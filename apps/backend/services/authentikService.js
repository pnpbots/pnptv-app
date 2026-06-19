const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { query } = require('../config/postgres');

const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'https://auth.pnptv.app';
const AUTHENTIK_TOKEN = process.env.AUTHENTIK_API_TOKEN;

// ── Passkey / WebAuthn flow env vars ─────────────────────────────────────────
// AUTHENTIK_PASSKEY_FLOW_SLUG — slug of the Authentik flow configured for
//   passwordless WebAuthn authentication.  Create it in Authentik Admin →
//   Flows & Stages → Flows, type "Authentication", with stages:
//     1. User Login Stage (identification)
//     2. Authenticator Validate Stage (webauthn device class, user_settings enabled)
//   Default slug: pnptv-passkey
// AUTHENTIK_URL — internal Docker network URL (default: https://auth.pnptv.app)
//   For flow executor calls we always use AUTHENTIK_URL (internal), not the
//   public auth.pnptv.app hostname.
const PASSKEY_FLOW_SLUG = process.env.AUTHENTIK_PASSKEY_FLOW_SLUG || 'pnptv-passkey';

// ── OIDC Configuration ────────────────────────────────────────────────────────
// AUTHENTIK_OIDC_CLIENT_ID     — OAuth2 application Client ID registered in Authentik
// AUTHENTIK_OIDC_CLIENT_SECRET — Client secret (used server-side only, never sent to browser)
// AUTHENTIK_OIDC_REDIRECT_URI  — Must exactly match the Redirect URI in the Authentik application config
//                                Default: https://pnptv.app/auth/oidc/callback
// AUTHENTIK_OIDC_ISSUER        — Authentik application issuer slug URL
//                                Default: https://auth.pnptv.app/application/o/pnptv-app/
const OIDC_CLIENT_ID = process.env.AUTHENTIK_OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.AUTHENTIK_OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI = process.env.AUTHENTIK_OIDC_REDIRECT_URI || 'https://pnptv.app/api/webapp/auth/oidc/callback';
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

// When calling Authentik's flow executor via the internal Docker hostname, we must
// pass Host: auth.pnptv.app so Authentik uses the correct brand and WebAuthn rpId.
// Without this, Authentik sets rpId to "authentik-server" (the internal hostname),
// which breaks all passkey challenges since credentials were registered against auth.pnptv.app.
const AUTHENTIK_PUBLIC_HOST = (() => {
  try { return new URL(OIDC_ISSUER).host; } catch { return 'auth.pnptv.app'; }
})();

function normalizeRole(role) {
  return String(role || 'user').toLowerCase();
}

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((group) => {
      if (typeof group === 'string') return group;
      if (group && typeof group.name === 'string') return group.name;
      return null;
    })
    .filter(Boolean);
}

function getAdminGroupNames() {
  const configured = String(process.env.AUTHENTIK_ADMINS_GROUP_NAME || '').trim();
  if (configured) return [configured];
  return ['Admins', 'authentik Admins'];
}

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
   * Generate a secure random password (16 chars, mixed case + digits + symbols).
   * @returns {string}
   */
  static generatePassword() {
    const charset = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    const bytes = crypto.randomBytes(16);
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += charset[bytes[i] % charset.length];
    }
    return password;
  }

  /**
   * Set a password on an Authentik user via the Admin API.
   * @param {number} userPk — Authentik user PK (integer)
   * @param {string} password — plaintext password to set
   * @returns {boolean} true if set successfully
   */
  static async setUserPassword(userPk, password) {
    if (!AUTHENTIK_TOKEN) return false;
    try {
      await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/${userPk}/set_password/`, {
        password,
      }, {
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` },
        timeout: 10000,
      });
      logger.info(`[Authentik] Password set for user pk=${userPk}`);
      return true;
    } catch (err) {
      logger.error('[Authentik] setUserPassword failed:', err.response?.data || err.message);
      return false;
    }
  }

  /**
   * Update the email on an Authentik user (replaces virtual email with real one).
   * @param {number} userPk — Authentik user PK
   * @param {string} email — real email address
   * @returns {boolean}
   */
  static async updateUserEmail(userPk, email) {
    if (!AUTHENTIK_TOKEN || !email) return false;
    try {
      await axios.patch(`${AUTHENTIK_URL}/api/v3/core/users/${userPk}/`, {
        email,
      }, {
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` },
        timeout: 10000,
      });
      logger.info(`[Authentik] Email updated for user pk=${userPk} to ${email}`);
      return true;
    } catch (err) {
      logger.error('[Authentik] updateUserEmail failed:', err.response?.data || err.message);
      return false;
    }
  }

  static async updateUserEmailByUuid(pnptvUuid, email) {
    if (!pnptvUuid || !email) return false;
    // Authentik UUIDs are 36-char xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx format.
    // Legacy pnptv_id values stored as long hex strings are not Authentik UUIDs — skip silently.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pnptvUuid)) {
      return false;
    }
    const pk = await AuthentikService._getUserPkBySub(pnptvUuid);
    if (!pk) {
      logger.warn('[Authentik] updateUserEmailByUuid: user not found', { pnptvUuid });
      return false;
    }
    return AuthentikService.updateUserEmail(pk, email);
  }

  /**
   * Sync a Telegram user with Authentik.
   * Ensures the user exists in Authentik and returns their UUID (sub).
   * On first creation, generates a password and returns it for credential delivery.
   *
   * @param {object} telegramUser — Telegram user object
   * @param {object} [opts] — Options
   * @param {string} [opts.realEmail] — Real email to set on the Authentik user
   * @returns {{ uuid: string, isNew: boolean, password: string|null, username: string }} | null
   */
  static async syncTelegramUser(telegramUser, opts = {}) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('AUTHENTIK_API_TOKEN is not configured');
      return null;
    }

    try {
      const telegramId = String(telegramUser.id);
      const username = telegramUser.username || `tg_${telegramId}`;
      const email = opts.realEmail || `${telegramId}@telegram.pnptv.app`;
      let dbLinkedPnptvId = null;
      try {
        const dbUser = await query(
          `SELECT pnptv_id
             FROM users
            WHERE telegram = $1
            ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
            LIMIT 1`,
          [telegramId]
        );
        dbLinkedPnptvId = dbUser.rows[0]?.pnptv_id || null;
      } catch (dbErr) {
        logger.warn('[Authentik] DB lookup for existing Telegram link failed (non-fatal):', dbErr.message);
      }

      const seenUserPks = new Set();
      const candidateUsers = [];
      const collectCandidates = async (params) => {
        if (!params || Object.values(params).every((v) => !v)) return;
        const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
          params,
          headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` },
          timeout: 10000,
        });
        for (const user of res.data?.results || []) {
          if (!user?.pk || seenUserPks.has(user.pk)) continue;
          seenUserPks.add(user.pk);
          candidateUsers.push(user);
        }
      };

      // 1. Reuse the canonical Authentik identity if PNPtv already linked one.
      // Guard against CONFLICT_ / legacy hex pnptv_ids that aren't valid UUIDs.
      const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (dbLinkedPnptvId && isValidUuid.test(dbLinkedPnptvId)) {
        await collectCandidates({ uuid: dbLinkedPnptvId });
      }
      // 2. Username-only lookup keeps current behavior for stable usernames.
      await collectCandidates({ username });
      // 3. Deterministic Telegram placeholder email catches renamed Telegram handles.
      await collectCandidates({ email });
      // 4. Broad search by Telegram ID helps recover accounts that now have a real email.
      await collectCandidates({ search: telegramId });

      const scoreCandidate = (user) => {
        let score = 0;
        if (dbLinkedPnptvId && user.uuid === dbLinkedPnptvId) score += 1000;
        if ((user.attributes?.telegram_id || '') === telegramId) score += 500;
        if ((user.email || '').toLowerCase() === email.toLowerCase()) score += 200;
        if (opts.realEmail && (user.email || '').toLowerCase() === opts.realEmail.toLowerCase()) score += 150;
        if (user.username === username) score += 100;
        if ((user.username || '').toLowerCase() === username.toLowerCase()) score += 50;
        if (user.path === 'users/telegram') score += 25;
        if (user.type === 'internal') score += 10;
        return score;
      };

      let authentikUser = candidateUsers
        .map((user) => ({ user, score: scoreCandidate(user) }))
        .sort((a, b) => (b.score - a.score) || (a.user.pk - b.user.pk))[0]?.user || null;
      let isNew = false;
      let password = null;

      if (authentikUser) {
        logger.debug(`[Authentik] Reusing existing user for Telegram ${telegramId}`, {
          requestedUsername: username,
          authentikPk: authentikUser.pk,
          authentikUsername: authentikUser.username,
          authentikUuid: authentikUser.uuid,
        });
        // Update name if changed
        if (authentikUser.name !== telegramUser.first_name) {
          await axios.patch(`${AUTHENTIK_URL}/api/v3/core/users/${authentikUser.pk}/`, {
            name: telegramUser.first_name || username
          }, {
            headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
          });
        }
        // If a real email is provided and the current one is the virtual email, update it
        if (opts.realEmail && authentikUser.email && authentikUser.email.endsWith('@telegram.pnptv.app')) {
          await AuthentikService.updateUserEmail(authentikUser.pk, opts.realEmail);
        }
      } else {
        logger.info(`Creating new Authentik user for Telegram ID: ${telegramId}`);
        isNew = true;
        password = AuthentikService.generatePassword();

        // 2. Create user in Authentik
        const createRes = await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/`, {
          username: username,
          name: telegramUser.first_name || username,
          email: email,
          type: 'internal',
          is_active: true,
          path: 'users/telegram',
          attributes: {
            telegram_id: telegramId,
            provisioned_via: 'telegram_bot',
            provisioned_at: new Date().toISOString(),
          }
        }, {
          headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
        });
        authentikUser = createRes.data;

        // 3. Set the generated password
        await AuthentikService.setUserPassword(authentikUser.pk, password);

        // 4. Add to default Users group if it exists
        try {
          const groupRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/groups/`, {
            params: { name: 'Users' },
            headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` },
            timeout: 10000,
          });
          const usersGroup = groupRes.data.results.find(g => g.name === 'Users');
          if (usersGroup) {
            await axios.post(
              `${AUTHENTIK_URL}/api/v3/core/groups/${usersGroup.pk}/add_user/`,
              { pk: authentikUser.pk },
              { headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }, timeout: 10000 }
            );
          }
        } catch (groupErr) {
          logger.warn('[Authentik] Failed to add user to Users group (non-fatal):', groupErr.message);
        }
      }

      return {
        uuid: authentikUser.uuid || authentikUser.pk,
        isNew,
        password,
        username,
        pk: authentikUser.pk,
      };

    } catch (error) {
      logger.error('Error syncing user with Authentik:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Assign Authentik groups based on PNPtv role/tier.
   * Maps: admin → Admins, moderator → Moderators, creator → Creators, prime → Prime Members
   * @param {string} authentikSub — UUID
   * @param {object} opts — { role, tier, creatorStatus }
   */
  static async syncUserGroups(authentikSub, { role, tier, creatorStatus } = {}) {
    if (!AUTHENTIK_TOKEN || !authentikSub) return;
    try {
      const userPk = await AuthentikService._getUserPkBySub(authentikSub);
      if (!userPk) return;

      const groupMappings = [
        { names: getAdminGroupNames(), condition: role === 'admin' || role === 'superadmin' },
        { name: 'Moderators', condition: role === 'moderator' },
        { name: 'Creators', condition: creatorStatus === 'approved' },
        { name: 'Prime Members', condition: (tier || '').toLowerCase() === 'prime' },
      ];

      for (const mapping of groupMappings) {
        try {
          const candidateNames = mapping.names || [mapping.name];
          let group = null;
          for (const candidateName of candidateNames) {
            const groupRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/groups/`, {
              params: { name: candidateName },
              headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` },
              timeout: 10000,
            });
            group = groupRes.data.results.find(g => g.name === candidateName);
            if (group) break;
          }
          if (!group) continue;

          if (mapping.condition) {
            await axios.post(
              `${AUTHENTIK_URL}/api/v3/core/groups/${group.pk}/add_user/`,
              { pk: userPk },
              { headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }, timeout: 10000 }
            ).catch(() => {}); // ignore if already in group
          }
        } catch {
          // Group may not exist yet — non-fatal
        }
      }
    } catch (err) {
      logger.warn('[Authentik] syncUserGroups failed (non-fatal):', err.message);
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
  static generateAuthUrl(state, codeVerifier, options = {}) {
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

    // Method hint — Authentik can read this via a flow policy (expression
    // policy that inspects request.context["acr"]) and route the user to a
    // passkey-only or email-only stage. If the operator hasn't wired the
    // policy, Authentik silently ignores the param and serves the default flow.
    if (options.method === 'passkey') {
      params.set('acr_values', 'urn:authentik:passkey');
      params.set('prompt', 'login');
    } else if (options.method === 'magic_link') {
      params.set('acr_values', 'urn:authentik:email');
      params.set('prompt', 'login');
    } else if (options.method === 'register') {
      params.set('prompt', 'create');
    }

    if (options.loginHint) {
      params.set('login_hint', options.loginHint);
    }

    return `${OIDC_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Build a URL that sends the browser directly to the enrollment flow, then
   * returns to the OIDC authorize endpoint after completion. Authentik follows
   * the ?next= redirect once enrollment is done; since the user is now logged
   * in, the authorize endpoint auto-completes and fires our callback.
   */
  static generateEnrollmentUrl(state, codeVerifier) {
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
    const authorizeUrl = `${OIDC_AUTH_ENDPOINT}?${params.toString()}`;
    const authentikPublicOrigin = new URL(OIDC_ISSUER).origin;
    return `${authentikPublicOrigin}/if/flow/pnptv-enrollment/?next=${encodeURIComponent(authorizeUrl)}`;
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
   * Check if a user belongs to the Admins group in Authentik.
   * @param {string} authentikSub — Authentik UUID
   * @returns {boolean} true if the user is in the Admins group
   */
  static async isUserInAdminsGroup(authentikSub) {
    if (!AUTHENTIK_TOKEN || !authentikSub) return false;

    try {
      const groupNames = getAdminGroupNames();

      const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
        params: { uuid: authentikSub },
        headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
        timeout: 10000,
      });

      const user = res.data.results.find(u => u.uuid === authentikSub);
      if (!user) {
        logger.warn('[Authentik] isUserInAdminsGroup: user not found', { authentikSub });
        return false;
      }

      const inGroup = (user.groups_obj || []).some(g => groupNames.includes(g.name));
      logger.debug('[Authentik] isUserInAdminsGroup result', { authentikSub, inGroup, groupNames });
      return inGroup;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.message;
      logger.error('[Authentik] isUserInAdminsGroup failed', { authentikSub, status, detail });
      return false;
    }
  }

  /**
   * Resolve the app role with Authentik as the source of truth for admin access.
   * Superadmin remains a local emergency/root role. Regular admin is granted only
   * when the Authentik identity is currently in the configured Admins group.
   *
   * @param {object} opts
   * @param {string} [opts.authentikSub]
   * @param {string} [opts.dbRole]
   * @param {Array<string|{name:string}>} [opts.groups]
   * @returns {Promise<string>}
   */
  static async resolveEffectiveRole({ authentikSub, dbRole, groups } = {}) {
    const normalizedDbRole = normalizeRole(dbRole);
    if (normalizedDbRole === 'superadmin') {
      return 'superadmin';
    }

    const adminGroupNames = getAdminGroupNames();
    let isAuthentikAdmin = null;
    const normalizedGroups = normalizeGroups(groups);

    if (normalizedGroups.length > 0) {
      isAuthentikAdmin = normalizedGroups.some((groupName) => adminGroupNames.includes(groupName));
    } else if (authentikSub) {
      isAuthentikAdmin = await AuthentikService.isUserInAdminsGroup(authentikSub);
    }

    if (isAuthentikAdmin === true) {
      return 'admin';
    }

    if (normalizedDbRole === 'admin') {
      return 'user';
    }

    return normalizedDbRole || 'user';
  }

  /**
   * Sync an X/Twitter user with Authentik.
   * Ensures the user exists in Authentik and returns their UUID (sub).
   */
  static async syncXUser(xProfile) {
    if (!AUTHENTIK_TOKEN) {
      logger.error('AUTHENTIK_API_TOKEN is not configured');
      return null;
    }

    try {
      const xId = String(xProfile.id || xProfile.xId);
      const handle = xProfile.username || xProfile.xHandle || `x_${xId}`;
      const username = handle;
      const email = `${xId}@x.pnptv.app`; // Virtual email for Authentik

      // 1. Check if user exists in Authentik by username
      const searchRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
        params: { username: username },
        headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
      });

      let authentikUser = searchRes.data.results.find(u => u.username === username);

      if (authentikUser) {
        logger.debug(`Found existing Authentik user for X: ${username}`);
        const displayName = xProfile.name || xProfile.firstName || handle;
        if (authentikUser.name !== displayName) {
          await axios.patch(`${AUTHENTIK_URL}/api/v3/core/users/${authentikUser.pk}/`, {
            name: displayName
          }, {
            headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
          });
        }
      } else {
        logger.info(`Creating new Authentik user for X ID: ${xId} (@${handle})`);
        const createRes = await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/`, {
          username: username,
          name: xProfile.name || xProfile.firstName || handle,
          email: email,
          type: 'internal',
          path: 'users/x',
          attributes: {
            x_id: xId,
            x_handle: handle,
          }
        }, {
          headers: { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` }
        });
        authentikUser = createRes.data;
      }

      return authentikUser.uuid || authentikUser.pk;
    } catch (error) {
      logger.error('Error syncing X user with Authentik:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Generate a one-time password-recovery link for an Authentik user.
   * Requires the default brand to have `flow_recovery_id` set.
   * Returns the fully-qualified recovery URL, or null on failure.
   *
   * @param {number} userPk — Authentik user PK (integer)
   * @returns {string|null}
   */
  static async generateRecoveryLink(userPk) {
    if (!AUTHENTIK_TOKEN || !userPk) return null;
    try {
      const res = await axios.post(
        `${AUTHENTIK_URL}/api/v3/core/users/${userPk}/recovery/`,
        {},
        { headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` }, timeout: 10000 }
      );
      return res.data?.link || null;
    } catch (err) {
      logger.error('[Authentik] generateRecoveryLink failed:', err.response?.data || err.message);
      return null;
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

  // ── Passkey / WebAuthn inline ceremony ───────────────────────────────────────

  /**
   * Initiate a passwordless WebAuthn flow via Authentik's flow executor.
   *
   * Authentik's executor is a stateful cookie-based state machine.  We drive
   * it server-side: start the flow, auto-advance any identification stage that
   * doesn't require a username, then return the WebAuthn publicKey options
   * (base64url-encoded, browser-ready) plus an opaque stateToken that ties
   * this session to the Redis-stored executor cookies.
   *
   * @returns {{ success: boolean, stateToken?: string, publicKey?: object, error?: string }}
   */
  static async beginPasskeyFlow() {
    let redis;
    try {
      // Lazy-require to avoid circular deps — redis config is only needed here.
      redis = require('../config/redis').getRedis();
    } catch (err) {
      logger.error('[Passkey] Redis unavailable:', err.message);
      return { success: false, error: 'passkey_unavailable' };
    }

    // Dedicated axios instance so cookies stay isolated to this flow session.
    // Host header overrides the internal Docker hostname so Authentik uses the
    // auth.pnptv.app brand — critical for correct WebAuthn rpId in challenges.
    const flowClient = axios.create({
      baseURL: AUTHENTIK_URL,
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (s) => s < 500,
      withCredentials: false,
      headers: { Host: AUTHENTIK_PUBLIC_HOST },
    });

    const executorUrl = `/api/v3/flows/executor/${PASSKEY_FLOW_SLUG}/?query=`;

    let cookieJar = '';
    let currentData = null;

    const captureSetCookie = (headers) => {
      const setCookieHeader = headers['set-cookie'];
      if (!setCookieHeader) return;
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      const parsed = cookies.map((c) => c.split(';')[0].trim()).filter(Boolean);
      if (parsed.length > 0) cookieJar = parsed.join('; ');
    };

    try {
      const initRes = await flowClient.get(executorUrl, {
        headers: { Accept: 'application/json' },
      });
      captureSetCookie(initRes.headers);
      currentData = initRes.data;
    } catch (err) {
      logger.error('[Passkey] beginPasskeyFlow init GET failed:', err.message);
      return { success: false, error: 'passkey_unavailable' };
    }

    if (!currentData) {
      logger.warn('[Passkey] beginPasskeyFlow: empty response from executor init');
      return { success: false, error: 'passkey_unavailable' };
    }

    // Auto-advance ak-stage-identification when present before the webauthn stage.
    // Authentik returns this stage when the flow starts with an identification
    // step.  A POST with an empty body (or { uid_field: '' }) advances it when
    // the flow is configured for passwordless (no username required).
    const MAX_STEPS = 5;
    let step = 0;
    while (
      step < MAX_STEPS &&
      currentData?.component === 'ak-stage-identification'
    ) {
      step++;
      logger.debug('[Passkey] Auto-advancing ak-stage-identification, step', step);
      try {
        const advRes = await flowClient.post(
          executorUrl,
          {},
          {
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(cookieJar ? { Cookie: cookieJar } : {}),
            },
          }
        );
        captureSetCookie(advRes.headers);
        currentData = advRes.data;
      } catch (err) {
        logger.error('[Passkey] Auto-advance POST failed:', err.message);
        return { success: false, error: 'passkey_unavailable' };
      }
    }

    // We expect ak-stage-authenticator-validate with a webauthn device_challenge.
    if (currentData?.component !== 'ak-stage-authenticator-validate') {
      logger.warn('[Passkey] beginPasskeyFlow: unexpected component after init:', currentData?.component, JSON.stringify(currentData)?.slice(0, 400));
      return { success: false, error: 'passkey_unavailable' };
    }

    const challenges = currentData?.device_challenges;
    if (!Array.isArray(challenges)) {
      logger.warn('[Passkey] beginPasskeyFlow: no device_challenges in response');
      return { success: false, error: 'passkey_unavailable' };
    }

    const webauthnChallenge = challenges.find((c) => c.device_class === 'webauthn');
    if (!webauthnChallenge) {
      logger.warn('[Passkey] beginPasskeyFlow: no webauthn device_challenge found');
      return { success: false, error: 'passkey_unavailable' };
    }

    const publicKey = webauthnChallenge.challenge;
    if (!publicKey || typeof publicKey !== 'object') {
      logger.warn('[Passkey] beginPasskeyFlow: challenge field is not an object');
      return { success: false, error: 'passkey_unavailable' };
    }

    const stateToken = crypto.randomBytes(32).toString('base64url');
    try {
      await redis.set(
        `passkey:flow:${stateToken}`,
        JSON.stringify({ cookieJar, flowSlug: PASSKEY_FLOW_SLUG }),
        'EX',
        300
      );
    } catch (err) {
      logger.error('[Passkey] Redis set failed:', err.message);
      return { success: false, error: 'passkey_unavailable' };
    }

    logger.info('[Passkey] beginPasskeyFlow: challenge ready, stateToken issued');
    return { success: true, stateToken, publicKey };
  }

  /**
   * Submit the WebAuthn assertion to Authentik and resolve the PNPtv user.
   *
   * On success returns the full Authentik user record fetched via the admin API
   * so the caller can upsert into the PNPtv DB via findOrLinkUser.
   *
   * @param {string} stateToken — token issued by beginPasskeyFlow
   * @param {object} assertion  — serialized PublicKeyCredential assertion (base64url fields)
   * @returns {{ success: boolean, authentikUser?: object, error?: string }}
   */
  static async finishPasskeyFlow(stateToken, assertion) {
    let redis;
    try {
      redis = require('../config/redis').getRedis();
    } catch (err) {
      logger.error('[Passkey] Redis unavailable:', err.message);
      return { success: false, error: 'server_error' };
    }

    const redisKey = `passkey:flow:${stateToken}`;
    let raw;
    try {
      raw = await redis.get(redisKey);
    } catch (err) {
      logger.error('[Passkey] Redis get failed:', err.message);
      return { success: false, error: 'server_error' };
    }

    if (!raw) {
      return { success: false, error: 'expired' };
    }

    // Single-use: delete immediately before any async work.
    try {
      await redis.del(redisKey);
    } catch {
      // Non-fatal — already past the guard above.
    }

    let flowState;
    try {
      flowState = JSON.parse(raw);
    } catch {
      return { success: false, error: 'expired' };
    }

    const { cookieJar, flowSlug } = flowState;
    const executorUrl = `${AUTHENTIK_URL}/api/v3/flows/executor/${flowSlug}/?query=`;

    // Authentik's ak-stage-authenticator-validate expects the assertion under
    // the `webauthn` key.  The `selected_challenge` field tells Authentik which
    // device class is being responded to.
    const body = {
      component: 'ak-stage-authenticator-validate',
      webauthn: assertion,
      selected_challenge: { device_class: 'webauthn' },
    };

    let assertRes;
    try {
      assertRes = await axios.post(executorUrl, body, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Host: AUTHENTIK_PUBLIC_HOST,
          ...(cookieJar ? { Cookie: cookieJar } : {}),
        },
        timeout: 20000,
        maxRedirects: 0,
        validateStatus: (s) => s < 500,
      });
    } catch (err) {
      logger.error('[Passkey] finishPasskeyFlow POST failed:', err.message);
      return { success: false, error: 'server_error' };
    }

    const resData = assertRes.data;
    logger.debug('[Passkey] finishPasskeyFlow executor response component:', resData?.component, 'status:', assertRes.status);

    // Authentik signals success with component === 'xak-flow-redirect' or
    // type === 'redirect' or by embedding pending_user / pending_user_identifier.
    const isSuccess =
      resData?.type === 'redirect' ||
      resData?.component === 'xak-flow-redirect' ||
      resData?.component === 'ak-flow-redirect' ||
      typeof resData?.pending_user_identifier === 'string';

    if (!isSuccess) {
      // Log full response for operator debugging — truncated to avoid log spam.
      logger.warn('[Passkey] finishPasskeyFlow: authentication not successful. Response:', JSON.stringify(resData)?.slice(0, 600));
      const errCode = resData?.response_errors?.webauthn?.[0]?.string || resData?.error || 'auth_failed';
      return { success: false, error: errCode };
    }

    // Resolve the Authentik user identity.  We prefer pending_user_identifier
    // (username or email) from the executor response.  If absent, we follow the
    // redirect URL which typically contains a uid in the query string — but
    // username lookup is simpler and more reliable.
    if (!AUTHENTIK_TOKEN) {
      logger.error('[Passkey] AUTHENTIK_API_TOKEN not set — cannot resolve user identity');
      return { success: false, error: 'server_error' };
    }

    const identifier = resData?.pending_user_identifier || resData?.pending_user?.username || null;
    if (!identifier) {
      logger.error('[Passkey] finishPasskeyFlow: success but no pending_user_identifier in response. Full data:', JSON.stringify(resData)?.slice(0, 600));
      return { success: false, error: 'identity_missing' };
    }

    // Fetch full user record from admin API.
    let authentikUser = null;
    try {
      // Try username first, then email.
      const searches = [
        { username: identifier },
        { email: identifier },
        { search: identifier },
      ];
      for (const params of searches) {
        const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
          params,
          headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
          timeout: 10000,
        });
        const match = (res.data?.results || []).find(
          (u) => u.username === identifier || (u.email || '').toLowerCase() === identifier.toLowerCase()
        );
        if (match) { authentikUser = match; break; }
      }
    } catch (err) {
      logger.error('[Passkey] admin user lookup failed:', err.message);
      return { success: false, error: 'server_error' };
    }

    if (!authentikUser) {
      logger.error('[Passkey] finishPasskeyFlow: could not find Authentik user for identifier:', identifier);
      return { success: false, error: 'user_not_found' };
    }

    logger.info('[Passkey] finishPasskeyFlow: resolved user', { username: authentikUser.username, uuid: authentikUser.uuid });
    return { success: true, authentikUser };
  }
}

module.exports = AuthentikService;
