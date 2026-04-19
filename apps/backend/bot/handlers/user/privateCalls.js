const { Markup } = require('telegraf');
const BookingAvailabilityIntegration = require('../../../services/bookingAvailabilityIntegration');
const BookingModel = require('../../../models/bookingModel');
const PerformerProfileModel = require('../../../models/performerProfileModel');
const VideoCallService = require('../../../services/videoCallService');
const RoleService = require('../../../services/roleService');
const UserModel = require('../../../models/userModel');
const PaymentService = require('../../../services/paymentService');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const { t } = require('../../../utils/i18n');

/**
 * Private call handlers for users
 * @param {Telegraf} bot - Bot instance
 */
const registerPrivateCallHandlers = (bot) => {
  // Show private call booking - First select performer
  bot.action(/^book_private_call(?::(\d+))?$/, async (ctx) => {
    try {
      const performerId = ctx.match[1];

      if (performerId) {
        const performer = await UserModel.getById(performerId);
        if (performer) {
          ctx.session.temp = ctx.session.temp || {};
          ctx.session.temp.selectedPerformer = performer;
          await ctx.saveSession();
          return promptForPayment(ctx);
        }
      }

      const lang = getLanguage(ctx);
      
      const performers = await RoleService.getUsersByRole('PERFORMER');
      const onlinePerformers = [];
      for (const performerId of performers) {
          const performer = await UserModel.getById(performerId);
          if (performer && performer.status === 'online') {
              const availability = await BookingAvailabilityIntegration.checkInstantAvailability(performer.id, 45);
              if (availability.available) {
                onlinePerformers.push(performer);
              }
          }
      }

      const availabilityIndicator = onlinePerformers.length > 0
        ? '🟢 *Available Now*'
        : '🔴 *Currently Unavailable*';

      const message = lang === 'es'
        ? `📞 *PNP Live*\n\n` +
          `${availabilityIndicator}\n\n` +
          `💎 *¿Qué incluye?*\n` +
          `• 45 minutos de consulta personalizada\n` +
          `• Videollamada directa (calidad HD)\n` +
          `• Consejos expertos y orientación\n` +
          `• Horario flexible\n\n` +
          `💰 *Precio:* $100 USD (USDC en Optimism)\n\n` +
          `📱 *Puedes pagar con:*\n` +
          `• Zelle\n` +
          `• CashApp\n` +
          `• Venmo\n` +
          `• Revolut\n` +
          `• Wise\n\n` +
          (onlinePerformers.length > 0
            ? '👥 *Elige con quién quieres la llamada:*'
            : '⏰ No disponible en este momento. Te notificaremos cuando haya disponibilidad.')
        : `📞 *PNP Live*\n\n` +
          `${availabilityIndicator}\n\n` +
          `💎 *What's included:*\n` +
          `• 45 minutes of personalized consultation\n` +
          `• Direct video call (HD quality)\n` +
          `• Expert advice and guidance\n` +
          `• Flexible scheduling\n\n` +
          `💰 *Price:* $100 USD (USDC on Optimism)\n\n` +
          `📱 *You can pay using:*\n` +
          `• Zelle\n` +
          `• CashApp\n` +
          `• Venmo\n` +
          `• Revolut\n` +
          `• Wise\n\n` +
          (onlinePerformers.length > 0
            ? '👥 *Choose who you want to talk to:*'
            : '⏰ Not available right now. We\'ll notify you when available.');

      const buttons = onlinePerformers.length > 0
        ? onlinePerformers.map(p => [
            Markup.button.callback(`Book ${p.firstName}`, `select_performer_${p.id}`),
            Markup.button.callback(`View Profile`, `view_performer_profile_${p.id}`),
          ])
        : [
          [Markup.button.callback('🔔 Notify Me', 'notify_call_availability')],
        ];
        
      if(buttons.length > 0) {
        buttons.push([Markup.button.callback(t('back', lang), 'back_to_main')]);
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing private call booking:', error);
    }
  });

  bot.action(/^view_performer_profile_(\d+)$/, async (ctx) => {
    try {
      const performerId = ctx.match[1];
      const performer = await UserModel.getById(performerId);
      if (!performer) {
        return ctx.answerCbQuery('Performer not found.');
      }

      const profile = await PerformerProfileModel.getByUserId(performerId);
      if (!profile) {
        return ctx.answerCbQuery('Profile not found.');
      }

      const message = `
*${performer.firstName}*

*Bio:*
${profile.bio || '_Not set_'}

*Rates:*
${profile.rates ? JSON.stringify(profile.rates) : '_Not set_'}

*Tags:*
${profile.tags ? profile.tags.join(', ') : '_Not set_'}
      `;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`Book ${performer.firstName}`, `select_performer_${performer.id}`)],
          [Markup.button.callback('⬅️ Back', 'book_private_call')],
        ]),
      });
    } catch (error) {
      logger.error('Error viewing performer profile:', error);
    }
  });

  bot.action(/^select_performer_(\d+)$/, async (ctx) => {
    try {
      const performerId = ctx.match[1];
      const performer = await UserModel.getById(performerId);
      if (!performer) {
        return ctx.answerCbQuery('Performer not found.');
      }

      const bookingData = {
        userId: ctx.from.id,
        modelId: performer.id,
        durationMinutes: 45,
        preferredStartTime: new Date(),
        searchStartTime: new Date(),
        searchEndTime: new Date(new Date().getTime() + 2 * 60 * 60 * 1000), // 2 hours from now
      };

      const { booking } = await BookingAvailabilityIntegration.createSmartBooking(bookingData);

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.bookingId = booking.id;
      ctx.session.temp.selectedPerformer = performer;
      await ctx.saveSession();

      const lang = getLanguage(ctx);
      const message = lang === 'es'
        ? `🎭 *Llamada con ${performer.firstName}*\n\n`
          + `Has seleccionado una llamada privada de 45 minutos con ${performer.firstName}.\n\n`
          + '💰 Precio: $100 USD\n\n'
          + 'Procede al pago para reservar tu llamada.'
        : `🎭 *Call with ${performer.firstName}*\n\n`
          + `You\'ve selected a 45-minute private call with ${performer.firstName}.\n\n`
          + '💰 Price: $100 USD\n\n'
          + 'Proceed to payment to book your call.';

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💳 Pay & Book', 'pay_for_private_call')],
          [Markup.button.callback(t('back', lang), 'book_private_call')],
        ]),
      });
    } catch (error) {
      logger.error('Error selecting performer:', error);
    }
  });

async function promptForPayment(ctx) {
  try {
    const lang = getLanguage(ctx);
    const userId = ctx.from.id;
    const chatId = ctx.chat?.id;
    const bookingId = ctx.session.temp.bookingId;

    const booking = await BookingModel.getById(bookingId);
    if (!booking) {
      return ctx.reply('Booking not found.');
    }

    // Create payment for private call (as a special plan).
    // Daimo retired — bot flow falls back to ePayco; users on the webapp
    // get the Dash + ePayco picker via BookCallModal.
    const result = await PaymentService.createPayment({
      userId,
      planId: 'private_call_45min', // This should be dynamic based on the booking
      provider: 'epayco',
      chatId,
      bookingId: booking.id,
      amount: booking.priceCents / 100,
    });

    if (result.success) {
      // Store temp data for booking after payment
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.pendingCallPayment = result.paymentId;
      await ctx.saveSession();

      const paymentMessage = lang === 'es'
        ? `💳 *Pago de PNP Live*\n\n` +
          `Precio: ${booking.priceCents / 100} USDC\n\n` +
          `📱 *Puedes pagar usando:*\n` +
          `• Zelle\n` +
          `• CashApp\n` +
          `• Venmo\n` +
          `• Revolut\n` +
          `• Wise\n\n` +
          `💡 *Cómo funciona:*\n` +
          `1. Haz clic en "Pagar Ahora"\n` +
          `2. Elige tu app de pago preferida\n` +
          `3. El pago se convierte automáticamente a USDC\n` +
          `4. Agenda tu llamada inmediatamente después\n\n` +
          `🔒 Seguro y rápido en la red Optimism`
        : `💳 *PNP Live Payment*\n\n` +
          `Price: ${booking.priceCents / 100} USDC\n\n` +
          `📱 *You can pay using:*\n` +
          `• Zelle\n` +
          `• CashApp\n` +
          `• Venmo\n` +
          `• Revolut\n` +
          `• Wise\n\n` +
          `💡 *How it works:*\n` +
          `1. Click "Pay Now"\n` +
          `2. Choose your preferred payment app\n` +
          `3. Payment is automatically converted to USDC\n` +
          `4. Schedule your call immediately after\n\n` +
          `🔒 Secure and fast on Optimism network`;

      await ctx.editMessageText(paymentMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💰 Pay Now', result.paymentUrl)],
          [Markup.button.callback(t('back', lang), 'book_private_call')],
        ]),
      });
    } else {
      await ctx.editMessageText(
        `${t('error', lang)}\n\n${result.error}`,
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'book_private_call')],
          ]),
        },
      );
    }
  } catch (error) {
    logger.error('Error processing call payment:', error);
    const lang = getLanguage(ctx);
    await ctx.editMessageText(
      t('error', lang),
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback(t('back', lang), 'book_private_call')],
        ]),
      },
    ).catch(() => {});
  }
}

  // Pay for private call
  bot.action('pay_for_private_call', async (ctx) => {
    await promptForPayment(ctx);
  });

  // After payment: schedule the call
  bot.action('schedule_private_call', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const bookingId = ctx.session.temp.bookingId;
      const booking = await BookingModel.getById(bookingId);

      const message = lang === 'es'
        ? '📅 *Agenda tu Llamada*\n\n'
          + '¡Pago confirmado! 🎉\n\n'
          + 'Elige cuándo quieres tu llamada:'
        : '📅 *Schedule Your Call*\n\n'
          + 'Payment confirmed! 🎉\n\n'
          + 'Choose when you want your call:';

      const buttons = [];

      buttons.push([
        Markup.button.callback(
          lang === 'es' ? '⚡ Ahora' : '⚡ Now',
          `schedule_call_now:${booking.id}`,
        ),
      ]);

      // Add custom schedule button
      buttons.push([
        Markup.button.callback(
          lang === 'es' ? '📆 Elegir fecha/hora' : '📆 Choose date/time',
          `schedule_call_custom:${booking.id}`,
        ),
      ]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error in schedule_private_call:', error);
    }
  });

  // Quick schedule (now)
  bot.action(/^schedule_call_now:(\S+)$/, async (ctx) => {
    try {
      const bookingId = ctx.match[1];
      const booking = await BookingModel.getById(bookingId);
      const performer = await UserModel.getById(booking.performerId);
      const user = await UserModel.getById(booking.userId);

      const meetingUrl = await VideoCallService.createMeetingRoom({
        callId: booking.id,
        userName: user.firstName,
        scheduledDate: new Date(),
      });

      await BookingModel.update(bookingId, { meetingUrl });
      
      const lang = getLanguage(ctx);
      const message = lang === 'es'
          ? `✅ *¡Llamada Reservada!*\n\n` +
            `🎭 Con: ${performer.firstName}\n` +
            `📅 Fecha: Ahora\n` +
            `⏰ Hora: Ahora\n` +
            `⏱ Duración: ${booking.durationMinutes} minutos\n\n` +
            `🔗 *Link de la llamada:*\n` +
            `${meetingUrl}\n\n` +
            `⚡ *Tu llamada comienza ahora!*\n` +
            `Prepárate y únete usando el link de arriba.\n\n` +
            `¡Nos vemos pronto! 👋`
          : `✅ *Call Booked!*\n\n` +
            `🎭 With: ${performer.firstName}\n` +
            `📅 Date: Now\n` +
            `⏰ Time: Now\n` +
            `⏱ Duration: ${booking.durationMinutes} minutes\n\n` +
            `🔗 *Join Link:*\n` +
            `${meetingUrl}\n\n` +
            `⚡ *Your call starts now!*\n` +
            `Get ready and join using the link above.\n\n` +
            `See you soon! 👋`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🎥 Join Call', meetingUrl)],
        ]),
      });
      
      // Notify performer
      await bot.telegram.sendMessage(performer.id, `¡Tienes una nueva llamada de PNP Live con ${user.firstName}! Link: ${meetingUrl}`);

    } catch (error) {
      logger.error('Error in quick schedule:', error);
      const lang = getLanguage(ctx);
      await ctx.editMessageText(
        t('error', lang),
      ).catch(() => {});
    }
  });

  // Custom schedule
  bot.action(/^schedule_call_custom:(\S+)$/, async (ctx) => {
    try {
      const bookingId = ctx.match[1];
      const lang = getLanguage(ctx);

      const message = lang === 'es'
        ? '📅 *Agenda tu Llamada*\n\n'
          + 'Por favor, envía tu fecha y hora preferida en el siguiente formato:\n\n'
          + '📅 Fecha: DD/MM/YYYY\n'
          + '⏰ Hora: HH:MM (zona horaria)\n\n'
          + 'Ejemplo:\n'
          + '25/01/2025\n'
          + '15:00 EST'
        : '📅 *Schedule Your Call*\n\n'
          + 'Please send your preferred date and time in the following format:\n\n'
          + '📅 Date: DD/MM/YYYY\n'
          + '⏰ Time: HH:MM (timezone)\n\n'
          + 'Example:\n'
          + '01/25/2025\n'
          + '3:00 PM EST';

      // Set user state to expect scheduling input
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.awaitingCallSchedule = bookingId;
      await ctx.saveSession();

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      logger.error('Error in custom schedule:', error);
    }
  });

  // Handle scheduling input (text message)
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.session?.temp?.awaitingCallSchedule) {
        const bookingId = ctx.session.temp.awaitingCallSchedule;
        const { text } = ctx.message;
        
        const lines = text.split('\n');
        const scheduledDate = lines[0]?.trim();
        const scheduledTime = lines[1]?.trim();

        if (!scheduledDate || !scheduledTime) {
          await ctx.reply(
            '⚠️ Please provide both date and time.\n\n'
            + 'Format:\n'
            + 'DD/MM/YYYY\n'
            + 'HH:MM timezone',
          );
          return;
        }

        const booking = await BookingModel.getById(bookingId);
        const performer = await UserModel.getById(booking.performerId);
        const user = await UserModel.getById(booking.userId);

        const meetingUrl = await VideoCallService.createMeetingRoom({
            callId: booking.id,
            userName: user.firstName,
            scheduledDate: new Date(`${scheduledDate} ${scheduledTime}`),
        });

        await BookingModel.update(bookingId, { meetingUrl, startTimeUtc: new Date(`${scheduledDate} ${scheduledTime}`) });
        
        delete ctx.session.temp.awaitingCallSchedule;
        await ctx.saveSession();

        const lang = getLanguage(ctx);
        const message = lang === 'es'
            ? `✅ *¡Llamada Reservada!*\n\n` +
              `🎭 Con: ${performer.firstName}\n` +
              `📅 Fecha: ${scheduledDate}\n` +
              `⏰ Hora: ${scheduledTime}\n` +
              `⏱ Duración: ${booking.durationMinutes} minutos\n\n` +
              `🔗 *Link de la llamada:*\n` +
              `${meetingUrl}\n\n` +
              `📧 Recibirás un recordatorio 15 minutos antes de la llamada.\n\n` +
              `¡Nos vemos pronto! 👋`
            : `✅ *Call Booked Successfully!*\n\n` +
              `🎭 With: ${performer.firstName}\n` +
              `📅 Date: ${scheduledDate}\n` +
              `⏰ Time: ${scheduledTime}\n` +
              `⏱ Duration: ${booking.durationMinutes} minutes\n\n` +
              `🔗 *Join Link:*\n` +
              `${meetingUrl}\n\n` +
              `📧 You\'ll receive a reminder 15 minutes before the call.\n\n` +
              `See you soon! 👋`;

        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                [{ text: '📅 Add to Calendar', url: meetingUrl }],
                ],
            },
        });
        
        // Notify performer
        await bot.telegram.sendMessage(performer.id, `¡Tienes una nueva llamada de PNP Live con ${user.firstName}! Link: ${meetingUrl}`);

        return;
      }

      // Continue to next handler if not awaiting schedule
      return next();
    } catch (error) {
      logger.error('Error processing call scheduling:', error);
      return next();
    }
  });

  // Notify me when available
  bot.action('notify_call_availability', async (ctx) => {
    try {
      // This would typically store user preference in database
      // For now, just acknowledge
      await ctx.answerCbQuery('✅ You\'ll be notified when available!');
      await ctx.editMessageText(
        '🔔 *Notification Enabled*\n\n'
        + 'We\'ll send you a message as soon as slots become available.\n\n'
        + 'Stay tuned! 📢',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'back_to_main')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in notify_call_availability:', error);
    }
  });

  // View my booked calls
  bot.action('my_private_calls', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = getLanguage(ctx);
      const calls = await BookingModel.getByUser(userId);

      if (calls.length === 0) {
        await ctx.editMessageText(
          '📅 *My Calls*\n\n'
          + 'You haven\'t booked any calls yet.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📞 Book a Call', 'book_private_call')],
              [Markup.button.callback(t('back', lang), 'back_to_main')],
            ]),
          },
        );
        return;
      }

      let message = '📅 *My Private Calls*\n\n';

      calls.forEach((call, index) => {
        const statusEmoji = {
          pending: '⏳',
          confirmed: '✅',
          completed: '✔️',
          cancelled: '❌',
        }[call.status] || '📞';

        message
          += `${index + 1}. ${statusEmoji} ${call.status.toUpperCase()}\n`
          + `   With: ${call.performerName}\n`
          + `   📅 ${new Date(call.startTimeUtc).toLocaleString()}\n`
          + `   ⏱ ${call.durationMinutes} minutes\n`;

        if (call.meetingUrl && (call.status === 'confirmed' || call.status === 'pending')) {
          message += `   🔗 ${call.meetingUrl}\n`;
        }

        message += '\n';
      });

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📞 Book Another Call', 'book_private_call')],
          [Markup.button.callback(t('back', lang), 'back_to_main')],
        ]),
      });
    } catch (error) {
      logger.error('Error viewing user calls:', error);
    }
  });
};

module.exports = registerPrivateCallHandlers;
