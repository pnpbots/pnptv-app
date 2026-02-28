const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../../../utils/logger');
const SocialPostService = require('../../services/socialPostService');
const axios = require('axios');

const { query: dbQuery } = require('../../../config/postgres');
const NotificationEmitter = require('../../services/notificationEmitter');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

/**
 * Check if a photo path is a valid web-servable URL (not a Telegram file ID).
 */
const isValidPhotoUrl = (photo) => {
  if (!photo || typeof photo !== 'string') return false;
  return photo.startsWith('/') || photo.startsWith('http');
};

// Look up fresh avatar URL from DB for the given user
const getUserPhotoFromDb = async (userId) => {
  try {
    const result = await dbQuery('SELECT photo_file_id FROM users WHERE id = $1', [userId]);
    const photo = result.rows[0]?.photo_file_id || null;
    return isValidPhotoUrl(photo) ? photo : null;
  } catch { return null; }
};

// ── Feed ──────────────────────────────────────────────────────────────────────

const getFeed = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const viewerSubStatus = user.subscription_status || user.subscriptionStatus;
    const result = await SocialPostService.getFeed(user.id, req.query.cursor, req.query.limit, viewerSubStatus);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getFeed error', err);
    return res.status(500).json({ error: 'Failed to load feed' });
  }
};

const getWall = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await SocialPostService.getWall(req.params.userId, user.id, req.query.cursor, req.query.limit);
    if (!result.profile) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getWall error', err);
    return res.status(500).json({ error: 'Failed to load wall' });
  }
};

// ── Wall of Fame Feed ────────────────────────────────────────────────────────

const getWofFeed = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await SocialPostService.getWofFeed(user.id, req.query.cursor, req.query.limit);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getWofFeed error', err);
    return res.status(500).json({ error: 'Failed to load Wall of Fame feed' });
  }
};

// ── Create Post ───────────────────────────────────────────────────────────────

const createPost = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { content, replyToId, repostOfId, isExclusive } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  if (content.length > 5000) return res.status(400).json({ error: 'Post too long (max 5000 chars)' });

  // Validate creator status for exclusive posts
  if (isExclusive) {
    const creatorCheck = await dbQuery('SELECT creator_status FROM users WHERE id = $1', [user.id]);
    if (creatorCheck.rows[0]?.creator_status !== 'active') {
      return res.status(403).json({ error: 'Only active creators can post exclusive content' });
    }
  }

  try {
    const post = await SocialPostService.createPost(user.id, content.trim(), null, null, replyToId, repostOfId, false, !!isExclusive);

    if (!replyToId && !repostOfId) {
      SocialPostService.mirrorToMastodon(content.trim(), post.id);
    }

    // Notify parent post author on reply
    if (replyToId) {
      const parentRow = await dbQuery('SELECT user_id FROM social_posts WHERE id = $1', [replyToId]);
      const parentAuthorId = parentRow.rows[0]?.user_id;
      if (parentAuthorId) {
        NotificationEmitter.emit({
          type: 'reply', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: parentAuthorId,
          entityType: 'post', entityId: String(replyToId),
          message: `${user.firstName || user.first_name || user.username} replied to your post`,
        });
      }
    }

    const authorPhoto = await getUserPhotoFromDb(user.id) || user.photoUrl || null;
    const fullPost = {
      ...post,
      author_id: user.id,
      author_username: user.username,
      author_first_name: user.firstName || user.first_name,
      author_photo: authorPhoto,
      liked_by_me: false,
    };

    const io = req.app.get('io');
    if (io) io.emit('feed:new_post', fullPost);

    return res.json({ success: true, post: fullPost });
  } catch (err) {
    logger.error('createPost error', err);
    return res.status(500).json({ error: 'Failed to create post' });
  }
};

// ── Like ──────────────────────────────────────────────────────────────────────

const toggleLike = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await SocialPostService.toggleLike(req.params.postId, user.id);

    // Notify post author on like
    if (result.liked) {
      const postRow = await dbQuery('SELECT user_id FROM social_posts WHERE id = $1', [req.params.postId]);
      const postAuthorId = postRow.rows[0]?.user_id;
      if (postAuthorId) {
        NotificationEmitter.emit({
          type: 'like', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: postAuthorId,
          entityType: 'post', entityId: String(req.params.postId),
          message: `${user.firstName || user.first_name || user.username} liked your post`,
        });
      }
    }

    return res.json(result);
  } catch (err) {
    logger.error('toggleLike error', err);
    return res.status(500).json({ error: 'Failed to toggle like' });
  }
};

// ── Delete ────────────────────────────────────────────────────────────────────

const deletePost = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  try {
    const deleted = await SocialPostService.deletePost(req.params.postId, user.id, isAdmin);
    if (!deleted) return res.status(404).json({ error: 'Post not found or not yours' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('deletePost error', err);
    return res.status(500).json({ error: 'Failed to delete post' });
  }
};

// ── Replies ───────────────────────────────────────────────────────────────────

const getReplies = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const result = await SocialPostService.getReplies(req.params.postId, user.id, req.query.cursor);
    return res.json({ success: true, ...result });
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
  const { content, replyToId, repostOfId, isExclusive } = req.body;

  if (!content || !content.toString().trim()) return res.status(400).json({ error: 'Content required' });
  if (content.toString().length > 5000) return res.status(400).json({ error: 'Post too long (max 5000 chars)' });

  // Validate creator status for exclusive posts
  if (isExclusive === 'true' || isExclusive === true) {
    const creatorCheck = await dbQuery('SELECT creator_status FROM users WHERE id = $1', [user.id]);
    if (creatorCheck.rows[0]?.creator_status !== 'active') {
      return res.status(403).json({ error: 'Only active creators can post exclusive content' });
    }
  }

  let mediaUrl = null;
  let mediaType = null;

  try {
    if (req.file) {
      const { mimetype, buffer } = req.file;
      // __dirname = /app/apps/backend/bot/api/controllers
      // 5 levels up reaches /app (monorepo root), then /public
      const uploadDir = path.join(__dirname, '../../../../../public/uploads/posts');
      await fs.mkdir(uploadDir, { recursive: true });

      if (/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mimetype)) {
        mediaType = 'image';
        const filename = `img-${user.id}-${Date.now()}.webp`;
        const filePath = path.join(uploadDir, filename);
        await sharp(buffer)
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 70, progressive: true })
          .toFile(filePath);
        mediaUrl = `/uploads/posts/${filename}`;
      } else if (/^video\/(mp4|webm)$/i.test(mimetype)) {
        mediaType = 'video';
        const ext = mimetype === 'video/webm' ? 'webm' : 'mp4';
        const filename = `vid-${user.id}-${Date.now()}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        await fs.writeFile(filePath, buffer);
        mediaUrl = `/uploads/posts/${filename}`;
      } else {
        return res.status(400).json({ error: 'Only image (jpg/png/webp/gif) or video (mp4/webm) files are allowed' });
      }
    }

    const exclusive = isExclusive === 'true' || isExclusive === true;
    const post = await SocialPostService.createPost(
      user.id, content.toString().trim(), mediaUrl, mediaType, replyToId, repostOfId, false, exclusive
    );

    if (!replyToId && !repostOfId) {
      SocialPostService.mirrorToMastodon(content.toString().trim(), post.id);
    }

    // Notify parent post author on reply
    if (replyToId) {
      const parentRow = await dbQuery('SELECT user_id FROM social_posts WHERE id = $1', [replyToId]);
      const parentAuthorId = parentRow.rows[0]?.user_id;
      if (parentAuthorId) {
        NotificationEmitter.emit({
          type: 'reply', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: parentAuthorId,
          entityType: 'post', entityId: String(replyToId),
          message: `${user.firstName || user.first_name || user.username} replied to your post`,
        });
      }
    }

    const authorPhoto = await getUserPhotoFromDb(user.id) || user.photoUrl || null;
    const fullPost = {
      ...post,
      author_id: user.id,
      author_username: user.username,
      author_first_name: user.firstName || user.first_name,
      author_photo: authorPhoto,
      liked_by_me: false,
    };

    const io = req.app.get('io');
    if (io) io.emit('feed:new_post', fullPost);

    return res.json({ success: true, post: fullPost });
  } catch (err) {
    logger.error('createPostWithMedia error', err);
    return res.status(500).json({ error: 'Failed to create post' });
  }
};

// ── Home Feed (public, no auth required) ─────────────────────────────────────

const getHomeFeed = async (req, res) => {
  try {
    const result = await SocialPostService.getHomeFeed(req.query.limit);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getHomeFeed error', err);
    return res.status(500).json({ error: 'Failed to load home feed' });
  }
};

// ── Public Profile ───────────────────────────────────────────────────────────

const getPublicProfile = async (req, res) => {
  const { userId } = req.params;
  const viewerId = req.session?.user?.id || null;

  try {
    const result = await SocialPostService.getPublicProfile(userId, viewerId, req.query.cursor, req.query.limit);
    if (!result.profile) return res.status(404).json({ error: 'User not found' });

    const profile = result.profile;
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
        postCount: result.postCount,
        creatorStatus: profile.creator_status,
        creatorType: profile.creator_type,
        creatorPriceUsd: profile.creator_price_usd ? parseFloat(profile.creator_price_usd) : null,
        creatorVerified: profile.creator_verified || false,
        creatorFeatured: profile.creator_featured || false,
        creatorSubscriberCount: profile.creator_subscriber_count || 0,
      },
      posts: result.posts,
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    logger.error('getPublicProfile error', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
};

module.exports = { getFeed, getHomeFeed, getWofFeed, getWall, createPost, toggleLike, deletePost, getReplies, postToMastodon, createPostWithMedia, getPublicProfile };
