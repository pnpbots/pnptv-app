const { Markup } = require('telegraf');
const PermissionService = require('../../services/permissionService');
const XPostService = require('../../services/xPostService');
const XOAuthService = require('../../services/xOAuthService');
const logger = require('../../../utils/logger');

const DEFAULT_SESSION_KEY = 'sharePostData';

const DEFAULT_OPTIONS = {
  sessionKey: DEFAULT_SESSION_KEY,
  actionPrefix: 'share_post',
  backAction: 'share_post_preview',
  title: '🐦 *Publicar en X*',
  emptyTitle: '🐦 *Publicar en X*',
  emptyBody: 'No hay cuentas activas configuradas.\nPuedes conectar una nueva cuenta ahora mismo.',
  prompt: 'Selecciona la cuenta desde la cual se publicará:',
  connectLabel: '➕ Conectar cuenta X',
  disableLabel: '🚫 No publicar en X',
  allowDisconnect: false,
  disconnectLabel: '🧹 Desconectar',
  accountActionPrefix: null,
  backLabel: '⬅️ Volver',
  notifyOnEmpty: true,
};

const getSessionData = (ctx, sessionKey) => {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.temp) ctx.session.temp = {};
  if (!ctx.session.temp[sessionKey]) {
    ctx.session.temp[sessionKey] = {
      postToX: false,
      xAccountId: null,
      xAccountHandle: null,
      xAccountDisplayName: null,
    };
  }
  return ctx.session.temp[sessionKey];
};

const safeAnswer = async (ctx, text, options = {}) => {
  if (!ctx?.answerCbQuery) return;
  try {
    if (text) {
      await ctx.answerCbQuery(text, options);
    } else {
      await ctx.answerCbQuery();
    }
  } catch (error) {
    const description = error?.response?.description || error?.message || '';
    if (
      description.includes('query is too old') ||
      description.includes('query ID is invalid') ||
      description.includes('response timeout')
    ) {
      logger.debug('Callback query expired (ignored)', { description });
      return;
    }
    logger.warn('Failed to answer callback query', { description });
  }
};

const safeEditOrReply = async (ctx, text, options = {}) => {
  if (ctx?.editMessageText && ctx?.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (error) {
      const description = error?.response?.description || error?.message || '';
      if (description.includes('message is not modified')) {
        return;
      }
      logger.warn('Failed to edit X accounts message', { description });
    }
  }

  try {
    await ctx.reply(text, options);
  } catch (error) {
    const description = error?.response?.description || error?.message || '';
    logger.warn('Failed to send X accounts message', { description });
  }
};

const buildButtons = (accounts, config, currentAccountId) => {
  const {
    actionPrefix,
    backAction,
    connectLabel,
    disableLabel,
    backLabel,
    allowDisconnect,
    disconnectLabel,
    accountActionPrefix,
  } = config;

  const accountPrefix = accountActionPrefix || actionPrefix;

  const buttons = accounts.map((account) => {
    const selected = currentAccountId === account.account_id;
    const label = `${selected ? '✅' : '⬜'} @${account.handle}`;
    const rows = [
      [Markup.button.callback(label, `${accountPrefix}_a_${account.account_id}`)],
    ];
    if (allowDisconnect) {
      rows.push([
        Markup.button.callback(
          `${disconnectLabel} @${account.handle}`,
          `${accountPrefix}_d_${account.account_id}`
        ),
      ]);
    }
    return rows;
  });

  const flattened = buttons.flat();
  flattened.push([Markup.button.callback(connectLabel, `${actionPrefix}_x_connect`)]);
  flattened.push([Markup.button.callback(disableLabel, `${actionPrefix}_x_disable`)]);
  flattened.push([Markup.button.callback(backLabel, backAction)]);

  return flattened;
};

const showXAccountSelection = async (ctx, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const session = getSessionData(ctx, config.sessionKey);
  const accounts = await XPostService.listActiveAccounts();
  const currentAccountId = session.xAccountId;
  const buttons = buildButtons(accounts, config, currentAccountId);

  const header = config.title;
  const body = accounts.length
    ? config.prompt
    : config.emptyBody;

  const replyOptions = {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  };

  if (accounts.length === 0 && config.notifyOnEmpty) {
    await safeEditOrReply(ctx, `${config.emptyTitle}\n\n${body}`, replyOptions);
    return;
  }

  await safeEditOrReply(ctx, `${header}\n\n${body}`, replyOptions);
};

const selectXAccount = async (ctx, accountId, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const session = getSessionData(ctx, config.sessionKey);
  const accounts = await XPostService.listActiveAccounts();
  const selected = accounts.find((account) => account.account_id === accountId);

  if (!selected) {
    await safeAnswer(ctx, '❌ Cuenta no válida');
    return;
  }

  session.postToX = true;
  session.xAccountId = selected.account_id;
  session.xAccountHandle = selected.handle;
  session.xAccountDisplayName = selected.display_name;
  if (ctx.session && typeof ctx.saveSession === 'function') {
    await ctx.saveSession();
  }

  await safeAnswer(ctx, `✅ Usando @${selected.handle}`);
  await showXAccountSelection(ctx, options);
};

const disableXPosting = async (ctx, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const session = getSessionData(ctx, config.sessionKey);
  session.postToX = false;
  session.xAccountId = null;
  session.xAccountHandle = null;
  session.xAccountDisplayName = null;
  if (ctx.session && typeof ctx.saveSession === 'function') {
    await ctx.saveSession();
  }

  await safeAnswer(ctx, '🚫 X desactivado');
  await showXAccountSelection(ctx, options);
};

const connectXAccount = async (ctx) => {
  try {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) {
      await ctx.answerCbQuery('❌ No autorizado');
      return;
    }
    const authUrl = await XOAuthService.createAuthUrl({
      adminId: ctx.from.id,
      adminUsername: ctx.from.username || null,
    });
    await safeAnswer(ctx);
    const message = '🔗 Conectar cuenta de X\n\n'
      + '1) Abre este enlace.\n'
      + '2) Autoriza la cuenta.\n'
      + '3) Regresa al bot y selecciona la cuenta.';
    await ctx.reply(
      message,
      Markup.inlineKeyboard([Markup.button.url('Abrir enlace', authUrl)])
    );
  } catch (error) {
    logger.error('Error starting X OAuth flow:', error);
    await ctx.answerCbQuery('❌ Error').catch(() => {});
    await ctx.reply('❌ No se pudo iniciar la conexión con X').catch(() => {});
  }
};

const registerXAccountHandlers = (bot, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const actionPrefix = config.actionPrefix;
  const accountPrefix = config.accountActionPrefix || actionPrefix;

  const configureAction = `${actionPrefix}_configure_x`;
  const connectAction = `${actionPrefix}_x_connect`;
  const disableAction = `${actionPrefix}_x_disable`;
  const selectPattern = new RegExp(`^${accountPrefix}_a_(.+)$`);
  const disconnectPattern = new RegExp(`^${accountPrefix}_d_(.+)$`);
  const legacySelectPattern = new RegExp(`^${actionPrefix}_x_account_(.+)$`);
  const legacyDisconnectPattern = new RegExp(`^${actionPrefix}_x_disconnect_(.+)$`);


  bot.action(configureAction, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      await safeAnswer(ctx);
      await showXAccountSelection(ctx, config);
    } catch (error) {
      logger.error('Error configuring X account:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(connectAction, async (ctx) => {
    await connectXAccount(ctx);
  });

  bot.action(disableAction, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      await disableXPosting(ctx, config);
    } catch (error) {
      logger.error('Error disabling X posting:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(selectPattern, async (ctx) => {
    const accountId = ctx.match[1];
    await selectXAccount(ctx, accountId, config);
  });

  bot.action(legacySelectPattern, async (ctx) => {
    const accountId = ctx.match[1];
    await selectXAccount(ctx, accountId, config);
  });

  bot.action(disconnectPattern, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await safeAnswer(ctx, '🧹 Desconectando...');
      const accountId = ctx.match[1];
      const session = getSessionData(ctx, config.sessionKey);
      const deactivated = await XPostService.deactivateAccount(accountId);

      if (session.xAccountId === accountId) {
        session.postToX = false;
        session.xAccountId = null;
        session.xAccountHandle = null;
        session.xAccountDisplayName = null;
        if (ctx.session && typeof ctx.saveSession === 'function') {
          await ctx.saveSession();
        }
      }

      await showXAccountSelection(ctx, config);
    } catch (error) {
      logger.error('Error disconnecting X account:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(legacyDisconnectPattern, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await safeAnswer(ctx, '🧹 Desconectando...');
      const accountId = ctx.match[1];
      const session = getSessionData(ctx, config.sessionKey);
      const deactivated = await XPostService.deactivateAccount(accountId);

      if (session.xAccountId === accountId) {
        session.postToX = false;
        session.xAccountId = null;
        session.xAccountHandle = null;
        session.xAccountDisplayName = null;
        if (ctx.session && typeof ctx.saveSession === 'function') {
          await ctx.saveSession();
        }
      }

      await showXAccountSelection(ctx, config);
    } catch (error) {
      logger.error('Error disconnecting X account (legacy):', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
};

module.exports = {
  registerXAccountHandlers,
  showXAccountSelection,
  selectXAccount,
};
