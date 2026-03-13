const CallPackageModel = require('../../../models/callPackageModel');
const PaymentService = require('../../services/paymentService');
const logger = require('../../../utils/logger');

/**
 * Call Package Handlers - Buy and manage call packages
 */
function registerCallPackageHandlers(bot) {
  /**
   * Show call packages
   */
  bot.command('packages', async (ctx) => {
    try {
      const packages = await CallPackageModel.getAvailablePackages();

      let message = '📦 *Call Packages*\n\n';
      message += 'Save money with our call packages! Buy multiple calls at a discounted rate.\n\n';

      const keyboard = packages.map(pkg => {
        const badge = pkg.popular ? '🔥 ' : '';
        const savings = pkg.savings > 0 ? ` (Save $${pkg.savings})` : '';

        return [{
          text: `${badge}${pkg.name} - $${pkg.price}${savings}`,
          callback_data: `view_package:${pkg.id}`,
        }];
      });

      keyboard.push([{ text: '💳 My Packages', callback_data: 'my_packages' }]);
      keyboard.push([{ text: '« Back', callback_data: 'back_to_main' }]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      logger.error('Error showing call packages:', error);
      await ctx.reply('❌ Error loading packages.');
    }
  });

  /**
   * View package details
   */
  bot.action(/^view_package:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const packageId = ctx.match[1];
      const pkg = await CallPackageModel.getById(packageId);

      if (!pkg) {
        await ctx.reply('❌ Package not found.');
        return;
      }

      const badge = pkg.popular ? '🔥 *MOST POPULAR* 🔥\n\n' : '';

      let message = badge;
      message += `📦 *${pkg.name}*\n\n`;
      message += `💎 *Details:*\n`;
      message += `• Calls Included: ${pkg.calls}\n`;
      message += `• Total Price: $${pkg.price} USD\n`;
      message += `• Price per Call: $${pkg.pricePerCall} USD\n`;

      if (pkg.savings > 0) {
        message += `• 💰 You Save: $${pkg.savings} (${pkg.savingsPercent}% discount)\n`;
      }

      message += `\n📅 *Validity:* ${pkg.calls * 60} days from purchase\n`;
      message += `\n🎯 *Benefits:*\n`;
      message += `• Book calls with any performer\n`;
      message += `• Flexible scheduling\n`;
      message += `• Priority booking\n`;
      message += `• No expiry pressure (generous validity)\n\n`;

      if (pkg.savings > 0) {
        message += `💡 *Compared to single calls:*\n`;
        message += `Regular: ${pkg.calls} × $100 = $${pkg.calls * 100}\n`;
        message += `Package: $${pkg.price}\n`;
        message += `✅ Your savings: $${pkg.savings}\n`;
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Buy This Package', callback_data: `buy_package:${pkg.id}` }],
            [{ text: '« Back to Packages', callback_data: 'back_to_packages' }],
          ],
        },
      });
    } catch (error) {
      logger.error('Error viewing package:', error);
      await ctx.answerCbQuery('Error loading package details');
    }
  });

  /**
   * Buy package
   */
  bot.action(/^buy_package:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery('Processing...');

      const packageId = ctx.match[1];
      const pkg = await CallPackageModel.getById(packageId);

      if (!pkg) {
        await ctx.reply('❌ Package not found.');
        return;
      }

      ctx.session.temp.purchasingPackage = packageId;
      await ctx.saveSession();

      // Create payment for the package
      const result = await PaymentService.createPayment({
        userId: ctx.from.id,
        planId: `call_package_${pkg.calls}calls`,
        provider: 'daimo',
        chatId: ctx.chat.id,
      });

      if (!result.success) {
        await ctx.reply(`❌ Error creating payment: ${result.error}`);
        return;
      }

      await ctx.editMessageText(
        `📦 *${pkg.name}*\n\n` +
        `💰 Total: $${pkg.price} USD\n\n` +
        `Click the button below to complete your payment.\n\n` +
        `📱 You can pay using:\n` +
        `• Zelle\n` +
        `• CashApp\n` +
        `• Venmo\n` +
        `• Revolut\n` +
        `• Wise\n\n` +
        `After payment, you'll receive ${pkg.calls} call credits!`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Pay Now', url: result.paymentUrl }],
              [{ text: '❌ Cancel', callback_data: 'back_to_packages' }],
            ],
          },
        }
      );

      logger.info('Package payment initiated', {
        userId: ctx.from.id,
        packageId,
        paymentId: result.paymentId,
      });
    } catch (error) {
      logger.error('Error buying package:', error);
      await ctx.reply('❌ Error processing package purchase.');
    }
  });

  /**
   * View user's packages
   */
  bot.action('my_packages', async (ctx) => {
    try {
      await ctx.answerCbQuery('Loading your packages...');

      const userId = ctx.from.id;
      const packages = await CallPackageModel.getUserPackages(userId);

      if (!packages || packages.length === 0) {
        await ctx.editMessageText(
          '📦 *My Packages*\n\n' +
          'You don\'t have any active packages.\n\n' +
          'Buy a package to save money on multiple calls!',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📦 View Packages', callback_data: 'back_to_packages' }],
              ],
            },
          }
        );
        return;
      }

      let message = '📦 *My Call Packages*\n\n';

      packages.forEach((pkg, index) => {
        const expiresAt = pkg.expiresAt.toDate ? pkg.expiresAt.toDate() : new Date(pkg.expiresAt);
        const daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));

        message += `${index + 1}. *${pkg.packageName}*\n`;
        message += `   • Remaining: ${pkg.remainingCalls}/${pkg.totalCalls} calls\n`;
        message += `   • Expires: ${daysLeft} days\n\n`;
      });

      const totalCalls = packages.reduce((sum, p) => sum + p.remainingCalls, 0);
      message += `✨ Total Available Calls: ${totalCalls}\n\n`;
      message += `💡 Use your credits when booking your next call!`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📞 Book Call on Web', url: 'https://pnptv.app/book-call' }],
            [{ text: '📦 Buy More', callback_data: 'back_to_packages' }],
          ],
        },
      });
    } catch (error) {
      logger.error('Error showing user packages:', error);
      await ctx.answerCbQuery('Error loading packages');
    }
  });

  /**
   * Back to packages list
   */
  bot.action('back_to_packages', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const packages = await CallPackageModel.getAvailablePackages();

      let message = '📦 *Call Packages*\n\n';
      message += 'Save money with our call packages! Buy multiple calls at a discounted rate.\n\n';

      const keyboard = packages.map(pkg => {
        const badge = pkg.popular ? '🔥 ' : '';
        const savings = pkg.savings > 0 ? ` (Save $${pkg.savings})` : '';

        return [{
          text: `${badge}${pkg.name} - $${pkg.price}${savings}`,
          callback_data: `view_package:${pkg.id}`,
        }];
      });

      keyboard.push([{ text: '💳 My Packages', callback_data: 'my_packages' }]);
      keyboard.push([{ text: '« Back', callback_data: 'back_to_main' }]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      logger.error('Error returning to packages:', error);
    }
  });

  logger.info('Call package handlers registered');
}

module.exports = registerCallPackageHandlers;
