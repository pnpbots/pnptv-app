const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');
const { Markup } = require('telegraf');

/**
 * PNP Television Live Notification Service
 * Handles all notifications for bookings, reminders, and system alerts
 * Now with actual Telegram message sending
 */

// Store bot reference for sending messages
let botInstance = null;

class PNPLiveNotificationService {
  /**
   * Initialize the notification service with bot instance
   * @param {Telegraf} bot - Telegraf bot instance
   */
  static init(bot) {
    botInstance = bot;
    logger.info('PNP Live Notification Service initialized');
  }

  /**
   * Send a Telegram message safely
   * @param {string|number} chatId - Chat ID to send to
   * @param {string} message - Message text
   * @param {Object} options - Message options
   * @returns {Promise<boolean>} Success status
   */
  static async sendMessage(chatId, message, options = {}) {
    if (!botInstance) {
      logger.warn('Bot instance not initialized for notifications');
      return false;
    }

    try {
      await botInstance.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...options
      });
      return true;
    } catch (error) {
      if (error.code === 403) {
        logger.warn('User blocked the bot', { chatId });
      } else if (error.code === 400 && error.description?.includes('chat not found')) {
        logger.warn('Chat not found', { chatId });
      } else {
        logger.error('Error sending notification:', { chatId, error: error.message });
      }
      return false;
    }
  }

  /**
   * Send booking confirmation notification to user
   */
  static async sendBookingConfirmation(bookingId, userId, lang = 'es') {
    try {
      const booking = await this.getBookingDetails(bookingId);
      if (!booking) return false;

      const startTime = new Date(booking.booking_time).toLocaleString(
        lang === 'es' ? 'es-ES' : 'en-US',
        { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      );

      const message = lang === 'es'
        ? `🎉 *¡Reserva Confirmada!*\n\n` +
          `📹 *PNP Television Live*\n` +
          `💃 *Modelo:* ${booking.model_name}\n` +
          `📅 *Fecha:* ${startTime}\n` +
          `⏱️ *Duración:* ${booking.duration_minutes} min\n` +
          `💰 *Total:* $${booking.price_usd}\n\n` +
          `✅ Tu sala privada está lista\n` +
          `🔔 Recibirás recordatorio 1 hora antes\n\n` +
          `🆔 Reserva #${bookingId}`
        : `🎉 *Booking Confirmed!*\n\n` +
          `📹 *PNP Television Live*\n` +
          `💃 *Model:* ${booking.model_name}\n` +
          `📅 *Date:* ${startTime}\n` +
          `⏱️ *Duration:* ${booking.duration_minutes} min\n` +
          `💰 *Total:* $${booking.price_usd}\n\n` +
          `✅ Your private room is ready\n` +
          `🔔 You'll receive a reminder 1 hour before\n\n` +
          `🆔 Booking #${bookingId}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(
          lang === 'es' ? '📹 Ver Mi Reserva' : '📹 View My Booking',
          `pnp_live_view_booking_${bookingId}`
        )],
        [Markup.button.callback(
          lang === 'es' ? '📋 Mis Reservas' : '📋 My Bookings',
          'pnp_live_my_bookings'
        )]
      ]);

      const sent = await this.sendMessage(userId, message, keyboard);

      // Also notify the model
      if (booking.model_telegram_id) {
        await this.sendModelBookingAlert(bookingId, booking.model_telegram_id, lang);
      }

      logger.info('Booking confirmation sent', { bookingId, userId, sent });
      return sent;
    } catch (error) {
      logger.error('Error sending booking confirmation:', error);
      return false;
    }
  }

  /**
   * Send booking reminder notification (1 hour before)
   */
  static async sendBookingReminder(bookingId, userId, lang = 'es') {
    try {
      const booking = await this.getBookingDetails(bookingId);
      if (!booking) return false;

      const startTime = new Date(booking.booking_time).toLocaleTimeString(
        lang === 'es' ? 'es-ES' : 'en-US',
        { hour: '2-digit', minute: '2-digit' }
      );

      const message = lang === 'es'
        ? `🔔 *Recordatorio - 1 Hora*\n\n` +
          `📹 *Tu show con ${booking.model_name}*\n` +
          `⏰ Comienza a las ${startTime}\n\n` +
          `💡 *Prepárate:*\n` +
          `• Usa auriculares\n` +
          `• Lugar privado\n` +
          `• Cámara y mic listos\n\n` +
          `🆔 Reserva #${bookingId}`
        : `🔔 *Reminder - 1 Hour*\n\n` +
          `📹 *Your show with ${booking.model_name}*\n` +
          `⏰ Starts at ${startTime}\n\n` +
          `💡 *Get ready:*\n` +
          `• Use headphones\n` +
          `• Private location\n` +
          `• Camera and mic ready\n\n` +
          `🆔 Booking #${bookingId}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🎥 Entrar a la Sala' : '🎥 Join Room',
          booking.video_room_url || 'https://meet.jit.si'
        )]
      ]);

      return await this.sendMessage(userId, message, keyboard);
    } catch (error) {
      logger.error('Error sending booking reminder:', error);
      return false;
    }
  }

  /**
   * Send 5-minute alert before show starts
   */
  static async sendShowStartingSoon(bookingId, userId, modelTelegramId, lang = 'es') {
    try {
      const booking = await this.getBookingDetails(bookingId);
      if (!booking) return false;

      // User notification
      const userMessage = lang === 'es'
        ? `🚀 *¡5 MINUTOS!*\n\n` +
          `📹 Tu show con *${booking.model_name}* está por comenzar\n\n` +
          `👆 Toca el botón para unirte ahora`
        : `🚀 *5 MINUTES!*\n\n` +
          `📹 Your show with *${booking.model_name}* is about to start\n\n` +
          `👆 Tap the button to join now`;

      const userKeyboard = Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🎥 UNIRME AHORA' : '🎥 JOIN NOW',
          booking.video_room_url || 'https://meet.jit.si'
        )]
      ]);

      await this.sendMessage(userId, userMessage, userKeyboard);

      // Model notification
      if (modelTelegramId) {
        const modelMessage = lang === 'es'
          ? `🚀 *¡5 MINUTOS!*\n\n` +
            `📹 Tu show está por comenzar\n` +
            `💰 Ganancias: $${booking.model_earnings || booking.price_usd}\n\n` +
            `👆 Únete a la sala ahora`
          : `🚀 *5 MINUTES!*\n\n` +
            `📹 Your show is about to start\n` +
            `💰 Earnings: $${booking.model_earnings || booking.price_usd}\n\n` +
            `👆 Join the room now`;

        const modelKeyboard = Markup.inlineKeyboard([
          [Markup.button.url(
            lang === 'es' ? '🎥 ENTRAR AHORA' : '🎥 JOIN NOW',
            booking.video_room_url || 'https://meet.jit.si'
          )]
        ]);

        await this.sendMessage(modelTelegramId, modelMessage, modelKeyboard);
      }

      return true;
    } catch (error) {
      logger.error('Error sending show starting soon notification:', error);
      return false;
    }
  }

  /**
   * Send notification to model about new booking
   */
  static async sendModelBookingAlert(bookingId, modelTelegramId, lang = 'es') {
    try {
      const booking = await this.getBookingDetails(bookingId);
      if (!booking || !modelTelegramId) return false;

      const startTime = new Date(booking.booking_time).toLocaleString(
        lang === 'es' ? 'es-ES' : 'en-US',
        { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      );

      const earnings = booking.model_earnings || (booking.price_usd * 0.7);

      const message = lang === 'es'
        ? `💃 *¡Nueva Reserva!*\n\n` +
          `📹 *PNP Television Live*\n` +
          `📅 ${startTime}\n` +
          `⏱️ ${booking.duration_minutes} minutos\n` +
          `💰 *Tus ganancias:* $${earnings.toFixed(2)}\n\n` +
          `✅ Prepárate 5 min antes`
        : `💃 *New Booking!*\n\n` +
          `📹 *PNP Television Live*\n` +
          `📅 ${startTime}\n` +
          `⏱️ ${booking.duration_minutes} minutes\n` +
          `💰 *Your earnings:* $${earnings.toFixed(2)}\n\n` +
          `✅ Be ready 5 min before`;

      return await this.sendMessage(modelTelegramId, message);
    } catch (error) {
      logger.error('Error sending model booking alert:', error);
      return false;
    }
  }

  /**
   * Send payment received notification
   */
  static async sendPaymentReceived(bookingId, userId, lang = 'es') {
    try {
      const booking = await this.getBookingDetails(bookingId);
      if (!booking) return false;

      const message = lang === 'es'
        ? `💳 *¡Pago Recibido!*\n\n` +
          `✅ Tu pago de *$${booking.price_usd}* fue procesado\n` +
          `📹 Show con ${booking.model_name}\n` +
          `🔒 Sala privada asegurada\n\n` +
          `🆔 Reserva #${bookingId}`
        : `💳 *Payment Received!*\n\n` +
          `✅ Your payment of *$${booking.price_usd}* was processed\n` +
          `📹 Show with ${booking.model_name}\n` +
          `🔒 Private room secured\n\n` +
          `🆔 Booking #${bookingId}`;

      return await this.sendMessage(userId, message);
    } catch (error) {
      logger.error('Error sending payment received notification:', error);
      return false;
    }
  }

  /**
   * Send show completed notification with rating request
   */
  static async sendShowCompleted(bookingId, userId, lang = 'es') {
    try {
      const booking = await this.getBookingDetails(bookingId);
      if (!booking) return false;

      const message = lang === 'es'
        ? `🎉 *¡Show Completado!*\n\n` +
          `📹 Gracias por tu show con *${booking.model_name}*\n\n` +
          `⭐ ¿Cómo fue tu experiencia?\n` +
          `Tu opinión ayuda a otros usuarios`
        : `🎉 *Show Completed!*\n\n` +
          `📹 Thanks for your show with *${booking.model_name}*\n\n` +
          `⭐ How was your experience?\n` +
          `Your feedback helps other users`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('⭐', `pnp_rate_${bookingId}_1`),
          Markup.button.callback('⭐⭐', `pnp_rate_${bookingId}_2`),
          Markup.button.callback('⭐⭐⭐', `pnp_rate_${bookingId}_3`),
        ],
        [
          Markup.button.callback('⭐⭐⭐⭐', `pnp_rate_${bookingId}_4`),
          Markup.button.callback('⭐⭐⭐⭐⭐', `pnp_rate_${bookingId}_5`),
        ],
        [Markup.button.callback(
          lang === 'es' ? '⏭️ Saltar' : '⏭️ Skip',
          'pnp_live_my_bookings'
        )]
      ]);

      return await this.sendMessage(userId, message, keyboard);
    } catch (error) {
      logger.error('Error sending show completed notification:', error);
      return false;
    }
  }

  /**
   * Send refund processed notification
   */
  static async sendRefundProcessed(bookingId, userId, approved, amount, lang = 'es') {
    try {
      const statusEmoji = approved ? '✅' : '❌';
      const statusText = approved
        ? (lang === 'es' ? 'Aprobado' : 'Approved')
        : (lang === 'es' ? 'Rechazado' : 'Rejected');

      const message = lang === 'es'
        ? `${statusEmoji} *Reembolso ${statusText}*\n\n` +
          `💸 Monto: $${amount}\n` +
          `🆔 Reserva #${bookingId}\n\n` +
          (approved
            ? `💰 Se acreditará en 3-5 días hábiles`
            : `📋 Contacta soporte para más información`)
        : `${statusEmoji} *Refund ${statusText}*\n\n` +
          `💸 Amount: $${amount}\n` +
          `🆔 Booking #${bookingId}\n\n` +
          (approved
            ? `💰 Will be credited in 3-5 business days`
            : `📋 Contact support for more information`);

      return await this.sendMessage(userId, message);
    } catch (error) {
      logger.error('Error sending refund processed notification:', error);
      return false;
    }
  }

  /**
   * Send feedback received notification to model
   */
  static async sendFeedbackToModel(bookingId, modelTelegramId, rating, comment, lang = 'es') {
    try {
      if (!modelTelegramId) return false;

      const stars = '⭐'.repeat(rating);

      const message = lang === 'es'
        ? `🌟 *Nuevo Feedback*\n\n` +
          `Calificación: ${stars}\n` +
          (comment ? `💬 "${comment}"\n\n` : '\n') +
          `¡Gracias por tu excelente servicio!`
        : `🌟 *New Feedback*\n\n` +
          `Rating: ${stars}\n` +
          (comment ? `💬 "${comment}"\n\n` : '\n') +
          `Thanks for your excellent service!`;

      return await this.sendMessage(modelTelegramId, message);
    } catch (error) {
      logger.error('Error sending feedback to model:', error);
      return false;
    }
  }

  /**
   * Get booking details with model info
   */
  static async getBookingDetails(bookingId) {
    try {
      const result = await query(
        `SELECT b.*,
                m.name as model_name,
                m.telegram_id as model_telegram_id,
                m.commission_percent
         FROM pnp_bookings b
         JOIN pnp_models m ON b.model_id = m.id
         WHERE b.id = $1`,
        [bookingId]
      );
      return result.rows?.[0] || null;
    } catch (error) {
      logger.error('Error getting booking details:', error);
      return null;
    }
  }

  /**
   * Get upcoming bookings needing notifications
   * Uses notification tracking columns to prevent duplicate sends
   */
  static async getBookingsNeedingNotifications() {
    try {
      const now = new Date();

      // 1-hour reminders (55-65 min window) - only if not already sent
      const oneHourReminders = await query(
        `SELECT b.id, b.user_id, m.telegram_id as model_telegram_id
         FROM pnp_bookings b
         JOIN pnp_models m ON b.model_id = m.id
         WHERE b.booking_time BETWEEN $1 AND $2
         AND b.status = 'confirmed'
         AND b.payment_status = 'paid'
         AND (b.reminder_1h_sent IS NULL OR b.reminder_1h_sent = FALSE)`,
        [
          new Date(now.getTime() + 55 * 60 * 1000),
          new Date(now.getTime() + 65 * 60 * 1000)
        ]
      );

      // 5-minute alerts (4-6 min window) - only if not already sent
      const fiveMinuteAlerts = await query(
        `SELECT b.id, b.user_id, m.telegram_id as model_telegram_id
         FROM pnp_bookings b
         JOIN pnp_models m ON b.model_id = m.id
         WHERE b.booking_time BETWEEN $1 AND $2
         AND b.status = 'confirmed'
         AND b.payment_status = 'paid'
         AND (b.reminder_5m_sent IS NULL OR b.reminder_5m_sent = FALSE)`,
        [
          new Date(now.getTime() + 4 * 60 * 1000),
          new Date(now.getTime() + 6 * 60 * 1000)
        ]
      );

      return {
        oneHourReminders: oneHourReminders.rows || [],
        fiveMinuteAlerts: fiveMinuteAlerts.rows || []
      };
    } catch (error) {
      logger.error('Error getting bookings needing notifications:', error);
      return { oneHourReminders: [], fiveMinuteAlerts: [] };
    }
  }

  /**
   * Mark notification as sent to prevent duplicates
   */
  static async markNotificationSent(bookingId, notificationType) {
    try {
      const column = notificationType === '1h' ? 'reminder_1h_sent' : 'reminder_5m_sent';
      await query(
        `UPDATE pnp_bookings SET ${column} = TRUE, updated_at = NOW() WHERE id = $1`,
        [bookingId]
      );
    } catch (error) {
      logger.error('Error marking notification sent:', { bookingId, notificationType, error: error.message });
    }
  }

  /**
   * Process all pending notifications (called by cron/worker)
   * Includes rate limiting and duplicate prevention
   */
  static async processPendingNotifications() {
    try {
      const { oneHourReminders, fiveMinuteAlerts } = await this.getBookingsNeedingNotifications();

      let sent = 0;
      const RATE_LIMIT_DELAY = 50; // 50ms between messages to avoid Telegram limits

      // Process 1-hour reminders
      for (const booking of oneHourReminders) {
        const success = await this.sendBookingReminder(booking.id, booking.user_id, 'es');
        if (success) {
          await this.markNotificationSent(booking.id, '1h');
          if (booking.model_telegram_id) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
            await this.sendModelBookingAlert(booking.id, booking.model_telegram_id, 'es');
          }
          sent++;
        }
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }

      // Process 5-minute alerts
      for (const booking of fiveMinuteAlerts) {
        const success = await this.sendShowStartingSoon(
          booking.id,
          booking.user_id,
          booking.model_telegram_id,
          'es'
        );
        if (success) {
          await this.markNotificationSent(booking.id, '5m');
          sent++;
        }
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }

      if (sent > 0) {
        logger.info('PNP Live notifications processed', {
          oneHourReminders: oneHourReminders.length,
          fiveMinuteAlerts: fiveMinuteAlerts.length,
          totalSent: sent
        });
      }

      return true;
    } catch (error) {
      logger.error('Error processing pending notifications:', error);
      return false;
    }
  }

  /**
   * Send broadcast to all active models
   */
  static async broadcastToModels(message, lang = 'es') {
    try {
      const models = await query(
        `SELECT telegram_id FROM pnp_models WHERE is_active = TRUE AND telegram_id IS NOT NULL`
      );

      const broadcastMsg = lang === 'es'
        ? `📢 *Anuncio PNP Live*\n\n${message}`
        : `📢 *PNP Live Announcement*\n\n${message}`;

      let sent = 0;
      for (const model of models.rows || []) {
        if (model.telegram_id) {
          const success = await this.sendMessage(model.telegram_id, broadcastMsg);
          if (success) sent++;
        }
      }

      logger.info('Broadcast to models completed', { total: models.rows?.length, sent });
      return sent;
    } catch (error) {
      logger.error('Error broadcasting to models:', error);
      return 0;
    }
  }
}

module.exports = PNPLiveNotificationService;
