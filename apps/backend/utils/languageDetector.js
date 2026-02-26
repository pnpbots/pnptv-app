/**
 * Language Detector Utility
 * Detects user's preferred language from context
 */

const logger = require('./logger');
const UserModel = require('../models/userModel');

/**
 * Detect language from user context
 * @param {Object} ctx - Telegraf context
 * @returns {Promise<string>} Language code ('en' or 'es')
 */
async function detectLanguage(ctx) {
  try {
    // Priority 1: Check user's Telegram language code
    if (ctx.from?.language_code) {
      const langCode = ctx.from.language_code.toLowerCase();

      // Spanish variants
      if (langCode === 'es' || langCode.startsWith('es-')) {
        return 'es';
      }

      // English variants
      if (langCode === 'en' || langCode.startsWith('en-')) {
        return 'en';
      }
    }

    // Priority 2: Check user's saved language preference from database
    if (ctx.from?.id) {
      try {
        const user = await UserModel.getById(ctx.from.id);
        if (user && user.language) {
          return user.language;
        }
      } catch (error) {
        logger.debug('Error fetching user language preference:', error);
        // Continue to next priority level
      }
    }

    // Priority 3: Check message text for language indicators
    const messageText = ctx.message?.text || ctx.callbackQuery?.message?.text || '';
    if (messageText) {
      const spanishIndicators = ['hola', 'ayuda', 'gracias', 'sí', 'no', 'por favor', 'cómo', 'qué'];
      const lowerText = messageText.toLowerCase();

      for (const indicator of spanishIndicators) {
        if (lowerText.includes(indicator)) {
          return 'es';
        }
      }
    }

    // Default to English
    return 'en';

  } catch (error) {
    logger.error('Error detecting language:', error);
    return 'en'; // Default to English on error
  }
}

/**
 * Get language-specific text from a multilingual object
 * @param {Object} textObject - Object with language keys (en, es)
 * @param {string} lang - Language code
 * @returns {string} Text in specified language or English fallback
 */
function getLocalizedText(textObject, lang = 'en') {
  if (!textObject || typeof textObject !== 'object') {
    return textObject || '';
  }

  return textObject[lang] || textObject.en || Object.values(textObject)[0] || '';
}

/**
 * Format language code to full name
 * @param {string} langCode - Language code ('en' or 'es')
 * @returns {string} Full language name
 */
function getLanguageName(langCode) {
  const languageNames = {
    en: 'English',
    es: 'Español'
  };

  return languageNames[langCode] || languageNames.en;
}

/**
 * Get language flag emoji
 * @param {string} langCode - Language code ('en' or 'es')
 * @returns {string} Flag emoji
 */
function getLanguageFlag(langCode) {
  const flags = {
    en: '🇺🇸',
    es: '🇪🇸'
  };

  return flags[langCode] || flags.en;
}

module.exports = {
  detectLanguage,
  getLocalizedText,
  getLanguageName,
  getLanguageFlag
};
