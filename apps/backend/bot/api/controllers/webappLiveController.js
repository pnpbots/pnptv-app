const crypto = require('crypto');
const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const axios = require('axios');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// GET /api/webapp/live/streams
// Proxies to Restreamer API and returns active HLS streams.
const listStreams = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
  const restreamerUser = process.env.RESTREAMER_USER;
  const restreamerPass = process.env.RESTREAMER_PASSWORD;

  try {
    let token = null;
    if (restreamerUser && restreamerPass) {
      try {
        const loginResp = await axios.post(`${restreamerUrl}/api/login`, {
          username: restreamerUser,
          password: restreamerPass,
        }, { timeout: 5000 });
        token = loginResp.data?.access_token;
      } catch (loginErr) {
        logger.warn(`listStreams: Restreamer login failed, trying without auth: ${loginErr.message}`);
      }
    }

    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await axios.get(`${restreamerUrl}/api/v3/process`, {
      headers,
      timeout: 10000,
    });

    const publicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
    const processes = resp.data || [];
    const streams = processes
      .filter((p) => p.id?.startsWith('restreamer-ui:ingest:'))
      .map((p) => {
        const refId = p.reference || p.id;
        return {
          id: p.id,
          name: p.metadata?.['restreamer-ui']?.meta?.name || 'Live Stream',
          description: p.metadata?.['restreamer-ui']?.meta?.description || '',
          hlsUrl: `${publicUrl}/memfs/${refId}.m3u8`,
          isLive: p.state?.exec === 'running',
        };
      });

    return res.json({ success: true, streams });
  } catch (err) {
    logger.error('webapp listStreams error', err);
    return res.status(502).json({ success: false, error: 'Failed to load streams from Restreamer' });
  }
};

// GET /api/webapp/live/rtmp-key
// Returns the RTMP ingest URL and a per-user stream key for creators/admins.
// The stream key is generated once per user and stored permanently in Redis.
const getRtmpKey = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;

  if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'creator') {
    return res.status(403).json({ success: false, error: 'Creator or admin role required' });
  }

  const restreamerUrl = process.env.RESTREAMER_URL || 'http://restreamer:8080';
  const restreamerPublicUrl = process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app';

  if (!process.env.RESTREAMER_USER || !process.env.RESTREAMER_PASSWORD) {
    return res.status(503).json({ success: false, error: 'Live streaming not configured' });
  }

  try {
    // Authenticate with Restreamer to verify it's reachable
    const loginResp = await fetch(`${restreamerUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.RESTREAMER_USER,
        password: process.env.RESTREAMER_PASSWORD,
      }),
    });

    if (!loginResp.ok) {
      logger.error('Restreamer login failed for rtmp-key', { status: loginResp.status });
      return res.status(503).json({ success: false, error: 'Live streaming not available' });
    }

    // Cryptographically random stream key, cached per user in Redis.
    // Generated once and persists until the user explicitly rotates it.
    const redis = getRedis();
    const redisKey = `rtmp:streamkey:${user.id}`;
    let streamKey = await redis.get(redisKey);
    if (!streamKey) {
      streamKey = crypto.randomBytes(20).toString('hex'); // 40-char random hex key
      await redis.set(redisKey, streamKey); // no TTL — permanent until rotated
    }

    const publicHost = restreamerPublicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // Note: RTMPS (rtmps://) requires TLS termination at the Restreamer level on port 443.
    // Configure infrastructure accordingly to upgrade from plain RTMP.
    const rtmpUrl = `rtmp://${publicHost}/live`;

    return res.json({ success: true, rtmpUrl, streamKey });
  } catch (err) {
    logger.error('getRtmpKey error', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve stream key' });
  }
};

module.exports = { listStreams, getRtmpKey };
