const Sentry = require('@sentry/node');
const logger = require('../../../utils/logger');
const { isOperationalError } = require('../../../utils/errors');

/**
 * Centralized Error Handler Middleware for Express
 * Handles all errors thrown in routes and controllers
 */
function errorHandler(err, req, res, _next) {
  // Log the error
  logger.error('Express error handler:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query,
    ip: req.ip,
  });

  // Send to Sentry if configured
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, {
      extra: {
        url: req.url,
        method: req.method,
        body: req.body,
        params: req.params,
        query: req.query,
      },
    });
  }

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Determine if we should expose the error message
  const isOperational = isOperationalError(err);
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
    message: `Route not found: ${req.method} ${req.url}`,
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
