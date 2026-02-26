/**
 * Custom Error Classes for Better Error Handling
 */

/* eslint-disable max-classes-per-file */

/**
 * Base Application Error
 */
class ApplicationError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} [statusCode=500] - HTTP status code
   * @param {string} [code='INTERNAL_ERROR'] - Error code
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON representation
   * @returns {{error: string, message: string, code: string, statusCode: number}}
   */
  toJSON() {
    return {
      error: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
    };
  }
}

/**
 * Payment-specific errors
 */
class PaymentError extends ApplicationError {
  /**
   * @param {string} message - Error message
   * @param {string} [code='PAYMENT_ERROR'] - Error code
   */
  constructor(message, code = 'PAYMENT_ERROR') {
    super(message, 400, code);
  }
}

class PaymentProviderError extends PaymentError {
  /**
   * @param {string} provider - Payment provider name
   * @param {string} message - Error message
   */
  constructor(provider, message) {
    super(`Payment provider error (${provider}): ${message}`, 'PROVIDER_ERROR');
    this.provider = provider;
  }
}

class PaymentNotFoundError extends PaymentError {
  /**
   * @param {string|number} paymentId - Payment ID
   */
  constructor(paymentId) {
    super(`Payment not found: ${paymentId}`, 'PAYMENT_NOT_FOUND');
    this.paymentId = paymentId;
  }
}

class DuplicatePaymentError extends PaymentError {
  /**
   * @param {string|number} paymentId - Payment ID
   */
  constructor(paymentId) {
    super(`Payment already processed: ${paymentId}`, 'DUPLICATE_PAYMENT');
    this.paymentId = paymentId;
    this.statusCode = 409;
  }
}

class InvalidSignatureError extends PaymentError {
  /**
   * @param {string} provider - Payment provider name
   */
  constructor(provider) {
    super(`Invalid webhook signature from ${provider}`, 'INVALID_SIGNATURE');
    this.provider = provider;
    this.statusCode = 401;
  }
}

/**
 * Validation errors
 */
class ValidationError extends ApplicationError {
  /**
   * @param {string} message - Error message
   * @param {string|null} [field=null] - Field that failed validation
   */
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

/**
 * Database errors
 */
class DatabaseError extends ApplicationError {
  /**
   * @param {string} message - Error message
   * @param {string|null} [operation=null] - Database operation that failed
   */
  constructor(message, operation = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.operation = operation;
  }
}

/**
 * Resource not found
 */
class NotFoundError extends ApplicationError {
  /**
   * @param {string} resource - Resource type
   * @param {string|number|null} [identifier=null] - Resource identifier
   */
  constructor(resource, identifier = null) {
    super(`${resource} not found${identifier ? `: ${identifier}` : ''}`, 404, 'NOT_FOUND');
    this.resource = resource;
    this.identifier = identifier;
  }
}

/**
 * Authorization errors
 */
class UnauthorizedError extends ApplicationError {
  /**
   * @param {string} [message='Unauthorized access'] - Error message
   */
  constructor(message = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends ApplicationError {
  /**
   * @param {string} [message='Access forbidden'] - Error message
   */
  constructor(message = 'Access forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Rate limiting errors
 */
class RateLimitError extends ApplicationError {
  /**
   * @param {number|null} [retryAfter=null] - Retry after seconds
   */
  constructor(retryAfter = null) {
    super('Too many requests. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

/**
 * Configuration errors
 */
class ConfigurationError extends ApplicationError {
  /**
   * @param {string} configKey - Configuration key that is missing or invalid
   */
  constructor(configKey) {
    super(`Missing or invalid configuration: ${configKey}`, 500, 'CONFIGURATION_ERROR');
    this.configKey = configKey;
  }
}

/**
 * External service errors
 */
class ExternalServiceError extends ApplicationError {
  /**
   * @param {string} service - External service name
   * @param {string} message - Error message
   */
  constructor(service, message) {
    super(`External service error (${service}): ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

/**
 * Check if error is operational (safe to expose to user)
 * @param {Error} error - Error object to check
 * @returns {boolean} True if error is operational
 */
function isOperationalError(error) {
  if (error instanceof ApplicationError) {
    return error.isOperational;
  }
  return false;
}

module.exports = {
  ApplicationError,
  PaymentError,
  PaymentProviderError,
  PaymentNotFoundError,
  DuplicatePaymentError,
  InvalidSignatureError,
  ValidationError,
  DatabaseError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ConfigurationError,
  ExternalServiceError,
  isOperationalError,
};
