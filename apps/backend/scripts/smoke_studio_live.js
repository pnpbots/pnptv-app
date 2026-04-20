#!/usr/bin/env node
/**
 * Studio → Bot (Socket.IO) → FFmpeg → Restreamer (RTMP) → HLS smoke test.
 *
 * Reproduces a real creator going live without a browser:
 *   1. Re-uses an existing creator session (cookie from Redis).
 *   2. Provisions the channel if needed.
 *   3. Opens a socket.io connection with that cookie.
 *   4. Generates WebM/VP8+Opus with local `ffmpeg` (testsrc + sine).
 *   5. Fires stream:start + pipes WebM bytes as stream:data.
 *   6. Polls the Restreamer HLS manifest until segments appear.
 *
 * Exits 0 on success, 1 on any failure. Run:
 *   node apps/backend/scripts/smoke_studio_live.js [--sid <rawSid>]
 *
 * Defaults target the currently-provisioned "pnptv-creator" test channel
 * (JCBTN session). Override via --sid or env STUDIO_SMOKE_SID.
 */

'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const { io } = require('socket.io-client');

// ── Config ──────────────────────────────────────────────────────────────────

const STUDIO_ORIGIN = process.env.STUDIO_ORIGIN || 'https://studio.pnptv.app';
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://app.pnptv.app';
const LIVE_ORIGIN = process.env.LIVE_ORIGIN || 'https://live.pnptv.app';
const SESSION_SECRET = process.env.SESSION_SECRET;
const DEFAULT_SID = 'YcVv7Tjj01Yu8C3v_erUazfjoBgCo_Qx';
const STREAM_DURATION_SECONDS = 20;
const HLS_POLL_TIMEOUT_MS = 30_000;
const HLS_POLL_INTERVAL_MS = 2_000;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const rawSid = argValue('--sid') || process.env.STUDIO_SMOKE_SID || DEFAULT_SID;

if (!SESSION_SECRET) {
  console.error('✗ SESSION_SECRET env var required');
  process.exit(1);
}

// ── Steps ───────────────────────────────────────────────────────────────────

function signedCookie(sid) {
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `__pnptv_sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function httpsRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { method, headers, rejectUnauthorized: false };
    const req = https.request(url, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function checkAuth(cookie) {
  const r = await httpsRequest(`${STUDIO_ORIGIN}/api/auth-status`, {
    headers: { Cookie: cookie },
  });
  if (r.status !== 200 || !r.json?.authenticated) {
    throw new Error(`auth check failed: status=${r.status} body=${r.text.slice(0, 200)}`);
  }
  return r.json.user;
}

async function provisionChannel(cookie) {
  const r = await httpsRequest(`${STUDIO_ORIGIN}/api/webapp/live/provision-channel`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (r.status !== 200 || !r.json?.success) {
    throw new Error(`provision failed: status=${r.status} body=${r.text.slice(0, 200)}`);
  }
  return r.json; // { rtmpUrl, streamKey, channelRef, hlsUrl, alreadyProvisioned }
}

function connectSocket(cookie) {
  const socket = io(STUDIO_ORIGIN, {
    path: '/socket.io/',
    transports: ['websocket'],
    rejectUnauthorized: false,
    extraHeaders: { Cookie: cookie },
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('socket connect timeout (10s)'));
    }, 10_000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`socket connect_error: ${err.message}`));
    });
  });
}

function spawnWebmGenerator(durationSeconds) {
  // testsrc = colour-bar clock, sine = 440 Hz A4. libvpx/libopus for Studio parity.
  // -g 60 -keyint_min 30 forces keyframes ~every 2s @ 30fps so the receiver
  // can recover from any lost prefix bytes. -cluster_time_limit/size chunks
  // the WebM into smaller clusters so FFmpeg on the bot side sees frequent
  // parse boundaries.
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=duration=${durationSeconds}:size=640x360:rate=30`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSeconds}`,
    '-c:v', 'libvpx', '-b:v', '500k',
    '-g', '60', '-keyint_min', '30',
    '-deadline', 'realtime', '-cpu-used', '4',
    '-c:a', 'libopus', '-b:a', '96k',
    '-cluster_time_limit', '1000',
    '-f', 'webm',
    'pipe:1',
  ];
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => {
    const line = d.toString('utf8').trim();
    if (line) console.error(`  ffmpeg(gen): ${line.slice(0, 200)}`);
  });
  return proc;
}

async function runSmokeStream({ socket, channel }) {
  return new Promise((resolve, reject) => {
    let startedSeen = false;
    let bytesSent = 0;
    const preBuffer = []; // bytes produced before stream:started ack
    const generator = spawnWebmGenerator(STREAM_DURATION_SECONDS);

    const startTimeout = setTimeout(() => {
      if (!startedSeen) reject(new Error('stream:started never received (25s)'));
    }, 25_000);

    socket.once('stream:error', (err) => {
      clearTimeout(startTimeout);
      reject(new Error(`bot emitted stream:error: ${JSON.stringify(err).slice(0, 200)}`));
    });

    const drainPreBuffer = () => {
      for (const chunk of preBuffer) {
        socket.emit('stream:data', chunk);
        bytesSent += chunk.length;
      }
      preBuffer.length = 0;
    };

    socket.once('stream:started', (msg) => {
      startedSeen = true;
      clearTimeout(startTimeout);
      console.log(`  ← stream:started for channelRef=${msg.channelRef}, draining ${preBuffer.length} pre-buffered chunks`);
      drainPreBuffer();
    });

    // Buffer WebM bytes until stream:started, then stream live.
    generator.stdout.on('data', (chunk) => {
      if (!startedSeen) {
        preBuffer.push(chunk);
      } else {
        bytesSent += chunk.length;
        socket.emit('stream:data', chunk);
      }
    });

    generator.stdout.on('end', () => {
      // Flush any stragglers (shouldn't happen but be safe).
      if (startedSeen) drainPreBuffer();
      console.log(`  → generator finished (${bytesSent} bytes sent). Waiting 2s, then stopping…`);
      setTimeout(() => socket.emit('stream:stop'), 2_000);
    });

    generator.on('exit', (code) => {
      if (code !== 0 && !startedSeen) {
        clearTimeout(startTimeout);
        reject(new Error(`ffmpeg generator exited ${code} before stream:started`));
      }
    });

    socket.once('stream:stopped', (msg) => {
      console.log(`  ← stream:stopped reason=${msg.reason || 'n/a'}`);
      resolve({ bytesSent });
    });

    // Start the pipeline.
    socket.emit('stream:start', {
      channelRef: channel.channelRef,
      videoBitrate: 500_000,
      audioBitrate: 96_000,
      fps: 30,
      title: 'smoke test',
      description: 'synthetic testsrc stream',
      tags: ['smoke'],
      thumbnailDataUrl: null,
    });
    console.log(`  → stream:start sent (channelRef=${channel.channelRef})`);
  });
}

async function pollHlsForSegments(channelRef) {
  // Restreamer serves a MASTER playlist at /memfs/<ref>.m3u8 that points to a
  // variant at ?session=<token>. We follow the variant reference when present
  // AND try the first TS segment directly so either of two signals proves
  // the pipeline ran: a variant with #EXTINF, or a .ts segment on disk.
  const manifestUrl = `${LIVE_ORIGIN}/memfs/${channelRef}.m3u8`;
  const segmentUrl = `${LIVE_ORIGIN}/memfs/${channelRef}_0000.ts`;
  const deadline = Date.now() + HLS_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // Direct TS probe first — cheapest + session-free.
    const tsProbe = await httpsRequest(segmentUrl);
    if (tsProbe.status === 200 && tsProbe.text.length > 1024) {
      return {
        ok: true,
        manifestUrl,
        segmentBytes: tsProbe.text.length,
        detail: `first segment ${segmentUrl} is ${tsProbe.text.length} bytes`,
      };
    }

    const master = await httpsRequest(manifestUrl);
    if (master.status === 200 && /\.ts/.test(master.text)) {
      const segments = (master.text.match(/\.ts/g) || []).length;
      return { ok: true, manifestUrl, segmentCount: segments, detail: `master playlist references ${segments} .ts chunks` };
    }
    // Master → follow variant with session token
    if (master.status === 200) {
      const variantMatch = master.text.match(/^[^#\s].+\.m3u8[^\s]*/m);
      if (variantMatch) {
        const variantUrl = `${LIVE_ORIGIN}/memfs/${variantMatch[0]}`;
        const variant = await httpsRequest(variantUrl);
        if (variant.status === 200 && /#EXTINF/.test(variant.text)) {
          const segments = (variant.text.match(/\.ts/g) || []).length;
          return {
            ok: true,
            manifestUrl,
            segmentCount: segments,
            detail: `variant ${variantUrl.split('?')[0]}?session=… served ${segments} segments`,
          };
        }
      }
    }

    await new Promise((res) => setTimeout(res, HLS_POLL_INTERVAL_MS));
  }
  return { ok: false, manifestUrl };
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const cookie = signedCookie(rawSid);
  console.log(`≡ smoke_studio_live (sid=${rawSid.slice(0, 8)}… origin=${STUDIO_ORIGIN})`);

  try {
    console.log('→ step 1: auth-status');
    const user = await checkAuth(cookie);
    console.log(`  ✓ authenticated as ${user.username || user.telegram_id} (role=${user.role})`);

    console.log('→ step 2: provision-channel');
    const channel = await provisionChannel(cookie);
    console.log(`  ✓ channelRef=${channel.channelRef} streamKey=${channel.streamKey} already=${!!channel.alreadyProvisioned}`);

    console.log('→ step 3: socket.io connect');
    const socket = await connectSocket(cookie);
    console.log(`  ✓ connected sid=${socket.id}`);

    console.log(`→ step 4: stream ${STREAM_DURATION_SECONDS}s of synthetic WebM via socket`);
    const streamResult = await runSmokeStream({ socket, channel });
    console.log(`  ✓ streamed ${streamResult.bytesSent} bytes`);

    console.log('→ step 5: poll Restreamer HLS manifest');
    const hls = await pollHlsForSegments(channel.channelRef);
    if (!hls.ok) {
      throw new Error(`HLS manifest never produced segments at ${hls.manifestUrl} (waited ${HLS_POLL_TIMEOUT_MS / 1000}s)`);
    }
    console.log(`  ✓ ${hls.detail}`);

    socket.disconnect();
    console.log('\n=== ALL PASS ===');
    process.exit(0);
  } catch (err) {
    console.error(`\n✗ FAIL: ${err.message}`);
    process.exit(1);
  }
})();
