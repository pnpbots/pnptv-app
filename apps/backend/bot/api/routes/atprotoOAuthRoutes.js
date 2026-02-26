'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../../../utils/logger');
const atproto = require('../../services/atprotoOAuthService');

const router = express.Router();

// ---------------------------------------------------------------------------
// Rate Limiters
// ---------------------------------------------------------------------------

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 OAuth attempts per 15 min
  message: { error: 'Too many OAuth requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const callbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // More generous since legit redirects are server-initiated
  message: { error: 'Too many callback attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Safe error codes from ATProto authorization servers — never reflect raw error_description
const SAFE_OAUTH_ERROR_CODES = new Set([
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'invalid_request',
  'unsupported_response_type',
  'invalid_scope',
  'unauthorized_client',
]);

// ---------------------------------------------------------------------------
// GET /oauth/client-metadata.json  — ATProto Client Identity Document (PUBLIC)
//
// The authorization server fetches this URL to learn about our app.
// The URL itself IS our client_id — it must be served at exactly the path
// that matches the client_id field inside the JSON.
// ---------------------------------------------------------------------------

router.get('/oauth/client-metadata.json', async (req, res) => {
  try {
    const client = await atproto.getClient();
    const metadata = client.clientMetadata;

    // Security: verify the request URL matches the client_id (hard error in production)
    if (process.env.NODE_ENV === 'production') {
      const servedAt = `https://${req.get('host')}${req.originalUrl.split('?')[0]}`;
      if (metadata.client_id !== servedAt) {
        logger.error('[ATProto] FATAL: client_id URL mismatch — OAuth will be broken', {
          expected: metadata.client_id,
          servedAt,
        });
        return res.status(500).json({
          error: 'OAuth client misconfiguration: client_id does not match serving URL.',
        });
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache
    res.setHeader('Access-Control-Allow-Origin', '*'); // Must be publicly accessible
    res.json(metadata);
  } catch (err) {
    logger.error('[ATProto] Error serving client metadata:', err);
    res.status(500).json({ error: 'Failed to generate client metadata' });
  }
});

// ---------------------------------------------------------------------------
// GET /oauth/jwks.json  — Public Keys for confidential client auth (PUBLIC)
// ---------------------------------------------------------------------------

router.get('/oauth/jwks.json', async (req, res) => {
  try {
    const client = await atproto.getClient();

    if (!client.jwks) {
      // Public client — no JWKS
      return res.status(404).json({ error: 'JWKS not available (public client mode)' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(client.jwks);
  } catch (err) {
    logger.error('[ATProto] Error serving JWKS:', err);
    res.status(500).json({ error: 'Failed to serve JWKS' });
  }
});

// ---------------------------------------------------------------------------
// GET /.well-known/oauth-protected-resource  — Resource Discovery (PUBLIC)
//
// ATProto spec requires this for resource servers. Since PNPtv acts as both
// a client and hosts user content, we serve a minimal resource descriptor.
// ---------------------------------------------------------------------------

router.get('/.well-known/oauth-protected-resource', (req, res) => {
  const publicUrl = atproto.PUBLIC_URL;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    resource: publicUrl,
    authorization_servers: [publicUrl],
    scopes_supported: ['atproto', 'transition:generic'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://atproto.com',
  });
});

// ---------------------------------------------------------------------------
// GET /oauth/resolve  — Handle Resolution API
//
// Pre-flight check: resolves a Bluesky handle to a DID before initiating OAuth.
// Used by the frontend to validate the handle and show the user's profile pic.
// ---------------------------------------------------------------------------

router.get('/oauth/resolve', oauthLimiter, async (req, res) => {
  const { handle } = req.query;

  if (!handle || typeof handle !== 'string' || handle.length < 3) {
    return res.status(400).json({ error: 'Invalid handle' });
  }

  try {
    const resolved = await atproto.resolveHandle(handle);
    if (!resolved) {
      return res.status(404).json({ error: 'Handle could not be resolved to a DID' });
    }
    res.json(resolved);
  } catch (err) {
    logger.error('[ATProto] Handle resolution error:', err);
    res.status(500).json({ error: 'Handle resolution failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /oauth/login  — Initiate ATProto OAuth Flow
//
// Accepts ?handle=alice.bsky.social (or a DID).
// Generates PKCE + state, sends PAR, redirects to authorization server.
// ---------------------------------------------------------------------------

router.get('/oauth/login', oauthLimiter, async (req, res) => {
  const { handle } = req.query;

  if (!handle || typeof handle !== 'string' || handle.length < 3) {
    return res.status(400).json({
      error: 'Missing or invalid handle parameter',
      example: '/oauth/login?handle=alice.bsky.social',
    });
  }

  try {
    const client = await atproto.getClient();
    const state = crypto.randomBytes(16).toString('hex');

    const url = await client.authorize(handle.replace(/^@/, ''), {
      state,
      scope: 'atproto transition:generic',
    });

    logger.info('[ATProto] Redirecting to authorization server', {
      handle,
      state: state.slice(0, 8) + '...',
    });

    res.redirect(url.toString());
  } catch (err) {
    logger.error('[ATProto] OAuth login initiation failed:', err);

    if (err.message?.includes('resolve')) {
      return res.status(400).json({
        error: 'Could not resolve handle. Please check the handle and try again.',
      });
    }

    res.status(500).json({ error: 'OAuth login failed. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /oauth/callback  — OAuth 2.1 Callback (Authorization Code Exchange)
//
// The authorization server redirects here with ?code=...&state=...&iss=...
// We exchange the code for tokens (with DPoP + PKCE verification).
// ---------------------------------------------------------------------------

router.get('/oauth/callback', callbackLimiter, async (req, res) => {
  try {
    const client = await atproto.getClient();

    // Parse callback parameters
    const params = new URLSearchParams(req.url.split('?')[1] || '');

    // Validate required params
    const code = params.get('code');
    const state = params.get('state');
    const iss = params.get('iss');
    const error = params.get('error');

    // Security: never reflect error_description from auth server to browser.
    // Map to a safe whitelisted code.
    if (error) {
      logger.warn('[ATProto] OAuth callback error from authorization server', {
        error,
        errorDesc: params.get('error_description'), // logged internally only
      });
      const safeErrorCode = SAFE_OAUTH_ERROR_CODES.has(error) ? error : 'login_failed';
      return res.redirect(`/?atproto_error=${safeErrorCode}`);
    }

    // ATProto spec mandates code, state, and iss in the callback
    if (!code || !state || !iss) {
      return res.status(400).json({ error: 'Missing required callback parameters (code, state, iss)' });
    }

    // Exchange code for tokens (PKCE verification, DPoP proof, state validation)
    const { session: oauthSession, state: returnedState } = await client.callback(params);

    const did = oauthSession.did;
    logger.info('[ATProto] OAuth callback successful', { did, state: state.slice(0, 8) + '...' });

    // Resolve handle and PDS from the session
    const agent = new (require('@atproto/api').Agent)(oauthSession);
    let handle = did;
    let pdsUrl = '';

    try {
      const profile = await agent.getProfile({ actor: did });
      handle = profile.data.handle || did;
      pdsUrl = agent.pdsUrl?.toString() || '';
    } catch (profileErr) {
      logger.warn('[ATProto] Could not fetch profile after login:', profileErr.message);
    }

    // Link ATProto identity to PNPtv user (hybrid session merge)
    const userId = await atproto.linkAtprotoToUser(did, handle, pdsUrl, req.session);

    // Build hybrid session
    const hybridSession = await atproto.buildHybridSession(userId, did, handle);

    if (!hybridSession) {
      logger.error('[ATProto] Failed to build hybrid session for user:', userId);
      return res.redirect('/?atproto_error=session_failed');
    }

    // Store in express session (same session cookie as Telegram auth)
    req.session.user = hybridSession;

    // Force session save before redirect
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    logger.info('[ATProto] Hybrid session established', {
      userId,
      did,
      handle,
      authMethods: hybridSession.auth_methods,
    });

    // Redirect to the app
    res.redirect('https://app.pnptv.app');
  } catch (err) {
    logger.error('[ATProto] OAuth callback failed:', err);

    // Provide helpful error feedback
    let errorMsg = 'login_failed';
    if (err.message?.includes('state')) errorMsg = 'state_mismatch';
    if (err.message?.includes('token')) errorMsg = 'token_exchange_failed';

    res.redirect(`/?atproto_error=${errorMsg}`);
  }
});

// ---------------------------------------------------------------------------
// POST /oauth/logout  — Revoke ATProto session
// ---------------------------------------------------------------------------

router.post('/oauth/logout', async (req, res) => {
  const did = req.session?.user?.atproto_did;

  if (!did) {
    return res.status(400).json({ error: 'No ATProto session to revoke' });
  }

  try {
    const client = await atproto.getClient();
    // Attempt to revoke the session (calls the revocation endpoint)
    try {
      const session = await client.restore(did);
      if (session && typeof session.signOut === 'function') {
        await session.signOut();
      }
    } catch (revokeErr) {
      // Session may already be expired — that's fine
      logger.debug('[ATProto] Session revocation note:', revokeErr.message);
    }

    // Clear ATProto fields from the hybrid session
    if (req.session.user) {
      req.session.user.atproto_did = null;
      req.session.user.atproto_handle = null;
      req.session.user.atproto_pds_url = null;
      if (req.session.user.auth_methods) {
        req.session.user.auth_methods.atproto = false;
      }

      // If no Telegram session either, destroy entirely
      if (!req.session.user.auth_methods?.telegram) {
        req.session.destroy((err) => {
          if (err) logger.error('[ATProto] Session destroy error:', err);
        });
        res.clearCookie('__pnptv_sid');
        return res.json({ success: true, message: 'Fully logged out' });
      }
    }

    res.json({ success: true, message: 'ATProto session revoked, Telegram session retained' });
  } catch (err) {
    logger.error('[ATProto] Logout error:', err);
    res.status(500).json({ error: 'Failed to revoke ATProto session' });
  }
});

// ---------------------------------------------------------------------------
// GET /oauth/session  — Get current ATProto session status
// ---------------------------------------------------------------------------

router.get('/oauth/session', oauthLimiter, async (req, res) => {
  const user = req.session?.user;

  if (!user?.atproto_did) {
    return res.json({
      authenticated: false,
      atproto: null,
    });
  }

  res.json({
    authenticated: true,
    atproto: {
      did: user.atproto_did,
      handle: user.atproto_handle,
      pds_url: user.atproto_pds_url,
    },
    auth_methods: user.auth_methods || {},
  });
});

module.exports = router;
