const logger = require('../../../utils/logger');
const { getPool } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');
const axios = require('axios');
const restreamerService = require('../../../services/restreamerService');
const IdentityVerificationService = require('../../../services/identityVerificationService');

/**
 * Module-level cache for the Restreamer auth token.
 * Tokens typically last 1 hour; we cache for 55 minutes to avoid expiry mid-request.
 */
const _restreamerTokenCache = {
  token: null,
  expiresAt: 0,
  TTL_MS: 55 * 60 * 1000, // 55 minutes
};

/**
 * Authenticate with the Restreamer API and return a Bearer token.
 * Results are cached for 55 minutes to avoid hitting the login endpoint on every request.
 * Returns null if credentials are not configured or login fails (non-fatal).
 *
 * @param {string} restreamerUrl - Internal Restreamer base URL (e.g. http://restreamer:8080)
 * @returns {Promise<string|null>}
 */
async function getRestreamerToken(restreamerUrl) {
  const user = process.env.RESTREAMER_USER;
  const pass = process.env.RESTREAMER_PASSWORD;
  // Use strict undefined check — empty-string credentials are still valid and must be sent.
  if (user === undefined || pass === undefined) return null;

  // Return cached token if still valid.
  if (_restreamerTokenCache.token && Date.now() < _restreamerTokenCache.expiresAt) {
    return _restreamerTokenCache.token;
  }

  try {
    const resp = await axios.post(`${restreamerUrl}/api/login`, {
      username: user,
      password: pass,
    }, { timeout: 5000 });
    const token = resp.data?.access_token ?? null;
    if (token) {
      _restreamerTokenCache.token = token;
      _restreamerTokenCache.expiresAt = Date.now() + _restreamerTokenCache.TTL_MS;
    }
    return token;
  } catch (err) {
    // Clear stale cache on auth failure so the next request retries immediately.
    _restreamerTokenCache.token = null;
    _restreamerTokenCache.expiresAt = 0;
    logger.warn(`Restreamer login failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch all ingest processes from Restreamer.
 * Throws a typed error on failure so callers can return a 503 to the client.
 * The error has a `restreamerUnavailable` flag set to true.
 *
 * @param {string} restreamerUrl
 * @param {string|null} token
 * @returns {Promise<Array>}
 */
async function fetchRestreamerProcesses(restreamerUrl, token) {
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await axios.get(`${restreamerUrl}/api/v3/process`, {
      headers,
      timeout: 5000,
    });
    if (resp.status !== 200) {
      logger.warn(`Restreamer process list returned status ${resp.status}`);
      const err = new Error(`Restreamer returned status ${resp.status}`);
      err.restreamerUnavailable = true;
      throw err;
    }
    return (resp.data || []).filter(p => p.id?.startsWith('restreamer-ui:ingest:'));
  } catch (err) {
    if (!err.restreamerUnavailable) {
      logger.warn(`Restreamer process fetch failed: ${err.message}`);
      err.restreamerUnavailable = true;
    }
    throw err;
  }
}

/**
 * Extract the RTMP stream name from a Restreamer process config input address.
 * The input address format is: {rtmp,name=<streamName>} or {rtmp,name=<streamName>,timeout=10}
 * Returns null if the address does not match this pattern.
 *
 * @param {string|undefined} address - e.g. '{rtmp,name=frank}'
 * @returns {string|null}
 */
function extractRtmpName(address) {
  if (typeof address !== 'string') return null;
  const match = address.match(/\{rtmp[^}]*,name=([^,}]+)/);
  return match ? match[1] : null;
}

/**
 * Sanitize a Restreamer reference slug before embedding it in an HLS URL.
 * Only alphanumeric characters, hyphens, underscores, and dots are allowed.
 * Rejects empty strings and path-traversal patterns.
 *
 * @param {string|any} refId
 * @returns {string|null}
 */
function sanitizeRefId(refId) {
  if (typeof refId !== 'string') return null;
  if (!/^[a-zA-Z0-9\-_.]+$/.test(refId)) return null;
  if (refId.includes('..')) return null;
  return refId;
}

// ---------------------------------------------------------------------------
// GET /api/webapp/live/streams
// Proxies to Restreamer API and returns active HLS streams.
// ---------------------------------------------------------------------------
const listStreams = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
  const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

  try {
    const token = await getRestreamerToken(restreamerUrl);
    const processes = await fetchRestreamerProcesses(restreamerUrl, token);

    const baseStreams = processes
      .map((p) => {
        const rawRefId = p.reference || p.id;
        const refId = sanitizeRefId(rawRefId);
        if (!refId) {
          logger.warn('listStreams: rejected process with unsafe reference ID', { rawRefId });
          return null;
        }
        return {
          id: refId,
          name: p.metadata?.['restreamer-ui']?.meta?.name || 'Live Stream',
          description: p.metadata?.['restreamer-ui']?.meta?.description || '',
          hlsUrl: `${publicUrl}/memfs/${refId}.m3u8`,
          isLive: p.state?.exec === 'running',
        };
      })
      .filter(Boolean);

    // Augment streams with metadata and host info from Redis
    const redis = getRedis();
    const streams = await Promise.all(
      baseStreams.map(async (s) => {
        // Fetch metadata and thumbnail for all streams
        let metadata = {};
        let thumbUrl = null;
        try {
          const [metaRaw, thumbRaw] = await Promise.all([
            redis.get(`stream:meta:${s.id}`),
            redis.get(`stream:thumb:${s.id}`),
          ]);
          if (metaRaw) {
            try { metadata = JSON.parse(metaRaw); } catch { /* ignore */ }
          }
          thumbUrl = thumbRaw;
        } catch { /* ignore */ }

        const enriched = {
          ...s,
          name: metadata.title || s.name,
          description: metadata.description || s.description,
          tags: metadata.tags || [],
          thumbnailUrl: thumbUrl || null,
        };

        if (s.isLive) return enriched;

        // For offline streams, also check for host info (24h TTL key live:host:<ref>)
        try {
          const hostedRef = await redis.get(`live:host:${s.id}`);
          if (!hostedRef) return enriched;
          const safeHostedRef = sanitizeRefId(hostedRef);
          if (!safeHostedRef) return enriched;
          const target = baseStreams.find((t) => t.id === safeHostedRef);
          if (!target) {
            // Hosted channel no longer exists in Restreamer — clear the stale key
            await redis.del(`live:host:${s.id}`).catch(() => {});
            return enriched;
          }
          return {
            ...enriched,
            hostedChannelRef: safeHostedRef,
            hostedChannelName: target.name,
            hostedHlsUrl: target.hlsUrl,
          };
        } catch {
          return enriched;
        }
      })
    );

    return res.json({ success: true, streams });
  } catch (err) {
    if (err.restreamerUnavailable) {
      logger.warn('listStreams: Restreamer unavailable', { message: err.message });
      return res.status(503).json({ success: false, error: 'Streaming service temporarily unavailable' });
    }
    logger.error('webapp listStreams error', err);
    return res.status(502).json({ success: false, error: 'Failed to load streams from Restreamer' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/live/rtmp-key
// Returns the RTMP ingest URL and stream name for the user's assigned channel.
//
// The stream name is the RTMP input name from the Restreamer process config
// (e.g. "frank" for a channel with address "{rtmp,name=frank}"). This is what
// the user enters as the "Stream Key" in OBS.
//
// A user must have a Restreamer channel assigned to them (users.live_channel)
// by an admin before they can stream. If no channel is assigned, 404 is returned.
// ---------------------------------------------------------------------------
const getRtmpKey = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;
  if (!['model', 'creator', 'admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Creator or admin access required to retrieve a stream key',
    });
  }

  if (process.env.RESTREAMER_USER === undefined || process.env.RESTREAMER_PASSWORD === undefined) {
    return res.status(503).json({ success: false, error: 'Live streaming not configured' });
  }

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
  const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

  try {
    // ── 2257 compliance gate ──────────────────────────────────────────────────
    // Load fresh columns from DB — session may not carry them after migration
    const { rows: compRows } = await getPool().query(
      'SELECT identity_verified, identity_verification_required_by FROM users WHERE id = $1',
      [user.id]
    );
    const dbUserComp = compRows[0] || {};
    if (!IdentityVerificationService.is2257Compliant(dbUserComp)) {
      return res.status(403).json({
        success: false,
        error: 'identity_verification_required',
        message: 'Complete identity verification (18 U.S.C. § 2257) before going live.',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Look up the user's assigned Restreamer channel slug from the database.
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1',
      [user.id]
    );
    const channelRef = rows[0]?.live_channel;

    if (!channelRef) {
      return res.status(404).json({
        success: false,
        error: 'No streaming channel assigned to your account. Contact an admin to get a channel assigned.',
      });
    }

    // Fetch the process config from Restreamer to extract the RTMP stream name.
    let processes;
    try {
      const token = await getRestreamerToken(restreamerUrl);
      processes = await fetchRestreamerProcesses(restreamerUrl, token);
    } catch (fetchErr) {
      logger.warn(`getRtmpKey: Restreamer unavailable for user ${user.id}: ${fetchErr.message}`);
      return res.status(503).json({ success: false, error: 'Streaming service temporarily unavailable' });
    }

    const proc = processes.find(p => p.reference === channelRef);

    if (!proc) {
      logger.warn(`getRtmpKey: user ${user.id} assigned channel '${channelRef}' not found in Restreamer`);
      return res.status(503).json({
        success: false,
        error: 'Your assigned streaming channel is not available. Try again later.',
      });
    }

    const inputAddress = proc.config?.input?.[0]?.address;
    const streamName = extractRtmpName(inputAddress);

    if (!streamName) {
      logger.error(`getRtmpKey: cannot extract RTMP name from channel '${channelRef}' address '${inputAddress}'`);
      return res.status(500).json({ success: false, error: 'Streaming channel misconfigured' });
    }

    // The RTMP ingest app name is configured in Restreamer as '/live' (config.json rtmp.app).
    const publicHost = restreamerPublicUrl.replace(/^https?:\/\//, '');
    const rtmpUrl = `rtmp://${publicHost}/live`;

    // The HLS output URL for this channel, derived from the output address.
    // Output address format: {memfs}/<ref>.m3u8
    const safeRef = sanitizeRefId(channelRef);
    const hlsUrl = safeRef ? `${restreamerPublicUrl}/memfs/${safeRef}.m3u8` : null;

    return res.json({
      success: true,
      rtmpUrl,
      streamKey: streamName,    // What the user enters in OBS as "Stream Key"
      channelRef,               // The Restreamer channel slug (e.g. 'pnptv-frank')
      hlsUrl,                   // The HLS playback URL for this channel
      isLive: proc.state?.exec === 'running',
    });
  } catch (err) {
    logger.error('getRtmpKey error', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve stream key' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/live/provision-channel
// Creator-only: self-serve Restreamer channel provisioning.
//
// If the creator already has users.live_channel set, returns their existing
// RTMP details without touching Restreamer.
//
// Otherwise:
//   1. Derives a deterministic refId from username: pnptv-<sanitized_username>
//   2. Calls restreamerService.createProcess() — idempotent (handles 409 / pre-existing)
//   3. On success: persists refId to users.live_channel
//   4. Returns RTMP URL + stream key
//
// On Restreamer failure returns 503 — users row is NOT updated.
//
// Note: most users self-provision via this endpoint; admins can still override
// or force-assign channels via POST /api/webapp/admin/live/assign-channel.
// ---------------------------------------------------------------------------
const provisionChannel = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;
  if (!['model', 'creator', 'admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Creator or admin access required to provision a streaming channel',
    });
  }

  if (process.env.RESTREAMER_USER === undefined || process.env.RESTREAMER_PASSWORD === undefined) {
    return res.status(503).json({ success: false, error: 'Live streaming not configured' });
  }

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
  const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

  try {
    // ── 2257 compliance gate ──────────────────────────────────────────────────
    const { rows: compRows } = await getPool().query(
      'SELECT identity_verified, identity_verification_required_by FROM users WHERE id = $1',
      [user.id]
    );
    const dbUserComp = compRows[0] || {};
    if (!IdentityVerificationService.is2257Compliant(dbUserComp)) {
      return res.status(403).json({
        success: false,
        error: 'identity_verification_required',
        message: 'Complete identity verification (18 U.S.C. § 2257) before going live.',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Look up existing channel assignment first.
    const { rows } = await getPool().query(
      'SELECT live_channel, username, first_name, last_name FROM users WHERE id = $1',
      [user.id]
    );
    const dbUser = rows[0];
    if (!dbUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // If already provisioned, return existing RTMP details without hitting Restreamer.
    if (dbUser.live_channel) {
      const publicHost = restreamerPublicUrl.replace(/^https?:\/\//, '');
      const rtmpUrl = `rtmp://${publicHost}/live`;
      const safeRef = sanitizeRefId(dbUser.live_channel);
      const hlsUrl = safeRef ? `${restreamerPublicUrl}/memfs/${safeRef}.m3u8` : null;

      const existingStreamKey = safeRef && safeRef.startsWith('pnptv-') ? safeRef.slice('pnptv-'.length) : safeRef;
      logger.info(`provisionChannel: user ${user.id} already has channel '${dbUser.live_channel}' — returning existing`);
      return res.json({
        success: true,
        alreadyProvisioned: true,
        rtmpUrl,
        streamKey: existingStreamKey,
        channelRef: dbUser.live_channel,
        hlsUrl,
      });
    }

    // Derive deterministic refId from username.
    // Strip characters not allowed in a Restreamer reference, lowercase, prefix 'pnptv-'.
    const rawUsername = dbUser.username || `user${user.id}`;
    const slugPart = rawUsername.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const refId = sanitizeRefId(`pnptv-${slugPart}`);
    if (!refId) {
      return res.status(400).json({ success: false, error: 'Could not derive a valid channel ID from your username' });
    }

    // Derive display title from name fields.
    const displayName =
      [dbUser.first_name, dbUser.last_name].filter(Boolean).join(' ') ||
      dbUser.username ||
      `Creator ${user.id}`;

    // Create (or confirm existing) Restreamer process.
    let provisionResult;
    try {
      provisionResult = await restreamerService.createProcess({ refId, title: displayName });
    } catch (err) {
      logger.warn(`provisionChannel: Restreamer unavailable for user ${user.id}: ${err.message}`);
      return res.status(503).json({
        success: false,
        error: 'Streaming service is currently unavailable. Please try again in a few minutes.',
      });
    }

    // Persist the channel assignment.
    // If another concurrent request already set live_channel (race), keep the
    // winner's value — return the one that ended up in the DB.
    const updateResult = await getPool().query(
      `UPDATE users
         SET live_channel = $1
       WHERE id = $2 AND live_channel IS NULL
       RETURNING live_channel`,
      [provisionResult.refId, user.id]
    );

    // If live_channel was already set by a concurrent request, use that value.
    let finalRef;
    if (updateResult.rows.length > 0) {
      finalRef = updateResult.rows[0].live_channel;
    } else {
      // Someone else won the race — fetch whatever is in the DB now.
      const refetch = await getPool().query('SELECT live_channel FROM users WHERE id = $1', [user.id]);
      finalRef = refetch.rows[0]?.live_channel || provisionResult.refId;
    }

    const publicHost = restreamerPublicUrl.replace(/^https?:\/\//, '');
    const rtmpUrl = `rtmp://${publicHost}/live`;
    const safeRef = sanitizeRefId(finalRef);
    const hlsUrl = safeRef ? `${restreamerPublicUrl}/memfs/${safeRef}.m3u8` : null;

    const newStreamKey = safeRef && safeRef.startsWith('pnptv-') ? safeRef.slice('pnptv-'.length) : safeRef;
    logger.info(`provisionChannel: user ${user.id} provisioned channel '${finalRef}'`);
    return res.json({
      success: true,
      alreadyProvisioned: false,
      rtmpUrl,
      streamKey: newStreamKey,
      channelRef: finalRef,
      hlsUrl,
    });
  } catch (err) {
    logger.error('provisionChannel error', err);
    return res.status(500).json({ success: false, error: 'Failed to provision streaming channel' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/admin/live/assign-channel
// Admin-only: assign a Restreamer channel to a user (or unassign by passing null).
// Most users now self-provision via POST /api/webapp/live/provision-channel.
// Use this endpoint for manual overrides (re-assignment, force-assignment, unassign).
//
// Body: { userId: number, channelRef: string|null }
//   channelRef: the Restreamer process reference slug (e.g. 'pnptv-frank'), or null to unassign.
// ---------------------------------------------------------------------------
const assignChannel = async (req, res) => {
  const admin = req.session?.user;
  if (!admin || (admin.role !== 'admin' && admin.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId, channelRef } = req.body;

  if (!userId || typeof userId !== 'number' && typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (channelRef !== null && typeof channelRef !== 'string') {
    return res.status(400).json({ error: 'channelRef must be a string or null' });
  }
  if (channelRef && !/^[a-zA-Z0-9\-_]+$/.test(channelRef)) {
    return res.status(400).json({ error: 'channelRef contains invalid characters' });
  }

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';

  try {
    // Validate that the channel exists in Restreamer (unless unassigning).
    if (channelRef) {
      let processes;
      try {
        const token = await getRestreamerToken(restreamerUrl);
        processes = await fetchRestreamerProcesses(restreamerUrl, token);
      } catch (fetchErr) {
        logger.warn(`assignChannel: Restreamer unavailable: ${fetchErr.message}`);
        return res.status(503).json({ error: 'Streaming service temporarily unavailable' });
      }
      const exists = processes.some(p => p.reference === channelRef);
      if (!exists) {
        return res.status(404).json({ error: 'Channel not found' });
      }
    }

    // Clear the old owner first to avoid unique constraint violation when re-assigning
    if (channelRef) {
      await getPool().query(
        `UPDATE users SET live_channel = NULL WHERE live_channel = $1 AND id != $2`,
        [channelRef, userId]
      );
    }
    const { rows } = await getPool().query(
      `UPDATE users SET live_channel = $1 WHERE id = $2
       RETURNING id, username, live_channel`,
      [channelRef || null, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info(`Admin ${admin.id} assigned channel '${channelRef ?? '(none)'}' to user ${userId}`);
    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      // Unique constraint violation: channel already assigned to another user.
      return res.status(409).json({
        error: `Channel '${channelRef}' is already assigned to another user`,
      });
    }
    logger.error('assignChannel error', err);
    return res.status(500).json({ error: 'Failed to assign channel' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/admin/live/channels
// Admin-only: list all Restreamer channels and their assigned users.
// ---------------------------------------------------------------------------
const listChannels = async (req, res) => {
  const admin = req.session?.user;
  if (!admin || (admin.role !== 'admin' && admin.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
  const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

  try {
    let token, userRows;
    try {
      [token, userRows] = await Promise.all([
        getRestreamerToken(restreamerUrl),
        getPool().query(
          `SELECT id, username, first_name, last_name, live_channel
           FROM users
           WHERE live_channel IS NOT NULL`
        ),
      ]);
    } catch (fetchErr) {
      if (fetchErr.restreamerUnavailable) {
        logger.warn(`listChannels: Restreamer unavailable: ${fetchErr.message}`);
        return res.status(503).json({ error: 'Streaming service temporarily unavailable' });
      }
      throw fetchErr;
    }

    let processes;
    try {
      processes = await fetchRestreamerProcesses(restreamerUrl, token);
    } catch (fetchErr) {
      logger.warn(`listChannels: Restreamer process fetch failed: ${fetchErr.message}`);
      return res.status(503).json({ error: 'Streaming service temporarily unavailable' });
    }

    // Build a map of channelRef -> assigned user
    const channelToUser = {};
    for (const row of userRows.rows) {
      channelToUser[row.live_channel] = {
        id: row.id,
        username: row.username,
        displayName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username,
      };
    }

    const channels = processes.map(p => {
      const ref = p.reference || '';
      const safeRef = sanitizeRefId(ref);
      const inputAddress = p.config?.input?.[0]?.address;
      return {
        id: p.id,
        reference: ref,
        rtmpName: extractRtmpName(inputAddress),
        hlsUrl: safeRef ? `${publicUrl}/memfs/${safeRef}.m3u8` : null,
        isLive: p.state?.exec === 'running',
        assignedUser: channelToUser[ref] || null,
      };
    });

    return res.json({ success: true, channels });
  } catch (err) {
    logger.error('listChannels error', err);
    return res.status(500).json({ error: 'Failed to list channels' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/live/schedule
// Returns upcoming scheduled live streams for the next 7 days.
// Sources: live_streams table (status = 'scheduled') joined with users for
// streamer info. Redis-cached for 5 minutes (key: pnp:live:schedule:weekly).
// ---------------------------------------------------------------------------
const SCHEDULE_CACHE_KEY = 'pnp:live:schedule:weekly';
const SCHEDULE_CACHE_TTL = 300; // 5 minutes

const getSchedule = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const redis = getRedis();

  try {
    // Return cached schedule if available
    const cached = await redis.get(SCHEDULE_CACHE_KEY).catch(() => null);
    if (cached) {
      return res.json({ success: true, slots: JSON.parse(cached), fromCache: true });
    }

    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Query live_streams with host user info for streams scheduled in next 7 days
    const { rows } = await getPool().query(
      `SELECT
         ls.id::text             AS slot_id,
         ls.title,
         ls.description,
         ls.scheduled_at,
         ls.scheduled_for,
         ls.duration,
         ls.thumbnail_url,
         ls.channel_name,
         ls.host_id,
         ls.host_name,
         u.username              AS host_username,
         u.first_name            AS host_first_name,
         u.last_name             AS host_last_name,
         u.photo_file_id         AS host_photo
       FROM live_streams ls
       LEFT JOIN users u ON u.id = ls.host_id
       WHERE ls.status = 'scheduled'
         AND COALESCE(ls.scheduled_at, ls.scheduled_for) >= $1
         AND COALESCE(ls.scheduled_at, ls.scheduled_for) <= $2
       ORDER BY COALESCE(ls.scheduled_at, ls.scheduled_for) ASC
       LIMIT 50`,
      [now.toISOString(), sevenDaysOut.toISOString()]
    );

    const slots = rows.map((r) => {
      const startTime = r.scheduled_at || r.scheduled_for;
      // Duration stored as minutes integer; default 60 if not set
      const durationMinutes = r.duration || 60;
      const displayName =
        r.host_name ||
        [r.host_first_name, r.host_last_name].filter(Boolean).join(' ') ||
        r.host_username ||
        'PNPtv Creator';
      const photoUrl = r.host_photo
        ? r.host_photo.startsWith('/') ? r.host_photo : `/${r.host_photo}`
        : null;

      return {
        slotId: r.slot_id,
        title: r.title || null,
        description: r.description || null,
        startTime: new Date(startTime).toISOString(),
        durationMinutes,
        streamerName: displayName,
        streamerAvatar: photoUrl,
        streamerId: r.host_id || null,
        channelName: r.channel_name || null,
      };
    });

    // Cache the result for 5 minutes
    await redis.setex(SCHEDULE_CACHE_KEY, SCHEDULE_CACHE_TTL, JSON.stringify(slots)).catch(() => {});

    return res.json({ success: true, slots });
  } catch (err) {
    logger.error('getSchedule error', err);
    return res.status(500).json({ success: false, error: 'Failed to load schedule' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/live/schedule/notify
// Subscribe the authenticated user to a stream-start notification for a slot.
// Body: { slotId: string }
// Stores userId in Redis SET: pnp:live:notify:{slotId}, TTL = 8 days.
// ---------------------------------------------------------------------------
const subscribeScheduleNotify = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const userId = String(req.session.user.id);
  const { slotId } = req.body;

  if (!slotId || typeof slotId !== 'string' || !/^[a-zA-Z0-9\-_]+$/.test(slotId)) {
    return res.status(400).json({ success: false, error: 'Invalid slotId' });
  }

  const redis = getRedis();
  try {
    const key = `pnp:live:notify:${slotId}`;
    await redis.sadd(key, userId);
    // TTL = 8 days (slot is at most 7 days away; give a day of buffer for cleanup)
    await redis.expire(key, 8 * 24 * 60 * 60);
    return res.json({ success: true, subscribed: true });
  } catch (err) {
    logger.error('subscribeScheduleNotify error', err);
    return res.status(500).json({ success: false, error: 'Failed to subscribe to notification' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/webapp/live/schedule/notify
// Unsubscribe the authenticated user from a stream-start notification.
// Body: { slotId: string }
// ---------------------------------------------------------------------------
const unsubscribeScheduleNotify = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const userId = String(req.session.user.id);
  const { slotId } = req.body;

  if (!slotId || typeof slotId !== 'string' || !/^[a-zA-Z0-9\-_]+$/.test(slotId)) {
    return res.status(400).json({ success: false, error: 'Invalid slotId' });
  }

  const redis = getRedis();
  try {
    await redis.srem(`pnp:live:notify:${slotId}`, userId);
    return res.json({ success: true, subscribed: false });
  } catch (err) {
    logger.error('unsubscribeScheduleNotify error', err);
    return res.status(500).json({ success: false, error: 'Failed to unsubscribe from notification' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/live/schedule/notify/:slotId
// Returns whether the authenticated user is subscribed to a slot notification.
// ---------------------------------------------------------------------------
const checkScheduleNotify = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const userId = String(req.session.user.id);
  const { slotId } = req.params;

  if (!slotId || !/^[a-zA-Z0-9\-_]+$/.test(slotId)) {
    return res.status(400).json({ success: false, error: 'Invalid slotId' });
  }

  const redis = getRedis();
  try {
    const isMember = await redis.sismember(`pnp:live:notify:${slotId}`, userId);
    return res.json({ success: true, subscribed: isMember === 1 });
  } catch (err) {
    logger.error('checkScheduleNotify error', err);
    return res.status(500).json({ success: false, error: 'Failed to check notification status' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/live/raid
// Creator-only: send all viewers in the source stream room to another live stream.
//
// Body: { targetChannelRef: string }
//   Validates the source stream is live and the user owns it.
//   Emits `live:raid` to the source Socket.IO room via io attached to req.app.
// ---------------------------------------------------------------------------
const initiateRaid = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;
  if (!['model', 'creator', 'admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({ success: false, error: 'Creator access required' });
  }

  const { targetChannelRef } = req.body;
  if (!targetChannelRef || typeof targetChannelRef !== 'string') {
    return res.status(400).json({ success: false, error: 'targetChannelRef is required' });
  }
  if (!sanitizeRefId(targetChannelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid targetChannelRef' });
  }

  // Redis-based cooldown — shared across HTTP and WebSocket, survives restarts
  try {
    const raidRedis = getRedis();
    const cooldownKey = `pnp:raid:cooldown:${user.id}`;
    const set = await raidRedis.set(cooldownKey, '1', 'NX', 'EX', 300);
    if (set === null) {
      const ttl = await raidRedis.ttl(cooldownKey).catch(() => 300);
      return res.status(429).json({ success: false, error: `Raid on cooldown. Try again in ${ttl > 0 ? ttl : 300}s.` });
    }
  } catch (cooldownErr) {
    logger.warn('initiateRaid: Redis cooldown check failed (continuing)', { userId: user.id, error: cooldownErr.message });
  }

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';

  try {
    // Look up the raider's assigned channel
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1',
      [user.id]
    );
    const sourceChannelRef = rows[0]?.live_channel;
    if (!sourceChannelRef) {
      return res.status(404).json({ success: false, error: 'No streaming channel assigned to your account' });
    }
    if (sourceChannelRef === targetChannelRef) {
      return res.status(400).json({ success: false, error: 'Cannot raid your own channel' });
    }

    // Fetch processes to validate liveness
    let processes;
    try {
      const token = await getRestreamerToken(restreamerUrl);
      processes = await fetchRestreamerProcesses(restreamerUrl, token);
    } catch (fetchErr) {
      return res.status(503).json({ success: false, error: 'Streaming service temporarily unavailable' });
    }

    const sourceProc = processes.find(p => p.reference === sourceChannelRef);
    if (!sourceProc || sourceProc.state?.exec !== 'running') {
      return res.status(400).json({ success: false, error: 'Your stream must be live to initiate a raid' });
    }

    const targetProc = processes.find(p => p.reference === targetChannelRef);
    if (!targetProc || targetProc.state?.exec !== 'running') {
      return res.status(400).json({ success: false, error: 'Target stream is not currently live' });
    }

    const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
    const targetName = targetProc.metadata?.['restreamer-ui']?.meta?.name || targetChannelRef;
    const sourceName = sourceProc.metadata?.['restreamer-ui']?.meta?.name || sourceChannelRef;

    const redis = getRedis();
    const viewerCountRaw = await redis.get(`live:viewers:${sourceChannelRef}`).catch(() => '0');
    const viewerCount = parseInt(viewerCountRaw, 10) || 0;

    // Emit raid event to everyone in the source stream room
    const io = req.app.get('io');
    if (io) {
      io.to(`live:${sourceChannelRef}`).emit('live:raid', {
        sourceChannelRef,
        sourceName,
        targetChannelRef,
        targetName,
        targetHlsUrl: `${publicUrl}/memfs/${targetChannelRef}.m3u8`,
        viewerCount,
        raidedBy: user.id,
      });
    }

    logger.info(`Raid: ${sourceChannelRef} → ${targetChannelRef} by user ${user.id}, viewers: ${viewerCount}`);
    return res.json({ success: true, sourceChannelRef, targetChannelRef, targetName, viewerCount });
  } catch (err) {
    logger.error('initiateRaid error', err);
    return res.status(500).json({ success: false, error: 'Failed to initiate raid' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/live/host
// Creator-only: set or clear the hosted channel for their stream.
//
// Body: { targetChannelRef: string|null }
//   null → clear host mode; string → set it (stored in Redis with 24h TTL).
// ---------------------------------------------------------------------------
const HOST_TTL_SECONDS = 86400;

const setHostedChannel = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;
  if (!['model', 'creator', 'admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({ success: false, error: 'Creator access required' });
  }

  const { targetChannelRef } = req.body;
  if (targetChannelRef !== null && targetChannelRef !== undefined && typeof targetChannelRef !== 'string') {
    return res.status(400).json({ success: false, error: 'targetChannelRef must be a string or null' });
  }
  if (targetChannelRef && !sanitizeRefId(targetChannelRef)) {
    return res.status(400).json({ success: false, error: 'Invalid targetChannelRef' });
  }

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1',
      [user.id]
    );
    const sourceChannelRef = rows[0]?.live_channel;
    if (!sourceChannelRef) {
      return res.status(404).json({ success: false, error: 'No streaming channel assigned' });
    }
    if (targetChannelRef && sourceChannelRef === targetChannelRef) {
      return res.status(400).json({ success: false, error: 'Cannot host your own channel' });
    }

    const redis = getRedis();
    const key = `live:host:${sourceChannelRef}`;

    if (!targetChannelRef) {
      await redis.del(key);
      logger.info(`Host mode cleared for ${sourceChannelRef} by user ${user.id}`);
      return res.json({ success: true, hosting: null });
    }

    // Validate target channel exists in Restreamer (non-fatal if unavailable)
    const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
    try {
      const token = await getRestreamerToken(restreamerUrl);
      const processes = await fetchRestreamerProcesses(restreamerUrl, token);
      if (!processes.some(p => p.reference === targetChannelRef)) {
        return res.status(404).json({ success: false, error: 'Target channel not found' });
      }
    } catch {
      logger.warn('setHostedChannel: Restreamer unavailable, skipping validation');
    }

    await redis.set(key, targetChannelRef, 'EX', HOST_TTL_SECONDS);
    logger.info(`Host mode set: ${sourceChannelRef} → ${targetChannelRef} by user ${user.id}`);
    return res.json({ success: true, hosting: targetChannelRef });
  } catch (err) {
    logger.error('setHostedChannel error', err);
    return res.status(500).json({ success: false, error: 'Failed to set hosted channel' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/live/host
// Creator-only: return the current hosted channel for their stream (or null).
// ---------------------------------------------------------------------------
const getHostedChannel = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;
  if (!['model', 'creator', 'admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({ success: false, error: 'Creator access required' });
  }

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1',
      [user.id]
    );
    const sourceChannelRef = rows[0]?.live_channel;
    if (!sourceChannelRef) {
      return res.status(404).json({ success: false, error: 'No channel assigned' });
    }

    const redis = getRedis();
    const hosting = await redis.get(`live:host:${sourceChannelRef}`);
    return res.json({ success: true, sourceChannelRef, hosting: hosting || null });
  } catch (err) {
    logger.error('getHostedChannel error', err);
    return res.status(500).json({ success: false, error: 'Failed to get hosted channel' });
  }
};

// ── Stream Analytics ──────────────────────────────────────────────────────────

const streamAnalyticsService = require('../../../services/streamAnalyticsService');
const streamRecordingService = require('../../../services/streamRecordingService');
const EntitlementAccessService = require('../../../services/entitlementAccessService');

/**
 * GET /api/webapp/live/analytics/sessions?limit=20
 * Returns the caller's recent stream sessions.
 * Requires an active creator profile (checked via creatorGuard middleware on the route).
 */
const getAnalyticsSessions = async (req, res) => {
  const creatorId = String(req.user.id);
  const limit = parseInt(req.query.limit, 10) || 20;
  try {
    const sessions = await streamAnalyticsService.getCreatorSessions(creatorId, limit);
    return res.json({ success: true, sessions });
  } catch (err) {
    logger.error('getAnalyticsSessions error', { creatorId, err });
    return res.status(500).json({ success: false, error: 'Failed to load sessions' });
  }
};

/**
 * GET /api/webapp/live/analytics/summary?days=30
 * Returns aggregate stats for the last N days.
 */
const getAnalyticsSummary = async (req, res) => {
  const creatorId = String(req.user.id);
  const days = parseInt(req.query.days, 10) || 30;
  try {
    const summary = await streamAnalyticsService.getCreatorSummary(creatorId, days);
    return res.json({ success: true, summary });
  } catch (err) {
    logger.error('getAnalyticsSummary error', { creatorId, err });
    return res.status(500).json({ success: false, error: 'Failed to load summary' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/live/slot/:id/ticket-status
// Returns ticket status for a scheduled live_streams slot.
// ---------------------------------------------------------------------------
const getSlotTicketStatus = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const { id } = req.params;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid slot id' });
  }

  const userId = String(req.session.user.id);

  try {
    const { rows: slotRows } = await getPool().query(
      `SELECT id, is_ticketed, ticket_price_usd, ticket_price_tokens
       FROM live_streams WHERE id = $1`,
      [id]
    );
    if (slotRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Slot not found' });
    }
    const slot = slotRows[0];

    let hasTicket = false;
    if (slot.is_ticketed) {
      const { rows: ticketRows } = await getPool().query(
        'SELECT 1 FROM live_show_tickets WHERE slot_id = $1 AND user_id = $2',
        [id, userId]
      );
      hasTicket = ticketRows.length > 0;
    }

    return res.json({
      success: true,
      isTicketed: slot.is_ticketed,
      priceTokens: slot.ticket_price_tokens,
      priceUsd: slot.ticket_price_usd,
      hasTicket,
    });
  } catch (err) {
    logger.error('getSlotTicketStatus error', err);
    return res.status(500).json({ success: false, error: 'Failed to get ticket status' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/live/slot/:id/buy-ticket
// Body: { currency: 'tokens' | 'dash' }
// tokens  — atomic debit from user_token_wallets + ticket insert.
// dash    — create BTCPay invoice via dash_subscription_orders, return checkoutUrl.
// Webhook settlement for Dash calls handleTicketSettlement() below.
// ---------------------------------------------------------------------------
const buySlotTicket = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const { id } = req.params;
  const { currency } = req.body;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid slot id' });
  }
  if (currency !== 'tokens' && currency !== 'dash') {
    return res.status(400).json({ success: false, error: "currency must be 'tokens' or 'dash'" });
  }

  const userId = String(req.session.user.id);
  const userEmail = req.session.user.email || null;

  try {
    const { rows: slotRows } = await getPool().query(
      `SELECT id, title, is_ticketed, ticket_price_usd, ticket_price_tokens
       FROM live_streams WHERE id = $1`,
      [id]
    );
    if (slotRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Slot not found' });
    }
    const slot = slotRows[0];

    if (!slot.is_ticketed) {
      return res.status(400).json({ success: false, error: 'This stream does not require a ticket' });
    }

    // Idempotency: already owned
    const { rows: existing } = await getPool().query(
      'SELECT 1 FROM live_show_tickets WHERE slot_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (existing.length > 0) {
      return res.json({ success: true, hasTicket: true, alreadyOwned: true });
    }

    // ── Token purchase path ──────────────────────────────────────────────────
    if (currency === 'tokens') {
      const price = slot.ticket_price_tokens;
      if (!price || price <= 0) {
        return res.status(400).json({ success: false, error: 'Token price not configured for this slot' });
      }

      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Atomic debit — mirrors pnpLiveTipsService pattern
        const debitResult = await client.query(
          `UPDATE user_token_wallets
           SET balance_tokens = balance_tokens - $2,
               updated_at = NOW()
           WHERE user_id = $1 AND balance_tokens >= $2
           RETURNING balance_tokens`,
          [userId, price]
        );
        if (debitResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(402).json({ success: false, error: 'Insufficient token balance' });
        }
        const newBalance = debitResult.rows[0].balance_tokens;

        await client.query(
          `INSERT INTO live_show_tickets (slot_id, user_id, price_paid_tokens)
           VALUES ($1, $2, $3)
           ON CONFLICT (slot_id, user_id) DO NOTHING`,
          [id, userId, price]
        );

        await client.query('COMMIT');

        logger.info('Live ticket purchased (tokens)', { userId, slotId: id, price });

        // Emit real-time event so frontend updates hasTicket optimistically
        try {
          const socketSingleton = require('../../../services/socketSingleton');
          const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
          if (io) {
            io.to(`user:${userId}`).emit('live:ticket:purchased', { slotId: id, userId });
          }
        } catch (emitErr) {
          logger.warn('buySlotTicket: socket emit failed (non-critical)', { error: emitErr.message });
        }

        return res.json({ success: true, hasTicket: true, newBalance });
      } catch (txErr) {
        await client.query('ROLLBACK');
        logger.error('buySlotTicket token transaction error', txErr);
        return res.status(500).json({ success: false, error: 'Purchase failed — please try again' });
      } finally {
        client.release();
      }
    }

    // ── Dash / BTCPay crypto purchase path ───────────────────────────────────
    if (currency === 'dash') {
      const priceUsd = parseFloat(slot.ticket_price_usd);
      if (!priceUsd || priceUsd <= 0) {
        return res.status(400).json({ success: false, error: 'USD price not configured for this slot' });
      }

      // HIGH-02: Idempotency guard — return the existing pending Dash invoice if one was
      // created within the last 15 minutes. Prevents double-charge on retry. Fail-open.
      try {
        const { rows: existingDash } = await getPool().query(
          `SELECT btcpay_invoice_id, metadata
             FROM dash_subscription_orders
            WHERE user_id = $1
              AND status = 'pending'
              AND metadata->>'resource' = 'live_show_ticket'
              AND metadata->>'slotId' = $2
              AND created_at > NOW() - INTERVAL '15 minutes'
            ORDER BY created_at DESC
            LIMIT 1`,
          [userId, id]
        );
        if (existingDash.length > 0) {
          const { createDashInvoice: _cdi } = require('../../../config/btcpay');
          const WEB_APP_URL_CHECK = process.env.WEB_APP_URL || 'https://pnptv.app';
          const existingInvoiceId = existingDash[0].btcpay_invoice_id;
          logger.info('buySlotTicket (dash): returning existing pending invoice', { userId, slotId: id, invoiceId: existingInvoiceId });
          return res.json({
            success: true,
            provider: 'dash',
            invoiceId: existingInvoiceId,
            checkoutUrl: `${process.env.BTCPAY_URL || 'https://btcpay.pnptv.app'}/i/${existingInvoiceId}`,
            idempotent: true,
          });
        }
      } catch (dashIdempErr) {
        logger.warn('buySlotTicket (dash): idempotency check failed, proceeding with new invoice', { error: dashIdempErr.message });
      }

      const { createDashInvoice } = require('../../../config/btcpay');
      const WEB_APP_URL = process.env.WEB_APP_URL || 'https://pnptv.app';

      const invoice = await createDashInvoice({
        usdAmount: priceUsd,
        userId,
        orderId: `pnptv-ticket-${userId}-${id}-${Date.now()}`,
        description: 'Online event access',
        redirectUrl: `${WEB_APP_URL}/live/${id}`,
      });

      // Store in dash_subscription_orders so the BTCPay webhook can settle it.
      // metadata.resource = 'live_show_ticket' is the routing key in the webhook handler.
      await getPool().query(
        `INSERT INTO dash_subscription_orders
           (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          userId,
          'live_show_ticket',
          userEmail,
          priceUsd,
          invoice.invoiceId,
          JSON.stringify({
            resource: 'live_show_ticket',
            slotId: id,
            slotTitle: slot.title || null,
            userId,
          }),
        ]
      );

      logger.info('Live ticket checkout created (dash)', { userId, slotId: id, invoiceId: invoice.invoiceId, priceUsd });

      return res.json({
        success: true,
        provider: 'dash',
        invoiceId: invoice.invoiceId,
        checkoutUrl: invoice.checkoutUrl,
      });
    }

    // Unreachable — validation gate above covers all cases
    return res.status(400).json({ success: false, error: 'Invalid currency' });
  } catch (err) {
    logger.error('buySlotTicket error', err);
    return res.status(500).json({ success: false, error: 'Failed to process ticket purchase' });
  }
};

// ---------------------------------------------------------------------------
// handleTicketSettlement — called by webhook handlers after payment confirmation.
// Inserts into live_show_tickets (idempotent via ON CONFLICT DO NOTHING) and
// emits live:ticket:purchased socket event so the frontend updates in real-time.
//
// @param {string} userId
// @param {string} slotId  — UUID of the live_streams row
// @param {string} provider — 'tokens' | 'dash'
// @param {number} pricePaidUsd
// ---------------------------------------------------------------------------
const handleTicketSettlement = async (userId, slotId, provider, pricePaidUsd) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO live_show_tickets (slot_id, user_id, price_paid_usd)
       VALUES ($1, $2, $3)
       ON CONFLICT (slot_id, user_id) DO NOTHING
       RETURNING id`,
      [slotId, userId, pricePaidUsd]
    );

    await client.query('COMMIT');

    const wasInserted = result.rowCount > 0;

    logger.info('handleTicketSettlement', {
      userId, slotId, provider, pricePaidUsd,
      wasInserted,
    });

    if (wasInserted) {
      // Emit real-time event — fire and forget
      try {
        const socketSingleton = require('../../../services/socketSingleton');
        const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
        if (io) {
          io.to(`user:${userId}`).emit('live:ticket:purchased', { slotId, userId });
        }
      } catch (emitErr) {
        logger.warn('handleTicketSettlement: socket emit failed (non-critical)', { error: emitErr.message });
      }
    }

    return { inserted: wasInserted };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('handleTicketSettlement error', { userId, slotId, provider, error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/creators/:creatorId/recordings
// Public with softAuth. Lists completed non-deleted recordings for a creator.
// manifestUrl exposed only to: the creator themselves, subscribers, admins.
// ---------------------------------------------------------------------------
const listCreatorRecordings = async (req, res) => {
  const { creatorId } = req.params;
  if (!creatorId) return res.status(400).json({ success: false, error: 'creatorId required' });

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, session_id, started_at, ended_at, duration_seconds, size_bytes, manifest_url, thumb_path, title, description
       FROM stream_recordings
       WHERE creator_id = $1
         AND status = 'completed'
         AND is_deleted = FALSE
       ORDER BY started_at DESC
       LIMIT 50`,
      [String(creatorId)]
    );

    const viewer = req.user; // set by softAuth, may be null
    const viewerId = viewer?.id ? String(viewer.id) : null;
    const isOwner = viewerId && viewerId === String(creatorId);

    let isAdmin = false;
    let hasSubscription = false;

    if (viewerId && !isOwner) {
      // Check admin role
      const { rows: userRows } = await pool.query(
        `SELECT role FROM users WHERE id = $1`,
        [viewerId]
      );
      const role = userRows[0]?.role;
      isAdmin = role === 'admin' || role === 'superadmin';

      if (!isAdmin) {
        // Check creator subscription entitlement
        try {
          const result = await EntitlementAccessService.hasResourceAccess(viewerId, 'creator', String(creatorId));
          hasSubscription = result.allowed;
        } catch {
          hasSubscription = false;
        }
      }
    }

    const canSeeManifest = isOwner || isAdmin || hasSubscription;

    const recordings = rows.map((r) => ({
      id: String(r.id),
      startedAt: r.started_at,
      endedAt: r.ended_at,
      // M-4: Null sensitive metadata for non-subscribers — only id + startedAt exposed publicly
      durationSeconds: canSeeManifest ? r.duration_seconds : null,
      sizeBytes: canSeeManifest ? (r.size_bytes ? Number(r.size_bytes) : null) : null,
      manifestUrl: canSeeManifest ? r.manifest_url : null,
      thumbUrl: canSeeManifest ? (r.thumb_path || null) : null,
      title: canSeeManifest ? (r.title || null) : null,
      description: canSeeManifest ? (r.description || null) : null,
      requiresSubscription: !canSeeManifest,
    }));

    return res.json({ success: true, recordings });
  } catch (err) {
    logger.error('listCreatorRecordings error', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch recordings' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/webapp/recordings/:id
// requireSessionAuth + owner check.
// ---------------------------------------------------------------------------
const deleteRecordingEndpoint = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const { id } = req.params;
  const recordingId = parseInt(id, 10);
  if (!recordingId || isNaN(recordingId)) {
    return res.status(400).json({ success: false, error: 'Invalid recording id' });
  }

  try {
    await streamRecordingService.deleteRecording(recordingId, String(req.session.user.id));
    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Recording not found' });
    if (err.code === 'FORBIDDEN') return res.status(403).json({ success: false, error: 'You do not own this recording' });
    logger.error('deleteRecordingEndpoint error', err);
    return res.status(500).json({ success: false, error: 'Failed to delete recording' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/webapp/recordings/:id
// Creator-only: update title and/or description of an owned recording.
// Body: { title?: string, description?: string }
// Max: title 120 chars, description 2000 chars. HTML stripped.
// ---------------------------------------------------------------------------
const _stripHtml = (str) => str.replace(/<[^>]*>/g, '').trim();

const updateRecordingEndpoint = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { id } = req.params;
  const recordingId = parseInt(id, 10);
  if (!recordingId || isNaN(recordingId)) {
    return res.status(400).json({ success: false, error: 'Invalid recording id' });
  }

  const { title, description } = req.body || {};

  // Must provide at least one field
  if (title === undefined && description === undefined) {
    return res.status(400).json({ success: false, error: 'Provide title and/or description' });
  }

  // Validate and sanitize
  let safeTitle = undefined;
  let safeDescription = undefined;

  if (title !== undefined) {
    if (typeof title !== 'string') {
      return res.status(400).json({ success: false, error: 'title must be a string' });
    }
    safeTitle = _stripHtml(title);
    if (safeTitle.length > 120) {
      return res.status(400).json({ success: false, error: 'title must be 120 characters or fewer' });
    }
  }

  if (description !== undefined) {
    if (typeof description !== 'string') {
      return res.status(400).json({ success: false, error: 'description must be a string' });
    }
    safeDescription = _stripHtml(description);
    if (safeDescription.length > 2000) {
      return res.status(400).json({ success: false, error: 'description must be 2000 characters or fewer' });
    }
  }

  try {
    const pool = getPool();

    // Owner check
    const { rows: checkRows } = await pool.query(
      `SELECT creator_id FROM stream_recordings WHERE id = $1 AND is_deleted = FALSE`,
      [recordingId]
    );
    if (checkRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }
    if (String(checkRows[0].creator_id) !== String(req.session.user.id)) {
      return res.status(403).json({ success: false, error: 'You do not own this recording' });
    }

    // Build dynamic SET clause — only update provided fields
    const setClauses = [];
    const params = [];
    let paramIdx = 1;

    if (safeTitle !== undefined) {
      setClauses.push(`title = $${paramIdx++}`);
      params.push(safeTitle || null);
    }
    if (safeDescription !== undefined) {
      setClauses.push(`description = $${paramIdx++}`);
      params.push(safeDescription || null);
    }

    params.push(recordingId);
    const { rows: updated } = await pool.query(
      `UPDATE stream_recordings SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING title, description`,
      params
    );

    logger.info('updateRecordingEndpoint: updated', { recordingId, userId: req.session.user.id });
    return res.json({ success: true, title: updated[0].title, description: updated[0].description });
  } catch (err) {
    logger.error('updateRecordingEndpoint error', err);
    return res.status(500).json({ success: false, error: 'Failed to update recording' });
  }
};

// ── Creator Revenue ───────────────────────────────────────────────────────────

/**
 * GET /api/webapp/creator/revenue?days=30[&creatorId=]
 * Aggregates revenue across tips (tokens), tickets (USD+tokens), subs (USD), calls (USD).
 * Creator-only; admin can pass ?creatorId= to fetch for another creator.
 */
const getCreatorRevenue = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const caller = req.session.user;

  let creatorId;
  if (req.query.creatorId) {
    if (caller.role !== 'admin' && caller.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Admin access required to view another creator revenue' });
    }
    creatorId = String(req.query.creatorId);
  } else {
    if (!['model', 'creator', 'admin', 'superadmin'].includes(caller.role)) {
      return res.status(403).json({ success: false, error: 'Creator access required' });
    }
    creatorId = String(caller.id);
  }

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const pool = getPool();

  try {
    const [tipsResult, ticketsResult, subsResult, callsResult,
           allTimeTips, allTimeTickets, allTimeSubs, allTimeCalls] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total_tokens, COUNT(*)::int AS count,
                DATE_TRUNC('day', created_at)::date::text AS day
         FROM pnp_tips
         WHERE performer_id = $1 AND payment_status = 'completed'
           AND created_at >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE_TRUNC('day', created_at)::date ORDER BY day ASC`,
        [creatorId, days]
      ),
      pool.query(
        `SELECT COALESCE(SUM(lst.price_paid_usd), 0)::numeric(12,2) AS total_usd,
                COALESCE(SUM(lst.price_paid_tokens), 0)::bigint AS total_tokens,
                COUNT(*)::int AS count,
                DATE_TRUNC('day', lst.purchased_at)::date::text AS day
         FROM live_show_tickets lst
         JOIN live_streams ls ON ls.id = lst.slot_id
         WHERE ls.host_id = $1
           AND lst.purchased_at >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE_TRUNC('day', lst.purchased_at)::date ORDER BY day ASC`,
        [creatorId, days]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount_creator), 0)::numeric(12,2) AS total_usd, COUNT(*)::int AS count,
                DATE_TRUNC('day', created_at)::date::text AS day
         FROM creator_earnings
         WHERE creator_id = $1 AND subscription_id IS NOT NULL
           AND created_at >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE_TRUNC('day', created_at)::date ORDER BY day ASC`,
        [creatorId, days]
      ),
      pool.query(
        `SELECT COALESCE(SUM(cb.price), 0)::numeric(12,2) AS total_usd, COUNT(*)::int AS count,
                DATE_TRUNC('day', cb.created_at)::date::text AS day
         FROM call_bookings cb
         JOIN performers p ON p.id = cb.performer_id
         WHERE p.user_id = $1 AND cb.payment_status = 'completed'
           AND cb.created_at >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE_TRUNC('day', cb.created_at)::date ORDER BY day ASC`,
        [creatorId, days]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS tokens, COUNT(*)::int AS count
         FROM pnp_tips WHERE performer_id = $1 AND payment_status = 'completed'`,
        [creatorId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(lst.price_paid_usd), 0)::numeric(12,2) AS usd,
                COALESCE(SUM(lst.price_paid_tokens), 0)::bigint AS tokens, COUNT(*)::int AS count
         FROM live_show_tickets lst JOIN live_streams ls ON ls.id = lst.slot_id
         WHERE ls.host_id = $1`,
        [creatorId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount_creator), 0)::numeric(12,2) AS usd, COUNT(*)::int AS count
         FROM creator_earnings WHERE creator_id = $1 AND subscription_id IS NOT NULL`,
        [creatorId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(cb.price), 0)::numeric(12,2) AS usd, COUNT(*)::int AS count
         FROM call_bookings cb JOIN performers p ON p.id = cb.performer_id
         WHERE p.user_id = $1 AND cb.payment_status = 'completed'`,
        [creatorId]
      ),
    ]);

    // Merge byDay across all sources
    const dayMap = new Map();
    const ensureDay = (d) => {
      if (!dayMap.has(d)) dayMap.set(d, { date: d, usd: 0, tokens: 0 });
      return dayMap.get(d);
    };
    for (const r of tipsResult.rows) {
      const e = ensureDay(r.day); e.tokens += Number(r.total_tokens);
    }
    for (const r of ticketsResult.rows) {
      const e = ensureDay(r.day);
      e.usd = Math.round((e.usd + Number(r.total_usd)) * 100) / 100;
      e.tokens += Number(r.total_tokens);
    }
    for (const r of subsResult.rows) {
      const e = ensureDay(r.day);
      e.usd = Math.round((e.usd + Number(r.total_usd)) * 100) / 100;
    }
    for (const r of callsResult.rows) {
      const e = ensureDay(r.day);
      e.usd = Math.round((e.usd + Number(r.total_usd)) * 100) / 100;
    }

    const byDay = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    const at = allTimeTips.rows[0];
    const ak = allTimeTickets.rows[0];
    const as_ = allTimeSubs.rows[0];
    const ac = allTimeCalls.rows[0];

    return res.json({
      success: true,
      days,
      totals: {
        usd: Math.round((Number(ak.usd) + Number(as_.usd) + Number(ac.usd)) * 100) / 100,
        tokens: Number(at.tokens) + Number(ak.tokens),
      },
      byDay,
      bySource: {
        tips:    { count: at.count,  tokens: Number(at.tokens),  usd: 0 },
        tickets: { count: ak.count,  tokens: Number(ak.tokens),  usd: Number(ak.usd) },
        subs:    { count: as_.count, tokens: 0,                  usd: Number(as_.usd) },
        calls:   { count: ac.count,  tokens: 0,                  usd: Number(ac.usd) },
      },
    });
  } catch (err) {
    logger.error('getCreatorRevenue error', { creatorId, days, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load revenue data' });
  }
};

// ── Manual Going-Live Broadcast ───────────────────────────────────────────────

const goingLiveBroadcastService = require('../../../services/goingLiveBroadcastService');

/**
 * POST /api/webapp/live/broadcast-live-now
 * Creator-only. Fires the same going-live notification as the auto stream:start event.
 * Same 6h Redis dedup key — both paths together produce at most one alert per 6h.
 * Body: { message?: string }  (optional, max 240 chars)
 */
const broadcastLiveNow = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;
  if (!['model', 'creator', 'admin', 'superadmin'].includes(user.role)) {
    return res.status(403).json({ success: false, error: 'Creator access required' });
  }

  const rawMessage = req.body?.message;
  if (rawMessage !== undefined && rawMessage !== null) {
    if (typeof rawMessage !== 'string') {
      return res.status(400).json({ success: false, error: 'message must be a string' });
    }
    if (rawMessage.length > 240) {
      return res.status(400).json({ success: false, error: 'message exceeds 240 character limit' });
    }
  }

  const creatorId = String(user.id);
  const customMessage = (typeof rawMessage === 'string' && rawMessage.trim()) ? rawMessage.trim() : null;

  try {
    let channelRef = null;
    try {
      const { rows } = await getPool().query('SELECT live_channel FROM users WHERE id = $1', [creatorId]);
      channelRef = rows[0]?.live_channel || null;
    } catch { /* non-fatal */ }

    const bot = req.app.get('bot') || null;
    const result = await goingLiveBroadcastService.broadcastGoingLive(bot, creatorId, channelRef, { message: customMessage });

    logger.info('broadcastLiveNow: manual trigger', { creatorId, channelRef, ...result });
    return res.json({ success: true, dispatched: result.dispatched, skippedDedup: result.skippedDedup });
  } catch (err) {
    logger.error('broadcastLiveNow error', { creatorId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to broadcast notification' });
  }
};

// ── Gap 1: Earnings history ───────────────────────────────────────────────────

/**
 * GET /api/webapp/live/earnings
 * Returns past-session earnings aggregates for the authenticated creator.
 * Response: { totalAllTime, totalLast30Days, recentSessions: [{ sessionId, startedAt, endedAt, earnings, viewerPeak }] }
 */
const getEarningsHistory = async (req, res) => {
  const creatorId = String(req.user.id);
  try {
    // Totals — all-time and last 30 days
    const totalsResult = await getPool().query(
      `SELECT
         COALESCE(SUM(ce.amount_gross), 0)::numeric(12,2)                              AS total_all_time,
         COALESCE(SUM(ce.amount_gross) FILTER (WHERE ce.created_at >= NOW() - INTERVAL '30 days'), 0)::numeric(12,2) AS total_last_30
       FROM creator_earnings ce
       WHERE ce.creator_id = $1`,
      [creatorId]
    );

    const totals = totalsResult.rows[0];

    // Recent sessions with per-session tip totals
    const sessionsResult = await getPool().query(
      `SELECT
         ss.id                                                                 AS session_id,
         ss.started_at,
         ss.ended_at,
         ss.peak_viewers                                                       AS viewer_peak,
         COALESCE(
           (SELECT SUM(ce2.amount_gross)
            FROM creator_earnings ce2
            WHERE ce2.creator_id = ss.creator_id
              AND ce2.created_at BETWEEN ss.started_at AND COALESCE(ss.ended_at, NOW())
           ), 0
         )::numeric(10,2)                                                      AS earnings
       FROM stream_sessions ss
       WHERE ss.creator_id = $1
       ORDER BY ss.started_at DESC
       LIMIT 20`,
      [creatorId]
    );

    return res.json({
      success: true,
      totalAllTime: parseFloat(totals.total_all_time),
      totalLast30Days: parseFloat(totals.total_last_30),
      recentSessions: sessionsResult.rows.map((r) => ({
        sessionId: String(r.session_id),
        startedAt: r.started_at,
        endedAt: r.ended_at,
        earnings: parseFloat(r.earnings),
        viewerPeak: r.viewer_peak,
      })),
    });
  } catch (err) {
    logger.error('getEarningsHistory error', { creatorId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load earnings history' });
  }
};

// ── Gap 4: Local recording upload ────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const RECORDING_UPLOAD_DIR = '/opt/pnptvapp/storage/stream-recordings';
const MAX_LOCAL_RECORDINGS_PER_USER = 5;

// Ensure upload directory exists at module load time (non-fatal)
try { fs.mkdirSync(RECORDING_UPLOAD_DIR, { recursive: true }); } catch { /* ok */ }

const localRecordingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RECORDING_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const userId = req.user?.id || 'unknown';
      const ts = Date.now();
      const ext = file.mimetype === 'video/mp4' ? '.mp4' : '.webm';
      cb(null, `${userId}-${ts}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 * 1024 }, // 3 GB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'video/webm' || file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only webm and mp4 video files are accepted'));
    }
  },
}).single('file');

/**
 * POST /api/webapp/live/recording
 * Multipart: field "file" (video/webm or video/mp4), optional text fields "sessionId", "durationSec".
 * Saves to disk, inserts row into stream_local_uploads, caps at 5 per user (deletes oldest).
 */
const uploadLocalRecording = (req, res) => {
  localRecordingUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'File exceeds 3 GB limit' });
      }
      return res.status(400).json({ success: false, error: uploadErr.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // H-3: Magic bytes check — verify the file is actually a video (MP4 or WebM)
    // regardless of the declared MIME type. Read first 12 bytes from disk.
    try {
      const fd = fs.openSync(req.file.path, 'r');
      const header = Buffer.alloc(12);
      fs.readSync(fd, header, 0, 12, 0);
      fs.closeSync(fd);
      // WebM: starts with \x1a\x45\xdf\xa3
      const isWebM = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
      // MP4/MOV: bytes 4–7 are 'ftyp' (0x66 0x74 0x79 0x70)
      const isMp4 = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70;
      if (!isWebM && !isMp4) {
        try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
        logger.warn('uploadLocalRecording: magic bytes mismatch — file rejected', {
          userId: req.user?.id,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          headerHex: header.toString('hex'),
        });
        return res.status(400).json({ success: false, error: 'File type does not match its contents. Only mp4 and webm videos are accepted.' });
      }
    } catch (magicErr) {
      try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
      logger.error('uploadLocalRecording: magic bytes read error', { err: magicErr.message });
      return res.status(500).json({ success: false, error: 'File verification failed' });
    }

    const userId = BigInt(req.user.id);
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.slice(0, 128) : null;
    const durationSec = req.body?.durationSec ? parseInt(req.body.durationSec, 10) || null : null;
    const storagePath = req.file.path;
    const sizeBytes = req.file.size;
    const mimeType = req.file.mimetype;
    const filename = req.file.filename;
    const publicUrl = `/static/stream-recordings/${filename}`;

    try {
      // Insert new recording row
      const insertResult = await getPool().query(
        `INSERT INTO stream_local_uploads (user_id, session_id, storage_path, public_url, size_bytes, duration_sec, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [String(userId), sessionId, storagePath, publicUrl, sizeBytes, durationSec, mimeType]
      );

      const newId = insertResult.rows[0].id;

      // Enforce max 5 recordings per user — delete oldest file + row on overflow
      const allRows = await getPool().query(
        `SELECT id, storage_path FROM stream_local_uploads WHERE user_id = $1 ORDER BY created_at ASC`,
        [String(userId)]
      );

      if (allRows.rows.length > MAX_LOCAL_RECORDINGS_PER_USER) {
        const toDelete = allRows.rows.slice(0, allRows.rows.length - MAX_LOCAL_RECORDINGS_PER_USER);
        for (const old of toDelete) {
          try { fs.unlinkSync(old.storage_path); } catch { /* file may already be gone */ }
          await getPool().query('DELETE FROM stream_local_uploads WHERE id = $1', [old.id]);
        }
      }

      return res.json({ success: true, id: String(newId), publicUrl, sizeBytes });
    } catch (err) {
      // Clean up the uploaded file on DB error
      try { fs.unlinkSync(storagePath); } catch { /* ok */ }
      logger.error('uploadLocalRecording DB error', { userId: String(userId), err: err.message });
      return res.status(500).json({ success: false, error: 'Failed to save recording' });
    }
  });
};

// ── Gap 2 (snapshots): Snapshot upload & persistence ─────────────────────────

const SNAPSHOT_DIR = '/opt/pnptvapp/storage/stream-snapshots';
try { require('fs').mkdirSync(SNAPSHOT_DIR, { recursive: true }); } catch { /* ok */ }

const SNAPSHOT_MAX_BYTES  = 4 * 1024 * 1024;  // 4 MB decoded
const SNAPSHOT_MAX_RETAIN = 30;                // per-user retention cap

/**
 * POST /api/webapp/live/snapshot
 * Body: { dataUrl: string, sessionId?: string }
 * Converts to WebP via sharp, stores under SNAPSHOT_DIR, inserts into
 * stream_snapshots and caps per-user rows at 30 (deletes oldest + files).
 */
const uploadSnapshot = async (req, res) => {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return res.status(500).json({ success: false, error: 'Image processing unavailable' });
  }

  const userId = req.user.pnptvId || req.user.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { dataUrl, sessionId } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'dataUrl is required' });
  }

  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    return res.status(400).json({ success: false, error: 'Invalid dataUrl format' });
  }
  const imageBuffer = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');

  if (imageBuffer.byteLength > SNAPSHOT_MAX_BYTES) {
    return res.status(413).json({ success: false, error: 'Snapshot exceeds 4 MB limit' });
  }

  const pool = getPool();
  const fs   = require('fs');
  const path = require('path');

  const filename  = `${userId}-${Date.now()}.webp`;
  const filePath  = path.join(SNAPSHOT_DIR, filename);
  const publicUrl = `/static/stream-snapshots/${filename}`;

  try {
    const info = await sharp(imageBuffer)
      .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(filePath);

    const sizeBytes = info.size || imageBuffer.byteLength;

    const { rows: inserted } = await pool.query(
      `INSERT INTO stream_snapshots (user_id, session_id, storage_path, public_url, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [String(userId), sessionId || null, filePath, publicUrl, sizeBytes]
    );
    const newId = inserted[0].id;

    // Enforce per-user retention cap: keep only newest SNAPSHOT_MAX_RETAIN rows
    const { rows: oldRows } = await pool.query(
      `SELECT id, storage_path FROM stream_snapshots
       WHERE user_id = $1
       ORDER BY created_at DESC
       OFFSET $2`,
      [String(userId), SNAPSHOT_MAX_RETAIN]
    );

    if (oldRows.length > 0) {
      const oldIds = oldRows.map((r) => r.id);
      await pool.query(
        `DELETE FROM stream_snapshots WHERE id = ANY($1::bigint[])`,
        [oldIds]
      );
      for (const row of oldRows) {
        try { fs.unlinkSync(row.storage_path); } catch { /* already gone — skip */ }
      }
    }

    return res.json({ success: true, id: String(newId), publicUrl });
  } catch (err) {
    // Clean up partial file if write failed
    try { require('fs').unlinkSync(filePath); } catch { /* ok */ }
    logger.error('uploadSnapshot error', { userId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to process snapshot' });
  }
};

// ── Gap 5: Scene & Mixer presets ─────────────────────────────────────────────

/**
 * GET /api/webapp/live/scene-presets
 */
const getScenePresets = async (req, res) => {
  const userId = String(req.user.id);
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, config, is_default, updated_at
       FROM stream_scene_presets WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );
    return res.json({
      success: true,
      presets: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        config: r.config,
        isDefault: r.is_default,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    logger.error('getScenePresets error', { userId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load scene presets' });
  }
};

/**
 * POST /api/webapp/live/scene-presets
 * Body: { name: string, config: object, isDefault?: boolean }
 * Upserts on (user_id, name). If isDefault=true, clears other defaults first (transaction).
 */
const saveScenePreset = async (req, res) => {
  const userId = String(req.user.id);
  const { name, config, isDefault = false } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return res.status(400).json({ success: false, error: 'config must be a JSON object' });
  }
  if (JSON.stringify(config).length > 64_000) {
    return res.status(400).json({ success: false, error: 'config exceeds maximum allowed size' });
  }

  const trimmedName = name.trim().slice(0, 100);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (isDefault) {
      await client.query(
        'UPDATE stream_scene_presets SET is_default = FALSE WHERE user_id = $1',
        [userId]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO stream_scene_presets (user_id, name, config, is_default, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, name) DO UPDATE
         SET config     = EXCLUDED.config,
             is_default = EXCLUDED.is_default,
             updated_at = NOW()
       RETURNING id, name, config, is_default, updated_at`,
      [userId, trimmedName, JSON.stringify(config), Boolean(isDefault)]
    );

    await client.query('COMMIT');
    const row = rows[0];
    return res.json({
      success: true,
      preset: {
        id: String(row.id),
        name: row.name,
        config: row.config,
        isDefault: row.is_default,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('saveScenePreset error', { userId, name: trimmedName, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save scene preset' });
  } finally {
    client.release();
  }
};

/**
 * GET /api/webapp/live/mixer-presets
 */
const getMixerPresets = async (req, res) => {
  const userId = String(req.user.id);
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, config, is_default, updated_at
       FROM stream_mixer_presets WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );
    return res.json({
      success: true,
      presets: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        config: r.config,
        isDefault: r.is_default,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    logger.error('getMixerPresets error', { userId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load mixer presets' });
  }
};

/**
 * POST /api/webapp/live/mixer-presets
 * Body: { name: string, config: object, isDefault?: boolean }
 */
const saveMixerPreset = async (req, res) => {
  const userId = String(req.user.id);
  const { name, config, isDefault = false } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return res.status(400).json({ success: false, error: 'config must be a JSON object' });
  }
  if (JSON.stringify(config).length > 64_000) {
    return res.status(400).json({ success: false, error: 'config exceeds maximum allowed size' });
  }

  const trimmedName = name.trim().slice(0, 100);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (isDefault) {
      await client.query(
        'UPDATE stream_mixer_presets SET is_default = FALSE WHERE user_id = $1',
        [userId]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO stream_mixer_presets (user_id, name, config, is_default, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, name) DO UPDATE
         SET config     = EXCLUDED.config,
             is_default = EXCLUDED.is_default,
             updated_at = NOW()
       RETURNING id, name, config, is_default, updated_at`,
      [userId, trimmedName, JSON.stringify(config), Boolean(isDefault)]
    );

    await client.query('COMMIT');
    const row = rows[0];
    return res.json({
      success: true,
      preset: {
        id: String(row.id),
        name: row.name,
        config: row.config,
        isDefault: row.is_default,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('saveMixerPreset error', { userId, name: trimmedName, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save mixer preset' });
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------------------
// GET /api/webapp/streams/:streamId/health
// Owner-only stream health endpoint. Returns RTMP input signal state, bitrate,
// fps, viewer count, and uptime derived from the Restreamer process record plus
// the live:viewers Redis key.
//
// Auth: requireSessionAuth (session cookie). Owner or admin/superadmin only.
// Redis cache key: stream:health:{channelRef} — 4-second TTL to absorb polling.
// ---------------------------------------------------------------------------
const getStreamHealth = async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const user = req.session.user;
  const { streamId } = req.params;

  // Sanitize the incoming streamId (channel ref)
  const channelRef = sanitizeRefId(streamId);
  if (!channelRef) {
    return res.status(400).json({ success: false, error: 'Invalid stream ID' });
  }

  const redis = getRedis();

  // ── Redis cache (4s TTL) to absorb 5s frontend polling ──────────────────
  const cacheKey = `stream:health:${channelRef}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        return res.json(JSON.parse(cached));
      } catch {
        // corrupt cache — fall through to fresh fetch
      }
    }
  } catch {
    // Redis unavailable — fall through
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  // Admins / superadmins bypass the ownership check.
  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  if (!isAdmin) {
    try {
      const { rows } = await getPool().query(
        'SELECT live_channel FROM users WHERE id = $1',
        [user.id]
      );
      const ownerChannelRef = rows[0]?.live_channel;
      if (!ownerChannelRef || ownerChannelRef !== channelRef) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    } catch (dbErr) {
      logger.error('getStreamHealth: DB ownership check failed', { userId: user.id, channelRef, err: dbErr.message });
      return res.status(500).json({ success: false, error: 'Internal error' });
    }
  }

  // ── Fetch Restreamer process + viewer count in parallel ───────────────────
  let proc = null;
  let viewerCount = 0;

  try {
    const [procResult, viewerRaw] = await Promise.allSettled([
      restreamerService.getProcess(channelRef),
      redis.get(`live:viewers:${channelRef}`).catch(() => null),
    ]);

    if (procResult.status === 'fulfilled') {
      proc = procResult.value;
    } else if (procResult.reason?.restreamerUnavailable) {
      // Restreamer unreachable — return graceful unknown state (HTTP 200)
      const body = { inputState: 'unknown', bitrateKbps: 0, fps: 0, viewerCount: 0, lastInputAt: null, uptimeSeconds: 0, error: 'restreamer_unreachable' };
      try { await redis.set(cacheKey, JSON.stringify(body), 'EX', 4); } catch { /* ignore */ }
      return res.json(body);
    } else {
      throw procResult.reason;
    }

    if (viewerRaw.status === 'fulfilled') {
      viewerCount = Math.max(0, parseInt(viewerRaw.value, 10) || 0);
    }
  } catch (err) {
    if (err?.restreamerUnavailable) {
      const body = { inputState: 'unknown', bitrateKbps: 0, fps: 0, viewerCount: 0, lastInputAt: null, uptimeSeconds: 0, error: 'restreamer_unreachable' };
      try { await redis.set(cacheKey, JSON.stringify(body), 'EX', 4); } catch { /* ignore */ }
      return res.json(body);
    }
    logger.error('getStreamHealth: unexpected error', { channelRef, err: err.message });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }

  // ── Build health payload from process data ────────────────────────────────
  // Restreamer v3 process state structure:
  //   proc.state.exec          — 'running' | 'idle' | 'failed' | 'killed' | 'starting'
  //   proc.state.runtime       — FFmpeg progress object (populated when running)
  //     .speed                 — playback speed multiplier (string like "1x")
  //     .fps                   — current frames per second (number)
  //     .bitrate               — input bitrate string (e.g. "2500.0kbits/s")
  //     .time                  — duration processed in seconds
  //   proc.state.last_logline  — last FFmpeg log line (error info when failed)

  const execState = proc?.state?.exec || 'idle';
  const runtime = proc?.state?.runtime || {};

  // Derive inputState
  let inputState;
  if (execState === 'running') {
    inputState = 'connected';
  } else if (execState === 'failed' || execState === 'killed') {
    inputState = 'failed';
  } else {
    inputState = 'idle';
  }

  // Parse bitrate string: "2500.0kbits/s" → 2500
  let bitrateKbps = 0;
  if (runtime.bitrate) {
    const bitrateStr = String(runtime.bitrate);
    const match = bitrateStr.match(/([\d.]+)\s*kbits/i);
    if (match) {
      bitrateKbps = Math.round(parseFloat(match[1]));
    }
  }

  // Parse fps
  const fps = typeof runtime.fps === 'number' ? Math.round(runtime.fps) : 0;

  // Uptime: proc.state.runtime.time is seconds elapsed in the current process run
  const uptimeSeconds = typeof runtime.time === 'number' ? Math.floor(runtime.time) : 0;

  // lastInputAt: if process is running we set it to now; otherwise null
  const lastInputAt = execState === 'running' ? new Date().toISOString() : null;

  // Error message from last log line (failed state)
  const errorMessage = execState === 'failed' || execState === 'killed'
    ? (proc?.state?.last_logline || 'Stream process terminated unexpectedly')
    : undefined;

  const body = {
    inputState,
    bitrateKbps,
    fps,
    viewerCount,
    lastInputAt,
    uptimeSeconds,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };

  // Cache for 4 seconds
  try { await redis.set(cacheKey, JSON.stringify(body), 'EX', 4); } catch { /* ignore */ }

  return res.json(body);
};

module.exports = {
  listStreams,
  getRtmpKey,
  provisionChannel,
  assignChannel,
  listChannels,
  getSchedule,
  subscribeScheduleNotify,
  unsubscribeScheduleNotify,
  checkScheduleNotify,
  initiateRaid,
  setHostedChannel,
  getHostedChannel,
  getAnalyticsSessions,
  getAnalyticsSummary,
  getSlotTicketStatus,
  buySlotTicket,
  handleTicketSettlement,
  listCreatorRecordings,
  deleteRecordingEndpoint,
  updateRecordingEndpoint,
  getCreatorRevenue,
  broadcastLiveNow,
  // Gap 1
  getEarningsHistory,
  // Gap 2 (snapshots)
  uploadSnapshot,
  // Gap 4
  uploadLocalRecording,
  // Gap 5
  getScenePresets,
  saveScenePreset,
  getMixerPresets,
  saveMixerPreset,
  getStreamHealth,
};
