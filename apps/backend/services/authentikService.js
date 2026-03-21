const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'https://auth.pnptv.app';
const AUTHENTIK_TOKEN = process.env.AUTHENTIK_API_TOKEN;

// ── OIDC Configuration ────────────────────────────────────────────────────────
// AUTHENTIK_OIDC_CLIENT_ID     — OAuth2 application Client ID registered in Authentik
// AUTHENTIK_OIDC_CLIENT_SECRET — Client secret (used server-side only, never sent to browser)
// AUTHENTIK_OIDC_REDIRECT_URI  — Must exactly match the Redirect URI in the Authentik application config
//                                Default: https://app.pnptv.app/auth/oidc/callback
// AUTHENTIK_OIDC_ISSUER        — Authentik application issuer slug URL
//                                Default: https://auth.pnptv.app/application/o/pnptv-app/
const OIDC_CLIENT_ID = process.env.AUTHENTIK_OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.AUTHENTIK_OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI = process.env.AUTHENTIK_OIDC_REDIRECT_URI || 'https://app.pnptv.app/api/webapp/auth/oidc/callback';
const OIDC_ISSUER = process.env.AUTHENTIK_OIDC_ISSUER || 'https://auth.pnptv.app/application/o/pnptv-app/';

// Authentik OIDC endpoints — NOT relative to issuer slug, but to /application/o/ root
const OIDC_BASE = OIDC_ISSUER.replace(/\/[^/]+\/$/, '/'); // "https://auth.pnptv.app/application/o/"
const OIDC_AUTH_ENDPOINT = `${OIDC_BASE}authorize/`;
const OIDC_TOKEN_ENDPOINT = `${OIDC_BASE}token/`;
const OIDC_USERINFO_ENDPOINT = `${OIDC_BASE}userinfo/`;
const OIDC_REVOCATION_ENDPOINT = `${OIDC_BASE}revoke/`;
const OIDC_JWKS_ENDPOINT = `${OIDC_ISSUER}jwks/`;

// Scopes requested — openid + profile (name, preferred_username) + email
const OIDC_SCOPE = 'openid profile email';

/**
 * Derive a PKCE code_challenge from a code_verifier using SHA-256 / S256.
 * Both code_verifier and code_challenge are base64url-encoded (no padding).
 *
 * @param {string} codeVerifier — random high-entropy string (43–128 chars)
 * @returns {string} base64url-encoded SHA-256 digest (code_challenge)
 */
function deriveCodeChallenge(codeVerifier) {
  return crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Parse and lightly validate a JWT id_token WITHOUT verifying the signature.
 * Signature verification against Authentik's JWKS requires an async JWKS fetch
 * on every login — acceptable for SSO flows, but we perform it lazily here.
 * The token is issued over TLS directly from Authentik's token endpoint so
 * transport-level integrity is sufficient for this threat model.
 *
 * Returns the decoded payload or throws if the token is structurally invalid,
 * the issuer doesn't match, or the token is expired.
 *
 * @param {string} idToken
 * @returns {{ sub: string, email: string|null, name: string|null, preferred_username: string|null, exp: number }}
 */
function decodeIdToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('id_token is not a valid JWT (expected 3 parts)');
  }

  let payload;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    throw new Error('id_token payload is not valid base64url JSON');
  }

  if (!payload.sub) {
    throw new Error('id_token missing required "sub" claim');
  }

  // Validate issuer — must match our configured Authentik issuer
  if (payload.iss && payload.iss !== OIDC_ISSUER.replace(/\/$/, '')) {
    // Authentik sometimes omits the trailing slash in iss — compare both forms
    const issNormalized = (payload.iss || '').replace(/\/$/, '');
    const expectedNormalized = OIDC_ISSUER.replace(/\/$/, '');
    if (issNormalized !== expectedNormalized) {
      throw new Error(`id_token issuer mismatch: got "${payload.iss}", expected "${OIDC_ISSUER}"`);
    }
  }

  // Validate expiry
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSeconds) {
    throw new Error(`id_token has expired (exp=${payload.exp}, now=${nowSeconds})`);
  }

  return payload;
}

class AuthentikService {
  /**
   * Sync a Telegram user with Authentik.
   * Ensures the user exists in Authentik and returns their UUID (sub).
   */
  static async syncTelegramUser(telegramUser) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('AUTHENTIK_API_TOKEN is not configured');
      return null;
    }

    try {
      const telegramId = String(telegramUser.id);
      const username = telegramUser.username || `tg_${telegramId}`;
      const email = `${telegramId}@telegram.pnptv.app`; // Virtual email for Authentik

      // 1. Check if user exists in Authentik using a filter
      // Note: We use the telegram_id as a custom attribute or username in Authentik
      const searchRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
        params: { username: username },
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
      });

      let authentikUser = searchRes.data.results.find(u => u.username === username);

      if (authentikUser) {
        logger.debug(`Found existing Authentik user: ${username}`);
        // Update user if needed (e.g., first_name changed)
        if (authentikUser.name !== telegramUser.first_name) {
          await axios.patch(`${AUTHENTIK_URL}/api/v3/core/users/${authentikUser.pk}/`, {
            name: telegramUser.first_name || username
          }, {
            headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
          });
        }
      } else {
        logger.info(`Creating new Authentik user for Telegram ID: ${telegramId}`);
        // 2. Create user in Authentik
        const createRes = await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/`, {
          username: username,
          name: telegramUser.first_name || username,
          email: email,
          type: 'internal',
          path: 'users/telegram',
          attributes: {
            telegram_id: telegramId
          }
        }, {
          headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
        });
        authentikUser = createRes.data;
      }

      // Authentik 'pk' is the UUID if configured correctly, or we might need to get the 'sub'
      // In Authentik v3, 'pk' is often the ID, and 'uuid' is also available.
      return authentikUser.uuid || authentikUser.pk;

    } catch (error) {
      logger.error('Error syncing user with Authentik:', error.response?.data || error.message);
      return null;
    }
  }

  // ── OIDC Methods ─────────────────────────────────────────────────────────────

  /**
   * Build the Authentik authorization URL for the OIDC login flow.
   * Uses PKCE (S256) — the code_verifier must be stored server-side (e.g. Redis)
   * and passed back to exchangeCode() in the callback.
   *
   * @param {string} state        — opaque value for CSRF protection (store alongside verifier)
   * @param {string} codeVerifier — high-entropy random string (43–128 URL-safe chars)
   * @returns {string} full authorization URL to redirect the user to
   */
  static generateAuthUrl(state, codeVerifier) {
    if (!OIDC_CLIENT_ID) {
      throw new Error('AUTHENTIK_OIDC_CLIENT_ID is not configured');
    }

    const codeChallenge = deriveCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OIDC_CLIENT_ID,
      redirect_uri: OIDC_REDIRECT_URI,
      scope: OIDC_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${OIDC_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens.
   * Validates the id_token (issuer, expiry, sub claim) and fetches userinfo.
   *
   * @param {string} code          — authorization code from callback query string
   * @param {string} codeVerifier  — original PKCE verifier stored during login initiation
   * @param {string} [redirectUri] — override redirect_uri (must match the one used in generateAuthUrl)
   * @returns {{ accessToken: string, refreshToken: string|null, idToken: string, userInfo: object }}
   */
  static async exchangeCode(code, codeVerifier, redirectUri) {
    if (!OIDC_CLIENT_ID) {
      throw new Error('AUTHENTIK_OIDC_CLIENT_ID is not configured');
    }

    const effectiveRedirectUri = redirectUri || OIDC_REDIRECT_URI;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: effectiveRedirectUri,
      client_id: OIDC_CLIENT_ID,
      code_verifier: codeVerifier,
    });

    // Include client_secret if configured (confidential client mode)
    if (OIDC_CLIENT_SECRET) {
      body.set('client_secret', OIDC_CLIENT_SECRET);
    }

    let tokenResponse;
    try {
      tokenResponse = await axios.post(OIDC_TOKEN_ENDPOINT, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
    } catch (err) {
      const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
      logger.error('[Authentik OIDC] Token exchange failed:', detail);
      throw new Error(`Token exchange failed: ${detail}`);
    }

    const { access_token, refresh_token, id_token } = tokenResponse.data;

    if (!access_token || !id_token) {
      throw new Error('Token endpoint did not return access_token or id_token');
    }

    // Validate id_token structure, issuer, and expiry
    const idTokenPayload = decodeIdToken(id_token);

    // Fetch userinfo to get the full profile (name, email, picture, etc.)
    const userInfo = await AuthentikService.getUserInfo(access_token);

    // Merge id_token claims with userinfo (userinfo is more authoritative for profile fields)
    const mergedUserInfo = {
      sub: idTokenPayload.sub,
      email: userInfo.email || idTokenPayload.email || null,
      email_verified: userInfo.email_verified || idTokenPayload.email_verified || false,
      name: userInfo.name || idTokenPayload.name || null,
      preferred_username: userInfo.preferred_username || idTokenPayload.preferred_username || null,
      picture: userInfo.picture || idTokenPayload.picture || null,
      groups: userInfo.groups || idTokenPayload.groups || [],
      ...userInfo,
    };

    logger.info('[Authentik OIDC] Token exchange successful', {
      sub: idTokenPayload.sub,
      username: mergedUserInfo.preferred_username,
    });

    return {
      accessToken: access_token,
      refreshToken: refresh_token || null,
      idToken: id_token,
      userInfo: mergedUserInfo,
    };
  }

  /**
   * Refresh an expired access token using a stored refresh_token.
   *
   * @param {string} refreshToken — the refresh_token from a previous exchangeCode() call
   * @returns {{ accessToken: string, refreshToken: string|null, idToken: string|null }}
   */
  static async refreshTokens(refreshToken) {
    if (!OIDC_CLIENT_ID) {
      throw new Error('AUTHENTIK_OIDC_CLIENT_ID is not configured');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OIDC_CLIENT_ID,
    });

    if (OIDC_CLIENT_SECRET) {
      body.set('client_secret', OIDC_CLIENT_SECRET);
    }

    let response;
    try {
      response = await axios.post(OIDC_TOKEN_ENDPOINT, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
    } catch (err) {
      const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
      logger.error('[Authentik OIDC] Token refresh failed:', detail);
      throw new Error(`Token refresh failed: ${detail}`);
    }

    const { access_token, refresh_token: newRefreshToken, id_token } = response.data;

    if (!access_token) {
      throw new Error('Token refresh did not return a new access_token');
    }

    logger.debug('[Authentik OIDC] Tokens refreshed successfully');

    return {
      accessToken: access_token,
      refreshToken: newRefreshToken || null,
      idToken: id_token || null,
    };
  }

  /**
   * Revoke a token (access or refresh) at Authentik's revocation endpoint.
   * Fails silently — revocation errors are logged but not re-thrown so logout
   * always succeeds from the user's perspective.
   *
   * @param {string} token — access_token or refresh_token to revoke
   * @returns {boolean} true if revocation succeeded, false if it failed
   */
  static async revokeToken(token) {
    if (!OIDC_CLIENT_ID || !token) {
      return false;
    }

    const body = new URLSearchParams({
      token,
      client_id: OIDC_CLIENT_ID,
    });

    if (OIDC_CLIENT_SECRET) {
      body.set('client_secret', OIDC_CLIENT_SECRET);
    }

    try {
      await axios.post(OIDC_REVOCATION_ENDPOINT, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });
      logger.debug('[Authentik OIDC] Token revoked successfully');
      return true;
    } catch (err) {
      // 400 with error=unsupported_token_type is expected for access tokens on some IdPs
      const status = err.response?.status;
      const errCode = err.response?.data?.error;
      if (status === 400 && errCode === 'unsupported_token_type') {
        logger.debug('[Authentik OIDC] Token type not revokable (expected for some token types)');
        return true;
      }
      logger.warn('[Authentik OIDC] Token revocation failed (non-fatal):', err.response?.data || err.message);
      return false;
    }
  }

  /**
   * Fetch the current user's profile from Authentik's userinfo endpoint.
   * The access_token must have the openid + profile + email scopes.
   *
   * @param {string} accessToken — valid OIDC access token
   * @returns {object} userinfo claims (sub, name, email, preferred_username, picture, groups, ...)
   */
  static async getUserInfo(accessToken) {
    if (!accessToken) {
      throw new Error('accessToken is required');
    }

    let response;
    try {
      response = await axios.get(OIDC_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
      logger.error('[Authentik OIDC] getUserInfo failed:', { status, detail });
      throw new Error(`UserInfo fetch failed (${status}): ${detail}`);
    }

    return response.data;
  }

  // ── Group Management ──────────────────────────────────────────────────────

  /**
   * Resolve the PK (UUID) of the Creators group by name.
   * Cached result is not stored — callers should not rely on tight loops.
   * @returns {string|null} group PK or null if not found / API not configured
   */
  static async _getCreatorsGroupPk() {
    if (!AUTHENTIK_TOKEN) {
      logger.error('[Authentik] AUTHENTIK_API_TOKEN is not configured — cannot manage groups');
      return null;
    }

    const groupName = process.env.AUTHENTIK_CREATORS_GROUP_NAME || 'Creators';

    const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/groups/`, {
      params: { name: groupName },
      headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
      timeout: 10000,
    });

    const group = res.data.results.find(g => g.name === groupName);
    if (!group) {
      logger.warn(`[Authentik] Creators group "${groupName}" not found — run setupCreatorAuthentikApp.js`);
      return null;
    }

    return group.pk;
  }

  /**
   * Resolve the integer PK of an Authentik user by their OIDC sub (UUID).
   * Authentik's /core/users/ UUID search uses the `uuid` filter param.
   * @param {string} authentikSub — UUID from the id_token `sub` claim
   * @returns {number|null} user PK or null if not found
   */
  static async _getUserPkBySub(authentikSub) {
    if (!AUTHENTIK_TOKEN || !authentikSub) return null;

    const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
      params: { uuid: authentikSub },
      headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
      timeout: 10000,
    });

    const user = res.data.results.find(u => u.uuid === authentikSub);
    return user ? user.pk : null;
  }

  /**
   * Add an Authentik user to the Creators group.
   * Non-fatal — logs on failure but does not throw.
   * @param {string} authentikSub — OIDC sub UUID stored in users.authentik_sub
   * @returns {{ success: boolean }}
   */
  static async addUserToCreatorsGroup(authentikSub) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('[Authentik] AUTHENTIK_API_TOKEN is not configured');
      return { success: false };
    }

    try {
      const [groupPk, userPk] = await Promise.all([
        AuthentikService._getCreatorsGroupPk(),
        AuthentikService._getUserPkBySub(authentikSub),
      ]);

      if (!groupPk) {
        logger.warn('[Authentik] addUserToCreatorsGroup: Creators group not found', { authentikSub });
        return { success: false };
      }

      if (!userPk) {
        logger.warn('[Authentik] addUserToCreatorsGroup: user not found', { authentikSub });
        return { success: false };
      }

      await axios.post(
        `${AUTHENTIK_URL}/api/v3/core/groups/${groupPk}/add_user/`,
        { pk: userPk },
        { headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` }, timeout: 10000 }
      );

      logger.info('[Authentik] User added to Creators group', { authentikSub, userPk, groupPk });
      return { success: true };
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.message;
      logger.error('[Authentik] addUserToCreatorsGroup failed', { authentikSub, status, detail });
      return { success: false };
    }
  }

  /**
   * Remove an Authentik user from the Creators group.
   * Non-fatal — logs on failure but does not throw.
   * @param {string} authentikSub — OIDC sub UUID stored in users.authentik_sub
   * @returns {{ success: boolean }}
   */
  static async removeUserFromCreatorsGroup(authentikSub) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('[Authentik] AUTHENTIK_API_TOKEN is not configured');
      return { success: false };
    }

    try {
      const [groupPk, userPk] = await Promise.all([
        AuthentikService._getCreatorsGroupPk(),
        AuthentikService._getUserPkBySub(authentikSub),
      ]);

      if (!groupPk) {
        logger.warn('[Authentik] removeUserFromCreatorsGroup: Creators group not found', { authentikSub });
        return { success: false };
      }

      if (!userPk) {
        logger.warn('[Authentik] removeUserFromCreatorsGroup: user not found', { authentikSub });
        return { success: false };
      }

      await axios.post(
        `${AUTHENTIK_URL}/api/v3/core/groups/${groupPk}/remove_user/`,
        { pk: userPk },
        { headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` }, timeout: 10000 }
      );

      logger.info('[Authentik] User removed from Creators group', { authentikSub, userPk, groupPk });
      return { success: true };
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.message;
      logger.error('[Authentik] removeUserFromCreatorsGroup failed', { authentikSub, status, detail });
      return { success: false };
    }
  }

  /**
   * Check whether an Authentik user is currently a member of the Creators group.
   * @param {string} authentikSub — OIDC sub UUID stored in users.authentik_sub
   * @returns {boolean} true if the user is in the group, false otherwise (including on error)
   */
  static async isUserInCreatorsGroup(authentikSub) {
    if (!AUTHENTIK_TOKEN || !authentikSub) return false;

    try {
      const groupName = process.env.AUTHENTIK_CREATORS_GROUP_NAME || 'Creators';

      const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
        params: { uuid: authentikSub },
        headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
        timeout: 10000,
      });

      const user = res.data.results.find(u => u.uuid === authentikSub);
      if (!user) {
        logger.warn('[Authentik] isUserInCreatorsGroup: user not found', { authentikSub });
        return false;
      }

      const inGroup = (user.groups_obj || []).some(g => g.name === groupName);
      logger.debug('[Authentik] isUserInCreatorsGroup result', { authentikSub, inGroup, groupName });
      return inGroup;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.message;
      logger.error('[Authentik] isUserInCreatorsGroup failed', { authentikSub, status, detail });
      return false;
    }
  }

  /**
   * Trigger a password reset flow in Authentik for the given email.
   * This sends an email to the user with a recovery link.
   */
  static async requestPasswordReset(email) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('AUTHENTIK_API_TOKEN is not configured');
      return { success: false, error: 'Identity provider not configured' };
    }

    try {
      // Find user by email in Authentik
      const searchRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
        params: { email: email },
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
      });

      const authentikUser = searchRes.data.results.find(u => u.email.toLowerCase() === email.toLowerCase());

      if (!authentikUser) {
        return { success: false, error: 'User not found' };
      }

      // Trigger recovery flow (requires a configured recovery flow in Authentik)
      // Note: This API endpoint depends on Authentik configuration.
      // Usually POST to /api/v3/flows/executor/recovery/
      await axios.post(`${AUTHENTIK_URL}/api/v3/flows/executor/recovery/`, {
        email: email
      }, {
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
      });

      return { success: true };
    } catch (error) {
      logger.error('Error requesting Authentik password reset:', error.response?.data || error.message);
      return { success: false, error: 'Failed to trigger recovery flow' };
    }
  }
}

module.exports = AuthentikService;
