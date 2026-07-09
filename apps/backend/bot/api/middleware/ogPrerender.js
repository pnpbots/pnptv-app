'use strict';

/**
 * OG Prerender Middleware
 *
 * Intercepts requests from social media crawlers (X/Twitter, Facebook, etc.)
 * and serves minimal HTML with dynamic Open Graph meta tags based on the URL.
 * Regular browsers get proxied to the SPA as normal.
 *
 * Supported routes:
 *   /social/post/:postId        → post content + media
 *   /profile/:userId            → user profile
 *   /u/:username                → user profile (short alias)
 *   /creator/:username          → creator profile page
 *   /live/:streamId             → live stream
 *   /v/:postId[/:slug]          → video preview page for X sharing
 *   /channels                   → channels directory
 *   /chat/:groupId              → hangout group
 *   /h/:groupId                 → hangout group (short alias)
 *   /main-stage                 → Main Stage generic card
 *   /main-stage/join/:code      → Main Stage invite card (host name + branded image)
 *   /*                          → default PNPtv card
 */

const { getPool } = require('../../../config/postgres');
const mainStageInviteService = require('../../../services/mainStageInviteService');
const ogService = require('../../../services/ogService');
const logger = require('../../../utils/logger');

const CRAWLER_UA = /Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Pinterest|Googlebot|bingbot/i;
const BASE_URL = process.env.APP_PUBLIC_URL || 'https://pnptv.app';
const DEFAULT_IMAGE = `${BASE_URL}/og-image.png`;
const MAIN_STAGE_IMAGE = `${BASE_URL}/og-main-stage.png`;
const DEFAULT_TITLE = 'PNPtv!';
const DEFAULT_DESC = 'PNPtv! is a private social platform for gay men into the party and play lifestyle.';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderOgHtml({ title, description, image, url, type = 'website', imageWidth, imageHeight, twitterCard }) {
  const safeTitle = escapeHtml(title || DEFAULT_TITLE);
  const safeDesc = escapeHtml(description || DEFAULT_DESC);
  const safeImage = escapeHtml(image || DEFAULT_IMAGE);
  const safeUrl = escapeHtml(url || BASE_URL);
  const safeImageAlt = escapeHtml(title || DEFAULT_TITLE);
  const w = imageWidth || 1200;
  const h = imageHeight || 630;
  const card = twitterCard || 'summary_large_image';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <meta property="og:type" content="${type}" />
  <meta property="og:site_name" content="PNPtv!" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:url" content="${safeUrl}" />
  <meta property="og:image" content="${safeImage}" />
  <meta property="og:image:secure_url" content="${safeImage}" />
  <meta property="og:image:width" content="${w}" />
  <meta property="og:image:height" content="${h}" />
  <meta property="og:image:alt" content="${safeImageAlt}" />
  <meta name="twitter:card" content="${card}" />
  <meta name="twitter:site" content="@pnptv" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${safeImage}" />
  <meta http-equiv="refresh" content="0;url=${safeUrl}" />
</head>
<body><p>Redirecting to <a href="${safeUrl}">${safeTitle}</a>...</p></body>
</html>`;
}

async function getPostOg(postId) {
  try {
    const { rows } = await getPool().query(
      `SELECT sp.content, sp.media_url, sp.media_type,
              u.first_name, u.username
       FROM social_posts sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.id = $1 AND sp.is_deleted = false`,
      [postId]
    );
    if (!rows[0]) return null;
    const post = rows[0];
    const author = post.first_name || post.username || 'Member';
    const preview = post.content
      ? post.content.slice(0, 160) + (post.content.length > 160 ? '...' : '')
      : 'Check out this post on PNPtv!';
    const image = post.media_type === 'image' && post.media_url
      ? `${BASE_URL}${post.media_url}`
      : DEFAULT_IMAGE;
    return {
      title: `${author} on PNPtv!`,
      description: preview,
      image,
      url: `${BASE_URL}/social/post/${postId}`,
      type: 'article',
    };
  } catch (err) {
    logger.warn('OG prerender: post lookup failed', { postId, error: err.message });
    return null;
  }
}

async function getProfileOg(userId) {
  try {
    const { rows } = await getPool().query(
      `SELECT first_name, username, bio, photo_file_id
       FROM users WHERE id = $1 AND is_deleted = false`,
      [userId]
    );
    if (!rows[0]) return null;
    const user = rows[0];
    const handle = user.username || user.first_name || 'member';
    const desc = user.bio
      ? user.bio.slice(0, 160) + (user.bio.length > 160 ? '...' : '')
      : 'PNPtv! Clouds & Slam Network!';
    const image = user.photo_file_id && (user.photo_file_id.startsWith('/') || user.photo_file_id.startsWith('http'))
      ? (user.photo_file_id.startsWith('http') ? user.photo_file_id : `${BASE_URL}${user.photo_file_id}`)
      : DEFAULT_IMAGE;
    return {
      title: `@${handle} — PNPtv! Clouds & Slam Network!`,
      description: desc,
      image,
      url: `${BASE_URL}/profile/${userId}`,
      type: 'profile',
    };
  } catch (err) {
    logger.warn('OG prerender: profile lookup failed', { userId, error: err.message });
    return null;
  }
}

async function getLiveOg(streamId) {
  try {
    const { rows } = await getPool().query(
      `SELECT ls.title, ls.description, u.first_name, u.username
       FROM live_streams ls
       JOIN users u ON u.id = ls.user_id
       WHERE ls.id = $1`,
      [streamId]
    );
    if (!rows[0]) return null;
    const stream = rows[0];
    const streamer = stream.first_name || stream.username || 'Creator';
    return {
      title: stream.title || `${streamer} is live on PNPtv!`,
      description: stream.description || `Watch ${streamer} live now on PNPtv!`,
      image: DEFAULT_IMAGE,
      url: `${BASE_URL}/live/${streamId}`,
      type: 'video.other',
    };
  } catch (err) {
    logger.warn('OG prerender: stream lookup failed', { streamId, error: err.message });
    return null;
  }
}

async function getGroupOg(groupId) {
  try {
    const { rows } = await getPool().query(
      `SELECT name, description, avatar_url, is_public, is_main FROM hangout_groups WHERE id = $1`,
      [groupId]
    );
    if (!rows[0]) return null;
    const group = rows[0];
    if (!group.is_public && !group.is_main) {
      // Private — leak nothing via OG
      return {
        title: 'PNPtv! Hangout',
        description: 'Members-only video hangout on PNPtv!',
        image: DEFAULT_IMAGE,
        url: `${BASE_URL}/chat/${groupId}`,
        type: 'video.other',
      };
    }
    const image = group.avatar_url
      ? (group.avatar_url.startsWith('http') ? group.avatar_url : `${BASE_URL}${group.avatar_url}`)
      : DEFAULT_IMAGE;
    const desc = (group.description || `Join the ${group.name} hangout on PNPtv!`).replace(/\s+/g, ' ').trim().slice(0, 280);
    return {
      title: `🎥 ${group.name} — PNPtv! Hangout`,
      description: `${desc} Members only — join at pnptv.app/join.`,
      image,
      url: `${BASE_URL}/h/${groupId}`,
      type: 'video.other',
    };
  } catch (err) {
    logger.warn('OG prerender: group lookup failed', { groupId, error: err.message });
    return null;
  }
}

function getMainStageOg() {
  return {
    title: 'Bye Zoom. Join Main Stage.',
    description: 'Hottest PNP Streaming Party. By PNPtv!',
    image: MAIN_STAGE_IMAGE,
    url: `${BASE_URL}/main-stage`,
    type: 'video.other',
  };
}

async function getMainStageInviteOg(code) {
  try {
    const preview = await mainStageInviteService.previewInvite(code);
    if (!preview || !preview.valid) {
      return {
        title: 'Bye Zoom. Join Main Stage.',
        description: 'Hottest PNP Streaming Party. By PNPtv!',
        image: MAIN_STAGE_IMAGE,
        url: `${BASE_URL}/main-stage/join/${code}`,
        type: 'video.other',
      };
    }
    const host = preview.hostName;
    return {
      title: 'Bye Zoom. Join Main Stage.',
      description: host
        ? `${host} is hosting. Hottest PNP Streaming Party. By PNPtv!`
        : 'Hottest PNP Streaming Party. By PNPtv!',
      image: MAIN_STAGE_IMAGE,
      url: `${BASE_URL}/main-stage/join/${code}`,
      type: 'video.other',
    };
  } catch (err) {
    logger.warn('OG prerender: main-stage invite lookup failed', { code, error: err.message });
    return {
      title: 'Bye Zoom. Join Main Stage.',
      description: 'Hottest PNP Streaming Party. By PNPtv!',
      image: MAIN_STAGE_IMAGE,
      url: `${BASE_URL}/main-stage/join/${code}`,
      type: 'video.other',
    };
  }
}

/**
 * Convert an ogService data object (which may have richer fields) into
 * the shape expected by renderOgHtml. Falls back to defaults on null.
 */
function ogServiceToRenderOg(og, fallbackUrl) {
  if (!og) return { url: fallbackUrl };
  return {
    title: og.title || null,
    description: og.description || null,
    image: og.image || null,
    url: og.url || fallbackUrl,
    type: og.type || 'website',
    imageWidth: og.imageWidth || null,
    imageHeight: og.imageHeight || null,
    twitterCard: og.twitterCard || null,
  };
}

/**
 * Express middleware — mount BEFORE the static file handler.
 * Only intercepts crawler user-agents; regular browsers pass through.
 */
function ogPrerenderMiddleware(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  if (!CRAWLER_UA.test(ua)) return next();

  const path = req.path;

  // Match routes
  const postMatch = path.match(/^\/social\/post\/(\d+)$/);
  const profileMatch = path.match(/^\/profile\/([^/]+)$/);
  const uMatch = path.match(/^\/u\/([^/]+)$/);
  const creatorMatch = path.match(/^\/creator\/([^/]+)$/);
  const liveMatch = path.match(/^\/live\/([^/]+)$/);
  const videoMatch = path.match(/^\/v\/(\d+)(?:\/[^/]*)?\/?$/);
  const chatMatch = path.match(/^\/chat\/(\d+)$/);
  const hMatch = path.match(/^\/h\/(\d+)$/);
  const mainStageInviteMatch = path.match(/^\/main-stage\/join\/([A-Za-z0-9_-]{8,32})$/);
  const mainStageMatch = /^\/main-stage\/?$/.test(path);
  const channelsMatch = /^\/channels\/?$/.test(path);

  let ogPromise;
  if (postMatch) {
    ogPromise = getPostOg(postMatch[1]);
  } else if (profileMatch) {
    ogPromise = getProfileOg(profileMatch[1]);
  } else if (uMatch) {
    // /u/:username — delegate to ogService which supports username lookup
    ogPromise = ogService.getProfileOG(uMatch[1]).then((og) => ogServiceToRenderOg(og, `${BASE_URL}/u/${uMatch[1]}`));
  } else if (creatorMatch) {
    // /creator/:username — creator profile page
    ogPromise = ogService.getProfileOG(creatorMatch[1]).then((og) => ogServiceToRenderOg(og, `${BASE_URL}/creator/${creatorMatch[1]}`));
  } else if (videoMatch) {
    // /v/:postId[/:slug] — video preview page for X sharing
    ogPromise = ogService.getVideoPreviewOG(videoMatch[1]).then((og) => ogServiceToRenderOg(og, `${BASE_URL}/v/${videoMatch[1]}`));
  } else if (channelsMatch) {
    const html = renderOgHtml(ogServiceToRenderOg(ogService.getChannelsOG(), `${BASE_URL}/channels`));
    return res.type('html').send(html);
  } else if (liveMatch) {
    ogPromise = getLiveOg(liveMatch[1]);
  } else if (chatMatch) {
    ogPromise = getGroupOg(chatMatch[1]);
  } else if (hMatch) {
    ogPromise = getGroupOg(hMatch[1]);
  } else if (mainStageInviteMatch) {
    ogPromise = getMainStageInviteOg(mainStageInviteMatch[1]);
  } else if (mainStageMatch) {
    const html = renderOgHtml(getMainStageOg());
    return res.type('html').send(html);
  } else {
    // Default card for any other page
    const html = renderOgHtml({
      url: `${BASE_URL}${path}`,
    });
    return res.type('html').send(html);
  }

  ogPromise
    .then((og) => {
      const html = renderOgHtml(og || { url: `${BASE_URL}${path}` });
      res.type('html').send(html);
    })
    .catch(() => {
      res.type('html').send(renderOgHtml({ url: `${BASE_URL}${path}` }));
    });
}

module.exports = { ogPrerenderMiddleware };
