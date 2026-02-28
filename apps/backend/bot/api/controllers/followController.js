'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const NotificationEmitter = require('../../services/notificationEmitter');

// Accounts that every user must follow — cannot be unfollowed
const ENFORCED_FOLLOW_IDS = ['8552451957', '8599671840', '8250283246']; // @pnptvadmin, @SantinoFurioso, @Lexboytv

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// ── Follow ────────────────────────────────────────────────────────────────────

const followUser = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.body;

  if (!targetId) return res.status(400).json({ error: 'userId required' });
  if (String(targetId) === String(actor.id)) return res.status(400).json({ error: 'Cannot follow yourself' });

  try {
    // Check target exists
    const targetRes = await query('SELECT id, username, first_name FROM users WHERE id = $1', [targetId]);
    if (!targetRes.rows.length) return res.status(404).json({ error: 'User not found' });
    const target = targetRes.rows[0];

    // Insert follow — ON CONFLICT DO NOTHING makes this idempotent
    const { rowCount } = await query(
      'INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [actor.id, targetId]
    );

    if (rowCount > 0) {
      // Increment counters only when a new row was inserted
      await query('UPDATE users SET following_count = following_count + 1 WHERE id = $1', [actor.id]);
      await query('UPDATE users SET followers_count = followers_count + 1 WHERE id = $1', [targetId]);

      // Fire notification (fire-and-forget)
      NotificationEmitter.emit({
        type: 'follow',
        category: 'social',
        priority: 'normal',
        actorId: actor.id,
        targetUserId: String(targetId),
        entityType: 'user',
        entityId: String(actor.id),
        message: `${actor.first_name || actor.firstName || actor.username || 'Someone'} started following you`,
      });
    }

    // Return updated counts for the target profile
    const countsRes = await query(
      'SELECT followers_count, following_count FROM users WHERE id = $1',
      [targetId]
    );
    const counts = countsRes.rows[0] || { followers_count: 0, following_count: 0 };

    return res.json({
      success: true,
      isFollowing: true,
      followerCount: counts.followers_count,
      followingCount: counts.following_count,
    });
  } catch (err) {
    logger.error('followUser error', err);
    return res.status(500).json({ error: 'Failed to follow user' });
  }
};

// ── Unfollow ──────────────────────────────────────────────────────────────────

const unfollowUser = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.body;

  if (!targetId) return res.status(400).json({ error: 'userId required' });

  // Block unfollowing enforced accounts
  if (ENFORCED_FOLLOW_IDS.includes(String(targetId))) {
    return res.status(403).json({ error: 'This account cannot be unfollowed' });
  }

  try {
    const { rowCount } = await query(
      'DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2',
      [actor.id, targetId]
    );

    if (rowCount > 0) {
      await query('UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = $1', [actor.id]);
      await query('UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = $1', [targetId]);
    }

    const countsRes = await query(
      'SELECT followers_count, following_count FROM users WHERE id = $1',
      [targetId]
    );
    const counts = countsRes.rows[0] || { followers_count: 0, following_count: 0 };

    return res.json({
      success: true,
      isFollowing: false,
      followerCount: counts.followers_count,
      followingCount: counts.following_count,
    });
  } catch (err) {
    logger.error('unfollowUser error', err);
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
};

// ── Follow Status ─────────────────────────────────────────────────────────────

const getFollowStatus = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.params;

  if (!targetId) return res.status(400).json({ error: 'userId required' });

  try {
    const [followRes, countsRes] = await Promise.all([
      query(
        'SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2',
        [actor.id, targetId]
      ),
      query('SELECT followers_count, following_count FROM users WHERE id = $1', [targetId]),
    ]);

    const counts = countsRes.rows[0] || { followers_count: 0, following_count: 0 };

    return res.json({
      success: true,
      isFollowing: followRes.rowCount > 0,
      followerCount: counts.followers_count,
      followingCount: counts.following_count,
    });
  } catch (err) {
    logger.error('getFollowStatus error', err);
    return res.status(500).json({ error: 'Failed to get follow status' });
  }
};

// ── Followers List ────────────────────────────────────────────────────────────

const getFollowers = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const cursor = req.query.cursor || null;

  try {
    const rows = await query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.photo_file_id, uf.created_at AS followed_at
       FROM user_follows uf
       JOIN users u ON u.id = uf.follower_id
       WHERE uf.following_id = $1
         AND ($2::timestamptz IS NULL OR uf.created_at < $2::timestamptz)
       ORDER BY uf.created_at DESC
       LIMIT $3`,
      [targetId, cursor, limit + 1]
    );

    const hasMore = rows.rows.length > limit;
    const users = rows.rows.slice(0, limit).map((r) => ({
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      photoUrl: r.photo_file_id,
      followedAt: r.followed_at,
    }));

    return res.json({
      success: true,
      users,
      nextCursor: hasMore ? rows.rows[limit - 1].followed_at.toISOString() : null,
    });
  } catch (err) {
    logger.error('getFollowers error', err);
    return res.status(500).json({ error: 'Failed to get followers' });
  }
};

// ── Following List ────────────────────────────────────────────────────────────

const getFollowing = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const cursor = req.query.cursor || null;

  try {
    const rows = await query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.photo_file_id, uf.created_at AS followed_at
       FROM user_follows uf
       JOIN users u ON u.id = uf.following_id
       WHERE uf.follower_id = $1
         AND ($2::timestamptz IS NULL OR uf.created_at < $2::timestamptz)
       ORDER BY uf.created_at DESC
       LIMIT $3`,
      [targetId, cursor, limit + 1]
    );

    const hasMore = rows.rows.length > limit;
    const users = rows.rows.slice(0, limit).map((r) => ({
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      photoUrl: r.photo_file_id,
      followedAt: r.followed_at,
    }));

    return res.json({
      success: true,
      users,
      nextCursor: hasMore ? rows.rows[limit - 1].followed_at.toISOString() : null,
    });
  } catch (err) {
    logger.error('getFollowing error', err);
    return res.status(500).json({ error: 'Failed to get following list' });
  }
};

// ── Following Feed ────────────────────────────────────────────────────────────

const getFollowingFeed = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const cursor = req.query.cursor ? BigInt(req.query.cursor) : null;

  try {
    const result = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count,
              sp.created_at, sp.is_wof, sp.bluesky_uri, sp.bluesky_cid,
              u.id AS author_id, u.username AS author_username,
              u.first_name AS author_first_name, u.photo_file_id AS author_photo,
              EXISTS(
                SELECT 1 FROM post_likes pl
                WHERE pl.post_id = sp.id AND pl.user_id = $1
              ) AS liked_by_me
       FROM social_posts sp
       JOIN user_follows uf ON sp.user_id = uf.following_id
       JOIN users u ON sp.user_id = u.id
       WHERE uf.follower_id = $1
         AND sp.is_deleted = FALSE
         AND sp.reply_to_id IS NULL
         AND ($2::bigint IS NULL OR sp.id < $2::bigint)
       ORDER BY sp.created_at DESC
       LIMIT $3`,
      [actor.id, cursor !== null ? String(cursor) : null, limit + 1]
    );

    const hasMore = result.rows.length > limit;
    const posts = result.rows.slice(0, limit).map((r) => ({
      id: r.id,
      content: r.content,
      media_url: r.media_url,
      media_type: r.media_type,
      reply_to_id: r.reply_to_id,
      repost_of_id: r.repost_of_id,
      likes_count: r.likes_count,
      reposts_count: r.reposts_count,
      replies_count: r.replies_count,
      created_at: r.created_at,
      is_wof: r.is_wof,
      bluesky_uri: r.bluesky_uri,
      bluesky_cid: r.bluesky_cid,
      author_id: r.author_id,
      author_username: r.author_username,
      author_first_name: r.author_first_name,
      author_photo: r.author_photo,
      liked_by_me: r.liked_by_me,
    }));

    return res.json({
      success: true,
      posts,
      nextCursor: hasMore ? String(result.rows[limit - 1].id) : null,
    });
  } catch (err) {
    logger.error('getFollowingFeed error', err);
    return res.status(500).json({ error: 'Failed to load following feed' });
  }
};

module.exports = {
  followUser,
  unfollowUser,
  getFollowStatus,
  getFollowers,
  getFollowing,
  getFollowingFeed,
};
