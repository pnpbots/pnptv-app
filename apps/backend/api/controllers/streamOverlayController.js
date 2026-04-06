'use strict';

const logger = require('../../utils/logger');
const { getPool } = require('../../config/postgres');
const socketSingleton = require('../../services/socketSingleton');

// Channel ref validation: alphanumeric + hyphens only (matches Restreamer slugs like 'pnptv-frank')
const CHANNEL_REF_RE = /^[a-zA-Z0-9-]+$/;

// CSS color validation — accepts hex (#RGB, #RRGGBB, #RRGGBBAA), rgb/rgba/hsl/hsla, and keywords
const CSS_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^(rgb|hsl)a?\([^)]+\)$|^(transparent|inherit|currentColor)$/i;

// Private IP ranges that must never appear in user-supplied URLs
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.|::1|fc00:|fd)/i;

/**
 * Validate a URL for use in overlay assets.
 * - Must be parseable as a URL
 * - Must use the https: protocol (prevents HTTP downgrade and non-URL schemes)
 * - Hostname must not resolve to a private/loopback IP range (SSRF prevention)
 *
 * @param {string} raw
 * @returns {{ valid: boolean, error?: string }}
 */
function validateOverlayUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { valid: false, error: 'URL must be a non-empty string' };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'URL must use HTTPS' };
  }
  if (PRIVATE_IP_RE.test(parsed.hostname)) {
    return { valid: false, error: 'URL hostname is not allowed' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// GET /api/webapp/admin/stream-overlays
// Admin only. Returns the overlay config for every channel.
// ---------------------------------------------------------------------------
const listOverlays = async (req, res) => {
  const user = req.session?.user;
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const { rows } = await getPool().query(
      `SELECT id, channel_ref, logo_url, logo_position, logo_size, logo_opacity,
              banner_text, banner_position, banner_bg_color, banner_text_color, banner_style,
              banner_image_url, is_active, updated_by, created_at, updated_at
       FROM stream_overlays
       ORDER BY channel_ref ASC`
    );
    return res.json({ success: true, overlays: rows });
  } catch (err) {
    logger.error('listOverlays error', err);
    return res.status(500).json({ error: 'Failed to list overlays' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/admin/stream-overlays/:channelRef
// Admin only. Returns the overlay config for a single channel.
// ---------------------------------------------------------------------------
const getOverlay = async (req, res) => {
  const user = req.session?.user;
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { channelRef } = req.params;
  if (!CHANNEL_REF_RE.test(channelRef)) {
    return res.status(400).json({ error: 'Invalid channelRef format' });
  }

  try {
    const { rows } = await getPool().query(
      `SELECT id, channel_ref, logo_url, logo_position, logo_size, logo_opacity,
              banner_text, banner_position, banner_bg_color, banner_text_color, banner_style,
              banner_image_url, is_active, updated_by, created_at, updated_at
       FROM stream_overlays
       WHERE channel_ref = $1`,
      [channelRef]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `No overlay config found for channel '${channelRef}'` });
    }

    return res.json({ success: true, overlay: rows[0] });
  } catch (err) {
    logger.error('getOverlay error', { channelRef, err });
    return res.status(500).json({ error: 'Failed to retrieve overlay' });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/webapp/admin/stream-overlays/:channelRef
// Admin only. Create-or-update overlay config for a channel (upsert).
// Accepts a partial body — only provided fields are written.
// After a successful write, the updated overlay is pushed to all viewers
// currently watching that channel via Socket.IO.
// ---------------------------------------------------------------------------
const updateOverlay = async (req, res) => {
  const user = req.session?.user;
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { channelRef } = req.params;
  if (!CHANNEL_REF_RE.test(channelRef)) {
    return res.status(400).json({ error: 'Invalid channelRef format' });
  }

  // Allowlist of updatable fields. Prevents arbitrary column injection.
  const ALLOWED_FIELDS = [
    'logo_url',
    'logo_position',
    'logo_size',
    'logo_opacity',
    'banner_text',
    'banner_position',
    'banner_bg_color',
    'banner_text_color',
    'banner_style',
    'banner_image_url',
    'is_active',
  ];

  // Build partial-update SET clause from only the fields present in the body.
  // Values array starts with channelRef ($1) and updatedBy ($2) which are
  // always present for the UPSERT.
  const values = [channelRef, user.id];
  const setClauses = ['updated_by = $2', 'updated_at = NOW()'];

  for (const field of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      values.push(req.body[field]);
      setClauses.push(`${field} = $${values.length}`);
    }
  }

  if (values.length === 2) {
    // No recognized fields were provided beyond the always-present ones
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  // CTRL-H1: Validate URL fields — must be https-only with no private IP hostnames
  for (const urlField of ['logo_url', 'banner_image_url']) {
    if (Object.prototype.hasOwnProperty.call(req.body, urlField) && req.body[urlField] !== null) {
      const check = validateOverlayUrl(req.body[urlField]);
      if (!check.valid) {
        return res.status(400).json({ error: `${urlField}: ${check.error}` });
      }
    }
  }

  // CTRL-C4: Validate CSS color fields
  for (const colorField of ['banner_bg_color', 'banner_text_color']) {
    if (Object.prototype.hasOwnProperty.call(req.body, colorField) && req.body[colorField] !== null) {
      if (typeof req.body[colorField] !== 'string' || !CSS_COLOR_RE.test(req.body[colorField])) {
        return res.status(400).json({ error: `${colorField}: invalid CSS color value` });
      }
    }
  }

  // CTRL-C4: Cap banner_text at 250 characters
  if (Object.prototype.hasOwnProperty.call(req.body, 'banner_text') && req.body.banner_text !== null) {
    if (typeof req.body.banner_text !== 'string' || req.body.banner_text.length > 250) {
      return res.status(400).json({ error: 'banner_text must not exceed 250 characters' });
    }
  }

  try {
    // Upsert: on first write for a channelRef, create the row.
    // On conflict, apply only the partial SET clauses built above.
    const { rows } = await getPool().query(
      `INSERT INTO stream_overlays (channel_ref, updated_by, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (channel_ref) DO UPDATE
         SET ${setClauses.join(', ')}
       RETURNING id, channel_ref, logo_url, logo_position, logo_size, logo_opacity,
                 banner_text, banner_position, banner_bg_color, banner_text_color, banner_style,
                 banner_image_url, is_active, updated_by, created_at, updated_at`,
      values
    );

    const overlay = rows[0];

    // Push real-time overlay update to all viewers currently in this channel room.
    // Strip updated_by — it is an internal admin user ID and must not be broadcast
    // to unauthenticated or lower-privileged viewers watching the live stream.
    const io = socketSingleton.get();
    if (io) {
      const { updated_by: _strip, ...overlayPublic } = overlay;
      io.to(`live:${channelRef}`).emit('overlay:updated', overlayPublic);
    }

    logger.info(`Admin ${user.id} updated overlay for channel '${channelRef}'`);
    return res.json({ success: true, overlay });
  } catch (err) {
    logger.error('updateOverlay error', { channelRef, err });
    return res.status(500).json({ error: 'Failed to update overlay' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/proxy/live/overlay/:channelRef
// Public endpoint — no auth required.
// Returns the active overlay config for a channel so the frontend player
// can render logo/banner without requiring the viewer to be logged in.
// Cache-Control: max-age=30 — overlays can change during a live stream
// but don't need sub-second freshness.
// ---------------------------------------------------------------------------
const getPublicOverlay = async (req, res) => {
  const { channelRef } = req.params;
  if (!CHANNEL_REF_RE.test(channelRef)) {
    return res.status(400).json({ error: 'Invalid channelRef format' });
  }

  res.setHeader('Cache-Control', 'public, max-age=30');

  try {
    const { rows } = await getPool().query(
      `SELECT id, channel_ref, logo_url, logo_position, logo_size, logo_opacity,
              banner_text, banner_position, banner_bg_color, banner_text_color, banner_style,
              banner_image_url, is_active, created_at, updated_at
       FROM stream_overlays
       WHERE channel_ref = $1 AND is_active = true`,
      [channelRef]
    );

    return res.json({ success: true, overlay: rows[0] ?? null });
  } catch (err) {
    logger.error('getPublicOverlay error', { channelRef, err });
    return res.status(500).json({ error: 'Failed to retrieve overlay' });
  }
};

module.exports = { listOverlays, getOverlay, updateOverlay, getPublicOverlay };
