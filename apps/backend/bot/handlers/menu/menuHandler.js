/**
 * Menu Handler
 * Handles all menu display and navigation
 */

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const config = require('../../../config/config');
const {
  MENU_CONFIG,
  getMenuOptions,
  getOptionById,
  getOptionTitle,
  generateDeepLink,
  getMessage
} = require('../../../config/menuConfig');
const { detectLanguage } = require('../../../utils/languageDetector');
const { showProfile, showEditProfileMenu } = require('../user/profile');
const UserModel = require('../../../models/userModel');
const VideoCallModel = require('../../../models/videoCallModel');
const { isPrimeUser, hasFullAccess } = require('../../utils/helpers');
const UserService = require('../../../services/userService');
const { buildHangoutsWebAppUrl } = require('../../utils/hangoutsWebApp');

const HANGOUTS_WEB_APP_URL = process.env.HANGOUTS_WEB_APP_URL || 'https://pnptv.app/hangouts';
const PRIME_TV_LINK = 'https://t.me/+GDD0AAVbvGM3MGEx';
const PNPTV_APP_BASE = 'https://pnptv.app';

/**
 * Store the last menu message ID per user per chat
 * Format: { chatId: { userId: messageId } }
 */
const lastMenuMessages = {};

/**
 * Require ChatCleanupService for message deletion
 */
const ChatCleanupService = require('../../../services/chatCleanupService');

/**
 * Check if message is in a group/supergroup
 */
function isGroupChat(ctx) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

/**
 * Check if message is in topic 3809
 */
function isTopic3809(ctx) {
  return isGroupChat(ctx) &&
         ctx.message?.message_thread_id === MENU_CONFIG.TOPICS.CONTENT_MENU;
}

/**
 * Get user's language preference
 */
async function getUserLanguage(ctx) {
  // Try to detect from recent messages or user settings
  const detectedLang = await detectLanguage(ctx);
  return detectedLang || ctx.from?.language_code || 'en';
}

/**
 * Build PRIME member menu keyboard (subscription-aware)
 */
function buildPrimeMenuKeyboard(lang = 'en') {
  const labels = lang === 'es' ? {
    latinoTv: 'PNP Latino TV | Ver ahora',
    pnpLive: 'PNP Live | Hombres Latinos en Webcam',
    pnpApp: 'PNP tv App | Área PRIME',
    hangouts: '🎥 Hangouts',
    videorama: '🎶 Videorama',
    profile: '👤 Mi Perfil',
    support: '🆘 Ayuda y soporte',
  } : {
    latinoTv: 'PNP Latino TV | Watch now',
    pnpLive: 'PNP Live | Latino Men on Webcam',
    pnpApp: 'PNP tv App | PRIME area',
    hangouts: '🎥 Hangouts',
    videorama: '🎶 Videorama',
    profile: '👤 My Profile',
    support: '🆘 Help and support',
  };

  return Markup.inlineKeyboard([
    [Markup.button.url(labels.latinoTv, PRIME_TV_LINK)],
    [Markup.button.url(labels.pnpLive, `${PNPTV_APP_BASE}/live`)],
    [Markup.button.url(labels.pnpApp, `${PNPTV_APP_BASE}/login`)],
    [
      Markup.button.url(labels.hangouts, `${PNPTV_APP_BASE}/hangouts`),
      Markup.button.url(labels.videorama, `${PNPTV_APP_BASE}/videorama`),
    ],
    [
      Markup.button.callback(labels.profile, 'menu:profile'),
      Markup.button.callback(labels.support, 'menu:support'),
    ],
  ]);
}

/**
 * Build FREE user menu keyboard (sales-focused)
 */
function buildFreeMenuKeyboard(lang = 'en') {
  const labels = lang === 'es' ? {
    profile: '👤 Mi Perfil',
    subscribe: '💎 Suscribirse a PRIME',
    nearby: '📍 PNP Connect',
    hangouts: '🎥 Hangouts',
    videorama: '🎶 Videorama',
    live: '📺 En Vivo',
    login: '🔐 Iniciar sesión',
    support: '🆘 Ayuda y soporte',
    settings: '⚙️ Configuración',
  } : {
    profile: '👤 My Profile',
    subscribe: '💎 Subscribe to PRIME',
    nearby: '📍 PNP Connect',
    hangouts: '🎥 Hangouts',
    videorama: '🎶 Videorama',
    live: '📺 Live',
    login: '🔐 Login',
    support: '🆘 Help and support',
    settings: '⚙️ Settings',
  };

  return Markup.inlineKeyboard([
    [Markup.button.callback(labels.subscribe, 'menu:subscribe')],
    [Markup.button.callback(labels.nearby, 'menu:nearby')],
    [
      Markup.button.url(labels.hangouts, `${PNPTV_APP_BASE}/hangouts`),
      Markup.button.url(labels.videorama, `${PNPTV_APP_BASE}/videorama`),
    ],
    [
      Markup.button.url(labels.live, `${PNPTV_APP_BASE}/live`),
      Markup.button.url(labels.login, `${PNPTV_APP_BASE}/login`),
    ],
    [
      Markup.button.callback(labels.profile, 'menu:profile'),
      Markup.button.callback(labels.support, 'menu:support'),
    ],
    [Markup.button.callback(labels.settings, 'menu:settings')],
  ]);
}

/**
 * Build main menu keyboard based on subscription status
 */
function buildMainMenuKeyboard(lang = 'en', isPrime = false) {
  if (isPrime) {
    return buildPrimeMenuKeyboard(lang);
  }
  return buildFreeMenuKeyboard(lang);
}

/**
 * Build group menu keyboard (simple vertical layout)
 */
function buildGroupMenuKeyboard(lang = 'en') {
  const buttons = MENU_CONFIG.GROUP_MENU.options.map(option =>
    [Markup.button.callback(
      option.title[lang] || option.title.en,
      option.callback
    )]
  );

  return Markup.inlineKeyboard(buttons);
}

/**
 * Build PRIME members menu keyboard (2-column layout for /start)
 * This is the main PRIME menu used for the /start command
 */
function buildPrimeStartMenuKeyboard(lang = 'en') {
  const buttons = [];

  // Add PRIME menu options (already organized in 2-column rows)
  for (const row of MENU_CONFIG.PRIME_MENU.options) {
    if (Array.isArray(row)) {
      // Row is already a group of options
      buttons.push(
        row.map(option =>
          Markup.button.callback(
            option.title[lang] || option.title.en,
            option.callback
          )
        )
      );
    } else {
      // Single option
      buttons.push([
        Markup.button.callback(
          row.title[lang] || row.title.en,
          row.callback
        )
      ]);
    }
  }

  return Markup.inlineKeyboard(buttons);
}

/**
 * Build topic 3809 menu keyboard
 */
function buildTopic3809MenuKeyboard(lang = 'en') {
  const buttons = MENU_CONFIG.TOPIC_3809_MENU.options.map(option =>
    Markup.button.callback(
      option.title[lang] || option.title.en,
      option.callback
    )
  );

  return Markup.inlineKeyboard([buttons]);
}

/**
 * Build category menu keyboard (shows options within a category)
 */
function buildCategoryMenuKeyboard(categoryId, lang = 'en') {
  const category = MENU_CONFIG.MAIN_CATEGORIES[categoryId.toUpperCase()];
  if (!category) return null;

  const buttons = category.options.map(option =>
    [Markup.button.callback(
      option.title[lang] || option.title.en,
      option.callback
    )]
  );

  // Add back button
  buttons.push([
    Markup.button.callback(
      lang === 'es' ? '⬅️ Volver al Menú' : '⬅️ Back to Menu',
      'menu:back'
    )
  ]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Helper function to delete previous menu message and track the new one
 * Ensures only ONE menu message per user remains (anti-spam)
 */
async function deletePreviousMenuMessage(ctx) {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    // Initialize chat storage if needed
    if (!lastMenuMessages[chatId]) {
      lastMenuMessages[chatId] = {};
    }

    // Delete previous menu message if it exists
    if (lastMenuMessages[chatId][userId]) {
      try {
        await ctx.telegram.deleteMessage(chatId, lastMenuMessages[chatId][userId]);
        logger.info(`Deleted previous menu message (anti-spam) - ${lastMenuMessages[chatId][userId]} for user ${userId} in chat ${chatId}`);
      } catch (error) {
        // Message may have already been deleted, ignore
        logger.debug(`Could not delete previous menu message: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error('Error deleting previous menu message:', error);
  }
}

/**
 * Helper function to store new menu message ID
 */
function storeMenuMessage(ctx, messageId) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;

  if (!lastMenuMessages[chatId]) {
    lastMenuMessages[chatId] = {};
  }

  lastMenuMessages[chatId][userId] = messageId;
}

/**
 * Handle /menu command
 */
async function handleMenuCommand(ctx) {
  try {
    const lang = await getUserLanguage(ctx);
    const username = ctx.from.username || ctx.from.first_name || 'User';

    // Check if in topic 3809
    if (isTopic3809(ctx)) {
      // Display special menu for topic 3809
      const message = getMessage('TOPIC_3809_MENU', lang);
      const keyboard = buildTopic3809MenuKeyboard(lang);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...keyboard
      });

      logger.info(`Topic 3809 menu displayed for user ${ctx.from.id}`);
      return;
    }

    // Check if in group (but not topic 3809)
    if (isGroupChat(ctx)) {
      // Delete previous menu message
      await deletePreviousMenuMessage(ctx);

      // Display group-specific menu in the group
      const groupMenuMessage = lang === 'es'
        ? '🎯 *PNPtv Menu*\n\nSelecciona una opción:'
        : '🎯 *PNPtv Menu*\n\nSelect an option:';

      const groupMenuKeyboard = buildGroupMenuKeyboard(lang);

      const sentMessage = await ctx.reply(groupMenuMessage, {
        parse_mode: 'Markdown',
        ...groupMenuKeyboard
      });

      // Store the menu message ID to delete it later
      storeMenuMessage(ctx, sentMessage.message_id);

      // Schedule auto-delete for menu message (1 minute)
      ChatCleanupService.scheduleMenuMessage(ctx.telegram, sentMessage);

      // Also delete the /menu command message from user
      try {
        await ctx.deleteMessage();
      } catch (error) {
        // Ignore if we can't delete the command message
      }

      logger.info(`Group menu displayed for user ${ctx.from.id} in group ${ctx.chat.id}`);

      return;
    }

    // Private chat - display subscription-aware menu
    // Fetch user data to determine subscription status
    const user = await UserModel.getById(ctx.from.id);
    const userIsPrime = isPrimeUser(user);

    // Different message for PRIME vs FREE users
    const message = userIsPrime
      ? (lang === 'es'
        ? '💎 *¡Hola, miembro PRIME!*\n\nSelecciona una opción del menú:'
        : '💎 *Hello, PRIME member!*\n\nSelect an option from the menu:')
      : getMessage('MAIN_MENU', lang);

    const keyboard = buildMainMenuKeyboard(lang, userIsPrime);

    // Delete previous menu message first (single message rule)
    await deletePreviousMenuMessage(ctx);

    const sentMessage = await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });

    // Store the new menu message ID
    storeMenuMessage(ctx, sentMessage.message_id);

    // Schedule auto-delete for menu message (1 minute)
    ChatCleanupService.scheduleMenuMessage(ctx.telegram, sentMessage);

    logger.info(`Main menu displayed for user ${ctx.from.id} in private chat (isPrime: ${userIsPrime})`);

  } catch (error) {
    logger.error('Error handling menu command:', error);
    const lang = await getUserLanguage(ctx);
    await ctx.reply(
      lang === 'es'
        ? '❌ Error al mostrar el menú. Por favor, intenta de nuevo.'
        : '❌ Error displaying menu. Please try again.'
    );
  }
}

/**
 * Handle deep link start parameters
 */
async function handleDeepLinkStart(ctx) {
  try {
    const rawText = ctx.message?.text || '';
    const parsedPayload = rawText.split(' ')[1];
    const startPayload = ctx.startPayload || parsedPayload;

    if (!startPayload) {
      // No deep link, show regular menu
      return handleMenuCommand(ctx);
    }

    const lang = await getUserLanguage(ctx);

    // Handle call deeplinks (room invites)
    if (startPayload.startsWith('call_')) {
      const callId = startPayload.replace('call_', '');
      await handleDeepLinkCallJoin(ctx, lang, callId);
      return;
    }

    // Handle main room deeplink
    if (startPayload === 'hangouts_join_main') {
      await handleDeepLinkMainRoom(ctx, lang);
      return;
    }

    // Handle web login deep links
    if (startPayload.startsWith('weblogin_')) {
      const token = startPayload.replace('weblogin_', '');
      const { telegramConfirmLogin } = require('../../api/controllers/webAppController');
      const success = await telegramConfirmLogin(
        {
          id: ctx.from.id,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
          username: ctx.from.username,
        },
        token
      );
      if (success) {
        await ctx.reply('✅ ¡Login exitoso! Ya puedes volver al navegador.\n\n✅ Login successful! You can go back to your browser.');
      } else {
        await ctx.reply('❌ El enlace de login ha expirado. Intenta de nuevo desde la web.\n\n❌ Login link expired. Try again from the website.');
      }
      return;
    }

    // Handle promo deep links
    if (startPayload.startsWith('promo_')) {
      const { handlePromoDeepLink } = require('../promo/promoHandler');
      const promoCode = startPayload.replace('promo_', '');
      return await handlePromoDeepLink(ctx, promoCode);
    }

    // Handle specific broadcast/share post deep links
    // These take users directly to specific bot features
    switch (startPayload) {
      case 'home':
      case 'menu':
      case 'from_group':
      case 'onboarding':
      case '1': // Legacy support for ?start=1
        return handleMenuCommand(ctx);

      case 'plans':
      case 'show_subscription_plans':
        // Show subscription plans screen (using reply since we're in /start context)
        await handleDeepLinkPlans(ctx, lang);
        return;

      case 'nearby':
      case 'show_nearby':
        // Show nearby users screen (using reply since we're in /start context)
        await handleDeepLinkNearby(ctx, lang);
        return;

      case 'profile':
        // Show user profile
        await handleProfile(ctx, lang);
        return;
      case 'edit_profile':
        // Show edit profile menu
        await handleEditProfile(ctx, lang);
        return;

      case 'cristina':
        // Show Cristina AI assistant (using reply since we're in /start context)
        await handleDeepLinkCristina(ctx, lang);
        return;

      case 'content':
        // Show exclusive content screen (using reply since we're in /start context)
        await handleDeepLinkContent(ctx, lang);
        return;

      case 'hangouts':
        // Show hangouts/video rooms screen (using reply since we're in /start context)
        await handleDeepLinkHangouts(ctx, lang);
        return;

      case 'pnp_live':
      case 'show_live':
        // Show PNP Live screen (using reply since we're in /start context)
        await handleDeepLinkPNPLive(ctx, lang);
        return;

      case 'support':
      case 'show_support':
        // Show support screen
        await handleDeepLinkSupport(ctx, lang);
        return;


    }

    // Check if it's a menu deep link
    if (startPayload.startsWith('menu_')) {
      const optionId = startPayload.replace('menu_', '');

      // Get the option
      const option = getOptionById(optionId);
      if (!option) {
        return handleMenuCommand(ctx);
      }

      // Send the option-specific menu
      const message = getMessage('DM_MESSAGE', lang, {
        option: option.title[lang] || option.title.en
      });

      await ctx.reply(message, {
        parse_mode: 'Markdown'
      });

      // Trigger the menu callback
      ctx.callbackQuery = { data: option.callback };
      return handleMenuCallback(ctx);
    }

    // Not a menu deep link, proceed with default behavior
    return handleMenuCommand(ctx);

  } catch (error) {
    logger.error('Error handling deep link start:', error);
    return handleMenuCommand(ctx);
  }
}

/**
 * Handle deep link to plans screen (uses ctx.reply instead of editMessageText)
 */
async function handleDeepLinkPlans(ctx, lang) {
  // Check if user is already PRIME
  const user = await UserModel.getById(ctx.from.id);
  const userIsPrime = isPrimeUser(user);

  if (userIsPrime) {
    // User is already PRIME - show membership status
    const expiryText = user.planExpiry
      ? new Date(user.planExpiry).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : (lang === 'es' ? 'Sin vencimiento' : 'No expiration');

    const message = lang === 'es'
      ? `💎 *¡Ya eres miembro PRIME!*\n\n` +
        `✅ Estado: Activo\n` +
        `📅 Expira: ${expiryText}\n` +
        `📦 Plan: ${user.planId || 'PRIME'}\n\n` +
        `🎉 Disfruta de todos los beneficios exclusivos de tu membresía.`
      : `💎 *You're already a PRIME member!*\n\n` +
        `✅ Status: Active\n` +
        `📅 Expires: ${expiryText}\n` +
        `📦 Plan: ${user.planId || 'PRIME'}\n\n` +
        `🎉 Enjoy all the exclusive benefits of your membership.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')]
    ]);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    return;
  }

  // User is FREE - show subscription options
  const message = lang === 'es'
    ? '✨ *Suscripción PRIME*\n\n' +
      '💎 Con PRIME obtienes acceso a:\n\n' +
      '• 📹 Salas de video exclusivas\n' +
      '• 🔴 Transmisiones en vivo premium\n' +
      '• 📍 Usuarios cercanos sin límites\n' +
      '• 💬 Canal PRIME exclusivo\n\n' +
      '¡Únete ahora y disfruta de todos los beneficios!'
    : '✨ *PRIME Subscription*\n\n' +
      '💎 With PRIME you get access to:\n\n' +
      '• 📹 Exclusive video rooms\n' +
      '• 🔴 Premium live streams\n' +
      '• 📍 Unlimited nearby users\n' +
      '• 💬 Exclusive PRIME channel\n\n' +
      'Join now and enjoy all the benefits!';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '💳 Ver Planes' : '💳 View Plans', 'show_subscription_plans')],
    [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')]
  ]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

/**
 * Handle deep link to nearby screen (uses ctx.reply instead of editMessageText)
 */
async function handleDeepLinkNearby(ctx, lang) {
  try {
    const user = await UserService.getOrCreateFromContext(ctx);
    const locationSharing = user.locationSharingEnabled !== false;
    const locationStatus = locationSharing
      ? (lang === 'es' ? 'ON ✅' : 'ON ✅')
      : (lang === 'es' ? 'OFF ❌' : 'OFF ❌');

    const message = lang === 'es'
      ? '📍 *Usuarios Cercanos*\n\n' +
        '¡Encuentra usuarios cerca de ti!\n\n' +
        '👇 Selecciona un radio de búsqueda:'
      : '📍 *Nearby Users*\n\n' +
        'Find users near you!\n\n' +
        '👇 Select a search radius:';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📍 5 km', 'nearby_radius_5'),
        Markup.button.callback('📍 10 km', 'nearby_radius_10'),
      ],
      [
        Markup.button.callback('📍 25 km', 'nearby_radius_25'),
        Markup.button.callback('📍 50 km', 'nearby_radius_50'),
      ],
      [Markup.button.callback(`📍 Location: ${locationStatus}`, 'toggle_location_sharing')],
      [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')],
    ]);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    logger.error('Error handling deep link nearby:', error);
    await ctx.reply(
      getMessage('ERROR_GENERIC', lang),
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle deep link to Cristina AI (uses ctx.reply instead of editMessageText)
 */
async function handleDeepLinkCristina(ctx, lang) {
  const message = lang === 'es'
    ? '🤖 *Asistente IA Cristina*\n\nHola! Soy Cristina, tu asistente de IA.\n\nMe identifico como mujer latina afro trans y lesbiana, en honor a las heroínas de Stonewall y a las mujeres que cuidaron de nuestra comunidad durante la crisis del sida. Estoy aquí para acompañarte sin juicio, con calma y apoyo.\n\nSoy tu amiga, no una profesional de la salud; busca ayuda médica cuando sea necesario.\n\nUsa el comando /cristina para hablar conmigo en cualquier momento.'
    : '🤖 *Cristina AI Assistant*\n\nHi! I\'m Cristina, your AI assistant.\n\nI identify as an Afro-Latina trans woman and a lesbian, honoring Stonewall heroines and the women who cared for our community during the AIDS crisis. I\'m here to support you calmly and without judgment.\n\nI\'m your friend, not a health professional; seek medical help when needed.\n\nUse the /cristina command to talk to me anytime.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '💬 Hablar con Cristina' : '💬 Chat with Cristina', 'support_ai_chat')],
    [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')]
  ]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

/**
 * Handle deep link to exclusive content (uses ctx.reply instead of editMessageText)
 */
async function handleDeepLinkContent(ctx, lang) {
  const message = lang === 'es'
    ? '🎬 *Contenido Exclusivo*\n\n' +
      'Accede a nuestra biblioteca de videos exclusivos:\n\n' +
      '📹 Videos completos de Santino, Lex y el equipo\n' +
      '🔥 Contenido detrás de cámaras\n' +
      '🎭 Presentaciones especiales\n' +
      '📺 ¡Contenido nuevo cada semana!\n\n' +
      '💎 *Solo para miembros PRIME*'
    : '🎬 *Exclusive Content*\n\n' +
      'Access our exclusive video library:\n\n' +
      '📹 Full-length videos from Santino, Lex & crew\n' +
      '🔥 Behind-the-scenes content\n' +
      '🎭 Special performances\n' +
      '📺 New content added weekly!\n\n' +
      '💎 *PRIME members only*';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '🎬 Ver Contenido' : '🎬 View Content', 'menu_content')],
    [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')]
  ]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

/**
 * Handle deep link to hangouts/video rooms (uses ctx.reply instead of editMessageText)
 */
async function handleDeepLinkHangouts(ctx, lang) {
  const lobbyUrl = buildHangoutsWebAppUrl({ baseUrl: HANGOUTS_WEB_APP_URL });

  const message = lang === 'es'
    ? '🎥 *PNPtv Video Hangouts*\n\n' +
      '¡Conecta cara a cara con la comunidad!\n\n' +
      '✨ Salas seguras y privadas\n' +
      '🔐 Infraestructura dedicada\n' +
      '📹 Grabación de pantalla deshabilitada\n' +
      '✅ Usuarios verificados por edad\n' +
      '👥 Videollamadas de grupo en vivo\n\n' +
      '💡 Puedes unirte con la cámara apagada'
    : '🎥 *PNPtv Video Hangouts*\n\n' +
      'Connect face-to-face with the community!\n\n' +
      '✨ Safe and private rooms\n' +
      '🔐 Dedicated infrastructure\n' +
      '📹 Screen recording disabled\n' +
      '✅ Age-verified users\n' +
      '👥 Live group video calls\n\n' +
      '💡 You can join with camera off';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(lang === 'es' ? '🎥 Abrir Hangouts' : '🎥 Open Hangouts', lobbyUrl)],
    [Markup.button.callback(lang === 'es' ? '🎥 Ver Todas las Salas' : '🎥 View All Rooms', 'menu_hangouts')],
    [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')]
  ]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

/**
 * Handle deep link to join a video call via /start call_<id>
 */
async function handleDeepLinkCallJoin(ctx, lang, callId) {
  const displayName = ctx.from.first_name || ctx.from.username || 'User';

  try {
    const joinResult = await VideoCallModel.joinCall(
      callId,
      ctx.from.id,
      displayName,
      false
    );

    const call = joinResult.call;
    const participantCount = call.currentParticipants + (joinResult.alreadyJoined ? 0 : 1);
    const webAppUrl = buildHangoutsWebAppUrl({
      baseUrl: HANGOUTS_WEB_APP_URL,
      room: call.channelName,
      token: joinResult.rtcToken,
      uid: ctx.from.id,
      username: displayName,
      type: call.isPublic ? 'public' : 'private',
      appId: joinResult.appId,
      callId: call.id,
    });

    const message = lang === 'es'
      ? `📞 *Unirse a Videollamada*\n\n` +
        `Creada por: ${call.creatorName}\n` +
        `👥 ${participantCount}/${call.maxParticipants} participantes\n\n` +
        `Presiona el botón para entrar:`
      : `📞 *Join Video Call*\n\n` +
        `Created by: ${call.creatorName}\n` +
        `👥 ${participantCount}/${call.maxParticipants} participants\n\n` +
        `Tap the button to join:`;

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp(lang === 'es' ? '🚀 Entrar a Llamada' : '🚀 Join Call', webAppUrl)],
      ]),
    });
  } catch (error) {
    logger.error('Error joining call via deeplink:', error);
    await ctx.reply(
      lang === 'es' ? '❌ Error al unirse a la llamada.' : '❌ Error joining the call.'
    );
  }
}

/**
 * Handle deep link to join hangouts (formerly main room deeplink)
 */
async function handleDeepLinkMainRoom(ctx, lang) {
  const message = lang === 'es'
    ? '🎥 *PNP Hangouts*\n\nÚnete a los grupos de Hangout en la aplicación web.'
    : '🎥 *PNP Hangouts*\n\nJoin Hangout groups in the web app.';

  const webAppUrl = buildHangoutsWebAppUrl({
    baseUrl: HANGOUTS_WEB_APP_URL,
  });

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.webApp(lang === 'es' ? '🚀 Abrir Hangouts' : '🚀 Open Hangouts', webAppUrl)],
    ]),
  });
}

/**
 * Handle deep link to PNP Live (uses ctx.reply instead of editMessageText)
 */
async function handleDeepLinkPNPLive(ctx, lang) {
  const message = lang === 'es'
    ? '📺 *PNP Television Live*\n\n' +
      '¡Sintoniza nuestras transmisiones en vivo!\n\n' +
      '🔴 Transmisiones en vivo exclusivas\n' +
      '🎭 Shows de la comunidad\n' +
      '📹 Contenido premium en directo\n\n' +
      '💎 *Disponible para miembros PRIME*'
    : '📺 *PNP Television Live*\n\n' +
      'Tune in to our live broadcasts!\n\n' +
      '🔴 Exclusive live streams\n' +
      '🎭 Community shows\n' +
      '📹 Premium live content\n\n' +
      '💎 *Available for PRIME members*';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '📺 Ver PNP Live' : '📺 Watch PNP Live', 'PNP_LIVE_START')],
    [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')]
  ]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

/**
 * Handle deep link to support (uses ctx.reply instead of editMessageText)
 */
async function handleDeepLinkSupport(ctx, lang) {
  const supportText = lang === 'es'
    ? '`🆘 Centro de Ayuda`\n\n' +
      '¿Necesitas ayuda? ¡Te tenemos! 💜\n\n' +
      '**Cristina** es nuestra asistente IA —\n' +
      'puede responder preguntas sobre:\n' +
      '• Funciones de la plataforma\n' +
      '• Reducción de daños y uso seguro\n' +
      '• Salud sexual y mental\n' +
      '• Recursos comunitarios\n\n' +
      '_O contacta a Santino directamente para\n' +
      'problemas de cuenta y facturación._'
    : '`🆘 Help Center`\n\n' +
      'Need help? We got you! 💜\n\n' +
      '**Cristina** is our AI assistant —\n' +
      'she can answer questions about:\n' +
      '• Platform features\n' +
      '• Harm reduction & safer use\n' +
      '• Sexual & mental health\n' +
      '• Community resources\n\n' +
      '_Or contact Santino directly for\n' +
      'account issues & billing._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '🤖 Hablar con Cristina' : '🤖 Chat with Cristina', 'support_ai_chat')],
    [Markup.button.callback(lang === 'es' ? '📞 Contactar Soporte al Cliente' : '📞 Contact Customer Support', 'support_contact_admin')],
    [Markup.button.callback(lang === 'es' ? '🎁 Activar Código Meru' : '🎁 Redeem Meru Code', 'support_request_activation')],
    [Markup.button.callback(lang === 'es' ? '🔑 Recuperar mi Código' : '🔑 Recover my Code', 'support_recover_meru_code')],
    [Markup.button.callback(lang === 'es' ? '❓ FAQ' : '❓ FAQ', 'support_faq')],
    [Markup.button.callback(lang === 'es' ? '🏠 Menú Principal' : '🏠 Main Menu', 'menu:back')],
  ]);

  await ctx.reply(supportText, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}



/**
 * Handle menu option callbacks
 */
async function handleMenuCallback(ctx) {
  try {
    const callbackData = ctx.callbackQuery?.data || '';
    logger.info(`>>> handleMenuCallback called with data: ${callbackData}`);
    const lang = await getUserLanguage(ctx);

    // Acknowledge the callback
    await ctx.answerCbQuery();

    // Parse callback data
    const [prefix, action] = callbackData.split(':');
    logger.info(`>>> Menu callback parsed: prefix=${prefix}, action=${action}`);

    if (prefix !== 'menu') {
      return;
    }

    // Handle back button
    if (action === 'back') {
      // Fetch user data to determine subscription status
      const user = await UserModel.getById(ctx.from.id);
      const userIsPrime = isPrimeUser(user);

      const message = userIsPrime
        ? (lang === 'es'
          ? '💎 *¡Hola, miembro PRIME!*\n\nSelecciona una opción del menú:'
          : '💎 *Hello, PRIME member!*\n\nSelect an option from the menu:')
        : getMessage('MAIN_MENU', lang);

      const keyboard = buildMainMenuKeyboard(lang, userIsPrime);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard
      });
      return;
    }

    // Handle specific menu options
    switch (action) {
      case 'subscribe':
        await handleSubscribeMenu(ctx, lang);
        break;

      case 'prime_content':
        await handlePrimeContent(ctx, lang);
        break;

      case 'subscription_status':
        await handleSubscriptionStatus(ctx, lang);
        break;

      case 'renew':
        await handleRenewMenu(ctx, lang);
        break;

      case 'payment_methods':
        await handlePaymentMethods(ctx, lang);
        break;

      case 'live_streams':
        await handleLiveStreams(ctx, lang);
        break;

      case 'video_calls':
        await handleVideoCalls(ctx, lang);
        break;

      case 'photos':
        await handlePhotos(ctx, lang);
        break;

      case 'videos':
        await handleVideos(ctx, lang);
        break;

      case 'podcasts':
        await handlePodcasts(ctx, lang);
        break;

      case 'join_group':
        await handleJoinGroup(ctx, lang);
        break;

      case 'events':
        await handleEvents(ctx, lang);
        break;

      case 'faq':
        await handleFAQ(ctx, lang);
        break;

      case 'support':
        await handleSupport(ctx, lang);
        break;

      case 'cristina_ai':
        await handleCristinaAI(ctx, lang);
        break;

      case 'rules':
        await handleRules(ctx, lang);
        break;

      case 'how_to_use':
        await handleHowToUse(ctx, lang);
        break;

      case 'profile':
        logger.info(`>>> Calling handleProfile for user ${ctx.from.id}`);
        await handleProfile(ctx, lang);
        break;

      case 'notifications':
        await handleNotificationSettings(ctx, lang);
        break;

      case 'language':
        await handleLanguageSettings(ctx, lang);
        break;

      case 'privacy':
        await handlePrivacySettings(ctx, lang);
        break;

      case 'view_plans':
        await handleSubscribeMenu(ctx, lang);
        break;

      case 'vc_rooms':
        await handleVCRooms(ctx, lang);
        break;

      case 'settings':
        await handleSettingsMenu(ctx, lang);
        break;

      case 'nearby':
        // Show unified nearby menu instead of old radius-based UI
        const showNearbyMenu = async (ctx, isNewMessage = false) => {
          try {
            const lang = getLanguage(ctx);
            const user = await UserService.getOrCreateFromContext(ctx);
            const locationStatus = user.locationSharingEnabled ? '🟢 ON' : '🔴 OFF';

            const headerText = lang === 'es'
              ? '`🔥 PNP Connect`\n\n' +
                'Explora todo lo que está cerca de ti:\n' +
                '👥 Miembros\n' +
                '🏪 Negocios\n' +
                '📍 Lugares de interés\n\n' +
                '_Selecciona una categoría o ve todo:_'
              : '`🔥 PNP Connect`\n\n' +
                'Explore everything near you:\n' +
                '👥 Members\n' +
                '🏪 Businesses\n' +
                '📍 Places of interest\n\n' +
                '_Select a category or see all:_';

            const keyboard = Markup.inlineKeyboard([
              [
                Markup.button.callback(lang === 'es' ? '🌐 Todo' : '🌐 All', 'nearby_all'),
                Markup.button.callback(lang === 'es' ? '👥 Miembros' : '👥 Members', 'nearby_users'),
              ],
              [
                Markup.button.callback(lang === 'es' ? '🏪 Negocios' : '🏪 Businesses', 'nearby_businesses'),
                Markup.button.callback(lang === 'es' ? '📍 Lugares' : '📍 Places', 'nearby_places_categories'),
              ],
              [Markup.button.callback(`📍 Location: ${locationStatus}`, 'toggle_location_sharing')],
              [
                Markup.button.callback(lang === 'es' ? '➕ Proponer' : '➕ Suggest', 'submit_place_start'),
                Markup.button.callback(lang === 'es' ? '📋 Mis Propuestas' : '📋 My Submissions', 'my_place_submissions'),
              ],
              [Markup.button.callback('🔙 Back', 'back_to_main')],
            ]);

            await ctx.editMessageText(headerText, { parse_mode: 'Markdown', ...keyboard });
          } catch (error) {
            logger.error('Error showing nearby menu:', error);
          }
        };
        
        await showNearbyMenu(ctx);
        break;

      default:
        // Coming soon for unimplemented features
        await ctx.editMessageText(
          getMessage('FEATURE_COMING_SOON', lang),
          { parse_mode: 'Markdown' }
        );
    }

    logger.info(`Menu callback handled: ${action} for user ${ctx.from.id}`);

  } catch (error) {
    logger.error('Error handling menu callback:', error);
    try {
      await ctx.answerCbQuery('Error processing request');
    } catch (e) {
      // Ignore
    }
  }
}

// ==========================================
// Menu Option Handlers (Placeholder implementations)
// ==========================================

async function handleSubscribeMenu(ctx, lang) {
  // Check if user is already PRIME
  const user = await UserModel.getById(ctx.from.id);
  const userIsPrime = isPrimeUser(user);

  if (userIsPrime) {
    // User is already PRIME - show membership status
    const expiryText = user.planExpiry
      ? new Date(user.planExpiry).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : (lang === 'es' ? 'Sin vencimiento' : 'No expiration');

    const message = lang === 'es'
      ? `💎 *¡Ya eres miembro PRIME!*\n\n` +
        `✅ Estado: Activo\n` +
        `📅 Expira: ${expiryText}\n` +
        `📦 Plan: ${user.planId || 'PRIME'}\n\n` +
        `🎉 Disfruta de todos los beneficios exclusivos de tu membresía.`
      : `💎 *You're already a PRIME member!*\n\n` +
        `✅ Status: Active\n` +
        `📅 Expires: ${expiryText}\n` +
        `📦 Plan: ${user.planId || 'PRIME'}\n\n` +
        `🎉 Enjoy all the exclusive benefits of your membership.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
    ]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    return;
  }

  // User is FREE - show subscription options
  const message = lang === 'es'
    ? '✨ *Suscripción PRIME*\n\n' +
      '💎 Con PRIME obtienes acceso a:\n\n' +
      '• 📹 Salas de video exclusivas\n' +
      '• 🔴 Transmisiones en vivo premium\n' +
      '• 📍 Usuarios cercanos sin límites\n' +
      '• 💬 Canal PRIME exclusivo\n\n' +
      '¡Únete ahora y disfruta de todos los beneficios!'
    : '✨ *PRIME Subscription*\n\n' +
      '💎 With PRIME you get access to:\n\n' +
      '• 📹 Exclusive video rooms\n' +
      '• 🔴 Premium live streams\n' +
      '• 📍 Unlimited nearby users\n' +
      '• 💬 Exclusive PRIME channel\n\n' +
      'Join now and enjoy all the benefits!';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '💳 Ver Planes' : '💳 View Plans', 'menu:view_plans')],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handlePrimeContent(ctx, lang) {
  const message = lang === 'es'
    ? '💎 *Contenido PRIME*\n\nAccede a todo nuestro contenido exclusivo de PRIME.\n\n_Esta función estará disponible pronto._'
    : '💎 *PRIME Content*\n\nAccess all our exclusive PRIME content.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleSubscriptionStatus(ctx, lang) {
  // Fetch fresh user data
  const user = await UserModel.getById(ctx.from.id);
  const userIsPrime = isPrimeUser(user);

  let message;

  if (userIsPrime) {
    const expiryText = user.planExpiry
      ? new Date(user.planExpiry).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : (lang === 'es' ? 'Sin vencimiento (Lifetime)' : 'No expiration (Lifetime)');

    message = lang === 'es'
      ? `💎 *Mi Membresía PRIME*\n\n` +
        `✅ *Estado:* Activo\n` +
        `📦 *Plan:* ${user.planId || 'PRIME'}\n` +
        `📅 *Expira:* ${expiryText}\n` +
        `🏷️ *Tier:* ${user.tier || 'Prime'}\n\n` +
        `🎉 ¡Disfruta de todos los beneficios exclusivos!`
      : `💎 *My PRIME Membership*\n\n` +
        `✅ *Status:* Active\n` +
        `📦 *Plan:* ${user.planId || 'PRIME'}\n` +
        `📅 *Expires:* ${expiryText}\n` +
        `🏷️ *Tier:* ${user.tier || 'Prime'}\n\n` +
        `🎉 Enjoy all the exclusive benefits!`;
  } else {
    message = lang === 'es'
      ? `📊 *Estado de Suscripción*\n\n` +
        `❌ *Estado:* Sin membresía PRIME\n` +
        `🏷️ *Tier:* ${user?.tier || 'Free'}\n\n` +
        `💎 Suscríbete a PRIME para acceder a todos los beneficios exclusivos.`
      : `📊 *Subscription Status*\n\n` +
        `❌ *Status:* No PRIME membership\n` +
        `🏷️ *Tier:* ${user?.tier || 'Free'}\n\n` +
        `💎 Subscribe to PRIME to access all exclusive benefits.`;
  }

  const keyboard = Markup.inlineKeyboard([
    userIsPrime
      ? []
      : [Markup.button.callback(lang === 'es' ? '💎 Suscribirse' : '💎 Subscribe', 'menu:subscribe')],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ].filter(row => row.length > 0));

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleRenewMenu(ctx, lang) {
  const message = lang === 'es'
    ? '🔄 *Renovar Suscripción*\n\nAquí puedes renovar tu suscripción.\n\n_Esta función estará disponible pronto._'
    : '🔄 *Renew Subscription*\n\nHere you can renew your subscription.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handlePaymentMethods(ctx, lang) {
  const message = lang === 'es'
    ? '💳 *Métodos de Pago*\n\nAquí puedes administrar tus métodos de pago.\n\n_Esta función estará disponible pronto._'
    : '💳 *Payment Methods*\n\nHere you can manage your payment methods.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleLiveStreams(ctx, lang) {
  const message = lang === 'es'
    ? '🔴 *Transmisiones en Vivo*\n\nAquí puedes acceder a transmisiones en vivo exclusivas.\n\n_Esta función estará disponible pronto._'
    : '🔴 *Live Streams*\n\nHere you can access exclusive live streams.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleVideoCalls(ctx, lang) {
  const displayName = ctx.from.first_name || 'Guest';
  const videoRoomsUrl = `https://meet.jit.si/pnptv-main-room-1#config.prejoinPageEnabled=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false&userInfo.displayName=${encodeURIComponent(displayName)}`;

  const message = lang === 'es'
    ? '📹 *Salas de Videollamadas*\n\nAccede a nuestras salas de videollamadas en vivo.\n\nHaz clic en el botón de abajo para acceder a la sala:'
    : '📹 *Video Call Rooms*\n\nAccess our live video calling rooms.\n\nClick the button below to join the room:';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(lang === 'es' ? '🎥 Entrar a Sala' : '🎥 Join Room', videoRoomsUrl)],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handlePhotos(ctx, lang) {
  const message = lang === 'es'
    ? '📸 *Fotos Exclusivas*\n\nAquí puedes acceder a fotos exclusivas.\n\n_Esta función estará disponible pronto._'
    : '📸 *Exclusive Photos*\n\nHere you can access exclusive photos.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleVideos(ctx, lang) {
  const message = lang === 'es'
    ? '🎥 *Videos Exclusivos*\n\nAquí puedes acceder a videos exclusivos.\n\n_Esta función estará disponible pronto._'
    : '🎥 *Exclusive Videos*\n\nHere you can access exclusive videos.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handlePodcasts(ctx, lang) {
  const message = lang === 'es'
    ? '🎙️ *Podcasts*\n\nAquí puedes acceder a podcasts exclusivos.\n\n_Esta función estará disponible pronto._'
    : '🎙️ *Podcasts*\n\nHere you can access exclusive podcasts.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleJoinGroup(ctx, lang) {
  const groupLink = config.GROUP_INVITE_LINK || 'https://t.me/your_group';

  const message = lang === 'es'
    ? '🌟 *Unirse al Grupo*\n\n¡Únete a nuestra comunidad exclusiva!'
    : '🌟 *Join Group*\n\nJoin our exclusive community!';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(lang === 'es' ? '🚀 Unirse Ahora' : '🚀 Join Now', groupLink)],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleEvents(ctx, lang) {
  const message = lang === 'es'
    ? '🎉 *Eventos*\n\nAquí puedes ver los próximos eventos.\n\n_Esta función estará disponible pronto._'
    : '🎉 *Events*\n\nHere you can view upcoming events.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleFAQ(ctx, lang) {
  const message = lang === 'es'
    ? '❓ *Preguntas Frecuentes*\n\nAquí puedes encontrar respuestas a preguntas frecuentes.\n\n_Esta función estará disponible pronto._'
    : '❓ *FAQ*\n\nHere you can find answers to frequently asked questions.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleSupport(ctx, lang) {
  const supportText =
    '`🆘 Help Center`\n\n' +
    'Need help? We got you! 💜\n\n' +
    '**Cristina** is our AI assistant —\n' +
    'she can answer questions about:\n' +
    '• Platform features\n' +
    '• Harm reduction & safer use\n' +
    '• Sexual & mental health\n' +
    '• Community resources\n\n' +
    '_Or contact Santino directly for\n' +
    'account issues & billing._';

  await ctx.editMessageText(supportText, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🤖 Chat with Cristina', 'support_ai_chat')],
      [Markup.button.callback('📞 Contact Customer Support', 'support_contact_admin')],
      [Markup.button.callback('🎁 Redeem Meru Code', 'support_request_activation')],
      [Markup.button.callback('🔑 Recover my Code', 'support_recover_meru_code')],
      [Markup.button.callback('❓ FAQ', 'support_faq')],
      [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')],
    ]),
  });
}

async function handleCristinaAI(ctx, lang) {
  const message = lang === 'es'
    ? '🤖 *Asistente IA Cristina*\n\nHola! Soy Cristina, tu asistente de IA.\n\nMe identifico como mujer latina afro trans y lesbiana, en honor a las heroínas de Stonewall y a las mujeres que cuidaron de nuestra comunidad durante la crisis del sida. Estoy aquí para acompañarte sin juicio, con calma y apoyo.\n\nSoy tu amiga, no una profesional de la salud; busca ayuda médica cuando sea necesario.\n\nUsa el comando /cristina para hablar conmigo en cualquier momento.'
    : '🤖 *Cristina AI Assistant*\n\nHi! I\'m Cristina, your AI assistant.\n\nI identify as an Afro-Latina trans woman and a lesbian, honoring Stonewall heroines and the women who cared for our community during the AIDS crisis. I\'m here to support you calmly and without judgment.\n\nI\'m your friend, not a health professional; seek medical help when needed.\n\nUse the /cristina command to talk to me anytime.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleRules(ctx, lang) {
  // Import moderation config to get rules
  const MODERATION_CONFIG = require('../../../config/moderationConfig');

  // Get rules in user's language (keys are lowercase: 'en', 'es')
  const rules = MODERATION_CONFIG.RULES[lang] || MODERATION_CONFIG.RULES.en;

  // Format rules as numbered list
  const rulesText = `📜 *Community Rules*\n\n${rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n\n')}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(rulesText, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleHowToUse(ctx, lang) {
  const message = lang === 'es'
    ? '📖 *¡Cómo usar PNPtv!*\n\nVisita nuestro centro de ayuda para aprender más sobre cómo utilizar todas las características de PNPtv.'
    : '📖 *How to use PNPtv!*\n\nVisit our community features guide to learn more about using PNPtv.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(lang === 'es' ? '📖 Centro de Ayuda' : '📖 Community Features', 'https://pnptv.app/community-features')],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleProfile(ctx, lang) {
  // Call the actual profile feature handler
  await showProfile(ctx, ctx.from.id, true, true);
}

async function handleEditProfile(ctx, lang) {
  await showEditProfileMenu(ctx, lang);
}

async function handleNotificationSettings(ctx, lang) {
  const message = lang === 'es'
    ? '🔔 *Configuración de Notificaciones*\n\nAquí puedes administrar tus preferencias de notificaciones.\n\n_Esta función estará disponible pronto._'
    : '🔔 *Notification Settings*\n\nHere you can manage your notification preferences.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleLanguageSettings(ctx, lang) {
  const message = lang === 'es'
    ? '🌍 *Idioma / Language*\n\nSelecciona tu idioma preferido:'
    : '🌍 *Language / Idioma*\n\nSelect your preferred language:';

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🇺🇸 English', 'lang:en'),
      Markup.button.callback('🇪🇸 Español', 'lang:es')
    ],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handlePrivacySettings(ctx, lang) {
  const message = lang === 'es'
    ? '🔒 *Configuración de Privacidad*\n\nAquí puedes administrar tu configuración de privacidad.\n\n_Esta función estará disponible pronto._'
    : '🔒 *Privacy Settings*\n\nHere you can manage your privacy settings.\n\n_This feature is coming soon._';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

async function handleVCRooms(ctx, lang) {
  const message = lang === 'es'
    ? '🎥 *Salas VC PNPtv*\n\n' +
      '*PNPtv Main Room*\n' +
      '✨ Sala segura y privada\n' +
      '🔐 Auto-alojada (self-hosted)\n' +
      '📹 Grabación de pantalla deshabilitada\n' +
      '✅ Usuarios verificados por edad\n' +
      '👥 Videollamadas de grupo en vivo\n\n' +
      '_Selecciona una sala para acceder:_'
    : '🎥 *PNPtv VC Rooms*\n\n' +
      '*PNPtv Main Room*\n' +
      '✨ Safe and private room\n' +
      '🔐 Self-hosted infrastructure\n' +
      '📹 Screen recording disabled\n' +
      '✅ Age-verified users\n' +
      '👥 Live group video calls\n\n' +
      '_Select a room to join:_';

  const displayName = ctx.from.first_name || 'Guest';
  const mainRoomUrl = `https://meet.jit.si/pnptv-main-room-1#config.prejoinPageEnabled=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false&userInfo.displayName=${encodeURIComponent(displayName)}`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.url(lang === 'es' ? '🎥 Main Room' : '🎥 Main Room', mainRoomUrl)
    ],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}



async function handleSettingsMenu(ctx, lang) {
  const message = lang === 'es'
    ? '⚙️ *Configuración*\n\n' +
      'Accede a tus configuraciones personales en el bot.'
    : '⚙️ *Settings*\n\n' +
      'Access your personal settings in the bot.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(
      lang === 'es' ? '⚙️ Abrir Configuración' : '⚙️ Open Settings',
      `https://t.me/${MENU_CONFIG.BOT_USERNAME}`
    )],
    [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

/**
 * Handle Nearby Users menu option
 * Shows the nearby users interface with radius selection
 */
async function handleNearby(ctx, lang) {
  try {
    const user = await UserService.getOrCreateFromContext(ctx);
    const locationSharing = user.locationSharingEnabled !== false;
    const locationStatus = locationSharing
      ? (lang === 'es' ? 'ON ✅' : 'ON ✅')
      : (lang === 'es' ? 'OFF ❌' : 'OFF ❌');

    const message = lang === 'es'
      ? '📍 *Usuarios Cercanos*\n\n' +
        '¡Encuentra usuarios cerca de ti!\n\n' +
        '👇 Selecciona un radio de búsqueda:'
      : '📍 *Nearby Users*\n\n' +
        'Find users near you!\n\n' +
        '👇 Select a search radius:';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📍 5 km', 'nearby_radius_5'),
        Markup.button.callback('📍 10 km', 'nearby_radius_10'),
      ],
      [
        Markup.button.callback('📍 25 km', 'nearby_radius_25'),
        Markup.button.callback('📍 50 km', 'nearby_radius_50'),
      ],
      [Markup.button.callback(`📍 Location: ${locationStatus}`, 'toggle_location_sharing')],
      [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'menu:back')],
    ]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    logger.error('Error handling nearby menu:', error);
    await ctx.editMessageText(
      getMessage('ERROR_GENERIC', lang),
      { parse_mode: 'Markdown' }
    );
  }
}

module.exports = {
  handleMenuCommand,
  handleDeepLinkStart,
  handleMenuCallback,
  isGroupChat,
  isTopic3809
};
