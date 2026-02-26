/**
 * Main Menu Integration for Private Calls
 * Adds the "Book a Private Call" option to the main user menu
 */

const logger = require('../../../utils/logger');
const ModelManagementModel = require('../../../models/modelManagementModel');

/**
 * Extend main menu with private calls option
 * This function should be called after the main menu setup
 */
const integratePrivateCallsToMenu = (bot) => {
  /**
   * Updated main menu with private calls option
   */
  bot.action('menu_main', async (ctx) => {
    try {
      const lang = ctx.session.lang || 'en';

      const keyboard = [
        // Existing options (keeping as is)
        [
          {
            text: lang === 'es' ? '👤 Mi Perfil' : '👤 My Profile',
            callback_data: 'show_profile'
          },
          {
            text: lang === 'es' ? '📍 PNP Nearby' : '📍 PNP Nearby',
            callback_data: 'menu:nearby'
          }
        ],
        [
          {
            text: lang === 'es' ? '💬 Mensajes' : '💬 Messages',
            callback_data: 'messages_menu'
          },
          {
            text: lang === 'es' ? '🎬 Videos' : '🎬 Videos',
            callback_data: 'videos_menu'
          }
        ],
        // NEW: Meet & Greet option
        [
          {
            text: lang === 'es' ? '📞 Video Llamada VIP' : '📞 Meet & Greet',
            callback_data: 'MEET_GREET_START'
          }
        ],
        // Existing options
        [
          {
            text: lang === 'es' ? '💳 Planes y Precios' : '💳 Plans & Pricing',
            callback_data: 'show_plans'
          }
        ],
        [
          {
            text: lang === 'es' ? '🔔 Notificaciones' : '🔔 Notifications',
            callback_data: 'notifications_menu'
          },
          {
            text: lang === 'es' ? '⚙️ Configuración' : '⚙️ Settings',
            callback_data: 'settings_menu'
          }
        ],
        [
          {
            text: lang === 'es' ? '📖 Ayuda' : '📖 Help',
            callback_data: 'help_menu'
          }
        ]
      ];

      const menuText = lang === 'es'
        ? '🏠 **Menú Principal**\n\n¿Qué te gustaría hacer?\n\n💡 *Nuevo*: Ahora puedes reservar llamadas privadas 1:1 con modelos verificados'
        : '🏠 **Main Menu**\n\nWhat would you like to do?\n\n💡 *New*: Now you can book 1:1 private calls with verified models';

      await ctx.editMessageText(menuText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in menu_main:', error);
      ctx.answerCbQuery('Error loading menu', true);
    }
  });

  /**
   * Show user's booked calls
   */
  bot.action('my_bookings', async (ctx) => {
    try {
      const bookings = await ModelManagementModel.getUserBookings(ctx.from.id);
      const lang = ctx.session.lang || 'en';

      if (bookings.length === 0) {
        const text = lang === 'es'
          ? '📞 **Mis Reservas**\n\nNo tienes reservas aún.\n\n¿Quieres reservar una llamada privada?'
          : '📞 **My Bookings**\n\nYou have no bookings yet.\n\nWould you like to book a private call?';

        return await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📞 Book Now', callback_data: 'book_private_call' }],
              [{ text: '🔙 Back', callback_data: 'menu_main' }]
            ]
          }
        });
      }

      const bookingsList = bookings.map((b, i) => {
        const status = b.status === 'completed' ? '✅' :
                      b.status === 'active' ? '🔴' :
                      b.status === 'confirmed' ? '⏳' : '⏸️';

        return `${i + 1}. ${status} **${b.display_name}**\n` +
               `   📅 ${b.scheduled_date} at ${b.start_time}\n` +
               `   ⏱️ ${b.duration_minutes} min | 💰 $${b.total_price}`;
      }).join('\n\n');

      const text = lang === 'es'
        ? `📞 **Mis Reservas**\n\n${bookingsList}`
        : `📞 **My Bookings**\n\n${bookingsList}`;

      const keyboard = [
        [{ text: '➕ Book New Call', callback_data: 'book_private_call' }],
        [{ text: '🔙 Back', callback_data: 'menu_main' }]
      ];

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in my_bookings:', error);
      ctx.answerCbQuery('Error loading bookings', true);
    }
  });

  /**
   * Admin: View bookings and earnings
   */
  bot.action('admin_earnings', async (ctx) => {
    try {
      // This would show admin dashboard with earnings from bookings
      const text = '📊 **Bookings & Earnings**\n\n' +
                   'Coming soon: Complete analytics dashboard';

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 Back', callback_data: 'admin_models' }
          ]]
        }
      });

      ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error in admin_earnings:', error);
      ctx.answerCbQuery('Error', true);
    }
  });
};

module.exports = integratePrivateCallsToMenu;
