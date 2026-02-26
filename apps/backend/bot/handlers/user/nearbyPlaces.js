const { Markup } = require('telegraf');
const NearbyPlaceService = require('../../services/nearbyPlaceService');
const UserService = require('../../services/userService');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');

/**
 * Nearby places handlers - Place categories and submission functionality
 * Main nearby menu is in nearbyUnified.js
 * @param {Telegraf} bot - Bot instance
 */
const PLACE_CATEGORY_GROUPS = [
  {
    key: 'nightlife',
    emoji: '🌙',
    nameEn: 'Nightlife & Adult',
    nameEs: 'Vida Nocturna y +18',
    slugs: ['bars_clubs', 'adult_entertainment', 'cruising', 'saunas'],
  },
  {
    key: 'wellness',
    emoji: '🧘',
    nameEn: 'Wellness & Support',
    nameEs: 'Bienestar y Apoyo',
    slugs: ['wellness', 'help_centers'],
  },
  {
    key: 'pnp',
    emoji: '💨',
    nameEn: 'PNP Friendly',
    nameEs: 'PNP Amigable',
    slugs: ['pnp_friendly'],
  },
];

const getPlaceCategoryGroups = (categories, lang) => {
  const categoryBySlug = new Map(categories.map(cat => [cat.slug, cat]));

  return PLACE_CATEGORY_GROUPS.map(group => {
    const groupCategories = group.slugs
      .map(slug => categoryBySlug.get(slug))
      .filter(Boolean);
    const categoryIds = groupCategories.map(cat => cat.id);
    const requiresAgeVerification = groupCategories.some(cat => cat.requiresAgeVerification);

    return {
      ...group,
      name: lang === 'es' ? group.nameEs : group.nameEn,
      categories: groupCategories,
      categoryIds,
      requiresAgeVerification,
    };
  }).filter(group => group.categoryIds.length > 0);
};

const registerNearbyPlacesHandlers = (bot) => {

  // ===========================================
  // PLACES OF INTEREST - Categories
  // ===========================================
  bot.action('nearby_places_categories', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const categories = await NearbyPlaceService.getCategories(lang);

      // Filter out community_business as it has its own menu
      const placeCategories = categories.filter(c => c.slug !== 'community_business');
      const groupedCategories = getPlaceCategoryGroups(placeCategories, lang);

      const buttons = groupedCategories.map(group => [
        Markup.button.callback(
          `${group.emoji} ${group.name}${group.requiresAgeVerification ? ' 🔞' : ''}`,
          `nearby_place_group_${group.key}`
        ),
      ]);

      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      await ctx.editMessageText(
        lang === 'es'
          ? '📍 *Lugares de Interés*\n\n' +
            'Selecciona un grupo:\n\n' +
            '_🔞 indica que requiere verificación de edad_'
          : '📍 *Places of Interest*\n\n' +
            'Select a group:\n\n' +
            '_🔞 indicates age verification required_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      logger.error('Error showing place categories:', error);
    }
  });

  // ===========================================
  // PLACES BY CATEGORY
  // ===========================================
  bot.action(/^nearby_place_group_(\w+)$/, async (ctx) => {
    try {
      const groupKey = ctx.match[1];
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();
      const categories = await NearbyPlaceService.getCategories(lang);
      const placeCategories = categories.filter(c => c.slug !== 'community_business');
      const groupedCategories = getPlaceCategoryGroups(placeCategories, lang);
      const group = groupedCategories.find(item => item.key === groupKey);

      if (!group) {
        await ctx.answerCbQuery(lang === 'es' ? 'Grupo inválido' : 'Invalid group', {
          show_alert: true,
        });
        return;
      }

      if (group.requiresAgeVerification) {
        const user = await UserService.getOrCreateFromContext(ctx);
        if (!user.ageVerified) {
          await ctx.answerCbQuery(
            lang === 'es' ? '🔞 Requiere verificación de edad' : '🔞 Age verification required',
            { show_alert: true }
          );
          return;
        }
      }

      await ctx.editMessageText(
        lang === 'es' ? '🔍 _Buscando lugares..._' : '🔍 _Searching for places..._',
        { parse_mode: 'Markdown' }
      );

      const result = await NearbyPlaceService.getNearbyPlacesOfInterest(
        userId,
        50,
        group.categoryIds
      );

      if (!result.success && result.error === 'no_location') {
        await showNoLocationMessage(ctx, lang, 'nearby_places_categories');
        return;
      }

      if (result.places.length === 0) {
        await ctx.editMessageText(
          lang === 'es'
            ? `${group.emoji} *${group.name}*\n\n` +
              'No hay lugares en este grupo cerca de ti.\n\n' +
              '¿Conoces alguno? ¡Propónlo!'
            : `${group.emoji} *${group.name}*\n\n` +
              'No places in this group near you.\n\n' +
              'Know any? Suggest one!',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(
                lang === 'es' ? '➕ Proponer Lugar' : '➕ Suggest Place',
                `submit_place_group_${group.key}`
              )],
              [Markup.button.callback('🔙 Back', 'nearby_places_categories')],
            ]),
          }
        );
        return;
      }

      await showPlacesList(ctx, result.places, lang, 'place', null, group.key);
    } catch (error) {
      logger.error('Error showing places by group:', error);
    }
  });

  bot.action(/^nearby_cat_(\d+)$/, async (ctx) => {
    try {
      const categoryId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      // Get category info
      const category = await NearbyPlaceService.getCategory(categoryId);

      // Check age verification for adult categories
      if (category?.requiresAgeVerification) {
        const user = await UserService.getOrCreateFromContext(ctx);
        if (!user.ageVerified) {
          await ctx.answerCbQuery(
            lang === 'es' ? '🔞 Requiere verificación de edad' : '🔞 Age verification required',
            { show_alert: true }
          );
          return;
        }
      }

      await ctx.editMessageText(
        lang === 'es' ? '🔍 _Buscando lugares..._' : '🔍 _Searching for places..._',
        { parse_mode: 'Markdown' }
      );

      const result = await NearbyPlaceService.getNearbyPlacesOfInterest(userId, 50, categoryId);

      if (!result.success && result.error === 'no_location') {
        await showNoLocationMessage(ctx, lang, 'nearby_places_categories');
        return;
      }

      const categoryName = lang === 'es' ? category?.nameEs : category?.nameEn;
      const categoryEmoji = category?.emoji || '📍';

      if (result.places.length === 0) {
        await ctx.editMessageText(
          lang === 'es'
            ? `${categoryEmoji} *${categoryName || 'Lugares'}*\n\n` +
              'No hay lugares en esta categoría cerca de ti.\n\n' +
              '¿Conoces alguno? ¡Propónlo!'
            : `${categoryEmoji} *${categoryName || 'Places'}*\n\n` +
              'No places in this category near you.\n\n' +
              'Know any? Suggest one!',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(
                lang === 'es' ? '➕ Proponer Lugar' : '➕ Suggest Place',
                `submit_place_cat_${categoryId}`
              )],
              [Markup.button.callback('🔙 Back', 'nearby_places_categories')],
            ]),
          }
        );
        return;
      }

      await showPlacesList(ctx, result.places, lang, 'place', categoryId);
    } catch (error) {
      logger.error('Error showing places by category:', error);
    }
  });

  // ===========================================
  // SUBMIT PLACE FLOW - Start
  // ===========================================
  bot.action('submit_place_start', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      // Initialize submission session
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.placeSubmission = {
        step: 'type',
      };
      await ctx.saveSession();

      await ctx.editMessageText(
        lang === 'es'
          ? '➕ *Proponer un Lugar*\n\n' +
            '¿Qué tipo de lugar quieres proponer?'
          : '➕ *Suggest a Place*\n\n' +
            'What type of place do you want to suggest?',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(
              lang === 'es' ? '🏪 Negocio Comunitario' : '🏪 Community Business',
              'submit_type_business'
            )],
            [Markup.button.callback(
              lang === 'es' ? '📍 Lugar de Interés' : '📍 Place of Interest',
              'submit_type_place'
            )],
            [Markup.button.callback('❌ Cancel', 'show_nearby')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting place submission:', error);
    }
  });

  // Redirect old business submission to new enhanced system
  bot.action('submit_place_business', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      await ctx.answerCbQuery(lang === 'es' ? 'Redirigiendo...' : 'Redirecting...');

      // Call the new business submission handler
      ctx.callbackQuery.data = 'submit_business_profile';
      await bot.handleUpdate(ctx.update);
    } catch (error) {
      logger.error('Error redirecting to new business submission:', error);
    }
  });

  // Quick submission for place in category
  bot.action(/^submit_place_cat_(\d+)$/, async (ctx) => {
    try {
      const categoryId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.placeSubmission = {
        step: 'name',
        placeType: 'place_of_interest',
        categoryId: categoryId,
      };
      await ctx.saveSession();

      await ctx.editMessageText(
        lang === 'es'
          ? '📝 *Paso 1/6: Nombre*\n\n' +
            'Escribe el nombre del lugar:'
          : '📝 *Step 1/6: Name*\n\n' +
            'Enter the name of the place:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'show_nearby')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting place submission:', error);
    }
  });

  bot.action(/^submit_place_group_(\w+)$/, async (ctx) => {
    try {
      const groupKey = ctx.match[1];
      const lang = getLanguage(ctx);
      const categories = await NearbyPlaceService.getCategories(lang);
      const placeCategories = categories.filter(c => c.slug !== 'community_business');
      const groupedCategories = getPlaceCategoryGroups(placeCategories, lang);
      const group = groupedCategories.find(item => item.key === groupKey);

      if (!group) {
        await ctx.answerCbQuery(lang === 'es' ? 'Grupo inválido' : 'Invalid group', {
          show_alert: true,
        });
        return;
      }

      if (group.requiresAgeVerification) {
        const user = await UserService.getOrCreateFromContext(ctx);
        if (!user.ageVerified) {
          await ctx.answerCbQuery(
            lang === 'es' ? '🔞 Requiere verificación de edad' : '🔞 Age verification required',
            { show_alert: true }
          );
          return;
        }
      }

      const buttons = group.categories.map(cat => [
        Markup.button.callback(
          `${cat.emoji} ${cat.name}`,
          `submit_select_cat_${cat.id}`
        ),
      ]);
      buttons.push([Markup.button.callback('❌ Cancel', 'show_nearby')]);

      await ctx.editMessageText(
        lang === 'es'
          ? '📂 *Selecciona la categoría:*'
          : '📂 *Select the category:*',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      logger.error('Error selecting group category:', error);
    }
  });

  // Select type
  bot.action('submit_type_business', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.placeSubmission = {
        ...ctx.session.temp.placeSubmission,
        step: 'name',
        placeType: 'business',
      };

      // Get community business category
      const categories = await NearbyPlaceService.getCategories(lang);
      const communityBizCat = categories.find(c => c.slug === 'community_business');
      if (communityBizCat) {
        ctx.session.temp.placeSubmission.categoryId = communityBizCat.id;
      }

      await ctx.saveSession();

      await ctx.editMessageText(
        lang === 'es'
          ? '📝 *Paso 1/6: Nombre*\n\n' +
            'Escribe el nombre del negocio:'
          : '📝 *Step 1/6: Name*\n\n' +
            'Enter the name of the business:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'show_nearby')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting business type:', error);
    }
  });

  bot.action('submit_type_place', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.placeSubmission = {
        ...ctx.session.temp.placeSubmission,
        step: 'category',
        placeType: 'place_of_interest',
      };
      await ctx.saveSession();

      // Show category selection
      const categories = await NearbyPlaceService.getCategories(lang);
      const placeCategories = categories.filter(c => c.slug !== 'community_business');
      const groupedCategories = getPlaceCategoryGroups(placeCategories, lang);

      const buttons = groupedCategories.map(group => [
        Markup.button.callback(
          `${group.emoji} ${group.name}${group.requiresAgeVerification ? ' 🔞' : ''}`,
          `submit_place_group_${group.key}`
        ),
      ]);
      buttons.push([Markup.button.callback('❌ Cancel', 'show_nearby')]);

      await ctx.editMessageText(
        lang === 'es'
          ? '📂 *Selecciona el grupo:*'
          : '📂 *Select the group:*',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      logger.error('Error selecting place type:', error);
    }
  });

  // Select category for place submission
  bot.action(/^submit_select_cat_(\d+)$/, async (ctx) => {
    try {
      const categoryId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.placeSubmission = {
        ...ctx.session.temp.placeSubmission,
        step: 'name',
        categoryId: categoryId,
      };
      await ctx.saveSession();

      await ctx.editMessageText(
        lang === 'es'
          ? '📝 *Paso 1/6: Nombre*\n\n' +
            'Escribe el nombre del lugar:'
          : '📝 *Step 1/6: Name*\n\n' +
            'Enter the name of the place:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'show_nearby')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting category:', error);
    }
  });

  // Skip optional steps
  bot.action('submit_skip_description', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      ctx.session.temp.placeSubmission.step = 'address';
      ctx.session.temp.placeSubmission.description = null;
      await ctx.saveSession();

      await ctx.editMessageText(
        lang === 'es'
          ? '📝 *Paso 3/6: Dirección*\n\n' +
            'Escribe la dirección del lugar:\n\n' +
            '_Ejemplo: Calle 123, Ciudad_'
          : '📝 *Step 3/6: Address*\n\n' +
            'Enter the address of the place:\n\n' +
            '_Example: 123 Main St, City_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '⏭️ Omitir' : '⏭️ Skip', 'submit_skip_address')],
            [Markup.button.callback('❌ Cancel', 'show_nearby')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error skipping description:', error);
    }
  });

  bot.action('submit_skip_address', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      ctx.session.temp.placeSubmission.step = 'city';
      ctx.session.temp.placeSubmission.address = null;
      await ctx.saveSession();

      await ctx.editMessageText(
        lang === 'es'
          ? '📝 *Paso 4/6: Ciudad*\n\n' +
            'Escribe la ciudad donde se encuentra:'
          : '📝 *Step 4/6: City*\n\n' +
            'Enter the city where it is located:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '⏭️ Omitir' : '⏭️ Skip', 'submit_skip_city')],
            [Markup.button.callback('❌ Cancel', 'show_nearby')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error skipping address:', error);
    }
  });

  bot.action('submit_skip_city', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      ctx.session.temp.placeSubmission.step = 'contact';
      ctx.session.temp.placeSubmission.city = null;
      await ctx.saveSession();

      await ctx.editMessageText(
        lang === 'es'
          ? '📝 *Paso 5/6: Contacto (opcional)*\n\n' +
            'Escribe información de contacto:\n' +
            '- Teléfono\n' +
            '- Website\n' +
            '- @usuario de Telegram\n' +
            '- Instagram\n\n' +
            '_Puedes enviar uno o varios_'
          : '📝 *Step 5/6: Contact (optional)*\n\n' +
            'Enter contact information:\n' +
            '- Phone\n' +
            '- Website\n' +
            '- Telegram @username\n' +
            '- Instagram\n\n' +
            '_You can send one or multiple_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '⏭️ Omitir' : '⏭️ Skip', 'submit_skip_contact')],
            [Markup.button.callback('❌ Cancel', 'show_nearby')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error skipping city:', error);
    }
  });

  bot.action('submit_skip_contact', async (ctx) => {
    try {
      await finalizeSubmission(ctx);
    } catch (error) {
      logger.error('Error skipping contact:', error);
    }
  });

  // Confirm submission
  bot.action('submit_confirm', async (ctx) => {
    try {
      await finalizeSubmission(ctx);
    } catch (error) {
      logger.error('Error confirming submission:', error);
    }
  });

  // ===========================================
  // MY SUBMISSIONS
  // ===========================================
  bot.action('my_place_submissions', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      const submissions = await NearbyPlaceService.getUserSubmissions(userId, 10);

      if (submissions.length === 0) {
        await ctx.editMessageText(
          lang === 'es'
            ? '📋 *Mis Propuestas*\n\n' +
              'No has enviado ninguna propuesta aún.'
            : '📋 *My Submissions*\n\n' +
              'You haven\'t submitted any places yet.',
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

      let text = lang === 'es'
        ? '📋 *Mis Propuestas*\n\n' +
          '_Toca una propuesta pendiente para editarla_\n\n'
        : '📋 *My Submissions*\n\n' +
          '_Tap a pending submission to edit it_\n\n';

      const buttons = [];

      submissions.forEach((sub, i) => {
        const statusEmoji = sub.status === 'pending' ? '⏳'
          : sub.status === 'approved' ? '✅'
          : '❌';
        const statusText = sub.status === 'pending'
          ? (lang === 'es' ? 'Pendiente' : 'Pending')
          : sub.status === 'approved'
          ? (lang === 'es' ? 'Aprobado' : 'Approved')
          : (lang === 'es' ? 'Rechazado' : 'Rejected');

        text += `${i + 1}. ${sub.categoryEmoji || '📍'} *${escapeMarkdown(sub.name)}*\n`;
        text += `   ${statusEmoji} ${statusText}`;
        if (sub.city) text += ` • ${escapeMarkdown(sub.city)}`;
        text += '\n\n';

        // Only allow editing pending submissions
        if (sub.status === 'pending') {
          buttons.push([
            Markup.button.callback(
              `✏️ ${sub.name.substring(0, 20)}${sub.name.length > 20 ? '...' : ''}`,
              `view_my_submission_${sub.id}`
            ),
          ]);
        }
      });

      buttons.push([Markup.button.callback(lang === 'es' ? '➕ Nueva Propuesta' : '➕ New Submission', 'submit_place_start')]);
      buttons.push([Markup.button.callback('🔙 Back', 'show_nearby')]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing user submissions:', error);
    }
  });

  // View submission details with edit options
  bot.action(/^view_my_submission_(\d+)$/, async (ctx) => {
    try {
      const submissionId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      const submission = await NearbyPlaceService.getSubmissionDetails(submissionId);

      if (!submission || submission.submittedByUserId !== userId) {
        await ctx.answerCbQuery(lang === 'es' ? 'Propuesta no encontrada' : 'Submission not found');
        return;
      }

      let text = `${submission.categoryEmoji || '📍'} *${escapeMarkdown(submission.name)}*\n\n`;

      if (submission.description) {
        text += `📝 ${escapeMarkdown(submission.description)}\n\n`;
      }

      if (submission.address) {
        text += `📍 ${escapeMarkdown(submission.address)}`;
        if (submission.city) text += `, ${escapeMarkdown(submission.city)}`;
        text += '\n';
      } else if (submission.city) {
        text += `🏙️ ${escapeMarkdown(submission.city)}\n`;
      }

      if (submission.phone) text += `📞 ${submission.phone}\n`;
      if (submission.website) text += `🌐 ${submission.website}\n`;
      if (submission.telegramUsername) text += `💬 @${submission.telegramUsername}\n`;
      if (submission.instagram) text += `📸 @${submission.instagram}\n`;

      const statusEmoji = submission.status === 'pending' ? '⏳' : submission.status === 'approved' ? '✅' : '❌';
      text += `\n${statusEmoji} ${lang === 'es' ? 'Estado' : 'Status'}: ${submission.status}\n`;

      if (submission.rejectionReason) {
        text += `\n❌ ${lang === 'es' ? 'Razón' : 'Reason'}: ${escapeMarkdown(submission.rejectionReason)}\n`;
      }

      const buttons = [];

      if (submission.status === 'pending') {
        buttons.push([
          Markup.button.callback(lang === 'es' ? '✏️ Editar Nombre' : '✏️ Edit Name', `edit_sub_name_${submissionId}`),
          Markup.button.callback(lang === 'es' ? '✏️ Editar Descripción' : '✏️ Edit Description', `edit_sub_desc_${submissionId}`),
        ]);
        buttons.push([
          Markup.button.callback(lang === 'es' ? '✏️ Editar Ciudad' : '✏️ Edit City', `edit_sub_city_${submissionId}`),
          Markup.button.callback(lang === 'es' ? '✏️ Editar Dirección' : '✏️ Edit Address', `edit_sub_addr_${submissionId}`),
        ]);
        buttons.push([
          Markup.button.callback(lang === 'es' ? '✏️ Editar Contacto' : '✏️ Edit Contact', `edit_sub_contact_${submissionId}`),
        ]);
      }

      buttons.push([Markup.button.callback('🔙 Back', 'my_place_submissions')]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error viewing submission details:', error);
    }
  });

  // Edit submission handlers
  bot.action(/^edit_sub_(name|desc|city|addr|contact)_(\d+)$/, async (ctx) => {
    try {
      const field = ctx.match[1];
      const submissionId = parseInt(ctx.match[2]);
      const lang = getLanguage(ctx);

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.editSubmission = {
        submissionId,
        field,
      };
      await ctx.saveSession();

      const prompts = {
        name: {
          es: '✏️ *Editar Nombre*\n\nEscribe el nuevo nombre:',
          en: '✏️ *Edit Name*\n\nEnter the new name:'
        },
        desc: {
          es: '✏️ *Editar Descripción*\n\nEscribe la nueva descripción:',
          en: '✏️ *Edit Description*\n\nEnter the new description:'
        },
        city: {
          es: '✏️ *Editar Ciudad*\n\nEscribe la nueva ciudad:',
          en: '✏️ *Edit City*\n\nEnter the new city:'
        },
        addr: {
          es: '✏️ *Editar Dirección*\n\nEscribe la nueva dirección:',
          en: '✏️ *Edit Address*\n\nEnter the new address:'
        },
        contact: {
          es: '✏️ *Editar Contacto*\n\nEscribe la información de contacto:\n- Teléfono\n- Website\n- @telegram\n- @instagram',
          en: '✏️ *Edit Contact*\n\nEnter contact information:\n- Phone\n- Website\n- @telegram\n- @instagram'
        },
      };

      await ctx.editMessageText(
        lang === 'es' ? prompts[field].es : prompts[field].en,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', `view_my_submission_${submissionId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting edit:', error);
    }
  });

  // ===========================================
  // TEXT HANDLER FOR SUBMISSION AND EDIT FLOW
  // ===========================================
  bot.on('text', async (ctx, next) => {
    try {
      // Check if we're in edit mode
      if (ctx.session?.temp?.editSubmission) {
        const { submissionId, field } = ctx.session.temp.editSubmission;
        const lang = getLanguage(ctx);
        const userId = ctx.from.id.toString();
        const text = ctx.message.text.trim();

        let updates = {};

        switch (field) {
          case 'name':
            if (text.length < 2 || text.length > 200) {
              await ctx.reply(lang === 'es' ? 'El nombre debe tener entre 2 y 200 caracteres.' : 'Name must be between 2 and 200 characters.');
              return;
            }
            updates.name = text;
            break;
          case 'desc':
            updates.description = text.substring(0, 1000);
            break;
          case 'city':
            updates.city = text.substring(0, 100);
            break;
          case 'addr':
            updates.address = text.substring(0, 500);
            break;
          case 'contact':
            const lines = text.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                updates.website = trimmed;
              } else if (trimmed.startsWith('@')) {
                updates.telegramUsername = trimmed.substring(1);
              } else if (/^\+?[\d\s\-()]+$/.test(trimmed) && trimmed.length >= 7) {
                updates.phone = trimmed;
              } else if (trimmed.includes('.') && !trimmed.includes(' ')) {
                updates.website = 'https://' + trimmed;
              }
            }
            break;
        }

        const result = await NearbyPlaceService.updateSubmission(submissionId, userId, updates);

        delete ctx.session.temp.editSubmission;
        await ctx.saveSession();

        if (result.success) {
          await ctx.reply(
            lang === 'es' ? '✅ ¡Actualizado correctamente!' : '✅ Updated successfully!',
            {
              ...Markup.inlineKeyboard([
                [Markup.button.callback(lang === 'es' ? '👁️ Ver Propuesta' : '👁️ View Submission', `view_my_submission_${submissionId}`)],
                [Markup.button.callback('🔙 Back', 'my_place_submissions')],
              ]),
            }
          );
        } else {
          await ctx.reply(
            lang === 'es' ? `❌ Error: ${result.error}` : `❌ Error: ${result.error}`,
            {
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Back', 'my_place_submissions')],
              ]),
            }
          );
        }
        return;
      }

      // Check if we're in submission flow
      if (!ctx.session?.temp?.placeSubmission || !ctx.session.temp.placeSubmission.step) {
        return next();
      }

      const submission = ctx.session.temp.placeSubmission;
      const lang = getLanguage(ctx);
      const text = ctx.message.text.trim();

      // Handle different steps
      switch (submission.step) {
        case 'name':
          if (text.length < 2 || text.length > 200) {
            await ctx.reply(
              lang === 'es'
                ? 'El nombre debe tener entre 2 y 200 caracteres.'
                : 'Name must be between 2 and 200 characters.'
            );
            return;
          }
          submission.name = text;
          submission.step = 'description';
          await ctx.saveSession();

          await ctx.reply(
            lang === 'es'
              ? '📝 *Paso 2/6: Descripción*\n\n' +
                'Escribe una descripción del lugar:'
              : '📝 *Step 2/6: Description*\n\n' +
                'Enter a description of the place:',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback(lang === 'es' ? '⏭️ Omitir' : '⏭️ Skip', 'submit_skip_description')],
                [Markup.button.callback('❌ Cancel', 'show_nearby')],
              ]),
            }
          );
          break;

        case 'description':
          submission.description = text.length > 0 ? text.substring(0, 1000) : null;
          submission.step = 'address';
          await ctx.saveSession();

          await ctx.reply(
            lang === 'es'
              ? '📝 *Paso 3/6: Dirección*\n\n' +
                'Escribe la dirección del lugar:\n\n' +
                '_Ejemplo: Calle 123, Ciudad, País_'
              : '📝 *Step 3/6: Address*\n\n' +
                'Enter the address of the place:\n\n' +
                '_Example: 123 Main St, City, Country_',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback(lang === 'es' ? '⏭️ Omitir' : '⏭️ Skip', 'submit_skip_address')],
                [Markup.button.callback('❌ Cancel', 'show_nearby')],
              ]),
            }
          );
          break;

        case 'address':
          submission.address = text.length > 0 ? text.substring(0, 500) : null;
          submission.step = 'city';
          await ctx.saveSession();

          await ctx.reply(
            lang === 'es'
              ? '📝 *Paso 4/6: Ciudad*\n\n' +
                'Escribe la ciudad donde se encuentra:'
              : '📝 *Step 4/6: City*\n\n' +
                'Enter the city where it is located:',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback(lang === 'es' ? '⏭️ Omitir' : '⏭️ Skip', 'submit_skip_city')],
                [Markup.button.callback('❌ Cancel', 'show_nearby')],
              ]),
            }
          );
          break;

        case 'city':
          submission.city = text.length > 0 ? text.substring(0, 100) : null;
          submission.step = 'contact';
          await ctx.saveSession();

          await ctx.reply(
            lang === 'es'
              ? '📝 *Paso 5/6: Contacto (opcional)*\n\n' +
                'Escribe información de contacto:\n' +
                '- Teléfono\n' +
                '- Website (https://...)\n' +
                '- @usuario de Telegram\n' +
                '- @instagram\n\n' +
                '_Puedes enviar uno o varios, separados por líneas_'
              : '📝 *Step 5/6: Contact (optional)*\n\n' +
                'Enter contact information:\n' +
                '- Phone\n' +
                '- Website (https://...)\n' +
                '- Telegram @username\n' +
                '- @instagram\n\n' +
                '_You can send one or multiple, separated by lines_',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback(lang === 'es' ? '⏭️ Omitir' : '⏭️ Skip', 'submit_skip_contact')],
                [Markup.button.callback('❌ Cancel', 'show_nearby')],
              ]),
            }
          );
          break;

        case 'contact':
          // Parse contact info
          const lines = text.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
              submission.website = trimmed;
            } else if (trimmed.startsWith('@')) {
              // Check if it looks like instagram or telegram
              const username = trimmed.substring(1);
              if (trimmed.toLowerCase().includes('instagram') || trimmed.toLowerCase().includes('ig')) {
                submission.instagram = username;
              } else {
                submission.telegramUsername = username;
              }
            } else if (/^\+?[\d\s\-()]+$/.test(trimmed) && trimmed.length >= 7) {
              submission.phone = trimmed;
            } else if (trimmed.includes('.') && !trimmed.includes(' ')) {
              // Might be a website without protocol
              submission.website = 'https://' + trimmed;
            } else if (trimmed.startsWith('@') === false && trimmed.length > 3) {
              // Could be telegram username or instagram
              submission.telegramUsername = submission.telegramUsername || trimmed;
            }
          }

          await finalizeSubmission(ctx);
          break;

        default:
          return next();
      }
    } catch (error) {
      logger.error('Error handling submission text:', error);
      return next();
    }
  });

  // ===========================================
  // HELPER FUNCTIONS
  // ===========================================
  async function showPlacesList(ctx, places, lang, type, categoryId, categoryGroupKey = null) {
    try {
      let headerText = type === 'business'
        ? (lang === 'es' ? '🏪 *Negocios Comunitarios*' : '🏪 *Community Businesses*')
        : (lang === 'es' ? '📍 *Lugares Cerca de Ti*' : '📍 *Places Near You*');

      headerText += `\n\n${lang === 'es' ? 'Encontrados:' : 'Found:'} ${places.length}\n\n`;

      // Show top 10 places
      const displayPlaces = places.slice(0, 10);
      displayPlaces.forEach((place, index) => {
        const emoji = place.categoryEmoji || '📍';
        const distance = place.distance !== undefined ? ` (${place.distance.toFixed(1)} km)` : '';
        headerText += `${index + 1}. ${emoji} *${escapeMarkdown(place.name)}*${distance}\n`;
      });

      const buttons = displayPlaces.map(place => [
        Markup.button.callback(
          `${place.categoryEmoji || '📍'} ${place.name.substring(0, 25)}${place.name.length > 25 ? '...' : ''}`,
          `view_place_${place.id}`
        ),
      ]);

      // Add suggest button
      if (type === 'business') {
        buttons.push([Markup.button.callback(
          lang === 'es' ? '➕ Proponer Negocio' : '➕ Suggest Business',
          'submit_business_profile'
        )]);
      } else if (categoryGroupKey) {
        buttons.push([Markup.button.callback(
          lang === 'es' ? '➕ Proponer Lugar' : '➕ Suggest Place',
          `submit_place_group_${categoryGroupKey}`
        )]);
      } else if (categoryId) {
        buttons.push([Markup.button.callback(
          lang === 'es' ? '➕ Proponer Lugar' : '➕ Suggest Place',
          `submit_place_cat_${categoryId}`
        )]);
      }

      // Back button
      const backAction = type === 'business' ? 'show_nearby' : 'nearby_places_categories';
      buttons.push([Markup.button.callback('🔙 Back', backAction)]);

      await ctx.editMessageText(headerText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing places list:', error);
    }
  }

  async function showNoLocationMessage(ctx, lang, backAction) {
    try {
      await ctx.editMessageText(
        lang === 'es'
          ? '📍 *Ubicación Requerida*\n\n' +
            'Necesitas compartir tu ubicación primero.\n\n' +
            'Ve a tu Perfil → Ubicación para compartir tu ubicación.'
          : '📍 *Location Required*\n\n' +
            'You need to share your location first.\n\n' +
            'Go to your Profile → Location to share your location.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '📝 Ir al Perfil' : '📝 Go to Profile', 'edit_profile')],
            [Markup.button.callback('🔙 Back', backAction)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing no location message:', error);
    }
  }

  async function finalizeSubmission(ctx) {
    try {
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();
      const submission = ctx.session.temp.placeSubmission;

      // Get user's location for the submission
      const user = await UserService.getOrCreateFromContext(ctx);
      if (user.location) {
        submission.location = {
          lat: user.location.lat,
          lng: user.location.lng,
        };
      }

      // Submit the place
      const result = await NearbyPlaceService.submitPlace(userId, {
        name: submission.name,
        description: submission.description,
        address: submission.address,
        city: submission.city,
        country: submission.country,
        location: submission.location,
        categoryId: submission.categoryId,
        placeType: submission.placeType,
        phone: submission.phone,
        website: submission.website,
        telegramUsername: submission.telegramUsername,
        instagram: submission.instagram,
      });

      // Clear session
      delete ctx.session.temp.placeSubmission;
      await ctx.saveSession();

      if (result.success) {
        await ctx.reply(
          lang === 'es'
            ? '✅ *¡Propuesta Enviada!*\n\n' +
              `Tu propuesta para "${escapeMarkdown(submission.name)}" ha sido enviada.\n\n` +
              'Un administrador la revisará pronto. Te notificaremos cuando sea aprobada.'
            : '✅ *Submission Sent!*\n\n' +
              `Your submission for "${escapeMarkdown(submission.name)}" has been sent.\n\n` +
              'An admin will review it soon. You\'ll be notified when it\'s approved.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '➕ Proponer Otro' : '➕ Suggest Another', 'submit_place_start')],
              [Markup.button.callback('🔙 Back to Nearby', 'show_nearby')],
            ]),
          }
        );
      } else {
        await ctx.reply(
          lang === 'es'
            ? '❌ *Error*\n\n' +
              'Hubo un error al enviar tu propuesta. Por favor intenta de nuevo.'
            : '❌ *Error*\n\n' +
              'There was an error submitting your place. Please try again.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Try Again', 'submit_place_start')],
              [Markup.button.callback('🔙 Back', 'show_nearby')],
            ]),
          }
        );
      }
    } catch (error) {
      logger.error('Error finalizing submission:', error);
    }
  }

  function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }
};

module.exports = registerNearbyPlacesHandlers;
