const logger = require('../../../utils/logger');
const { getPool } = require('../../../config/postgres');
const axios = require('axios');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

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
 * Returns an empty array on failure (non-fatal).
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
      timeout: 10000,
    });
    return (resp.data || []).filter(p => p.id?.startsWith('restreamer-ui:ingest:'));
  } catch (err) {
    logger.warn(`Restreamer process fetch failed: ${err.message}`);
    return [];
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
  const clean = refId.replace(/[^a-zA-Z0-9\-_.]/g, '');
  if (!clean || clean.includes('..')) return null;
  return clean;
}

// ---------------------------------------------------------------------------
// GET /api/webapp/live/streams
// Proxies to Restreamer API and returns active HLS streams.
// ---------------------------------------------------------------------------
const listStreams = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
  const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');

  try {
    const token = await getRestreamerToken(restreamerUrl);
    const processes = await fetchRestreamerProcesses(restreamerUrl, token);

    const streams = processes
      .map((p) => {
        const rawRefId = p.reference || p.id;
        const refId = sanitizeRefId(rawRefId);
        if (!refId) {
          logger.warn('listStreams: rejected process with unsafe reference ID', { rawRefId });
          return null;
        }
        return {
          id: p.id,
          name: p.metadata?.['restreamer-ui']?.meta?.name || 'Live Stream',
          description: p.metadata?.['restreamer-ui']?.meta?.description || '',
          hlsUrl: `${publicUrl}/memfs/${refId}.m3u8`,
          isLive: p.state?.exec === 'running',
        };
      })
      .filter(Boolean);

    return res.json({ success: true, streams });
  } catch (err) {
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
  const user = authGuard(req, res); if (!user) return;

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
    const token = await getRestreamerToken(restreamerUrl);
    const processes = await fetchRestreamerProcesses(restreamerUrl, token);
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
// POST /api/webapp/admin/live/assign-channel
// Admin-only: assign a Restreamer channel to a user (or unassign by passing null).
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
      const token = await getRestreamerToken(restreamerUrl);
      const processes = await fetchRestreamerProcesses(restreamerUrl, token);
      const exists = processes.some(p => p.reference === channelRef);
      if (!exists) {
        return res.status(404).json({
          error: `Channel '${channelRef}' does not exist in Restreamer. Available channels: ${processes.map(p => p.reference).join(', ')}`,
        });
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
    const [token, userRows] = await Promise.all([
      getRestreamerToken(restreamerUrl),
      getPool().query(
        `SELECT id, username, first_name, last_name, live_channel
         FROM users
         WHERE live_channel IS NOT NULL`
      ),
    ]);

    const processes = await fetchRestreamerProcesses(restreamerUrl, token);

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

module.exports = { listStreams, getRtmpKey, assignChannel, listChannels };
