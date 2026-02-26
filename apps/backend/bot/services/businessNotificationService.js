const logger = require('../../utils/logger');

const CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;

class BusinessNotificationService {
  static bot = null;

  static initialize(bot) {
    this.bot = bot;
    if (!CHANNEL_ID) {
      logger.warn('NOTIFICATION_CHANNEL_ID not set — business notifications disabled');
    } else {
      logger.info('Business notification service initialized', { channelId: CHANNEL_ID });
    }
  }

  static async send(message) {
    if (!this.bot || !CHANNEL_ID) return;
    try {
      await this.bot.telegram.sendMessage(CHANNEL_ID, message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Business notification send failed:', {
        error: error.message,
        channelId: CHANNEL_ID,
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
    await this.send(msg);
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
    await this.send(msg);
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
    await this.send(msg);
  }

  static async notifyCleanupSummary({ statusUpdates, channelKicks }) {
    const msg = [
      '🧹 <b>LIMPIEZA DIARIA DE MEMBRESÍAS</b>',
      '',
      '📊 Resultados:',
      `• Canceladas (churned): ${statusUpdates?.toChurned || 0}`,
      `• Cambiadas a free: ${statusUpdates?.toFree || 0}`,
      `• Removidos de PRIME: ${channelKicks?.kicked || 0}`,
      `• Errores: ${(statusUpdates?.errors || 0) + (channelKicks?.failed || 0)}`,
      `📅 Fecha: ${this.formatDate()}`,
    ].join('\n');
    await this.send(msg);
  }
}

module.exports = BusinessNotificationService;
