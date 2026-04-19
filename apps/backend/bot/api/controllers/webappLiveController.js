const logger = require('../../../utils/logger');
const { getPool } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');
const axios = require('axios');
const restreamerService = require('../../../services/restreamerService');

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
          return {
            ...enriched,
            hostedChannelRef: safeHostedRef,
            hostedChannelName: target?.name || safeHostedRef,
            hostedHlsUrl: target?.hlsUrl || `${publicUrl}/memfs/${safeHostedRef}.m3u8`,
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

      logger.info(`provisionChannel: user ${user.id} already has channel '${dbUser.live_channel}' — returning existing`);
      return res.json({
        success: true,
        alreadyProvisioned: true,
        rtmpUrl,
        streamKey: dbUser.live_channel, // RTMP name equals refId
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

    logger.info(`provisionChannel: user ${user.id} provisioned channel '${finalRef}'`);
    return res.json({
      success: true,
      alreadyProvisioned: false,
      rtmpUrl,
      streamKey: finalRef,
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
const RAID_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between raids
const raidCooldowns = new Map(); // userId -> lastRaidTs

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

  // Cooldown check (in-process — prevents rapid-fire raids from REST endpoint)
  const now = Date.now();
  const lastRaid = raidCooldowns.get(String(user.id)) || 0;
  if (now - lastRaid < RAID_COOLDOWN_MS) {
    const remaining = Math.ceil((RAID_COOLDOWN_MS - (now - lastRaid)) / 1000);
    return res.status(429).json({ success: false, error: `Raid on cooldown. Try again in ${remaining}s.` });
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

    raidCooldowns.set(String(user.id), now);

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
// Body: { currency: 'tokens' | 'usd' }
// Tokens: atomic debit from user_token_wallets + ticket insert (same pattern as pnpLiveTipsService).
// USD: placeholder — 501 until ePayco/Daimo checkout is wired per project payment memory.
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
  if (currency !== 'tokens' && currency !== 'usd') {
    return res.status(400).json({ success: false, error: "currency must be 'tokens' or 'usd'" });
  }

  const userId = String(req.session.user.id);

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
        return res.json({ success: true, hasTicket: true, newBalance });
      } catch (txErr) {
        await client.query('ROLLBACK');
        logger.error('buySlotTicket token transaction error', txErr);
        return res.status(500).json({ success: false, error: 'Purchase failed — please try again' });
      } finally {
        client.release();
      }
    }

    // ── USD purchase path ────────────────────────────────────────────────────
    return res.status(501).json({
      success: false,
      error: 'USD ticket purchase not yet available — use tokens',
    });
  } catch (err) {
    logger.error('buySlotTicket error', err);
    return res.status(500).json({ success: false, error: 'Failed to process ticket purchase' });
  }
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
};
