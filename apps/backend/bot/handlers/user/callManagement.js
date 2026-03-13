const BookingModel = require('../../../models/bookingModel');
const logger = require('../../../utils/logger');

/**
 * Process refund through payment provider
 * @param {Object} call - The call object
 * @param {number} refundAmount - The amount to refund
 * @param {number} refundPercentage - The percentage of refund
 * @returns {Promise<void>}
 */
async function processRefund(call, refundAmount, refundPercentage) {
  try {
    // Validate refund parameters
    if (!call || refundAmount <= 0) {
      logger.warn('Invalid refund parameters', { callId: call?.id, refundAmount });
      return;
    }

    logger.info('Processing refund', {
      callId: call.id,
      userId: call.userId,
      refundAmount,
      refundPercentage,
      transactionId: call.transactionId,
    });

    // Call PaymentService to process refund through payment provider
    // This should integrate with Daimo Pay or ePayco refund API
    if (PaymentService && typeof PaymentService.processRefund === 'function') {
      await PaymentService.processRefund({
        callId: call.id,
        userId: call.userId,
        transactionId: call.transactionId,
        refundAmount,
        refundPercentage,
        reason: 'User cancelled call',
      });
    } else {
      logger.warn('PaymentService.processRefund not implemented yet');
    }

    logger.info('Refund processing initiated', {
      callId: call.id,
      refundAmount,
    });
  } catch (error) {
    logger.error('Error in processRefund:', error);
    throw error;
  }
}

/**
 * Call Management Handlers - Reschedule, cancel, view history
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 * @returns {void}
 */
function registerCallManagementHandlers(bot) {
  /**
   * View user's call history
   */
  bot.command('mycalls', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const calls = await BookingModel.getByUser(userId, 10);

      if (!calls || calls.length === 0) {
        await ctx.reply(
          '📞 *My Calls*\n\n' +
          'You have no scheduled calls yet.\n\n' +
          'Book a 1:1 call to get started!',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 Book 1:1 Call', callback_data: 'book_private_call' }],
              ],
            },
          }
        );
        return;
      }

      let message = '📞 *My Calls*\n\n';

      // Group by status
      const upcoming = calls.filter(c => c.status === 'confirmed' || c.status === 'pending');
      const completed = calls.filter(c => c.status === 'completed');
      const cancelled = calls.filter(c => c.status === 'cancelled');

      if (upcoming.length > 0) {
        message += `📅 *Upcoming (${upcoming.length}):*\n`;
        upcoming.forEach(call => {
          message += `• ${call.scheduledDate} at ${call.scheduledTime}\n`;
          message += `  with ${call.performer} (${call.duration} min)\n`;
        });
        message += '\n';
      }

      if (completed.length > 0) {
        message += `✅ *Completed (${completed.length}):*\n`;
        completed.slice(0, 3).forEach(call => {
          message += `• ${call.scheduledDate} - ${call.performer}\n`;
        });
        message += '\n';
      }

      if (cancelled.length > 0) {
        message += `❌ *Cancelled (${cancelled.length}):*\n`;
      }

      const keyboard = upcoming.map(call => [{
        text: `Manage: ${call.scheduledDate} ${call.scheduledTime}`,
        callback_data: `manage_call:${call.id}`,
      }]);

      keyboard.push([{ text: '📞 Book New Call', callback_data: 'book_private_call' }]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      logger.error('Error showing call history:', error);
      await ctx.reply('❌ Error loading your calls.');
    }
  });

  /**
   * Manage specific call
   */
  bot.action(/^manage_call:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const callId = ctx.match[1];
      const call = await BookingModel.getById(callId);

      if (!call || call.userId.toString() !== ctx.from.id.toString()) {
        await ctx.reply('❌ Call not found or access denied.');
        return;
      }

      let message = '📞 *Call Details*\n\n';
      message += `👤 *Performer:* ${call.performer}\n`;
      message += `📅 *Date:* ${call.scheduledDate}\n`;
      message += `⏰ *Time:* ${call.scheduledTime}\n`;
      message += `⏱ *Duration:* ${call.duration} minutes\n`;
      message += `📊 *Status:* ${call.status}\n`;

      if (call.meetingUrl) {
        message += `\n🔗 *Meeting Link:*\n${call.meetingUrl}`;
      }

      const keyboard = [];

      // Add join button if call is soon
      if (call.meetingUrl) {
        keyboard.push([{ text: '🎥 Join Call', url: call.meetingUrl }]);
      }

      // Only allow reschedule/cancel for upcoming calls
      if (call.status === 'confirmed' || call.status === 'pending') {
        keyboard.push([{ text: '📅 Reschedule', callback_data: `reschedule_call:${call.id}` }]);
        keyboard.push([{ text: '❌ Cancel Call', callback_data: `cancel_call_confirm:${call.id}` }]);
      }

      // Add feedback option for completed calls
      if (call.status === 'completed' && !call.feedbackSubmitted) {
        keyboard.push([{ text: '⭐ Leave Feedback', callback_data: `feedback_call:${call.id}` }]);
      }

      keyboard.push([{ text: '« Back', callback_data: 'back_to_mycalls' }]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      logger.error('Error managing call:', error);
      await ctx.reply('❌ Error loading call details.');
    }
  });

  /**
   * Reschedule call
   */
  bot.action(/^reschedule_call:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const callId = ctx.match[1];
      const call = await BookingModel.getById(callId);

      if (!call || call.userId.toString() !== ctx.from.id.toString()) {
        await ctx.reply('❌ Call not found or access denied.');
        return;
      }

      // Check if call can be rescheduled (at least 2 hours before)
      const scheduledDate = new Date(call.scheduledDate);
      const now = new Date();
      const hoursUntilCall = (scheduledDate - now) / (1000 * 60 * 60);

      if (hoursUntilCall < 2) {
        await ctx.editMessageText(
          '⚠️ *Cannot Reschedule*\n\n' +
          'Calls can only be rescheduled at least 2 hours in advance.\n\n' +
          'Please contact support if you need assistance.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '« Back', callback_data: `manage_call:${callId}` }],
              ],
            },
          }
        );
        return;
      }

      ctx.session.temp.reschedulingCallId = callId;
      await ctx.saveSession();

      await ctx.editMessageText(
        '📅 *Reschedule Call*\n\n' +
        `Current: ${call.scheduledDate} at ${call.scheduledTime}\n\n` +
        'Please send your preferred new date and time in the following format:\n\n' +
        '`DD/MM/YYYY`\n' +
        '`HH:MM AM/PM`\n\n' +
        'Example:\n' +
        '`25/12/2024`\n' +
        '`3:30 PM`',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancel', callback_data: `manage_call:${callId}` }],
            ],
          },
        }
      );
    } catch (error) {
      logger.error('Error starting reschedule:', error);
      await ctx.reply('❌ Error processing reschedule request.');
    }
  });

  /**
   * Handle reschedule text input
   */
  bot.on('text', async (ctx, next) => {
    if (ctx.session?.temp?.reschedulingCallId) {
      try {
        const callId = ctx.session.temp.reschedulingCallId;
        const call = await BookingModel.getById(callId);

        if (!call) {
          delete ctx.session.temp.reschedulingCallId;
          await ctx.saveSession();
          await ctx.reply('❌ Call not found.');
          return;
        }

        const text = ctx.message.text.trim();
        const lines = text.split('\n');

        if (lines.length < 2) {
          await ctx.reply('❌ Invalid format. Please send date and time on separate lines.');
          return;
        }

        const newDate = lines[0].trim();
        const newTime = lines[1].trim();

        // Update call
        await BookingModel.updateStatus(callId, call.status, {
          scheduledDate: newDate,
          scheduledTime: newTime,
          rescheduledAt: new Date(),
          rescheduledFrom: {
            date: call.scheduledDate,
            time: call.scheduledTime,
          },
        });

        delete ctx.session.temp.reschedulingCallId;
        await ctx.saveSession();

        await ctx.reply(
          '✅ *Call Rescheduled!*\n\n' +
          `📅 New Date: ${newDate}\n` +
          `⏰ New Time: ${newTime}\n` +
          `👤 Performer: ${call.performer}\n\n` +
          'You will receive reminders before your call.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📞 View My Calls', callback_data: 'back_to_mycalls' }],
              ],
            },
          }
        );

        logger.info('Call rescheduled', {
          callId,
          userId: ctx.from.id,
          oldDate: call.scheduledDate,
          oldTime: call.scheduledTime,
          newDate,
          newTime,
        });
      } catch (error) {
        logger.error('Error processing reschedule:', error);
        await ctx.reply('❌ Error rescheduling call. Please try again.');
      }
    } else {
      return next();
    }
  });

  /**
   * Cancel call confirmation
   */
  bot.action(/^cancel_call_confirm:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const callId = ctx.match[1];
      const call = await BookingModel.getById(callId);

      if (!call || call.userId.toString() !== ctx.from.id.toString()) {
        await ctx.reply('❌ Call not found or access denied.');
        return;
      }

      // Calculate refund amount based on cancellation time
      const scheduledDate = new Date(call.scheduledDate);
      const now = new Date();
      const hoursUntilCall = (scheduledDate - now) / (1000 * 60 * 60);

      let refundPercentage = 0;
      let refundMessage = '';

      if (hoursUntilCall >= 24) {
        refundPercentage = 100;
        refundMessage = '100% refund (full refund)';
      } else if (hoursUntilCall >= 2) {
        refundPercentage = 50;
        refundMessage = '50% refund';
      } else {
        refundPercentage = 0;
        refundMessage = 'No refund (less than 2 hours notice)';
      }

      const refundAmount = (call.amount || 100) * (refundPercentage / 100);

      await ctx.editMessageText(
        '⚠️ *Cancel Call*\n\n' +
        `📅 Date: ${call.scheduledDate}\n` +
        `⏰ Time: ${call.scheduledTime}\n` +
        `👤 Performer: ${call.performer}\n\n` +
        `💰 *Refund Policy:*\n` +
        `${refundMessage}\n` +
        `Refund Amount: $${refundAmount.toFixed(2)} USD\n\n` +
        'Are you sure you want to cancel this call?',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes, Cancel Call', callback_data: `cancel_call_execute:${callId}:${refundPercentage}` }],
              [{ text: '❌ No, Keep Call', callback_data: `manage_call:${callId}` }],
            ],
          },
        }
      );
    } catch (error) {
      logger.error('Error showing cancel confirmation:', error);
      await ctx.reply('❌ Error processing cancellation request.');
    }
  });

  /**
   * Execute call cancellation
   */
  bot.action(/^cancel_call_execute:(.+):(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery('Processing cancellation...');

      const callId = ctx.match[1];
      // HIGH-04: Recalculate refund server-side instead of trusting callback_data
      const call = await BookingModel.getById(callId);

      if (!call || call.userId.toString() !== ctx.from.id.toString()) {
        await ctx.reply('❌ Call not found or access denied.');
        return;
      }

      // HIGH-04: Recalculate refund percentage server-side
      const scheduledDate = new Date(call.scheduledDate || call.startTimeUtc);
      const now = new Date();
      const hoursUntilCall = (scheduledDate - now) / (1000 * 60 * 60);

      let refundPercentage = 0;
      if (hoursUntilCall >= 24) {
        refundPercentage = 100;
      } else if (hoursUntilCall >= 2) {
        refundPercentage = 50;
      }

      // Cancel the call
      await BookingModel.cancel(callId, 'User requested cancellation', 'user');

      const refundAmount = (call.amount || call.priceCents / 100 || 100) * (refundPercentage / 100);

      let message = '✅ *Call Cancelled*\n\n';
      message += `Your call has been cancelled.\n\n`;

      if (refundPercentage > 0) {
        message += `💰 *Refund Processing:*\n`;
        message += `Amount: $${refundAmount.toFixed(2)} USD (${refundPercentage}%)\n`;
        message += `Method: Original payment method\n`;
        message += `Timeline: 5-10 business days\n\n`;
        message += 'You will receive a confirmation email once the refund is processed.';
      } else {
        message += `⚠️ No refund applicable (cancelled within 2 hours of scheduled time).`;
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📞 Book New Call', callback_data: 'book_private_call' }],
            [{ text: '📋 View My Calls', callback_data: 'back_to_mycalls' }],
          ],
        },
      });

      logger.info('Call cancelled', {
        callId,
        userId: ctx.from.id,
        refundPercentage,
        refundAmount,
      });

      // Process refund through payment provider if refund amount is greater than 0
      if (refundPercentage > 0) {
        try {
          await processRefund(call, refundAmount, refundPercentage);
        } catch (refundError) {
          logger.error('Error processing refund in payment provider:', refundError);
          // Refund processing failed but cancellation was recorded
          // User should contact support if refund is not received
        }
      }
    } catch (error) {
      logger.error('Error executing cancellation:', error);
      await ctx.reply('❌ Error cancelling call. Please contact support.');
    }
  });

  /**
   * Back to my calls
   */
  bot.action('back_to_mycalls', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      // Trigger the /mycalls command logic
      ctx.command = 'mycalls';
      await bot.handleUpdate({
        ...ctx.update,
        message: {
          ...ctx.update.callback_query.message,
          text: '/mycalls',
          from: ctx.from,
        },
      });
    } catch (error) {
      logger.error('Error returning to my calls:', error);
    }
  });

  logger.info('Call management handlers registered');
}

module.exports = registerCallManagementHandlers;
