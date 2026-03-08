'use strict';

/**
 * OG (Open Graph) Controller
 *
 * renderOG  — serves a minimal HTML page with og: + twitter: meta tags for crawlers,
 *             plus a meta-refresh redirect to the real SPA URL for browsers.
 *
 * renderPlayer — serves an embeddable video player page used as twitter:player.
 */

const { query } = require('../../../config/postgres');
const ogService = require('../../../services/ogService');
const logger = require('../../../utils/logger');

const APP_BASE_URL = 'https://app.pnptv.app';

// Known CMS page slugs that map to /page/:slug OG lookup
const CMS_SLUGS = new Set([
  'terms',
  'privacy',
  'cookies',
  'community-guidelines',
  'content-policy',
  'refunds',
  'subscriptions',
  'creator-terms',
  'dmca',
  'safety',
  'contact',
]);

/**
 * Escape a string for safe inclusion inside an HTML attribute value.
 */
const escAttr = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

/**
 * Build the minimal HTML document returned to crawlers.
 */
const buildOgHtml = (og, canonicalPath) => {
  const redirectUrl = `${APP_BASE_URL}${canonicalPath}`;

  const playerMeta = og.playerUrl
    ? `
  <meta name="twitter:player" content="${escAttr(og.playerUrl)}" />
  <meta name="twitter:player:width" content="${escAttr(String(og.videoWidth || 1280))}" />
  <meta name="twitter:player:height" content="${escAttr(String(og.videoHeight || 720))}" />`
    : '';

  const videoMeta = og.video
    ? `
  <meta property="og:video" content="${escAttr(og.video)}" />
  <meta property="og:video:secure_url" content="${escAttr(og.video)}" />
  <meta property="og:video:type" content="${escAttr(og.videoType || 'video/mp4')}" />
  <meta property="og:video:width" content="${escAttr(String(og.videoWidth || 1280))}" />
  <meta property="og:video:height" content="${escAttr(String(og.videoHeight || 720))}" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escAttr(og.title)}</title>
  <meta http-equiv="refresh" content="0;url=${escAttr(redirectUrl)}" />

  <!-- Open Graph -->
  <meta property="og:site_name" content="PNPtv!" />
  <meta property="og:title" content="${escAttr(og.title)}" />
  <meta property="og:description" content="${escAttr(og.description)}" />
  <meta property="og:image" content="${escAttr(og.image)}" />
  <meta property="og:image:width" content="${escAttr(String(og.imageWidth || 1200))}" />
  <meta property="og:image:height" content="${escAttr(String(og.imageHeight || 630))}" />
  <meta property="og:url" content="${escAttr(og.url || redirectUrl)}" />
  <meta property="og:type" content="${escAttr(og.type || 'website')}" />${videoMeta}

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="${escAttr(og.twitterCard || 'summary_large_image')}" />
  <meta name="twitter:site" content="@pnptv" />
  <meta name="twitter:title" content="${escAttr(og.title)}" />
  <meta name="twitter:description" content="${escAttr(og.description)}" />
  <meta name="twitter:image" content="${escAttr(og.image)}" />${playerMeta}

  <!-- Canonical -->
  <link rel="canonical" href="${escAttr(og.url || redirectUrl)}" />
</head>
<body>
  <p>Redirecting to <a href="${escAttr(redirectUrl)}">${escAttr(og.title)}</a>…</p>
</body>
</html>`;
};

/**
 * Resolve which OG data fetcher to call based on the path after the /og prefix.
 * Returns { ogData, canonicalPath }.
 */
const resolveOgData = async (strippedPath) => {
  // /social/post/:id
  let m = strippedPath.match(/^\/social\/post\/(\d+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getPostOG(m[1]),
      canonicalPath: `/social/post/${m[1]}`,
    };
  }

  // /profile/:userId (numeric id or UUID)
  m = strippedPath.match(/^\/profile\/([^/]+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getProfileOG(m[1]),
      canonicalPath: `/profile/${m[1]}`,
    };
  }

  // /u/:username
  m = strippedPath.match(/^\/u\/([^/]+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getProfileOG(m[1]),
      canonicalPath: `/u/${m[1]}`,
    };
  }

  // /live/:streamId
  m = strippedPath.match(/^\/live\/([^/]+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getStreamOG(m[1]),
      canonicalPath: `/live/${m[1]}`,
    };
  }

  // /stream/:id
  m = strippedPath.match(/^\/stream\/([^/]+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getStreamOG(m[1]),
      canonicalPath: `/stream/${m[1]}`,
    };
  }

  // /page/:slug
  m = strippedPath.match(/^\/page\/([^/]+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getCmsPageOG(m[1]),
      canonicalPath: `/page/${m[1]}`,
    };
  }

  // Known top-level CMS slugs: /terms, /privacy, /cookies, etc.
  const slug = strippedPath.replace(/^\//, '').replace(/\/$/, '');
  if (CMS_SLUGS.has(slug)) {
    return {
      ogData: await ogService.getCmsPageOG(slug),
      canonicalPath: `/${slug}`,
    };
  }

  // Default fallback
  return {
    ogData: ogService.getDefaultOG(),
    canonicalPath: strippedPath || '/',
  };
};

// ─── renderOG ─────────────────────────────────────────────────────────────────

const renderOG = async (req, res) => {
  try {
    // req.path is e.g. /og/social/post/123 — strip the /og prefix
    const rawPath = req.path || '/';
    const strippedPath = rawPath.replace(/^\/og/, '') || '/';

    const { ogData, canonicalPath } = await resolveOgData(strippedPath);

    const html = buildOgHtml(ogData, canonicalPath);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Allow crawlers to cache for 5 minutes; CDN can cache for 10 minutes
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.setHeader('X-Robots-Tag', 'noindex'); // OG pages are not canonical — avoid duplicate indexing
    return res.send(html);
  } catch (err) {
    logger.error('ogController.renderOG error', { path: req.path, error: err.message });
    const html = buildOgHtml(ogService.getDefaultOG(), '/');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
};

// ─── renderPlayer ─────────────────────────────────────────────────────────────

const renderPlayer = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);

  try {
    let videoUrl = null;

    if (Number.isFinite(postId) && postId > 0) {
      const result = await query(
        `SELECT media_url, media_type
         FROM social_posts
         WHERE id = $1
           AND is_deleted = false
           AND (is_exclusive IS NOT TRUE)
         LIMIT 1`,
        [postId]
      );

      const post = result.rows[0];
      if (post && post.media_type === 'video' && post.media_url) {
        // Ensure absolute URL
        videoUrl = post.media_url.startsWith('http')
          ? post.media_url
          : `${APP_BASE_URL}${post.media_url}`;
      }
    }

    // X-Frame-Options must be absent or ALLOWALL for Twitter player card embedding
    // We deliberately omit the header here.
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');

    if (!videoUrl) {
      return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Video not found — PNPtv!</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; display: flex; align-items: center; justify-content: center; }
    p { color: #fff; font-family: sans-serif; font-size: 14px; }
  </style>
</head>
<body><p>Video not available.</p></body>
</html>`);
    }

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PNPtv! Video Player</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    }
  </style>
</head>
<body>
  <video
    src="${escAttr(videoUrl)}"
    controls
    autoplay
    playsinline
    preload="metadata"
  >
    Your browser does not support the video tag.
  </video>
</body>
</html>`);
  } catch (err) {
    logger.error('ogController.renderPlayer error', { postId, error: err.message });
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Error — PNPtv!</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; display: flex; align-items: center; justify-content: center; }
    p { color: #fff; font-family: sans-serif; font-size: 14px; }
  </style>
</head>
<body><p>An error occurred loading this video.</p></body>
</html>`);
  }
};

module.exports = { renderOG, renderPlayer };
