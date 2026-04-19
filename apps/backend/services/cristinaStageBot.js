'use strict';

/**
 * Cristina Stage Bot — 24/7 LiveKit presence for the Main Stage.
 *
 * Streams mode-matched audio from the media library into a LiveKit room.
 * Optimized for smooth playback, bandwidth efficiency, and clean audio.
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

const MAX_QUEUE_FRAMES = 200; // 4 seconds of buffer for stability

const BOT_IDENTITY = 'cristina-ai';
const BOT_DISPLAY_NAME = 'Cristina AI';
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
let _generation = 0;
let _consecutiveFailures = 0;

// ─── Shared Buffer for the playback loop ────────────────────────────────────
const ringFrames = new Array(MAX_QUEUE_FRAMES);
for (let i = 0; i < MAX_QUEUE_FRAMES; i++) {
  ringFrames[i] = Buffer.allocUnsafe(FRAME_SIZE_BYTES);
}
let ringHead = 0;  // write pointer
let ringTail = 0;  // read pointer
let ringCount = 0;  // frames buffered
let _playbackLoopActive = false;

async function runPlaybackLoop(audioSource, generation) {
  if (_playbackLoopActive) return;
  _playbackLoopActive = true;
  
  logger.info('[CristinaBot] Playback loop started');

  const frameInterval = 20; // ms
  
  while (_running && _playbackLoopActive && _room && _room.isConnected) {
    const startTime = Date.now();

    if (ringCount > 0) {
      const frameBuf = ringFrames[ringTail];
      ringTail = (ringTail + 1) % MAX_QUEUE_FRAMES;
      ringCount--;

      const samples = new Int16Array(
        frameBuf.buffer, frameBuf.byteOffset, frameBuf.length / BYTES_PER_SAMPLE
      );
      const audioFrame = new AudioFrame(samples, SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME);
      
      try {
        await audioSource.captureFrame(audioFrame);
      } catch (err) {
        logger.warn('[CristinaBot] captureFrame error', { error: err.message });
      }
    }

    const elapsed = Date.now() - startTime;
    const sleepTime = Math.max(0, frameInterval - elapsed);
    await new Promise(r => setTimeout(r, sleepTime));
    
    // Check if generation changed (mode switch)
    if (_generation !== generation) {
      _playbackLoopActive = false;
      break;
    }
  }
  
  _playbackLoopActive = false;
  logger.info('[CristinaBot] Playback loop stopped');
}

// ─── Mode switch ─────────────────────────────────────────────────────────────

function _switchMode(newMode) {
  if (newMode === _currentMode) return;
  _currentMode = newMode;
  _modeChanged = true;
  _generation += 1;
  logger.info('[CristinaBot] Mode changed', { to: newMode, generation: _generation });
  if (_ffmpeg) {
    try { _ffmpeg.kill('SIGKILL'); } catch {}
    _ffmpeg = null;
  }
  // Reset buffer on mode switch
  ringCount = 0;
  ringHead = 0;
  ringTail = 0;
}

// ─── Mode change listener ───────────────────────────────────────────────────

function setupModeListener() {
  const interval = setInterval(async () => {
    if (!_running) { clearInterval(interval); return; }
    try {
      const { getRedis } = require('../config/redis');
      const mode = await getRedis().get('mainstage:mode') || 'ambient';
      if (mode !== _currentMode) _switchMode(mode);
    } catch {}
  }, 2000);
  return interval;
}

// ─── Core loop ──────────────────────────────────────────────────────────────

async function loadPlaylist(mode) {
  const label = MODE_LABEL_MAP[mode] || 'flying';
  const { rows } = await query(
    `SELECT id, title, url FROM media_library
     WHERE type = 'audio' AND url IS NOT NULL AND url != '' AND label = $1
     ORDER BY RANDOM() LIMIT 100`,
    [label]
  );
  return rows.length > 0 ? rows : (await query(`SELECT id, title, url FROM media_library WHERE type = 'audio' AND url IS NOT NULL AND url != '' ORDER BY RANDOM() LIMIT 100`)).rows;
}

async function resolveStreamUrl(soundcloudUrl) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', [
      '--no-warnings', '-q', '-f', 'bestaudio', '--get-url', soundcloudUrl,
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

async function connectAndStream() {
  const { rows: mainRows } = await query(`SELECT id FROM hangout_groups WHERE is_main = true LIMIT 1`);
  if (!mainRows.length) return;
  const roomName = `hangout-${mainRows[0].id}`;

  const token = await livekitService.generateToken(roomName, BOT_IDENTITY, BOT_DISPLAY_NAME, true);
  _room = new LKRoom();
  await _room.connect(BOT_LIVEKIT_URL, token, { autoSubscribe: false });

  const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('cristina-radio', audioSource);
  const publishOptions = new TrackPublishOptions();
  // SCREEN_SHARE_AUDIO (4) signals "system/music audio" to the SFU, which
  // selects the music-tuned Opus preset (stereo, full-band, no aggressive
  // VAD/noise-shaping). MICROPHONE (2) used the speech preset and made
  // music sound tinny on the client side.
  publishOptions.source = 4; // SCREEN_SHARE_AUDIO
  // 192 kbps stereo Opus is the sweet spot for music; 128 kbps was leaving
  // audible artifacts on dense mixes.
  publishOptions.audioEncoding = new AudioEncoding({ maxBitrate: BigInt(192_000) });
  publishOptions.dtx = false; // never silence quiet music passages
  publishOptions.red = true;  // packet-loss redundancy
  await _room.localParticipant.publishTrack(track, publishOptions);

  runPlaybackLoop(audioSource, _generation);

  const modeInterval = setupModeListener();
  try {
    while (_running && _room.isConnected) {
      const cycleGen = _generation;
      // Mode changes kill the playback loop (it exits when _generation shifts).
      // Restart it before decoding the next playlist so audio actually publishes.
      if (!_playbackLoopActive) {
        runPlaybackLoop(audioSource, cycleGen);
      }
      const playlist = await loadPlaylist(_currentMode);
      if (!playlist.length) { await new Promise(r => setTimeout(r, 10000)); continue; }

      for (const entry of playlist) {
        if (!_running || !_room.isConnected || _generation !== cycleGen) break;

        const streamUrl = await resolveStreamUrl(entry.url);
        if (!streamUrl) continue;

        await streamTrack(streamUrl, cycleGen);
        if (_generation !== cycleGen) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } finally {
    clearInterval(modeInterval);
  }
}

function streamTrack(streamUrl, generation) {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-i', streamUrl,
      '-af', [
        'loudnorm=I=-14:TP=-1.5:LRA=11',
        'alimiter=limit=0.9',
        `aresample=${SAMPLE_RATE}`,
        'aformat=channel_layouts=stereo:sample_fmts=s16:sample_rates=48000',
      ].join(','),
      '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', String(SAMPLE_RATE), '-ac', String(NUM_CHANNELS), '-loglevel', 'error', 'pipe:1',
    ]);
    _ffmpeg = ffmpeg;

    let accum = Buffer.alloc(0);

    ffmpeg.stdout.on('data', (chunk) => {
      accum = Buffer.concat([accum, chunk]);
      while (accum.length >= FRAME_SIZE_BYTES) {
        if (ringCount < MAX_QUEUE_FRAMES) {
          accum.copy(ringFrames[ringHead], 0, 0, FRAME_SIZE_BYTES);
          ringHead = (ringHead + 1) % MAX_QUEUE_FRAMES;
          ringCount++;
        }
        accum = accum.subarray(FRAME_SIZE_BYTES);
      }
    });

    ffmpeg.on('close', () => { _ffmpeg = null; resolve(); });
    ffmpeg.on('error', () => { _ffmpeg = null; resolve(); });
  });
}

function start() { if (!_running) { _running = true; runLoop(); } }
async function stop() { 
  _running = false; 
  if (_ffmpeg) _ffmpeg.kill('SIGKILL'); 
  if (_room) _room.disconnect(); 
  _playbackLoopActive = false;
}

async function runLoop() {
  while (_running) {
    try { await connectAndStream(); } catch (err) { logger.error('[CristinaBot] Error', { error: err.message }); }
    if (_running) await new Promise(r => setTimeout(r, 5000));
  }
}

module.exports = { start, stop, setMode: _switchMode, getStatus: () => ({ running: _running, mode: _currentMode }) };
