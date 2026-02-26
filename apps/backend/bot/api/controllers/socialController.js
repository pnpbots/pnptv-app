const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const MediaCleanupService = require('../../services/mediaCleanupService');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// ── Feed ──────────────────────────────────────────────────────────────────────

const getFeed = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { cursor, limit = 20 } = req.query;
  const lim = Math.min(Number(limit) || 20, 50);
  try {
    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.created_at,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me,
              -- repost original
              rp.content as repost_content, rp.created_at as repost_created_at,
              ru.username as repost_author_username, ru.first_name as repost_author_first_name
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       LEFT JOIN social_posts rp ON sp.repost_of_id = rp.id
       LEFT JOIN users ru ON rp.user_id = ru.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL
         ${cursor ? 'AND sp.created_at < $3' : ''}
       ORDER BY sp.created_at DESC
       LIMIT $2`,
      cursor ? [user.id, lim, cursor] : [user.id, lim]
    );
    const nextCursor = rows.length === lim ? rows[rows.length - 1].created_at : null;
    return res.json({ success: true, posts: rows, nextCursor });
  } catch (err) {
    logger.error('getFeed error', err);
    return res.status(500).json({ error: 'Failed to load feed' });
  }
};

const getWall = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { userId } = req.params;
  const { cursor, limit = 20 } = req.query;
  const lim = Math.min(Number(limit) || 20, 50);
  try {
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
           ${cursor ? 'AND sp.created_at < $4' : ''}
         ORDER BY sp.created_at DESC LIMIT $3`,
        cursor ? [user.id, userId, lim, cursor] : [user.id, userId, lim]
      ),
      query(
        `SELECT id, username, first_name, last_name, bio, photo_file_id, pnptv_id,
                subscription_status, created_at
         FROM users WHERE id = $1`,
        [userId]
      ),
    ]);
    if (profileRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const nextCursor = postsRes.rows.length === lim ? postsRes.rows[postsRes.rows.length - 1].created_at : null;
    return res.json({ success: true, profile: profileRes.rows[0], posts: postsRes.rows, nextCursor });
  } catch (err) {
    logger.error('getWall error', err);
    return res.status(500).json({ error: 'Failed to load wall' });
  }
};

// ── Create Post ───────────────────────────────────────────────────────────────

const createPost = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { content, replyToId, repostOfId } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  if (content.length > 5000) return res.status(400).json({ error: 'Post too long (max 5000 chars)' });

  try {
    const { rows } = await query(
      `INSERT INTO social_posts (user_id, content, reply_to_id, repost_of_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, content, media_url, media_type, reply_to_id, repost_of_id,
                 likes_count, reposts_count, replies_count, created_at`,
      [user.id, content.trim(), replyToId || null, repostOfId || null]
    );
    const post = rows[0];

    // Update reply count on parent
    if (replyToId) {
      await query('UPDATE social_posts SET replies_count = replies_count + 1 WHERE id = $1', [replyToId]);
    }
    // Update repost count on original
    if (repostOfId) {
      await query('UPDATE social_posts SET reposts_count = reposts_count + 1 WHERE id = $1', [repostOfId]);
    }

    // Mirror to Mastodon if token configured and it's a top-level post
    if (!replyToId && !repostOfId && process.env.MASTODON_ACCESS_TOKEN && process.env.MASTODON_BASE_URL) {
      axios.post(
        `${process.env.MASTODON_BASE_URL}/api/v1/statuses`,
        { status: content.trim() },
        { headers: { Authorization: `Bearer ${process.env.MASTODON_ACCESS_TOKEN}` } }
      ).then(r => {
        query('UPDATE social_posts SET mastodon_id = $1 WHERE id = $2', [r.data.id, post.id]).catch(() => {});
      }).catch(() => {});
    }

    // Notify room via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('feed:new_post', {
        ...post,
        author_id: user.id,
        author_username: user.username,
        author_first_name: user.firstName,
        author_photo: user.photoUrl,
        liked_by_me: false,
      });
    }

    const fullPost = {
      ...post,
      author_id: user.id,
      author_username: user.username,
      author_first_name: user.firstName || user.first_name,
      author_photo: user.photoUrl || user.photo_url,
      liked_by_me: false,
    };
    return res.json({ success: true, post: fullPost });
  } catch (err) {
    logger.error('createPost error', err);
    return res.status(500).json({ error: 'Failed to create post' });
  }
};

// ── Like ──────────────────────────────────────────────────────────────────────

const toggleLike = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { postId } = req.params;
  try {
    const existing = await query('SELECT 1 FROM social_post_likes WHERE post_id=$1 AND user_id=$2', [postId, user.id]);
    if (existing.rows.length > 0) {
      await query('DELETE FROM social_post_likes WHERE post_id=$1 AND user_id=$2', [postId, user.id]);
      await query('UPDATE social_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id=$1', [postId]);
      return res.json({ liked: false });
    } else {
      await query('INSERT INTO social_post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, user.id]);
      await query('UPDATE social_posts SET likes_count = likes_count + 1 WHERE id=$1', [postId]);
      return res.json({ liked: true });
    }
  } catch (err) {
    logger.error('toggleLike error', err);
    return res.status(500).json({ error: 'Failed to toggle like' });
  }
};

// ── Delete ────────────────────────────────────────────────────────────────────

const deletePost = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { postId } = req.params;
  try {
    // Delete media file if present (cost optimization)
    await MediaCleanupService.deletePostMedia(postId);

    const { rowCount } = await query(
      'UPDATE social_posts SET is_deleted=true WHERE id=$1 AND user_id=$2',
      [postId, user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Post not found or not yours' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('deletePost error', err);
    return res.status(500).json({ error: 'Failed to delete post' });
  }
};

// ── Replies ───────────────────────────────────────────────────────────────────

const getReplies = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { postId } = req.params;
  const { cursor } = req.query;
  try {
    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.likes_count, sp.replies_count, sp.created_at,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me
       FROM social_posts sp JOIN users u ON sp.user_id = u.id
       WHERE sp.reply_to_id = $2 AND sp.is_deleted = false
         ${cursor ? 'AND sp.created_at > $3' : ''}
       ORDER BY sp.created_at ASC LIMIT 20`,
      cursor ? [user.id, postId, cursor] : [user.id, postId]
    );
    return res.json({ success: true, replies: rows });
  } catch (err) {
    logger.error('getReplies error', err);
    return res.status(500).json({ error: 'Failed to load replies' });
  }
};

// ── Post to Mastodon ──────────────────────────────────────────────────────────

const postToMastodon = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const token = process.env.MASTODON_ACCESS_TOKEN;
  const baseUrl = process.env.MASTODON_BASE_URL || process.env.MASTODON_INSTANCE;
  if (!token || !baseUrl) return res.status(503).json({ error: 'Mastodon not configured' });
  const { status } = req.body;
  if (!status || !status.trim()) return res.status(400).json({ error: 'Status required' });
  try {
    const r = await axios.post(`${baseUrl}/api/v1/statuses`, { status: status.trim() }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json({ success: true, post: r.data });
  } catch (err) {
    logger.error('postToMastodon error', err.message);
    return res.status(500).json({ error: 'Failed to post to Mastodon' });
  }
};

// ── Create Post with Media ────────────────────────────────────────────────

const createPostWithMedia = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { content, replyToId, repostOfId } = req.body;

  if (!content || !content.toString().trim()) return res.status(400).json({ error: 'Content required' });
  if (content.toString().length > 5000) return res.status(400).json({ error: 'Post too long (max 5000 chars)' });

  let mediaUrl = null;
  let mediaType = null;

  try {
    // Process uploaded media if present
    if (req.file) {
      const { mimetype, buffer, originalname } = req.file;
      const uploadDir = path.join(__dirname, '../../../../public/uploads/posts');
      await fs.mkdir(uploadDir, { recursive: true });

      // Determine media type and process
      if (/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mimetype)) {
        mediaType = 'image';
        const ext = '.webp';
        const filename = `img-${user.id}-${Date.now()}${ext}`;
        const filePath = path.join(uploadDir, filename);

        // Aggressive compression: max 800px (not 1200), WebP 70% quality, progressive (saves ~50%)
        await sharp(buffer)
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 70, progressive: true })
          .toFile(filePath);

        mediaUrl = `/uploads/posts/${filename}`;
      } else if (/^video\/(mp4|webm)$/i.test(mimetype)) {
        mediaType = 'video';
        // IMPORTANT: Videos NOT stored locally - too expensive.
        // Instead, require external video hosting (YouTube, Vimeo, etc.)
        return res.status(400).json({
          error: 'Videos must be uploaded to YouTube/Vimeo and shared via link. Local video storage disabled to save costs.'
        });
      } else {
        return res.status(400).json({ error: 'Only image (jpg/png/webp/gif) files are allowed' });
      }
    }

    // Create post record
    const { rows } = await query(
      `INSERT INTO social_posts (user_id, content, media_url, media_type, reply_to_id, repost_of_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, content, media_url, media_type, reply_to_id, repost_of_id,
                 likes_count, reposts_count, replies_count, created_at`,
      [user.id, content.toString().trim(), mediaUrl, mediaType, replyToId || null, repostOfId || null]
    );
    const post = rows[0];

    // Update reply count on parent
    if (replyToId) {
      await query('UPDATE social_posts SET replies_count = replies_count + 1 WHERE id = $1', [replyToId]);
    }
    // Update repost count on original
    if (repostOfId) {
      await query('UPDATE social_posts SET reposts_count = reposts_count + 1 WHERE id = $1', [repostOfId]);
    }

    // Mirror to Mastodon if token configured and it's a top-level post
    if (!replyToId && !repostOfId && process.env.MASTODON_ACCESS_TOKEN && process.env.MASTODON_BASE_URL) {
      axios.post(
        `${process.env.MASTODON_BASE_URL}/api/v1/statuses`,
        { status: content.toString().trim() },
        { headers: { Authorization: `Bearer ${process.env.MASTODON_ACCESS_TOKEN}` } }
      ).then(r => {
        query('UPDATE social_posts SET mastodon_id = $1 WHERE id = $2', [r.data.id, post.id]).catch(() => {});
      }).catch(() => {});
    }

    // Notify room via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('feed:new_post', {
        ...post,
        author_id: user.id,
        author_username: user.username,
        author_first_name: user.firstName,
        author_photo: user.photoUrl,
        liked_by_me: false,
      });
    }

    const fullPost = {
      ...post,
      author_id: user.id,
      author_username: user.username,
      author_first_name: user.firstName || user.first_name,
      author_photo: user.photoUrl || user.photo_url,
      liked_by_me: false,
    };
    return res.json({ success: true, post: fullPost });
  } catch (err) {
    logger.error('createPostWithMedia error', err);
    return res.status(500).json({ error: 'Failed to create post' });
  }
};

// ── Public Profile ───────────────────────────────────────────────────────────

const getPublicProfile = async (req, res) => {
  const { userId } = req.params;
  const { cursor, limit = 20 } = req.query;
  const lim = Math.min(Number(limit) || 20, 50);
  const viewerId = req.session?.user?.id || null;

  try {
    // Build parameterized query dynamically to avoid index bugs
    const params = [userId, lim];
    let likedSubquery = '';
    let cursorClause = '';

    if (viewerId) {
      params.push(viewerId);
      likedSubquery = `, EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$${params.length}) as liked_by_me`;
    }
    if (cursor) {
      params.push(cursor);
      cursorClause = `AND sp.created_at < $${params.length}`;
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
         ORDER BY sp.created_at DESC LIMIT $2`,
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

    if (profileRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const profile = profileRes.rows[0];
    const posts = postsRes.rows.map(p => ({
      ...p,
      liked_by_me: viewerId ? p.liked_by_me : false,
    }));
    const nextCursor = posts.length === lim ? posts[posts.length - 1].created_at : null;

    return res.json({
      success: true,
      profile: {
        id: profile.id,
        username: profile.username,
        firstName: profile.first_name,
        lastName: profile.last_name,
        bio: profile.bio,
        photoUrl: profile.photo_file_id,
        pnptvId: profile.pnptv_id,
        subscriptionStatus: profile.subscription_status,
        memberSince: profile.created_at,
        postCount: postCountRes.rows[0]?.count || 0,
      },
      posts,
      nextCursor,
    });
  } catch (err) {
    logger.error('getPublicProfile error', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
};

module.exports = { getFeed, getWall, createPost, toggleLike, deletePost, getReplies, postToMastodon, createPostWithMedia, getPublicProfile };
