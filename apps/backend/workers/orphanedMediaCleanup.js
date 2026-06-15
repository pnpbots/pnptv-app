'use strict';

/**
 * Orphaned Media Cleanup Worker
 *
 * Deletes files on disk for soft-deleted chat_messages that have a media_url
 * and were deleted more than 30 days ago.  Runs every 6 hours.
 *
 * Wire-up: apps/backend/bot/core/bot.js (alongside other scheduler inits)
 */

const fs = require('fs').promises;
const path = require('path');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

// Hangouts upload root — the only directory we are allowed to delete from.
// __dirname = /app/apps/backend/workers → three levels up = /app → then public/uploads/hangouts
const HANGOUTS_UPLOAD_ROOT = path.resolve(__dirname, '../../..', 'public', 'uploads', 'hangouts');

// How many rows to process per run (avoid long-running transactions)
const BATCH_LIMIT = 500;

// Interval between runs (6 hours in ms)
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Resolve a media_url stored in the DB (e.g. "/uploads/hangouts/42/foo.webp")
 * to an absolute file-system path, and confirm it is inside HANGOUTS_UPLOAD_ROOT.
 *
 * Returns null if the path is outside the allowed root (path-traversal guard).
 *
 * @param {string} mediaUrl
 * @returns {string|null}
 */
function resolveHangoutPath(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== 'string') return null;

  // Strip leading slash for path.resolve
  const relative = mediaUrl.replace(/^\//, '');
  const resolved = path.resolve(__dirname, '../../..', 'public', relative);

  // Path-traversal guard: resolved path MUST start with the hangouts upload root
  if (!resolved.startsWith(HANGOUTS_UPLOAD_ROOT + path.sep) && resolved !== HANGOUTS_UPLOAD_ROOT) {
    logger.warn('[OrphanedMediaCleanup] Path traversal blocked', { mediaUrl, resolved });
    return null;
  }

  return resolved;
}

/**
 * Run one cleanup pass:
 * 1. Query up to BATCH_LIMIT soft-deleted chat messages older than 30 days that still have media_url.
 * 2. For each, attempt fs.unlink.
 * 3. On successful unlink, NULL out media_url so the row is not retried next run.
 *
 * @returns {Promise<number>} Number of files successfully deleted.
 */
async function runOnce() {
  logger.info('[OrphanedMediaCleanup] Starting cleanup pass');

  let deleted = 0;

  try {
    await fs.access(HANGOUTS_UPLOAD_ROOT);
  } catch {
    logger.error('[OrphanedMediaCleanup] Upload root inaccessible — aborting run', { path: HANGOUTS_UPLOAD_ROOT });
    return 0;
  }

  try {
    const { rows } = await query(
      // chat_messages has no updated_at column — use edited_at (set when the
      // message was last mutated, including the soft-delete edit) with a
      // created_at fallback so rows deleted before edit tracking existed
      // still get collected after the full retention window.
      `SELECT id, media_url, content FROM chat_messages
       WHERE is_deleted = TRUE
         AND media_url IS NOT NULL
         AND COALESCE(edited_at, created_at) < NOW() - INTERVAL '30 days'
       LIMIT $1`,
      [BATCH_LIMIT]
    );

    if (rows.length === 0) {
      logger.info('[OrphanedMediaCleanup] No orphaned media found — nothing to do');
      return 0;
    }

    logger.info(`[OrphanedMediaCleanup] Processing ${rows.length} orphaned media rows`);

    for (const row of rows) {
      const filePath = resolveHangoutPath(row.media_url);

      if (!filePath) {
        // Path is outside hangouts root — stop retrying it
        await query(
          `UPDATE chat_messages SET media_url = NULL WHERE id = $1 AND (content IS NOT NULL AND content <> '')`,
          [row.id]
        ).catch(() => {});
        // If content is also empty the UPDATE above matched 0 rows; hard-delete to satisfy the constraint
        await query(
          `DELETE FROM chat_messages WHERE id = $1 AND (content IS NULL OR content = '')`,
          [row.id]
        ).catch((err) => {
          logger.error('[OrphanedMediaCleanup] Failed to clean non-hangout row', { id: row.id, error: err.message });
        });
        continue;
      }

      try {
        await fs.unlink(filePath);
        deleted += 1;
      } catch (unlinkErr) {
        if (unlinkErr.code === 'ENOENT') {
          // File already gone — still clear the row so we don't retry
          logger.debug('[OrphanedMediaCleanup] File already absent, clearing row', { id: row.id, filePath });
        } else {
          logger.warn('[OrphanedMediaCleanup] Could not unlink file — skipping row', {
            id: row.id,
            filePath,
            error: unlinkErr.message,
          });
          continue; // Don't clear; will retry next run when the I/O issue resolves
        }
      }

      // Clear the row: null media_url if content exists, otherwise delete the row entirely
      await query(
        `UPDATE chat_messages SET media_url = NULL WHERE id = $1 AND (content IS NOT NULL AND content <> '')`,
        [row.id]
      ).catch(() => {});
      await query(
        `DELETE FROM chat_messages WHERE id = $1 AND (content IS NULL OR content = '')`,
        [row.id]
      ).catch((err) => {
        logger.error('[OrphanedMediaCleanup] Failed to clear row after delete', { id: row.id, error: err.message });
      });
    }
  } catch (err) {
    logger.error('[OrphanedMediaCleanup] Query failed', { error: err.message });
  }

  logger.info(`[OrphanedMediaCleanup] Cleanup pass complete — deleted ${deleted} file(s)`);
  return deleted;
}

/**
 * Start the recurring cleanup scheduler.
 * First run is delayed by 10 minutes after startup to avoid competing with
 * database migrations and warm-up queries.
 */
function start() {
  const INITIAL_DELAY_MS = 10 * 60 * 1000; // 10 minutes

  setTimeout(() => {
    runOnce().catch((err) => {
      logger.error('[OrphanedMediaCleanup] Initial run failed', { error: err.message });
    });

    setInterval(() => {
      runOnce().catch((err) => {
        logger.error('[OrphanedMediaCleanup] Scheduled run failed', { error: err.message });
      });
    }, RUN_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  logger.info('[OrphanedMediaCleanup] Scheduler registered (first run in 10 min, then every 6h)');
}

module.exports = { start, runOnce };
