'use strict';

/**
 * restreamerService.js
 *
 * Centralised Restreamer HTTP API v3 client.
 * Token auth is cached module-level for 55 minutes (tokens expire in ~1h).
 *
 * Used by webappLiveController for both the existing read paths and the new
 * self-serve channel provisioning flow.
 */

const axios = require('axios');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Token cache (module-level singleton — survives across requests)
// ---------------------------------------------------------------------------
const _tokenCache = {
  token: null,
  expiresAt: 0,
  TTL_MS: 55 * 60 * 1000,
};

function _baseUrl() {
  return (process.env.RESTREAMER_URL || 'http://restreamer:8080').replace(/\/$/, '');
}

/**
 * Authenticate and return a Bearer token.
 * Returns null if credentials are not configured or login fails.
 *
 * @returns {Promise<string|null>}
 */
async function getToken() {
  const user = process.env.RESTREAMER_USER;
  const pass = process.env.RESTREAMER_PASSWORD;
  if (user === undefined || pass === undefined) return null;

  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  try {
    const resp = await axios.post(`${_baseUrl()}/api/login`, {
      username: user,
      password: pass,
    }, { timeout: 5000 });
    const token = resp.data?.access_token ?? null;
    if (token) {
      _tokenCache.token = token;
      _tokenCache.expiresAt = Date.now() + _tokenCache.TTL_MS;
    }
    return token;
  } catch (err) {
    _tokenCache.token = null;
    _tokenCache.expiresAt = 0;
    logger.warn(`[restreamerService] login failed: ${err.message}`);
    return null;
  }
}

/**
 * @param {string|null} token
 * @returns {Object}
 */
function _authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Tag an error as originating from Restreamer being unreachable / unhealthy.
 * @param {Error} err
 * @returns {Error}
 */
function _markUnavailable(err) {
  err.restreamerUnavailable = true;
  return err;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all RTMP ingest processes from Restreamer.
 * Filters to processes whose ID starts with 'restreamer-ui:ingest:'.
 *
 * @returns {Promise<Array>}
 * @throws {Error} with .restreamerUnavailable = true on network / API failure
 */
async function listProcesses() {
  const doRequest = async (tok) =>
    axios.get(`${_baseUrl()}/api/v3/process`, { headers: _authHeaders(tok), timeout: 5000 });
  try {
    const token = await getToken();
    let resp;
    try {
      resp = await doRequest(token);
    } catch (err) {
      if (err.response?.status === 401) {
        _tokenCache.token = null;
        _tokenCache.expiresAt = 0;
        const fresh = await getToken();
        resp = await doRequest(fresh);
      } else throw err;
    }
    if (resp.status !== 200) {
      throw _markUnavailable(new Error(`Restreamer returned status ${resp.status}`));
    }
    return (resp.data || []).filter(p => p.id?.startsWith('restreamer-ui:ingest:'));
  } catch (err) {
    if (!err.restreamerUnavailable) {
      logger.warn(`[restreamerService] listProcesses failed: ${err.message}`);
      throw _markUnavailable(err);
    }
    throw err;
  }
}

/**
 * Fetch a single ingest process by its reference slug.
 * Returns null if not found.
 *
 * @param {string} refId  — e.g. 'pnptv-frank'
 * @returns {Promise<Object|null>}
 * @throws {Error} with .restreamerUnavailable = true on network / API failure
 */
async function getProcess(refId) {
  const doRequest = async (tok) =>
    axios.get(`${_baseUrl()}/api/v3/process/restreamer-ui:ingest:${refId}`, {
      headers: _authHeaders(tok),
      timeout: 5000,
    });
  try {
    const token = await getToken();
    try {
      const resp = await doRequest(token);
      return resp.data ?? null;
    } catch (err) {
      if (err.response?.status === 401) {
        _tokenCache.token = null;
        _tokenCache.expiresAt = 0;
        const fresh = await getToken();
        const resp2 = await doRequest(fresh);
        return resp2.data ?? null;
      }
      throw err;
    }
  } catch (err) {
    if (err.response?.status === 404) return null;
    logger.warn(`[restreamerService] getProcess(${refId}) failed: ${err.message}`);
    throw _markUnavailable(err);
  }
}

/**
 * Build the Restreamer v3 process config for an RTMP ingest + HLS output pipeline.
 *
 * Process ID format:   restreamer-ui:ingest:<refId>
 * RTMP input address:  {rtmp,name=<refId>}
 * HLS output address:  {memfs}/<refId>.m3u8
 *
 * The stream key that a creator enters in OBS equals <refId> (the RTMP name).
 * This keeps the key predictable and human-readable without a separate lookup.
 *
 * @param {string} refId     — sanitized slug, e.g. 'pnptv-frank'
 * @param {string} title     — display name for the Restreamer UI
 * @returns {Object}         — POST body for /api/v3/process
 */
function _buildProcessConfig(refId, title) {
  const processId = `restreamer-ui:ingest:${refId}`;
  // The bot's socket stream handler pushes to rtmp://restreamer:1935/live/<streamKey>
  // where streamKey strips the 'pnptv-' prefix (see socketHandlers.js:1770). The
  // Restreamer input {rtmp,name=X} MUST match that stripped name, or FFmpeg fails
  // to open its input and the HLS output never produces segments.
  const rtmpName = refId.startsWith('pnptv-') ? refId.slice('pnptv-'.length) : refId;

  // Restreamer's /api/v3/process validator expects the ProcessConfig fields
  // (id, type, input, output, ...) at the top level — NOT nested under `config`.
  return {
    id: processId,
    type: 'ffmpeg',
    reference: refId,
    input: [
      {
        id: 'input_0',
        address: `{rtmp,name=${rtmpName}}`,
        options: ['-fflags', '+genpts'],
      },
    ],
    output: [
      {
        id: 'output_0',
        address: `{memfs}/${refId}.m3u8`,
        options: [
          '-codec:v', 'copy',
          '-codec:a', 'aac',
          '-b:a', '128k',
          '-af', 'afftdn=nf=-25',
          '-f', 'hls',
          '-hls_time', '1',
          '-hls_list_size', '5',
          '-hls_flags', 'delete_segments+append_list',
          '-hls_delete_threshold', '4',
          '-hls_segment_filename', `{memfs}/${refId}_%04d.ts`,
          '-method', 'PUT',
        ],
      },
      {
        id: 'output_1',
        address: `{memfs}/${refId}_720p.m3u8`,
        options: [
          '-codec:v', 'libx264',
          '-preset', 'veryfast',
          '-maxrate', '800k',
          '-bufsize', '1600k',
          '-vf', 'scale=1280:-2',
          '-codec:a', 'aac',
          '-b:a', '96k',
          '-af', 'afftdn=nf=-25',
          '-f', 'hls',
          '-hls_time', '1',
          '-hls_list_size', '5',
          '-hls_flags', 'delete_segments+append_list',
          '-hls_delete_threshold', '4',
          '-hls_segment_filename', `{memfs}/${refId}_720p_%04d.ts`,
          '-method', 'PUT',
        ],
      },
    ],
    options: ['-err_detect', 'ignore_err'],
    reconnect: true,
    reconnect_delay_seconds: 1,
    autostart: true,
    stale_timeout_seconds: 30,
  };
}

/**
 * Create a new RTMP ingest + HLS pipeline in Restreamer.
 *
 * Collision strategy: if a process with the same refId already exists (HTTP 409
 * or the process is returned by getProcess), we return the existing process
 * rather than erroring — idempotent from the caller's perspective.
 *
 * @param {{ refId: string, title: string }} opts
 * @returns {Promise<{ refId: string, streamKey: string }>}
 * @throws {Error} with .restreamerUnavailable = true on network failure
 */
async function createProcess({ refId, title }) {
  // Check for existing process first (idempotent)
  let existing;
  try {
    existing = await getProcess(refId);
  } catch (err) {
    throw err; // already marked unavailable
  }

  if (existing) {
    logger.info(`[restreamerService] createProcess: process '${refId}' already exists — returning existing`);
    return { refId, streamKey: refId };
  }

  const body = _buildProcessConfig(refId, title);

  try {
    const token = await getToken();
    const resp = await axios.post(`${_baseUrl()}/api/v3/process`, body, {
      headers: { ..._authHeaders(token), 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    if (resp.status === 409) {
      // Race condition: another request created it between our check and POST
      logger.info(`[restreamerService] createProcess: 409 conflict for '${refId}' — treating as existing`);
      return { refId, streamKey: refId };
    }

    if (resp.status < 200 || resp.status >= 300) {
      const err = new Error(`Restreamer returned status ${resp.status} on create`);
      throw _markUnavailable(err);
    }

    logger.info(`[restreamerService] createProcess: created '${refId}' (status ${resp.status})`);
    return { refId, streamKey: refId };
  } catch (err) {
    // axios throws on non-2xx; 409 is caught above if axios config allows it
    if (err.response?.status === 409) {
      logger.info(`[restreamerService] createProcess: 409 (axios throw) for '${refId}' — treating as existing`);
      return { refId, streamKey: refId };
    }
    if (!err.restreamerUnavailable) {
      logger.warn(`[restreamerService] createProcess('${refId}') failed: ${err.message}`);
      throw _markUnavailable(err);
    }
    throw err;
  }
}

/**
 * Delete an ingest process by refId. Admin-only utility.
 *
 * @param {string} refId
 * @returns {Promise<void>}
 * @throws {Error} with .restreamerUnavailable = true on network failure
 */
async function deleteProcess(refId) {
  try {
    const token = await getToken();
    await axios.delete(
      `${_baseUrl()}/api/v3/process/restreamer-ui:ingest:${refId}`,
      { headers: _authHeaders(token), timeout: 5000 }
    );
    logger.info(`[restreamerService] deleteProcess: deleted '${refId}'`);
  } catch (err) {
    if (err.response?.status === 404) {
      logger.warn(`[restreamerService] deleteProcess: '${refId}' not found — nothing to delete`);
      return;
    }
    logger.warn(`[restreamerService] deleteProcess('${refId}') failed: ${err.message}`);
    throw _markUnavailable(err);
  }
}

module.exports = {
  getToken,
  listProcesses,
  getProcess,
  createProcess,
  deleteProcess,
};
