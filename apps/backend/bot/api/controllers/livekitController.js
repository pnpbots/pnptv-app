'use strict';

/**
 * livekitController.js
 *
 * Handles standalone LiveKit token endpoints (separate from the hangout call flow).
 *
 * Endpoints:
 *   POST /api/livekit/token   — generate a participant token for any room
 *   GET  /api/livekit/status  — check LiveKit service configuration
 */

const livekitService = require('../../services/livekitService');
const EntitlementAccessService = require('../../services/entitlementAccessService');
const logger = require('../../../utils/logger');

// Room name validation: only alphanumeric, hyphens, underscores
const ROOM_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * POST /api/livekit/token
 *
 * Body: { roomName: string, displayName?: string }
 * Returns: { success, token, wsUrl, roomName }
 *
 * Requires an active pnp-member entitlement.
 */
const getToken = async (req, res) => {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const userId = String(sessionUser.id);

    const { roomName, displayName } = req.body;

    if (!roomName || !ROOM_NAME_RE.test(roomName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing roomName (alphanumeric, hyphens, underscores only; max 128 chars)',
      });
    }

    if (!livekitService.isConfigured()) {
      return res.status(503).json({ success: false, error: 'Video service temporarily unavailable' });
    }

    // Require active membership
    const hasAccess = await EntitlementAccessService.hasEntitlement(userId, 'pnp-member');
    if (!hasAccess) {
      return res.status(403).json({ success: false, error: 'Active membership required' });
    }

    const name = displayName || sessionUser.firstName || sessionUser.username || 'User';
    const photoUrl = sessionUser.photoUrl || '';

    const token = await livekitService.generateToken(roomName, userId, name, photoUrl, false);

    logger.info('LiveKit token generated', { userId, roomName });

    return res.json({
      success: true,
      token,
      wsUrl: livekitService.LIVEKIT_WS_URL,
      roomName,
    });
  } catch (err) {
    logger.error('livekitController.getToken error', err);
    return res.status(500).json({ success: false, error: 'Failed to generate token' });
  }
};

/**
 * GET /api/livekit/status
 *
 * Returns LiveKit configuration status. Does not require authentication.
 */
const getStatus = async (_req, res) => {
  try {
    const configured = livekitService.isConfigured();
    return res.json({
      success: true,
      configured,
      wsUrl: configured ? livekitService.LIVEKIT_WS_URL : null,
      message: configured
        ? 'LiveKit is ready for video sessions'
        : 'LiveKit is not properly configured',
    });
  } catch (err) {
    logger.error('livekitController.getStatus error', err);
    return res.status(500).json({ success: false, error: 'Failed to check service status' });
  }
};

module.exports = { getToken, getStatus };
