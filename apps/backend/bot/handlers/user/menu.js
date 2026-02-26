const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const ChatCleanupService = require('../../services/chatCleanupService');
const PermissionService = require('../../services/permissionService');
const { isPrimeUser, hasFullAccess, safeReplyOrEdit } = require('../../utils/helpers');
const config = require('../../../config/config');
const UserModel = require('../../../models/userModel');
const PlanModel = require('../../../models/planModel');

/**
 * Sanitize text for Telegram Markdown to prevent parsing errors
 * Ensures backticks are properly matched and no newlines inside monospace
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
const sanitizeMarkdown = (text) => {
  if (!text) return '';
  // Replace any backtick followed immediately by newline with backtick + space + newline
  // This prevents Telegram from failing to find the end of monospace entity
  return text.replace(/`\n/g, '` \n').replace(/\n`/g, '\n `');
};

/**
 * Format membership expiration date
 * @param {Date|string} expiry - Expiration date
 * @param {string} lang - Language code
 * @returns {string} Formatted date string
 */
const formatMembershipExpiry = (expiry, lang) => {
  if (!expiry) return lang === 'es' ? 'Sin fecha de vencimiento' : 'No expiration date';

  const date = expiry instanceof Date ? expiry : new Date(expiry);
  if (isNaN(date.getTime())) return lang === 'es' ? 'Fecha no disponible' : 'Date not available';

  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', options);
};

/**
 * Build membership status header
 * @param {Object} user - User object
 * @param {boolean} isPremium - Whether user is premium
 * @param {string} lang - Language code
 * @returns {string} Membership status header
 */
const buildMembershipHeader = (user, isPremium, lang) => {
  const memberType = isPremium ? 'PRIME' : 'FREE';
  const emoji = isPremium ? '💎' : '🆓';
  const memberLabel = lang === 'es' ? 'Membresía' : 'Membership';

  if (isPremium && user?.planExpiry) {
    const expiryDate = formatMembershipExpiry(user.planExpiry, lang);
    const validUntil = lang === 'es' ? 'Válido hasta' : 'Valid until';
    return `${emoji} *${memberLabel}: ${memberType}*\n📅 ${validUntil}: ${expiryDate}\n\n`;
  } else if (isPremium) {
    // PRIME without expiry (lifetime or similar)
    const lifetime = lang === 'es' ? 'Lifetime' : 'Lifetime';
    return `${emoji} *${memberLabel}: ${memberType}* (${lifetime})\n\n`;
  } else {
    // FREE user
    return `${emoji} *${memberLabel}: ${memberType}*\n\n`;
  }
};

const formatPlanButtonText = (plan, lang) => {
  const displayName = lang === 'es' ? (plan.nameEs || plan.name) : plan.name;
  const duration = plan.duration || plan.duration_days || plan.durationDays || 0;
  const isLifetimePlan = plan.isLifetime || duration >= 36500;
  const periodText = isLifetimePlan
    ? (lang === 'es' ? 'De por vida' : 'Lifetime')
    : `${duration} ${t('days', lang)}`;
  const priceText = plan.price ? `$${plan.price.toFixed(2)}` : '';
  const textSegments = [displayName];
  if (periodText) textSegments.push(periodText);
  if (priceText) textSegments.push(priceText);
  return textSegments.join(' | ');
};

const buildPlanButtons = async (lang) => {
  try {
    const plans = await PlanModel.getPublicPlans();
    if (!plans || plans.length === 0) {
      throw new Error('No plans available');
    }

    const visiblePlans = plans.filter((plan) => plan.active);
    if (visiblePlans.length === 0) {
      throw new Error('No active plans available');
    }

    return visiblePlans.map((plan) => ([
      Markup.button.callback(formatPlanButtonText(plan, lang), `select_plan_${plan.id}`),
    ]));
  } catch (error) {
    logger.warn('Unable to build plan buttons:', error.message);
    return [
      [Markup.button.callback(lang === 'es' ? '💎 Suscríbete a PRIME' : '💎 Subscribe to PRIME', 'menu_subscribe')],
    ];
  }
};

const buildPrimeMenuButtons = (lang) => ([
  [
    Markup.button.url(
      lang === 'es' ? 'PNP Latino TV | Ver ahora' : 'PNP Latino TV | Watch now',
      'https://t.me/+GDD0AAVbvGM3MGEx'
    ),
  ],
  [
    Markup.button.callback(
      lang === 'es' ? 'PNP Live | Hombres Latinos en Webcam' : 'PNP Live | Latino Men on Webcam',
      'PNP_LIVE_START'
    ),
  ],
  [
    Markup.button.callback(
      lang === 'es' ? 'PNP tv App | Área PRIME' : 'PNP tv App | PRIME area',
      'menu_pnp_tv_app'
    ),
  ],
  [
    Markup.button.callback(lang === 'es' ? '👤 Mi Perfil' : '👤 My Profile', 'show_profile'),
    Markup.button.callback(lang === 'es' ? '🆘 Ayuda y Soporte' : '🆘 Help & Support', 'show_support'),
  ],
]);

const buildOnboardingPrompt = (lang, botUsername) => {
  const message = lang === 'es'
    ? '📝 Necesitas completar el onboarding para acceder al menú.\n\nUsa /start para continuar.'
    : '📝 You need to complete onboarding to access the menu.\n\nUse /start to continue.';
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(
      lang === 'es' ? '🚀 Completar Onboarding' : '🚀 Complete Onboarding',
      `https://t.me/${botUsername}?start=onboarding`
    )]
  ]);

  return { message, keyboard };
};

const fetchUserForMenu = async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return ctx.session?.user || null;

  try {
    return await UserModel.getById(userId);
  } catch (error) {
    logger.warn('Error fetching user for menu:', error.message);
    return ctx.session?.user || null;
  }
};

/**
 * Envía mensaje de bienvenida y link de ingreso al canal PRIME
 * @param {Telegraf} bot - Bot instance
 * @param {string|number} userId - Telegram user ID
 */
const sendPrimeWelcome = async (bot, userId) => {
  const messageEs = [
    '🎉 ¡Bienvenido a PNPtv!',
    '',
    'Para explorar PNPtv, pulsa /menu',
    '',
    'Disfruta todos los beneficios y novedades.'
  ].join('\n');
  const messageEn = [
    '🎉 Welcome to PNPtv!',
    '',
    'To explore PNPtv, press /menu',
    '',
    'Enjoy all the benefits and updates.'
  ].join('\n');
  const lang = (bot.language || 'es').toLowerCase();
  const message = lang === 'en' ? messageEn : messageEs;
  try {
    await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error enviando bienvenida PNPtv:', error);
  }
};


/**
 * Main menu handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerMenuHandlers = (bot) => {
    // /menu command is handled by `src/bot/handlers/media/menu.js` to avoid conflicts (especially in groups)

    // /cristina command: starts AI support chat, message stays in chat (no autodelete)
    bot.command('cristina', async (ctx) => {
      try {
        // Activate AI chat session
        ctx.session.temp = ctx.session.temp || {};
        ctx.session.temp.aiChatActive = true;
        await ctx.saveSession();
        const lang = ctx.session?.language || 'en';
        await ctx.reply(
          lang === 'es'
            ? '🤖 Cristina está lista para ayudarte. Escribe tu pregunta o mensaje.'
            : '🤖 Cristina is ready to help you. Type your question or message.'
        );
      } catch (error) {
        logger.error('Error starting Cristina AI chat:', error);
      }
    });


  const PRIME_CHAT_ID = -1003291737499;

  // /menu command is now handled by media/menu.js - removed from here to avoid conflicts

  // Intercept main menu button actions in group and show redirect message
  const mainMenuActions = [
    'show_subscription_plans',
    'show_profile',
    'show_nearby',
    'show_support',
    'show_support',
    'show_settings',
    'admin_panel'
  ];
  mainMenuActions.forEach(action => {
    bot.action(action, async (ctx, next) => {
      const chatType = ctx.chat?.type;
      if (chatType === 'group' || chatType === 'supergroup') {
        try {
          const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'user';
          const botUsername = ctx.botInfo?.username || 'PNPtvbot';

          // Send notification in group
          const groupMsg = `${username} I sent you a private message please check it out! 💬`;
          const sentMessage = await ctx.reply(groupMsg);
          ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 30 * 1000, false);

          // Send private message with link to the feature
          try {
            const pmLink = `https://t.me/${botUsername}?start=${action}`;
            const pmMsg = `You clicked on a menu button in the group! Click the link below to access this feature:\n\n${pmLink}`;
            await ctx.telegram.sendMessage(ctx.from.id, pmMsg);
          } catch (pmError) {
            logger.debug('Could not send private message:', pmError.message);
          }

          return;
        } catch (error) {
          logger.error('Error handling group menu action:', error);
        }
      }
      return next();
    });
  });

  // Gate Live Streams when disabled (otherwise let the live handler handle it)
  bot.action('show_live', async (ctx, next) => {
    const lang = ctx.session?.language || 'en';
    if (config.ENABLE_LIVE_STREAMS === false) {
      await ctx.answerCbQuery(
        lang === 'es' ? '🚧 ESTRENO EL FIN DE SEMANA' : '🚧 COMING OUT THIS WEEKEND',
        { show_alert: true }
      );
      return;
    }
    return next();
  });

  // Note: hangouts_menu action is handled by hangoutsHandler.js
  // It checks for admin access and shows full menu for testing

  // Note: menu_videorama action is handled by videoramaHandler.js
  // It checks for admin access and shows full menu for testing
    // Locked feature handler for free users
    bot.action('locked_feature', async (ctx) => {
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        lang === 'es'
          ? '🔒 Función solo para usuarios premium. Suscríbete para acceder.'
          : '🔒 Feature for premium users only. Subscribe to unlock.',
        { show_alert: true }
      );
    });

    // PNP tv App (PRIME area) - regroup Hangouts + Videorama
    bot.action('menu_pnp_tv_app', async (ctx) => {
      try {
        const lang = ctx.session?.language || 'en';
        const message = lang === 'es'
          ? '📱 *PNP tv App*\n\nSelecciona una opción del área PRIME:'
          : '📱 *PNP tv App*\n\nChoose an option from the PRIME area:';

        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === 'es' ? '🎥 PNP Hangouts' : '🎥 PNP Hangouts', 'hangouts_menu'),
            Markup.button.callback(lang === 'es' ? '🎶 PNP Videorama' : '🎶 PNP Videorama', 'menu_videorama'),
          ],
          [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'back_to_main')],
        ]);

        await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard });
      } catch (error) {
        logger.error('Error handling menu_pnp_tv_app:', error);
      }
    });



    // Already PRIME handler
    bot.action('already_prime', async (ctx) => {
      await ctx.answerCbQuery('✅ You are already a PRIME member! Enjoy all features.', { show_alert: true });
    });

    // Members Area handler
    // Note: show_members_area handler is in /bot/handlers/media/membersArea.js

    // Legacy members videos handler (deprecated - use membersArea.js instead)
    bot.action('members_videos', async (ctx) => {
      await ctx.answerCbQuery('🎬 Videos section coming soon!', { show_alert: true });
    });

    // Admin panel handler: admins and superadmins can access role management
    bot.action('admin_panel', async (ctx) => {
      try {
        // PermissionService is required from roleManagement.js
        const PermissionService = require('../admin/../../services/permissionService');
        const showRoleManagement = require('../admin/roleManagement.js').showRoleManagement;
        const role = await PermissionService.getUserRole(ctx.from.id);
        if (!(role === 'superadmin' || role === 'admin')) {
          await ctx.answerCbQuery('❌ No autorizado');
          return;
        }
        await showRoleManagement(ctx);
      } catch (error) {
        logger.error('Error in admin panel:', error);
      }
    });

  // Back to main menu action
  bot.action('back_to_main', async (ctx) => {
    try {
      await showMainMenu(ctx);
    } catch (error) {
      logger.error('Error in back to main:', error);
    }
  });

  // Alternative back to main menu action
  bot.action('back_main', async (ctx) => {
    try {
      await showMainMenu(ctx);
    } catch (error) {
      logger.error('Error in back_main:', error);
    }
  });

  // Note: show_subscription_plans handler is in payments/index.js

  // Group menu: Contact Admin
  bot.action('group_contact_admin', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const botUsername = ctx.botInfo?.username || 'PNPtvbot';
      const pmLink = `https://t.me/${botUsername}?start=support`;

      const message = lang === 'es'
        ? `📞 Contacta al administrador\n\nHaz clic en el enlace para abrir un chat privado:\n${pmLink}`
        : `📞 Contact Admin\n\nClick the link to open a private chat:\n${pmLink}`;

      const sentMessage = await ctx.reply(message);
      ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 2 * 60 * 1000);

      logger.info('Admin contact link shown in group', { userId: ctx.from.id, chatId: ctx.chat.id });
    } catch (error) {
      logger.error('Error in group_contact_admin:', error);
      await ctx.answerCbQuery('Error showing contact options');
    }
  });

  // Group menu: Show Rules
  bot.action('group_show_rules', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const rulesMessage = lang === 'es'
        ? `📘 **Reglas de PNPtv:**\n\n• 🔞 Debes tener 18+ años\n• 🤝 Respeto entre miembros\n• 🚫 Sin spam\n• 🔗 Sin enlaces\n• ⚠️ 3 strikes = ban\n• 💬 Mantente en tema\n• 🤖 Sin bots`
        : `📘 **PNPtv Rules:**\n\n• 🔞 Must be 18+\n• 🤝 Respect all members\n• 🚫 No spam\n• 🔗 No links allowed\n• ⚠️ 3 strikes = ban\n• 💬 Stay on topic\n• 🤖 No bots`;

      const sentMessage = await ctx.reply(rulesMessage, { parse_mode: 'Markdown' });
      ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 2 * 60 * 1000);

      logger.info('Rules displayed in group', { userId: ctx.from.id, chatId: ctx.chat.id });
    } catch (error) {
      logger.error('Error in group_show_rules:', error);
      await ctx.answerCbQuery('Error showing rules');
    }
  });
};

/**
 * Get the effective view mode for admin preview
 * Admins get full access to all features (pre-launch testing)
 * @param {Context} ctx - Telegraf context
 * @returns {Object} { isPremium, isAdmin, viewMode }
 */
const getEffectiveViewMode = async (ctx) => {
  const userId = ctx.from?.id;

  // ALWAYS fetch fresh user data from database - don't rely on stale session data
  let user;
  try {
    user = await UserModel.getById(userId);
  } catch (error) {
    logger.warn('Error fetching user in getEffectiveViewMode:', error.message);
    user = ctx.session?.user || {};
  }

  // Check admin status using env vars (most reliable) or database role
  const actualIsAdmin = PermissionService.isEnvSuperAdmin(userId) ||
                        PermissionService.isEnvAdmin(userId) ||
                        user?.role === 'admin' ||
                        user?.role === 'superadmin';

  // Check PRIME status - admins get full access (pre-launch testing)
  const actualIsPremium = hasFullAccess(user, userId);

  // Check if admin has set a view mode
  const adminViewMode = ctx.session?.adminViewMode;

  if (actualIsAdmin && adminViewMode) {
    // Admin is previewing as a specific user type
    return {
      isPremium: adminViewMode === 'prime',
      isAdmin: true, // Keep admin access even when previewing
      viewMode: adminViewMode,
      isPreviewMode: true,
      actualIsAdmin: true
    };
  }

  return {
    isPremium: actualIsPremium,
    isAdmin: actualIsAdmin,
    viewMode: null,
    isPreviewMode: false,
    actualIsAdmin: actualIsAdmin
  };
};

/**
 * Show main menu (new message)
 * @param {Context} ctx - Telegraf context
 */
const showMainMenu = async (ctx) => {
  const lang = ctx.session?.language || 'en';
  const chatType = ctx.chat?.type;
  const userRecord = await fetchUserForMenu(ctx);
  const user = userRecord || ctx.session?.user || {};
  const username = ctx.from?.username || ctx.from?.first_name || 'Member';

  if (chatType === 'group' || chatType === 'supergroup') {
    await showGroupMenu(ctx);
    return;
  }

  if (!user?.onboardingComplete) {
    const botUsername = ctx.botInfo?.username || 'PNPtvbot';
    const { message, keyboard } = buildOnboardingPrompt(lang, botUsername);
    await ctx.reply(message, { ...keyboard });
    return;
  }

  // Get effective view mode (handles admin preview)
  const viewState = await getEffectiveViewMode(ctx);
  const { isPremium, isAdmin, isPreviewMode, viewMode, actualIsAdmin } = viewState;

  let menuText;
  let keyboard;

  // Add preview mode indicator for admins
  let previewBanner = '';
  if (isPreviewMode) {
    const modeLabel = viewMode === 'prime'
      ? (lang === 'es' ? '👁️ VISTA PRIME' : '👁️ PRIME VIEW')
      : (lang === 'es' ? '👁️ VISTA FREE' : '👁️ FREE VIEW');
    previewBanner = `\`${modeLabel}\`\n\n`;
  }

  // Build membership status header
  const membershipHeader = buildMembershipHeader(user, isPremium, lang);

  // Build keyboard buttons array
  let buttons = [];

  // Show PRIME menu only when user has premium access (isPremium handles admin preview mode)
  if (isPremium) {
    // PRIME MEMBER VERSION - BENEFITS FOCUSED
    menuText = previewBanner + membershipHeader + t(lang === 'es' ? 'pnpLatinoPrimeMenu' : 'pnpLatinoPrimeMenu', lang);
    buttons = buildPrimeMenuButtons(lang);
  } else {
    // FREE MEMBER VERSION - SALES FOCUSED
    menuText = previewBanner + membershipHeader + t('mainMenuIntroFree', lang, { username });

    const planButtons = await buildPlanButtons(lang);
    buttons = [
      ...planButtons,
      [
        Markup.button.callback(lang === 'es' ? '👤 Mi Perfil' : '👤 My Profile', 'show_profile'),
        Markup.button.callback(lang === 'es' ? '🆘 Ayuda y Soporte' : '🆘 Help & Support', 'show_support'),
      ],
    ];
  }

  // Add exit preview button if in preview mode
  if (isPreviewMode && actualIsAdmin) {
    buttons.push([
      Markup.button.callback(lang === 'es' ? '🔙 Salir Vista Previa' : '🔙 Exit Preview', 'admin_exit_preview'),
    ]);
  }

  keyboard = Markup.inlineKeyboard(buttons);

  try {
    await ctx.reply(sanitizeMarkdown(menuText), {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    // Fallback to plain text if Markdown parsing fails
    logger.warn('Markdown parsing failed in showMainMenu, falling back to plain text:', error.message);
    await ctx.reply(menuText.replace(/`/g, '').replace(/\*\*/g, ''), keyboard);
  }
};

/**
 * Show limited group menu (for privacy and anti-spam)
 * Redirects user to private chat for full menu
 * @param {Context} ctx - Telegraf context
 */
const showGroupMenu = async (ctx) => {
  const lang = ctx.session?.language || 'en';
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'friend';
  const botUsername = ctx.botInfo?.username || 'PNPtvbot';

  const message = lang === 'es'
    ? `👋 ¡Hola ${username}!\n\n` +
      `El menú completo está disponible en nuestro chat privado.\n\n` +
      `Presiona el botón para abrirlo 👇`
    : `👋 Hey ${username}!\n\n` +
      `The full menu is available in our private chat.\n\n` +
      `Tap the button to open it 👇`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(
      lang === 'es' ? '💬 Abrir Chat Privado' : '💬 Open Private Chat',
      `https://t.me/${botUsername}?start=menu`
    )]
  ]);

  try {
    await ctx.reply(message, keyboard);
    logger.info('Group menu redirect sent', { userId: ctx.from?.id, chatId: ctx.chat?.id });
  } catch (error) {
    logger.error('Error sending group menu redirect:', error);
  }
};

/**
 * Show main menu (edit existing message)
 * @param {Context} ctx - Telegraf context
 */
const showMainMenuEdit = async (ctx) => {
  const lang = ctx.session?.language || 'en';
  const userRecord = await fetchUserForMenu(ctx);
  const user = userRecord || ctx.session?.user || {};
  const username = ctx.from?.username || ctx.from?.first_name || 'Member';

  if (!user?.onboardingComplete) {
    const botUsername = ctx.botInfo?.username || 'PNPtvbot';
    const { message, keyboard } = buildOnboardingPrompt(lang, botUsername);
    await safeReplyOrEdit(ctx, message, { ...keyboard });
    return;
  }

  // Get effective view mode (handles admin preview)
  const viewState = await getEffectiveViewMode(ctx);
  const { isPremium, isAdmin, isPreviewMode, viewMode, actualIsAdmin } = viewState;

  let menuText;
  let buttons = [];

  // Add preview mode indicator for admins
  let previewBanner = '';
  if (isPreviewMode) {
    const modeLabel = viewMode === 'prime'
      ? (lang === 'es' ? '👁️ VISTA PRIME' : '👁️ PRIME VIEW')
      : (lang === 'es' ? '👁️ VISTA FREE' : '👁️ FREE VIEW');
    previewBanner = `\`${modeLabel}\`\n\n`;
  }

  // Build membership status header
  const membershipHeader = buildMembershipHeader(user, isPremium, lang);

  // Show PRIME menu only when user has premium access (isPremium handles admin preview mode)
  if (isPremium) {
    // PRIME MEMBER VERSION - BENEFITS FOCUSED
    menuText = previewBanner + membershipHeader + t(lang === 'es' ? 'pnpLatinoPrimeMenu' : 'pnpLatinoPrimeMenu', lang);
    buttons = buildPrimeMenuButtons(lang);
  } else {
    // FREE MEMBER VERSION - SALES FOCUSED
    menuText = previewBanner + membershipHeader + t('mainMenuIntroFree', lang, { username });

    const planButtons = await buildPlanButtons(lang);
    buttons = [
      ...planButtons,
      [
        Markup.button.callback(lang === 'es' ? '👤 Mi Perfil' : '👤 My Profile', 'show_profile'),
        Markup.button.callback(lang === 'es' ? '🆘 Ayuda y Soporte' : '🆘 Help & Support', 'show_support'),
      ],
    ];
  }

  // Add exit preview button if in preview mode
  if (isPreviewMode && actualIsAdmin) {
    buttons.push([
      Markup.button.callback(lang === 'es' ? '🔙 Salir Vista Previa' : '🔙 Exit Preview', 'admin_exit_preview'),
    ]);
  }

  const keyboard = Markup.inlineKeyboard(buttons);

  try {
    await ctx.editMessageText(sanitizeMarkdown(menuText), {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    // If edit fails due to Markdown, try plain text; otherwise send new message
    logger.warn('Error in showMainMenuEdit:', error.message);
    try {
      await ctx.editMessageText(menuText.replace(/`/g, '').replace(/\*\*/g, ''), keyboard);
    } catch {
      await showMainMenu(ctx);
    }
  }
};





/**
 * Send the PRIME main menu to a user by their Telegram ID (used after activation)
 * @param {object} telegram - ctx.telegram instance
 * @param {string|number} userId - Telegram user ID
 * @param {string} lang - Language code ('es' or 'en')
 */
const sendPrimeMenuToUser = async (telegram, userId, lang = 'es') => {
  try {
    const menuText = `💎 *${lang === 'es' ? 'Membresía' : 'Membership'}: PRIME* (Lifetime)\n\n` +
      t(lang === 'es' ? 'pnpLatinoPrimeMenu' : 'pnpLatinoPrimeMenu', lang);
    const buttons = buildPrimeMenuButtons(lang);
    const keyboard = Markup.inlineKeyboard(buttons);

    await telegram.sendMessage(userId, sanitizeMarkdown(menuText), {
      parse_mode: 'Markdown',
      ...keyboard,
    });
  } catch (error) {
    logger.warn('Could not send PRIME menu to user after activation', { userId, error: error.message });
  }
};

// Export as default function for consistency with other handlers
module.exports = registerMenuHandlers;
module.exports.showMainMenu = showMainMenu;
module.exports.buildOnboardingPrompt = buildOnboardingPrompt;
module.exports.sendPrimeWelcome = sendPrimeWelcome;
module.exports.sendPrimeMenuToUser = sendPrimeMenuToUser;