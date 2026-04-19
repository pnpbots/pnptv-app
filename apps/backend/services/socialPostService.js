const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const axios = require('axios');
const MediaCleanupService = require('./mediaCleanupService');
const CreatorService = require('./creatorService');

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
  /**
   * @param {number}   userId      - Authenticated viewer's user ID
   * @param {string}   cursor      - Opaque cursor (post ID) for pagination
   * @param {number}   limit       - Page size (max 50)
   * @param {string}   viewerTier  - Viewer's subscription tier ('free'|'member'|'prime')
   * @param {boolean}  isAdmin     - True when the viewer has an admin/superadmin role
   * @param {number[]} blockedIds  - Array of user IDs the viewer has blocked (C-08)
   */
  static async getFeed(userId, cursor, limit = 20, viewerTier, isAdmin = false, blockedIds = []) {
    const lim = Math.min(Number(limit) || 20, 50);
    const fetchLimit = lim + 10;
    const cursorId = cursor ? parseInt(cursor, 10) : null;

    // Build parameterized query — $1=userId, $2=fetchLimit, [$3=cursorId], $N=blockedIds
    const params = [userId, fetchLimit];
    if (cursorId) params.push(cursorId);
    const blockedParam = blockedIds.length > 0 ? blockedIds.map(Number) : [];
    params.push(blockedParam);
    const blockedParamIdx = params.length; // last param index
    const cursorClause = cursorId ? `AND sp.id < $3` : '';

    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
              sp.source_channel, sp.hangout_group_id,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.created_at,
              sp.is_promoted, sp.promoted_link, sp.promoted_link_label, sp.promoted_thumbnail,
              COALESCE(sp.content_tier, 'free') as content_tier,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              u.city as author_city, u.country as author_country,
              u.creator_status as author_creator_status, u.creator_type as author_creator_type,
              u.creator_verified as author_creator_verified, u.creator_price_usd as author_creator_price,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me,
              rp.content as repost_content, rp.created_at as repost_created_at,
              ru.username as repost_author_username, ru.first_name as repost_author_first_name,
              hg.name as hangout_group_name, hg.avatar_url as hangout_group_avatar
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       LEFT JOIN social_posts rp ON sp.repost_of_id = rp.id
       LEFT JOIN users ru ON rp.user_id = ru.id
       LEFT JOIN hangout_groups hg ON sp.hangout_group_id = hg.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL
         AND (sp.hangout_group_id IS NULL OR hg.feed_visibility = 'public')
         ${cursorClause}
         AND sp.user_id != ALL($${blockedParamIdx}::text[])
       ORDER BY sp.id DESC
       LIMIT $2`,
      params
    );
    let posts = sanitizePostRows(rows);
    if (viewerTier !== undefined) {
      posts = await CreatorService.filterFeedExclusivePosts(posts, userId, viewerTier);
    }
    // Apply content_tier blurring based on viewer tier (H-01, H-08)
    if (viewerTier !== undefined) {
      posts = SocialPostService._applyContentTierBlur(posts, viewerTier, isAdmin);
    }
    const page = posts.slice(0, lim);
    const nextCursor = posts.length > lim ? String(page[page.length - 1].id) : null;

    // Pin latest promoted post at top of first page only (no cursor = first page)
    if (!cursorId) {
      const pinnedIds = new Set(page.filter(p => p.is_promoted).map(p => p.id));
      const { rows: promotedRows } = await query(
        `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
                sp.source_channel,
                sp.reply_to_id, sp.repost_of_id,
                sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.created_at,
                sp.is_promoted, sp.promoted_link, sp.promoted_link_label, sp.promoted_thumbnail,
                COALESCE(sp.content_tier, 'free') as content_tier,
                u.id as author_id, u.username as author_username,
                u.first_name as author_first_name, u.photo_file_id as author_photo,
                u.creator_status as author_creator_status, u.creator_type as author_creator_type,
                u.creator_verified as author_creator_verified, u.creator_price_usd as author_creator_price,
                EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me,
                NULL as repost_content, NULL as repost_created_at,
                NULL as repost_author_username, NULL as repost_author_first_name
         FROM social_posts sp
         JOIN users u ON sp.user_id = u.id
         WHERE sp.is_promoted = true AND sp.is_deleted = false
           AND sp.user_id != ALL($2::text[])
         ORDER BY sp.id DESC
         LIMIT 1`,
        [userId, blockedParam]
      );
      if (promotedRows.length > 0) {
        let promoted = sanitizePostRows(promotedRows)[0];
        // Apply the same tier gate as the rest of the feed (CRIT-01)
        [promoted] = SocialPostService._applyContentTierBlur([promoted], viewerTier, isAdmin);
        // Remove duplicate if it already appears in the page
        const filtered = pinnedIds.has(promoted.id)
          ? page.filter(p => p.id !== promoted.id)
          : page;
        return { posts: [promoted, ...filtered], nextCursor };
      }
    }

    return { posts: page, nextCursor };
  }

  /**
   * Blur posts whose content_tier exceeds the viewer's tier.
   * Blurred posts retain metadata but have content and media_url set to null,
   * and gain a `content_locked: true` flag so the frontend can render a paywall.
   * Tier hierarchy: free < member < PRIME
   *
   * @param {Array}   posts       - Array of post rows
   * @param {string}  viewerTier  - Viewer's subscription tier string
   * @param {boolean} isAdmin     - When true, bypass all tier blurring (H-08 fix)
   */
  static _applyContentTierBlur(posts, viewerTier, isAdmin = false) {
    // Admins can see all content regardless of tier (H-08: tier string never equals 'admin')
    if (isAdmin) {
      return posts.map(post => ({ ...post, content_locked: false }));
    }

    const normalizedViewer = (viewerTier || 'free').toLowerCase();
    // Determine which content tiers the viewer can see in full
    const allowedTiers = new Set(['free']);
    if (normalizedViewer === 'member') {
      allowedTiers.add('member');
    } else if (normalizedViewer === 'prime') {
      allowedTiers.add('member');
      allowedTiers.add('prime');
      allowedTiers.add('PRIME');
    }

    return posts.map(post => {
      const postTier = (post.content_tier || 'free').toLowerCase();
      const isAllowed = allowedTiers.has(post.content_tier) || allowedTiers.has(postTier);
      if (isAllowed) {
        return { ...post, content_locked: false };
      }
      // Blur: keep metadata, null out content and media, set content_locked flag
      return {
        id: post.id,
        author_id: post.author_id,
        author_username: post.author_username,
        author_first_name: post.author_first_name,
        author_photo: post.author_photo,
        created_at: post.created_at,
        likes_count: post.likes_count,
        reposts_count: post.reposts_count,
        replies_count: post.replies_count,
        content_tier: post.content_tier,
        reply_to_id: post.reply_to_id,
        repost_of_id: post.repost_of_id,
        is_wof: post.is_wof,
        liked_by_me: post.liked_by_me,
        blurred: true,
        content_locked: true,
        content: null,
        media_url: null,
        media_type: null,
        media_urls: null,
      };
    });
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
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
              sp.source_channel,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_wof, sp.created_at,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              u.city as author_city, u.country as author_country,
              false as liked_by_me,
              rp.content as repost_content, rp.created_at as repost_created_at,
              ru.username as repost_author_username, ru.first_name as repost_author_first_name
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       LEFT JOIN social_posts rp ON sp.repost_of_id = rp.id
       LEFT JOIN users ru ON rp.user_id = ru.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL AND sp.is_exclusive = false
       ORDER BY sp.id DESC
       LIMIT $1`,
      [lim]
    );
    return { posts: sanitizePostRows(rows) };
  }

  // ── Wall of Fame Feed ───────────────────────────────────────────────────────

  /**
   * Paginated WoF sub-feed for the Social page (/api/webapp/social/wof-feed).
   * Same pattern as getFeed but filters WHERE is_wof = true.
   *
   * @param {number}   userId     - Authenticated viewer's user ID
   * @param {string}   cursor     - Opaque cursor for pagination
   * @param {number}   limit      - Page size (max 50)
   * @param {number[]} blockedIds - User IDs the viewer has blocked (C-08)
   */
  static async getWofFeed(userId, cursor, limit = 20, blockedIds = [], viewerTier, isAdmin = false) {
    const lim = Math.min(Number(limit) || 20, 50);
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const blockedParam = blockedIds.length > 0 ? blockedIds.map(Number) : [];

    // Param order: $1=userId, $2=lim, [$3=cursorId], $N=blockedParam
    const params = [userId, lim];
    if (cursorId) params.push(cursorId);
    params.push(blockedParam);
    const blockedParamIdx = params.length;
    const cursorClause = cursorId ? `AND sp.id < $3` : '';

    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
              sp.source_channel,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_shareable, sp.is_wof, sp.created_at,
              COALESCE(sp.content_tier, 'free') as content_tier,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              u.city as author_city, u.country as author_country,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL AND sp.is_wof = true AND sp.is_exclusive = false
         ${cursorClause}
         AND sp.user_id != ALL($${blockedParamIdx}::text[])
       ORDER BY sp.id DESC
       LIMIT $2`,
      params
    );
    let posts = sanitizePostRows(rows);
    // Apply content_tier blurring so PRIME-gated WoF posts are locked for non-PRIME viewers (HIGH-03)
    if (viewerTier !== undefined) {
      posts = SocialPostService._applyContentTierBlur(posts, viewerTier, isAdmin);
    }
    const nextCursor = rows.length === lim ? String(rows[rows.length - 1].id) : null;
    return { posts, nextCursor };
  }

  // ── Hashtag Feed ──────────────────────────────────────────────────────────

  /**
   * Paginated feed filtered by a single hashtag present in post content.
   * Uses a case-insensitive word-boundary match so #pnp does not match #pnplive.
   *
   * @param {number}   userId     - Authenticated viewer's user ID (for liked_by_me)
   * @param {string}   tag        - Hashtag without the leading # character
   * @param {string}   cursor     - Opaque pagination cursor (last seen post id)
   * @param {number}   limit      - Page size (max 50)
   * @param {string}   viewerTier - Viewer's current access tier
   * @param {boolean}  isAdmin    - True for admin/superadmin roles
   * @param {number[]} blockedIds - IDs the viewer has blocked
   */
  static async getHashtagFeed(userId, tag, cursor, limit = 20, viewerTier, isAdmin = false, blockedIds = []) {
    if (!tag || typeof tag !== 'string') return { posts: [], nextCursor: null };
    // Sanitize: only allow word chars + accented letters, 1-64 chars
    const cleanTag = tag.replace(/[^a-zA-Z0-9_\u00C0-\u024F]/g, '').slice(0, 64);
    if (!cleanTag) return { posts: [], nextCursor: null };

    const lim = Math.min(Number(limit) || 20, 50);
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const blockedParam = blockedIds.length > 0 ? blockedIds.map(Number) : [];

    // Param order: $1=userId, $2=pattern, $3=lim, [$4=cursorId], $N=blockedParam
    const params = [userId, `#${cleanTag}`, lim];
    if (cursorId) params.push(cursorId);
    params.push(blockedParam);
    const blockedParamIdx = params.length;
    const cursorClause = cursorId ? `AND sp.id < $4` : '';

    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
              sp.source_channel, sp.hangout_group_id,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.created_at,
              sp.is_promoted, sp.promoted_link, sp.promoted_link_label, sp.promoted_thumbnail,
              COALESCE(sp.content_tier, 'free') as content_tier,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              u.city as author_city, u.country as author_country,
              u.creator_status as author_creator_status, u.creator_type as author_creator_type,
              u.creator_verified as author_creator_verified, u.creator_price_usd as author_creator_price,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me,
              rp.content as repost_content, rp.created_at as repost_created_at,
              ru.username as repost_author_username, ru.first_name as repost_author_first_name,
              hg.name as hangout_group_name, hg.avatar_url as hangout_group_avatar
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       LEFT JOIN social_posts rp ON sp.repost_of_id = rp.id
       LEFT JOIN users ru ON rp.user_id = ru.id
       LEFT JOIN hangout_groups hg ON sp.hangout_group_id = hg.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL
         AND sp.content ILIKE '%' || $2 || '%'
         AND (sp.hangout_group_id IS NULL OR hg.feed_visibility = 'public')
         ${cursorClause}
         AND sp.user_id != ALL($${blockedParamIdx}::text[])
       ORDER BY sp.id DESC
       LIMIT $3`,
      params
    );
    let posts = sanitizePostRows(rows);
    if (viewerTier !== undefined) {
      posts = await CreatorService.filterFeedExclusivePosts(posts, userId, viewerTier);
      posts = SocialPostService._applyContentTierBlur(posts, viewerTier, isAdmin);
    }
    const nextCursor = rows.length === lim ? String(rows[rows.length - 1].id) : null;
    return { posts, nextCursor };
  }

  // ── Hangout Feed ─────────────────────────────────────────────────────────

  /**
   * Paginated feed scoped to a specific hangout group.
   * Only returns posts where hangout_group_id matches.
   */
  static async getHangoutFeed(hangoutGroupId, userId, cursor, limit = 20, viewerTier, isAdmin = false, blockedIds = []) {
    const lim = Math.min(Number(limit) || 20, 50);
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const blockedParam = blockedIds.length > 0 ? blockedIds.map(Number) : [];

    const params = [userId, hangoutGroupId, lim];
    if (cursorId) params.push(cursorId);
    params.push(blockedParam);
    const blockedParamIdx = params.length;
    const cursorClause = cursorId ? `AND sp.id < $4` : '';

    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
              sp.source_channel, sp.hangout_group_id, sp.source_message_id,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.created_at,
              COALESCE(sp.content_tier, 'free') as content_tier,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              u.city as author_city, u.country as author_country,
              u.creator_status as author_creator_status, u.creator_type as author_creator_type,
              u.creator_verified as author_creator_verified, u.creator_price_usd as author_creator_price,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me,
              rp.content as repost_content, rp.created_at as repost_created_at,
              ru.username as repost_author_username, ru.first_name as repost_author_first_name
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       LEFT JOIN social_posts rp ON sp.repost_of_id = rp.id
       LEFT JOIN users ru ON rp.user_id = ru.id
       WHERE sp.is_deleted = false AND sp.reply_to_id IS NULL
         AND sp.hangout_group_id = $2
         ${cursorClause}
         AND sp.user_id != ALL($${blockedParamIdx}::text[])
       ORDER BY sp.id DESC
       LIMIT $3`,
      params
    );
    let posts = sanitizePostRows(rows);
    if (viewerTier !== undefined) {
      posts = SocialPostService._applyContentTierBlur(posts, viewerTier, isAdmin);
    }
    const nextCursor = posts.length === lim ? String(posts[posts.length - 1].id) : null;
    return { posts, nextCursor };
  }

  // ── Wall ──────────────────────────────────────────────────────────────────

  /**
   * @param {number}   userId      - Profile owner's user ID
   * @param {number}   viewerId    - Authenticated viewer's user ID
   * @param {string}   cursor      - Opaque cursor for pagination
   * @param {number}   limit       - Page size (max 50)
   * @param {string}   viewerTier  - Viewer's subscription tier ('free'|'member'|'prime')
   * @param {boolean}  isAdmin     - True when viewer has admin/superadmin role (H-08)
   * @param {number[]} blockedIds  - User IDs the viewer has blocked (C-08)
   */
  static async getWall(userId, viewerId, cursor, limit = 20, viewerTier, isAdmin = false, blockedIds = []) {
    const lim = Math.min(Number(limit) || 20, 50);
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    const blockedParam = blockedIds.length > 0 ? blockedIds.map(Number) : [];

    // Param order: $1=viewerId, $2=userId, $3=lim, [$4=cursorId], $N=blockedParam
    const params = [viewerId, userId, lim];
    if (cursorId) params.push(cursorId);
    params.push(blockedParam);
    const blockedParamIdx = params.length;
    const cursorClause = cursorId ? `AND sp.id < $4` : '';

    const [postsRes, profileRes] = await Promise.all([
      query(
        `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
                sp.source_channel,
                sp.reply_to_id, sp.repost_of_id,
                sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.created_at,
                COALESCE(sp.content_tier, 'free') as content_tier,
                u.id as author_id, u.username as author_username,
                u.first_name as author_first_name, u.photo_file_id as author_photo,
                u.city as author_city, u.country as author_country,
                EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me
         FROM social_posts sp
         JOIN users u ON sp.user_id = u.id
         WHERE sp.is_deleted = false AND sp.user_id = $2 AND sp.reply_to_id IS NULL
           ${cursorClause}
           AND sp.user_id != ALL($${blockedParamIdx}::text[])
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

    let posts = sanitizePostRows(postsRes.rows);
    // Filter exclusive creator posts the viewer hasn't subscribed to (mirrors getFeed behaviour)
    if (viewerTier !== undefined) {
      posts = await CreatorService.filterFeedExclusivePosts(posts, viewerId, viewerTier);
    }
    // Apply content_tier blurring so exclusive posts are locked for non-PRIME viewers (H-03, H-08)
    if (viewerTier !== undefined) {
      posts = SocialPostService._applyContentTierBlur(posts, viewerTier, isAdmin);
    }

    const nextCursor = posts.length === lim ? String(posts[posts.length - 1].id) : null;
    return { profile, posts, nextCursor };
  }

  // ── Create Post ───────────────────────────────────────────────────────────

  static async createPost(userId, content, mediaUrl, mediaType, replyToId, repostOfId, isWof = false, isExclusive = false, isShareable = true, videoThumbnailUrl = null, videoTitle = null, videoDescription = null, hangoutGroupId = null, sourceMessageId = null) {
    const contentTier = isExclusive ? 'PRIME' : 'free';
    const { rows } = await query(
      `INSERT INTO social_posts (user_id, content, media_url, media_type, reply_to_id, repost_of_id, is_wof, is_exclusive, is_shareable, video_thumbnail_url, content_tier, video_title, video_description, hangout_group_id, source_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, content, media_url, media_type, video_thumbnail_url, video_title, video_description, reply_to_id, repost_of_id,
                 likes_count, reposts_count, replies_count, is_wof, is_exclusive, is_shareable, content_tier, created_at, hangout_group_id, source_message_id`,
      [userId, content, mediaUrl, mediaType, replyToId || null, repostOfId || null, isWof, isExclusive, isShareable, videoThumbnailUrl || null, contentTier, videoTitle || null, videoDescription || null, hangoutGroupId || null, sourceMessageId || null]
    );
    const post = rows[0];

    if (replyToId) {
      await query('UPDATE social_posts SET replies_count = replies_count + 1 WHERE id = $1 AND is_deleted = false', [replyToId]);
    }
    if (repostOfId) {
      await query('UPDATE social_posts SET reposts_count = reposts_count + 1 WHERE id = $1 AND is_deleted = false', [repostOfId]);
    }

    return post;
  }

  /**
   * Auto-drop a hangout chat message to the hangout feed.
   * Only syncs messages that are "feed-worthy":
   *   - Text content >= 50 chars  OR  has media attached
   *   - Not a reply (conversational noise)
   *   - Group's feed_visibility is not 'ghost'
   *   - Not already dropped (source_message_id unique constraint)
   *
   * @param {Object}  msg      - The chat_messages row (from INSERT RETURNING)
   * @param {number}  groupId  - Hangout group ID
   * @param {Object}  io       - Socket.IO instance (optional, for real-time broadcast)
   * @returns {Object|null}    - The created post, or null if skipped
   */
  static async autoDropToFeed(msg, groupId, io) {
    try {
      if (!msg || !groupId) return null;

      // Skip replies — they're conversational, not feed-worthy
      if (msg.reply_to_id) return null;

      const hasMedia = !!msg.media_url;
      const textLength = (msg.content || '').trim().length;

      // Only sync meaningful messages: 50+ chars or has media
      if (!hasMedia && textLength < 50) return null;

      // Check feed_visibility
      const { rows: groupRows } = await query(
        'SELECT feed_visibility, name FROM hangout_groups WHERE id = $1',
        [groupId]
      );
      if (!groupRows.length || groupRows[0].feed_visibility === 'ghost') return null;

      // Check not already dropped (avoids unique constraint violation)
      const { rows: existing } = await query(
        'SELECT id FROM social_posts WHERE source_message_id = $1',
        [msg.id]
      );
      if (existing.length) return null;

      // Create the feed post
      const post = await SocialPostService.createPost(
        msg.user_id,
        msg.content || '',
        msg.media_url || null,
        msg.media_type || null,
        null, null, false, false, true,
        msg.media_thumb_url || null,
        null, null,
        groupId,
        msg.id  // source_message_id
      );

      // Broadcast to hangout feed room
      if (io && post) {
        const fullPost = {
          ...post,
          author_id: msg.user_id,
          author_username: msg.username || '',
          author_first_name: msg.first_name || '',
          author_photo: msg.photo_url || null,
          liked_by_me: false,
          hangout_group_id: groupId,
          hangout_group_name: groupRows[0].name,
        };
        io.to(`hangout:${groupId}`).emit('hangout:feed:new_post', fullPost);
      }

      return post;
    } catch (err) {
      // Log but don't throw — auto-drop is non-critical
      logger.error('autoDropToFeed error', { messageId: msg?.id, groupId, error: err.message });
      return null;
    }
  }

  /**
   * Insert a post migrated/mirrored from a Telegram channel.
   * Accepts a custom created_at and telegram_message_id for deduplication.
   * Returns the new row, or null if it already existed (ON CONFLICT).
   */
  static async createMigratedPost(userId, content, mediaUrl, mediaType, telegramMessageId, sourceChannel, originalDate) {
    const { rows } = await query(
      `INSERT INTO social_posts
         (user_id, content, media_url, media_type, telegram_message_id, source_channel,
          is_wof, is_exclusive, is_shareable, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, false, true, $7, $7)
       ON CONFLICT (telegram_message_id) WHERE telegram_message_id IS NOT NULL DO NOTHING
       RETURNING id, content, media_url, media_type, telegram_message_id, source_channel, created_at`,
      [userId, content || '', mediaUrl || null, mediaType || null, telegramMessageId, sourceChannel, originalDate]
    );
    return rows[0] || null;
  }

  // ── Toggle Like ───────────────────────────────────────────────────────────

  static async toggleLike(postId, userId) {
    const { rows } = await query(
      `WITH del AS (
        DELETE FROM social_post_likes WHERE post_id=$1 AND user_id=$2 RETURNING post_id
      ),
      ins AS (
        INSERT INTO social_post_likes (post_id, user_id) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM del) ON CONFLICT DO NOTHING RETURNING post_id
      )
      UPDATE social_posts SET likes_count = CASE
        WHEN (SELECT COUNT(*) FROM ins) > 0 THEN likes_count + 1
        WHEN (SELECT COUNT(*) FROM del) > 0 THEN GREATEST(0, likes_count - 1)
        ELSE likes_count
      END WHERE id = $1 AND is_deleted = false
      RETURNING (SELECT COUNT(*) FROM ins) > 0 AS liked, likes_count`,
      [postId, userId]
    );
    if (!rows[0]) return { liked: false, likes_count: 0 };
    return { liked: rows[0].liked ?? false, likes_count: rows[0].likes_count };
  }

  // ── Delete Post ───────────────────────────────────────────────────────────

  static async deletePost(postId, userId, isAdmin = false) {
    if (isAdmin) {
      const { rows, rowCount } = await query(
        'UPDATE social_posts SET is_deleted=true, updated_at=NOW() WHERE id=$1 RETURNING reply_to_id, repost_of_id',
        [postId]
      );
      if (rowCount > 0) {
        await MediaCleanupService.deletePostMedia(postId);
        const { reply_to_id, repost_of_id } = rows[0];
        if (reply_to_id) {
          await query('UPDATE social_posts SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = $1', [reply_to_id]);
        }
        if (repost_of_id) {
          await query('UPDATE social_posts SET reposts_count = GREATEST(reposts_count - 1, 0) WHERE id = $1', [repost_of_id]);
        }
      }
      return rowCount > 0;
    }
    const { rows, rowCount } = await query(
      'UPDATE social_posts SET is_deleted=true WHERE id=$1 AND user_id=$2 RETURNING reply_to_id, repost_of_id',
      [postId, userId]
    );
    if (rowCount > 0) {
      await MediaCleanupService.deletePostMedia(postId);
      const { reply_to_id, repost_of_id } = rows[0];
      if (reply_to_id) {
        await query('UPDATE social_posts SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = $1', [reply_to_id]);
      }
      if (repost_of_id) {
        await query('UPDATE social_posts SET reposts_count = GREATEST(reposts_count - 1, 0) WHERE id = $1', [repost_of_id]);
      }
    }
    return rowCount > 0;
  }

  // ── Delete WoF Post (user requesting removal of their own WoF content) ────

  static async deleteWofPost(postId, userId) {
    const { rowCount } = await query(
      'UPDATE social_posts SET is_deleted=true, updated_at=NOW() WHERE id=$1 AND user_id=$2 AND is_wof=true',
      [postId, userId]
    );
    if (rowCount > 0) await MediaCleanupService.deletePostMedia(postId);
    return rowCount > 0;
  }

  // ── Replies ───────────────────────────────────────────────────────────────

  static async getReplies(postId, viewerId, cursor) {
    const cursorId = cursor ? parseInt(cursor, 10) : null;
    // Fetch limit + 1 so we can detect "more available" without a second
    // round trip. The extra row is sliced off before returning.
    const lim = 20;
    // CRIT-2 FIX: Exclude replies from users the viewer has blocked and from
    // users who have blocked the viewer, using the users.blocked text[] column.
    // $1 = viewerId, $2 = postId, $3 (optional) = cursorId
    const params = cursorId ? [viewerId, postId, cursorId] : [viewerId, postId];
    const { rows } = await query(
      `SELECT sp.id, sp.content, sp.likes_count, sp.replies_count, sp.created_at,
              u.id as author_id, u.username as author_username,
              u.first_name as author_first_name, u.photo_file_id as author_photo,
              EXISTS(SELECT 1 FROM social_post_likes l WHERE l.post_id=sp.id AND l.user_id=$1) as liked_by_me
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       -- Exclude replies where the viewer has blocked the reply author
       LEFT JOIN users viewer ON viewer.id = $1::text
       WHERE sp.reply_to_id = $2 AND sp.is_deleted = false
         -- Filter: viewer has not blocked the reply author
         AND NOT COALESCE(viewer.blocked @> ARRAY[u.id::text], false)
         -- Filter: reply author has not blocked the viewer
         AND NOT COALESCE(u.blocked @> ARRAY[$1::text], false)
         ${cursorId ? 'AND sp.id > $3' : ''}
       ORDER BY sp.id ASC LIMIT ${lim + 1}`,
      params
    );
    const page = rows.slice(0, lim);
    const nextCursor = rows.length > lim ? String(page[page.length - 1].id) : null;
    return { replies: sanitizePostRows(page), nextCursor };
  }

  // ── Public Profile ────────────────────────────────────────────────────────

  static async getPublicProfile(userId, viewerId, cursor, limit = 20, viewerTier, isAdmin = false) {
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

    const [postsRes, profileRes, postCountRes, performerRes] = await Promise.all([
      query(
        `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url, sp.video_title, sp.video_description,
                sp.source_channel, sp.channel_id,
                sp.reply_to_id, sp.repost_of_id,
                sp.likes_count, sp.reposts_count, sp.replies_count, sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.created_at,
                COALESCE(sp.content_tier, 'free') as content_tier,
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
                created_at, privacy, date_of_birth, city, country,
                creator_status, creator_type, creator_price_usd, creator_verified, creator_featured, creator_subscriber_count
         FROM users WHERE id = $1`,
        [userId]
      ),
      query(
        'SELECT COUNT(*)::int as count FROM social_posts WHERE user_id = $1 AND is_deleted = false AND reply_to_id IS NULL',
        [userId]
      ),
      query(
        `SELECT id, is_available, base_price, total_calls, total_rating, rating_count, availability_message
         FROM performers WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
      ),
    ]);

    const profile = profileRes.rows[0] || null;
    if (profile) profile.photo_file_id = isValidPhotoUrl(profile.photo_file_id) ? profile.photo_file_id : null;

    // --- PRIVACY SETTINGS ENFORCEMENT ---
    // Only apply to third-party viewers (not the profile owner themselves).
    if (profile && String(viewerId) !== String(userId)) {
      const privacy = (typeof profile.privacy === 'object' && profile.privacy !== null)
        ? profile.privacy
        : {};
      if (privacy.showLocation === false) {
        profile.location_name = null;
        profile.location_lat = null;
        profile.location_lng = null;
      }
      if (privacy.showBio === false) {
        profile.bio = null;
      }
      if (privacy.showInterests === false) {
        profile.interests = null;
      }
      if (privacy.showDob === false) {
        profile.date_of_birth = null;
      }
    }

    let posts = sanitizePostRows(postsRes.rows).map(p => ({
      ...p,
      liked_by_me: viewerId ? p.liked_by_me : false,
    }));

    if (viewerTier) {
      posts = await CreatorService.filterFeedExclusivePosts(posts, viewerId, viewerTier);
    }
    // Apply content_tier blurring for PRIME-gated posts (CRIT-02)
    if (viewerTier !== undefined) {
      posts = SocialPostService._applyContentTierBlur(posts, viewerTier, isAdmin);
    }

    const nextCursor = posts.length === lim ? String(posts[posts.length - 1].id) : null;
    const postCount = postCountRes.rows[0]?.count || 0;
    const performerData = performerRes.rows[0] || null;

    return { profile, posts, nextCursor, postCount, performerData };
  }

  // ── Wall of Fame: Leaderboard ─────────────────────────────────────────────

  /**
   * Returns the top N WoF contributors ranked by total likes on their WoF posts.
   */
  static async getWofLeaderboard(limit = 10) {
    const lim = Math.min(Number(limit) || 10, 50);
    const { rows } = await query(
      `SELECT u.id, u.username, u.first_name, u.photo_file_id,
              COUNT(sp.id)::int AS total_posts,
              COALESCE(SUM(sp.likes_count), 0)::int AS total_likes
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       WHERE sp.is_wof = true AND sp.is_deleted = false
       GROUP BY u.id, u.username, u.first_name, u.photo_file_id
       ORDER BY total_likes DESC, total_posts DESC
       LIMIT $1`,
      [lim]
    );
    return rows.map(r => ({
      ...r,
      photo_file_id: isValidPhotoUrl(r.photo_file_id) ? r.photo_file_id : null,
    }));
  }

  // ── Wall of Fame: Stats ───────────────────────────────────────────────────

  /**
   * Aggregate WoF statistics: total posts, total likes, unique contributors.
   */
  static async getWofStats() {
    const { rows } = await query(
      `SELECT
         COUNT(*)::int AS total_posts,
         COALESCE(SUM(likes_count), 0)::int AS total_likes,
         COUNT(DISTINCT user_id)::int AS unique_contributors
       FROM social_posts
       WHERE is_wof = true AND is_deleted = false`
    );
    return rows[0] || { total_posts: 0, total_likes: 0, unique_contributors: 0 };
  }

  // ── Wall of Fame: Admin Flag / Unflag ─────────────────────────────────────

  /** Admin: mark an existing post as WoF. Returns post id or null. */
  static async adminFlagWof(postId) {
    const { rows } = await query(
      'UPDATE social_posts SET is_wof=true, updated_at=NOW() WHERE id=$1 AND is_deleted=false RETURNING id',
      [postId]
    );
    return rows[0]?.id || null;
  }

  /** Admin: remove WoF flag without deleting the post. Returns post id or null. */
  static async adminUnflagWof(postId) {
    const { rows } = await query(
      'UPDATE social_posts SET is_wof=false, updated_at=NOW() WHERE id=$1 AND is_deleted=false RETURNING id',
      [postId]
    );
    return rows[0]?.id || null;
  }

  // ── Admin List Posts ──────────────────────────────────────────────────────

  static async adminListPosts(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [result, countResult] = await Promise.all([
      query(
        `SELECT p.id, p.user_id, p.content, p.media_url, p.media_type,
                p.likes_count, p.replies_count, p.created_at,
                u.username, u.first_name, u.photo_file_id
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
