const axios = require('axios');
const crypto = require('crypto');
const db = require('../../utils/db');
const logger = require('../../utils/logger');
const PaymentSecurityService = require('./paymentSecurityService');

const X_OAUTH_BASE = 'https://twitter.com/i/oauth2';
const X_API_BASE = 'https://api.twitter.com/2';
const STATE_TTL_MINUTES = 15;

const base64UrlEncode = (buffer) => buffer
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

class XOAuthService {
  static getOAuthConfig() {
    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    const redirectUri = process.env.TWITTER_REDIRECT_URI;
    const scopes = process.env.TWITTER_OAUTH_SCOPES
      || 'tweet.read tweet.write users.read offline.access media.write';

    if (!clientId || !redirectUri) {
      throw new Error('Faltan variables TWITTER_CLIENT_ID o TWITTER_REDIRECT_URI');
    }

    return {
      clientId,
      clientSecret,
      redirectUri,
      scopes,
    };
  }

  static async createAuthUrl({ adminId = null, adminUsername = null } = {}) {
    const { clientId, redirectUri, scopes } = this.getOAuthConfig();

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
    const codeChallenge = base64UrlEncode(sha256(codeVerifier));
    const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000);

    const insertQuery = `
      INSERT INTO x_oauth_states (state, code_verifier, admin_id, admin_username, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `;

    await db.query(insertQuery, [state, codeVerifier, adminId, adminUsername, expiresAt]);

    const params = new URLSearchParams({
      response_type: 'code',
      response_mode: 'query',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${X_OAUTH_BASE}/authorize?${params.toString()}`;

    logger.info('Generated X OAuth URL', {
      clientId: clientId.substring(0, 10) + '...',
      redirectUri,
      scopes,
      state: state.substring(0, 8) + '...',
    });

    return authUrl;
  }

  static async handleOAuthCallback({ code, state }) {
    if (!code || !state) {
      throw new Error('Parametros OAuth incompletos');
    }

    // Atomic DELETE ... RETURNING prevents race conditions on duplicate callbacks
    const stateResult = await db.query(
      `DELETE FROM x_oauth_states
       WHERE state = $1 AND expires_at > NOW()
       RETURNING state, code_verifier, admin_id, admin_username`,
      [state]
    );
    const storedState = stateResult.rows[0];

    if (!storedState) {
      // State was already consumed by a prior request or expired
      throw new Error('Estado OAuth ya utilizado o expirado');
    }

    const tokens = await this.exchangeCodeForTokens({ code, codeVerifier: storedState.code_verifier });
    const profile = await this.fetchXProfile(tokens.access_token);

    const account = await this.upsertAccount({
      adminId: storedState.admin_id,
      adminUsername: storedState.admin_username,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      tokenScope: tokens.scope,
      tokenType: tokens.token_type,
      profile,
    });

    return account;
  }

  static async exchangeCodeForTokens({ code, codeVerifier }) {
    const { clientId, clientSecret, redirectUri } = this.getOAuthConfig();

    const payload = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (clientSecret) {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    }

    const response = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      payload.toString(),
      { headers, timeout: 15000 }
    );

    return response.data;
  }

  static async refreshTokens({ refreshToken }) {
    const { clientId, clientSecret } = this.getOAuthConfig();
    if (!refreshToken) {
      throw new Error('Refresh token no disponible');
    }

    const payload = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (clientSecret) {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    }

    const response = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      payload.toString(),
      { headers, timeout: 15000 }
    );

    return response.data;
  }

  static async fetchXProfile(accessToken) {
    const response = await axios.get(
      `${X_API_BASE}/users/me?user.fields=profile_image_url,description,public_metrics`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 15000,
      }
    );

    return response.data?.data || null;
  }

  static async upsertAccount({
    adminId,
    adminUsername,
    accessToken,
    refreshToken,
    expiresIn,
    tokenScope,
    tokenType,
    profile,
  }) {
    if (!profile || !profile.username) {
      throw new Error('Perfil de X no disponible');
    }

    const handle = String(profile.username).replace(/^@/, '').trim();
    if (!handle) {
      throw new Error('Handle de X invalido');
    }

    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    const encryptedAccess = PaymentSecurityService.encryptSensitiveData({
      accessToken,
      tokenType,
      scope: tokenScope,
      expiresAt: tokenExpiresAt?.toISOString() || null,
    });
    if (!encryptedAccess) {
      throw new Error('No se pudo cifrar el access token de X');
    }
    const encryptedRefresh = refreshToken
      ? PaymentSecurityService.encryptSensitiveData({ refreshToken })
      : null;
    if (refreshToken && !encryptedRefresh) {
      throw new Error('No se pudo cifrar el refresh token de X');
    }

    const updateByUserId = await db.query(
      `
        UPDATE x_accounts
        SET handle = $1,
            display_name = $2,
            encrypted_access_token = $3,
            encrypted_refresh_token = $4,
            token_expires_at = $5,
            is_active = TRUE,
            updated_at = CURRENT_TIMESTAMP,
            created_by = COALESCE($6, created_by)
        WHERE x_user_id = $7
        RETURNING account_id
      `,
      [
        handle,
        profile.name || null,
        encryptedAccess,
        encryptedRefresh,
        tokenExpiresAt,
        adminId,
        profile.id,
      ]
    );

    if (updateByUserId.rows.length) {
      return { accountId: updateByUserId.rows[0].account_id, handle };
    }

    const upsert = await db.query(
      `
        INSERT INTO x_accounts (
          handle, display_name, encrypted_access_token, encrypted_refresh_token,
          token_expires_at, created_by, x_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (handle)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          created_by = COALESCE(EXCLUDED.created_by, x_accounts.created_by),
          is_active = TRUE,
          updated_at = CURRENT_TIMESTAMP,
          x_user_id = EXCLUDED.x_user_id
        RETURNING account_id
      `,
      [
        handle,
        profile.name || null,
        encryptedAccess,
        encryptedRefresh,
        tokenExpiresAt,
        adminId,
        profile.id,
      ]
    );

    logger.info('X account connected', {
      accountId: upsert.rows[0].account_id,
      handle,
      adminId,
      adminUsername,
    });

    return { accountId: upsert.rows[0].account_id, handle };
  }

  static async refreshAccountTokens(account) {
    let refreshData;
    try {
      refreshData = PaymentSecurityService.decryptSensitiveData(account.encrypted_refresh_token);
    } catch (error) {
      logger.warn('Failed to decrypt X refresh token', {
        accountId: account.account_id,
        error: error.message,
      });
    }

    const refreshToken = refreshData?.refreshToken || account.encrypted_refresh_token;
    if (!refreshToken) {
      throw new Error('Refresh token no disponible para X');
    }

    const tokens = await this.refreshTokens({ refreshToken });
    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    const encryptedAccess = PaymentSecurityService.encryptSensitiveData({
      accessToken: tokens.access_token,
      tokenType: tokens.token_type,
      scope: tokens.scope,
      expiresAt: tokenExpiresAt?.toISOString() || null,
    });
    if (!encryptedAccess) {
      throw new Error('No se pudo cifrar el access token actualizado de X');
    }
    const encryptedRefresh = tokens.refresh_token
      ? PaymentSecurityService.encryptSensitiveData({ refreshToken: tokens.refresh_token })
      : account.encrypted_refresh_token;
    if (tokens.refresh_token && !encryptedRefresh) {
      throw new Error('No se pudo cifrar el refresh token actualizado de X');
    }

    await db.query(
      `
        UPDATE x_accounts
        SET encrypted_access_token = $1,
            encrypted_refresh_token = $2,
            token_expires_at = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE account_id = $4
      `,
      [encryptedAccess, encryptedRefresh, tokenExpiresAt, account.account_id]
    );

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt,
    };
  }
}

module.exports = XOAuthService;
