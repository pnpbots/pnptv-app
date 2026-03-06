/**
 * Mono — Telegram bot handler (admin-only)
 * Usage: /mono <question>  OR  free-text message from admin
 */
const { chatWithMono } = require('../../services/monoService');
const PermissionService = require('../../services/permissionService');
const logger = require('../../../utils/logger');

const TYPING_INTERVAL = 4000;

async function handleMonoMessage(ctx, message) {
  const userId = ctx.from?.id;
  const isAdmin = await PermissionService.isAdmin(userId);
  if (!isAdmin) return false; // not handled

  const text = (message || '').trim();
  if (!text || text === '/mono') {
    await ctx.reply(
      'Hola, soy Mono. Preguntame lo que quieras sobre PNPtv — miembros top, ingresos, installs, campanas, todo.\n\nEj: "quienes son los mejores candidatos para modelos?" o "cuantos installs tenemos?"',
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  // Show typing indicator
  let typingInterval;
  try {
    await ctx.sendChatAction('typing');
    typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), TYPING_INTERVAL);

    const reply = await chatWithMono({
      message: text,
      historyKey: String(userId),
    });

    clearInterval(typingInterval);
    // Split long messages (Telegram limit 4096)
    if (reply.length <= 4000) {
      await ctx.reply(reply, { parse_mode: 'Markdown' }).catch(() => ctx.reply(reply));
    } else {
      const chunks = reply.match(/.{1,4000}(\n|$)/gs) || [reply];
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => ctx.reply(chunk));
      }
    }
  } catch (err) {
    clearInterval(typingInterval);
    logger.error('Mono Telegram error', { error: err.message });
    await ctx.reply('Mono no pudo responder ahora. Intenta de nuevo en un momento.');
  }
  return true;
}

function registerMonoHandlers(bot) {
  // /mono command
  bot.command('mono', async (ctx) => {
    const query = ctx.message?.text?.replace(/^\/mono\s*/i, '').trim() || '';
    await handleMonoMessage(ctx, query);
  });

  logger.info('Mono handler registered');
}

module.exports = { registerMonoHandlers, handleMonoMessage };
