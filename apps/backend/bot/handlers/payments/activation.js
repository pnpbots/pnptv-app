const logger = require('../../../utils/logger');
const { query } = require('../../../utils/db');
const { requirePrivateChat } = require('../../utils/notifications');
const { getLanguage } = require('../../utils/helpers');
const PermissionService = require('../../services/permissionService');
const MessageTemplates = require('../../services/messageTemplates');
const supportRoutingService = require('../../services/supportRoutingService');
const UserModel = require('../../../models/userModel');
const { createChatInviteLink } = require('../../utils/telegramAdmin');
const BusinessNotificationService = require('../../services/businessNotificationService');
const PaymentHistoryService = require('../../../services/paymentHistoryService');

const PRIME_FALLBACK_LINK = 'https://t.me/PNPTV_PRIME';

const normalizeCode = (raw) => (raw || '').trim().toUpperCase().replace(/\s+/g, '');

const isValidCode = (code) => /^[A-Z0-9-]{6,50}$/.test(code);

const isExpired = (expiresAt) => {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() < Date.now();
};

const getPrimeInviteLink = async (ctx, userId) => {
  const primeChannelId = process.env.PRIME_CHANNEL_ID;
  if (!primeChannelId) return PRIME_FALLBACK_LINK;

  try {
    const inviteLink = await createChatInviteLink(
      ctx,
      primeChannelId,
      `activation_${userId}_${Date.now()}`,
      1
    );
    return inviteLink || PRIME_FALLBACK_LINK;
  } catch (error) {
    logger.warn('Failed to create PRIME invite link, using fallback', { userId, error: error.message });
    return PRIME_FALLBACK_LINK;
  }
};

const fetchActivationCode = async (code) => {
  const result = await query(
    `SELECT code, product, used, used_at, used_by, used_by_username, email, expires_at, created_at
     FROM activation_codes
     WHERE code = $1`,
    [code]
  );
  return result.rows[0] || null;
};

const markCodeUsed = async (code, userId, username) => {
  const result = await query(
    `UPDATE activation_codes
     SET used = true, used_at = NOW(), used_by = $2, used_by_username = $3
     WHERE code = $1 AND used = false`,
    [code, String(userId), username || null]
  );
  return result.rowCount > 0;
};

const logActivation = async ({ userId, username, code, product, success }) => {
  await query(
    `INSERT INTO activation_logs (user_id, username, code, product, success)
     VALUES ($1, $2, $3, $4, $5)`,
    [String(userId), username || null, code, product || null, Boolean(success)]
  );
};

const buildCheckcodeResponse = (row) => {
  return [
    '📊 *Code Information*',
    '',
    `Code: \`${row.code}\``,
    `Product: ${row.product || 'lifetime-pass'}`,
    `Used: ${row.used ? 'Yes' : 'No'}`,
    `Used At: ${row.used_at || 'N/A'}`,
    `Used By: ${row.used_by || 'N/A'}`,
    `Username: ${row.used_by_username || 'N/A'}`,
    `Created At: ${row.created_at || 'N/A'}`,
    `Expires At: ${row.expires_at || 'N/A'}`,
    `Email: ${row.email || 'N/A'}`,
  ].join('\n');
};

const activateMembership = async ({ ctx, userId, planId, product, successMessage }) => {
  const updated = await UserModel.updateSubscription(userId, {
    status: 'active',
    planId,
    expiry: null,
  });

  if (!updated) {
    await ctx.reply('❌ Error al activar la membresía. Inténtalo de nuevo más tarde.');
    return false;
  }

  if (successMessage) {
    await ctx.reply(successMessage, { parse_mode: 'Markdown', disable_web_page_preview: true });
  }

  logger.info('Membership activated via activation code', { userId, planId, product });
  return true;
};

const registerActivationHandlers = (bot) => {
  // /activate CODE
  bot.hears(/^\/(activate|activar)\s+(.+)$/i, async (ctx) => {
    try {
      const isPrivate = await requirePrivateChat(ctx, 'Activate', 'Please send the activation code here in private.');
      if (!isPrivate) return;

      const lang = getLanguage(ctx);
      const rawCode = ctx.match?.[2] || '';
      const code = normalizeCode(rawCode);

      if (!isValidCode(code)) {
        await ctx.reply(lang === 'es'
          ? '❌ Código inválido. Verifica que hayas ingresado el código correctamente.'
          : '❌ Invalid code. Please check that you entered the code correctly.');
        return;
      }

      const activation = await fetchActivationCode(code);
      if (!activation) {
        await ctx.reply(lang === 'es'
          ? '❌ Código inválido. Verifica que hayas ingresado el código correctamente.'
          : '❌ Invalid code. Please check that you entered the code correctly.');
        return;
      }

      if (activation.used) {
        await ctx.reply(lang === 'es'
          ? '❌ Este código ya ha sido utilizado.\n\nCada código solo puede ser activado una vez.'
          : '❌ This code has already been used.\n\nEach code can only be activated once.');
        return;
      }

      if (isExpired(activation.expires_at)) {
        await ctx.reply(lang === 'es'
          ? '❌ Este código ha expirado. Contacta soporte para ayuda.'
          : '❌ This code has expired. Please contact support for help.');
        return;
      }

      const product = activation.product || 'lifetime-pass';
      if (product === 'lifetime100-promo' || product === 'lifetime100_promo') {
        await ctx.reply(lang === 'es'
          ? '📝 Este código es para Lifetime100. Por favor usa: /lifetime100 TU_CODIGO'
          : '📝 This code is for Lifetime100. Please use: /lifetime100 YOUR_CODE');
        return;
      }

      const planId = 'lifetime_pass';
      const successMessage = MessageTemplates.buildLifetimePassMessage(lang);

      const activated = await activateMembership({
        ctx,
        userId: ctx.from.id,
        planId,
        product,
        successMessage,
      });

      if (!activated) return;

      const codeMarked = await markCodeUsed(code, ctx.from.id, ctx.from.username);
      if (!codeMarked) {
        logger.warn('Activation code was not marked as used (possible race)', { code, userId: ctx.from.id });
      }

      await logActivation({
        userId: ctx.from.id,
        username: ctx.from.username,
        code,
        product,
        success: true,
      });

      BusinessNotificationService.notifyCodeActivation({
        userId: ctx.from.id,
        username: ctx.from.username,
        code,
        product,
      }).catch(() => {});

      const inviteLink = await getPrimeInviteLink(ctx, ctx.from.id);
      await ctx.reply(
        lang === 'es'
          ? `🌟 Accede al canal PRIME:\n👉 ${inviteLink}`
          : `🌟 Access the PRIME channel:\n👉 ${inviteLink}`,
        { disable_web_page_preview: true }
      );
    } catch (error) {
      logger.error('Error in /activate handler:', error);
      await ctx.reply('❌ Error al procesar tu activación. Inténtalo de nuevo más tarde.');
    }
  });

  // /checkcode CODE (admin)
  bot.hears(/^\/checkcode\s+(.+)$/i, async (ctx) => {
    try {
      const isPrivate = await requirePrivateChat(ctx, 'CheckCode', 'Please send the code here in private.');
      if (!isPrivate) return;

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const code = normalizeCode(ctx.match?.[1] || '');
      if (!isValidCode(code)) {
        await ctx.reply('❌ Código inválido.');
        return;
      }

      const activation = await fetchActivationCode(code);
      if (!activation) {
        await ctx.reply('❌ Código no encontrado.');
        return;
      }

      await ctx.reply(buildCheckcodeResponse(activation), { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /checkcode handler:', error);
      await ctx.reply('❌ Error al verificar el código.');
    }
  });

  // /lifetime100 CODE
  bot.hears(/^\/lifetime100\s+(.+)$/i, async (ctx) => {
    try {
      const isPrivate = await requirePrivateChat(ctx, 'Lifetime100', 'Please send the code here in private.');
      if (!isPrivate) return;

      const lang = getLanguage(ctx);
      const code = normalizeCode(ctx.match?.[1] || '');

      if (!isValidCode(code)) {
        await ctx.reply(lang === 'es'
          ? '❌ Código inválido. Verifica que hayas ingresado el código correctamente.'
          : '❌ Invalid code. Please check that you entered the code correctly.');
        return;
      }

      const activation = await fetchActivationCode(code);
      if (!activation) {
        await ctx.reply(lang === 'es'
          ? '❌ Código inválido. Verifica que hayas ingresado el código correctamente.'
          : '❌ Invalid code. Please check that you entered the code correctly.');
        return;
      }

      if (activation.used) {
        await ctx.reply(lang === 'es'
          ? '❌ Este código ya ha sido utilizado.\n\nCada código solo puede ser activado una vez.'
          : '❌ This code has already been used.\n\nEach code can only be activated once.');
        return;
      }

      if (isExpired(activation.expires_at)) {
        await ctx.reply(lang === 'es'
          ? '❌ Este código ha expirado. Contacta soporte para ayuda.'
          : '❌ This code has expired. Please contact support for help.');
        return;
      }

      const product = activation.product || '';
      if (product !== 'lifetime100-promo' && product !== 'lifetime100_promo') {
        await ctx.reply(lang === 'es'
          ? '❌ Este código no pertenece a Lifetime100. Usa /activate para activarlo.'
          : '❌ This code is not for Lifetime100. Use /activate to redeem it.');
        return;
      }

      if (!ctx.session.temp) ctx.session.temp = {};
      ctx.session.temp.lifetime100Activation = { code };
      await ctx.saveSession();

      await ctx.reply(
        lang === 'es'
          ? '📝 Por favor adjunta tu recibo de pago como respuesta a este mensaje.\n\nPuedes enviar una imagen o documento.'
          : '📝 Please attach your payment receipt as a reply to this message.\n\nYou can send an image or document.'
      );
    } catch (error) {
      logger.error('Error in /lifetime100 handler:', error);
      await ctx.reply('❌ Error al procesar tu solicitud.');
    }
  });

  // Lifetime100 receipt handler
  bot.on('message', async (ctx, next) => {
    try {
      if (ctx.chat?.type !== 'private') return next();

      const pending = ctx.session?.temp?.lifetime100Activation;
      if (!pending?.code) return next();

      if (ctx.message?.text?.startsWith('/')) {
        ctx.session.temp.lifetime100Activation = null;
        await ctx.saveSession();
        return next();
      }

      const hasPhoto = Boolean(ctx.message?.photo);
      const hasDoc = Boolean(ctx.message?.document);
      if (!hasPhoto && !hasDoc) {
        await ctx.reply('❌ Por favor envía una imagen o documento del recibo.');
        return;
      }

      const code = pending.code;
      const receiptNote = `🧾 *Lifetime100 Receipt*\n\nCódigo: \`${code}\``;

      try {
        const messageType = hasPhoto ? 'photo' : 'document';
        const originalCaption = ctx.message.caption || '';
        ctx.message.caption = [receiptNote, originalCaption].filter(Boolean).join('\n\n');
        await supportRoutingService.sendToSupportGroup(receiptNote, 'activation', ctx.from, messageType, ctx);
      } catch (sendError) {
        logger.error('Failed to forward Lifetime100 receipt to support:', sendError);
        await ctx.reply('⚠️ Recibo recibido, pero hubo un error al notificar al equipo. Intentaremos de nuevo.');
      }

      ctx.session.temp.lifetime100Activation = null;
      await ctx.saveSession();

      await ctx.reply('✅ Recibo recibido. Nuestro equipo revisará y activará tu cuenta pronto.');
      return;
    } catch (error) {
      logger.error('Error handling lifetime100 receipt:', error);
      return next();
    }
  });

  // /activate_lifetime100 USERID CODE (admin)
  bot.hears(/^\/activate_lifetime100\s+(\d+)\s+(.+)$/i, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const targetUserId = ctx.match?.[1];
      const code = normalizeCode(ctx.match?.[2] || '');

      if (!targetUserId || !isValidCode(code)) {
        await ctx.reply('❌ Uso: /activate_lifetime100 USERID CODE');
        return;
      }

      const activation = await fetchActivationCode(code);
      if (!activation) {
        await ctx.reply('❌ Código no encontrado.');
        return;
      }

      if (activation.used) {
        await ctx.reply('❌ Este código ya fue usado.');
        return;
      }

      const product = activation.product || '';
      if (product !== 'lifetime100-promo' && product !== 'lifetime100_promo') {
        await ctx.reply('❌ Este código no pertenece a Lifetime100.');
        return;
      }

      const targetUser = await UserModel.getById(targetUserId);
      const lang = targetUser?.language || 'es';

      const successMessage = MessageTemplates.buildLifetime100PromoMessage(lang);
      const activated = await activateMembership({
        ctx,
        userId: targetUserId,
        planId: 'lifetime100_promo',
        product,
        successMessage,
      });

      if (!activated) return;

      const codeMarked = await markCodeUsed(code, targetUserId, targetUser?.username);
      if (!codeMarked) {
        logger.warn('Lifetime100 code was not marked as used (possible race)', { code, targetUserId });
      }

      await logActivation({
        userId: targetUserId,
        username: targetUser?.username,
        code,
        product,
        success: true,
      });

      // Record payment in history
      try {
        await PaymentHistoryService.recordPayment({
          userId: targetUserId,
          paymentMethod: 'lifetime100',
          amount: 100,  // Standard lifetime100 price
          currency: 'USD',
          planId: 'lifetime100_promo',
          planName: 'Lifetime100 Promo',
          product: product || 'lifetime100-promo',
          paymentReference: code,  // Activation code is the payment reference
          status: 'completed',
          metadata: {
            activated_by: ctx.from.id,
            activated_by_username: ctx.from.username,
            manual_activation: true,
            activation_code: code,
          },
        });
      } catch (historyError) {
        logger.warn('Failed to record lifetime100 payment in history (non-critical):', {
          error: historyError.message,
          userId: targetUserId,
          code,
        });
      }

      BusinessNotificationService.notifyCodeActivation({
        userId: targetUserId,
        username: targetUser?.username,
        code,
        product,
      }).catch(() => {});

      const inviteLink = await getPrimeInviteLink(ctx, targetUserId);
      await ctx.telegram.sendMessage(
        targetUserId,
        lang === 'es'
          ? `🌟 Accede al canal PRIME:\n👉 ${inviteLink}`
          : `🌟 Access the PRIME channel:\n👉 ${inviteLink}`,
        { disable_web_page_preview: true }
      ).catch(() => {});

      await ctx.reply(`✅ Lifetime100 promo activado para usuario ${targetUserId} con código ${code}`);
    } catch (error) {
      logger.error('Error in /activate_lifetime100 handler:', error);
      await ctx.reply('❌ Error al activar Lifetime100.');
    }
  });
};

module.exports = registerActivationHandlers;
module.exports.activateMembership = activateMembership;
module.exports.getPrimeInviteLink = getPrimeInviteLink;
module.exports.fetchActivationCode = fetchActivationCode;
module.exports.markCodeUsed = markCodeUsed;
module.exports.logActivation = logActivation;
