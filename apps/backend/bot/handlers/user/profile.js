const { Markup } = require('telegraf');
const moment = require('moment');
const UserService = require('../../services/userService');
const UserModel = require('../../../models/userModel');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage, validateUserInput, safeReplyOrEdit } = require('../../utils/helpers');
const { buildMemberProfileCard, buildMemberProfileInlineKeyboard } = require('../../utils/memberProfileCard');

const GROUP_ID = process.env.GROUP_ID;

/**
 * Profile handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerProfileHandlers = (bot) => {
  // Show all interests as a popup
  bot.action(/^profile_interests_(\d+)$/, async (ctx) => {
    try {
      const targetUserId = ctx.match[1];
      const targetUser = await UserModel.getById(targetUserId);
      const interests = Array.isArray(targetUser?.interests) ? targetUser.interests.filter(Boolean) : [];
      const text = interests.length ? interests.join(', ').slice(0, 200) : '—';
      await ctx.answerCbQuery(text, { show_alert: true });
    } catch (error) {
      logger.error('Error showing profile interests:', error);
      await ctx.answerCbQuery('Error', { show_alert: false }).catch(() => {});
    }
  });

  // Show own profile
  bot.action('show_profile', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await showProfile(ctx, ctx.from.id, true, true);
    } catch (error) {
      logger.error('Error showing profile:', error);
    }
  });

  // Edit Profile (consolidated overview)
  bot.action('show_edit_profile_overview', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      await showEditProfileOverview(ctx, lang);
    } catch (error) {
      logger.error('Error showing edit profile overview menu:', error);
    }
  });



  // Show settings overview
  bot.action('show_settings_overview', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      await showSettingsOverview(ctx, lang);
    } catch (error) {
      logger.error('Error showing settings overview:', error);
    }
  });

  // Show privacy settings
  bot.action('privacy_settings', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await showPrivacySettings(ctx);
    } catch (error) {
      logger.error('Error showing privacy settings:', error);
    }
  });

  // Toggle privacy settings
  bot.action(/^privacy_toggle_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const setting = ctx.match[1];
      await togglePrivacySetting(ctx, setting);
    } catch (error) {
      logger.error('Error toggling privacy setting:', error);
    }
  });

  // Show favorites
  bot.action('show_favorites', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await showFavorites(ctx);
    } catch (error) {
      logger.error('Error showing favorites:', error);
    }
  });

  // Show blocked users
  bot.action('show_blocked', async (ctx) => {
    try {
      await showBlockedUsers(ctx);
    } catch (error) {
      logger.error('Error showing blocked users:', error);
    }
  });

  // View user profile
  // NOTE: This handler has been removed to avoid conflict with enhancedProfileCards.js
  // The enhanced profile cards provide more comprehensive profile viewing functionality
  // bot.action(/^view_user_(\d+)$/, async (ctx) => {
  //   try {
  //     const targetUserId = ctx.match[1];
  //     await showProfile(ctx, targetUserId, true, false);
  //   } catch (error) {
  //     logger.error('Error viewing user profile:', error);
  //   }
  // });

  // Add/Remove favorites
  bot.action(/^add_favorite_(\d+)$/, async (ctx) => {
    try {
      const targetUserId = ctx.match[1];
      await addToFavorites(ctx, targetUserId);
    } catch (error) {
      logger.error('Error adding to favorites:', error);
    }
  });

  bot.action(/^remove_favorite_(\d+)$/, async (ctx) => {
    try {
      const targetUserId = ctx.match[1];
      await removeFromFavorites(ctx, targetUserId);
    } catch (error) {
      logger.error('Error removing from favorites:', error);
    }
  });

  // Block/Unblock user
  bot.action(/^block_user_(\d+)$/, async (ctx) => {
    try {
      const targetUserId = ctx.match[1];
      await blockUser(ctx, targetUserId);
    } catch (error) {
      logger.error('Error blocking user:', error);
    }
  });

  bot.action(/^unblock_user_(\d+)$/, async (ctx) => {
    try {
      const targetUserId = ctx.match[1];
      await unblockUser(ctx, targetUserId);
    } catch (error) {
      logger.error('Error unblocking user:', error);
    }
  });

  // Share Profile Directly
  bot.action('share_profile_direct', async (ctx) => {
    try {
      await shareProfileDirect(ctx);
    } catch (error) {
      logger.error('Error sharing profile directly:', error);
    }
  });

  // Print/Share Profile
  bot.action('share_profile', async (ctx) => {
    try {
      await shareProfile(ctx);
    } catch (error) {
      logger.error('Error sharing profile:', error);
    }
  });

  // Share to group
  bot.action('share_to_group', async (ctx) => {
    try {
      await shareToGroup(ctx);
    } catch (error) {
      logger.error('Error sharing to group:', error);
    }
  });

  // Edit actions
  bot.action('edit_photo', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForPhoto = true;
      await ctx.saveSession();
      await ctx.editMessageText(t('sendPhoto', lang));
    } catch (error) {
      logger.error('Error in edit photo:', error);
    }
  });

  bot.action('edit_bio', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForBio = true;
      await ctx.saveSession();
      await ctx.editMessageText(t('sendBio', lang));
    } catch (error) {
      logger.error('Error in edit bio:', error);
    }
  });

  bot.action('edit_interests', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForInterests = true;
      await ctx.saveSession();
      await ctx.editMessageText(t('sendInterests', lang));
    } catch (error) {
      logger.error('Error in edit interests:', error);
    }
  });

  bot.action('edit_tribe', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForTribe = true;
      await ctx.saveSession();
      await ctx.editMessageText(
        lang === 'es'
          ? '🏳️‍🌈 ¿Cuál es tu tribu?\n\nEjemplos: Bear, Otter, Jock, Twink, Daddy, etc.\n\nEnvía tu tribu o "borrar" para eliminar:'
          : '🏳️‍🌈 What\'s your tribe?\n\nExamples: Bear, Otter, Jock, Twink, Daddy, etc.\n\nSend your tribe or "delete" to remove:'
      );
    } catch (error) {
      logger.error('Error in edit tribe:', error);
    }
  });

  bot.action('edit_looking_for', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForLookingFor = true;
      await ctx.saveSession();
      const text = lang === 'es'
        ? '🔎 ¿Qué estás buscando?\n\nEjemplos: "Un slam buddy", "Amigos cloudy", "Relación seria", "Diversión casual", etc.\n\nEnvía lo que buscas o "borrar" para eliminar:'
        : '🔎 What are you looking for?\n\nExamples: "A slam buddy", "Cloudy friends", "Serious relationship", "Casual fun", etc.\n\nSend what you\'re looking for or "delete" to remove:';
      try {
        await ctx.editMessageText(text);
      } catch (e) {
        await ctx.reply(text);
      }
    } catch (error) {
      logger.error('Error in edit looking_for:', error);
    }
  });

  bot.action('edit_location', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForLocation = true;
      await ctx.saveSession();
      await ctx.answerCbQuery();
      await ctx.reply(
        t('sendLocation', lang),
        Markup.keyboard([
          [Markup.button.locationRequest(lang === 'es' ? '📍 Compartir Ubicación' : '📍 Share Location')],
          [lang === 'es' ? '❌ Cancelar' : '❌ Cancel'],
        ]).resize(),
      );
    } catch (error) {
      logger.error('Error in edit location:', error);
    }
  });

  // City editing
  bot.action('edit_city', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForCity = true;
      await ctx.saveSession();
      await ctx.editMessageText(
        lang === 'es'
          ? '🏙️ ¿En qué ciudad estás?\n\nEnvía el nombre de tu ciudad o "borrar" para eliminar:'
          : '🏙️ What city are you in?\n\nSend your city name or "delete" to remove:'
      );
    } catch (error) {
      logger.error('Error in edit city:', error);
    }
  });

  // Country editing
  bot.action('edit_country', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForCountry = true;
      await ctx.saveSession();
      await ctx.editMessageText(
        lang === 'es'
          ? '🌍 ¿En qué país estás?\n\nEnvía el nombre de tu país o "borrar" para eliminar:'
          : '🌍 What country are you in?\n\nSend your country name or "delete" to remove:'
      );
    } catch (error) {
      logger.error('Error in edit country:', error);
    }
  });

  // Social Media Menu
  bot.action('edit_social', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      await showSocialMediaMenu(ctx, lang);
    } catch (error) {
      logger.error('Error showing social media menu:', error);
    }
  });

  bot.action('edit_tiktok', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForTikTok = true;
      await ctx.saveSession();
      await ctx.editMessageText(
        lang === 'es'
          ? '📱 Envía tu nombre de usuario de TikTok (sin @) o "borrar" para eliminar:'
          : '📱 Send your TikTok username (without @) or "delete" to remove:'
      );
    } catch (error) {
      logger.error('Error in edit tiktok:', error);
    }
  });

  bot.action('edit_twitter', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForTwitter = true;
      await ctx.saveSession();
      await ctx.editMessageText(
        lang === 'es'
          ? '🐦 Envía tu nombre de usuario de X/Twitter (sin @) o "borrar" para eliminar:'
          : '🐦 Send your X/Twitter username (without @) or "delete" to remove:'
      );
    } catch (error) {
      logger.error('Error in edit twitter:', error);
    }
  });

  bot.action('edit_facebook', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForFacebook = true;
      await ctx.saveSession();
      await ctx.editMessageText(
        lang === 'es'
          ? '📘 Envía tu nombre de usuario de Facebook o "borrar" para eliminar:'
          : '📘 Send your Facebook username or "delete" to remove:'
      );
    } catch (error) {
      logger.error('Error in edit facebook:', error);
    }
  });

  bot.action('edit_instagram', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp.waitingForInstagram = true;
      await ctx.saveSession();
      await ctx.editMessageText(
        lang === 'es'
          ? '📷 Envía tu nombre de usuario de Instagram (sin @) o "borrar" para eliminar:'
          : '📷 Send your Instagram username (without @) or "delete" to remove:'
      );
    } catch (error) {
      logger.error('Error in edit instagram:', error);
    }
  });

  // Handle photo upload
  bot.on('photo', async (ctx, next) => {
    if (ctx.session.temp?.waitingForPhoto) {
      try {
        const lang = getLanguage(ctx);
        if (!ctx.message?.photo || ctx.message.photo.length === 0) {
          await ctx.reply(t('invalidInput', lang));
          return;
        }
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        await UserService.updateProfile(ctx.from.id, { photoFileId: photo.file_id });
        ctx.session.temp.waitingForPhoto = false;
        await ctx.saveSession();
        await ctx.reply(t('photoUpdated', lang));
        await showProfile(ctx, ctx.from.id, false, true);
      } catch (error) {
        logger.error('Error updating photo:', error);
      }
      return;
    }
    return next();
  });

  // Handle location
  bot.on('location', async (ctx, next) => {
    if (ctx.session.temp?.waitingForLocation) {
      const lang = getLanguage(ctx);
      try {
        if (!ctx.message?.location?.latitude || !ctx.message?.location?.longitude) {
          await ctx.reply(t('invalidInput', lang), Markup.removeKeyboard());
          return;
        }
        const { latitude, longitude } = ctx.message.location;
        const result = await UserService.updateLocation(ctx.from.id, { lat: latitude, lng: longitude });
        ctx.session.temp.waitingForLocation = false;
        await ctx.saveSession();
        if (result.success) {
          await ctx.reply(t('locationUpdated', lang), Markup.removeKeyboard());
          await showProfile(ctx, ctx.from.id, false, true);
        } else {
          await ctx.reply(t('error', lang), Markup.removeKeyboard());
        }
      } catch (error) {
        logger.error('Error updating location:', error);
        await ctx.reply(t('error', lang), Markup.removeKeyboard());
      }
      return;
    }
    return next();
  });

  // Handle text inputs
  bot.on('text', async (ctx, next) => {
    const { temp } = ctx.session;
    const lang = getLanguage(ctx);
    const input = ctx.message.text;

    // Cancel location
    if (temp?.waitingForLocation && (input === '❌ Cancelar' || input === '❌ Cancel')) {
      ctx.session.temp.waitingForLocation = false;
      await ctx.saveSession();
      await ctx.reply(t('operationCancelled', lang) || 'Cancelled', Markup.removeKeyboard());
      await showProfile(ctx, ctx.from.id, false, true);
      return;
    }

    // Bio
    if (temp?.waitingForBio) {
      const bio = validateUserInput(input, 500);
      if (!bio) { await ctx.reply(t('invalidInput', lang)); return; }
      await UserService.updateProfile(ctx.from.id, { bio });
      ctx.session.temp.waitingForBio = false;
      await ctx.saveSession();
      await ctx.reply(t('bioUpdated', lang));
      await showEditProfileOverview(ctx, lang);
      return;
    }

    // Interests
    if (temp?.waitingForInterests) {
      const text = validateUserInput(input, 500);
      if (!text) { await ctx.reply(t('invalidInput', lang)); return; }
      const interests = text.split(',').map(i => i.trim()).filter(i => i.length > 0).slice(0, 10);
      if (interests.length === 0) { await ctx.reply(t('invalidInput', lang)); return; }
      await UserService.updateProfile(ctx.from.id, { interests });
      ctx.session.temp.waitingForInterests = false;
      await ctx.saveSession();
      await ctx.reply(t('interestsUpdated', lang));
      await showEditProfileOverview(ctx, lang);
      return;
    }

    // Tribe
    if (temp?.waitingForTribe) {
      const value = validateUserInput(input, 100);
      if (value && (value.toLowerCase() === 'delete' || value.toLowerCase() === 'borrar')) {
        await UserService.updateProfile(ctx.from.id, { tribe: null });
        await ctx.reply(lang === 'es' ? '✅ Tribu eliminada' : '✅ Tribe removed');
      } else if (value) {
        await UserService.updateProfile(ctx.from.id, { tribe: value });
        await ctx.reply(lang === 'es' ? '✅ Tribu actualizada' : '✅ Tribe updated');
      } else {
        await ctx.reply(t('invalidInput', lang)); return;
      }
      ctx.session.temp.waitingForTribe = false;
      await ctx.saveSession();
      await showEditProfileOverview(ctx, lang);
      return;
    }

    // Looking for
    if (temp?.waitingForLookingFor) {
      const value = validateUserInput(input, 200);
      if (value && (value.toLowerCase() === 'delete' || value.toLowerCase() === 'borrar')) {
        await UserService.updateProfile(ctx.from.id, { looking_for: null });
        await ctx.reply(lang === 'es' ? '✅ Eliminado' : '✅ Removed');
      } else if (value) {
        await UserService.updateProfile(ctx.from.id, { looking_for: value });
        await ctx.reply(lang === 'es' ? '✅ Actualizado' : '✅ Updated');
      } else {
        await ctx.reply(t('invalidInput', lang)); return;
      }
      ctx.session.temp.waitingForLookingFor = false;
      await ctx.saveSession();
      await showEditProfileOverview(ctx, lang);
      return;
    }

    // City
    if (temp?.waitingForCity) {
      const value = validateUserInput(input, 100);
      if (value && (value.toLowerCase() === 'delete' || value.toLowerCase() === 'borrar')) {
        await UserService.updateProfile(ctx.from.id, { city: null });
        await ctx.reply(lang === 'es' ? '✅ Ciudad eliminada' : '✅ City removed');
      } else if (value) {
        await UserService.updateProfile(ctx.from.id, { city: value });
        await ctx.reply(lang === 'es' ? '✅ Ciudad actualizada' : '✅ City updated');
      } else {
        await ctx.reply(t('invalidInput', lang)); return;
      }
      ctx.session.temp.waitingForCity = false;
      await ctx.saveSession();
      await showEditProfileOverview(ctx, lang);
      return;
    }

    // Country
    if (temp?.waitingForCountry) {
      const value = validateUserInput(input, 100);
      if (value && (value.toLowerCase() === 'delete' || value.toLowerCase() === 'borrar')) {
        await UserService.updateProfile(ctx.from.id, { country: null });
        await ctx.reply(lang === 'es' ? '✅ País eliminado' : '✅ Country removed');
      } else if (value) {
        await UserService.updateProfile(ctx.from.id, { country: value });
        await ctx.reply(lang === 'es' ? '✅ País actualizado' : '✅ Country updated');
      } else {
        await ctx.reply(t('invalidInput', lang)); return;
      }
      ctx.session.temp.waitingForCountry = false;
      await ctx.saveSession();
      await showEditProfileOverview(ctx, lang);
      return;
    }

    // Social media handlers
    const socialFields = [
      { flag: 'waitingForTikTok', field: 'tiktok', name: 'TikTok' },
      { flag: 'waitingForTwitter', field: 'twitter', name: 'X/Twitter' },
      { flag: 'waitingForFacebook', field: 'facebook', name: 'Facebook' },
      { flag: 'waitingForInstagram', field: 'instagram', name: 'Instagram' },
    ];

    for (const { flag, field, name } of socialFields) {
      if (temp?.[flag]) {
        const value = validateUserInput(input, 100);
        if (value && (value.toLowerCase() === 'delete' || value.toLowerCase() === 'borrar')) {
          await UserService.updateProfile(ctx.from.id, { [field]: null });
          await ctx.reply(lang === 'es' ? `✅ ${name} eliminado` : `✅ ${name} removed`);
        } else if (value) {
          const username = value.replace('@', '').trim();
          await UserService.updateProfile(ctx.from.id, { [field]: username });
          await ctx.reply(lang === 'es' ? `✅ ${name} actualizado` : `✅ ${name} updated`);
        } else {
          await ctx.reply(t('invalidInput', lang)); return;
        }
        ctx.session.temp[flag] = false;
        await ctx.saveSession();
        await showSocialMediaMenu(ctx, lang);
        return;
      }
    }

    return next();
  });
};

/**
 * Show consolidated edit profile overview menu
 */
const showEditProfileOverview = async (ctx, lang) => {
  try {
    const user = await UserModel.getById(ctx.from.id);
    if (!user) { await ctx.reply(t('error', lang)); return; }

    // Build location string
    let locationStr = '—';
    if (user.city && user.country) {
      locationStr = `${user.city}, ${user.country}`;
    } else if (user.city) {
      locationStr = user.city;
    } else if (user.country) {
      locationStr = user.country;
    } else if (user.location) {
      locationStr = lang === 'es' ? '📍 Coordenadas guardadas' : '📍 Coordinates saved';
    }

    const text = lang === 'es'
      ? [
          '`📝 Editar Perfil`',
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
          '',
          `📝 *Bio:* ${user.bio || '—'}`,
          `🎯 *Intereses:* ${user.interests?.length ? user.interests.join(', ') : '—'}`,
          `🏳️‍🌈 *Tribu:* ${user.tribe || '—'}`,
          `🔎 *Buscando:* ${user.looking_for || '—'}`,
          '',
          `🏙️ *Ciudad:* ${user.city || '—'}`,
          `🌍 *País:* ${user.country || '—'}`,
          `📍 *Ubicación:* ${locationStr}`,
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
          '',
          '_Selecciona qué deseas actualizar:_',
        ].join('\n')
      : [
          '`📝 Edit Profile`',
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
          '',
          `📝 *Bio:* ${user.bio || '—'}`,
          `🎯 *Interests:* ${user.interests?.length ? user.interests.join(', ') : '—'}`,
          `🏳️‍🌈 *Tribe:* ${user.tribe || '—'}`,
          `🔎 *Looking for:* ${user.looking_for || '—'}`,
          '',
          `🏙️ *City:* ${user.city || '—'}`,
          `🌍 *Country:* ${user.country || '—'}`,
          `📍 *Location:* ${locationStr}`,
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
          '',
          '_Select what you want to update:_',
        ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📸 ' + (lang === 'es' ? 'Foto' : 'Photo'), 'edit_photo'),
        Markup.button.callback('📝 Bio', 'edit_bio'),
      ],
      [
        Markup.button.callback('🎯 ' + (lang === 'es' ? 'Intereses' : 'Interests'), 'edit_interests'),
        Markup.button.callback('🏳️‍🌈 ' + (lang === 'es' ? 'Tribu' : 'Tribe'), 'edit_tribe'),
      ],
      [
        Markup.button.callback('🔎 ' + (lang === 'es' ? 'Buscando' : 'Looking For'), 'edit_looking_for'),
        Markup.button.callback('🏙️ ' + (lang === 'es' ? 'Ciudad' : 'City'), 'edit_city'),
      ],
      [
        Markup.button.callback('🌍 ' + (lang === 'es' ? 'País' : 'Country'), 'edit_country'),
        Markup.button.callback('📍 ' + (lang === 'es' ? 'GPS' : 'GPS Location'), 'edit_location'),
      ],
      [
        Markup.button.callback('🔗 ' + (lang === 'es' ? 'Redes' : 'Social'), 'edit_social'),
      ],
      [Markup.button.callback(t('back', lang), 'show_profile')],
    ]);

    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
  } catch (error) {
    logger.error('Error showing edit profile overview menu:', error);
  }
};

/**
 * Show social media menu
 */
const showSocialMediaMenu = async (ctx, lang) => {
  try {
    const user = await UserModel.getById(ctx.from.id);
    if (!user) { await ctx.reply(t('error', lang)); return; }

    const text = lang === 'es'
      ? [
          '`🔗 Redes Sociales`',
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
          '',
          `📱 *TikTok:* ${user.tiktok ? '@' + user.tiktok : '—'}`,
          `🐦 *X/Twitter:* ${user.twitter ? '@' + user.twitter : '—'}`,
          `📘 *Facebook:* ${user.facebook || '—'}`,
          `📷 *Instagram:* ${user.instagram ? '@' + user.instagram : '—'}`,
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
        ].join('\n')
      : [
          '`🔗 Social Media`',
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
          '',
          `📱 *TikTok:* ${user.tiktok ? '@' + user.tiktok : '—'}`,
          `🐦 *X/Twitter:* ${user.twitter ? '@' + user.twitter : '—'}`,
          `📘 *Facebook:* ${user.facebook || '—'}`,
          `📷 *Instagram:* ${user.instagram ? '@' + user.instagram : '—'}`,
          '',
          '━━━━━━━━━━━━━━━━━━━━━━',
        ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📱 TikTok', 'edit_tiktok'),
        Markup.button.callback('🐦 X', 'edit_twitter'),
      ],
      [
        Markup.button.callback('📘 Facebook', 'edit_facebook'),
        Markup.button.callback('📷 Instagram', 'edit_instagram'),
      ],
      [Markup.button.callback(t('back', lang), 'show_edit_profile_overview')],
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  } catch (error) {
    logger.error('Error showing social media menu:', error);
  }
};

/**
 * Show consolidated settings overview menu
 */
const showSettingsOverview = async (ctx, lang) => {
  try {
    const text = lang === 'es'
      ? '`⚙️ Ajustes`\n\n_Gestiona tus preferencias de perfil y privacidad._'
      : '`⚙️ Settings`\n\n_Manage your profile and privacy preferences._';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(lang === 'es' ? '🔒 Privacidad' : '🔒 Privacy', 'privacy_settings'),
      ],
      [
        Markup.button.callback(lang === 'es' ? '⭐ Mis Favoritos' : '⭐ My Favorites', 'show_favorites'),
        Markup.button.callback(lang === 'es' ? '🚫 Usuarios Bloqueados' : '🚫 Blocked Users', 'show_blocked'),
      ],
      [Markup.button.callback(t('back', lang), 'show_profile')],
    ]);

    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
  } catch (error) {
    logger.error('Error showing settings overview menu:', error);
  }
};


/**
 * Show user profile - Clean design
 */
const showProfile = async (ctx, targetUserId, edit = true, isOwnProfile = false) => {
  try {
    const lang = getLanguage(ctx);
    const viewerId = ctx.from.id;
    const botUsername = ctx.botInfo?.username || 'PNPLatinoTV_bot';

    const targetUser = await UserModel.getById(targetUserId);
    if (!targetUser) { await ctx.reply(t('userNotFound', lang)); return; }

    // Check blocks
    if (!isOwnProfile) {
      const isBlocked = await UserModel.isBlocked(targetUserId, viewerId);
      const hasBlockedTarget = await UserModel.isBlocked(viewerId, targetUserId);
      if (isBlocked || hasBlockedTarget) { await ctx.reply(t('cannotViewProfile', lang)); return; }
      await UserModel.incrementProfileViews(targetUserId);
    }

    // Build profile card text
    const displayName = targetUser.username ? `@${targetUser.username}` : (targetUser.firstName || 'User');

    // Location string
    let locationStr = '';
    if (targetUser.city && targetUser.country) {
      locationStr = `${targetUser.city}, ${targetUser.country}`;
    } else if (targetUser.city) {
      locationStr = targetUser.city;
    } else if (targetUser.country) {
      locationStr = targetUser.country;
    }

    // Build card lines
    const cardLines = [
      `👤 *${displayName}*`,
    ];

    // Badges
    if (targetUser.badges?.length > 0) {
      const badgeEmojis = targetUser.badges.map(b => {
        const map = { verified: '✅', premium: '💎', vip: '👑', moderator: '🛡️', trailblazer: '🏆' };
        return typeof b === 'string' ? (map[b] || '⭐') : (b.emoji || b.icon || '⭐');
      }).join(' ');
      if (badgeEmojis) cardLines.push(badgeEmojis);
    }

    cardLines.push('');

    if (targetUser.bio) cardLines.push(`📝 ${targetUser.bio}`);
    if (targetUser.tribe) cardLines.push(`🏳️‍🌈 ${targetUser.tribe}`);
    if (targetUser.looking_for) cardLines.push(`🔎 ${targetUser.looking_for}`);
    if (locationStr) cardLines.push(`📍 ${locationStr}`);

    // Subscription
    if (targetUser.subscriptionStatus === 'active') {
      cardLines.push(`💎 PRIME`);
    }

    cardLines.push('');
    cardLines.push(`💜 PNPtv`);

    const profileText = cardLines.join('\n');

    // Build keyboard
    const keyboard = [];

    // Interests popup button (if has interests)
    if (targetUser.interests?.length > 0) {
      keyboard.push([Markup.button.callback(`🎯 ${lang === 'es' ? 'Ver Intereses' : 'View Interests'}`, `profile_interests_${targetUserId}`)]);
    }

    // Social media links
    const socialButtons = [];
    if (targetUser.twitter) socialButtons.push(Markup.button.url('X', `https://x.com/${targetUser.twitter}`));
    if (targetUser.instagram) socialButtons.push(Markup.button.url('IG', `https://instagram.com/${targetUser.instagram}`));
    if (targetUser.tiktok) socialButtons.push(Markup.button.url('TikTok', `https://tiktok.com/@${targetUser.tiktok}`));
    if (targetUser.facebook) socialButtons.push(Markup.button.url('FB', `https://facebook.com/${targetUser.facebook}`));

    for (let i = 0; i < socialButtons.length; i += 3) {
      keyboard.push(socialButtons.slice(i, i + 3));
    }

    if (isOwnProfile) {
      // Own profile actions
      keyboard.push([
        Markup.button.callback(t('editProfile', lang), 'show_edit_profile_overview'),
        Markup.button.callback(t('settings', lang), 'show_settings_overview'),
      ]);
      keyboard.push([
        Markup.button.callback(lang === 'es' ? '📍 PNP Cercanos' : '📍 PNP Nearby', 'show_nearby_unified'),
        Markup.button.callback(t('shareProfile', lang), 'share_profile_direct'),
      ]);
      keyboard.push([Markup.button.callback(t('back', lang), 'back_to_main')]);
    } else {
      // Other user actions
      const viewer = await UserModel.getById(viewerId);
      const isFavorite = viewer.favorites?.includes(targetUserId.toString());
      keyboard.push([Markup.button.callback(
        isFavorite ? t('removeFromFavorites', lang) : t('addToFavorites', lang),
        isFavorite ? `remove_favorite_${targetUserId}` : `add_favorite_${targetUserId}`
      )]);
      keyboard.push([Markup.button.callback(t('blockUser', lang), `block_user_${targetUserId}`)]);
      keyboard.push([Markup.button.callback(t('back', lang), 'back_to_main')]);
    }

    // Send with photo if available
    if (targetUser.photoFileId) {
      if (edit && ctx.callbackQuery?.message?.message_id) {
        try { await ctx.deleteMessage(); } catch (e) {}
      }
      try {
        await ctx.replyWithPhoto(targetUser.photoFileId, {
          caption: profileText,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(keyboard),
        });
        return;
      } catch (e) {
        logger.error('Photo send failed, falling back to text:', e.message);
      }
    }

    // Text fallback
    if (edit) {
      await safeReplyOrEdit(ctx, profileText, Markup.inlineKeyboard(keyboard));
    } else {
      await ctx.reply(profileText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
    }

  } catch (error) {
    logger.error('Error in showProfile:', error);
    await ctx.reply(t('error', getLanguage(ctx)));
  }
};

/**
 * Share profile card directly to user's private chat, with option to share to group
 */
const shareProfileDirect = async (ctx) => {
  let lang = 'en';
  try {
    lang = getLanguage(ctx);
    const user = await UserModel.getById(ctx.from.id);
    if (!user) { await ctx.reply(t('error', lang)); return; }

    await ctx.answerCbQuery();

    const profileText = buildMemberProfileCard(user);

    const buttons = buildMemberProfileInlineKeyboard(user, lang);
    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '📤 Compartir en Grupo' : '📤 Share to Group',
        'share_to_group'
      ),
    ]);
    buttons.push([Markup.button.callback(t('back', lang), 'show_profile')]);
    const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;

    const baseOptions = { parse_mode: 'Markdown' };
    const sendOptions = keyboard ? { ...baseOptions, ...keyboard } : baseOptions;
    if (user.photoFileId) {
      try {
        await ctx.replyWithPhoto(user.photoFileId, {
          caption: profileText,
          ...sendOptions
        });
      } catch (photoError) {
        const description = photoError?.response?.description || photoError?.description || photoError?.message || '';
        if (String(description).toLowerCase().includes('wrong file identifier')) {
          await ctx.reply(profileText, {
            ...sendOptions
          });
          return;
        }
        throw photoError;
      }
    } else {
      await ctx.reply(profileText, {
        ...sendOptions
      });
    }
  } catch (error) {
    logger.error('Error sharing profile directly:', error);
    await ctx.reply(t('error', lang));
  }
};

/**
 * Share profile card to group
 */
const shareToGroup = async (ctx) => {
  let lang = 'en';
  try {
    lang = getLanguage(ctx);
    const user = await UserModel.getById(ctx.from.id);
    if (!user) { await ctx.reply(t('error', lang)); return; }

    if (!GROUP_ID) {
      await ctx.answerCbQuery(lang === 'es' ? 'Grupo no configurado' : 'Group not configured', { show_alert: true });
      return;
    }

    const profileText = buildMemberProfileCard(user);

    const buttons = buildMemberProfileInlineKeyboard(user, lang);
    const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;

    try {
      const baseOptions = { parse_mode: 'Markdown' };
      const sendOptions = keyboard ? { ...baseOptions, ...keyboard } : baseOptions;
      if (user.photoFileId) {
        try {
          await ctx.telegram.sendPhoto(GROUP_ID, user.photoFileId, {
            caption: profileText,
            ...sendOptions
          });
        } catch (photoError) {
          const description = photoError?.response?.description || photoError?.description || photoError?.message || '';
          if (String(description).toLowerCase().includes('wrong file identifier')) {
            await ctx.telegram.sendMessage(GROUP_ID, profileText, sendOptions);
          } else {
            throw photoError;
          }
        }
      } else {
        await ctx.telegram.sendMessage(GROUP_ID, profileText, sendOptions);
      }
      await ctx.answerCbQuery(lang === 'es' ? '✅ Tarjeta compartida en el grupo!' : '✅ Card shared to group!', { show_alert: true });
    } catch (error) {
      logger.error('Error sharing to group:', error);
      await ctx.answerCbQuery(lang === 'es' ? '❌ Error al compartir' : '❌ Error sharing', { show_alert: true });
    }
  } catch (error) {
    logger.error('Error in shareToGroup:', error);
  }
};

/**
 * Show privacy settings
 */
const showPrivacySettings = async (ctx) => {
  try {
    const lang = getLanguage(ctx);
    const user = await UserModel.getById(ctx.from.id);
    if (!user) { await ctx.reply(t('error', lang)); return; }

    const privacy = user.privacy || {
      showLocation: true, showInterests: true, showBio: true, allowMessages: true, showOnline: true,
    };

    const text = [
      `\`${lang === 'es' ? '⚙️ Privacidad' : '⚙️ Privacy Settings'}\``,
      '',
      `${privacy.showLocation ? '✅' : '❌'} ${t('showLocation', lang)}`,
      `${privacy.showInterests ? '✅' : '❌'} ${t('showInterests', lang)}`,
      `${privacy.showBio ? '✅' : '❌'} ${t('showBio', lang)}`,
      `${privacy.allowMessages ? '✅' : '❌'} ${t('allowMessages', lang)}`,
      `${privacy.showOnline ? '✅' : '❌'} ${t('showOnline', lang)}`,
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`${privacy.showLocation ? '✅' : '❌'} ${t('showLocation', lang)}`, 'privacy_toggle_showLocation')],
      [Markup.button.callback(`${privacy.showInterests ? '✅' : '❌'} ${t('showInterests', lang)}`, 'privacy_toggle_showInterests')],
      [Markup.button.callback(`${privacy.showBio ? '✅' : '❌'} ${t('showBio', lang)}`, 'privacy_toggle_showBio')],
      [Markup.button.callback(`${privacy.allowMessages ? '✅' : '❌'} ${t('allowMessages', lang)}`, 'privacy_toggle_allowMessages')],
      [Markup.button.callback(`${privacy.showOnline ? '✅' : '❌'} ${t('showOnline', lang)}`, 'privacy_toggle_showOnline')],
      [Markup.button.callback(t('back', lang), 'show_profile')],
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  } catch (error) {
    const description = error?.response?.description || error?.description || error?.message || '';
    if (String(description).toLowerCase().includes('message is not modified')) {
      return;
    }
    logger.error('Error showing privacy settings:', error);
  }
};

/**
 * Toggle privacy setting
 */
const togglePrivacySetting = async (ctx, setting) => {
  try {
    const lang = getLanguage(ctx);
    const user = await UserModel.getById(ctx.from.id);
    if (!user) { await ctx.reply(t('error', lang)); return; }

    const privacy = user.privacy || {
      showLocation: true, showInterests: true, showBio: true, allowMessages: true, showOnline: true,
    };
    privacy[setting] = !privacy[setting];

    await UserModel.updatePrivacy(ctx.from.id, privacy);
    await ctx.answerCbQuery(t('privacyUpdated', lang));
    await showPrivacySettings(ctx);
  } catch (error) {
    logger.error('Error toggling privacy setting:', error);
  }
};

/**
 * Show favorites
 */
const showFavorites = async (ctx) => {
  try {
    const lang = getLanguage(ctx);
    const favorites = await UserModel.getFavorites(ctx.from.id);

    if (!favorites?.length) {
      await ctx.editMessageText(
        t('noFavorites', lang),
        Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_profile')]]),
      );
      return;
    }

    let text = `\`⭐ ${lang === 'es' ? 'Mis Favoritos' : 'My Favorites'}\`\n\n`;
    const keyboard = [];

    favorites.forEach((user, i) => {
      text += `${i + 1}. ${user.firstName}${user.username ? ` (@${user.username})` : ''}\n`;
      keyboard.push([
        Markup.button.callback(`👁️ ${user.firstName}`, `view_user_${user.id}`),
        Markup.button.callback('❌', `remove_favorite_${user.id}`),
      ]);
    });

    keyboard.push([Markup.button.callback(t('back', lang), 'show_profile')]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
  } catch (error) {
    logger.error('Error showing favorites:', error);
  }
};

/**
 * Show blocked users
 */
const showBlockedUsers = async (ctx) => {
  try {
    const lang = getLanguage(ctx);
    const user = await UserModel.getById(ctx.from.id);

    if (!user?.blocked?.length) {
      await ctx.editMessageText(
        t('noBlockedUsers', lang),
        Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_profile')]]),
      );
      return;
    }

    let text = `\`🚫 ${lang === 'es' ? 'Usuarios Bloqueados' : 'Blocked Users'}\`\n\n`;
    const keyboard = [];

    for (const blockedId of user.blocked) {
      const blockedUser = await UserModel.getById(blockedId);
      if (blockedUser) {
        text += `• ${blockedUser.firstName}${blockedUser.username ? ` (@${blockedUser.username})` : ''}\n`;
        keyboard.push([Markup.button.callback(`✅ Unblock ${blockedUser.firstName}`, `unblock_user_${blockedId}`)]);
      }
    }

    keyboard.push([Markup.button.callback(t('back', lang), 'show_profile')]);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
  } catch (error) {
    logger.error('Error showing blocked users:', error);
  }
};

const addToFavorites = async (ctx, targetUserId) => {
  try {
    const lang = getLanguage(ctx);
    await UserModel.addToFavorites(ctx.from.id, targetUserId);
    await ctx.answerCbQuery(t('addedToFavorites', lang));
    await showProfile(ctx, targetUserId, true, false);
  } catch (error) {
    logger.error('Error adding to favorites:', error);
  }
};

const removeFromFavorites = async (ctx, targetUserId) => {
  try {
    const lang = getLanguage(ctx);
    await UserModel.removeFromFavorites(ctx.from.id, targetUserId);
    await ctx.answerCbQuery(t('removedFromFavorites', lang));
    if (ctx.callbackQuery?.message?.text?.includes('Favorites')) {
      await showFavorites(ctx);
    } else {
      await showProfile(ctx, targetUserId, true, false);
    }
  } catch (error) {
    logger.error('Error removing from favorites:', error);
  }
};

const blockUser = async (ctx, targetUserId) => {
  try {
    const lang = getLanguage(ctx);
    await UserModel.blockUser(ctx.from.id, targetUserId);
    await ctx.answerCbQuery(t('userBlocked', lang));
    await ctx.editMessageText(
      t('userBlocked', lang),
      Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'back_to_main')]]),
    );
  } catch (error) {
    logger.error('Error blocking user:', error);
  }
};

const unblockUser = async (ctx, targetUserId) => {
  try {
    const lang = getLanguage(ctx);
    await UserModel.unblockUser(ctx.from.id, targetUserId);
    await ctx.answerCbQuery(t('userUnblocked', lang));
    await showBlockedUsers(ctx);
  } catch (error) {
    logger.error('Error unblocking user:', error);
  }
};

module.exports = registerProfileHandlers;
module.exports.showProfile = showProfile;
module.exports.showEditProfileOverview = showEditProfileOverview;
module.exports.showSettingsOverview = showSettingsOverview;
module.exports.shareProfileDirect = shareProfileDirect;
