const { Markup } = require('telegraf');
const NearbyPlaceService = require('../../services/nearbyPlaceService');
const UserService = require('../../services/userService');
const NotificationService = require('../../services/notificationService');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const { t } = require('../../../utils/i18n');

/**
 * World-Class Business Profile Submission System
 * @param {Telegraf} bot - Bot instance
 */
const registerBusinessSubmissionHandlers = (bot) => {
  
  // ===========================================
  // MAIN BUSINESS SUBMISSION ENTRY POINT
  // ===========================================
  bot.action('submit_business_profile', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const user = await UserService.getOrCreateFromContext(ctx);

      // Check if user has location enabled
      if (!user.location || !user.location.lat) {
        await ctx.editMessageText(
          lang === 'es'
            ? '`📍 Ubicación Requerida`\n\n' +
              'Para proponer un negocio, necesitas compartir tu ubicación primero.\n\n' +
              '_Ve a tu Perfil → Ubicación para compartir tu ubicación._'
            : '`📍 Location Required`\n\n' +
              'To submit a business, you need to share your location first.\n\n' +
              '_Go to your Profile → Location to share your location._',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '📝 Ir al Perfil' : '📝 Go to Profile', 'edit_profile')],
              [Markup.button.callback('🔙 Back', 'show_nearby_unified')],
            ]),
          }
        );
        return;
      }

      // Initialize submission session with enhanced data structure
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.businessSubmission = {
        step: 'welcome',
        userId: user.id.toString(),
        username: user.username || `@${user.id}`,
        userTier: user.subscriptionStatus || 'basic',
        submissionDate: new Date().toISOString(),
        metadata: {
          source: 'mobile',
          language: lang,
          version: '2.0'
        }
      };
      await ctx.saveSession();

      // Show welcome screen with benefits
      const welcomeText = lang === 'es'
        ? '`🏪 Proponer Negocio Comunitario`\n\n' +
          '¡Gracias por ayudar a crecer nuestra comunidad! 🙌\n\n' +
          '*Beneficios de proponer negocios:*\n' +
          '✅ Apoyas a negocios locales\n' +
          '✅ Reconocimiento en la comunidad\n' +
          '✅ Acceso a promociones especiales\n\n' +
          '_El proceso toma solo 2-3 minutos._'
        : '`🏪 Submit Community Business`\n\n' +
          'Thank you for helping grow our community! 🙌\n\n' +
          '*Benefits of submitting businesses:*\n' +
          '✅ Support local businesses\n' +
          '✅ Community recognition\n' +
          '✅ Access to special promotions\n\n' +
          '_The process takes only 2-3 minutes._';

      await ctx.editMessageText(welcomeText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🚀 Comenzar' : '🚀 Get Started', 'business_step_basic_info')],
          [Markup.button.callback(lang === 'es' ? '❓ Ver Ejemplo' : '❓ See Example', 'business_show_example')],
          [Markup.button.callback('🔙 Cancel', 'show_nearby_unified')],
        ]),
      });
    } catch (error) {
      logger.error('Error starting business submission:', error);
    }
  });

  // Show example of a great business submission
  bot.action('business_show_example', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      const exampleText = lang === 'es'
        ? '`📋 Ejemplo de Negocio Bien Presentado`\n\n' +
          '*Nombre:* Café Delicias\n' +
          '*Categoría:* Café / Restaurante\n' +
          '*Descripción:* Café acogedor con WiFi gratuito, ambiente LGBTQ+ friendly y deliciosos postres caseros. Ideal para trabajar o socializar.\n' +
          '*Dirección:* Calle Principal 123, Centro\n' +
          '*Contacto:*\n' +
          '- 📞 +1234567890\n' +
          '- 🌐 cafedelicias.com\n' +
          '- 📸 @cafedelicias\n' +
          '- 💬 @cafedeliciasbot\n' +
          '*Horario:* Lunes-Viernes 8AM-10PM, Sábado-Domingo 9AM-8PM\n' +
          '*Rango de precios:* $$\n' +
          '*Foto:* Imagen clara del frente del negocio\n\n' +
          '_¿Listo para crear tu propuesta?_'
        : '`📋 Example of a Well-Presented Business`\n\n' +
          '*Name:* Delight Café\n' +
          '*Category:* Café / Restaurant\n' +
          '*Description:* Cozy café with free WiFi, LGBTQ+ friendly atmosphere, and delicious homemade desserts. Perfect for working or socializing.\n' +
          '*Address:* 123 Main Street, Downtown\n' +
          '*Contact:*\n' +
          '- 📞 +1234567890\n' +
          '- 🌐 delightcafe.com\n' +
          '- 📸 @delightcafe\n' +
          '- 💬 @delightcafebot\n' +
          '*Hours:* Mon-Fri 8AM-10PM, Sat-Sun 9AM-8PM\n' +
          '*Price Range:* $$\n' +
          '*Photo:* Clear image of the business front\n\n' +
          '_Ready to create your submission?_';

      await ctx.editMessageText(exampleText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🚀 Comenzar Ahora' : '🚀 Start Now', 'business_step_basic_info')],
          [Markup.button.callback('🔙 Back', 'submit_business_profile')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing business example:', error);
    }
  });

  // ===========================================
  // ENHANCED SUBMISSION FLOW - Step by Step
  // ===========================================

  // Step 1: Basic Information
  bot.action('business_step_basic_info', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Update step
      ctx.session.temp.businessSubmission.step = 'basic_info';
      await ctx.saveSession();

      const instructions = lang === 'es'
        ? '`📝 Paso 1/5: Información Básica`\n\n' +
          'Por favor proporciona la información básica del negocio:\n\n' +
          '*Nombre del Negocio:* (nombre oficial)\n' +
          '*Categoría:* (selecciona de la lista)\n' +
          '*Descripción:* (qué hace único a este negocio, 50-300 caracteres)\n\n' +
          '_Ejemplo: "Café acogedor con WiFi gratuito y ambiente LGBTQ+ friendly"_' +
          '\n\n*Envía el nombre del negocio:*'
        : '`📝 Step 1/5: Basic Information`\n\n' +
          'Please provide the basic business information:\n\n' +
          '*Business Name:* (official name)\n' +
          '*Category:* (select from list)\n' +
          '*Description:* (what makes this business unique, 50-300 characters)\n\n' +
          '_Example: "Cozy café with free WiFi and LGBTQ+ friendly atmosphere"_' +
          '\n\n*Send the business name:*';

      await ctx.editMessageText(instructions, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
        ]),
      });
    } catch (error) {
      logger.error('Error in business basic info step:', error);
    }
  });

  // Step 2: Contact Information
  bot.action('business_step_contact_info', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      ctx.session.temp.businessSubmission.step = 'contact_info';
      await ctx.saveSession();

      const instructions = lang === 'es'
        ? '`📞 Paso 2/5: Información de Contacto`\n\n' +
          'Proporciona al menos 2 formas de contacto (más = mejor):\n\n' +
          '*Teléfono:* +1234567890\n' +
          '*Website:* https://ejemplo.com\n' +
          '*Telegram:* @usuario\n' +
          '*Instagram:* @usuario\n' +
          '*Email:* contacto@ejemplo.com\n\n' +
          '_Envía la información de contacto (una por línea):_' +
          '\n\n*Ejemplo:*\n' +
          '+1234567890\n' +
          'https://ejemplo.com\n' +
          '@ejemplo'
        : '`📞 Step 2/5: Contact Information`\n\n' +
          'Provide at least 2 contact methods (more = better):\n\n' +
          '*Phone:* +1234567890\n' +
          '*Website:* https://example.com\n' +
          '*Telegram:* @username\n' +
          '*Instagram:* @username\n' +
          '*Email:* contact@example.com\n\n' +
          '_Send contact information (one per line):_' +
          '\n\n*Example:*\n' +
          '+1234567890\n' +
          'https://example.com\n' +
          '@example';

      await ctx.editMessageText(instructions, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Skip', 'business_step_location')],
          [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
        ]),
      });
    } catch (error) {
      logger.error('Error in business contact info step:', error);
    }
  });

  // Step 3: Location and Hours
  bot.action('business_step_location', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      ctx.session.temp.businessSubmission.step = 'location';
      await ctx.saveSession();

      const instructions = lang === 'es'
        ? '`📍 Paso 3/5: Ubicación y Horario`\n\n' +
          'Proporciona la dirección completa y horario de atención:\n\n' +
          '*Dirección:* Calle, Número, Ciudad, País\n' +
          '*Horario:* Lunes-Viernes 9AM-6PM, Sábado 10AM-4PM\n' +
          '*Días cerrados:* (opcional)\n\n' +
          '_Envía la dirección completa primero:_'
        : '`📍 Step 3/5: Location and Hours`\n\n' +
          'Provide the full address and business hours:\n\n' +
          '*Address:* Street, Number, City, Country\n' +
          '*Hours:* Mon-Fri 9AM-6PM, Sat 10AM-4PM\n' +
          '*Closed days:* (optional)\n\n' +
          '_Send the full address first:_';

      await ctx.editMessageText(instructions, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Skip', 'business_step_media')],
          [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
        ]),
      });
    } catch (error) {
      logger.error('Error in business location step:', error);
    }
  });

  // Step 4: Media and Visuals
  bot.action('business_step_media', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      ctx.session.temp.businessSubmission.step = 'media';
      await ctx.saveSession();

      const instructions = lang === 'es'
        ? '`📸 Paso 4/5: Medios Visuales`\n\n' +
          'Las imágenes mejoran significativamente la visibilidad:\n\n' +
          '*Foto principal:* Fachada del negocio (clara y bien iluminada)\n' +
          '*Fotos adicionales:* Interior, productos, equipo (opcional)\n' +
          '*Logo:* (si disponible)\n\n' +
          '_Envía una foto del negocio o selecciona "Omitir":_' +
          '\n\n*Consejo:* Las fotos con buena iluminación reciben 3x más vistas.'
        : '`📸 Step 4/5: Media and Visuals`\n\n' +
          'Images significantly improve visibility:\n\n' +
          '*Main photo:* Business facade (clear and well-lit)\n' +
          '*Additional photos:* Interior, products, team (optional)\n' +
          '*Logo:* (if available)\n\n' +
          '_Send a photo of the business or select "Skip":_' +
          '\n\n*Tip:* Well-lit photos get 3x more views.';

      await ctx.editMessageText(instructions, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Skip', 'business_step_review')],
          [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
        ]),
      });
    } catch (error) {
      logger.error('Error in business media step:', error);
    }
  });

  // Step 5: Review and Submit
  bot.action('business_step_review', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const submission = ctx.session.temp.businessSubmission;

      // Generate preview
      let previewText = lang === 'es'
        ? '`🔍 Paso 5/5: Revisión Final`\n\n' +
          '*Tu propuesta:*\n\n' +
          `🏪 *Nombre:* ${submission.name || '❓ Por completar'}\n` +
          `📍 *Ubicación:* ${submission.address || '❓ Por completar'}\n` +
          `📞 *Contacto:* ${submission.contactInfo ? Object.keys(submission.contactInfo).length + ' métodos' : '❓ Por completar'}\n` +
          `📸 *Fotos:* ${submission.photoFileId ? '✅ 1 foto' : '❌ Ninguna'}\n` +
          `📝 *Descripción:* ${submission.description ? '✅ Completa' : '❌ Pendiente'}\n\n` +
          '*Calidad estimada:* 🌟🌟🌟🌟✩ (4/5)\n' +
          '*Tiempo de revisión:* 24-48 horas\n\n' +
          '_¿Todo se ve bien?_'
        : '`🔍 Step 5/5: Final Review`\n\n' +
          '*Your submission:*\n\n' +
          `🏪 *Name:* ${submission.name || '❓ To complete'}\n` +
          `📍 *Location:* ${submission.address || '❓ To complete'}\n` +
          `📞 *Contact:* ${submission.contactInfo ? Object.keys(submission.contactInfo).length + ' methods' : '❓ To complete'}\n` +
          `📸 *Photos:* ${submission.photoFileId ? '✅ 1 photo' : '❌ None'}\n` +
          `📝 *Description:* ${submission.description ? '✅ Complete' : '❌ Pending'}\n\n` +
          '*Estimated quality:* 🌟🌟🌟🌟✩ (4/5)\n' +
          '*Review time:* 24-48 hours\n\n' +
          '_Does everything look good?_';

      await ctx.editMessageText(previewText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '✅ Enviar Propuesta' : '✅ Submit Proposal', 'business_submit_final')],
          [Markup.button.callback(lang === 'es' ? '⬅️ Editar' : '⬅️ Edit', 'business_step_basic_info')],
          [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
        ]),
      });
    } catch (error) {
      logger.error('Error in business review step:', error);
    }
  });

  // Final Submission
  bot.action('business_submit_final', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const submission = ctx.session.temp.businessSubmission;
      const userId = ctx.from.id.toString();

      // Validate required fields
      const validation = validateBusinessSubmission(submission, lang);
      if (!validation.valid) {
        await ctx.editMessageText(validation.message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '⬅️ Corregir' : '⬅️ Fix Issues', 'business_step_review')],
            [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
          ]),
        });
        return;
      }

      // Get user location for submission
      const user = await UserService.getOrCreateFromContext(ctx);
      
      // Prepare submission data
      const submissionData = {
        name: submission.name,
        description: submission.description,
        address: submission.address,
        city: submission.city,
        country: submission.country,
        location: user.location || submission.location,
        categoryId: submission.categoryId,
        placeType: 'business',
        phone: submission.contactInfo?.phone,
        email: submission.contactInfo?.email,
        website: submission.contactInfo?.website,
        telegramUsername: submission.contactInfo?.telegram,
        instagram: submission.contactInfo?.instagram,
        photoFileId: submission.photoFileId,
        hoursOfOperation: submission.hours,
        isCommunityOwned: true,
        metadata: {
          submittedBy: userId,
          submissionQuality: calculateQualityScore(submission),
          source: 'mobile-app',
          language: lang
        }
      };

      // Submit to service
      const result = await NearbyPlaceService.submitPlace(userId, submissionData);

      // Clear session
      delete ctx.session.temp.businessSubmission;
      await ctx.saveSession();

      if (result.success) {
        // Send confirmation
        const confirmationText = lang === 'es'
          ? '`✅ ¡Propuesta Enviada con Éxito!`\n\n' +
            '🎉 *¡Gracias por tu contribución!*\n\n' +
            `*ID de propuesta:* #${result.submission.id}\n` +
            '*Estado:* En revisión ⏳\n' +
            '*Tiempo estimado:* 24-48 horas\n\n' +
            '_Recibirás una notificación cuando sea aprobada._\n\n' +
            '*Beneficios desbloqueados:*\n' +
            '✅ Acceso a canal VIP\n' +
            '✅ Reconocimiento en la comunidad\n\n' +
            '_¿Quieres proponer otro negocio?_'
          : '`✅ Submission Successful!`\n\n' +
            '🎉 *Thank you for your contribution!*\n\n' +
            `*Submission ID:* #${result.submission.id}\n` +
            '*Status:* Under review ⏳\n' +
            '*Estimated time:* 24-48 hours\n\n' +
            '_You will receive a notification when approved._\n\n' +
            '*Unlocked benefits:*\n' +
            '✅ VIP channel access\n' +
            '✅ Community recognition\n\n' +
            '_Want to submit another business?_';

        await ctx.editMessageText(confirmationText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '➕ Proponer Otro' : '➕ Submit Another', 'submit_business_profile')],
            [Markup.button.callback(lang === 'es' ? '📋 Mis Propuestas' : '📋 My Submissions', 'my_place_submissions')],
            [Markup.button.callback('🔙 Back to Nearby', 'show_nearby_unified')],
          ]),
        });

        // Send notification to admins
        await NotificationService.notifyAdmins(
          lang === 'es'
            ? `📥 Nueva propuesta de negocio: ${submission.name}`
            : `📥 New business submission: ${submission.name}`,
          `admin_review_place_submissions`
        );
      } else {
        await ctx.editMessageText(
          lang === 'es'
            ? '❌ *Error al enviar propuesta*\n\n' +
              'Hubo un error. Por favor intenta de nuevo.'
            : '❌ *Error submitting proposal*\n\n' +
              'There was an error. Please try again.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Try Again', 'business_step_review')],
              [Markup.button.callback('🔙 Back', 'show_nearby_unified')],
            ]),
          }
        );
      }
    } catch (error) {
      logger.error('Error submitting business:', error);
    }
  });

  // ===========================================
  // TEXT HANDLER FOR SUBMISSION FLOW
  // ===========================================
  bot.on('text', async (ctx, next) => {
    try {
      // Check if we're in business submission flow
      if (!ctx.session?.temp?.businessSubmission || !ctx.session.temp.businessSubmission.step) {
        return next();
      }

      const submission = ctx.session.temp.businessSubmission;
      const lang = getLanguage(ctx);
      const text = ctx.message.text.trim();

      // Handle different steps
      switch (submission.step) {
        case 'basic_info':
          if (!submission.name) {
            // First text is the business name
            if (text.length < 2 || text.length > 100) {
              await ctx.reply(
                lang === 'es'
                  ? 'El nombre debe tener entre 2 y 100 caracteres.'
                  : 'Name must be between 2 and 100 characters.'
              );
              return;
            }
            submission.name = text;
            
            // Ask for category
            await ctx.reply(
              lang === 'es'
                ? '📂 *Selecciona la categoría:*'
                : '📂 *Select the category:*',
              await showCategorySelection(ctx, lang, 'business')
            );
          } else if (!submission.categoryId) {
            // This shouldn't happen as categories are selected via buttons
            await ctx.reply(
              lang === 'es'
                ? 'Por favor selecciona una categoría usando los botones.'
                : 'Please select a category using the buttons.'
            );
          } else if (!submission.description) {
            // Next is description
            if (text.length < 10 || text.length > 1000) {
              await ctx.reply(
                lang === 'es'
                  ? 'La descripción debe tener entre 10 y 1000 caracteres.'
                  : 'Description must be between 10 and 1000 characters.'
              );
              return;
            }
            submission.description = text;
            submission.step = 'contact_info';
            await ctx.saveSession();
            
            // Move to contact info step
            ctx.callbackQuery = { data: 'business_step_contact_info' };
            await bot.handleUpdate(ctx.update);
          }
          break;

        case 'contact_info':
          // Parse contact info
          parseContactInformation(submission, text);
          submission.step = 'location';
          await ctx.saveSession();
          
          // Move to location step
          ctx.callbackQuery = { data: 'business_step_location' };
          await bot.handleUpdate(ctx.update);
          break;

        case 'location':
          if (!submission.address) {
            // First text is address
            if (text.length < 5 || text.length > 200) {
              await ctx.reply(
                lang === 'es'
                  ? 'La dirección debe tener entre 5 y 200 caracteres.'
                  : 'Address must be between 5 and 200 characters.'
              );
              return;
            }
            submission.address = text;
            
            // Try to extract city/country
            const locationParts = parseAddress(text);
            submission.city = locationParts.city;
            submission.country = locationParts.country;
            
            // Ask for hours
            await ctx.reply(
              lang === 'es'
                ? '⏰ *Horario de atención:*\n\n' +
                  'Ejemplo: Lunes-Viernes 9AM-6PM, Sábado 10AM-4PM\n' +
                  '_Envía el horario o selecciona "Omitir":_'
                : '⏰ *Business hours:*\n\n' +
                  'Example: Mon-Fri 9AM-6PM, Sat 10AM-4PM\n' +
                  '_Send the hours or select "Skip":_',
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('⏭️ Skip', 'business_step_media')],
                ]),
              }
            );
          } else if (!submission.hours) {
            // This is the hours
            submission.hours = text;
            submission.step = 'media';
            await ctx.saveSession();
            
            // Move to media step
            ctx.callbackQuery = { data: 'business_step_media' };
            await bot.handleUpdate(ctx.update);
          }
          break;

        default:
          return next();
      }
    } catch (error) {
      logger.error('Error handling business submission text:', error);
      return next();
    }
  });

  // Handle photo uploads
  bot.on('photo', async (ctx, next) => {
    try {
      if (!ctx.session?.temp?.businessSubmission || ctx.session.temp.businessSubmission.step !== 'media') {
        return next();
      }

      const submission = ctx.session.temp.businessSubmission;
      const lang = getLanguage(ctx);

      // Get the largest photo
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileId = photo.file_id;

      // Store the photo file ID
      submission.photoFileId = fileId;
      submission.step = 'review';
      await ctx.saveSession();

      await ctx.reply(
        lang === 'es'
          ? '✅ Foto guardada exitosamente!\n\n' +
            '_Puedes enviar más fotos o seleccionar "Revisar" para continuar._'
          : '✅ Photo saved successfully!\n\n' +
            '_You can send more photos or select "Review" to continue._',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '👁️ Revisar' : '👁️ Review', 'business_step_review')],
            [Markup.button.callback('➕ Add Another Photo', 'business_step_media')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error handling business photo:', error);
      return next();
    }
  });

  // ===========================================
  // HELPER FUNCTIONS
  // ===========================================

  async function showCategorySelection(ctx, lang, type) {
    try {
      const categories = await NearbyPlaceService.getCategories(lang);
      const businessCategories = type === 'business'
        ? categories.filter(c => c.slug === 'community_business')
        : categories.filter(c => c.slug !== 'community_business');

      const buttons = businessCategories.map(cat => [
        Markup.button.callback(
          `${cat.emoji} ${cat.name}`,
          `business_select_cat_${cat.id}`
        ),
      ]);

      buttons.push([Markup.button.callback('❌ Cancel', 'show_nearby_unified')]);

      return Markup.inlineKeyboard(buttons);
    } catch (error) {
      logger.error('Error showing category selection:', error);
      return Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
      ]);
    }
  }

  function parseContactInformation(submission, text) {
    submission.contactInfo = submission.contactInfo || {};
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        submission.contactInfo.website = trimmed;
      } else if (trimmed.startsWith('@')) {
        const username = trimmed.substring(1);
        if (trimmed.toLowerCase().includes('instagram') || trimmed.toLowerCase().includes('ig')) {
          submission.contactInfo.instagram = username;
        } else {
          submission.contactInfo.telegram = username;
        }
      } else if (/^\+?[\d\s\-\(\)]+$/.test(trimmed) && trimmed.length >= 7) {
        submission.contactInfo.phone = trimmed;
      } else if (trimmed.includes('@') && trimmed.includes('.')) {
        submission.contactInfo.email = trimmed;
      }
    }
  }

  function parseAddress(address) {
    const parts = address.split(',');
    const result = { city: null, country: null };
    
    if (parts.length >= 2) {
      result.city = parts[parts.length - 2]?.trim() || null;
      result.country = parts[parts.length - 1]?.trim() || null;
    }
    
    return result;
  }

  function validateBusinessSubmission(submission, lang) {
    const errors = [];
    
    if (!submission.name || submission.name.length < 2) {
      errors.push(lang === 'es' ? '❌ Nombre del negocio requerido' : '❌ Business name required');
    }
    
    if (!submission.categoryId) {
      errors.push(lang === 'es' ? '❌ Categoría requerida' : '❌ Category required');
    }
    
    if (!submission.description || submission.description.length < 10) {
      errors.push(lang === 'es' ? '❌ Descripción demasiado corta' : '❌ Description too short');
    }
    
    if (!submission.address || submission.address.length < 5) {
      errors.push(lang === 'es' ? '❌ Dirección requerida' : '❌ Address required');
    }
    
    // Check contact info
    const contactMethods = [];
    if (submission.contactInfo) {
      if (submission.contactInfo.phone) contactMethods.push('phone');
      if (submission.contactInfo.email) contactMethods.push('email');
      if (submission.contactInfo.website) contactMethods.push('website');
      if (submission.contactInfo.telegram) contactMethods.push('telegram');
      if (submission.contactInfo.instagram) contactMethods.push('instagram');
    }
    
    if (contactMethods.length < 1) {
      errors.push(lang === 'es' ? '❌ Al menos 1 método de contacto requerido' : '❌ At least 1 contact method required');
    }
    
    if (errors.length > 0) {
      return {
        valid: false,
        message: lang === 'es'
          ? '`⚠️ Errores en la propuesta`\n\n' + errors.join('\n') + '\n\n_Por favor corrige estos errores._'
          : '`⚠️ Submission Errors`\n\n' + errors.join('\n') + '\n\n_Please fix these errors._'
      };
    }
    
    return { valid: true };
  }

  function calculateQualityScore(submission) {
    let score = 1; // Base score
    
    // Add points for completeness
    if (submission.description && submission.description.length > 50) score += 1;
    if (submission.photoFileId) score += 1;
    if (submission.hours) score += 1;
    
    // Add points for contact methods
    const contactMethods = [];
    if (submission.contactInfo) {
      if (submission.contactInfo.phone) contactMethods.push('phone');
      if (submission.contactInfo.email) contactMethods.push('email');
      if (submission.contactInfo.website) contactMethods.push('website');
      if (submission.contactInfo.telegram) contactMethods.push('telegram');
      if (submission.contactInfo.instagram) contactMethods.push('instagram');
    }
    
    if (contactMethods.length >= 2) score += 1;
    if (contactMethods.length >= 3) score += 1;
    
    return Math.min(5, score); // Max 5 stars
  }

  // Category selection handler
  bot.action(/^business_select_cat_(\d+)$/, async (ctx) => {
    try {
      const categoryId = parseInt(ctx.match[1]);
      const lang = getLanguage(ctx);
      
      ctx.session.temp.businessSubmission.categoryId = categoryId;
      await ctx.saveSession();
      
      await ctx.answerCbQuery(lang === 'es' ? '✅ Categoría seleccionada' : '✅ Category selected');
      
      // Ask for description
      await ctx.editMessageText(
        lang === 'es'
          ? '📝 *Descripción del negocio:*\n\n' +
            '¿Qué hace único a este negocio? (50-300 caracteres)\n' +
            '_Ejemplo: "Café acogedor con WiFi gratuito y ambiente LGBTQ+ friendly"_' +
            '\n\n*Envía la descripción:*'
          : '📝 *Business description:*\n\n' +
            'What makes this business unique? (50-300 characters)\n' +
            '_Example: "Cozy café with free WiFi and LGBTQ+ friendly atmosphere"_' +
            '\n\n*Send the description:*',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'show_nearby_unified')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting business category:', error);
    }
  });
};

module.exports = registerBusinessSubmissionHandlers;
