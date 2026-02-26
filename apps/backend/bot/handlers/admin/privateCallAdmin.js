const { Markup } = require('telegraf');
const PrivateCallService = require('../../services/privateCallService');
const PerformerModel = require('../../../models/performerModel');
const CallModel = require('../../../models/callModel');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const PermissionService = require('../../services/permissionService');

/**
 * Private Call Admin Handlers - Admin dashboard for monitoring private calls
 * @param {Telegraf} bot - Bot instance
 */
const registerPrivateCallAdminHandlers = (bot) => {
  
  // =====================================================
  // ACCESS CONTROL
  // =====================================================
  
  /**
   * Check if user is admin
   */
  const checkAdminAccess = async (ctx) => {
    try {
      const userId = ctx.from.id;
      const isAdmin = await PermissionService.isAdmin(userId);
      const isSuperAdmin = await PermissionService.isSuperAdmin(userId);
      
      if (!isAdmin && !isSuperAdmin) {
        const lang = getLanguage(ctx);
        await ctx.answerCbQuery(
          lang === 'es' 
            ? '❌ Acceso denegado. Solo para administradores.'
            : '❌ Access denied. Admins only.',
          { show_alert: true }
        );
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Error checking admin access:', error);
      return false;
    }
  };

  // =====================================================
  // ADMIN DASHBOARD
  // =====================================================

  // Admin panel - Private Calls section
  bot.action('admin_private_calls', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      // Get statistics
      const stats = await PrivateCallService.getStatistics();
      
      const dashboardText = lang === 'es'
        ? `📊 *Panel de Control - Llamadas Privadas*

📞 *Estadísticas Generales:*
• Total de llamadas: ${stats.total}
• Pendientes: ${stats.pending}
• Confirmadas: ${stats.confirmed}
• Completadas: ${stats.completed}
• Canceladas: ${stats.cancelled}
• Ingresos: $${stats.revenue.toFixed(2)} USD

🎭 *Acciones Rápidas:*`
        : `📊 *Admin Dashboard - Private Calls*

📞 *General Statistics:*
• Total Calls: ${stats.total}
• Pending: ${stats.pending}
• Confirmed: ${stats.confirmed}
• Completed: ${stats.completed}
• Cancelled: ${stats.cancelled}
• Revenue: $${stats.revenue.toFixed(2)} USD

🎭 *Quick Actions:*`;
      
      const buttons = [
        [Markup.button.callback(lang === 'es' ? '📅 Ver Todas las Llamadas' : '📅 View All Calls', 'admin_view_all_calls')],
        [Markup.button.callback(lang === 'es' ? '👥 Gestionar Performers' : '👥 Manage Performers', 'admin_manage_performers')],
        [Markup.button.callback(lang === 'es' ? '📈 Estadísticas Detalladas' : '📈 Detailed Statistics', 'admin_detailed_stats')],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_home')],
      ];
      
      await ctx.editMessageText(dashboardText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing admin private calls dashboard:', error);
    }
  });

  // View all calls
  bot.action('admin_view_all_calls', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      // Get all calls (limited to 20 for display)
      const allCalls = await CallModel.getAll();
      const recentCalls = allCalls.slice(0, 20);
      
      let callsText = lang === 'es'
        ? `📋 *Todas las Llamadas Privadas*

*Últimas ${recentCalls.length} llamadas:*\n\n`
        : `📋 *All Private Calls*

*Last ${recentCalls.length} calls:*\n\n`;
      
      recentCalls.forEach((call, index) => {
        const statusEmoji = {
          pending: '⏳',
          confirmed: '✅',
          active: '🟢',
          completed: '✔️',
          cancelled: '❌',
        }[call.status] || '📞';
        
        callsText += `${index + 1}. ${statusEmoji} *${call.status.toUpperCase()}*
` +
          `   📅 ${call.scheduled_date} ${call.scheduled_time}
` +
          `   👤 ${call.user_name} → 🎭 ${call.performer}
` +
          `   ⏱ ${call.duration} min | $${call.amount}
` +
          `   🔗 ${call.meeting_url || 'N/A'}
\n`;
      });
      
      const buttons = [
        [Markup.button.callback(lang === 'es' ? '📅 Exportar CSV' : '📅 Export CSV', 'admin_export_calls')],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_private_calls')],
      ];
      
      await ctx.editMessageText(callsText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error viewing all calls:', error);
    }
  });

  // Manage performers
  bot.action('admin_manage_performers', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      // Get all performers
      const performers = await PerformerModel.getAll();
      
      let performersText = lang === 'es'
        ? `🎭 *Gestionar Performers*

*Total: ${performers.length} performers*\n\n`
        : `🎭 *Manage Performers*

*Total: ${performers.length} performers*\n\n`;
      
      performers.forEach((performer, index) => {
        const statusEmoji = {
          active: '🟢',
          paused: '🟡',
          inactive: '🔴',
        }[performer.status] || '❓';
        
        const availability = performer.is_available ? '🟢 Disponible' : '🔴 No disponible';
        
        performersText += `${index + 1}. ${statusEmoji} *${performer.display_name}*
` +
          `   💰 $${performer.base_price}/hr | ⭐ ${performer.total_rating || 0.0}
` +
          `   ${availability}
` +
          `   📅 ${performer.total_calls || 0} llamadas
\n`;
      });
      
      const buttons = [];
      
      // Add buttons for each performer (first 5)
      performers.slice(0, 5).forEach(performer => {
        buttons.push([
          Markup.button.callback(`👤 ${performer.display_name}`, `admin_performer_${performer.id}`)
        ]);
      });
      
      buttons.push([
        Markup.button.callback(lang === 'es' ? '➕ Añadir Performer' : '➕ Add Performer', 'admin_add_performer'),
      ]);
      
      buttons.push([
        Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_private_calls'),
      ]);
      
      await ctx.editMessageText(performersText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error managing performers:', error);
    }
  });

  // View performer details
  bot.action(/^admin_performer_(.+)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const performerId = ctx.match[1];
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      // Get performer details
      const performer = await PerformerModel.getById(performerId);
      const stats = await PrivateCallService.getPerformerStatistics(performerId);
      
      if (!performer) {
        await ctx.answerCbQuery(
          lang === 'es' ? '❌ Performer no encontrado' : '❌ Performer not found',
          { show_alert: true }
        );
        return;
      }
      
      const performerText = lang === 'es'
        ? `🎭 *Detalles del Performer*

👤 *Nombre:* ${performer.display_name}
💰 *Precio base:* $${performer.base_price}/hr
⭐ *Calificación:* ${stats.averageRating} (${stats.ratingCount} reseñas)
📅 *Llamadas totales:* ${stats.totalCalls}
🕒 *Duración máx:* ${performer.max_call_duration} min
🟢 *Disponible:* ${performer.is_available ? 'Sí' : 'No'}
📋 *Estado:* ${performer.status}

📝 *Bio:*
${performer.bio || 'Sin bio'}

🎯 *Acciones:*`
        : `🎭 *Performer Details*

👤 *Name:* ${performer.display_name}
💰 *Base Price:* $${performer.base_price}/hr
⭐ *Rating:* ${stats.averageRating} (${stats.ratingCount} reviews)
📅 *Total Calls:* ${stats.totalCalls}
🕒 *Max Duration:* ${performer.max_call_duration} min
🟢 *Available:* ${performer.is_available ? 'Yes' : 'No'}
📋 *Status:* ${performer.status}

📝 *Bio:*
${performer.bio || 'No bio'}

🎯 *Actions:*`;
      
      const buttons = [
        [Markup.button.callback(
          performer.is_available 
            ? (lang === 'es' ? '🔴 Desactivar' : '🔴 Deactivate') 
            : (lang === 'es' ? '🟢 Activar' : '🟢 Activate'),
          `admin_toggle_performer_${performer.id}`
        )],
        [Markup.button.callback(lang === 'es' ? '✏️ Editar' : '✏️ Edit', `admin_edit_performer_${performer.id}`)],
        [Markup.button.callback(lang === 'es' ? '📊 Ver Llamadas' : '📊 View Calls', `admin_performer_calls_${performer.id}`)],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_manage_performers')],
      ];
      
      await ctx.editMessageText(performerText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error viewing performer details:', error);
    }
  });

  // Toggle performer availability
  bot.action(/^admin_toggle_performer_(.+)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const performerId = ctx.match[1];
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      // Get current performer
      const performer = await PerformerModel.getById(performerId);
      
      if (!performer) {
        await ctx.answerCbQuery(
          lang === 'es' ? '❌ Performer no encontrado' : '❌ Performer not found',
          { show_alert: true }
        );
        return;
      }
      
      // Toggle availability
      const newAvailability = !performer.is_available;
      
      await PerformerModel.updateAvailability(performerId, newAvailability, 
        newAvailability 
          ? (lang === 'es' ? 'Disponible' : 'Available')
          : (lang === 'es' ? 'No disponible' : 'Not Available')
      );
      
      await ctx.answerCbQuery(
        newAvailability
          ? (lang === 'es' ? '✅ Performer activado' : '✅ Performer activated')
          : (lang === 'es' ? '❌ Performer desactivado' : '❌ Performer deactivated'),
        { show_alert: true }
      );
      
      // Refresh performer details
      ctx.callbackQuery.data = `admin_performer_${performerId}`;
      await bot.handleUpdate(ctx.update);
    } catch (error) {
      logger.error('Error toggling performer availability:', error);
      const lang = getLanguage(ctx);
      await ctx.answerCbQuery(
        lang === 'es' ? '❌ Error al actualizar' : '❌ Update failed',
        { show_alert: true }
      );
    }
  });

  // View performer's calls
  bot.action(/^admin_performer_calls_(.+)$/, async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      const performerId = ctx.match[1];
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      // Get performer calls
      const calls = await CallModel.getByPerformer(performerId);
      const performer = await PerformerModel.getById(performerId);
      
      let callsText = lang === 'es'
        ? `📋 *Llamadas de ${performer.display_name}*

*Total: ${calls.length} llamadas*\n\n`
        : `📋 *${performer.display_name}'s Calls*

*Total: ${calls.length} calls*\n\n`;
      
      calls.slice(0, 10).forEach((call, index) => {
        const statusEmoji = {
          pending: '⏳',
          confirmed: '✅',
          active: '🟢',
          completed: '✔️',
          cancelled: '❌',
        }[call.status] || '📞';
        
        callsText += `${index + 1}. ${statusEmoji} *${call.status.toUpperCase()}*
` +
          `   📅 ${call.scheduled_date} ${call.scheduled_time}
` +
          `   👤 ${call.user_name}
` +
          `   ⏱ ${call.duration} min | $${call.amount}
\n`;
      });
      
      const buttons = [
        [Markup.button.callback(lang === 'es' ? '📅 Exportar' : '📅 Export', `admin_export_performer_calls_${performerId}`)],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', `admin_performer_${performerId}`)],
      ];
      
      await ctx.editMessageText(callsText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error viewing performer calls:', error);
    }
  });

  // Detailed statistics
  bot.action('admin_detailed_stats', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      // Get detailed statistics
      const stats = await PrivateCallService.getStatistics();
      const performers = await PerformerModel.getAll({ status: 'active' });
      
      // Calculate average rating
      let totalRating = 0;
      let totalRatingCount = 0;
      
      for (const performer of performers) {
        const performerStats = await PrivateCallService.getPerformerStatistics(performer.id);
        totalRating += performerStats.averageRating * performerStats.ratingCount;
        totalRatingCount += performerStats.ratingCount;
      }
      
      const averageRating = totalRatingCount > 0 
        ? (totalRating / totalRatingCount).toFixed(2)
        : '0.00';
      
      const detailedStatsText = lang === 'es'
        ? `📊 *Estadísticas Detalladas - Llamadas Privadas*

📈 *Métricas Clave:*
• Total de llamadas: ${stats.total}
• Tasa de completado: ${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
• Tasa de cancelación: ${stats.total > 0 ? Math.round((stats.cancelled / stats.total) * 100) : 0}%
• Ingresos totales: $${stats.revenue.toFixed(2)} USD
• Calificación promedio: ⭐ ${averageRating}

🎭 *Desempeño de Performers:*
• Performers activos: ${performers.length}
• Llamadas por performer: ${stats.total > 0 ? Math.round(stats.total / performers.length) : 0}
• Ingresos por performer: $${stats.revenue > 0 ? (stats.revenue / performers.length).toFixed(2) : '0.00'} USD

📅 *Tendencias:*
• Llamadas pendientes: ${stats.pending}
• Llamadas confirmadas: ${stats.confirmed}
• Llamadas completadas: ${stats.completed}`
        : `📊 *Detailed Statistics - Private Calls*

📈 *Key Metrics:*
• Total Calls: ${stats.total}
• Completion Rate: ${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
• Cancellation Rate: ${stats.total > 0 ? Math.round((stats.cancelled / stats.total) * 100) : 0}%
• Total Revenue: $${stats.revenue.toFixed(2)} USD
• Average Rating: ⭐ ${averageRating}

🎭 *Performer Performance:*
• Active Performers: ${performers.length}
• Calls per Performer: ${stats.total > 0 ? Math.round(stats.total / performers.length) : 0}
• Revenue per Performer: $${stats.revenue > 0 ? (stats.revenue / performers.length).toFixed(2) : '0.00'} USD

📅 *Trends:*
• Pending Calls: ${stats.pending}
• Confirmed Calls: ${stats.confirmed}
• Completed Calls: ${stats.completed}`;
      
      const buttons = [
        [Markup.button.callback(lang === 'es' ? '📅 Ver Tendencias' : '📅 View Trends', 'admin_view_trends')],
        [Markup.button.callback(lang === 'es' ? '💰 Ver Ingresos' : '💰 View Revenue', 'admin_view_revenue')],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_private_calls')],
      ];
      
      await ctx.editMessageText(detailedStatsText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error showing detailed statistics:', error);
    }
  });

  // Export calls (simulated)
  bot.action('admin_export_calls', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      await ctx.answerCbQuery(
        lang === 'es' 
          ? '📅 Exportando llamadas... (funcionalidad simulada)'
          : '📅 Exporting calls... (simulated functionality)',
        { show_alert: true }
      );
      
      logger.info('Admin attempted to export calls', {
        adminId: ctx.from.id,
      });
    } catch (error) {
      logger.error('Error exporting calls:', error);
    }
  });

  // Add performer (simulated)
  bot.action('admin_add_performer', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      await ctx.editMessageText(
        lang === 'es'
          ? `➕ *Añadir Nuevo Performer*
\n*Funcionalidad simulada*
\nEn una implementación real, esto mostraría un formulario para añadir un nuevo performer con:
• Nombre de display
• Bio
• Foto
• Precio base
• Horario de disponibilidad
• Tipos de llamadas permitidas`
          : `➕ *Add New Performer*
\n*Simulated functionality*
\nIn a real implementation, this would show a form to add a new performer with:
• Display name
• Bio
• Photo
• Base price
• Availability schedule
• Allowed call types`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_manage_performers')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in add performer:', error);
    }
  });

  // View trends (simulated)
  bot.action('admin_view_trends', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      await ctx.editMessageText(
        lang === 'es'
          ? `📈 *Tendencias de Llamadas Privadas*
\n*Funcionalidad simulada*
\nEn una implementación real, esto mostraría gráficos y tendencias de:
• Llamadas por día/semana/mes
• Ingresos por período
• Performers más populares
• Duración promedio de llamadas
• Tasa de satisfacción`
          : `📈 *Private Call Trends*
\n*Simulated functionality*
\nIn a real implementation, this would show charts and trends for:
• Calls per day/week/month
• Revenue per period
• Most popular performers
• Average call duration
• Satisfaction rate`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_detailed_stats')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in view trends:', error);
    }
  });

  // View revenue (simulated)
  bot.action('admin_view_revenue', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      
      // Check admin access
      const hasAccess = await checkAdminAccess(ctx);
      if (!hasAccess) {
        return;
      }
      
      await ctx.editMessageText(
        lang === 'es'
          ? `💰 *Ingresos de Llamadas Privadas*
\n*Funcionalidad simulada*
\nEn una implementación real, esto mostraría:
• Ingresos totales y por período
• Desglose por performer
• Métodos de pago más usados
• Proyecciones de ingresos
• Comparación con períodos anteriores`
          : `💰 *Private Call Revenue*
\n*Simulated functionality*
\nIn a real implementation, this would show:
• Total and period-based revenue
• Breakdown by performer
• Most used payment methods
• Revenue projections
• Comparison with previous periods`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '🔙 Volver' : '🔙 Back', 'admin_detailed_stats')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in view revenue:', error);
    }
  });
};

module.exports = registerPrivateCallAdminHandlers;
