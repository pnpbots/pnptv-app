const XOAuthService = require('../../services/xOAuthService');
const logger = require('../../utils/logger');
const axios = require('axios');
const crypto = require('crypto');
const { query } = require('../../config/postgres');
const { enforceDefaultFollows } = require('../../services/followService');
const { v4: uuidv4 } = require('uuid');

function encryptToken(plaintext) {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('ENCRYPTION_KEY misconfigured');
  const key = Buffer.from(raw, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  return JSON.stringify({ data: enc, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') });
}

const sanitizeBotUsername = (value) => String(value || '').replace(/^@/, '').trim();

const buildRedirectPage = (title, message, botLink) => `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 40px; }
    .card { max-width: 520px; margin: 0 auto; border-radius: 12px; padding: 24px; background: #f6f8ff; }
    h1 { color: #0f172a; }
    p { color: #334155; }
    .button { display: inline-block; margin-top: 16px; padding: 12px 18px; background: #1d4ed8; color: #fff; text-decoration: none; border-radius: 8px; }
    .muted { color: #64748b; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${botLink ? `<a class="button" href="${botLink}">Abrir bot</a><p class="muted">${botLink}</p>` : ''}
  </div>
  ${botLink ? `
  <script>
    (function() {
      try {
        var tg = '${botLink}'.replace('https://t.me/', 'tg://resolve?domain=');
        setTimeout(function() { window.location.href = tg; }, 400);
      } catch (e) {}
    })();
  </script>` : ''}
</body>
</html>
`;

const buildHashRecoveryPage = (title, message, botLink) => `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 40px; }
    .card { max-width: 520px; margin: 0 auto; border-radius: 12px; padding: 24px; background: #f6f8ff; }
    h1 { color: #0f172a; }
    p { color: #334155; }
    .button { display: inline-block; margin-top: 16px; padding: 12px 18px; background: #1d4ed8; color: #fff; text-decoration: none; border-radius: 8px; }
    .muted { color: #64748b; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${botLink ? `<a class="button" href="${botLink}">Abrir bot</a><p class="muted">${botLink}</p>` : ''}
  </div>
  <script>
    (function() {
      try {
        var hash = window.location.hash || '';
        if (hash.startsWith('#')) hash = hash.slice(1);
        var params = new URLSearchParams(hash);
        var code = params.get('code');
        var state = params.get('state');
        if (code && state) {
          var qs = new URLSearchParams({ code: code, state: state }).toString();
          var nextUrl = window.location.pathname + '?' + qs;
          window.location.replace(nextUrl);
        }
      } catch (e) {}
    })();
  </script>
</body>
</html>
`;

const startOAuth = async (req, res) => {
  try {
    const adminId = req.session?.user?.id ? Number(req.session.user.id) : null;
    const adminUsername = req.session?.user?.username || null;
    const url = await XOAuthService.createAuthUrl({ adminId, adminUsername });
    // If the request came from the creator route, set a return_to so the callback redirects to the webapp
    if (req.originalUrl.includes('/creator/')) {
      req.session.xOAuthReturnTo = '/creators/x-campaigns';
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    }
    res.json({ success: true, url });
  } catch (error) {
    logger.error('Error starting X OAuth via API:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const handleCallback = async (req, res) => {
  const botUsername = sanitizeBotUsername(process.env.BOT_USERNAME);
  const botLink = botUsername ? `https://t.me/${botUsername}` : null;

  // ── Webapp login flow ────────────────────────────────────────────────────────
  // Reached when xLoginStart (webAppController) stored xWebLogin=true in session
  // and the redirect_uri pointed to /api/auth/x/callback (TWITTER_REDIRECT_URI).
  if (req.session?.xWebLogin) {
    delete req.session.xWebLogin;
    const { state, code, error: xError } = req.query;
    const stored = req.session.xOAuth;
    delete req.session.xOAuth;

    const canonicalAppUrl = 'https://pnptv.app';
    const canonicalErrorUrl = (process.env.WEBAPP_ORIGIN || process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app').replace(/\/+$/, '') + '/?error=auth_failed';

    if (xError || !code || !state || !stored || stored.state !== state) {
      logger.warn('X webapp login failed: state mismatch or missing params', { xError, hasCode: !!code, hasStored: !!stored });
      return res.redirect(canonicalErrorUrl);
    }

    try {
      // Use credentials that match what xLoginStart stored — resolve from stored session or env
      const clientId = stored.clientId || process.env.WEBAPP_X_CLIENT_ID || process.env.TWITTER_CLIENT_ID;
      const redirectUri = stored.redirectUri || process.env.WEBAPP_X_REDIRECT_URI || process.env.TWITTER_REDIRECT_URI;
      const clientSecret = stored.clientMode === 'webapp'
        ? (process.env.WEBAPP_X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET)
        : (process.env.TWITTER_CLIENT_SECRET || process.env.WEBAPP_X_CLIENT_SECRET);

      // Token exchange with retry across endpoints and auth modes (matches webAppController)
      const toFormEncoded = (value) => encodeURIComponent(String(value));

      const buildTokenBody = (mode) => {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: stored.codeVerifier,
          client_id: clientId,
        });
        if (mode === 'client_secret_post') {
          body.set('client_secret', clientSecret);
        }
        return body;
      };

      const exchangeToken = async (mode, tokenEndpoint) => {
        const config = {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        };
        if (mode === 'basic') {
          config.auth = { username: clientId, password: clientSecret };
        }
        if (mode === 'basic_encoded') {
          const encodedId = toFormEncoded(clientId);
          const basicValue = Buffer.from(`${encodedId}:${String(clientSecret)}`).toString('base64');
          config.headers.Authorization = `Basic ${basicValue}`;
        }
        return axios.post(tokenEndpoint, buildTokenBody(mode).toString(), config);
      };

      const modes = clientSecret
        ? ['basic_encoded', 'client_secret_post', 'basic', 'public']
        : ['public'];
      const tokenEndpoints = [
        'https://api.twitter.com/2/oauth2/token',
        'https://api.x.com/2/oauth2/token',
      ];
      let tokenRes = null;
      let lastTokenError = null;

      for (const tokenEndpoint of tokenEndpoints) {
        for (const mode of modes) {
          try {
            tokenRes = await exchangeToken(mode, tokenEndpoint);
            break;
          } catch (tokenErr) {
            lastTokenError = tokenErr;
            const status = tokenErr.response?.status;
            logger.error('X webapp token exchange failed:', { mode, tokenEndpoint, status, redirectUri });
            if (![400, 401, 403].includes(status)) throw tokenErr;
          }
        }
        if (tokenRes) break;
      }
      if (!tokenRes) throw lastTokenError || new Error('X OAuth token exchange failed');

      const accessToken = tokenRes.data.access_token;

      // Fetch X profile — try v2 API, then v1.1 fallback
      let xData = null;
      try {
        const profileRes = await axios.get('https://api.twitter.com/2/users/me', {
          params: { 'user.fields': 'name,profile_image_url' },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        xData = profileRes.data?.data;
      } catch (err1) {
        try {
          const profileRes2 = await axios.get('https://api.x.com/2/users/me', {
            params: { 'user.fields': 'name,profile_image_url' },
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          xData = profileRes2.data?.data;
        } catch (err2) {
          logger.warn('X webapp v2 profile fetch failed, trying v1.1 fallback', {
            status1: err1.response?.status,
            status2: err2.response?.status,
          });
        }
      }

      // Fallback: v1.1 verify_credentials (works without project enrollment)
      if (!xData) {
        try {
          const v1Res = await axios.get('https://api.twitter.com/1.1/account/verify_credentials.json', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const v1Data = v1Res.data;
          xData = {
            id: String(v1Data.id_str || v1Data.id),
            username: v1Data.screen_name,
            name: v1Data.name,
          };
          logger.info('X webapp profile resolved via v1.1 verify_credentials', { username: xData.username });
        } catch (v1Err) {
          logger.error('X webapp v1.1 profile fallback also failed:', { status: v1Err.response?.status, data: v1Err.response?.data });
        }
      }

      const xHandle = xData?.username;
      const xId = xData?.id ? String(xData.id) : null;
      const xName = xData?.name || xHandle;
      if (!xHandle) return res.redirect(canonicalErrorUrl);

      const RETURN_COLS = `id, pnptv_id, first_name, last_name, username, email,
        subscription_status, tier, terms_accepted, photo_file_id, bio, language, telegram, twitter, x_id, role`;

      let user;

      // If already logged in, link X to existing user
      if (req.session?.user?.id) {
        const existingId = req.session.user.id;
        // Clear x_id/twitter from any other user that has this X identity
        if (xId) {
          await query(
            `UPDATE users SET x_id = NULL, twitter = CASE WHEN twitter = $1 THEN NULL ELSE twitter END, updated_at = NOW()
             WHERE x_id = $2 AND id != $3`,
            [xHandle, xId, existingId]
          );
        }
        if (xHandle) {
          await query(`UPDATE users SET twitter = NULL, updated_at = NOW() WHERE twitter = $1 AND id != $2`, [xHandle, existingId]);
        }
        await query(
          `UPDATE users SET twitter = $1, x_id = COALESCE(x_id, $2), updated_at = NOW() WHERE id = $3`,
          [xHandle, xId, existingId]
        );
        const { rows } = await query(`SELECT ${RETURN_COLS} FROM users WHERE id = $1`, [existingId]);
        user = rows[0];
        logger.info(`Linked X @${xHandle} to existing session user ${user.id}`);
      } else {
        // Lookup by x_id first, then twitter handle
        let result = await query(`SELECT ${RETURN_COLS} FROM users WHERE x_id = $1`, [xId]);
        if (result.rows.length === 0) {
          result = await query(`SELECT ${RETURN_COLS} FROM users WHERE twitter = $1`, [xHandle]);
        }

        if (result.rows.length > 0) {
          user = result.rows[0];
          // Update x_id if missing
          if (xId && !user.x_id) {
            await query(`UPDATE users SET x_id = $1, updated_at = NOW() WHERE id = $2`, [xId, user.id]);
          }
        } else {
          // Create new user with username
          const [firstName, ...rest] = (xName || xHandle).split(' ');
          const { rows } = await query(
            `INSERT INTO users (id, pnptv_id, first_name, last_name, username, twitter, x_id,
              subscription_status, tier, role, terms_accepted, is_active, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'free','free','user',false,true,NOW(),NOW())
             RETURNING ${RETURN_COLS}`,
            [uuidv4(), uuidv4(), firstName, rest.join(' ') || null, xHandle ? xHandle.toUpperCase() : xHandle, xHandle, xId]
          );
          user = rows[0];
          logger.info(`Created new user via X web login: ${user.id} (@${xHandle})`);
        }
      }

      enforceDefaultFollows(user.id).catch(() => {});

      // Save encrypted tokens + scopes so share-to-X works immediately
      try {
        const encAccess = encryptToken(accessToken);
        const rawRefresh = tokenRes.data.refresh_token || null;
        const encRefresh = rawRefresh ? encryptToken(rawRefresh) : null;
        const expiresIn = tokenRes.data.expires_in || 7200;
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        const scopes = tokenRes.data.scope || null;
        await query(
          `UPDATE users
           SET x_user_id                  = COALESCE(x_user_id, $1),
               x_username                 = $2,
               x_access_token_encrypted   = $3,
               x_refresh_token_encrypted  = COALESCE($4, x_refresh_token_encrypted),
               x_token_expires_at         = $5,
               x_oauth_scopes             = COALESCE($6, x_oauth_scopes),
               updated_at                 = NOW()
           WHERE id = $7`,
          [xId, xHandle, encAccess, encRefresh, expiresAt, scopes, user.id]
        );
        logger.info(`[X OAuth] Saved encrypted tokens for user ${user.id} (@${xHandle}), scopes: ${scopes}`);
      } catch (tokenSaveErr) {
        logger.error('[X OAuth] Failed to save X tokens (non-fatal for login):', tokenSaveErr.message);
      }

      // Build complete session matching webAppController.buildSession
      req.session.user = {
        id: user.id,
        pnptvId: user.pnptv_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        subscriptionStatus: user.subscription_status,
        tier: user.tier || 'free',
        acceptedTerms: user.terms_accepted,
        photoUrl: user.photo_file_id,
        bio: user.bio,
        language: user.language,
        role: user.role || 'user',
        xHandle,
        auth_methods: {
          telegram: !!(user.telegram),
          atproto: false,
          x: true,
        },
      };

      await new Promise((resolve, reject) =>
        req.session.save(err => (err ? reject(err) : resolve()))
      );

      logger.info(`Web app X login success: user ${user.id} via @${xHandle}`);
      return res.redirect(canonicalAppUrl);
    } catch (err) {
      logger.error(`X webapp login callback error: ${err.message}`);
      const canonicalErr = (process.env.WEBAPP_ORIGIN || process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app').replace(/\/+$/, '') + '/?error=auth_failed';
      return res.redirect(canonicalErr);
    }
  }
  // ── End webapp login flow ────────────────────────────────────────────────────

  try {
    const { state, code, error, error_description: errorDescription } = req.query;

    logger.info('X OAuth callback received', {
      hasCode: !!code,
      hasState: !!state,
      hasError: !!error,
      error: error || null,
      errorDescription: errorDescription || null,
      originalUrl: req.originalUrl,
      queryKeys: Object.keys(req.query || {}),
    });

    if (error) {
      logger.error('X OAuth authorization denied by user or Twitter', {
        error,
        errorDescription,
      });
      return res.status(400).send(buildRedirectPage('Conexion rechazada', errorDescription || error, botLink));
    }

    if (!code && !state) {
      logger.warn('X OAuth callback missing code/state – trying hash recovery', {
        originalUrl: req.originalUrl,
      });
      return res.status(200).send(buildHashRecoveryPage(
        'Procesando conexion',
        'Si la autorizacion fue correcta, esta pagina se actualizara sola en segundos. Si no, vuelve al bot y genera un nuevo enlace.',
        botLink
      ));
    }

    if (!code) {
      logger.warn('X OAuth callback has state but no code', { state });
      return res.status(400).send(buildRedirectPage(
        'Parametros incompletos',
        'No se recibio el codigo de autorizacion. Vuelve al bot y genera un nuevo enlace.',
        botLink
      ));
    }

    const account = await XOAuthService.handleOAuthCallback({ code, state });
    // Redirect to webapp if the OAuth was initiated from the creator panel
    const returnTo = req.session?.xOAuthReturnTo;
    if (returnTo) {
      delete req.session.xOAuthReturnTo;
      await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
      const appUrl = (process.env.WEBAPP_ORIGIN || 'https://app.pnptv.app').replace(/\/+$/, '');
      return res.redirect(appUrl + returnTo);
    }
    return res.send(buildRedirectPage(
      'Cuenta conectada',
      `La cuenta @${account.handle} fue conectada correctamente. Puedes regresar al bot.`,
      botLink
    ));
  } catch (error) {
    // If the state was already consumed (duplicate request), show a friendly page
    const isDuplicate = error.message?.includes('ya utilizado')
      || error.message?.includes('no valido')
      || (error.isAxiosError && error.response?.status === 400);

    if (isDuplicate) {
      logger.warn('X OAuth duplicate or expired callback', { message: error.message });
      return res.send(buildRedirectPage(
        'Conexion procesada',
        'Si ya autorizaste tu cuenta, la conexion fue exitosa. Puedes regresar al bot.',
        botLink
      ));
    }

    logger.error('Error handling X OAuth callback:', error);
    return res.status(400).send(buildRedirectPage(
      'Error al conectar',
      error.message || 'No se pudo conectar la cuenta de X.',
      botLink
    ));
  }
};

const startOAuth1 = async (req, res) => {
  try {
    const XOAuth1Service = require('../../services/xOAuth1Service');
    const appRef = (req.query.app || 'generic').toLowerCase();
    const refUpper = appRef.toUpperCase();

    // Use per-app consumer keys (SANTINO_, LEX_, GENERIC_) with fallback to TWITTER_
    const consumerKey = process.env[`${refUpper}_CONSUMER_KEY`] || process.env.TWITTER_CONSUMER_KEY;
    const consumerSecret = process.env[`${refUpper}_CONSUMER_SECRET`] || process.env.TWITTER_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      return res.status(400).json({ success: false, error: `Consumer key not configured for app "${appRef}"` });
    }

    const { oauth_token } = await XOAuth1Service.getRequestToken({ consumerKey, consumerSecret });

    // Store the app ref in Redis alongside the request token secret so the callback knows which app
    const { getRedis } = require('../../config/redis');
    const redis = getRedis();
    await redis.set(`oauth1:app_ref:${oauth_token}`, appRef, 'EX', 900);

    const authorizeUrl = `https://api.twitter.com/oauth/authorize?oauth_token=${oauth_token}`;
    return res.json({ success: true, url: authorizeUrl });
  } catch (err) {
    logger.error('OAuth 1.0a start failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const callbackOAuth1 = async (req, res) => {
  try {
    const XOAuth1Service = require('../../services/xOAuth1Service');
    const { oauth_token, oauth_verifier } = req.query;

    if (!oauth_token || !oauth_verifier) {
      return res.status(400).json({ success: false, error: 'Missing oauth_token or oauth_verifier' });
    }

    // Retrieve the app ref stored during startOAuth1
    const { getRedis } = require('../../config/redis');
    const redis = getRedis();
    const appRef = (await redis.get(`oauth1:app_ref:${oauth_token}`)) || 'generic';
    await redis.del(`oauth1:app_ref:${oauth_token}`);

    const refUpper = appRef.toUpperCase();
    const consumerKey = process.env[`${refUpper}_CONSUMER_KEY`] || process.env.TWITTER_CONSUMER_KEY;
    const consumerSecret = process.env[`${refUpper}_CONSUMER_SECRET`] || process.env.TWITTER_CONSUMER_SECRET;

    const result = await XOAuth1Service.getAccessToken(oauth_token, oauth_verifier, { consumerKey, consumerSecret });
    await XOAuth1Service.saveAccount({
      oauthToken: result.accessToken,
      oauthTokenSecret: result.accessTokenSecret,
      xUserId: result.xUserId,
      handle: result.handle,
      displayName: result.displayName,
      createdBy: req.session?.user?.id || null,
      consumerKeyRef: appRef,
    });

    const webBase = (process.env.WEB_APP_URL || 'https://pnptv.app').replace(/\/+$/, '');
    return res.redirect(`${webBase}/admin/x-campaigns?oauth1=success`);
  } catch (err) {
    logger.error('OAuth 1.0a callback failed:', err);
    const webBase = (process.env.WEB_APP_URL || 'https://pnptv.app').replace(/\/+$/, '');
    return res.redirect(`${webBase}/admin/x-campaigns?oauth1=error&msg=${encodeURIComponent(err.message)}`);
  }
};

module.exports = {
  startOAuth,
  handleCallback,
  startOAuth1,
  callbackOAuth1,
};
