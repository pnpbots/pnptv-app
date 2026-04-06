'use strict';
const { query } = require('../config/postgres');

async function listActivePacks(packType = null) {
  const params = [];
  let typeFilter = '';
  if (packType) {
    params.push(packType);
    typeFilter = `AND p.pack_type = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT p.*, COUNT(i.id)::int AS item_count
     FROM custom_media_packs p
     LEFT JOIN custom_media_items i ON i.pack_id = p.id AND i.is_active = true
     WHERE p.is_active = true ${typeFilter}
     GROUP BY p.id
     ORDER BY p.sort_order, p.created_at`,
    params
  );
  return rows;
}

async function getPackItems(packSlug) {
  const { rows } = await query(
    `SELECT i.*
     FROM custom_media_items i
     JOIN custom_media_packs p ON p.id = i.pack_id
     WHERE p.slug = $1 AND p.is_active = true AND i.is_active = true
     ORDER BY i.sort_order, i.id`,
    [packSlug]
  );
  return rows;
}

async function searchItems(searchQuery, limit = 24) {
  const { rows } = await query(
    `SELECT i.*, p.name AS pack_name, p.pack_type
     FROM custom_media_items i
     JOIN custom_media_packs p ON p.id = i.pack_id
     WHERE i.is_active = true AND p.is_active = true
       AND ($1 = ANY(i.tags) OR i.name ILIKE $2)
     ORDER BY i.use_count DESC, i.sort_order
     LIMIT $3`,
    [searchQuery.toLowerCase(), `%${searchQuery}%`, limit]
  );
  return rows;
}

async function getUserFavorites(userId, limit = 16) {
  const { rows } = await query(
    `SELECT i.*, f.last_used_at, f.use_count AS user_use_count
     FROM user_media_favorites f
     JOIN custom_media_items i ON i.id = f.item_id
     WHERE f.user_id = $1 AND i.is_active = true
     ORDER BY f.last_used_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function trackUsage(userId, itemId) {
  await query('UPDATE custom_media_items SET use_count = use_count + 1 WHERE id = $1', [itemId]);
  await query(
    `INSERT INTO user_media_favorites (user_id, item_id, last_used_at, use_count)
     VALUES ($1, $2, NOW(), 1)
     ON CONFLICT (user_id, item_id) DO UPDATE
       SET last_used_at = NOW(), use_count = user_media_favorites.use_count + 1`,
    [userId, itemId]
  );
}

// ── Admin operations ──

async function createPack({ slug, name, description, pack_type, cover_url, is_premium, sort_order, created_by }) {
  const { rows } = await query(
    `INSERT INTO custom_media_packs (slug, name, description, pack_type, cover_url, is_premium, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [slug, name, description || null, pack_type, cover_url || null, is_premium || false, sort_order || 0, created_by || null]
  );
  return rows[0];
}

async function addItem({ pack_id, slug, name, alt_text, file_url, thumbnail_url, file_type, file_size_bytes, width_px, height_px, tags, sort_order }) {
  const { rows } = await query(
    `INSERT INTO custom_media_items
       (pack_id, slug, name, alt_text, file_url, thumbnail_url, file_type, file_size_bytes, width_px, height_px, tags, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [pack_id, slug, name, alt_text || null, file_url, thumbnail_url || null, file_type, file_size_bytes || null, width_px || null, height_px || null, tags || [], sort_order || 0]
  );
  return rows[0];
}

async function togglePackActive(packId, isActive) {
  const { rows } = await query(
    'UPDATE custom_media_packs SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [isActive, packId]
  );
  return rows[0];
}

async function deletePack(packId) {
  await query('DELETE FROM custom_media_packs WHERE id=$1', [packId]);
}

async function deleteItem(itemId) {
  await query('DELETE FROM custom_media_items WHERE id=$1', [itemId]);
}

module.exports = {
  listActivePacks,
  getPackItems,
  searchItems,
  getUserFavorites,
  trackUsage,
  createPack,
  addItem,
  togglePackActive,
  deletePack,
  deleteItem,
};
