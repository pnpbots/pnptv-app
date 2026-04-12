/**
 * Model Self-Service Handler
 * Allows models to manage their own profiles, availability, and settings
 */

const ModelService = require('../../../services/modelService');
const ComprehensiveAvailabilityService = require('../../../services/comprehensiveAvailabilityService');
const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');

/**
 * Register model self-service handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerModelSelfServiceHandlers = (bot) => {
  
  /**
   * Model dashboard - Main menu for model self-service
   */
  bot.command('modelo', async (ctx) => {
    try {
      // Check if user is a model
      const userId = ctx.from.id;
      const model = await ModelService.getModelByUserId(userId);
      
      if (!model) {
        const lang = getLanguage(ctx);
        await ctx.reply(lang === 'es' 
          ? '🔒 Solo los modelos pueden usar este comando.'
          : '🔒 Only models can use this command.');
        return;
      }

      // Show model dashboard
      await showModelDashboard(ctx, model);
      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in /modelo command:', error);
      await ctx.reply('An error occurred. Please try again.');
    }
  });

  /**
   * Show model dashboard
   */
  async function showModelDashboard(ctx, model) {
    const lang = getLanguage(ctx);
    const isOnline = model.is_online || false;
    
    // Get availability statistics
    const stats = await ComprehensiveAvailabilityService.getModelAvailabilitySettings(model.id);
    
    const keyboard = [
      [{
        text: isOnline ? '🟢 Online' : '🔴 Offline',
        callback_data: `model_toggle_online_${model.id}`
      }],
      [{
        text: lang === 'es' ? '📝 Editar Perfil' : '📝 Edit Profile',
        callback_data: `model_edit_profile_${model.id}`
      }],
      [{
        text: lang === 'es' ? '📅 Mi Disponibilidad' : '📅 My Availability',
        callback_data: `model_availability_${model.id}`
      }],
      [{
        text: lang === 'es' ? '💰 Mis Reservas' : '💰 My Bookings',
        callback_data: `model_bookings_${model.id}`
      }],
      [{
        text: lang === 'es' ? '⚙️ Configuración' : '⚙️ Settings',
        callback_data: `model_settings_${model.id}`
      }],
      [{
        text: lang === 'es' ? '◀️ Volver' : '◀️ Back',
        callback_data: 'main_menu'
      }]
    ];

    const message = lang === 'es'
      ? `👑 *Panel de Modelo - ${model.name}*\n\n` +
        `📛 *Usuario:* @${model.username}\n\n` +
        `📊 *Disponibilidad:*\n` +
        `• ${stats.statistics.availableSlots} slots disponibles\n` +
        `• ${stats.statistics.bookedSlots} slots reservados\n` +
        `• Tasa de ocupación: ${stats.statistics.utilizationRate}%\n\n` +
        `💃 *Estado:* ${isOnline ? '🟢 En línea' : '🔴 Fuera de línea'}`
      : `👑 *Model Dashboard - ${model.name}*\n\n` +
        `📛 *Username:* @${model.username}\n\n` +
        `📊 *Availability:*\n` +
        `• ${stats.statistics.availableSlots} available slots\n` +
        `• ${stats.statistics.bookedSlots} booked slots\n` +
        `• Utilization: ${stats.statistics.utilizationRate}%\n\n` +
        `💃 *Status:* ${isOnline ? '🟢 Online' : '🔴 Offline'}`;

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  /**
   * Toggle model online/offline status
   */
  bot.action(/^model_toggle_online_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const modelId = parseInt(ctx.match[1]);
      const userId = ctx.from.id;
      
      // Verify user is the model
      const model = await ModelService.getModelByUserId(userId);
      if (!model || model.id !== modelId) {
        await ctx.reply('❌ Unauthorized access.');
        return;
      }

      // Toggle online status
      const newStatus = !model.is_online;
      const result = await ModelService.updateModelStatus(modelId, newStatus);

      if (result.success) {
        const lang = getLanguage(ctx);
        await ctx.reply(lang === 'es'
          ? `🟢 Estado actualizado: ${newStatus ? 'En línea' : 'Fuera de línea'}`
          : `🟢 Status updated: ${newStatus ? 'Online' : 'Offline'}`);
        
        // Show updated dashboard
        await showModelDashboard(ctx, { ...model, is_online: newStatus });
      } else {
        await ctx.reply('❌ Failed to update status.');
      }
    } catch (error) {
      logger.error('Error toggling model status:', error);
      await ctx.reply('An error occurred.');
    }
  });

  /**
   * Edit model profile
   */
  bot.action(/^model_edit_profile_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const modelId = parseInt(ctx.match[1]);
      const userId = ctx.from.id;
      
      // Verify user is the model
      const model = await ModelService.getModelByUserId(userId);
      if (!model || model.id !== modelId) {
        await ctx.reply('❌ Unauthorized access.');
        return;
      }

      // Store in session for multi-step edit
      ctx.session.editModel = {
        modelId: model.id,
        currentData: model
      };
      
      await showEditProfileMenu(ctx, model);
    } catch (error) {
      logger.error('Error in model edit profile:', error);
      await ctx.reply('An error occurred.');
    }
  });

  /**
   * Show edit profile menu
   */
  async function showEditProfileMenu(ctx, model) {
    const lang = getLanguage(ctx);
    
    const keyboard = [
      [{
        text: lang === 'es' ? '📝 Nombre' : '📝 Name',
        callback_data: 'edit_model_name'
      }],
      [{
        text: lang === 'es' ? '📛 Usuario' : '📛 Username',
        callback_data: 'edit_model_username'
      }],
      [{
        text: lang === 'es' ? '📄 Biografía' : '📄 Bio',
        callback_data: 'edit_model_bio'
      }],
      [{
        text: lang === 'es' ? '🖼️ Foto de Perfil' : '🖼️ Profile Photo',
        callback_data: 'edit_model_photo'
      }],
      [{
        text: lang === 'es' ? '💰 Precios' : '💰 Pricing',
        callback_data: 'edit_model_pricing'
      }],
      [{
        text: lang === 'es' ? '◀️ Volver' : '◀️ Back',
        callback_data: `model_dashboard_${model.id}`
      }]
    ];

    const message = lang === 'es'
      ? `📝 *Editar Perfil*\n\n` +
        `Selecciona qué deseas editar:`
      : `📝 *Edit Profile*\n\n` +
        `Select what you want to edit:`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  /**
   * Manage model availability
   */
  bot.action(/^model_availability_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const modelId = parseInt(ctx.match[1]);
      const userId = ctx.from.id;
      
      // Verify user is the model
      const model = await ModelService.getModelByUserId(userId);
      if (!model || model.id !== modelId) {
        await ctx.reply('❌ Unauthorized access.');
        return;
      }

      await showAvailabilityMenu(ctx, model);
    } catch (error) {
      logger.error('Error in model availability:', error);
      await ctx.reply('An error occurred.');
    }
  });

  /**
   * Show availability management menu
   */
  async function showAvailabilityMenu(ctx, model) {
    const lang = getLanguage(ctx);
    const stats = await ComprehensiveAvailabilityService.getModelAvailabilitySettings(model.id);
    
    const keyboard = [
      [{
        text: lang === 'es' ? '⏰ Horarios Recurrentes' : '⏰ Recurring Schedules',
        callback_data: `model_schedules_${model.id}`
      }],
      [{
        text: lang === 'es' ? '📅 Fechas Bloqueadas' : '📅 Blocked Dates',
        callback_data: `model_blocked_dates_${model.id}`
      }],
      [{
        text: lang === 'es' ? '🔄 Generar Disponibilidad' : '🔄 Generate Availability',
        callback_data: `model_generate_availability_${model.id}`
      }],
      [{
        text: lang === 'es' ? '📊 Estadísticas' : '📊 Statistics',
        callback_data: `model_availability_stats_${model.id}`
      }],
      [{
        text: lang === 'es' ? '◀️ Volver' : '◀️ Back',
        callback_data: `model_dashboard_${model.id}`
      }]
    ];

    const nextSlot = stats.statistics.nextAvailableSlot
      ? new Date(stats.statistics.nextAvailableSlot.available_from).toLocaleString()
      : 'None';

    const message = lang === 'es'
      ? `📅 *Gestión de Disponibilidad*\n\n` +
        `📊 *Resumen:*\n` +
        `• ${stats.statistics.totalManualSlots} slots manuales\n` +
        `• ${stats.statistics.totalRecurringSlots} horarios recurrentes\n` +
        `• ${stats.statistics.bookedSlots} slots reservados\n` +
        `• ${stats.statistics.availableSlots} slots disponibles\n` +
        `• Próximo slot: ${nextSlot}`
      : `📅 *Availability Management*\n\n` +
        `📊 *Summary:*\n` +
        `• ${stats.statistics.totalManualSlots} manual slots\n` +
        `• ${stats.statistics.totalRecurringSlots} recurring schedules\n` +
        `• ${stats.statistics.bookedSlots} booked slots\n` +
        `• ${stats.statistics.availableSlots} available slots\n` +
        `• Next slot: ${nextSlot}`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  /**
   * Manage recurring schedules
   */
  bot.action(/^model_schedules_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const modelId = parseInt(ctx.match[1]);
      const userId = ctx.from.id;
      
      // Verify user is the model
      const model = await ModelService.getModelByUserId(userId);
      if (!model || model.id !== modelId) {
        await ctx.reply('❌ Unauthorized access.');
        return;
      }

      // Store model ID in session
      ctx.session.manageModelId = modelId;
      
      await showRecurringSchedules(ctx, model);
    } catch (error) {
      logger.error('Error in model schedules:', error);
      await ctx.reply('An error occurred.');
    }
  });

  /**
   * Show recurring schedules
   */
  async function showRecurringSchedules(ctx, model) {
    const lang = getLanguage(ctx);
    const settings = await ComprehensiveAvailabilityService.getModelAvailabilitySettings(model.id);
    
    const keyboard = [
      [{
        text: lang === 'es' ? '➕ Añadir Horario' : '➕ Add Schedule',
        callback_data: 'add_recurring_schedule'
      }],
      [{
        text: lang === 'es' ? '📝 Ver Horarios' : '📝 View Schedules',
        callback_data: 'view_recurring_schedules'
      }],
      [{
        text: lang === 'es' ? '◀️ Volver' : '◀️ Back',
        callback_data: `model_availability_${model.id}`
      }]
    ];

    const schedules = settings.recurringSchedules;
    const scheduleList = schedules.length > 0
      ? schedules.map(s => `
• ${getDayName(s.day_of_week, lang)}: ${s.start_time} - ${s.end_time}`).join('')
      : lang === 'es' ? '\n*No hay horarios recurrentes*' : '\n*No recurring schedules*';

    const message = lang === 'es'
      ? `⏰ *Horarios Recurrentes*\n\n` +
        `📋 *Horarios actuales:*${scheduleList}\n\n` +
        `💡 *Consejo:* Los horarios recurrentes generan automáticamente slots de disponibilidad.`
      : `⏰ *Recurring Schedules*\n\n` +
        `📋 *Current schedules:*${scheduleList}\n\n` +
        `💡 *Tip:* Recurring schedules automatically generate availability slots.`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  /**
   * Helper: Get day name
   */
  function getDayName(dayOfWeek, lang) {
    const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysEs = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    
    return lang === 'es' ? daysEs[dayOfWeek] : daysEn[dayOfWeek];
  }

  /**
   * View model bookings
   */
  bot.action(/^model_bookings_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const modelId = parseInt(ctx.match[1]);
      const userId = ctx.from.id;
      
      // Verify user is the model
      const model = await ModelService.getModelByUserId(userId);
      if (!model || model.id !== modelId) {
        await ctx.reply('❌ Unauthorized access.');
        return;
      }

      await showModelBookings(ctx, model);
    } catch (error) {
      logger.error('Error in model bookings:', error);
      await ctx.reply('An error occurred.');
    }
  });

  /**
   * Show model bookings
   */
  async function showModelBookings(ctx, model) {
    const lang = getLanguage(ctx);
    
    // This would integrate with the booking system
    // For now, show placeholder
    const keyboard = [
      [{
        text: lang === 'es' ? '📅 Próximas' : '📅 Upcoming',
        callback_data: 'model_upcoming_bookings'
      }],
      [{
        text: lang === 'es' ? '💰 Historial' : '💰 History',
        callback_data: 'model_booking_history'
      }],
      [{
        text: lang === 'es' ? '◀️ Volver' : '◀️ Back',
        callback_data: `model_dashboard_${model.id}`
      }]
    ];

    const message = lang === 'es'
      ? `💰 *Mis Reservas*\n\n` +
        `📊 *Funcionalidad próxima:*\n` +
        `• Ver reservas próximas\n` +
        `• Historial de reservas\n` +
        `• Estadísticas de ganancias`
      : `💰 *My Bookings*\n\n` +
        `📊 *Coming soon:*\n` +
        `• View upcoming bookings\n` +
        `• Booking history\n` +
        `• Earnings statistics`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  /**
   * Model settings
   */
  bot.action(/^model_settings_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const modelId = parseInt(ctx.match[1]);
      const userId = ctx.from.id;
      
      // Verify user is the model
      const model = await ModelService.getModelByUserId(userId);
      if (!model || model.id !== modelId) {
        await ctx.reply('❌ Unauthorized access.');
        return;
      }

      await showModelSettings(ctx, model);
    } catch (error) {
      logger.error('Error in model settings:', error);
      await ctx.reply('An error occurred.');
    }
  });

  /**
   * Show model settings
   */
  async function showModelSettings(ctx, model) {
    const lang = getLanguage(ctx);
    
    const keyboard = [
      [{
        text: lang === 'es' ? '🔔 Notificaciones' : '🔔 Notifications',
        callback_data: 'model_notification_settings'
      }],
      [{
        text: lang === 'es' ? '🔒 Privacidad' : '🔒 Privacy',
        callback_data: 'model_privacy_settings'
      }],
      [{
        text: lang === 'es' ? '💰 Pagos' : '💰 Payments',
        callback_data: 'model_payment_settings'
      }],
      [{
        text: lang === 'es' ? '◀️ Volver' : '◀️ Back',
        callback_data: `model_dashboard_${model.id}`
      }]
    ];

    const message = lang === 'es'
      ? `⚙️ *Configuración*\n\n` +
        `📋 *Ajusta la configuración de tu perfil de modelo.`
      : `⚙️ *Settings*\n\n` +
        `📋 *Adjust your model profile settings.`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  /**
   * Return to model dashboard
   */
  bot.action(/^model_dashboard_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      const modelId = parseInt(ctx.match[1]);
      const userId = ctx.from.id;
      
      // Verify user is the model
      const model = await ModelService.getModelByUserId(userId);
      if (!model || model.id !== modelId) {
        await ctx.reply('❌ Unauthorized access.');
        return;
      }

      await showModelDashboard(ctx, model);
    } catch (error) {
      logger.error('Error returning to dashboard:', error);
      await ctx.reply('An error occurred.');
    }
  });
};

// Export the handler
module.exports = {
  registerModelSelfServiceHandlers
};