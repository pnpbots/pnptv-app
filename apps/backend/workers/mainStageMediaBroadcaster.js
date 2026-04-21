'use strict';

/**
 * Main Stage Media Broadcaster
 *
 * Publishes a video or audio source to the LiveKit room `main-stage-prime`
 * using a LiveKit **URL_INPUT** ingress. LiveKit pulls the HTTPS URL
 * server-side and publishes it to the room as the `mainstage-media`
 * participant — no local FFmpeg required.
 *
 * Lifecycle:
 *   - start() is a no-op until an admin calls setMedia(playing=true, src).
 *   - updateSource(src) / setPlaying(bool) manage the ingress lifecycle:
 *       - play + have src   → create ingress pointing at src
 *       - source changes    → delete old, create new
 *       - pause / kind=off  → delete ingress
 *   - Crash recovery: 5s → 5min exponential backoff on ingress create failures.
 *
 * Gate: MAIN_STAGE_MEDIA_ENABLED env var (defaults to 'true').
 *
 * Supported sources: HTTPS URL to a single media file (mp4, m4a, mp3) or an
 * HLS (.m3u8) stream. The controller's `validateMediaSrc()` enforces https://
 * and blocks RFC1918 / loopback / shell metacharacters before we see the URL.
 */

const logger        = require('../utils/logger');
const { getRedis }  = require('../config/redis');

const {
  IngressClient,
  IngressInput,
} = require('livekit-server-sdk');

const ROOM_NAME          = 'main-stage-prime';
const MEDIA_BOT_IDENTITY = 'mainstage-media';
const INGRESS_REDIS_KEY  = 'mainstage:ingress';
const MIN_BACKOFF_MS     = 5_000;
const MAX_BACKOFF_MS     = 5 * 60_000;

// ── Module state ──────────────────────────────────────────────────────────────

let stopping    = false;
let backoffMs   = MIN_BACKOFF_MS;
let currentSrc  = null;
let isPlaying   = false;
let ingressId   = null;
let retryTimer  = null;

// ── Config ────────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    enabled:      String(process.env.MAIN_STAGE_MEDIA_ENABLED ?? 'true').toLowerCase() !== 'false',
    livekitHost:  process.env.LIVEKIT_WS_URL?.replace(/^wss?:\/\//, 'https://') || 'https://livekit.pnptv.app',
    apiKey:       process.env.LIVEKIT_API_KEY,
    apiSecret:    process.env.LIVEKIT_API_SECRET,
  };
}

function getClient() {
  const { livekitHost, apiKey, apiSecret } = getConfig();
  return new IngressClient(livekitHost, apiKey, apiSecret);
}

// ── Ingress lifecycle ─────────────────────────────────────────────────────────

/**
 * Delete all existing URL-pull ingresses for the main-stage room + media-bot
 * identity. Called before creating a new one so multiple ingresses don't
 * stack up and publish overlapping tracks.
 */
async function deleteExistingIngresses() {
  const redis  = getRedis();
  const client = getClient();

  try {
    const list = await client.listIngress({ roomName: ROOM_NAME });
    for (const ing of list) {
      if (ing.participantIdentity !== MEDIA_BOT_IDENTITY) continue;
      try {
        await client.deleteIngress(ing.ingressId);
        logger.info('[MainStageMedia] deleted existing ingress', { ingressId: ing.ingressId });
      } catch (err) {
        logger.warn('[MainStageMedia] failed to delete ingress', { ingressId: ing.ingressId, error: err.message });
      }
    }
  } catch (err) {
    logger.warn('[MainStageMedia] listIngress failed', { error: err.message });
  }

  ingressId = null;
  await redis.del(INGRESS_REDIS_KEY);
}

/**
 * Create a URL_INPUT ingress pointing at `src`. LiveKit pulls the URL and
 * publishes it as the media-bot participant.
 */
async function createUrlIngress(src) {
  const redis  = getRedis();
  const client = getClient();

  const ingress = await client.createIngress(IngressInput.URL_INPUT, {
    name:                `main-stage-media-${Date.now()}`,
    roomName:            ROOM_NAME,
    participantIdentity: MEDIA_BOT_IDENTITY,
    participantName:     'Media Bot',
    url:                 src,
  });

  ingressId = ingress.ingressId;
  await redis.set(
    INGRESS_REDIS_KEY,
    JSON.stringify({ ingressId, src, createdAt: Date.now() }),
    'EX', 86400,
  );

  logger.info('[MainStageMedia] URL ingress created', { ingressId, src: src.slice(0, 80) });
  return ingress;
}

/**
 * Bring the ingress state in line with (isPlaying, currentSrc):
 *   - no src or not playing → ensure no ingress
 *   - playing + src         → ensure an ingress exists pointing at src
 */
async function reconcile() {
  if (stopping) return;
  clearRetry();

  const desired = isPlaying && currentSrc ? 'active' : 'none';

  if (desired === 'none') {
    if (ingressId) await deleteExistingIngresses();
    return;
  }

  // desired === 'active'
  try {
    // Always recreate so a source change is reflected. LiveKit's URL_INPUT
    // doesn't support updating the URL in-place.
    await deleteExistingIngresses();
    await createUrlIngress(currentSrc);
    backoffMs = MIN_BACKOFF_MS;
  } catch (err) {
    logger.error('[MainStageMedia] reconcile failed — will retry', { error: err.message, backoffMs });
    retryTimer = setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      reconcile().catch(() => {});
    }, backoffMs);
  }
}

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load initial state from Redis and reconcile.
 * Called at bot boot from bot/core/bot.js.
 */
async function start() {
  const { enabled, apiKey, apiSecret } = getConfig();
  if (!enabled) {
    logger.info('[MainStageMedia] disabled (MAIN_STAGE_MEDIA_ENABLED=false)');
    return;
  }
  if (!apiKey || !apiSecret) {
    logger.warn('[MainStageMedia] LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured — not starting');
    return;
  }

  stopping  = false;
  backoffMs = MIN_BACKOFF_MS;

  // Read initial state so a bot restart picks up in-progress playback
  try {
    const redis = getRedis();
    const raw   = await redis.get('mainstage:media');
    if (raw) {
      const media = JSON.parse(raw);
      currentSrc = media.src || null;
      isPlaying  = Boolean(media.playing) && media.kind !== 'off';
    }
  } catch (err) {
    logger.warn('[MainStageMedia] failed to read initial state', { error: err.message });
  }

  logger.info('[MainStageMedia] starting', { isPlaying, hasSrc: Boolean(currentSrc) });
  await reconcile();
}

async function stop() {
  stopping = true;
  clearRetry();
  // Best-effort teardown so another instance starting up doesn't see our stale ingress
  try { await deleteExistingIngresses(); } catch (_) {}
  logger.info('[MainStageMedia] stopped');
}

async function restart() {
  clearRetry();
  backoffMs = MIN_BACKOFF_MS;
  if (!stopping) await reconcile();
}

/**
 * Hot-reload source. Triggers ingress delete + recreate if currently playing.
 */
async function updateSource(src) {
  currentSrc = src || null;
  logger.info('[MainStageMedia] source updated', { src: src?.slice(0, 80) });
  await reconcile();
}

/**
 * Toggle playback. If true + we have a source, creates ingress; if false, deletes.
 */
async function setPlaying(bool) {
  isPlaying = Boolean(bool);
  logger.info('[MainStageMedia] setPlaying', { isPlaying });
  await reconcile();
}

module.exports = { start, stop, restart, updateSource, setPlaying };
