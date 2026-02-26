const { Markup } = require('telegraf');
const { query } = require('../../../config/postgres');
const RoleService = require('../../services/roleService');
const PermissionService = require('../../services/permissionService');
const UserModel = require('../../../models/userModel');
const logger = require('../../../utils/logger');
const { getLanguage, safeEditMessage } = require('../../utils/helpers');

/**
 * Performer Management for PNP Live
 * Handles creating, editing, and managing performers
 */

/**
 * Get all performers with their user info
 */
async function getAllPerformers() {
  try {
    const result = await query(`
      SELECT
        p.*,
        u.username,
        u.first_name,
        u.last_name,
        ur.role as user_role
      FROM performers p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN user_roles ur ON p.user_id = ur.user_id
      ORDER BY p.created_at DESC
    `);
    return result.rows;
  } catch (error) {
    logger.error('Error getting all performers:', error);
    return [];
  }
}

/**
 * Get performer by user ID
 */
async function getPerformerByUserId(userId) {
  try {
    const result = await query(
      'SELECT * FROM performers WHERE user_id = $1',
      [userId.toString()]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error getting performer by user ID:', error);
    return null;
  }
}

/**
 * Create a new performer
 */
async function createPerformer(userId, displayName, basePrice = 60) {
  try {
    // First, assign the PERFORMER role
    await RoleService.setUserRole(userId, 'PERFORMER', 'system');

    // Then create the performer entry
    const result = await query(`
      INSERT INTO performers (user_id, display_name, base_price, status, is_available, created_by)
      VALUES ($1, $2, $3, 'active', true, 'admin')
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        base_price = EXCLUDED.base_price,
        status = 'active',
        updated_at = NOW()
      RETURNING *
    `, [userId.toString(), displayName, basePrice]);

    return result.rows[0];
  } catch (error) {
    // Check if it's a unique constraint violation on display_name
    if (error.code === '23505' && error.constraint === 'performers_display_name_key') {
      throw new Error(`El nombre "${displayName}" ya está en uso. Elige otro nombre.`);
    }
    logger.error('Error creating performer:', error);
    throw error;
  }
}

/**
 * Update performer details
 */
async function updatePerformer(performerId, updates) {
  try {
    const setClauses = ['updated_at = NOW()'];
    const values = [performerId];
    let paramIndex = 2;

    const allowedFields = [
      'display_name', 'bio', 'bio_short', 'photo_url',
      'base_price', 'status', 'is_available', 'availability_message',
      'timezone', 'max_call_duration', 'buffer_before_minutes', 'buffer_after_minutes'
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (setClauses.length === 1) {
      return false; // No valid updates
    }

    await query(
      `UPDATE performers SET ${setClauses.join(', ')} WHERE id = $1`,
      values
    );
    return true;
  } catch (error) {
    logger.error('Error updating performer:', error);
    return false;
  }
}

/**
 * Delete performer (remove from performers table and user_roles)
 */
async function deletePerformer(performerId) {
  try {
    // Get performer to find user_id
    const performer = await query('SELECT user_id FROM performers WHERE id = $1', [performerId]);
    if (performer.rows.length > 0 && performer.rows[0].user_id) {
      // Remove PERFORMER role
      await RoleService.removeRole(performer.rows[0].user_id);
    }

    // Delete from performers table
    await query('DELETE FROM performers WHERE id = $1', [performerId]);
    return true;
  } catch (error) {
    logger.error('Error deleting performer:', error);
    return false;
  }
}

/**
 * Show performer management panel
 */
async function showPerformerManagement(ctx, edit = true) {
  try {
    const performers = await getAllPerformers();

    let message = '🎭 *PNP Live - Gestión de Performers*\n\n';

    if (performers.length === 0) {
      message += '_No hay performers registrados._\n\n';
      message += '👆 Usa el botón para crear tu primer performer.';
    } else {
      message += `📊 *Total:* ${performers.length} performers\n\n`;

      for (const p of performers) {
        const statusEmoji = p.is_available ? '🟢' : '🔴';
        const linkedEmoji = p.user_id ? '✅' : '⚠️';
        const username = p.username ? `@${p.username}` : (p.user_id || 'Sin vincular');

        message += `${statusEmoji} *${p.display_name}*\n`;
        message += `   ${linkedEmoji} ${username}\n`;
        message += `   💰 $${p.base_price} USD\n\n`;
      }
    }

    const keyboard = [
      [Markup.button.callback('➕ Crear Performer', 'perf_create_start')],
    ];

    if (performers.length > 0) {
      keyboard.push([Markup.button.callback('✏️ Editar Performer', 'perf_edit_list')]);
      keyboard.push([Markup.button.callback('🗑️ Eliminar Performer', 'perf_delete_list')]);
    }

    keyboard.push([Markup.button.callback('⬅️ Volver', 'admin_cancel')]);

    if (edit) {
      await safeEditMessage(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard),
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard),
      });
    }
  } catch (error) {
    logger.error('Error showing performer management:', error);
    await ctx.answerCbQuery('❌ Error cargando performers');
  }
}

/**
 * Register performer management handlers
 */
const registerPerformerManagementHandlers = (bot) => {
  // Main performer management menu
  bot.action('admin_performers', async (ctx) => {
    try {
      logger.info('[PERF-HANDLER] admin_performers called', { userId: ctx.from.id });
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      logger.info('[PERF-HANDLER] isAdmin check result', { userId: ctx.from.id, isAdmin });
      if (!isAdmin) {
        logger.info('[PERF-HANDLER] User is not admin, rejecting');
        return;
      }
      logger.info('[PERF-HANDLER] Calling showPerformerManagement');
      await showPerformerManagement(ctx, true);
      logger.info('[PERF-HANDLER] showPerformerManagement completed');
    } catch (error) {
      logger.error('Error in admin_performers:', error);
    }
  });

  // Start creating a performer - Step 1: Enter Telegram ID
  bot.action('perf_create_start', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.performerCreate = { step: 'telegram_id' };
      await ctx.saveSession();

      await safeEditMessage(ctx,
        '🎭 *Crear Nuevo Performer*\n\n' +
        '*Paso 1 de 3:* ID de Telegram\n\n' +
        'Envía el ID de Telegram del usuario que será performer.\n\n' +
        '_Puedes obtener el ID pidiendo al usuario que envíe un mensaje al bot, o usando @userinfobot_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', 'admin_performers')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting performer creation:', error);
    }
  });

  // Show list of performers to edit
  bot.action('perf_edit_list', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performers = await getAllPerformers();

      if (performers.length === 0) {
        await ctx.answerCbQuery('No hay performers para editar');
        return;
      }

      const keyboard = performers.map(p => [
        Markup.button.callback(
          `${p.is_available ? '🟢' : '🔴'} ${p.display_name}`,
          `perf_edit_${p.id}`
        )
      ]);
      keyboard.push([Markup.button.callback('⬅️ Volver', 'admin_performers')]);

      await safeEditMessage(ctx,
        '✏️ *Editar Performer*\n\nSelecciona un performer para editar:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(keyboard),
        }
      );
    } catch (error) {
      logger.error('Error showing edit list:', error);
    }
  });

  // Edit specific performer
  bot.action(/^perf_edit_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performerId = ctx.match[1];
      const result = await query('SELECT * FROM performers WHERE id = $1', [performerId]);
      const performer = result.rows[0];

      if (!performer) {
        await ctx.answerCbQuery('❌ Performer no encontrado');
        return;
      }

      const statusEmoji = performer.is_available ? '🟢 Online' : '🔴 Offline';

      let message = `✏️ *Editar: ${performer.display_name}*\n\n`;
      message += `📛 *Nombre:* ${performer.display_name}\n`;
      message += `📝 *Bio:* ${performer.bio || '_Sin bio_'}\n`;
      message += `💰 *Precio base:* $${performer.base_price} USD\n`;
      message += `📊 *Estado:* ${statusEmoji}\n`;
      message += `🌐 *Zona horaria:* ${performer.timezone || 'UTC'}\n`;
      message += `⭐ *Rating:* ${performer.total_rating || 0} (${performer.rating_count || 0} reseñas)\n`;
      message += `📞 *Llamadas:* ${performer.total_calls || 0}\n`;

      const keyboard = [
        [
          Markup.button.callback('📛 Nombre', `perf_set_name_${performerId}`),
          Markup.button.callback('📝 Bio', `perf_set_bio_${performerId}`),
        ],
        [
          Markup.button.callback('💰 Precio', `perf_set_price_${performerId}`),
          Markup.button.callback(performer.is_available ? '🔴 Poner Offline' : '🟢 Poner Online', `perf_toggle_${performerId}`),
        ],
        [Markup.button.callback('⬅️ Volver', 'perf_edit_list')],
      ];

      await safeEditMessage(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard),
      });
    } catch (error) {
      logger.error('Error editing performer:', error);
    }
  });

  // Toggle performer availability
  bot.action(/^perf_toggle_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performerId = ctx.match[1];

      // Get current status
      const result = await query('SELECT is_available FROM performers WHERE id = $1', [performerId]);
      if (result.rows.length === 0) {
        await ctx.answerCbQuery('❌ Performer no encontrado');
        return;
      }

      const newStatus = !result.rows[0].is_available;
      await updatePerformer(performerId, { is_available: newStatus });

      await ctx.answerCbQuery(newStatus ? '✅ Performer ahora está Online' : '✅ Performer ahora está Offline');

      // Refresh the edit view
      await ctx.answerCbQuery();
      // Simulate clicking the edit button again
      ctx.match = [null, performerId];
      await bot.handleUpdate({
        callback_query: {
          ...ctx.callbackQuery,
          data: `perf_edit_${performerId}`
        }
      });
    } catch (error) {
      logger.error('Error toggling performer:', error);
      await ctx.answerCbQuery('❌ Error al cambiar estado');
    }
  });

  // Set performer name
  bot.action(/^perf_set_name_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performerId = ctx.match[1];
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.editingPerformer = { id: performerId, field: 'display_name' };
      await ctx.saveSession();

      await safeEditMessage(ctx,
        '📛 *Cambiar Nombre*\n\nEnvía el nuevo nombre para este performer:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', `perf_edit_${performerId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error setting up name edit:', error);
    }
  });

  // Set performer bio
  bot.action(/^perf_set_bio_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performerId = ctx.match[1];
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.editingPerformer = { id: performerId, field: 'bio' };
      await ctx.saveSession();

      await safeEditMessage(ctx,
        '📝 *Cambiar Bio*\n\nEnvía la nueva biografía para este performer:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', `perf_edit_${performerId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error setting up bio edit:', error);
    }
  });

  // Set performer price
  bot.action(/^perf_set_price_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performerId = ctx.match[1];
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.editingPerformer = { id: performerId, field: 'base_price' };
      await ctx.saveSession();

      await safeEditMessage(ctx,
        '💰 *Cambiar Precio Base*\n\nEnvía el nuevo precio en USD (solo el número, ej: 60):',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', `perf_edit_${performerId}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error setting up price edit:', error);
    }
  });

  // Show list of performers to delete
  bot.action('perf_delete_list', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performers = await getAllPerformers();

      if (performers.length === 0) {
        await ctx.answerCbQuery('No hay performers para eliminar');
        return;
      }

      const keyboard = performers.map(p => [
        Markup.button.callback(
          `🗑️ ${p.display_name}`,
          `perf_delete_confirm_${p.id}`
        )
      ]);
      keyboard.push([Markup.button.callback('⬅️ Volver', 'admin_performers')]);

      await safeEditMessage(ctx,
        '🗑️ *Eliminar Performer*\n\n⚠️ Esta acción no se puede deshacer.\n\nSelecciona un performer para eliminar:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(keyboard),
        }
      );
    } catch (error) {
      logger.error('Error showing delete list:', error);
    }
  });

  // Confirm performer deletion
  bot.action(/^perf_delete_confirm_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performerId = ctx.match[1];
      const result = await query('SELECT display_name FROM performers WHERE id = $1', [performerId]);

      if (result.rows.length === 0) {
        await ctx.answerCbQuery('❌ Performer no encontrado');
        return;
      }

      const performer = result.rows[0];

      await safeEditMessage(ctx,
        `⚠️ *¿Eliminar a ${performer.display_name}?*\n\n` +
        'Esta acción eliminará:\n' +
        '• El perfil del performer\n' +
        '• El rol de PERFORMER del usuario\n' +
        '• Sus horarios de disponibilidad\n\n' +
        '*Esta acción no se puede deshacer.*',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Sí, eliminar', `perf_delete_do_${performerId}`)],
            [Markup.button.callback('❌ No, cancelar', 'perf_delete_list')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error confirming deletion:', error);
    }
  });

  // Execute performer deletion
  bot.action(/^perf_delete_do_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const performerId = ctx.match[1];
      const success = await deletePerformer(performerId);

      if (success) {
        await ctx.answerCbQuery('✅ Performer eliminado');
      } else {
        await ctx.answerCbQuery('❌ Error al eliminar');
      }

      await showPerformerManagement(ctx, true);
    } catch (error) {
      logger.error('Error deleting performer:', error);
      await ctx.answerCbQuery('❌ Error al eliminar');
    }
  });

  // Handle text input for performer creation/editing
  bot.on('text', async (ctx, next) => {
    if (ctx.chat?.type && ctx.chat.type !== 'private') {
      return next();
    }
    if (ctx.session?.temp?.promoCreate?.step === 'custom_code') {
      return next();
    }
    // Debug logging
    logger.info('[PERFORMER-TEXT-HANDLER] Received text', {
      userId: ctx.from.id,
      text: ctx.message.text?.substring(0, 50),
      hasSession: !!ctx.session,
      hasTemp: !!ctx.session?.temp,
      performerCreate: ctx.session?.temp?.performerCreate,
      editingPerformer: ctx.session?.temp?.editingPerformer
    });

    // Check if we're creating a performer
    if (ctx.session?.temp?.performerCreate) {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();

      const createState = ctx.session.temp.performerCreate;
      const text = ctx.message.text.trim();

      try {
        if (createState.step === 'telegram_id') {
          // Validate Telegram ID
          if (!/^\d+$/.test(text)) {
            await ctx.reply('❌ ID inválido. Debe ser un número. Intenta de nuevo:');
            return;
          }

          // Check if user exists
          const user = await UserModel.getById(text);
          if (!user) {
            await ctx.reply(
              '⚠️ Este usuario no está en la base de datos.\n\n' +
              'El usuario debe enviar /start al bot primero.\n\n' +
              'Envía otro ID o cancela:',
              Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancelar', 'admin_performers')],
              ])
            );
            return;
          }

          // Check if already a performer
          const existingPerformer = await getPerformerByUserId(text);
          if (existingPerformer) {
            await ctx.reply(
              `⚠️ Este usuario ya es performer: *${existingPerformer.display_name}*\n\n` +
              'Envía otro ID o cancela:',
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('❌ Cancelar', 'admin_performers')],
                ]),
              }
            );
            return;
          }

          // Save and move to next step
          createState.userId = text;
          createState.userName = user.first_name || user.username || text;
          createState.step = 'display_name';
          await ctx.saveSession();

          await ctx.reply(
            `✅ Usuario encontrado: *${createState.userName}*\n\n` +
            '*Paso 2 de 3:* Nombre de Performer\n\n' +
            'Envía el nombre artístico/display name para este performer:',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancelar', 'admin_performers')],
              ]),
            }
          );
          return;
        }

        if (createState.step === 'display_name') {
          if (text.length < 2 || text.length > 50) {
            await ctx.reply('❌ El nombre debe tener entre 2 y 50 caracteres. Intenta de nuevo:');
            return;
          }

          createState.displayName = text;
          createState.step = 'base_price';
          await ctx.saveSession();

          await ctx.reply(
            `✅ Nombre: *${text}*\n\n` +
            '*Paso 3 de 3:* Precio Base\n\n' +
            'Envía el precio base en USD para 30 minutos (solo el número, ej: 60):',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('💰 Usar $60 (default)', 'perf_create_default_price')],
                [Markup.button.callback('❌ Cancelar', 'admin_performers')],
              ]),
            }
          );
          return;
        }

        if (createState.step === 'base_price') {
          const price = parseFloat(text);
          if (isNaN(price) || price < 1 || price > 10000) {
            await ctx.reply('❌ Precio inválido. Debe ser un número entre 1 y 10000. Intenta de nuevo:');
            return;
          }

          // Create the performer
          try {
            const performer = await createPerformer(
              createState.userId,
              createState.displayName,
              price
            );

            // Clear session
            delete ctx.session.temp.performerCreate;
            await ctx.saveSession();

            await ctx.reply(
              `✅ *Performer Creado Exitosamente*\n\n` +
              `🎭 *${performer.display_name}*\n` +
              `👤 Usuario: ${createState.userName}\n` +
              `💰 Precio: $${performer.base_price} USD\n` +
              `📊 Estado: 🟢 Activo\n\n` +
              'El performer ya puede usar /pnp_live para gestionar su perfil.',
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('✏️ Editar Performer', `perf_edit_${performer.id}`)],
                  [Markup.button.callback('⬅️ Volver a Performers', 'admin_performers')],
                ]),
              }
            );
          } catch (error) {
            await ctx.reply(`❌ Error: ${error.message}`);
          }
          return;
        }
      } catch (error) {
        logger.error('Error in performer creation flow:', error);
        await ctx.reply('❌ Error en el proceso. Intenta de nuevo.');
      }
      return; // Don't call next
    }

    // Check if we're editing a performer
    if (ctx.session?.temp?.editingPerformer) {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();

      const { id, field } = ctx.session.temp.editingPerformer;
      const text = ctx.message.text.trim();

      try {
        let value = text;

        // Validate based on field
        if (field === 'base_price') {
          value = parseFloat(text);
          if (isNaN(value) || value < 1 || value > 10000) {
            await ctx.reply('❌ Precio inválido. Debe ser un número entre 1 y 10000.');
            return;
          }
        } else if (field === 'display_name') {
          if (text.length < 2 || text.length > 50) {
            await ctx.reply('❌ El nombre debe tener entre 2 y 50 caracteres.');
            return;
          }
        }

        const success = await updatePerformer(id, { [field]: value });

        // Clear session
        delete ctx.session.temp.editingPerformer;
        await ctx.saveSession();

        if (success) {
          await ctx.reply(
            '✅ Performer actualizado exitosamente',
            Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Volver', `perf_edit_${id}`)],
            ])
          );
        } else {
          await ctx.reply('❌ Error al actualizar. Intenta de nuevo.');
        }
      } catch (error) {
        logger.error('Error updating performer:', error);
        await ctx.reply('❌ Error al actualizar. Intenta de nuevo.');
      }
      return; // Don't call next
    }

    return next();
  });

  // Use default price ($60)
  bot.action('perf_create_default_price', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const createState = ctx.session?.temp?.performerCreate;
      if (!createState || createState.step !== 'base_price') {
        await ctx.answerCbQuery('❌ Sesión expirada');
        return;
      }

      // Create the performer with default price
      try {
        const performer = await createPerformer(
          createState.userId,
          createState.displayName,
          60
        );

        // Clear session
        delete ctx.session.temp.performerCreate;
        await ctx.saveSession();

        await safeEditMessage(ctx,
          `✅ *Performer Creado Exitosamente*\n\n` +
          `🎭 *${performer.display_name}*\n` +
          `👤 Usuario: ${createState.userName}\n` +
          `💰 Precio: $${performer.base_price} USD\n` +
          `📊 Estado: 🟢 Activo\n\n` +
          'El performer ya puede usar /pnp_live para gestionar su perfil.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✏️ Editar Performer', `perf_edit_${performer.id}`)],
              [Markup.button.callback('⬅️ Volver a Performers', 'admin_performers')],
            ]),
          }
        );
      } catch (error) {
        await ctx.answerCbQuery(`❌ ${error.message}`);
      }
    } catch (error) {
      logger.error('Error creating performer with default price:', error);
    }
  });
};

module.exports = registerPerformerManagementHandlers;
module.exports.showPerformerManagement = showPerformerManagement;
module.exports.createPerformer = createPerformer;
module.exports.getPerformerByUserId = getPerformerByUserId;
