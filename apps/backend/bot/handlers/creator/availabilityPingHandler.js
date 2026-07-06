'use strict';

const { getRedis } = require('../../../config/redis');
const logger = require('../../../utils/logger');

const ACCEPTING_CALLS_KEY = (id) => `user:${id}:accepting_calls`;
const ACCEPTING_CALLS_TTL_SECONDS = 60 * 60;

function emitAcceptingCallsChanged(userId, accepting) {
  try {
    const socketSingleton = require('../../../services/socketSingleton');
    const io = socketSingleton.get();
    if (io) io.to(`creator:${userId}:public`).emit('creator:accepting_calls_changed', { creatorId: userId, accepting });
  } catch {
    // non-fatal
  }
}

function registerAvailabilityPingHandlers(bot) {
  // "💚 Sí, 60 min más" — renews the Redis TTL
  bot.action(/^avail_ping_yes:(.+)$/, async (ctx) => {
    try {
      const userId = ctx.match[1];
      if (String(ctx.from?.id) !== String(userId)) {
        return ctx.answerCbQuery('❌ No autorizado').catch(() => {});
      }
      await ctx.answerCbQuery('✅ ¡Renovado!');
      const redis = getRedis();
      if (redis) {
        await redis.set(ACCEPTING_CALLS_KEY(userId), '1', 'EX', ACCEPTING_CALLS_TTL_SECONDS);
      }
      emitAcceptingCallsChanged(userId, true);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('✅ Disponibilidad renovada por 60 minutos. Te avisaremos antes de que expire.');
    } catch (err) {
      logger.warn('[availabilityPingHandler] avail_ping_yes error', { error: err.message });
    }
  });

  // "🔴 Ya terminé" — removes the key
  bot.action(/^avail_ping_no:(.+)$/, async (ctx) => {
    try {
      const userId = ctx.match[1];
      if (String(ctx.from?.id) !== String(userId)) {
        return ctx.answerCbQuery('❌ No autorizado').catch(() => {});
      }
      await ctx.answerCbQuery('👋 Desactivado');
      const redis = getRedis();
      if (redis) {
        await redis.del(ACCEPTING_CALLS_KEY(userId));
      }
      emitAcceptingCallsChanged(userId, false);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('👋 Disponibilidad desactivada. Reactívala cuando quieras desde tu estudio.');
    } catch (err) {
      logger.warn('[availabilityPingHandler] avail_ping_no error', { error: err.message });
    }
  });
}

module.exports = { registerAvailabilityPingHandlers };
