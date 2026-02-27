const axios = require('axios');
const logger = require('../../../utils/logger');

// Cached PDS session token
let _pdsAccessJwt = null;
let _pdsJwtExpiry = 0;

async function getPdsAccessToken() {
  const now = Date.now();
  if (_pdsAccessJwt && now < _pdsJwtExpiry) {
    return _pdsAccessJwt;
  }
  const pdsUrl = process.env.BLUESKY_PDS_URL || 'http://bluesky-pds:3000';
  const pdsHandle = process.env.PDS_ADMIN_HANDLE || '';
  const pdsPassword = process.env.PDS_ACCOUNT_PASSWORD || '';
  if (!pdsHandle || !pdsPassword) return null;

  const resp = await axios.post(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
    identifier: pdsHandle,
    password: pdsPassword,
  }, { timeout: 10000 });

  _pdsAccessJwt = resp.data?.accessJwt;
  _pdsJwtExpiry = now + 90 * 60 * 1000;
  return _pdsAccessJwt;
}

// GET /api/proxy/social/feed — PDS/Bluesky feed proxy
const getFeed = async (req, res) => {
  try {
    const pdsUrl = process.env.BLUESKY_PDS_URL || 'http://bluesky-pds:3000';
    const pdsHandle = process.env.PDS_ADMIN_HANDLE || '';
    const { limit = 20 } = req.query;

    if (!pdsHandle) {
      return res.json({ success: true, posts: [], message: 'No PDS handle configured' });
    }

    const token = await getPdsAccessToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const handleResp = await axios.get(`${pdsUrl}/xrpc/com.atproto.identity.resolveHandle`, {
      params: { handle: pdsHandle },
      timeout: 5000,
    });
    const did = handleResp.data?.did;
    if (!did) {
      return res.json({ success: true, posts: [], message: 'Could not resolve handle' });
    }

    const resp = await axios.get(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`, {
      params: { repo: did, collection: 'app.bsky.feed.post', limit: +limit, reverse: true },
      headers,
      timeout: 10000,
    });

    let profileName = '';
    try {
      const profileResp = await axios.get(`${pdsUrl}/xrpc/com.atproto.repo.getRecord`, {
        params: { repo: did, collection: 'app.bsky.actor.profile', rkey: 'self' },
        headers,
        timeout: 5000,
      });
      profileName = profileResp.data?.value?.displayName || '';
    } catch (_) { /* ignore if no profile */ }

    const posts = (resp.data?.records || []).map((record) => ({
      uri: record.uri,
      cid: record.cid,
      author: {
        handle: pdsHandle,
        displayName: profileName,
        avatar: '',
      },
      record: {
        text: record.value?.text || '',
        createdAt: record.value?.createdAt || '',
      },
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
    }));

    res.json({ success: true, posts });
  } catch (error) {
    logger.error('Social proxy feed error:', error.message);
    if (error.response?.status === 401) {
      _pdsAccessJwt = null;
      _pdsJwtExpiry = 0;
    }
    res.json({ success: true, posts: [], message: 'Feed temporarily unavailable' });
  }
};

module.exports = { getFeed };
