/**
 * Menu Configuration
 * Defines all menu options, categories, and display settings
 */

const config = require('./config');

const MENU_CONFIG = {
  // Main menu categories (displayed in private chat and group /menu)
  MAIN_CATEGORIES: {
    SUBSCRIPTION: {
      id: 'subscription',
      title: {
        en: '📱 Subscription & Access',
        es: '📱 Suscripción y Acceso'
      },
      description: {
        en: 'Manage your subscription and access',
        es: 'Administra tu suscripción y acceso'
      },
      emoji: '📱',
      options: [
        {
          id: 'subscribe',
          title: { en: '✨ Subscribe Now', es: '✨ Suscribirse Ahora' },
          callback: 'menu:subscribe',
          deepLink: 'subscribe'
        },
        {
          id: 'subscription_status',
          title: { en: '📊 Subscription Status', es: '📊 Estado de Suscripción' },
          callback: 'menu:subscription_status',
          deepLink: 'subscription_status'
        },
        {
          id: 'renew',
          title: { en: '🔄 Renew Subscription', es: '🔄 Renovar Suscripción' },
          callback: 'menu:renew',
          deepLink: 'renew'
        },
        {
          id: 'payment_methods',
          title: { en: '💳 Payment Methods', es: '💳 Métodos de Pago' },
          callback: 'menu:payment_methods',
          deepLink: 'payment_methods'
        }
      ]
    },

    CONTENT: {
      id: 'content',
      title: {
        en: '🎬 Content & Media',
        es: '🎬 Contenido y Medios'
      },
      description: {
        en: 'Access exclusive content and media',
        es: 'Accede a contenido exclusivo y medios'
      },
      emoji: '🎬',
      options: [
        {
          id: 'video_calls',
          title: { en: '📹 Video Calls', es: '📹 Videollamadas' },
          callback: 'menu:video_calls',
          deepLink: 'video_calls'
        },
        {
          id: 'photos',
          title: { en: '📸 Exclusive Photos', es: '📸 Fotos Exclusivas' },
          callback: 'menu:photos',
          deepLink: 'photos'
        },
        {
          id: 'videos',
          title: { en: '🎥 Exclusive Videos', es: '🎥 Videos Exclusivos' },
          callback: 'menu:videos',
          deepLink: 'videos'
        },
        {
          id: 'podcasts',
          title: { en: '🎙️ Podcasts', es: '🎙️ Podcasts' },
          callback: 'menu:podcasts',
          deepLink: 'podcasts'
        }
      ]
    },

    COMMUNITY: {
      id: 'community',
      title: {
        en: '👥 Community & Engagement',
        es: '👥 Comunidad y Participación'
      },
      description: {
        en: 'Join the community and engage',
        es: 'Únete a la comunidad y participa'
      },
      emoji: '👥',
      options: [
        {
          id: 'community_features',
          title: { en: '✨ Community Features', es: '✨ Características de la Comunidad' },
          callback: 'menu:community_features',
          deepLink: 'community_features',
          url: 'https://pnptv.app/community-features'
        },
        {
          id: 'join_group',
          title: { en: '🌟 Join Group', es: '🌟 Unirse al Grupo' },
          callback: 'menu:join_group',
          deepLink: 'join_group'
        },
        {
          id: 'events',
          title: { en: '🎉 Events', es: '🎉 Eventos' },
          callback: 'menu:events',
          deepLink: 'events'
        }
      ]
    },

    SUPPORT: {
      id: 'support',
      title: {
        en: '💬 Support & Help',
        es: '💬 Soporte y Ayuda'
      },
      description: {
        en: 'Get help and support',
        es: 'Obtén ayuda y soporte'
      },
      emoji: '💬',
      options: [
        {
          id: 'faq',
          title: { en: '❓ FAQ', es: '❓ Preguntas Frecuentes' },
          callback: 'menu:faq',
          deepLink: 'faq'
        },
        {
          id: 'support',
          title: { en: '🆘 Contact Support', es: '🆘 Contactar Soporte' },
          callback: 'menu:support',
          deepLink: 'support'
        },
        {
          id: 'cristina_ai',
          title: { en: '🤖 Cristina AI Assistant', es: '🤖 Asistente IA Cristina' },
          callback: 'menu:cristina_ai',
          deepLink: 'cristina_ai'
        },
        {
          id: 'rules',
          title: { en: '📜 Community Rules', es: '📜 Reglas de la Comunidad' },
          callback: 'menu:rules',
          deepLink: 'rules'
        },
        {
          id: 'how_to_use',
          title: { en: '📖 How to use PNPtv!', es: '📖 ¡Cómo usar PNPtv!' },
          callback: 'menu:how_to_use',
          deepLink: 'how_to_use',
          url: 'https://pnptv.app/community-features'
        }
      ]
    },

    SETTINGS: {
      id: 'settings',
      title: {
        en: '⚙️ Settings & Profile',
        es: '⚙️ Configuración y Perfil'
      },
      description: {
        en: 'Manage your settings and profile',
        es: 'Administra tu configuración y perfil'
      },
      emoji: '⚙️',
      options: [
        {
          id: 'profile',
          title: { en: '👤 My Profile', es: '👤 Mi Perfil' },
          callback: 'menu:profile',
          deepLink: 'profile'
        },
        {
          id: 'notifications',
          title: { en: '🔔 Notification Settings', es: '🔔 Configuración de Notificaciones' },
          callback: 'menu:notifications',
          deepLink: 'notifications'
        },
        {
          id: 'language',
          title: { en: '🌍 Language / Idioma', es: '🌍 Idioma / Language' },
          callback: 'menu:language',
          deepLink: 'language'
        },
        {
          id: 'privacy',
          title: { en: '🔒 Privacy Settings', es: '🔒 Configuración de Privacidad' },
          callback: 'menu:privacy',
          deepLink: 'privacy'
        }
      ]
    }
  },

  // Group-specific menu (restricted options for group chat)
  GROUP_MENU: {
    title: {
      en: '🎯 PNPtv Menu',
      es: '🎯 Menú PNPtv'
    },
    options: [
      {
        id: 'subscribe',
        title: { en: '💎 Subscribe to PRIME', es: '💎 Suscribirse a PRIME' },
        callback: 'menu:subscribe',
        deepLink: 'subscribe'
      },
      {
        id: 'nearby',
        title: { en: '📍 Nearby', es: '📍 Cercanos' },
        callback: 'menu:nearby',
        deepLink: 'nearby'
      },
      {
        id: 'main_room',
        title: { en: '🎥 PNPtv Main Room', es: '🎥 Sala Principal PNPtv' },
        callback: 'menu:main_room',
        deepLink: 'main_room'
      },
      {
        id: 'support',
        title: { en: '💬 Support', es: '💬 Soporte' },
        callback: 'menu:support',
        deepLink: 'support'
      }
    ]
  },

  // PRIME members menu (2-column layout for /start)
  PRIME_MENU: {
    title: {
      en: '👑 PRIME Members Menu',
      es: '👑 Menú Miembros PRIME'
    },
    options: [
      [
        {
          id: 'profile',
          title: { en: '👤 My Profile', es: '👤 Mi Perfil' },
          callback: 'menu:profile',
          deepLink: 'profile'
        },
        {
          id: 'nearby',
          title: { en: '📍 Who is Nearby?', es: '📍 ¿Quién está Cercano?' },
          callback: 'menu:nearby',
          deepLink: 'nearby'
        }
      ],
      [
        {
          id: 'prime_content',
          title: { en: '💎 Watch PRIME Content', es: '💎 Ver Contenido PRIME' },
          callback: 'menu:prime_content',
          deepLink: 'prime_content'
        },
        {
          id: 'vc_rooms',
          title: { en: '🎥 PNPtv VC Rooms', es: '🎥 Salas VC PNPtv' },
          callback: 'menu:vc_rooms',
          deepLink: 'vc_rooms'
        }
      ],

      [
        {
          id: 'settings',
          title: { en: '⚙️ Settings', es: '⚙️ Configuración' },
          callback: 'menu:settings',
          deepLink: 'settings'
        },
        {
          id: 'support',
          title: { en: '💬 Support', es: '💬 Soporte' },
          callback: 'menu:support',
          deepLink: 'support'
        }
      ]
    ]
  },

  // Topic 3809 specific menu (only video calls)
  TOPIC_3809_MENU: {
    title: {
      en: '🎬 Content Menu',
      es: '🎬 Menú de Contenido'
    },
    description: {
      en: 'Access video calls',
      es: 'Accede a videollamadas'
    },
    options: [
      {
        id: 'video_calls',
        title: { en: '📹 Video Calls', es: '📹 Videollamadas' },
        callback: 'menu:video_calls',
        deepLink: 'video_calls'
      }
    ]
  },

  // Messages
  MESSAGES: {
    MAIN_MENU: {
      en: '🎯 *Main Menu*\n\nSelect an option below to get started:',
      es: '🎯 *Menú Principal*\n\nSelecciona una opción para comenzar:'
    },
    TOPIC_3809_MENU: {
      en: '🎬 *Content Menu*\n\nAccess our exclusive content:',
      es: '🎬 *Menú de Contenido*\n\nAccede a nuestro contenido exclusivo:'
    },
    GROUP_REDIRECT: {
      en: '@{username} I sent you a direct message about your *{option}* request!',
      es: '@{username} ¡Te envié un mensaje directo sobre tu solicitud de *{option}*!'
    },
    OPEN_BOT_BUTTON: {
      en: '💬 Open Bot',
      es: '💬 Abrir Bot'
    },
    DM_MESSAGE: {
      en: '✨ You selected: *{option}*\n\nHere\'s what you can do:',
      es: '✨ Seleccionaste: *{option}*\n\nEsto es lo que puedes hacer:'
    },
    PLEASE_START_BOT: {
      en: '⚠️ Please start a private chat with me first!\n\nClick the button below to open our conversation:',
      es: '⚠️ ¡Por favor inicia una conversación privada conmigo primero!\n\nHaz clic en el botón de abajo para abrir nuestra conversación:'
    },
    FEATURE_COMING_SOON: {
      en: '🚧 This feature is coming soon!\n\nStay tuned for updates.',
      es: '🚧 ¡Esta función estará disponible pronto!\n\nMantente atento a las actualizaciones.'
    }
  },

  // Deep link base URL
  BOT_USERNAME: config.BOT_USERNAME || 'your_bot_username',

  // Topic configuration
  TOPICS: {
    CONTENT_MENU: 3809 // Topic ID for special content menu
  }
};

/**
 * Get menu options based on context
 */
function getMenuOptions(context = 'main', lang = 'en') {
  if (context === 'topic_3809') {
    return MENU_CONFIG.TOPIC_3809_MENU.options;
  }

  // Return all main categories
  return MENU_CONFIG.MAIN_CATEGORIES;
}

/**
 * Get option by ID
 */
function getOptionById(optionId) {
  // Search in main categories
  for (const category of Object.values(MENU_CONFIG.MAIN_CATEGORIES)) {
    const option = category.options.find(opt => opt.id === optionId);
    if (option) {
      return option;
    }
  }

  // Search in topic 3809 menu
  const option = MENU_CONFIG.TOPIC_3809_MENU.options.find(opt => opt.id === optionId);
  if (option) {
    return option;
  }

  return null;
}

/**
 * Get option title by ID
 */
function getOptionTitle(optionId, lang = 'en') {
  const option = getOptionById(optionId);
  if (!option) return optionId;

  return option.title[lang] || option.title.en;
}

/**
 * Generate deep link for specific menu option
 */
function generateDeepLink(optionId) {
  const option = getOptionById(optionId);
  if (!option || !option.deepLink) {
    return `https://t.me/${MENU_CONFIG.BOT_USERNAME}`;
  }

  return `https://t.me/${MENU_CONFIG.BOT_USERNAME}?start=menu_${option.deepLink}`;
}

/**
 * Get message text
 */
function getMessage(key, lang = 'en', replacements = {}) {
  let message = MENU_CONFIG.MESSAGES[key]?.[lang] || MENU_CONFIG.MESSAGES[key]?.en || '';

  // Replace placeholders
  for (const [placeholder, value] of Object.entries(replacements)) {
    message = message.replace(`{${placeholder}}`, value);
  }

  return message;
}

module.exports = {
  MENU_CONFIG,
  getMenuOptions,
  getOptionById,
  getOptionTitle,
  generateDeepLink,
  getMessage
};
