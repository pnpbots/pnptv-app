/**
 * Content → Social Feed Sync Controller
 *
 * Syncs published Directus "content" items (where publish_to_feed=true)
 * into social_posts — so CMS-managed videos appear in the social feed
 * with proper video_title / video_description.
 *
 * Runs on a 10-minute interval alongside the promoted posts sync.
 */

const axios = require('axios');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL || process.env.DIRECTUS_URL || 'http://directus:8055';
const DIRECTUS_PUBLIC_URL = process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let syncTimer = null;

/**
 * Resolve the user_id for a performer's pnptv_id.
 * Returns the user.id (text) or null.
 */
async function resolveUserId(pnptvId) {
  if (!pnptvId) return null;
  const res = await query(
    'SELECT id FROM users WHERE pnptv_id = $1 OR id::text = $1 LIMIT 1',
    [String(pnptvId)]
  );
  return res.rows[0]?.id || null;
}

/**
 * Build absolute media URL from a Directus content item.
 * content.media_url may be:
 *   - a full https:// URL (external)
 *   - a Directus file UUID
 *   - a relative /uploads/ path (local backend)
 */
function resolveMediaUrl(item) {
  if (!item.media_url) return null;
  if (item.media_url.startsWith('http')) return item.media_url;
  if (item.media_url.startsWith('/')) return item.media_url; // local uploads path
  // Assume it's a Directus file UUID
  return `${DIRECTUS_PUBLIC_URL}/assets/${item.media_url}`;
}

function resolveThumbnailUrl(item) {
  if (!item.thumbnail) return null;
  return `${DIRECTUS_PUBLIC_URL}/assets/${item.thumbnail}`;
}

/**
 * Main sync: fetch content items flagged for feed publishing
 * and upsert into social_posts.
 */
async function syncContentToFeed() {
  if (!DIRECTUS_TOKEN) {
    logger.warn('[ContentFeedSync] DIRECTUS_ADMIN_TOKEN not set — skipping');
    return { synced: 0, removed: 0 };
  }

  try {
    // Fetch published content with publish_to_feed = true
    const res = await axios.get(`${DIRECTUS_URL}/items/content`, {
      params: {
        filter: JSON.stringify({
          _and: [
            { status: { _eq: 'published' } },
            { publish_to_feed: { _eq: true } },
          ],
        }),
        fields: [
          'id', 'title', 'description', 'type', 'media_url', 'thumbnail',
          'is_premium', 'performer', 'social_post_id', 'date_created',
        ].join(','),
        // Resolve performer → pnptv_id
        deep: JSON.stringify({ performer: { _fields: ['id', 'pnptv_id', 'name'] } }),
        limit: 200,
      },
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
      timeout: 15000,
    });

    const items = res.data?.data || [];
    let synced = 0;

    // We also need performer details for each item — fetch performer IDs
    const performerIds = [...new Set(items.map(i => i.performer).filter(Boolean))];
    const performerMap = {};

    if (performerIds.length > 0) {
      const perfRes = await axios.get(`${DIRECTUS_URL}/items/performers`, {
        params: {
          filter: JSON.stringify({ id: { _in: performerIds } }),
          fields: 'id,pnptv_id,name',
          limit: 200,
        },
        headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
        timeout: 10000,
      });
      for (const p of (perfRes.data?.data || [])) {
        performerMap[p.id] = p;
      }
    }

    for (const item of items) {
      try {
        const performer = performerMap[item.performer];
        if (!performer?.pnptv_id) {
          logger.warn(`[ContentFeedSync] Content ${item.id} has no linked performer pnptv_id — skipping`);
          continue;
        }

        const userId = await resolveUserId(performer.pnptv_id);
        if (!userId) {
          logger.warn(`[ContentFeedSync] No user found for pnptv_id=${performer.pnptv_id} — skipping content ${item.id}`);
          continue;
        }

        const mediaUrl = resolveMediaUrl(item);
        const mediaType = (item.type === 'video' || item.type === 'clip') ? 'video' : 'image';
        const videoTitle = item.title || null;
        const videoDesc = item.description || null;
        const isExclusive = !!item.is_premium;
        const content = item.description
          ? `${item.title || ''}\n\n${item.description}`.trim()
          : (item.title || '');

        // Check if social post already exists for this content item
        const existing = await query(
          'SELECT id FROM social_posts WHERE content_directus_id = $1 LIMIT 1',
          [item.id]
        );

        if (existing.rows[0]) {
          // Update existing post
          await query(
            `UPDATE social_posts
             SET content = $1, media_url = $2, media_type = $3,
                 video_title = $4, video_description = $5,
                 is_exclusive = $6, is_deleted = false
             WHERE content_directus_id = $7`,
            [content, mediaUrl, mediaType, videoTitle, videoDesc, isExclusive, item.id]
          );
        } else {
          // Create new social post
          const insertRes = await query(
            `INSERT INTO social_posts
               (user_id, content, media_url, media_type, video_title, video_description,
                is_exclusive, is_shareable, content_directus_id, is_deleted)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, false)
             RETURNING id`,
            [userId, content, mediaUrl, mediaType, videoTitle, videoDesc, isExclusive, item.id]
          );

          const newPostId = insertRes.rows[0]?.id;

          // Write back social_post_id to Directus so the CMS shows the link
          if (newPostId) {
            await axios.patch(
              `${DIRECTUS_URL}/items/content/${item.id}`,
              { social_post_id: newPostId },
              { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } }
            ).catch(err => {
              logger.warn(`[ContentFeedSync] Failed to write social_post_id back to Directus content ${item.id}: ${err.message}`);
            });
          }
        }

        synced++;
      } catch (itemErr) {
        logger.error(`[ContentFeedSync] Error syncing content ${item.id}: ${itemErr.message}`);
      }
    }

    // Soft-delete social posts whose content was un-published or had publish_to_feed turned off
    const activeContentIds = items.map(i => i.id);
    let removed = 0;
    if (activeContentIds.length > 0) {
      const delRes = await query(
        `UPDATE social_posts SET is_deleted = true
         WHERE content_directus_id IS NOT NULL
           AND content_directus_id != ALL($1::int[])
           AND is_deleted = false`,
        [activeContentIds]
      );
      removed = delRes.rowCount || 0;
    } else {
      const delRes = await query(
        `UPDATE social_posts SET is_deleted = true
         WHERE content_directus_id IS NOT NULL AND is_deleted = false`
      );
      removed = delRes.rowCount || 0;
    }

    if (synced > 0 || removed > 0) {
      logger.info(`[ContentFeedSync] Synced ${synced} content items, soft-deleted ${removed}`);
    }
    return { synced, removed };
  } catch (err) {
    logger.error(`[ContentFeedSync] Sync failed: ${err.message}`);
    return { synced: 0, removed: 0, error: err.message };
  }
}

/** POST /api/admin/social/sync-content — manual trigger */
async function handleSyncContent(req, res) {
  const result = await syncContentToFeed();
  res.json({ success: !result.error, ...result });
}

/** Start recurring auto-sync */
function startContentFeedSync() {
  setTimeout(() => {
    syncContentToFeed().catch(err => {
      logger.error(`[ContentFeedSync] Initial sync error: ${err.message}`);
    });
  }, 8000); // Stagger after promoted sync

  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    syncContentToFeed().catch(err => {
      logger.error(`[ContentFeedSync] Interval sync error: ${err.message}`);
    });
  }, SYNC_INTERVAL_MS);
}

module.exports = {
  syncContentToFeed,
  handleSyncContent,
  startContentFeedSync,
};
