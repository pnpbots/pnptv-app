const { Markup } = require('telegraf');
const UserService = require('../../services/userService');
const NearbyPlaceService = require('../../services/nearbyPlaceService');
const { getLanguage } = require('../../utils/helpers');
const { buildMemberProfileCard, buildMemberProfileInlineKeyboard } = require('../../utils/memberProfileCard');
const logger = require('../../../utils/logger');

/**
 * Enhanced Profile Card System - World Class Profile Display
 * @param {Telegraf} bot - Bot instance
 */
const registerEnhancedProfileCards = (bot) => {
  
  // ===========================================
  // ENHANCED MEMBER PROFILE CARD
  // ===========================================
  bot.action(/^view_user_(.+)$/, async (ctx) => {
    try {
      // Validate match result exists
      if (!ctx.match || !ctx.match[1]) {
        logger.error('Invalid view user action format');
        return;
      }

      const targetUserId = ctx.match[1];
      const lang = getLanguage(ctx);

      const user = await UserService.getById(targetUserId);

      if (!user) {
        await ctx.answerCbQuery(lang === 'es' ? 'Usuario no encontrado' : 'User not found');
        return;
      }

      const profileText = buildMemberProfileCard(user);
      const buttons = buildMemberProfileInlineKeyboard(user, lang);
      buttons.push([
        Markup.button.callback(
          lang === 'es' ? '🔙 Volver a resultados' : '🔙 Back to results',
          'nearby_all'
        ),
      ]);
      const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;

      const baseOptions = { parse_mode: 'Markdown' };
      const sendOptions = keyboard ? { ...baseOptions, ...keyboard } : baseOptions;

      if (user.photoFileId) {
        try {
          await ctx.deleteMessage().catch(() => {});
          await ctx.replyWithPhoto(user.photoFileId, {
            caption: profileText,
            ...sendOptions,
          });
          return;
        } catch (photoError) {
          logger.error('Error sending member photo:', photoError);
        }
      }

      await ctx.editMessageText(profileText, {
        ...sendOptions,
      });
    } catch (error) {
      logger.error('Error viewing enhanced user profile:', error);
    }
  });

  // ===========================================
  // ENHANCED BUSINESS PROFILE CARD
  // ===========================================
  bot.action(/^view_place_(\d+)$/, async (ctx) => {
    try {
      const placeId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);

      const place = await NearbyPlaceService.getPlaceDetails(placeId, true);

      if (!place) {
        await ctx.answerCbQuery(lang === 'es' ? 'Lugar no encontrado' : 'Place not found');
        return;
      }

      // Build enhanced business profile card
      const profileCard = buildEnhancedBusinessProfileCard(place, lang);
      const buttons = createBusinessProfileButtons(place, lang);

      // Send with photo if available, otherwise just text
      if (place.photoFileId) {
        try {
          await ctx.deleteMessage().catch(() => {});
          await ctx.replyWithPhoto(place.photoFileId, {
            caption: profileCard.text,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        } catch (photoError) {
          logger.error('Error sending business photo:', photoError);
          await ctx.editMessageText(profileCard.text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          });
        }
      } else {
        await ctx.editMessageText(profileCard.text, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        });
      }
    } catch (error) {
      logger.error('Error viewing enhanced place details:', error);
    }
  });

  // ===========================================
  // PROFILE CARD BUILDERS
  // ===========================================

  /**
   * Build enhanced member profile card
   */
  function buildEnhancedMemberProfileCard(user, lang) {
    const isSpanish = lang === 'es';
    
    // Build the profile card in the requested format
    let text = '';
    
    // Header: User Name - Badges - Bio - Looking For - Tribe
    text += '`👤 ' + (isSpanish ? 'PERFIL' : 'PROFILE') + '`\n\n';
    
    // Line 1: User Name - Badges
    const displayName = escapeMarkdown(getDisplayName(user));
    text += `👑 *${displayName}*`;
    
    // Add badges if available
    if (user.badges && user.badges.length > 0) {
      // Show first badge
      text += ` ${user.badges[0]}`;
    } else if (user.subscriptionStatus && user.subscriptionStatus !== 'basic') {
      const tierInfo = getUserTierInfo(user);
      text += ` ${tierInfo.badge}`;
    }
    text += '\n';
    
    // Line 2: Username
    if (user.username) {
      text += `@${user.username}\n`;
    }
    
    // Line 3: Bio (single line)
    if (user.bio) {
      // Show first line of bio only
      const bioFirstLine = user.bio.split('\n')[0];
      text += `📝 "${escapeMarkdown(bioFirstLine)}"\n`;
    }
    
    // Line 4: Looking For - Tribe
    if (user.looking_for) {
      text += `👀 ${isSpanish ? 'Buscando' : 'Looking for'}: ${user.looking_for}`;
    }
    
    // Add tribe if available
    if (user.tribe) {
      if (user.looking_for) text += ` | `;
      text += `🏷️ ${user.tribe}`;
    }
    
    if (user.looking_for || user.tribe) {
      text += '\n\n';
    } else {
      text += '\n';
    }
    
    // Line 5: Location (if available)
    if (user.location && (user.city || user.country)) {
      text += `📍 ${isSpanish ? 'Ubicación' : 'Location'}:`;
      if (user.city) text += ` 🏙️ ${escapeMarkdown(user.city)}`;
      if (user.country) text += ` 🌍 ${escapeMarkdown(user.country)}`;
      text += '\n\n';
    }
    
    return { text };
  }

  /**
   * Build enhanced business profile card
   */
  function buildEnhancedBusinessProfileCard(place, lang) {
    const isSpanish = lang === 'es';
    
    // Calculate business profile score
    const profileScore = calculateBusinessProfileScore(place);
    const scoreStars = getScoreStars(profileScore);
    
    let text = '';
    
    // Header with category and score
    text += `${place.categoryEmoji || '🏪'} *${escapeMarkdown(place.name)}* ${scoreStars}\n\n`;
    
    // Business type and ID
    text += `🆔${place.id} • ${place.placeType === 'business' ? (isSpanish ? 'Negocio Comunitario' : 'Community Business') : (isSpanish ? 'Lugar de Interés' : 'Place of Interest')}\n\n`;
    
    // Description
    if (place.description) {
      text += `📝 *${isSpanish ? 'Descripción' : 'Description'}:\n*\n`;
      text += `${escapeMarkdown(place.description)}\n\n`;
    }
    
    // Location information
    if (place.address || place.city || place.location) {
      text += `📍 *${isSpanish ? 'Ubicación' : 'Location'}:\n*\n`;
      if (place.address) text += `🏠 ${escapeMarkdown(place.address)}\n`;
      if (place.city) text += `🏙️ ${escapeMarkdown(place.city)}\n`;
      if (place.country) text += `🌍 ${escapeMarkdown(place.country)}\n`;
      if (place.location) {
        text += `📡 ${isSpanish ? 'Coordenadas' : 'Coordinates'}: ${place.location.lat.toFixed(4)}, ${place.location.lng.toFixed(4)}\n`;
      }
      if (place.distance !== undefined) {
        text += `📏 ${place.distance.toFixed(1)} km ${isSpanish ? 'de distancia' : 'away'}\n`;
      }
      text += '\n';
    }
    
    // Contact information
    const contactMethods = getContactMethods(place);
    if (contactMethods.length > 0) {
      text += `📞 *${isSpanish ? 'Contacto' : 'Contact'}:\n*\n`;
      text += contactMethods.join('\n') + '\n\n';
    }
    
    // Business hours
    if (place.hoursOfOperation) {
      text += `⏰ *${isSpanish ? 'Horario' : 'Business Hours'}:\n*\n`;
      text += formatBusinessHours(place.hoursOfOperation) + '\n\n';
    }
    
    // Price range
    if (place.priceRange) {
      text += `💰 *${isSpanish ? 'Rango de Precios' : 'Price Range'}: ${place.priceRange}*\n\n`;
    }
    
    // Additional business information
    if (place.website || place.email || place.phone) {
      text += `🌐 *${isSpanish ? 'Información Adicional' : 'Additional Info'}:\n*\n`;
      if (place.website) text += `🔗 ${place.website}\n`;
      if (place.email) text += `✉️ ${place.email}\n`;
      if (place.phone) text += `📞 ${place.phone}\n`;
      text += '\n';
    }
    
    // Business statistics
    text += `📊 *${isSpanish ? 'Estadísticas' : 'Statistics'}:\n*\n`;
    text += `👁️ ${isSpanish ? 'Vistas' : 'Views'}: ${place.viewCount || 0}\n`;
    text += `📅 ${isSpanish ? 'Agregado' : 'Added'}: ${formatDate(place.createdAt)}\n`;
    text += `💎 ${isSpanish ? 'Calidad' : 'Profile Score'}: ${profileScore}/5\n\n`;
    
    // Community information
    if (place.isCommunityOwned) {
      text += `🤝 *${isSpanish ? 'Información Comunitaria' : 'Community Info'}:\n*\n`;
      text += `✅ ${isSpanish ? 'Negocio verificado por la comunidad' : 'Community verified business'}\n`;
      text += `💬 ${isSpanish ? '¿Conoces este lugar?' : 'Know this place?'} ${isSpanish ? '¡Propón mejoras!' : 'Suggest improvements!'}\n\n`;
    }
    
    // Call to action
    text += getBusinessCTA(place, lang);
    
    return { text, profileScore };
  }

  // ===========================================
  // BUTTON CREATORS
  // ===========================================

  /**
   * Create member profile buttons
   * Inline menu format: [Interests] [X] [FB] [IG]
   */
  function createMemberProfileButtons(user, userId, lang) {
    const isSpanish = lang === 'es';
    const buttons = [];
    
    // Inline menu row: [Interests] [X] [FB] [IG]
    const inlineMenuButtons = [];
    
    // Interests button (if user has interests)
    if (user.interests && user.interests.length > 0) {
      inlineMenuButtons.push(Markup.button.callback('🎯', 'show_interests_'));
    }
    
    // Social media buttons
    if (user.twitter) {
      inlineMenuButtons.push(Markup.button.url('𝕏', `https://twitter.com/${user.twitter}`));
    }
    if (user.facebook) {
      inlineMenuButtons.push(Markup.button.url('📘', `https://facebook.com/${user.facebook}`));
    }
    if (user.instagram) {
      inlineMenuButtons.push(Markup.button.url('📸', `https://instagram.com/${user.instagram}`));
    }
    
    // Add inline menu row if we have any buttons
    if (inlineMenuButtons.length > 0) {
      buttons.push(inlineMenuButtons);
    }
    
    // Contact button (separate row) - always show, use username or user ID deep link
    if (user.username) {
      const cleanUsername = user.username.replace(/^@/, '');
      buttons.push([
        Markup.button.url(`💬 ${isSpanish ? 'Enviar DM' : 'Send DM'}`, `https://t.me/${cleanUsername}`)
      ]);
    } else if (user.id) {
      buttons.push([
        Markup.button.url(`💬 ${isSpanish ? 'Enviar DM' : 'Send DM'}`, `tg://user?id=${user.id}`)
      ]);
    }
    
    // Back button
    buttons.push([
      Markup.button.callback('🔙 ' + (isSpanish ? 'Volver' : 'Back'), 'show_nearby_unified')
    ]);
    
    return Markup.inlineKeyboard(buttons);
  }

  /**
   * Create business profile buttons
   */
  function createBusinessProfileButtons(place, lang) {
    const isSpanish = lang === 'es';
    const buttons = [];
    
    // Contact buttons - prioritize Telegram
    if (place.telegramUsername) {
      buttons.push([
        Markup.button.url('💬 Telegram', `https://t.me/${place.telegramUsername}`)
      ]);
    }
    
    // Website button
    if (place.website) {
      buttons.push([
        Markup.button.url('🌐 Website', place.website)
      ]);
    }
    
    // Instagram button
    if (place.instagram) {
      buttons.push([
        Markup.button.url('📸 Instagram', `https://instagram.com/${place.instagram}`)
      ]);
    }
    
    // Phone button
    if (place.phone) {
      buttons.push([
        Markup.button.url('📞 Call', `tel:${place.phone}`)
      ]);
    }
    
    // Map button if location available
    if (place.location) {
      buttons.push([
        Markup.button.url(
          '🗺️ ' + (isSpanish ? 'Abrir en Maps' : 'Open in Maps'),
          `https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}`
        )
      ]);
    }
    
    // Additional actions row
    const actionButtons = [];
    
    // Save/favorite button
    actionButtons.push(Markup.button.callback('⭐ ' + (isSpanish ? 'Guardar' : 'Save'), `save_place_${place.id}`));
    
    // Share button
    actionButtons.push(Markup.button.callback('📤 ' + (isSpanish ? 'Compartir' : 'Share'), `share_place_${place.id}`));
    
    if (actionButtons.length > 0) {
      buttons.push(actionButtons);
    }
    
    // Back button
    const backAction = place.placeType === 'business' ? 'nearby_businesses' : 'nearby_places';
    buttons.push([
      Markup.button.callback('🔙 ' + (isSpanish ? 'Volver' : 'Back'), backAction)
    ]);
    
    return Markup.inlineKeyboard(buttons);
  }

  // ===========================================
  // HELPER FUNCTIONS
  // ===========================================

  function getDisplayName(user) {
    let name = user.firstName || '';
    if (user.lastName) name += ' ' + user.lastName;
    return name.trim() || (user.username ? user.username : 'Anonymous');
  }

  function calculateProfileCompletion(user) {
    let score = 0;
    const maxScore = 10;
    
    // Basic info
    if (user.firstName) score += 1;
    if (user.lastName) score += 0.5;
    if (user.username) score += 1;
    
    // Bio and interests
    if (user.bio && user.bio.length > 20) score += 2;
    if (user.interests && user.interests.length > 0) score += 1;
    
    // Location
    if (user.location) score += 1.5;
    if (user.city) score += 0.5;
    if (user.country) score += 0.5;
    
    // Social media
    if (user.instagram) score += 0.5;
    if (user.twitter) score += 0.5;
    if (user.tiktok) score += 0.5;
    
    // Personal info
    if (user.age) score += 0.5;
    if (user.gender) score += 0.5;
    if (user.looking_for) score += 0.5;
    
    return Math.round((score / maxScore) * 100);
  }

  function getCompletionBar(completion) {
    const filled = Math.round(completion / 10);
    const empty = 10 - filled;
    return '■'.repeat(filled) + '□'.repeat(empty);
  }

  function getUserTierInfo(user) {
    const tier = user.subscriptionStatus || 'basic';
    
    const tiers = {
      basic: { name: 'Basic', badge: '', benefits: 'Standard features' },
      premium: { name: 'Premium', badge: '💎', benefits: 'Enhanced visibility, advanced features' },
      crystal: { name: 'Crystal', badge: '💠', benefits: 'Priority support, exclusive content' },
      diamond: { name: 'Diamond', badge: '🔷', benefits: 'VIP access, all premium features' },
      pnp: { name: 'PNP', badge: '🏆', benefits: 'Elite status, special privileges' },
      admin: { name: 'Admin', badge: '👑', benefits: 'Full access, moderation tools' },
      superadmin: { name: 'Super Admin', badge: '👑⚡', benefits: 'Complete control, all features' }
    };
    
    return tiers[tier] || tiers.basic;
  }

  function getSocialMediaLinks(user) {
    const links = [];
    
    if (user.instagram) links.push(`📸 Instagram: @${user.instagram}`);
    if (user.twitter) links.push(`𝕏 Twitter: @${user.twitter}`);
    if (user.tiktok) links.push(`🎵 TikTok: @${user.tiktok}`);
    if (user.facebook) links.push(`👥 Facebook: ${user.facebook}`);
    if (user.snapchat) links.push(`👻 Snapchat: @${user.snapchat}`);
    
    return links;
  }

  function calculateBusinessProfileScore(place) {
    let score = 1; // Base score
    
    // Description quality
    if (place.description && place.description.length > 50) score += 0.5;
    if (place.description && place.description.length > 150) score += 0.5;
    
    // Location completeness
    if (place.address) score += 0.5;
    if (place.city) score += 0.3;
    if (place.country) score += 0.2;
    if (place.location) score += 0.5;
    
    // Contact methods
    const contacts = [];
    if (place.phone) contacts.push('phone');
    if (place.email) contacts.push('email');
    if (place.website) contacts.push('website');
    if (place.telegramUsername) contacts.push('telegram');
    if (place.instagram) contacts.push('instagram');
    
    if (contacts.length >= 1) score += 0.5;
    if (contacts.length >= 2) score += 0.5;
    if (contacts.length >= 3) score += 0.3;
    
    // Business hours
    if (place.hoursOfOperation) score += 0.5;
    
    // Media
    if (place.photoFileId) score += 0.8;
    
    // Additional info
    if (place.priceRange) score += 0.2;
    
    return Math.min(5, Math.round(score * 10) / 10);
  }

  function getScoreStars(score) {
    const fullStars = Math.floor(score);
    const halfStar = score % 1 >= 0.5 ? '⭐' : '';
    const emptyStars = 5 - Math.ceil(score);
    
    return '⭐'.repeat(fullStars) + halfStar + '☆'.repeat(emptyStars);
  }

  function getContactMethods(place) {
    const methods = [];
    
    if (place.phone) methods.push(`📞 ${place.phone}`);
    if (place.telegramUsername) methods.push(`💬 @${place.telegramUsername}`);
    if (place.instagram) methods.push(`📸 @${place.instagram}`);
    if (place.website) methods.push(`🌐 ${place.website}`);
    if (place.email) methods.push(`✉️ ${place.email}`);
    
    return methods;
  }

  function formatBusinessHours(hours) {
    if (typeof hours === 'string') return hours;
    if (!hours || typeof hours !== 'object') return 'Not specified';
    
    try {
      return Object.entries(hours).map(([day, time]) => {
        if (!time || time === 'closed') return `${day}: 🔴 Closed`;
        return `${day}: 🟢 ${time}`;
      }).join('\n');
    } catch (error) {
      return 'Not specified';
    }
  }

  function formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'N/A';
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'N/A';
    }
  }

  function getProfileCTA(user, lang) {
    const isSpanish = lang === 'es';
    const ctaMessages = [
      isSpanish ? '¡Conéctate y haz nuevos amigos!' : 'Connect and make new friends!',
      isSpanish ? '¿Interesado? ¡Envía un mensaje!' : 'Interested? Send a message!',
      isSpanish ? 'No seas tímido... ¡Hablemos!' : 'Don\'t be shy... Let\'s chat!',
      isSpanish ? '¿Quieres conocer más? ¡DM ahora!' : 'Want to know more? DM now!'
    ];
    
    const randomCTA = ctaMessages[Math.floor(Math.random() * ctaMessages.length)];
    
    return `💬 *${randomCTA}*`;
  }

  function getBusinessCTA(place, lang) {
    const isSpanish = lang === 'es';
    const ctaMessages = [
      isSpanish ? '¡Visita este lugar hoy!' : 'Visit this place today!',
      isSpanish ? '¿Te gusta? ¡Compártelo con amigos!' : 'Like it? Share with friends!',
      isSpanish ? '¡Apoya negocios locales!' : 'Support local businesses!',
      isSpanish ? '¿Conoces este lugar? ¡Déjanos tu opinión!' : 'Know this place? Leave us your review!'
    ];
    
    const randomCTA = ctaMessages[Math.floor(Math.random() * ctaMessages.length)];
    
    return `💙 *${randomCTA}*`;
  }

  function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*\\[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  // ===========================================
  // ACTION HANDLERS
  // ===========================================

  // Save place to favorites
  bot.action(/^save_place_(\d+)$/, async (ctx) => {
    try {
      const placeId = parseInt(ctx.match[1]);
      const userId = ctx.from.id.toString();
      const lang = getLanguage(ctx);

      const result = await UserService.saveFavoritePlace(userId, placeId);

      if (result.success) {
        await ctx.answerCbQuery(
          lang === 'es' ? '⭐ Guardado en favoritos!' : '⭐ Saved to favorites!',
          { show_alert: false }
        );
      } else {
        await ctx.answerCbQuery(
          lang === 'es' ? '❌ Error al guardar' : '❌ Error saving',
          { show_alert: true }
        );
      }
    } catch (error) {
      logger.error('Error saving place to favorites:', error);
      await ctx.answerCbQuery('Error');
    }
  });

  // Share place
  bot.action(/^share_place_(\d+)$/, async (ctx) => {
    try {
      const placeId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);

      const place = await NearbyPlaceService.getPlaceDetails(placeId);
      
      if (place) {
        const shareText = lang === 'es'
          ? `📍 ${place.name}\n\n${place.description}\n\n${place.address}\n\n#PNPtv #NegociosLocales`
          : `📍 ${place.name}\n\n${place.description}\n\n${place.address}\n\n#PNPtv #LocalBusiness`;

        await ctx.answerCbQuery(shareText, {
          url: `https://t.me/share/url?url=${encodeURIComponent(shareText)}`
        });
      }
    } catch (error) {
      logger.error('Error sharing place:', error);
    }
  });
};

module.exports = registerEnhancedProfileCards;
