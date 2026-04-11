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
 *   - Volume normalization + limiter prevents clipping
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
const RECONNECT_DELAY_MS = 10_000;
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

// ─── Mode change listener ───────────────────────────────────────────────────

function setupModeListener() {
  const interval = setInterval(async () => {
    if (!_running) { clearInterval(interval); return; }
    try {
      const { getRedis } = require('../config/redis');
      const mode = await getRedis().get('mainstage:mode') || 'ambient';
      if (mode !== _currentMode) {
        const oldMode = _currentMode;
        _currentMode = mode;
        _modeChanged = true;
        logger.info('[CristinaBot] Mode changed', { from: oldMode, to: mode });
        if (_ffmpeg) { try { _ffmpeg.kill('SIGKILL'); } catch {} _ffmpeg = null; }
      }
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
  logger.info('[CristinaBot] Connected', { roomName, mode: _currentMode });

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
      _modeChanged = false;
      const playlist = await loadPlaylist(_currentMode);
      if (!playlist.length) {
        logger.warn('[CristinaBot] No tracks, waiting 30s', { mode: _currentMode });
        await sleep(30_000);
        continue;
      }

      const modeLabel = MODE_LABEL_MAP[_currentMode] || 'flying';
      logger.info('[CristinaBot] Playlist loaded', { mode: _currentMode, label: modeLabel, tracks: playlist.length });

      for (const entry of playlist) {
        if (!_running || !room.isConnected || _modeChanged) break;

        logger.info('[CristinaBot] Now playing', { title: entry.title, mode: _currentMode });
        await query(
          `INSERT INTO radio_now_playing (id, title, artist, started_at, updated_at)
           VALUES (1, $1, $2, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET title = $1, artist = $2, started_at = NOW(), updated_at = NOW()`,
          [entry.title, `PNP Radio — ${modeLabel}`]
        ).catch(() => {});

        const streamUrl = await resolveStreamUrl(entry.url);
        if (!streamUrl) {
          logger.warn('[CristinaBot] Resolve failed, skipping', { title: entry.title });
          continue;
        }

        await streamTrack(audioSource, streamUrl);
        if (_modeChanged) break;
      }
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
 *   Input → loudnorm (volume normalize) → aresample (48kHz) → limiter → s16le PCM
 *
 * The loudnorm filter uses EBU R128 two-pass loudness normalization.
 * Single-pass mode (linear=false) works in real-time and targets -16 LUFS
 * which is the standard for music streaming (Spotify/YouTube level).
 *
 * The alimiter prevents clipping on loud transients.
 */
function streamTrack(audioSource, streamUrl) {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      // Input with reconnect for network resilience
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', streamUrl,

      // Audio filter chain: gentle normalization → high-quality resample → format guard
      // Less aggressive than before: louder target (-14 LUFS), more headroom, no hard limiter
      // (the previous alimiter was coloring transients — Opus handles clipping gracefully on its own).
      '-af', [
        // EBU R128 loudness normalization — -14 LUFS (Spotify/YouTube streaming standard)
        // -1 dB true-peak headroom leaves room for Opus encoder without audible clipping
        'loudnorm=I=-14:TP=-1:LRA=11:print_format=none',
        // High-quality resampling to target rate via SoX resampler
        `aresample=${SAMPLE_RATE}:resampler=soxr:precision=28`,
        // Lock channel layout & sample format so Opus encoder has stable input
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
    });

    ffmpeg.on('close', () => { _ffmpeg = null; resolve(); });
    ffmpeg.on('error', () => { _ffmpeg = null; resolve(); });
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

function start() {
  if (_running) return;
  _running = true;
  logger.info('[CristinaBot] Starting 24/7 Main Stage bot');
  runLoop();
}

function stop() {
  _running = false;
  if (_ffmpeg) { try { _ffmpeg.kill('SIGKILL'); } catch {} }
  if (_room) { try { _room.disconnect(); } catch {} }
  _room = null;
  _ffmpeg = null;
  logger.info('[CristinaBot] Stopped');
}

function setMode(mode) {
  if (mode === _currentMode) return;
  _currentMode = mode;
  _modeChanged = true;
  if (_ffmpeg) { try { _ffmpeg.kill('SIGKILL'); } catch {} _ffmpeg = null; }
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
      logger.info(`[CristinaBot] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
      await sleep(RECONNECT_DELAY_MS);
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
