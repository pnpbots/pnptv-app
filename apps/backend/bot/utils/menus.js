/**
 * Inline keyboard menu templates
 */

const PNP_TV_LINK = 'https://t.me/+GDD0AAVbvGM3MGEx';
const PNPTV_APP_BASE = 'https://pnptv.app';

/**
 * Main menu for users
 * @param {string} [language='en'] - Language code ('en' or 'es')
 * @param {boolean} [isPrime=false] - Whether user is PRIME member
 * @returns {{inline_keyboard: Array<Array<{text: string, callback_data: string}>>}} Inline keyboard markup
 */
const getMainMenu = (language = 'en', isPrime = false) => {
  const labels = {
    en: {
      profile: '👤 My Profile',
      subscribe: '💎 Subscribe to PRIME',
      nearby: '📍 Nearby Users',
      hangouts: '🎥 Hangouts',
      videorama: '🎶 Videorama',
      live: '📺 Live',
      support: '🆘 Help and support',
      settings: '⚙️ Settings',
      latinoTv: 'PNP Latino TV | Watch now',
      pnpLive: 'PNP Live | Latino Men on Webcam',
      pnpApp: 'PNP tv App | PRIME area',
      login: '🔐 Login to PNPtv',
    },
    es: {
      profile: '👤 Mi Perfil',
      subscribe: '💎 Suscribirse a PRIME',
      nearby: '📍 Usuarios Cercanos',
      hangouts: '🎥 Hangouts',
      videorama: '🎶 Videorama',
      live: '📺 En Vivo',
      support: '🆘 Ayuda y soporte',
      settings: '⚙️ Configuración',
      latinoTv: 'PNP Latino TV | Ver ahora',
      pnpLive: 'PNP Live | Hombres Latinos en Webcam',
      pnpApp: 'PNP tv App | Área PRIME',
      login: '🔐 Iniciar sesión en PNPtv',
    },
  };

  const l = labels[language] || labels.en;

  const primeButtons = [
    [
      {
        text: l.latinoTv,
        url: PNP_TV_LINK,
      },
    ],
    [
      {
        text: l.pnpLive,
        url: `${PNPTV_APP_BASE}/live`,
      },
    ],
    [
      {
        text: l.pnpApp,
        url: `${PNPTV_APP_BASE}/login`,
      },
    ],
    [
      {
        text: l.hangouts,
        url: `${PNPTV_APP_BASE}/hangouts`,
      },
      {
        text: l.videorama,
        url: `${PNPTV_APP_BASE}/videorama`,
      },
    ],
    [
      { text: l.profile, callback_data: 'menu_profile' },
      { text: l.support, callback_data: 'menu_support' },
    ],
  ];

  const freeButtons = [
    [{ text: l.subscribe, callback_data: 'menu_subscribe' }],
    [{ text: l.nearby, callback_data: 'menu_nearby' }],
    [
      { text: l.hangouts, url: `${PNPTV_APP_BASE}/hangouts` },
      { text: l.videorama, url: `${PNPTV_APP_BASE}/videorama` },
    ],
    [
      { text: l.live, url: `${PNPTV_APP_BASE}/live` },
      { text: l.login, url: `${PNPTV_APP_BASE}/login` },
    ],
    [
      { text: l.profile, callback_data: 'menu_profile' },
      { text: l.support, callback_data: 'menu_support' },
    ],
    [{ text: l.settings, callback_data: 'menu_settings' }],
  ];

  return {
    inline_keyboard: isPrime ? primeButtons : freeButtons,
  };
};

/**
 * Language selection menu
 * @returns {{inline_keyboard: Array<Array<{text: string, callback_data: string}>>}} Inline keyboard markup
 */
const getLanguageMenu = () => {
  return {
    inline_keyboard: [
      [{ text: '🇬🇧 English', callback_data: 'lang_en' }],
      [{ text: '🇪🇸 Español', callback_data: 'lang_es' }],
    ],
  };
};

/**
 * Subscription plans menu
 * @param {string} [language='en'] - Language code ('en' or 'es')
 * @returns {{inline_keyboard: Array<Array<{text: string, callback_data: string}>>}} Inline keyboard markup
 */
const getPlansMenu = (language = 'en') => {
  const labels = {
    en: {
      basic: '🥉 Basic - $9.99/mo',
      premium: '🥈 Premium - $19.99/mo',
      gold: '🥇 Gold - $49.99/mo',
      enterprise: '💼 Enterprise - Custom',
      back: '🔙 Back',
    },
    es: {
      basic: '🥉 Básico - $9.99/mes',
      premium: '🥈 Premium - $19.99/mes',
      gold: '🥇 Oro - $49.99/mes',
      enterprise: '💼 Empresarial - Personalizado',
      back: '🔙 Volver',
    },
  };

  const l = labels[language] || labels.en;

  return {
    inline_keyboard: [
      [{ text: l.basic, callback_data: 'plan_basic' }],
      [{ text: l.premium, callback_data: 'plan_premium' }],
      [{ text: l.gold, callback_data: 'plan_gold' }],
      [{ text: l.enterprise, callback_data: 'plan_enterprise' }],
      [{ text: l.back, callback_data: 'back_main' }],
    ],
  };
};

/**
 * Payment method menu
 * @param {string|number} planId - Plan ID
 * @param {string} [language='en'] - Language code ('en' or 'es')
 * @returns {{inline_keyboard: Array<Array<{text: string, callback_data: string}>>}} Inline keyboard markup
 */
const getPaymentMethodMenu = (planId, language = 'en') => {
  const labels = {
    en: {
      credit: '💳 Credit Card (Stripe)',
      crypto: '🥷 Crypto / Dash',
      back: '🔙 Back to Plans',
    },
    es: {
      credit: '💳 Tarjeta de Crédito (Stripe)',
      crypto: '🥷 Crypto / Dash',
      back: '🔙 Volver a Planes',
    },
  };

  const l = labels[language] || labels.en;

  return {
    inline_keyboard: [
      [{ text: l.credit, url: `https://app.pnptv.app/subscribe?plan=${encodeURIComponent(planId)}` }],
      [{ text: l.crypto, url: 'https://app.pnptv.app/subscribe' }],
      [{ text: l.back, callback_data: 'back_plans' }],
    ],
  };
};

/**
 * Admin menu
 */
const getAdminMenu = () => {
  return {
    inline_keyboard: [
      [{ text: '📢 Broadcast Messages', callback_data: 'admin_broadcast' }],
      [{ text: '👥 User Management', callback_data: 'admin_users' }],
      [{ text: '📊 Analytics', callback_data: 'admin_analytics' }],
      [{ text: '💰 Plan Management', callback_data: 'admin_plans' }],
      [{ text: '⚙️ Settings', callback_data: 'admin_settings' }],
    ],
  };
};

/**
 * Broadcast type menu
 * @param {string} [language='en'] - Language code ('en' or 'es')
 */
const getBroadcastTypeMenu = (language = 'en') => {
  const labels = {
    en: {
      text: '💬 Text Message',
      photo: '📷 Photo with Caption',
      video: '🎥 Video with Caption',
      back: '🔙 Back to Admin',
    },
    es: {
      text: '💬 Mensaje de Texto',
      photo: '📷 Foto con Leyenda',
      video: '🎥 Video con Leyenda',
      back: '🔙 Volver al Admin',
    },
  };

  const l = labels[language] || labels.en;

  return {
    inline_keyboard: [
      [{ text: l.text, callback_data: 'broadcast_text' }],
      [{ text: l.photo, callback_data: 'broadcast_photo' }],
      [{ text: l.video, callback_data: 'broadcast_video' }],
      [{ text: l.back, callback_data: 'back_admin' }],
    ],
  };
};

/**
 * Confirmation menu
 */
const getConfirmationMenu = (action, language = 'en') => {
  const labels = {
    en: {
      confirm: '✅ Confirm',
      cancel: '❌ Cancel',
    },
    es: {
      confirm: '✅ Confirmar',
      cancel: '❌ Cancelar',
    },
  };

  const l = labels[language] || labels.en;

  return {
    inline_keyboard: [
      [
        { text: l.confirm, callback_data: `confirm_${action}` },
        { text: l.cancel, callback_data: `cancel_${action}` },
      ],
    ],
  };
};

/**
 * Back button
 */
const getBackButton = (destination, language = 'en') => {
  const label = language === 'es' ? '🔙 Volver' : '🔙 Back';
  return {
    inline_keyboard: [[{ text: label, callback_data: `back_${destination}` }]],
  };
};

/**
 * Settings menu
 */
const getSettingsMenu = (language = 'en') => {
  const labels = {
    en: {
      language: '🌐 Change Language',
      notifications: '🔔 Notifications',
      privacy: '🔒 Privacy Settings',
      back: '🔙 Back to Main Menu',
    },
    es: {
      language: '🌐 Cambiar Idioma',
      notifications: '🔔 Notificaciones',
      privacy: '🔒 Configuración de Privacidad',
      back: '🔙 Volver al Menú Principal',
    },
  };

  const l = labels[language] || labels.en;

  return {
    inline_keyboard: [
      [{ text: l.language, callback_data: 'settings_language' }],
      [{ text: l.notifications, callback_data: 'settings_notifications' }],
      [{ text: l.privacy, callback_data: 'settings_privacy' }],
      [{ text: l.back, callback_data: 'back_main' }],
    ],
  };
};

module.exports = {
  getMainMenu,
  getLanguageMenu,
  getPlansMenu,
  getPaymentMethodMenu,
  getAdminMenu,
  getBroadcastTypeMenu,
  getConfirmationMenu,
  getBackButton,
  getSettingsMenu,
};
