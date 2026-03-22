const PlatformBanService = require('../../services/platformBanService');
const ModerationModel    = require('../../../models/moderationModel');
const UserModel          = require('../../../models/userModel');
const logger             = require('../../../utils/logger');

const BAN_MESSAGE =
  '🚫 *Tu cuenta ha sido suspendida permanentemente.*\n\n' +
  'Valoramos profundamente a nuestra comunidad y trabajamos cada día para mantenerla ' +
  'segura, respetuosa e íntegra para todos nuestros miembros. 💛\n\n' +
  'Lamentablemente, esta decisión es *definitiva y sin apelación*. ' +
  'No existen segundas oportunidades para quienes comprometen la confianza de nuestra comunidad.\n\n' +
  '_PNPtv Team_ 🏳️‍🌈';

/**
 * Global ban check middleware
 * Blocks banned users from using the bot entirely.
 * Checks platform_bans (all identity vectors), users.tier='banned',
 * AND the legacy banned_users table.
 */
const globalBanCheck = () => async (ctx, next) => {
  try {
    const userId     = ctx.from?.id;
    const telegramId = String(userId || '');

    if (!userId) return next();

    // ── Fast path: users.tier='banned' ───────────────────────────────────────
    const user = await UserModel.getById(userId);
    if (user?.tier === 'banned') {
      await _sendBanMessage(ctx);
      return;
    }

    // ── Platform bans (all identity vectors) ─────────────────────────────────
    const ban = await PlatformBanService.isBanned({
      userId:     telegramId,
      telegramId: telegramId,
      pnptvId:    user?.pnptv_id    || undefined,
      email:      user?.email       || undefined,
      xId:        user?.x_id        || undefined,
    });

    if (ban) {
      logger.warn('globalBanCheck — platform ban hit', { userId, banId: ban.id });
      await _sendBanMessage(ctx);
      return;
    }

    // ── Legacy banned_users table ─────────────────────────────────────────────
    if (await ModerationModel.isUserBanned(userId, 'global')) {
      logger.info('globalBanCheck — legacy ban hit', { userId });
      await _sendBanMessage(ctx);
      return;
    }

    return next();
  } catch (error) {
    logger.error('globalBanCheck — error, dropping update (fail-closed)', { error: error.message });
    return; // fail-closed: silently drop the update rather than bypass ban check
  }
};

async function _sendBanMessage(ctx) {
  if (ctx.chat?.type !== 'private') return;
  try {
    await ctx.reply(BAN_MESSAGE, { parse_mode: 'Markdown' });
  } catch (e) {
    logger.debug('globalBanCheck — could not send ban message', { error: e.message });
  }
}

module.exports = globalBanCheck;
