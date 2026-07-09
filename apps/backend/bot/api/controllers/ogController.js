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

const APP_BASE_URL = 'https://pnptv.app';

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
  <meta property="og:image:alt" content="${escAttr(og.imageAlt || og.title)}" />
  <meta property="og:image:secure_url" content="${escAttr(og.image)}" />
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

  // /creator/:username (creator profile page)
  m = strippedPath.match(/^\/creator\/([^/]+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getProfileOG(m[1]),
      canonicalPath: `/creator/${m[1]}`,
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

  // /main-stage  (Main Stage shareable link)
  if (/^\/main-stage\/?$/.test(strippedPath)) {
    return {
      ogData: ogService.getMainStageOG(),
      canonicalPath: '/main-stage',
    };
  }

  // /h/:hangoutId  (shareable hangout link — short alias)
  m = strippedPath.match(/^\/h\/(\d+)\/?$/);
  if (m) {
    return {
      ogData: await ogService.getHangoutOG(m[1]),
      canonicalPath: `/h/${m[1]}`,
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

  // /v/:postId or /v/:postId/:slug (video preview for X sharing — slug is purely cosmetic)
  m = strippedPath.match(/^\/v\/(\d+)(?:\/[^/]*)?\/?$/);
  if (m) {
    return {
      ogData: await ogService.getVideoPreviewOG(m[1]),
      canonicalPath: `/v/${m[1]}`,
    };
  }

  // /channels (directory page)
  if (/^\/channels\/?$/.test(strippedPath)) {
    return {
      ogData: ogService.getChannelsOG(),
      canonicalPath: '/channels',
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

// ─── renderVideoPreview ──────────────────────────────────────────────────────
// Standalone page served at /v/:postId — contains OG tags for X crawlers
// AND a branded video player + CTA for real browsers.

/**
 * Safely escape a string for inline JSON embedded in HTML.
 * Prevents </script> injection and other XSS vectors.
 */
const escJson = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');

const renderVideoPreview = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);

  try {
    const og = Number.isFinite(postId) && postId > 0
      ? await ogService.getVideoPreviewOG(postId)
      : ogService.getDefaultOG();

    // Fetch the actual video URL for the player (og already has thumbnail + media url via service)
    let videoUrl = null;
    let thumbUrl = null;
    if (Number.isFinite(postId) && postId > 0) {
      const result = await query(
        `SELECT media_url, media_type, video_thumbnail_url
         FROM social_posts
         WHERE id = $1
           AND is_deleted = false
           AND (is_exclusive IS NOT TRUE)
         LIMIT 1`,
        [postId]
      );
      const post = result.rows[0];
      if (post && post.media_type === 'video' && post.media_url) {
        videoUrl = post.media_url.startsWith('http')
          ? post.media_url
          : `${APP_BASE_URL}${post.media_url}`;
        thumbUrl = post.video_thumbnail_url
          ? (post.video_thumbnail_url.startsWith('http')
              ? post.video_thumbnail_url
              : `${APP_BASE_URL}${post.video_thumbnail_url}`)
          : null;
      }
    }

    // Canonical URL with slug (og.url already contains it from ogService)
    const canonicalUrl = og.url || `${APP_BASE_URL}/v/${postId}`;

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

    // twitter:creator — only emit when the author has a linked X handle
    const twitterCreatorMeta = og.creatorXHandle
      ? `\n  <meta name="twitter:creator" content="${escAttr(`@${og.creatorXHandle.replace(/^@/, '')}`)}" />`
      : '';

    // og:video:release_date
    const releaseDateMeta = og.createdAt
      ? `\n  <meta property="og:video:release_date" content="${escAttr(og.createdAt)}" />`
      : '';

    // og:video:duration (omit when unknown)
    const durationMeta = og.videoDuration != null && Number.isFinite(og.videoDuration)
      ? `\n  <meta property="og:video:duration" content="${escAttr(String(Math.round(og.videoDuration)))}" />`
      : '';

    // JSON-LD VideoObject / CreativeWork
    const jsonLdObj = {
      '@context': 'https://schema.org',
      '@type': og.video ? 'VideoObject' : 'CreativeWork',
      name: og.title,
      description: og.description,
      thumbnailUrl: og.thumbnailUrl ? [og.thumbnailUrl] : undefined,
      uploadDate: og.createdAt || undefined,
      contentUrl: og.video || undefined,
      embedUrl: og.playerUrl ? `${APP_BASE_URL}/og/player/${postId}` : undefined,
      duration: (og.videoDuration != null && Number.isFinite(og.videoDuration))
        ? `PT${Math.round(og.videoDuration)}S`
        : undefined,
      author: {
        '@type': 'Person',
        name: og.authorName || 'PNPtv! user',
        url: og.authorProfileUrl || APP_BASE_URL,
      },
    };
    // Remove undefined keys for clean JSON
    const jsonLdClean = JSON.parse(JSON.stringify(jsonLdObj));
    const jsonLdScript = `\n  <script type="application/ld+json">${escJson(jsonLdClean)}</script>`;

    const videoPlayerHtml = videoUrl
      ? `<video
          src="${escAttr(videoUrl)}"
          controls
          playsinline
          preload="metadata"
          ${thumbUrl ? `poster="${escAttr(thumbUrl)}"` : ''}
          style="width:100%;max-height:70vh;border-radius:16px;background:#000;object-fit:contain;"
        >Your browser does not support the video tag.</video>`
      : `<div style="width:100%;height:300px;border-radius:16px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;">
          <p style="color:#8E8E93;font-size:14px;">Video not available</p>
        </div>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escAttr(og.title)}</title>
  <meta name="description" content="${escAttr(og.description)}" />

  <!-- Open Graph -->
  <meta property="og:site_name" content="PNPtv!" />
  <meta property="og:title" content="${escAttr(og.title)}" />
  <meta property="og:description" content="${escAttr(og.description)}" />
  <meta property="og:image" content="${escAttr(og.image)}" />
  <meta property="og:image:width" content="${escAttr(String(og.imageWidth || 1200))}" />
  <meta property="og:image:height" content="${escAttr(String(og.imageHeight || 630))}" />
  <meta property="og:url" content="${escAttr(canonicalUrl)}" />
  <meta property="og:type" content="${escAttr(og.type || 'website')}" />${videoMeta}${releaseDateMeta}${durationMeta}

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="${escAttr(og.twitterCard || 'summary_large_image')}" />
  <meta name="twitter:site" content="@pnptv" />${twitterCreatorMeta}
  <meta name="twitter:title" content="${escAttr(og.title)}" />
  <meta name="twitter:description" content="${escAttr(og.description)}" />
  <meta name="twitter:image" content="${escAttr(og.image)}" />${playerMeta}

  <!-- Canonical -->
  <link rel="canonical" href="${escAttr(canonicalUrl)}" />${jsonLdScript}

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; min-height: 100vh;
      background: #0A0A0A;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #fff;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 640px;
      margin: 0 auto;
      padding: 24px 16px 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }
    .logo-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-circle {
      width: 44px; height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #D4007A, #E69138);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .logo-circle img { width: 28px; height: 28px; object-fit: contain; }
    .brand-name {
      font-size: 20px;
      font-weight: 800;
      background: linear-gradient(135deg, #D4007A, #E69138);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .video-wrapper {
      width: 100%;
      border-radius: 16px;
      overflow: hidden;
      background: #000;
    }
    .info {
      text-align: center;
      max-width: 480px;
    }
    .info h1 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
      line-height: 1.3;
    }
    .info p {
      font-size: 14px;
      color: #8E8E93;
      line-height: 1.5;
    }
    .cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 32px;
      border-radius: 14px;
      background: linear-gradient(135deg, #D4007A, #E69138);
      color: #fff;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
      transition: opacity 0.2s, transform 0.2s;
      border: none;
      cursor: pointer;
    }
    .cta-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .cta-btn:active { transform: translateY(0); }
    .cta-btn svg { width: 18px; height: 18px; }
    .footer-text {
      font-size: 12px;
      color: #48484A;
      text-align: center;
    }
    .footer-text a { color: #8E8E93; text-decoration: none; }
    .footer-text a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-row">
      <div class="logo-circle">
        <img src="${APP_BASE_URL}/Logo2-50.png" alt="PNPtv!" />
      </div>
      <span class="brand-name">PNPtv!</span>
    </div>

    <div class="video-wrapper">
      ${videoPlayerHtml}
    </div>

    <div class="info">
      ${og.authorUsername
        ? `<p style="font-size:13px;color:#8E8E93;margin-bottom:6px;"><a href="${escAttr(`${APP_BASE_URL}/profile/${og.authorUsername}`)}" style="color:#5ED1C4;text-decoration:none;font-weight:600;">@${escAttr(og.authorUsername)}</a></p>`
        : (og.authorName ? `<p style="font-size:13px;color:#8E8E93;margin-bottom:6px;">${escAttr(og.authorName)}</p>` : '')}
      <h1>${escAttr(og.title || 'PNPtv!')}</h1>
      ${og.contentSnippet ? `<p>${escAttr(og.contentSnippet)}</p>` : `<p>Watch on PNPtv! — the queer PNP community streaming platform.</p>`}
    </div>

    <a href="${escAttr(og.authorUsername ? `${APP_BASE_URL}/profile/${og.authorUsername}` : APP_BASE_URL)}" class="cta-btn">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
      ${og.authorUsername ? `View @${escAttr(og.authorUsername)}` : 'Join PNPtv!'}
    </a>

    <p class="footer-text">
      <a href="${APP_BASE_URL}/terms">Terms</a> &middot;
      <a href="${APP_BASE_URL}/privacy">Privacy</a> &middot;
      <a href="${APP_BASE_URL}/community-guidelines">Community Guidelines</a>
    </p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    return res.send(html);
  } catch (err) {
    logger.error('ogController.renderVideoPreview error', { postId, error: err.message });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.redirect(APP_BASE_URL);
  }
};

// ─── getOgPreview ─────────────────────────────────────────────────────────────
// JSON endpoint for in-app link preview cards in chat.
// Only resolves internal pnptv.app paths — never fetches external URLs.

const getOgPreview = async (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath || typeof rawPath !== 'string' || rawPath.length > 500) {
      return res.status(400).json({ success: false });
    }
    // Normalise to a leading-slash path
    const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const { ogData } = await resolveOgData(cleanPath);
    if (!ogData) return res.status(404).json({ success: false });
    return res.json({
      success: true,
      title: ogData.title || null,
      description: ogData.description || null,
      image: ogData.image || null,
      url: ogData.url || `${APP_BASE_URL}${cleanPath}`,
      type: ogData.type || 'website',
    });
  } catch (err) {
    logger.error('ogController.getOgPreview error', { error: err.message });
    return res.status(500).json({ success: false });
  }
};

module.exports = { renderOG, renderPlayer, renderVideoPreview, getOgPreview };
