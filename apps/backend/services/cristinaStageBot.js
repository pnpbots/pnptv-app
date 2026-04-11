'use strict';

/**
 * Cristina Stage Bot — 24/7 LiveKit presence for the Main Stage.
 *
 * Streams mode-matched audio from the media library into a LiveKit room.
 * Optimized for smooth playback, bandwidth efficiency, and clean audio.
 *
 * Audio pipeline:
 *   SoundCloud → yt-dlp (resolve URL) → ffmpeg (decode + normalize + resample)
 *     → ring buffer → AudioFrame → LiveKit AudioSource → WebRTC Opus
 *
 * Bandwidth strategy:
 *   - ffmpeg decodes to 48 kHz stereo s16le PCM (required by LiveKit)
 *   - LiveKit's built-in Opus encoder compresses for WebRTC (~64-128 kbps)
 *   - ffmpeg applies loudnorm filter for consistent volume across tracks
 *   - Volume normalization + limiter prevents pre-encoder digital clipping
 *   - Ring buffer caps at 2s of audio to bound memory and latency
 *   - Real-time pacing via captureFrame backpressure (no busy loops)
 */

const { Room: LKRoom, LocalAudioTrack, AudioSource, AudioFrame, TrackPublishOptions } = require('@livekit/rtc-node');
const { AudioEncoding } = require('@livekit/rtc-ffi-bindings');
const { spawn } = require('child_process');
const { query } = require('../config/postgres');
const livekitService = require('./livekitService');
const logger = require('../utils/logger');

// ─── Audio constants ────────────────────────────────────────────────────────
const SAMPLE_RATE = 48000;
const NUM_CHANNELS = 2;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960
const BYTES_PER_SAMPLE = 2; // s16le
const FRAME_SIZE_BYTES = SAMPLES_PER_FRAME * NUM_CHANNELS * BYTES_PER_SAMPLE; // 3840

// Ring buffer: cap at 2 seconds of audio (~100 frames) to bound latency + memory
const MAX_QUEUE_FRAMES = 100;

const BOT_IDENTITY = 'cristina-ai';
const BOT_DISPLAY_NAME = 'Cristina AI';
// Base reconnect delay — exponential backoff resets to this on successful connect
const BASE_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const BOT_LIVEKIT_URL = process.env.LIVEKIT_INTERNAL_WS_URL || 'ws://livekit-pnptv:7880';

const MODE_LABEL_MAP = {
  'ambient':   'landing',
  'community': 'flying',
  'dj-live':   'takeoff',
};

let _running = false;
let _room = null;
let _ffmpeg = null;
let _currentMode = 'ambient';
let _modeChanged = false;
// Atomic generation counter — increments on every mode change so inner loops
// can detect a stale generation and break immediately.
let _generation = 0;
// Consecutive yt-dlp resolve failures — drives exponential backoff
let _consecutiveFailures = 0;
// Reconnect backoff state
let _reconnectDelay = BASE_RECONNECT_DELAY_MS;

// ─── Observability state ────────────────────────────────────────────────────
// Heartbeat debounce — at most one Redis write per 10s to avoid hammering.
const HEARTBEAT_DEBOUNCE_MS = 10_000;
const HEARTBEAT_TTL_SEC = 60;
// Short-track guard — tracks shorter than this are treated as suspicious (ffmpeg
// dying immediately rather than actual playback). This catches failure modes
// like filter-chain errors where ffmpeg exits ~instantly.
const MIN_HEALTHY_TRACK_MS = 10_000;
let _lastHeartbeatAt = 0;
let _currentRoomName = null;
let _currentTrackTitle = null;
let _currentTrackStartedAt = null;

async function _writeHeartbeat(force = false) {
  const now = Date.now();
  if (!force && now - _lastHeartbeatAt < HEARTBEAT_DEBOUNCE_MS) return;
  _lastHeartbeatAt = now;
  try {
    const { getRedis } = require('../config/redis');
    await getRedis().set(
      'cristina:heartbeat',
      JSON.stringify({
        at: now,
        mode: _currentMode,
        room: _currentRoomName,
        track: _currentTrackTitle,
        trackStartedAt: _currentTrackStartedAt,
      }),
      'EX',
      HEARTBEAT_TTL_SEC,
    );
  } catch {
    // Redis unavailable — heartbeat fails silently. Intentional: bot must
    // not crash on transient Redis issues. Health endpoint will show red
    // when the key expires, which is the correct signal.
  }
}

// ─── Mode switch serializer ─────────────────────────────────────────────────

/**
 * _switchMode — single serialized path for all mode changes.
 * Both the poll interval and setMode() must call this instead of duplicating
 * the SIGKILL logic, preventing races where two callers both touch _ffmpeg.
 */
function _switchMode(newMode) {
  if (newMode === _currentMode) return;
  const oldMode = _currentMode;
  _currentMode = newMode;
  _modeChanged = true;
  _generation += 1;
  logger.info('[CristinaBot] Mode changed', { from: oldMode, to: newMode, generation: _generation });
  if (_ffmpeg) {
    try { _ffmpeg.kill('SIGKILL'); } catch {}
    _ffmpeg = null;
  }
}

// ─── Mode change listener ───────────────────────────────────────────────────

function setupModeListener() {
  const interval = setInterval(async () => {
    if (!_running) { clearInterval(interval); return; }
    try {
      const { getRedis } = require('../config/redis');
      const mode = await getRedis().get('mainstage:mode') || 'ambient';
      _switchMode(mode);
    } catch {}
  }, 2000);
  return interval;
}

// ─── Track playlist ─────────────────────────────────────────────────────────

async function loadPlaylist(mode) {
  const label = MODE_LABEL_MAP[mode] || 'flying';
  const { rows } = await query(
    `SELECT id, title, url FROM media_library
     WHERE type = 'audio' AND url IS NOT NULL AND url != '' AND label = $1
     ORDER BY RANDOM() LIMIT 100`,
    [label]
  );
  if (rows.length === 0) {
    const { rows: fallback } = await query(
      `SELECT id, title, url FROM media_library
       WHERE type = 'audio' AND url IS NOT NULL AND url != ''
       ORDER BY RANDOM() LIMIT 100`
    );
    return fallback;
  }
  return rows;
}

async function resolveStreamUrl(soundcloudUrl) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', [
      '--no-warnings', '-q', '-f', 'bestaudio[abr>=160]/bestaudio', '--get-url', soundcloudUrl,
    ], { timeout: 30_000 });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      const url = stdout.trim().split('\n')[0];
      resolve(code === 0 && url && url.startsWith('http') ? url : null);
    });
    proc.on('error', () => resolve(null));
  });
}

// ─── Core loop ──────────────────────────────────────────────────────────────

async function ensureMainGroupCall(mainGroupId) {
  const { rows: existing } = await query(
    `SELECT id, room_name FROM hangout_video_calls
     WHERE group_id = $1 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [mainGroupId]
  );
  if (existing.length > 0) return existing[0].room_name;

  const roomName = `hangout-${mainGroupId}`;
  await query(
    `INSERT INTO hangout_video_calls (group_id, creator_id, room_name, status, participant_count, is_persistent)
     VALUES ($1, $2, $3, 'active', 1, true)`,
    [mainGroupId, BOT_IDENTITY, roomName]
  );
  logger.info('[CristinaBot] Created persistent call', { roomName });
  return roomName;
}

async function connectAndStream() {
  const { rows: mainRows } = await query(
    `SELECT id FROM hangout_groups WHERE is_main = true ORDER BY id ASC LIMIT 1`
  );
  if (!mainRows.length) { logger.warn('[CristinaBot] No main group'); return; }
  const mainGroupId = mainRows[0].id;
  const roomName = await ensureMainGroupCall(mainGroupId);

  try {
    const { getRedis } = require('../config/redis');
    _currentMode = await getRedis().get('mainstage:mode') || 'ambient';
  } catch { _currentMode = 'ambient'; }

  const token = await livekitService.generateToken(roomName, BOT_IDENTITY, BOT_DISPLAY_NAME, true);
  const room = new LKRoom();
  _room = room;
  await room.connect(BOT_LIVEKIT_URL, token, { autoSubscribe: false });
  _currentRoomName = roomName;
  logger.info('[CristinaBot] Connected', { roomName, mode: _currentMode });

  // Successful connect — reset reconnect backoff
  _reconnectDelay = BASE_RECONNECT_DELAY_MS;

  const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('cristina-radio', audioSource);
  const publishOptions = new TrackPublishOptions();
  publishOptions.source = 2; // MICROPHONE (TrackSource enum: 0=UNKNOWN, 1=CAMERA, 2=MICROPHONE)
  // Music-quality Opus: 192 kbps stereo, DTX off (no silence gap), RED on (packet-loss resilience)
  publishOptions.audioEncoding = new AudioEncoding({ maxBitrate: BigInt(192_000) });
  publishOptions.dtx = false;
  publishOptions.red = true;
  await room.localParticipant.publishTrack(track, publishOptions);
  logger.info('[CristinaBot] Audio track published', { bitrate: '192kbps', dtx: false, red: true });

  const modeInterval = setupModeListener();
  try {
    while (_running && room.isConnected) {
      // Capture the current generation at the start of this playlist cycle
      const cycleGeneration = _generation;
      _modeChanged = false;

      // Read mode fresh from Redis at playlist-reload time (not from stale local)
      let currentMode = _currentMode;
      try {
        const { getRedis } = require('../config/redis');
        currentMode = await getRedis().get('mainstage:mode') || _currentMode;
        if (currentMode !== _currentMode) _switchMode(currentMode);
      } catch {}

      const playlist = await loadPlaylist(_currentMode);
      if (!playlist.length) {
        logger.warn('[CristinaBot] No tracks, waiting 30s', { mode: _currentMode });
        await sleep(30_000);
        continue;
      }

      const modeLabel = MODE_LABEL_MAP[_currentMode] || 'flying';
      logger.info('[CristinaBot] Playlist loaded', { mode: _currentMode, label: modeLabel, tracks: playlist.length });

      let successfulStreams = 0;

      for (const entry of playlist) {
        // Check both _modeChanged flag AND generation counter for early exit
        if (!_running || !room.isConnected || _modeChanged || _generation !== cycleGeneration) break;

        _currentTrackTitle = entry.title;
        _currentTrackStartedAt = Date.now();
        logger.info('[CristinaBot] Now playing', { title: entry.title, mode: _currentMode });
        // Force heartbeat on each track advance so monitoring sees liveness
        // even if the previous track was >10s ago.
        _writeHeartbeat(true);
        await query(
          `INSERT INTO radio_now_playing (id, title, artist, started_at, updated_at)
           VALUES (1, $1, $2, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET title = $1, artist = $2, started_at = NOW(), updated_at = NOW()`,
          [entry.title, `PNP Radio — ${modeLabel}`]
        ).catch(() => {});

        const streamUrl = await resolveStreamUrl(entry.url);
        if (!streamUrl) {
          _consecutiveFailures += 1;
          logger.warn('[CristinaBot] Resolve failed, skipping', {
            title: entry.title,
            consecutiveFailures: _consecutiveFailures,
          });
          // Exponential backoff after 3 consecutive failures
          if (_consecutiveFailures >= 3) {
            const backoffMs = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * Math.pow(2, _consecutiveFailures));
            logger.warn('[CristinaBot] Entering resolve backoff', {
              consecutiveFailures: _consecutiveFailures,
              backoffMs,
            });
            await sleep(backoffMs);
          }
          continue;
        }

        // Successful resolve — reset failure counter
        _consecutiveFailures = 0;

        await streamTrack(audioSource, streamUrl, cycleGeneration);
        successfulStreams += 1;

        // Minimum inter-track gap — avoids hammering SoundCloud CDN back-to-back
        if (_running && !_modeChanged && _generation === cycleGeneration) {
          await sleep(500);
        }

        if (_modeChanged || _generation !== cycleGeneration) break;
      }

      // If an entire playlist completed with zero successful streams, back off before
      // reloading to avoid hammering the DB and SoundCloud in a tight spin loop.
      if (successfulStreams === 0 && !_modeChanged && _generation === cycleGeneration) {
        logger.warn('[CristinaBot] Playlist completed with zero successful streams, sleeping 60s');
        await sleep(60_000);
      }
    }

    // Room disconnected — update observable state
    if (_running && !room.isConnected) {
      logger.warn('[CristinaBot] Room disconnected, will reconnect');
      try {
        const { getRedis } = require('../config/redis');
        await getRedis().set('mainstage:state', 'reconnecting', 'EX', 120);
      } catch {}
    }
  } finally {
    clearInterval(modeInterval);
  }
}

// ─── Streaming engine ───────────────────────────────────────────────────────

/**
 * Stream a track through ffmpeg with audio normalization into the AudioSource.
 *
 * ffmpeg pipeline:
 *   Input → loudnorm (volume normalize) → alimiter (clip prevention)
 *     → aresample (48kHz) → aformat (s16le stereo) → s16le PCM
 *
 * The loudnorm filter uses EBU R128 single-pass loudness normalization targeting
 * -14 LUFS (Spotify/YouTube streaming standard) with -1 dBTP true-peak ceiling.
 *
 * NOTE: Opus does NOT handle pre-encoder digital clipping — it encodes whatever
 * PCM it receives. The alimiter here is essential: it catches transients that
 * loudnorm's look-ahead misses and prevents hard clipping before the Opus encoder.
 * attack=5ms, release=50ms, asc=1 (auto-level) keeps dynamics natural.
 *
 * cycleGeneration is checked on close — if the generation has changed by the time
 * ffmpeg exits, the track was killed mid-play by a mode switch (expected).
 */
function streamTrack(audioSource, streamUrl, cycleGeneration) {
  return new Promise((resolve) => {
    const trackStartMs = Date.now();
    // Rolling tail of ffmpeg stderr so we can attach the last 100 chars to an
    // error log when ffmpeg exits non-zero or dies immediately.
    let stderrTail = '';
    let firstFrameSeen = false;
    const ffmpeg = spawn('ffmpeg', [
      // Input with reconnect for network resilience
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', streamUrl,

      // Audio filter chain:
      //   1. EBU R128 loudness normalization — -14 LUFS, -1 dBTP true-peak ceiling
      //   2. alimiter — prevents pre-encoder digital clipping on loud transients
      //      (Opus does NOT handle clipping — it encodes whatever PCM it receives)
      //   3. High-quality SoX resampling to 48 kHz
      //   4. Lock channel layout & sample format for stable Opus encoder input
      '-af', [
        'loudnorm=I=-14:TP=-1:LRA=11:print_format=none',
        'alimiter=level_in=1:level_out=0.891:limit=0.891:attack=5:release=50:asc=1',
        `aresample=${SAMPLE_RATE}:resampler=soxr:precision=28`,
        'aformat=channel_layouts=stereo:sample_fmts=s16:sample_rates=48000',
      ].join(','),

      // Output: raw PCM stereo 48kHz
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(NUM_CHANNELS),
      '-loglevel', 'error',
      'pipe:1',
    ]);
    _ffmpeg = ffmpeg;

    // ── Pre-allocated ring buffer for zero-GC frame delivery ────────────
    // Each slot is a pre-allocated Buffer that gets reused.
    const ringFrames = new Array(MAX_QUEUE_FRAMES);
    for (let i = 0; i < MAX_QUEUE_FRAMES; i++) {
      ringFrames[i] = Buffer.allocUnsafe(FRAME_SIZE_BYTES);
    }
    let ringHead = 0;  // write pointer
    let ringTail = 0;  // read pointer
    let ringCount = 0;  // frames buffered
    let draining = false;

    // Accumulation buffer for partial ffmpeg chunks
    let accum = Buffer.alloc(0);

    async function drainRing() {
      if (draining) return;
      draining = true;
      while (ringCount > 0) {
        const frameBuf = ringFrames[ringTail];
        ringTail = (ringTail + 1) % MAX_QUEUE_FRAMES;
        ringCount--;

        // Direct Int16Array view (LE on x86/ARM) — zero copy
        const samples = new Int16Array(
          frameBuf.buffer, frameBuf.byteOffset, frameBuf.length / BYTES_PER_SAMPLE
        );
        const audioFrame = new AudioFrame(samples, SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME);
        try {
          await audioSource.captureFrame(audioFrame);
          if (!firstFrameSeen) {
            firstFrameSeen = true;
            // First real audio frame of this track — force a heartbeat now
            // so "bot is actually publishing audio" is proven, not assumed.
            _writeHeartbeat(true);
          } else {
            // Debounced heartbeat on every subsequent frame; the helper
            // self-limits to ~1 write per HEARTBEAT_DEBOUNCE_MS.
            _writeHeartbeat(false);
          }
        } catch {
          // Frame dropped — non-fatal (room disconnected etc.)
        }
      }
      draining = false;
    }

    ffmpeg.stdout.on('data', (chunk) => {
      // Append to accumulation buffer
      if (accum.length === 0) {
        accum = chunk;
      } else {
        accum = Buffer.concat([accum, chunk]);
      }

      // Extract complete frames into ring buffer
      while (accum.length >= FRAME_SIZE_BYTES) {
        if (ringCount >= MAX_QUEUE_FRAMES) {
          // Ring full — drop oldest frame to prevent latency buildup
          ringTail = (ringTail + 1) % MAX_QUEUE_FRAMES;
          ringCount--;
        }
        // Copy frame data into the pre-allocated ring slot
        accum.copy(ringFrames[ringHead], 0, 0, FRAME_SIZE_BYTES);
        ringHead = (ringHead + 1) % MAX_QUEUE_FRAMES;
        ringCount++;

        // Advance the accumulation buffer
        accum = accum.subarray(FRAME_SIZE_BYTES);
      }

      drainRing();
    });

    ffmpeg.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) logger.warn('[CristinaBot] ffmpeg:', msg);
      // Keep a rolling ~400-char tail for post-mortem attach on close.
      stderrTail = (stderrTail + d.toString()).slice(-400);
    });

    ffmpeg.on('close', (code) => {
      _ffmpeg = null;
      const elapsedMs = Date.now() - trackStartMs;
      // Silent-failure guard: ffmpeg exited non-zero, OR the "track" was
      // unrealistically short (indicates ffmpeg died on startup, e.g. bad
      // filter chain). This is the failure mode where the bot *looks* running
      // but actually advances tracks every 1-2s and publishes nothing.
      const nonZeroExit = code !== 0 && code !== null;
      const suspiciouslyShort = elapsedMs < MIN_HEALTHY_TRACK_MS;
      if (nonZeroExit || suspiciouslyShort) {
        logger.error('[CristinaBot] ffmpeg exited abnormally', {
          exitCode: code,
          elapsedMs,
          track: _currentTrackTitle,
          firstFrameSeen,
          stderrTail: stderrTail.slice(-100),
        });
      }
      resolve();
    });
    ffmpeg.on('error', (err) => {
      _ffmpeg = null;
      logger.error('[CristinaBot] ffmpeg spawn error', {
        error: err?.message,
        track: _currentTrackTitle,
      });
      resolve();
    });
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

function start() {
  if (_running) return;
  _running = true;
  logger.info('[CristinaBot] Starting 24/7 Main Stage bot');
  runLoop();
}

async function stop() {
  _running = false;
  if (_ffmpeg) { try { _ffmpeg.kill('SIGKILL'); } catch {} }
  if (_room) { try { _room.disconnect(); } catch {} }
  _room = null;
  _ffmpeg = null;
  _currentRoomName = null;
  _currentTrackTitle = null;
  _currentTrackStartedAt = null;

  // Clear stale now-playing row so frontend doesn't show stale track info
  try {
    await query(
      `UPDATE radio_now_playing SET title = NULL, artist = NULL, updated_at = NOW() WHERE id = 1`
    );
  } catch {}

  logger.info('[CristinaBot] Stopped');
}

function setMode(mode) {
  _switchMode(mode);
  logger.info('[CristinaBot] Mode set externally', { mode });
}

function skipTrack() {
  if (_ffmpeg) { try { _ffmpeg.kill('SIGKILL'); } catch {} _ffmpeg = null; }
  logger.info('[CristinaBot] Track skipped');
}

async function runLoop() {
  while (_running) {
    try {
      await connectAndStream();
    } catch (err) {
      logger.error('[CristinaBot] Error in main loop', { error: err.message });
    }
    if (_running) {
      logger.info(`[CristinaBot] Reconnecting in ${_reconnectDelay / 1000}s`);
      // Publish reconnecting state to Redis so frontend can react
      try {
        const { getRedis } = require('../config/redis');
        await getRedis().set('mainstage:state', 'reconnecting', 'EX', 120);
      } catch {}
      await sleep(_reconnectDelay);
      // Exponential backoff: double delay up to max, reset happens on successful connect
      _reconnectDelay = Math.min(MAX_RECONNECT_DELAY_MS, _reconnectDelay * 2);
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getStatus() {
  return {
    running: _running,
    connected: _room?.isConnected ?? false,
    mode: _currentMode,
    label: MODE_LABEL_MAP[_currentMode] || 'flying',
  };
}

module.exports = { start, stop, setMode, skipTrack, getStatus };
