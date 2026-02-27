const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const axios = require('axios');
const MediaCleanupService = require('./mediaCleanupService');

/**
 * Check if a photo_file_id is a valid web-servable URL (local path or http URL).
 * Telegram file IDs (base64-like strings) are NOT valid web URLs.
 */
const isValidPhotoUrl = (photo) => {
  if (!photo || typeof photo !== 'string') return false;
  return photo.startsWith('/') || photo.startsWith('http');
};

/**
 * Sanitize post rows: convert Telegram file IDs to null so the frontend
 * shows a gradient fallback instead of a broken <img> tag.
 */
const sanitizePostRows = (rows) => {
  return rows.map(row => ({
    ...row,
    author_photo: isValidPhotoUrl(row.author_photo) ? row.author_photo : null,
  }));
};

class SocialPostService {
  // ── Feed ──────────────────────────────────────────────────────────────────

  /**
   * Full paginated feed for the Social page (/api/webapp/social/feed).
   * Requires userId for the liked_by_me subquery.
   * Uses ID-based cursor pagination for consistent, index-friendly fetching.
   */
  static async getFeed(userId, cursor, limit = 20) {
    const lim = Math.min(Number(limit) || 20, 50);
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const params = cursorId ? [userId, lim, cursorId] : [userId, lim];
    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.created_at,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me,
              rp.content as repost_content, rp.created_at as repost_created_at,
              ru.username as repost_author_username, ru.first_name as repost_author_first_name
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       LEFT JOIN social_posts rp ON sp.repost_of_id = rp.id
       LEFT JOIN users ru ON rp.user_id = ru.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL
         ${cursorId ? 'AND sp.id < $3' : ''}
       ORDER BY sp.id DESC
       LIMIT $2`,
      params
    );
    const nextCursor = rows.length === lim ? String(rows[rows.length - 1].id) : null;
    return { posts: sanitizePostRows(rows), nextCursor };
  }

  /**
   * Home page preview feed (/api/webapp/social/home-feed).
   * Returns the latest N posts without a liked_by_me check.
   * Does NOT require authentication — the home page shows this before/after login.
   * liked_by_me is always false; the Social page full feed provides accurate state.
   */
  static async getHomeFeed(limit = 10) {
    const lim = Math.min(Number(limit) || 10, 20);
    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.created_at,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              false as liked_by_me,
              rp.content as repost_content, rp.created_at as repost_created_at,
              ru.username as repost_author_username, ru.first_name as repost_author_first_name
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       LEFT JOIN social_posts rp ON sp.repost_of_id = rp.id
       LEFT JOIN users ru ON rp.user_id = ru.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL
       ORDER BY sp.id DESC
       LIMIT $1`,
      [lim]
    );
    return { posts: sanitizePostRows(rows) };
  }

  // ── Wall ──────────────────────────────────────────────────────────────────

  static async getWall(userId, viewerId, cursor, limit = 20) {
    const lim = Math.min(Number(limit) || 20, 50);
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const params = cursorId ? [viewerId, userId, lim, cursorId] : [viewerId, userId, lim];
    const [postsRes, profileRes] = await Promise.all([
      query(
        `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.reply_to_id, sp.repost_of_id,
                sp.likes_count, sp.reposts_count, sp.replies_count, sp.created_at,
                u.id as author_id, u.username as author_username,
                u.first_name as author_first_name, u.photo_file_id as author_photo,
                EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me
         FROM social_posts sp
         JOIN users u ON sp.user_id = u.id
         WHERE sp.is_deleted = false AND sp.user_id = $2 AND sp.reply_to_id IS NULL
           ${cursorId ? 'AND sp.id < $4' : ''}
         ORDER BY sp.id DESC LIMIT $3`,
        params
      ),
      query(
        `SELECT id, username, first_name, last_name, bio, photo_file_id, pnptv_id,
                subscription_status, created_at
         FROM users WHERE id = $1`,
        [userId]
      ),
    ]);
    const profile = profileRes.rows[0] || null;
    if (profile) profile.photo_file_id = isValidPhotoUrl(profile.photo_file_id) ? profile.photo_file_id : null;
    const nextCursor = postsRes.rows.length === lim ? String(postsRes.rows[postsRes.rows.length - 1].id) : null;
    return { profile, posts: sanitizePostRows(postsRes.rows), nextCursor };
  }

  // ── Create Post ───────────────────────────────────────────────────────────

  static async createPost(userId, content, mediaUrl, mediaType, replyToId, repostOfId) {
    const { rows } = await query(
      `INSERT INTO social_posts (user_id, content, media_url, media_type, reply_to_id, repost_of_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, content, media_url, media_type, reply_to_id, repost_of_id,
                 likes_count, reposts_count, replies_count, created_at`,
      [userId, content, mediaUrl, mediaType, replyToId || null, repostOfId || null]
    );
    const post = rows[0];

    if (replyToId) {
      await query('UPDATE social_posts SET replies_count = replies_count + 1 WHERE id = $1', [replyToId]);
    }
    if (repostOfId) {
      await query('UPDATE social_posts SET reposts_count = reposts_count + 1 WHERE id = $1', [repostOfId]);
    }

    return post;
  }

  // ── Toggle Like ───────────────────────────────────────────────────────────

  static async toggleLike(postId, userId) {
    const existing = await query('SELECT 1 FROM social_post_likes WHERE post_id=$1 AND user_id=$2', [postId, userId]);
    if (existing.rows.length > 0) {
      await query('DELETE FROM social_post_likes WHERE post_id=$1 AND user_id=$2', [postId, userId]);
      await query('UPDATE social_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id=$1', [postId]);
      return { liked: false };
    }
    await query('INSERT INTO social_post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, userId]);
    await query('UPDATE social_posts SET likes_count = likes_count + 1 WHERE id=$1', [postId]);
    return { liked: true };
  }

  // ── Delete Post ───────────────────────────────────────────────────────────

  static async deletePost(postId, userId, isAdmin = false) {
    await MediaCleanupService.deletePostMedia(postId);

    if (isAdmin) {
      const { rowCount } = await query(
        'UPDATE social_posts SET is_deleted=true, updated_at=NOW() WHERE id=$1',
        [postId]
      );
      return rowCount > 0;
    }
    const { rowCount } = await query(
      'UPDATE social_posts SET is_deleted=true WHERE id=$1 AND user_id=$2',
      [postId, userId]
    );
    return rowCount > 0;
  }

  // ── Replies ───────────────────────────────────────────────────────────────

  static async getReplies(postId, viewerId, cursor) {
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const params = cursorId ? [viewerId, postId, cursorId] : [viewerId, postId];
    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.likes_count, sp.replies_count, sp.created_at,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me
       FROM social_posts sp JOIN users u ON sp.user_id = u.id
       WHERE sp.reply_to_id = $2 AND sp.is_deleted = false
         ${cursorId ? 'AND sp.id > $3' : ''}
       ORDER BY sp.id ASC LIMIT 20`,
      params
    );
    return { replies: sanitizePostRows(rows) };
  }

  // ── Public Profile ────────────────────────────────────────────────────────

  static async getPublicProfile(userId, viewerId, cursor, limit = 20) {
    const lim = Math.min(Number(limit) || 20, 50);
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const params = [userId, lim];
    let likedSubquery = '';
    let cursorClause = '';

    if (viewerId) {
      params.push(viewerId);
      likedSubquery = `, EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$${params.length}) as liked_by_me`;
    }
    if (cursorId) {
      params.push(cursorId);
      cursorClause = `AND sp.id < $${params.length}`;
    }

    const [postsRes, profileRes, postCountRes] = await Promise.all([
      query(
        `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.reply_to_id, sp.repost_of_id,
                sp.likes_count, sp.reposts_count, sp.replies_count, sp.created_at,
                u.id as author_id, u.username as author_username,
                u.first_name as author_first_name, u.photo_file_id as author_photo
                ${likedSubquery}
         FROM social_posts sp
         JOIN users u ON sp.user_id = u.id
         WHERE sp.is_deleted = false AND sp.user_id = $1 AND sp.reply_to_id IS NULL
           ${cursorClause}
         ORDER BY sp.id DESC LIMIT $2`,
        params
      ),
      query(
        `SELECT id, username, first_name, last_name, bio, photo_file_id, pnptv_id,
                subscription_status, created_at
         FROM users WHERE id = $1`,
        [userId]
      ),
      query(
        'SELECT COUNT(*)::int as count FROM social_posts WHERE user_id = $1 AND is_deleted = false AND reply_to_id IS NULL',
        [userId]
      ),
    ]);

    const profile = profileRes.rows[0] || null;
    if (profile) profile.photo_file_id = isValidPhotoUrl(profile.photo_file_id) ? profile.photo_file_id : null;
    const posts = sanitizePostRows(postsRes.rows).map(p => ({
      ...p,
      liked_by_me: viewerId ? p.liked_by_me : false,
    }));
    const nextCursor = posts.length === lim ? String(posts[posts.length - 1].id) : null;
    const postCount = postCountRes.rows[0]?.count || 0;

    return { profile, posts, nextCursor, postCount };
  }

  // ── Admin List Posts ──────────────────────────────────────────────────────

  static async adminListPosts(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [result, countResult] = await Promise.all([
      query(
        `SELECT p.id, p.user_id, p.content, p.media_url, p.media_type,
                p.likes_count, p.replies_count, p.created_at,
                u.username, u.first_name
         FROM social_posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.is_deleted = false
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query('SELECT COUNT(*)::int as count FROM social_posts WHERE is_deleted = false'),
    ]);

    const total = countResult.rows[0]?.count || 0;
    const totalPages = Math.ceil(total / limit);
    return { posts: result.rows, pagination: { page, limit, total, totalPages } };
  }

  // ── Mastodon Mirror ───────────────────────────────────────────────────────

  static mirrorToMastodon(content, postId) {
    const token = process.env.MASTODON_ACCESS_TOKEN;
    const baseUrl = process.env.MASTODON_BASE_URL;
    if (!token || !baseUrl) return;

    axios.post(
      `${baseUrl}/api/v1/statuses`,
      { status: content },
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => {
      query('UPDATE social_posts SET mastodon_id = $1 WHERE id = $2', [r.data.id, postId]).catch(() => {});
    }).catch(() => {});
  }
}

module.exports = SocialPostService;
