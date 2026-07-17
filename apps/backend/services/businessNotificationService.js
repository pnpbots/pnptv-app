const logger = require('../utils/logger');

const CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;

// Forum topics inside the notifications group. All fall back to NOTIFICATIONS_TOPIC_ID
// when a category-specific ID isn't configured; that in turn falls back to no topic
// (posts to the group's General topic) if the chat isn't a forum.
const TOPIC_FALLBACK = process.env.NOTIFICATIONS_TOPIC_ID
  ? Number(process.env.NOTIFICATIONS_TOPIC_ID) : null;
const TOPICS = {
  payment:        process.env.PAYMENTS_TOPIC_ID,
  planActivated:  process.env.PLANS_ACTIVATED_TOPIC_ID,
  newUser:        process.env.NEW_USERS_TOPIC_ID,
  codeActivation: process.env.CODE_ACTIVATIONS_TOPIC_ID,
  cleanup:        process.env.CLEANUP_SUMMARY_TOPIC_ID,
  creatorSub:     process.env.CREATOR_SUBS_TOPIC_ID,
  inviteRedeem:   process.env.INVITE_REDEMPTIONS_TOPIC_ID,
  tokenPurchase:  process.env.TOKEN_PURCHASES_TOPIC_ID,
};
function resolveTopic(kind) {
  const raw = TOPICS[kind];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : TOPIC_FALLBACK;
}

class BusinessNotificationService {
  static bot = null;

  static initialize(bot) {
    this.bot = bot;
    if (!CHANNEL_ID) {
      logger.warn('NOTIFICATION_CHANNEL_ID not set — business notifications disabled');
    } else {
      logger.info('Business notification service initialized', {
        channelId: CHANNEL_ID,
        topicFallback: TOPIC_FALLBACK,
        topicsConfigured: Object.entries(TOPICS)
          .filter(([, v]) => v).map(([k]) => k),
      });
    }
  }

  static async send(message, kind = null) {
    if (!this.bot || !CHANNEL_ID) return;
    try {
      const opts = { parse_mode: 'HTML' };
      const threadId = kind ? resolveTopic(kind) : TOPIC_FALLBACK;
      if (threadId) opts.message_thread_id = threadId;
      await this.bot.telegram.sendMessage(CHANNEL_ID, message, opts);
    } catch (error) {
      logger.error('Business notification send failed:', {
        error: error.message,
        channelId: CHANNEL_ID,
        kind,
      });
    }
  }

  static formatDate() {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  }

  static async notifyPayment({ userId, planName, amount, provider, transactionId, customerName }) {
    const txShort = transactionId
      ? (transactionId.length > 20 ? transactionId.slice(0, 20) + '...' : transactionId)
      : 'N/A';
    const msg = [
      '💰 <b>PAGO RECIBIDO</b>',
      '',
      `👤 Cliente: ${customerName || 'Desconocido'} (ID: ${userId})`,
      `📦 Plan: ${planName || 'N/A'}`,
      `💵 Monto: $${parseFloat(amount || 0).toFixed(2)} USD`,
      `🏦 Proveedor: ${provider || 'N/A'}`,
      `🔗 TX: <code>${txShort}</code>`,
      `📅 Fecha: ${this.formatDate()}`,
    ].join('\n');
    await this.send(msg, 'payment');
  }

  static async notifyNewUser({ userId, username, firstName, language }) {
    const name = firstName || 'N/A';
    const user = username ? `@${username}` : 'sin username';
    const msg = [
      '👤 <b>NUEVO USUARIO</b>',
      '',
      `🆔 ID: ${userId}`,
      `📛 Nombre: ${name} (${user})`,
      `🌐 Idioma: ${language || 'N/A'}`,
      `📅 Fecha: ${this.formatDate()}`,
    ].join('\n');
    await this.send(msg, 'newUser');
  }

  static async notifyCodeActivation({ userId, username, code, product }) {
    const user = username ? `@${username}` : 'sin username';
    const msg = [
      '🔑 <b>CODIGO ACTIVADO</b>',
      '',
      `👤 Usuario: ${user} (ID: ${userId})`,
      `🔢 Codigo: <code>${code}</code>`,
      `📦 Producto: ${product || 'N/A'}`,
      `📅 Fecha: ${this.formatDate()}`,
    ].join('\n');
    await this.send(msg, 'codeActivation');
  }

  static async notifyCleanupSummary({ statusUpdates, channelAdds, channelKicks }) {
    const totalErrors = (statusUpdates?.errors || 0) + (channelKicks?.failed || 0) + (channelAdds?.failed || 0);
    const msg = [
      '🧹 <b>LIMPIEZA DIARIA DE MEMBRESÍAS</b>',
      '',
      '📊 Resultados:',
      `• Canceladas (churned): ${statusUpdates?.toChurned || 0}`,
      `• Cambiadas a free: ${statusUpdates?.toFree || 0}`,
      `• Añadidos a PRIME: ${channelAdds?.added || 0}`,
      `• Removidos de PRIME: ${channelKicks?.kicked || 0}`,
      `• Errores: ${totalErrors}`,
      `📅 Fecha: ${this.formatDate()}`,
    ].join('\n');
    await this.send(msg, 'cleanup');
  }

  /**
   * Fired after grantEntitlementsForPlan succeeds.
   * addOns: [{add_on_id, add_on_name, is_lifetime, durationDays}]
   */
  static async notifyEntitlementGrant({ userId, planId, planName, addOns = [], source, sourcePaymentId, scopeLabel }) {
    try {
      // Non-blocking username lookup
      const { query } = require('../config/postgres');
      const userRow = await query('SELECT username, first_name FROM users WHERE id = $1', [String(userId)]).catch(() => ({ rows: [] }));
      const u = userRow.rows[0];
      const userLabel = u?.username ? `@${u.username}` : (u?.first_name || 'N/A');

      const accessLines = addOns.map(({ add_on_name, add_on_id, is_lifetime, durationDays }) => {
        const name = add_on_name || add_on_id;
        if (is_lifetime) return `  • ${name} — ♾ de por vida`;
        const days = durationDays || 30;
        const exp = new Date(Date.now() + days * 86400000);
        const expStr = exp.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });
        return `  • ${name} — hasta ${expStr} (${days}d)`;
      });

      const refShort = sourcePaymentId
        ? (sourcePaymentId.length > 24 ? sourcePaymentId.slice(0, 24) + '…' : sourcePaymentId)
        : null;

      const lines = [
        '🎫 <b>ACCESO OTORGADO</b>',
        '',
        `👤 Usuario: ${userLabel} (ID: <code>${userId}</code>)`,
        `📦 Plan: ${planName || planId}`,
      ];
      if (scopeLabel) lines.push(`🔍 Alcance: ${scopeLabel}`);
      if (accessLines.length) {
        lines.push('🔑 Accesos:');
        lines.push(...accessLines);
      }
      lines.push(`💳 Fuente: ${source || 'system'}`);
      if (refShort) lines.push(`🔗 Ref: <code>${refShort}</code>`);
      lines.push(`📅 Fecha: ${this.formatDate()}`);

      await this.send(lines.join('\n'), 'planActivated');
    } catch (err) {
      logger.error('notifyEntitlementGrant failed', { userId, planId, error: err.message });
    }
  }

  /**
   * Fired after a creator subscription (new or renewal) is committed.
   */
  static async notifyCreatorSubscription({ subscriberId, subscriberUsername, creatorId, creatorUsername, priceUsd, expiresAt, paymentId, isRenewal }) {
    try {
      const subLabel = subscriberUsername ? `@${subscriberUsername}` : `ID ${subscriberId}`;
      const creatorLabel = creatorUsername ? `@${creatorUsername}` : `ID ${creatorId}`;
      const expStr = expiresAt
        ? new Date(expiresAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' })
        : 'N/A';
      const refShort = paymentId
        ? (String(paymentId).length > 24 ? String(paymentId).slice(0, 24) + '…' : String(paymentId))
        : null;

      const lines = [
        isRenewal ? '🔄 <b>RENOVACIÓN A CREADOR</b>' : '⭐ <b>SUSCRIPCIÓN A CREADOR</b>',
        '',
        `👤 Suscriptor: ${subLabel} (ID: <code>${subscriberId}</code>)`,
        `🎭 Creador: ${creatorLabel} (ID: <code>${creatorId}</code>)`,
        `💵 Precio: $${parseFloat(priceUsd || 0).toFixed(2)} USD`,
        `⏰ Vence: ${expStr}`,
      ];
      if (refShort) lines.push(`🔗 Ref: <code>${refShort}</code>`);
      lines.push(`📅 Fecha: ${this.formatDate()}`);

      await this.send(lines.join('\n'), 'creatorSub');
    } catch (err) {
      logger.error('notifyCreatorSubscription failed', { subscriberId, creatorId, error: err.message });
    }
  }

  /**
   * Fired after an invite link is successfully redeemed.
   */
  static async notifyInviteLinkRedemption({ userId, username, code, isLifetime, primeGranted, primeHours }) {
    try {
      const userLabel = username ? `@${username}` : `ID ${userId}`;
      const accessLines = [];
      if (isLifetime) accessLines.push('  • pnp-member — ♾ de por vida');
      if (primeGranted && primeHours) {
        const h = Number(primeHours);
        const exp = new Date(Date.now() + h * 3600000);
        const expStr = exp.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });
        accessLines.push(`  • prime — hasta ${expStr} (${h}h)`);
        if (!isLifetime) accessLines.push(`  • pnp-member — hasta ${expStr} (${h}h)`);
      }

      const lines = [
        '🔗 <b>INVITACIÓN CANJEADA</b>',
        '',
        `👤 Usuario: ${userLabel} (ID: <code>${userId}</code>)`,
        `🎫 Código: <code>${code}</code>`,
      ];
      if (accessLines.length) {
        lines.push('🔑 Accesos:');
        lines.push(...accessLines);
      }
      lines.push(`📅 Fecha: ${this.formatDate()}`);

      await this.send(lines.join('\n'), 'inviteRedeem');
    } catch (err) {
      logger.error('notifyInviteLinkRedemption failed', { userId, code, error: err.message });
    }
  }

  /**
   * Fired after tokens are credited to a user's wallet.
   */
  static async notifyTokenPurchase({ userId, tokens, usdAmount, invoiceId, newBalance }) {
    try {
      const { query } = require('../config/postgres');
      const userRow = await query('SELECT username, first_name FROM users WHERE id = $1', [String(userId)]).catch(() => ({ rows: [] }));
      const u = userRow.rows[0];
      const userLabel = u?.username ? `@${u.username}` : (u?.first_name || 'N/A');
      const refShort = invoiceId
        ? (invoiceId.length > 24 ? invoiceId.slice(0, 24) + '…' : invoiceId)
        : null;

      const lines = [
        '🪙 <b>TOKENS COMPRADOS</b>',
        '',
        `👤 Usuario: ${userLabel} (ID: <code>${userId}</code>)`,
        `🎯 Tokens: +${tokens} tokens`,
        `💰 Saldo nuevo: ${newBalance} tokens`,
        `💵 Monto: $${parseFloat(usdAmount || 0).toFixed(2)} USD`,
      ];
      if (refShort) lines.push(`🔗 Ref: <code>${refShort}</code>`);
      lines.push(`📅 Fecha: ${this.formatDate()}`);

      await this.send(lines.join('\n'), 'tokenPurchase');
    } catch (err) {
      logger.error('notifyTokenPurchase failed', { userId, tokens, error: err.message });
    }
  }
}

module.exports = BusinessNotificationService;
