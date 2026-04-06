'use strict';
const mediaPackService = require('../../services/mediaPackService');
const logger = require('../../utils/logger');

// GET /api/webapp/media-packs?type=sticker|gif|emoji
async function listPacks(req, res) {
  try {
    const { type } = req.query;
    const validTypes = ['sticker', 'gif', 'emoji'];
    const packType = validTypes.includes(type) ? type : null;
    const packs = await mediaPackService.listActivePacks(packType);
    return res.json({ packs });
  } catch (err) {
    logger.error('[mediaPackController] listPacks:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// GET /api/webapp/media-packs/:slug/items
async function getPackItems(req, res) {
  try {
    const items = await mediaPackService.getPackItems(req.params.slug);
    return res.json({ items });
  } catch (err) {
    logger.error('[mediaPackController] getPackItems:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// GET /api/webapp/media-packs/search?q=crystal
async function searchItems(req, res) {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ items: [] });
  try {
    const items = await mediaPackService.searchItems(q.slice(0, 50));
    return res.json({ items });
  } catch (err) {
    logger.error('[mediaPackController] searchItems:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// GET /api/webapp/media-packs/favorites
async function getUserFavorites(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const items = await mediaPackService.getUserFavorites(user.id);
    return res.json({ items });
  } catch (err) {
    logger.error('[mediaPackController] getUserFavorites:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// POST /api/webapp/media-packs/items/:id/use
async function trackUsage(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const itemId = parseInt(req.params.id, 10);
  if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: 'Invalid item ID' });
  try {
    await mediaPackService.trackUsage(user.id, itemId);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('[mediaPackController] trackUsage:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// ── Admin ──

// POST /api/webapp/admin/media-packs
async function adminCreatePack(req, res) {
  const user = req.session?.user;
  try {
    const { slug, name, description, pack_type, cover_url, is_premium, sort_order } = req.body;
    if (!slug || !name || !pack_type) return res.status(400).json({ error: 'slug, name and pack_type are required' });
    const pack = await mediaPackService.createPack({
      slug, name, description, pack_type, cover_url, is_premium, sort_order, created_by: user?.id,
    });
    return res.status(201).json({ pack });
  } catch (err) {
    logger.error('[mediaPackController] adminCreatePack:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/webapp/admin/media-packs/:id/toggle
async function adminTogglePack(req, res) {
  const packId = parseInt(req.params.id, 10);
  if (!Number.isFinite(packId)) return res.status(400).json({ error: 'Invalid pack ID' });
  try {
    const pack = await mediaPackService.togglePackActive(packId, req.body.is_active);
    return res.json({ pack });
  } catch (err) {
    logger.error('[mediaPackController] adminTogglePack:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// DELETE /api/webapp/admin/media-packs/:id
async function adminDeletePack(req, res) {
  const packId = parseInt(req.params.id, 10);
  if (!Number.isFinite(packId)) return res.status(400).json({ error: 'Invalid pack ID' });
  try {
    await mediaPackService.deletePack(packId);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('[mediaPackController] adminDeletePack:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// POST /api/webapp/admin/media-packs/:packId/items
async function adminAddItem(req, res) {
  const packId = parseInt(req.params.packId, 10);
  if (!Number.isFinite(packId)) return res.status(400).json({ error: 'Invalid pack ID' });
  try {
    const { slug, name, alt_text, file_url, thumbnail_url, file_type, file_size_bytes, width_px, height_px, tags, sort_order } = req.body;
    if (!slug || !name || !file_url || !file_type) return res.status(400).json({ error: 'slug, name, file_url, file_type required' });
    const item = await mediaPackService.addItem({
      pack_id: packId, slug, name, alt_text, file_url, thumbnail_url, file_type,
      file_size_bytes, width_px, height_px, tags, sort_order,
    });
    return res.status(201).json({ item });
  } catch (err) {
    logger.error('[mediaPackController] adminAddItem:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/webapp/admin/media-packs/items/:id
async function adminDeleteItem(req, res) {
  const itemId = parseInt(req.params.id, 10);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'Invalid item ID' });
  try {
    await mediaPackService.deleteItem(itemId);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('[mediaPackController] adminDeleteItem:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = {
  listPacks, getPackItems, searchItems, getUserFavorites, trackUsage,
  adminCreatePack, adminTogglePack, adminDeletePack, adminAddItem, adminDeleteItem,
};
