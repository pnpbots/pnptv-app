const { Markup } = require('telegraf');
const UserService = require('../../services/userService');
const NearbyPlaceService = require('../../services/nearbyPlaceService');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage, isPrimeUser } = require('../../utils/helpers');
const FeatureUrlService = require('../../services/featureUrlService');

/**
 * Tier gate for bot actions — only Prime users can access Nearby
 * Returns true if user should be blocked (not Prime)
 */
const checkNearbyAccess = async (ctx) => {
  try {
    const user = await UserService.getOrCreateFromContext(ctx);
    if (isPrimeUser(user)) return false; // access granted
    const lang = getLanguage(ctx);
    const msg = lang === 'es'
      ? '🔒 *Nearby* es una función exclusiva de PRIME.\n\nSuscríbete para desbloquear.'
      : '🔒 *Nearby* is a PRIME-only feature.\n\nSubscribe to unlock.';
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(lang === 'es' ? '🔒 Solo para PRIME' : '🔒 PRIME only', { show_alert: true });
    }
    await ctx.reply(msg, { parse_mode: 'Markdown' });
    return true; // blocked
  } catch (error) {
    logger.error('Error checking nearby access:', error);
    return false; // fail open to avoid breaking existing users
  }
};

// Helper function to safely edit message or send new if editing fails
// This handles cases where the original message is a photo or was deleted
const safeEditOrReply = async (ctx, text, options) => {
  try {
    // Check if the message is a photo message (has photo or media)
    const message = ctx.callbackQuery?.message;
    if (message && (message.photo || message.video || message.animation || message.document)) {
      // Can't edit photo message text, delete and send new
      await ctx.deleteMessage().catch(() => {});
      return await ctx.reply(text, options);
    }

    return await ctx.editMessageText(text, options);
  } catch (error) {
    // If edit fails (message deleted, no text, etc.), try sending new message
    if (error.message?.includes('there is no text') ||
        error.message?.includes('message to edit not found') ||
        error.message?.includes('message can\'t be edited')) {
      try {
        await ctx.deleteMessage().catch(() => {});
      } catch (e) { /* ignore delete errors */ }
      return await ctx.reply(text, options);
    }
    throw error;
  }
};

const showNearbyMenu = async (ctx, options = {}) => {
  const { isNewMessage = false } = options;

  try {
    // Tier gate: only Prime users can access Nearby
    if (await checkNearbyAccess(ctx)) return;

    const lang = getLanguage(ctx);
    const user = await UserService.getOrCreateFromContext(ctx);
    const locationStatus = user.locationSharingEnabled ? '🟢 ON' : '🔴 OFF';

    const headerText = lang === 'es'
      ? '`🔥 PNP Nearby`\n\n' +
        'Explora todo lo que está cerca de ti:\n' +
        '👥 Miembros\n' +
        '🏪 Negocios\n' +
        '📍 Lugares de interés\n\n' +
        '_Selecciona una categoría o ve todo:_'
      : '`🔥 PNP Nearby`\n\n' +
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

    if (isNewMessage || !ctx.callbackQuery) {
      await ctx.reply(headerText, { parse_mode: 'Markdown', ...keyboard });
    } else {
      await safeEditOrReply(ctx, headerText, { parse_mode: 'Markdown', ...keyboard });
    }
  } catch (error) {
    logger.error('Error showing nearby menu:', error);
  }
};

/**
 * Unified Nearby handlers - MAIN nearby handler file
 * All nearby functionality is consolidated here to avoid duplicate callbacks
 * @param {Telegraf} bot - Bot instance
 */
const registerNearbyUnifiedHandlers = (bot) => {
  // Main unified nearby menu - handles all entry point action names for compatibility
  bot.action(['show_nearby_unified', 'show_nearby', 'show_nearby_menu'], async (ctx) => {
    await showNearbyMenu(ctx);
  });

  // Toggle location sharing
  bot.action('toggle_location_sharing', async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      const lang = getLanguage(ctx);

      if (!ctx.from?.id) {
        logger.error('Missing user context in location sharing toggle');
        await ctx.answerCbQuery(t('error', lang));
        return;
      }

      const userId = ctx.from.id;
      const user = await UserService.getOrCreateFromContext(ctx);

      // Toggle the current setting
      const newSetting = !user.locationSharingEnabled;

      await UserService.updateProfile(userId, {
        locationSharingEnabled: newSetting
      });

      const message = newSetting
        ? t('locationSharingToggleEnabled', lang)
        : t('locationSharingToggleDisabled', lang);

      await ctx.answerCbQuery(message);

      // Update the button text
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: ctx.callbackQuery.message.reply_markup.inline_keyboard.map(row => {
            if (row[0]?.callback_data === 'toggle_location_sharing') {
              const newStatus = newSetting ? '🟢 ON' : '🔴 OFF';
              return [Markup.button.callback(`📍 Location: ${newStatus}`, 'toggle_location_sharing')];
            }
            return row;
          })
        });
      } catch (editError) {
        // Ignore "message is not modified" errors (can happen with rapid clicks)
        if (!editError.message?.includes('message is not modified')) {
          throw editError;
        }
      }
    } catch (error) {
      logger.error('Error toggling location sharing:', error);
      const lang = getLanguage(ctx);
      await ctx.answerCbQuery(t('error', lang));
    }
  });

  // Show all nearby items (users + businesses + places)
  bot.action('nearby_all', async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      // Check if user has location set
      const currentUser = await UserService.getOrCreateFromContext(ctx);
      if (!currentUser.location || !currentUser.location.lat) {
        const noLocationText =
          lang === 'es'
            ? '`📍 Ubicación Requerida`\n\n' +
              'Necesitas compartir tu ubicación primero!\n\n' +
              '_Ve a tu Perfil → Ubicación para compartir tu ubicación._'
            : '`📍 Location Required`\n\n' +
              'You need to share your location first!\n\n' +
              '_Go to your Profile → Location to share your location._';

        await safeEditOrReply(
          ctx,
          noLocationText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '📝 Ir al Perfil' : '📝 Go to Profile', 'edit_profile')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      await safeEditOrReply(ctx, lang === 'es' ? '🔍 _Buscando todo cerca de ti..._' : '🔍 _Searching everything near you..._', { parse_mode: 'Markdown' });

      // Get all nearby items
      const [nearbyUsers, nearbyBusinesses, nearbyPlaces] = await Promise.all([
        UserService.getNearbyUsers(userId, 10),
        NearbyPlaceService.getNearbyBusinesses(userId, 10),
        NearbyPlaceService.getNearbyPlacesOfInterest(userId, 10)
      ]);

      // Combine all results
      const allItems = [];
      
      // Add users
      nearbyUsers.forEach(user => {
        allItems.push({
          type: 'user',
          id: user.id,
          name: user.firstName || 'Anonymous',
          username: user.username,
          distance: user.distance,
          emoji: '👥'
        });
      });

      // Add businesses
      nearbyBusinesses.places.forEach(business => {
        allItems.push({
          type: 'business',
          id: business.id,
          name: business.name,
          distance: business.distance,
          emoji: '🏪',
          categoryEmoji: business.categoryEmoji
        });
      });

      // Add places
      nearbyPlaces.places.forEach(place => {
        allItems.push({
          type: 'place',
          id: place.id,
          name: place.name,
          distance: place.distance,
          emoji: '📍',
          categoryEmoji: place.categoryEmoji
        });
      });

      // Sort by distance
      allItems.sort((a, b) => a.distance - b.distance);

      if (allItems.length === 0) {
        const noResultsText =
          lang === 'es'
            ? '`😢 Sin Resultados`\n\n' +
              'No se encontró nada cerca de ti 😔\n\n' +
              '_Intenta más tarde o sugiere un lugar!_'
            : '`😢 No Results`\n\n' +
              'Nothing found near you 😔\n\n' +
              '_Try again later or suggest a place!_';

        await safeEditOrReply(
          ctx,
          noResultsText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '➕ Proponer Lugar' : '➕ Suggest Place', 'submit_place_start')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      // Show results
      let message = lang === 'es'
        ? '`🔥 Todo Cerca de Ti 🔥`\n\n' +
          `Encontrados **${allItems.length}** items cerca 👀\n\n`
        : '`🔥 Everything Near You 🔥`\n\n' +
          `Found **${allItems.length}** items nearby 👀\n\n`;

      const buttons = [];

      // Show top 15 items
      allItems.slice(0, 15).forEach((item, index) => {
        const displayEmoji = item.categoryEmoji || item.emoji;
        const distance = item.distance.toFixed(1);
        const displayName = item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name;

        message += `${index + 1}. ${displayEmoji} **${displayName}** - _${distance} km_\n`;

        // Create action based on type
        if (item.type === 'user') {
          const label = item.username ? `@${item.username}` : displayName;
          buttons.push([Markup.button.callback(`View ${label}`, `view_user_${item.id}`)]);
        } else if (item.type === 'business' || item.type === 'place') {
          buttons.push([
            Markup.button.callback(`📍 ${displayName}`, `view_place_${item.id}`),
          ]);
        }
      });

      message += lang === 'es'
        ? '\n_Toca para ver detalles_ 😏'
        : '\n_Tap to view details_ 😏';

      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      await safeEditOrReply(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing all nearby items:', error);
      const lang = getLanguage(ctx);
      await ctx.reply(t('error', lang));
    }
  });

  // Show only nearby users
  bot.action('nearby_users', async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      // Check if user has location set
      const currentUser = await UserService.getOrCreateFromContext(ctx);
      if (!currentUser.location || !currentUser.location.lat) {
        const noLocationText =
          lang === 'es'
            ? '`📍 Ubicación Requerida`\n\n' +
              'Necesitas compartir tu ubicación primero!\n\n' +
              '_Ve a tu Perfil → Ubicación para compartir tu ubicación._'
            : '`📍 Location Required`\n\n' +
              'You need to share your location first!\n\n' +
              '_Go to your Profile → Location to share your location._';

        await safeEditOrReply(
          ctx,
          noLocationText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '📝 Ir al Perfil' : '📝 Go to Profile', 'edit_profile')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      await safeEditOrReply(ctx, lang === 'es' ? '🔍 _Buscando miembros cerca..._' : '🔍 _Searching for members..._', { parse_mode: 'Markdown' });

      const nearbyUsers = await UserService.getNearbyUsers(userId, 10);

      if (nearbyUsers.length === 0) {
        const noResultsText =
          lang === 'es'
            ? '`😢 Sin Miembros`\n\n' +
              'No se encontraron miembros cerca 😔\n\n' +
              '_Intenta un radio más grande!_'
            : '`😢 No Members`\n\n' +
              'No members found nearby 😔\n\n' +
              '_Try a larger radius!_';

        await safeEditOrReply(
          ctx,
          noResultsText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Try Again', 'nearby_users')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      // Show list of nearby users
      let message = lang === 'es'
        ? '`🔥 Miembros Cercanos 🔥`\n\n' +
          `Encontrados **${nearbyUsers.length}** miembros cerca 👀\n\n`
        : '`🔥 Nearby Members 🔥`\n\n' +
          `Found **${nearbyUsers.length}** members nearby 👀\n\n`;

      const buttons = [];
      nearbyUsers.slice(0, 10).forEach((user, index) => {
        const name = user.firstName || 'Anonymous';
        const distance = user.distance.toFixed(1);
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👥';
        message += `${emoji} **${name}** - _${distance} km away_\n`;

        const label = user.username ? `@${user.username}` : name;
        buttons.push([Markup.button.callback(`View ${label}`, `view_user_${user.id}`)]);
      });

      message += lang === 'es'
        ? '\n_Toca para ver el perfil_ 😏'
        : '\n_Tap to view the profile_ 😏';

      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      await safeEditOrReply(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing nearby users:', error);
      const lang = getLanguage(ctx);
      await ctx.reply(t('error', lang));
    }
  });

  // Show only nearby businesses
  bot.action('nearby_businesses', async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      await safeEditOrReply(ctx, lang === 'es' ? '🔍 _Buscando negocios..._' : '🔍 _Searching for businesses..._', { parse_mode: 'Markdown' });

      const result = await NearbyPlaceService.getNearbyBusinesses(userId, 10);

      if (!result.success && result.error === 'no_location') {
        await safeEditOrReply(
          ctx,
          lang === 'es'
            ? '`📍 Ubicación Requerida`\n\n' +
              'Necesitas compartir tu ubicación primero.'
            : '`📍 Location Required`\n\n' +
              'You need to share your location first.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '📝 Ir al Perfil' : '📝 Go to Profile', 'edit_profile')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      if (result.places.length === 0) {
        await safeEditOrReply(
          ctx,
          lang === 'es'
            ? '🏪 *Negocios Comunitarios*\n\n' +
              'No hay negocios cerca de ti aún.\n\n' +
              '¿Conoces alguno? ¡Propónlo!'
            : '🏪 *Community Businesses*\n\n' +
              'No businesses near you yet.\n\n' +
              'Know any? Suggest one!',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '➕ Proponer Negocio' : '➕ Suggest Business', 'submit_place_business')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      let headerText = '🏪 *Community Businesses*\n\n' +
        `Found: ${result.places.length}\n\n`;

      const buttons = [];
      result.places.slice(0, 10).forEach((place, index) => {
        const emoji = place.categoryEmoji || '🏪';
        const distance = place.distance !== undefined ? ` (${place.distance.toFixed(1)} km)` : '';
        headerText += `${index + 1}. ${emoji} *${place.name}*${distance}\n`;

        buttons.push([
          Markup.button.callback(
            `${place.categoryEmoji || '🏪'} ${place.name.substring(0, 25)}${place.name.length > 25 ? '...' : ''}`,
            `view_place_${place.id}`
          ),
        ]);
      });

      buttons.push([Markup.button.callback(lang === 'es' ? '➕ Proponer Negocio' : '➕ Suggest Business', 'submit_place_business')]);
      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      await safeEditOrReply(ctx, headerText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing businesses:', error);
    }
  });

  // Show only nearby places
  bot.action('nearby_places', async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      await safeEditOrReply(ctx, lang === 'es' ? '🔍 _Buscando lugares..._' : '🔍 _Searching for places..._', { parse_mode: 'Markdown' });

      const result = await NearbyPlaceService.getNearbyPlacesOfInterest(userId, 10);

      if (!result.success && result.error === 'no_location') {
        await safeEditOrReply(
          ctx,
          lang === 'es'
            ? '`📍 Ubicación Requerida`\n\n' +
              'Necesitas compartir tu ubicación primero.'
            : '`📍 Location Required`\n\n' +
              'You need to share your location first.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '📝 Ir al Perfil' : '📝 Go to Profile', 'edit_profile')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      if (result.places.length === 0) {
        await safeEditOrReply(
          ctx,
          lang === 'es'
            ? '📍 *Lugares de Interés*\n\n' +
              'No hay lugares cerca de ti aún.\n\n' +
              '¿Conoces alguno? ¡Propónlo!'
            : '📍 *Places of Interest*\n\n' +
              'No places near you yet.\n\n' +
              'Know any? Suggest one!',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '➕ Proponer Lugar' : '➕ Suggest Place', 'submit_place_start')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
        return;
      }

      let headerText = '📍 *Places of Interest*\n\n' +
        `Found: ${result.places.length}\n\n`;

      const buttons = [];
      result.places.slice(0, 10).forEach((place, index) => {
        const emoji = place.categoryEmoji || '📍';
        const distance = place.distance !== undefined ? ` (${place.distance.toFixed(1)} km)` : '';
        headerText += `${index + 1}. ${emoji} *${place.name}*${distance}\n`;

        buttons.push([
          Markup.button.callback(
            `${place.categoryEmoji || '📍'} ${place.name.substring(0, 25)}${place.name.length > 25 ? '...' : ''}`,
            `view_place_${place.id}`
          ),
        ]);
      });

      buttons.push([Markup.button.callback(lang === 'es' ? '➕ Proponer Lugar' : '➕ Suggest Place', 'submit_place_start')]);
      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      await safeEditOrReply(ctx, headerText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing places:', error);
    }
  });

  // Import existing handlers for user viewing and DM functionality
  // View user profile (imported from original nearby.js)
  // NOTE: This handler has been removed to avoid conflict with enhancedProfileCards.js
  // The enhanced profile cards provide more comprehensive profile viewing functionality
  // bot.action(/^view_user_(.+)$/, async (ctx) => {
  //   try {
  //     if (!ctx.match || !ctx.match[1]) {
  //       logger.error('Invalid view user action format');
  //       return;
  //     }
  //
  //     const targetUserId = ctx.match[1];
  //     const lang = getLanguage(ctx);
  //
  //     const user = await UserService.getById(targetUserId);
  //
  //     if (!user) {
  //       await ctx.answerCbQuery(t('userNotFound', lang));
  //       return;
  //     }
  //
  //     let profileText = '`👤 PROFILE CARD`\n\n';
  //
  //     const displayName = user.firstName || 'Anonymous';
  //     profileText += `**${displayName}**`;
  //     if (user.lastName) profileText += ` ${user.lastName}`;
  //     profileText += '\n';
  //     
  //     if (user.username) {
  //       profileText += `@${user.username}\n`;
  //     }
  //

  // Handle DM button clicks (imported from original nearby.js)
  bot.action(/^dm_user_(.+)$/, async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid DM user action format');
        return;
      }

      const targetUserId = ctx.match[1];
      const lang = getLanguage(ctx);

      const targetUser = await UserService.getById(targetUserId);

      if (!targetUser) {
        await ctx.answerCbQuery(t('userNotFound', lang));
        return;
      }

      try {
        // Build the profile link - prefer username, fallback to user ID deep link
        let profileLink;
        if (targetUser.username) {
          // Clean the username (remove @ if present)
          const cleanUsername = targetUser.username.replace(/^@/, '');
          profileLink = `https://t.me/${encodeURIComponent(cleanUsername)}`;
        } else {
          // Use Telegram deep link for users without username
          profileLink = `tg://user?id=${targetUserId}`;
        }

        // Show message with link - answerCbQuery url option only works for games/web apps
        await ctx.answerCbQuery(
          lang === 'es'
            ? `💬 Haz click para chatear con ${targetUser.firstName || 'este usuario'}`
            : `💬 Click to chat with ${targetUser.firstName || 'this user'}`,
          { show_alert: false }
        );

        // Send a helpful message with the DM link button
        const messageText = lang === 'es'
          ? `💬 Para enviar un mensaje a **${targetUser.firstName || 'este usuario'}**, usa el botón abajo:`
          : `💬 To send a message to **${targetUser.firstName || 'this user'}**, use the button below:`;

        await ctx.reply(messageText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url(lang === 'es' ? '💬 Abrir Chat' : '💬 Open Chat', profileLink)],
            [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'show_nearby')]
          ])
        });
      } catch (chatError) {
        logger.error('Error opening chat:', chatError);
        await ctx.answerCbQuery(t('errorOpeningChat', lang), {
          show_alert: true,
        });
      }
    } catch (error) {
      logger.error('Error handling DM action:', error);
      const lang = getLanguage(ctx);
      await ctx.answerCbQuery(t('error', lang), {
        show_alert: true,
      });
    }
  });

  // Import place viewing functionality from nearbyPlaces.js
  bot.action(/^view_place_(\d+)$/, async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      const placeId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);

      const place = await NearbyPlaceService.getPlaceDetails(placeId, true);

      if (!place) {
        await ctx.answerCbQuery(lang === 'es' ? 'Lugar no encontrado' : 'Place not found');
        return;
      }

      let detailsText = `${place.categoryEmoji || '📍'} *${escapeMarkdown(place.name)}*\n\n`;

      if (place.description) {
        detailsText += `${escapeMarkdown(place.description)}\n\n`;
      }

      if (place.address) {
        detailsText += `📍 ${escapeMarkdown(place.address)}`;
        if (place.city) detailsText += `, ${escapeMarkdown(place.city)}`;
        detailsText += '\n';
      }

      if (place.distance !== undefined) {
        detailsText += `📏 ${place.distance.toFixed(1)} km ${lang === 'es' ? 'de distancia' : 'away'}\n`;
      }

      if (place.priceRange) {
        detailsText += `💰 ${place.priceRange}\n`;
      }

      if (place.phone) {
        detailsText += `📞 ${place.phone}\n`;
      }

      detailsText += `\n👁️ ${place.viewCount} ${lang === 'es' ? 'vistas' : 'views'}`;

      const buttons = [];

      if (place.telegramUsername) {
        buttons.push([Markup.button.url('💬 Telegram', `https://t.me/${place.telegramUsername}`)]);
      }

      if (place.website) {
        buttons.push([Markup.button.url('🌐 Website', place.website)]);
      }

      if (place.instagram) {
        buttons.push([Markup.button.url('📸 Instagram', `https://instagram.com/${place.instagram}`)]);
      }

      if (place.location) {
        buttons.push([Markup.button.url(
          '🗺️ Open in Maps',
          `https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}`
        )]);
      }

      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      if (place.photoFileId) {
        try {
          await ctx.deleteMessage().catch(() => {});
          await ctx.replyWithPhoto(place.photoFileId, {
            caption: detailsText,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        } catch (photoError) {
          logger.error('Error sending photo:', photoError);
          await safeEditOrReply(ctx, detailsText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        }
      } else {
        await safeEditOrReply(ctx, detailsText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        });
      }
    } catch (error) {
      logger.error('Error viewing place details:', error);
    }
  });

  function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*\\[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  // Unified nearby command
  bot.command('nearby', async (ctx) => {
    try {
      if (await checkNearbyAccess(ctx)) return;
      const lang = getLanguage(ctx);
      const userId = ctx.from?.id;

      if (!userId) {
        await ctx.reply(lang === 'es' ? '❌ Usuario no identificado.' : '❌ User not identified.');
        return;
      }

      // Try to get the nearby web app URL from API
      try {
        const webAppUrl = await FeatureUrlService.getNearbyUrl(userId);

        const message = lang === 'es'
          ? '🔥 *PNP Nearby* ha sido movido a nuestra aplicación web para una mejor experiencia.'
          : '🔥 *PNP Nearby* has been moved to our web app for a better experience.';

        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.webApp(lang === 'es' ? '🌐 Abrir Nearby' : '🌐 Open Nearby', webAppUrl)],
            [Markup.button.callback(lang === 'es' ? '📱 Menú Clásico' : '📱 Classic Menu', 'show_nearby_unified')],
          ]),
        });
      } catch (error) {
        logger.error('Error getting Nearby URL, falling back to menu:', error);
        // Fallback to classic menu if API fails
        ctx.callbackQuery = { data: 'show_nearby_unified' };
        await bot.handleUpdate(ctx.update);
      }
    } catch (error) {
      logger.error('Error handling /nearby command:', error);
    }
  });

  // Add support for "pno nearbt" command pattern
  bot.on('text', async (ctx, next) => {
    try {
      const text = ctx.message.text?.trim()?.toLowerCase();
      
      // Check for "pnp nearby" pattern
      if (text && (text === 'pnp nearby' || text.startsWith('pnp nearby '))) {
        const lang = getLanguage(ctx);
        
        // Extract any additional parameters (like "burton")
        const parts = text.split(' ');
        const locationFilter = parts.length > 2 ? parts.slice(2).join(' ') : null;
        
        // Store location filter in session if provided
        if (locationFilter) {
          ctx.session.temp = ctx.session.temp || {};
          ctx.session.temp.nearbyLocationFilter = locationFilter;
          await ctx.saveSession();
        }
        
        // Show the unified nearby menu
        ctx.callbackQuery = { data: 'show_nearby_unified' };
        await bot.handleUpdate(ctx.update);
        
        return; // Don't continue to other handlers
      }
      
      // Continue to other text handlers
      return next();
    } catch (error) {
      logger.error('Error handling pnp nearby command:', error);
      return next();
    }
  });

};

module.exports = registerNearbyUnifiedHandlers;
module.exports.showNearbyMenu = showNearbyMenu;
