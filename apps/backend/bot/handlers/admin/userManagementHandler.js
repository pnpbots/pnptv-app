const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const UserModel = require('../../../models/userModel');
const PermissionService = require('../../../services/permissionService');
const { getLanguage } = require('../../utils/helpers');
const { query } = require('../../../utils/db');

/**
 * Show user management main menu with options
 */
async function showUserManagementMenu(ctx, user) {
  const lang = getLanguage(ctx);

  const userInfo = `
👤 **Usuario encontrado**
ID: \`${user.id}\`
Username: @${user.username || 'N/A'}
Email: ${user.email || 'N/A'}
Tier: ${user.tier || 'Free'}
Estado: ${user.subscriptionStatus || user.subscription_status || 'free'}
Baneado: ${user.tier === 'banned' ? 'Sí ⛔' : 'No ✅'}
  `.trim();

  const buttons = [
    [Markup.button.callback('✏️ Cambiar username', `manage_user_${user.id}_username`)],
    [Markup.button.callback('📧 Cambiar email', `manage_user_${user.id}_email`)],
    [Markup.button.callback('💎 Cambiar Tier', `manage_user_${user.id}_tier`)],
    [Markup.button.callback('📊 Suscripción', `manage_user_${user.id}_subscription`)],
    [
      user.tier === 'banned'
        ? Markup.button.callback('✅ Desbanear', `manage_user_${user.id}_unban`)
        : Markup.button.callback('⛔ Banear', `manage_user_${user.id}_ban`),
    ],
    [Markup.button.callback('💬 Enviar mensaje', `manage_user_${user.id}_message`)],
    [Markup.button.callback('↩️ Volver', 'admin_users_search')],
  ];

  // Try to edit message (works for callback queries), fall back to reply (works for text messages)
  try {
    await ctx.editMessageText(userInfo, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    // If edit fails (e.g., message can't be edited), use reply instead
    if (error.description && error.description.includes("can't be edited")) {
      await ctx.reply(userInfo, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } else {
      throw error;
    }
  }
}

/**
 * Handle username update
 */
async function handleUsernameUpdate(ctx) {
  const userId = ctx.match[1];
  const user = await UserModel.getById(userId);

  if (!user) {
    await ctx.answerCbQuery('❌ Usuario no encontrado');
    return;
  }

  ctx.session.temp = ctx.session.temp || {};
  ctx.session.temp.editingUser = { id: userId, field: 'username', currentValue: user.username };
  await ctx.saveSession();

  await ctx.editMessageText(
    `📝 **Actualizar username**\n\nUsername actual: @${user.username || 'N/A'}\n\nEnvía el nuevo username (sin @):`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', `manage_user_${userId}_cancel`)]])
  );
}

/**
 * Handle email update
 */
async function handleEmailUpdate(ctx) {
  const userId = ctx.match[1];
  const user = await UserModel.getById(userId);

  if (!user) {
    await ctx.answerCbQuery('❌ Usuario no encontrado');
    return;
  }

  ctx.session.temp = ctx.session.temp || {};
  ctx.session.temp.editingUser = { id: userId, field: 'email', currentValue: user.email };
  await ctx.saveSession();

  await ctx.editMessageText(
    `📧 **Actualizar email**\n\nEmail actual: ${user.email || 'No registrado'}\n\nEnvía el nuevo email:`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', `manage_user_${userId}_cancel`)]])
  );
}

/**
 * Handle tier change
 */
async function handleTierChange(ctx) {
  const userId = ctx.match[1];
  const user = await UserModel.getById(userId);

  if (!user) {
    await ctx.answerCbQuery('❌ Usuario no encontrado');
    return;
  }

  await ctx.editMessageText(
    `💎 **Cambiar Tier**\n\nTier actual: ${user.tier || 'Free'}\n\nSelecciona el nuevo tier:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('💎 PRIME', `confirm_tier_${userId}_prime`)],
      [Markup.button.callback('🆓 FREE', `confirm_tier_${userId}_free`)],
      [Markup.button.callback('↩️ Atrás', `manage_user_${userId}_menu`)],
    ])
  );
}

/**
 * Handle subscription status change
 */
async function handleSubscriptionChange(ctx) {
  const userId = ctx.match[1];
  const user = await UserModel.getById(userId);

  if (!user) {
    await ctx.answerCbQuery('❌ Usuario no encontrado');
    return;
  }

  await ctx.editMessageText(
    `📊 **Cambiar Estado de Suscripción**\n\nEstado actual: ${user.subscription_status || 'free'}\n\nSelecciona el nuevo estado:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Active', `confirm_sub_${userId}_active`)],
      [Markup.button.callback('⏰ Churned', `confirm_sub_${userId}_churned`)],
      [Markup.button.callback('❌ Expired', `confirm_sub_${userId}_expired`)],
      [Markup.button.callback('🆓 Free', `confirm_sub_${userId}_free`)],
      [Markup.button.callback('↩️ Atrás', `manage_user_${userId}_menu`)],
    ])
  );
}

/**
 * Handle ban/unban
 */
async function handleBanToggle(ctx) {
  const match = ctx.match[1];
  const parts = match.split('_');
  const userId = parts[0];
  const action = parts[1]; // 'ban' or 'unban'

  const user = await UserModel.getById(userId);
  if (!user) {
    await ctx.answerCbQuery('❌ Usuario no encontrado');
    return;
  }

  const isBanning = action === 'ban';
  const message = isBanning
    ? `⛔ **Confirmar baneo**\n\n¿Banear a @${user.username}?`
    : `✅ **Confirmar desbaneo**\n\n¿Desbanear a @${user.username}?`;

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Confirmar', `confirm_ban_${userId}_${isBanning ? 'yes' : 'no'}`),
        Markup.button.callback('❌ Cancelar', `manage_user_${userId}_menu`),
      ],
    ])
  });
}

/**
 * Handle send message
 */
async function handleSendMessage(ctx) {
  const userId = ctx.match[1];
  const user = await UserModel.getById(userId);

  if (!user) {
    await ctx.answerCbQuery('❌ Usuario no encontrado');
    return;
  }

  ctx.session.temp = ctx.session.temp || {};
  ctx.session.temp.sendingMessageTo = userId;
  await ctx.saveSession();

  await ctx.editMessageText(
    `💬 **Enviar Mensaje Directo**\n\nEnvía el mensaje para @${user.username}:`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', `manage_user_${userId}_menu`)]])
  );
}

/**
 * Handle text input for various fields
 */
async function handleUserManagementInput(ctx, next) {
  try {
    const editing = ctx.session?.temp?.editingUser;
    const sendingMessageTo = ctx.session?.temp?.sendingMessageTo;

    if (!editing && !sendingMessageTo) {
      return next();
    }

    const text = ctx.message?.text?.trim();
    if (!text) {
      await ctx.reply('❌ Por favor envía un valor válido.');
      return;
    }

    const adminId = ctx.from.id;
    const isAdmin = await PermissionService.isAdmin(adminId);
    if (!isAdmin) {
      return next();
    }

    if (editing) {
      const { id: userId, field } = editing;
      const user = await UserModel.getById(userId);

      if (field === 'username') {
        await UserModel.updateProfile(userId, { username: text });
        logger.info('Admin updated user username', { adminId, userId, newUsername: text });
        await ctx.reply(`✅ Username actualizado a: @${text}`);
      } else if (field === 'email') {
        await UserModel.updateProfile(userId, { email: text });
        logger.info('Admin updated user email', { adminId, userId, newEmail: text });
        await ctx.reply(`✅ Email actualizado a: ${text}`);
      }

      ctx.session.temp.editingUser = null;
      await ctx.saveSession();

      const updatedUser = await UserModel.getById(userId);
      await showUserManagementMenu(ctx, updatedUser);
    } else if (sendingMessageTo) {
      const userId = sendingMessageTo;
      const user = await UserModel.getById(userId);

      // Send via customer service (simulating admin message)
      const supportRoutingService = require('../../../services/supportRoutingService');
      const messageNote = `📨 **Mensaje del Admin**\n\nPara: @${user.username}\n\n${text}`;

      try {
        await supportRoutingService.sendToSupportGroup(messageNote, 'admin_message', {
          id: adminId,
          first_name: 'Admin',
          username: 'admin',
        }, 'text', null, { recipient_user_id: userId });

        logger.info('Admin sent message to user', { adminId, userId, messageLength: text.length });
        await ctx.reply(`✅ Mensaje enviado a @${user.username}`);
      } catch (error) {
        logger.warn('Failed to send admin message:', error);
        await ctx.reply(`⚠️ Mensaje queued pero hubo error al enviar`);
      }

      ctx.session.temp.sendingMessageTo = null;
      await ctx.saveSession();

      const updatedUser = await UserModel.getById(userId);
      await showUserManagementMenu(ctx, updatedUser);
    }
  } catch (error) {
    logger.error('Error in user management input:', error);
    await ctx.reply('❌ Error procesando tu solicitud.');
  }
}

/**
 * Register user management handlers
 */
function registerUserManagementHandlers(bot) {
  // Search user
  bot.action('admin_users_search', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      ctx.session.temp = { searchingUser: true };
      await ctx.saveSession();

      await ctx.editMessageText(
        '🔍 **Buscar Usuario**\n\nEnvía un username, email o user ID:',
        Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'admin_cancel')]])
      );
    } catch (error) {
      logger.error('Error in user search:', error);
    }
  });

  // Handle user search input
  bot.on('message', async (ctx, next) => {
    try {
      if (ctx.session?.temp?.searchingUser && ctx.message?.text) {
        const adminId = ctx.from.id;
        const isAdmin = await PermissionService.isAdmin(adminId);
        if (!isAdmin) return next();

        const searchQuery = ctx.message.text.trim();
        let user = null;

        // Try to find user
        if (searchQuery.startsWith('@')) {
          user = await UserModel.searchByUsername(searchQuery.substring(1));
        } else if (!isNaN(searchQuery)) {
          user = await UserModel.getById(searchQuery);
        } else {
          // Try to find by email
          const result = await query(
            'SELECT * FROM users WHERE email = $1 LIMIT 1',
            [searchQuery]
          );
          user = result.rows[0] ? UserModel.mapRowToUser(result.rows[0]) : null;
        }

        ctx.session.temp.searchingUser = false;
        await ctx.saveSession();

        if (!user) {
          await ctx.reply('❌ Usuario no encontrado.');
          return;
        }

        logger.info('Admin found user', { adminId, userId: user.id });

        // Use reply instead of editMessageText since this comes from a text message
        const userInfo = `
👤 **Usuario encontrado**
ID: \`${user.id}\`
Username: @${user.username || 'N/A'}
Email: ${user.email || 'N/A'}
Tier: ${user.tier || 'Free'}
Estado: ${user.subscriptionStatus || user.subscription_status || 'free'}
Baneado: ${user.tier === 'banned' ? 'Sí ⛔' : 'No ✅'}
        `.trim();

        const buttons = [
          [Markup.button.callback('✏️ Cambiar username', `manage_user_${user.id}_username`)],
          [Markup.button.callback('📧 Cambiar email', `manage_user_${user.id}_email`)],
          [Markup.button.callback('💎 Cambiar Tier', `manage_user_${user.id}_tier`)],
          [Markup.button.callback('📊 Suscripción', `manage_user_${user.id}_subscription`)],
          [
            user.tier === 'banned'
              ? Markup.button.callback('✅ Desbanear', `manage_user_${user.id}_unban`)
              : Markup.button.callback('⛔ Banear', `manage_user_${user.id}_ban`),
          ],
          [Markup.button.callback('💬 Enviar mensaje', `manage_user_${user.id}_message`)],
          [Markup.button.callback('↩️ Volver', 'admin_users_search')],
        ];

        await ctx.reply(userInfo, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        });
        return;
      }

      return next();
    } catch (error) {
      logger.error('Error in user search input:', error);
      return next();
    }
  });

  // Manage user menu
  bot.action(/^manage_user_(\w+)_username$/, handleUsernameUpdate);
  bot.action(/^manage_user_(\w+)_email$/, handleEmailUpdate);
  bot.action(/^manage_user_(\w+)_tier$/, handleTierChange);
  bot.action(/^manage_user_(\w+)_subscription$/, handleSubscriptionChange);
  bot.action(/^manage_user_(\w+)_ban$/, (ctx) => handleBanToggle(ctx));
  bot.action(/^manage_user_(\w+)_unban$/, (ctx) => {
    ctx.match[1] = `${ctx.match[1]}_unban`;
    return handleBanToggle(ctx);
  });
  bot.action(/^manage_user_(\w+)_message$/, handleSendMessage);
  bot.action(/^manage_user_(\w+)_cancel$/, async (ctx) => {
    const userId = ctx.match[1];
    const user = await UserModel.getById(userId);
    if (user) {
      await showUserManagementMenu(ctx, user);
    } else {
      await ctx.answerCbQuery('❌ Usuario no encontrado');
    }
  });
  bot.action(/^manage_user_(\w+)_menu$/, async (ctx) => {
    const userId = ctx.match[1];
    const user = await UserModel.getById(userId);
    if (user) {
      await showUserManagementMenu(ctx, user);
    } else {
      await ctx.answerCbQuery('❌ Usuario no encontrado');
    }
  });

  // Confirm tier change
  bot.action(/^confirm_tier_(\w+)_(prime|free)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const userId = ctx.match[1];
      const tier = ctx.match[2];
      const adminId = ctx.from.id;

      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) return;

      const newTier = tier === 'prime' ? 'PRIME' : 'free';
      await query('UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2', [newTier, userId]);
      await require('../../../config/redis').cache.del(`user:${userId}`);

      logger.info('Admin changed user tier', { adminId, userId, newTier });
      await ctx.answerCbQuery('✅ Tier actualizado');

      const user = await UserModel.getById(userId);
      await showUserManagementMenu(ctx, user);
    } catch (error) {
      logger.error('Error confirming tier change:', error);
      await ctx.answerCbQuery('❌ Error');
    }
  });

  // Confirm subscription change
  bot.action(/^confirm_sub_(\w+)_(active|churned|expired|free)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const userId = ctx.match[1];
      const status = ctx.match[2];
      const adminId = ctx.from.id;

      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) return;

      const user = await UserModel.getById(userId);
      await UserModel.updateSubscription(userId, {
        status,
        planId: user.subscription_plan_id,
        expiry: user.plan_expiry,
      });

      logger.info('Admin changed user subscription', { adminId, userId, status });
      await ctx.answerCbQuery('✅ Suscripción actualizada');

      const updatedUser = await UserModel.getById(userId);
      await showUserManagementMenu(ctx, updatedUser);
    } catch (error) {
      logger.error('Error confirming subscription change:', error);
      await ctx.answerCbQuery('❌ Error');
    }
  });

  // Confirm ban
  bot.action(/^confirm_ban_(\w+)_(yes|no)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const userId = ctx.match[1];
      const isBanning = ctx.match[2] === 'yes';
      const adminId = ctx.from.id;

      const isAdmin = await PermissionService.isAdmin(adminId);
      if (!isAdmin) return;

      const newTier = isBanning ? 'banned' : 'free';
      await query('UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2', [newTier, userId]);
      await require('../../../config/redis').cache.del(`user:${userId}`);

      const action = isBanning ? 'banned' : 'unbanned';
      logger.info(`Admin ${action} user`, { adminId, userId });
      await ctx.answerCbQuery(`✅ Usuario ${action}`);

      const user = await UserModel.getById(userId);
      await showUserManagementMenu(ctx, user);
    } catch (error) {
      logger.error('Error confirming ban:', error);
      await ctx.answerCbQuery('❌ Error');
    }
  });

  // Handle text input for username/email/message
  bot.use(async (ctx, next) => {
    await handleUserManagementInput(ctx, next);
  });
}

module.exports = {
  registerUserManagementHandlers,
  showUserManagementMenu,
};
