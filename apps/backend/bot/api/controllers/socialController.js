const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const FileType = require('../../utils/fileType');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const logger = require('../../../utils/logger');
const SocialPostService = require('../../../services/socialPostService');
const axios = require('axios');

const { query: dbQuery } = require('../../../config/postgres');
const NotificationEmitter = require('../../../services/notificationEmitter');
const mentionService = require('../../../services/mentionService');
const { validateTierFresh } = require('../../../services/accessService');
const { resolveUserId } = require('../../utils/helpers');
const { archivePromotedSourceForSocialPost } = require('../utils/promotedPostDeletion');
const IdentityVerificationService = require('../../../services/identityVerificationService');

async function extractVideoThumbnail(videoPath, thumbPath) {
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-ss', '00:00:01', '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=400:-2', '-q:v', '2', thumbPath,
    ], { timeout: 30000 });
    return true;
  } catch (err) {
    logger.warn('socialController: ffmpeg thumbnail extraction failed', { videoPath, error: err.message });
    await fs.unlink(thumbPath).catch(() => {});
    return false;
  }
}

async function getVideoDurationSecs(videoPath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
    ], { timeout: 30000 });
    return Math.round(parseFloat(stdout.trim()) || 0);
  } catch {
    return 0;
  }
}

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

const FREE_FEED_LIMIT = 5;
const FREE_PROFILE_LIMIT = 3;

const getFeed = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const viewerTier = await validateTierFresh(user.id, user.tier || 'free');
    if (viewerTier !== (user.tier || 'free').toLowerCase()) req.session.user.tier = viewerTier;
    const isFreeUser = !isAdmin && viewerTier === 'free';
    // Fetch the viewer's blocked list from DB to exclude their posts (C-08)
    const blockedRes = await dbQuery('SELECT blocked FROM users WHERE id = $1', [user.id]);
    const blockedIds = (blockedRes.rows[0]?.blocked || []).map(Number);
    const result = await SocialPostService.getFeed(
      user.id,
      isFreeUser ? undefined : req.query.cursor,
      isFreeUser ? FREE_FEED_LIMIT : req.query.limit,
      viewerTier, isAdmin, blockedIds
    );
    if (isFreeUser) result.nextCursor = null;
    return res.json({ success: true, freeUserLimited: isFreeUser, ...result });
  } catch (err) {
    logger.error('getFeed error', err);
    return res.status(500).json({ error: 'Failed to load feed' });
  }
};

const getWall = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const viewerTier = await validateTierFresh(user.id, user.tier || 'free');
    if (viewerTier !== (user.tier || 'free').toLowerCase()) req.session.user.tier = viewerTier;
    // Fetch the viewer's blocked list from DB to exclude their posts (C-08)
    const blockedRes = await dbQuery('SELECT blocked FROM users WHERE id = $1', [user.id]);
    const blockedIds = (blockedRes.rows[0]?.blocked || []).map(Number);
    const wallUserId = await resolveUserId(req.params.userId);
    if (!wallUserId) return res.status(404).json({ error: 'User not found' });
    const result = await SocialPostService.getWall(wallUserId, user.id, req.query.cursor, req.query.limit, viewerTier, isAdmin, blockedIds);
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
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const viewerTier = await validateTierFresh(user.id, user.tier || 'free');
    if (viewerTier !== (user.tier || 'free').toLowerCase()) req.session.user.tier = viewerTier;
    // Fetch the viewer's blocked list from DB to exclude their posts (C-08)
    const blockedRes = await dbQuery('SELECT blocked FROM users WHERE id = $1', [user.id]);
    const blockedIds = (blockedRes.rows[0]?.blocked || []).map(Number);
    const result = await SocialPostService.getWofFeed(user.id, req.query.cursor, req.query.limit, blockedIds, viewerTier, isAdmin);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getWofFeed error', err);
    return res.status(500).json({ error: 'Failed to load Wall of Fame feed' });
  }
};

// ── Socket emission helper (CRIT-1: exclusive posts must not broadcast to all) ─

/**
 * Emit feed:new_post to the correct audience.
 * - Non-exclusive posts: broadcast to all connected clients.
 * - Exclusive posts: emit only to the post author and active subscribers of
 *   that creator, using each user's personal Socket.IO room `user:<userId>`.
 *
 * We intentionally do NOT await the DB query on the hot path — a fire-and-forget
 * Promise is sufficient because WebSocket delivery is best-effort anyway.
 */
function emitNewPost(io, post, authorId) {
  if (!io) return;

  const postTier = (post.content_tier || 'free').toLowerCase();
  const isExclusive = post.is_exclusive === true || postTier === 'prime';

  if (!isExclusive) {
    io.emit('feed:new_post', post);
    return;
  }

  // Exclusive: resolve subscribers asynchronously, then emit to each personal room
  dbQuery(
    `SELECT subscriber_id FROM creator_subscriptions
     WHERE creator_id = $1 AND status = 'active' AND expires_at > NOW()`,
    [authorId]
  ).then(({ rows }) => {
    const recipientIds = new Set(rows.map(r => String(r.subscriber_id)));
    // Always include the author so they can see their own post in real time
    recipientIds.add(String(authorId));
    for (const uid of recipientIds) {
      io.to(`user:${uid}`).emit('feed:new_post', post);
    }
  }).catch((err) => {
    logger.error('emitNewPost: failed to resolve creator subscribers', { authorId, err });
  });
}

function parseTaggedPerformerIds(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 10).map(String).filter(s => s.trim());
  } catch { return []; }
}

async function resolveTaggedPerformers(ids) {
  if (!ids.length) return [];
  const { rows } = await dbQuery(
    `SELECT id::text AS id, username, photo_file_id AS avatar_url FROM users WHERE id = ANY($1::text[]) AND subscription_status != 'banned' LIMIT 10`,
    [ids]
  );
  return rows;
}

// ── Create Post ───────────────────────────────────────────────────────────────

const createPost = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { content, isExclusive, isShareable, hangoutGroupId: rawHangoutGroupId, category: rawCategory, taggedPerformerIds: rawTaggedIds } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const taggedPerformerIds = parseTaggedPerformerIds(rawTaggedIds);

  try {
    const { assertCleanText } = require('../../../services/contentModerationFilter');
    assertCleanText(content, 'content');
  } catch (err) {
    if (err.code === 'FORBIDDEN_CONTENT') {
      return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
    }
    throw err;
  }

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
    // 2257 compliance gate — enforce for active creators
    if (user.creator_status === 'active') {
      const { rows: compRows } = await dbQuery(
        'SELECT identity_verified, identity_verification_required_by FROM users WHERE id = $1',
        [user.id]
      );
      if (compRows.length > 0 && !IdentityVerificationService.is2257Compliant(compRows[0])) {
        return res.status(403).json({
          success: false,
          error: 'identity_verification_required',
          message: 'Complete identity verification (18 U.S.C. § 2257) before posting content.',
        });
      }
    }

    if (replyToId) {
      const parentCheck = await dbQuery('SELECT id, user_id, reply_to_id, channel_id FROM social_posts WHERE id = $1 AND is_deleted = false', [replyToId]);
      if (!parentCheck.rows.length) return res.status(404).json({ error: 'Parent post not found' });
      // Flatten threading: if replying to a reply, reparent to the top-level post
      if (parentCheck.rows[0].reply_to_id !== null) replyToId = parentCheck.rows[0].reply_to_id;

      // Channel access gate: if the root post belongs to a channel, replier must have access
      const rootChannelId = parentCheck.rows[0].channel_id
        ?? (parentCheck.rows[0].reply_to_id
          ? (await dbQuery('SELECT channel_id FROM social_posts WHERE id = $1', [replyToId])).rows[0]?.channel_id
          : null);
      if (rootChannelId) {
        const commenterRole = user.role || '';
        const isAdminReplier = commenterRole === 'admin' || commenterRole === 'superadmin';
        if (!isAdminReplier) {
          const EntitlementAccessService = require('../../../services/entitlementAccessService');
          const decision = await EntitlementAccessService.hasResourceAccess(
            String(user.id), 'channel', String(rootChannelId)
          );
          if (!decision.allowed) return res.status(403).json({ error: 'Subscribe to comment on this content', code: decision.code });
        }
      }

      // CRIT-3: Bidirectional block check — neither party may reply if either has blocked the other
      const parentAuthorId = parentCheck.rows[0].user_id;
      if (String(parentAuthorId) !== String(user.id)) {
        const [replierBlockedByAuthor, authorBlockedByReplier] = await Promise.all([
          dbQuery(
            `SELECT 1 FROM users WHERE id = $1 AND blocked @> ARRAY[$2::text] LIMIT 1`,
            [parentAuthorId, String(user.id)]
          ),
          dbQuery(
            `SELECT 1 FROM users WHERE id = $1 AND blocked @> ARRAY[$2::text] LIMIT 1`,
            [user.id, String(parentAuthorId)]
          ),
        ]);
        if (replierBlockedByAuthor.rows.length > 0 || authorBlockedByReplier.rows.length > 0) {
          return res.status(403).json({ error: 'Cannot reply to this post', code: 'BLOCKED' });
        }
      }
    }

    // Text-only posts cannot be exclusive — requires a video ≥ 4 minutes
    if (isExclusive) return res.status(400).json({ error: 'Exclusive content must be a video of at least 4 minutes', code: 'EXCLUSIVE_VIDEO_REQUIRED' });

    const exclusive = !!isExclusive;
    const shareable = isShareable !== false;

    // Validate hangout group if provided (post scoped to a hangout feed)
    let hangoutGroupId = null;
    if (rawHangoutGroupId) {
      hangoutGroupId = parseInt(rawHangoutGroupId, 10);
      if (!Number.isFinite(hangoutGroupId) || hangoutGroupId <= 0) {
        return res.status(400).json({ error: 'Invalid hangoutGroupId' });
      }
      // Must be a member of the group
      const memberCheck = await dbQuery(
        'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned = false OR is_banned IS NULL)',
        [hangoutGroupId, user.id]
      );
      if (!memberCheck.rows.length) return res.status(403).json({ error: 'Must be a group member to post' });
      // Group must not be in ghost mode
      const groupCheck = await dbQuery('SELECT feed_visibility FROM hangout_groups WHERE id=$1', [hangoutGroupId]);
      if (!groupCheck.rows.length) return res.status(404).json({ error: 'Group not found' });
      if (groupCheck.rows[0].feed_visibility === 'ghost') return res.status(403).json({ error: 'This group does not have a feed' });
    }

    // Validate channel ownership if provided (only for non-reply posts)
    let channelId = null;
    if (!replyToId && req.body.channelId) {
      channelId = parseInt(req.body.channelId, 10);
      if (!Number.isFinite(channelId) || channelId <= 0) {
        return res.status(400).json({ error: 'Invalid channelId' });
      }
      const chRes = await dbQuery('SELECT creator_id, collaborators FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
      if (!chRes.rows.length) return res.status(404).json({ error: 'Channel not found' });
      const ch = chRes.rows[0];
      const isOwner = ch.creator_id === user.id;
      const isCollaborator = Array.isArray(ch.collaborators) && ch.collaborators.includes(String(user.id));
      if (!isOwner && !isCollaborator) return res.status(403).json({ error: 'Channel not found or not yours' });
    }

    const post = await SocialPostService.createPost(user.id, content.trim(), null, null, replyToId, repostOfId, false, exclusive, shareable, null, null, null, hangoutGroupId, null, rawCategory || null);

    // Assign to channel and update post_count
    if (channelId) {
      await dbQuery('UPDATE social_posts SET channel_id = $1 WHERE id = $2', [channelId, post.id]);
      await dbQuery('UPDATE creator_channels SET post_count = (SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false) WHERE id = $1', [channelId]);
      post.channel_id = channelId;
    }

    // Apply channel_promo metadata + thumbnail for hype posts
    const rawMetadata = req.body.metadata;
    const rawVideoThumb = req.body.videoThumbnailUrl;
    if (rawMetadata && typeof rawMetadata === 'object' && rawMetadata.kind === 'channel_promo') {
      await dbQuery(
        'UPDATE social_posts SET metadata = $1, video_thumbnail_url = COALESCE($2, video_thumbnail_url) WHERE id = $3',
        [JSON.stringify(rawMetadata), rawVideoThumb || null, post.id]
      );
      post.metadata = rawMetadata;
      if (rawVideoThumb) post.video_thumbnail_url = rawVideoThumb;
    }

    if (!replyToId && !repostOfId && !exclusive) {
      SocialPostService.mirrorToMastodon(content.trim(), post.id);
    }

    // Notify parent post author on reply
    if (replyToId) {
      const parentRow = await dbQuery('SELECT user_id FROM social_posts WHERE id = $1', [replyToId]);
      const parentAuthorId = parentRow.rows[0]?.user_id;
      if (parentAuthorId) {
        const actorName = user.firstName || user.first_name || user.username;
        const replyPreview = content && content.trim().length > 60 ? content.trim().slice(0, 57) + '...' : (content || '').trim();
        NotificationEmitter.emit({
          type: 'reply', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: parentAuthorId,
          entityType: 'post', entityId: String(replyToId),
          message: replyPreview ? `${actorName} replied: "${replyPreview}"` : `${actorName} replied to your post`,
          metadata: {
            pushTitle: `${actorName} commented`,
            pushBody: replyPreview ? `"${replyPreview}"` : 'Tap to view',
            url: `/social/post/${replyToId}`,
          },
        });
      }
    }

    const [authorPhoto, taggedPerformers] = await Promise.all([
      getUserPhotoFromDb(user.id).then(p => p || user.photoUrl || null),
      resolveTaggedPerformers(taggedPerformerIds),
    ]);
    const fullPost = {
      ...post,
      author_id: user.id,
      author_username: user.username,
      author_first_name: user.firstName || user.first_name,
      author_photo: authorPhoto,
      liked_by_me: false,
      tagged_performers: taggedPerformers,
    };

    setImmediate(() => {
      mentionService.createPostMentions(post.id, user.id, content.trim()).catch(() => {});
      if (taggedPerformerIds.length) {
        mentionService.createPostTags(post.id, user.id, taggedPerformerIds).catch(() => {});
      }
    });

    const io = req.app.get('io');
    emitNewPost(io, fullPost, user.id);

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
    const isSelfLike = String(postCheck.rows[0].user_id) === String(user.id);

    const result = await SocialPostService.toggleLike(postId, user.id);

    // Mirror likes_count to prime_videos.likes when post is linked to a Directus prime video.
    // Fire-and-forget — never block the like response on Directus.
    try {
      const { rows: pvRows } = await dbQuery(
        'SELECT directus_id, likes_count FROM social_posts WHERE id = $1 AND directus_id IS NOT NULL',
        [postId]
      );
      if (pvRows.length && pvRows[0].directus_id) {
        const directusUrl = process.env.DIRECTUS_URL || process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
        const token = process.env.DIRECTUS_ADMIN_TOKEN;
        if (token) {
          require('axios').patch(
            `${directusUrl}/items/prime_videos/${pvRows[0].directus_id}`,
            { likes: pvRows[0].likes_count },
            { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }
          ).catch((err) => logger.warn('prime_videos.likes sync failed', { directus_id: pvRows[0].directus_id, error: err.message }));
        }
      }
    } catch (_) { /* never block likes on sync */ }

    // Notify post author on like (skip if it's a self-like — no point pinging yourself)
    if (result.liked && !isSelfLike) {
      const postAuthorId = postCheck.rows[0].user_id;
      if (postAuthorId) {
        // Fetch post preview for rich notification
        let postPreview = '';
        try {
          const { rows: postRows } = await dbQuery('SELECT content FROM social_posts WHERE id = $1', [postId]);
          if (postRows[0]?.content) {
            postPreview = postRows[0].content.length > 60 ? postRows[0].content.slice(0, 57) + '...' : postRows[0].content;
          }
        } catch (_) {}
        const actorName = user.firstName || user.first_name || user.username;
        const bodyText = postPreview ? `${actorName} liked your post: "${postPreview}"` : `${actorName} liked your post`;
        NotificationEmitter.emit({
          type: 'like', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: postAuthorId,
          entityType: 'post', entityId: String(postId),
          message: bodyText,
          metadata: {
            pushTitle: `${actorName} liked your post`,
            pushBody: postPreview ? `"${postPreview}"` : 'Tap to view',
            url: `/social/post/${postId}`,
          },
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
    if (isAdmin) {
      await archivePromotedSourceForSocialPost(postId);
    }
    const deleted = await SocialPostService.deletePost(postId, user.id, isAdmin);
    if (!deleted) return res.status(404).json({ error: 'Post not found or not yours' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('deletePost error', err);
    return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to delete post' });
  }
};

// ── Edit post ─────────────────────────────────────────────────────────────────

const editPost = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const postId = parsePostId(req, res); if (!postId) return;
  const { content, video_title, video_description, tagged_performer_ids } = req.body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }
  const trimmed = content.trim().slice(0, 2000);
  try {
    const { assertCleanText } = require('../../../services/contentModerationFilter');
    assertCleanText(trimmed, 'content');
  } catch (err) {
    if (err.code === 'FORBIDDEN_CONTENT') {
      return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
    }
    throw err;
  }
  try {
    const result = await dbQuery(
      `UPDATE social_posts
       SET content = $1,
           video_title = $4::text,
           video_description = $5::text,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND is_deleted = false
       RETURNING id, content, video_title, video_description`,
      [trimmed, postId, user.id,
       typeof video_title === 'string' ? video_title.trim() || null : null,
       typeof video_description === 'string' ? video_description.trim() || null : null]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Post not found or not yours' });

    if (Array.isArray(tagged_performer_ids)) {
      await dbQuery('DELETE FROM post_mentions WHERE post_id = $1 AND mention_type = $2', [postId, 'tag']);
      const validIds = tagged_performer_ids.filter(id => id && typeof id === 'string').slice(0, 10);
      if (validIds.length > 0) {
        const { createPostTags } = require('../../../services/mentionService');
        await createPostTags(postId, user.id, validIds);
      }
    }

    return res.json({
      success: true,
      content: result.rows[0].content,
      videoTitle: result.rows[0].video_title || null,
      videoDescription: result.rows[0].video_description || null,
    });
  } catch (err) {
    logger.error('editPost error', err);
    return res.status(500).json({ error: 'Failed to edit post' });
  }
};

// ── Replies ───────────────────────────────────────────────────────────────────

const getReplies = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const postId = parsePostId(req, res); if (!postId) return;
  try {
    // HIGH-02: Gate replies on PRIME-gated or exclusive parent posts
    const parentRes = await dbQuery(
      `SELECT user_id, is_exclusive, COALESCE(content_tier, 'free') as content_tier
       FROM social_posts WHERE id = $1 AND is_deleted = false`,
      [postId]
    );
    if (!parentRes.rows.length) return res.status(404).json({ error: 'Post not found' });

    const parent = parentRes.rows[0];
    const postTier = (parent.content_tier || 'free').toLowerCase();
    const isExclusiveParent = parent.is_exclusive === true || postTier === 'prime';

    if (isExclusiveParent) {
      const viewerRole = req.session?.user?.role || '';
      const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';
      const isAuthor = String(user.id) === String(parent.user_id);

      if (!isAdmin && !isAuthor) {
        const viewerTier = await validateTierFresh(user.id, req.session?.user?.tier || 'free');
        if (viewerTier !== (req.session?.user?.tier || 'free').toLowerCase()) req.session.user.tier = viewerTier;
        if (viewerTier !== 'prime') {
          return res.status(403).json({ error: 'PRIME subscription required to view replies on this post', code: 'PRIME_REQUIRED' });
        }
      }
    }

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
  const { content, isExclusive, isShareable, videoTitle, videoDescription, category: rawCategory, taggedPerformerIds: rawTaggedIds } = req.body;
  const taggedPerformerIds = parseTaggedPerformerIds(rawTaggedIds);

  // Media-attached post: content may be empty (caption-less photo/video is valid).
  const hasContent = content && content.toString().trim().length > 0;
  const hasMedia = !!req.file;
  if (!hasContent && !hasMedia) return res.status(400).json({ error: 'Content or media required' });

  try {
    const { assertCleanText } = require('../../../services/contentModerationFilter');
    if (hasContent) assertCleanText(content, 'content');
    if (videoTitle) assertCleanText(videoTitle, 'video title');
    if (videoDescription) assertCleanText(videoDescription, 'video description');
  } catch (err) {
    if (err.code === 'FORBIDDEN_CONTENT') {
      return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
    }
    throw err;
  }

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
  let finalFilePath = null;

  try {
    // 2257 compliance gate — enforce for active creators
    if (user.creator_status === 'active') {
      const { rows: compRows } = await dbQuery(
        'SELECT identity_verified, identity_verification_required_by FROM users WHERE id = $1',
        [user.id]
      );
      if (compRows.length > 0 && !IdentityVerificationService.is2257Compliant(compRows[0])) {
        if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({
          success: false,
          error: 'identity_verification_required',
          message: 'Complete identity verification (18 U.S.C. § 2257) before posting content.',
        });
      }
    }

    if (replyToId) {
      const parentCheck = await dbQuery('SELECT id, user_id, reply_to_id FROM social_posts WHERE id = $1 AND is_deleted = false', [replyToId]);
      if (!parentCheck.rows.length) return res.status(404).json({ error: 'Parent post not found' });
      // Flatten threading: if replying to a reply, reparent to the top-level post
      if (parentCheck.rows[0].reply_to_id !== null) replyToId = parentCheck.rows[0].reply_to_id;

      // CRIT-3: Bidirectional block check
      const parentAuthorId = parentCheck.rows[0].user_id;
      if (String(parentAuthorId) !== String(user.id)) {
        const replierBlockedByAuthor = await dbQuery(
          `SELECT 1 FROM users WHERE id = $1 AND blocked @> ARRAY[$2::text] LIMIT 1`,
          [parentAuthorId, String(user.id)]
        );
        const authorBlockedByReplier = await dbQuery(
          `SELECT 1 FROM users WHERE id = $1 AND blocked @> ARRAY[$2::text] LIMIT 1`,
          [user.id, String(parentAuthorId)]
        );
        if (replierBlockedByAuthor.rows.length > 0 || authorBlockedByReplier.rows.length > 0) {
          if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
          return res.status(403).json({ error: 'Cannot reply to this post', code: 'BLOCKED' });
        }
      }
    }

    // Validate creator status, role, and follower threshold for exclusive posts.
    if (isExclusive === 'true' || isExclusive === true) {
      const creatorCheck = await dbQuery(
        'SELECT creator_status, creator_role, followers_count FROM users WHERE id = $1',
        [user.id]
      );
      const row = creatorCheck.rows[0] || {};
      if (row.creator_status !== 'active') {
        return res.status(403).json({ error: 'Only active creators can post exclusive content' });
      }
      if (row.creator_role !== 'creator' && row.creator_role !== 'both') {
        return res.status(403).json({
          success: false,
          error: 'Exclusive paid content requires the Creator role. Performer-only accounts cannot publish exclusive posts.',
          code: 'CREATOR_ROLE_REQUIRED',
        });
      }
      if ((row.followers_count ?? 0) < 10) {
        return res.status(403).json({
          success: false,
          error: 'Reach 10 followers on your free profile to unlock exclusive content.',
          code: 'creator_ice_tier',
        });
      }
    }

    if (req.file) {
      const tempPath = req.file.path; // disk storage path (may be undefined for memory storage)
      const hasBuffer = !!req.file.buffer;

      // __dirname = /app/apps/backend/bot/api/controllers
      // 5 levels up reaches /app (monorepo root), then /public
      const uploadDir = path.join(__dirname, '../../../../../public/uploads/posts');
      await fs.mkdir(uploadDir, { recursive: true });

      // --- MAGIC BYTE VALIDATION ---
      // Only read first 4100 bytes for magic byte detection (avoid loading GB files into memory)
      const MAGIC_TO_MEDIA_TYPE = {
        'image/jpeg': 'image',
        'image/png':  'image',
        'image/webp': 'image',
        'image/gif':  'image',
        'image/heic': 'image',
        'image/heif': 'image',
        'image/avif': 'image',
        'image/tiff': 'image',
        'image/bmp':  'image',
        'video/mp4':  'video',
        'video/webm': 'video',
        'video/quicktime': 'video',
        'video/3gpp': 'video',
        'video/hevc': 'video',
      };

      let headerBytes;
      if (hasBuffer) {
        headerBytes = req.file.buffer.length > 4100 ? req.file.buffer.subarray(0, 4100) : req.file.buffer;
      } else {
        // Disk storage: read only first 4100 bytes
        const fh = await fs.open(tempPath, 'r');
        headerBytes = Buffer.alloc(4100);
        const { bytesRead } = await fh.read(headerBytes, 0, 4100, 0);
        await fh.close();
        headerBytes = headerBytes.subarray(0, bytesRead);
      }

      const detected = await FileType.fromBuffer(headerBytes);
      const detectedMime = detected?.mime;
      mediaType = MAGIC_TO_MEDIA_TYPE[detectedMime] || null;

      if (!mediaType) {
        logger.warn('socialController: rejected post media — magic bytes do not match allowed types', {
          userId: user.id,
          claimedMime: req.file.mimetype,
          detectedMime: detectedMime || 'unknown',
        });
        if (tempPath) await fs.unlink(tempPath).catch(() => {});
        return res.status(400).json({ error: 'Only image (jpg/png/webp/gif/heic/hevc/avif/tiff/bmp) or video (mp4/webm/mov/3gp) files are allowed' });
      }

      if (mediaType === 'image') {
        const imgBuffer = hasBuffer ? req.file.buffer : await fs.readFile(tempPath);
        let filename, filePath;
        if (detectedMime === 'image/gif') {
          // GIF: save as-is to preserve animation
          filename = `img-${user.id}-${Date.now()}.gif`;
          filePath = path.join(uploadDir, filename);
          await fs.writeFile(filePath, imgBuffer);
        } else {
          filename = `img-${user.id}-${Date.now()}.webp`;
          filePath = path.join(uploadDir, filename);
          const processedBuf = await sharp(imgBuffer, { failOn: 'none' })
            .rotate()
            .withMetadata(false)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 70, progressive: true })
            .toBuffer();
          const finalImgBuf = user.creator_status === 'active'
            ? await require('../../../services/watermarkService').applyImageWatermark(processedBuf, user.username)
            : processedBuf;
          await fs.writeFile(filePath, finalImgBuf);
        }
        if (tempPath) await fs.unlink(tempPath).catch(() => {});
        finalFilePath = filePath;
        mediaUrl = `/uploads/posts/${filename}`;
      } else {
        const VIDEO_EXT = { 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/hevc': 'mp4' };
        const ext = VIDEO_EXT[detectedMime] || 'mp4';
        const filename = `vid-${user.id}-${Date.now()}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        if (tempPath) {
          // Move disk temp file to final destination (no memory copy needed)
          const fsSync = require('fs');
          try { fsSync.renameSync(tempPath, filePath); } catch {
            // Cross-device rename fallback: copy + delete
            await fs.copyFile(tempPath, filePath);
            await fs.unlink(tempPath).catch(() => {});
          }
        } else {
          await fs.writeFile(filePath, req.file.buffer);
        }
        finalFilePath = filePath;
        mediaUrl = `/uploads/posts/${filename}`;
      }
    }

    // Apply watermark for creator uploads
    if (user.creator_status === 'active' && finalFilePath && mediaType === 'video') {
      const { applyVideoWatermark } = require('../../../services/watermarkService');
      const base = path.basename(finalFilePath, path.extname(finalFilePath));
      const ext = path.extname(finalFilePath);
      const wmPath = path.join(path.dirname(finalFilePath), `${base}-wm${ext}`);
      try {
        await applyVideoWatermark(finalFilePath, wmPath, user.username);
        await fs.unlink(finalFilePath).catch(() => {});
        finalFilePath = wmPath;
        mediaUrl = `/uploads/posts/${path.basename(wmPath)}`;
      } catch (err) {
        logger.warn('socialController: video watermark failed, using original', { userId: user.id, error: err.message });
        await fs.unlink(wmPath).catch(() => {});
      }
    }

    // Extract video thumbnail if we have a video
    let videoThumbnailUrl = null;
    if (mediaType === 'video' && finalFilePath) {
      const thumbFilename = `thumb-${path.basename(finalFilePath, path.extname(finalFilePath))}.jpg`;
      const thumbPath = path.join(path.dirname(finalFilePath), thumbFilename);
      const ok = await extractVideoThumbnail(finalFilePath, thumbPath);
      if (ok) videoThumbnailUrl = `/uploads/posts/${thumbFilename}`;
    }

    // Exclusive gate: only videos ≥ 4 minutes (240s) qualify
    if (isExclusive === 'true' || isExclusive === true) {
      if (mediaType !== 'video') {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(400).json({ error: 'Exclusive content must be a video of at least 4 minutes', code: 'EXCLUSIVE_VIDEO_REQUIRED' });
      }
      const durationSecs = await getVideoDurationSecs(finalFilePath);
      if (durationSecs < 240) {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        const m = Math.floor(durationSecs / 60), s = durationSecs % 60;
        return res.status(400).json({ error: `Exclusive content requires a video of at least 4 minutes (this video is ${m}m ${s}s)`, code: 'EXCLUSIVE_VIDEO_TOO_SHORT' });
      }
    }

    const exclusive = isExclusive === 'true' || isExclusive === true;
    const shareable = isShareable !== 'false' && isShareable !== false;
    const vTitle = (mediaType === 'video' && videoTitle) ? videoTitle.toString().trim().slice(0, 150) : null;
    const vDesc = (mediaType === 'video' && videoDescription) ? videoDescription.toString().trim().slice(0, 2000) : null;

    // Validate hangout group if provided
    let hangoutGroupId = null;
    if (req.body.hangoutGroupId) {
      hangoutGroupId = parseInt(req.body.hangoutGroupId, 10);
      if (!Number.isFinite(hangoutGroupId) || hangoutGroupId <= 0) {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(400).json({ error: 'Invalid hangoutGroupId' });
      }
      const memberCheck = await dbQuery(
        'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned = false OR is_banned IS NULL)',
        [hangoutGroupId, user.id]
      );
      if (!memberCheck.rows.length) {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(403).json({ error: 'Must be a group member to post' });
      }
      const groupCheck = await dbQuery('SELECT feed_visibility FROM hangout_groups WHERE id=$1', [hangoutGroupId]);
      if (!groupCheck.rows.length) {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(404).json({ error: 'Group not found' });
      }
      if (groupCheck.rows[0].feed_visibility === 'ghost') {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(403).json({ error: 'This group does not have a feed' });
      }
    }

    // Validate channel ownership if provided (only for non-reply posts)
    let channelId = null;
    if (!replyToId && req.body.channelId) {
      channelId = parseInt(req.body.channelId, 10);
      if (!Number.isFinite(channelId) || channelId <= 0) {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(400).json({ error: 'Invalid channelId' });
      }
      const chRes = await dbQuery('SELECT creator_id, collaborators FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
      if (!chRes.rows.length) {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(404).json({ error: 'Channel not found' });
      }
      const ch = chRes.rows[0];
      const isOwner = ch.creator_id === user.id;
      const isCollaborator = Array.isArray(ch.collaborators) && ch.collaborators.includes(String(user.id));
      if (!isOwner && !isCollaborator) {
        if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
        return res.status(403).json({ error: 'Channel not found or not yours' });
      }
    }

    const post = await SocialPostService.createPost(
      user.id, content.toString().trim(), mediaUrl, mediaType, replyToId, repostOfId, false, exclusive, shareable, videoThumbnailUrl, vTitle, vDesc, hangoutGroupId, null, rawCategory || null
    );

    // Assign to channel and update post_count
    if (channelId) {
      await dbQuery('UPDATE social_posts SET channel_id = $1 WHERE id = $2', [channelId, post.id]);
      await dbQuery('UPDATE creator_channels SET post_count = (SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false) WHERE id = $1', [channelId]);
      post.channel_id = channelId;
    }

    if (!replyToId && !repostOfId && !exclusive) {
      SocialPostService.mirrorToMastodon(content.toString().trim(), post.id);
    }

    // Notify parent post author on reply
    if (replyToId) {
      const parentRow = await dbQuery('SELECT user_id FROM social_posts WHERE id = $1', [replyToId]);
      const parentAuthorId = parentRow.rows[0]?.user_id;
      if (parentAuthorId) {
        const actorName = user.firstName || user.first_name || user.username;
        const replyRawContent = content ? content.toString() : '';
        const replyPreview = replyRawContent.trim().length > 60 ? replyRawContent.trim().slice(0, 57) + '...' : replyRawContent.trim();
        NotificationEmitter.emit({
          type: 'reply', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: parentAuthorId,
          entityType: 'post', entityId: String(replyToId),
          message: replyPreview ? `${actorName} replied: "${replyPreview}"` : `${actorName} replied to your post`,
          metadata: {
            pushTitle: `${actorName} commented`,
            pushBody: replyPreview ? `"${replyPreview}"` : 'Tap to view',
            url: `/social/post/${replyToId}`,
          },
        });
      }
    }

    const [authorPhoto, taggedPerformers] = await Promise.all([
      getUserPhotoFromDb(user.id).then(p => p || user.photoUrl || null),
      resolveTaggedPerformers(taggedPerformerIds),
    ]);
    const fullPost = {
      ...post,
      author_id: user.id,
      author_username: user.username,
      author_first_name: user.firstName || user.first_name,
      author_photo: authorPhoto,
      liked_by_me: false,
      tagged_performers: taggedPerformers,
    };

    setImmediate(() => {
      if (content) mentionService.createPostMentions(post.id, user.id, content.toString().trim()).catch(() => {});
      if (taggedPerformerIds.length) {
        mentionService.createPostTags(post.id, user.id, taggedPerformerIds).catch(() => {});
      }
    });

    const io = req.app.get('io');
    emitNewPost(io, fullPost, user.id);

    return res.json({ success: true, post: fullPost });
  } catch (err) {
    logger.error('createPostWithMedia error', err);
    if (finalFilePath) await fs.unlink(finalFilePath).catch(() => {});
    return res.status(500).json({ error: 'Failed to create post' });
  }
};

// ── Create Post with Multi-Media (up to 4 images) ────────────────────────────

const MAGIC_TO_MEDIA_TYPE = {
  'image/jpeg': 'image',
  'image/png':  'image',
  'image/webp': 'image',
  'image/gif':  'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'image/avif': 'image',
  'image/tiff': 'image',
  'image/bmp':  'image',
  'video/mp4':  'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'video/3gpp': 'video',
  'video/hevc': 'video',
};

const VIDEO_EXT_MAP = { 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/hevc': 'mp4' };

const createPostWithMultiMedia = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { content, isExclusive, isShareable, category: rawCategory, taggedPerformerIds: rawTaggedIds } = req.body;
  const taggedPerformerIds = parseTaggedPerformerIds(rawTaggedIds);

  // Media-attached post: content may be empty (caption-less multi-photo post is valid).
  const hasContent = content && content.toString().trim().length > 0;
  const hasMedia = Array.isArray(req.files) && req.files.length > 0;
  if (!hasContent && !hasMedia) return res.status(400).json({ error: 'Content or media required' });

  try {
    const { assertCleanText } = require('../../../services/contentModerationFilter');
    if (hasContent) assertCleanText(content, 'content');
  } catch (err) {
    if (err.code === 'FORBIDDEN_CONTENT') {
      return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
    }
    throw err;
  }

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

  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'At least one media file required' });
  if (files.length > 4) return res.status(400).json({ error: 'Maximum 4 files per post' });

  const writtenFilePaths = [];

  try {
    // 2257 compliance gate — enforce for active creators
    if (user.creator_status === 'active') {
      const { rows: compRows } = await dbQuery(
        'SELECT identity_verified, identity_verification_required_by FROM users WHERE id = $1',
        [user.id]
      );
      if (compRows.length > 0 && !IdentityVerificationService.is2257Compliant(compRows[0])) {
        for (const f of files) await fs.unlink(f.path).catch(() => {});
        return res.status(403).json({
          success: false,
          error: 'identity_verification_required',
          message: 'Complete identity verification (18 U.S.C. § 2257) before posting content.',
        });
      }
    }

    if (replyToId) {
      const parentCheck = await dbQuery('SELECT id, user_id, reply_to_id FROM social_posts WHERE id = $1 AND is_deleted = false', [replyToId]);
      if (!parentCheck.rows.length) return res.status(404).json({ error: 'Parent post not found' });
      // Flatten threading: if replying to a reply, reparent to the top-level post
      if (parentCheck.rows[0].reply_to_id !== null) replyToId = parentCheck.rows[0].reply_to_id;

      // CRIT-3: Bidirectional block check
      const parentAuthorId = parentCheck.rows[0].user_id;
      if (String(parentAuthorId) !== String(user.id)) {
        const [replierBlockedByAuthor, authorBlockedByReplier] = await Promise.all([
          dbQuery(
            `SELECT 1 FROM users WHERE id = $1 AND blocked @> ARRAY[$2::text] LIMIT 1`,
            [parentAuthorId, String(user.id)]
          ),
          dbQuery(
            `SELECT 1 FROM users WHERE id = $1 AND blocked @> ARRAY[$2::text] LIMIT 1`,
            [user.id, String(parentAuthorId)]
          ),
        ]);
        if (replierBlockedByAuthor.rows.length > 0 || authorBlockedByReplier.rows.length > 0) {
          await Promise.all(writtenFilePaths.map(p => fs.unlink(p).catch(() => {})));
          return res.status(403).json({ error: 'Cannot reply to this post', code: 'BLOCKED' });
        }
      }
    }

    if (isExclusive === 'true' || isExclusive === true) {
      const creatorCheck = await dbQuery(
        'SELECT creator_status, creator_role, followers_count FROM users WHERE id = $1',
        [user.id]
      );
      const row = creatorCheck.rows[0] || {};
      if (row.creator_status !== 'active') {
        return res.status(403).json({ error: 'Only active creators can post exclusive content' });
      }
      if (row.creator_role !== 'creator' && row.creator_role !== 'both') {
        return res.status(403).json({
          success: false,
          error: 'Exclusive paid content requires the Creator role. Performer-only accounts cannot publish exclusive posts.',
          code: 'CREATOR_ROLE_REQUIRED',
        });
      }
      if ((row.followers_count ?? 0) < 10) {
        return res.status(403).json({
          success: false,
          error: 'Reach 10 followers on your free profile to unlock exclusive content.',
          code: 'creator_ice_tier',
        });
      }
    }

    const uploadDir = path.join(__dirname, '../../../../../public/uploads/posts');
    await fs.mkdir(uploadDir, { recursive: true });

    const mediaItems = [];
    const timestamp = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const hasBuffer = !!file.buffer;
      const fileTempPath = file.path;

      // Read only header bytes for magic detection (avoid loading large videos into memory)
      let headerBytes;
      if (hasBuffer) {
        headerBytes = file.buffer.length > 4100 ? file.buffer.subarray(0, 4100) : file.buffer;
      } else {
        const fh = await fs.open(fileTempPath, 'r');
        headerBytes = Buffer.alloc(4100);
        const { bytesRead } = await fh.read(headerBytes, 0, 4100, 0);
        await fh.close();
        headerBytes = headerBytes.subarray(0, bytesRead);
      }

      const detected = await FileType.fromBuffer(headerBytes);
      const detectedMime = detected?.mime;
      const mediaType = MAGIC_TO_MEDIA_TYPE[detectedMime] || null;

      if (!mediaType) {
        logger.warn('createPostWithMultiMedia: rejected file — magic bytes do not match allowed types', {
          userId: user.id,
          fileIndex: i,
          claimedMime: file.mimetype,
          detectedMime: detectedMime || 'unknown',
        });
        if (fileTempPath) await fs.unlink(fileTempPath).catch(() => {});
        continue;
      }

      if (mediaType === 'image') {
        const imgBuffer = hasBuffer ? file.buffer : await fs.readFile(fileTempPath);
        let filename, destPath;
        if (detectedMime === 'image/gif') {
          // GIF: save as-is to preserve animation
          filename = `img-${user.id}-${timestamp}-${i}.gif`;
          destPath = path.join(uploadDir, filename);
          await fs.writeFile(destPath, imgBuffer);
        } else {
          filename = `img-${user.id}-${timestamp}-${i}.webp`;
          destPath = path.join(uploadDir, filename);
          const processedBuf = await sharp(imgBuffer, { failOn: 'none' })
            .rotate()
            .withMetadata(false)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 70, progressive: true })
            .toBuffer();
          const finalImgBuf = user.creator_status === 'active'
            ? await require('../../../services/watermarkService').applyImageWatermark(processedBuf, user.username)
            : processedBuf;
          await fs.writeFile(destPath, finalImgBuf);
        }
        if (fileTempPath) await fs.unlink(fileTempPath).catch(() => {});
        writtenFilePaths.push(destPath);
        mediaItems.push({ url: `/uploads/posts/${filename}`, type: 'image' });
      } else {
        const ext = VIDEO_EXT_MAP[detectedMime] || 'mp4';
        const filename = `vid-${user.id}-${timestamp}-${i}.${ext}`;
        let destPath = path.join(uploadDir, filename);
        if (fileTempPath) {
          const fsSync = require('fs');
          try { fsSync.renameSync(fileTempPath, destPath); } catch {
            await fs.copyFile(fileTempPath, destPath);
            await fs.unlink(fileTempPath).catch(() => {});
          }
        } else {
          await fs.writeFile(destPath, file.buffer);
        }

        // Apply watermark for creator uploads
        if (user.creator_status === 'active') {
          const { applyVideoWatermark } = require('../../../services/watermarkService');
          const base = path.basename(destPath, path.extname(destPath));
          const wmPath = path.join(uploadDir, `${base}-wm.${ext}`);
          try {
            await applyVideoWatermark(destPath, wmPath, user.username);
            await fs.unlink(destPath).catch(() => {});
            destPath = wmPath;
          } catch (err) {
            logger.warn('createPostWithMultiMedia: video watermark failed, using original', { userId: user.id, error: err.message });
            await fs.unlink(wmPath).catch(() => {});
          }
        }

        writtenFilePaths.push(destPath);
        const videoUrl = `/uploads/posts/${path.basename(destPath)}`;
        const thumbFilename = `thumb-${path.basename(destPath, path.extname(destPath))}.jpg`;
        const thumbPath = path.join(uploadDir, thumbFilename);
        const thumbOk = await extractVideoThumbnail(destPath, thumbPath);
        mediaItems.push({ url: videoUrl, type: 'video', thumbUrl: thumbOk ? `/uploads/posts/${thumbFilename}` : null, _localPath: destPath });
      }
    }

    if (mediaItems.length === 0) {
      return res.status(400).json({ error: 'No valid media files could be processed' });
    }

    // Exclusive gate: must have at least one video of ≥ 4 minutes (240s)
    if (isExclusive === 'true' || isExclusive === true) {
      const videoItems = mediaItems.filter(m => m.type === 'video');
      if (videoItems.length === 0) {
        await Promise.all(writtenFilePaths.map(p => fs.unlink(p).catch(() => {})));
        return res.status(400).json({ error: 'Exclusive content must be a video of at least 4 minutes', code: 'EXCLUSIVE_VIDEO_REQUIRED' });
      }
      const durations = await Promise.all(videoItems.map(v => getVideoDurationSecs(v._localPath)));
      const maxDuration = Math.max(...durations);
      if (maxDuration < 240) {
        await Promise.all(writtenFilePaths.map(p => fs.unlink(p).catch(() => {})));
        const m = Math.floor(maxDuration / 60), s = maxDuration % 60;
        return res.status(400).json({ error: `Exclusive content requires a video of at least 4 minutes (longest video is ${m}m ${s}s)`, code: 'EXCLUSIVE_VIDEO_TOO_SHORT' });
      }
    }

    const exclusive = isExclusive === 'true' || isExclusive === true;
    const shareable = isShareable !== 'false' && isShareable !== false;
    const contentTier = exclusive ? 'PRIME' : 'free';

    // Validate channel ownership if provided (only for non-reply posts)
    let channelId = null;
    if (!replyToId && req.body.channelId) {
      channelId = parseInt(req.body.channelId, 10);
      if (!Number.isFinite(channelId) || channelId <= 0) {
        await Promise.all(writtenFilePaths.map(p => fs.unlink(p).catch(() => {})));
        return res.status(400).json({ error: 'Invalid channelId' });
      }
      const chRes = await dbQuery('SELECT creator_id, collaborators FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
      if (!chRes.rows.length) {
        await Promise.all(writtenFilePaths.map(p => fs.unlink(p).catch(() => {})));
        return res.status(404).json({ error: 'Channel not found' });
      }
      const ch = chRes.rows[0];
      const isOwner = ch.creator_id === user.id;
      const isCollaborator = Array.isArray(ch.collaborators) && ch.collaborators.includes(String(user.id));
      if (!isOwner && !isCollaborator) {
        await Promise.all(writtenFilePaths.map(p => fs.unlink(p).catch(() => {})));
        return res.status(403).json({ error: 'Channel not found or not yours' });
      }
    }

    const VALID_CATS = new Set(['fun', 'wellness', 'adult', 'community', 'social', 'media']);
    const resolvedCategory = (rawCategory && VALID_CATS.has(rawCategory))
      ? rawCategory
      : SocialPostService._classifyByKeywords(content ? content.toString() : '');

    const result = await dbQuery(
      `INSERT INTO social_posts
         (user_id, content, media_url, media_type, media_urls, reply_to_id, repost_of_id,
          is_wof, is_exclusive, is_shareable, content_tier, channel_id, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, $12)
       RETURNING id, content, media_url, media_type, media_urls, video_thumbnail_url,
                 reply_to_id, repost_of_id, channel_id,
                 likes_count, reposts_count, replies_count, is_wof, is_exclusive, is_shareable, content_tier, created_at, category`,
      [
        user.id,
        content.toString().trim(),
        mediaItems[0].url,
        mediaItems[0].type,
        JSON.stringify(mediaItems),
        replyToId || null,
        repostOfId || null,
        exclusive,
        shareable,
        contentTier,
        channelId || null,
        resolvedCategory,
      ]
    );

    const post = result.rows[0];

    // Set video_thumbnail_url from the first video item that has a thumbnail
    const firstVideoThumb = mediaItems.find(m => m.type === 'video' && m.thumbUrl)?.thumbUrl || null;
    if (firstVideoThumb) {
      await dbQuery('UPDATE social_posts SET video_thumbnail_url = $1 WHERE id = $2', [firstVideoThumb, post.id]);
      post.video_thumbnail_url = firstVideoThumb;
    }

    if (replyToId) {
      await dbQuery('UPDATE social_posts SET replies_count = replies_count + 1 WHERE id = $1 AND is_deleted = false', [replyToId]);
    }
    if (repostOfId) {
      await dbQuery('UPDATE social_posts SET reposts_count = reposts_count + 1 WHERE id = $1 AND is_deleted = false', [repostOfId]);
    }

    // Update channel post_count after insert
    if (channelId) {
      await dbQuery('UPDATE creator_channels SET post_count = (SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false) WHERE id = $1', [channelId]);
    }

    if (!replyToId && !repostOfId && !exclusive) {
      SocialPostService.mirrorToMastodon(content.toString().trim(), post.id);
    }

    if (replyToId) {
      const parentRow = await dbQuery('SELECT user_id FROM social_posts WHERE id = $1', [replyToId]);
      const parentAuthorId = parentRow.rows[0]?.user_id;
      if (parentAuthorId) {
        const actorName = user.firstName || user.first_name || user.username;
        const replyRawContent = content ? content.toString() : '';
        const replyPreview = replyRawContent.trim().length > 60 ? replyRawContent.trim().slice(0, 57) + '...' : replyRawContent.trim();
        NotificationEmitter.emit({
          type: 'reply', category: 'social', priority: 'normal',
          actorId: user.id, targetUserId: parentAuthorId,
          entityType: 'post', entityId: String(replyToId),
          message: replyPreview ? `${actorName} replied: "${replyPreview}"` : `${actorName} replied to your post`,
          metadata: {
            pushTitle: `${actorName} commented`,
            pushBody: replyPreview ? `"${replyPreview}"` : 'Tap to view',
            url: `/social/post/${replyToId}`,
          },
        });
      }
    }

    const [authorPhoto, taggedPerformers] = await Promise.all([
      getUserPhotoFromDb(user.id).then(p => p || user.photoUrl || null),
      resolveTaggedPerformers(taggedPerformerIds),
    ]);
    const fullPost = {
      ...post,
      media_urls: mediaItems,
      author_id: user.id,
      author_username: user.username,
      author_first_name: user.firstName || user.first_name,
      author_photo: authorPhoto,
      liked_by_me: false,
      tagged_performers: taggedPerformers,
    };

    setImmediate(() => {
      if (content) mentionService.createPostMentions(post.id, user.id, content.toString().trim()).catch(() => {});
      if (taggedPerformerIds.length) {
        mentionService.createPostTags(post.id, user.id, taggedPerformerIds).catch(() => {});
      }
    });

    const io = req.app.get('io');
    emitNewPost(io, fullPost, user.id);

    return res.json({ success: true, post: fullPost });
  } catch (err) {
    logger.error('createPostWithMultiMedia error', err);
    await Promise.all(writtenFilePaths.map(p => fs.unlink(p).catch(() => {})));
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
  let { userId } = req.params;

  // Short-circuit deleted/missing profiles via a Redis tombstone (24h TTL) so
  // repeated requests for a hard-deleted UUID don't hammer the DB.
  const { getRedis } = require('../../../config/redis');
  const tombstoneKey = `profile:404:${userId}`;
  try {
    const redis = getRedis();
    const tomb = await redis.get(tombstoneKey);
    if (tomb) return res.status(404).json({ error: 'User not found' });
  } catch { /* Redis down — fall through to DB */ }

  // Resolve param to canonical DB id (handles @usernames, pnptv_id UUIDs, telegram IDs)
  userId = await resolveUserId(userId);
  if (!userId) {
    try { await getRedis().set(tombstoneKey, '1', 'EX', 86400); } catch { /* non-fatal */ }
    return res.status(404).json({ error: 'User not found' });
  }

  const viewerId = req.session?.user?.id || null;
  const viewerRole = req.session?.user?.role || '';
  const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';

  try {
    const viewerTier = viewerId
      ? await validateTierFresh(viewerId, req.session?.user?.tier || 'free')
      : 'free';
    if (viewerId && viewerTier !== (req.session?.user?.tier || 'free').toLowerCase()) {
      req.session.user.tier = viewerTier;
    }

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

    // Profile browsing is open to all authenticated users (no tier restriction).

    const isFreeViewer = !isAdmin && viewerTier === 'free';
    const result = await SocialPostService.getPublicProfile(
      userId, viewerId,
      isFreeViewer ? undefined : req.query.cursor,
      isFreeViewer ? FREE_PROFILE_LIMIT : req.query.limit,
      viewerTier, isAdmin
    );
    if (!result.profile) {
      // Soft-deleted or missing from social service — stamp tombstone so next requests skip DB
      try { await getRedis().set(tombstoneKey, '1', 'EX', 86400); } catch { /* non-fatal */ }
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = result.profile;
    const pd = result.performerData;

    // Compute the PRIME/BASIC/FREE label from the target user's active
    // entitlements so the badge next to the username is always accurate,
    // even if users.tier has drifted.
    const EntitlementAccessService = require('../../../services/entitlementAccessService');
    const label = await EntitlementAccessService.getUserLabel(profile.id);

    const gamificationService = require('../../../services/gamificationService');
    const gamificationBadges = await gamificationService.getUserBadges(profile.id).catch(() => []);

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
        city: profile.city,
        country: profile.country,
        memberSince: profile.created_at,
        postCount: result.postCount,
        tier: profile.tier || EntitlementAccessService.labelToDisplayTier(label),
        label,
        creatorStatus: profile.creator_status,
        creatorType: profile.creator_type,
        creatorPriceUsd: profile.creator_price_usd ? parseFloat(profile.creator_price_usd) : null,
        creatorVerified: profile.creator_verified || false,
        creatorFeatured: profile.creator_featured || false,
        creatorSubscriberCount: profile.creator_subscriber_count || 0,
        exclusiveVideoCount: result.exclusiveVideoCount,
        exclusivePhotoCount: result.exclusivePhotoCount,
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
        gamificationBadges,
      },
      posts: result.posts,
      nextCursor: isFreeViewer ? null : result.nextCursor,
      freeUserLimited: isFreeViewer,
    });
  } catch (err) {
    logger.error('getPublicProfile error', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
};

// ── WoF Leaderboard ──────────────────────────────────────────────────────────

const getWofLeaderboard = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const leaderboard = await SocialPostService.getWofLeaderboard(req.query.limit);
    return res.json({ success: true, leaderboard });
  } catch (err) {
    logger.error('getWofLeaderboard error', err);
    return res.status(500).json({ error: 'Failed to load WoF leaderboard' });
  }
};

// ── WoF Stats ─────────────────────────────────────────────────────────────────

const getWofStats = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const stats = await SocialPostService.getWofStats();
    return res.json({ success: true, stats });
  } catch (err) {
    logger.error('getWofStats error', err);
    return res.status(500).json({ error: 'Failed to load WoF stats' });
  }
};

// ── Admin: Flag / Unflag WoF ──────────────────────────────────────────────────

const adminFlagWof = async (req, res) => {
  const postId = parsePostId(req, res); if (!postId) return;
  try {
    const id = await SocialPostService.adminFlagWof(postId);
    if (!id) return res.status(404).json({ error: 'Post not found' });
    return res.json({ success: true, postId: id });
  } catch (err) {
    logger.error('adminFlagWof error', err);
    return res.status(500).json({ error: 'Failed to flag post as WoF' });
  }
};

const adminUnflagWof = async (req, res) => {
  const postId = parsePostId(req, res); if (!postId) return;
  try {
    const id = await SocialPostService.adminUnflagWof(postId);
    if (!id) return res.status(404).json({ error: 'Post not found' });
    return res.json({ success: true, postId: id });
  } catch (err) {
    logger.error('adminUnflagWof error', err);
    return res.status(500).json({ error: 'Failed to unflag WoF post' });
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

// ── Bulk Video Upload (performers only) ───────────────────────────────────────

const bulkCreateVideos = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;

  // Verify active creator status and 2257 compliance
  try {
    const creatorCheck = await dbQuery(
      'SELECT creator_status, identity_verified, identity_verification_required_by FROM users WHERE id = $1',
      [user.id]
    );
    const creatorRow = creatorCheck.rows[0];
    if (creatorRow?.creator_status !== 'active') {
      if (req.files) {
        for (const f of req.files) await fs.unlink(f.path).catch(() => {});
      }
      return res.status(403).json({ error: 'Only active creators can bulk upload videos' });
    }
    if (!IdentityVerificationService.is2257Compliant(creatorRow)) {
      if (req.files) {
        for (const f of req.files) await fs.unlink(f.path).catch(() => {});
      }
      return res.status(403).json({
        success: false,
        error: 'identity_verification_required',
        message: 'Complete identity verification (18 U.S.C. § 2257) before posting content.',
      });
    }
  } catch (err) {
    logger.error('bulkCreateVideos: creator check failed', err);
    return res.status(500).json({ error: 'Failed to verify creator status' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No video files uploaded' });
  }

  const rawCaptions = req.body.captions;
  const rawExclusive = req.body.isExclusive;
  const rawShareable = req.body.isShareable;
  const captions = Array.isArray(rawCaptions) ? rawCaptions : (rawCaptions ? [rawCaptions] : []);
  const exclusiveArr = Array.isArray(rawExclusive) ? rawExclusive : (rawExclusive ? [rawExclusive] : []);
  const shareableArr = Array.isArray(rawShareable) ? rawShareable : (rawShareable ? [rawShareable] : []);

  const uploadDir = path.join(__dirname, '../../../../../public/uploads/posts');
  await fs.mkdir(uploadDir, { recursive: true });

  const createdPosts = [];
  const errors = [];

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const caption = (captions[i] || '').trim() || '🎬';
    const exclusive = exclusiveArr[i] === 'true';
    const shareable = shareableArr[i] !== 'false';

    if (caption.length > 5000) {
      await fs.unlink(file.path).catch(() => {});
      errors.push({ index: i, error: 'Caption too long (max 5000 chars)' });
      continue;
    }

    try {
      // Validate magic bytes from first 4100 bytes
      const headerBuf = Buffer.alloc(4100);
      const fd = await fs.open(file.path, 'r');
      await fd.read(headerBuf, 0, 4100, 0);
      await fd.close();

      const detected = await FileType.fromBuffer(headerBuf);
      const detectedMime = detected?.mime;
      const isValidVideo = detectedMime === 'video/mp4' || detectedMime === 'video/webm';

      if (!isValidVideo) {
        logger.warn('bulkCreateVideos: rejected file — magic bytes mismatch', { userId: user.id, index: i, detectedMime });
        await fs.unlink(file.path).catch(() => {});
        errors.push({ index: i, error: 'Invalid file type — only mp4/webm allowed' });
        continue;
      }

      const ext = detectedMime === 'video/webm' ? 'webm' : 'mp4';
      const filename = `vid-${user.id}-${Date.now()}-${i}.${ext}`;
      const finalPath = path.join(uploadDir, filename);
      await fs.rename(file.path, finalPath);
      const mediaUrl = `/uploads/posts/${filename}`;

      // Generate thumbnail (non-fatal)
      let videoThumbnailUrl = null;
      const thumbFilename = `thumb-${user.id}-${Date.now()}-${i}.jpg`;
      const thumbPath = path.join(uploadDir, thumbFilename);
      try {
        await new Promise((resolve, reject) => {
          ffmpeg(finalPath)
            .screenshots({ count: 1, timemarks: ['2'], filename: thumbFilename, folder: uploadDir })
            .on('end', resolve)
            .on('error', reject);
        });
        videoThumbnailUrl = `/uploads/posts/${thumbFilename}`;
      } catch (thumbErr) {
        logger.warn('bulkCreateVideos: thumbnail generation failed', { userId: user.id, index: i, err: thumbErr.message });
      }

      // Upload to object storage (R2) if configured. We keep the local file
      // as a backup until the migration script confirms successful R2 sync;
      // the video access guard will prefer R2 (presigned URL redirect) when
      // both copies exist. Failures here are non-fatal — disk copy still works.
      try {
        const objectStorage = require('../../../services/objectStorageService');
        if (objectStorage.isConfigured()) {
          await objectStorage.uploadFile(finalPath, `posts/${filename}`, detectedMime === 'video/webm' ? 'video/webm' : 'video/mp4');
          logger.info('Video uploaded to object storage', { userId: user.id, key: `posts/${filename}` });
          if (videoThumbnailUrl) {
            try {
              await objectStorage.uploadFile(thumbPath, `posts/${thumbFilename}`, 'image/jpeg');
            } catch (thumbUploadErr) {
              logger.warn('Thumbnail R2 upload failed (non-fatal)', { error: thumbUploadErr.message });
            }
          }
        }
      } catch (uploadErr) {
        logger.error('Object storage upload failed — falling back to disk-only', {
          userId: user.id, filename, error: uploadErr.message,
        });
      }

      const post = await SocialPostService.createPost(
        user.id, caption, mediaUrl, 'video', null, null, false, exclusive, shareable, videoThumbnailUrl
      );

      const authorPhoto = await getUserPhotoFromDb(user.id) || user.photoUrl || null;
      const fullPost = {
        ...post,
        author_id: user.id,
        author_username: user.username,
        author_first_name: user.firstName || user.first_name,
        author_photo: authorPhoto,
        liked_by_me: false,
      };
      createdPosts.push(fullPost);

      const io = req.app.get('io');
      emitNewPost(io, fullPost, user.id);
    } catch (err) {
      logger.error('bulkCreateVideos: error processing file', { userId: user.id, index: i, err });
      await fs.unlink(file.path).catch(() => {});
      errors.push({ index: i, error: 'Failed to process video' });
    }
  }

  if (createdPosts.length === 0) {
    return res.status(400).json({ error: 'No videos could be processed', details: errors });
  }
  return res.json({ success: true, posts: createdPosts, errors });
};

// ── Get Single Post (public, no auth required) ────────────────────────────────

const getPost = async (req, res) => {
  const id = parsePostId(req, res);
  if (!id) return;
  try {
    const viewerId = req.session?.user?.id || null;
    const { rows } = await dbQuery(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url,
              sp.video_title, sp.video_description,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count,
              sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.is_promoted, sp.created_at,
              COALESCE(sp.content_tier, 'free') as content_tier,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              u.city as author_city, u.country as author_country,
              u.creator_status as author_creator_status, u.creator_type as author_creator_type,
              u.creator_verified as author_creator_verified, u.creator_price_usd as author_creator_price,
              ${viewerId
                ? 'EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$2) as liked_by_me'
                : 'false as liked_by_me'}
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       WHERE sp.id = $1 AND sp.is_deleted = false`,
      viewerId ? [id, viewerId] : [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    const row = rows[0];
    const photo = row.author_photo;

    // H-06: Determine whether this post should be locked for the viewer.
    // Exclusive posts (is_exclusive=true OR content_tier='prime') are locked when:
    //   - The viewer is unauthenticated, OR
    //   - The viewer is not the post author AND does not have PRIME tier/admin role
    const viewerRole = req.session?.user?.role || '';
    const viewerIsAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';
    const isAuthor = viewerId && String(viewerId) === String(row.author_id);
    const postTier = (row.content_tier || 'free').toLowerCase();
    const isExclusivePost = row.is_exclusive === true || postTier === 'prime';
    // HIGH-04: re-validate PRIME tier from DB/cache to prevent stale-session access
    const viewerTier = viewerId
      ? await validateTierFresh(viewerId, req.session?.user?.tier || 'free')
      : 'free';
    if (viewerId && viewerTier !== (req.session?.user?.tier || 'free').toLowerCase()) {
      req.session.user.tier = viewerTier;
    }
    const viewerHasAccess = viewerIsAdmin || isAuthor || viewerTier === 'prime';
    let contentLocked = isExclusivePost && !viewerHasAccess;
    // Track why we locked so the frontend can show the right upsell.
    // 'not_prime' → viewer isn't PRIME; 'not_subscribed' → viewer is PRIME but lacks the per-creator subscription.
    let lockedReason = contentLocked ? 'not_prime' : null;

    // M-2: For exclusive posts where the viewer IS prime, also verify they have an active
    // creator subscription for this post's author — prime alone is not enough.
    if (isExclusivePost && !contentLocked && viewerTier === 'prime' && viewerId && !isAuthor && !viewerIsAdmin) {
      try {
        const postAuthorId = String(row.author_id);
        const { rows: subCheck } = await dbQuery(
          `SELECT 1 FROM creator_subscriptions
           WHERE subscriber_id = $1
             AND creator_id = $2
             AND status = 'active'
             AND (expires_at IS NULL OR expires_at > NOW())
           LIMIT 1`,
          [String(viewerId), postAuthorId]
        );
        if (!subCheck.length) {
          contentLocked = true;
          lockedReason = 'not_subscribed';
        }
      } catch (subErr) {
        logger.error('getPost: creator subscription check failed', { viewerId, err: subErr.message });
        contentLocked = true;
        lockedReason = 'not_subscribed';
      }
    }

    const post = {
      ...row,
      author_photo: isValidPhotoUrl(photo) ? photo : null,
      is_shareable: row.is_shareable !== false,
      content_locked: contentLocked,
      // Mirror the signals used by feed/creator endpoints so SocialPostCard's
      // existing locked-card UI fires here too. Without these, PostDetail would
      // render a blank card for non-PRIME viewers instead of the upgrade prompt.
      is_exclusive: contentLocked ? true : (row.is_exclusive === true),
      exclusive_status: contentLocked ? 'locked' : undefined,
      locked_reason: contentLocked ? lockedReason : undefined,
      // Null out sensitive content when locked so it is not exposed in the response
      content: contentLocked ? null : row.content,
      media_url: contentLocked ? null : row.media_url,
      media_urls: contentLocked ? null : row.media_urls,
      // M-3: Null video metadata fields so locked posts don't leak title/thumbnail
      video_thumbnail_url: contentLocked ? null : row.video_thumbnail_url,
      video_title: contentLocked ? null : (row.video_title || null),
      video_description: contentLocked ? null : (row.video_description || null),
    };
    return res.json({ success: true, post });
  } catch (err) {
    logger.error('getPost error', err);
    return res.status(500).json({ error: 'Failed to load post' });
  }
};

// ── Public Post (no auth, non-exclusive only, minimal fields for OG) ──────────

const getPublicPost = async (req, res) => {
  const id = parseInt(req.params.postId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid post ID' });
  }

  try {
    const result = await dbQuery(
      `SELECT
         sp.id,
         LEFT(sp.content, 200)   AS content,
         sp.media_url,
         sp.media_type,
         sp.media_urls,
         sp.video_thumbnail_url,
         u.username              AS author_username,
         u.first_name            AS author_first_name,
         u.photo_file_id         AS author_photo
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       WHERE sp.id = $1
         AND sp.is_deleted = false
         AND (sp.is_exclusive IS NOT TRUE)`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = result.rows[0];

    // Normalize media_urls if stored as a JSON string
    if (post.media_urls && typeof post.media_urls === 'string') {
      try {
        post.media_urls = JSON.parse(post.media_urls);
      } catch (_) {
        post.media_urls = null;
      }
    }

    // Only expose web-servable photo URLs — not Telegram file IDs
    if (!isValidPhotoUrl(post.author_photo)) {
      post.author_photo = null;
    }

    return res.json({ success: true, post });
  } catch (err) {
    logger.error('getPublicPost error', err);
    return res.status(500).json({ error: 'Failed to load post' });
  }
};

// ── Mention autocomplete search ───────────────────────────────────────────────

const searchMentions = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const q = (req.query.q || '').trim();
  if (!q || q.length < 1) return res.json({ success: true, users: [] });
  try {
    const creatorsOnly = req.query.creators_only === '1' || req.query.creators_only === 'true';
    const users = creatorsOnly
      ? await mentionService.searchCreatorsForTag(q, 8)
      : await mentionService.searchUsersForMention(q, 8);
    return res.json({ success: true, users });
  } catch (err) {
    logger.error('searchMentions error', err);
    return res.status(500).json({ error: 'Failed to search users' });
  }
};

const assignPostToChannel = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const postId = parsePostId(req, res); if (!postId) return;
  const channelId = parseInt(req.body.channelId, 10);
  if (!Number.isFinite(channelId)) return res.status(400).json({ error: 'Valid channelId is required' });

  try {
    // Verify post ownership
    const postRes = await dbQuery('SELECT user_id, channel_id FROM social_posts WHERE id = $1 AND is_deleted = false', [postId]);
    if (!postRes.rows.length || postRes.rows[0].user_id !== user.id) {
      return res.status(404).json({ error: 'Post not found or not yours' });
    }
    // Verify channel ownership or collaborator access
    const chRes = await dbQuery('SELECT creator_id, collaborators FROM creator_channels WHERE id = $1 AND is_active = true', [channelId]);
    if (!chRes.rows.length) return res.status(404).json({ error: 'Channel not found or not yours' });
    const ch = chRes.rows[0];
    const isOwner = ch.creator_id === user.id;
    const isCollaborator = Array.isArray(ch.collaborators) && ch.collaborators.includes(String(user.id));
    if (!isOwner && !isCollaborator) {
      return res.status(404).json({ error: 'Channel not found or not yours' });
    }
    const oldChannelId = postRes.rows[0].channel_id;
    await dbQuery('UPDATE social_posts SET channel_id = $1 WHERE id = $2', [channelId, postId]);
    // Recalculate post_count
    await dbQuery('UPDATE creator_channels SET post_count = (SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false) WHERE id = $1', [channelId]);
    if (oldChannelId && oldChannelId !== channelId) {
      await dbQuery('UPDATE creator_channels SET post_count = (SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false) WHERE id = $1', [oldChannelId]);
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error('assignPostToChannel error', err);
    return res.status(500).json({ error: 'Failed to assign post to channel' });
  }
};

const unassignPostFromChannel = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const postId = parsePostId(req, res); if (!postId) return;

  try {
    const postRes = await dbQuery('SELECT user_id, channel_id FROM social_posts WHERE id = $1 AND is_deleted = false', [postId]);
    if (!postRes.rows.length || postRes.rows[0].user_id !== user.id) {
      return res.status(404).json({ error: 'Post not found or not yours' });
    }
    const oldChannelId = postRes.rows[0].channel_id;
    if (!oldChannelId) return res.json({ success: true }); // already unassigned

    await dbQuery('UPDATE social_posts SET channel_id = NULL WHERE id = $1', [postId]);
    await dbQuery('UPDATE creator_channels SET post_count = (SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false) WHERE id = $1', [oldChannelId]);
    return res.json({ success: true });
  } catch (err) {
    logger.error('unassignPostFromChannel error', err);
    return res.status(500).json({ error: 'Failed to unassign post from channel' });
  }
};

// ── Hangout Feed ──────────────────────────────────────────────────────────────

const getHangoutFeed = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    // Must be a member
    const memberCheck = await dbQuery(
      'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned = false OR is_banned IS NULL)',
      [groupId, user.id]
    );
    if (!memberCheck.rows.length) return res.status(403).json({ error: 'Must be a group member' });

    // Check feed visibility
    const groupCheck = await dbQuery('SELECT feed_visibility FROM hangout_groups WHERE id=$1', [groupId]);
    if (!groupCheck.rows.length) return res.status(404).json({ error: 'Group not found' });
    if (groupCheck.rows[0].feed_visibility === 'ghost') return res.json({ success: true, posts: [], nextCursor: null });

    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const viewerTier = await validateTierFresh(user.id, user.tier || 'free');
    const blockedRes = await dbQuery('SELECT blocked FROM users WHERE id = $1', [user.id]);
    const blockedIds = (blockedRes.rows[0]?.blocked || []).map(Number);

    const result = await SocialPostService.getHangoutFeed(groupId, user.id, req.query.cursor, req.query.limit, viewerTier, isAdmin, blockedIds);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getHangoutFeed error', err);
    return res.status(500).json({ error: 'Failed to load hangout feed' });
  }
};

// ── Drop to Feed — promote a chat message into a hangout feed post ───────────

const dropToFeed = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  const { messageId, note } = req.body;
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });
  if (!messageId) return res.status(400).json({ error: 'messageId required' });
  const safeNote = (typeof note === 'string' ? note.trim().slice(0, 500) : '') || '';

  const msgId = parseInt(messageId, 10);
  if (!Number.isFinite(msgId) || msgId <= 0) return res.status(400).json({ error: 'Invalid messageId' });

  try {
    // Must be member
    const memberCheck = await dbQuery(
      'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned = false OR is_banned IS NULL)',
      [groupId, user.id]
    );
    if (!memberCheck.rows.length) return res.status(403).json({ error: 'Must be a group member' });

    // Group must not be ghost
    const groupCheck = await dbQuery('SELECT feed_visibility, name FROM hangout_groups WHERE id=$1', [groupId]);
    if (!groupCheck.rows.length) return res.status(404).json({ error: 'Group not found' });
    if (groupCheck.rows[0].feed_visibility === 'ghost') return res.status(403).json({ error: 'This group does not have a feed' });

    // Fetch the chat message
    const msgRes = await dbQuery(
      `SELECT id, room, user_id, content, media_url, media_type, media_thumb_url, media_width, media_height
       FROM chat_messages WHERE id=$1 AND room=$2 AND is_deleted = false`,
      [msgId, `hangout:${groupId}`]
    );
    if (!msgRes.rows.length) return res.status(404).json({ error: 'Message not found' });

    const msg = msgRes.rows[0];

    // Only the message author or a moderator/owner can drop to feed
    const isOwnerOrMod = memberCheck.rows[0].role === 'owner' || memberCheck.rows[0].role === 'moderator';
    if (String(msg.user_id) !== String(user.id) && !isOwnerOrMod) {
      return res.status(403).json({ error: 'Only the author or a moderator can drop this to the feed' });
    }

    // Check if already dropped
    const existingCheck = await dbQuery('SELECT id FROM social_posts WHERE source_message_id=$1', [msgId]);
    if (existingCheck.rows.length) return res.status(409).json({ error: 'This message has already been dropped to the feed' });

    // Create the post — note (user comment) takes priority over raw message content
    const postContent = safeNote || msg.content || '';
    const post = await SocialPostService.createPost(
      msg.user_id, postContent, msg.media_url, msg.media_type,
      null, null, false, false, true, null, null, null,
      groupId, msgId
    );

    const authorPhoto = await getUserPhotoFromDb(msg.user_id);
    const authorRes = await dbQuery('SELECT username, first_name FROM users WHERE id=$1', [msg.user_id]);
    const author = authorRes.rows[0] || {};

    const fullPost = {
      ...post,
      author_id: msg.user_id,
      author_username: author.username || '',
      author_first_name: author.first_name || '',
      author_photo: authorPhoto,
      liked_by_me: false,
      hangout_group_id: groupId,
      hangout_group_name: groupCheck.rows[0].name,
    };

    // Emit to hangout feed room
    const io = req.app.get('io');
    if (io) io.to(`hangout:${groupId}`).emit('hangout:feed:new_post', fullPost);

    return res.json({ success: true, post: fullPost });
  } catch (err) {
    logger.error('dropToFeed error', err);
    return res.status(500).json({ error: 'Failed to drop to feed' });
  }
};

// ── User hangout activity (for profiles) ─────────────────────────────────────

const getUserHangoutActivity = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const targetUserId = req.params.userId || user.id;

  try {
    // Public hangouts the user is a member of (with message count as activity)
    const { rows } = await dbQuery(
      `SELECT g.id, g.name, g.avatar_url, g.is_main, g.is_public, g.feed_visibility,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (SELECT COUNT(*)::int FROM chat_messages cm WHERE cm.room = 'hangout:' || g.id::text AND cm.user_id = $1 AND cm.is_deleted = false) as message_count,
              (SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.room = 'hangout:' || g.id::text AND cm.user_id = $1 AND cm.is_deleted = false) as last_active_at
       FROM hangout_groups g
       JOIN hangout_group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       WHERE g.is_public = true
       ORDER BY last_active_at DESC NULLS LAST
       LIMIT 10`,
      [targetUserId]
    );

    return res.json({
      success: true,
      hangouts: rows.map(r => ({
        id: r.id,
        name: r.name,
        avatarUrl: r.avatar_url,
        isMain: r.is_main,
        memberCount: r.member_count,
        messageCount: r.message_count,
        lastActiveAt: r.last_active_at,
      })),
    });
  } catch (err) {
    logger.error('getUserHangoutActivity error', err);
    return res.status(500).json({ error: 'Failed to load hangout activity' });
  }
};

const getHashtagFeed = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const tag = (req.query.tag || '').trim();
  if (!tag) return res.status(400).json({ error: 'Missing tag parameter' });
  try {
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const viewerTier = await validateTierFresh(user.id, user.tier || 'free');
    if (viewerTier !== (user.tier || 'free').toLowerCase()) req.session.user.tier = viewerTier;
    const blockedRes = await dbQuery('SELECT blocked FROM users WHERE id = $1', [user.id]);
    const blockedIds = (blockedRes.rows[0]?.blocked || []).map(Number);
    const result = await SocialPostService.getHashtagFeed(
      user.id, tag, req.query.cursor, req.query.limit, viewerTier, isAdmin, blockedIds
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('getHashtagFeed error', err);
    return res.status(500).json({ error: 'Failed to load hashtag feed' });
  }
};

// ── Share a post to one or more hangouts ─────────────────────────────────────
// POST /api/webapp/social/posts/:postId/share-to-hangouts
// Body: { groupIds: number[] (max 10), note?: string }
// Response: { success, results: [{ groupId, status: "sent"|"skipped", messageId?, reason? }] }
const sharePostToHangouts = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isFinite(postId) || postId <= 0) {
    return res.status(400).json({ error: 'Invalid postId' });
  }

  const { groupIds, note } = req.body || {};
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return res.status(400).json({ error: 'groupIds required' });
  }
  if (groupIds.length > 10) {
    return res.status(400).json({ error: 'Max 10 hangouts per share' });
  }

  const normalizedIds = Array.from(new Set(
    groupIds.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0)
  ));
  if (normalizedIds.length === 0) {
    return res.status(400).json({ error: 'No valid groupIds' });
  }

  // Fetch source post
  const { rows: postRows } = await dbQuery(
    `SELECT sp.id, sp.user_id, sp.content, sp.media_url, sp.media_type, sp.is_deleted, sp.is_shareable,
            sp.video_title, sp.video_description, sp.video_thumbnail_url,
            u.username AS author_username, u.first_name AS author_first_name,
            u.photo_file_id AS author_photo
       FROM social_posts sp
       JOIN users u ON u.id = sp.user_id
      WHERE sp.id = $1`,
    [postId]
  );
  const post = postRows[0];
  if (!post || post.is_deleted) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const noteText = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  const authorHandle = post.author_username ? `@${post.author_username}` : (post.author_first_name || 'User');
  const preview = (post.content || '').trim().slice(0, 180);
  const postUrl = `https://pnptv.app/post/${post.id}`;

  // Build the message body — visible to any client that doesn't know post_card type
  const bodyParts = [];
  if (noteText) bodyParts.push(noteText);
  bodyParts.push(`📎 ${authorHandle}:`);
  if (preview) bodyParts.push(preview + (post.content && post.content.length > 180 ? '…' : ''));
  bodyParts.push(postUrl);
  const content = bodyParts.join('\n');

  const resolvePhoto = (p) => (p && (p.startsWith('/') || p.startsWith('http'))) ? p : null;

  const meta = {
    postId: post.id,
    snapshot: {
      authorUsername: post.author_username || null,
      authorFirstName: post.author_first_name || null,
      authorPhoto: resolvePhoto(post.author_photo),
      content: preview || null,
      mediaUrl: post.media_url || null,
      mediaType: post.media_type || null,
      videoTitle: post.video_title || null,
      videoDescription: post.video_description || null,
      videoThumbnailUrl: post.video_thumbnail_url || null,
      note: noteText || null,
    },
  };

  // Look up sender display fields once
  const { rows: senderRows } = await dbQuery(
    `SELECT photo_file_id, username, first_name FROM users WHERE id = $1`,
    [user.id]
  );
  const senderPhoto = senderRows[0]?.photo_file_id && (senderRows[0].photo_file_id.startsWith('/') || senderRows[0].photo_file_id.startsWith('http'))
    ? senderRows[0].photo_file_id : null;
  const senderUsername = senderRows[0]?.username || user.username || null;
  const senderFirstName = senderRows[0]?.first_name || user.firstName || user.first_name || null;

  const io = req.app.get('io');
  const results = [];

  for (const groupId of normalizedIds) {
    try {
      // Membership check
      const { rows: memberRows } = await dbQuery(
        `SELECT is_banned, is_muted, muted_until FROM hangout_group_members
          WHERE group_id = $1 AND user_id = $2`,
        [groupId, user.id]
      );
      if (memberRows.length === 0) {
        results.push({ groupId, status: 'skipped', reason: 'not_a_member' });
        continue;
      }
      if (memberRows[0].is_banned) {
        results.push({ groupId, status: 'skipped', reason: 'banned' });
        continue;
      }
      if (memberRows[0].is_muted && (!memberRows[0].muted_until || new Date(memberRows[0].muted_until) > new Date())) {
        results.push({ groupId, status: 'skipped', reason: 'muted' });
        continue;
      }

      // Read-only check (allow if user is owner/mod)
      const { rows: gsRows } = await dbQuery(
        `SELECT hg.is_read_only,
                (EXISTS(SELECT 1 FROM hangout_group_members m
                         WHERE m.group_id = hg.id AND m.user_id = $2
                           AND m.role IN ('owner','mod'))) AS is_mod_or_owner
           FROM hangout_groups hg WHERE hg.id = $1`,
        [groupId, user.id]
      );
      if (gsRows[0]?.is_read_only && !gsRows[0].is_mod_or_owner) {
        results.push({ groupId, status: 'skipped', reason: 'read_only' });
        continue;
      }

      const room = `hangout:${groupId}`;
      const { rows: msgRows } = await dbQuery(
        `INSERT INTO chat_messages
           (room, user_id, username, first_name, photo_url, content, message_type, meta)
         VALUES ($1, $2, $3, $4, $5, $6, 'post_card', $7::jsonb)
         RETURNING id, room, user_id, username, first_name, photo_url, content,
                   media_url, media_type, message_type, meta, created_at`,
        [room, user.id, senderUsername, senderFirstName, senderPhoto, content, JSON.stringify(meta)]
      );
      const msg = msgRows[0];

      await dbQuery('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

      if (io) io.to(room).emit('chat:message', msg);

      results.push({ groupId, status: 'sent', messageId: msg.id });
    } catch (err) {
      logger.error('sharePostToHangouts per-group failed', { groupId, error: err.message });
      results.push({ groupId, status: 'skipped', reason: 'server_error' });
    }
  }

  return res.json({ success: true, results });
};

module.exports = { getFeed, getHomeFeed, getWofFeed, getWall, createPost, toggleLike, deletePost, editPost, getReplies, postToMastodon, createPostWithMedia, createPostWithMultiMedia, getPublicProfile, requestWofDeletion, bulkCreateVideos, getWofLeaderboard, getWofStats, adminFlagWof, adminUnflagWof, getPost, getPublicPost, searchMentions, assignPostToChannel, unassignPostFromChannel, getHangoutFeed, dropToFeed, getUserHangoutActivity, getHashtagFeed, sharePostToHangouts };
