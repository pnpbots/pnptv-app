'use strict';

/**
 * streamRecordingService.js
 * HLS VOD recording lifecycle: spawn ffmpeg, lifecycle control, retention cleanup.
 *
 * Storage: /app/public/uploads/recordings/<recordingId>/
 * Manifest: /uploads/recordings/<id>/index.m3u8 (served by Express static)
 * Max duration: 4 hours (-t 14400), codec: copy (no re-encode).
 *
 * Import path for callers in bot/api/socketHandlers.js:
 *   require('../../services/streamRecordingService')
 * Import path for callers in bot/api/controllers/*.js:
 *   require('../../../services/streamRecordingService')
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

// Module-level map: recordingId (number) → child_process
const _activeProcesses = new Map();
// Recording IDs that are waiting for Restreamer's HLS manifest to appear
// before spawning ffmpeg. Removed when ffmpeg spawns or when stopRecording
// is called before the manifest shows up.
const _pendingStarts = new Set();

const RECORDINGS_BASE = '/app/public/uploads/recordings';
const RESTREAMER_URL = process.env.RESTREAMER_URL || 'http://restreamer:8080';

// Thumbnail capture timeout (ms) — kills hung ffmpeg snapshot after this long
const THUMB_FFMPEG_TIMEOUT_MS = 30_000;

// HLS manifest readiness polling. Restreamer publishes /memfs/<channel>.m3u8
// only after the first RTMP keyframe arrives, which takes ~5–10s after stream
// start. Polling the manifest before spawning the recording ffmpeg avoids the
// guaranteed 404 → exit-code-1 → status='failed' that every recording was hitting.
const MANIFEST_POLL_MAX_MS = 45_000;
const MANIFEST_POLL_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * GET the Restreamer HLS manifest and return true when it represents a LIVE
 * (or recently live) stream.
 *
 * Restreamer serves two shapes:
 *   - Master playlist (#EXT-X-STREAM-INF) — what external clients receive on
 *     first hit; contains a session-bound child URL.
 *   - Media playlist (.ts segments, EXT-X-MEDIA-SEQUENCE) — what FFmpeg sees
 *     after following the session redirect.
 *
 * A 200 response on either is sufficient to signal "stream is live" because
 * Restreamer 404s the URL when the memfs entry has expired (idle channel).
 * The one trap is the media playlist's #EXT-X-ENDLIST marker, which Restreamer
 * leaves in place for up to 30 s after a stream ends. We must NOT start a
 * recording in that window — the underlying RTMP source is gone too.
 */
function _checkManifestOnce(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 32 * 1024) { res.destroy(); } });
      res.on('end', () => {
        // Reject the post-stream stale variant playlist.
        if (body.includes('#EXT-X-ENDLIST')) { resolve(false); return; }
        // Accept master (STREAM-INF) or media (.ts segments) — both indicate
        // Restreamer's memfs has a current stream entry for this channel.
        const isMaster = body.includes('#EXT-X-STREAM-INF');
        const isMedia = /\.ts\b/.test(body);
        resolve(isMaster || isMedia);
      });
      res.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Poll Restreamer for the channel's HLS manifest until it returns 200 or the
 * deadline is reached. Cancellable via _pendingStarts.delete(recordingId).
 *
 * Returns: 'ready' if manifest appeared, 'cancelled' if recordingId was
 * removed from _pendingStarts, 'timeout' otherwise.
 */
async function _waitForManifest(channelRef, recordingId) {
  const url = `${RESTREAMER_URL}/memfs/${channelRef}.m3u8`;
  const deadline = Date.now() + MANIFEST_POLL_MAX_MS;
  while (Date.now() < deadline) {
    if (!_pendingStarts.has(recordingId)) return 'cancelled';
    if (await _checkManifestOnce(url)) return 'ready';
    await new Promise((r) => setTimeout(r, MANIFEST_POLL_INTERVAL_MS));
  }
  return 'timeout';
}

/**
 * Sum the total size in bytes of all .ts segment files in a directory.
 * Returns 0 if the directory doesn't exist or is empty.
 */
async function _sumSegmentBytes(dir) {
  try {
    const entries = await fs.promises.readdir(dir);
    let total = 0;
    for (const entry of entries) {
      if (!entry.endsWith('.ts')) continue;
      try {
        const stat = await fs.promises.stat(path.join(dir, entry));
        total += stat.size;
      } catch {
        // skip unreadable files
      }
    }
    return total;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// _captureThumb — one-shot ffmpeg thumbnail attempt
// Returns true on success, false on any failure.
// Kills the ffmpeg child after THUMB_FFMPEG_TIMEOUT_MS to prevent hangs.
// ---------------------------------------------------------------------------

async function _captureThumb(recordingId) {
  const dir = path.join(RECORDINGS_BASE, String(recordingId));
  const manifest = path.join(dir, 'index.m3u8');
  const thumbPath = path.join(dir, 'thumb.jpg');
  const thumbUrl = `/uploads/recordings/${recordingId}/thumb.jpg`;

  // Verify manifest exists before trying to snapshot it.
  try {
    await fs.promises.access(manifest, fs.constants.R_OK);
  } catch {
    logger.info('streamRecording: thumb skip — manifest not readable yet', { recordingId });
    return false;
  }

  return new Promise((resolve) => {
    const ffmpegArgs = [
      '-y',
      '-i', manifest,
      '-vframes', '1',
      '-vf', 'scale=640:-1',
      '-q:v', '4',
      thumbPath,
    ];

    const child = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(-500); });

    // Kill guard: prevent runaway ffmpeg from blocking indefinitely
    const killTimer = setTimeout(() => {
      logger.warn('streamRecording: thumb ffmpeg timeout — killing', { recordingId });
      try { child.kill('SIGKILL'); } catch {}
    }, THUMB_FFMPEG_TIMEOUT_MS);

    child.on('close', async (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        logger.warn('streamRecording: thumb ffmpeg failed', { recordingId, code, stderr: stderr.trim().slice(0, 300) });
        resolve(false);
        return;
      }

      // Verify file exists with non-zero size
      try {
        const stat = await fs.promises.stat(thumbPath);
        if (stat.size === 0) {
          logger.warn('streamRecording: thumb file is empty', { recordingId });
          resolve(false);
          return;
        }
      } catch {
        logger.warn('streamRecording: thumb file missing after ffmpeg exit 0', { recordingId });
        resolve(false);
        return;
      }

      // Persist thumb_path to DB
      try {
        const pool = getPool();
        await pool.query(
          `UPDATE stream_recordings SET thumb_path = $1 WHERE id = $2`,
          [thumbUrl, recordingId]
        );
        logger.info('streamRecording: thumbnail captured', { recordingId, thumbUrl });
      } catch (dbErr) {
        logger.error('streamRecording: failed to persist thumb_path', { recordingId, error: dbErr.message });
      }

      resolve(true);
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      logger.error('streamRecording: thumb ffmpeg spawn error', { recordingId, error: err.message });
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// _scheduleThumbCapture — attempts at 30s, then 90s if first fails.
// Fire-and-forget; never throws.
// ---------------------------------------------------------------------------

function _scheduleThumbCapture(recordingId) {
  setTimeout(async () => {
    try {
      const ok = await _captureThumb(recordingId);
      if (!ok) {
        // Second attempt at 90s from start (60s after first attempt)
        setTimeout(async () => {
          try {
            await _captureThumb(recordingId);
          } catch (e) {
            logger.warn('streamRecording: thumb second attempt threw', { recordingId, error: e.message });
          }
        }, 60_000);
      }
    } catch (e) {
      logger.warn('streamRecording: thumb first attempt threw', { recordingId, error: e.message });
    }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// startRecording
// ---------------------------------------------------------------------------

/**
 * Spawn ffmpeg to record a live HLS stream to local VOD HLS segments.
 *
 * @param {{ sessionId: number|string|null, creatorId: string, channelRef: string }} opts
 * @returns {Promise<number>} recordingId (BIGINT as number)
 */
async function startRecording({ sessionId, creatorId, channelRef }) {
  const pool = getPool();

  // Insert DB row first so we have an id for the directory name.
  const { rows } = await pool.query(
    `INSERT INTO stream_recordings
       (session_id, creator_id, channel_ref, started_at, file_path, status)
     VALUES ($1, $2, $3, NOW(), $4, 'recording')
     RETURNING id`,
    [
      sessionId ? String(sessionId) : null,
      String(creatorId),
      channelRef,
      '', // placeholder; updated below once id is known
    ]
  );
  const recordingId = Number(rows[0].id);

  const dir = path.join(RECORDINGS_BASE, String(recordingId));
  const manifestPath = path.join(dir, 'index.m3u8');
  const segmentPattern = path.join(dir, 'seg_%05d.ts');
  const manifestUrl = `/uploads/recordings/${recordingId}/index.m3u8`;
  // _waitForManifest still polls Restreamer's HLS to detect when the stream
  // is actually live (proves RTMP is being ingested). But the recording itself
  // pulls from RTMP — HLS pulling raced against playlist updates and FFmpeg
  // EOF'd on stale ENDLIST markers, producing 1-segment "completed" recordings.
  const rtmpName = channelRef.startsWith('pnptv-') ? channelRef.slice('pnptv-'.length) : channelRef;
  const rtmpToken = process.env.RESTREAMER_RTMP_TOKEN;
  const inputUrl = rtmpToken
    ? `rtmp://restreamer:1935/live/${rtmpName}?token=${rtmpToken}`
    : `rtmp://restreamer:1935/live/${rtmpName}`;
  const inputUrlForLog = `rtmp://restreamer:1935/live/${rtmpName}${rtmpToken ? '?token=<redacted>' : ''}`;

  // Update file_path to the directory now that we know the id.
  await pool.query(
    `UPDATE stream_recordings SET file_path = $1, manifest_url = $2 WHERE id = $3`,
    [dir, manifestUrl, recordingId]
  );

  // Create directory before spawning ffmpeg.
  await fs.promises.mkdir(dir, { recursive: true });

  // Defer the actual ffmpeg spawn until Restreamer's HLS manifest is ready.
  // Pulling /memfs/<channel>.m3u8 immediately after stream:start always 404s
  // (no RTMP keyframe yet) and ffmpeg exits code=1. Mark the recording as
  // pending and return immediately so the caller has the recordingId for
  // cancellation via stopRecording.
  _pendingStarts.add(recordingId);
  logger.info('streamRecording: waiting for manifest', { recordingId, channelRef, inputUrl: inputUrlForLog });

  setImmediate(async () => {
    const result = await _waitForManifest(channelRef, recordingId);
    if (result !== 'ready') {
      _pendingStarts.delete(recordingId);
      const status = result === 'cancelled' ? 'cancelled' : 'failed';
      logger.warn('streamRecording: manifest never appeared', { recordingId, channelRef, result });
      try {
        await pool.query(
          `UPDATE stream_recordings SET status = $2, ended_at = NOW() WHERE id = $1`,
          [recordingId, status]
        );
      } catch (dbErr) {
        logger.error('streamRecording: failed to mark recording as failed', { recordingId, error: dbErr.message });
      }
      return;
    }

    // Manifest is live — spawn the recording ffmpeg.
    _pendingStarts.delete(recordingId);
    const ffmpegArgs = [
      // Be lenient about momentary upstream corruption — Restreamer's RTMP
      // server can briefly hiccup when the ingest process restarts.
      '-fflags', '+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-rw_timeout', '15000000', // 15 s socket timeout (microseconds)
      '-i', inputUrl,
      '-c', 'copy',
      '-t', '14400',
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', segmentPattern,
      manifestPath,
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    _activeProcesses.set(recordingId, ffmpeg);

    ffmpeg.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      if (line.includes('Error') || line.includes('error') || line.includes('Invalid')) {
        logger.warn('streamRecording: ffmpeg stderr', { recordingId, line: line.trim().slice(0, 200) });
      }
    });

    ffmpeg.on('close', async (code) => {
      _activeProcesses.delete(recordingId);
      const status = code === 0 ? 'completed' : 'failed';
      const sizeBytes = await _sumSegmentBytes(dir);
      try {
        const { rows: durRows } = await pool.query(
          `UPDATE stream_recordings
           SET ended_at = NOW(),
               duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER,
               size_bytes = $2,
               status = $3
           WHERE id = $1
           RETURNING duration_seconds`,
          [recordingId, sizeBytes, status]
        );
        logger.info('streamRecording: ffmpeg closed', {
          recordingId,
          code,
          status,
          sizeBytes,
          durationSeconds: durRows[0]?.duration_seconds,
        });
      } catch (dbErr) {
        logger.error('streamRecording: failed to update row on ffmpeg close', { recordingId, dbErr: dbErr.message });
      }
    });

    ffmpeg.on('error', (err) => {
      logger.error('streamRecording: ffmpeg spawn error', { recordingId, error: err.message });
      _activeProcesses.delete(recordingId);
      pool.query(
        `UPDATE stream_recordings SET status = 'failed', ended_at = NOW() WHERE id = $1`,
        [recordingId]
      ).catch(() => {});
    });

    logger.info('streamRecording: started', { recordingId, creatorId, channelRef, inputUrl: inputUrlForLog });
    _scheduleThumbCapture(recordingId);
  });

  return recordingId;
}

// ---------------------------------------------------------------------------
// stopRecording
// ---------------------------------------------------------------------------

/**
 * SIGTERM the ffmpeg process for a recording.
 * The 'close' handler above finalises the DB row.
 *
 * @param {number|null|undefined} recordingId
 */
async function stopRecording(recordingId) {
  if (!recordingId) return;
  // Cancel a pending manifest-wait before ffmpeg has spawned. _waitForManifest
  // checks _pendingStarts each iteration and returns 'cancelled' when removed.
  if (_pendingStarts.has(recordingId)) {
    _pendingStarts.delete(recordingId);
    logger.info('streamRecording: cancelled before manifest ready', { recordingId });
    return;
  }
  const proc = _activeProcesses.get(recordingId);
  if (!proc) {
    // Process already exited — ensure row is not stuck in 'recording'.
    const pool = getPool();
    await pool.query(
      `UPDATE stream_recordings
       SET status = CASE WHEN status = 'recording' THEN 'failed' ELSE status END,
           ended_at = COALESCE(ended_at, NOW())
       WHERE id = $1`,
      [recordingId]
    ).catch((e) => logger.warn('streamRecording: stopRecording no-proc update failed', { recordingId, error: e.message }));
    return;
  }
  try {
    proc.kill('SIGTERM');
    logger.info('streamRecording: SIGTERM sent', { recordingId });
  } catch (err) {
    logger.warn('streamRecording: failed to send SIGTERM', { recordingId, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// cleanupStuckRecordings
// ---------------------------------------------------------------------------

/**
 * At service boot, mark any rows with status='recording' whose ffmpeg process
 * is not in _activeProcesses as 'failed'. Keeps DB consistent after bot restart.
 * Call once at startup.
 */
async function cleanupStuckRecordings() {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT id FROM stream_recordings WHERE status = 'recording'`
    );
    if (rows.length === 0) return;
    const activeIds = new Set(_activeProcesses.keys());
    const stuckIds = rows.map((r) => Number(r.id)).filter((id) => !activeIds.has(id));
    if (stuckIds.length === 0) return;
    await pool.query(
      `UPDATE stream_recordings
       SET status = 'failed', ended_at = COALESCE(ended_at, NOW())
       WHERE id = ANY($1::bigint[])`,
      [stuckIds]
    );
    logger.info('streamRecording: cleanupStuckRecordings', { markedFailed: stuckIds });
  } catch (err) {
    logger.error('streamRecording: cleanupStuckRecordings error', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// deleteRecording
// ---------------------------------------------------------------------------

/**
 * Delete a recording's files and mark the DB row as deleted.
 * When requestingCreatorId is provided, only the owner may delete.
 * Pass requestingCreatorId=null to skip the owner check (system-driven expiry).
 *
 * @param {number} recordingId
 * @param {string|null} requestingCreatorId
 */
async function deleteRecording(recordingId, requestingCreatorId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT creator_id, file_path, status FROM stream_recordings WHERE id = $1`,
    [recordingId]
  );
  if (rows.length === 0) throw Object.assign(new Error('Recording not found'), { code: 'NOT_FOUND' });

  const rec = rows[0];

  if (requestingCreatorId && String(rec.creator_id) !== String(requestingCreatorId)) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  }

  // Remove ffmpeg process if still running
  const proc = _activeProcesses.get(recordingId);
  if (proc) {
    try { proc.kill('SIGKILL'); } catch {}
    _activeProcesses.delete(recordingId);
  }

  // Remove files
  if (rec.file_path) {
    await fs.promises.rm(rec.file_path, { recursive: true, force: true }).catch((err) => {
      logger.warn('streamRecording: deleteRecording fs.rm warning', { recordingId, error: err.message });
    });
  }

  await pool.query(
    `UPDATE stream_recordings
     SET status = 'deleted', is_deleted = TRUE, deleted_at = NOW()
     WHERE id = $1`,
    [recordingId]
  );

  logger.info('streamRecording: deleted', { recordingId, requestingCreatorId });
}

// ---------------------------------------------------------------------------
// expireOldRecordings
// ---------------------------------------------------------------------------

/**
 * Find completed recordings older than `days` days and delete them.
 * System-driven — no creator owner check.
 *
 * @param {number} [days=7]
 */
async function expireOldRecordings(days = 7) {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT id FROM stream_recordings
       WHERE status = 'completed'
         AND is_deleted = FALSE
         AND ended_at < NOW() - ($1 || ' days')::INTERVAL`,
      [days]
    );
    if (rows.length === 0) {
      logger.info('streamRecording: expireOldRecordings — nothing to expire');
      return;
    }
    let expired = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        await deleteRecording(Number(row.id), null);
        expired++;
      } catch (err) {
        errors++;
        logger.error('streamRecording: expireOldRecordings single delete failed', { id: row.id, error: err.message });
      }
    }
    logger.info('streamRecording: expireOldRecordings complete', { days, expired, errors });
  } catch (err) {
    logger.error('streamRecording: expireOldRecordings error', { error: err.message });
  }
}

// Run cleanup at module load time (non-blocking) so stuck rows are fixed on restart.
setImmediate(() => {
  cleanupStuckRecordings().catch((e) =>
    logger.warn('streamRecording: cleanupStuckRecordings boot error', { error: e.message })
  );
});

module.exports = {
  startRecording,
  stopRecording,
  cleanupStuckRecordings,
  deleteRecording,
  expireOldRecordings,
};
