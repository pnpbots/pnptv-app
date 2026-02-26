const { Markup } = require('telegraf');
const PermissionService = require('../../services/permissionService');
const XPostService = require('../../services/xPostService');
const XOAuthService = require('../../services/xOAuthService');
const GrokService = require('../../services/grokService');
const logger = require('../../../utils/logger');
const dateTimePicker = require('../../utils/dateTimePicker');

const SESSION_KEY = 'xPostWizard';
const X_MAX_TEXT_LENGTH = 280;
const X_REQUIRED_LINKS = ['t.me/pnplatinotv_bot', 'pnptv.app/lifetime100'];

const SERVER_TIMEZONE = 'America/Bogota';

const stripInvalidUnicode = (text) => {
  if (!text) return '';
  // Remove lone surrogates that cause UTF-8 encoding errors
  return String(text).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
};

const escapeMarkdown = (text) => {
  if (!text) return '';
  return stripInvalidUnicode(String(text)).replace(/[_*\\[\]()~`>#+=|{}.!-]/g, '\\$&');
};

const safeCodeBlock = (text) => {
  if (!text) return '';
  return stripInvalidUnicode(String(text)).replace(/```/g, '``\\`');
};

const getMissingRequiredLinks = (text) => {
  const trimmed = (text || '').trim();
  if (!trimmed) return X_REQUIRED_LINKS.slice();
  return X_REQUIRED_LINKS.filter((link) => {
    const escaped = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(escaped, 'i').test(trimmed);
  });
};

const formatMissingLinks = (missing) => {
  if (!missing || missing.length === 0) return '✅ Links requeridos: OK';
  const list = missing.map((link) => `\`${link}\``).join(', ');
  return `⚠️ Links requeridos faltantes: ${list}`;
};

const updateSessionText = (session, newText, oldText) => {
  session.text = newText;
};

// Wizard steps
const STEPS = {
  MENU: 'menu',
  SELECT_ACCOUNT: 'select_account',
  COMPOSE_TEXT: 'compose_text',
  AI_LANGUAGE: 'ai_language',
  AI_PROMPT: 'ai_prompt',
  ADD_MEDIA: 'add_media',
  PREVIEW: 'preview',
  SCHEDULE: 'schedule',
  VIEW_SCHEDULED: 'view_scheduled',
  VIEW_HISTORY: 'view_history',
};

const getSession = (ctx) => {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.temp) ctx.session.temp = {};
  if (!ctx.session.temp[SESSION_KEY]) {
    ctx.session.temp[SESSION_KEY] = {
      step: STEPS.MENU,
      accountId: null,
      accountHandle: null,
      text: null,
      mediaUrl: null,
      mediaFileId: null,
      mediaType: null,
      scheduledAt: null,
      lastAiPrompt: null,
      aiLanguage: null,
    };
  }
  return ctx.session.temp[SESSION_KEY];
};

const clearSession = (ctx) => {
  if (ctx.session?.temp) {
    ctx.session.temp[SESSION_KEY] = null;
  }
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
    const desc = error?.response?.description || error?.message || '';
    if (desc.includes('query is too old') || desc.includes('query ID is invalid')) {
      return;
    }
    logger.debug('Callback query answer failed', { desc });
  }
};

const safeEditOrReply = async (ctx, text, options = {}) => {
  if (ctx?.callbackQuery) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (error) {
      logger.warn('Edit message failed, falling back to reply', {
        error: error?.message,
      });
    }
  }
  await ctx.reply(text, options);
};

const formatDate = (date) => {
  if (!date) return 'N/A';
  const d = new Date(date);
  const options = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return d.toLocaleString('es-ES', { ...options, timeZone: SERVER_TIMEZONE });
  } catch (error) {
    return d.toLocaleString('es-ES', options);
  }
};

const getStatusEmoji = (status) => {
  switch (status) {
    case 'scheduled': return '🕐';
    case 'sending': return '📤';
    case 'sent': return '✅';
    case 'failed': return '❌';
    default: return '❓';
  }
};

// ==================== MENU ====================

const showXPostMenu = async (ctx, edit = false) => {
  const session = getSession(ctx);
  session.step = STEPS.MENU;
  await ctx.saveSession?.();

  const accounts = await XPostService.listActiveAccounts();
  const scheduledPosts = await XPostService.getScheduledPosts();
  const recentPosts = await XPostService.getRecentPosts(5);

  let message = '🐦 **Panel de Publicación en X**\n\n';

  if (accounts.length === 0) {
    message += '⚠️ No hay cuentas de X configuradas.\n';
    message += 'Conecta una cuenta para empezar a publicar.\n\n';
  } else {
    message += `📊 **Cuentas activas:** ${accounts.length}\n`;
    accounts.forEach(acc => {
      message += `  • @${escapeMarkdown(acc.handle)}\n`;
    });
    message += '\n';
  }

  if (scheduledPosts.length > 0) {
    message += `🕐 **Posts programados:** ${scheduledPosts.length}\n\n`;
  }

  if (recentPosts.length > 0) {
    message += '📜 **Últimos posts:**\n';
    recentPosts.forEach(post => {
      const status = getStatusEmoji(post.status);
      const date = formatDate(post.sent_at || post.scheduled_at);
      const fullText = post.text || '';
      const chars = [...fullText];
      const textPreview = chars.slice(0, 30).join('') + (chars.length > 30 ? '...' : '');
      message += `  ${status} ${escapeMarkdown(date)} - ${escapeMarkdown(textPreview)}\n`;
    });
  }

  const buttons = [
    [Markup.button.callback('✍️ Crear Nuevo Post', 'xpost_new')],
    [Markup.button.callback('🕐 Ver Programados', 'xpost_view_scheduled')],
    [Markup.button.callback('📜 Historial', 'xpost_view_history')],
    [Markup.button.callback('⚙️ Gestionar Cuentas', 'admin_x_accounts_configure_x')],
    [Markup.button.callback('◀️ Volver al Panel', 'admin_cancel')],
  ];

  const options = {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...Markup.inlineKeyboard(buttons),
  };

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

// ==================== SELECT ACCOUNT ====================

const showAccountSelection = async (ctx, edit = false) => {
  const session = getSession(ctx);
  session.step = STEPS.SELECT_ACCOUNT;
  await ctx.saveSession?.();

  const accounts = await XPostService.listActiveAccounts();

  if (accounts.length === 0) {
    const message = '🐦 **Seleccionar Cuenta**\n\n'
      + '⚠️ No hay cuentas de X configuradas.\n\n'
      + 'Primero debes conectar una cuenta.';

    const buttons = [
      [Markup.button.callback('➕ Conectar cuenta X', 'xpost_connect_account')],
      [Markup.button.callback('◀️ Volver', 'xpost_menu')],
    ];

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
    if (edit && ctx.callbackQuery) {
      await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
    } else {
      await ctx.reply(message, options);
    }
    return;
  }

  let message = '🐦 **Seleccionar Cuenta**\n\n';
  message += 'Elige la cuenta desde la cual publicar:\n\n';

  const buttons = accounts.map(acc => {
    const selected = session.accountId === acc.account_id;
    const label = `${selected ? '✅' : '⬜'} @${acc.handle}`;
    return [Markup.button.callback(label, `xpost_select_account_${acc.account_id}`)];
  });

  buttons.push([Markup.button.callback('➕ Conectar nueva cuenta', 'xpost_connect_account')]);
  buttons.push([Markup.button.callback('◀️ Volver', 'xpost_menu')]);

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

// ==================== COMPOSE TEXT ====================

const showComposeText = async (ctx, edit = false) => {
  const session = getSession(ctx);
  session.step = STEPS.COMPOSE_TEXT;
  await ctx.saveSession?.();

  let message = '✍️ **Redactar Post**\n\n';
  const safeHandle = session.accountHandle ? escapeMarkdown(session.accountHandle) : 'No seleccionada';
  message += `📤 Cuenta: @${safeHandle}\n\n`;

  if (session.text) {
    const charCount = session.text.length;
    const charStatus = charCount <= X_MAX_TEXT_LENGTH ? '✅' : '⚠️';
    message += `📝 **Texto actual** (${charCount}/${X_MAX_TEXT_LENGTH} ${charStatus}):\n`;
    message += `\`\`\`\n${safeCodeBlock(session.text)}\n\`\`\`\n\n`;
    message += `${formatMissingLinks(getMissingRequiredLinks(session.text))}\n\n`;
    if (charCount > X_MAX_TEXT_LENGTH) {
      message += `🚨 **¡ATENCIÓN!** El texto excede el límite de ${X_MAX_TEXT_LENGTH} caracteres por ${charCount - X_MAX_TEXT_LENGTH} chars.\n`;
      message += 'Será truncado al publicar.\n\n';
    }
    message += 'Envía un nuevo mensaje para reemplazar el texto.\n';
  } else {
    message += '📝 Envía el texto que deseas publicar o usa AI para generarlo.\n';
    message += `⚠️ Máximo ${X_MAX_TEXT_LENGTH} caracteres.\n`;
  }

  const buttons = [];

  buttons.push([Markup.button.callback('🤖 Generar con Grok', 'xpost_ai_generate')]);

  if (session.lastAiPrompt) {
    const langLabel = session.aiLanguage === 'English' ? '🇬🇧' : '🇪🇸';
    buttons.push([Markup.button.callback(`🔄 Regenerar ${langLabel}`, 'xpost_ai_regenerate')]);
  }

  if (session.text) {
    const missingLinks = getMissingRequiredLinks(session.text);
    if (missingLinks.length > 0) {
      buttons.push([Markup.button.callback('🔗 Agregar links requeridos', 'xpost_append_links')]);
    }
    if (session.text.length > X_MAX_TEXT_LENGTH) {
      buttons.push([Markup.button.callback('✂️ Recortar a 280', 'xpost_trim_text')]);
    }
    buttons.push([Markup.button.callback('▶️ Continuar a Media', 'xpost_add_media')]);
    buttons.push([Markup.button.callback('🗑️ Borrar texto', 'xpost_clear_text')]);
  }

  buttons.push([Markup.button.callback('◀️ Volver', 'xpost_select_account')]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'xpost_menu')]);

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

// ==================== ADD MEDIA ====================

const showAddMedia = async (ctx, edit = false) => {
  const session = getSession(ctx);
  session.step = STEPS.ADD_MEDIA;
  await ctx.saveSession?.();

  let message = '🖼️ **Agregar Media (Opcional)**\n\n';

  if (session.mediaUrl) {
    const mediaTypeLabel = {
      'photo': '🖼️ Imagen',
      'video': '🎥 Video',
      'animation': '🎞️ GIF',
      'image': '🖼️ Imagen',
    }[session.mediaType] || '📎 Media';

    message += `✅ **Media agregada:** ${mediaTypeLabel}\n\n`;
    message += '👆 Presiona **"Continuar con Media"** para ir a la vista previa.\n';
    message += '📤 O envía otra media para reemplazar la actual.\n';
  } else {
    message += '📤 Envía una imagen o video para agregar al post.\n';
    message += 'O presiona **"Omitir Media"** para continuar sin ella.\n';
  }

  const buttons = [];

  if (session.mediaUrl) {
    // Media is attached - show continue with media button
    buttons.push([Markup.button.callback('▶️ Continuar con Media', 'xpost_preview')]);
    buttons.push([Markup.button.callback('🗑️ Eliminar media', 'xpost_clear_media')]);
  } else {
    // No media - show skip option
    buttons.push([Markup.button.callback('⏭️ Omitir Media', 'xpost_preview')]);
  }

  buttons.push([Markup.button.callback('◀️ Volver', 'xpost_compose')]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'xpost_menu')]);

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

// ==================== PREVIEW ====================

const showPreview = async (ctx, edit = false) => {
  const session = getSession(ctx);
  session.step = STEPS.PREVIEW;
  await ctx.saveSession?.();

  if (!session.text) {
    return showComposeText(ctx, edit);
  }

  const charCount = (session.text || '').length;
  const charStatus = charCount <= X_MAX_TEXT_LENGTH ? '✅' : '🚨';
  const willTruncate = charCount > X_MAX_TEXT_LENGTH;
  const excessChars = charCount - X_MAX_TEXT_LENGTH;
  const missingLinks = getMissingRequiredLinks(session.text);

  let message = '👁️ **Vista Previa del Post**\n\n';
  const safeHandle = session.accountHandle ? escapeMarkdown(session.accountHandle) : 'No seleccionada';
  message += `📤 Cuenta: @${safeHandle}\n`;

  // Character count with warning
  if (willTruncate) {
    message += `\n🚨🚨🚨 **¡LÍMITE EXCEDIDO!** 🚨🚨🚨\n`;
    message += `📊 Caracteres: ${charCount}/${X_MAX_TEXT_LENGTH} (${excessChars} chars de más)\n`;
    message += `⚠️ El texto será TRUNCADO automáticamente.\n`;
  } else {
    const remaining = X_MAX_TEXT_LENGTH - charCount;
    message += `📊 Caracteres: ${charCount}/${X_MAX_TEXT_LENGTH} ${charStatus}`;
    if (remaining <= 20) {
      message += ` (⚠️ solo ${remaining} restantes)`;
    }
    message += '\n';
  }

  message += `${formatMissingLinks(missingLinks)}\n`;

  // Media indicator with more detail
  if (session.mediaUrl) {
    const mediaTypeEmoji = {
      'photo': '🖼️ Imagen',
      'video': '🎥 Video',
      'animation': '🎞️ GIF',
      'image': '🖼️ Imagen',
    }[session.mediaType] || '📎 Media';
    message += `${mediaTypeEmoji}: Incluida ✅\n`;
  } else {
    message += `📎 Media: Sin media\n`;
  }

  message += '\n━━━━━━━━━━━━━━━━━━━━\n';
  message += escapeMarkdown(session.text || '(Sin texto)');
  message += '\n━━━━━━━━━━━━━━━━━━━━\n\n';

  if (willTruncate) {
    message += '⚠️ **Texto truncado se verá así:**\n';
    const truncatedPreview = (session.text || '').slice(0, X_MAX_TEXT_LENGTH - 1) + '…';
    message += `\`\`\`\n${safeCodeBlock(truncatedPreview)}\n\`\`\`\n\n`;
  }

  message += '¿Qué deseas hacer?';

  const buttons = [];

  if (missingLinks.length > 0) {
    buttons.push([Markup.button.callback('🔗 Agregar links requeridos', 'xpost_append_links')]);
  }
  if (willTruncate) {
    buttons.push([Markup.button.callback('✂️ Recortar a 280', 'xpost_trim_text')]);
  }

  buttons.push(
    [
      Markup.button.callback('📤 Publicar Ahora', 'xpost_send_now'),
      Markup.button.callback('🕐 Programar', 'xpost_schedule'),
    ],
    [Markup.button.callback('✏️ Editar Texto', 'xpost_compose')],
    [Markup.button.callback('🖼️ Editar Media', 'xpost_add_media')],
    [Markup.button.callback('◀️ Volver', 'xpost_add_media')],
    [Markup.button.callback('❌ Cancelar', 'xpost_menu')],
  );

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

// ==================== SCHEDULE ====================

const showSchedule = async (ctx, edit = false) => {
  const session = getSession(ctx);
  session.step = STEPS.SCHEDULE;
  session.scheduleTimezone = session.scheduleTimezone || SERVER_TIMEZONE;
  await ctx.saveSession?.();

  let message = '🕐 **Programar Publicación**\n\n';
  message += 'Selecciona cuándo deseas publicar:\n\n';
  message += `🌍 Zona horaria: \`${session.scheduleTimezone}\`\n\n`;

  // Quick schedule options
  const quickHours = dateTimePicker.getQuickPresetHours();
  const quickButtons = [];
  for (let i = 0; i < quickHours.length; i += 2) {
    const first = quickHours[i];
    const second = quickHours[i + 1];
    const row = [
      Markup.button.callback(`⏰ En ${first} horas`, `xpost_schedule_${first}h`),
    ];
    if (second) {
      row.push(Markup.button.callback(`⏰ En ${second} horas`, `xpost_schedule_${second}h`));
    }
    quickButtons.push(row);
  }

  const buttons = [
    ...quickButtons,
    [Markup.button.callback('🗓️ Elegir fecha', 'xpost_schedule_custom')],
    [Markup.button.callback('◀️ Volver', 'xpost_preview')],
    [Markup.button.callback('❌ Cancelar', 'xpost_menu')],
  ];

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

const showCustomSchedule = async (ctx) => {
  const session = getSession(ctx);
  session.step = 'schedule_custom_picker';
  session.scheduleTimezone = session.scheduleTimezone || SERVER_TIMEZONE;
  await ctx.saveSession?.();
  const PREFIX = 'xpost_sched';
  const { text, keyboard } = dateTimePicker.getSchedulingMenu('es', PREFIX);
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
};

// ==================== VIEW SCHEDULED ====================

const showScheduledPosts = async (ctx, edit = false, page = 0) => {
  const session = getSession(ctx);
  session.step = STEPS.VIEW_SCHEDULED;
  await ctx.saveSession?.();

  const posts = await XPostService.getScheduledPosts();
  const pageSize = 5;
  const totalPages = Math.ceil(posts.length / pageSize);
  const pagePosts = posts.slice(page * pageSize, (page + 1) * pageSize);

  let message = '🕐 **Posts Programados**\n\n';
  message += `🌍 Zona horaria: \`${SERVER_TIMEZONE}\`\n\n`;

  if (posts.length === 0) {
    message += '📭 No hay posts programados.\n';
  } else {
    message += `📊 Total: ${posts.length} posts\n\n`;

    pagePosts.forEach((post, idx) => {
      const num = page * pageSize + idx + 1;
      const date = formatDate(post.scheduled_at);
      const handle = escapeMarkdown(post.handle || 'desconocido');
      const textPreview = (post.text || '').substring(0, 40) + (post.text?.length > 40 ? '...' : '');

      message += `**${num}.** @${handle}\n`;
      message += `   📅 ${escapeMarkdown(date)}\n`;
      message += `   📝 ${escapeMarkdown(textPreview)}\n\n`;
    });

    if (totalPages > 1) {
      message += `\nPágina ${page + 1} de ${totalPages}`;
    }
  }

  const buttons = [];

  // Pagination
  if (totalPages > 1) {
    const navButtons = [];
    if (page > 0) {
      navButtons.push(Markup.button.callback('◀️ Anterior', `xpost_scheduled_page_${page - 1}`));
    }
    if (page < totalPages - 1) {
      navButtons.push(Markup.button.callback('Siguiente ▶️', `xpost_scheduled_page_${page + 1}`));
    }
    if (navButtons.length > 0) {
      buttons.push(navButtons);
    }
  }

  // Cancel buttons for each post on current page
  if (pagePosts.length > 0) {
    pagePosts.forEach((post, idx) => {
      const num = page * pageSize + idx + 1;
      buttons.push([
        Markup.button.callback(`🗑️ Cancelar #${num}`, `xpost_cancel_${post.post_id}`),
      ]);
    });
  }

  buttons.push([Markup.button.callback('🔄 Actualizar', 'xpost_view_scheduled')]);
  buttons.push([Markup.button.callback('◀️ Volver', 'xpost_menu')]);

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

// ==================== VIEW HISTORY ====================

const showHistory = async (ctx, edit = false, page = 0) => {
  const session = getSession(ctx);
  session.step = STEPS.VIEW_HISTORY;
  await ctx.saveSession?.();

  const posts = await XPostService.getPostHistory(20);
  const pageSize = 5;
  const totalPages = Math.ceil(posts.length / pageSize);
  const pagePosts = posts.slice(page * pageSize, (page + 1) * pageSize);

  let message = '📜 **Historial de Posts**\n\n';
  message += `🌍 Zona horaria: \`${SERVER_TIMEZONE}\`\n\n`;

  if (posts.length === 0) {
    message += '📭 No hay posts en el historial.\n';
  } else {
    message += '💡 **Acciones:** 🔄 Reintentar fallidos | 📋 Copiar texto\n\n';

    pagePosts.forEach((post, idx) => {
      const num = page * pageSize + idx + 1;
      const status = getStatusEmoji(post.status);
      const date = formatDate(post.sent_at || post.scheduled_at || post.created_at);
      const handle = escapeMarkdown(post.handle || 'desconocido');
      const textPreview = (post.text || '').substring(0, 40) + (post.text?.length > 40 ? '...' : '');

      message += `**${num}.** ${status} @${handle}\n`;
      message += `   📅 ${escapeMarkdown(date)}\n`;
      message += `   📝 ${escapeMarkdown(textPreview)}\n`;

      if (post.status === 'failed' && post.error_message) {
        const errorPreview = post.error_message.substring(0, 50);
        message += `   ❌ ${escapeMarkdown(errorPreview)}\n`;
      }

      message += '\n';
    });

    if (totalPages > 1) {
      message += `\nPágina ${page + 1} de ${totalPages}`;
    }
  }

  const buttons = [];

  // Pagination
  if (totalPages > 1) {
    const navButtons = [];
    if (page > 0) {
      navButtons.push(Markup.button.callback('◀️ Anterior', `xpost_history_page_${page - 1}`));
    }
    if (page < totalPages - 1) {
      navButtons.push(Markup.button.callback('Siguiente ▶️', `xpost_history_page_${page + 1}`));
    }
    if (navButtons.length > 0) {
      buttons.push(navButtons);
    }
  }

  // Add retry and copy buttons for each post
  pagePosts.forEach((post, idx) => {
    const num = page * pageSize + idx + 1;
    const postButtons = [];

    // Retry button only for failed posts
    if (post.status === 'failed') {
      postButtons.push(Markup.button.callback(`🔄 #${num}`, `xpost_retry_${post.post_id}`));
    }

    // Copy button for all posts
    postButtons.push(Markup.button.callback(`📋 #${num}`, `xpost_copy_${post.post_id}`));

    if (postButtons.length > 0) {
      buttons.push(postButtons);
    }
  });

  buttons.push([Markup.button.callback('🔄 Actualizar', 'xpost_view_history')]);
  buttons.push([Markup.button.callback('◀️ Volver', 'xpost_menu')]);

  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) };
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(message, options).catch(() => ctx.reply(message, options));
  } else {
    await ctx.reply(message, options);
  }
};

// ==================== ACTIONS ====================

const sendNow = async (ctx) => {
  const session = getSession(ctx);

  if (!session.accountId || !session.text) {
    await ctx.reply('❌ Faltan datos. Por favor, completa el proceso.');
    return showXPostMenu(ctx);
  }

  await safeAnswer(ctx, '📤 Publicando...');

  try {
    const result = await XPostService.sendPostNow({
      accountId: session.accountId,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username,
      text: session.text,
      mediaUrl: session.mediaUrl,
    });

    const tweetId = result.response?.data?.id;
    const tweetUrl = tweetId ? `https://x.com/i/status/${tweetId}` : null;

    let message = '✅ **Post Publicado Exitosamente**\n\n';
    const safeHandle = session.accountHandle ? escapeMarkdown(session.accountHandle) : 'desconocida';
    message += `📤 Cuenta: @${safeHandle}\n`;

    if (result.truncated) {
      message += '⚠️ El texto fue truncado a 280 caracteres.\n';
    }

    if (tweetUrl) {
      message += `\n🔗 [Ver en X](${tweetUrl})`;
    }

    clearSession(ctx);

    await safeEditOrReply(ctx, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✍️ Crear otro post', 'xpost_new')],
        [Markup.button.callback('◀️ Volver al menú', 'xpost_menu')],
      ]),
    });

    logger.info('X post sent successfully via wizard', {
      adminId: ctx.from.id,
      accountHandle: session.accountHandle,
      tweetId,
    });
  } catch (error) {
    logger.error('Error sending X post via wizard:', error);

    // Rate limited - post was auto-scheduled
    if (error.rescheduled) {
      const safeHandle = session.accountHandle ? escapeMarkdown(session.accountHandle) : 'desconocida';
      let msg = '⏰ **Post Programado Automáticamente**\n\n';
      msg += `📤 Cuenta: @${safeHandle}\n`;
      msg += `⚠️ X tiene límite de publicaciones. El post se enviará automáticamente en ~${error.delayMinutes} minutos.\n`;

      clearSession(ctx);

      await safeEditOrReply(ctx, msg, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 Ver Programados', 'xpost_scheduled')],
          [Markup.button.callback('◀️ Volver al menú', 'xpost_menu')],
        ]),
      });
      return;
    }

    let errorMsg = '❌ **Error al Publicar**\n\n';
    const safeHandle = session.accountHandle ? escapeMarkdown(session.accountHandle) : 'desconocida';
    const safeError = escapeMarkdown(error.message || 'Error desconocido');
    errorMsg += `Cuenta: @${safeHandle}\n`;
    errorMsg += `Error: ${safeError}\n\n`;
    errorMsg += 'Por favor, intenta de nuevo más tarde.';

    await safeEditOrReply(ctx, errorMsg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Reintentar', 'xpost_send_now')],
        [Markup.button.callback('◀️ Volver', 'xpost_preview')],
      ]),
    });
  }
};

const schedulePost = async (ctx, minutes) => {
  const session = getSession(ctx);

  if (!session.accountId || !session.text) {
    await ctx.reply('❌ Faltan datos. Por favor, completa el proceso.');
    return showXPostMenu(ctx);
  }

  const scheduledAt = new Date(Date.now() + minutes * 60 * 1000);

  await safeAnswer(ctx, '🕐 Programando...');

  try {
    const postId = await XPostService.createPostJob({
      accountId: session.accountId,
      adminId: ctx.from.id,
      adminUsername: ctx.from.username,
      text: session.text,
      mediaUrl: session.mediaUrl,
      scheduledAt,
      status: 'scheduled',
    });

    let message = '✅ **Post Programado Exitosamente**\n\n';
    const safeHandle = session.accountHandle ? escapeMarkdown(session.accountHandle) : 'desconocida';
    message += `📤 Cuenta: @${safeHandle}\n`;
    const displayTz = session.scheduleTimezone || SERVER_TIMEZONE;
    message += `📅 Fecha: ${escapeMarkdown(formatDate(scheduledAt))} (\`${displayTz}\`)\n`;
    message += `🆔 ID: ${postId.substring(0, 8)}...\n\n`;
    message += 'El post se publicará automáticamente en la fecha indicada.';

    clearSession(ctx);

    await safeEditOrReply(ctx, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🕐 Ver programados', 'xpost_view_scheduled')],
        [Markup.button.callback('✍️ Crear otro post', 'xpost_new')],
        [Markup.button.callback('◀️ Volver al menú', 'xpost_menu')],
      ]),
    });

    logger.info('X post scheduled via wizard', {
      adminId: ctx.from.id,
      accountHandle: session.accountHandle,
      scheduledAt,
      postId,
    });
  } catch (error) {
    logger.error('Error scheduling X post via wizard:', error);

    await safeEditOrReply(
      ctx,
      `❌ **Error al Programar**\n\n${escapeMarkdown(error.message || 'Error desconocido')}`,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reintentar', 'xpost_schedule')],
          [Markup.button.callback('◀️ Volver', 'xpost_preview')],
        ]),
      },
    );
  }
};

const scheduleForTomorrow = async (ctx, hour) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hour, 0, 0, 0);

  const minutesUntil = Math.round((tomorrow.getTime() - Date.now()) / 60000);
  await schedulePost(ctx, minutesUntil);
};

const cancelScheduledPost = async (ctx, postId) => {
  await safeAnswer(ctx, '🗑️ Cancelando...');

  try {
    await XPostService.cancelScheduledPost(postId);

    await safeEditOrReply(
      ctx,
      '✅ **Post Cancelado**\n\nEl post programado ha sido eliminado.',
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Volver', 'xpost_view_scheduled')],
        ]),
      },
    );

    logger.info('Scheduled X post cancelled', { postId, adminId: ctx.from.id });
  } catch (error) {
    logger.error('Error cancelling scheduled X post:', error);
    await ctx.answerCbQuery('❌ Error al cancelar').catch(() => {});
  }
};

// ==================== AI GENERATION HELPERS ====================

const generateAIContent = async (ctx, prompt, isRegenerate = false) => {
  const session = getSession(ctx);

  session.lastAiPrompt = prompt;
  await ctx.saveSession?.();

  const language = session.aiLanguage || 'Spanish';
  const langLabel = language === 'English' ? '🇬🇧' : '🇪🇸';
  await ctx.reply(`⏳ Generando post en ${langLabel} con Grok...`);

  try {
    // Build a focused sales prompt for X/Twitter
    const salesPrompt = language === 'English'
      ? `Create a SINGLE sales tweet for X (Twitter) about: ${prompt}

STRICT RULES:
- MAXIMUM 280 characters total (including links, emojis, hashtags)
- Language: English only
- Structure: HOOK (caps) + brief pitch + CTA
- Include ONE link: t.me/pnplatinotv_bot OR pnptv.app/lifetime100
- Use 2-3 emojis max
- 2-3 hashtags max
- NO explanations, ONLY the final tweet text`
      : `Crea UN SOLO tweet de venta para X (Twitter) sobre: ${prompt}

REGLAS ESTRICTAS:
- MÁXIMO 280 caracteres total (incluyendo links, emojis, hashtags)
- Idioma: Español únicamente
- Estructura: GANCHO (mayúsculas) + pitch breve + CTA
- Incluir UN link: t.me/pnplatinotv_bot O pnptv.app/lifetime100
- Usar 2-3 emojis máximo
- 2-3 hashtags máximo
- SIN explicaciones, SOLO el texto final del tweet`;

    const aiText = await GrokService.chat({
      mode: 'xPost',
      language,
      prompt: salesPrompt,
      maxTokens: 150,
    });

    // Clean up the response - remove any explanations or extra text
    let cleanText = aiText.trim();
    // If Grok added explanations, try to extract just the tweet
    if (cleanText.length > 350) {
      const lines = cleanText.split('\n').filter(l => l.trim());
      // Find the line that looks most like a tweet (has emojis/hashtags)
      const tweetLine = lines.find(l => l.includes('#') || /[\u{1F300}-\u{1F9FF}]/u.test(l)) || lines[0];
      cleanText = tweetLine || cleanText.substring(0, 280);
    }

    // Ensure we don't exceed 280 chars
    if (cleanText.length > X_MAX_TEXT_LENGTH) {
      cleanText = cleanText.substring(0, X_MAX_TEXT_LENGTH - 3) + '...';
    }

    session.text = cleanText;
    session.step = STEPS.COMPOSE_TEXT;
    await ctx.saveSession?.();

    const genLabel = isRegenerate ? 'regenerado' : 'generado';
    await ctx.reply(`✅ Post ${genLabel} (${cleanText.length}/${X_MAX_TEXT_LENGTH} chars)`);

    return showComposeText(ctx);
  } catch (error) {
    logger.error('Error generating AI content:', error);
    await ctx.reply(`❌ Error generando contenido: ${error.message || 'desconocido'}`);
    return showComposeText(ctx);
  }
};

// ==================== TEXT HANDLER ====================

const handleTextInput = async (ctx, next) => {
  const session = getSession(ctx);

  if (!session.step) {
    return next();
  }

  // Handle new AI prompt step
  if (session.step === STEPS.AI_PROMPT) {
    const prompt = ctx.message?.text?.trim();
    if (!prompt) return next();
    return generateAIContent(ctx, prompt);
  }

  if (session.step === STEPS.COMPOSE_TEXT) {
    const text = ctx.message?.text;
    if (!text) return next();

    session.text = text;
    await ctx.saveSession?.();

    const charCount = text.length;
    const status = charCount <= X_MAX_TEXT_LENGTH ? '✅' : '⚠️';
    let response = `${status} Texto guardado (${charCount}/${X_MAX_TEXT_LENGTH} caracteres)`;

    if (charCount > X_MAX_TEXT_LENGTH) {
      response += `\n🚨 ¡Excede el límite por ${charCount - X_MAX_TEXT_LENGTH} caracteres!`;
    }

    await ctx.reply(response);

    return showComposeText(ctx);
  }

  // Handle custom time input from inline picker
  if (session.step === 'schedule_custom_time') {
    const text = ctx.message?.text?.trim();
    if (!text) return next();

    if (text.startsWith('/')) return next();

    const match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      await ctx.reply('❌ Formato inválido. Usa HH:MM (24 horas).');
      return;
    }

    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      await ctx.reply('❌ Hora inválida. Usa HH:MM (00-23 / 00-59).');
      return;
    }

    const dateInfo = session.scheduleCustomDate;
    if (!dateInfo) {
      await ctx.reply('❌ Sesión expirada. Selecciona la fecha de nuevo.');
      return;
    }

    const tz = session.scheduleTimezone || SERVER_TIMEZONE;
    const scheduledAt = dateTimePicker.buildDateInTimeZone(
      {
        year: dateInfo.year,
        month: dateInfo.month,
        day: dateInfo.day,
        hour,
        minute,
      },
      tz
    );
    if (scheduledAt <= new Date()) {
      await ctx.reply('❌ La fecha debe ser en el futuro.');
      return;
    }

    session.scheduleTempDate = scheduledAt.toISOString();
    session.step = 'schedule_custom_picker';
    await ctx.saveSession?.();

    const PREFIX = 'xpost_sched';
    const { text: confirmText, keyboard } = dateTimePicker.getConfirmationView(scheduledAt, SERVER_TIMEZONE, 'es', PREFIX);
    await ctx.reply(confirmText, { parse_mode: 'Markdown', ...keyboard });
    return;
  }

  return next();
};

const handleMediaInput = async (ctx, media) => {
  const session = getSession(ctx);

  if (session.step !== STEPS.ADD_MEDIA) {
    return false;
  }

  const fileId = media?.file_id;
  if (!fileId) {
    await ctx.reply('❌ Media inválida. Intenta de nuevo.');
    return true;
  }

  // Telegram Bot API can only download files up to 20MB
  const TELEGRAM_MAX_FILE_SIZE = 20 * 1024 * 1024;
  const fileSize = media.file_size || 0;
  if (fileSize > TELEGRAM_MAX_FILE_SIZE) {
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    await ctx.reply(`❌ El archivo es demasiado grande (${sizeMB}MB). Telegram permite máximo 20MB para bots.\n\nIntenta comprimir el archivo o enviar uno más pequeño.`);
    return true;
  }

  try {
    // Store the fileId instead of the temporary download URL.
    // The fileId is permanent and will be resolved to a fresh URL at send time.
    session.mediaType = media.type || 'media';
    session.mediaFileId = fileId;
    session.mediaUrl = fileId;
    await ctx.saveSession?.();

    logger.info('X post media saved', {
      userId: ctx.from?.id,
      type: session.mediaType,
      fileId,
    });

    await ctx.reply('✅ Media guardada correctamente');
    await showAddMedia(ctx);
    return true;
  } catch (error) {
    logger.error('Error handling X post media:', error);
    await ctx.reply('❌ Error al procesar la media. Intenta de nuevo.');
    return true;
  }
};

// ==================== REGISTER HANDLERS ====================

const registerXPostWizardHandlers = (bot) => {
  // Menu
  bot.action('xpost_menu', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showXPostMenu(ctx, true);
  });

  // New post flow - auto-select if only 1 account
  bot.action('xpost_new', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    clearSession(ctx);
    await safeAnswer(ctx);

    const accounts = await XPostService.listActiveAccounts();
    if (accounts.length === 1) {
      const session = getSession(ctx);
      session.accountId = accounts[0].account_id;
      session.accountHandle = accounts[0].handle;
      await ctx.saveSession?.();
      await showComposeText(ctx, true);
    } else {
      await showAccountSelection(ctx, true);
    }
  });

  // Account selection
  bot.action('xpost_select_account', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showAccountSelection(ctx, true);
  });

  bot.action(/^xpost_select_account_(.+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const accountId = ctx.match[1];
    const accounts = await XPostService.listActiveAccounts();
    const account = accounts.find(a => a.account_id === accountId);

    if (!account) {
      await ctx.answerCbQuery('❌ Cuenta no encontrada');
      return;
    }

    const session = getSession(ctx);
    session.accountId = account.account_id;
    session.accountHandle = account.handle;
    await ctx.saveSession?.();

    await safeAnswer(ctx, `✅ @${account.handle}`);
    await showComposeText(ctx, true);
  });

  // AI Generate button - show language selection first
  bot.action('xpost_ai_generate', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    session.step = STEPS.AI_LANGUAGE;
    await ctx.saveSession?.();

    await safeAnswer(ctx);
    await safeEditOrReply(ctx,
      '🤖 *Generar post con Grok*\n\n'
      + '🌍 Selecciona el idioma del post:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🇪🇸 Español', 'xpost_ai_lang_es')],
          [Markup.button.callback('🇬🇧 English', 'xpost_ai_lang_en')],
          [Markup.button.callback('◀️ Volver', 'xpost_compose')],
        ]),
      },
    );
  });

  // Language selection handlers
  bot.action('xpost_ai_lang_es', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    session.aiLanguage = 'Spanish';
    session.step = STEPS.AI_PROMPT;
    await ctx.saveSession?.();

    await safeAnswer(ctx, '🇪🇸 Español');
    await safeEditOrReply(ctx,
      '🤖 *Generar post en Español*\n\n'
      + 'Describe brevemente lo que quieres promocionar:\n\n'
      + '*Ejemplos:*\n'
      + '• `Show en vivo esta noche`\n'
      + '• `Promo lifetime $100`\n'
      + '• `Nuevo video de clouds`',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Cambiar idioma', 'xpost_ai_generate')],
          [Markup.button.callback('❌ Cancelar', 'xpost_compose')],
        ]),
      },
    );
  });

  bot.action('xpost_ai_lang_en', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    session.aiLanguage = 'English';
    session.step = STEPS.AI_PROMPT;
    await ctx.saveSession?.();

    await safeAnswer(ctx, '🇬🇧 English');
    await safeEditOrReply(ctx,
      '🤖 *Generate post in English*\n\n'
      + 'Briefly describe what you want to promote:\n\n'
      + '*Examples:*\n'
      + '• `Live show tonight`\n'
      + '• `Lifetime promo $100`\n'
      + '• `New clouds video`',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Change language', 'xpost_ai_generate')],
          [Markup.button.callback('❌ Cancel', 'xpost_compose')],
        ]),
      },
    );
  });

  // Regenerate AI - uses the same language as before
  bot.action('xpost_ai_regenerate', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    if (!session.lastAiPrompt) {
      await ctx.answerCbQuery('❌ No hay prompt previo');
      return;
    }

    const langLabel = session.aiLanguage === 'English' ? '🇬🇧' : '🇪🇸';
    await safeAnswer(ctx, `🔄 Regenerando ${langLabel}...`);
    await generateAIContent(ctx, session.lastAiPrompt, true);
  });

  bot.action('xpost_connect_account', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    try {
      const authUrl = await XOAuthService.createAuthUrl({
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || null,
      });
      await safeAnswer(ctx);
      await ctx.reply(
        '🔗 *Conectar cuenta de X*\n\n'
        + '1) Abre el enlace de abajo.\n'
        + '2) Autoriza la cuenta.\n'
        + '3) Regresa y selecciona la cuenta.',
        { parse_mode: 'Markdown' },
      );
      await ctx.reply(authUrl, { disable_web_page_preview: true });
    } catch (error) {
      logger.error('Error starting X OAuth from wizard:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Compose text
  bot.action('xpost_compose', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showComposeText(ctx, true);
  });

  bot.action('xpost_clear_text', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    session.text = null;
    session.lastAiPrompt = null;
    await ctx.saveSession?.();

    await safeAnswer(ctx, '🗑️ Texto eliminado');
    await showComposeText(ctx, true);
  });

  bot.action('xpost_append_links', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    if (!session.text) {
      await safeAnswer(ctx, '❌ No hay texto');
      return showComposeText(ctx, true);
    }

    const oldText = session.text;
    const normalized = XPostService.ensureRequiredLinks(oldText, X_REQUIRED_LINKS, X_MAX_TEXT_LENGTH);
    updateSessionText(session, normalized.text, oldText);
    await ctx.saveSession?.();

    const notice = normalized.truncated
      ? '✅ Links agregados (texto recortado)'
      : '✅ Links agregados';
    await safeAnswer(ctx, notice);
    await showComposeText(ctx, true);
  });

  bot.action('xpost_trim_text', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    if (!session.text) {
      await safeAnswer(ctx, '❌ No hay texto');
      return showComposeText(ctx, true);
    }

    const oldText = session.text;
    const normalized = XPostService.normalizeXText(oldText);
    if (!normalized.truncated) {
      await safeAnswer(ctx, '✅ Ya está dentro de 280');
      return showComposeText(ctx, true);
    }

    updateSessionText(session, normalized.text, oldText);
    await ctx.saveSession?.();
    await safeAnswer(ctx, '✂️ Texto recortado a 280');
    await showComposeText(ctx, true);
  });

  // Add media
  bot.action('xpost_add_media', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showAddMedia(ctx, true);
  });

  bot.action('xpost_clear_media', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const session = getSession(ctx);
    session.mediaUrl = null;
    session.mediaType = null;
    await ctx.saveSession?.();

    await safeAnswer(ctx, '🗑️ Media eliminada');
    await showAddMedia(ctx, true);
  });

  // Preview
  bot.action('xpost_preview', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showPreview(ctx, true);
  });

  // Send now
  bot.action('xpost_send_now', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await sendNow(ctx);
  });

  // Schedule
  bot.action('xpost_schedule', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showSchedule(ctx, true);
  });

  const quickHours = dateTimePicker.getQuickPresetHours();
  for (const hours of quickHours) {
    bot.action(`xpost_schedule_${hours}h`, async (ctx) => {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
      await schedulePost(ctx, hours * 60);
    });
  }

  bot.action('xpost_schedule_custom', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showCustomSchedule(ctx);
  });

  // Inline date/time picker for X scheduling
  const XPOST_PREFIX = 'xpost_sched';

  const presetCount = dateTimePicker.getQuickPresetHours().length;
  for (let i = 0; i < presetCount; i++) {
    bot.action(`${XPOST_PREFIX}_preset_${i}`, async (ctx) => {
      await safeAnswer(ctx);
      const session = getSession(ctx);
      const scheduledDate = dateTimePicker.calculatePresetDate(i);
      if (!scheduledDate) return;
      session.scheduleTempDate = scheduledDate.toISOString();
      await ctx.saveSession?.();
      const tz = session.scheduleTimezone || SERVER_TIMEZONE;
      const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', XPOST_PREFIX);
      await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
    });
  }

  bot.action(`${XPOST_PREFIX}_open_calendar`, async (ctx) => {
    await safeAnswer(ctx);
    const now = new Date();
    const { text, keyboard } = dateTimePicker.getCalendarView(now.getFullYear(), now.getMonth(), 'es', XPOST_PREFIX);
    await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action(new RegExp(`^${XPOST_PREFIX}_month_(\\d{4})_(-?\\d+)$`), async (ctx) => {
    await safeAnswer(ctx);
    const parsed = dateTimePicker.parseMonthCallback(ctx.match[0]);
    if (!parsed) return;
    let { year, month } = parsed;
    while (month < 0) { month += 12; year--; }
    while (month > 11) { month -= 12; year++; }
    const now = new Date();
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())) return;
    const { text, keyboard } = dateTimePicker.getCalendarView(year, month, 'es', XPOST_PREFIX);
    await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action(new RegExp(`^${XPOST_PREFIX}_date_(\\d{4})_(\\d+)_(\\d+)$`), async (ctx) => {
    await safeAnswer(ctx);
    const parsed = dateTimePicker.parseDateCallback(ctx.match[0]);
    if (!parsed) return;
    const { year, month, day } = parsed;
    const { text, keyboard } = dateTimePicker.getTimeSelectionView(year, month, day, 'es', XPOST_PREFIX);
    await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action(new RegExp(`^${XPOST_PREFIX}_time_(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})_(\\d{2})$`), async (ctx) => {
    await safeAnswer(ctx);
    const session = getSession(ctx);
    const parsed = dateTimePicker.parseTimeCallback(ctx.match[0]);
    if (!parsed) return;
    const { year, month, day, hour, minute } = parsed;
    const tz = session.scheduleTimezone || SERVER_TIMEZONE;
    const scheduledDate = dateTimePicker.buildDateInTimeZone(
      { year, month, day, hour, minute },
      tz
    );
    if (scheduledDate <= new Date()) {
      await ctx.answerCbQuery('❌ La hora seleccionada ya pasó', { show_alert: true }).catch(() => {});
      return;
    }
    session.scheduleTempDate = scheduledDate.toISOString();
    await ctx.saveSession?.();
    const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', XPOST_PREFIX);
    await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action(new RegExp(`^${XPOST_PREFIX}_custom_time_(\\d{4})-(\\d{2})-(\\d{2})$`), async (ctx) => {
    await safeAnswer(ctx);
    const session = getSession(ctx);
    const match = ctx.match[0].match(/custom_time_(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return;
    const [, year, month, day] = match;
    session.scheduleCustomDate = { year: parseInt(year, 10), month: parseInt(month, 10) - 1, day: parseInt(day, 10) };
    session.step = 'schedule_custom_time';
    await ctx.saveSession?.();
    const monthName = dateTimePicker.MONTHS_FULL.es[parseInt(month, 10) - 1];
    const formattedDate = `${day} ${monthName} ${year}`;
    await safeEditOrReply(ctx, `⌨️ *Hora Personalizada*\n\n📅 Fecha: *${formattedDate}*\n\nEscribe la hora en formato HH:MM (24 horas)`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Volver', `${XPOST_PREFIX}_date_${year}_${parseInt(month, 10) - 1}_${day}`)],
      ]),
    });
  });

  bot.action(`${XPOST_PREFIX}_confirm`, async (ctx) => {
    await safeAnswer(ctx);
    const session = getSession(ctx);
    const scheduledIso = session.scheduleTempDate;
    if (!scheduledIso) return;
    const scheduledAt = new Date(scheduledIso);
    const minutesUntil = Math.round((scheduledAt.getTime() - Date.now()) / 60000);
    session.step = STEPS.PREVIEW;
    await ctx.saveSession?.();
    await schedulePost(ctx, minutesUntil);
  });

  bot.action(`${XPOST_PREFIX}_change_tz`, async (ctx) => {
    await safeAnswer(ctx);
    const session = getSession(ctx);
    session.scheduleTimezone = session.scheduleTimezone || SERVER_TIMEZONE;
    await ctx.saveSession?.();
    await safeEditOrReply(ctx, '🌍 *Zona Horaria*\n\nSelecciona tu zona horaria:', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🇨🇴 Bogotá', `${XPOST_PREFIX}_tz_America/Bogota`)],
        [Markup.button.callback('🇺🇸 New York', `${XPOST_PREFIX}_tz_America/New_York`)],
        [Markup.button.callback('🇺🇸 Los Angeles', `${XPOST_PREFIX}_tz_America/Los_Angeles`)],
        [Markup.button.callback('🇲🇽 Mexico City', `${XPOST_PREFIX}_tz_America/Mexico_City`)],
        [Markup.button.callback('🇪🇸 Madrid', `${XPOST_PREFIX}_tz_Europe/Madrid`)],
        [Markup.button.callback('🇬🇧 London', `${XPOST_PREFIX}_tz_Europe/London`)],
        [Markup.button.callback('🌐 UTC', `${XPOST_PREFIX}_tz_UTC`)],
      ]),
    });
  });

  const xpostTimezones = [
    'America/Bogota',
    'America/New_York',
    'America/Los_Angeles',
    'America/Mexico_City',
    'Europe/Madrid',
    'Europe/London',
    'UTC',
  ];

  for (const tz of xpostTimezones) {
    bot.action(`${XPOST_PREFIX}_tz_${tz}`, async (ctx) => {
      await safeAnswer(ctx);
      const session = getSession(ctx);
      session.scheduleTimezone = tz;
      await ctx.saveSession?.();
      const scheduledIso = session.scheduleTempDate;
      if (!scheduledIso) return;
      const scheduledDate = new Date(scheduledIso);
      const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', XPOST_PREFIX);
      await safeEditOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
    });
  }

  // View scheduled
  bot.action('xpost_view_scheduled', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showScheduledPosts(ctx, true);
  });

  bot.action(/^xpost_scheduled_page_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    const page = parseInt(ctx.match[1], 10);
    await safeAnswer(ctx);
    await showScheduledPosts(ctx, true, page);
  });

  bot.action(/^xpost_cancel_(.+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    const postId = ctx.match[1];
    await cancelScheduledPost(ctx, postId);
  });

  // View history
  bot.action('xpost_view_history', async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    await safeAnswer(ctx);
    await showHistory(ctx, true);
  });

  bot.action(/^xpost_history_page_(\d+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');
    const page = parseInt(ctx.match[1], 10);
    await safeAnswer(ctx);
    await showHistory(ctx, true, page);
  });

  // Retry failed post
  bot.action(/^xpost_retry_(.+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const postId = ctx.match[1];
    await safeAnswer(ctx, '🔄 Reintentando...');

    try {
      const post = await XPostService.getPostById(postId);
      if (!post) {
        await ctx.reply('❌ Post no encontrado');
        return;
      }

      if (post.status !== 'failed') {
        await ctx.reply('❌ Solo se pueden reintentar posts fallidos');
        return;
      }

      // Get the account
      const account = await XPostService.getAccount(post.account_id);
      if (!account || !account.is_active) {
        await ctx.reply('❌ La cuenta de X no está disponible');
        return;
      }

      // Retry sending the post
      const result = await XPostService.sendPostNow({
        accountId: post.account_id,
        adminId: ctx.from.id,
        adminUsername: ctx.from.username,
        text: post.text,
        mediaUrl: post.media_url,
      });

      const tweetId = result.response?.data?.id;
      const tweetUrl = tweetId ? `https://x.com/i/status/${tweetId}` : null;

      let message = '✅ **Post Reenviado Exitosamente**\n\n';
      message += `📤 Cuenta: @${escapeMarkdown(account.handle || 'desconocida')}\n`;
      if (tweetUrl) {
        message += `\n🔗 [Ver en X](${tweetUrl})`;
      }

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      logger.info('Failed X post retried successfully', {
        adminId: ctx.from.id,
        originalPostId: postId,
        newPostId: result.postId,
        tweetId,
      });
    } catch (error) {
      logger.error('Error retrying X post:', error);
      await ctx.reply(`❌ Error al reintentar: ${error.message || 'desconocido'}`);
    }
  });

  // Copy post to new
  bot.action(/^xpost_copy_(.+)$/, async (ctx) => {
    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    if (!isAdmin) return ctx.answerCbQuery('❌ No autorizado');

    const postId = ctx.match[1];

    try {
      const post = await XPostService.getPostById(postId);
      if (!post) {
        await ctx.answerCbQuery('❌ Post no encontrado');
        return;
      }

      // Initialize a new session with the copied text
      clearSession(ctx);
      const session = getSession(ctx);

      // Pre-fill the text
      session.text = post.text;

      // If we know the account, pre-select it
      if (post.account_id) {
        const accounts = await XPostService.listActiveAccounts();
        const account = accounts.find(a => String(a.account_id) === String(post.account_id));
        if (account) {
          session.accountId = account.account_id;
          session.accountHandle = account.handle;
        }
      }

      await ctx.saveSession?.();

      await safeAnswer(ctx, '📋 Texto copiado');
      await ctx.reply(
        '📋 **Post Copiado**\n\n'
        + 'El texto ha sido copiado. Puedes editarlo antes de publicar.\n\n'
        + `📝 Texto: ${escapeMarkdown((post.text || '').substring(0, 50))}...`,
        { parse_mode: 'Markdown' },
      );

      // Go to account selection if not pre-selected, otherwise to compose
      if (session.accountId) {
        await showComposeText(ctx);
      } else {
        await showAccountSelection(ctx);
      }

      logger.info('X post copied for new post', {
        adminId: ctx.from.id,
        sourcePostId: postId,
      });
    } catch (error) {
      logger.error('Error copying X post:', error);
      await ctx.answerCbQuery('❌ Error al copiar').catch(() => {});
    }
  });

  logger.info('X post wizard handlers registered');
};

module.exports = {
  registerXPostWizardHandlers,
  showXPostMenu,
  handleTextInput,
  handleMediaInput,
  getSession,
  STEPS,
};
