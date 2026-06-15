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

let stopping        = false;
let backoffMs       = MIN_BACKOFF_MS;
let currentSrc      = null;
let isPlaying       = false;
let ingressId       = null;
let retryTimer      = null;
// If the LiveKit server's ingress service is not provisioned (no ingress
// binary / no Redis), createIngress returns "ingress not connected". Retrying
// won't help until infra is fixed, so we latch here and skip further attempts.
// The latch auto-resets after 1 hour so a fixed infra doesn't require a bot restart.
// An admin hitting Play also clears the latch (via setPlaying/updateSource).
let ingressDisabled   = false;
let ingressDisabledAt = null;
const INGRESS_LATCH_RESET_MS = 60 * 60 * 1000; // 1 hour

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
 * Quick HEAD probe to check a source URL is reachable before creating a
 * LiveKit ingress. Fails fast (5s) so broken URLs don't block reconcile.
 */
async function probeUrl(src) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(src, { method: 'HEAD', signal: controller.signal });
    return res.ok || res.status === 405; // 405 = HEAD not allowed but server is alive
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bring the ingress state in line with (isPlaying, currentSrc):
 *   - no src or not playing → ensure no ingress
 *   - playing + src         → ensure an ingress exists pointing at src
 */
function isIngressInfraError(err) {
  const msg = (err && err.message) || '';
  return /ingress not connected|redis required|ingress.*unavailable/i.test(msg);
}

async function reconcile() {
  if (stopping) return;
  clearRetry();

  const desired = isPlaying && currentSrc ? 'active' : 'none';

  if (desired === 'none') {
    if (ingressId) await deleteExistingIngresses();
    return;
  }

  if (ingressDisabled) {
    const latchAge = ingressDisabledAt ? Date.now() - ingressDisabledAt : Infinity;
    if (latchAge >= INGRESS_LATCH_RESET_MS) {
      logger.info('[MainStageMedia] ingress latch auto-reset after 1h — retrying');
      ingressDisabled   = false;
      ingressDisabledAt = null;
    } else {
      logger.warn('[MainStageMedia] ingress latched off — admin play ignored until infra is fixed or latch resets in ' +
        Math.ceil((INGRESS_LATCH_RESET_MS - latchAge) / 60000) + 'min');
      return;
    }
  }

  // Probe the source URL before creating an ingress so admins get fast feedback
  // on broken links rather than a silent retry loop.
  if (currentSrc) {
    const probeOk = await probeUrl(currentSrc);
    if (!probeOk) {
      logger.warn('[MainStageMedia] source URL unreachable — skipping ingress create', { src: currentSrc.slice(0, 80) });
      return;
    }
  }

  try {
    // Always recreate so a source change is reflected. LiveKit's URL_INPUT
    // doesn't support updating the URL in-place.
    await deleteExistingIngresses();
    await createUrlIngress(currentSrc);
    backoffMs = MIN_BACKOFF_MS;
  } catch (err) {
    if (isIngressInfraError(err)) {
      ingressDisabled   = true;
      ingressDisabledAt = Date.now();
      logger.error(
        '[MainStageMedia] LiveKit ingress service is not provisioned on this server ' +
        '(err: "' + err.message + '"). Media playback is disabled until livekit-ingress ' +
        'is deployed. The rest of Main Stage (rooms, cammers, rotation, admin) works normally.',
      );
      return;
    }
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
 * Also clears the ingressDisabled latch so an admin swapping sources after
 * an infra fix gets a fresh attempt rather than a permanent no-op.
 */
async function updateSource(src) {
  ingressDisabled = false;
  currentSrc = src || null;
  logger.info('[MainStageMedia] source updated', { src: src?.slice(0, 80) });
  await reconcile();
}

/**
 * Toggle playback. If true + we have a source, creates ingress; if false, deletes.
 * Clears the ingressDisabled latch on Play so admin recovery works without a restart.
 */
async function setPlaying(bool) {
  if (bool) ingressDisabled = false;
  isPlaying = Boolean(bool);
  logger.info('[MainStageMedia] setPlaying', { isPlaying });
  await reconcile();
}

module.exports = { start, stop, restart, updateSource, setPlaying };
