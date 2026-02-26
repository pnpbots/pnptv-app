const PaymentService = require('../../services/paymentService');
const logger = require('../../../utils/logger');

/**
 * Payment History Handlers - User payment history and receipts
 */
function registerPaymentHistoryHandlers(bot) {
  /**
   * View payment history
   */
  bot.command('payments', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const payments = await PaymentService.getPaymentHistory(userId);

      if (!payments || payments.length === 0) {
        await ctx.reply(
          '📊 *Payment History*\n\n' +
          'You have no payment history yet.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Group payments by status
      const successful = payments.filter(p => p.status === 'success');
      const pending = payments.filter(p => p.status === 'pending');
      const failed = payments.filter(p => p.status === 'failed');

      let message = '📊 *Your Payment History*\n\n';

      if (successful.length > 0) {
        message += `✅ *Successful (${successful.length})*\n`;
        successful.slice(0, 5).forEach(payment => {
          const date = payment.createdAt?.toDate ? payment.createdAt.toDate() : new Date(payment.createdAt);
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          message += `• ${dateStr} - $${payment.amount} USD - ${payment.planId}\n`;
        });
        message += '\n';
      }

      if (pending.length > 0) {
        message += `⏳ *Pending (${pending.length})*\n`;
        pending.slice(0, 3).forEach(payment => {
          const date = payment.createdAt?.toDate ? payment.createdAt.toDate() : new Date(payment.createdAt);
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          message += `• ${dateStr} - $${payment.amount} USD\n`;
        });
        message += '\n';
      }

      const totalSpent = successful.reduce((sum, p) => sum + (p.amount || 0), 0);
      message += `💰 *Total Spent:* $${totalSpent} USD\n`;
      message += `📈 *Total Payments:* ${payments.length}\n`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '📄 Download Receipt', callback_data: 'view_receipts' }],
          [{ text: '📧 Email History', callback_data: 'email_payment_history' }],
        ],
      };

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (error) {
      logger.error('Error showing payment history:', error);
      await ctx.reply('❌ Error loading payment history. Please try again later.');
    }
  });

  /**
   * View receipts list
   */
  bot.action('view_receipts', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const userId = ctx.from.id;
      const payments = await PaymentService.getPaymentHistory(userId);
      const successful = payments.filter(p => p.status === 'success');

      if (successful.length === 0) {
        await ctx.editMessageText('No receipts available. Complete a payment first.');
        return;
      }

      let message = '📄 *Available Receipts*\n\n';
      message += 'Select a payment to download receipt:\n\n';

      const keyboard = successful.slice(0, 10).map(payment => {
        const date = payment.createdAt?.toDate ? payment.createdAt.toDate() : new Date(payment.createdAt);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return [{
          text: `${dateStr} - $${payment.amount} USD`,
          callback_data: `receipt:${payment.id}`,
        }];
      });

      keyboard.push([{ text: '« Back', callback_data: 'back_to_menu' }]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      logger.error('Error showing receipts:', error);
      await ctx.answerCbQuery('Error loading receipts');
    }
  });

  /**
   * Download specific receipt
   */
  bot.action(/^receipt:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery('Generating receipt...');

      const paymentId = ctx.match[1];
      const receipt = await PaymentService.generateReceipt(paymentId);

      if (!receipt) {
        await ctx.reply('❌ Receipt not found.');
        return;
      }

      const message =
        '🧾 *Payment Receipt*\n\n' +
        `📅 Date: ${receipt.date}\n` +
        `💳 Transaction ID: ${receipt.transactionId}\n` +
        `📦 Item: ${receipt.itemName}\n` +
        `💰 Amount: $${receipt.amount} USD\n` +
        `🔗 Network: ${receipt.network || 'N/A'}\n` +
        `🪙 Token: ${receipt.token || 'N/A'}\n` +
        `✅ Status: Paid\n\n` +
        `Thank you for your payment! 🙏`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

      // Log receipt generation
      logger.info('Receipt generated', {
        paymentId,
        userId: ctx.from.id,
      });
    } catch (error) {
      logger.error('Error generating receipt:', error);
      await ctx.reply('❌ Error generating receipt. Please try again.');
    }
  });

  /**
   * Email payment history (placeholder for future implementation)
   */
  bot.action('email_payment_history', async (ctx) => {
    try {
      await ctx.answerCbQuery('Coming soon! 📧');
      await ctx.reply(
        '📧 *Email Payment History*\n\n' +
        'This feature is coming soon! You will be able to receive your complete payment history via email.\n\n' +
        'Stay tuned! 🎉',
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error with email history:', error);
    }
  });

  logger.info('Payment history handlers registered');
}

module.exports = registerPaymentHistoryHandlers;
