/**
 * Broadcast Utilities
 * Shared functions for broadcast and share post functionality
 */

const { Markup } = require('telegraf');
const i18n = require('./i18n');

/**
 * Translate button text based on user language
 * @param {string} buttonKey - Button translation key
 * @param {string} language - User language ('en' or 'es')
 * @returns {string} Translated button text
 */
function translateButtonText(buttonKey, language = 'en') {
  return i18n.t(buttonKey, language);
}

/**
 * Get standard button options for broadcasts and community posts
 * @param {string} [language='en'] - Language code ('en' or 'es')
 * @returns {Array} Array of button configuration objects
 */
function getStandardButtonOptions(language = 'en') {
  const botUsername = process.env.BOT_USERNAME || 'pnplatinotv_bot';
  const mainRoomUrl = 'https://meet.jit.si/pnptv-main-room#config.prejoinPageEnabled=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false';
  const hangoutsUrl = process.env.HANGOUTS_WEB_APP_URL || 'https://pnptv.app/hangouts';
  const videoramaUrl = process.env.VIDEORAMA_URL || 'https://pnptv.app/videorama-app/';

  const translations = {
    en: {
      home: '🏠 Back to home menu',
      plans: '💎 Subscribe to PRIME',
      main_room: '🎥 PNPtv Main Room',
      hangouts: '🎭 PNPtv Hangouts',
      videorama: '🎬 PNPtv Videorama',
      pnp_live: '📺 PNP Live',
      nearby: '📍 Check Who is Nearby',
      profile: '📝 Edit My Profile',
      cristina: '🤖 Cristina AI',
      all_features: '✨ All Features',
    },
    es: {
      home: '🏠 Volver al menú principal',
      plans: '💎 Suscribirse a PRIME',
      main_room: '🎥 Sala Principal PNPtv',
      hangouts: '🎭 PNPtv Hangouts',
      videorama: '🎬 PNPtv Videorama',
      pnp_live: '📺 PNP Live',
      nearby: '📍 Ver quién está cerca',
      profile: '📝 Editar mi perfil',
      cristina: '🤖 Cristina AI',
      all_features: '✨ Todas las Funciones',
    }
  };

  const t = translations[language] || translations.en;

  return [
    { key: 'home', text: t.home, type: 'url', target: `https://t.me/${botUsername}?start=home` },
    { key: 'plans', text: t.plans, type: 'url', target: `https://t.me/${botUsername}?start=plans` },
    { key: 'main_room', text: t.main_room, type: 'url', target: mainRoomUrl },
    { key: 'hangouts', text: t.hangouts, type: 'url', target: hangoutsUrl },
    { key: 'videorama', text: t.videorama, type: 'url', target: videoramaUrl },
    { key: 'pnp_live', text: t.pnp_live, type: 'url', target: `https://t.me/${botUsername}?start=pnp_live` },
    { key: 'nearby', text: t.nearby, type: 'url', target: `https://t.me/${botUsername}?start=nearby` },
    { key: 'profile', text: t.profile, type: 'url', target: `https://t.me/${botUsername}?start=edit_profile` },
    { key: 'cristina', text: t.cristina, type: 'url', target: `https://t.me/${botUsername}?start=cristina` },
    { key: 'all_features', text: t.all_features, type: 'url', target: `https://t.me/${botUsername}?start=home` },
  ];
}

/**
 * Normalize buttons from various formats to consistent array format
 * @param {Array|String} buttons - Buttons in various formats
 * @returns {Array} Normalized array of button objects
 */
function normalizeButtons(buttons) {
  if (!buttons) return [];
  
  if (Array.isArray(buttons)) {
    return buttons.map(b => typeof b === 'string' ? JSON.parse(b) : b);
  }
  
  if (typeof buttons === 'string' && buttons.trim()) {
    try {
      const parsed = JSON.parse(buttons);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  
  return [];
}

/**
 * Build Telegram inline keyboard from button configurations
 * @param {Array} buttons - Array of button configuration objects
 * @returns {Object|undefined} Markup.inlineKeyboard object or undefined
 */
function buildInlineKeyboard(buttons) {
  const normalized = normalizeButtons(buttons);
  if (!normalized.length) return undefined;
  
  const rows = normalized.map((raw) => {
    const b = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (b.type === 'url') {
      return [Markup.button.url(b.text, b.target)];
    }
    if (b.type === 'callback') {
      return [Markup.button.callback(b.text, b.data)];
    }
    return null;
  }).filter(Boolean);
  
  return rows.length ? Markup.inlineKeyboard(rows) : undefined;
}

/**
 * Build post caption with proper formatting
 * @param {Object} postData - Post data containing text
 * @returns {String} Formatted caption
 */
function buildPostCaption(postData) {
  const text = postData.text || postData.textEn || '';
  return text ? `📢 ${text}` : '';
}

/**
 * Validate broadcast or post data
 * @param {Object} data - Broadcast/post data to validate
 * @param {Boolean} requireBothLanguages - Whether both languages are required
 * @returns {Object} Validation result with valid flag and errors array
 */
function validateBroadcastData(data, requireBothLanguages = false) {
  const errors = [];

  if (!data.target && !data.postDestinations) {
    errors.push('Target audience or destinations are required');
  }

  if (requireBothLanguages) {
    if (!data.textEn) errors.push('English text is required');
    if (!data.textEs) errors.push('Spanish text is required');
  } else {
    if (!data.textEn && !data.textEs && !data.text) {
      errors.push('At least one language text is required');
    }
  }

  // Text length validation
  if (data.textEn && data.textEn.length > 4096) {
    errors.push('English text exceeds 4096 character limit');
  }
  if (data.textEs && data.textEs.length > 4096) {
    errors.push('Spanish text exceeds 4096 character limit');
  }
  if (data.text && data.text.length > 4096) {
    errors.push('Text exceeds 4096 character limit');
  }

  return { 
    valid: errors.length === 0, 
    errors 
  };
}

/**
 * Build progress indicator for multi-step processes
 * @param {Number} currentStep - Current step number
 * @param {Number} totalSteps - Total number of steps
 * @param {String} description - Step description
 * @param {String} lang - Language code (en/es)
 * @returns {String} Formatted progress message
 */
function buildProgressIndicator(currentStep, totalSteps, description, lang = 'en') {
  const progressBar = '▰'.repeat(currentStep) + '▱'.repeat(totalSteps - currentStep);
  const progressPercent = Math.round((currentStep / totalSteps) * 100);
  
  const header = lang === 'es' ? '📤 *Compartir Publicación*' : '📤 *Share Post*';
  const stepLabel = lang === 'es' ? '*Paso*' : '*Step*';
  const progressLabel = lang === 'es' ? '*Progreso*' : '*Progress*';

  return `${header}\n\n` +
    `${stepLabel} ${currentStep}/${totalSteps}: ${description}\n\n` +
    `${progressLabel}: [${progressBar}] ${progressPercent}%\n\n`;
}

/**
 * Sanitize input text to prevent injection and ensure safety
 * @param {String} text - Input text to sanitize
 * @param {Number} maxLength - Maximum allowed length
 * @returns {String} Sanitized text
 */
function sanitizeInput(text, maxLength = 4096) {
  if (!text) return '';
  
  return String(text)
    .replace(/[<>&]/g, '') // Basic HTML sanitization
    .substring(0, maxLength); // Length limit
}

/**
 * Build default broadcast buttons (home and profile)
 * @param {String} lang - Language code (en/es)
 * @returns {Array} Array of default button configurations
 */
function buildDefaultBroadcastButtons(lang = 'en') {
  const options = getStandardButtonOptions();

  // Return broadcast ads buttons by default
  const plansButton = options.find(opt => opt.key === 'plans');
  const profileButton = options.find(opt => opt.key === 'profile');
  const nearbyButton = options.find(opt => opt.key === 'nearby');

  return [plansButton, profileButton, nearbyButton].filter(Boolean);
}

/**
 * Get button toggle label based on selection state
 * @param {Boolean} isSelected - Whether button is selected
 * @param {String} text - Button text
 * @param {String} lang - Language code
 * @returns {String} Label with appropriate prefix
 */
function getButtonToggleLabel(isSelected, text, lang = 'en') {
  const prefix = isSelected ? (lang === 'es' ? '✅' : '✅') : (lang === 'es' ? '➕' : '➕');
  return `${prefix} ${text}`;
}

/**
 * Format statistics display for admin panels
 * @param {Object} stats - Statistics data
 * @param {String} lang - Language code
 * @returns {String} Formatted statistics text
 */
function formatDashboardStats(stats, lang) {
  if (!stats?.users) return '';

  const users = stats.users;
  const totalUsers = users.totalUsers ?? '-';
  const activeSubscriptions = users.activeSubscriptions ?? '-';
  const newUsersLast30Days = users.newUsersLast30Days ?? '-';

  const lines = [];
  lines.push(lang === 'es' ? '`📊 Resumen`' : '`📊 Summary`');
  lines.push(`${lang === 'es' ? '• Usuarios' : '• Users'}: ${totalUsers}`);
  lines.push(`${lang === 'es' ? '• Suscripciones activas' : '• Active subscriptions'}: ${activeSubscriptions}`);
  lines.push(`${lang === 'es' ? '• Nuevos (30d)' : '• New (30d)'}: ${newUsersLast30Days}`);

  if (stats.recentBroadcasts?.length) {
    const recent = stats.recentBroadcasts
      .slice(0, 3)
      .map(b => sanitizeInput(b?.status || 'sent'))
      .join(', ');
    lines.push(`${lang === 'es' ? '• Broadcasts' : '• Broadcasts'}: ${recent}`);
  }

  return `${lines.join('\n')}\n\n`;
}

module.exports = {
  getStandardButtonOptions,
  normalizeButtons,
  buildInlineKeyboard,
  buildPostCaption,
  validateBroadcastData,
  buildProgressIndicator,
  sanitizeInput,
  buildDefaultBroadcastButtons,
  getButtonToggleLabel,
  formatDashboardStats
};
