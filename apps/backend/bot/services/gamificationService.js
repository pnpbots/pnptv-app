const { query: poolQuery } = require('../../config/postgres');

class GamificationService {
  // Get all categories with their badges
  async getCategories() {
    const cats = await poolQuery('SELECT * FROM gamification_categories ORDER BY sort_order');
    const badges = await poolQuery('SELECT * FROM gamification_badges ORDER BY sort_order');
    return cats.rows.map(cat => ({
      ...cat,
      badges: badges.rows.filter(b => b.category_id === cat.id)
    }));
  }

  // Get all badges (optionally filtered by category slug)
  async getBadges(categorySlug) {
    if (categorySlug) {
      const result = await poolQuery(
        `SELECT b.* FROM gamification_badges b
         JOIN gamification_categories c ON b.category_id = c.id
         WHERE c.slug = $1 ORDER BY b.sort_order`,
        [categorySlug]
      );
      return result.rows;
    }
    const result = await poolQuery('SELECT * FROM gamification_badges ORDER BY sort_order');
    return result.rows;
  }

  // Get badges for a specific user
  async getUserBadges(userId) {
    const result = await poolQuery(
      `SELECT ub.*, b.slug, b.name_en, b.name_es, b.description_en, b.description_es, b.icon, b.level,
              c.slug as category_slug, c.name_en as category_name_en, c.name_es as category_name_es, c.icon as category_icon
       FROM user_badges ub
       JOIN gamification_badges b ON ub.badge_id = b.id
       JOIN gamification_categories c ON b.category_id = c.id
       WHERE ub.user_id = $1
       ORDER BY ub.awarded_at DESC`,
      [userId]
    );
    return result.rows;
  }

  // Award a badge to a user
  async awardBadge(userId, badgeSlug, awardedBy = null, note = null) {
    const badge = await poolQuery(
      'SELECT id, name_en, name_es FROM gamification_badges WHERE slug = $1',
      [badgeSlug]
    );
    if (!badge.rows.length) throw new Error(`Badge not found: ${badgeSlug}`);

    const result = await poolQuery(
      `INSERT INTO user_badges (user_id, badge_id, awarded_by, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, badge_id) DO NOTHING
       RETURNING *`,
      [userId, badge.rows[0].id, awardedBy, note]
    );
    return { awarded: result.rowCount > 0, badge: badge.rows[0], userBadge: result.rows[0] || null };
  }

  // Revoke a badge from a user
  async revokeBadge(userId, badgeSlug) {
    const badge = await poolQuery(
      'SELECT id FROM gamification_badges WHERE slug = $1',
      [badgeSlug]
    );
    if (!badge.rows.length) throw new Error(`Badge not found: ${badgeSlug}`);
    const result = await poolQuery(
      'DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2',
      [userId, badge.rows[0].id]
    );
    return { revoked: result.rowCount > 0 };
  }

  // Award badge to multiple users (bulk)
  async awardBadgeBulk(userIds, badgeSlug, awardedBy = null, note = null) {
    const badge = await poolQuery(
      'SELECT id, name_en, name_es FROM gamification_badges WHERE slug = $1',
      [badgeSlug]
    );
    if (!badge.rows.length) throw new Error(`Badge not found: ${badgeSlug}`);

    let awarded = 0;
    for (const userId of userIds) {
      const result = await poolQuery(
        `INSERT INTO user_badges (user_id, badge_id, awarded_by, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, badge_id) DO NOTHING
         RETURNING *`,
        [userId, badge.rows[0].id, awardedBy, note]
      );
      if (result.rowCount > 0) awarded++;
    }
    return { awarded, total: userIds.length, badge: badge.rows[0] };
  }

  // Get users who have a specific badge
  async getBadgeHolders(badgeSlug) {
    const result = await poolQuery(
      `SELECT u.id, u.first_name, u.username, u.creator_status, ub.awarded_at, ub.note
       FROM user_badges ub
       JOIN gamification_badges b ON ub.badge_id = b.id
       JOIN users u ON ub.user_id = u.id
       WHERE b.slug = $1
       ORDER BY ub.awarded_at DESC`,
      [badgeSlug]
    );
    return result.rows;
  }

  // Award Me Cuido 1 to all active creators
  async awardMeCuidoToCreators(awardedBy = null) {
    const creators = await poolQuery(
      "SELECT id FROM users WHERE creator_status = 'active'"
    );
    const userIds = creators.rows.map(r => r.id);
    if (!userIds.length) return { awarded: 0, total: 0 };
    return this.awardBadgeBulk(userIds, 'me-cuido-1', awardedBy, 'Awarded to active creators');
  }
}

module.exports = new GamificationService();
