const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const FileType = require('file-type');
const logger = require('../../../utils/logger');
const SocialPostService = require('../../services/socialPostService');
const axios = require('axios');

const { query: dbQuery } = require('../../../config/postgres');
const NotificationEmitter = require('../../services/notificationEmitter');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  if (user.tier === 'banned') { res.status(403).json({ error: 'Account suspended', code: 'ACCOUNT_BANNED' }); return null; }
  return user;
};

const parsePostId = (req, res) => {
  const id = parseInt(req.params.postId, 10);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'Invalid post ID' }); return null; }
  return id;
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
    const viewerTier = req.session?.user?.tier || 'free';
    const result = await SocialPostService.getFeed(user.id, req.query.cursor, req.query.limit, viewerTier);
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
  const { content, isExclusive, isShareable } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });

  let replyToId = req.body.replyToId ? parseInt(req.body.replyToId, 10) : null;
  let repostOfId = req.body.repostOfId ? parseInt(req.body.repostOfId, 10) : null;
  if (req.body.replyToId && (!Number.isFinite(replyToId) || replyToId <= 0)) {
    return res.status(400).json({ error: 'Invalid replyToId' });
  }
  if (req.body.repostOfId && (!Number.isFinite(repostOfId) || repostOfId <= 0)) {
    return res.status(400).json({ error: 'Invalid repostOfId' });
  }

  const maxLen = replyToId ? 500 : 5000;
  if (content.length > maxLen) return res.status(400).json({ error: `Content too long (max ${maxLen} chars)` });

  try {
    if (replyToId) {
      const parentCheck = await dbQuery('SELECT id, user_id, reply_to_id FROM social_posts WHERE id = $1 AND is_deleted = false', [replyToId]);
      if (!parentCheck.rows.length) return res.status(404).json({ error: 'Parent post not found' });
      if (parentCheck.rows[0].reply_to_id !== null) return res.status(400).json({ error: 'Cannot reply to a reply' });
    }

    // Validate creator status for exclusive posts
    if (isExclusive) {
      const creatorCheck = await dbQuery('SELECT creator_status FROM users WHERE id = $1', [user.id]);
      if (creatorCheck.rows[0]?.creator_status !== 'active') {
        return res.status(403).json({ error: 'Only active creators can post exclusive content' });
      }
    }

    const exclusive = !!isExclusive;
    const shareable = isShareable !== false;
    const post = await SocialPostService.createPost(user.id, content.trim(), null, null, replyToId, repostOfId, false, exclusive, shareable);

    if (!replyToId && !repostOfId && !exclusive) {
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
  const postId = parsePostId(req, res); if (!postId) return;
  try {
    const postCheck = await dbQuery('SELECT user_id FROM social_posts WHERE id = $1 AND is_deleted = false', [postId]);
    if (!postCheck.rows.length) return res.status(404).json({ error: 'Post not found' });
    if (String(postCheck.rows[0].user_id) === String(user.id)) {
      return res.status(400).json({ error: 'Cannot like your own post' });
    }

    const result = await SocialPostService.toggleLike(postId, user.id);

    // Notify post author on like
    if (result.liked) {
      const postAuthorId = postCheck.rows[0].user_id;
      if (postAuthorId) {
        NotificationEmitter.emit({
          type: 'like', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: postAuthorId,
          entityType: 'post', entityId: String(postId),
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
  const postId = parsePostId(req, res); if (!postId) return;
  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  try {
    const deleted = await SocialPostService.deletePost(postId, user.id, isAdmin);
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
  const postId = parsePostId(req, res); if (!postId) return;
  try {
    const result = await SocialPostService.getReplies(postId, user.id, req.query.cursor);
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
  const { content, isExclusive, isShareable } = req.body;

  if (!content || !content.toString().trim()) return res.status(400).json({ error: 'Content required' });

  let replyToId = req.body.replyToId ? parseInt(req.body.replyToId, 10) : null;
  let repostOfId = req.body.repostOfId ? parseInt(req.body.repostOfId, 10) : null;
  if (req.body.replyToId && (!Number.isFinite(replyToId) || replyToId <= 0)) {
    return res.status(400).json({ error: 'Invalid replyToId' });
  }
  if (req.body.repostOfId && (!Number.isFinite(repostOfId) || repostOfId <= 0)) {
    return res.status(400).json({ error: 'Invalid repostOfId' });
  }

  const maxLen = replyToId ? 500 : 5000;
  if (content.toString().length > maxLen) return res.status(400).json({ error: `Content too long (max ${maxLen} chars)` });

  let mediaUrl = null;
  let mediaType = null;

  try {
    if (replyToId) {
      const parentCheck = await dbQuery('SELECT id, user_id, reply_to_id FROM social_posts WHERE id = $1 AND is_deleted = false', [replyToId]);
      if (!parentCheck.rows.length) return res.status(404).json({ error: 'Parent post not found' });
      if (parentCheck.rows[0].reply_to_id !== null) return res.status(400).json({ error: 'Cannot reply to a reply' });
    }

    // Validate creator status for exclusive posts
    if (isExclusive === 'true' || isExclusive === true) {
      const creatorCheck = await dbQuery('SELECT creator_status FROM users WHERE id = $1', [user.id]);
      if (creatorCheck.rows[0]?.creator_status !== 'active') {
        return res.status(403).json({ error: 'Only active creators can post exclusive content' });
      }
    }

    if (req.file) {
      const { buffer } = req.file;
      // __dirname = /app/apps/backend/bot/api/controllers
      // 5 levels up reaches /app (monorepo root), then /public
      const uploadDir = path.join(__dirname, '../../../../../public/uploads/posts');
      await fs.mkdir(uploadDir, { recursive: true });

      // --- MAGIC BYTE VALIDATION ---
      // Never trust client-supplied Content-Type; inspect actual file bytes.
      const MAGIC_TO_MEDIA_TYPE = {
        'image/jpeg': 'image',
        'image/png':  'image',
        'image/webp': 'image',
        'image/gif':  'image',
        'video/mp4':  'video',
        'video/webm': 'video',
      };
      const detected = await FileType.fromBuffer(buffer);
      const detectedMime = detected?.mime;
      mediaType = MAGIC_TO_MEDIA_TYPE[detectedMime] || null;

      if (!mediaType) {
        logger.warn('socialController: rejected post media — magic bytes do not match allowed types', {
          userId: user.id,
          claimedMime: req.file.mimetype,
          detectedMime: detectedMime || 'unknown',
        });
        return res.status(400).json({ error: 'Only image (jpg/png/webp/gif) or video (mp4/webm) files are allowed' });
      }

      if (mediaType === 'image') {
        const filename = `img-${user.id}-${Date.now()}.webp`;
        const filePath = path.join(uploadDir, filename);
        await sharp(buffer)
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 70, progressive: true })
          .toFile(filePath);
        mediaUrl = `/uploads/posts/${filename}`;
      } else {
        // video — detectedMime is either video/mp4 or video/webm
        const ext = detectedMime === 'video/webm' ? 'webm' : 'mp4';
        const filename = `vid-${user.id}-${Date.now()}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        await fs.writeFile(filePath, buffer);
        mediaUrl = `/uploads/posts/${filename}`;
      }
    }

    const exclusive = isExclusive === 'true' || isExclusive === true;
    const shareable = isShareable !== 'false' && isShareable !== false;
    const post = await SocialPostService.createPost(
      user.id, content.toString().trim(), mediaUrl, mediaType, replyToId, repostOfId, false, exclusive, shareable
    );

    if (!replyToId && !repostOfId && !exclusive) {
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
  const viewerTier = (req.session?.user?.tier || 'free').toLowerCase();
  const viewerRole = req.session?.user?.role || '';
  const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';

  try {
    // Bidirectional block check: deny access if either party has blocked the other
    if (viewerId && String(viewerId) !== String(userId)) {
      const UserModel = require('../../../models/userModel');
      const [viewerBlocked, targetBlocked] = await Promise.all([
        UserModel.isBlocked(viewerId, userId),
        UserModel.isBlocked(userId, viewerId),
      ]);
      if (viewerBlocked || targetBlocked) {
        return res.status(403).json({ success: false, error: 'Profile unavailable', code: 'BLOCKED' });
      }
    }

    // Free-tier profile browsing restriction:
    // Free users may only view profiles of users they have an existing connection with.
    // Connections: any DM thread between viewer and target, OR target liked viewer's post.
    // Admins, members, and prime users have unrestricted profile browsing.
    if (viewerId && !isAdmin && viewerTier === 'free' && String(viewerId) !== String(userId)) {
      const [dmCheck, likeCheck] = await Promise.all([
        dbQuery(
          `SELECT 1 FROM dm_threads
           WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)
           LIMIT 1`,
          [viewerId, userId]
        ),
        dbQuery(
          `SELECT 1 FROM social_post_likes spl
           JOIN social_posts sp ON sp.id = spl.post_id
           WHERE spl.user_id = $2 AND sp.user_id = $1
           LIMIT 1`,
          [viewerId, userId]
        ),
      ]);
      const hasConnection = dmCheck.rows.length > 0 || likeCheck.rows.length > 0;
      if (!hasConnection) {
        return res.status(403).json({
          success: false,
          error: 'Upgrade to Member to browse member profiles',
          code: 'PROFILE_RESTRICTED',
        });
      }
    }

    const result = await SocialPostService.getPublicProfile(userId, viewerId, req.query.cursor, req.query.limit, viewerTier);
    if (!result.profile) return res.status(404).json({ error: 'User not found' });

    const profile = result.profile;
    const pd = result.performerData;
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
        memberSince: profile.created_at,
        postCount: result.postCount,
        creatorStatus: profile.creator_status,
        creatorType: profile.creator_type,
        creatorPriceUsd: profile.creator_price_usd ? parseFloat(profile.creator_price_usd) : null,
        creatorVerified: profile.creator_verified || false,
        creatorFeatured: profile.creator_featured || false,
        creatorSubscriberCount: profile.creator_subscriber_count || 0,
        performerData: pd ? {
          id: pd.id,
          isAvailable: pd.is_available,
          basePrice: parseFloat(pd.base_price),
          averageRating: pd.rating_count > 0
            ? parseFloat((pd.total_rating / pd.rating_count).toFixed(2))
            : 0,
          totalCalls: pd.total_calls,
          availabilityMessage: pd.availability_message || null,
        } : null,
      },
      posts: result.posts,
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    logger.error('getPublicProfile error', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
};

// ── Request WoF Deletion ─────────────────────────────────────────────────────

const requestWofDeletion = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const postId = parsePostId(req, res); if (!postId) return;
  try {
    const deleted = await SocialPostService.deleteWofPost(postId, user.id);
    if (!deleted) return res.status(404).json({ error: 'WoF post not found or not yours' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('requestWofDeletion error', err);
    return res.status(500).json({ error: 'Failed to delete WoF post' });
  }
};

module.exports = { getFeed, getHomeFeed, getWofFeed, getWall, createPost, toggleLike, deletePost, getReplies, postToMastodon, createPostWithMedia, getPublicProfile, requestWofDeletion };
