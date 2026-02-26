const validator = require('validator');
const logger = require('./logger');

/**
 * Input sanitization utilities
 * Prevents XSS, injection attacks, and malformed data
 */
const sanitize = {
  /**
   * Sanitize general text input
   * - Trims whitespace
   * - Escapes HTML entities to prevent XSS
   * - Removes null bytes
   * @param {string} input - Raw text input
   * @param {{maxLength?: number, allowNewlines?: boolean, escapeHtml?: boolean}} [options={}] - Sanitization options
   * @returns {string} Sanitized text
   */
  text: (input, options = {}) => {
    if (!input) return '';

    const {
      maxLength = 1000,
      allowNewlines = true,
      escapeHtml = true,
    } = options;

    let sanitized = String(input);

    // Remove null bytes (can cause issues with databases)
    sanitized = sanitized.replace(/\0/g, '');

    // Trim whitespace
    sanitized = sanitized.trim();

    // Remove or replace newlines if not allowed
    if (!allowNewlines) {
      sanitized = sanitized.replace(/[\r\n]+/g, ' ');
    }

    // Escape HTML entities to prevent XSS
    if (escapeHtml) {
      sanitized = validator.escape(sanitized);
    }

    // Enforce max length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
      logger.warn('Input truncated to max length', { maxLength, originalLength: input.length });
    }

    return sanitized;
  },

  /**
   * Sanitize username
   * - Only allows alphanumeric and underscores
   * - Converts to lowercase
   * - Removes leading/trailing underscores
   * @param {string} input - Raw username
   * @returns {string} Sanitized username
   */
  username: (input) => {
    if (!input) return '';

    let sanitized = String(input);

    // Only keep alphanumeric and underscores
    sanitized = sanitized.replace(/[^a-zA-Z0-9_]/g, '');

    // Convert to lowercase for consistency
    sanitized = sanitized.toLowerCase();

    // Remove leading/trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, '');

    // Limit length (Telegram max is 32)
    if (sanitized.length > 32) {
      sanitized = sanitized.substring(0, 32);
    }

    return sanitized;
  },

  /**
   * Sanitize email address
   * @param {string} input - Raw email
   * @returns {string} Sanitized email or empty string if invalid
   */
  email: (input) => {
    if (!input) return '';

    const sanitized = validator.normalizeEmail(String(input).trim(), {
      gmail_remove_dots: false, // Keep dots in Gmail addresses
      gmail_remove_subaddress: false, // Keep + addresses
    });

    // Validate after normalization
    if (!sanitized || !validator.isEmail(sanitized)) {
      logger.warn('Invalid email provided', { input });
      return '';
    }

    return sanitized;
  },

  /**
   * Sanitize phone number
   * - Removes all non-digit characters except leading +
   * @param {string} input - Raw phone number
   * @returns {string} Sanitized phone number
   */
  phone: (input) => {
    if (!input) return '';

    let sanitized = String(input).trim();

    // Keep leading + if present
    const hasPlus = sanitized.startsWith('+');

    // Remove all non-digits
    sanitized = sanitized.replace(/\D/g, '');

    // Re-add + if it was there
    if (hasPlus && sanitized) {
      sanitized = `+${sanitized}`;
    }

    return sanitized;
  },

  /**
   * Sanitize number input
   * @param {*} input - Raw number input
   * @param {{min?: number, max?: number, defaultValue?: number, allowFloat?: boolean}} [options={}] - Sanitization options
   * @returns {number} Sanitized number or default value
   */
  number: (input, options = {}) => {
    const {
      min = Number.MIN_SAFE_INTEGER,
      max = Number.MAX_SAFE_INTEGER,
      defaultValue = 0,
      allowFloat = true,
    } = options;

    if (input === null || input === undefined || input === '') {
      return defaultValue;
    }

    let num = allowFloat ? parseFloat(input) : parseInt(input, 10);

    if (Number.isNaN(num)) {
      logger.warn('Invalid number input', { input });
      return defaultValue;
    }

    // Enforce min/max bounds
    num = Math.max(min, Math.min(max, num));

    return num;
  },

  /**
   * Sanitize URL
   * @param {string} input - Raw URL
   * @param {{allowedProtocols?: string[], requireTld?: boolean}} [options={}] - Sanitization options
   * @returns {string} Sanitized URL or empty string if invalid
   */
  url: (input, options = {}) => {
    if (!input) return '';

    const {
      allowedProtocols = ['http', 'https'],
      requireTld = true,
    } = options;

    const sanitized = String(input).trim();

    // Validate URL
    if (!validator.isURL(sanitized, {
      protocols: allowedProtocols,
      require_protocol: true,
      require_valid_protocol: true,
      require_tld: requireTld,
    })) {
      logger.warn('Invalid URL provided', { input });
      return '';
    }

    return sanitized;
  },

  /**
   * Sanitize boolean input
   * @param {*} input - Raw boolean input
   * @param {boolean} [defaultValue=false] - Default value if invalid
   * @returns {boolean} Sanitized boolean
   */
  boolean: (input, defaultValue = false) => {
    if (input === null || input === undefined) {
      return defaultValue;
    }

    // Handle string representations
    if (typeof input === 'string') {
      const lower = input.toLowerCase().trim();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no') return false;
      return defaultValue;
    }

    return Boolean(input);
  },

  /**
   * Sanitize JSON input
   * @param {string} input - Raw JSON string
   * @param {*} [defaultValue=null] - Default value if invalid
   * @returns {*} Parsed JSON or default value
   */
  json: (input, defaultValue = null) => {
    if (!input) return defaultValue;

    try {
      return JSON.parse(String(input));
    } catch (err) {
      logger.warn('Invalid JSON input', { input, error: err.message });
      return defaultValue;
    }
  },

  /**
   * Sanitize file path
   * - Prevents path traversal attacks
   * - Removes dangerous characters
   * @param {string} input - Raw file path
   * @returns {string} Sanitized file path
   */
  filePath: (input) => {
    if (!input) return '';

    let sanitized = String(input);

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Prevent path traversal
    sanitized = sanitized.replace(/\.\./g, '');
    sanitized = sanitized.replace(/^\/+/, ''); // Remove leading slashes

    // Remove dangerous characters
    sanitized = sanitized.replace(/[<>:"|?*]/g, '');

    return sanitized;
  },

  /**
   * Sanitize command input
   * - Prevents command injection
   * - Only allows alphanumeric, underscores, hyphens
   * @param {string} input - Raw command
   * @returns {string} Sanitized command
   */
  command: (input) => {
    if (!input) return '';

    let sanitized = String(input);

    // Remove leading slash if present
    sanitized = sanitized.replace(/^\/+/, '');

    // Only keep safe characters
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');

    return sanitized;
  },

  /**
   * Escape special Markdown characters for Telegram
   * @param {string} input - Raw text that may contain Markdown special characters
   * @returns {string} Escaped text safe for Telegram Markdown
   */
  telegramMarkdown: (input) => {
    if (!input) return '';

    // Escape Telegram Markdown special characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return String(input).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  },

  /**
   * Sanitize object by applying sanitizers to each field
   * @param {Object.<string, *>} data - Raw object data
   * @param {Object.<string, string|{type: string, [key: string]: *}>} schema - Schema defining sanitizer for each field
   * @returns {Object.<string, *>} Sanitized object
   * @example
   * const sanitized = sanitize.object(rawData, {
   *   username: 'username',
   *   email: 'email',
   *   age: { type: 'number', min: 0, max: 120 }
   * });
   */
  object: (data, schema) => {
    if (!data || typeof data !== 'object') return {};

    const sanitized = {};

    Object.entries(schema).forEach(([field, config]) => {
      const value = data[field];

      // Skip undefined values
      if (value === undefined) return;

      // Handle simple string config (e.g., 'username' -> sanitize.username)
      if (typeof config === 'string') {
        if (sanitize[config]) {
          sanitized[field] = sanitize[config](value);
        } else {
          sanitized[field] = value;
        }
        return;
      }

      // Handle object config with options
      if (typeof config === 'object' && config.type) {
        const { type, ...options } = config;
        if (sanitize[type]) {
          sanitized[field] = sanitize[type](value, options);
        } else {
          sanitized[field] = value;
        }
        return;
      }

      // Fallback: keep original value
      sanitized[field] = value;
    });

    return sanitized;
  },
};

module.exports = sanitize;
