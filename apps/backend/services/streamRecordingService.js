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
const path = require('path');
const { spawn } = require('child_process');
const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

// Module-level map: recordingId (number) → child_process
const _activeProcesses = new Map();

const RECORDINGS_BASE = '/app/public/uploads/recordings';
const RESTREAMER_URL = process.env.RESTREAMER_URL || 'http://restreamer:8080';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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
  const inputUrl = `${RESTREAMER_URL}/memfs/${channelRef}.m3u8`;

  // Update file_path to the directory now that we know the id.
  await pool.query(
    `UPDATE stream_recordings SET file_path = $1, manifest_url = $2 WHERE id = $3`,
    [dir, manifestUrl, recordingId]
  );

  // Create directory before spawning ffmpeg.
  await fs.promises.mkdir(dir, { recursive: true });

  const ffmpegArgs = [
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
    // ffmpeg writes progress to stderr — only log warnings/errors
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

  logger.info('streamRecording: started', { recordingId, creatorId, channelRef, inputUrl });
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
