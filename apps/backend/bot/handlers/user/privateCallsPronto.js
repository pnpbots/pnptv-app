const { Markup } = require('telegraf');
const PrivateCallBookingService = require('../../services/privateCallBookingService');
const { getLanguage } = require('../../utils/helpers');
const logger = require('../../../utils/logger');

/**
 * Private Calls Pronto Handler
 * Full booking flow: Eligibility -> Performer -> Type -> Duration -> Slot -> Rules -> Payment -> Confirm
 */

const registerPrivateCallsProntoHandlers = (bot) => {
  // =====================================================
  // STEP 0: START - Check Eligibility
  // =====================================================

  bot.action('PRIVATECALL_START', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      // Check eligibility
      const eligibility = await PrivateCallBookingService.checkEligibility(userId);

      if (!eligibility.eligible) {
        // Handle different eligibility issues
        if (eligibility.reasons.includes('membership_required') || eligibility.reasons.includes('membership_expired')) {
          const message = lang === 'es'
            ? '`🔒 VIDEO LLAMADA VIP - SOLO PRIME`\n\n' +
              '¡Hola! Esta función exclusiva está disponible solo para miembros PRIME.\n\n' +
              '**Con PRIME puedes disfrutar de:**\n\n' +
              '📞 **Video Llamadas VIP 1:1** — Llamadas privadas con modelos\n' +
              '🎥 **Video o Audio** — Elige tu formato preferido\n' +
              '⏱️ **Duraciones Flexibles** — 15, 30 o 60 minutos\n' +
              '📅 **Programación Anticipada** — Reserva con tiempo\n\n' +
              '`¡Hazte PRIME y disfruta de llamadas exclusivas! 💎`'
            : '`🔒 VIDEO CALL VIP - PRIME ONLY`\n\n' +
              'Hey! This exclusive feature is only available for PRIME members.\n\n' +
              '**With PRIME you can enjoy:**\n\n' +
              '📞 **VIP 1:1 Video Calls** — Private calls with models\n' +
              '🎥 **Video or Audio** — Choose your preferred format\n' +
              '⏱️ **Flexible Durations** — 15, 30 or 60 minutes\n' +
              '📅 **Advanced Scheduling** — Book in advance\n\n' +
              '`Go PRIME and enjoy exclusive calls! 💎`';

          await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '💎 VER PLANES PRIME' : '💎 VIEW PRIME PLANS', 'show_subscription_plans')],
              [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menú' : '🔙 Back to Menu', 'back_to_main')],
            ]),
          });
          return;
        }

        if (eligibility.reasons.includes('age_not_verified')) {
          await ctx.editMessageText(
            lang === 'es'
              ? '🔞 Debes verificar tu edad para acceder a las llamadas privadas.'
              : '🔞 You must verify your age to access private calls.',
            Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '✅ Verificar Edad' : '✅ Verify Age', 'verify_age')],
              [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')],
            ])
          );
          return;
        }

        if (eligibility.isRestricted) {
          await ctx.editMessageText(
            lang === 'es'
              ? '⚠️ Tu cuenta tiene restricciones. Contacta soporte para más información.'
              : '⚠️ Your account has restrictions. Contact support for more information.',
            Markup.inlineKeyboard([
              [Markup.button.callback(lang === 'es' ? '📞 Soporte' : '📞 Support', 'support')],
              [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')],
            ])
          );
          return;
        }
      }

      // User is eligible - show performers
      await showPerformersList(ctx, lang);
    } catch (error) {
      logger.error('Error in PRIVATECALL_START:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // STEP 1: PERFORMER SELECTION
  // =====================================================

  async function showPerformersList(ctx, lang) {
    const performers = await PrivateCallBookingService.getAvailablePerformers();

    if (performers.length === 0) {
      await ctx.editMessageText(
        lang === 'es'
          ? '😔 No hay modelos disponibles en este momento. Intenta más tarde.'
          : '😔 No models available right now. Try again later.',
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')],
        ])
      );
      return;
    }

    const message = lang === 'es'
      ? '📞 *Reservar Llamada Privada 1:1*\n\n' +
        'Selecciona con quién quieres hablar:\n\n' +
        performers.map(p => `• *${p.displayName}* - $${(p.basePriceCents / 100).toFixed(0)}/30min`).join('\n')
      : '📞 *Book 1:1 Private Call*\n\n' +
        'Select who you want to talk to:\n\n' +
        performers.map(p => `• *${p.displayName}* - $${(p.basePriceCents / 100).toFixed(0)}/30min`).join('\n');

    const buttons = performers.map(p => [
      Markup.button.callback(
        `🎭 ${p.displayName}`,
        `PC_PICK_PERFORMER:${p.id}`
      ),
    ]);
    buttons.push([Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  bot.action(/^PC_PICK_PERFORMER:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const performerId = ctx.match[1];

      // Store in session
      ctx.session.privateCallBooking = {
        performerId,
        step: 'call_type',
      };

      const performer = await PrivateCallBookingService.getPerformer(performerId);

      if (!performer) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ Modelo no encontrado.' : '❌ Model not found.',
          Markup.inlineKeyboard([[Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'PRIVATECALL_START')]])
        );
        return;
      }

      // Show call type selection
      const message = lang === 'es'
        ? `🎭 *${performer.displayName}*\n\n` +
          `${performer.bio || ''}\n\n` +
          `💰 Precio base: $${(performer.basePriceCents / 100).toFixed(0)}/30min\n\n` +
          '¿Qué tipo de llamada prefieres?'
        : `🎭 *${performer.displayName}*\n\n` +
          `${performer.bio || ''}\n\n` +
          `💰 Base price: $${(performer.basePriceCents / 100).toFixed(0)}/30min\n\n` +
          'What type of call do you prefer?';

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '📹 Video' : '📹 Video', 'PC_PICK_TYPE:video')],
          [Markup.button.callback(lang === 'es' ? '🎙 Audio' : '🎙 Audio', 'PC_PICK_TYPE:audio')],
          [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'PRIVATECALL_START')],
        ]),
      });
    } catch (error) {
      logger.error('Error in PC_PICK_PERFORMER:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // STEP 2: CALL TYPE SELECTION
  // =====================================================

  bot.action(/^PC_PICK_TYPE:(video|audio)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const callType = ctx.match[1];

      if (!ctx.session.privateCallBooking) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ Sesión expirada. Comienza de nuevo.' : '❌ Session expired. Start again.',
          Markup.inlineKeyboard([[Markup.button.callback(lang === 'es' ? '🔄 Reiniciar' : '🔄 Restart', 'PRIVATECALL_START')]])
        );
        return;
      }

      ctx.session.privateCallBooking.callType = callType;
      ctx.session.privateCallBooking.step = 'duration';

      const performer = await PrivateCallBookingService.getPerformer(ctx.session.privateCallBooking.performerId);
      const basePrice = performer?.basePriceCents || 10000;

      // Show duration selection
      const message = lang === 'es'
        ? `⏱ *Selecciona la duración*\n\n` +
          `Tipo: ${callType === 'video' ? '📹 Video' : '🎙 Audio'}\n\n` +
          `Precios:\n` +
          `• 15 min - $${(basePrice * 0.5 / 100).toFixed(0)}\n` +
          `• 30 min - $${(basePrice / 100).toFixed(0)}\n` +
          `• 60 min - $${(basePrice * 2 / 100).toFixed(0)}`
        : `⏱ *Select duration*\n\n` +
          `Type: ${callType === 'video' ? '📹 Video' : '🎙 Audio'}\n\n` +
          `Prices:\n` +
          `• 15 min - $${(basePrice * 0.5 / 100).toFixed(0)}\n` +
          `• 30 min - $${(basePrice / 100).toFixed(0)}\n` +
          `• 60 min - $${(basePrice * 2 / 100).toFixed(0)}`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`15 min - $${(basePrice * 0.5 / 100).toFixed(0)}`, 'PC_PICK_DURATION:15')],
          [Markup.button.callback(`30 min - $${(basePrice / 100).toFixed(0)}`, 'PC_PICK_DURATION:30')],
          [Markup.button.callback(`60 min - $${(basePrice * 2 / 100).toFixed(0)}`, 'PC_PICK_DURATION:60')],
          [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', `PC_PICK_PERFORMER:${ctx.session.privateCallBooking.performerId}`)],
        ]),
      });
    } catch (error) {
      logger.error('Error in PC_PICK_TYPE:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // STEP 3: DURATION SELECTION
  // =====================================================

  bot.action(/^PC_PICK_DURATION:(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const duration = parseInt(ctx.match[1]);

      if (!ctx.session.privateCallBooking) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ Sesión expirada.' : '❌ Session expired.',
          Markup.inlineKeyboard([[Markup.button.callback('🔄', 'PRIVATECALL_START')]])
        );
        return;
      }

      ctx.session.privateCallBooking.durationMinutes = duration;
      ctx.session.privateCallBooking.step = 'slot';
      ctx.session.privateCallBooking.slotPage = 0;

      await showSlotSelection(ctx, lang, 0);
    } catch (error) {
      logger.error('Error in PC_PICK_DURATION:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // STEP 4: SLOT SELECTION
  // =====================================================

  async function showSlotSelection(ctx, lang, page = 0) {
    const booking = ctx.session.privateCallBooking;
    const slotsPerPage = 6;

    // Get available slots for next 14 days
    const fromDate = new Date();
    const toDate = new Date(fromDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    const allSlots = await PrivateCallBookingService.getAvailableSlots(
      booking.performerId,
      fromDate,
      toDate,
      booking.durationMinutes
    );

    if (allSlots.length === 0) {
      await ctx.editMessageText(
        lang === 'es'
          ? '😔 No hay horarios disponibles en los próximos 14 días.'
          : '😔 No available slots in the next 14 days.',
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', `PC_PICK_TYPE:${booking.callType}`)],
        ])
      );
      return;
    }

    const totalPages = Math.ceil(allSlots.length / slotsPerPage);
    const startIdx = page * slotsPerPage;
    const pageSlots = allSlots.slice(startIdx, startIdx + slotsPerPage);

    const message = lang === 'es'
      ? `📅 *Selecciona un horario*\n\n` +
        `Duración: ${booking.durationMinutes} min\n` +
        `Página ${page + 1}/${totalPages}`
      : `📅 *Select a time slot*\n\n` +
        `Duration: ${booking.durationMinutes} min\n` +
        `Page ${page + 1}/${totalPages}`;

    const buttons = pageSlots.map(slot => {
      const date = new Date(slot.startUtc);
      const dateStr = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const timeStr = date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const epochTime = Math.floor(date.getTime() / 1000);

      return [Markup.button.callback(`${dateStr} ${timeStr}`, `PC_PICK_SLOT:${epochTime}`)];
    });

    // Navigation buttons
    const navButtons = [];
    if (page > 0) {
      navButtons.push(Markup.button.callback('⬅️', `PC_SLOTS_PAGE:${page - 1}`));
    }
    if (page < totalPages - 1) {
      navButtons.push(Markup.button.callback('➡️', `PC_SLOTS_PAGE:${page + 1}`));
    }
    if (navButtons.length > 0) {
      buttons.push(navButtons);
    }

    buttons.push([Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', `PC_PICK_TYPE:${booking.callType}`)]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  bot.action(/^PC_SLOTS_PAGE:(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const page = parseInt(ctx.match[1]);

      ctx.session.privateCallBooking.slotPage = page;
      await showSlotSelection(ctx, lang, page);
    } catch (error) {
      logger.error('Error in PC_SLOTS_PAGE:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  bot.action(/^PC_PICK_SLOT:(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery(getLanguage(ctx) === 'es' ? 'Reservando...' : 'Booking...');
      const lang = getLanguage(ctx);
      const epochTime = parseInt(ctx.match[1]);
      const userId = ctx.from.id.toString();

      const booking = ctx.session.privateCallBooking;
      if (!booking) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ Sesión expirada.' : '❌ Session expired.',
          Markup.inlineKeyboard([[Markup.button.callback('🔄', 'PRIVATECALL_START')]])
        );
        return;
      }

      const startTimeUtc = new Date(epochTime * 1000).toISOString();

      // Create draft booking
      const result = await PrivateCallBookingService.createBooking({
        userId,
        performerId: booking.performerId,
        callType: booking.callType,
        durationMinutes: booking.durationMinutes,
        startTimeUtc,
      });

      if (!result.success) {
        await ctx.editMessageText(
          lang === 'es'
            ? `❌ Error: ${result.error === 'slot_not_available' ? 'El horario ya no está disponible' : 'No se pudo crear la reserva'}`
            : `❌ Error: ${result.error === 'slot_not_available' ? 'Slot is no longer available' : 'Could not create booking'}`,
          Markup.inlineKeyboard([[Markup.button.callback(lang === 'es' ? '🔄 Reintentar' : '🔄 Retry', 'PRIVATECALL_START')]])
        );
        return;
      }

      // Hold the slot
      const holdResult = await PrivateCallBookingService.holdBooking(result.booking.id, 10);

      if (!holdResult.success) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ El horario ya fue tomado por otro usuario.' : '❌ Slot was taken by another user.',
          Markup.inlineKeyboard([[Markup.button.callback(lang === 'es' ? '🔄 Reintentar' : '🔄 Retry', 'PRIVATECALL_START')]])
        );
        return;
      }

      ctx.session.privateCallBooking.bookingId = result.booking.id;
      ctx.session.privateCallBooking.step = 'rules';

      // Show rules confirmation
      await showRulesConfirmation(ctx, lang, result.booking);
    } catch (error) {
      logger.error('Error in PC_PICK_SLOT:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // STEP 5: RULES CONFIRMATION
  // =====================================================

  async function showRulesConfirmation(ctx, lang, booking) {
    const performer = await PrivateCallBookingService.getPerformer(booking.performerId);
    const date = new Date(booking.startTimeUtc);
    const dateStr = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const timeStr = date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const message = lang === 'es'
      ? `📋 *Confirma tu reserva*\n\n` +
        `🎭 Modelo: ${performer?.displayName}\n` +
        `📹 Tipo: ${booking.callType === 'video' ? 'Video' : 'Audio'}\n` +
        `⏱ Duración: ${booking.durationMinutes} min\n` +
        `📅 Fecha: ${dateStr}\n` +
        `🕐 Hora: ${timeStr}\n` +
        `💰 Precio: $${(booking.priceCents / 100).toFixed(2)}\n\n` +
        `⚠️ *Reglas:*\n` +
        `• Sé puntual, la llamada comienza a la hora programada\n` +
        `• No grabar ni capturar pantalla\n` +
        `• Ser respetuoso en todo momento\n` +
        `• No compartir información personal\n\n` +
        `⏰ Tienes 10 minutos para completar el pago.`
      : `📋 *Confirm your booking*\n\n` +
        `🎭 Model: ${performer?.displayName}\n` +
        `📹 Type: ${booking.callType === 'video' ? 'Video' : 'Audio'}\n` +
        `⏱ Duration: ${booking.durationMinutes} min\n` +
        `📅 Date: ${dateStr}\n` +
        `🕐 Time: ${timeStr}\n` +
        `💰 Price: $${(booking.priceCents / 100).toFixed(2)}\n\n` +
        `⚠️ *Rules:*\n` +
        `• Be punctual, call starts at scheduled time\n` +
        `• No recording or screenshots\n` +
        `• Be respectful at all times\n` +
        `• Don't share personal information\n\n` +
        `⏰ You have 10 minutes to complete payment.`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(lang === 'es' ? '✅ Acepto - Continuar al Pago' : '✅ I Agree - Continue to Payment', 'PC_CONFIRM_RULES')],
        [Markup.button.callback(lang === 'es' ? '❌ Cancelar' : '❌ Cancel', 'PC_CANCEL_FLOW')],
      ]),
    });
  }

  bot.action('PC_CONFIRM_RULES', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);

      const booking = ctx.session.privateCallBooking;
      if (!booking?.bookingId) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ Sesión expirada.' : '❌ Session expired.',
          Markup.inlineKeyboard([[Markup.button.callback('🔄', 'PRIVATECALL_START')]])
        );
        return;
      }

      // Confirm rules
      const result = await PrivateCallBookingService.confirmRules(booking.bookingId);

      if (!result.success) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ La reserva ha expirado. Intenta de nuevo.' : '❌ Booking has expired. Try again.',
          Markup.inlineKeyboard([[Markup.button.callback('🔄', 'PRIVATECALL_START')]])
        );
        return;
      }

      // Create payment link
      const paymentResult = await PrivateCallBookingService.createPaymentLink(booking.bookingId, 'epayco', 10);

      if (!paymentResult.success) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ Error creando enlace de pago.' : '❌ Error creating payment link.',
          Markup.inlineKeyboard([[Markup.button.callback('🔄', 'PRIVATECALL_START')]])
        );
        return;
      }

      ctx.session.privateCallBooking.paymentId = paymentResult.paymentId;
      ctx.session.privateCallBooking.step = 'payment';

      // Show payment screen
      const message = lang === 'es'
        ? `💳 *Pagar Reserva*\n\n` +
          `💰 Total: $${(paymentResult.amountCents / 100).toFixed(2)} ${paymentResult.currency}\n\n` +
          `⏰ Este enlace expira en 10 minutos.\n\n` +
          `Haz clic en "Pagar Ahora" para completar tu reserva.`
        : `💳 *Pay for Booking*\n\n` +
          `💰 Total: $${(paymentResult.amountCents / 100).toFixed(2)} ${paymentResult.currency}\n\n` +
          `⏰ This link expires in 10 minutes.\n\n` +
          `Click "Pay Now" to complete your booking.`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(lang === 'es' ? '💳 Pagar Ahora' : '💳 Pay Now', paymentResult.paymentLink)],
          [Markup.button.callback(lang === 'es' ? '🔄 Verificar Pago' : '🔄 Check Payment', 'PC_REFRESH_PAYMENT_STATUS')],
          [Markup.button.callback(lang === 'es' ? '❌ Cancelar' : '❌ Cancel', 'PC_CANCEL_BOOKING')],
        ]),
      });
    } catch (error) {
      logger.error('Error in PC_CONFIRM_RULES:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // STEP 6: PAYMENT
  // =====================================================

  bot.action('PC_REFRESH_PAYMENT_STATUS', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const booking = ctx.session.privateCallBooking;

      if (!booking?.bookingId) {
        await ctx.answerCbQuery(lang === 'es' ? 'Sesión expirada' : 'Session expired', true);
        return;
      }

      const paymentStatus = await PrivateCallBookingService.checkPaymentStatus(booking.bookingId);

      if (paymentStatus.status === 'paid') {
        await ctx.answerCbQuery(lang === 'es' ? '✅ Pago recibido!' : '✅ Payment received!');
        await showConfirmation(ctx, lang, booking.bookingId);
      } else if (paymentStatus.status === 'expired') {
        await ctx.answerCbQuery(lang === 'es' ? '❌ Pago expirado' : '❌ Payment expired', true);
        await ctx.editMessageText(
          lang === 'es' ? '❌ El pago ha expirado. Intenta de nuevo.' : '❌ Payment has expired. Try again.',
          Markup.inlineKeyboard([[Markup.button.callback('🔄', 'PRIVATECALL_START')]])
        );
      } else {
        await ctx.answerCbQuery(lang === 'es' ? '⏳ Pago pendiente...' : '⏳ Payment pending...', true);
      }
    } catch (error) {
      logger.error('Error in PC_REFRESH_PAYMENT_STATUS:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  bot.action('PC_CANCEL_BOOKING', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const booking = ctx.session.privateCallBooking;

      if (booking?.bookingId) {
        await PrivateCallBookingService.cancelBooking(booking.bookingId, 'user_cancelled', 'user');
      }

      ctx.session.privateCallBooking = null;

      await ctx.editMessageText(
        lang === 'es' ? '❌ Reserva cancelada.' : '❌ Booking cancelled.',
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menú' : '🔙 Back to Menu', 'menu_main')],
        ])
      );
    } catch (error) {
      logger.error('Error in PC_CANCEL_BOOKING:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  bot.action('PC_CANCEL_FLOW', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const booking = ctx.session.privateCallBooking;

      if (booking?.bookingId) {
        await PrivateCallBookingService.cancelBooking(booking.bookingId, 'user_cancelled', 'user');
      }

      ctx.session.privateCallBooking = null;

      await ctx.editMessageText(
        lang === 'es' ? '❌ Reserva cancelada.' : '❌ Booking cancelled.',
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')],
        ])
      );
    } catch (error) {
      logger.error('Error in PC_CANCEL_FLOW:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // STEP 7: CONFIRMATION
  // =====================================================

  async function showConfirmation(ctx, lang, bookingId) {
    const booking = await PrivateCallBookingService.getBooking(bookingId);
    const session = await PrivateCallBookingService.getCallSession(bookingId);

    if (!booking) {
      await ctx.editMessageText(
        lang === 'es' ? '❌ Error cargando reserva.' : '❌ Error loading booking.',
        Markup.inlineKeyboard([[Markup.button.callback('🔙', 'menu_main')]])
      );
      return;
    }

    const date = new Date(booking.startTimeUtc);
    const dateStr = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const message = lang === 'es'
      ? `✅ *¡Reserva Confirmada!*\n\n` +
        `🎭 Modelo: ${booking.performerName}\n` +
        `📹 Tipo: ${booking.callType === 'video' ? 'Video' : 'Audio'}\n` +
        `⏱ Duración: ${booking.durationMinutes} min\n` +
        `📅 ${dateStr}\n` +
        `🕐 ${timeStr}\n\n` +
        `Te enviaremos recordatorios antes de tu llamada.\n\n` +
        `¡Nos vemos pronto! 👋`
      : `✅ *Booking Confirmed!*\n\n` +
        `🎭 Model: ${booking.performerName}\n` +
        `📹 Type: ${booking.callType === 'video' ? 'Video' : 'Audio'}\n` +
        `⏱ Duration: ${booking.durationMinutes} min\n` +
        `📅 ${dateStr}\n` +
        `🕐 ${timeStr}\n\n` +
        `We'll send you reminders before your call.\n\n` +
        `See you soon! 👋`;

    const buttons = [
      [Markup.button.callback(lang === 'es' ? '📋 Ver Mis Reservas' : '📋 View My Bookings', `PC_VIEW_BOOKING:${bookingId}`)],
    ];

    if (session?.joinUrlUser) {
      buttons.unshift([Markup.button.url(lang === 'es' ? '🔗 Link de la Llamada' : '🔗 Call Link', session.joinUrlUser)]);
    }

    buttons.push([Markup.button.callback(lang === 'es' ? '🔙 Menú Principal' : '🔙 Main Menu', 'menu_main')]);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });

    // Clear session
    ctx.session.privateCallBooking = null;
  }

  // =====================================================
  // VIEW BOOKING
  // =====================================================

  bot.action(/^PC_VIEW_BOOKING:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const bookingId = ctx.match[1];

      const booking = await PrivateCallBookingService.getBooking(bookingId);
      const session = await PrivateCallBookingService.getCallSession(bookingId);

      if (!booking) {
        await ctx.editMessageText(
          lang === 'es' ? '❌ Reserva no encontrada.' : '❌ Booking not found.',
          Markup.inlineKeyboard([[Markup.button.callback('🔙', 'menu_main')]])
        );
        return;
      }

      const date = new Date(booking.startTimeUtc);
      const dateStr = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      const timeStr = date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const statusEmoji = {
        draft: '📝',
        held: '⏳',
        awaiting_payment: '💳',
        confirmed: '✅',
        completed: '🎉',
        cancelled: '❌',
        no_show: '👻',
        expired: '⏰',
      }[booking.status] || '❓';

      const statusText = lang === 'es'
        ? { draft: 'Borrador', held: 'Reservado', awaiting_payment: 'Pendiente de Pago', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No Presentado', expired: 'Expirada' }[booking.status]
        : { draft: 'Draft', held: 'Held', awaiting_payment: 'Awaiting Payment', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No Show', expired: 'Expired' }[booking.status];

      const message = lang === 'es'
        ? `📋 *Detalles de la Reserva*\n\n` +
          `${statusEmoji} Estado: ${statusText}\n` +
          `🎭 Modelo: ${booking.performerName}\n` +
          `📹 Tipo: ${booking.callType === 'video' ? 'Video' : 'Audio'}\n` +
          `⏱ Duración: ${booking.durationMinutes} min\n` +
          `📅 ${dateStr}\n` +
          `🕐 ${timeStr}\n` +
          `💰 $${(booking.priceCents / 100).toFixed(2)}`
        : `📋 *Booking Details*\n\n` +
          `${statusEmoji} Status: ${statusText}\n` +
          `🎭 Model: ${booking.performerName}\n` +
          `📹 Type: ${booking.callType === 'video' ? 'Video' : 'Audio'}\n` +
          `⏱ Duration: ${booking.durationMinutes} min\n` +
          `📅 ${dateStr}\n` +
          `🕐 ${timeStr}\n` +
          `💰 $${(booking.priceCents / 100).toFixed(2)}`;

      const buttons = [];

      if (booking.status === 'confirmed' && session?.joinUrlUser) {
        buttons.push([Markup.button.url(lang === 'es' ? '🎥 Unirse a la Llamada' : '🎥 Join Call', session.joinUrlUser)]);
      }

      if (['confirmed', 'held', 'awaiting_payment'].includes(booking.status)) {
        buttons.push([Markup.button.callback(lang === 'es' ? '❌ Cancelar Reserva' : '❌ Cancel Booking', `PC_CANCEL_CONFIRM:${bookingId}`)]);
      }

      buttons.push([Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error in PC_VIEW_BOOKING:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  bot.action(/^PC_CANCEL_CONFIRM:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const bookingId = ctx.match[1];

      await ctx.editMessageText(
        lang === 'es' ? '⚠️ ¿Estás seguro de que quieres cancelar esta reserva?' : '⚠️ Are you sure you want to cancel this booking?',
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '✅ Sí, Cancelar' : '✅ Yes, Cancel', `PC_DO_CANCEL:${bookingId}`)],
          [Markup.button.callback(lang === 'es' ? '❌ No, Volver' : '❌ No, Go Back', `PC_VIEW_BOOKING:${bookingId}`)],
        ])
      );
    } catch (error) {
      logger.error('Error in PC_CANCEL_CONFIRM:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  bot.action(/^PC_DO_CANCEL:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const bookingId = ctx.match[1];

      await PrivateCallBookingService.cancelBooking(bookingId, 'user_cancelled', 'user');

      await ctx.editMessageText(
        lang === 'es' ? '✅ Reserva cancelada exitosamente.' : '✅ Booking cancelled successfully.',
        Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🔙 Menú Principal' : '🔙 Main Menu', 'menu_main')],
        ])
      );
    } catch (error) {
      logger.error('Error in PC_DO_CANCEL:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });

  // =====================================================
  // MY BOOKINGS LIST
  // =====================================================

  bot.action('PC_MY_BOOKINGS', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      const userId = ctx.from.id.toString();

      const bookings = await PrivateCallBookingService.getUserBookings(userId, {
        statuses: ['confirmed', 'completed'],
        limit: 10,
      });

      if (bookings.length === 0) {
        await ctx.editMessageText(
          lang === 'es' ? '📋 No tienes reservas aún.' : '📋 You don\'t have any bookings yet.',
          Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '📞 Reservar Llamada' : '📞 Book a Call', 'PRIVATECALL_START')],
            [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')],
          ])
        );
        return;
      }

      let message = lang === 'es' ? '📋 *Mis Reservas*\n\n' : '📋 *My Bookings*\n\n';

      const buttons = [];
      for (const booking of bookings) {
        const date = new Date(booking.startTimeUtc);
        const dateStr = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' });

        const statusEmoji = booking.status === 'confirmed' ? '✅' : '🎉';
        message += `${statusEmoji} ${booking.performerName} - ${dateStr} ${timeStr}\n`;

        buttons.push([Markup.button.callback(`${statusEmoji} ${booking.performerName} - ${dateStr}`, `PC_VIEW_BOOKING:${booking.id}`)]);
      }

      buttons.push([Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'menu_main')]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error in PC_MY_BOOKINGS:', error);
      await ctx.answerCbQuery('Error', true);
    }
  });
};

module.exports = registerPrivateCallsProntoHandlers;
