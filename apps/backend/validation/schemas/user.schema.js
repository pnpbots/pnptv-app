const Joi = require('joi');

/**
 * User validation schemas
 * Centralized validation rules for user-related data
 */
const schemas = {
  /**
   * Telegram User ID validation
   * Must be a string of digits (Telegram IDs are numbers but stored as strings)
   */
  userId: Joi.string()
    .pattern(/^\d+$/)
    .required()
    .messages({
      'string.pattern.base': 'User ID must be a valid Telegram ID',
      'any.required': 'User ID is required',
    }),

  /**
   * Username validation (Telegram username rules)
   * - 5-32 characters
   * - Only letters, numbers, underscores
   * - Case-insensitive
   */
  username: Joi.string()
    .min(5)
    .max(32)
    .pattern(/^[a-zA-Z0-9_]+$/)
    .messages({
      'string.min': 'Username must be at least 5 characters',
      'string.max': 'Username cannot exceed 32 characters',
      'string.pattern.base': 'Username can only contain letters, numbers, and underscores',
    }),

  /**
   * Email validation
   */
  email: Joi.string()
    .email()
    .max(255)
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.max': 'Email cannot exceed 255 characters',
    }),

  /**
   * Phone number validation (international format)
   * E.164 format: +[country code][subscriber number]
   */
  phone: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .messages({
      'string.pattern.base': 'Phone number must be in international format (e.g., +1234567890)',
    }),

  /**
   * Location coordinates validation
   */
  location: Joi.object({
    latitude: Joi.number()
      .min(-90)
      .max(90)
      .required()
      .messages({
        'number.min': 'Latitude must be between -90 and 90',
        'number.max': 'Latitude must be between -90 and 90',
        'any.required': 'Latitude is required',
      }),
    longitude: Joi.number()
      .min(-180)
      .max(180)
      .required()
      .messages({
        'number.min': 'Longitude must be between -180 and 180',
        'number.max': 'Longitude must be between -180 and 180',
        'any.required': 'Longitude is required',
      }),
  }),

  /**
   * User profile update validation
   */
  profileUpdate: Joi.object({
    displayName: Joi.string().min(1).max(100).optional(),
    bio: Joi.string().max(500).optional(),
    avatar: Joi.string().uri().optional(),
    language: Joi.string().valid('en', 'es').optional(),
    timezone: Joi.string().optional(),
  }).min(1), // At least one field must be provided

  /**
   * Registration data validation
   */
  registration: Joi.object({
    userId: Joi.string().pattern(/^\d+$/).required(),
    username: Joi.string().min(5).max(32).pattern(/^[a-zA-Z0-9_]+$/)
      .optional(),
    firstName: Joi.string().min(1).max(100).required(),
    lastName: Joi.string().min(1).max(100).optional(),
    languageCode: Joi.string().length(2).optional(),
  }),
};

/**
 * Middleware factory for validating Telegraf context data
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @param {string} source - Where to get data from ('message', 'callbackQuery', 'update', 'custom')
 * @param {function} extractor - Custom function to extract data from context
 * @returns {function} Telegraf middleware function
 */
const validate = (schema, source = 'message', extractor = null) => async (ctx, next) => {
  const logger = ctx.logger || require('../../utils/logger');

  let dataToValidate;

  // Extract data based on source
  if (extractor) {
    dataToValidate = extractor(ctx);
  } else {
    switch (source) {
      case 'message':
        dataToValidate = ctx.message;
        break;
      case 'callbackQuery':
        dataToValidate = ctx.callbackQuery;
        break;
      case 'update':
        dataToValidate = ctx.update;
        break;
      default:
        dataToValidate = ctx[source];
    }
  }

  // Validate data
  const { error, value } = schema.validate(dataToValidate, {
    abortEarly: false, // Return all errors, not just the first one
    stripUnknown: true, // Remove unknown fields
  });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message).join(', ');
    logger.warn('Validation failed:', {
      userId: ctx.from?.id,
      username: ctx.from?.username,
      errors: errorMessages,
      data: dataToValidate,
    });

    // Send user-friendly error message
    await ctx.reply(
      `❌ Datos inválidos: ${errorMessages}\n\n`
      + 'Por favor verifica e intenta de nuevo.',
    );

    return; // Stop middleware chain
  }

  // Attach validated and sanitized data to context
  ctx.validated = value;

  return next();
};

/**
 * Quick validation function (non-middleware)
 * Useful for validating data outside of Telegraf handlers
 * @param {Joi.Schema} schema - Joi schema
 * @param {any} data - Data to validate
 * @returns {Promise<{valid: boolean, data?: any, errors?: string[]}>}
 */
const validateData = async (schema, data) => {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return {
      valid: false,
      errors: error.details.map((detail) => detail.message),
    };
  }

  return {
    valid: true,
    data: value,
  };
};

module.exports = {
  schemas,
  validate,
  validateData,
};
