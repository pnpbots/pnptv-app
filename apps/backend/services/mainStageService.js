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
const livekit     = require('./livekitService');

// ── Constants ─────────────────────────────────────────────────────────────────

const ROOM_NAME            = 'main-stage-prime';
const ROTATE_INTERVAL_MS   = 120_000; // 2 min between spotlight rotations
const AUTO_MEDIA_INTERVAL_MS = 10 * 60_000; // 10 min between auto-picked Prime Videos
const MEDIA_BOT_IDENTITY   = 'mainstage-media';
const LOCK_KEY             = 'mainstage:rotator:lock';
const LOCK_TTL_S           = 60;      // lock expires in 60s
const LOCK_RENEW_MS        = 20_000;  // renew every 20s
const MAX_CAMMERS          = 100;
const VALID_MODES          = new Set(['spotlight', 'cinema', 'equal', 'theater', 'karaoke']);
const VALID_MEDIA_KINDS    = new Set(['video', 'music', 'off']);

// mainstage:media is stored as a Redis Hash (HSET/HGETALL) so individual fields
// can be updated atomically without a read-modify-write race. String fields are
// stored as their JSON-stringified form so booleans, nulls, and numbers round-trip
// correctly when read back via HGETALL (which returns everything as strings).
const MEDIA_KEY            = 'mainstage:media';
const MODE_KEY             = 'mainstage:mode';

// Default media state — merged with whatever is stored in the Hash.
const MEDIA_DEFAULTS = {
  kind:        'off',
  src:         null,
  title:       null,
  playing:     false,
  volume:      70,
  startedAt:   null,
  elapsedMs:   0,
  adminLocked: false,
  modeLocked:  false,
};

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

// Debounced state broadcast. Admin burst clicks (e.g. rapid volume slider
// tweaks) used to fire one broadcast per mutation. This coalesces anything
// within 200ms into a single emit to the whole mainstage room.
let _emitStateTimer = null;
async function emitState() {
  if (!_io) return;
  if (_emitStateTimer) return;
  _emitStateTimer = setTimeout(async () => {
    _emitStateTimer = null;
    try {
      const snapshot = await getState();
      _io.to('mainstage').emit('mainstage:state', snapshot);
    } catch (err) {
      logger.warn('[MainStage] emitState failed', { error: err.message });
    }
  }, 200);
}

// Viewer-count broadcast. Already-debounced via emitState above, but kept
// as a named entry so socketHandlers can stay semantic.
function notifyViewersChanged() {
  emitState().catch(() => {});
}

// ── State accessors ───────────────────────────────────────────────────────────

/**
 * Returns the full state snapshot.
 * @returns {Promise<{
 *   mode: string,
 *   spotlight: { cammer: string|null, nextAt: number|null, queue: string[] },
 *   media: { kind: string, src: string|null, playing: boolean, volume: number, startedAt: number|null },
 *   cams: { volume: number },
 *   counts: { participants: number, guests: number, cammers: number, viewers: number }
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

  let media = {
    kind: 'off',
    src: null,
    title: null,
    playing: false,
    volume: 70,
    startedAt: null,
    adminLocked: false,   // If true, autoRotateMedia skips until admin unlocks
  };
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
      participants: queue.length,
      guests: queue.filter((identity) => String(identity).startsWith('guest_')).length,
      cammers: queue.length,
      viewers: 0,
    },
  };
}

/**
 * Legacy no-op kept for compatibility while the room model has no viewer role.
 */
function countViewers(cammerCount) {
  return 0;
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
 * @param {{
 *   kind?: string,
 *   src?: string,
 *   title?: string,
 *   playing?: boolean,
 *   volume?: number,
 *   adminLocked?: boolean,   // explicit admin lock/unlock of auto-rotation
 *   _fromAutoRotate?: boolean // internal: true when called by autoRotateMedia
 * }} opts
 */
async function setMedia({ kind, src, title, playing, volume, adminLocked, _fromAutoRotate } = {}) {
  const redis  = getRedis();
  const rawNow = await redis.get('mainstage:media');
  let current  = {
    kind: 'off', src: null, title: null, playing: false, volume: 70,
    startedAt: null, elapsedMs: 0, playbackRate: 1.25, adminLocked: false,
  };
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

  // Admin-lock semantics: any human call to setMedia (kind/src change) locks
  // auto-rotation so admin intent (including "silence") is respected. Only
  // autoRotateMedia itself bypasses the lock via _fromAutoRotate. An admin
  // can explicitly unlock by passing { adminLocked: false }.
  if (adminLocked !== undefined) {
    current.adminLocked = Boolean(adminLocked);
  } else if (!_fromAutoRotate && (kind !== undefined || src !== undefined)) {
    current.adminLocked = true;
  }

  if (playing !== undefined) {
    const wasPlaying = current.playing;
    current.playing  = Boolean(playing);
    if (current.playing && !wasPlaying) {
      // Resuming: shift startedAt back by accumulated elapsed time so
      // clients can seek to the correct position mid-video.
      current.startedAt = Date.now() - (current.elapsedMs || 0);
      current.elapsedMs = 0;
    } else if (!current.playing && wasPlaying) {
      // Pausing: record how far we got so resume can restore position.
      current.elapsedMs = current.startedAt ? Date.now() - current.startedAt : (current.elapsedMs || 0);
      current.startedAt = null;
    }
  }
  // Source change resets position tracking
  if (src !== undefined) {
    current.startedAt = null;
    current.elapsedMs = 0;
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
//
// KEYS[1] = mainstage:spotlight:queue
// KEYS[2] = mainstage:spotlight:queue:timestamps
// ARGV[1] = identity
// ARGV[2] = cap
// ARGV[3] = now (ms since epoch as string)
const ADD_CAMMER_LUA = `
local key      = KEYS[1]
local tsKey    = KEYS[2]
local id       = ARGV[1]
local cap      = tonumber(ARGV[2])
local now      = ARGV[3]
local list = redis.call('LRANGE', key, 0, -1)
for i = 1, #list do
  if list[i] == id then return 'duplicate' end
end
if #list >= cap then return 'full' end
redis.call('RPUSH', key, id)
redis.call('HSET', tsKey, id, now)
return 'added'
`;

const QUEUE_TS_KEY = 'mainstage:spotlight:queue:timestamps';

// Like ADD_CAMMER_LUA but skips the cap check — admin bypass.
// KEYS[1] = mainstage:spotlight:queue
// KEYS[2] = mainstage:spotlight:queue:timestamps
// ARGV[1] = identity
// ARGV[2] = now (ms since epoch as string)
const ADD_CAMMER_FORCE_LUA = `
local key   = KEYS[1]
local tsKey = KEYS[2]
local id    = ARGV[1]
local now   = ARGV[2]
local list  = redis.call('LRANGE', key, 0, -1)
for i = 1, #list do
  if list[i] == id then return 'duplicate' end
end
redis.call('RPUSH', key, id)
redis.call('HSET', tsKey, id, now)
return 'added'
`;

async function addCammer(identity) {
  if (!identity) return 'invalid';
  const redis    = getRedis();
  const queueKey = 'mainstage:spotlight:queue';

  const result = await redis.eval(
    ADD_CAMMER_LUA, 2, queueKey, QUEUE_TS_KEY,
    String(identity), String(MAX_CAMMERS), String(Date.now()),
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

// Atomic shuffle-and-rotate-spotlight. Closes the race where a concurrent
// addCammer's Lua could slip in between a JS-side LRANGE and the DEL+RPUSH
// pipeline, wiping the new cammer. Everything now runs in a single EVAL.
//   KEYS[1]  = mainstage:spotlight:queue
//   KEYS[2]  = mainstage:spotlight:cammer
//   KEYS[3]  = mainstage:spotlight:nextAt
//   ARGV[1]  = nextAt (ms since epoch)
//   ARGV[2]  = STATE_CACHE_TTL_S
// Returns:    the new queue order (ARRAY) — client uses [1] as new spotlight
const SHUFFLE_LUA = `
local queueKey = KEYS[1]
local spotKey  = KEYS[2]
local nextKey  = KEYS[3]
local nextAt   = ARGV[1]
local ttl      = tonumber(ARGV[2])
local list = redis.call('LRANGE', queueKey, 0, -1)
if #list == 0 then return {} end
if #list > 1 then
  -- Seed from Redis TIME (sec+usec) so successive shuffles differ.
  local t = redis.call('TIME')
  math.randomseed(tonumber(t[1]) * 1000000 + tonumber(t[2]))
  for i = #list, 2, -1 do
    local j = math.random(i)
    list[i], list[j] = list[j], list[i]
  end
  redis.call('DEL', queueKey)
  redis.call('RPUSH', queueKey, unpack(list))
  redis.call('EXPIRE', queueKey, ttl)
end
redis.call('SET', spotKey, list[1], 'EX', ttl)
redis.call('SET', nextKey, nextAt, 'EX', ttl)
return list
`;

/**
 * Randomize the cammer queue order in-place and advance the spotlight to the
 * new head of the queue. Used by the client "shuffle" button to let any user
 * shake up the layout when the room gets stale. Atomic via Lua so concurrent
 * addCammer calls can't get their identity silently dropped.
 */
async function shuffleCammers() {
  const redis   = getRedis();
  const nextAt  = Date.now() + ROTATE_INTERVAL_MS;
  const result = await redis.eval(
    SHUFFLE_LUA, 3,
    'mainstage:spotlight:queue',
    'mainstage:spotlight:cammer',
    'mainstage:spotlight:nextAt',
    String(nextAt),
    String(STATE_CACHE_TTL_S),
  );
  const newQueue = Array.isArray(result) ? result : [];
  if (newQueue.length === 0) return; // nothing to do, no emit needed
  logger.info('[MainStage] cammers shuffled', { count: newQueue.length, spotlight: newQueue[0] });
  await emitState();
}

// Force-add a cammer bypassing the cap check (used for admin users).
// Dedup check still applies — calling twice for the same identity is a no-op.
// Uses a Lua script for atomicity, eliminating the TOCTOU race in the old
// JS-side LRANGE + RPUSH pattern.
async function addCammerForce(identity) {
  if (!identity) return 'invalid';
  const redis    = getRedis();
  const queueKey = 'mainstage:spotlight:queue';

  const result = await redis.eval(
    ADD_CAMMER_FORCE_LUA, 2, queueKey, QUEUE_TS_KEY,
    String(identity), String(Date.now()),
  );

  if (result === 'duplicate') {
    logger.debug('[MainStage] addCammerForce: already in queue', { identity });
    return 'duplicate';
  }

  await redis.expire(queueKey, STATE_CACHE_TTL_S);

  const current = await redis.get('mainstage:spotlight:cammer');
  if (!current) {
    await redis.set('mainstage:spotlight:cammer', String(identity), 'EX', STATE_CACHE_TTL_S);
    const nextAt = Date.now() + ROTATE_INTERVAL_MS;
    await redis.set('mainstage:spotlight:nextAt', String(nextAt), 'EX', STATE_CACHE_TTL_S);
  }

  logger.info('[MainStage] admin cammer force-added', { identity });
  upsertCammerStats(identity).catch(() => {});
  await emitState();
  return 'added';
}

async function removeCammer(identity) {
  if (!identity) return;
  const redis    = getRedis();
  const queueKey = 'mainstage:spotlight:queue';

  // LREM returns the number of elements removed. Only proceed with queue
  // maintenance and logging when the identity was actually present, avoiding
  // spurious state broadcasts and misleading log entries when called for users
  // who were never in the cammer queue.
  const removed = await redis.lrem(queueKey, 0, String(identity));
  await redis.hdel(QUEUE_TS_KEY, String(identity));

  if (removed === 0) return; // identity was not in the queue — nothing to do

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

// Directus file IDs are UUIDs. Guard against malformed records leaking
// arbitrary path segments into the URL we broadcast to every client.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * If no admin-picked media is currently playing and auto-rotation isn't
 * admin-locked, pick a random featured Prime Video from Directus and
 * broadcast it as the background.
 *
 * Respects admin intent in two ways:
 * 1. If state.media.kind !== 'off', we don't interrupt.
 * 2. If state.media.adminLocked === true, we skip even when kind === 'off'
 *    (admin explicitly chose silence).
 */
async function autoRotateMedia() {
  try {
    const redis    = getRedis();
    const rawMedia = await redis.get('mainstage:media');
    let current = { kind: 'off', adminLocked: false };
    if (rawMedia) { try { current = { ...current, ...JSON.parse(rawMedia) }; } catch (_) {} }

    // Admin has media playing — don't interrupt
    if (current.kind !== 'off') return;
    // Admin explicitly chose silence — respect it
    if (current.adminLocked) return;

    const items = await fetchFeaturedPrimeVideos();
    if (!items.length) return;

    const pick = items[Math.floor(Math.random() * items.length)];
    if (!pick || typeof pick.fileId !== 'string' || !UUID_RE.test(pick.fileId)) {
      logger.warn('[MainStage] autoRotateMedia skipped: invalid Directus fileId', { fileId: pick?.fileId });
      return;
    }
    const src  = `${DIRECTUS_PUBLIC_URL}/assets/${pick.fileId}`;

    // Only CinemaGrid/Theater/Karaoke render URL-backed media. If the room is
    // in equal/spotlight mode, the video would be set in state but invisible
    // — force the layout to cinema when auto-filling.
    const currentMode = await redis.get('mainstage:mode');
    if (currentMode !== 'cinema' && currentMode !== 'theater' && currentMode !== 'karaoke') {
      await setMode('cinema');
    }

    // _fromAutoRotate bypasses the admin-lock auto-set; the lock stays false.
    await setMedia({ kind: 'video', src, title: pick.title, playing: true, _fromAutoRotate: true });
    logger.info('[MainStage] auto-rotated Prime Video', { fileId: pick.fileId, title: pick.title });
  } catch (err) {
    logger.error('[MainStage] autoRotateMedia error', { error: err.message });
  }
}

/**
 * Prune queue entries whose identities are NOT connected to the LiveKit room.
 * This catches ghost cammers — users who were granted a cammer token but
 * whose socket died before the disconnect handler could run removeCammer
 * (e.g. socket closed before auth-binding). Without this sweep they squat
 * a MAX_CAMMERS slot until the 24h TTL expires.
 *
 * Runs on the same rotation tick as spotlight rotation (locked; one replica
 * only). Admin identities with isAdminRole are preserved even if not yet
 * published, in case they're slow to join.
 */
async function sweepGhostCammers() {
  try {
    const participants = await livekit.listParticipants(ROOM_NAME);
    if (!participants) return;

    const redis = getRedis();
    const queue = await redis.lrange('mainstage:spotlight:queue', 0, -1);

    // If LiveKit returned zero participants but our queue has entries, we do
    // NOT nuke the queue based on LiveKit alone — that's more likely a transient
    // LiveKit hiccup than all users disconnecting at once. However, if any
    // queue entry's join timestamp is older than 2× ROTATE_INTERVAL_MS we
    // trust they are truly gone and sweep anyway to prevent slot squatting.
    if (participants.length === 0) {
      if (queue.length === 0) return;

      const now = Date.now();
      const staleThresholdMs = 2 * ROTATE_INTERVAL_MS;
      const timestamps = await redis.hgetall(QUEUE_TS_KEY);
      const staleEntries = queue.filter(id => {
        if (id === MEDIA_BOT_IDENTITY) return false;
        const ts = timestamps && timestamps[id] ? parseInt(timestamps[id], 10) : null;
        if (ts === null) return false; // no timestamp = recently added without timestamp; be conservative
        return (now - ts) > staleThresholdMs;
      });

      if (staleEntries.length === 0) return; // LiveKit hiccup — preserve queue

      logger.warn(
        '[MainStage] sweepGhostCammers: LiveKit returned 0 participants but stale queue entries found — ' +
        'sweeping via timestamp fallback',
        { staleEntries, staleThresholdMs },
      );

      for (const id of staleEntries) {
        await redis.lrem('mainstage:spotlight:queue', 0, id);
        await redis.hdel(QUEUE_TS_KEY, id);
        logger.info('[MainStage] swept stale ghost cammer (0-participant fallback)', { identity: id });
      }

      const currentSpot = await redis.get('mainstage:spotlight:cammer');
      if (currentSpot && staleEntries.includes(currentSpot)) {
        await advanceSpotlight();
      } else {
        await emitState();
      }
      return;
    }

    // Build a lookup: identity -> canPublish permission. A queue entry is a
    // "ghost" if (a) the identity isn't connected to LiveKit at all, or
    // (b) the identity IS connected but with a viewer-only token (canPublish
    // false) — happens when a former cammer navigated away and their
    // useMainStage init re-minted a viewer token.
    const canPublishByIdentity = new Map();
    for (const p of participants) {
      canPublishByIdentity.set(p.identity, Boolean(p.permission?.canPublish));
    }

    const ghosts = queue.filter(id => {
      if (id === MEDIA_BOT_IDENTITY) return false;
      if (!canPublishByIdentity.has(id)) return true; // not in LiveKit
      if (canPublishByIdentity.get(id) === false) return true; // viewer-only
      return false;
    });
    if (ghosts.length === 0) return;

    for (const id of ghosts) {
      await redis.lrem('mainstage:spotlight:queue', 0, id);
      await redis.hdel(QUEUE_TS_KEY, id);
      logger.info('[MainStage] swept ghost cammer', { identity: id });
    }

    // If the spotlighted cammer was a ghost, advance to a live one
    const currentSpot = await redis.get('mainstage:spotlight:cammer');
    if (currentSpot && ghosts.includes(currentSpot)) {
      await advanceSpotlight();
    } else {
      await emitState();
    }
  } catch (err) {
    logger.warn('[MainStage] sweepGhostCammers error', { error: err.message });
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

    // Rotation tick — also opportunistically sweeps ghost cammers every tick
    _rotationInterval = setInterval(async () => {
      try {
        // Ghost-sweep first so the spotlight rotation operates on a clean queue
        await sweepGhostCammers();
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
    const identityStr = String(identity);
    const userId = (identityStr.startsWith('guest_') || identityStr.startsWith('viewer_'))
      ? null : identityStr;
    const pool = getPool();
    await pool.query(
      `INSERT INTO mainstage_cammer_stats (identity, user_id, last_seen_at)
       VALUES ($1, $2::text, NOW())
       ON CONFLICT (identity) DO UPDATE SET last_seen_at = NOW(), user_id = COALESCE(mainstage_cammer_stats.user_id, EXCLUDED.user_id)`,
      [identityStr, userId]
    );
  } catch (err) {
    logger.warn('[MainStage] upsertCammerStats failed', { error: err.message });
  }
}

async function updateCammerSpotlightStats(identity) {
  try {
    const identityStr = String(identity);
    const userId = (identityStr.startsWith('guest_') || identityStr.startsWith('viewer_'))
      ? null : identityStr;
    const pool = getPool();
    await pool.query(
      `INSERT INTO mainstage_cammer_stats (identity, user_id, last_spotlight_at, total_seconds)
       VALUES ($1, $2::text, NOW(), $3)
       ON CONFLICT (identity) DO UPDATE
         SET last_spotlight_at = NOW(),
             total_seconds = mainstage_cammer_stats.total_seconds + $3,
             user_id = COALESCE(mainstage_cammer_stats.user_id, EXCLUDED.user_id)`,
      [identityStr, userId, Math.floor(ROTATE_INTERVAL_MS / 1000)]
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
  addCammerForce,
  removeCammer,
  shuffleCammers,
  setSpotlight,
  advanceSpotlight,
  startRotation,
  stopRotation,
  logAdminAction,
  notifyViewersChanged,
  autoRotateMedia,
};
