const { Markup } = require('telegraf');
const XFollowersService = require('../../services/xFollowersService');
const PermissionService = require('../../services/permissionService');
const logger = require('../../../utils/logger');

class XFollowersManagement {
  static registerHandlers(bot) {
    // Command to show X followers management menu
    bot.command('xfollowers', this.showMenu.bind(this));

    // Callback handlers
    bot.action('xfollowers_menu', this.showMenu.bind(this));
    bot.action('xfollowers_analyze', this.showAnalyzePrompt.bind(this));
    bot.action('xfollowers_unfollow', this.showUnfollowConfirm.bind(this));
    bot.action('xfollowers_unfollow_confirm', this.executeUnfollow.bind(this));
    bot.action('xfollowers_unfollow_dryrun', this.executeDryRun.bind(this));

    // Text input for X User ID
    bot.hears(/^[\d]+$/, this.handleUserIdInput.bind(this));
  }

  static async showMenu(ctx) {
    // Check admin permission
    const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
    if (!isAdmin) {
      return ctx.reply('❌ Solo administradores pueden usar este comando');
    }

    const message = `
🐦 *Gestión de Followers en X*

Utiliza este panel para gestionar tus followers en X (Twitter):
• Analizar followers que no te siguen de vuelta
• Ver estadísticas de followers
• Deseguir en batch

*¿Qué deseas hacer?*
    `;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📊 Analizar Non-Mutuals', 'xfollowers_analyze')],
        [Markup.button.callback('🔄 Deseguir (Dry Run)', 'xfollowers_unfollow_dryrun')],
        [Markup.button.callback('⚠️ Deseguir (Real)', 'xfollowers_unfollow_confirm')],
      ]).reply_markup,
    }).catch(error => {
      ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('📊 Analizar Non-Mutuals', 'xfollowers_analyze')],
          [Markup.button.callback('🔄 Deseguir (Dry Run)', 'xfollowers_unfollow_dryrun')],
          [Markup.button.callback('⚠️ Deseguir (Real)', 'xfollowers_unfollow_confirm')],
        ]).reply_markup,
      });
    });
  }

  static async showAnalyzePrompt(ctx) {
    const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
    if (!isAdmin) {
      return ctx.answerCbQuery('❌ No tienes permisos');
    }

    ctx.session.temp = ctx.session.temp || {};
    ctx.session.temp.xFollowersAction = 'analyze';

    await ctx.answerCbQuery();
    await ctx.reply(
      '📝 *Envía tu X User ID*\n\nEjemplo: `1234567890`\n\nPuedes encontrarlo en: https://twitter.com/settings/account/username',
      { parse_mode: 'Markdown' }
    );
  }

  static async showUnfollowConfirm(ctx) {
    const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
    if (!isAdmin) {
      return ctx.answerCbQuery('❌ No tienes permisos');
    }

    ctx.session.temp = ctx.session.temp || {};
    ctx.session.temp.xFollowersAction = 'unfollow_real';

    await ctx.answerCbQuery();
    await ctx.reply(
      '⚠️ *ADVERTENCIA: Acción Irreversible*\n\nEstas a punto de deseguir a TODOS los usuarios que no te siguen de vuelta.\n\n📝 Envía tu X User ID para confirmar:\n\nEjemplo: `1234567890`',
      { parse_mode: 'Markdown' }
    );
  }

  static async executeDryRun(ctx) {
    const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
    if (!isAdmin) {
      return ctx.answerCbQuery('❌ No tienes permisos');
    }

    ctx.session.temp = ctx.session.temp || {};
    ctx.session.temp.xFollowersAction = 'unfollow_dry';

    await ctx.answerCbQuery();
    await ctx.reply(
      '🔄 *Dry Run - Sin cambios reales*\n\nEsto analizará pero NO deseguirá a nadie.\n\n📝 Envía tu X User ID:\n\nEjemplo: `1234567890`',
      { parse_mode: 'Markdown' }
    );
  }

  static async handleUserIdInput(ctx) {
    const userId = ctx.message.text.trim();
    const action = ctx.session?.temp?.xFollowersAction;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;

    if (!action) {
      return;
    }

    if (!accessToken || accessToken.startsWith('YOUR_')) {
      return ctx.reply('❌ Error: No hay credenciales de X configuradas en .env');
    }

    try {
      const typing = await ctx.sendChatAction('typing');

      let message = '';
      let results = null;

      if (action === 'analyze') {
        message = '📊 Analizando followers...';
        await ctx.reply(message);

        results = await XFollowersService.findNonMutuals(userId, accessToken);

        const reply = `
✅ *Análisis Completado*

👥 **Estadísticas:**
• Seguidores totales: ${results.followers}
• Siguiendo: ${results.following}
• No-mutuals (sigues pero no te siguen): *${results.nonMutualsCount}*

*Top 10 Non-Mutuals:*
${results.nonMutuals.slice(0, 10).map((u, i) => `${i + 1}. @${u.username} (${u.name})`).join('\n')}

${results.nonMutualsCount > 10 ? `\n... y ${results.nonMutualsCount - 10} más` : ''}
        `;

        await ctx.reply(reply, { parse_mode: 'Markdown' });
      } else if (action === 'unfollow_dry') {
        message = '🔄 Ejecutando dry run (sin cambios reales)...';
        await ctx.reply(message);

        results = await XFollowersService.unfollowNonMutuals(userId, accessToken, true);

        const reply = `
✅ *Dry Run Completado*

📋 **Resultados:**
• Non-mutuals encontrados: ${results.totalNonMutuals}
• Que se deseguirían: ${results.unfollowed}
• Errores: ${results.failed}

⚠️ *Esto es un dry run - no se hizo nada real*

Para proceder con el deseguimiento, usa: /xfollowers
        `;

        await ctx.reply(reply, { parse_mode: 'Markdown' });
      } else if (action === 'unfollow_real') {
        message = '⚠️ DESEGUIENDO (acción real)...';
        await ctx.reply(message);

        results = await XFollowersService.unfollowNonMutuals(userId, accessToken, false);

        const reply = `
✅ *Deseguimiento Completado*

📋 **Resultados:**
• Non-mutuals encontrados: ${results.totalNonMutuals}
• Deseguidos exitosamente: *${results.unfollowed}*
• Errores: ${results.failed}

${results.failed > 0 ? `\n⚠️ **Errores:**\n${results.errors.slice(0, 5).map(e => `• @${e.username}: ${e.error}`).join('\n')}` : ''}
        `;

        await ctx.reply(reply, { parse_mode: 'Markdown' });

        // Save to database
        try {
          await XFollowersService.saveUnfollowResults(userId, results);
        } catch (error) {
          logger.error('Error saving unfollow results', { error });
        }
      }

      ctx.session.temp.xFollowersAction = null;
    } catch (error) {
      logger.error('Error in xFollowers handler', { error, action });
      ctx.reply(`❌ Error: ${error.message || 'Unknown error'}`);
      ctx.session.temp.xFollowersAction = null;
    }
  }

  static async executeUnfollow(ctx) {
    const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
    if (!isAdmin) {
      return ctx.answerCbQuery('❌ No tienes permisos');
    }

    await ctx.answerCbQuery();
    ctx.session.temp = ctx.session.temp || {};
    ctx.session.temp.xFollowersAction = 'unfollow_real';

    await ctx.reply(
      '⚠️ *CONFIRMACIÓN FINAL*\n\nEstas a punto de deseguir a TODOS los usuarios que no te siguen de vuelta.\n\n*Esta acción es IRREVERSIBLE*\n\n📝 Envía tu X User ID para CONFIRMAR:\n\nEjemplo: `1234567890`',
      { parse_mode: 'Markdown' }
    );
  }
}

module.exports = XFollowersManagement;
