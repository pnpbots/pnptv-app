const { Markup } = require('telegraf');
const PrivateCallService = require('../../services/privateCallService');
const PerformerModel = require('../../../models/performerModel');
const UserModel = require('../../../models/userModel');
const logger = require('../../../utils/logger');
const { getLanguage, isPrimeUser } = require('../../utils/helpers');
const { t } = require('../../../utils/i18n');

/**
 * Private Call Booking Handlers - Enhanced booking flow with all required features
 * @param {Telegraf} bot - Bot instance
 */
const registerPrivateCallBookingHandlers = (bot) => {
  
  // =====================================================
  // ACCESS CONTROL MIDDLEWARE
  // =====================================================
  
  /**
   * Check if user is eligible to book private calls
   */
  const checkBookingEligibility = async (ctx) => {
    const lang = getLanguage(ctx);
    try {
      const userId = ctx.from.id;
      
      // Get user data
      const user = await UserModel.getById(userId);
      
      if (!user) {
        await ctx.answerCbQuery(t('user_not_found', lang), { show_alert: true });
        return false;
      }
      
      // Check 1: Age verification
      if (!user.age_verified) {
        await ctx.answerCbQuery(
          lang === 'es' 
            ? '⚠️ Debes completar la verificación de edad para reservar llamadas privadas.'
            : '⚠️ You must complete age verification to book private calls.',
          { show_alert: true }
        );
        return false;
      }
      
      // Check 2: Terms and conditions
      if (!user.terms_accepted) {
        await ctx.answerCbQuery(
          lang === 'es'
            ? '⚠️ Debes aceptar los términos y condiciones para continuar.'
            : '⚠️ You must accept the terms and conditions to continue.',
          { show_alert: true }
        );
        return false;
      }
      
      // Check 3: User is PRIME or can pay per-call
      const isPrime = isPrimeUser(user);
      if (!isPrime) {
        // FREE users can still book but will see upgrade prompt
        ctx.session.temp = ctx.session.temp || {};
        ctx.session.temp.freeUserBooking = true;
        await ctx.saveSession();
      }
      
      // Check 4: User is not restricted or flagged
      if (user.role === 'banned' || user.role === 'restricted') {
        await ctx.answerCbQuery(
          lang === 'es'
            ? '❌ Tu cuenta está restringida y no puede reservar llamadas.'
            : '❌ Your account is restricted and cannot book calls.',
          { show_alert: true }
        );
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Error checking booking eligibility:', error);
      await ctx.answerCbQuery(t('error', lang), { show_alert: true });
      return false;
    }
  };

  // =====================================================
  // MAIN BOOKING FLOW
  // =====================================================

  // Entry point: Book a private call
  bot.action('book_private_call', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check eligibility
      const isEligible = await checkBookingEligibility(ctx);
      if (!isEligible) {
        return;
      }
      
      // Get available performers
      const performers = await PerformerModel.getAvailable();
      
      if (performers.length === 0) {
        const message = lang === 'es'
          ? `📞 *Llamadas Privadas 1:1*
\n🔴 *No hay performers disponibles en este momento.*
\nPor favor, inténtalo más tarde.`
          : `📞 *Private 1:1 Calls*
\n🔴 *No performers available at this time.*
\nPlease try again later.`;
        
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'back_to_main')],
          ]),
        });
        return;
      }
      
      // Show performer selection
      const message = lang === 'es'
        ? `📞 *Llamada Privada 1:1*
\n💎 *¿Qué incluye?*
\n• Videollamada privada con un performer
• Duración configurable (30-60 minutos)
• Calidad HD y conexión segura
• Horario flexible según disponibilidad
\n👥 *Elige con quién quieres la llamada:*`
        : `📞 *Private 1:1 Call*
\n💎 *What's included:*
\n• Private video call with a performer
• Configurable duration (30-60 minutes)
• HD quality and secure connection
• Flexible scheduling based on availability
\n👥 *Choose who you want to talk to:*`;
      
      const buttons = performers.map(performer => [
        Markup.button.callback(`🎭 ${performer.displayName}`, `select_performer_${performer.id}`)
      ]);
      
      buttons.push([Markup.button.callback(t('back', lang), 'back_to_main')]);
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing private call booking:', error);
    }
  });

  // Select performer
  bot.action(/^select_performer_(.+)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const performerId = ctx.match[1];
      
      // Get performer details
      const performer = await PerformerModel.getById(performerId);
      
      if (!performer) {
        await ctx.answerCbQuery(t('performer_not_found', lang), { show_alert: true });
        return;
      }
      
      // Store selected performer in session
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.selectedPerformer = performer;
      await ctx.saveSession();
      
      // Show performer details and duration options
      const message = lang === 'es'
        ? `🎭 *Llamada con ${performer.displayName}*
\n${performer.bio || 'Performer experimentado y profesional.'}
\n💰 *Precio base:* $${performer.basePrice.toFixed(2)} USD
\n📅 *Duración disponible:*
• 30 minutos (+$0)
• 45 minutos (+$50)
• 60 minutos (+$100)`
        : `🎭 *Call with ${performer.displayName}*
\n${performer.bio || 'Experienced and professional performer.'}
\n💰 *Base Price:* $${performer.basePrice.toFixed(2)} USD
\n📅 *Available Duration:*
• 30 minutes (+$0)
• 45 minutes (+$50)
• 60 minutes (+$100)`;
      
      const buttons = [
        [Markup.button.callback('30 min', `select_duration_30_${performerId}`)],
        [Markup.button.callback('45 min', `select_duration_45_${performerId}`)],
        [Markup.button.callback('60 min', `select_duration_60_${performerId}`)],
        [Markup.button.callback(t('back', lang), 'book_private_call')],
      ];
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error selecting performer:', error);
    }
  });

  // Select duration
  bot.action(/^select_duration_(\d+)_(.+)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const duration = parseInt(ctx.match[1]);
      const performerId = ctx.match[2];
      
      const performer = await PerformerModel.getById(performerId);
      
      if (!performer) {
        await ctx.answerCbQuery(t('performer_not_found', lang), { show_alert: true });
        return;
      }
      
      // Calculate price based on duration
      let price = performer.basePrice;
      if (duration === 45) {
        price += 50;
      } else if (duration === 60) {
        price += 100;
      }
      
      // Store duration in session
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.selectedDuration = duration;
      ctx.session.temp.selectedPrice = price;
      await ctx.saveSession();
      
      // Show time slot selection
      const message = lang === 'es'
        ? `⏰ *Selecciona fecha y hora*
\n📅 *Disponibilidad de ${performer.displayName}*
\nPor favor elige una fecha para ver los horarios disponibles:`
        : `⏰ *Select Date and Time*
\n📅 *${performer.displayName}'s Availability*
\nPlease choose a date to see available time slots:`;
      
      // Generate date buttons (next 7 days)
      const dates = [];
      const today = new Date();
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const dayName = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'short' });
        const dayMonth = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'numeric' });
        
        dates.push(Markup.button.callback(`${dayName} ${dayMonth}`, `show_slots_${dateStr}_${performerId}`));
      }
      
      const buttons = [];
      while (dates.length) {
        buttons.push(dates.splice(0, 3));
      }
      
      buttons.push([Markup.button.callback(t('back', lang), `select_performer_${performerId}`)]);
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error selecting duration:', error);
    }
  });

  // Show available slots for selected date
  bot.action(/^show_slots_(\d{4}-\d{2}-\d{2})_(.+)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const date = ctx.match[1];
      const performerId = ctx.match[2];
      
      const performer = await PerformerModel.getById(performerId);
      
      if (!performer) {
        await ctx.answerCbQuery(t('performer_not_found', lang), { show_alert: true });
        return;
      }
      
      // Get available slots for this date
      const slots = await PerformerModel.getAvailableSlots(performerId, { date });
      
      if (slots.length === 0) {
        const message = lang === 'es'
          ? `📅 *Sin disponibilidad el ${date}*
\nNo hay horarios disponibles para este día. Por favor elige otra fecha.`
          : `📅 *No Availability on ${date}*
\nNo time slots available for this day. Please choose another date.`;
        
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), `select_duration_${ctx.session.temp.selectedDuration}_${performerId}`)],
          ]),
        });
        return;
      }
      
      const message = lang === 'es'
        ? `📅 *Horarios disponibles - ${date}*
\n👥 *${performer.displayName}*
\nPor favor elige un horario disponible:`
        : `📅 *Available Time Slots - ${date}*
\n👥 *${performer.displayName}*
\nPlease choose an available time slot:`;
      
      const buttons = slots.map(slot => [
        Markup.button.callback(
          `${slot.startTime} - ${slot.endTime}`, 
          `select_slot_${slot.id}_${performerId}`
        )
      ]);
      
      buttons.push([Markup.button.callback(t('back', lang), `show_slots_${date}_${performerId}`)]);
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing slots:', error);
    }
  });

  // Select specific time slot
  bot.action(/^select_slot_([^_]+)_(.+)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const slotId = ctx.match[1];
      const performerId = ctx.match[2];
      
      const performer = await PerformerModel.getById(performerId);
      const slot = await PerformerModel.getAvailabilitySlots(performerId, {})
        .then(slots => slots.find(s => s.id === slotId));
      
      if (!performer || !slot) {
        await ctx.answerCbQuery(t('slot_not_available', lang), { show_alert: true });
        return;
      }
      
      // Store selected slot in session
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.selectedSlot = slot;
      await ctx.saveSession();
      
      // Show call rules confirmation
      const message = lang === 'es'
        ? `📋 *Reglas de la Llamada Privada*
\nPor favor lee y confirma las reglas antes de continuar:
\n1️⃣ *Solo 1:1* - Solo tú y el performer en la llamada
2️⃣ *Sin grabación* - No está permitido grabar la sesión
3️⃣ *Respeto mutuo* - Mantén un comportamiento respetuoso
4️⃣ *Límite de tiempo* - La sesión termina automáticamente al límite de tiempo
5️⃣ *Sin reembolsos* - No hay reembolsos una vez que la llamada comienza
\n📅 *Detalles de tu reserva:*
• Performer: ${performer.displayName}
• Fecha: ${slot.date}
• Hora: ${slot.startTime} - ${slot.endTime}
• Duración: ${ctx.session.temp.selectedDuration} minutos
• Precio: $${ctx.session.temp.selectedPrice.toFixed(2)} USD
\n✅ *Confirmo que he leído y acepto las reglas*`
        : `📋 *Private Call Rules*
\nPlease read and confirm the rules before continuing:
\n1️⃣ *1:1 Only* - Only you and the performer in the call
2️⃣ *No Recording* - Recording the session is not allowed
3️⃣ *Mutual Respect* - Maintain respectful behavior
4️⃣ *Time Limit* - Session ends automatically at time limit
5️⃣ *No Refunds* - No refunds once the call starts
\n📅 *Your Booking Details:*
• Performer: ${performer.displayName}
• Date: ${slot.date}
• Time: ${slot.startTime} - ${slot.endTime}
• Duration: ${ctx.session.temp.selectedDuration} minutes
• Price: $${ctx.session.temp.selectedPrice.toFixed(2)} USD
\n✅ *I confirm that I have read and accept the rules*`;
      
      const buttons = [
        [Markup.button.callback('✅ Acepto las reglas / I Accept', 'confirm_call_rules')],
        [Markup.button.callback(t('back', lang), `show_slots_${slot.date}_${performerId}`)],
      ];
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error selecting slot:', error);
    }
  });

  // Confirm call rules
  bot.action('confirm_call_rules', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check if we have all required session data
      if (!ctx.session?.temp?.selectedPerformer || 
          !ctx.session?.temp?.selectedDuration || 
          !ctx.session?.temp?.selectedPrice || 
          !ctx.session?.temp?.selectedSlot) {
        
        await ctx.answerCbQuery(
          lang === 'es' 
            ? '⚠️ Error: Datos de reserva incompletos.'
            : '⚠️ Error: Incomplete booking data.',
          { show_alert: true }
        );
        return;
      }
      
      const performer = ctx.session.temp.selectedPerformer;
      const duration = ctx.session.temp.selectedDuration;
      const price = ctx.session.temp.selectedPrice;
      const slot = ctx.session.temp.selectedSlot;
      
      // Show payment options
      const message = lang === 'es'
        ? `💳 *Opciones de Pago*
\n📅 *Reserva Confirmada*
• Performer: ${performer.displayName}
• Fecha: ${slot.date}
• Hora: ${slot.startTime} - ${slot.endTime}
• Duración: ${duration} minutos
• Precio: $${price.toFixed(2)} USD
\n💰 *Selecciona método de pago:*`
        : `💳 *Payment Options*
\n📅 *Booking Confirmed*
• Performer: ${performer.displayName}
• Date: ${slot.date}
• Time: ${slot.startTime} - ${slot.endTime}
• Duration: ${duration} minutes
• Price: $${price.toFixed(2)} USD
\n💰 *Select Payment Method:*`;
      
      const buttons = [
        [Markup.button.callback('💳 Tarjeta de Crédito / Credit Card', 'pay_with_card')],
        [Markup.button.callback('🪙 Crypto (USDC)', 'pay_with_crypto')],
        [Markup.button.callback('🏦 Transferencia Bancaria / Bank Transfer', 'pay_with_bank')],
        [Markup.button.callback(t('back', lang), 'select_slot')],
      ];
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error confirming call rules:', error);
    }
  });

  // Payment methods
  bot.action(/^pay_with_(card|crypto|bank)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const paymentMethod = ctx.match[1]; // card, crypto, or bank
      
      // Check if we have all required session data
      if (!ctx.session?.temp?.selectedPerformer || 
          !ctx.session?.temp?.selectedDuration || 
          !ctx.session?.temp?.selectedPrice || 
          !ctx.session?.temp?.selectedSlot) {
        
        await ctx.answerCbQuery(
          lang === 'es' 
            ? '⚠️ Error: Datos de reserva incompletos.'
            : '⚠️ Error: Incomplete booking data.',
          { show_alert: true }
        );
        return;
      }
      
      const performer = ctx.session.temp.selectedPerformer;
      const duration = ctx.session.temp.selectedDuration;
      const price = ctx.session.temp.selectedPrice;
      const slot = ctx.session.temp.selectedSlot;
      
      // Create payment and get payment link
      await ctx.editMessageText(t('loading', lang));
      
      const paymentResult = await PrivateCallService.createPayment({
        userId: ctx.from.id,
        userName: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
        performerId: performer.id,
        performerName: performer.displayName,
        duration: duration,
        price: price,
        slotId: slot.id,
        paymentMethod: paymentMethod,
      });
      
      if (!paymentResult.success) {
        await ctx.editMessageText(
          lang === 'es'
            ? `❌ *Error al crear el pago*
\n${paymentResult.error || 'Por favor inténtalo de nuevo.'}`
            : `❌ *Payment Creation Error*
\n${paymentResult.error || 'Please try again.'}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'confirm_call_rules')],
            ]),
          }
        );
        return;
      }
      
      // Store payment ID in session for later verification
      ctx.session.temp.pendingPaymentId = paymentResult.paymentId;
      ctx.session.temp.paymentTimeout = Date.now() + 10 * 60 * 1000; // 10 minutes timeout
      await ctx.saveSession();
      
      // Show payment instructions
      const paymentMessage = lang === 'es'
        ? `💳 *Pago de Llamada Privada*
\n📅 *Detalles de la reserva:*
• Performer: ${performer.displayName}
• Fecha: ${slot.date}
• Hora: ${slot.startTime} - ${slot.endTime}
• Duración: ${duration} minutos
• Precio: $${price.toFixed(2)} USD
\n💰 *Método de pago:* ${getPaymentMethodName(paymentMethod, lang)}
\n🔗 *Por favor completa el pago haciendo clic en el botón de abajo:*
\n⏰ *Tienes 10 minutos para completar el pago antes de que la reserva se cancele.*`
        : `💳 *Private Call Payment*
\n📅 *Booking Details:*
• Performer: ${performer.displayName}
• Date: ${slot.date}
• Time: ${slot.startTime} - ${slot.endTime}
• Duration: ${duration} minutes
• Price: $${price.toFixed(2)} USD
\n💰 *Payment Method:* ${getPaymentMethodName(paymentMethod, lang)}
\n🔗 *Please complete the payment by clicking the button below:*
\n⏰ *You have 10 minutes to complete payment before the booking is cancelled.*`;
      
      const buttons = [
        [Markup.button.url('💰 Complete Payment', paymentResult.paymentUrl)],
        [Markup.button.callback('❌ Cancel Booking', 'cancel_booking')],
      ];
      
      await ctx.editMessageText(paymentMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
      
      // Start payment timeout check
      schedulePaymentTimeoutCheck(ctx, paymentResult.paymentId);
    } catch (error) {
      logger.error('Error processing payment:', error);
      const lang = getLanguage(ctx);
      await ctx.editMessageText(
        t('error', lang),
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'confirm_call_rules')],
          ]),
        }
      ).catch(() => {});
    }
  });

  // Helper method to get payment method name
  const getPaymentMethodName = (method, lang) => {
    const methods = {
      card: lang === 'es' ? 'Tarjeta de Crédito/Débito' : 'Credit/Debit Card',
      crypto: lang === 'es' ? 'Crypto (USDC)' : 'Crypto (USDC)',
      bank: lang === 'es' ? 'Transferencia Bancaria' : 'Bank Transfer',
    };
    return methods[method] || method;
  };

  // Schedule payment timeout check
  const schedulePaymentTimeoutCheck = (ctx, paymentId) => {
    setTimeout(async () => {
      try {
        const paymentStatus = await PrivateCallService.checkPaymentStatus(paymentId);
        
        if (paymentStatus.status === 'pending') {
          // Payment still pending, cancel the booking
          await PrivateCallService.cancelBooking(paymentId, 'Payment timeout');
          
          const lang = getLanguage(ctx);
          await ctx.telegram.sendMessage(
            ctx.from.id,
            lang === 'es'
              ? `⏰ *Pago no completado*
\nTu reserva ha sido cancelada debido a que el pago no se completó a tiempo.`
              : `⏰ *Payment Not Completed*
\nYour booking has been cancelled because payment was not completed on time.`
          );
        }
      } catch (error) {
        logger.error('Error in payment timeout check:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes
  };

  // Cancel booking
  bot.action('cancel_booking', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      if (!ctx.session?.temp?.pendingPaymentId) {
        await ctx.answerCbQuery(
          lang === 'es' 
            ? '⚠️ No hay reserva activa para cancelar.'
            : '⚠️ No active booking to cancel.',
          { show_alert: true }
        );
        return;
      }
      
      const result = await PrivateCallService.cancelBooking(
        ctx.session.temp.pendingPaymentId,
        'User cancellation'
      );
      
      if (result.success) {
        // Clear session data
        delete ctx.session.temp.selectedPerformer;
        delete ctx.session.temp.selectedDuration;
        delete ctx.session.temp.selectedPrice;
        delete ctx.session.temp.selectedSlot;
        delete ctx.session.temp.pendingPaymentId;
        delete ctx.session.temp.paymentTimeout;
        await ctx.saveSession();
        
        await ctx.editMessageText(
          lang === 'es'
            ? `✅ *Reserva Cancelada*
\nTu reserva ha sido cancelada exitosamente.`
            : `✅ *Booking Cancelled*
\nYour booking has been successfully cancelled.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📞 Book Another Call', 'book_private_call')],
              [Markup.button.callback(t('back', lang), 'back_to_main')],
            ]),
          }
        );
      } else {
        await ctx.answerCbQuery(
          lang === 'es'
            ? '❌ Error al cancelar la reserva.'
            : '❌ Error cancelling booking.',
          { show_alert: true }
        );
      }
    } catch (error) {
      logger.error('Error cancelling booking:', error);
      const lang = getLanguage(ctx);
      await ctx.answerCbQuery(t('error', lang), { show_alert: true });
    }
  });

  // =====================================================
  // POST-PAYMENT FLOW
  // =====================================================

  // This would be triggered by webhook or manual check
  // For now, we'll simulate it with a callback
  bot.action('payment_completed', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      if (!ctx.session?.temp?.pendingPaymentId) {
        await ctx.answerCbQuery(
          lang === 'es' 
            ? '⚠️ No hay pago pendiente.'
            : '⚠️ No pending payment.',
          { show_alert: true }
        );
        return;
      }
      
      const paymentId = ctx.session.temp.pendingPaymentId;
      
      // Check payment status
      const paymentStatus = await PrivateCallService.checkPaymentStatus(paymentId);
      
      if (paymentStatus.status !== 'success') {
        await ctx.answerCbQuery(
          lang === 'es'
            ? '⚠️ Pago aún no completado.'
            : '⚠️ Payment not yet completed.',
          { show_alert: true }
        );
        return;
      }
      
      // Complete the booking
      const bookingResult = await PrivateCallService.completeBooking(paymentId);
      
      if (!bookingResult.success) {
        await ctx.editMessageText(
          lang === 'es'
            ? `❌ *Error al completar la reserva*
\n${bookingResult.error || 'Por favor contacta a soporte.'}`
            : `❌ *Booking Completion Error*
\n${bookingResult.error || 'Please contact support.'}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(t('back', lang), 'back_to_main')],
            ]),
          }
        );
        return;
      }
      
      // Clear session data
      delete ctx.session.temp.selectedPerformer;
      delete ctx.session.temp.selectedDuration;
      delete ctx.session.temp.selectedPrice;
      delete ctx.session.temp.selectedSlot;
      delete ctx.session.temp.pendingPaymentId;
      delete ctx.session.temp.paymentTimeout;
      await ctx.saveSession();
      
      // Show booking confirmation
      const message = lang === 'es'
        ? `✅ *¡Llamada Reservada!*
\n🎭 *Con:* ${bookingResult.booking.performerName}
📅 *Fecha:* ${bookingResult.booking.date}
⏰ *Hora:* ${bookingResult.booking.time}
⏱ *Duración:* ${bookingResult.booking.duration} minutos
💰 *Precio:* $${bookingResult.booking.price.toFixed(2)} USD
\n🔗 *Link de la llamada:*
${bookingResult.booking.meetingUrl}
\n⚡ *Tu llamada comienza en ${calculateTimeUntilCall(bookingResult.booking.date, bookingResult.booking.time, lang)}*
\n📧 Recibirás recordatorios 24h, 1h y 15 minutos antes de la llamada.
\n💡 *Importante:*
• Únete a tiempo usando el link de arriba
• La sesión termina automáticamente al límite de tiempo
• No se permiten reembolsos una vez que la llamada comienza
\n¡Nos vemos pronto! 👋`
        : `✅ *Call Booked Successfully!*
\n🎭 *With:* ${bookingResult.booking.performerName}
📅 *Date:* ${bookingResult.booking.date}
⏰ *Time:* ${bookingResult.booking.time}
⏱ *Duration:* ${bookingResult.booking.duration} minutes
💰 *Price:* $${bookingResult.booking.price.toFixed(2)} USD
\n🔗 *Join Link:*
${bookingResult.booking.meetingUrl}
\n⚡ *Your call starts in ${calculateTimeUntilCall(bookingResult.booking.date, bookingResult.booking.time, lang)}*
\n📧 You'll receive reminders 24h, 1h, and 15 minutes before the call.
\n💡 *Important:*
• Join on time using the link above
• Session ends automatically at time limit
• No refunds once the call starts
\nSee you soon! 👋`;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📅 Add to Calendar', bookingResult.booking.meetingUrl)],
          [Markup.button.callback('📞 Book Another Call', 'book_private_call')],
          [Markup.button.callback(t('back', lang), 'back_to_main')],
        ]),
      });
    } catch (error) {
      logger.error('Error completing booking:', error);
      const lang = getLanguage(ctx);
      await ctx.editMessageText(
        t('error', lang),
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t('back', lang), 'back_to_main')],
          ]),
        }
      ).catch(() => {});
    }
  });

  // Helper method to calculate time until call
  const calculateTimeUntilCall = (date, time, lang) => {
    try {
      const callDateTime = new Date(`${date}T${time}`);
      const now = new Date();
      const diffMs = callDateTime - now;
      const diffMins = Math.ceil(diffMs / (1000 * 60));
      
      if (diffMins <= 0) {
        return lang === 'es' ? 'ahora mismo' : 'right now';
      } else if (diffMins < 60) {
        return lang === 'es' ? `${diffMins} minutos` : `${diffMins} minutes`;
      } else if (diffMins < 1440) {
        const hours = Math.floor(diffMins / 60);
        return lang === 'es' ? `${hours} horas` : `${hours} hours`;
      } else {
        const days = Math.floor(diffMins / 1440);
        return lang === 'es' ? `${days} días` : `${days} days`;
      }
    } catch (error) {
      return lang === 'es' ? 'próximamente' : 'soon';
    }
  };

  // =====================================================
  // MY BOOKINGS
  // =====================================================

  // View my bookings
  bot.action('my_private_calls', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = getLanguage(ctx);
      const bookings = await PrivateCallService.getUserBookings(userId);
      
      if (bookings.length === 0) {
        await ctx.editMessageText(
          lang === 'es'
            ? `📅 *Mis Llamadas*
\nNo has reservado ninguna llamada aún.`
            : `📅 *My Calls*
\nYou haven't booked any calls yet.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📞 Book a Call', 'book_private_call')],
              [Markup.button.callback(t('back', lang), 'back_to_main')],
            ]),
          }
        );
        return;
      }
      
      let message = lang === 'es'
        ? `📅 *Mis Llamadas Privadas*
\nAquí están tus reservas:`
        : `📅 *My Private Calls*
\nHere are your bookings:`;
      
      bookings.forEach((booking, index) => {
        const statusEmoji = {
          pending: '⏳',
          confirmed: '✅',
          completed: '✔️',
          cancelled: '❌',
        }[booking.status] || '📞';
        
        message += `

${index + 1}. ${statusEmoji} ${getBookingStatusText(booking.status, lang)}
   🎭 ${booking.performerName}
   📅 ${booking.date} at ${booking.time}
   ⏱ ${booking.duration} minutes`;
        
        if (booking.meetingUrl && (booking.status === 'confirmed' || booking.status === 'pending')) {
          message += `
   🔗 ${booking.meetingUrl}`;
        }
      });
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📞 Book Another Call', 'book_private_call')],
          [Markup.button.callback(t('back', lang), 'back_to_main')],
        ]),
      });
    } catch (error) {
      logger.error('Error viewing user bookings:', error);
    }
  });

  // Helper method to get booking status text
  const getBookingStatusText = (status, lang) => {
    const statusTexts = {
      pending: lang === 'es' ? 'Pendiente' : 'Pending',
      confirmed: lang === 'es' ? 'Confirmada' : 'Confirmed',
      completed: lang === 'es' ? 'Completada' : 'Completed',
      cancelled: lang === 'es' ? 'Cancelada' : 'Cancelled',
    };
    return statusTexts[status] || status;
  };

  // =====================================================
  // FREE USER UPGRADE GATE
  // =====================================================

  // Show upgrade prompt for free users
  const showFreeUserUpgradePrompt = async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      const message = lang === 'es'
        ? `🔒 *Función para Usuarios PRIME*
\n📞 *Llamadas Privadas 1:1*
\nEsta función está disponible para usuarios PRIME. Con PRIME obtienes:
\n💎 Acceso a llamadas privadas con performers
🎭 Sesiones de 30-60 minutos
📅 Agendamiento flexible
🔒 Conexión segura y privada
\n💰 *Precio:* $14.99 USD/semana
\n¿Quieres convertirte en PRIME para acceder a esta función?`
        : `🔒 *Feature for PRIME Users*
\n📞 *Private 1:1 Calls*
\nThis feature is available for PRIME users. With PRIME you get:
\n💎 Access to private calls with performers
🎭 30-60 minute sessions
📅 Flexible scheduling
🔒 Secure and private connection
\n💰 *Price:* $14.99 USD/week
\nDo you want to become PRIME to access this feature?`;
      
      const buttons = [
        [Markup.button.callback('💎 Yes, Upgrade to PRIME', 'show_subscription_plans')],
        [Markup.button.callback(t('back', lang), 'back_to_main')],
      ];
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing free user upgrade prompt:', error);
    }
  };

  // Check if user is free and show upgrade prompt
  const checkFreeUserAndShowUpgrade = async (ctx, next) => {
    try {
      const userId = ctx.from.id;
      const user = await UserModel.getById(userId);
      
      if (user && !isPrimeUser(user) && ctx.session?.temp?.freeUserBooking) {
        await showFreeUserUpgradePrompt(ctx);
        return;
      }
      
      return next();
    } catch (error) {
      logger.error('Error in free user check:', error);
      return next();
    }
  };

  // Apply free user check to booking entry point
  bot.action('book_private_call', checkFreeUserAndShowUpgrade, async (ctx) => {
    // This will be handled by the original handler
  });
};

module.exports = registerPrivateCallBookingHandlers;
