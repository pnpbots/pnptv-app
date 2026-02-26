const Joi = require('joi');
const validator = require('validator');
const logger = require('./logger');

/**
 * Sanitize user input to prevent XSS and injection attacks
 * @param {string} input - User input
 * @returns {string|*} Sanitized input (returns original if not a string)
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;

  // Remove HTML tags and scripts
  let sanitized = input.replace(/<[^>]*>/g, '');

  // Escape special characters
  sanitized = validator.escape(sanitized);

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
};

/**
 * Validate email address
 * @param {string} email - Email address
 * @returns {boolean} Validation result
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return validator.isEmail(email);
};

/**
 * Validate age (18+)
 * @param {number} age - User age
 * @returns {boolean} Validation result
 */
const isValidAge = (age) => {
  const ageNum = parseInt(age, 10);
  return !Number.isNaN(ageNum) && ageNum >= 18 && ageNum <= 120;
};

/**
 * Validate username
 * @param {string} username - Username
 * @returns {boolean} Validation result
 */
const isValidUsername = (username) => {
  if (!username || typeof username !== 'string') return false;
  // Alphanumeric, underscores, hyphens, 3-30 characters
  return /^[a-zA-Z0-9_-]{3,30}$/.test(username);
};

/**
 * Validate URL
 * @param {string} url - URL
 * @returns {boolean} Validation result
 */
const isValidUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true,
  });
};

/**
 * Validate geolocation coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean} Validation result
 */
const isValidLocation = (lat, lng) => {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return false;

  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
};

/**
 * Validate payment amount
 * @param {number} amount - Payment amount
 * @returns {boolean} Validation result
 */
const isValidAmount = (amount) => {
  const amountNum = parseFloat(amount);
  return !Number.isNaN(amountNum) && amountNum > 0 && amountNum <= 1000000;
};

/**
 * Validate Telegram user ID
 * @param {number|string} userId - Telegram user ID
 * @returns {boolean} Validation result
 */
const isValidTelegramId = (userId) => {
  const idNum = parseInt(userId, 10);
  return !Number.isNaN(idNum) && idNum > 0;
};

/**
 * Joi schemas for complex validation
 */
const schemas = {
  // User profile schema
  userProfile: Joi.object({
    userId: Joi.number().integer().positive().required(),
    username: Joi.string().min(3).max(30).pattern(/^[a-zA-Z0-9_-]+$/)
      .optional(),
    firstName: Joi.string().min(1).max(50).required(),
    lastName: Joi.string().min(1).max(50).optional(),
    email: Joi.string().email().optional(),
    age: Joi.number().integer().min(18).max(120)
      .required(),
    bio: Joi.string().max(500).optional(),
    interests: Joi.array().items(Joi.string().max(50)).max(10).optional(),
    language: Joi.string().valid('en', 'es').default('en'),
  }),

  // User profile update schema (for partial updates)
  userProfileUpdate: Joi.object({
    userId: Joi.number().integer().positive().optional(),
    username: Joi.string().min(3).max(30).pattern(/^[a-zA-Z0-9_-]+$/)
      .optional().allow(null),
    firstName: Joi.string().min(1).max(50).optional().allow(null),
    lastName: Joi.string().min(1).max(50).optional().allow(null),
    email: Joi.string().email().optional().allow(null, ''),
    age: Joi.number().integer().min(18).max(120).optional().allow(null),
    bio: Joi.string().max(500).optional().allow('', null),
    interests: Joi.array().items(Joi.string().max(50)).max(10).optional(),
    photoFileId: Joi.string().optional().allow(null),
    language: Joi.string().valid('en', 'es').optional(),
    locationSharingEnabled: Joi.boolean().optional(),
    // Profile info fields
    looking_for: Joi.string().max(200).optional().allow('', null),
    tribe: Joi.string().max(100).optional().allow('', null),
    city: Joi.string().max(100).optional().allow('', null),
    country: Joi.string().max(100).optional().allow('', null),
    // Social media fields
    instagram: Joi.string().max(100).optional().allow('', null),
    twitter: Joi.string().max(100).optional().allow('', null),
    facebook: Joi.string().max(100).optional().allow('', null),
    tiktok: Joi.string().max(100).optional().allow('', null),
    youtube: Joi.string().max(200).optional().allow('', null),
    telegram: Joi.string().max(100).optional().allow('', null),
    // Onboarding and verification flags
    onboardingComplete: Joi.boolean().optional(),
    ageVerified: Joi.boolean().optional(),
    termsAccepted: Joi.boolean().optional(),
    privacyAccepted: Joi.boolean().optional(),
    hasSeenTutorial: Joi.boolean().optional(),
  }).min(1),

  // Location schema
  location: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    address: Joi.string().max(200).optional(),
  }),

  // Payment schema
  payment: Joi.object({
    userId: Joi.number().integer().positive().required(),
    amount: Joi.number().positive().max(1000000).required(),
    currency: Joi.string().valid('USD', 'USDC', 'COP').required(),
    planId: Joi.string().required(),
    provider: Joi.string().valid('epayco', 'daimo').required(),
  }),

  // Live stream schema
  liveStream: Joi.object({
    title: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(500).optional(),
    isPaid: Joi.boolean().default(false),
    price: Joi.number().positive().when('isPaid', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  }),

  // Broadcast message schema
  broadcast: Joi.object({
    message: Joi.string().min(1).max(4096).required(),
    target: Joi.string().valid('all', 'premium', 'free').required(),
    mediaUrl: Joi.string().uri().optional(),
    mediaType: Joi.string().valid('photo', 'video', 'document').optional(),
  }),
};

/**
 * Validate data against schema
 * @param {*} data - Data to validate
 * @param {import('joi').Schema} schema - Joi schema
 * @returns {{error: string|null, value: *}} Validation result with error message and value
 */
const validateSchema = (data, schema) => {
  try {
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn('Validation error:', error.details);
      return {
        error: error.details.map((detail) => detail.message).join(', '),
        value: null,
      };
    }

    return { error: null, value };
  } catch (err) {
    logger.error('Validation exception:', err);
    return { error: 'Validation failed', value: null };
  }
};

/**
 * Sanitize object properties
 * @param {Object.<string, *>} obj - Object to sanitize
 * @param {string[]} fields - Fields to sanitize
 * @returns {Object.<string, *>} Sanitized object
 */
const sanitizeObject = (obj, fields) => {
  const sanitized = { ...obj };
  fields.forEach((field) => {
    if (sanitized[field] && typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeInput(sanitized[field]);
    }
  });
  return sanitized;
};

module.exports = {
  sanitizeInput,
  isValidEmail,
  isValidAge,
  isValidUsername,
  isValidUrl,
  isValidLocation,
  isValidAmount,
  isValidTelegramId,
  schemas,
  validateSchema,
  sanitizeObject,
};
