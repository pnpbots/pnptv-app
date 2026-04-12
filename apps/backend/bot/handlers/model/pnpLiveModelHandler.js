const { Markup } = require('telegraf');
const RoleService = require('../../../services/roleService');
const UserModel = require('../../../models/userModel');
const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');

const BroadcastService = require('../../../services/broadcastService');

const PerformerProfileModel = require('../../../models/performerProfileModel');

/**
 * Get performer data from performers table
 */
async function getPerformerData(userId) {
  try {
    const result = await query(
      'SELECT * FROM performers WHERE user_id = $1',
      [userId.toString()]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error getting performer data:', error);
    return null;
  }
}

/**
 * Update performer availability status
 */
async function updatePerformerStatus(userId, isAvailable) {
  try {
    await query(
      'UPDATE performers SET is_available = $1, updated_at = NOW() WHERE user_id = $2',
      [isAvailable, userId.toString()]
    );
    return true;
  } catch (error) {
    logger.error('Error updating performer status:', error);
    return false;
  }
}

/**
 * PNP Live Model Handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerPNPLiveModelHandlers = (bot) => {
  bot.command('pnp_live', async (ctx) => {
    try {
      const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
      if (!isPerformer) {
        return;
      }

      // Get performer data from performers table
      const performer = await getPerformerData(ctx.from.id);
      if (!performer) {
        await ctx.reply(
          '❌ Tu perfil de performer no está configurado.\n\n' +
          'Contacta a un administrador para configurar tu perfil.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const statusEmoji = performer.is_available ? '🟢' : '🔴';
      const statusText = performer.is_available ? 'ONLINE' : 'OFFLINE';

      const message = `🎭 *PNP Live - Menú de Performer*\n\n` +
        `👤 *${performer.display_name}*\n` +
        `📊 Estado: ${statusEmoji} *${statusText}*\n` +
        `💰 Precio base: $${performer.base_price} USD\n` +
        `⭐ Rating: ${performer.total_rating || 0} (${performer.rating_count || 0} reseñas)\n` +
        `📞 Llamadas: ${performer.total_calls || 0}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(
          performer.is_available ? '🔴 Ponerme Offline' : '🟢 Ponerme Online',
          'pnp_live_toggle_status'
        )],
        [Markup.button.callback('📝 Editar Perfil', 'pnp_live_manage_profile')],
        [Markup.button.callback('📊 Mis Estadísticas', 'pnp_live_my_stats')],
      ]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } catch (error) {
      logger.error('Error in /pnp_live command:', error);
    }
  });

  bot.action('pnp_live_manage_profile', async (ctx) => {
    try {
      const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
      if (!isPerformer) {
        return;
      }

      let profile = await PerformerProfileModel.getByUserId(ctx.from.id);
      if (!profile) {
        profile = await PerformerProfileModel.create(ctx.from.id);
      }

      const message = `
📝 *Your Performer Profile*

*Bio:*
${profile.bio || '_Not set_'}

*Rates:*
${profile.rates ? JSON.stringify(profile.rates) : '_Not set_'}

*Tags:*
${profile.tags ? profile.tags.join(', ') : '_Not set_'}
      `;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Edit Bio', 'pnp_live_edit_bio')],
        [Markup.button.callback('✏️ Edit Rates', 'pnp_live_edit_rates')],
        [Markup.button.callback('✏️ Edit Tags', 'pnp_live_edit_tags')],
        [Markup.button.callback('⬅️ Back', 'pnp_live_back_to_menu')],
      ]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } catch (error) {
      logger.error('Error in pnp_live_manage_profile:', error);
    }
  });

  bot.action('pnp_live_edit_bio', async (ctx) => {
    try {
      const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
      if (!isPerformer) {
        return;
      }

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.editingProfileField = 'bio';
      await ctx.saveSession();

      await ctx.editMessageText('📝 *Edit Bio*\n\nPlease send your new bio.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'pnp_live_manage_profile')],
        ]),
      });
    } catch (error) {
      logger.error('Error in pnp_live_edit_bio:', error);
    }
  });

  bot.action('pnp_live_edit_rates', async (ctx) => {
    try {
      const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
      if (!isPerformer) {
        return;
      }

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.editingProfileField = 'rates';
      await ctx.saveSession();

      await ctx.editMessageText('💰 *Edit Rates*\n\nPlease send your new rates in JSON format (e.g., `{"30min": 50, "60min": 90}`).', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'pnp_live_manage_profile')],
        ]),
      });
    } catch (error) {
      logger.error('Error in pnp_live_edit_rates:', error);
    }
  });

  bot.action('pnp_live_edit_tags', async (ctx) => {
    try {
      const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
      if (!isPerformer) {
        return;
      }

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.editingProfileField = 'tags';
      await ctx.saveSession();

      await ctx.editMessageText('🏷️ *Edit Tags*\n\nPlease send your new tags as a comma-separated list (e.g., `tag1, tag2, tag3`).', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'pnp_live_manage_profile')],
        ]),
      });
    } catch (error) {
      logger.error('Error in pnp_live_edit_tags:', error);
    }
  });

  bot.on('text', async (ctx, next) => {
    if (ctx.session?.temp?.editingProfileField) {
      try {
        const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
        if (!isPerformer) {
          return next();
        }

        const field = ctx.session.temp.editingProfileField;
        let value = ctx.message.text;

        if (field === 'rates') {
          try {
            value = JSON.parse(value);
          } catch (error) {
            return ctx.reply('❌ Invalid JSON format. Please try again.');
          }
        } else if (field === 'tags') {
          value = value.split(',').map(tag => tag.trim());
        }

        await PerformerProfileModel.update(ctx.from.id, { [field]: value });
        delete ctx.session.temp.editingProfileField;
        await ctx.saveSession();

        await ctx.reply(`✅ ${field.charAt(0).toUpperCase() + field.slice(1)} updated!`);
        return bot.handleUpdate({ callback_query: { data: 'pnp_live_manage_profile', from: ctx.from, message: ctx.message } });
      } catch (error) {
        logger.error(`Error updating ${ctx.session.temp.editingProfileField}:`, error);
      }
    }
    return next();
  });

  bot.action('pnp_live_back_to_menu', async (ctx) => {
      // This is a bit of a hack, but it works for now
      await bot.handleUpdate({ message: { text: '/pnp_live', from: ctx.from, chat: ctx.chat } });
  });

  bot.action('pnp_live_toggle_status', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
      if (!isPerformer) {
        return;
      }

      // Get performer data
      const performer = await getPerformerData(ctx.from.id);
      if (!performer) {
        await ctx.answerCbQuery('❌ Perfil no encontrado');
        return;
      }

      const newStatus = !performer.is_available;

      // Update performer status in performers table
      await updatePerformerStatus(ctx.from.id, newStatus);

      const statusEmoji = newStatus ? '🟢' : '🔴';
      const statusText = newStatus ? 'ONLINE' : 'OFFLINE';

      const message = `🎭 *PNP Live - Menú de Performer*\n\n` +
        `👤 *${performer.display_name}*\n` +
        `📊 Estado: ${statusEmoji} *${statusText}*\n` +
        `💰 Precio base: $${performer.base_price} USD\n` +
        `⭐ Rating: ${performer.total_rating || 0} (${performer.rating_count || 0} reseñas)\n` +
        `📞 Llamadas: ${performer.total_calls || 0}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(
          newStatus ? '🔴 Ponerme Offline' : '🟢 Ponerme Online',
          'pnp_live_toggle_status'
        )],
        [Markup.button.callback('📝 Editar Perfil', 'pnp_live_manage_profile')],
        [Markup.button.callback('📊 Mis Estadísticas', 'pnp_live_my_stats')],
      ]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });

      // Send broadcast when going ONLINE
      if (newStatus) {
        await sendPerformerOnlineBroadcast(bot, performer);
      }
    } catch (error) {
      logger.error('Error in pnp_live_toggle_status:', error);
    }
  });

  // Show performer stats
  bot.action('pnp_live_my_stats', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isPerformer = await RoleService.hasRole(ctx.from.id, 'PERFORMER');
      if (!isPerformer) return;

      const performer = await getPerformerData(ctx.from.id);
      if (!performer) return;

      const message = `📊 *Estadísticas de ${performer.display_name}*\n\n` +
        `📞 *Llamadas totales:* ${performer.total_calls || 0}\n` +
        `⭐ *Rating promedio:* ${performer.total_rating || 0}\n` +
        `📝 *Número de reseñas:* ${performer.rating_count || 0}\n` +
        `💰 *Precio base:* $${performer.base_price} USD\n` +
        `📅 *Desde:* ${new Date(performer.created_at).toLocaleDateString('es-ES')}`;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Volver', 'pnp_live_back_to_menu')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing performer stats:', error);
    }
  });
};

/**
 * Send broadcast announcing performer is online with Profile Card
 */
async function sendPerformerOnlineBroadcast(bot, performer) {
  try {
    const broadcastService = new BroadcastService();

    // Build performer profile card message
    const ratingDisplay = performer.total_rating > 0
      ? `⭐ ${parseFloat(performer.total_rating).toFixed(1)} (${performer.rating_count} reseñas)`
      : '⭐ Nuevo';

    const bioShort = performer.bio
      ? (performer.bio.length > 100 ? performer.bio.substring(0, 100) + '...' : performer.bio)
      : '';

    // English profile card
    const messageEn = `🔴 *LIVE NOW* 🔴\n\n` +
      `🎭 *${performer.display_name}* is now online!\n\n` +
      (bioShort ? `📝 ${bioShort}\n\n` : '') +
      `💰 Starting at *$${performer.base_price} USD*\n` +
      `${ratingDisplay}\n` +
      `📞 ${performer.total_calls || 0} completed calls\n\n` +
      `🔥 *Book your private show now!*`;

    // Spanish profile card
    const messageEs = `🔴 *EN VIVO AHORA* 🔴\n\n` +
      `🎭 *${performer.display_name}* está en línea!\n\n` +
      (bioShort ? `📝 ${bioShort}\n\n` : '') +
      `💰 Desde *$${performer.base_price} USD*\n` +
      `${ratingDisplay}\n` +
      `📞 ${performer.total_calls || 0} llamadas completadas\n\n` +
      `🔥 *¡Reserva tu show privado ahora!*`;

    // Get bot username for deep link
    const botInfo = await bot.telegram.getMe();
    const botUsername = botInfo.username;

    // Create deep link to PNP Live booking
    const deepLink = `https://t.me/${botUsername}?start=pnp_live`;

    const broadcastData = {
      adminId: performer.user_id,
      adminUsername: performer.display_name,
      title: `${performer.display_name} Online`,
      messageEn: messageEn,
      messageEs: messageEs,
      targetType: 'all',
      buttons: [
        {
          text: '🎭 Book Private Show / Reservar Show',
          type: 'url',
          url: deepLink,
        },
        {
          text: '📹 PNP Live',
          type: 'callback',
          data: 'PNP_LIVE_START',
        },
      ],
    };

    const broadcast = await broadcastService.createBroadcast(broadcastData);

    // Send the broadcast
    if (broadcast && broadcast.broadcast_id) {
      await broadcastService.sendBroadcast(bot, broadcast.broadcast_id);
      logger.info(`Performer online broadcast sent for ${performer.display_name}`);
    }
  } catch (error) {
    logger.error('Error sending performer online broadcast:', error);
  }
}

module.exports = registerPNPLiveModelHandlers;