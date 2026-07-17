/**
 * CristinaFeedService — Automated social feed posts from Cristina AI
 *
 * Responsibilities:
 * 1. Scheduled posts: wellness tips, feature tutorials, PRIME promos (cron-driven)
 * 2. Creator shoutouts: when creators post media or go live (event-driven)
 *
 * All posts are created as user 'pnptv' (8552451957) and broadcast via Socket.IO.
 */

const logger = require('../utils/logger');
const { query } = require('../config/postgres');
const GrokService = require('./grokService');
const SocialPostService = require('./socialPostService');
const socketSingleton = require('./socketSingleton');

const CRISTINA_USER_ID = '8552451957';

// ── Redis helpers for deduplication & rotation ───────────────────────────────

let _redis = null;
function getRedis() {
  if (!_redis) {
    try {
      const { getRedis: gr } = require('../config/redis');
      _redis = gr();
    } catch { /* noop */ }
  }
  return _redis;
}

const REDIS_PREFIX = 'cristina:feed:';
const CREATOR_SHOUTOUT_TTL = 6 * 3600;   // 1 shoutout per creator per 6 hours
const LAST_CATEGORY_TTL = 86400;          // track last category for 24h

// ── Post categories & prompts ────────────────────────────────────────────────

const CATEGORIES = {
  wellness: {
    label: 'wellness',
    prompts: [
      'Write a short wellness reminder for a queer PNP community. Focus on hydration, rest, or personal boundaries. Keep it caring and non-judgmental.',
      'Write a short harm reduction tip for the PNP community. Mention things like staying hydrated, taking breaks, checking in on friends, or knowing your limits. Warm and supportive tone.',
      'Write a brief mental health check-in message for the community. Remind them they are not alone, encourage self-care, or suggest reaching out to a friend. Empowering, never preachy.',
      'Write a short safety reminder: protecting privacy online, verifying profiles before meetups, or reporting toxic behavior. Supportive, practical tone.',
      'Write a wellness tip about rest and recovery. Remind the community that taking breaks is strength, not weakness. Warm and compassionate.',
    ],
  },
  feature_tutorial: {
    label: 'feature_tutorial',
    prompts: [
      'Write a short tip teaching users how to use the Nearby feature on pnptv.app to find people close to them. Mention they can see who is online nearby and connect instantly.',
      'Write a short tip explaining how Hangouts work on pnptv.app — users can create or join group video calls, chat rooms, and meet new people in real time.',
      'Write a short tip about PNP Television Live — users can watch live streams, tip performers, and even go live themselves if they are creators.',
      'Write a short tip about the Social feed on pnptv.app — users can post text, photos, and videos, follow other members, and interact with the community.',
      'Write a short tip about Videorama on pnptv.app — curated video playlists and VOD content from creators. Mention PRIME members get access to exclusive content.',
      'Write a short tip about DMs (direct messages) on pnptv.app — users can send private messages, share media, and connect one-on-one. PRIME members get unlimited DMs.',
      'Write a short tip about the Radio feature on pnptv.app — community radio with curated playlists playing 24/7. Perfect background vibes.',
      'Write a short tip about following creators on pnptv.app — users can follow their favorite creators, get notified when they go live, and support them with tips.',
      'Write a short tip about improving your profile on pnptv.app — add a photo, write a bio, set your location to appear in Nearby, and verify your profile for more visibility.',
      'Write a short tip about Hangout video calls on pnptv.app — how to start a private or public video call with other members. Great for meeting new people face to face.',
    ],
  },
  prime_promo: {
    label: 'prime_promo',
    prompts: [
      'Write a short promotional post inviting users to upgrade to PRIME membership on pnptv.app. Mention key benefits: unlimited DMs, exclusive content, priority in Nearby, access to all live streams. Price: $25.00/month. Enthusiastic but not pushy.',
      'Write a short post highlighting what PRIME members get on pnptv.app: exclusive creator content, unlimited video calls, priority placement, ad-free experience. Invite them to upgrade. $25.00/month or Lifetime at $100.',
      'Write a short post about the Lifetime membership deal on pnptv.app — one payment of $100, access forever. Mention it includes all PRIME benefits for life. Create urgency without being aggressive.',
      'Write a short post comparing FREE vs PRIME on pnptv.app. FREE gets you basic access. PRIME unlocks everything: exclusive streams, unlimited DMs, Hangout priority, creator content. Worth the upgrade at $25.00/month.',
      'Write a short promotional post about PRIME membership. Focus on the community aspect — being PRIME means supporting creators and getting closer to the community. $25.00/month, cancel anytime.',
    ],
  },
};

// ── Prompt injection sanitization ────────────────────────────────────────────

const INJECTION_PHRASES = [
  /ignore\s+previous/gi,
  /system\s*:/gi,
  /you\s+are\s+now/gi,
  /new\s+instructions/gi,
  /disregard\s+all/gi,
  /forget\s+everything/gi,
];

/**
 * Sanitize a user-supplied string before interpolating it into a Grok prompt.
 * - Strips control characters
 * - Collapses newlines to spaces
 * - Truncates to 80 chars
 * - Removes known prompt-injection phrases
 */
function sanitizeForPrompt(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str
    .replace(/[\x00-\x1F\x7F]/g, ' ')  // strip control chars
    .replace(/\n|\r/g, ' ')             // collapse newlines
    .trim()
    .slice(0, 80);                       // truncate
  for (const pattern of INJECTION_PHRASES) {
    s = s.replace(pattern, '');
  }
  return s.trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pick a random prompt from a category, avoiding the last-used one if possible.
 */
async function pickPrompt(category) {
  const prompts = CATEGORIES[category]?.prompts;
  if (!prompts?.length) return null;

  const redis = getRedis();
  const lastKey = `${REDIS_PREFIX}last_prompt:${category}`;
  let lastIndex = -1;

  if (redis) {
    try {
      const val = await redis.get(lastKey);
      if (val !== null) lastIndex = parseInt(val, 10);
    } catch { /* noop */ }
  }

  // Pick a random index different from last used
  let idx;
  if (prompts.length === 1) {
    idx = 0;
  } else {
    do { idx = Math.floor(Math.random() * prompts.length); } while (idx === lastIndex);
  }

  if (redis) {
    try { await redis.set(lastKey, String(idx), 'EX', LAST_CATEGORY_TTL); } catch { /* noop */ }
  }

  return prompts[idx];
}

/**
 * Generate content via Grok using Cristina persona, then create a social post.
 */
async function generateAndPost(prompt, language = 'bilingual') {
  const lang = language === 'bilingual' ? (Math.random() > 0.5 ? 'English' : 'Spanish') : language;

  const content = await GrokService.chat({
    mode: 'post',
    language: lang,
    prompt,
    personaType: 'cristina',
    maxTokens: 400,
  });

  if (!content || content.trim().length < 10) {
    logger.warn('CristinaFeed: Grok returned empty/short content, skipping post');
    return null;
  }

  const post = await SocialPostService.createPost(
    CRISTINA_USER_ID,
    content.trim(),
    null,   // mediaUrl
    null,   // mediaType
    null,   // replyToId
    null,   // repostOfId
    false,  // isWof
    false,  // isExclusive
    true,   // isShareable
  );

  // Broadcast via Socket.IO
  broadcastPost(post);

  logger.info('CristinaFeed: posted scheduled content', {
    postId: post.id,
    contentLength: content.length,
    language: lang,
  });

  return post;
}

/**
 * Broadcast a Cristina post to all connected clients via Socket.IO.
 */
function broadcastPost(post) {
  const io = socketSingleton.get();
  if (!io || !post) return;

  const fullPost = {
    ...post,
    author_id: CRISTINA_USER_ID,
    author_username: 'cristina',
    author_first_name: 'Cristina AI',
    author_photo: null,  // Frontend shows gradient fallback
    liked_by_me: false,
  };

  io.emit('feed:new_post', fullPost);
}

// ── Scheduled post methods (called from cron.js) ─────────────────────────────

/**
 * Post a wellness tip to the social feed.
 */
// Disabled — social feed posts by Cristina AI removed per admin request.
async function postWellness() {}

/**
 * Post a feature tutorial to the social feed.
 */
async function postFeatureTutorial() {}

/**
 * Post a PRIME upgrade promo to the social feed.
 */
async function postPrimePromo() {}

// ── Event-driven: Creator shoutouts ──────────────────────────────────────────

/**
 * Shout out a creator who just posted new media content.
 * Rate-limited to 1 shoutout per creator per 6 hours.
 *
 * @param {string} creatorId     - Creator's user ID
 * @param {string} creatorName   - Display name or username
 * @param {string} mediaType     - 'image' or 'video'
 * @param {number} postId        - The post ID for linking
 */
async function shoutoutNewContent(_creatorId, _creatorName, _mediaType, _postId) {}

/**
 * Announce that a creator just went live.
 * Rate-limited to 1 announcement per creator per 6 hours.
 * Creates a branded feed post from @pnptv and cross-posts to X (@PNPTelevision).
 *
 * @param {string} creatorId    - Creator's user ID
 * @param {string} creatorName  - Display name or username
 * @param {string} channelRef   - Restreamer channel ref (e.g. "pnptv-santino")
 */
async function announceLiveStream(creatorId, creatorName, channelRef) {
  if (!channelRef) return;
  const redis = getRedis();
  const dedupKey = `${REDIS_PREFIX}live:${creatorId}`;

  if (redis) {
    const already = await redis.get(dedupKey).catch(() => null);
    if (already) {
      logger.info('cristinaFeed: announceLiveStream skipped (dedup)', { creatorId });
      return;
    }
  }

  try {
    const fs = require('fs');
    const path = require('path');
    const ogService = require('./ogService');
    const XPostService = require('./xPostService');
    const db = require('../utils/db');

    const APP_BASE_URL = process.env.APP_PUBLIC_URL || 'https://pnptv.app';
    const SNAPSHOTS_DIR = '/app/public/uploads/live-snapshots';
    const displayName = creatorName || 'Creator';
    const streamUrl = `${APP_BASE_URL}/live/${channelRef}`;

    // Build branded composite image
    const branded = await ogService.fetchAndBrandStreamSnapshot(channelRef, displayName);

    // Save to public uploads so it can be served as social post media and X image
    let mediaUrl = null;
    if (branded) {
      if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
      const filename = `live-${channelRef}-${Date.now()}.jpg`;
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, filename), branded);
      mediaUrl = `/uploads/live-snapshots/${filename}`;
    }

    // Create in-app feed post from @pnptv system account
    const postContent = `🔴 ${displayName} is LIVE on PNPtv!\nReal Models. Real Clouds. 🌫️\n\n👉 ${streamUrl}`;
    const post = await SocialPostService.createPost(
      CRISTINA_USER_ID,
      postContent,
      mediaUrl,
      mediaUrl ? 'image' : null,
      null, null, false, false, true,
      null, null, null, null, null,
      'social'
    );

    // Broadcast to all connected clients
    const io = socketSingleton.getIO();
    if (io && post) {
      io.emit('feed:new_post', { post });
    }

    // Cross-post to X via PNPTelevision account
    try {
      const xResult = await db.query(
        `SELECT account_id, handle, encrypted_access_token, encrypted_access_token_secret,
                oauth_version, consumer_key_ref, encrypted_refresh_token, token_expires_at,
                is_active, x_user_id
           FROM x_accounts
          WHERE LOWER(handle) = 'pnptelevision' AND is_active = true
          LIMIT 1`
      );
      if (xResult.rows.length) {
        const xAccount = xResult.rows[0];
        const xText = `🔴 ${displayName} is LIVE on PNPtv!\nReal Models. Real Clouds. 🌫️🔞\n\n${streamUrl}`;
        const xImageUrl = mediaUrl ? `${APP_BASE_URL}${mediaUrl}` : null;
        await XPostService.postToX(xAccount, xText, xImageUrl);
        logger.info('cristinaFeed: X cross-post sent', { channelRef, handle: xAccount.handle });
      }
    } catch (xErr) {
      logger.warn('cristinaFeed: X cross-post failed', { channelRef, error: xErr.message });
    }

    // Set dedup key (6h)
    if (redis) {
      await redis.set(dedupKey, '1', 'EX', CREATOR_SHOUTOUT_TTL).catch(() => {});
    }

    logger.info('cristinaFeed: announceLiveStream complete', {
      creatorId, channelRef, postId: post?.id, hasImage: !!branded,
    });
  } catch (err) {
    logger.error('cristinaFeed: announceLiveStream error', { creatorId, channelRef, error: err.message });
  }
}

// ── In-call presence: disabled ───────────────────────────────────────────────
// All Cristina in-call activity (tips, replies, video suggestions) disabled
// per admin request. cristinaStartSession in socketHandlers.js is also no-op.
async function generateCallWellnessTip() { return null; }
async function generateCallReply() { return null; }
async function pickCallVideoSuggestion() { return null; }

module.exports = {
  postWellness,
  postFeatureTutorial,
  postPrimePromo,
  shoutoutNewContent,
  announceLiveStream,
  generateCallWellnessTip,
  generateCallReply,
  pickCallVideoSuggestion,
  CRISTINA_USER_ID,
};
