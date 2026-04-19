'use strict';

/**
 * creatorMediaController — CRUD + reorder for creator album media.
 *
 * Import path (CLAUDE.md): controllers are at bot/api/controllers/ so
 * services are at ../../../services/
 */

const creatorMediaService = require('../../../services/creatorMediaService');
const logger = require('../../../utils/logger');

function sendError(res, status, message, code) {
  return res.status(status).json({ success: false, error: { code, message } });
}

/**
 * GET /api/webapp/creators/:creatorId/media
 * Public — respects premium gating via canView flag.
 */
async function listMedia(req, res) {
  const { creatorId } = req.params;
  const viewerUserId = req.session?.user?.id || null;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const items = await creatorMediaService.listByCreator(creatorId, { viewerUserId, limit });
    return res.json({ success: true, items });
  } catch (err) {
    logger.error('creatorMediaController.listMedia error', { err: err.message, creatorId });
    return sendError(res, 500, 'Failed to list media', 'SERVER_ERROR');
  }
}

/**
 * POST /api/webapp/creators/media
 * Auth + creator-only.
 * Body: { type, url, thumbUrl?, caption?, isPremium? }
 */
async function addMedia(req, res) {
  const user = req.session?.user;
  if (!user) return sendError(res, 401, 'Not authenticated', 'AUTH_REQUIRED');

  const { type, url, thumbUrl, caption, isPremium } = req.body || {};
  if (!type || !url) return sendError(res, 400, 'type and url are required', 'VALIDATION_ERROR');

  try {
    const item = await creatorMediaService.addMedia(String(user.id), { type, url, thumbUrl, caption, isPremium });
    return res.status(201).json({ success: true, item });
  } catch (err) {
    const status = err.status || 500;
    logger.error('creatorMediaController.addMedia error', { err: err.message, userId: user.id });
    return sendError(res, status, err.message, status === 400 ? 'VALIDATION_ERROR' : 'SERVER_ERROR');
  }
}

/**
 * PATCH /api/webapp/creators/media/:id
 * Auth + owner-only (enforced at DB level in service).
 * Body: { url?, thumbUrl?, caption?, isPremium?, sortOrder? }
 */
async function updateMedia(req, res) {
  const user = req.session?.user;
  if (!user) return sendError(res, 401, 'Not authenticated', 'AUTH_REQUIRED');

  const { id } = req.params;
  const patch = req.body || {};

  try {
    const item = await creatorMediaService.updateMedia(id, String(user.id), patch);
    return res.json({ success: true, item });
  } catch (err) {
    const status = err.status || 500;
    logger.error('creatorMediaController.updateMedia error', { err: err.message, id, userId: user.id });
    return sendError(res, status, err.message, status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : 'SERVER_ERROR');
  }
}

/**
 * DELETE /api/webapp/creators/media/:id
 * Auth + owner-only.
 */
async function deleteMedia(req, res) {
  const user = req.session?.user;
  if (!user) return sendError(res, 401, 'Not authenticated', 'AUTH_REQUIRED');

  const { id } = req.params;

  try {
    await creatorMediaService.deleteMedia(id, String(user.id));
    return res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    logger.error('creatorMediaController.deleteMedia error', { err: err.message, id, userId: user.id });
    return sendError(res, status, err.message, status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR');
  }
}

/**
 * POST /api/webapp/creators/media/reorder
 * Auth + creator-only.
 * Body: { items: [{id, sort_order}] }
 */
async function reorderMedia(req, res) {
  const user = req.session?.user;
  if (!user) return sendError(res, 401, 'Not authenticated', 'AUTH_REQUIRED');

  const { items } = req.body || {};
  if (!Array.isArray(items)) return sendError(res, 400, 'items must be an array', 'VALIDATION_ERROR');

  try {
    const result = await creatorMediaService.reorderMedia(String(user.id), items);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('creatorMediaController.reorderMedia error', { err: err.message, userId: user.id });
    return sendError(res, 500, 'Failed to reorder media', 'SERVER_ERROR');
  }
}

module.exports = { listMedia, addMedia, updateMedia, deleteMedia, reorderMedia };
