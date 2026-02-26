const ModelManagementModel = require('../../../models/modelManagementModel');
const logger = require('../../../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Admin Model Management Handler
 * Complete admin interface for managing models, pricing, availability, and status
 */

const registerModelManagementHandlers = (bot) => {
  /**
   * Main models management menu
   */
  bot.action('admin_models', async (ctx) => {
    try {
      const keyboard = [
        [{
          text: '➕ Add New Model',
          callback_data: 'add_model'
        }],
        [{
          text: '📋 View All Models',
          callback_data: 'view_models_list'
        }],
        [{
          text: '⚙️ Model Settings',
          callback_data: 'model_settings'
        }],
        [{
          text: '📊 Bookings & Earnings',
          callback_data: 'admin_earnings'
        }],
        [{
          text: '🔙 Back',
          callback_data: 'admin_main_menu'
        }]
      ];

      await ctx.editMessageText(
        '👥 **Models Management**\n\n' +
        'Manage all private call models and their settings.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in admin_models:', error);
      ctx.answerCbQuery('Error', true);
    }
  });

  /**
   * Add new model - Step 1: Username
   */
  bot.action('add_model', async (ctx) => {
    try {
      ctx.session.newModel = {};
      ctx.session.addModelStep = 'username';

      await ctx.editMessageText(
        '📛 **Add New Model**\n\n' +
        'Step 1/7: Enter the model\'s Telegram username:\n\n' +
        '_Example: @modelusername_',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{
              text: '❌ Cancel',
              callback_data: 'admin_models'
            }]]
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in add_model:', error);
      ctx.answerCbQuery('Error', true);
    }
  });

  /**
   * Handle text input for model creation
   */
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (!ctx.session.addModelStep) return next();

      const step = ctx.session.addModelStep;
      const text = ctx.message.text.trim();

      switch (step) {
        case 'username':
          ctx.session.newModel.username = text.replace('@', '');
          ctx.session.addModelStep = 'display_name';
          await ctx.reply(
            '📝 **Step 2/7: Display Name**\n\n' +
            'Enter the display name for the model:\n\n' +
            '_Example: Maria Garcia_',
            { parse_mode: 'Markdown' }
          );
          break;

        case 'display_name':
          ctx.session.newModel.display_name = text;
          ctx.session.addModelStep = 'bio';
          await ctx.reply(
            '📄 **Step 3/7: Bio/Description**\n\n' +
            'Enter a short bio (max 200 characters):\n\n' +
            '_Example: Friendly, fun conversations. Love meeting new people!_',
            { parse_mode: 'Markdown' }
          );
          break;

        case 'bio':
          ctx.session.newModel.bio = text.substring(0, 200);
          ctx.session.addModelStep = 'price';
          await ctx.reply(
            '💰 **Step 4/7: Price Per Minute**\n\n' +
            'Enter the price in USD (e.g., 5.00 for $5 per minute):\n\n' +
            '_Example: 5.00_',
            { parse_mode: 'Markdown' }
          );
          break;

        case 'price':
          const price = parseFloat(text);
          if (isNaN(price) || price <= 0) {
            return await ctx.reply('❌ Please enter a valid price (e.g., 5.00)');
          }
          ctx.session.newModel.price_per_minute = price;
          ctx.session.addModelStep = 'duration';
          await ctx.reply(
            '⏱️ **Step 5/7: Duration Range**\n\n' +
            'Enter min and max duration in minutes (e.g., 15 120):\n\n' +
            '_Example: 15 120_',
            { parse_mode: 'Markdown' }
          );
          break;

        case 'duration':
          const [minDur, maxDur] = text.split(' ').map(x => parseInt(x));
          if (!minDur || !maxDur || minDur <= 0 || maxDur <= minDur) {
            return await ctx.reply('❌ Please enter valid durations (e.g., 15 120)');
          }
          ctx.session.newModel.min_duration_minutes = minDur;
          ctx.session.newModel.max_duration_minutes = maxDur;
          ctx.session.addModelStep = 'photo';
          await ctx.reply(
            '📸 **Step 6/7: Profile Photo**\n\n' +
            'Send a profile photo for the model:',
            { parse_mode: 'Markdown' }
          );
          break;
      }
    } catch (error) {
      logger.error('Error in text handler for model creation:', error);
    }
  });

  /**
   * Handle photo upload
   */
  bot.on('photo', async (ctx, next) => {
    try {
      if (ctx.session.addModelStep !== 'photo') return next();

      const file_id = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      const file_path = await ctx.telegram.getFile(file_id);
      const download_url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file_path.file_path}`;

      ctx.session.newModel.photo_url = download_url;
      ctx.session.addModelStep = 'availability';

      const keyboard = [
        [{ text: 'Monday', callback_data: 'avail_mon' }],
        [{ text: 'Tuesday', callback_data: 'avail_tue' }],
        [{ text: 'Wednesday', callback_data: 'avail_wed' }],
        [{ text: 'Thursday', callback_data: 'avail_thu' }],
        [{ text: 'Friday', callback_data: 'avail_fri' }],
        [{ text: 'Saturday', callback_data: 'avail_sat' }],
        [{ text: 'Sunday', callback_data: 'avail_sun' }],
        [{ text: 'Done with availability', callback_data: 'avail_done' }]
      ];

      await ctx.reply(
        '📅 **Step 7/7: Weekly Availability**\n\n' +
        'Select days when the model is available:\n\n' +
        '_You can add specific times after creating the model_',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
    } catch (error) {
      logger.error('Error handling photo upload:', error);
      ctx.reply('❌ Error uploading photo');
    }
  });

  /**
   * Handle availability day selection
   */
  bot.action(/^avail_(\w+)$/, async (ctx) => {
    try {
      const day = ctx.match[1];
      const dayMap = {
        'mon': { num: 1, name: 'Monday' },
        'tue': { num: 2, name: 'Tuesday' },
        'wed': { num: 3, name: 'Wednesday' },
        'thu': { num: 4, name: 'Thursday' },
        'fri': { num: 5, name: 'Friday' },
        'sat': { num: 6, name: 'Saturday' },
        'sun': { num: 0, name: 'Sunday' }
      };

      if (!ctx.session.newModel.availability) {
        ctx.session.newModel.availability = [];
      }

      ctx.session.newModel.availability.push(dayMap[day]);
      ctx.answerCbQuery(`✅ ${dayMap[day].name} added`);
    } catch (error) {
      logger.error('Error in avail selection:', error);
      ctx.answerCbQuery('Error', true);
    }
  });

  /**
   * Finish model creation
   */
  bot.action('avail_done', async (ctx) => {
    try {
      const newModel = ctx.session.newModel;

      if (!newModel.username || !newModel.display_name || !newModel.price_per_minute) {
        return ctx.answerCbQuery('❌ Missing required fields', true);
      }

      // Save model to database
      const created = await ModelManagementModel.createModel({
        model_id: ctx.from.id, // Using admin ID for now - should be actual model ID
        username: newModel.username,
        display_name: newModel.display_name,
        bio: newModel.bio,
        photo_url: newModel.photo_url,
        price_per_minute: newModel.price_per_minute,
        min_duration_minutes: newModel.min_duration_minutes,
        max_duration_minutes: newModel.max_duration_minutes
      });

      // Set availability
      if (newModel.availability && newModel.availability.length > 0) {
        for (const avail of newModel.availability) {
          await ModelManagementModel.setAvailability(
            created.model_id,
            avail.num,
            '09:00', // Default 9 AM
            '22:00'  // Default 10 PM
          );
        }
      }

      ctx.session.newModel = null;
      ctx.session.addModelStep = null;

      await ctx.reply(
        `✅ **Model Added Successfully!**\n\n` +
        `📛 **${created.display_name}**\n` +
        `💰 Price: $${created.price_per_minute}/min\n\n` +
        `You can now edit availability and manage this model.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{
              text: 'View Models',
              callback_data: 'view_models_list'
            }]]
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in avail_done:', error);
      ctx.answerCbQuery('Error creating model', true);
    }
  });

  /**
   * View all models list
   */
  bot.action('view_models_list', async (ctx) => {
    try {
      const models = await ModelManagementModel.getAllModels(false);

      if (models.length === 0) {
        return ctx.answerCbQuery('No models yet', true);
      }

      const keyboard = models.map(m => [{
        text: `${m.display_name} (${m.status}) - $${m.price_per_minute}/min`,
        callback_data: `edit_model:${m.model_id}`
      }]);

      keyboard.push([{
        text: '🔙 Back',
        callback_data: 'admin_models'
      }]);

      await ctx.editMessageText(
        '📋 **All Models**\n\n' +
        'Click on a model to edit:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in view_models_list:', error);
      ctx.answerCbQuery('Error', true);
    }
  });

  /**
   * Edit model
   */
  bot.action(/^edit_model:(.+)$/, async (ctx) => {
    try {
      const model_id = BigInt(ctx.match[1]);
      const model = await ModelManagementModel.getModelDetails(model_id);
      const availability = await ModelManagementModel.getAvailability(model_id);

      if (!model) {
        return ctx.answerCbQuery('Model not found', true);
      }

      ctx.session.editingModelId = model_id;

      const availText = availability.length > 0
        ? availability.map(a => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][a.day_of_week]}: ${a.start_time}-${a.end_time}`).join('\n')
        : 'No availability set';

      const keyboard = [
        [{
          text: `${model.status === 'online' ? '🟢' : model.status === 'busy' ? '🟡' : '⚪'} Toggle Status`,
          callback_data: `toggle_model_status:${model_id}`
        }],
        [{
          text: '⏱️ Set Availability',
          callback_data: `set_availability:${model_id}`
        }],
        [{
          text: '💰 Change Price',
          callback_data: `change_price:${model_id}`
        }],
        [{
          text: '📸 Add Photos',
          callback_data: `add_model_photos:${model_id}`
        }],
        [{
          text: '🗑️ Deactivate',
          callback_data: `deactivate_model:${model_id}`
        }],
        [{
          text: '🔙 Back',
          callback_data: 'view_models_list'
        }]
      ];

      await ctx.editMessageText(
        `👤 **${model.display_name}**\n\n` +
        `💰 Price: $${model.price_per_minute}/min\n` +
        `⏱️ Duration: ${model.min_duration_minutes}-${model.max_duration_minutes} min\n` +
        `Status: ${model.status}\n\n` +
        `📅 **Availability:**\n${availText}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in edit_model:', error);
      ctx.answerCbQuery('Error', true);
    }
  });

  /**
   * Toggle model online/offline/busy status
   */
  bot.action(/^toggle_model_status:(.+)$/, async (ctx) => {
    try {
      const model_id = BigInt(ctx.match[1]);
      const current = await ModelManagementModel.getModelStatus(model_id);

      let newStatus;
      if (current.status === 'offline') {
        newStatus = 'online';
      } else if (current.status === 'online') {
        newStatus = 'busy';
      } else {
        newStatus = 'offline';
      }

      await ModelManagementModel.updateModelStatus(model_id, newStatus);

      const statusEmoji = newStatus === 'online' ? '🟢' : newStatus === 'busy' ? '🟡' : '⚪';
      ctx.answerCbQuery(`✅ Status changed to ${statusEmoji} ${newStatus}`);

      // Refresh the model edit view
      const action = `edit_model:${model_id}`;
      ctx.match = [`${action}`, `${model_id}`];
      ctx.callbackQuery.data = action;
      return bot.action(/^edit_model:(.+)$/, async (ctx) => {
        const m_id = BigInt(ctx.match[1]);
        const model = await ModelManagementModel.getModelDetails(m_id);
        const availability = await ModelManagementModel.getAvailability(m_id);

        const availText = availability.length > 0
          ? availability.map(a => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][a.day_of_week]}: ${a.start_time}-${a.end_time}`).join('\n')
          : 'No availability set';

        const keyboard = [
          [{
            text: `${model.status === 'online' ? '🟢' : model.status === 'busy' ? '🟡' : '⚪'} Toggle Status`,
            callback_data: `toggle_model_status:${m_id}`
          }],
          [{
            text: '⏱️ Set Availability',
            callback_data: `set_availability:${m_id}`
          }],
          [{
            text: '💰 Change Price',
            callback_data: `change_price:${m_id}`
          }],
          [{
            text: '📸 Add Photos',
            callback_data: `add_model_photos:${m_id}`
          }],
          [{
            text: '🗑️ Deactivate',
            callback_data: `deactivate_model:${m_id}`
          }],
          [{
            text: '🔙 Back',
            callback_data: 'view_models_list'
          }]
        ];

        await ctx.editMessageText(
          `👤 **${model.display_name}**\n\n` +
          `💰 Price: $${model.price_per_minute}/min\n` +
          `⏱️ Duration: ${model.min_duration_minutes}-${model.max_duration_minutes} min\n` +
          `Status: ${statusEmoji} ${model.status}\n\n` +
          `📅 **Availability:**\n${availText}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: keyboard
            }
          }
        );
      })(ctx);
    } catch (error) {
      logger.error('Error toggling status:', error);
      ctx.answerCbQuery('Error', true);
    }
  });

  /**
   * Set availability times
   */
  bot.action(/^set_availability:(.+)$/, async (ctx) => {
    try {
      const model_id = BigInt(ctx.match[1]);

      ctx.session.editingModelId = model_id;
      ctx.session.availStep = 'select_day';

      const keyboard = [
        [{ text: 'Monday', callback_data: 'avail_set_mon' }],
        [{ text: 'Tuesday', callback_data: 'avail_set_tue' }],
        [{ text: 'Wednesday', callback_data: 'avail_set_wed' }],
        [{ text: 'Thursday', callback_data: 'avail_set_thu' }],
        [{ text: 'Friday', callback_data: 'avail_set_fri' }],
        [{ text: 'Saturday', callback_data: 'avail_set_sat' }],
        [{ text: 'Sunday', callback_data: 'avail_set_sun' }],
        [{ text: '🔙 Back', callback_data: `edit_model:${model_id}` }]
      ];

      await ctx.editMessageText(
        '📅 **Set Weekly Availability**\n\n' +
        'Select a day to set availability hours:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in set_availability:', error);
      ctx.answerCbQuery('Error', true);
    }
  });

  /**
   * Deactivate model
   */
  bot.action(/^deactivate_model:(.+)$/, async (ctx) => {
    try {
      const model_id = BigInt(ctx.match[1]);

      await ModelManagementModel.updateModel(model_id, { is_active: false });
      await ModelManagementModel.updateModelStatus(model_id, 'offline');

      ctx.answerCbQuery('✅ Model deactivated');

      await ctx.editMessageText(
        '✅ **Model Deactivated**\n\n' +
        'The model is now hidden from the booking list.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{
              text: 'View Models',
              callback_data: 'view_models_list'
            }]]
          }
        }
      );
    } catch (error) {
      logger.error('Error deactivating model:', error);
      ctx.answerCbQuery('Error', true);
    }
  });
};

module.exports = registerModelManagementHandlers;
