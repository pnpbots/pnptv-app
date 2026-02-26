/**
 * Enhanced Broadcast Management Handler
 * Includes scheduling and S3 media upload support
 */

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const BroadcastService = require('../../services/broadcastService');
const broadcastService = new BroadcastService();
const s3Service = require('../../../utils/s3Service');
const PermissionService = require('../../services/permissionService');
const { getLanguage } = require('../../utils/helpers');
const { escapeMarkdown } = require('../../utils/memberProfileCard');

/**
 * Register enhanced broadcast handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerBroadcastHandlers = (bot) => {
  // Step 4: Ask if user wants to schedule the broadcast
  bot.action('broadcast_schedule_options', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp || !ctx.session.temp.broadcastData) {
        await ctx.answerCbQuery('❌ Sesión expirada');
        return;
      }

      await ctx.answerCbQuery();

      await ctx.editMessageText(
        '⏰ *Paso 4/5: Programación*\n\n'
        + '¿Cuándo quieres enviar este broadcast?\n\n'
        + '📤 *Enviar Ahora:* El broadcast se enviará inmediatamente\n'
        + '📅 *Programar:* Elige una fecha y hora para enviar',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📤 Enviar Ahora', 'broadcast_send_now')],
            [Markup.button.callback('📅 Programar Envío', 'broadcast_schedule_later')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing schedule options:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Send broadcast immediately
  bot.action('broadcast_send_now', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await ctx.answerCbQuery();
      await sendBroadcastNow(ctx, bot);
    } catch (error) {
      logger.error('Error sending broadcast now:', error);
      await ctx.reply('❌ Error al enviar broadcast').catch(() => {});
    }
  });

  // Schedule broadcast for later
  bot.action('broadcast_schedule_later', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp) {
        ctx.session.temp = {};
      }

      ctx.session.temp.broadcastStep = 'schedule_type';
      ctx.session.temp.scheduledTimes = [];
      await ctx.saveSession();

      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'es';

      const text = lang === 'es'
        ? '📅 *Tipo de Programación*\n\n' +
          '¿Qué tipo de programación deseas?\n\n' +
          '📆 *Una vez:* Envío único en fecha/hora específica\n' +
          '📅 *Múltiples:* Programar varias fechas diferentes\n' +
          '🔄 *Recurrente:* Envíos repetidos (diario, semanal, mensual)'
        : '📅 *Scheduling Type*\n\n' +
          'What type of schedule do you want?\n\n' +
          '📆 *One time:* Single send at specific date/time\n' +
          '📅 *Multiple:* Schedule for several different dates\n' +
          '🔄 *Recurring:* Repeated sends (daily, weekly, monthly)';

      const buttons = lang === 'es'
        ? [
            [Markup.button.callback('📆 Una vez', 'schedule_type_once')],
            [Markup.button.callback('📅 Múltiples fechas', 'schedule_type_multiple')],
            [Markup.button.callback('🔄 Recurrente', 'schedule_type_recurring')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]
        : [
            [Markup.button.callback('📆 One time', 'schedule_type_once')],
            [Markup.button.callback('📅 Multiple dates', 'schedule_type_multiple')],
            [Markup.button.callback('🔄 Recurring', 'schedule_type_recurring')],
            [Markup.button.callback('❌ Cancel', 'admin_cancel')],
          ];

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error scheduling broadcast:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Schedule type: one-time - Show visual date/time picker
  bot.action('schedule_type_once', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp) {
        ctx.session.temp = {};
      }

      ctx.session.temp.isRecurring = false;
      ctx.session.temp.schedulingContext = 'single';
      ctx.session.temp.scheduledTimes = [];
      ctx.session.temp.scheduleCount = 1;
      ctx.session.temp.schedulingStep = 'selecting_datetime';
      ctx.session.temp.timezone = null;
      await ctx.saveSession();

      await ctx.answerCbQuery();

      // Trigger the visual date/time picker
      const lang = ctx.session?.language || 'es';
      const dateTimePicker = require('../../utils/dateTimePicker');
      const PREFIX = 'bcast_sched';

      const { text, keyboard } = dateTimePicker.getSchedulingMenu(lang, PREFIX);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } catch (error) {
      logger.error('Error selecting one-time schedule:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Multiple schedule count selection (for 2+ broadcasts)
  bot.action('schedule_type_multiple', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp) {
        ctx.session.temp = {};
      }

      ctx.session.temp.broadcastStep = 'schedule_count';
      ctx.session.temp.schedulingContext = 'multi';
      ctx.session.temp.isRecurring = false;
      ctx.session.temp.scheduledTimes = [];
      await ctx.saveSession();

      await ctx.answerCbQuery();

      await ctx.editMessageText(
        '📅 *Programar Múltiples Broadcasts*\n\n'
        + '¿Cuántas veces deseas programar este broadcast?\n\n'
        + '🔄 *Opciones:* 2 a 12 programaciones diferentes\n\n'
        + 'Ejemplo: Puedes programar el mismo mensaje para 3 fechas/horas diferentes',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('2️⃣ Dos veces', 'schedule_count_2'), Markup.button.callback('3️⃣ Tres veces', 'schedule_count_3'), Markup.button.callback('4️⃣ Cuatro', 'schedule_count_4')],
            [Markup.button.callback('5️⃣ Cinco', 'schedule_count_5'), Markup.button.callback('6️⃣ Seis', 'schedule_count_6'), Markup.button.callback('7️⃣ Siete', 'schedule_count_7')],
            [Markup.button.callback('8️⃣ Ocho', 'schedule_count_8'), Markup.button.callback('9️⃣ Nueve', 'schedule_count_9'), Markup.button.callback('🔟 Diez', 'schedule_count_10')],
            [Markup.button.callback('1️⃣1️⃣ Once', 'schedule_count_11'), Markup.button.callback('1️⃣2️⃣ Doce', 'schedule_count_12')],
            [Markup.button.callback('◀️ Volver', 'broadcast_schedule_later')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting multiple schedule:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Schedule type: recurring
  bot.action('schedule_type_recurring', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp) {
        ctx.session.temp = {};
      }

      ctx.session.temp.broadcastStep = 'recurring_pattern';
      ctx.session.temp.isRecurring = true;
      ctx.session.temp.schedulingContext = 'recurring_start';
      await ctx.saveSession();

      await ctx.answerCbQuery();

      await ctx.editMessageText(
        '🔄 *Broadcast Recurrente*\n\n'
        + '¿Con qué frecuencia deseas enviar este broadcast?\n\n'
        + '📅 *Diario:* Todos los días a la misma hora\n'
        + '📆 *Semanal:* Una vez por semana\n'
        + '🗓️ *Mensual:* Una vez al mes\n'
        + '⚙️ *Personalizado:* Expresión cron personalizada',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📅 Diario', 'recurring_pattern_daily')],
            [Markup.button.callback('📆 Semanal', 'recurring_pattern_weekly')],
            [Markup.button.callback('🗓️ Mensual', 'recurring_pattern_monthly')],
            [Markup.button.callback('⚙️ Personalizado (Cron)', 'recurring_pattern_custom')],
            [Markup.button.callback('◀️ Volver', 'broadcast_schedule_later')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting recurring schedule:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Handle recurring pattern selection
  const recurringPatterns = ['daily', 'weekly', 'monthly'];
  const patternLabels = {
    daily: 'Diario',
    weekly: 'Semanal',
    monthly: 'Mensual',
    custom: 'Personalizado',
  };

  // Handle custom cron pattern
  bot.action('recurring_pattern_custom', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp) {
        ctx.session.temp = {};
      }

      ctx.session.temp.recurrencePattern = 'custom';
      ctx.session.temp.broadcastStep = 'custom_cron_expression';
      await ctx.saveSession();

      await ctx.answerCbQuery();

      await ctx.editMessageText(
        '⚙️ *Expresión Cron Personalizada*\n\n'
        + 'Por favor envía una expresión cron en el siguiente formato:\n\n'
        + '`minuto hora día_mes mes día_semana`\n\n'
        + '*Ejemplos:*\n'
        + '• `0 9 * * *` - Todos los días a las 9:00 AM\n'
        + '• `0 9 * * 1` - Cada lunes a las 9:00 AM\n'
        + '• `0 9 1 * *` - El día 1 de cada mes a las 9:00 AM\n'
        + '• `0 9,18 * * *` - Dos veces al día (9 AM y 6 PM)\n'
        + '• `0 */6 * * *` - Cada 6 horas\n\n'
        + '💡 Usa * para "cualquier valor"',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver', 'schedule_type_recurring')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting custom cron:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  for (const pattern of recurringPatterns) {
    bot.action(`recurring_pattern_${pattern}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) {
          await ctx.answerCbQuery('❌ No autorizado');
          return;
        }

        if (!ctx.session.temp) {
          ctx.session.temp = {};
        }

        ctx.session.temp.recurrencePattern = pattern;
        ctx.session.temp.broadcastStep = 'recurring_max_occurrences';
        await ctx.saveSession();

        await ctx.answerCbQuery();

        await ctx.editMessageText(
          `🔄 *Broadcast ${patternLabels[pattern]}*\n\n`
          + '¿Cuántas veces debe repetirse?\n\n'
          + '♾️ *Sin límite:* Continúa indefinidamente\n'
          + '🔢 *Con límite:* Especifica número de repeticiones',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('♾️ Sin límite', 'recurring_max_unlimited')],
              [Markup.button.callback('5️⃣ 5 veces', 'recurring_max_5'), Markup.button.callback('🔟 10 veces', 'recurring_max_10')],
              [Markup.button.callback('2️⃣0️⃣ 20 veces', 'recurring_max_20'), Markup.button.callback('3️⃣0️⃣ 30 veces', 'recurring_max_30')],
              [Markup.button.callback('◀️ Volver', 'schedule_type_recurring')],
            ]),
          }
        );
      } catch (error) {
        logger.error('Error selecting recurring pattern:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  // Handle max occurrences selection
  const maxOccurrences = [
    { key: 'unlimited', value: null, label: 'Sin límite' },
    { key: '5', value: 5, label: '5 veces' },
    { key: '10', value: 10, label: '10 veces' },
    { key: '20', value: 20, label: '20 veces' },
    { key: '30', value: 30, label: '30 veces' },
  ];

  for (const opt of maxOccurrences) {
    bot.action(`recurring_max_${opt.key}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) {
          await ctx.answerCbQuery('❌ No autorizado');
          return;
        }

        if (!ctx.session.temp) {
          ctx.session.temp = {};
        }

        ctx.session.temp.maxOccurrences = opt.value;
        ctx.session.temp.broadcastStep = 'recurring_timezone';
        await ctx.saveSession();

        await ctx.answerCbQuery();

        await showTimezoneSelection(ctx);
      } catch (error) {
        logger.error('Error selecting max occurrences:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  // Timezone selection helper
  async function showTimezoneSelection(ctx) {
    await ctx.editMessageText(
      '🌍 *Zona Horaria*\n\n'
      + 'Selecciona la zona horaria para la programación:\n\n'
      + '⏰ La hora que ingreses será interpretada en esta zona',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🌎 América/New York (EST)', 'tz_America/New_York')],
          [Markup.button.callback('🌎 América/Los Angeles (PST)', 'tz_America/Los_Angeles')],
          [Markup.button.callback('🌎 América/Mexico City (CST)', 'tz_America/Mexico_City')],
          [Markup.button.callback('🌍 Europa/Madrid (CET)', 'tz_Europe/Madrid')],
          [Markup.button.callback('🌍 Europa/London (GMT)', 'tz_Europe/London')],
          [Markup.button.callback('🌏 UTC', 'tz_UTC')],
          [Markup.button.callback('◀️ Volver', 'schedule_type_recurring')],
        ]),
      }
    );
  }

  // Handle timezone selection
  const timezones = [
    'America/New_York',
    'America/Los_Angeles',
    'America/Mexico_City',
    'Europe/Madrid',
    'Europe/London',
    'UTC',
  ];

  for (const tz of timezones) {
    bot.action(`tz_${tz}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) {
          await ctx.answerCbQuery('❌ No autorizado');
          return;
        }

        if (!ctx.session.temp) {
          ctx.session.temp = {};
        }

        ctx.session.temp.timezone = tz;
        ctx.session.temp.broadcastStep = 'recurring_start_datetime';
        ctx.session.temp.schedulingContext = 'recurring_start';
        ctx.session.temp.schedulingStep = 'selecting_datetime';
        await ctx.saveSession();

        await ctx.answerCbQuery();

        const lang = ctx.session?.language || 'es';
        const dateTimePicker = require('../../utils/dateTimePicker');
        const PREFIX = 'bcast_sched';

        const { text, keyboard } = dateTimePicker.getSchedulingMenu(lang, PREFIX);

        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } catch (error) {
        logger.error('Error selecting timezone:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  // Handle schedule count selection (1-12)
  for (let i = 1; i <= 12; i++) {
    bot.action(`schedule_count_${i}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) {
          await ctx.answerCbQuery('❌ No autorizado');
          return;
        }

        if (!ctx.session.temp) {
          ctx.session.temp = {};
        }

        ctx.session.temp.broadcastStep = 'onetime_timezone';
        ctx.session.temp.scheduleCount = i;
        ctx.session.temp.scheduledTimes = [];
        ctx.session.temp.currentScheduleIndex = 0;
        ctx.session.temp.schedulingContext = 'multi';
        ctx.session.temp.schedulingStep = 'selecting_datetime';
        ctx.session.temp.timezone = null;
        await ctx.saveSession();

        await ctx.answerCbQuery();

        const lang = ctx.session?.language || 'es';
        const dateTimePicker = require('../../utils/dateTimePicker');
        const PREFIX = 'bcast_sched';

        const { text, keyboard } = dateTimePicker.getSchedulingMenu(lang, PREFIX);

        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } catch (error) {
        logger.error('Error selecting schedule count:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  // Handle one-time timezone selection
  for (const tz of timezones) {
    bot.action(`onetime_tz_${tz}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) {
          await ctx.answerCbQuery('❌ No autorizado');
          return;
        }

        if (!ctx.session.temp) {
          ctx.session.temp = {};
        }

        const scheduleCount = ctx.session.temp.scheduleCount || 1;
        ctx.session.temp.timezone = tz;
        ctx.session.temp.broadcastStep = 'schedule_datetime';
        await ctx.saveSession();

        await ctx.answerCbQuery();

        await ctx.editMessageText(
          `📅 *Programar Broadcasts (1/${scheduleCount})*\n\n`
          + `🌍 Zona horaria: ${tz}\n\n`
          + 'Por favor envía la fecha y hora en el siguiente formato:\n\n'
          + '`YYYY-MM-DD HH:MM`\n\n'
          + '*Ejemplos:*\n'
          + '• `2025-12-15 14:30` (15 dic 2025, 2:30 PM)\n'
          + '• `2025-12-25 09:00` (25 dic 2025, 9:00 AM)\n\n'
          + '💡 Tip: Asegúrate de que la fecha sea en el futuro',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          }
        );
      } catch (error) {
        logger.error('Error selecting one-time timezone:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  // Handler for creating scheduled broadcast after visual date/time picker confirmation
  bot.action('broadcast_create_scheduled', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'es';

      // Validate session data
      const confirmedSchedule = ctx.session.temp?.confirmedSchedule;
      const broadcastData = ctx.session.temp?.broadcastData;
      const broadcastTarget = ctx.session.temp?.broadcastTarget;

      if (!confirmedSchedule || !confirmedSchedule.date) {
        const msg = lang === 'es' ? '❌ Sesión expirada. Por favor inicia de nuevo.' : '❌ Session expired. Please start again.';
        await ctx.editMessageText(msg, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '◀️ Volver al Panel' : '◀️ Back to Panel', 'admin_cancel')],
          ]),
        });
        return;
      }

      if (!broadcastData || (!broadcastData.textEn && !broadcastData.textEs && !broadcastData.mediaFileId)) {
        const msg = lang === 'es' ? '❌ Faltan datos del broadcast.' : '❌ Missing broadcast data.';
        await ctx.editMessageText(msg, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '◀️ Volver al Panel' : '◀️ Back to Panel', 'admin_cancel')],
          ]),
        });
        return;
      }

      // Show creating message
      await ctx.editMessageText(
        lang === 'es'
          ? '📤 *Creando broadcast programado...*'
          : '📤 *Creating scheduled broadcast...*',
        { parse_mode: 'Markdown' }
      );

      try {
        const scheduledDate = new Date(confirmedSchedule.date);
        const timezone = confirmedSchedule.timezone || 'UTC';

        // Create the scheduled broadcast
        const broadcast = await broadcastService.createBroadcast({
          adminId: String(ctx.from.id),
          adminUsername: ctx.from.username || 'Admin',
          title: `Broadcast programado ${scheduledDate.toLocaleDateString()} ${scheduledDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} (${timezone})`,
          messageEn: broadcastData.textEn || '',
          messageEs: broadcastData.textEs || '',
          targetType: broadcastTarget || 'all',
          mediaType: broadcastData.mediaType || null,
          mediaUrl: broadcastData.s3Url || broadcastData.mediaFileId || null,
          mediaFileId: broadcastData.mediaFileId || null,
          s3Key: broadcastData.s3Key || null,
          s3Bucket: broadcastData.s3Bucket || null,
          includeFilters: broadcastData.includeFilters || {},
          scheduledAt: scheduledDate,
          timezone: timezone,
        });

        // Add buttons to the broadcast if they exist
        if (broadcastData.buttons && broadcastData.buttons.length > 0) {
          try {
            const BroadcastButtonModel = require('../../../models/broadcastButtonModel');
            await BroadcastButtonModel.addButtonsToBroadcast(broadcast.broadcast_id, broadcastData.buttons);
            logger.info(`Buttons added to broadcast ${broadcast.broadcast_id}`, {
              buttonCount: broadcastData.buttons.length
            });
          } catch (buttonError) {
            logger.error(`Error adding buttons to broadcast ${broadcast.broadcast_id}:`, buttonError);
          }
        }

        logger.info('Broadcast scheduled via visual picker', {
          broadcastId: broadcast.broadcast_id,
          scheduledAt: scheduledDate,
          timezone: timezone,
        });

        // Format date for display
        const dateTimePicker = require('../../utils/dateTimePicker');
        const formattedDate = dateTimePicker.formatDate(scheduledDate, lang, timezone);

        // Clear session data
        ctx.session.temp.broadcastTarget = null;
        ctx.session.temp.broadcastStep = null;
        ctx.session.temp.broadcastData = null;
        ctx.session.temp.confirmedSchedule = null;
        ctx.session.temp.scheduledDate = null;
        ctx.session.temp.timezone = null;
        ctx.session.temp.schedulingStep = null;
        await ctx.saveSession();

        // Show success message
        const successText = lang === 'es'
          ? `✅ *Broadcast Programado*\n\n` +
            `📅 ${formattedDate}\n` +
            `🌍 ${timezone}\n` +
            `🎯 Audiencia: ${broadcastTarget === 'all' ? 'Todos' : broadcastTarget === 'premium' ? 'Premium' : broadcastTarget === 'free' ? 'Gratis' : broadcastTarget === 'payment_incomplete' ? 'Pagos no completados' : broadcastTarget}\n` +
            `🆔 ID: \`${broadcast.broadcast_id}\`\n` +
            `${broadcastData.mediaType ? `📎 Con media (${broadcastData.mediaType})` : '📝 Solo texto'}\n` +
            `${broadcastData.s3Key ? '☁️ Almacenado en S3\n' : ''}` +
            `\n💡 El broadcast se enviará automáticamente.`
          : `✅ *Broadcast Scheduled*\n\n` +
            `📅 ${formattedDate}\n` +
            `🌍 ${timezone}\n` +
            `🎯 Audience: ${broadcastTarget === 'all' ? 'All' : broadcastTarget === 'premium' ? 'Premium' : broadcastTarget === 'free' ? 'Free' : broadcastTarget === 'payment_incomplete' ? 'Payment Not Completed' : broadcastTarget}\n` +
            `🆔 ID: \`${broadcast.broadcast_id}\`\n` +
            `${broadcastData.mediaType ? `📎 With media (${broadcastData.mediaType})` : '📝 Text only'}\n` +
            `${broadcastData.s3Key ? '☁️ Stored in S3\n' : ''}` +
            `\n💡 The broadcast will be sent automatically.`;

        await ctx.reply(successText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '◀️ Volver al Panel Admin' : '◀️ Back to Admin Panel', 'admin_cancel')],
          ]),
        });
      } catch (createError) {
        logger.error('Error creating scheduled broadcast:', createError);
        const safeErrorMessage = escapeMarkdown(createError?.message || 'Unknown error');
        await ctx.reply(
          lang === 'es'
            ? `❌ *Error al crear broadcast*\n\nDetalles: ${safeErrorMessage}`
            : `❌ *Error creating broadcast*\n\nDetails: ${safeErrorMessage}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '◀️ Volver' : '◀️ Back', 'admin_cancel')],
            ]),
          }
        );
      }
    } catch (error) {
      logger.error('Error in broadcast_create_scheduled:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Upload media with S3 support (called when media is uploaded)
  const uploadMediaToS3 = async (ctx, fileId, mediaType) => {
    try {
      logger.info(`Uploading ${mediaType} to S3...`, { fileId });

      // Show upload progress
      await ctx.reply(
        '☁️ Subiendo archivo a almacenamiento seguro (S3)...',
        { parse_mode: 'Markdown' }
      );

      // Upload to S3
      const uploadResult = await s3Service.uploadTelegramFileToS3(
        bot,
        fileId,
        mediaType,
        {
          folder: 'broadcasts',
          metadata: {
            admin_id: String(ctx.from.id),
            admin_username: ctx.from.username || 'unknown',
          },
        }
      );

      logger.info('S3 upload successful', {
        s3Key: uploadResult.s3Key,
        s3Url: uploadResult.s3Url,
      });

      // Store both S3 and Telegram file info
      if (!ctx.session.temp.broadcastData) {
        ctx.session.temp.broadcastData = {};
      }

      ctx.session.temp.broadcastData.mediaType = mediaType;
      ctx.session.temp.broadcastData.mediaFileId = fileId; // Keep for fallback
      ctx.session.temp.broadcastData.s3Key = uploadResult.s3Key;
      ctx.session.temp.broadcastData.s3Url = uploadResult.s3Url;
      ctx.session.temp.broadcastData.s3Bucket = uploadResult.s3Bucket;

      await ctx.saveSession();

      return uploadResult;
    } catch (error) {
      logger.error('Error uploading to S3:', error);
      throw error;
    }
  };

  return {
    uploadMediaToS3,
  };
};

/**
 * Send broadcast immediately using new broadcast service
 * @param {Context} ctx - Telegraf context
 * @param {Telegraf} bot - Bot instance
 */
async function sendBroadcastNow(ctx, bot) {
  try {
    const { broadcastTarget, broadcastData } = ctx.session.temp;

    if (!broadcastData || !broadcastData.textEn || !broadcastData.textEs) {
      await ctx.reply('❌ Error: Faltan datos del broadcast');
      return;
    }

    await ctx.editMessageText(
      '📤 *Enviando Broadcast...*\n\n'
      + 'Tu broadcast se está enviando a los usuarios seleccionados.\n'
      + 'Esto puede tardar unos minutos dependiendo del número de destinatarios...',
      { parse_mode: 'Markdown' }
    );

    // Create broadcast record
    const broadcast = await broadcastService.createBroadcast({
      adminId: String(ctx.from.id),
      adminUsername: ctx.from.username || 'Admin',
      title: `Broadcast ${new Date().toLocaleDateString()}`,
      messageEn: broadcastData.textEn,
      messageEs: broadcastData.textEs,
      targetType: broadcastTarget,
      mediaType: broadcastData.mediaType || null,
      mediaUrl: broadcastData.s3Url || broadcastData.mediaFileId || null,
      mediaFileId: broadcastData.mediaFileId || null,
      s3Key: broadcastData.s3Key || null,
      s3Bucket: broadcastData.s3Bucket || null,
      includeFilters: broadcastData.includeFilters || {},
      scheduledAt: null, // Immediate
      timezone: 'UTC',
    });

    logger.info('Broadcast created', {
      broadcastId: broadcast.broadcast_id,
      target: broadcastTarget,
    });

    // Queue broadcast using async queue if available
    let results;
    const queueIntegration = global.broadcastQueueIntegration;
    if (queueIntegration) {
      try {
        const job = await queueIntegration.queueBroadcast(broadcast.broadcast_id);
        logger.info('Broadcast queued', {
          broadcastId: broadcast.broadcast_id,
          jobId: job.job_id,
        });
        results = { success: true, jobId: job.job_id, queued: true };
      } catch (error) {
        logger.warn('Failed to queue broadcast, falling back to sync:', error.message);
        results = await broadcastService.sendBroadcast(bot, broadcast.broadcast_id);
      }
    } else {
      // Fallback if queue not initialized
      results = await broadcastService.sendBroadcast(bot, broadcast.broadcast_id);
    }

    // Clear session data
    ctx.session.temp.broadcastTarget = null;
    ctx.session.temp.broadcastStep = null;
    ctx.session.temp.broadcastData = null;
    await ctx.saveSession();

    // Show results
    await ctx.reply(
      `✅ *Broadcast Completado*\n\n`
      + `📊 *Estadísticas:*\n`
      + `✓ Enviados: ${results.sent}\n`
      + `✗ Fallidos: ${results.failed}\n`
      + `🚫 Bloqueados: ${results.blocked}\n`
      + `👤 Desactivados: ${results.deactivated}\n`
      + `📈 Total intentos: ${results.total}\n\n`
      + `🎯 Audiencia: ${broadcastTarget === 'all' ? 'Todos' : broadcastTarget === 'premium' ? 'Premium' : broadcastTarget === 'free' ? 'Gratis' : broadcastTarget === 'payment_incomplete' ? 'Pagos no completados' : broadcastTarget}\n`
      + `🆔 ID: \`${broadcast.broadcast_id}\`\n`
      + `${broadcastData.mediaType ? `📎 Con media (${broadcastData.mediaType})` : '📝 Solo texto'}\n`
      + `${broadcastData.s3Key ? '☁️ Almacenado en S3' : ''}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
        ]),
      }
    );

    logger.info('Broadcast completed', {
      broadcastId: broadcast.broadcast_id,
      results,
    });
  } catch (error) {
    logger.error('Error sending broadcast:', error);
    await ctx.reply(
      '❌ *Error al enviar broadcast*\n\n'
      + `Detalles: ${error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Schedule broadcast for later
 * @param {Context} ctx - Telegraf context
 * @param {Date} scheduledDate - When to send
 */
async function scheduleBroadcastForLater(ctx, scheduledDate) {
  try {
    const { broadcastTarget, broadcastData } = ctx.session.temp;

    if (!broadcastData || !broadcastData.textEn || !broadcastData.textEs) {
      await ctx.reply('❌ Error: Faltan datos del broadcast');
      return;
    }

    // Create scheduled broadcast
    const broadcast = await broadcastService.createBroadcast({
      adminId: String(ctx.from.id),
      adminUsername: ctx.from.username || 'Admin',
      title: `Broadcast programado ${scheduledDate.toLocaleDateString()}`,
      messageEn: broadcastData.textEn,
      messageEs: broadcastData.textEs,
      targetType: broadcastTarget,
      mediaType: broadcastData.mediaType || null,
      mediaUrl: broadcastData.s3Url || broadcastData.mediaFileId || null,
      mediaFileId: broadcastData.mediaFileId || null,
      s3Key: broadcastData.s3Key || null,
      s3Bucket: broadcastData.s3Bucket || null,
      includeFilters: broadcastData.includeFilters || {},
      scheduledAt: scheduledDate,
      timezone: 'UTC',
    });

    logger.info('Broadcast scheduled', {
      broadcastId: broadcast.broadcast_id,
      scheduledAt: scheduledDate,
    });

    // Clear session data
    ctx.session.temp.broadcastTarget = null;
    ctx.session.temp.broadcastStep = null;
    ctx.session.temp.broadcastData = null;
    await ctx.saveSession();

    // Show confirmation
    await ctx.reply(
      `✅ *Broadcast Programado*\n\n`
      + `📅 Fecha programada: ${scheduledDate.toLocaleString('es-ES', { timeZone: 'UTC' })} UTC\n`
      + `🎯 Audiencia: ${broadcastTarget === 'all' ? 'Todos' : broadcastTarget === 'premium' ? 'Premium' : broadcastTarget === 'free' ? 'Gratis' : broadcastTarget === 'payment_incomplete' ? 'Pagos no completados' : broadcastTarget}\n`
      + `🆔 ID: \`${broadcast.broadcast_id}\`\n`
      + `${broadcastData.mediaType ? `📎 Con media (${broadcastData.mediaType})` : '📝 Solo texto'}\n`
      + `${broadcastData.s3Key ? '☁️ Almacenado en S3\n' : ''}`
      + `\n💡 El broadcast se enviará automáticamente a la hora programada.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
        ]),
      }
    );
  } catch (error) {
    logger.error('Error scheduling broadcast:', error);
    await ctx.reply(
      '❌ *Error al programar broadcast*\n\n'
      + `Detalles: ${error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
}

module.exports = {
  registerBroadcastHandlers,
  sendBroadcastNow,
  scheduleBroadcastForLater,
};
