const axios = require('axios');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const SYSTEM_USER_ID = 'pnptv-official';
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let syncTimer = null;

/**
 * Fetch published social_posts from Directus CMS and upsert into PostgreSQL.
 * - New/updated published items are upserted with is_promoted=true
 * - Items removed from published set are soft-deleted
 */
async function syncPromotedPosts() {
  if (!DIRECTUS_TOKEN) {
    logger.warn('[PromotedSync] DIRECTUS_ADMIN_TOKEN not configured — skipping sync');
    return { synced: 0, deleted: 0 };
  }

  try {
    const res = await axios.get(`${DIRECTUS_URL}/items/social_posts`, {
      params: {
        filter: { status: { _eq: 'published' } },
        fields: ['id', 'content', 'media', 'promoted_link', 'promoted_link_label', 'date_created', 'date_updated'],
        limit: 100,
      },
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
      timeout: 10000,
    });

    const items = res.data?.data || [];
    const directusIds = items.map(i => i.id);
    let synced = 0;

    for (const item of items) {
      // Build thumbnail URL from Directus file UUID
      const thumbnail = item.media
        ? `${DIRECTUS_URL}/assets/${item.media}`
        : null;

      await query(
        `INSERT INTO social_posts (user_id, content, is_promoted, promoted_link, promoted_link_label, promoted_thumbnail, directus_id, is_deleted)
         VALUES ($1, $2, true, $3, $4, $5, $6, false)
         ON CONFLICT (directus_id) WHERE directus_id IS NOT NULL
         DO UPDATE SET
           content = EXCLUDED.content,
           promoted_link = EXCLUDED.promoted_link,
           promoted_link_label = EXCLUDED.promoted_link_label,
           promoted_thumbnail = EXCLUDED.promoted_thumbnail,
           is_deleted = false`,
        [
          SYSTEM_USER_ID,
          item.content || '',
          item.promoted_link || null,
          item.promoted_link_label || null,
          thumbnail,
          item.id,
        ]
      );
      synced++;
    }

    // Soft-delete promoted posts whose directus_id is no longer in the published set
    let deleted = 0;
    if (directusIds.length > 0) {
      const result = await query(
        `UPDATE social_posts SET is_deleted = true
         WHERE is_promoted = true AND directus_id IS NOT NULL
           AND directus_id != ALL($1::int[])
           AND is_deleted = false`,
        [directusIds]
      );
      deleted = result.rowCount || 0;
    } else {
      // No published items — soft-delete all promoted posts
      const result = await query(
        `UPDATE social_posts SET is_deleted = true
         WHERE is_promoted = true AND directus_id IS NOT NULL AND is_deleted = false`
      );
      deleted = result.rowCount || 0;
    }

    logger.info(`[PromotedSync] Synced ${synced} promoted posts, soft-deleted ${deleted}`);
    return { synced, deleted };
  } catch (err) {
    logger.error(`[PromotedSync] Sync failed: ${err.message}`);
    return { synced: 0, deleted: 0, error: err.message };
  }
}

/**
 * POST /api/admin/social/sync-promoted — Manual trigger for admin
 */
async function handleSyncPromoted(req, res) {
  const result = await syncPromotedPosts();
  res.json({ success: !result.error, ...result });
}

/**
 * Start auto-sync: run immediately then every 15 minutes
 */
function startAutoSync() {
  // Fire initial sync after a short delay (let DB connections settle)
  setTimeout(() => {
    syncPromotedPosts().catch(err => {
      logger.error(`[PromotedSync] Initial sync error: ${err.message}`);
    });
  }, 5000);

  // Recurring sync
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    syncPromotedPosts().catch(err => {
      logger.error(`[PromotedSync] Interval sync error: ${err.message}`);
    });
  }, SYNC_INTERVAL_MS);
}

module.exports = {
  syncPromotedPosts,
  handleSyncPromoted,
  startAutoSync,
};
