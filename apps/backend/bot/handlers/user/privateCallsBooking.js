const ModelManagementModel = require('../../../models/modelManagementModel');
const logger = require('../../../utils/logger');
const PaymentService = require('../../services/paymentService');

/**
 * User Private Calls Booking Handler
 * Manages 1:1 private calls booking interface
 */

const registerPrivateCallsBookingHandlers = (bot) => {
  /**
   * Show available models
   */
  bot.action('book_private_call', async (ctx) => {
    try {
      const models = await ModelManagementModel.getAllModels(true);

      if (models.length === 0) {
        return ctx.answerCbQuery('No models available yet', true);
      }

      const keyboard = models.map(model => {
        const status = model.status || 'offline';
        const statusEmoji = status === 'online' ? '🟢' : status === 'busy' ? '🟡' : '⚪';

        return [{
          text: `${statusEmoji} ${model.display_name} - $${model.price_per_minute}/min`,
          callback_data: `select_model:${model.model_id}`
        }];
      });

      keyboard.push([{
        text: '🔙 Back',
        callback_data: 'menu_main'
      }]);

      await ctx.editMessageText(
        '📞 **Book a 1:1 Private Call**\n\n' +
        'Select a model to view their profile and book a call:\n\n' +
        `${models.map(m => `• **${m.display_name}** - $${m.price_per_minute}/min (${m.status})`).join('\n')}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in book_private_call:', error);
      ctx.answerCbQuery('Error loading models', true);
    }
  });

  /**
   * Show model profile and details
   */
  bot.action(/^select_model:(.+)$/, async (ctx) => {
    try {
      const model_id = BigInt(ctx.match[1]);
      const model = await ModelManagementModel.getModelDetails(model_id);

      if (!model) {
        return ctx.answerCbQuery('Model not found', true);
      }

      const statusEmoji = model.status === 'online' ? '🟢 Online' :
                         model.status === 'busy' ? '🟡 Busy' : '⚪ Offline';

      const avgRating = model.avg_rating ? parseFloat(model.avg_rating).toFixed(1) : 'N/A';
      const ratingStars = avgRating !== 'N/A' ? '⭐'.repeat(Math.round(avgRating)) : 'No reviews';

      const profileText = `
⭐ **${model.display_name}**
${statusEmoji}

📝 ${model.bio || 'No bio available'}

💰 Price: **$${model.price_per_minute}** per minute
⏱️ Duration: ${model.min_duration_minutes}-${model.max_duration_minutes} minutes

🌟 Rating: ${ratingStars} (${model.review_count} reviews)

📸 Photos: ${model.photo_count} available
`;

      const keyboard = [
        [{
          text: '📸 View Photos',
          callback_data: `view_model_photos:${model_id}`
        }],
        [{
          text: '📅 Book a Call',
          callback_data: `book_call:${model_id}`
        }],
        [{
          text: '🔙 Back',
          callback_data: 'book_private_call'
        }]
      ];

      await ctx.editMessageText(profileText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in select_model:', error);
      ctx.answerCbQuery('Error loading model details', true);
    }
  });

  /**
   * View model photos
   */
  bot.action(/^view_model_photos:(.+)$/, async (ctx) => {
    try {
      const model_id = BigInt(ctx.match[1]);
      const photos = await ModelManagementModel.getModelPhotos(model_id);
      const model = await ModelManagementModel.getModelDetails(model_id);

      if (photos.length === 0) {
        return ctx.answerCbQuery('No photos available', true);
      }

      // Send first photo
      const photo = photos[0];
      const caption = `📸 ${photo.caption || ''}\n\n(1/${photos.length})`;

      // Store photo index in session for navigation
      ctx.session.currentPhotoIndex = 0;
      ctx.session.modelPhotos = photos;
      ctx.session.selectedModelId = model_id;

      const keyboard = [
        [{
          text: '⬅️ Previous',
          callback_data: `prev_photo:${model_id}`
        },
        {
          text: 'Next ➡️',
          callback_data: `next_photo:${model_id}`
        }],
        [{
          text: '📅 Book',
          callback_data: `book_call:${model_id}`
        }],
        [{
          text: '🔙 Back',
          callback_data: `select_model:${model_id}`
        }]
      ];

      await ctx.editMessageMedia(
        {
          type: 'photo',
          media: photo.photo_url,
          caption: caption,
          parse_mode: 'Markdown'
        },
        {
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in view_model_photos:', error);
      ctx.answerCbQuery('Error loading photos', true);
    }
  });

  /**
   * Book call - Select date
   */
  bot.action(/^book_call:(.+)$/, async (ctx) => {
    try {
      const model_id = BigInt(ctx.match[1]);
      const model = await ModelManagementModel.getModelDetails(model_id);

      if (!model) {
        return ctx.answerCbQuery('Model not found', true);
      }

      // Store model selection in session
      ctx.session.selectedModelId = model_id;
      ctx.session.bookingStep = 'select_date';

      // Generate next 14 days
      const keyboard = [];
      for (let i = 1; i <= 14; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();

        keyboard.push([{
          text: `${dayName} ${dayNum}`,
          callback_data: `select_date:${dateStr}`
        }]);
      }

      keyboard.push([{
        text: '🔙 Back',
        callback_data: `select_model:${model_id}`
      }]);

      await ctx.editMessageText(
        `📅 **Select a Date**\n\nChoose when you'd like to book with **${model.display_name}**`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in book_call:', error);
      ctx.answerCbQuery('Error loading booking', true);
    }
  });

  /**
   * Select time slot
   */
  bot.action(/^select_date:(.+)$/, async (ctx) => {
    try {
      const date = ctx.match[1];
      const model_id = ctx.session.selectedModelId;

      if (!model_id) {
        return ctx.answerCbQuery('Session expired. Please start over.', true);
      }

      // Get available slots
      const slots = await ModelManagementModel.getAvailableSlots(model_id, date);
      const model = await ModelManagementModel.getModelDetails(model_id);

      if (slots.length === 0) {
        return ctx.answerCbQuery('No available slots for this date', true);
      }

      ctx.session.selectedDate = date;
      ctx.session.bookingStep = 'select_time';

      const keyboard = [];
      for (let i = 0; i < slots.length; i += 4) {
        const row = [];
        for (let j = 0; j < 4 && i + j < slots.length; j++) {
          row.push({
            text: slots[i + j],
            callback_data: `select_time:${slots[i + j]}`
          });
        }
        keyboard.push(row);
      }

      keyboard.push([{
        text: '🔙 Back',
        callback_data: `book_call:${model_id}`
      }]);

      await ctx.editMessageText(
        `⏰ **Select a Time**\n\nDate: **${date}**\nModel: **${model.display_name}**\n\nAvailable slots:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in select_date:', error);
      ctx.answerCbQuery('Error loading time slots', true);
    }
  });

  /**
   * Select duration
   */
  bot.action(/^select_time:(.+)$/, async (ctx) => {
    try {
      const time = ctx.match[1];
      const model_id = ctx.session.selectedModelId;
      const model = await ModelManagementModel.getModelDetails(model_id);

      if (!model) {
        return ctx.answerCbQuery('Model not found', true);
      }

      ctx.session.selectedTime = time;
      ctx.session.bookingStep = 'select_duration';

      // Generate duration options (15, 30, 45, 60, 90, 120 minutes)
      const keyboard = [];
      const durations = [15, 30, 45, 60, 90, 120].filter(d =>
        d >= model.min_duration_minutes && d <= model.max_duration_minutes
      );

      for (let i = 0; i < durations.length; i += 3) {
        const row = [];
        for (let j = 0; j < 3 && i + j < durations.length; j++) {
          const dur = durations[i + j];
          const price = (dur * model.price_per_minute).toFixed(2);
          row.push({
            text: `${dur}min - $${price}`,
            callback_data: `select_duration:${dur}`
          });
        }
        keyboard.push(row);
      }

      keyboard.push([{
        text: '🔙 Back',
        callback_data: `select_date:${ctx.session.selectedDate}`
      }]);

      await ctx.editMessageText(
        `⏱️ **Select Duration**\n\nDate: **${ctx.session.selectedDate}**\nTime: **${time}**\nModel: **${model.display_name}**\n\nPrice: **$${model.price_per_minute}** per minute`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in select_time:', error);
      ctx.answerCbQuery('Error loading duration options', true);
    }
  });

  /**
   * Confirm booking
   */
  bot.action(/^select_duration:(\d+)$/, async (ctx) => {
    try {
      const duration = parseInt(ctx.match[1]);
      const model_id = ctx.session.selectedModelId;
      const date = ctx.session.selectedDate;
      const time = ctx.session.selectedTime;

      const model = await ModelManagementModel.getModelDetails(model_id);
      const totalPrice = (duration * model.price_per_minute).toFixed(2);

      ctx.session.selectedDuration = duration;
      ctx.session.totalPrice = totalPrice;
      ctx.session.bookingStep = 'confirm';

      const keyboard = [
        [{
          text: '💳 Pay with ePayco',
          callback_data: 'pay_epayco'
        }],
        [{
          text: '💎 Pay with Daimo (Crypto)',
          callback_data: 'pay_daimo'
        }],
        [{
          text: '🔙 Back',
          callback_data: `select_time:${time}`
        }]
      ];

      await ctx.editMessageText(
        `✅ **Confirm Your Booking**\n\n` +
        `📛 Model: **${model.display_name}**\n` +
        `📅 Date: **${date}**\n` +
        `⏰ Time: **${time}**\n` +
        `⏱️ Duration: **${duration} minutes**\n` +
        `💰 Total: **$${totalPrice}**\n\n` +
        `Select payment method:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in select_duration:', error);
      ctx.answerCbQuery('Error confirming booking', true);
    }
  });

  /**
   * Process payment
   */
  bot.action(/^pay_(epayco|daimo)$/, async (ctx) => {
    try {
      const method = ctx.match[1];
      const userId = ctx.from.id;
      const username = ctx.from.username || 'No username';

      // Create booking in pending status
      const booking = await ModelManagementModel.createBooking({
        model_id: ctx.session.selectedModelId,
        user_id: userId,
        telegram_user_id: userId,
        username: username,
        scheduled_date: ctx.session.selectedDate,
        start_time: ctx.session.selectedTime,
        duration_minutes: ctx.session.selectedDuration,
        total_price: ctx.session.totalPrice,
        payment_method: method,
        notes: 'Booked via Telegram'
      });

      // Generate payment link based on method
      let paymentUrl;
      if (method === 'epayco') {
        paymentUrl = await PaymentService.createEPaycoCheckout({
          userId,
          bookingId: booking.id,
          amount: ctx.session.totalPrice
        });
      } else if (method === 'daimo') {
        paymentUrl = await PaymentService.createDaimoPayment({
          userId,
          bookingId: booking.id,
          amount: ctx.session.totalPrice
        });
      }

      const keyboard = [[{
        text: '💳 Complete Payment',
        url: paymentUrl
      }], [{
        text: '❌ Cancel',
        callback_data: 'cancel_booking'
      }]];

      await ctx.editMessageText(
        `🔗 **Payment Required**\n\n` +
        `Click the button below to complete your payment:\n\n` +
        `Total: **$${ctx.session.totalPrice}**`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in pay_method:', error);
      ctx.answerCbQuery('Error processing payment', true);
    }
  });

  /**
   * Cancel booking
   */
  bot.action('cancel_booking', async (ctx) => {
    try {
      ctx.session.selectedModelId = null;
      ctx.session.bookingStep = null;

      await ctx.editMessageText(
        '❌ **Booking Cancelled**\n\n' +
        'Your booking has been cancelled.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{
              text: '🔙 Back to Menu',
              callback_data: 'menu_main'
            }]]
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in cancel_booking:', error);
      ctx.answerCbQuery('Error cancelling booking', true);
    }
  });

  /**
   * View my bookings
   */
  bot.action('view_my_bookings', async (ctx) => {
    try {
      const bookings = await ModelManagementModel.getUserBookings(ctx.from.id);

      if (bookings.length === 0) {
        return ctx.answerCbQuery('You have no bookings yet', true);
      }

      const bookingList = bookings.map((b, i) =>
        `${i + 1}. **${b.display_name}** - ${b.scheduled_date} at ${b.start_time}\n` +
        `   Status: ${b.status} | $${b.total_price}`
      ).join('\n\n');

      await ctx.editMessageText(
        `📞 **My Bookings**\n\n${bookingList}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{
              text: '🔙 Back',
              callback_data: 'menu_main'
            }]]
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in view_my_bookings:', error);
      ctx.answerCbQuery('Error loading bookings', true);
    }
  });
};

module.exports = registerPrivateCallsBookingHandlers;
