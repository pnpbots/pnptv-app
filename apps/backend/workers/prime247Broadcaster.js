'use strict';

/**
 * Prime 24/7 Broadcaster
 *
 * Continuously pushes the published `prime_videos` Directus collection to
 * Restreamer's `pnptv-main` channel so the `/live/pnptv-main` HLS output is
 * always populated. Viewers on PNP Live see a pinned "PNPtv! 24/7" tile.
 *
 * Pipeline:
 *   Directus /items/prime_videos
 *     → /tmp/prime-playlist.txt (ffconcat v1.0)
 *     → ffmpeg -re -stream_loop -1 -f concat -i playlist.txt
 *         -c:v libx264 -c:a aac -f flv rtmp://restreamer:1935/live/main?token=…
 *
 * Playlist refresh: every 60 minutes (restarts ffmpeg).
 * Crash recovery: exponential backoff 5s → 30s → 2m → 5m cap, auto-respawn.
 * Gate: PRIME_247_ENABLED=true env var. Defaults off so a failing Directus
 * never prevents the bot from booting.
 *
 * Wire-up: apps/backend/bot/core/bot.js alongside orphanedMediaCleanup.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const PLAYLIST_PATH = '/tmp/prime-playlist.txt';
const PLAYLIST_REFRESH_MS = 60 * 60 * 1000; // 60 min
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

let ffmpegProc = null;
let refreshTimer = null;
let backoffMs = MIN_BACKOFF_MS;
let stopping = false;
let lastPlaylistHash = '';

function getConfig() {
  return {
    directusUrl: process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055',
    directusToken: process.env.DIRECTUS_ADMIN_TOKEN,
    // Use the public CMS URL for FFmpeg because ffmpeg-inside-bot resolves
    // docker DNS via its own libcurl, not the host's; the internal HTTP URL
    // works from the bot container, so prefer that to avoid NPM/TLS cost.
    directusAssetsBase: process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055',
    restreamerHost: process.env.RESTREAMER_HOST || 'restreamer',
    rtmpToken: process.env.RESTREAMER_RTMP_TOKEN || '',
    enabled: String(process.env.PRIME_247_ENABLED || '').toLowerCase() === 'true',
  };
}

async function fetchPublishedVideos() {
  const { directusUrl, directusToken } = getConfig();
  if (!directusToken) throw new Error('DIRECTUS_ADMIN_TOKEN not configured');

  const url = `${directusUrl}/items/prime_videos?limit=500&fields=id,title,video_file,status,type&filter[status][_eq]=published`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${directusToken}` } });
  if (!res.ok) throw new Error(`Directus returned ${res.status}`);
  const body = await res.json();
  const rows = (body.data || []).filter(v => v.type === 'video' && v.video_file);
  return rows;
}

function buildPlaylist(videos, assetsBase) {
  // ffconcat v1.0 demuxer syntax. 'file' lines reference each asset URL.
  // libcurl-via-ffmpeg resolves docker DNS so http://directus:8055/assets/<uuid>
  // works from inside the bot container.
  const lines = ['ffconcat version 1.0'];
  for (const v of videos) {
    lines.push(`# id=${v.id} — ${(v.title || '').replace(/[\r\n]/g, ' ').slice(0, 80)}`);
    lines.push(`file '${assetsBase}/assets/${v.video_file}'`);
  }
  return lines.join('\n') + '\n';
}

function hashPlaylist(text) {
  return require('crypto').createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function spawnFfmpeg() {
  const { restreamerHost, rtmpToken } = getConfig();
  const rtmpUrl = `rtmp://${restreamerHost}:1935/live/main${rtmpToken ? `?token=${rtmpToken}` : ''}`;

  // -reconnect* only apply to HTTP inputs passed via -i — our inputs are HTTP
  // URLs *inside* a concat playlist, so FFmpeg complains they aren't valid on
  // the concat demuxer. Omit them; the ffmpeg exit handler already respawns
  // on failure with exponential backoff.
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-re',
    '-stream_loop', '-1',
    '-f', 'concat',
    '-safe', '0',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,pipe',
    '-i', PLAYLIST_PATH,
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-b:v', '2500k',
    '-maxrate', '3000k',
    '-bufsize', '5000k',
    '-r', '30',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-f', 'flv',
    rtmpUrl,
  ];

  logger.info('[Prime247] spawning ffmpeg', { target: rtmpUrl.replace(/\?token=.+/, '?token=***') });
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim();
    if (!text) return;
    // FFmpeg writes progress + warnings to stderr. Keep warnings/errors visible,
    // drop periodic "frame=..." progress spam so logs stay useful.
    if (/^frame=/.test(text) || /^size=/.test(text)) return;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      logger.warn(`[Prime247:ffmpeg] ${line.slice(0, 240)}`);
    }
  });

  proc.on('exit', (code, signal) => {
    ffmpegProc = null;
    if (stopping) {
      logger.info('[Prime247] ffmpeg stopped cleanly', { code, signal });
      return;
    }
    logger.warn('[Prime247] ffmpeg exited unexpectedly — scheduling restart', { code, signal, backoffMs });
    setTimeout(() => {
      if (stopping) return;
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      runOnce().catch(err => logger.error('[Prime247] restart failed', { error: err.message }));
    }, backoffMs);
  });

  return proc;
}

async function runOnce() {
  if (stopping) return;
  if (ffmpegProc) {
    logger.debug('[Prime247] runOnce called while ffmpeg running — ignoring');
    return;
  }

  const videos = await fetchPublishedVideos();
  if (!videos.length) {
    logger.warn('[Prime247] No published prime videos found — retrying in 5 min');
    setTimeout(() => runOnce().catch(() => {}), 5 * 60 * 1000);
    return;
  }

  const { directusAssetsBase } = getConfig();
  const playlistText = buildPlaylist(videos, directusAssetsBase);
  const nextHash = hashPlaylist(playlistText);

  await fs.promises.writeFile(PLAYLIST_PATH, playlistText, 'utf8');
  lastPlaylistHash = nextHash;

  logger.info('[Prime247] playlist ready', { videoCount: videos.length, hash: nextHash });

  ffmpegProc = spawnFfmpeg();
  // Healthy spawn resets the backoff.
  backoffMs = MIN_BACKOFF_MS;
}

async function refreshPlaylist() {
  if (stopping) return;
  try {
    const videos = await fetchPublishedVideos();
    if (!videos.length) return;
    const { directusAssetsBase } = getConfig();
    const text = buildPlaylist(videos, directusAssetsBase);
    const nextHash = hashPlaylist(text);
    if (nextHash === lastPlaylistHash) {
      logger.debug('[Prime247] playlist unchanged, skipping restart');
      return;
    }
    await fs.promises.writeFile(PLAYLIST_PATH, text, 'utf8');
    lastPlaylistHash = nextHash;
    logger.info('[Prime247] playlist updated — restarting ffmpeg', { videoCount: videos.length, hash: nextHash });
    if (ffmpegProc && !ffmpegProc.killed) {
      // SIGTERM triggers the exit handler, which schedules a fast restart
      // with the freshly-written playlist.
      ffmpegProc.kill('SIGTERM');
    }
  } catch (err) {
    logger.warn('[Prime247] refreshPlaylist failed', { error: err.message });
  }
}

function start() {
  const { enabled, directusToken, rtmpToken } = getConfig();
  if (!enabled) {
    logger.info('[Prime247] disabled (PRIME_247_ENABLED != true) — not starting');
    return;
  }
  if (!directusToken) {
    logger.warn('[Prime247] DIRECTUS_ADMIN_TOKEN missing — broadcaster not started');
    return;
  }
  if (!rtmpToken) {
    logger.warn('[Prime247] RESTREAMER_RTMP_TOKEN missing — broadcaster not started');
    return;
  }

  stopping = false;
  logger.info('[Prime247] starting 24/7 broadcaster');
  // First run with a short delay so the bot is fully up and Restreamer's input
  // process is ready to accept RTMP.
  setTimeout(() => {
    runOnce().catch(err => logger.error('[Prime247] initial runOnce failed', { error: err.message }));
  }, 15_000);

  // Hourly playlist refresh (picks up newly-published CMS videos).
  refreshTimer = setInterval(() => {
    refreshPlaylist().catch(() => {});
  }, PLAYLIST_REFRESH_MS);
}

function stop() {
  stopping = true;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (ffmpegProc && !ffmpegProc.killed) {
    ffmpegProc.kill('SIGTERM');
  }
  logger.info('[Prime247] stopped');
}

module.exports = { start, stop };
