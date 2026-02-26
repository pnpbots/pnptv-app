const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class WallOfFameModel {
  static async recordPost({ groupId, messageId, userId, dateKey, isNewMember, createdAt }) {
    const postSql = `
      INSERT INTO wall_of_fame_posts (group_id, message_id, user_id, date_key, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (group_id, message_id) DO NOTHING
    `;

    const statsSql = `
      INSERT INTO wall_of_fame_daily_stats (
        date_key,
        user_id,
        photos_shared,
        reactions_received,
        is_new_member,
        first_post_at,
        updated_at
      )
      VALUES ($1, $2, 1, 0, $3, $4, NOW())
      ON CONFLICT (date_key, user_id) DO UPDATE SET
        photos_shared = wall_of_fame_daily_stats.photos_shared + 1,
        is_new_member = wall_of_fame_daily_stats.is_new_member OR EXCLUDED.is_new_member,
        first_post_at = LEAST(wall_of_fame_daily_stats.first_post_at, EXCLUDED.first_post_at),
        updated_at = NOW()
    `;

    try {
      await query(postSql, [groupId, messageId, userId, dateKey, createdAt]);
      await query(statsSql, [dateKey, userId, isNewMember, createdAt]);
    } catch (error) {
      logger.error('Error recording Wall of Fame post:', error);
    }
  }

  static async incrementReactions({ groupId, messageId, delta }) {
    if (delta === 0) {
      return null;
    }

    const postSql = `
      UPDATE wall_of_fame_posts
      SET reactions_count = GREATEST(reactions_count + $1, 0)
      WHERE group_id = $2 AND message_id = $3
      RETURNING user_id, date_key
    `;

    const statsSql = `
      UPDATE wall_of_fame_daily_stats
      SET reactions_received = GREATEST(reactions_received + $1, 0),
          updated_at = NOW()
      WHERE date_key = $2 AND user_id = $3
    `;

    try {
      const result = await query(postSql, [delta, groupId, messageId]);
      const post = result.rows[0];
      if (!post) {
        return null;
      }

      await query(statsSql, [delta, post.date_key, post.user_id]);
      return post;
    } catch (error) {
      logger.error('Error incrementing Wall of Fame reactions:', error);
      return null;
    }
  }

  static async getDailyWinners(dateKey) {
    const winnersSql = 'SELECT * FROM wall_of_fame_daily_winners WHERE date_key = $1';
    try {
      const result = await query(winnersSql, [dateKey]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting Wall of Fame daily winners:', error);
      return null;
    }
  }

  static async setDailyWinners(dateKey, winners) {
    const sql = `
      INSERT INTO wall_of_fame_daily_winners (
        date_key,
        legend_user_id,
        new_member_user_id,
        active_user_id,
        processed_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (date_key) DO NOTHING
    `;

    try {
      await query(sql, [
        dateKey,
        winners.legendUserId || null,
        winners.newMemberUserId || null,
        winners.activeUserId || null,
      ]);
      return true;
    } catch (error) {
      logger.error('Error setting Wall of Fame daily winners:', error);
      return false;
    }
  }

  static async calculateDailyWinners(dateKey) {
    const legendSql = `
      SELECT user_id
      FROM wall_of_fame_daily_stats
      WHERE date_key = $1
      ORDER BY reactions_received DESC, photos_shared DESC, first_post_at ASC
      LIMIT 1
    `;

    const activeSql = `
      SELECT user_id
      FROM wall_of_fame_daily_stats
      WHERE date_key = $1
      ORDER BY photos_shared DESC, reactions_received DESC, first_post_at ASC
      LIMIT 1
    `;

    const newMemberSql = `
      SELECT user_id
      FROM wall_of_fame_daily_stats
      WHERE date_key = $1 AND is_new_member = true
      ORDER BY first_post_at ASC
      LIMIT 1
    `;

    try {
      const [legendResult, activeResult, newMemberResult] = await Promise.all([
        query(legendSql, [dateKey]),
        query(activeSql, [dateKey]),
        query(newMemberSql, [dateKey]),
      ]);

      return {
        legendUserId: legendResult.rows[0]?.user_id || null,
        activeUserId: activeResult.rows[0]?.user_id || null,
        newMemberUserId: newMemberResult.rows[0]?.user_id || null,
      };
    } catch (error) {
      logger.error('Error calculating Wall of Fame winners:', error);
      return {
        legendUserId: null,
        activeUserId: null,
        newMemberUserId: null,
      };
    }
  }
}

module.exports = WallOfFameModel;
