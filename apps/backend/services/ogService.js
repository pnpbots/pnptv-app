'use strict';

/**
 * OG (Open Graph) Service
 * Fetches content metadata for Open Graph / Twitter Card meta tags.
 * All returned image/video URLs are absolute (https://app.pnptv.app prefix).
 * Results are cached in Redis with appropriate TTLs.
 */

const axios = require('axios');
const { query } = require('../config/postgres');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

const APP_BASE_URL = 'https://app.pnptv.app';
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://directus:8055';

// Cache TTLs in seconds
const TTL_POST = 300;       // 5 min
const TTL_PROFILE = 300;    // 5 min
const TTL_STREAM = 60;      // 1 min — live data changes fast
const TTL_CMS = 1800;       // 30 min

/**
 * Ensure a URL is absolute. Relative paths (starting with /) get the app base prepended.
 */
const toAbsoluteUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${APP_BASE_URL}${url}`;
  return null;
};

/**
 * Truncate text to a maximum length, appending ellipsis if needed.
 */
const truncate = (text, max = 200) => {
  if (!text || typeof text !== 'string') return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}\u2026`;
};

/**
 * Read from Redis cache. Returns null on miss or error.
 */
const cacheGet = async (key) => {
  try {
    const redis = getRedis();
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('ogService cacheGet error', { key, error: err.message });
    return null;
  }
};

/**
 * Write to Redis cache. Silently fails on error.
 */
const cacheSet = async (key, value, ttl) => {
  try {
    const redis = getRedis();
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    logger.warn('ogService cacheSet error', { key, error: err.message });
  }
};

// ─── Default site OG ────────────────────────────────────────────────────────

const getDefaultOG = () => ({
  title: 'PNPtv! — Clouds & Rush Network',
  description: 'The queer PNP community streaming platform. Live streams, social posts, community hangouts, and creator content.',
  image: `${APP_BASE_URL}/og-default.png`,
  imageWidth: 1200,
  imageHeight: 630,
  url: APP_BASE_URL,
  type: 'website',
  video: null,
  videoType: null,
  videoWidth: null,
  videoHeight: null,
  twitterCard: 'summary_large_image',
  playerUrl: null,
});

// ─── Post OG ────────────────────────────────────────────────────────────────

const getPostOG = async (postId) => {
  const id = parseInt(postId, 10);
  if (!Number.isFinite(id) || id <= 0) return getDefaultOG();

  const cacheKey = `og:post:${id}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const result = await query(
      `SELECT
         sp.id,
         sp.content,
         sp.media_url,
         sp.media_type,
         sp.media_urls,
         sp.video_thumbnail_url,
         u.username,
         u.first_name,
         u.photo_file_id AS author_photo
       FROM social_posts sp
       JOIN users u ON sp.user_id = u.id
       WHERE sp.id = $1
         AND sp.is_deleted = false
         AND (sp.is_exclusive IS NOT TRUE)`,
      [id]
    );

    if (!result.rows.length) return getDefaultOG();

    const post = result.rows[0];
    const authorName = post.first_name || post.username || 'PNPtv! user';
    const contentSnippet = truncate(post.content || '', 200);
    const title = `${authorName} on PNPtv!`;
    const description = contentSnippet || `View this post by ${authorName} on PNPtv!`;

    const isVideo = post.media_type === 'video';
    const isImage = post.media_type === 'image';

    // Resolve media — prefer video_thumbnail_url for poster, media_url for playback
    const rawMediaUrl = post.media_url || null;
    const rawThumbUrl = post.video_thumbnail_url || post.media_url || null;

    // For multi-media posts, use first item if media_url is empty
    let parsedMediaUrls = null;
    if (post.media_urls) {
      try {
        parsedMediaUrls = typeof post.media_urls === 'string'
          ? JSON.parse(post.media_urls)
          : post.media_urls;
      } catch (_) { /* ignore parse errors */ }
    }
    const firstMedia = parsedMediaUrls?.[0];
    const effectiveMediaUrl = rawMediaUrl || firstMedia?.url || null;
    const effectiveThumbUrl = rawThumbUrl || firstMedia?.url || null;

    const absoluteMediaUrl = toAbsoluteUrl(effectiveMediaUrl);
    const absoluteThumbUrl = toAbsoluteUrl(effectiveThumbUrl);
    const absoluteAuthorPhoto = toAbsoluteUrl(post.author_photo);

    let ogData;
    if (isVideo && absoluteMediaUrl) {
      ogData = {
        title,
        description,
        image: absoluteThumbUrl || absoluteAuthorPhoto || `${APP_BASE_URL}/og-default.png`,
        imageWidth: 1280,
        imageHeight: 720,
        url: `${APP_BASE_URL}/social/post/${id}`,
        type: 'video.other',
        video: absoluteMediaUrl,
        videoType: 'video/mp4',
        videoWidth: 1280,
        videoHeight: 720,
        twitterCard: 'player',
        playerUrl: `${APP_BASE_URL.replace('app.', 'api.')}/og/player/${id}`,
      };
    } else if (isImage && absoluteMediaUrl) {
      ogData = {
        title,
        description,
        image: absoluteMediaUrl,
        imageWidth: 1200,
        imageHeight: 630,
        url: `${APP_BASE_URL}/social/post/${id}`,
        type: 'article',
        video: null,
        videoType: null,
        videoWidth: null,
        videoHeight: null,
        twitterCard: 'summary_large_image',
        playerUrl: null,
      };
    } else {
      ogData = {
        title,
        description,
        image: absoluteAuthorPhoto || `${APP_BASE_URL}/og-default.png`,
        imageWidth: 1200,
        imageHeight: 630,
        url: `${APP_BASE_URL}/social/post/${id}`,
        type: 'article',
        video: null,
        videoType: null,
        videoWidth: null,
        videoHeight: null,
        twitterCard: 'summary',
        playerUrl: null,
      };
    }

    await cacheSet(cacheKey, ogData, TTL_POST);
    return ogData;
  } catch (err) {
    logger.error('ogService.getPostOG error', { postId, error: err.message });
    return getDefaultOG();
  }
};

// ─── Profile OG ─────────────────────────────────────────────────────────────

const getProfileOG = async (userId) => {
  if (!userId) return getDefaultOG();

  const cacheKey = `og:profile:${String(userId).toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Support numeric ID, UUID, or username
    const isNumericOrUuid = /^\d+$/.test(userId)
      || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);

    let result;
    if (isNumericOrUuid) {
      result = await query(
        `SELECT id, username, first_name, bio, photo_file_id FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
    } else {
      result = await query(
        `SELECT id, username, first_name, bio, photo_file_id FROM users WHERE lower(username) = lower($1) LIMIT 1`,
        [userId]
      );
    }

    if (!result.rows.length) return getDefaultOG();

    const user = result.rows[0];
    const displayName = user.first_name || user.username || 'PNPtv! user';
    const handle = user.username ? `@${user.username}` : '';
    const title = handle ? `${displayName} (${handle}) on PNPtv!` : `${displayName} on PNPtv!`;
    const description = truncate(user.bio || `Check out ${displayName}'s profile on PNPtv! — Clouds & Rush Network`, 200);
    const image = toAbsoluteUrl(user.photo_file_id) || `${APP_BASE_URL}/og-default.png`;

    const resolvedId = user.username || user.id;
    const ogData = {
      title,
      description,
      image,
      imageWidth: 400,
      imageHeight: 400,
      url: `${APP_BASE_URL}/profile/${user.id}`,
      type: 'profile',
      video: null,
      videoType: null,
      videoWidth: null,
      videoHeight: null,
      twitterCard: 'summary',
      playerUrl: null,
    };

    await cacheSet(cacheKey, ogData, TTL_PROFILE);
    return ogData;
  } catch (err) {
    logger.error('ogService.getProfileOG error', { userId, error: err.message });
    return getDefaultOG();
  }
};

// ─── Stream OG ───────────────────────────────────────────────────────────────

const getStreamOG = async (streamId) => {
  if (!streamId) return getDefaultOG();

  const cacheKey = `og:stream:${streamId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Query users table for assigned live channel (Restreamer architecture)
    const result = await query(
      `SELECT
         u.id,
         u.username,
         u.first_name,
         u.photo_file_id,
         u.live_channel
       FROM users u
       WHERE u.id = $1 OR u.username = $1 OR u.live_channel = $1
       LIMIT 1`,
      [streamId]
    );

    const RESTREAMER_PUBLIC_URL = process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app';

    if (result.rows.length) {
      const user = result.rows[0];
      const displayName = user.first_name || user.username || 'PNPtv! Live';
      const channelRef = user.live_channel;
      const streamUrl = channelRef
        ? `${RESTREAMER_PUBLIC_URL}/memfs/${channelRef}.m3u8`
        : null;
      const thumbUrl = channelRef
        ? `${RESTREAMER_PUBLIC_URL}/memfs/${channelRef}.jpg`
        : toAbsoluteUrl(user.photo_file_id) || `${APP_BASE_URL}/og-default.png`;

      const ogData = {
        title: `${displayName} is LIVE on PNPtv!`,
        description: `Watch ${displayName} stream live on PNPtv! — Clouds & Rush Network`,
        image: thumbUrl,
        imageWidth: 1280,
        imageHeight: 720,
        url: `${APP_BASE_URL}/live/${streamId}`,
        type: 'video.other',
        video: streamUrl,
        videoType: streamUrl ? 'application/x-mpegURL' : null,
        videoWidth: 1280,
        videoHeight: 720,
        twitterCard: streamUrl ? 'player' : 'summary_large_image',
        playerUrl: streamUrl ? `${APP_BASE_URL.replace('app.', 'api.')}/og/player/${streamId}` : null,
      };

      await cacheSet(cacheKey, ogData, TTL_STREAM);
      return ogData;
    }

    // Fallback: generic live stream OG
    const ogData = {
      title: 'Live Stream on PNPtv!',
      description: 'Watch live streams on PNPtv! — Clouds & Rush Network',
      image: `${APP_BASE_URL}/og-default.png`,
      imageWidth: 1280,
      imageHeight: 720,
      url: `${APP_BASE_URL}/live/${streamId}`,
      type: 'video.other',
      video: null,
      videoType: null,
      videoWidth: 1280,
      videoHeight: 720,
      twitterCard: 'summary_large_image',
      playerUrl: null,
    };

    await cacheSet(cacheKey, ogData, TTL_STREAM);
    return ogData;
  } catch (err) {
    logger.error('ogService.getStreamOG error', { streamId, error: err.message });
    return getDefaultOG();
  }
};

// ─── CMS Page OG ─────────────────────────────────────────────────────────────

const getCmsPageOG = async (slug) => {
  if (!slug) return getDefaultOG();

  const cacheKey = `og:cms:${slug}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const directusUrl = `${DIRECTUS_URL}/items/pages?filter[slug][_eq]=${encodeURIComponent(slug)}&fields=title,description,content,image&limit=1`;
    const response = await axios.get(directusUrl, { timeout: 5000 });
    const page = response.data?.data?.[0];

    if (!page) {
      // Return a reasonable default for known legal pages
      const pageTitle = slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const ogData = {
        title: `${pageTitle} — PNPtv!`,
        description: `${pageTitle} for PNPtv! — Clouds & Rush Network`,
        image: `${APP_BASE_URL}/og-default.png`,
        imageWidth: 1200,
        imageHeight: 630,
        url: `${APP_BASE_URL}/${slug}`,
        type: 'website',
        video: null,
        videoType: null,
        videoWidth: null,
        videoHeight: null,
        twitterCard: 'summary',
        playerUrl: null,
      };
      await cacheSet(cacheKey, ogData, TTL_CMS);
      return ogData;
    }

    const rawDescription = page.description
      || (page.content ? page.content.replace(/<[^>]+>/g, ' ') : '')
      || '';

    const ogData = {
      title: page.title ? `${page.title} — PNPtv!` : 'PNPtv! — Clouds & Rush Network',
      description: truncate(rawDescription, 200) || 'PNPtv! — Clouds & Rush Network',
      image: toAbsoluteUrl(page.image) || `${APP_BASE_URL}/og-default.png`,
      imageWidth: 1200,
      imageHeight: 630,
      url: `${APP_BASE_URL}/${slug}`,
      type: 'website',
      video: null,
      videoType: null,
      videoWidth: null,
      videoHeight: null,
      twitterCard: 'summary',
      playerUrl: null,
    };

    await cacheSet(cacheKey, ogData, TTL_CMS);
    return ogData;
  } catch (err) {
    logger.error('ogService.getCmsPageOG error', { slug, error: err.message });
    // Non-fatal — return a generic page OG
    const pageTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      title: `${pageTitle} — PNPtv!`,
      description: `${pageTitle} for PNPtv! — Clouds & Rush Network`,
      image: `${APP_BASE_URL}/og-default.png`,
      imageWidth: 1200,
      imageHeight: 630,
      url: `${APP_BASE_URL}/${slug}`,
      type: 'website',
      video: null,
      videoType: null,
      videoWidth: null,
      videoHeight: null,
      twitterCard: 'summary',
      playerUrl: null,
    };
  }
};

module.exports = {
  getPostOG,
  getProfileOG,
  getStreamOG,
  getCmsPageOG,
  getDefaultOG,
};
