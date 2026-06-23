const logger = require('../utils/logger');
const { query } = require('../config/postgres');
const { Markup } = require('telegraf');
const { CREATOR_REVENUE_RATE } = require('../config/monetizationConfig');

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

      const appUrl = process.env.APP_PUBLIC_URL || 'https://pnptv.app';
      const roomUrl = `${appUrl}/booking/${bookingId}/confirm`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🎥 Entrar a la Sala' : '🎥 Join Room',
          roomUrl
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

      const appUrl5m = process.env.APP_PUBLIC_URL || 'https://pnptv.app';
      const joinUrl5m = `${appUrl5m}/booking/${bookingId}/confirm`;

      const userKeyboard = Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🎥 UNIRME AHORA' : '🎥 JOIN NOW',
          joinUrl5m
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
            joinUrl5m
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

      const earnings = booking.model_earnings || (booking.price_usd * CREATOR_REVENUE_RATE);

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

      // Escape user-supplied comment so it cannot break Telegram Markdown parsing.
      // Replace backticks, asterisks, underscores, and square brackets that have
      // special meaning in Telegram's legacy Markdown mode.
      const safeComment = comment
        ? comment.replace(/[`*_[\]]/g, '\\$&').slice(0, 500)
        : '';

      const message = lang === 'es'
        ? `🌟 *Nuevo Feedback*\n\n` +
          `Calificación: ${stars}\n` +
          (safeComment ? `💬 "${safeComment}"\n\n` : '\n') +
          `¡Gracias por tu excelente servicio!`
        : `🌟 *New Feedback*\n\n` +
          `Rating: ${stars}\n` +
          (safeComment ? `💬 "${safeComment}"\n\n` : '\n') +
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
                m.display_name as model_name,
                m.user_id as model_telegram_id
         FROM pnp_bookings b
         JOIN performers m ON b.model_id = m.id
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
        `SELECT b.id, b.user_id, m.user_id as model_telegram_id
         FROM pnp_bookings b
         JOIN performers m ON b.model_id = m.id
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
        `SELECT b.id, b.user_id, m.user_id as model_telegram_id
         FROM pnp_bookings b
         JOIN performers m ON b.model_id = m.id
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
      // Column name is derived from an allowlist — never interpolate user-supplied input
      const ALLOWED_NOTIFICATION_TYPES = { '1h': 'reminder_1h_sent', '5m': 'reminder_5m_sent' };
      const column = ALLOWED_NOTIFICATION_TYPES[notificationType];
      if (!column) {
        logger.error('markNotificationSent: invalid notificationType rejected', { notificationType });
        return;
      }
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

      // Process 1-hour reminders.
      // Atomically claim each booking before sending to prevent duplicate dispatch
      // when multiple workers run concurrently within the same time window.
      for (const booking of oneHourReminders) {
        const claimed = await query(
          `UPDATE pnp_bookings SET reminder_1h_sent = TRUE, updated_at = NOW()
           WHERE id = $1 AND (reminder_1h_sent IS NULL OR reminder_1h_sent = FALSE)`,
          [booking.id]
        );
        if (!claimed.rowCount) continue; // another worker already sent this one

        await this.sendBookingReminder(booking.id, booking.user_id, 'es');
        if (booking.model_telegram_id) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
          await this.sendModelBookingAlert(booking.id, booking.model_telegram_id, 'es');
        }
        sent++;
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }

      // Process 5-minute alerts.
      for (const booking of fiveMinuteAlerts) {
        const claimed = await query(
          `UPDATE pnp_bookings SET reminder_5m_sent = TRUE, updated_at = NOW()
           WHERE id = $1 AND (reminder_5m_sent IS NULL OR reminder_5m_sent = FALSE)`,
          [booking.id]
        );
        if (!claimed.rowCount) continue; // another worker already sent this one

        await this.sendShowStartingSoon(
          booking.id,
          booking.user_id,
          booking.model_telegram_id,
          'es'
        );
        sent++;
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
   * Notify all users who subscribed to a stream-start notification for a slot.
   * Reads the Redis SET pnp:live:notify:{slotId}, sends Telegram messages to
   * each subscriber's telegram ID (looked up from the users table), then
   * deletes the SET so notifications are not re-sent.
   *
   * Called from the live stream start worker/cron when a scheduled stream begins
   * (or 5 minutes before start).
   *
   * @param {string} slotId - The live_streams UUID
   * @param {string} streamerName - Display name of the streamer going live
   * @param {string|null} channelRef - Restreamer channel ref for watch URL (e.g. 'pnptv-frank')
   * @returns {Promise<number>} Number of notifications sent
   */
  static async notifyStreamSubscribers(slotId, streamerName, channelRef = null) {
    if (!slotId || typeof slotId !== 'string') {
      logger.warn('notifyStreamSubscribers: invalid slotId', { slotId });
      return 0;
    }

    let redis;
    try {
      const { getRedis } = require('../config/redis');
      redis = getRedis();
    } catch (err) {
      logger.error('notifyStreamSubscribers: failed to get Redis client', { error: err.message });
      return 0;
    }

    const redisKey = `pnp:live:notify:${slotId}`;

    try {
      const subscriberIds = await redis.smembers(redisKey);
      if (!subscriberIds || subscriberIds.length === 0) {
        logger.info('notifyStreamSubscribers: no subscribers for slot', { slotId });
        return 0;
      }

      // Look up Telegram IDs for all subscriber user IDs in a single query.
      // Users without a Telegram account linked will be silently skipped.
      const placeholders = subscriberIds.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await query(
        `SELECT id, telegram FROM users WHERE id IN (${placeholders}) AND telegram IS NOT NULL`,
        subscriberIds
      );

      if (rows.length === 0) {
        // No Telegram-linked subscribers; delete the key and exit
        await redis.del(redisKey);
        return 0;
      }

      const watchPath = channelRef ? `/live/${channelRef}` : '/live';
      const appUrl = process.env.APP_PUBLIC_URL || 'https://pnptv.app';
      const watchUrl = `${appUrl}${watchPath}`;
      const safeName = (streamerName || 'A creator').replace(/[*_[\]()~`>#+=|{}.!-]/g, '\\$&');
      const message =
        `🔴 *${safeName} is going live now\\!*\n\n` +
        `Tap below to watch before the room fills up\\.`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('Watch Now', watchUrl)],
      ]);

      const RATE_LIMIT_DELAY_MS = 50;
      let sent = 0;
      for (const row of rows) {
        if (!row.telegram) continue;
        const success = await this.sendMessage(row.telegram, message, {
          ...keyboard,
          parse_mode: 'MarkdownV2',
        });
        if (success) sent++;
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }

      // Clean up the SET so subscribers are not notified again
      await redis.del(redisKey);

      logger.info('notifyStreamSubscribers: notifications dispatched', {
        slotId,
        subscriberCount: subscriberIds.length,
        telegramLinked: rows.length,
        sent,
      });

      return sent;
    } catch (err) {
      logger.error('notifyStreamSubscribers: error dispatching notifications', {
        slotId,
        error: err.message,
      });
      return 0;
    }
  }

  /**
   * Send broadcast to all active models
   */
  static async broadcastToModels(message, lang = 'es') {
    try {
      const models = await query(
        `SELECT user_id FROM performers WHERE status = 'active' AND user_id IS NOT NULL`
      );

      const broadcastMsg = lang === 'es'
        ? `📢 *Anuncio PNP Live*\n\n${message}`
        : `📢 *PNP Live Announcement*\n\n${message}`;

      const RATE_LIMIT_DELAY = 50; // ms between Telegram sends — matches processPendingNotifications
      let sent = 0;
      for (const model of models.rows || []) {
        if (model.user_id) {
          const success = await this.sendMessage(model.user_id, broadcastMsg);
          if (success) sent++;
          await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
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
