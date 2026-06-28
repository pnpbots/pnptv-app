const Sentry = require('@sentry/node');
const multer = require('multer');
const logger = require('../../../utils/logger');
const { isOperationalError } = require('../../../utils/errors');

const REDACTED_FIELDS = ['password', 'cardToken', 'token', 'secret', 'authorization', 'code', 'otp', 'cardNumber', 'cvc', 'cvv'];
const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  return Object.fromEntries(
    Object.entries(body).map(([k, v]) => [
      k,
      REDACTED_FIELDS.some(f => k.toLowerCase().includes(f.toLowerCase())) ? '[REDACTED]' : v,
    ])
  );
};

/**
 * Centralized Error Handler Middleware for Express
 * Handles all errors thrown in routes and controllers
 */
function errorHandler(err, req, res, _next) {
  // Handle multer errors (file upload validation) as 400s
  if (err instanceof multer.MulterError || err.message?.includes('files are allowed')) {
    logger.warn('Upload validation error:', { error: err.message, url: req.url, ip: req.ip });
    return res.status(400).json({ error: err.message });
  }

  // Client disconnected mid-upload — not an application error, no Sentry noise
  if (err.message === 'Request aborted') {
    logger.warn('Upload aborted by client:', { url: req.url, ip: req.ip });
    return res.headersSent ? undefined : res.status(499).end();
  }

  // Determine status code (also accept legacy `err.status` from older throw sites)
  const statusCode = err.statusCode || err.status || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  // Log at the appropriate level: 4xx are user-input/validation, not exceptions
  if (isClientError) {
    logger.warn('Client error:', {
      status: statusCode,
      error: err.message,
      url: req.url,
      method: req.method,
      ip: req.ip,
    });
  } else {
    logger.error('Express error handler:', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      body: sanitizeBody(req.body),
      params: req.params,
      query: req.query,
      ip: req.ip,
    });
  }

  // Only send 5xx errors to Sentry — 4xx are expected user-input failures
  if (process.env.SENTRY_DSN && !isClientError) {
    Sentry.captureException(err, {
      extra: {
        url: req.url,
        method: req.method,
        body: sanitizeBody(req.body),
        params: req.params,
        query: req.query,
      },
    });
  }

  // Determine if we should expose the error message — 4xx errors carry
  // user-facing validation messages, so expose them too.
  const isOperational = isOperationalError(err) || isClientError;
  const message = isOperational ? err.message : 'Internal server error';

  // Build error response
  const errorResponse = {
    error: err.code || 'INTERNAL_ERROR',
    message,
  };

  // Add additional fields for operational errors
  if (isOperational && err.toJSON) {
    Object.assign(errorResponse, err.toJSON());
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  // Send response
  res.status(statusCode).json(errorResponse);
}

/**
 * 404 Not Found Handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route not found: ${req.method} ${req.path}`,
  });
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
};
