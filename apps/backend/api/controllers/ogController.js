'use strict';

/**
 * OG (Open Graph) Controller
 *
 * renderOG  — serves a minimal HTML page with og: + twitter: meta tags for crawlers,
 *             plus a meta-refresh redirect to the real SPA URL for browsers.
 *
 * renderPlayer — serves an embeddable video player page used as twitter:player.
 */

const { query } = require('../../config/postgres');
const ogService = require('../../services/ogService');
const logger = require('../../utils/logger');

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

  // /v/:postId (video preview for X sharing)
  m = strippedPath.match(/^\/v\/(\d+)\/?$/);
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

const renderVideoPreview = async (req, res) => {
  const postId = parseInt(req.params.postId, 10);

  try {
    const og = Number.isFinite(postId) && postId > 0
      ? await ogService.getVideoPreviewOG(postId)
      : ogService.getDefaultOG();

    // Fetch the post so we can render an appropriate body:
    //   video → <video>, image → <img>, text → styled content card
    let videoUrl = null;
    let thumbUrl = null;
    let imageUrl = null;
    let mediaKind = null; // 'video' | 'image' | 'text'
    let postContent = '';
    let postAuthor = '';
    if (Number.isFinite(postId) && postId > 0) {
      const result = await query(
        `SELECT sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url,
                sp.content, sp.video_title, sp.video_description,
                u.username, u.first_name
         FROM social_posts sp
         JOIN users u ON sp.user_id = u.id
         WHERE sp.id = $1
           AND sp.is_deleted = false
           AND (sp.is_exclusive IS NOT TRUE)
         LIMIT 1`,
        [postId]
      );
      const post = result.rows[0];
      if (post) {
        const absolutize = (u) => (u && u.startsWith('http') ? u : (u ? `${APP_BASE_URL}${u}` : null));

        // Resolve a fallback media URL from media_urls jsonb if media_url is missing
        let firstMedia = null;
        if (post.media_urls) {
          try {
            const parsed = typeof post.media_urls === 'string' ? JSON.parse(post.media_urls) : post.media_urls;
            firstMedia = Array.isArray(parsed) ? parsed[0] : null;
          } catch (_) { /* ignore */ }
        }
        const rawMedia = post.media_url || firstMedia?.url || null;
        const rawThumb = post.video_thumbnail_url || firstMedia?.thumbnail_url || null;

        postAuthor = post.first_name || post.username || '';
        postContent = (post.video_description || post.content || '').trim();

        if (post.media_type === 'video' && rawMedia) {
          mediaKind = 'video';
          videoUrl = absolutize(rawMedia);
          thumbUrl = absolutize(rawThumb);
        } else if (rawMedia) {
          // image (or any non-video media) — render as <img>
          mediaKind = 'image';
          imageUrl = absolutize(rawMedia);
        } else {
          mediaKind = 'text';
        }
      }
    }

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

    // Escape post content for HTML body usage (newlines → <br>)
    const escHtml = (s = '') => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const contentHtml = escHtml(postContent).replace(/\n/g, '<br />');

    let mediaPlayerHtml;
    if (mediaKind === 'video' && videoUrl) {
      mediaPlayerHtml = `<video
          src="${escAttr(videoUrl)}"
          controls
          playsinline
          preload="metadata"
          ${thumbUrl ? `poster="${escAttr(thumbUrl)}"` : ''}
          style="width:100%;max-height:70vh;border-radius:16px;background:#000;object-fit:contain;"
        >Your browser does not support the video tag.</video>`;
    } else if (mediaKind === 'image' && imageUrl) {
      mediaPlayerHtml = `<img
          src="${escAttr(imageUrl)}"
          alt="${escAttr(og.title)}"
          style="width:100%;max-height:70vh;border-radius:16px;background:#000;object-fit:contain;display:block;"
        />`;
    } else if (mediaKind === 'text' && postContent) {
      mediaPlayerHtml = `<div style="width:100%;padding:32px 24px;border-radius:16px;background:linear-gradient(135deg,rgba(212,0,122,0.15),rgba(230,145,56,0.12));color:#fff;font-size:18px;line-height:1.5;text-align:center;min-height:200px;display:flex;align-items:center;justify-content:center;">
          <p>${contentHtml}</p>
        </div>`;
    } else {
      mediaPlayerHtml = `<div style="width:100%;height:300px;border-radius:16px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;">
          <p style="color:#8E8E93;font-size:14px;">Post not available</p>
        </div>`;
    }

    // Body title / caption (falls back to og.title which is already author-aware)
    const bodyTitle = postAuthor
      ? `${postAuthor} on PNPtv!`
      : 'Clouds &amp; Rush Network';
    const bodyCaption = postContent && mediaKind !== 'text'
      ? escHtml(postContent.length > 220 ? postContent.slice(0, 219) + '\u2026' : postContent)
      : 'Exclusive community content. Stream, connect, and vibe with the hottest PNP creators.';

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
  <meta property="og:url" content="${escAttr(og.url || `${APP_BASE_URL}/v/${postId}`)}" />
  <meta property="og:type" content="${escAttr(og.type || 'website')}" />${videoMeta}

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="${escAttr(og.twitterCard || 'summary_large_image')}" />
  <meta name="twitter:site" content="@pnptv" />
  <meta name="twitter:title" content="${escAttr(og.title)}" />
  <meta name="twitter:description" content="${escAttr(og.description)}" />
  <meta name="twitter:image" content="${escAttr(og.image)}" />${playerMeta}

  <!-- Canonical -->
  <link rel="canonical" href="${escAttr(og.url || `${APP_BASE_URL}/v/${postId}`)}" />

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
      ${mediaPlayerHtml}
    </div>

    <div class="info">
      <h1>${bodyTitle}</h1>
      <p>${bodyCaption}</p>
    </div>

    <a href="${APP_BASE_URL}" class="cta-btn">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
      </svg>
      Get PNPtv!
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

module.exports = { renderOG, renderPlayer, renderVideoPreview };
