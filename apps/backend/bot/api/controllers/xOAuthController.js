const XOAuthService = require('../../services/xOAuthService');
const logger = require('../../../utils/logger');
const axios = require('axios');
const { query } = require('../../../config/postgres');

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
    const adminId = req.query.admin_id ? Number(req.query.admin_id) : null;
    const adminUsername = req.query.admin_username || null;
    const url = await XOAuthService.createAuthUrl({ adminId, adminUsername });
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
  if (req.session?.xWebLogin) {
    delete req.session.xWebLogin;
    const { state, code, error: xError } = req.query;
    const stored = req.session.xOAuth;
    delete req.session.xOAuth;

    if (xError || !code || !state || !stored || stored.state !== state) {
      logger.warn('X webapp login failed: state mismatch or missing params', { xError, hasCode: !!code, hasStored: !!stored });
      return res.redirect('/?error=auth_failed');
    }

    try {
      const clientId = process.env.TWITTER_CLIENT_ID;
      const clientSecret = process.env.TWITTER_CLIENT_SECRET;
      const redirectUri = process.env.TWITTER_REDIRECT_URI;

      const tokenRes = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: stored.codeVerifier,
        }).toString(),
        {
          auth: { username: clientId, password: clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const accessToken = tokenRes.data.access_token;
      const profileRes = await axios.get('https://api.twitter.com/2/users/me', {
        params: { 'user.fields': 'name,profile_image_url' },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const xData = profileRes.data?.data;
      const xHandle = xData?.username;
      if (!xHandle) return res.redirect('/?error=auth_failed');

      // Find or create user
      let result = await query(
        `SELECT id, pnptv_id, telegram, username, first_name, last_name, subscription_status, tier,
                terms_accepted, photo_file_id, bio, language
         FROM users WHERE twitter = $1`,
        [xHandle]
      );

      let user;
      if (result.rows.length === 0) {
        if (req.session?.user?.id) {
          await query('UPDATE users SET twitter = $1 WHERE id = $2', [xHandle, req.session.user.id]);
          result = await query(
            `SELECT id, pnptv_id, telegram, username, first_name, last_name, subscription_status, tier,
                    terms_accepted, photo_file_id, bio, language FROM users WHERE id = $1`,
            [req.session.user.id]
          );
          user = result.rows[0];
        } else {
          const { v4: uuidv4 } = require('uuid');
          const [firstName, ...rest] = ((xData?.name || xHandle)).split(' ');
          const { rows } = await query(
            `INSERT INTO users (id, pnptv_id, first_name, last_name, twitter,
              subscription_status, tier, role, terms_accepted, is_active, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,'free','free','user',false,true,NOW(),NOW())
             RETURNING id, pnptv_id, first_name, last_name, username, subscription_status, terms_accepted, photo_file_id, bio, language, twitter`,
            [uuidv4(), uuidv4(), firstName, rest.join(' ') || null, xHandle]
          );
          user = rows[0];
          logger.info(`Created new user via X web login: ${user.id} (@${xHandle})`);
        }
      } else {
        user = result.rows[0];
      }

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
        xHandle,
      };

      await new Promise((resolve, reject) =>
        req.session.save(err => (err ? reject(err) : resolve()))
      );

      logger.info(`Web app X login success: user ${user.id} via @${xHandle}`);
      return res.redirect('/app');
    } catch (err) {
      logger.error('X webapp login callback error:', err.message);
      return res.redirect('/?error=auth_failed');
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

module.exports = {
  startOAuth,
  handleCallback,
};
