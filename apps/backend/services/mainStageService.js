'use strict';

/**
 * Main Stage Service
 *
 * Redis-backed state machine for the 24/7 Main Stage LiveKit room.
 * Manages mode (spotlight / cinema / equal), media playback state, cammer
 * queue, and a distributed spotlight-rotation lock so multiple bot replicas
 * do not each run their own rotation timer simultaneously.
 *
 * Socket.IO instance is injected via setIo() at boot time (called from
 * socketHandlers.js) to avoid a circular require with bot.js.
 */

const axios       = require('axios');
const logger      = require('../utils/logger');
const { getRedis } = require('../config/redis');
const { getPool }  = require('../config/postgres');

// ── Constants ─────────────────────────────────────────────────────────────────

const ROOM_NAME            = 'main-stage-prime';
const ROTATE_INTERVAL_MS   = 120_000; // 2 min between spotlight rotations
const AUTO_MEDIA_INTERVAL_MS = 10 * 60_000; // 10 min between auto-picked Prime Videos
const MEDIA_BOT_IDENTITY   = 'mainstage-media';
const LOCK_KEY             = 'mainstage:rotator:lock';
const LOCK_TTL_S           = 60;      // lock expires in 60s
const LOCK_RENEW_MS        = 20_000;  // renew every 20s
const MAX_CAMMERS          = 12;
const VALID_MODES          = new Set(['spotlight', 'cinema', 'equal']);
const VALID_MEDIA_KINDS    = new Set(['video', 'music', 'off']);

// Directus endpoints for background Prime Video auto-rotation
const DIRECTUS_INTERNAL_URL = (process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055').replace(/\/$/, '');
const DIRECTUS_PUBLIC_URL   = (process.env.DIRECTUS_PUBLIC_URL   || 'https://cms.pnptv.app').replace(/\/$/, '');
// 24h TTL so an idle room doesn't silently reset to `mode: 'equal'` after 5 min.
// Every write refreshes the TTL; the rotation tick effectively heartbeats it too.
const STATE_CACHE_TTL_S    = 86_400;

// ── Module-level io reference (injected via setIo) ───────────────────────────

let _io = null;

/**
 * Inject the Socket.IO server instance.
 * Called once at boot by socketHandlers.js after io is created.
 */
function setIo(io) {
  _io = io;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function clampVolume(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

async function emitState() {
  if (!_io) return;
  try {
    const snapshot = await getState();
    _io.to('mainstage').emit('mainstage:state', snapshot);
  } catch (err) {
    logger.warn('[MainStage] emitState failed', { error: err.message });
  }
}

// Debounced viewer-count broadcast. Called when sockets join/leave the
// mainstage room — bursty during app boot, so collapse to one emit per tick.
let _viewerEmitTimer = null;
function notifyViewersChanged() {
  if (_viewerEmitTimer) return;
  _viewerEmitTimer = setTimeout(() => {
    _viewerEmitTimer = null;
    emitState().catch(() => {});
  }, 500);
}

// ── State accessors ───────────────────────────────────────────────────────────

/**
 * Returns the full state snapshot.
 * @returns {Promise<{
 *   mode: string,
 *   spotlight: { cammer: string|null, nextAt: number|null, queue: string[] },
 *   media: { kind: string, src: string|null, playing: boolean, volume: number, startedAt: number|null },
 *   cams: { volume: number },
 *   counts: { cammers: number, viewers: number }
 * }>}
 */
async function getState() {
  const redis = getRedis();

  const [
    mode,
    spotlightCammer,
    spotlightNextAt,
    queue,
    mediaRaw,
    camsVolRaw,
  ] = await Promise.all([
    redis.get('mainstage:mode'),
    redis.get('mainstage:spotlight:cammer'),
    redis.get('mainstage:spotlight:nextAt'),
    redis.lrange('mainstage:spotlight:queue', 0, -1),
    redis.get('mainstage:media'),
    redis.get('mainstage:cams:volume'),
  ]);

  let media = { kind: 'off', src: null, title: null, playing: false, volume: 70, startedAt: null };
  if (mediaRaw) {
    try { media = { ...media, ...JSON.parse(mediaRaw) }; } catch (_) {}
  }

  return {
    mode:      mode || 'equal',
    spotlight: {
      cammer: spotlightCammer || null,
      nextAt: spotlightNextAt ? parseInt(spotlightNextAt, 10) : null,
      queue,
    },
    media,
    cams: {
      volume: camsVolRaw !== null ? parseInt(camsVolRaw, 10) : 80,
    },
    counts: {
      cammers: queue.length,
      viewers: countViewers(queue.length),
    },
  };
}

/**
 * Best-effort viewer count: every authenticated socket auto-joins the
 * 'mainstage' Socket.IO room (see socketHandlers.js). Subtract the cammer
 * queue size so cammers aren't double-counted as both performer and viewer.
 * Returns 0 if io isn't wired yet (boot ordering) or the room is empty.
 */
function countViewers(cammerCount) {
  if (!_io) return 0;
  try {
    const room = _io.sockets?.adapter?.rooms?.get('mainstage');
    const total = room ? room.size : 0;
    return Math.max(0, total - (cammerCount || 0));
  } catch {
    return 0;
  }
}

// ── Mode ──────────────────────────────────────────────────────────────────────

async function setMode(mode) {
  if (!VALID_MODES.has(mode)) throw new Error(`Invalid mode: ${mode}`);
  const redis = getRedis();
  await redis.set('mainstage:mode', mode, 'EX', STATE_CACHE_TTL_S);
  logger.info('[MainStage] mode set', { mode });
  await emitState();
}

// ── Media ─────────────────────────────────────────────────────────────────────

/**
 * @param {{ kind?: string, src?: string, title?: string, playing?: boolean, volume?: number }} opts
 */
async function setMedia({ kind, src, title, playing, volume } = {}) {
  const redis  = getRedis();
  const rawNow = await redis.get('mainstage:media');
  let current  = { kind: 'off', src: null, title: null, playing: false, volume: 70, startedAt: null };
  if (rawNow) { try { current = { ...current, ...JSON.parse(rawNow) }; } catch (_) {} }

  if (kind !== undefined) {
    if (!VALID_MEDIA_KINDS.has(kind)) throw new Error(`Invalid media kind: ${kind}`);
    current.kind = kind;
    // When the kind changes (or admin clears with kind='off'), reset the
    // title so stale metadata doesn't linger from the previous pick.
    if (title === undefined) current.title = null;
  }
  if (src    !== undefined) current.src    = src || null;
  if (title  !== undefined) current.title  = title || null;
  if (volume !== undefined) current.volume = clampVolume(volume);

  if (playing !== undefined) {
    const wasPlaying = current.playing;
    current.playing  = Boolean(playing);
    // Track when playback started so the frontend can sync position
    if (current.playing && !wasPlaying) {
      current.startedAt = Date.now();
    } else if (!current.playing) {
      current.startedAt = null;
    }
  }

  await redis.set('mainstage:media', JSON.stringify(current), 'EX', STATE_CACHE_TTL_S);
  logger.info('[MainStage] media updated', { kind: current.kind, playing: current.playing });
  await emitState();
}

async function setMediaVolume(v) {
  const redis  = getRedis();
  const rawNow = await redis.get('mainstage:media');
  let current  = { kind: 'off', src: null, playing: false, volume: 70, startedAt: null };
  if (rawNow) { try { current = { ...current, ...JSON.parse(rawNow) }; } catch (_) {} }
  current.volume = clampVolume(v);
  await redis.set('mainstage:media', JSON.stringify(current), 'EX', STATE_CACHE_TTL_S);
  await emitState();
}

async function setCamsVolume(v) {
  const redis = getRedis();
  await redis.set('mainstage:cams:volume', clampVolume(v), 'EX', STATE_CACHE_TTL_S);
  await emitState();
}

// ── Cammer queue ──────────────────────────────────────────────────────────────

// Atomic add-if-under-cap. Returns:
//   'added'      - identity was pushed to the queue
//   'duplicate'  - identity already present (idempotent success)
//   'full'       - queue at cap, not added
// Implemented as a Lua script so the dedup + cap check + push run in a single
// Redis round-trip, eliminating the TOCTOU race that allowed concurrent token
// requests to all pass a stale cap check and collectively exceed MAX_CAMMERS.
const ADD_CAMMER_LUA = `
local key = KEYS[1]
local id  = ARGV[1]
local cap = tonumber(ARGV[2])
local list = redis.call('LRANGE', key, 0, -1)
for i = 1, #list do
  if list[i] == id then return 'duplicate' end
end
if #list >= cap then return 'full' end
redis.call('RPUSH', key, id)
return 'added'
`;

async function addCammer(identity) {
  if (!identity) return 'invalid';
  const redis    = getRedis();
  const queueKey = 'mainstage:spotlight:queue';

  const result = await redis.eval(
    ADD_CAMMER_LUA, 1, queueKey, String(identity), String(MAX_CAMMERS),
  );

  if (result === 'duplicate') {
    logger.debug('[MainStage] addCammer: already in queue', { identity });
    return 'duplicate';
  }
  if (result === 'full') {
    logger.warn('[MainStage] addCammer: cammer cap reached', { cap: MAX_CAMMERS });
    return 'full';
  }

  await redis.expire(queueKey, STATE_CACHE_TTL_S);

  // If no spotlight yet, immediately set this cammer as spotlight
  const current = await redis.get('mainstage:spotlight:cammer');
  if (!current) {
    await redis.set('mainstage:spotlight:cammer', String(identity), 'EX', STATE_CACHE_TTL_S);
    const nextAt = Date.now() + ROTATE_INTERVAL_MS;
    await redis.set('mainstage:spotlight:nextAt', String(nextAt), 'EX', STATE_CACHE_TTL_S);
  }

  logger.info('[MainStage] cammer added', { identity });

  // Best-effort stats upsert
  upsertCammerStats(identity).catch(() => {});

  await emitState();
  return 'added';
}

async function removeCammer(identity) {
  if (!identity) return;
  const redis    = getRedis();
  const queueKey = 'mainstage:spotlight:queue';

  await redis.lrem(queueKey, 0, String(identity));

  // If this was the spotlight cammer, advance to the next
  const current = await redis.get('mainstage:spotlight:cammer');
  if (current === String(identity)) {
    await advanceSpotlight();
  } else {
    await emitState();
  }
  logger.info('[MainStage] cammer removed', { identity });
}

async function setSpotlight(identity) {
  if (!identity) throw new Error('identity required');
  const redis = getRedis();
  await redis.set('mainstage:spotlight:cammer', String(identity), 'EX', STATE_CACHE_TTL_S);
  const nextAt = Date.now() + ROTATE_INTERVAL_MS;
  await redis.set('mainstage:spotlight:nextAt', String(nextAt), 'EX', STATE_CACHE_TTL_S);
  logger.info('[MainStage] spotlight set manually', { identity });
  await emitState();
}

/**
 * Atomic round-robin advance. Read-modify-write in a single Redis call so
 * two advanceSpotlight invocations (e.g. brief lock-handover window) can't
 * skip a cammer by racing each other's reads. Returns the outgoing identity
 * so the caller can update stats outside the script.
 */
const ADVANCE_LUA = `
local qk     = KEYS[1]
local ck     = KEYS[2]
local nk     = KEYS[3]
local ttl    = tonumber(ARGV[1])
local nextAt = ARGV[2]
local queue  = redis.call('LRANGE', qk, 0, -1)
if #queue == 0 then
  redis.call('DEL', ck)
  redis.call('DEL', nk)
  return {'', ''}
end
local current = redis.call('GET', ck)
local idx = 0
if current then
  for i, v in ipairs(queue) do
    if v == current then idx = i end
  end
end
local nextIdx = (idx % #queue) + 1
local nextId  = queue[nextIdx]
redis.call('SET', ck, nextId, 'EX', ttl)
redis.call('SET', nk, nextAt, 'EX', ttl)
return { nextId, current or '' }
`;

async function advanceSpotlight() {
  const redis  = getRedis();
  const nextAt = Date.now() + ROTATE_INTERVAL_MS;

  const result = await redis.eval(
    ADVANCE_LUA, 3,
    'mainstage:spotlight:queue',
    'mainstage:spotlight:cammer',
    'mainstage:spotlight:nextAt',
    String(STATE_CACHE_TTL_S),
    String(nextAt),
  );

  const next    = result[0] || null;
  const outgoing = result[1] || null;

  logger.info('[MainStage] spotlight advanced', { next });

  if (outgoing) {
    updateCammerSpotlightStats(outgoing).catch(() => {});
  }

  await emitState();
}

// ── Prime Video auto-rotation ─────────────────────────────────────────────────

let _primeVideoCache = { items: [], fetchedAt: 0 };
const PRIME_CACHE_TTL_MS = 60 * 60 * 1000; // refetch Directus list hourly

async function fetchFeaturedPrimeVideos() {
  const now = Date.now();
  if (_primeVideoCache.items.length && now - _primeVideoCache.fetchedAt < PRIME_CACHE_TTL_MS) {
    return _primeVideoCache.items;
  }
  try {
    const resp = await axios.get(`${DIRECTUS_INTERNAL_URL}/items/prime_videos`, {
      params: {
        filter: JSON.stringify({
          status: { _eq: 'published' },
          video_file: { _nnull: true },
        }),
        fields: 'video_file,title',
        limit: 100,
      },
      timeout: 8_000,
    });
    const items = (resp.data?.data || [])
      .filter(v => v?.video_file)
      .map(v => ({ fileId: v.video_file, title: v.title || null }));
    _primeVideoCache = { items, fetchedAt: now };
    return items;
  } catch (err) {
    logger.warn('[MainStage] fetchFeaturedPrimeVideos failed', { error: err.message });
    return _primeVideoCache.items; // stale-ok
  }
}

/**
 * If no admin-picked media is currently playing and there is no active
 * cammer, pick a random featured Prime Video from Directus and broadcast it
 * as the background. Respects admin overrides: once state.media.kind is set
 * to 'video' or 'music' by an admin, this function is a no-op.
 */
async function autoRotateMedia() {
  try {
    const redis   = getRedis();
    const rawMedia = await redis.get('mainstage:media');
    let current = { kind: 'off' };
    if (rawMedia) { try { current = { ...current, ...JSON.parse(rawMedia) }; } catch (_) {} }

    // Admin has media playing — don't interrupt
    if (current.kind !== 'off') return;

    const items = await fetchFeaturedPrimeVideos();
    if (!items.length) return;

    const pick = items[Math.floor(Math.random() * items.length)];
    const src  = `${DIRECTUS_PUBLIC_URL}/assets/${pick.fileId}`;

    // Only CinemaGrid renders URL-backed media. If the room is in equal/
    // spotlight mode, the video would be set in state but invisible — so
    // force the layout to cinema when we auto-fill. Admin can still pick a
    // different mode and their choice persists until their media is cleared.
    const redis2   = getRedis();
    const currentMode = await redis2.get('mainstage:mode');
    if (currentMode !== 'cinema') {
      await setMode('cinema');
    }

    await setMedia({ kind: 'video', src, title: pick.title, playing: true });
    logger.info('[MainStage] auto-rotated Prime Video', { fileId: pick.fileId, title: pick.title });
  } catch (err) {
    logger.error('[MainStage] autoRotateMedia error', { error: err.message });
  }
}

// ── Distributed rotation lock ─────────────────────────────────────────────────

let _rotationInterval = null;
let _autoMediaInterval = null;
let _lockRenewInterval = null;
let _lockToken        = null;

/**
 * Acquire the Redis lock and, if successful, start the local rotation interval.
 * Multiple bot replicas call this at boot; only one holds the lock at a time.
 */
async function startRotation() {
  _lockToken = `${process.pid}-${Date.now()}`;
  const redis = getRedis();

  async function tryAcquire() {
    const result = await redis.set(LOCK_KEY, _lockToken, 'NX', 'EX', LOCK_TTL_S);
    if (result !== 'OK') {
      logger.debug('[MainStage] rotation lock not acquired — another instance holds it');
      // Retry after half a lock TTL
      setTimeout(tryAcquire, (LOCK_TTL_S / 2) * 1000);
      return;
    }

    logger.info('[MainStage] rotation lock acquired', { token: _lockToken });

    // Renew lock before it expires
    _lockRenewInterval = setInterval(async () => {
      try {
        const holder = await redis.get(LOCK_KEY);
        if (holder !== _lockToken) {
          // Lock was taken from us (e.g. crash + recovery); stop renewing
          clearInterval(_lockRenewInterval);
          clearInterval(_rotationInterval);
          if (_autoMediaInterval) clearInterval(_autoMediaInterval);
          _lockRenewInterval = null;
          _rotationInterval  = null;
          _autoMediaInterval = null;
          logger.warn('[MainStage] rotation lock lost — stopping local rotation');
          return;
        }
        await redis.expire(LOCK_KEY, LOCK_TTL_S);
      } catch (err) {
        logger.error('[MainStage] lock renew error', { error: err.message });
      }
    }, LOCK_RENEW_MS);

    // Rotation tick
    _rotationInterval = setInterval(async () => {
      try {
        const mode = await redis.get('mainstage:mode');
        if (mode !== 'spotlight') return;
        await advanceSpotlight();
      } catch (err) {
        logger.error('[MainStage] rotation tick error', { error: err.message });
      }
    }, ROTATE_INTERVAL_MS);

    // Prime Video auto-rotation: fire once shortly after boot so the room
    // isn't silent on first load, then every AUTO_MEDIA_INTERVAL_MS.
    setTimeout(() => { autoRotateMedia().catch(() => {}); }, 15_000);
    _autoMediaInterval = setInterval(() => {
      autoRotateMedia().catch(() => {});
    }, AUTO_MEDIA_INTERVAL_MS);
  }

  await tryAcquire().catch(err =>
    logger.error('[MainStage] startRotation error', { error: err.message })
  );
}

async function stopRotation() {
  if (_lockRenewInterval) { clearInterval(_lockRenewInterval); _lockRenewInterval = null; }
  if (_rotationInterval)  { clearInterval(_rotationInterval);  _rotationInterval  = null; }
  if (_autoMediaInterval) { clearInterval(_autoMediaInterval); _autoMediaInterval = null; }

  if (_lockToken) {
    try {
      const redis  = getRedis();
      const holder = await redis.get(LOCK_KEY);
      if (holder === _lockToken) {
        await redis.del(LOCK_KEY);
        logger.info('[MainStage] rotation lock released');
      }
    } catch (err) {
      logger.warn('[MainStage] stopRotation: lock release failed', { error: err.message });
    }
    _lockToken = null;
  }
}

// ── Audit log ─────────────────────────────────────────────────────────────────

/**
 * Insert a row into mainstage_admin_log.
 * @param {string|number} userId
 * @param {string} action
 * @param {object} [payload]
 */
async function logAdminAction(userId, action, payload = null) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO mainstage_admin_log (user_id, action, payload)
       VALUES ($1::varchar, $2, $3)`,
      [userId ? String(userId) : null, String(action), payload ? JSON.stringify(payload) : null]
    );
  } catch (err) {
    logger.error('[MainStage] logAdminAction failed', { error: err.message, action });
  }
}

// ── Internal DB helpers ───────────────────────────────────────────────────────

async function upsertCammerStats(identity) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO mainstage_cammer_stats (identity, user_id, last_seen_at)
       VALUES ($1, NULL, NOW())
       ON CONFLICT (identity) DO UPDATE SET last_seen_at = NOW()`,
      [String(identity)]
    );
  } catch (err) {
    logger.warn('[MainStage] upsertCammerStats failed', { error: err.message });
  }
}

async function updateCammerSpotlightStats(identity) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO mainstage_cammer_stats (identity, user_id, last_spotlight_at, total_seconds)
       VALUES ($1, NULL, NOW(), $2)
       ON CONFLICT (identity) DO UPDATE
         SET last_spotlight_at = NOW(),
             total_seconds = mainstage_cammer_stats.total_seconds + $2`,
      [String(identity), Math.floor(ROTATE_INTERVAL_MS / 1000)]
    );
  } catch (err) {
    logger.warn('[MainStage] updateCammerSpotlightStats failed', { error: err.message });
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ROOM_NAME,
  ROTATE_INTERVAL_MS,
  MEDIA_BOT_IDENTITY,
  MAX_CAMMERS,
  setIo,
  getState,
  setMode,
  setMedia,
  setMediaVolume,
  setCamsVolume,
  addCammer,
  removeCammer,
  setSpotlight,
  advanceSpotlight,
  startRotation,
  stopRotation,
  logAdminAction,
  notifyViewersChanged,
  autoRotateMedia,
};
