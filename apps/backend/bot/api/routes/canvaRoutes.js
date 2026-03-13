'use strict';

/**
 * Canva Connect API Routes
 *
 * Mounts under /api/canva (registered in routes.js).
 *
 * GET  /auth/login     — Initiate OAuth → redirect to Canva
 * GET  /auth/callback  — OAuth callback → exchange code, store tokens, redirect to app
 * POST /auth/unlink    — Disconnect Canva account
 * GET  /designs        — List user's Canva designs
 * POST /export         — Start an export job
 * GET  /exports        — List user's export jobs
 * GET  /exports/:id    — Get single export job status
 * GET  /status         — Check if Canva is connected + display name
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const authGuard = require('../middleware/authGuard');
const CanvaService = require('../../services/canvaService');
const logger = require('../../../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Rate Limiters
// ---------------------------------------------------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Canva login attempts. Please try again later.' },
});

const callbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Canva callback requests. Please try again later.' },
});

const designsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many design list requests. Please slow down.' },
});

const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many export requests. Please slow down.' },
});

const exportsListLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many export list requests. Please slow down.' },
});

// ---------------------------------------------------------------------------
// Middleware: require Canva linked
// ---------------------------------------------------------------------------

const requireCanvaLinked = async (req, res, next) => {
  try {
    const status = await CanvaService.getStatus(req.user.id);
    if (!status.connected) {
      return res.status(403).json({
        success: false,
        error: 'Canva account not connected. Please connect Canva first.',
      });
    }
    next();
  } catch (err) {
    logger.error('Error checking Canva status', { error: err.message });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
};

// ---------------------------------------------------------------------------
// OAuth Routes
// ---------------------------------------------------------------------------

/**
 * GET /auth/login — Initiate Canva OAuth
 */
router.get('/auth/login', loginLimiter, authGuard, async (req, res) => {
  try {
    const authUrl = await CanvaService.getAuthUrl(req.user.id);
    // If redirect=true query param, redirect directly; else return URL
    if (req.query.redirect === 'true') {
      return res.redirect(authUrl);
    }
    return res.json({ success: true, url: authUrl });
  } catch (err) {
    logger.error('Canva auth URL generation failed', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ success: false, error: 'Failed to initiate Canva login' });
  }
});

/**
 * GET /auth/callback — Canva OAuth callback
 * No session required (state param validates the request)
 */
router.get('/auth/callback', callbackLimiter, async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      const desc = req.query.error_description || oauthError;
      logger.warn('Canva OAuth denied', { error: oauthError, description: desc });
      return res.redirect(`/admin/canva?canva_error=${encodeURIComponent(desc)}`);
    }

    if (!code || !state) {
      return res.redirect('/admin/canva?canva_error=invalid_request');
    }

    const result = await CanvaService.handleCallback(code, state);

    // Update session if the user who initiated OAuth is the current session user
    if (req.session?.user?.id === result.userId) {
      req.session.user.canva_connected = true;
      req.session.user.canva_display_name = result.displayName;
    }

    logger.info('Canva OAuth completed (audit)', {
      userId: result.userId,
      canvaUserId: result.canvaUserId,
      action: 'canva_connect',
    });

    return res.redirect('/admin/canva?canva_connected=true');
  } catch (err) {
    logger.error('Canva OAuth callback failed', { error: err.message });
    return res.redirect('/admin/canva?canva_error=callback_failed');
  }
});

/**
 * POST /auth/unlink — Disconnect Canva account
 */
router.post('/auth/unlink', authGuard, async (req, res) => {
  try {
    await CanvaService.unlinkAccount(req.user.id);

    // Update session
    if (req.session?.user) {
      req.session.user.canva_connected = false;
      req.session.user.canva_display_name = null;
    }

    logger.info('Canva account disconnected (audit)', {
      userId: req.user.id,
      action: 'canva_disconnect',
    });

    return res.json({ success: true, message: 'Canva account disconnected' });
  } catch (err) {
    logger.error('Canva unlink failed', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ success: false, error: 'Failed to disconnect Canva' });
  }
});

// ---------------------------------------------------------------------------
// Design Routes
// ---------------------------------------------------------------------------

/**
 * GET /designs — List user's Canva designs
 */
router.get('/designs', designsLimiter, authGuard, requireCanvaLinked, async (req, res) => {
  try {
    const designs = await CanvaService.listDesigns(req.user.id);
    return res.json({ success: true, designs });
  } catch (err) {
    logger.error('Failed to list Canva designs', { error: err.message, userId: req.user?.id });

    if (err.response?.status === 401) {
      return res.status(401).json({ success: false, error: 'Canva session expired. Please reconnect.' });
    }

    return res.status(500).json({ success: false, error: 'Failed to fetch designs' });
  }
});

// ---------------------------------------------------------------------------
// Export Routes
// ---------------------------------------------------------------------------

/**
 * POST /export — Start a new export job
 */
router.post('/export', exportLimiter, authGuard, requireCanvaLinked, async (req, res) => {
  try {
    const { designId, title, quality } = req.body;

    if (!designId) {
      return res.status(400).json({ success: false, error: 'designId is required' });
    }

    const job = await CanvaService.createExportJob({
      userId: req.user.id,
      designId,
      designTitle: title || 'Untitled',
      quality: quality || '1080p',
    });

    logger.info('Canva export job created', { jobId: job.id, userId: req.user.id, designId });

    return res.json({ success: true, jobId: job.id, status: job.status });
  } catch (err) {
    logger.error('Failed to create Canva export job', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ success: false, error: 'Failed to start export' });
  }
});

/**
 * GET /exports — List user's export jobs
 */
router.get('/exports', exportsListLimiter, authGuard, async (req, res) => {
  try {
    const jobs = await CanvaService.getUserExportJobs(req.user.id);
    // Sanitize error_message to avoid leaking internal details
    const sanitized = jobs.map(j => ({
      ...j,
      error_message: j.status === 'failed' && j.error_message
        ? j.error_message.substring(0, 200)
        : null,
    }));
    return res.json({ success: true, jobs: sanitized });
  } catch (err) {
    logger.error('Failed to list Canva exports', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ success: false, error: 'Failed to list exports' });
  }
});

/**
 * GET /exports/:id — Get single export job status
 */
router.get('/exports/:id', exportsListLimiter, authGuard, async (req, res) => {
  try {
    const job = await CanvaService.getExportJob(req.params.id);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Export job not found' });
    }

    // Only allow owner to view their own jobs
    if (job.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    return res.json({ success: true, job });
  } catch (err) {
    logger.error('Failed to get Canva export status', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ success: false, error: 'Failed to get export status' });
  }
});

// ---------------------------------------------------------------------------
// Status Route
// ---------------------------------------------------------------------------

/**
 * GET /status — Check Canva connection status
 */
router.get('/status', authGuard, async (req, res) => {
  try {
    const status = await CanvaService.getStatus(req.user.id);
    return res.json({ success: true, ...status });
  } catch (err) {
    logger.error('Failed to get Canva status', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ success: false, error: 'Failed to check status' });
  }
});

module.exports = router;
