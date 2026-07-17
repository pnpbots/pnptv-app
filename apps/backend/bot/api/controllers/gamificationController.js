const gamificationService = require('../../../services/gamificationService');
const { resolveUserId } = require('../../utils/helpers');
const { query: poolQuery } = require('../../../config/postgres');

// Returns the ISO Monday date string for the current UTC week (YYYY-MM-DD).
function currentWeekStart() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday.toISOString().slice(0, 10);
}

// GET /api/webapp/gamification/leaderboard/weekly
async function getWeeklyLeaderboard(req, res) {
  try {
    const weekStart = currentWeekStart();
    const currentUserId = req.user?.id || null;

    // Prefer current-week rows; fall back to all-time aggregate if none exist yet.
    const weekRes = await poolQuery(
      `SELECT gar.rank_position,
              gar.points,
              gar.user_id,
              gar.username   AS tg_username,
              gar.prime_awarded,
              u.username     AS app_username,
              u.first_name,
              u.photo_file_id
         FROM group_activity_ranks gar
         LEFT JOIN users u ON u.id = gar.user_id
        WHERE gar.week_start = $1
          AND gar.points > 0
        ORDER BY gar.points DESC, gar.rank_position ASC NULLS LAST
        LIMIT 20`,
      [weekStart]
    );

    let rows = weekRes.rows;
    let period = 'weekly';

    if (rows.length === 0) {
      // All-time fallback across all groups (aggregate by user)
      const allTimeRes = await poolQuery(
        `SELECT ROW_NUMBER() OVER (ORDER BY SUM(gp.points) DESC) AS rank_position,
                SUM(gp.points)::int  AS points,
                gp.pnptv_user_id     AS user_id,
                MAX(gp.username)     AS tg_username,
                false                AS prime_awarded,
                u.username           AS app_username,
                u.first_name,
                u.photo_file_id
           FROM group_points gp
           LEFT JOIN users u ON u.id = gp.pnptv_user_id
          GROUP BY gp.pnptv_user_id, u.username, u.first_name, u.photo_file_id
         HAVING SUM(gp.points) > 0
          ORDER BY SUM(gp.points) DESC
          LIMIT 20`
      );
      rows = allTimeRes.rows;
      period = 'alltime';
    }

    const leaderboard = rows.map((r, i) => {
      const displayName = r.app_username || r.tg_username || r.first_name || 'Member';
      const rank = r.rank_position != null ? Number(r.rank_position) : i + 1;
      return {
        rank,
        userId: r.user_id,
        displayName,
        avatar: r.photo_file_id || null,
        points: Number(r.points),
        primeAwarded: Boolean(r.prime_awarded),
        isCurrentUser: currentUserId != null && String(r.user_id) === String(currentUserId),
      };
    });

    // Determine current user's rank if not in top 20
    let currentUserRank = null;
    if (currentUserId) {
      const inTop = leaderboard.find(e => e.isCurrentUser);
      if (!inTop) {
        const rankRow = await poolQuery(
          `SELECT COUNT(*) + 1 AS rank_position,
                  SUM(points)::int AS points
             FROM group_activity_ranks
            WHERE week_start = $1
              AND points > (
                    SELECT COALESCE(SUM(points), 0)
                      FROM group_activity_ranks
                     WHERE week_start = $1 AND user_id = $2
                  )`,
          [weekStart, String(currentUserId)]
        );
        const myPoints = await poolQuery(
          `SELECT COALESCE(SUM(points), 0)::int AS points
             FROM group_activity_ranks
            WHERE week_start = $1 AND user_id = $2`,
          [weekStart, String(currentUserId)]
        );
        const pts = myPoints.rows[0]?.points ?? 0;
        if (pts > 0) {
          currentUserRank = {
            rank: Number(rankRow.rows[0]?.rank_position ?? 0),
            points: pts,
          };
        }
      }
    }

    res.json({ success: true, period, weekStart, leaderboard, currentUserRank });
  } catch (err) {
    console.error('getWeeklyLeaderboard error:', err);
    res.status(500).json({ success: false, error: 'Failed to load leaderboard' });
  }
}

// GET /api/webapp/gamification/categories
async function getCategories(req, res) {
  try {
    const categories = await gamificationService.getCategories();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('getCategories error:', err);
    res.status(500).json({ success: false, error: 'Failed to load categories' });
  }
}

// GET /api/webapp/gamification/badges?category=wellness
async function getBadges(req, res) {
  try {
    const badges = await gamificationService.getBadges(req.query.category);
    res.json({ success: true, badges });
  } catch (err) {
    console.error('getBadges error:', err);
    res.status(500).json({ success: false, error: 'Failed to load badges' });
  }
}

// GET /api/webapp/gamification/user/:userId/badges
async function getUserBadges(req, res) {
  try {
    const userId = await resolveUserId(req.params.userId);
    if (!userId) return res.status(404).json({ success: false, error: 'User not found' });
    const badges = await gamificationService.getUserBadges(userId);
    res.json({ success: true, badges });
  } catch (err) {
    console.error('getUserBadges error:', err);
    res.status(500).json({ success: false, error: 'Failed to load user badges' });
  }
}

// POST /api/webapp/gamification/award (admin only)
async function awardBadge(req, res) {
  try {
    const { userId, badgeSlug, note } = req.body;
    if (!userId || !badgeSlug) return res.status(400).json({ success: false, error: 'userId and badgeSlug required' });
    const adminId = req.user?.id || null;
    const result = await gamificationService.awardBadge(userId, badgeSlug, adminId, note);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('awardBadge error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/webapp/gamification/revoke (admin only)
async function revokeBadge(req, res) {
  try {
    const { userId, badgeSlug } = req.body;
    if (!userId || !badgeSlug) return res.status(400).json({ success: false, error: 'userId and badgeSlug required' });
    const result = await gamificationService.revokeBadge(userId, badgeSlug);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('revokeBadge error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/webapp/gamification/award-creators-mecuido (admin only)
async function awardMeCuidoToCreators(req, res) {
  try {
    const adminId = req.user?.id || null;
    const result = await gamificationService.awardMeCuidoToCreators(adminId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('awardMeCuidoToCreators error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/webapp/gamification/badge/:badgeSlug/holders
async function getBadgeHolders(req, res) {
  try {
    const holders = await gamificationService.getBadgeHolders(req.params.badgeSlug);
    res.json({ success: true, holders });
  } catch (err) {
    console.error('getBadgeHolders error:', err);
    res.status(500).json({ success: false, error: 'Failed to load badge holders' });
  }
}

module.exports = { getCategories, getBadges, getUserBadges, awardBadge, revokeBadge, awardMeCuidoToCreators, getBadgeHolders, getWeeklyLeaderboard };
