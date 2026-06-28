'use strict';

/**
 * creatorMediaService — Creator album / media management.
 *
 * Import path convention (CLAUDE.md):
 *   bot/api/controllers/*.js → require('../../../services/creatorMediaService')
 */

const { query, getClient } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * List media for a creator, respecting premium gating.
 *
 * @param {string} creatorId
 * @param {{ viewerUserId?: string|null, limit?: number }} opts
 * @returns {Promise<Array>}
 */
async function listByCreator(creatorId, { viewerUserId = null, limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT id, media_type AS type, url, thumb_url, caption, is_premium, sort_order, created_at
     FROM creator_media
     WHERE creator_id = $1
     ORDER BY sort_order ASC, created_at DESC
     LIMIT $2`,
    [creatorId, Math.min(limit, 200)]
  );

  // Determine if viewer is the creator themselves
  const isSelf = viewerUserId && String(viewerUserId) === String(creatorId);

  // For premium items we need to check entitlements once (lazy require to avoid
  // circular deps — same pattern as hangoutGroupController).
  let entitledToCreator = false;
  if (!isSelf && viewerUserId) {
    try {
      const EntitlementAccessService = require('./entitlementAccessService');
      const result = await EntitlementAccessService.hasResourceAccess(
        String(viewerUserId),
        'creator',
        String(creatorId)
      );
      entitledToCreator = result.allowed === true;
    } catch (err) {
      logger.warn('creatorMediaService: entitlement check failed', { err: err.message, viewerUserId, creatorId });
    }
  }

  return rows.map((row) => {
    const canView = !row.is_premium || isSelf || entitledToCreator;
    return {
      id: String(row.id),
      type: row.type,
      url: canView ? row.url : null,
      thumbUrl: canView ? row.thumb_url : null,
      caption: row.caption || null,
      isPremium: row.is_premium,
      canView,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    };
  });
}

/**
 * Add a media item to a creator's album.
 */
async function addMedia(creatorId, { type, url, thumbUrl = null, caption = null, isPremium = false }) {
  if (!['photo', 'video'].includes(type)) throw Object.assign(new Error('Invalid media_type'), { status: 400 });
  if (!url || typeof url !== 'string') throw Object.assign(new Error('url is required'), { status: 400 });

  const { rows } = await query(
    `INSERT INTO creator_media (creator_id, media_type, url, thumb_url, caption, is_premium, sort_order)
     VALUES ($1::text, $2, $3, $4, $5, $6,
       COALESCE((SELECT MAX(sort_order) + 1 FROM creator_media WHERE creator_id = $1::text), 0))
     RETURNING id, media_type AS type, url, thumb_url, caption, is_premium, sort_order, created_at`,
    [creatorId, type, url, thumbUrl, caption, isPremium]
  );

  const row = rows[0];
  return {
    id: String(row.id),
    type: row.type,
    url: row.url,
    thumbUrl: row.thumb_url,
    caption: row.caption,
    isPremium: row.is_premium,
    sortOrder: row.sort_order,
    canView: true,
    createdAt: row.created_at,
  };
}

/**
 * Update a media item — only the owner (creatorId) can update.
 */
async function updateMedia(mediaId, creatorId, patch) {
  const allowed = ['url', 'thumb_url', 'caption', 'is_premium', 'sort_order'];
  const setClauses = [];
  const values = [];
  let idx = 1;

  if (patch.url !== undefined)         { setClauses.push(`url = $${idx++}`);         values.push(patch.url); }
  if (patch.thumbUrl !== undefined)    { setClauses.push(`thumb_url = $${idx++}`);    values.push(patch.thumbUrl); }
  if (patch.caption !== undefined)     { setClauses.push(`caption = $${idx++}`);      values.push(patch.caption); }
  if (patch.isPremium !== undefined)   { setClauses.push(`is_premium = $${idx++}`);   values.push(!!patch.isPremium); }
  if (patch.sortOrder !== undefined)   { setClauses.push(`sort_order = $${idx++}`);   values.push(patch.sortOrder); }

  if (setClauses.length === 0) throw Object.assign(new Error('No updatable fields'), { status: 400 });

  values.push(mediaId, creatorId);
  const { rows } = await query(
    `UPDATE creator_media SET ${setClauses.join(', ')}
     WHERE id = $${idx} AND creator_id = $${idx + 1}
     RETURNING id, media_type AS type, url, thumb_url, caption, is_premium, sort_order`,
    values
  );

  if (rows.length === 0) throw Object.assign(new Error('Not found or not owned by creator'), { status: 404 });
  const row = rows[0];
  return { id: String(row.id), type: row.type, url: row.url, thumbUrl: row.thumb_url, caption: row.caption, isPremium: row.is_premium, sortOrder: row.sort_order, canView: true };
}

/**
 * Delete a media item — only the owner can delete.
 */
async function deleteMedia(mediaId, creatorId) {
  const { rowCount } = await query(
    'DELETE FROM creator_media WHERE id = $1 AND creator_id = $2',
    [mediaId, creatorId]
  );
  if (rowCount === 0) throw Object.assign(new Error('Not found or not owned by creator'), { status: 404 });
  return { deleted: true };
}

/**
 * Atomically reorder media items via CASE WHEN.
 * @param {string} creatorId
 * @param {Array<{id: string|number, sort_order: number}>} items
 */
async function reorderMedia(creatorId, items) {
  if (!Array.isArray(items) || items.length === 0) return { updated: 0 };

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Build CASE WHEN for a single UPDATE statement
    const caseClause = items.map((_, i) => `WHEN id = $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ');
    const idList = items.map((_, i) => `$${i * 2 + 1}`).join(', ');
    const params = [];
    for (const item of items) {
      params.push(String(item.id), Number(item.sort_order));
    }
    params.push(creatorId);

    const { rowCount } = await client.query(
      `UPDATE creator_media
       SET sort_order = CASE ${caseClause} END
       WHERE id IN (${idList}) AND creator_id = $${params.length}`,
      params
    );

    await client.query('COMMIT');
    return { updated: rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listByCreator, addMedia, updateMedia, deleteMedia, reorderMedia };
