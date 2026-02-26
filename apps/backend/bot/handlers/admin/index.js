const { Markup } = require('telegraf');
const UserService = require('../../services/userService');
const PermissionService = require('../../services/permissionService');
const { PERMISSIONS } = require('../../../models/permissionModel');
const UserModel = require('../../../models/userModel');
const PaymentModel = require('../../../models/paymentModel');
const PlanModel = require('../../../models/planModel');
const ModerationModel = require('../../../models/moderationModel');
const PaymentWebhookEventModel = require('../../../models/paymentWebhookEventModel');
const PaymentService = require('../../services/paymentService');
const PaymentSecurityService = require('../../services/paymentSecurityService');
const PromoService = require('../../services/promoService');
const PromoModel = require('../../../models/promoModel');
const adminService = require('../../services/adminService');
const { getBroadcastQueueIntegration } = require('../../services/broadcastQueueIntegration');
const BroadcastService = require('../../services/broadcastService');
const GrokService = require('../../services/grokService');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage, validateUserInput } = require('../../utils/helpers');
const sanitize = require('../../../utils/sanitizer');
const broadcastUtils = require('../../utils/broadcastUtils');
const performanceUtils = require('../../utils/performanceUtils');
const uxUtils = require('../../utils/uxUtils');
const BroadcastButtonModel = require('../../../models/broadcastButtonModel');
const { registerBroadcastHandlers } = require('./broadcastManagement');
const { registerXAccountHandlers } = require('./xAccountWizard');
const { registerXPostWizardHandlers, handleTextInput: handleXPostTextInput, handleMediaInput: handleXPostMediaInput, getSession: getXPostSession, STEPS: XPOST_STEPS } = require('./xPostWizard');
const { registerUserManagementHandlers } = require('./userManagementHandler');
const XFollowersManagement = require('./xFollowersManagement');
const PlaylistAdminService = require('../../services/PlaylistAdminService');
const RadioAdminService = require('../../services/RadioAdminService');
const CristinaAdminInfoService = require('../../../services/cristinaAdminInfoService');
const { chatWithCristina, isCristinaAIAvailable } = require('../../services/cristinaAIService');

// Use shared utilities
const { sanitizeInput } = broadcastUtils;

const formatBroadcastTargetLabel = (target, lang = 'es') => {
  const labels = {
    all: { es: 'Todos', en: 'All' },
    premium: { es: 'Premium', en: 'Premium' },
    free: { es: 'Gratis', en: 'Free' },
    churned: { es: 'Churned (Ex-Premium)', en: 'Churned (Ex-Premium)' },
    payment_incomplete: { es: 'Pagos no completados', en: 'Payment Not Completed' },
  };
  return labels[target]?.[lang] || target;
};

const generateRecoveryPromoCode = () => {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RECOV30${suffix}`;
};

const safeAnswerCbQuery = async (ctx, text, options = {}) => {
  if (!ctx?.answerCbQuery) return;
  try {
    if (typeof text === 'string') {
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
      logger.debug('Callback query expired', { error: description });
      return;
    }
    logger.warn('Failed to answer callback query', { error: description });
  }
};

function getBroadcastStepLabel(step, lang) {
  const labels = {
    // Paso 1/5: Selección de audiencia
    audience: 'Paso 1/5: Seleccionar Audiencia',

    // Paso 2/5: Media (opcional)
    media: 'Paso 2/5: Media (Opcional)',

    // Paso 3/5: Texto en inglés (opcional)
    text_en: 'Paso 3/5: Texto en Inglés (Opcional)',
    ai_prompt_en: 'Paso 3/5: AI (Inglés)',
    review_ai_en: 'Paso 3/5: Revisión AI (Inglés)',
    edit_ai_en: 'Paso 3/5: Edición AI (Inglés)',

    // Paso 4/5: Texto en español (opcional)
    text_es: 'Paso 4/5: Texto en Español (Opcional)',
    ai_prompt_es: 'Paso 4/5: AI (Español)',
    review_ai_es: 'Paso 4/5: Revisión AI (Español)',
    edit_ai_es: 'Paso 4/5: Edición AI (Español)',

    // Paso 5/5: Botones y envío (unificado)
    buttons: 'Paso 5/5: Botones y Envío',
    custom_buttons: 'Paso 5/5: Botones Personalizados',
    preview: 'Paso 5/5: Vista Previa y Envío',
    schedule_options: 'Paso 5/5: Programación',
    schedule_datetime: 'Programación (Fecha/Hora)',
    schedule_count: 'Programación (Cantidad)',
    sending: 'Enviando…',
  };
  return labels[step] || step || 'Desconocido';
}

// Use shared utilities for button management
const {
  getStandardButtonOptions,
  normalizeButtons,
  buildInlineKeyboard,
  buildDefaultBroadcastButtons
} = broadcastUtils;

function getBroadcastButtonOptions(lang) {
  const options = getStandardButtonOptions();

  // Return options as-is (button text is already in English)
  // Language preference doesn't affect button labels in this implementation
  return options;
}

function summarizeBroadcastButtons(buttons) {
  const normalized = normalizeButtons(buttons);
  return normalized.map((b) => {
    const obj = typeof b === 'string' ? JSON.parse(b) : b;
    return obj.text;
  });
}

const CRISTINA_SUMMARY_MAX = 200;

function shortenCristinaValue(value = '', max = CRISTINA_SUMMARY_MAX) {
  if (!value) return '_Sin actualizaciones._';
  if (value.length <= max) {
    return value;
  }
  return `${value.substring(0, max)}…`;
}

async function replyOrEditMessage(ctx, message, keyboard, edit) {
  const options = {
    parse_mode: 'Markdown',
    ...keyboard,
  };

  if (edit) {
    try {
      await ctx.editMessageText(message, options);
      return;
    } catch (error) {
      logger.warn('Editar mensaje falló, reintentando con reply', {
        error: error.message,
      });
    }
  }

  await ctx.reply(message, options);
}

async function showCristinaAdminMenu(ctx, edit = false) {
  const brief = await CristinaAdminInfoService.getBrief();
  const summaryLines = [
    '*📌 Actualizaciones almacenadas*',
    `• *Planes de Lex:* ${shortenCristinaValue(brief.lexPlan)}`,
    `• *Planes del canal:* ${shortenCristinaValue(brief.channelPlan)}`,
  ].join('\n');

  const message = [
    '`🧠 Cristina Asistente Admin`',
    'Actualiza el conocimiento que necesita Cristina para recomendar planes y canales, y mantén los precios/estado del bot sincronizados.',
    summaryLines,
  ].join('\n\n');

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📝 Alimentar info (Lex/Canal)', 'cristina_admin_feed_menu')],
    [Markup.button.callback('🔄 Actualizar precios + bot', 'cristina_admin_refresh_system')],
    [Markup.button.callback('👑 Cristina soy Lex', 'cristina_admin_lex_mode')],
    [Markup.button.callback('◀️ Volver', 'admin_home')],
  ]);

  await replyOrEditMessage(ctx, message, keyboard, edit);
}

async function showCristinaFeedMenu(ctx, edit = false) {
  const message = [
    '`📝 Alimentar a Cristina`',
    'Escribe un párrafo corto (1–2 frases) describiendo los planes actualizados para Lex o para el canal. Cristina guardará el texto tal como lo mandes y lo usará en sus respuestas.',
  ].join('\n\n');

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Planes de Lex', 'cristina_admin_feed_section_lex')],
    [Markup.button.callback('✍️ Planes del canal', 'cristina_admin_feed_section_channel')],
    [Markup.button.callback('◀️ Volver', 'cristina_admin_menu')],
  ]);

  await replyOrEditMessage(ctx, message, keyboard, edit);
}

const LEX_MODE_SYSTEM_PROMPT = `Eres Cristina, asesora privada de administración de PNP Latino TV. Estás hablando directamente con Lex, el administrador principal.

TU ROL:
- Ayudar a Lex a entender y usar todas las opciones del panel de administración del bot.
- Dar consejos prácticos de marketing digital y redes sociales para una plataforma de entretenimiento LGBTQ+ latina.
- Traducir textos entre inglés y español cuando se te pida explícitamente.

ESTILO:
- Habla en español por defecto, a menos que Lex pida inglés.
- Sé directa, concisa y profesional. Máximo un párrafo.
- Si Lex te pide traducir, proporciona SOLO la traducción sin explicaciones adicionales.

FUNCIONES DEL BOT que puedes explicar:
- Broadcasts (enviar mensajes a usuarios), Cola de broadcasts, Programación
- Gestión de usuarios (búsqueda, roles, permisos, moderación)
- Planes y precios (crear, editar, promociones)
- Contenido (playlists, radio, videos, streams en vivo)
- X/Twitter (publicaciones, cuenta conectada)
- Pagos y webhooks
- Nearby, Hangouts, Videorama, PNP Live

NO:
- No reveles información técnica interna del código.
- No hagas cambios al sistema, solo asesora.`;

const lexModeHistory = new Map();
const LEX_HISTORY_MAX = 6;

async function processLexModeMessage(userId, text) {
  const history = lexModeHistory.get(userId) || [];
  const messages = [...history, { role: 'user', content: text }];

  const response = await chatWithCristina({
    systemPrompt: LEX_MODE_SYSTEM_PROMPT,
    messages,
    maxTokens: parseInt(process.env.CRISTINA_MAX_TOKENS || '500', 10),
    temperature: 0.7,
  });

  // Update history
  history.push({ role: 'user', content: text });
  history.push({ role: 'assistant', content: response });
  if (history.length > LEX_HISTORY_MAX) {
    lexModeHistory.set(userId, history.slice(-LEX_HISTORY_MAX));
  } else {
    lexModeHistory.set(userId, history);
  }

  return response;
}

async function createScheduledBroadcastsFromTimes(ctx, scheduledTimes, timezone) {
  const { broadcastTarget, broadcastData } = ctx.session.temp;

  if (!broadcastData || !broadcastData.textEn || !broadcastData.textEs) {
    await ctx.reply('❌ Error: Faltan datos del broadcast');
    return { successCount: 0, errorCount: 1, broadcastIds: [] };
  }

  const broadcastIds = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < scheduledTimes.length; i += 1) {
    try {
      const scheduledTime = scheduledTimes[i];
      const broadcast = await BroadcastService.createBroadcast({
        adminId: String(ctx.from.id),
        adminUsername: ctx.from.username || 'Admin',
        title: `Broadcast programado ${scheduledTime.toLocaleDateString()} ${scheduledTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} (${timezone})`,
        messageEn: broadcastData.textEn,
        messageEs: broadcastData.textEs,
        targetType: broadcastTarget,
        mediaType: broadcastData.mediaType || null,
        mediaUrl: broadcastData.s3Url || broadcastData.mediaFileId || null,
        mediaFileId: broadcastData.mediaFileId || null,
        s3Key: broadcastData.s3Key || null,
        s3Bucket: broadcastData.s3Bucket || null,
        includeFilters: broadcastData.includeFilters || {},
        scheduledAt: scheduledTime,
        timezone: timezone,
      });

      if (broadcastData.buttons && broadcastData.buttons.length > 0) {
        try {
          await BroadcastButtonModel.addButtonsToBroadcast(broadcast.broadcast_id, broadcastData.buttons);
          logger.info(`Buttons added to broadcast ${broadcast.broadcast_id}`, {
            buttonCount: broadcastData.buttons.length
          });
        } catch (buttonError) {
          logger.error(`Error adding buttons to broadcast ${broadcast.broadcast_id}:`, buttonError);
        }
      }

      broadcastIds.push(broadcast.broadcast_id);
      successCount += 1;
    } catch (error) {
      logger.error(`Error creating broadcast ${i + 1}:`, error);
      errorCount += 1;
    }
  }

  return { successCount, errorCount, broadcastIds };
}

async function createRecurringBroadcastFromSchedule(ctx, scheduledDate) {
  const timezone = ctx.session.temp.timezone || 'UTC';
  const {
    broadcastTarget,
    broadcastData,
    recurrencePattern,
    maxOccurrences,
    cronExpression,
  } = ctx.session.temp;

  if (!broadcastData || !broadcastData.textEn || !broadcastData.textEs) {
    await ctx.reply('❌ Error: Faltan datos del broadcast');
    return null;
  }

  const patternLabels = {
    daily: 'Diario',
    weekly: 'Semanal',
    monthly: 'Mensual',
    custom: 'Personalizado',
  };

  const broadcast = await BroadcastService.createRecurringBroadcast({
    adminId: String(ctx.from.id),
    adminUsername: ctx.from.username || 'Admin',
    title: `Broadcast recurrente ${patternLabels[recurrencePattern] || recurrencePattern} - ${scheduledDate.toLocaleDateString()}`,
    messageEn: broadcastData.textEn,
    messageEs: broadcastData.textEs,
    targetType: broadcastTarget,
    mediaType: broadcastData.mediaType || null,
    mediaUrl: broadcastData.s3Url || broadcastData.mediaFileId || null,
    mediaFileId: broadcastData.mediaFileId || null,
    s3Key: broadcastData.s3Key || null,
    s3Bucket: broadcastData.s3Bucket || null,
    includeFilters: broadcastData.includeFilters || {},
    scheduledAt: scheduledDate,
    timezone: timezone,
    isRecurring: true,
    recurrencePattern: recurrencePattern,
    cronExpression: cronExpression || null,
    maxOccurrences: maxOccurrences,
  });

  if (broadcastData.buttons && broadcastData.buttons.length > 0) {
    try {
      await BroadcastButtonModel.addButtonsToBroadcast(broadcast.broadcast_id, broadcastData.buttons);
      logger.info(`Buttons added to recurring broadcast ${broadcast.broadcast_id}`, {
        buttonCount: broadcastData.buttons.length
      });
    } catch (buttonError) {
      logger.error(`Error adding buttons to broadcast ${broadcast.broadcast_id}:`, buttonError);
    }
  }

  return broadcast;
}

async function sendBroadcastPreview(ctx) {
  const lang = getLanguage(ctx);
  const data = ctx.session?.temp?.broadcastData;

  // Validate session exists
  if (!ctx.session?.temp?.broadcastTarget) {
    await ctx.reply('❌ Sesión expirada. Inicia de nuevo.');
    return;
  }

  // Validate that we have at least SOME content (text or media)
  const hasTextEn = data?.textEn && data.textEn.trim().length > 0;
  const hasTextEs = data?.textEs && data.textEs.trim().length > 0;
  const hasMedia = data?.mediaFileId;

  if (!hasTextEn && !hasTextEs && !hasMedia) {
    await ctx.reply(
      '❌ Debes proporcionar al menos uno de los siguientes:\n• Texto en inglés\n• Texto en español\n• Media (imagen/video/archivo)'
    );
    return;
  }

  // Log warning if only one language provided
  if (!hasTextEn || !hasTextEs) {
    const missingLang = !hasTextEn ? 'inglés' : 'español';
    logger.warn(`Broadcasting without ${missingLang} text`, {
      userId: ctx.from.id,
      hasTextEn,
      hasTextEs,
      hasMedia
    });
  }

  const buttons = summarizeBroadcastButtons(data.buttons);
  const buttonsText = buttons.length ? buttons.map((t) => `• ${t}`).join('\n') : '_Sin botones_';
  const mediaText = data.mediaType ? `📎 ${data.mediaType}` : '📝 Solo texto';

  const previewText =
    '🎯 *Paso 5/5: Botones y Envío*\n\n' +
    '📌 *Parte 2: Vista Previa y Envío*\n\n' +
    '👀 *Vista previa del Broadcast:*' +
    `\n\n${mediaText}\n\n` +
    (hasTextEn ? `*EN:*\n${data.textEn}\n\n` : '') +
    (hasTextEs ? `*ES:*\n${data.textEs}\n\n` : '') +
    `*Botones:*\n${buttonsText}\n\n` +
    (ctx.session.temp?.broadcastData?.sendEmail
      ? `*Email:*\n` +
        `• EN subject: ${data.emailSubjectEn || '_auto_'}\n` +
        `• ES subject: ${data.emailSubjectEs || '_auto_'}\n` +
        `• EN preheader: ${data.emailPreheaderEn || '_auto_'}\n` +
        `• ES preheader: ${data.emailPreheaderEs || '_auto_'}\n\n`
      : '') +
    '¿Listo para enviar?';

  // Check if email sending is enabled
  const sendEmail = ctx.session.temp?.broadcastData?.sendEmail || false;
  const emailToggleText = sendEmail
    ? '✅ También enviar por Email'
    : '📧 También enviar por Email';

    const keyboardRows = [
      [Markup.button.callback(emailToggleText, 'broadcast_toggle_email')],
      [Markup.button.callback('📤 Enviar Ahora', 'broadcast_send_now_with_buttons')],
      [Markup.button.callback('📅 Programar Envío', 'broadcast_schedule_with_buttons')],
      [Markup.button.callback('◀️ Volver a Botones', 'broadcast_resume_buttons')],
      [Markup.button.callback('❌ Cancelar Broadcast', 'admin_cancel')],
    ];

    if (sendEmail) {
      keyboardRows.splice(1, 0,
        [Markup.button.callback('✉️ Subject EN', 'broadcast_edit_email_subject_en')],
        [Markup.button.callback('✉️ Subject ES', 'broadcast_edit_email_subject_es')],
        [Markup.button.callback('📝 Preheader EN', 'broadcast_edit_email_preheader_en')],
        [Markup.button.callback('📝 Preheader ES', 'broadcast_edit_email_preheader_es')]
      );
    }

    const keyboard = Markup.inlineKeyboard(keyboardRows);

  // Also send a "rendered" preview with buttons for one language (EN) so admin sees layout.
  try {
    const buttonMarkup = (() => {
      const rows = [];
      for (const btn of normalizeButtons(data.buttons)) {
        const b = typeof btn === 'string' ? JSON.parse(btn) : btn;
        if (b.type === 'url') rows.push([Markup.button.url(b.text, b.target)]);
        else if (b.type === 'callback') rows.push([Markup.button.callback(b.text, b.data)]);
      }
      return rows.length ? Markup.inlineKeyboard(rows) : undefined;
    })();

    // Use English text if available, otherwise Spanish, otherwise empty string
    const previewCaption = hasTextEn ? `📢 ${data.textEn}` : hasTextEs ? `📢 ${data.textEs}` : '📢';

    if (data.mediaType === 'photo') {
      await ctx.replyWithPhoto(data.mediaFileId, {
        caption: previewCaption,
        parse_mode: 'Markdown',
        ...(buttonMarkup ? { reply_markup: buttonMarkup.reply_markup } : {}),
      });
    } else if (data.mediaType === 'video') {
      await ctx.replyWithVideo(data.mediaFileId, {
        caption: previewCaption,
        parse_mode: 'Markdown',
        ...(buttonMarkup ? { reply_markup: buttonMarkup.reply_markup } : {}),
      });
    } else if (data.mediaType === 'document') {
      await ctx.replyWithDocument(data.mediaFileId, {
        caption: previewCaption,
        parse_mode: 'Markdown',
        ...(buttonMarkup ? { reply_markup: buttonMarkup.reply_markup } : {}),
      });
    } else if (hasTextEn || hasTextEs) {
      // Only send text preview if we have text
      await ctx.reply(previewCaption, {
        parse_mode: 'Markdown',
        ...(buttonMarkup ? { reply_markup: buttonMarkup.reply_markup } : {}),
      });
    }
  } catch (error) {
    logger.warn('Failed to send rendered preview (continuing):', error.message);
  }

  await ctx.reply(previewText, { parse_mode: 'Markdown', ...keyboard });
}

async function showBroadcastButtonsPicker(ctx) {
  const lang = getLanguage(ctx);
  const options = getBroadcastButtonOptions(lang);

  if (!ctx.session.temp?.broadcastData) ctx.session.temp.broadcastData = {};

  // Normalize and ensure buttons array
  ctx.session.temp.broadcastData.buttons = normalizeButtons(ctx.session.temp.broadcastData.buttons);

  // DEFENSIVE FIX: Step progression guard in button picker
  // Check if we have a max completed step to prevent regression
  const currentStep = ctx.session.temp.broadcastStep;
  const maxCompletedStep = ctx.session.temp.maxCompletedStep;
  
  // Define step order for progression validation
  const stepOrder = ['media', 'text_en', 'ai_prompt_en', 'text_es', 'ai_prompt_es', 'buttons', 'preview', 'sending'];
  
  if (maxCompletedStep) {
    const currentStepIndex = stepOrder.indexOf(currentStep);
    const maxStepIndex = stepOrder.indexOf(maxCompletedStep);
    
    // If current step is before max completed step, prevent regression
    // EXCEPT: Allow button picker to run when called from text_es step (normal progression)
    if (currentStepIndex < maxStepIndex && currentStep !== 'text_es') {
      logger.warn('Step regression detected in button picker - preventing', {
        userId: ctx.from.id,
        attemptedStep: currentStep,
        maxCompletedStep: maxCompletedStep,
        currentStepIndex,
        maxStepIndex
      });
      
      // Force back to the correct step
      ctx.session.temp.broadcastStep = maxCompletedStep;
      await ctx.saveSession();
      
      logger.info('Step regression prevented in button picker - restored to max completed step', {
        userId: ctx.from.id,
        restoredStep: ctx.session.temp.broadcastStep
      });
      
      return; // Exit to prevent further processing with wrong step
    }
  }
  
  // Ensure we're in the buttons step with additional safeguards
  if (currentStep !== 'buttons') {
    logger.info('Broadcast step correction in button picker', {
      userId: ctx.from.id,
      fromStep: currentStep,
      toStep: 'buttons'
    });
    ctx.session.temp.broadcastStep = 'buttons';
    await ctx.saveSession();
  }

  // Log button picker display
  logger.info('Displaying button picker', {
    userId: ctx.from.id,
    broadcastStep: ctx.session.temp.broadcastStep,
    buttonCount: ctx.session.temp.broadcastData.buttons.length
  });

  const currentButtons = ctx.session.temp.broadcastData.buttons || [];
  const selectedKeys = new Set(
    currentButtons
      .map((b) => (typeof b === 'string' ? JSON.parse(b).key : b.key))
      .filter(Boolean),
  );

  const rows = options.map((opt) => {
    const on = selectedKeys.has(opt.key);
    const label = on ? `✅ ${opt.text}` : `➕ ${opt.text}`;
    return [Markup.button.callback(label, `broadcast_toggle_${opt.key}`)];
  });

  // Show any custom buttons that have been added (not in preset options)
  const presetKeys = new Set(options.map(opt => opt.key));
  const customButtons = currentButtons.filter(b => {
    const btn = typeof b === 'string' ? JSON.parse(b) : b;
    return !presetKeys.has(btn.key) || btn.key === 'custom';
  });

  for (let i = 0; i < customButtons.length; i++) {
    const btn = typeof customButtons[i] === 'string' ? JSON.parse(customButtons[i]) : customButtons[i];
    rows.push([Markup.button.callback(`✅ ${btn.text} 🔗`, `broadcast_remove_custom_${i}`)]);
  }

  rows.push([Markup.button.callback('➕ Link Personalizado', 'broadcast_add_custom_link')]);
  rows.push([Markup.button.callback('✅ Continuar a Vista Previa', 'broadcast_continue_with_buttons')]);
  rows.push([Markup.button.callback('⏭️ Sin Botones', 'broadcast_no_buttons')]);
  rows.push([Markup.button.callback('❌ Cancelar', 'admin_cancel')]);

  await ctx.reply(
    '🎯 *Paso 5/5: Botones y Envío*\n\n' +
    '📌 *Parte 1: Seleccionar Botones*\n\n' +
    'Selecciona 1 o varios botones para incluir en el broadcast, o elige "Sin Botones" para continuar.\n\n' +
    'Cuando estés listo, presiona "✅ Continuar" para ver la vista previa y enviar.',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) },
  );
}

async function showBroadcastResumePrompt(ctx) {
  const lang = getLanguage(ctx);
  const step = ctx.session?.temp?.broadcastStep;
  const label = getBroadcastStepLabel(step, lang);
  await ctx.editMessageText(
    `⚠️ Tienes un broadcast en progreso.\n\n*Estado:* ${label}\n\n¿Deseas reanudar o reiniciar?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('▶️ Reanudar', 'broadcast_resume')],
        [Markup.button.callback('🔁 Reiniciar', 'broadcast_restart')],
        [Markup.button.callback('◀️ Volver', 'admin_cancel')],
      ]),
    },
  );
}

/**
 * Update broadcast step with validation and atomic save
 * @param {Object} ctx - Telegraf context
 * @param {string} newStep - New step to transition to
 */
async function updateBroadcastStep(ctx, newStep) {
  const validSteps = [
    'media',
    'text_en',
    'text_es',
    'ai_prompt_en',
    'ai_prompt_es',
    'review_ai_en',
    'review_ai_es',
    'edit_ai_en',
    'edit_ai_es',
    'buttons',
    'preview',
    'sending',
    'schedule_count',
    'custom_link',
    'custom_buttons',
  ];

  if (!validSteps.includes(newStep)) {
    logger.error(`Invalid broadcast step transition attempted: ${newStep}`);
    throw new Error(`Invalid broadcast step: ${newStep}`);
  }

  const previousStep = ctx.session.temp?.broadcastStep;
  ctx.session.temp.broadcastStep = newStep;

  try {
    await ctx.saveSession();
    logger.info(`Broadcast step updated: ${previousStep} → ${newStep}`, {
      userId: ctx.from.id,
      previousStep,
      newStep
    });
  } catch (error) {
    logger.error('Failed to save broadcast step:', {
      error: error.message,
      previousStep,
      attemptedStep: newStep
    });
    throw error;
  }
}

/**
 * Get appropriate fallback step on error
 * @param {string} currentStep - Current step
 * @returns {string} Safe fallback step
 */
function getFallbackStep(currentStep) {
  const fallbackMap = {
    'ai_prompt_en': 'text_en',
    'ai_prompt_es': 'text_es',
    'custom_link': 'buttons',
    'custom_buttons': 'buttons'
  };

  return fallbackMap[currentStep] || currentStep;
}

async function renderBroadcastStep(ctx) {
  const lang = getLanguage(ctx);
  const step = ctx.session?.temp?.broadcastStep;
  
  logger.info('Rendering broadcast step', {
    userId: ctx.from.id,
    broadcastTarget: ctx.session?.temp?.broadcastTarget,
    broadcastStep: step
  });

  if (!ctx.session?.temp?.broadcastTarget) {
    logger.warn('No broadcast target found in session', { userId: ctx.from.id });
    await ctx.editMessageText(
      '❌ Sesión expirada. Inicia de nuevo desde /admin.',
      Markup.inlineKeyboard([[Markup.button.callback('◀️ Volver', 'admin_cancel')]]),
    );
    return;
  }

  if (step === 'media') {
    const message = await ctx.editMessageText(
      '📎 *Paso 2/5: Subir Media (Opcional)*\n\n'
      + 'Envía una imagen, video o archivo para adjuntar al broadcast.\n\n'
      + '💡 También puedes saltar este paso si solo quieres enviar texto.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Saltar (Solo Texto)', 'broadcast_skip_media')],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      },
    );

    // Store message ID to delete later when media is uploaded
    // For editMessageText, the message ID is from the callback query message
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      ctx.session.temp.mediaPromptMessageId = ctx.callbackQuery.message.message_id;
      await ctx.saveSession();
      logger.info('Stored media prompt message ID for deletion', {
        messageId: ctx.callbackQuery.message.message_id
      });
    }

    return;
  }

  if (step === 'text_en') {
    await ctx.editMessageText(
      '🇺🇸 *Paso 3/5: Texto en Inglés (Opcional)*\n\n'
      + 'Escribe el mensaje en inglés que quieres enviar.\n\n'
      + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en inglés.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_en')],
          [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_en')],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      },
    );
    return;
  }

  if (step === 'text_es') {
    await ctx.editMessageText(
      '🇪🇸 *Paso 4/5: Texto en Español (Opcional)*\n\n'
      + 'Escribe el mensaje en español que quieres enviar.\n\n'
      + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en español.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_es')],
          [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_es')],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      },
    );
    return;
  }

  if (step === 'review_ai_en' || step === 'review_ai_es') {
    const isEn = step === 'review_ai_en';
    const aiDraft = ctx.session.temp?.aiDraft || '';
    const safeDraft = sanitize.telegramMarkdown(aiDraft);

    if (!aiDraft) {
      await updateBroadcastStep(ctx, isEn ? 'text_en' : 'text_es');
      await renderBroadcastStep(ctx);
      return;
    }

    await ctx.editMessageText(
      `🤖 *AI Draft (${isEn ? 'EN' : 'ES'}):*\n\n${safeDraft}\n\n` +
      '_Puedes usar este texto o editarlo manualmente._',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Usar texto', isEn ? 'broadcast_use_ai_en' : 'broadcast_use_ai_es')],
          [Markup.button.callback('✏️ Editar manualmente', isEn ? 'broadcast_edit_ai_en' : 'broadcast_edit_ai_es')],
          [Markup.button.callback('🔄 Regenerar', isEn ? 'broadcast_ai_en' : 'broadcast_ai_es')],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      },
    );
    return;
  }

  if (step === 'edit_ai_en' || step === 'edit_ai_es') {
    const isEn = step === 'edit_ai_en';
    const aiDraft = ctx.session.temp?.aiDraft || '';
    const safeDraft = sanitize.telegramMarkdown(aiDraft);

    await ctx.editMessageText(
      `✏️ *Editar texto (${isEn ? 'EN' : 'ES'})*\n\n` +
      'Envía el texto editado que quieres usar:\n\n' +
      (aiDraft ? `_Texto actual:_\n\`\`\`\n${safeDraft}\n\`\`\`` : '_Texto actual:_ (vacío)'),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Volver', isEn ? 'broadcast_ai_en' : 'broadcast_ai_es')],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      },
    );
    return;
  }

  if (step === 'buttons' || step === 'custom_buttons') {
    await showBroadcastButtonsPicker(ctx);
    return;
  }

  await ctx.editMessageText(
    `ℹ️ Broadcast en progreso (${getBroadcastStepLabel(step, lang)}).\n\nUsa Reiniciar si no avanza.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔁 Reiniciar', 'broadcast_restart')],
      [Markup.button.callback('◀️ Volver', 'admin_cancel')],
    ]),
  );
}

/**
 * Show admin panel based on user role
 * @param {Context} ctx - Telegraf context
 * @param {boolean} edit - Whether to edit message or send new
 */
async function showAdminPanel(ctx, edit = false) {
  try {
    const lang = getLanguage(ctx);
    const userId = ctx.from.id;
    const userRole = await PermissionService.getUserRole(userId);
    const roleDisplay = await PermissionService.getUserRoleDisplay(userId, lang);

    // Optional stats (Firestore may be disabled in some deployments)
    let statsText = '';
    try {
      if (userRole === 'superadmin' || userRole === 'admin') {
        const stats = await adminService.getDashboardStats();
        statsText = broadcastUtils.formatDashboardStats(stats, lang);
      }
    } catch (error) {
      logger.warn(`Admin stats unavailable (continuing without stats): ${error.message}`);
    }

    const cristinaBrief = await CristinaAdminInfoService.getBrief();
    const cristinaSummaryText = [
      '*Cristina Admin Info:*',
      `• Lex: ${shortenCristinaValue(cristinaBrief.lexPlan)}`,
      `• Canal: ${shortenCristinaValue(cristinaBrief.channelPlan)}`,
    ].join('\n');

    // Build menu based on role with organized sections
    const buttons = [];

    // ═══ CONTROLES PRINCIPALES ═══
    buttons.push([
      Markup.button.callback('🔄 Actualizar', 'admin_refresh'),
      Markup.button.callback('🧪 Prueba', 'test_callback'),
    ]);

    // ═══ GESTIÓN DE USUARIOS ═══
    buttons.push([
      Markup.button.callback('👥 Usuarios', 'admin_users'),
      Markup.button.callback('🎁 Membresía', 'admin_activate_membership'),
    ]);

    // Funciones de Admin y SuperAdmin
    if (userRole === 'superadmin' || userRole === 'admin') {
      // ═══ CONTENIDO Y COMUNICACIÓN ═══
      buttons.push([
        Markup.button.callback('📢 Difusión', 'admin_broadcast'),
        Markup.button.callback('📤 Compartir', 'admin_improved_share_post'),
      ]);

      buttons.push([
        Markup.button.callback('🐦 Publicar en X', 'xpost_menu'),
        Markup.button.callback('⚙️ X Cuentas', 'admin_x_accounts_configure_x'),
      ]);

      // ═══ PROMOS Y MARKETING ═══
      buttons.push([
        Markup.button.callback('🎁 Promos', 'promo_admin_menu'),
      ]);
      buttons.push([
        Markup.button.callback('⚡ Recovery 30%', 'admin_recovery_30'),
      ]);

      // ═══ PNP LIVE / PERFORMERS ═══
      buttons.push([
        Markup.button.callback('🎭 Performers', 'admin_performers'),
      ]);

      // ═══ LUGARES Y NEGOCIOS ═══
      buttons.push([
        Markup.button.callback('🏪 Business Admin', 'admin_business_dashboard'),
        Markup.button.callback('📍 Nearby Places', 'admin_nearby_places'),
      ]);

      // ═══ SISTEMA Y HERRAMIENTAS ═══
      buttons.push([
        Markup.button.callback('📦 Cola', 'admin_queue_status'),
        Markup.button.callback('👁️ Vista Previa', 'admin_view_mode'),
      ]);
      buttons.push([
        Markup.button.callback('🧠 Cristina Asistente Admin', 'cristina_admin_menu'),
      ]);
      buttons.push([
        Markup.button.callback('💳 Webhooks Pago', 'admin_payment_webhooks'),
        Markup.button.callback('🔒 Security Report', 'admin_security_report'),
      ]);
    }

    // Funciones solo para SuperAdmin
    if (userRole === 'superadmin' || userRole === 'admin') {
      buttons.push([
        Markup.button.callback('👑 Roles', 'admin_roles'),
      ]);
    }

    if (userRole === 'superadmin') {
      // ═══ ADMINISTRACIÓN ═══
      buttons.push([
        Markup.button.callback('📜 Registros', 'admin_logs'),
      ]);
    }

    // Construir mensaje con estilo
    const header = '`⚙️ Panel de Administración`';
    const divider = '━━━━━━━━━━━━━━━━━━━━';
    const footer = '`Selecciona una opción 💜`';

    const statsSection = statsText ? `${statsText}\n\n` : '';
    const message = `${header}\n${divider}\n\n${roleDisplay}\n\n${statsSection}${cristinaSummaryText}\n\n${footer}`;

    const options = {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    };

    if (edit) {
      await ctx.editMessageText(message, options);
    } else {
      await ctx.reply(message, options);
    }
  } catch (error) {
    logger.error('Error showing admin panel:', error);
  }
}

/**
 * Admin handlers
 * @param {Telegraf} bot - Bot instance
 */
// Import handlers
const registerImprovedSharePostHandlers = require('./improvedSharePost');
const { registerPromoAdminHandlers } = require('./promoAdmin');

let registerAdminHandlers = (bot) => {
  logger.info('[DEBUG-INIT] registerAdminHandlers called - registering admin command handlers');
  // Register handlers
  registerImprovedSharePostHandlers(bot);
  registerPromoAdminHandlers(bot);
  registerXAccountHandlers(bot, {
    sessionKey: 'adminXAccountWizard',
    actionPrefix: 'admin_x_accounts',
    backAction: 'admin_home',
    title: '🐦 X Accounts',
    emptyTitle: '🐦 X Accounts',
    emptyBody: 'No hay cuentas activas configuradas.\nPuedes conectar una nueva cuenta ahora mismo.',
    prompt: 'Selecciona la cuenta desde la cual se publicará:',
    connectLabel: '➕ Conectar cuenta X',
    disableLabel: '🚫 No publicar en X',
    allowDisconnect: true,
    disconnectLabel: '🧹 Desconectar',
    backLabel: '⬅️ Volver al panel',
    notifyOnEmpty: true,
  });

  // Register X Post Wizard handlers
  registerXPostWizardHandlers(bot);

  bot.action('admin_home', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await showAdminPanel(ctx, true);
    } catch (error) {
      logger.error('Error in admin_home:', error);
    }
  });

  bot.action('admin_refresh', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await showAdminPanel(ctx, true);
    } catch (error) {
      logger.error('Error in admin_refresh:', error);
    }
  });

  bot.action('cristina_admin_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await showCristinaAdminMenu(ctx, true);
    } catch (error) {
      logger.error('Error opening Cristina admin menu:', error);
    }
  });

  bot.action('cristina_admin_feed_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await showCristinaFeedMenu(ctx, true);
    } catch (error) {
      logger.error('Error opening Cristina feed menu:', error);
    }
  });

  bot.action('cristina_admin_feed_section_lex', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.awaitingCristinaAdminText = true;
      ctx.session.temp.cristinaAdminFeed = { section: 'lex' };
      await ctx.saveSession();

      await ctx.reply(
        '✍️ Envía un párrafo corto que describa los planes recientes de Lex. Cristina guardará este contenido para usarlo en sus respuestas de soporte.'
      );
    } catch (error) {
      logger.error('Error preparando el feed de Lex:', error);
    }
  });

  bot.action('cristina_admin_feed_section_channel', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.awaitingCristinaAdminText = true;
      ctx.session.temp.cristinaAdminFeed = { section: 'channel' };
      await ctx.saveSession();

      await ctx.reply(
        '✍️ Cuéntale a Cristina en un párrafo corto qué novedades hay sobre los planes del canal. Ella incorporará esa información a sus respuestas.'
      );
    } catch (error) {
      logger.error('Error preparando el feed del canal:', error);
    }
  });

  bot.action('cristina_admin_refresh_system', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const { pricing, botStatus } = await CristinaAdminInfoService.refreshSystemInfo();

      const message = [
        '`🔄 Actualizaciones del sistema`',
        '*Precios*',
        pricing,
        '*Estado del bot*',
        botStatus,
      ].join('\n\n');

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Volver a Cristina', 'cristina_admin_menu')],
      ]);

      await replyOrEditMessage(ctx, message, keyboard, true);
    } catch (error) {
      logger.error('Error actualizando la info del sistema:', error);
      await ctx.reply('❌ No se pudo actualizar la información del sistema. Reintenta más tarde.');
    }
  });

  bot.action('cristina_admin_lex_mode', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.cristinaLexMode = true;
      await ctx.saveSession();

      const message = [
        '*👑 Modo Lex Activado*',
        'Cristina ahora te responderá como asesora de administración. Puedes:',
        '1. Preguntarle cómo usar cualquier opción del panel de admin.',
        '2. Pedirle consejos de marketing y redes sociales.',
        '3. Pedirle traducciones EN↔ES empezando con `Lex: traduce...`.',
        'Escribe tu mensaje directamente. Para salir, usa el botón de abajo.',
      ].join('\n\n');

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🚪 Salir del modo Lex', 'cristina_admin_lex_exit')],
        [Markup.button.callback('◀️ Volver a Cristina', 'cristina_admin_menu')],
      ]);

      await replyOrEditMessage(ctx, message, keyboard, true);
    } catch (error) {
      logger.error('Error en modo Cristina soy Lex:', error);
    }
  });

  bot.action('cristina_admin_lex_exit', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      delete ctx.session.temp?.cristinaLexMode;
      await ctx.saveSession();

      await showCristinaAdminMenu(ctx, true);
    } catch (error) {
      logger.error('Error saliendo del modo Lex:', error);
    }
  });

  bot.action('admin_queue_status', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const lang = getLanguage(ctx);
      const isSuperAdmin = await PermissionService.isSuperAdmin(ctx.from.id);
      const queueIntegration = getBroadcastQueueIntegration();
      const status = await queueIntegration.getStatus();

      if (status?.error) {
        await ctx.editMessageText(
          '❌ Error al cargar el estado de la cola:\n\n' + sanitizeInput(status.error),
          Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Actualizar', 'admin_queue_status')],
            [Markup.button.callback('◀️ Volver', 'admin_cancel')],
          ])
        );
        return;
      }

      const running = status.running ? '✅ Activa' : '⏸️ Pausada';
      const activeJobs = status.activeJobs ?? 0;
      const totalFailed = status.statistics?.totalFailed ?? '-';
      const totalCompleted = status.statistics?.totalCompleted ?? '-';
      const totalPending = status.statistics?.totalPending ?? '-';

      const msg =
        '`📦 Estado de Cola`' +
        '\n━━━━━━━━━━━━━━━━━━━━\n\n' +
        `• Estado: ${running}\n` +
        `• Trabajos activos: ${activeJobs}\n` +
        `• Pendientes: ${totalPending}\n` +
        `• Completados: ${totalCompleted}\n` +
        `• Fallidos: ${totalFailed}\n`;

      const controlsRow = [];
      if (isSuperAdmin) {
        if (status.running) {
          controlsRow.push(Markup.button.callback('⏸️ Pausar', 'admin_queue_pause_confirm'));
        } else {
          controlsRow.push(
            Markup.button.callback('▶️ Reanudar x1', 'admin_queue_resume_1'),
            Markup.button.callback('▶️ Reanudar x2', 'admin_queue_resume_2'),
          );
        }
      }

      const controlsRow2 = [];
      if (isSuperAdmin && !status.running) {
        controlsRow2.push(
          Markup.button.callback('▶️ Reanudar x3', 'admin_queue_resume_3'),
          Markup.button.callback('▶️ Reanudar x5', 'admin_queue_resume_5'),
        );
      }

      await ctx.editMessageText(
        msg,
        Object.assign(
          { parse_mode: 'Markdown' },
          Markup.inlineKeyboard([
            [
              Markup.button.callback('🧯 Ver fallidos', 'admin_queue_failed'),
              Markup.button.callback('🔄 Actualizar', 'admin_queue_status'),
            ],
            ...(controlsRow.length ? [controlsRow] : []),
            ...(controlsRow2.length ? [controlsRow2] : []),
            [Markup.button.callback('◀️ Volver', 'admin_cancel')],
          ])
        )
      );
    } catch (error) {
      logger.error('Error in admin_queue_status:', error);
    }
  });

  bot.action('admin_queue_pause_confirm', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isSuperAdmin = await PermissionService.isSuperAdmin(ctx.from.id);
      if (!isSuperAdmin) return;

      await ctx.editMessageText(
        '⏸️ ¿Pausar la cola de broadcasts?\n\nEsto detiene el procesador y el scheduler de retries/cleanup.',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Sí, pausar', 'admin_queue_pause'),
            Markup.button.callback('❌ Cancelar', 'admin_queue_status'),
          ],
        ])
      );
    } catch (error) {
      logger.error('Error in admin_queue_pause_confirm:', error);
    }
  });

  bot.action('admin_queue_pause', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isSuperAdmin = await PermissionService.isSuperAdmin(ctx.from.id);
      if (!isSuperAdmin) return;

      const queueIntegration = getBroadcastQueueIntegration();
      await queueIntegration.stop();
      await showAdminPanel(ctx, true);
    } catch (error) {
      logger.error('Error in admin_queue_pause:', error);
    }
  });

  bot.action(/^admin_queue_resume_(\\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isSuperAdmin = await PermissionService.isSuperAdmin(ctx.from.id);
      if (!isSuperAdmin) return;

      const requested = Number(ctx.match[1]);
      const concurrency = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 10) : 2;
      const queueIntegration = getBroadcastQueueIntegration();
      await queueIntegration.start(concurrency);
      await showAdminPanel(ctx, true);
    } catch (error) {
      logger.error('Error in admin_queue_resume:', error);
    }
  });

  bot.action('admin_queue_failed', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const lang = getLanguage(ctx);
      const queueIntegration = getBroadcastQueueIntegration();
      const failed = await queueIntegration.getFailedBroadcasts(10);

      if (!failed?.length) {
        await ctx.editMessageText(
          '✅ No hay broadcasts fallidos.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Actualizar', 'admin_queue_failed')],
            [Markup.button.callback('◀️ Volver', 'admin_queue_status')],
          ])
        );
        return;
      }

      const lines = failed.map((job, idx) => {
        const id = job.job_id || job.id || '-';
        const attempts = job.attempts ?? '-';
        const lastError = sanitizeInput(job.last_error || job.error || '').slice(0, 80);
        return `${idx + 1}) \`${sanitizeInput(id)}\` (attempts: ${attempts})${lastError ? `\n   ${lastError}` : ''}`;
      });

      const keyboard = failed
        .map((job) => {
          const id = job.job_id || job.id;
          if (!id) return null;
          return [Markup.button.callback('Reintentar ' + String(id).slice(0, 8), `admin_queue_retry_${id}`)];
        })
        .filter(Boolean);

      keyboard.push([
        Markup.button.callback('🔄 Actualizar', 'admin_queue_failed'),
        Markup.button.callback('◀️ Volver', 'admin_queue_status'),
      ]);

      await ctx.editMessageText(
        '`🧯 Broadcasts fallidos`' +
          '\n━━━━━━━━━━━━━━━━━━━━\n\n' +
          lines.join('\n\n'),
        Object.assign({ parse_mode: 'Markdown' }, Markup.inlineKeyboard(keyboard))
      );
    } catch (error) {
      logger.error('Error in admin_queue_failed:', error);
    }
  });

  bot.action(/^admin_queue_retry_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const jobId = ctx.match[1];
      const queueIntegration = getBroadcastQueueIntegration();
      await queueIntegration.retryFailedBroadcast(jobId);

      await ctx.reply(`✅ Reintento programado: ${jobId}`);
    } catch (error) {
      logger.error('Error in admin_queue_retry:', error);
    }
  });

  // NOTE: /admin command is now registered early in bot.js to ensure proper handler execution
  // The showAdminPanel function is called directly from there

  // Quick view mode command: /viewas free | /viewas prime | /viewas normal
  bot.command('viewas', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.reply(t('unauthorized', getLanguage(ctx)));
        return;
      }

      const args = ctx.message.text.split(' ');
      const mode = args[1]?.toLowerCase();

      if (!mode || !['free', 'prime', 'normal'].includes(mode)) {
        const helpMsg = '👁️ **Comando de Vista Previa**\n\n' +
            'Uso: `/viewas <modo>`\n\n' +
            'Modos disponibles:\n' +
            '• `free` - Ver como usuario FREE\n' +
            '• `prime` - Ver como usuario PRIME\n' +
            '• `normal` - Vista normal (admin)\n\n' +
            'Ejemplo: `/viewas free`';
        await ctx.reply(helpMsg, { parse_mode: 'Markdown' });
        return;
      }

      if (mode === 'normal') {
        delete ctx.session.adminViewMode;
      } else {
        ctx.session.adminViewMode = mode;
      }
      await ctx.saveSession();

      const modeText = mode === 'free'
        ? '🆓 FREE'
        : mode === 'prime'
        ? '💎 PRIME'
        : '🔙 Normal';

      await ctx.reply(
        `👁️ Vista activada: ${modeText}\n\nUsa /menu para ver el menú.`,
        { parse_mode: 'Markdown' }
      );

      logger.info('Admin view mode changed via command', { userId: ctx.from.id, mode });
    } catch (error) {
      logger.error('Error in /viewas command:', error);
    }
  });

  // Quick stats command
  bot.command('stats', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.reply(t('unauthorized', getLanguage(ctx)));
        return;
      }

      const lang = getLanguage(ctx);

      // Get comprehensive statistics
      const userStats = await UserService.getStatistics();

      // Revenue stats for different periods
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [todayRevenue, monthRevenue, last30Revenue] = await Promise.all([
        PaymentModel.getRevenue(today, now),
        PaymentModel.getRevenue(thisMonth, now),
        PaymentModel.getRevenue(last30Days, now),
      ]);

      // Build comprehensive stats message
      const statsMessage = '📊 *Estadísticas en Tiempo Real*\n\n'
        + '*Métricas de Usuarios:*\n'
        + `👥 Total Usuarios: ${userStats.total}\n`
        + `💎 Usuarios Premium: ${userStats.active}\n`
        + `🆓 Usuarios Free: ${userStats.free}\n`
        + `📈 Tasa de Conversión: ${userStats.conversionRate.toFixed(2)}%\n\n`
        + '*Ingresos - Hoy:*\n'
        + `💰 Total: $${todayRevenue.total.toFixed(2)}\n`
        + `📦 Pagos: ${todayRevenue.count}\n`
        + `📊 Promedio: $${todayRevenue.average.toFixed(2)}\n\n`
        + '*Ingresos - Este Mes:*\n'
        + `💰 Total: $${monthRevenue.total.toFixed(2)}\n`
        + `📦 Pagos: ${monthRevenue.count}\n`
        + `📊 Promedio: $${monthRevenue.average.toFixed(2)}\n\n`
        + '*Ingresos - Últimos 30 Días:*\n'
        + `💰 Total: $${last30Revenue.total.toFixed(2)}\n`
        + `📦 Pagos: ${last30Revenue.count}\n`
        + `📊 Promedio: $${last30Revenue.average.toFixed(2)}\n\n`
        + '*Desglose por Plan (Últimos 30 Días):*\n'
        + `${Object.entries(last30Revenue.byPlan)
          .map(([plan, count]) => `  ${plan}: ${count}`)
          .join('\n') || '  Sin datos'}\n\n`
        + '*Desglose por Proveedor:*\n'
        + `${Object.entries(last30Revenue.byProvider)
          .map(([provider, count]) => `  ${provider}: ${count}`)
          .join('\n') || '  Sin datos'}\n\n`
        + `_Actualizado: ${now.toLocaleString()}_`;

      await ctx.reply(statsMessage, { parse_mode: 'Markdown' });

      logger.info('Stats command executed', { adminId: ctx.from.id });
    } catch (error) {
      logger.error('Error in /stats command:', error);
      await ctx.reply('Error al obtener estadísticas. Por favor intenta de nuevo.');
    }
  });

  // User management
  bot.action('admin_users', async (ctx) => {
    try {
      await ctx.answerCbQuery(); // Answer immediately

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      // Redirect to user management search
      await ctx.editMessageText(
        '👥 **Gestión de Usuarios**\n\nSelecciona una opción:',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔍 Buscar Usuario', 'admin_users_search')],
          [Markup.button.callback('↩️ Volver', 'admin_cancel')],
        ]),
      );
    } catch (error) {
      logger.error('Error in admin users:', error);
    }
  });

  // View Mode - Show options to preview as Free or Prime
  bot.action('admin_view_mode', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const currentMode = ctx.session?.adminViewMode;

      let statusText = '';
      if (currentMode === 'free') {
        statusText = '\n\n_Actualmente: Vista FREE_';
      } else if (currentMode === 'prime') {
        statusText = '\n\n_Actualmente: Vista PRIME_';
      } else {
        statusText = '\n\n_Actualmente: Vista Normal (Admin)_';
      }

      const message = '👁️ **Vista Previa de Menú**\n\nSelecciona cómo quieres ver el menú para probar la experiencia del usuario:' + statusText;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🆓 Ver como FREE', 'admin_view_as_free'),
            Markup.button.callback('💎 Ver como PRIME', 'admin_view_as_prime'),
          ],
          [
            Markup.button.callback('🔙 Vista Normal', 'admin_view_as_normal'),
          ],
          [
            Markup.button.callback('↩️ Volver', 'admin_cancel'),
          ],
        ]),
      });
    } catch (error) {
      logger.error('Error in admin view mode:', error);
    }
  });

  // Set view mode to FREE
  bot.action('admin_view_as_free', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.adminViewMode = 'free';
      await ctx.saveSession();

      await ctx.answerCbQuery('👁️ Vista FREE activada');

      // Show menu with new view mode
      const { showMainMenu } = require('../user/menu');
      await ctx.deleteMessage().catch(() => {});
      await showMainMenu(ctx);
    } catch (error) {
      logger.error('Error setting free view mode:', error);
    }
  });

  // Set view mode to PRIME
  bot.action('admin_view_as_prime', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.adminViewMode = 'prime';
      await ctx.saveSession();

      await ctx.answerCbQuery('👁️ Vista PRIME activada');

      // Show menu with new view mode
      const { showMainMenu } = require('../user/menu');
      await ctx.deleteMessage().catch(() => {});
      await showMainMenu(ctx);
    } catch (error) {
      logger.error('Error setting prime view mode:', error);
    }
  });

  // Set view mode back to Normal (admin)
  bot.action('admin_view_as_normal', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      delete ctx.session.adminViewMode;
      await ctx.saveSession();

      await ctx.answerCbQuery('🔙 Vista Normal activada');

      // Show menu with normal view
      const { showMainMenu } = require('../user/menu');
      await ctx.deleteMessage().catch(() => {});
      await showMainMenu(ctx);
    } catch (error) {
      logger.error('Error setting normal view mode:', error);
    }
  });

  // Exit preview mode (from menu button)
  bot.action('admin_exit_preview', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      delete ctx.session.adminViewMode;
      await ctx.saveSession();

      await ctx.answerCbQuery('🔙 Vista Normal');

      // Show menu with normal view
      const { showMainMenu } = require('../user/menu');
      await ctx.deleteMessage().catch(() => {});
      await showMainMenu(ctx);
    } catch (error) {
      logger.error('Error exiting preview mode:', error);
    }
  });

  // Broadcast
  bot.action('admin_broadcast', async (ctx) => {
    try {
      await ctx.answerCbQuery(); // Answer immediately to prevent timeout

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        logger.warn('Non-admin tried to access broadcast:', { userId: ctx.from.id });
        return;
      }

      // Broadcast flow must run in private chat, otherwise session state splits across chats/topics
      if (ctx.chat?.type !== 'private') {
        const botUsername = process.env.BOT_USERNAME || 'pnplatinotv_bot';
        await ctx.editMessageText(
          '⚠️ Para enviar un broadcast, abre el bot en privado.\n\nEsto evita que el proceso se quede atascado entre topics/chats.',
          Markup.inlineKeyboard([
            [Markup.button.url('🔗 Abrir bot', `https://t.me/${botUsername}`)],
            [Markup.button.callback('◀️ Volver', 'admin_cancel')],
          ]),
        );
        return;
      }

      // If there's an in-progress broadcast, offer resume/restart instead of resetting silently
      const existingStep = ctx.session?.temp?.broadcastStep;
      if (existingStep && existingStep !== 'sending') {
        await showBroadcastResumePrompt(ctx);
        return;
      }

      // Clear any ongoing admin tasks
      ctx.session.temp = {};
      await ctx.saveSession();

      await ctx.editMessageText(
        '📢 *Asistente de Difusión*\n\n🎯 *Paso 1/5: Seleccionar Audiencia*\n\nElige a quién enviar este broadcast:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('👥 Todos los Usuarios', 'broadcast_all')],
            [Markup.button.callback('💎 Solo Premium', 'broadcast_premium')],
            [Markup.button.callback('🆓 Solo Gratis', 'broadcast_free')],
            [Markup.button.callback('↩️ Churned (Ex-Premium)', 'broadcast_churned')],
            [Markup.button.callback('💸 Pagos No Completados', 'broadcast_payment_incomplete')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in admin broadcast:', error);
      try {
        await ctx.answerCbQuery('Error al iniciar broadcast');
        await ctx.reply('❌ Error al cargar el menú de broadcast. Por favor intenta de nuevo.').catch(() => {});
      } catch (e) {
        logger.error('Failed to send error message:', e);
      }
    }
  });

  // One-click recovery promo + broadcast draft
  bot.action('admin_recovery_30', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const lang = getLanguage(ctx);

      // Create 30% any-plan promo
      let promo = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (!promo && attempts < maxAttempts) {
        attempts += 1;
        const code = generateRecoveryPromoCode();
        try {
          promo = await PromoService.createPromo({
            code,
            name: 'Recovery 30% OFF',
            nameEs: 'Recuperación 30% OFF',
            description: '30% off any plan for incomplete payments',
            descriptionEs: '30% de descuento en cualquier plan para pagos no completados',
            basePlanId: 'any',
            discountType: 'percentage',
            discountValue: 30,
            targetAudience: 'all',
            maxSpots: null,
            validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            createdBy: String(ctx.from.id),
          });
        } catch (error) {
          if (attempts >= maxAttempts) throw error;
        }
      }

      if (!promo) {
        await ctx.reply('❌ Error creando promo. Intenta de nuevo.');
        return;
      }

      const deepLink = PromoModel.generateDeepLink(promo.code);

      // Prepare broadcast draft
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.broadcastTarget = 'payment_incomplete';
      ctx.session.temp.broadcastFilters = { paymentIncompleteDays: null };
      ctx.session.temp.broadcastData = {
        textEn: 'Ey, listen up, boy… Meth Daddy’s calling you back!\n\nMissed your shot? I’m giving you a 30% discount on ANY plan to get you in my dark ritual. Come feel the clouds hit hard and let me split you deep on my altar while we party ☁️🔥. Claim it now at pnptv before I change my mind, parce.\n\n#PNPLatinoTV #MethDaddy #ChimbaDura #OfrendaOscura',
        textEs: 'Ey parce… Meth Daddy te llama al culto.\n\nVolvimos más duros que nunca y pa’ que regreses, te doy un 30% de descuento en cualquier plan en pnptv. Únete ya, siente el rush conmigo y déjame partirte mientras las nubes nos elevan ☁️🔥. ¿Listo pa’ esta ofrenda oscura?\n\n#PNPLatinoTV #CultoSantino #MethDaddy #ChimbaDura #OfrendaOscura',
        emailSubjectEn: 'Meth Daddy is calling you back — 30% OFF any plan',
        emailSubjectEs: 'Meth Daddy te llama de vuelta — 30% OFF en cualquier plan',
        emailPreheaderEn: '30% off any plan on PNPtv. Claim it before I change my mind.',
        emailPreheaderEs: '30% de descuento en cualquier plan en PNPtv. Reclámalo antes de que cambie de idea.',
        buttons: [
          { key: 'promo', text: '🔥 Reclamar 30% OFF', type: 'url', target: deepLink },
        ],
        sendEmail: true,
        includeFilters: { paymentIncompleteDays: null },
      };
      ctx.session.temp.broadcastStep = 'preview';
      ctx.session.temp.maxCompletedStep = 'preview';
      await ctx.saveSession();

      await ctx.reply(
        lang === 'es'
          ? `✅ Promo creada: *${promo.code}*\n\nLink:\n\`${deepLink}\`\n\nSe preparó un broadcast para pagos no completados con email activado.`
          : `✅ Promo created: *${promo.code}*\n\nLink:\n\`${deepLink}\`\n\nPrepared a broadcast for incomplete payments with email enabled.`,
        { parse_mode: 'Markdown' }
      );

      await sendBroadcastPreview(ctx);
    } catch (error) {
      logger.error('Error in admin_recovery_30:', error);
      await ctx.reply('❌ Error al crear la promo de recovery.').catch(() => {});
    }
  });

  bot.action('broadcast_all', async (ctx) => {
    try {
      logger.info('🎯 HANDLER TRIGGERED: broadcast_all', {
        userId: ctx.from.id,
        chatType: ctx.chat?.type,
        callbackData: ctx.callbackQuery?.data
      });
      
      // Answer callback immediately
      await ctx.answerCbQuery('✅ Processing...');
      logger.info('✅ Callback query answered');
      
      // Check admin permissions
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      logger.info('🔐 Permission check result:', { userId: ctx.from.id, isAdmin });
      
      if (!isAdmin) {
        logger.warn('Non-admin tried to select broadcast audience (all):', { userId: ctx.from.id });
        await ctx.answerCbQuery('❌ Not authorized');
        return;
      }
      
      logger.info('👥 Broadcast audience selected: all', { userId: ctx.from.id });
      
      // Initialize session data with debugging
      logger.info('📊 Session before initialization:', ctx.session);
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.broadcastTarget = 'all';
      ctx.session.temp.broadcastData = {};
      logger.info('📊 Session after initialization:', ctx.session);
      
      // Update broadcast step
      logger.info('🔄 Updating broadcast step to media...');
      await updateBroadcastStep(ctx, 'media');
      logger.info('✅ Broadcast step updated');
      
      // Save session
      logger.info('💾 Saving session...');
      await ctx.saveSession();
      logger.info('✅ Session saved successfully');
      
      // Log final session state
      logger.info('📋 Final session state:', {
        userId: ctx.from.id,
        broadcastTarget: ctx.session.temp.broadcastTarget,
        broadcastStep: ctx.session.temp.broadcastStep,
        broadcastData: ctx.session.temp.broadcastData
      });
      
      // Render next step
      logger.info('🎨 Rendering broadcast step...');
      await renderBroadcastStep(ctx);
      logger.info('✅ Broadcast step rendered');
      
    } catch (error) {
      logger.error('❌ CRITICAL ERROR in broadcast_all handler:', {
        error: error.message,
        stack: error.stack,
        userId: ctx.from.id
      });
      try {
        await ctx.reply('❌ Error selecting audience. Please check logs and try again.').catch(() => {});
      } catch (replyError) {
        logger.error('❌ Failed to send error message:', replyError.message);
      }
    }
  });

  bot.action('broadcast_premium', async (ctx) => {
    try {
      logger.info('🎯 HANDLER TRIGGERED: broadcast_premium', {
        userId: ctx.from.id,
        chatType: ctx.chat?.type,
        callbackData: ctx.callbackQuery?.data
      });
      
      await ctx.answerCbQuery('✅ Processing...');
      logger.info('✅ Callback query answered');
      
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      logger.info('🔐 Permission check result:', { userId: ctx.from.id, isAdmin });
      
      if (!isAdmin) {
        logger.warn('Non-admin tried to select broadcast audience (premium):', { userId: ctx.from.id });
        await ctx.answerCbQuery('❌ Not authorized');
        return;
      }
      
      logger.info('💎 Broadcast audience selected: premium', { userId: ctx.from.id });
      
      logger.info('📊 Session before initialization:', ctx.session);
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.broadcastTarget = 'premium';
      ctx.session.temp.broadcastData = {};
      logger.info('📊 Session after initialization:', ctx.session);
      
      logger.info('🔄 Updating broadcast step to media...');
      await updateBroadcastStep(ctx, 'media');
      logger.info('✅ Broadcast step updated');
      
      logger.info('💾 Saving session...');
      await ctx.saveSession();
      logger.info('✅ Session saved successfully');
      
      logger.info('📋 Final session state:', {
        userId: ctx.from.id,
        broadcastTarget: ctx.session.temp.broadcastTarget,
        broadcastStep: ctx.session.temp.broadcastStep
      });
      
      logger.info('🎨 Rendering broadcast step...');
      await renderBroadcastStep(ctx);
      logger.info('✅ Broadcast step rendered');
      
    } catch (error) {
      logger.error('❌ CRITICAL ERROR in broadcast_premium handler:', {
        error: error.message,
        stack: error.stack,
        userId: ctx.from.id
      });
      try {
        await ctx.reply('❌ Error selecting audience. Please check logs and try again.').catch(() => {});
      } catch (replyError) {
        logger.error('❌ Failed to send error message:', replyError.message);
      }
    }
  });

  bot.action('broadcast_free', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastTarget = 'free';
      ctx.session.temp.broadcastData = {};
      await updateBroadcastStep(ctx, 'media');
      await ctx.saveSession();
      await renderBroadcastStep(ctx);
    } catch (error) {
      logger.error('Error selecting broadcast audience (free):', error);
    }
  });

  bot.action('broadcast_churned', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastTarget = 'churned';
      ctx.session.temp.broadcastData = {};
      await updateBroadcastStep(ctx, 'media');
      await ctx.saveSession();
      await renderBroadcastStep(ctx);
    } catch (error) {
      logger.error('Error selecting broadcast audience (churned):', error);
    }
  });

  bot.action('broadcast_payment_incomplete', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastTarget = 'payment_incomplete';
      ctx.session.temp.broadcastData = {};
      ctx.session.temp.broadcastFilters = {};
      ctx.session.temp.broadcastStep = 'payment_incomplete_window';
      await ctx.saveSession();

      await ctx.editMessageText(
        '⏱️ *Pagos No Completados*\n\nSelecciona la ventana de tiempo para segmentar:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Últimos 7 días', 'broadcast_payment_window_7')],
            [Markup.button.callback('Últimos 30 días', 'broadcast_payment_window_30')],
            [Markup.button.callback('Último mes', 'broadcast_payment_window_30')],
            [Markup.button.callback('Todos', 'broadcast_payment_window_all')],
            [Markup.button.callback('✏️ Custom', 'broadcast_payment_window_custom')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting broadcast audience (payment_incomplete):', error);
    }
  });

  bot.action(/^broadcast_payment_window_(\d+|all|custom)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const choice = ctx.match?.[1];
      ctx.session.temp.broadcastFilters = ctx.session.temp.broadcastFilters || {};

      if (choice === 'custom') {
        ctx.session.temp.broadcastStep = 'payment_incomplete_window_custom';
        await ctx.saveSession();
        await ctx.editMessageText(
          '✏️ Ingresa el número de días (ej: 30):',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          }
        );
        return;
      }

      const days = choice === 'all' ? null : parseInt(choice, 10);
      ctx.session.temp.broadcastFilters.paymentIncompleteDays = Number.isFinite(days) ? days : null;
      if (ctx.session.temp.broadcastData) {
        ctx.session.temp.broadcastData.includeFilters = { paymentIncompleteDays: ctx.session.temp.broadcastFilters.paymentIncompleteDays };
      }
      await updateBroadcastStep(ctx, 'media');
      await ctx.saveSession();
      await renderBroadcastStep(ctx);
    } catch (error) {
      logger.error('Error selecting payment window:', error);
    }
  });

  bot.action('broadcast_resume', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await renderBroadcastStep(ctx);
    } catch (error) {
      logger.error('Error in broadcast_resume:', error);
    }
  });

  bot.action('broadcast_restart', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp = {};
      await ctx.saveSession();
      await ctx.editMessageText(
        t('broadcastTarget', getLanguage(ctx)),
        Markup.inlineKeyboard([
          [Markup.button.callback('👥 Todos los Usuarios', 'broadcast_all')],
          [Markup.button.callback('💎 Solo Premium', 'broadcast_premium')],
          [Markup.button.callback('🆓 Solo Gratis', 'broadcast_free')],
          [Markup.button.callback('↩️ Churned (Ex-Premium)', 'broadcast_churned')],
          [Markup.button.callback('💸 Pagos No Completados', 'broadcast_payment_incomplete')],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      );
    } catch (error) {
      logger.error('Error in broadcast_restart:', error);
    }
  });

  // Broadcast target selection
  // 🧪 TEST HANDLER: Simple callback test to verify callback queries work
  bot.action('test_callback', async (ctx) => {
    try {
      logger.info('🧪 TEST CALLBACK TRIGGERED', {
        userId: ctx.from.id,
        callbackData: ctx.callbackQuery?.data
      });
      
      await ctx.answerCbQuery('✅ Test callback received!');
      await ctx.reply('🎉 Test callback works! Callback queries are functioning properly.').catch(() => {});
      
      logger.info('✅ Test callback completed successfully');
    } catch (error) {
      logger.error('❌ Test callback failed:', {
        error: error.message,
        userId: ctx.from.id
      });
      try {
        await ctx.answerCbQuery('❌ Test failed');
        await ctx.reply('❌ Test callback failed. Check logs for details.').catch(() => {});
      } catch (replyError) {
        logger.error('❌ Failed to send test error message:', replyError.message);
      }
    }
  });

  // DISABLED: Regex handler conflicts with specific audience selection handlers
  // bot.action(/^broadcast_(.+)$/, async (ctx) => {
  //   try {
  //     logger.info('🎯 Regex handler: broadcast_* triggered', { 
  //       userId: ctx.from.id, 
  //       action: ctx.callbackQuery?.data 
  //     });
  //     const isAdmin = await PermissionService.isAdmin(ctx.from.id);
  //     if (!isAdmin) {
  //       await ctx.answerCbQuery('❌ No autorizado');
  //       return;
  //     }

  //     // Validate match result exists
  //     if (!ctx.match || !ctx.match[1]) {
  //       logger.error('Invalid broadcast target action format');
  //       await ctx.answerCbQuery('❌ Error en formato de acción');
  //       return;
  //     }

  //     const target = ctx.match[1];
  //     const lang = getLanguage(ctx);

  //     // Initialize session temp if needed
  //     if (!ctx.session.temp) {
  //       ctx.session.temp = {};
  //     }

  //     ctx.session.temp.broadcastTarget = target;
  //     await updateBroadcastStep(ctx, 'media');
  //     ctx.session.temp.broadcastData = {};
  //     await ctx.saveSession();

  //     logger.info('Broadcast target selected via regex handler', { target, userId: ctx.from.id });

  //     await ctx.answerCbQuery(`✓ Audiencia: ${target}`);

  //     await ctx.editMessageText(
  //       '📎 *Paso 1/5: Subir Media*\n\n'
  //       + 'Por favor envía una imagen, video o archivo para adjuntar al broadcast.\n\n'
  //       + '💡 También puedes saltar este paso si solo quieres enviar texto.',
  //       {
  //         parse_mode: 'Markdown',
  //         ...Markup.inlineKeyboard([
  //           [Markup.button.callback('⏭️ Saltar (Solo Texto)', 'broadcast_skip_media')],
  //           [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
  //         ]),
  //       },
  //     );
  //   } catch (error) {
  //     logger.error('Error in broadcast target:', error);
  //     await ctx.answerCbQuery('❌ Error al seleccionar audiencia').catch(() => {});
  //   }
  // });

  // Skip media upload
  bot.action('broadcast_skip_media', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      // Validate session state
      if (!ctx.session.temp || !ctx.session.temp.broadcastTarget) {
        await ctx.answerCbQuery('❌ Sesión expirada. Por favor inicia de nuevo.');
        logger.warn('Broadcast session expired or missing', { userId: ctx.from.id });
        return;
      }

      ctx.session.temp.broadcastStep = 'text_en';
      await ctx.saveSession();

      await ctx.answerCbQuery('⏭️ Saltando media');

      await ctx.editMessageText(
        '🇺🇸 *Paso 3/5: Texto en Inglés (Opcional)*\n\n'
        + 'Escribe el mensaje en inglés que quieres enviar.\n\n'
        + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en inglés.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_en')],
            [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_en')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );

      logger.info('Broadcast media skipped', { userId: ctx.from.id });
    } catch (error) {
      logger.error('Error skipping media:', error);
      await ctx.answerCbQuery('❌ Error al saltar media').catch(() => {});
    }
  });

  // Skip English text
  bot.action('broadcast_skip_text_en', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      // Validate session state
      if (!ctx.session.temp || !ctx.session.temp.broadcastTarget) {
        await ctx.answerCbQuery('❌ Sesión expirada. Por favor inicia de nuevo.');
        logger.warn('Broadcast session expired or missing', { userId: ctx.from.id });
        return;
      }

      // Set empty English text
      if (!ctx.session.temp.broadcastData) {
        ctx.session.temp.broadcastData = {};
      }
      ctx.session.temp.broadcastData.textEn = '';

      ctx.session.temp.broadcastStep = 'text_es';
      ctx.session.temp.maxCompletedStep = 'text_es';
      await ctx.saveSession();

      await ctx.answerCbQuery('⏭️ Texto en inglés omitido');

      await ctx.editMessageText(
        '🇪🇸 *Paso 4/5: Texto en Español (Opcional)*\n\n'
        + 'Escribe el mensaje en español que quieres enviar.\n\n'
        + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en español.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_es')],
            [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_es')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );

      logger.info('Broadcast English text skipped', { userId: ctx.from.id });
    } catch (error) {
      logger.error('Error skipping English text:', error);
      await ctx.answerCbQuery('❌ Error al saltar texto').catch(() => {});
    }
  });

  // Skip Spanish text
  bot.action('broadcast_skip_text_es', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      // Validate session state
      if (!ctx.session.temp || !ctx.session.temp.broadcastTarget) {
        await ctx.answerCbQuery('❌ Sesión expirada. Por favor inicia de nuevo.');
        logger.warn('Broadcast session expired or missing', { userId: ctx.from.id });
        return;
      }

      // Set empty Spanish text
      if (!ctx.session.temp.broadcastData) {
        ctx.session.temp.broadcastData = {};
      }
      ctx.session.temp.broadcastData.textEs = '';

      ctx.session.temp.broadcastStep = 'buttons';
      ctx.session.temp.maxCompletedStep = 'buttons';

      // Initialize buttons array with default buttons
      const lang = getLanguage(ctx);
      if (!ctx.session.temp.broadcastData.buttons || !Array.isArray(ctx.session.temp.broadcastData.buttons)) {
        ctx.session.temp.broadcastData.buttons = buildDefaultBroadcastButtons(lang);
      }

      await ctx.saveSession();

      await ctx.answerCbQuery('⏭️ Texto en español omitido');
      await showBroadcastButtonsPicker(ctx);

      logger.info('Broadcast Spanish text skipped', { userId: ctx.from.id });
    } catch (error) {
      logger.error('Error skipping Spanish text:', error);
      await ctx.answerCbQuery('❌ Error al saltar texto').catch(() => {});
    }
  });

  // NOTE: Old preset-based broadcast buttons removed in favor of a flexible toggle picker.

  // Broadcast - No buttons option
  bot.action('broadcast_no_buttons', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      // Save no buttons selection
      if (!ctx.session.temp.broadcastData) {
        ctx.session.temp.broadcastData = {};
      }
      ctx.session.temp.broadcastData.buttons = [];
      ctx.session.temp.broadcastStep = 'preview';
      await ctx.saveSession();

      await ctx.answerCbQuery('⏭️ Sin botones');
      await sendBroadcastPreview(ctx);
    } catch (error) {
      logger.error('Error selecting no buttons:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Broadcast - Toggle one of the optional buttons (add/remove)
  // Note: exclude 'email' which has its own handler (broadcast_toggle_email)
  bot.action(/^broadcast_toggle_(?!email$)(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      if (!ctx.session.temp?.broadcastData) return;

      const key = ctx.match?.[1];
      if (!key) return;

      const lang = getLanguage(ctx);
      const options = getBroadcastButtonOptions(lang);
      const opt = options.find((o) => o.key === key);
      if (!opt) {
        await ctx.answerCbQuery('Unknown');
        return;
      }

      const buttons = normalizeButtons(ctx.session.temp.broadcastData.buttons);
      const idx = buttons.findIndex((b) => (typeof b === 'string' ? JSON.parse(b).key : b.key) === key);
      if (idx >= 0) {
        buttons.splice(idx, 1);
        await ctx.answerCbQuery('Removed');
      } else {
        buttons.push(opt);
        await ctx.answerCbQuery('Added');
      }
      ctx.session.temp.broadcastData.buttons = buttons;
      ctx.session.temp.broadcastStep = 'buttons'; // Ensure we stay in buttons step
      await ctx.saveSession();
      await showBroadcastButtonsPicker(ctx);
    } catch (error) {
      logger.error('Error toggling broadcast button:', error);
      // Reset to buttons step on error to prevent getting stuck
      if (ctx.session.temp) {
        ctx.session.temp.broadcastStep = 'buttons';
        await ctx.saveSession();
      }
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action('broadcast_continue_with_buttons', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      if (!ctx.session.temp?.broadcastTarget || !ctx.session.temp?.broadcastData) {
        await ctx.answerCbQuery('❌ Sesión expirada');
        return;
      }
      await ctx.answerCbQuery();
      ctx.session.temp.broadcastStep = 'preview';
      await ctx.saveSession();
      await sendBroadcastPreview(ctx);
    } catch (error) {
      logger.error('Error in broadcast_continue_with_buttons:', error);
    }
  });

  bot.action('broadcast_resume_buttons', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastStep = 'buttons';
      await ctx.saveSession();
      await showBroadcastButtonsPicker(ctx);
    } catch (error) {
      logger.error('Error in broadcast_resume_buttons:', error);
    }
  });

  bot.action('broadcast_ai_en', async (ctx) => {
    try {
      logger.info('[GROK-BUTTON] broadcast_ai_en clicked', { userId: ctx.from.id });
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        logger.warn('[GROK-BUTTON] User not admin, ignoring broadcast_ai_en');
        return;
      }
      if (!ctx.session.temp?.broadcastData) ctx.session.temp.broadcastData = {};
      ctx.session.temp.broadcastStep = 'ai_prompt_en';
      await ctx.saveSession();
      logger.info('[GROK-BUTTON] Set broadcastStep to ai_prompt_en', { userId: ctx.from.id });
      await ctx.reply(
        '🤖 *AI Write (EN)*\n\nDescribe what you want to announce.\nExample:\n`Promote Lifetime Pass with urgency + link pnptv.app/lifetime100`',
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('[GROK-BUTTON] Error in broadcast_ai_en:', { error: error.message, stack: error.stack });
    }
  });

  bot.action('broadcast_ai_es', async (ctx) => {
    try {
      logger.info('[GROK-BUTTON] broadcast_ai_es clicked', { userId: ctx.from.id });
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        logger.warn('[GROK-BUTTON] User not admin, ignoring broadcast_ai_es');
        return;
      }
      if (!ctx.session.temp?.broadcastData) ctx.session.temp.broadcastData = {};
      ctx.session.temp.broadcastStep = 'ai_prompt_es';
      await ctx.saveSession();
      logger.info('[GROK-BUTTON] Set broadcastStep to ai_prompt_es', { userId: ctx.from.id });
      await ctx.reply(
        '🤖 *AI Write (ES)*\n\nDescribe lo que quieres anunciar.\nEjemplo:\n`Promociona Lifetime Pass con urgencia + link pnptv.app/lifetime100`',
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('[GROK-BUTTON] Error in broadcast_ai_es:', { error: error.message, stack: error.stack });
    }
  });

  // Use AI text as-is (English)
  bot.action('broadcast_use_ai_en', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery('✅ Texto guardado');

      const aiDraft = ctx.session.temp?.aiDraft;
      if (!aiDraft) {
        await ctx.reply('❌ No hay borrador AI. Intenta de nuevo.');
        return;
      }

      if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
      ctx.session.temp.broadcastData.textEn = aiDraft;
      ctx.session.temp.aiDraft = null;
      await updateBroadcastStep(ctx, 'text_es');
      await ctx.saveSession();

      await ctx.reply(
        '🇪🇸 *Paso 3/5: Texto en Español*\n\n'
        + 'Por favor escribe el mensaje en español que quieres enviar:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_es')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in broadcast_use_ai_en:', error);
    }
  });

  // Use AI text as-is (Spanish)
  bot.action('broadcast_use_ai_es', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery('✅ Texto guardado');

      const aiDraft = ctx.session.temp?.aiDraft;
      if (!aiDraft) {
        await ctx.reply('❌ No hay borrador AI. Intenta de nuevo.');
        return;
      }

      if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
      ctx.session.temp.broadcastData.textEs = aiDraft;
      ctx.session.temp.aiDraft = null;
      await updateBroadcastStep(ctx, 'buttons');

      // Ensure buttons array is properly initialized
      if (!ctx.session.temp.broadcastData.buttons || !Array.isArray(ctx.session.temp.broadcastData.buttons)) {
        ctx.session.temp.broadcastData.buttons = buildDefaultBroadcastButtons(getLanguage(ctx));
      }
      await ctx.saveSession();

      await showBroadcastButtonsPicker(ctx);
    } catch (error) {
      logger.error('Error in broadcast_use_ai_es:', error);
    }
  });

  // Edit AI text manually (English)
  bot.action('broadcast_edit_ai_en', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();

      await updateBroadcastStep(ctx, 'edit_ai_en');
      await ctx.saveSession();

      const aiDraft = ctx.session.temp?.aiDraft || '';
      const safeDraft = sanitize.telegramMarkdown(aiDraft);
      await ctx.reply(
        '✏️ *Editar texto (EN)*\n\n' +
        'Envía el texto editado que quieres usar:\n\n' +
        `_Texto actual:_\n\`\`\`\n${safeDraft}\n\`\`\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Volver', 'broadcast_ai_en')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in broadcast_edit_ai_en:', error);
    }
  });

  // Edit AI text manually (Spanish)
  bot.action('broadcast_edit_ai_es', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();

      await updateBroadcastStep(ctx, 'edit_ai_es');
      await ctx.saveSession();

      const aiDraft = ctx.session.temp?.aiDraft || '';
      const safeDraft = sanitize.telegramMarkdown(aiDraft);
      await ctx.reply(
        '✏️ *Editar texto (ES)*\n\n' +
        'Envía el texto editado que quieres usar:\n\n' +
        `_Texto actual:_\n\`\`\`\n${safeDraft}\n\`\`\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Volver', 'broadcast_ai_es')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in broadcast_edit_ai_es:', error);
    }
  });

  bot.action('broadcast_add_custom_link', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      if (!ctx.session.temp?.broadcastTarget || !ctx.session.temp?.broadcastData) {
        await ctx.answerCbQuery('❌ Sesión expirada');
        return;
      }
      await ctx.answerCbQuery();
      ctx.session.temp.broadcastStep = 'custom_link';
      await ctx.saveSession();
      await ctx.editMessageText(
        '🔗 *Custom Link*\n\n'
        + 'Envía el enlace en este formato:\n\n'
        + '`Texto del Botón|https://tu-link.com`\n\n'
        + 'Ejemplo:\n'
        + '`🔥 Promo|https://pnptv.app`',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏭️ Saltar', 'broadcast_continue_with_buttons')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in broadcast_add_custom_link:', error);
    }
  });

  // Broadcast - Remove custom link
  bot.action(/^broadcast_remove_custom_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      if (!ctx.session.temp?.broadcastData?.buttons) return;

      const index = parseInt(ctx.match[1]);
      const options = getBroadcastButtonOptions(getLanguage(ctx));
      const presetKeys = new Set(options.map(opt => opt.key));

      // Find and remove the custom button at the given index
      const buttons = normalizeButtons(ctx.session.temp.broadcastData.buttons);
      let customIndex = 0;
      for (let i = 0; i < buttons.length; i++) {
        const btn = typeof buttons[i] === 'string' ? JSON.parse(buttons[i]) : buttons[i];
        if (!presetKeys.has(btn.key) || btn.key === 'custom') {
          if (customIndex === index) {
            buttons.splice(i, 1);
            break;
          }
          customIndex++;
        }
      }

      ctx.session.temp.broadcastData.buttons = buttons;
      await ctx.saveSession();

      await ctx.answerCbQuery('Removed');
      await showBroadcastButtonsPicker(ctx);
    } catch (error) {
      logger.error('Error removing custom button:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Broadcast - Custom buttons option
  bot.action('broadcast_custom_buttons', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.temp.broadcastStep = 'custom_buttons';
      ctx.session.temp.customButtons = [];
      await ctx.saveSession();

      await ctx.answerCbQuery('➕ Botones Personalizados');
      await ctx.editMessageText(
        '➕ *Agregar Botones Personalizados*\n\n'
        + 'Envía cada botón en este formato:\n\n'
        + '`Texto del Botón|tipo|destino`\n\n'
        + '**Tipos disponibles:**\n'
        + '• `url` - Enlace externo (ej: https://...)\n'
        + '• `plan` - Plan específico (ej: premium, gold)\n'
        + '• `command` - Comando bot (ej: /plans, /support)\n'
        + '• `feature` - Característica (ej: features, nearby)\n\n'
        + '**Ejemplos:**\n'
        + '`💎 Ver Planes|command|/plans`\n'
        + '`⭐ Premium Now|plan|premium`\n'
        + '`🔗 Website|url|https://pnptv.app`\n\n'
        + 'Escribe cada botón en un mensaje. Cuando termines, di \"listo\".',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting custom buttons:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Broadcast - Send now with buttons
  bot.action('broadcast_send_now_with_buttons', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      // Answer callback query immediately to prevent timeout
      await safeAnswerCbQuery(ctx, '📤 Enviando broadcast...');

      ctx.session.temp.broadcastStep = 'sending';
      await ctx.saveSession();

      // Process broadcast sending with buttons (async/non-blocking)
      void sendBroadcastWithButtons(ctx, bot).catch((error) => {
        logger.error('Error in background broadcast send:', error);
        ctx.reply('❌ Error al enviar broadcast en segundo plano. Revisa los logs.').catch(() => {});
      });

      // Immediately show "processing" message to user
      try {
        await ctx.editMessageText(
          '📤 *Broadcast en Cola*\n\n'
          + 'Tu broadcast se está enviando en segundo plano.\n\n'
          + 'Recibirás una notificación cuando se complete.\n\n'
          + '⏳ Esto puede tomar unos minutos dependiendo del número de usuarios...',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
            ]),
          }
        );
      } catch (editError) {
        logger.warn('Failed to update broadcast queue message:', editError.message);
        await ctx.reply(
          '📤 *Broadcast en Cola*\n\n'
          + 'Tu broadcast se está enviando en segundo plano.\n\n'
          + 'Recibirás una notificación cuando se complete.',
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    } catch (error) {
      logger.error('Error in broadcast send now with buttons:', error);
      await ctx.reply('❌ Error al enviar broadcast').catch(() => {});
    }
  });

  // Broadcast - Toggle email sending
  bot.action('broadcast_toggle_email', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      // Ensure session structure exists
      if (!ctx.session.temp) {
        ctx.session.temp = {};
      }
      if (!ctx.session.temp.broadcastData) {
        ctx.session.temp.broadcastData = {};
      }

      // Toggle email sending flag
      ctx.session.temp.broadcastData.sendEmail = !ctx.session.temp.broadcastData.sendEmail;
      await ctx.saveSession();

      const sendEmail = ctx.session.temp.broadcastData.sendEmail;

      // Update button text based on new state
      const emailToggleText = sendEmail
        ? '✅ También enviar por Email'
        : '📧 También enviar por Email';

      // Edit the keyboard in place
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(emailToggleText, 'broadcast_toggle_email')],
        [Markup.button.callback('📤 Enviar Ahora', 'broadcast_send_now_with_buttons')],
        [Markup.button.callback('📅 Programar Envío', 'broadcast_schedule_with_buttons')],
        [Markup.button.callback('◀️ Volver a Botones', 'broadcast_resume_buttons')],
        [Markup.button.callback('❌ Cancelar Broadcast', 'admin_cancel')],
      ]);

      // Answer callback and update keyboard
      try {
        await ctx.answerCbQuery(sendEmail ? '✅ Email habilitado' : '📧 Email deshabilitado');
      } catch (cbError) {
        logger.warn('Could not answer callback for email toggle:', cbError.message);
      }

      // Edit message to update the keyboard
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: keyboard.reply_markup.inline_keyboard
        });
      } catch (editError) {
        logger.warn('Could not edit message for email toggle:', editError.message);
      }
    } catch (error) {
      logger.error('Error toggling email in broadcast:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action('broadcast_edit_email_subject_en', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastStep = 'email_subject_en';
      await ctx.saveSession();
      await ctx.reply('✉️ Subject EN:\nEnvía el asunto para email (inglés).');
    } catch (error) {
      logger.error('Error editing email subject EN:', error);
    }
  });

  bot.action('broadcast_edit_email_subject_es', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastStep = 'email_subject_es';
      await ctx.saveSession();
      await ctx.reply('✉️ Subject ES:\nEnvía el asunto para email (español).');
    } catch (error) {
      logger.error('Error editing email subject ES:', error);
    }
  });

  bot.action('broadcast_edit_email_preheader_en', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastStep = 'email_preheader_en';
      await ctx.saveSession();
      await ctx.reply('📝 Preheader EN:\nEnvía el preheader para email (inglés).');
    } catch (error) {
      logger.error('Error editing email preheader EN:', error);
    }
  });

  bot.action('broadcast_edit_email_preheader_es', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.broadcastStep = 'email_preheader_es';
      await ctx.saveSession();
      await ctx.reply('📝 Preheader ES:\nEnvía el preheader para email (español).');
    } catch (error) {
      logger.error('Error editing email preheader ES:', error);
    }
  });

  // Broadcast - Schedule with buttons
  bot.action('broadcast_schedule_with_buttons', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp || !ctx.session.temp.broadcastTarget) {
        await ctx.answerCbQuery('❌ Sesión expirada');
        return;
      }

      ctx.session.temp.broadcastStep = 'schedule_count';
      ctx.session.temp.scheduledTimes = [];
      await ctx.saveSession();

      await ctx.answerCbQuery();

      await ctx.editMessageText(
        '📅 *Programar Broadcasts*\n\n'
        + '¿Qué tipo de programación deseas?\n\n'
        + '📆 *Una vez:* Envío único en fecha/hora específica\n'
        + '📅 *Múltiples:* Programar varias fechas diferentes\n'
        + '🔄 *Recurrente:* Envíos repetidos (diario, semanal, mensual)',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📆 Una vez', 'schedule_type_once')],
            [Markup.button.callback('📅 Múltiples fechas', 'schedule_type_multiple')],
            [Markup.button.callback('🔄 Recurrente', 'schedule_type_recurring')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in broadcast schedule with buttons:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action('broadcast_create_scheduled_multiple', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await ctx.answerCbQuery();

      const timezone = ctx.session.temp?.timezone || 'UTC';
      const scheduledTimesRaw = ctx.session.temp?.scheduledTimes || [];
      const scheduledTimes = scheduledTimesRaw.map((time) => new Date(time));

      if (!scheduledTimes.length) {
        await ctx.reply('❌ No hay fechas programadas.');
        return;
      }

      await ctx.reply(
        '📤 *Creando broadcasts programados...*',
        { parse_mode: 'Markdown' }
      );

      const { successCount, errorCount, broadcastIds } = await createScheduledBroadcastsFromTimes(
        ctx,
        scheduledTimes,
        timezone
      );

      const broadcastTarget = ctx.session.temp?.broadcastTarget;
      const broadcastData = ctx.session.temp?.broadcastData;

      // Clear session data
      ctx.session.temp.broadcastTarget = null;
      ctx.session.temp.broadcastStep = null;
      ctx.session.temp.broadcastData = null;
      ctx.session.temp.scheduledTimes = null;
      ctx.session.temp.scheduleCount = null;
      ctx.session.temp.currentScheduleIndex = null;
      ctx.session.temp.timezone = null;
      ctx.session.temp.schedulingStep = null;
      ctx.session.temp.schedulingContext = null;
      await ctx.saveSession();

      let resultMessage = `✅ *Broadcasts Programados*\n\n`;
      resultMessage += `📊 *Resultados:*\n`;
      resultMessage += `✓ Creados: ${successCount}/${scheduledTimes.length}\n`;
      if (errorCount > 0) {
        resultMessage += `✗ Errores: ${errorCount}\n`;
      }
      resultMessage += `\n🎯 Audiencia: ${formatBroadcastTargetLabel(broadcastTarget, 'es')}\n`;
      resultMessage += `🌍 Zona horaria: ${timezone}\n`;
      resultMessage += `🌐 Mensajes bilingües: EN / ES\n`;
      resultMessage += `${broadcastData?.mediaType ? `📎 Con media: ${broadcastData.mediaType}` : '📝 Solo texto'}\n`;
      resultMessage += `\n📅 *Programaciones:*\n`;

      scheduledTimes.forEach((time, idx) => {
        resultMessage += `${idx + 1}. ${time.toLocaleString('es-ES', { timeZone: timezone })} (${timezone})\n`;
      });

      resultMessage += `\n💡 Los broadcasts se enviarán automáticamente a la hora programada.`;

      await ctx.reply(
        resultMessage,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
          ]),
        }
      );

      logger.info('Broadcast scheduling completed (picker)', {
        adminId: ctx.from.id,
        totalSchedules: scheduledTimes.length,
        successCount,
        errorCount,
        broadcastIds,
      });
    } catch (error) {
      logger.error('Error creating scheduled broadcasts (picker):', error);
      await ctx.reply(
        '❌ *Error al programar broadcasts*\n\n'
        + `Detalles: ${error.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  bot.action('broadcast_create_recurring_from_picker', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await ctx.answerCbQuery();

      const confirmed = ctx.session.temp?.confirmedSchedule;
      if (!confirmed?.date) {
        await ctx.reply('❌ Sesión expirada. Inicia de nuevo.');
        return;
      }

      const timezone = ctx.session.temp?.timezone || 'UTC';
      const scheduledDate = new Date(confirmed.date);
      const { broadcastTarget, broadcastData, recurrencePattern, maxOccurrences, cronExpression } = ctx.session.temp;

      await ctx.reply(
        '📤 *Creando broadcast recurrente...*',
        { parse_mode: 'Markdown' }
      );

      const broadcast = await createRecurringBroadcastFromSchedule(ctx, scheduledDate);

      const patternLabel = recurrencePattern || 'custom';
      const maxLabel = maxOccurrences ? `${maxOccurrences} veces` : 'Sin límite';
      const cronInfo = cronExpression ? `\n⚙️ Cron: \`${cronExpression}\`` : '';

      // Clear session data
      ctx.session.temp.broadcastTarget = null;
      ctx.session.temp.broadcastStep = null;
      ctx.session.temp.broadcastData = null;
      ctx.session.temp.isRecurring = null;
      ctx.session.temp.recurrencePattern = null;
      ctx.session.temp.cronExpression = null;
      ctx.session.temp.maxOccurrences = null;
      ctx.session.temp.timezone = null;
      ctx.session.temp.schedulingStep = null;
      ctx.session.temp.schedulingContext = null;
      ctx.session.temp.confirmedSchedule = null;
      await ctx.saveSession();

      await ctx.reply(
        `✅ *Broadcast Recurrente Creado*\n\n`
        + `🔄 Frecuencia: ${patternLabel}${cronInfo}\n`
        + `📊 Repeticiones: ${maxLabel}\n`
        + `📅 Primer envío: ${scheduledDate.toLocaleString('es-ES', { timeZone: timezone })} (${timezone})\n`
        + `🎯 Audiencia: ${formatBroadcastTargetLabel(broadcastTarget, 'es')}\n`
        + `🆔 ID: \`${broadcast.broadcast_id}\`\n`
        + `${broadcastData?.mediaType ? `📎 Con media (${broadcastData.mediaType})` : '📝 Solo texto'}\n\n`
        + `💡 El broadcast se enviará automáticamente según la programación.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
          ]),
        }
      );

      logger.info('Recurring broadcast created (picker)', {
        broadcastId: broadcast.broadcast_id,
        adminId: ctx.from.id,
        pattern: recurrencePattern,
        cronExpression,
        maxOccurrences,
        scheduledAt: scheduledDate,
        timezone,
      });
    } catch (error) {
      logger.error('Error creating recurring broadcast (picker):', error);
      await ctx.reply(
        '❌ *Error al crear broadcast recurrente*\n\n'
        + `Detalles: ${error.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // Analytics
  bot.action('admin_analytics', async (ctx) => {
    try {
      await ctx.answerCbQuery(); // Answer immediately

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const lang = getLanguage(ctx);

      // Clear any ongoing admin tasks
      ctx.session.temp = {};
      await ctx.saveSession();

      // Get statistics
      const userStats = await UserService.getStatistics();
      const revenue = await PaymentModel.getRevenue(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date(),
      );

      const analytics = `${t('analytics', lang)}\n\n`
        + `👥 Total Users: ${userStats.total}\n`
        + `💎 Premium Users: ${userStats.active}\n`
        + `🆓 Free Users: ${userStats.free}\n`
        + `📈 Conversion Rate: ${userStats.conversionRate.toFixed(2)}%\n\n`
        + '💰 Last 30 Days Revenue:\n'
        + `Total: $${revenue.total.toFixed(2)}\n`
        + `Payments: ${revenue.count}\n`
        + `Average: $${revenue.average.toFixed(2)}`;

      await ctx.editMessageText(
        analytics,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Actualizar', 'admin_analytics')],
          [Markup.button.callback('◀️ Volver', 'admin_cancel')],
        ]),
      );
    } catch (error) {
      logger.error('Error in admin analytics:', error);
    }
  });

  // Payment webhook summary
  bot.action('admin_payment_webhooks', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const lang = getLanguage(ctx);
      const summary = await PaymentWebhookEventModel.getSummary({ sinceHours: 24 });
      const recent = await PaymentWebhookEventModel.getRecent(10);

      let message = lang === 'es'
        ? '💳 *Webhooks de Pago (últimas 24h)*\n\n'
        : '💳 *Payment Webhooks (last 24h)*\n\n';

      if (!summary.length) {
        message += lang === 'es'
          ? 'No hay eventos recientes.\n\n'
          : 'No recent events.\n\n';
      } else {
        message += lang === 'es' ? '*Resumen:*\n' : '*Summary:*\n';
        summary.forEach((row) => {
          const provider = row.provider || 'unknown';
          const status = row.status || 'unknown';
          const sig = row.is_valid_signature ? '✓' : '✗';
          message += `• ${provider} | ${status} | sig ${sig}: ${row.count}\n`;
        });
        message += '\n';
      }

      if (recent.length) {
        message += lang === 'es' ? '*Recientes:*\n' : '*Recent:*\n';
        recent.forEach((row) => {
          const provider = row.provider || 'unknown';
          const status = row.status || 'unknown';
          const sig = row.is_valid_signature ? '✓' : '✗';
          const ts = row.created_at
            ? new Date(row.created_at).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US')
            : '';
          const eventId = row.event_id || row.payment_id || 'n/a';
          message += `• ${ts} | ${provider} | ${status} | sig ${sig} | ${eventId}\n`;
        });
      }

      await ctx.editMessageText(
        message,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '🔄 Actualizar' : '🔄 Refresh', 'admin_payment_webhooks')],
            [Markup.button.callback(lang === 'es' ? '◀️ Volver' : '◀️ Back', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in admin_payment_webhooks:', error);
      await ctx.reply('❌ Error').catch(() => {});
    }
  });

  // Security Report handler
  bot.action('admin_security_report', async (ctx) => {
    try {
      await safeAnswerCbQuery(ctx);
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const lang = getLanguage(ctx);
      const report = await PaymentSecurityService.generateSecurityReport(30);

      let message = '🔒 *Payment Security Report (30 days)*\n';
      message += '━━━━━━━━━━━━━━━━━━━━\n\n';

      if (!report || report.length === 0) {
        message += lang === 'es' ? 'No hay datos de seguridad aún.' : 'No security data yet.';
      } else {
        let totalEvents = 0;
        let totalBlocked = 0;
        let totalFailed = 0;

        for (const row of report.slice(0, 10)) {
          const date = new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const events = parseInt(row.total_events) || 0;
          const blocked = parseInt(row.blocked_payments) || 0;
          const failed = parseInt(row.failed_payments) || 0;
          const users = parseInt(row.unique_users) || 0;

          totalEvents += events;
          totalBlocked += blocked;
          totalFailed += failed;

          message += `📅 *${date}*: ${events} events, ${blocked} blocked, ${failed} failed, ${users} users\n`;
        }

        message += `\n📊 *Totals*: ${totalEvents} events, ${totalBlocked} blocked, ${totalFailed} failed\n`;
      }

      await ctx.editMessageText(
        message,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'admin_security_report')],
            [Markup.button.callback('⬅️ Back', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in admin_security_report:', error);
      await ctx.reply('❌ Error loading security report').catch(() => {});
    }
  });

  // Admin cancel / back to main panel
  bot.action('admin_cancel', async (ctx) => {
    try {
      await safeAnswerCbQuery(ctx); // Answer immediately

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      // Safely clear session temp data
      if (ctx.session) {
        ctx.session.temp = {};
        if (typeof ctx.saveSession === 'function') {
          await ctx.saveSession();
        }
      }

      await showAdminPanel(ctx, true);
    } catch (error) {
      logger.error('Error in admin cancel:', error);
      // Try to show admin panel even if session operations fail
      try {
        await showAdminPanel(ctx, true);
      } catch (panelError) {
        await ctx.reply('❌ Error. Please use /admin to return to the panel.');
      }
    }
  });

  // Back to admin panel (alternative back button)
  bot.action('back_admin', async (ctx) => {
    try {
      await safeAnswerCbQuery(ctx); // Answer immediately

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      // Safely clear session temp data
      if (ctx.session) {
        ctx.session.temp = {};
        if (typeof ctx.saveSession === 'function') {
          await ctx.saveSession();
        }
      }

      await showAdminPanel(ctx, true);
    } catch (error) {
      logger.error('Error in back_admin:', error);
      // Try to show admin panel even if session operations fail
      try {
        await showAdminPanel(ctx, true);
      } catch (panelError) {
        await ctx.reply('❌ Error. Please use /admin to return to the panel.');
      }
    }
  });

  // Handle media uploads for broadcast
  bot.on('photo', async (ctx, next) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);

      // Handle X post media upload
      if (isAdmin) {
        const xPostSession = getXPostSession(ctx);
        if (xPostSession.step === XPOST_STEPS.ADD_MEDIA) {
          const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
          const handled = await handleXPostMediaInput(ctx, { file_id: photo?.file_id, type: 'photo' });
          if (handled) return;
        }
      }

      // Check if this is for broadcast
      if (!isAdmin || !ctx.session.temp || ctx.session.temp.broadcastStep !== 'media') {
        return next();
      }

      // Validate session state
      if (!ctx.session.temp.broadcastTarget || !ctx.session.temp.broadcastData) {
        logger.warn('Broadcast session incomplete when uploading photo', { userId: ctx.from.id });
        await ctx.reply('❌ Sesión expirada. Por favor inicia el broadcast de nuevo con /admin');
        return;
      }

      const photo = ctx.message.photo[ctx.message.photo.length - 1];

      if (!photo || !photo.file_id) {
        logger.error('Invalid photo upload', { userId: ctx.from.id });
        await ctx.reply('❌ Error al procesar la imagen. Por favor intenta de nuevo.');
        return;
      }

      // Use batch session updates for better performance
      await performanceUtils.batchSessionUpdates(ctx, [
        { key: 'temp.broadcastData.mediaType', value: 'photo' },
        { key: 'temp.broadcastData.mediaFileId', value: photo.file_id },
        { key: 'temp.broadcastStep', value: 'text_en' },
        { key: 'temp.maxCompletedStep', value: 'text_en' }
      ]);

      logger.info('Broadcast photo uploaded', {
        userId: ctx.from.id,
        fileId: photo.file_id,
        target: ctx.session.temp.broadcastTarget
      });

      // Delete the "Upload Media" prompt message to avoid confusion
      if (ctx.session.temp.mediaPromptMessageId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.temp.mediaPromptMessageId);
          logger.info('Deleted media prompt message', { messageId: ctx.session.temp.mediaPromptMessageId });
        } catch (deleteError) {
          logger.warn('Could not delete media prompt message:', deleteError.message);
        }
      }

      await ctx.reply(
        '✅ Imagen guardada correctamente\n\n'
        + '🇺🇸 *Paso 3/5: Texto en Inglés (Opcional)*\n\n'
        + 'Escribe el mensaje en inglés que quieres enviar.\n\n'
        + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en inglés.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_en')],
            [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_en')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error handling photo for broadcast:', error);
      await ctx.reply('❌ Error al procesar la imagen. Por favor intenta de nuevo.').catch(() => {});
    }
  });

  bot.on('video', async (ctx, next) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);

      // Handle X post media upload
      if (isAdmin) {
        const xPostSession = getXPostSession(ctx);
        if (xPostSession.step === XPOST_STEPS.ADD_MEDIA) {
          const video = ctx.message.video;
          const handled = await handleXPostMediaInput(ctx, { file_id: video?.file_id, type: 'video' });
          if (handled) return;
        }
      }

      // Check if this is for broadcast
      if (!isAdmin || !ctx.session.temp || ctx.session.temp.broadcastStep !== 'media') {
        return next();
      }

      // Validate session state
      if (!ctx.session.temp.broadcastTarget || !ctx.session.temp.broadcastData) {
        logger.warn('Broadcast session incomplete when uploading video', { userId: ctx.from.id });
        await ctx.reply('❌ Sesión expirada. Por favor inicia el broadcast de nuevo con /admin');
        return;
      }

      const video = ctx.message.video;

      if (!video || !video.file_id) {
        logger.error('Invalid video upload', { userId: ctx.from.id });
        await ctx.reply('❌ Error al procesar el video. Por favor intenta de nuevo.');
        return;
      }

      // Use batch session updates for better performance
      await performanceUtils.batchSessionUpdates(ctx, [
        { key: 'temp.broadcastData.mediaType', value: 'video' },
        { key: 'temp.broadcastData.mediaFileId', value: video.file_id },
        { key: 'temp.broadcastStep', value: 'text_en' },
        { key: 'temp.maxCompletedStep', value: 'text_en' }
      ]);

      logger.info('Broadcast video uploaded', {
        userId: ctx.from.id,
        fileId: video.file_id,
        target: ctx.session.temp.broadcastTarget
      });

      // Delete the "Upload Media" prompt message to avoid confusion
      if (ctx.session.temp.mediaPromptMessageId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.temp.mediaPromptMessageId);
          logger.info('Deleted media prompt message', { messageId: ctx.session.temp.mediaPromptMessageId });
        } catch (deleteError) {
          logger.warn('Could not delete media prompt message:', deleteError.message);
        }
      }

      await ctx.reply(
        '✅ Video guardado correctamente\n\n'
        + '🇺🇸 *Paso 3/5: Texto en Inglés (Opcional)*\n\n'
        + 'Escribe el mensaje en inglés que quieres enviar.\n\n'
        + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en inglés.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_en')],
            [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_en')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error handling video for broadcast:', error);
      await ctx.reply('❌ Error al procesar el video. Por favor intenta de nuevo.').catch(() => {});
    }
  });

  bot.on('animation', async (ctx, next) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);

      // Handle X post media upload (animations/gifs)
      if (isAdmin) {
        const xPostSession = getXPostSession(ctx);
        if (xPostSession.step === XPOST_STEPS.ADD_MEDIA) {
          const animation = ctx.message.animation;
          const handled = await handleXPostMediaInput(ctx, { file_id: animation?.file_id, type: 'video' });
          if (handled) return;
        }
      }

      return next();
    } catch (error) {
      logger.error('Error handling animation for X post:', error);
      return next();
    }
  });

  bot.on('video_note', async (ctx, next) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);

      // Handle X post media upload (video notes)
      if (isAdmin) {
        const xPostSession = getXPostSession(ctx);
        if (xPostSession.step === XPOST_STEPS.ADD_MEDIA) {
          const note = ctx.message.video_note;
          const handled = await handleXPostMediaInput(ctx, { file_id: note?.file_id, type: 'video' });
          if (handled) return;
        }
      }

      return next();
    } catch (error) {
      logger.error('Error handling video_note for X post:', error);
      return next();
    }
  });

  bot.on('document', async (ctx, next) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);

      // Handle X post media upload (documents that are images/videos)
      if (isAdmin) {
        const xPostSession = getXPostSession(ctx);
        if (xPostSession.step === XPOST_STEPS.ADD_MEDIA) {
          const document = ctx.message.document;
          const mime = document?.mime_type || '';
          if (mime.startsWith('video/') || mime.startsWith('image/')) {
            const type = mime.startsWith('video/') ? 'video' : 'photo';
            const handled = await handleXPostMediaInput(ctx, { file_id: document?.file_id, type });
            if (handled) return;
          }
        }
      }

      // Check if this is for broadcast
      if (!isAdmin || !ctx.session.temp || ctx.session.temp.broadcastStep !== 'media') {
        return next();
      }

      // Validate session state
      if (!ctx.session.temp.broadcastTarget || !ctx.session.temp.broadcastData) {
        logger.warn('Broadcast session incomplete when uploading document', { userId: ctx.from.id });
        await ctx.reply('❌ Sesión expirada. Por favor inicia el broadcast de nuevo con /admin');
        return;
      }

      const document = ctx.message.document;

      if (!document || !document.file_id) {
        logger.error('Invalid document upload', { userId: ctx.from.id });
        await ctx.reply('❌ Error al procesar el documento. Por favor intenta de nuevo.');
        return;
      }

      ctx.session.temp.broadcastData.mediaType = 'document';
      ctx.session.temp.broadcastData.mediaFileId = document.file_id;
      
      // DEFENSIVE FIX: Track max completed step to prevent regression
      ctx.session.temp.maxCompletedStep = 'text_en';
      
      ctx.session.temp.broadcastStep = 'text_en';
      await ctx.saveSession();

      logger.info('Broadcast document uploaded', {
        userId: ctx.from.id,
        fileId: document.file_id,
        target: ctx.session.temp.broadcastTarget
      });

      // Delete the "Upload Media" prompt message to avoid confusion
      if (ctx.session.temp.mediaPromptMessageId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.temp.mediaPromptMessageId);
        } catch (deleteError) {
          logger.warn('Could not delete media prompt message:', deleteError.message);
        }
      }

      await ctx.reply(
        '✅ Documento guardado correctamente\n\n'
        + '🇺🇸 *Paso 3/5: Texto en Inglés (Opcional)*\n\n'
        + 'Escribe el mensaje en inglés que quieres enviar.\n\n'
        + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en inglés.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_en')],
            [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_en')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error handling document for broadcast:', error);
      await ctx.reply('❌ Error al procesar el documento. Por favor intenta de nuevo.').catch(() => {});
    }
  });

  bot.on('audio', async (ctx, next) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);

      // Check if this is for broadcast
      if (!isAdmin || !ctx.session.temp || ctx.session.temp.broadcastStep !== 'media') {
        return next();
      }

      // Validate session state
      if (!ctx.session.temp.broadcastTarget || !ctx.session.temp.broadcastData) {
        logger.warn('Broadcast session incomplete when uploading audio', { userId: ctx.from.id });
        await ctx.reply('❌ Sesión expirada. Por favor inicia el broadcast de nuevo con /admin');
        return;
      }

      const audio = ctx.message.audio;

      if (!audio || !audio.file_id) {
        logger.error('Invalid audio upload', { userId: ctx.from.id });
        await ctx.reply('❌ Error al procesar el audio. Por favor intenta de nuevo.');
        return;
      }

      ctx.session.temp.broadcastData.mediaType = 'audio';
      ctx.session.temp.broadcastData.mediaFileId = audio.file_id;
      
      // DEFENSIVE FIX: Track max completed step to prevent regression
      ctx.session.temp.maxCompletedStep = 'text_en';
      
      ctx.session.temp.broadcastStep = 'text_en';
      await ctx.saveSession();

      logger.info('Broadcast audio uploaded', {
        userId: ctx.from.id,
        fileId: audio.file_id,
        target: ctx.session.temp.broadcastTarget
      });

      // Delete the "Upload Media" prompt message to avoid confusion
      if (ctx.session.temp.mediaPromptMessageId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.temp.mediaPromptMessageId);
        } catch (deleteError) {
          logger.warn('Could not delete media prompt message:', deleteError.message);
        }
      }

      await ctx.reply(
        '✅ Audio guardado correctamente\n\n'
        + '🇺🇸 *Paso 3/5: Texto en Inglés (Opcional)*\n\n'
        + 'Escribe el mensaje en inglés que quieres enviar.\n\n'
        + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en inglés.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_en')],
            [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_en')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error handling audio for broadcast:', error);
      await ctx.reply('❌ Error al procesar el audio. Por favor intenta de nuevo.').catch(() => {});
    }
  });

  bot.on('voice', async (ctx, next) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);

      // Check if this is for broadcast
      if (!isAdmin || !ctx.session.temp || ctx.session.temp.broadcastStep !== 'media') {
        return next();
      }

      // Validate session state
      if (!ctx.session.temp.broadcastTarget || !ctx.session.temp.broadcastData) {
        logger.warn('Broadcast session incomplete when uploading voice', { userId: ctx.from.id });
        await ctx.reply('❌ Sesión expirada. Por favor inicia el broadcast de nuevo con /admin');
        return;
      }

      const voice = ctx.message.voice;

      if (!voice || !voice.file_id) {
        logger.error('Invalid voice upload', { userId: ctx.from.id });
        await ctx.reply('❌ Error al procesar el mensaje de voz. Por favor intenta de nuevo.');
        return;
      }

      ctx.session.temp.broadcastData.mediaType = 'voice';
      ctx.session.temp.broadcastData.mediaFileId = voice.file_id;
      
      // DEFENSIVE FIX: Track max completed step to prevent regression
      ctx.session.temp.maxCompletedStep = 'text_en';
      
      ctx.session.temp.broadcastStep = 'text_en';
      await ctx.saveSession();

      logger.info('Broadcast voice uploaded', {
        userId: ctx.from.id,
        fileId: voice.file_id,
        target: ctx.session.temp.broadcastTarget
      });

      // Delete the "Upload Media" prompt message to avoid confusion
      if (ctx.session.temp.mediaPromptMessageId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.temp.mediaPromptMessageId);
        } catch (deleteError) {
          logger.warn('Could not delete media prompt message:', deleteError.message);
        }
      }

      await ctx.reply(
        '✅ Mensaje de voz guardado correctamente\n\n'
        + '🇺🇸 *Paso 3/5: Texto en Inglés (Opcional)*\n\n'
        + 'Escribe el mensaje en inglés que quieres enviar.\n\n'
        + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en inglés.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_en')],
            [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_en')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error handling voice for broadcast:', error);
      await ctx.reply('❌ Error al procesar el mensaje de voz. Por favor intenta de nuevo.').catch(() => {});
    }
  });

  // Handle admin text inputs
  bot.on('text', async (ctx, next) => {
    // Guard: ignore non-private chats (e.g., support topics) to prevent wizard contamination
    if (ctx.chat?.type && ctx.chat.type !== 'private') {
      return next();
    }
    if (ctx.session?.temp?.promoCreate?.step === 'custom_code') {
      return next();
    }
    logger.info('[TEXT-HANDLER-RAW] Raw text message received BEFORE admin check', {
      userId: ctx.from.id,
      messageText: (ctx.message.text || '').substring(0, 50),
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      hasSession: !!ctx.session,
      broadcastStep: ctx.session?.temp?.broadcastStep
    });

    const isAdmin = await PermissionService.isAdmin(ctx.from.id);
    logger.info('[TEXT-HANDLER] Text message received', {
      userId: ctx.from.id,
      isAdmin,
      messageText: (ctx.message.text || '').substring(0, 50),
      broadcastStep: ctx.session.temp?.broadcastStep,
      adminSearchingUser: ctx.session.temp?.adminSearchingUser
    });

    if (!isAdmin) {
      logger.info('[TEXT-HANDLER] User is not admin, passing to next handler', { userId: ctx.from.id });
      return next();
    }

    // Lex mode: route messages through admin AI assistant
    if (ctx.session.temp?.cristinaLexMode && isCristinaAIAvailable()) {
      const lexKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🚪 Salir del modo Lex', 'cristina_admin_lex_exit')],
      ]);
      try {
        const response = await processLexModeMessage(ctx.from.id, ctx.message.text);
        await ctx.reply(response, { parse_mode: 'Markdown', ...lexKeyboard });
      } catch (error) {
        logger.error('Error en modo Lex AI:', error);
        await ctx.reply(
          '❌ No pude procesar tu mensaje. Intenta de nuevo.',
          lexKeyboard
        );
      }
      return;
    }

    const awaitingCristinaInput = ctx.session.temp?.awaitingCristinaAdminText;
    const cristinaFeed = ctx.session.temp?.cristinaAdminFeed;
    if (awaitingCristinaInput && cristinaFeed?.section) {
      const sectionLabel = cristinaFeed.section === 'lex' ? 'Planes de Lex' : 'Planes del canal';
      const backKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Volver a Cristina', 'cristina_admin_menu')],
      ]);
      try {
        const savedText = await CristinaAdminInfoService.updateSection(cristinaFeed.section, ctx.message.text);
        await ctx.reply(
          `✅ Información guardada para *${sectionLabel}*:\n\n${shortenCristinaValue(savedText, 500)}`,
          { parse_mode: 'Markdown', ...backKeyboard }
        );
      } catch (error) {
        logger.error('Error guardando info de Cristina desde admin:', error);
        await ctx.reply(
          '❌ No pude guardar la información. Por favor intenta de nuevo.',
          backKeyboard
        );
      } finally {
        delete ctx.session.temp.awaitingCristinaAdminText;
        delete ctx.session.temp.cristinaAdminFeed;
        await ctx.saveSession();
      }
      return;
    }

    // X Post Wizard text input (compose, AI prompt, or schedule custom time)
    const xPostSession = getXPostSession(ctx);
    if (
      xPostSession.step === XPOST_STEPS.COMPOSE_TEXT
      || xPostSession.step === XPOST_STEPS.AI_PROMPT
      || xPostSession.step === 'schedule_custom_time'
    ) {
      logger.info('[TEXT-HANDLER] Processing X post wizard text input', { userId: ctx.from.id, step: xPostSession.step });
      return handleXPostTextInput(ctx, next);
    }

    // User search
    if (ctx.session.temp?.adminSearchingUser) {
      logger.info('[TEXT-HANDLER] Processing adminSearchingUser flow', { userId: ctx.from.id });
      try {
        const lang = getLanguage(ctx);
        const searchQuery = ctx.message.text.trim();

        let user = null;
        // Try by numeric ID first
        if (/^\d+$/.test(searchQuery)) {
          user = await UserModel.getById(searchQuery);
        }
        // Try by username (strip leading @)
        if (!user) {
          const { query: dbQuery } = require('../../../config/postgres');
          const username = searchQuery.replace(/^@/, '');
          const result = await dbQuery(
            `SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
            [username]
          );
          if (result.rows.length > 0) {
            user = UserModel.mapRowToUser(result.rows[0]);
          }
          // Try by first_name
          if (!user) {
            const nameResult = await dbQuery(
              `SELECT * FROM users WHERE first_name ILIKE $1 LIMIT 1`,
              [`%${searchQuery}%`]
            );
            if (nameResult.rows.length > 0) {
              user = UserModel.mapRowToUser(nameResult.rows[0]);
            }
          }
        }
        // Try by email
        if (!user) {
          user = await UserModel.getByEmail(searchQuery);
        }

        if (!user) {
          await ctx.reply(t('userNotFound', lang));
          return;
        }

        ctx.session.temp.adminSearchingUser = false;
        ctx.session.temp.selectedUserId = user.id;
        await ctx.saveSession();

        // Check if user is banned globally
        const isBanned = await ModerationModel.isUserBanned(user.id, 'global');

        const buttons = [
          [Markup.button.callback('📅 Extender Suscripción', 'admin_extend_sub')],
          [Markup.button.callback('💎 Cambiar Plan', 'admin_change_plan')],
          [Markup.button.callback('🚫 Desactivar Usuario', 'admin_deactivate')],
          [isBanned
            ? Markup.button.callback('✅ Desbanear Usuario', 'admin_unban_user')
            : Markup.button.callback('⛔ Banear Usuario', 'admin_ban_user')],
          [Markup.button.callback('🔞 Forzar Verificación Edad', 'admin_force_age_verify')],
          [Markup.button.callback('◀️ Volver', 'admin_cancel')],
        ];

        await ctx.reply(
          `${t('userFound', lang)}\n\n`
          + `👤 ${user.firstName || ''} ${user.lastName || ''}\n`
          + `🆔 ${user.id}\n`
          + `📧 ${user.email || 'N/A'}\n`
          + `💎 Status: ${user.subscriptionStatus}\n`
          + `📦 Plan: ${user.planId || 'N/A'}\n`
          + `🔞 Edad: ${user.ageVerified ? '✅ Verificado' : '❌ No verificado'}`
          + (isBanned ? '\n\n⛔ **USUARIO BANEADO**' : ''),
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          },
        );
      } catch (error) {
        logger.error('Error searching user:', error);
      }
      return;
    }

    // Message to user after activation
    if (ctx.session.temp?.awaitingMessageInput) {
      logger.info('[TEXT-HANDLER] Processing awaitingMessageInput flow', { userId: ctx.from.id });
      try {
        const requiredPromptId = ctx.session.temp.awaitingMessagePromptId;
        const replyToId = ctx.message?.reply_to_message?.message_id;
        if (requiredPromptId && replyToId !== requiredPromptId) {
          await ctx.reply(
            '⚠️ Responde al mensaje de solicitud para enviar el texto al usuario.',
            { reply_to_message_id: ctx.message.message_id },
          );
          return;
        }
        const message = ctx.message.text;
        const recipientId = ctx.session.temp.messageRecipientId;
        const user = await UserModel.getById(recipientId);

        if (!user) {
          await ctx.reply('❌ Usuario no encontrado');
          ctx.session.temp.awaitingMessageInput = false;
          await ctx.saveSession();
          return;
        }

        // Send message to user
        try {
          await ctx.telegram.sendMessage(recipientId, message, { parse_mode: 'Markdown' });

          // Confirm to admin
          const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');
          let confirmText = '✅ **Mensaje Enviado**\n\n';
          confirmText += `👤 Destinatario: ${safeName}\n`;
          confirmText += `🆔 ID: ${recipientId}\n\n`;
          confirmText += '📨 El mensaje ha sido entregado correctamente.';

          await ctx.reply(confirmText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
            ]),
          });

          logger.info('Admin sent custom message to user', {
            adminId: ctx.from.id,
            recipientId,
            messageLength: message.length,
          });
        } catch (sendError) {
          logger.warn('Could not send message to user', { recipientId, error: sendError.message });

          let errorText = '⚠️ **Error al Enviar Mensaje**\n\n';
          errorText += `Usuario ${user.firstName} no pudo recibir el mensaje.\n\n`;
          errorText += `Posibles razones:\n`;
          errorText += `• El usuario ha bloqueado al bot\n`;
          errorText += `• El usuario ha eliminado su cuenta\n`;
          errorText += `• Error de Telegram`;

          await ctx.reply(errorText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
            ]),
          });
        }

        // Clear message input state
        ctx.session.temp.awaitingMessageInput = false;
        ctx.session.temp.messageRecipientId = null;
        ctx.session.temp.awaitingMessagePromptId = null;
        await ctx.saveSession();
      } catch (error) {
        logger.error('Error handling message input:', error);
        await ctx.reply('❌ Error al procesar el mensaje');
      }
      return;
    }

    // Handle button preset selection
    const presetMatch = ctx.session.temp?.broadcastStep === 'buttons' ? true : false;

    // Broadcast flow - If user types while in media step, guide them
    if (ctx.session.temp?.broadcastStep === 'media') {
      try {
        await ctx.reply(
          '⏳ *Esperando Media*\n\n'
          + 'Parece que estás escribiendo texto, pero aún estamos en el paso de media.\n\n'
          + 'Tienes dos opciones:\n'
          + '1️⃣ **Salta el media** - Presiona el botón "Saltar (Solo Texto)" arriba\n'
          + '2️⃣ **Sube media** - Envía una imagen, video o archivo\n\n'
          + 'Luego podrás escribir tu mensaje.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⏭️ Saltar (Solo Texto)', 'broadcast_skip_media')],
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          }
        );
      } catch (error) {
        logger.error('Error guiding user during media step:', error);
      }
      return;
    }
    
    // DEFENSIVE FIX: Guard against step regression in text processing
    // Check if we have a max completed step to prevent regression
    const maxCompletedStep = ctx.session.temp?.maxCompletedStep;
    const currentStep = ctx.session.temp?.broadcastStep;
    const stepAliasMap = {
      custom_link: 'buttons',
      custom_buttons: 'buttons',
      schedule_options: 'buttons',
    };
    const normalizedStep = stepAliasMap[currentStep] || currentStep;
    
    logger.info('[TEXT-HANDLER] Checking step regression guard', {
      userId: ctx.from.id,
      currentStep,
      maxCompletedStep
    });
    
    if (maxCompletedStep && currentStep) {
      const stepOrder = ['media', 'text_en', 'ai_prompt_en', 'text_es', 'ai_prompt_es', 'buttons', 'preview', 'sending'];
      const currentStepIndex = stepOrder.indexOf(normalizedStep);
      const maxStepIndex = stepOrder.indexOf(maxCompletedStep);
      
      // If current step is before max completed step, prevent regression
      // EXCEPT: Allow normal step progression (text_en -> ai_prompt_en -> text_es -> ai_prompt_es -> buttons)
      const isNormalProgression = 
        (normalizedStep === 'text_en' && maxCompletedStep === 'ai_prompt_en') ||
        (normalizedStep === 'ai_prompt_en' && maxCompletedStep === 'text_es') ||
        (normalizedStep === 'text_es' && maxCompletedStep === 'ai_prompt_es') ||
        (normalizedStep === 'ai_prompt_es' && maxCompletedStep === 'buttons') ||
        (normalizedStep === 'text_es' && maxCompletedStep === 'buttons');
      
      if (currentStepIndex < maxStepIndex && !isNormalProgression) {
        logger.warn('Step regression detected in text processing - preventing', {
          userId: ctx.from.id,
          attemptedStep: currentStep,
          maxCompletedStep: maxCompletedStep,
          currentStepIndex,
          maxStepIndex
        });
        
        // Force back to the correct step
        ctx.session.temp.broadcastStep = maxCompletedStep;
        await ctx.saveSession();
        
        logger.info('Step regression prevented in text processing - restored to max completed step', {
          userId: ctx.from.id,
          restoredStep: ctx.session.temp.broadcastStep
        });
        
        return; // Exit to prevent further processing with wrong step
      }
    }
    
    // Guard: Prevent text input interference in advanced broadcast steps
    // If we're in buttons/preview/sending steps, skip text processing
    if (ctx.session.temp?.broadcastStep && ['buttons', 'preview', 'sending'].includes(ctx.session.temp.broadcastStep)) {
      // User is in a step that uses callback buttons, not text input
      logger.info('Skipping text input processing - already in advanced broadcast step', {
        userId: ctx.from.id,
        currentStep: ctx.session.temp.broadcastStep
      });
      return;
    }

    // Broadcast flow - Handle custom button entries
    if (ctx.session.temp?.broadcastStep === 'custom_buttons') {
      try {
        const message = ctx.message.text;

        // Check for "listo" (done) command
        if (message.toLowerCase() === 'listo') {
          // Verify at least one button was added
          if (!ctx.session.temp.customButtons || ctx.session.temp.customButtons.length === 0) {
            await ctx.reply(
              '❌ *Sin Botones*\n\n'
              + 'No has agregado ningún botón. Por favor agrega al menos uno o selecciona "Sin Botones".',
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('◀️ Volver a Presets', 'broadcast_custom_buttons')],
                ]),
              }
            );
            return;
          }

          // Convert custom buttons to same format as presets
          ctx.session.temp.broadcastData.buttons = ctx.session.temp.customButtons;

          // Move to schedule/send options
          ctx.session.temp.broadcastStep = 'schedule_options';
          await ctx.saveSession();

          await ctx.reply(
            '✅ *Botones Configurados*\n\n'
            + `📝 Botones agregados: ${ctx.session.temp.customButtons.length}\n\n`
            + '¿Qué deseas hacer?',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('📤 Enviar Ahora', 'broadcast_send_now_with_buttons')],
                [Markup.button.callback('📅 Programar', 'broadcast_schedule_with_buttons')],
                [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
              ]),
            }
          );
          return;
        }

        // Parse button entry: "Button Text|type|target"
        const parts = message.split('|');
        if (parts.length !== 3) {
          await ctx.reply(
            '❌ *Formato Inválido*\n\n'
            + 'Por favor usa el formato: `Texto|tipo|destino`\n\n'
            + '**Ejemplo:**\n'
            + '`💎 Ver Planes|command|/plans`\n\n'
            + 'O di "listo" cuando termines.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const [buttonText, buttonType, buttonTarget] = parts.map(p => p.trim());

        // Validate button type
        const validTypes = ['url', 'plan', 'command', 'feature'];
        if (!validTypes.includes(buttonType.toLowerCase())) {
          await ctx.reply(
            '❌ *Tipo de Botón Inválido*\n\n'
            + `Tipo recibido: \`${buttonType}\`\n\n`
            + '**Tipos válidos:**\n'
            + '• `url` - Enlace web (ej: https://...)\n'
            + '• `plan` - Plan (ej: premium)\n'
            + '• `command` - Comando (ej: /plans)\n'
            + '• `feature` - Característica (ej: features)\n\n'
            + 'Por favor intenta de nuevo.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Validate URL format if type is url
        if (buttonType.toLowerCase() === 'url') {
          if (!buttonTarget.startsWith('http://') && !buttonTarget.startsWith('https://')) {
            await ctx.reply(
              '❌ *URL Inválida*\n\n'
              + `URL recibida: \`${buttonTarget}\`\n\n`
              + 'Las URLs deben comenzar con `http://` o `https://`\n\n'
              + 'Por favor intenta de nuevo.',
              { parse_mode: 'Markdown' }
            );
            return;
          }
        }

        // Validate command format if type is command
        if (buttonType.toLowerCase() === 'command') {
          if (!buttonTarget.startsWith('/')) {
            await ctx.reply(
              '❌ *Comando Inválido*\n\n'
              + `Comando recibido: \`${buttonTarget}\`\n\n`
              + 'Los comandos deben comenzar con `/` (ej: /plans, /support)\n\n'
              + 'Por favor intenta de nuevo.',
              { parse_mode: 'Markdown' }
            );
            return;
          }
        }

        // Validate button text length
        if (buttonText.length > 64) {
          await ctx.reply(
            '❌ *Texto del Botón Muy Largo*\n\n'
            + `Longitud actual: ${buttonText.length} caracteres\n`
            + 'Máximo: 64 caracteres\n\n'
            + 'Por favor acorta el texto.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Initialize customButtons array if needed
        if (!ctx.session.temp.customButtons) {
          ctx.session.temp.customButtons = [];
        }

        // Add button
        ctx.session.temp.customButtons.push({
          text: buttonText,
          type: buttonType.toLowerCase(),
          target: buttonTarget,
        });

        await ctx.saveSession();

        await ctx.reply(
          `✅ *Botón Agregado*\n\n`
          + `📝 ${buttonText}\n`
          + `🔗 Tipo: ${buttonType}\n`
          + `🎯 Destino: ${buttonTarget}\n\n`
          + `Total: ${ctx.session.temp.customButtons.length} botón(es)\n\n`
          + 'Envía otro botón o escribe "listo" cuando termines.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          }
        );
      } catch (error) {
        logger.error('Error handling custom button input:', error);
        await ctx.reply('❌ Error al procesar el botón. Por favor intenta de nuevo.').catch(() => {});
      }
      return;
    }

    // Broadcast flow - Handle text inputs
    if (ctx.session.temp?.broadcastStep === 'payment_incomplete_window_custom') {
      try {
        const input = (ctx.message.text || '').trim();
        const days = parseInt(input, 10);
        if (!Number.isFinite(days) || days <= 0 || days > 3650) {
          await ctx.reply('❌ Ingresa un número válido de días (1-3650).');
          return;
        }

        ctx.session.temp.broadcastFilters = ctx.session.temp.broadcastFilters || {};
        ctx.session.temp.broadcastFilters.paymentIncompleteDays = days;
        if (ctx.session.temp.broadcastData) {
          ctx.session.temp.broadcastData.includeFilters = { paymentIncompleteDays: days };
        }
        await updateBroadcastStep(ctx, 'media');
        await ctx.saveSession();
        await renderBroadcastStep(ctx);
      } catch (error) {
        logger.error('Error saving custom payment window:', error);
      }
      return;
    }

    if (ctx.session.temp?.broadcastStep === 'email_subject_en') {
      try {
        const input = (ctx.message.text || '').trim();
        if (!input) {
          await ctx.reply('❌ Subject EN vacío.');
          return;
        }
        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
        ctx.session.temp.broadcastData.emailSubjectEn = input;
        ctx.session.temp.broadcastStep = 'preview';
        await ctx.saveSession();
        await sendBroadcastPreview(ctx);
      } catch (error) {
        logger.error('Error saving email subject EN:', error);
      }
      return;
    }

    if (ctx.session.temp?.broadcastStep === 'email_subject_es') {
      try {
        const input = (ctx.message.text || '').trim();
        if (!input) {
          await ctx.reply('❌ Subject ES vacío.');
          return;
        }
        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
        ctx.session.temp.broadcastData.emailSubjectEs = input;
        ctx.session.temp.broadcastStep = 'preview';
        await ctx.saveSession();
        await sendBroadcastPreview(ctx);
      } catch (error) {
        logger.error('Error saving email subject ES:', error);
      }
      return;
    }

    if (ctx.session.temp?.broadcastStep === 'email_preheader_en') {
      try {
        const input = (ctx.message.text || '').trim();
        if (!input) {
          await ctx.reply('❌ Preheader EN vacío.');
          return;
        }
        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
        ctx.session.temp.broadcastData.emailPreheaderEn = input;
        ctx.session.temp.broadcastStep = 'preview';
        await ctx.saveSession();
        await sendBroadcastPreview(ctx);
      } catch (error) {
        logger.error('Error saving email preheader EN:', error);
      }
      return;
    }

    if (ctx.session.temp?.broadcastStep === 'email_preheader_es') {
      try {
        const input = (ctx.message.text || '').trim();
        if (!input) {
          await ctx.reply('❌ Preheader ES vacío.');
          return;
        }
        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
        ctx.session.temp.broadcastData.emailPreheaderEs = input;
        ctx.session.temp.broadcastStep = 'preview';
        await ctx.saveSession();
        await sendBroadcastPreview(ctx);
      } catch (error) {
        logger.error('Error saving email preheader ES:', error);
      }
      return;
    }

    if (ctx.session.temp?.broadcastStep === 'text_en') {
      try {
        const message = ctx.message.text;

        // Validate message length
        // Telegram caption limit is 1024 chars for media, 4096 for text-only
        // Use 1020 to leave room for the "📢 " prefix and safety margin
        const hasMedia = ctx.session.temp.broadcastData?.mediaFileId;
        const maxLength = hasMedia ? 1020 : 4000;
        const charCount = message.length;

        if (charCount > maxLength) {
          const excessChars = charCount - maxLength;
          await ctx.reply(
            `❌ *Mensaje demasiado largo*\n\n`
            + `📏 Tu mensaje: ${charCount} caracteres\n`
            + `📏 Límite máximo: ${maxLength} caracteres\n`
            + `⚠️ Exceso: ${excessChars} caracteres\n\n`
            + `${hasMedia ? '⚠️ *Nota:* Los mensajes con foto/video tienen un límite de 1024 caracteres en Telegram.\n\n' : ''}`
            + `Por favor acorta tu mensaje y envíalo de nuevo.`,
            { parse_mode: 'Markdown' },
          );
          return;
        }

        // Initialize broadcastData if needed
        if (!ctx.session.temp.broadcastData) {
          ctx.session.temp.broadcastData = {};
        }
        // Save English text
        ctx.session.temp.broadcastData.textEn = message;
        
        // DEFENSIVE FIX: Track max completed step to prevent regression
        ctx.session.temp.maxCompletedStep = 'text_es';
        
        ctx.session.temp.broadcastStep = 'text_es';
        await ctx.saveSession();

        await ctx.reply(
          '🇪🇸 *Paso 4/5: Texto en Español (Opcional)*\n\n'
          + 'Escribe el mensaje en español que quieres enviar.\n\n'
          + '💡 Puedes usar Grok AI para generar el texto, o saltar si no necesitas texto en español.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_es')],
              [Markup.button.callback('⏭️ Saltar', 'broadcast_skip_text_es')],
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          },
        );
      } catch (error) {
        logger.error('Error saving English text:', error);
      }
      return;
    }

    // Broadcast flow - Custom link input
    if (ctx.session.temp?.broadcastStep === 'custom_link') {
      try {
        const input = ctx.message.text || '';
        const parts = input.split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2) {
          await ctx.reply('❌ Formato inválido. Usa: `Texto del Botón|https://tu-link.com`', { parse_mode: 'Markdown' });
          return;
        }
        const [text, url] = parts;
        if (!/^https?:\/\//i.test(url)) {
          await ctx.reply('❌ El link debe comenzar con http:// o https://', { parse_mode: 'Markdown' });
          return;
        }
        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
        if (!Array.isArray(ctx.session.temp.broadcastData.buttons)) {
          ctx.session.temp.broadcastData.buttons = buildDefaultBroadcastButtons(getLanguage(ctx));
        }
        ctx.session.temp.broadcastData.buttons.push({ key: 'custom', text, type: 'url', target: url });
        ctx.session.temp.broadcastStep = 'buttons';
        await ctx.saveSession();

        await ctx.reply('✅ Custom link agregado.');
        await showBroadcastButtonsPicker(ctx);
      } catch (error) {
        logger.error('Error handling custom link input:', error);
      }
      return;
    }

    // Broadcast flow - AI prompt EN/ES
    if (ctx.session.temp?.broadcastStep === 'ai_prompt_en' || ctx.session.temp?.broadcastStep === 'ai_prompt_es') {
      logger.info('[TEXT-HANDLER] MATCHED ai_prompt step!', {
        userId: ctx.from.id,
        step: ctx.session.temp.broadcastStep,
        messageLength: (ctx.message.text || '').length
      });
      try {
        const prompt = (ctx.message.text || '').trim();
        if (!prompt) {
          logger.info('Empty AI prompt received, ignoring');
          return;
        }

        logger.info('[GROK] AI prompt received', { 
          step: ctx.session.temp.broadcastStep, 
          promptLength: prompt.length,
          userId: ctx.from.id
        });

        const isEn = ctx.session.temp.broadcastStep === 'ai_prompt_en';
        const hasMedia = !!ctx.session.temp.broadcastData?.mediaFileId;
        const language = isEn ? 'English' : 'Spanish';

        logger.info('[GROK] Calling GrokService', {
          language,
          hasMedia,
          isEn
        });

        // Use optimized chat with hasMedia for automatic token calculation
        const result = await GrokService.chat({
          mode: 'broadcast',
          language,
          prompt,
          hasMedia,
        });

        logger.info('[GROK] GrokService returned result', {
          resultLength: result.length,
          isEn
        });

        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};

        // Store AI result temporarily for review/edit
        ctx.session.temp.aiDraft = result;
        ctx.session.temp.aiDraftLang = isEn ? 'en' : 'es';
        await updateBroadcastStep(ctx, isEn ? 'review_ai_en' : 'review_ai_es');
        await ctx.saveSession();

        const safeResult = sanitize.telegramMarkdown(result);
        await ctx.reply(
          `🤖 *AI Draft (${isEn ? 'EN' : 'ES'}):*\n\n${safeResult}\n\n` +
          `_Puedes usar este texto o editarlo manualmente._`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Usar texto', isEn ? 'broadcast_use_ai_en' : 'broadcast_use_ai_es')],
              [Markup.button.callback('✏️ Editar manualmente', isEn ? 'broadcast_edit_ai_en' : 'broadcast_edit_ai_es')],
              [Markup.button.callback('🔄 Regenerar', isEn ? 'broadcast_ai_en' : 'broadcast_ai_es')],
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          },
        );
      } catch (error) {
        logger.error('[GROK] Error generating AI broadcast text:', {
          error: error.message,
          stack: error.stack,
          step: ctx.session.temp?.broadcastStep
        });
        await ctx.reply(`❌ AI error: ${error.message}`);
        // Reset to previous step on error using fallback logic
        const fallbackStep = getFallbackStep(ctx.session.temp.broadcastStep);
        await updateBroadcastStep(ctx, fallbackStep);
      }
      return;
    }

    // Handle edited AI text (English)
    if (ctx.session.temp?.broadcastStep === 'edit_ai_en') {
      try {
        const editedText = ctx.message.text;
        const safeEditedText = sanitize.telegramMarkdown(editedText);
        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
        ctx.session.temp.broadcastData.textEn = editedText;
        ctx.session.temp.aiDraft = null;
        await updateBroadcastStep(ctx, 'text_es');
        await ctx.saveSession();

        await ctx.reply(
          `✅ *Texto editado guardado (EN)*\n\n${safeEditedText}`,
          { parse_mode: 'Markdown' },
        );
        await ctx.reply(
          '🇪🇸 *Paso 3/5: Texto en Español*\n\n'
          + 'Por favor escribe el mensaje en español que quieres enviar:',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🤖 AI Write (Grok)', 'broadcast_ai_es')],
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          },
        );
      } catch (error) {
        logger.error('Error saving edited AI text (EN):', error);
        await ctx.reply('❌ Error al guardar. Intenta de nuevo.');
      }
      return;
    }

    // Handle edited AI text (Spanish)
    if (ctx.session.temp?.broadcastStep === 'edit_ai_es') {
      try {
        const editedText = ctx.message.text;
        const safeEditedText = sanitize.telegramMarkdown(editedText);
        if (!ctx.session.temp.broadcastData) ctx.session.temp.broadcastData = {};
        ctx.session.temp.broadcastData.textEs = editedText;
        ctx.session.temp.aiDraft = null;
        await updateBroadcastStep(ctx, 'buttons');

        // Ensure buttons array is properly initialized
        if (!ctx.session.temp.broadcastData.buttons || !Array.isArray(ctx.session.temp.broadcastData.buttons)) {
          ctx.session.temp.broadcastData.buttons = buildDefaultBroadcastButtons(getLanguage(ctx));
        }
        await ctx.saveSession();

        await ctx.reply(
          `✅ *Texto editado guardado (ES)*\n\n${safeEditedText}`,
          { parse_mode: 'Markdown' },
        );
        await showBroadcastButtonsPicker(ctx);
      } catch (error) {
        logger.error('Error saving edited AI text (ES):', error);
        await ctx.reply('❌ Error al guardar. Intenta de nuevo.');
      }
      return;
    }

    // Broadcast flow - Spanish text and send
    if (ctx.session.temp?.broadcastStep === 'text_es') {
      try {
        const message = ctx.message.text;
        const target = ctx.session.temp.broadcastTarget;
        const broadcastData = ctx.session.temp.broadcastData;

        // Validate message length
        // Telegram caption limit is 1024 chars for media, 4096 for text-only
        // Use 1020 to leave room for the "📢 " prefix and safety margin
        const hasMedia = broadcastData.mediaFileId;
        const maxLength = hasMedia ? 1020 : 4000;
        const charCount = message.length;

        if (charCount > maxLength) {
          const excessChars = charCount - maxLength;
          await ctx.reply(
            `❌ *Mensaje demasiado largo*\n\n`
            + `📏 Tu mensaje: ${charCount} caracteres\n`
            + `📏 Límite máximo: ${maxLength} caracteres\n`
            + `⚠️ Exceso: ${excessChars} caracteres\n\n`
            + `${hasMedia ? '⚠️ *Nota:* Los mensajes con foto/video tienen un límite de 1024 caracteres en Telegram.\n\n' : ''}`
            + `Por favor acorta tu mensaje y envíalo de nuevo.`,
            { parse_mode: 'Markdown' },
          );
          return;
        }

        // Validate English text exists
        if (!broadcastData.textEn) {
          await ctx.reply('❌ Error: Falta el texto en inglés. Por favor inicia el broadcast de nuevo.');
          ctx.session.temp = {};
          await ctx.saveSession();
          return;
        }
        
        // Save Spanish text
        broadcastData.textEs = message;

        logger.info('Spanish text saved, transitioning to buttons step', {
          userId: ctx.from.id,
          hasTextEn: !!broadcastData.textEn,
          hasTextEs: !!broadcastData.textEs,
          currentStep: ctx.session.temp.broadcastStep
        });

        // DEFENSIVE FIX: Prevent step regression by tracking max completed step
        ctx.session.temp.maxCompletedStep = 'buttons';
        
        // Move to buttons step
        ctx.session.temp.broadcastStep = 'buttons';

        // Initialize buttons array with default buttons if not exists
        if (!broadcastData.buttons || !Array.isArray(broadcastData.buttons)) {
          broadcastData.buttons = buildDefaultBroadcastButtons(getLanguage(ctx));
        }

        await ctx.saveSession();

        logger.info('Session saved, showing button picker', {
          userId: ctx.from.id,
          broadcastStep: ctx.session.temp.broadcastStep,
          buttonCount: broadcastData.buttons?.length || 0
        });

        // Show button picker for next step
        try {
          await showBroadcastButtonsPicker(ctx);
          logger.info('Button picker displayed successfully', { userId: ctx.from.id });
        } catch (error) {
          logger.error('Error showing button picker:', {
            userId: ctx.from.id,
            error: error.message,
            stack: error.stack
          });
          await ctx.reply('❌ Error al mostrar el selector de botones. Por favor intenta de nuevo.');
        }
      } catch (error) {
        logger.error('Error sending broadcast:', error);
        await ctx.reply('❌ Error al enviar el broadcast. Por favor intenta de nuevo.');
      }
      return;
    }

    // Visual date/time picker - Custom time input handling
    if (ctx.session.temp?.schedulingStep === 'custom_time_input') {
      try {
        const input = ctx.message.text.trim();
        const lang = getLanguage(ctx);

        // Parse time - expecting format: HH:MM
        const timeMatch = input.match(/^(\d{1,2}):(\d{2})$/);
        if (!timeMatch) {
          await ctx.reply(
            lang === 'es'
              ? '❌ Formato inválido.\n\nUsa el formato: HH:MM (24 horas)\nEjemplo: 14:30'
              : '❌ Invalid format.\n\nUse format: HH:MM (24-hour)\nExample: 14:30'
          );
          return;
        }

        const hour = parseInt(timeMatch[1]);
        const minute = parseInt(timeMatch[2]);

        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
          await ctx.reply('❌ Hora inválida. La hora debe ser 00-23 y los minutos 00-59.');
          return;
        }

        // Get selected date from session
        const { selectedYear, selectedMonth, selectedDay } = ctx.session.temp;
        if (!selectedYear || selectedMonth === undefined || !selectedDay) {
          await ctx.reply('❌ Sesión expirada. Por favor selecciona la fecha de nuevo.');
          return;
        }

        // Create the scheduled date
        const scheduledDate = new Date(selectedYear, selectedMonth, selectedDay, hour, minute);

        // Validate it's in the future
        if (scheduledDate <= new Date()) {
          await ctx.reply('❌ La fecha/hora debe ser en el futuro.');
          return;
        }

        // Store in session and move to timezone selection
        ctx.session.temp.scheduledDate = scheduledDate.toISOString();
        ctx.session.temp.schedulingStep = 'selecting_timezone';
        if (!ctx.session.temp.timezone) {
          ctx.session.temp.timezone = 'America/Bogota';
        }
        await ctx.saveSession();

        if (ctx.session.temp.timezone) {
          const dateTimePicker = require('../../utils/dateTimePicker');
          const PREFIX = 'bcast_sched';
          const { text, keyboard } = dateTimePicker.getConfirmationView(
            scheduledDate,
            ctx.session.temp.timezone,
            lang,
            PREFIX,
          );
          await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        } else {
          // Show timezone selection
          const dateTimePicker = require('../../utils/dateTimePicker');
          const PREFIX = 'bcast_sched';

          const text = '🌍 *Zona Horaria*\n\n' +
              'Selecciona tu zona horaria:\n\n' +
              '⏰ La programación será en esta zona';

          await ctx.reply(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🌎 New York (EST)', `${PREFIX}_tz_America/New_York`)],
              [Markup.button.callback('🌎 Los Angeles (PST)', `${PREFIX}_tz_America/Los_Angeles`)],
              [Markup.button.callback('🌎 Mexico City (CST)', `${PREFIX}_tz_America/Mexico_City`)],
              [Markup.button.callback('🌎 Bogotá (COT)', `${PREFIX}_tz_America/Bogota`)],
              [Markup.button.callback('🌍 Madrid (CET)', `${PREFIX}_tz_Europe/Madrid`)],
              [Markup.button.callback('🌍 London (GMT)', `${PREFIX}_tz_Europe/London`)],
              [Markup.button.callback('🌏 UTC', `${PREFIX}_tz_UTC`)],
              [Markup.button.callback('◀️ Volver', `${PREFIX}_back_to_presets`)],
            ]),
          });
        }
      } catch (error) {
        logger.error('Error handling custom time input:', error);
        await ctx.reply('❌ Error processing time. Please try again.');
      }
      return;
    }

    // Broadcast schedule datetime handling (collect up to 12 scheduled times)
    if (ctx.session.temp?.broadcastStep === 'schedule_datetime') {
      try {
        const input = ctx.message.text;
        const scheduleCount = ctx.session.temp.scheduleCount || 1;
        const currentIndex = ctx.session.temp.currentScheduleIndex || 0;

        // Parse date/time - expecting format: YYYY-MM-DD HH:MM
        const dateMatch = input.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (!dateMatch) {
          await ctx.reply(
            '❌ Formato de fecha inválido.\n\n'
            + 'Usa el formato: YYYY-MM-DD HH:MM\n'
            + 'Ejemplo: 2025-01-20 15:30'
          );
          return;
        }

        const timezone = ctx.session.temp.timezone || 'UTC';
        const scheduledDate = new Date(input);
        if (scheduledDate <= new Date()) {
          await ctx.reply('❌ La fecha debe ser en el futuro.');
          return;
        }

        // Add to scheduled times array
        if (!ctx.session.temp.scheduledTimes) {
          ctx.session.temp.scheduledTimes = [];
        }
        ctx.session.temp.scheduledTimes.push(scheduledDate);
        ctx.session.temp.currentScheduleIndex = currentIndex + 1;
        await ctx.saveSession();

        // If we need more datetimes, ask for the next one
        if (currentIndex + 1 < scheduleCount) {
          await ctx.reply(
            `✅ Programación ${currentIndex + 1}/${scheduleCount} confirmada\n`
            + `📅 ${scheduledDate.toLocaleString('es-ES', { timeZone: timezone })} (${timezone})\n\n`
            + `📅 *Programación ${currentIndex + 2}/${scheduleCount}*\n\n`
            + `🌍 Zona horaria: ${timezone}\n\n`
            + 'Por favor envía la fecha y hora en el siguiente formato:\n\n'
            + '`YYYY-MM-DD HH:MM`\n\n'
            + '*Ejemplos:*\n'
            + '• `2025-12-15 14:30` (15 dic 2025, 2:30 PM)\n'
            + '• `2025-12-25 09:00` (25 dic 2025, 9:00 AM)',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // All datetimes collected - create broadcasts for each scheduled time
        const { broadcastTarget, broadcastData } = ctx.session.temp;

        if (!broadcastData || !broadcastData.textEn || !broadcastData.textEs) {
          await ctx.reply('❌ Error: Faltan datos del broadcast');
          return;
        }

        await ctx.reply(
          '📤 *Creando broadcasts programados...*\n\n'
          + `Generando ${scheduleCount} broadcast(s) programado(s)...`,
          { parse_mode: 'Markdown' }
        );

        const scheduledTimes = ctx.session.temp.scheduledTimes.map((time) => new Date(time));
        const { successCount, errorCount, broadcastIds } = await createScheduledBroadcastsFromTimes(
          ctx,
          scheduledTimes,
          timezone
        );

        // Store timezone before clearing (for result message)
        const savedTimezone = timezone;
        const savedScheduledTimes = [...ctx.session.temp.scheduledTimes];

        // Clear session data
        ctx.session.temp.broadcastTarget = null;
        ctx.session.temp.broadcastStep = null;
        ctx.session.temp.broadcastData = null;
        ctx.session.temp.scheduledTimes = null;
        ctx.session.temp.scheduleCount = null;
        ctx.session.temp.currentScheduleIndex = null;
        ctx.session.temp.timezone = null;
        ctx.session.temp.schedulingContext = null;
        await ctx.saveSession();

        // Show results
        let resultMessage = `✅ *Broadcasts Programados*\n\n`;
        resultMessage += `📊 *Resultados:*\n`;
        resultMessage += `✓ Creados: ${successCount}/${scheduleCount}\n`;
        if (errorCount > 0) {
          resultMessage += `✗ Errores: ${errorCount}\n`;
        }
        resultMessage += `\n🎯 Audiencia: ${formatBroadcastTargetLabel(broadcastTarget, 'es')}\n`;
        resultMessage += `🌍 Zona horaria: ${savedTimezone}\n`;
        resultMessage += `🌐 Mensajes bilingües: EN / ES\n`;
        resultMessage += `${broadcastData.mediaType ? `📎 Con media: ${broadcastData.mediaType}` : '📝 Solo texto'}\n`;
        resultMessage += `\n📅 *Programaciones:*\n`;

        savedScheduledTimes.forEach((time, idx) => {
          resultMessage += `${idx + 1}. ${time.toLocaleString('es-ES', { timeZone: savedTimezone })} (${savedTimezone})\n`;
        });

        resultMessage += `\n💡 Los broadcasts se enviarán automáticamente a la hora programada.`;

        await ctx.reply(
          resultMessage,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
            ]),
          }
        );

        logger.info('Broadcast scheduling completed', {
          adminId: ctx.from.id,
          totalSchedules: scheduleCount,
          successCount,
          errorCount,
          broadcastIds,
        });
      } catch (error) {
        logger.error('Error scheduling broadcasts:', error);
        await ctx.reply(
          '❌ *Error al programar broadcasts*\n\n'
          + `Detalles: ${error.message}`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    // Recurring broadcast start datetime handling
    if (ctx.session.temp?.broadcastStep === 'recurring_start_datetime') {
      try {
        const input = ctx.message.text;

        // Parse date/time - expecting format: YYYY-MM-DD HH:MM
        const dateMatch = input.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (!dateMatch) {
          await ctx.reply(
            '❌ Formato de fecha inválido.\n\n'
            + 'Usa el formato: YYYY-MM-DD HH:MM\n'
            + 'Ejemplo: 2025-01-20 15:30'
          );
          return;
        }

        // Parse date in the selected timezone
        const timezone = ctx.session.temp.timezone || 'UTC';
        const { broadcastTarget, broadcastData, recurrencePattern, maxOccurrences, cronExpression } = ctx.session.temp;
        const scheduledDate = new Date(input);

        if (scheduledDate <= new Date()) {
          await ctx.reply('❌ La fecha debe ser en el futuro.');
          return;
        }

        await ctx.reply(
          '📤 *Creando broadcast recurrente...*',
          { parse_mode: 'Markdown' }
        );

        const broadcast = await createRecurringBroadcastFromSchedule(ctx, scheduledDate);

        // Prepare labels before clearing session
        const patternLabel = recurrencePattern || 'custom';
        const maxLabel = maxOccurrences ? `${maxOccurrences} veces` : 'Sin límite';
        const cronInfo = cronExpression ? `\n⚙️ Cron: \`${cronExpression}\`` : '';

        // Clear session data
        ctx.session.temp.broadcastTarget = null;
        ctx.session.temp.broadcastStep = null;
        ctx.session.temp.broadcastData = null;
        ctx.session.temp.isRecurring = null;
        ctx.session.temp.recurrencePattern = null;
        ctx.session.temp.cronExpression = null;
        ctx.session.temp.maxOccurrences = null;
        ctx.session.temp.timezone = null;
        ctx.session.temp.schedulingContext = null;
        await ctx.saveSession();

        // Show confirmation
        await ctx.reply(
          `✅ *Broadcast Recurrente Creado*\n\n`
          + `🔄 Frecuencia: ${patternLabel}${cronInfo}\n`
          + `📊 Repeticiones: ${maxLabel}\n`
          + `📅 Primer envío: ${scheduledDate.toLocaleString('es-ES', { timeZone: timezone })} (${timezone})\n`
          + `🎯 Audiencia: ${formatBroadcastTargetLabel(broadcastTarget, 'es')}\n`
          + `🆔 ID: \`${broadcast.broadcast_id}\`\n`
          + `${broadcastData.mediaType ? `📎 Con media (${broadcastData.mediaType})` : '📝 Solo texto'}\n\n`
          + `💡 El broadcast se enviará automáticamente según la programación.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
            ]),
          }
        );

        logger.info('Recurring broadcast created', {
          broadcastId: broadcast.broadcast_id,
          adminId: ctx.from.id,
          pattern: recurrencePattern,
          cronExpression,
          maxOccurrences,
          scheduledAt: scheduledDate,
          timezone,
        });
      } catch (error) {
        logger.error('Error creating recurring broadcast:', error);
        await ctx.reply(
          '❌ *Error al crear broadcast recurrente*\n\n'
          + `Detalles: ${error.message}`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    // Custom cron expression handling
    if (ctx.session.temp?.broadcastStep === 'custom_cron_expression') {
      try {
        const input = ctx.message.text.trim();

        // Validate cron expression
        const cronParser = require('cron-parser');
        try {
          cronParser.parseExpression(input);
        } catch (cronError) {
          await ctx.reply(
            '❌ *Expresión cron inválida*\n\n'
            + `Error: ${cronError.message}\n\n`
            + 'Por favor usa el formato: `minuto hora día_mes mes día_semana`\n'
            + 'Ejemplo: `0 9 * * *` (todos los días a las 9 AM)',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        if (!ctx.session.temp) {
          ctx.session.temp = {};
        }

        ctx.session.temp.cronExpression = input;
        ctx.session.temp.broadcastStep = 'recurring_max_occurrences';
        await ctx.saveSession();

        await ctx.reply(
          `✅ *Expresión cron válida*: \`${input}\`\n\n`
          + '¿Cuántas veces debe repetirse?\n\n'
          + '♾️ *Sin límite:* Continúa indefinidamente\n'
          + '🔢 *Con límite:* Especifica número de repeticiones',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('♾️ Sin límite', 'recurring_max_unlimited')],
              [Markup.button.callback('5️⃣ 5 veces', 'recurring_max_5'), Markup.button.callback('🔟 10 veces', 'recurring_max_10')],
              [Markup.button.callback('2️⃣0️⃣ 20 veces', 'recurring_max_20'), Markup.button.callback('3️⃣0️⃣ 30 veces', 'recurring_max_30')],
              [Markup.button.callback('◀️ Volver', 'schedule_type_recurring')],
            ]),
          }
        );
      } catch (error) {
        logger.error('Error processing cron expression:', error);
        await ctx.reply(
          '❌ *Error al procesar expresión cron*\n\n'
          + `Detalles: ${error.message}`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    // Plan field editing
    if (ctx.session.temp?.editingPlanId && ctx.session.temp?.editingPlanField) {
      try {
        const planId = ctx.session.temp.editingPlanId;
        const field = ctx.session.temp.editingPlanField;
        const input = ctx.message.text;
        const plan = await PlanModel.getById(planId);

        if (!plan) {
          await ctx.reply('Plan no encontrado');
          ctx.session.temp.editingPlanId = null;
          ctx.session.temp.editingPlanField = null;
          await ctx.saveSession();
          return;
        }

        const planData = plan.dataValues ? plan.dataValues : plan;
        let updateData = { ...planData };
        let successMessage = '';

        switch (field) {
          case 'name': {
            // Parse format: EN: name\nES: name
            const lines = input.split('\n');
            let nameEn = plan.name;
            let nameEs = plan.nameEs;

            lines.forEach((line) => {
              if (line.startsWith('EN:')) {
                nameEn = line.substring(3).trim();
              } else if (line.startsWith('ES:')) {
                nameEs = line.substring(3).trim();
              }
            });

            updateData.name = nameEn;
            updateData.nameEs = nameEs;
            successMessage = `✅ Nombre actualizado:\nEN: ${nameEn}\nES: ${nameEs}`;
            break;
          }

          case 'price': {
            const price = parseFloat(input);
            if (Number.isNaN(price) || price < 0) {
              await ctx.reply('❌ Precio inválido. Por favor ingresa un número válido.');
              return;
            }
            updateData.price = price;
            successMessage = `✅ Precio actualizado: $${price}`;
            break;
          }

          case 'duration': {
            const duration = parseInt(input, 10);
            if (Number.isNaN(duration) || duration < 1) {
              await ctx.reply('❌ Duración inválida. Por favor ingresa un número de días válido.');
              return;
            }
            updateData.duration = duration;
            // Regenerate SKU with new duration
            updateData.sku = PlanModel.generateSKU(planId, duration);
            successMessage = `✅ Duración actualizada: ${duration} días\nSKU actualizado: ${updateData.sku}`;
            break;
          }

          case 'features': {
            // Parse format: EN:\n- feature1\n- feature2\nES:\n- feature1\n- feature2
            const sections = input.split(/EN:|ES:/i).filter((s) => s.trim());
            const featuresEn = [];
            const featuresEs = [];

            if (sections.length >= 1) {
              // First section is EN
              const enLines = sections[0].split('\n').filter((l) => l.trim().startsWith('-'));
              enLines.forEach((line) => {
                const feature = line.replace(/^-\s*/, '').trim();
                if (feature) featuresEn.push(feature);
              });
            }

            if (sections.length >= 2) {
              // Second section is ES
              const esLines = sections[1].split('\n').filter((l) => l.trim().startsWith('-'));
              esLines.forEach((line) => {
                const feature = line.replace(/^-\s*/, '').trim();
                if (feature) featuresEs.push(feature);
              });
            }

            if (featuresEn.length === 0 || featuresEs.length === 0) {
              await ctx.reply('❌ Formato inválido. Asegúrate de incluir características en ambos idiomas.');
              return;
            }

            updateData.features = featuresEn;
            updateData.featuresEs = featuresEs;
            successMessage = `✅ Características actualizadas:\nEN: ${featuresEn.length} características\nES: ${featuresEs.length} características`;
            break;
          }

          default:
            await ctx.reply('Campo desconocido');
            return;
        }

        // Update the plan
        await PlanModel.createOrUpdate(planId, updateData);

        // Clear editing state
        ctx.session.temp.editingPlanId = null;
        ctx.session.temp.editingPlanField = null;
        await ctx.saveSession();

        await ctx.reply(
          successMessage,
          Markup.inlineKeyboard([
            [Markup.button.callback('✏️ Editar Otro Campo', `admin_plan_edit_${planId}`)],
            [Markup.button.callback('👁️ Ver Detalles', `admin_plan_view_${planId}`)],
            [Markup.button.callback('◀️ Volver a Planes', 'admin_plans')],
          ]),
        );

        logger.info('Plan field updated by admin', {
          adminId: ctx.from.id,
          planId,
          field,
          newValue: updateData[field],
        });
      } catch (error) {
        logger.error('Error updating plan field:', error);
        await ctx.reply('Error al actualizar el plan');
      }
      return;
    }

    // Membership activation - User search
    if (ctx.session.temp?.activatingMembership && ctx.session.temp?.activationStep === 'search_user') {
      try {
        let userId = ctx.message.text.trim();

        // Extract numeric ID if user sent /user123456789 format
        const match = userId.match(/\/user(\d+)|(\d+)/);
        if (match) {
          userId = match[1] || match[2];
        }

        // Validate it's a number
        if (!/^\d+$/.test(userId)) {
          await ctx.reply('❌ ID inválido. Por favor envía un ID de Telegram válido (solo números).\n\nEjemplos válidos: `1541921361` o `/user1541921361`', { parse_mode: 'Markdown' });
          return;
        }

        const user = await UserModel.getById(userId);

        if (!user) {
          await ctx.reply(
            '❌ **Usuario no encontrado**\n\n' +
            `No se encontró ningún usuario con el ID: ${userId}\n\n` +
            '💡 Asegúrate de que el usuario haya iniciado el bot al menos una vez con /start',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        // Clear activation step
        ctx.session.temp.activationStep = null;
        await ctx.saveSession();

        // Show user info and type selection
        const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');
        let text = '✅ **Usuario Encontrado**\n\n';
        text += `👤 ${safeName}\n`;
        text += `🆔 ${userId}\n`;
        // Escape markdown special characters in email
        const emailDisplay = user.email ? user.email.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&') : 'Sin email';
        text += `📧 ${emailDisplay}\n`;
        text += `💎 Estado actual: ${user.subscriptionStatus || 'free'}\n`;
        if (user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date()) {
          text += `⏰ Expira: ${new Date(user.subscriptionExpiry).toLocaleDateString('es-ES')}\n`;
        }
        text += '\n¿Qué tipo de membresía deseas activar?\n';

        await ctx.reply(
          text,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('💎 Plan Existente', `admin_activate_type_${userId}_plan`)],
              [Markup.button.callback('🎁 Pase de Cortesía', `admin_activate_type_${userId}_courtesy`)],
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          },
        );
      } catch (error) {
        logger.error('Error searching user for activation:', error);
        await ctx.reply('❌ Error al buscar usuario. Por favor intenta de nuevo.');
      }
      return;
    }

    logger.info('[TEXT-HANDLER] No matching broadcast/admin condition found, passing to next handler', {
      userId: ctx.from.id,
      broadcastStep: ctx.session.temp?.broadcastStep,
      messageLength: (ctx.message.text || '').length
    });

    return next();
  });

  // Extend subscription - Show duration options
  bot.action('admin_extend_sub', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session.temp.selectedUserId;
      const lang = getLanguage(ctx);
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('Usuario no encontrado');
        return;
      }

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');
      let text = `📅 **Extender Membresía**\n\n`;
      text += `👤 ${safeName}\n`;
      text += `💎 Status: ${user.subscriptionStatus}\n`;
      if (user.subscriptionExpiry) {
        text += `⏰ Expira: ${new Date(user.subscriptionExpiry).toLocaleDateString()}\n`;
      }
      text += `\nSelecciona la duración de la extensión:\n`;

      await ctx.editMessageText(
        text,
        Markup.inlineKeyboard([
          [Markup.button.callback('📅 1 Semana', `admin_extend_duration_${userId}_7`)],
          [Markup.button.callback('📅 2 Semanas', `admin_extend_duration_${userId}_14`)],
          [Markup.button.callback('📅 1 Mes', `admin_extend_duration_${userId}_30`)],
          [Markup.button.callback('♾️ Lifetime', `admin_extend_duration_${userId}_lifetime`)],
          [Markup.button.callback('◀️ Volver', 'admin_cancel')],
        ]),
      );
    } catch (error) {
      logger.error('Error showing extension options:', error);
      await ctx.answerCbQuery('Error al mostrar opciones');
    }
  });

  // Handle extension duration selection
  bot.action(/^admin_extend_duration_(.+)_(7|14|30|lifetime)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.match[1];
      const duration = ctx.match[2];
      const lang = getLanguage(ctx);
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('Usuario no encontrado');
        return;
      }

      let newExpiry;
      let durationText;

      if (duration === 'lifetime') {
        // Lifetime subscription - no expiry
        newExpiry = null;
        durationText = 'Lifetime (sin vencimiento)';
      } else {
        // Calculate new expiry based on current expiry or now
        const baseDate = user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date()
          ? new Date(user.subscriptionExpiry)
          : new Date();

        newExpiry = new Date(baseDate);
        const days = parseInt(duration, 10);
        newExpiry.setDate(newExpiry.getDate() + days);

        if (days === 7) {
          durationText = '1 semana';
        } else if (days === 14) {
          durationText = '2 semanas';
        } else if (days === 30) {
          durationText = '1 mes';
        } else {
          durationText = `${days} días`;
        }
      }

      const planName = user.planId || 'premium';

      await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: planName,
        expiry: newExpiry,
      });

      // Send PRIME confirmation with invite link to user
      await PaymentService.sendPrimeConfirmation(userId, planName, newExpiry, 'admin-extend');

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');
      let successText = `✅ **Membresía Extendida**\n\n`;
      successText += `👤 Usuario: ${safeName}\n`;
      successText += `⏱️ Duración: ${durationText}\n`;
      if (newExpiry) {
        successText += `📅 Nueva fecha de vencimiento: ${newExpiry.toLocaleDateString()}\n`;
      } else {
        successText += `♾️ Membresía Lifetime activada\n`;
      }
      successText += `\n📨 Se envió confirmación con enlace PRIME al usuario`;

      await ctx.editMessageText(
        successText,
        Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Volver', 'admin_cancel')],
        ]),
      );

      logger.info('Subscription extended by admin', {
        adminId: ctx.from.id,
        userId,
        duration,
        newExpiry,
      });

      await ctx.answerCbQuery('✅ Membresía extendida exitosamente');
    } catch (error) {
      logger.error('Error extending subscription:', error);
      await ctx.answerCbQuery('Error al extender membresía');
    }
  });

  // Deactivate user
  bot.action('admin_deactivate', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session?.temp?.selectedUserId;
      const lang = getLanguage(ctx);

      if (!userId) {
        await ctx.editMessageText(
          '❌ No se encontró el usuario. Búscalo de nuevo desde 👥 Usuarios.',
          Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver', 'admin_cancel')],
          ]),
        );
        return;
      }

      await UserModel.updateSubscription(userId, {
        status: 'deactivated',
        planId: null,
        expiry: new Date(),
      });

      await ctx.editMessageText(
        `✅ Usuario ${userId} desactivado`,
        Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Volver', 'admin_cancel')],
        ]),
      );

      logger.info('User deactivated by admin', { adminId: ctx.from.id, userId });
    } catch (error) {
      logger.error('Error deactivating user:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Ban user - Show confirmation
  bot.action('admin_ban_user', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session.temp.selectedUserId;
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('Usuario no encontrado');
        return;
      }

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      await ctx.editMessageText(
        `⛔ **Confirmar Baneo**\n\n`
        + `👤 ${safeName}\n`
        + `🆔 ${userId}\n\n`
        + `⚠️ Esta acción impedirá que el usuario use el bot.\n\n`
        + `¿Estás seguro de que deseas banear a este usuario?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Sí, Banear', 'admin_ban_user_confirm')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error showing ban confirmation:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Ban user - Confirm
  bot.action('admin_ban_user_confirm', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session.temp.selectedUserId;
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('Usuario no encontrado');
        return;
      }

      // Ban user globally
      await ModerationModel.banUser(userId, 'global', 'Banned by admin', ctx.from.id);

      // Log the action
      await ModerationModel.addLog({
        groupId: 'global',
        action: 'ban',
        userId: userId,
        moderatorId: ctx.from.id.toString(),
        targetUserId: userId,
        reason: 'Banned by admin',
        details: { bannedBy: ctx.from.id },
      });

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      await ctx.editMessageText(
        `✅ **Usuario Baneado**\n\n`
        + `👤 ${safeName}\n`
        + `🆔 ${userId}\n\n`
        + `⛔ El usuario ya no puede usar el bot.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver al Panel', 'admin_cancel')],
          ]),
        },
      );

      logger.info('User banned by admin', { adminId: ctx.from.id, userId });
    } catch (error) {
      logger.error('Error banning user:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Unban user
  bot.action('admin_unban_user', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session.temp.selectedUserId;
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('Usuario no encontrado');
        return;
      }

      // Unban user globally
      await ModerationModel.unbanUser(userId, 'global');

      // Log the action
      await ModerationModel.addLog({
        groupId: 'global',
        action: 'unban',
        userId: userId,
        moderatorId: ctx.from.id.toString(),
        targetUserId: userId,
        reason: 'Unbanned by admin',
        details: { unbannedBy: ctx.from.id },
      });

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      await ctx.editMessageText(
        `✅ **Usuario Desbaneado**\n\n`
        + `👤 ${safeName}\n`
        + `🆔 ${userId}\n\n`
        + `El usuario puede volver a usar el bot.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver al Panel', 'admin_cancel')],
          ]),
        },
      );

      logger.info('User unbanned by admin', { adminId: ctx.from.id, userId });
    } catch (error) {
      logger.error('Error unbanning user:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Force age verification - Reset age verification to require re-verification
  bot.action('admin_force_age_verify', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session.temp.selectedUserId;
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('Usuario no encontrado');
        return;
      }

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      await ctx.editMessageText(
        `🔞 **Forzar Verificación de Edad**\n\n`
        + `👤 ${safeName}\n`
        + `🆔 ${userId}\n\n`
        + `⚠️ Esta acción resetea la verificación de edad del usuario.\n`
        + `El usuario deberá volver a verificar su edad con IA la próxima vez que intente acceder a contenido restringido.\n\n`
        + `Estado actual: ${user.ageVerified ? '✅ Verificado' : '❌ No verificado'}\n\n`
        + `¿Confirmar el reset de verificación?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Sí, Resetear', 'admin_force_age_verify_confirm')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error showing force age verify confirmation:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Force age verification - Confirm
  bot.action('admin_force_age_verify_confirm', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session.temp.selectedUserId;
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('Usuario no encontrado');
        return;
      }

      // Reset age verification - set to false with expired timestamp
      await UserModel.updateAgeVerification(userId, {
        verified: false,
        method: 'admin_reset',
        expiresHours: 0,
      });

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      await ctx.editMessageText(
        `✅ **Verificación de Edad Reseteada**\n\n`
        + `👤 ${safeName}\n`
        + `🆔 ${userId}\n\n`
        + `🔞 El usuario deberá volver a verificar su edad con IA para acceder a contenido restringido.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver al Panel', 'admin_cancel')],
          ]),
        },
      );

      logger.info('Age verification reset by admin', { adminId: ctx.from.id, userId });
    } catch (error) {
      logger.error('Error resetting age verification:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Change plan - Show available plans
  bot.action('admin_change_plan', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.session.temp.selectedUserId;
      const lang = getLanguage(ctx);
      const user = await UserModel.getById(userId);

      if (!user) {
        await ctx.answerCbQuery('User not found');
        return;
      }

      const plans = await PlanModel.getAdminPlans();

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');
      let text = `💎 **Cambiar Plan de Usuario**\n\n`;
      text += `👤 ${safeName}\n`;
      text += `📦 Plan Actual: ${user.planId || 'Ninguno'}\n`;
      text += `💎 Status: ${user.subscriptionStatus}\n\n`;
      text += `Selecciona el nuevo plan:\n`;

      const keyboard = [];

      // Add button for each plan
      plans.forEach((plan) => {
        keyboard.push([
          Markup.button.callback(
            `${plan.name} - $${plan.price}`,
            `admin_set_plan_${userId}_${plan.id}`,
          ),
        ]);
      });

      // Add option to set as free
      keyboard.push([Markup.button.callback('🆓 Plan Gratis', `admin_set_plan_${userId}_free`)]);
      keyboard.push([Markup.button.callback('◀️ Volver', 'admin_cancel')]);

      await ctx.editMessageText(text, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error showing plan change menu:', error);
    }
  });

  // Set plan for user
  bot.action(/^admin_set_plan_(.+)_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.match[1];
      const planId = ctx.match[2];
      const lang = getLanguage(ctx);

      const user = await UserModel.getById(userId);
      if (!user) {
        await ctx.answerCbQuery('User not found');
        return;
      }

      // Set new plan
      let newExpiry = null;
      let planName = 'Gratis';

      if (planId === 'free') {
        await UserModel.updateSubscription(userId, {
          status: 'free',
          planId: null,
          expiry: null,
        });
        // No PRIME confirmation for free plan
      } else {
        const plan = await PlanModel.getById(planId);
        if (!plan) {
          await ctx.answerCbQuery('Plan not found');
          return;
        }

        planName = plan.name || planId;

        // Set new expiry date based on plan duration
        newExpiry = new Date();
        const durationDays = plan.duration_days || plan.duration || 30;
        newExpiry.setDate(newExpiry.getDate() + durationDays);

        await UserModel.updateSubscription(userId, {
          status: 'active',
          planId,
          expiry: newExpiry,
        });

        // Send PRIME confirmation with invite link to user
        await PaymentService.sendPrimeConfirmation(userId, planName, newExpiry, 'admin-plan-change');
      }

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');
      let successMsg = `✅ Plan actualizado exitosamente\n\n`
        + `👤 Usuario: ${safeName}\n`
        + `💎 Nuevo Plan: ${planId === 'free' ? 'Gratis' : planName}\n`
        + `📅 Estado: ${planId === 'free' ? 'free' : 'active'}`;

      if (planId !== 'free') {
        successMsg += `\n\n📨 Se envió confirmación con enlace PRIME al usuario`;
      }

      await ctx.editMessageText(
        successMsg,
        Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Volver', 'admin_cancel')],
        ]),
      );

      logger.info('Plan changed by admin', { adminId: ctx.from.id, userId, newPlan: planId });
    } catch (error) {
      logger.error('Error changing user plan:', error);
      await ctx.answerCbQuery('Error al cambiar el plan');
    }
  });

  // ====== MANUAL MEMBERSHIP ACTIVATION ======

  // Start membership activation flow
  bot.action('admin_activate_membership', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const lang = getLanguage(ctx);

      // Clear any ongoing admin tasks
      ctx.session.temp = {
        activatingMembership: true,
        activationStep: 'search_user',
      };
      await ctx.saveSession();

      await ctx.editMessageText(
        '🎁 **Activar Membresía Manualmente**\n\n'
        + '👤 Por favor envía el **ID de Telegram** del usuario al que deseas activar la membresía.\n\n'
        + '💡 Puedes encontrar el ID pidiendo al usuario que use /start en el bot.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error starting membership activation:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Handle membership type selection
  bot.action(/^admin_activate_type_(.+)_(plan|courtesy)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.match[1];
      const type = ctx.match[2];

      const user = await UserModel.getById(userId);
      if (!user) {
        return;
      }

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      if (type === 'courtesy') {
        // Show courtesy pass options
        let text = '🎁 **Pase de Cortesía**\n\n';
        text += `👤 ${safeName}\n`;
        text += `🆔 ${userId}\n\n`;
        text += 'Selecciona la duración del pase de cortesía:';

        await ctx.editMessageText(
          text,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📅 2 Días', `admin_activate_courtesy_${userId}_2`)],
              [Markup.button.callback('📅 7 Días (1 Semana)', `admin_activate_courtesy_${userId}_7`)],
              [Markup.button.callback('📅 14 Días (2 Semanas)', `admin_activate_courtesy_${userId}_14`)],
              [Markup.button.callback('◀️ Volver', `admin_activate_select_type_${userId}`)],
            ]),
          },
        );
      } else {
        // Show available plans
        const plans = await PlanModel.getAdminPlans();

        let text = '💎 **Seleccionar Plan**\n\n';
        text += `👤 ${safeName}\n`;
        text += `🆔 ${userId}\n\n`;
        text += 'Selecciona el plan a activar:';

        const keyboard = [];

        // Add button for each active plan
        plans.filter((p) => p.active).forEach((plan) => {
          const lang = user.language || 'es';
          const planName = lang === 'es' ? (plan.nameEs || plan.name) : plan.name;
          keyboard.push([
            Markup.button.callback(
              `${planName} - $${plan.price} (${plan.duration} días)`,
              `admin_activate_plan_${userId}_${plan.id}`,
            ),
          ]);
        });

        keyboard.push([Markup.button.callback('◀️ Volver', `admin_activate_select_type_${userId}`)]);

        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(keyboard),
        });
      }
    } catch (error) {
      logger.error('Error showing membership type options:', error);
      await ctx.answerCbQuery('Error al mostrar opciones');
    }
  });

  // Activate courtesy pass
  bot.action(/^admin_activate_courtesy_(.+)_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.match[1];
      const days = parseInt(ctx.match[2], 10);

      const user = await UserModel.getById(userId);
      if (!user) {
        return;
      }

      // Calculate expiry date
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);

      // Activate subscription with courtesy pass plan
      await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: `courtesy_${days}d`,
        expiry: expiryDate,
      });

      // Record as PRIME sale (manual activation)
      try {
        await PaymentModel.create({
          userId,
          planId: `courtesy_${days}d`,
          provider: 'manual_activation',
          amount: 0, // Courtesy pass is free
          currency: 'USD',
          status: 'completed',
          metadata: {
            activatedBy: ctx.from.id,
            activationType: 'courtesy_pass',
            durationDays: days,
          },
        });
        logger.info('Payment record created for courtesy pass activation', {
          userId,
          days,
          activatedBy: ctx.from.id,
        });
      } catch (paymentError) {
        logger.warn('Failed to create payment record for courtesy pass, continuing', {
          userId,
          error: paymentError.message,
        });
      }

      const lang = user.language || 'es';
      const durationText = days === 2 ? '2 días' : days === 7 ? '1 semana (7 días)' : '2 semanas (14 días)';
      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      let successText = '✅ **Pase de Cortesía Activado**\n\n';
      successText += `👤 Usuario: ${safeName}\n`;
      successText += `🆔 ID: ${userId}\n`;
      successText += `🎁 Tipo: Pase de Cortesía\n`;
      successText += `⏱️ Duración: ${durationText}\n`;
      successText += `📅 Expira: ${expiryDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}\n`;
      successText += `💎 Estado: Activo\n\n`;
      successText += '📨 El usuario ha sido notificado por el bot.\n\n';
      successText += '💬 **¿Deseas enviar un mensaje personalizado al usuario?**';

      // Store activation details for potential message sending
      ctx.session.temp.lastActivation = {
        userId,
        activationType: 'courtesy',
        durationText,
        expiryDate: expiryDate.toISOString(),
      };
      await ctx.saveSession();

      await ctx.editMessageText(
        successText,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✏️ Enviar Mensaje', `admin_send_message_${userId}`)],
            [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
          ]),
        },
      );

      // Send notification to user via bot
      try {
        // Generate unique invite link for PRIME channel
        let inviteLink = 'https://t.me/PNPTV_PRIME'; // Fallback
        try {
          const groupId = process.env.PRIME_CHANNEL_ID || '-1002997324714';
          const response = await ctx.telegram.createChatInviteLink(groupId, {
            member_limit: 1,
            name: `CourtesyPass ${userId}_${Date.now()}`,
          });
          inviteLink = response.invite_link;
          logger.info('PRIME channel invite link created for courtesy pass', {
            userId,
            inviteLink,
            channelId: groupId,
          });
        } catch (linkError) {
          logger.warn('Failed to create PRIME channel invite link, using fallback', {
            userId,
            error: linkError.message,
          });
        }

        const welcomeMessage = lang === 'es'
          ? `🎉 **¡Membresía Activada!**\n\n` +
            `Has recibido un **pase de cortesía** de **${durationText}**.\n\n` +
            `✅ Tu membresía está activa hasta el **${expiryDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}**\n\n` +
            `🌟 **¡Bienvenido a PRIME!**\n\n` +
            `👉 Accede al canal exclusivo aquí:\n` +
            `[🔗 Ingresar a PRIME](${inviteLink})\n\n` +
            `💎 Disfruta de todo el contenido premium y beneficios exclusivos.\n\n` +
            `📱 Usa /menu para ver todas las funciones disponibles.`
          : `🎉 **Membership Activated!**\n\n` +
            `You have received a **courtesy pass** for **${days} days**.\n\n` +
            `✅ Your membership is active until **${expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}**\n\n` +
            `🌟 **Welcome to PRIME!**\n\n` +
            `👉 Access the exclusive channel here:\n` +
            `[🔗 Join PRIME](${inviteLink})\n\n` +
            `💎 Enjoy all premium content and exclusive benefits.\n\n` +
            `📱 Use /menu to see all available features.`;

        await ctx.telegram.sendMessage(userId, welcomeMessage, { parse_mode: 'Markdown', disable_web_page_preview: false });

        // Send PRIME main menu after activation message
        const { sendPrimeMenuToUser } = require('../user/menu');
        await sendPrimeMenuToUser(ctx.telegram, userId, lang);
      } catch (notifyError) {
        logger.warn('Could not notify user about courtesy pass', { userId, error: notifyError.message });
      }

      logger.info('Courtesy pass activated by admin', {
        adminId: ctx.from.id,
        userId,
        days,
        expiryDate,
      });
    } catch (error) {
      logger.error('Error activating courtesy pass:', error);
      try {
        await ctx.answerCbQuery('Error al activar pase de cortesía');
      } catch (cbError) {
        // Ignore callback query errors if it times out
      }
    }
  });

  // Activate specific plan
  bot.action(/^admin_activate_plan_(.+)_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.match[1];
      const planId = ctx.match[2];

      const user = await UserModel.getById(userId);
      if (!user) {
        return;
      }

      const plan = await PlanModel.getById(planId);
      if (!plan) {
        await ctx.answerCbQuery('Plan no encontrado');
        return;
      }

      // Calculate expiry date based on plan duration
      let expiryDate;
      const durationDays = plan.duration_days || plan.duration || 30;
      if (plan.isLifetime || plan.is_lifetime || durationDays >= 36500) {
        expiryDate = null; // Lifetime = no expiry
      } else {
        expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + durationDays);
      }

      // Activate subscription
      await UserModel.updateSubscription(userId, {
        status: 'active',
        planId: plan.id,
        expiry: expiryDate,
      });

      // Record as PRIME sale (manual activation)
      try {
        await PaymentModel.create({
          userId,
          planId: plan.id,
          provider: 'manual_activation',
          amount: plan.price || 0,
          currency: plan.currency || 'USD',
          status: 'completed',
          metadata: {
            activatedBy: ctx.from.id,
            activationType: 'plan_activation',
            planName: plan.name,
            duration: plan.duration,
            isLifetime: plan.isLifetime || false,
          },
        });
        logger.info('Payment record created for plan activation', {
          userId,
          planId: plan.id,
          amount: plan.price,
          activatedBy: ctx.from.id,
        });
      } catch (paymentError) {
        logger.warn('Failed to create payment record for plan activation, continuing', {
          userId,
          planId: plan.id,
          error: paymentError.message,
        });
      }

      const lang = user.language || 'es';
      const planName = lang === 'es' ? (plan.nameEs || plan.name) : plan.name;
      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');

      let successText = '✅ **Membresía Activada**\n\n';
      successText += `👤 Usuario: ${safeName}\n`;
      successText += `🆔 ID: ${userId}\n`;
      successText += `💎 Plan: ${planName}\n`;
      successText += `⏱️ Duración: ${plan.isLifetime || plan.duration >= 36500 ? 'Lifetime' : `${plan.duration} días`}\n`;
      if (expiryDate) {
        successText += `📅 Expira: ${expiryDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}\n`;
      } else {
        successText += `♾️ Sin vencimiento (Lifetime)\n`;
      }
      successText += `💰 Valor: $${plan.price} ${plan.currency}\n`;
      successText += `📊 Estado: Activo\n\n`;
      successText += '📨 El usuario ha sido notificado por el bot.\n\n';
      successText += '💬 **¿Deseas enviar un mensaje personalizado al usuario?**';

      // Store activation details for potential message sending
      ctx.session.temp.lastActivation = {
        userId,
        activationType: 'plan',
        planName,
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
      };
      await ctx.saveSession();

      await ctx.editMessageText(
        successText,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✏️ Enviar Mensaje', `admin_send_message_${userId}`)],
            [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
          ]),
        },
      );

      // Send notification to user via bot
      try {
        // Generate unique invite link for PRIME channel
        let inviteLink = 'https://t.me/PNPTV_PRIME'; // Fallback
        try {
          const groupId = process.env.PRIME_CHANNEL_ID || '-1002997324714';
          const response = await ctx.telegram.createChatInviteLink(groupId, {
            member_limit: 1,
            name: `Plan ${userId}_${Date.now()}`,
          });
          inviteLink = response.invite_link;
          logger.info('PRIME channel invite link created for plan activation', {
            userId,
            inviteLink,
            channelId: groupId,
          });
        } catch (linkError) {
          logger.warn('Failed to create PRIME channel invite link, using fallback', {
            userId,
            error: linkError.message,
          });
        }

        const durationText = plan.isLifetime || plan.duration >= 36500
          ? (lang === 'es' ? 'acceso de por vida' : 'lifetime access')
          : (lang === 'es' ? `${plan.duration} días` : `${plan.duration} days`);

        const expiryText = expiryDate
          ? (lang === 'es'
            ? `hasta el **${expiryDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}**`
            : `until **${expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}**`)
          : (lang === 'es' ? '**sin vencimiento**' : '**no expiration**');

        const welcomeMessage = lang === 'es'
          ? `🎉 **¡Membresía Activada!**\n\n` +
            `Has recibido el plan **${planName}** con ${durationText}.\n\n` +
            `✅ Tu membresía está activa ${expiryText}\n\n` +
            `🌟 **¡Bienvenido a PRIME!**\n\n` +
            `👉 Accede al canal exclusivo aquí:\n` +
            `[🔗 Ingresar a PRIME](${inviteLink})\n\n` +
            `💎 Disfruta de todo el contenido premium y beneficios exclusivos.\n\n` +
            `📱 Usa /menu para ver todas las funciones disponibles.`
          : `🎉 **Membership Activated!**\n\n` +
            `You have received the **${planName}** plan with ${durationText}.\n\n` +
            `✅ Your membership is active ${expiryText}\n\n` +
            `🌟 **Welcome to PRIME!**\n\n` +
            `👉 Access the exclusive channel here:\n` +
            `[🔗 Join PRIME](${inviteLink})\n\n` +
            `💎 Enjoy all premium content and exclusive benefits.\n\n` +
            `📱 Use /menu to see all available features.`;

        await ctx.telegram.sendMessage(userId, welcomeMessage, { parse_mode: 'Markdown', disable_web_page_preview: false });

        // Send PRIME main menu after activation message
        const { sendPrimeMenuToUser } = require('../user/menu');
        await sendPrimeMenuToUser(ctx.telegram, userId, lang);
      } catch (notifyError) {
        logger.warn('Could not notify user about plan activation', { userId, error: notifyError.message });
      }

      logger.info('Plan activated manually by admin', {
        adminId: ctx.from.id,
        userId,
        planId: plan.id,
        planName,
        duration: plan.duration,
        expiryDate,
      });
    } catch (error) {
      logger.error('Error activating plan:', error);
      try {
        await ctx.answerCbQuery('Error al activar membresía');
      } catch (cbError) {
        // Ignore callback query errors if it times out
      }
    }
  });

  // Handle send message button after activation
  bot.action(/^admin_send_message_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.match[1];
      const user = await UserModel.getById(userId);

      if (!user) {
        return;
      }

      // Set up session to capture message input
      ctx.session.temp.messageRecipientId = userId;
      ctx.session.temp.awaitingMessageInput = true;
      ctx.session.temp.awaitingMessagePromptId = null;
      await ctx.saveSession();

      const lang = user.language || 'es';
      const messagePrompt = lang === 'es'
        ? `📝 **Enviar Mensaje a ${user.firstName}**\n\nPor favor, escribe el mensaje que deseas enviar a este usuario. Usa /cancelar para salir.`
        : `📝 **Send Message to ${user.firstName}**\n\nPlease type the message you want to send to this user. Use /cancelar to cancel.`;

      const promptMessage = await ctx.reply(messagePrompt, { parse_mode: 'Markdown' });
      try {
        ctx.session.temp.awaitingMessagePromptId = promptMessage?.message_id || null;
        await ctx.saveSession();
      } catch (promptSaveError) {
        logger.warn('Could not store admin message prompt id', { error: promptSaveError.message });
      }
      try {
        await ctx.answerCbQuery('Escribe tu mensaje');
      } catch (cbError) {
        // Ignore callback query errors if it times out
      }
    } catch (error) {
      logger.error('Error handling send message action:', error);
      try {
        await ctx.answerCbQuery('Error al procesar solicitud');
      } catch (cbError) {
        // Ignore callback query errors if it times out
      }
    }
  });

  // Show type selection (plan or courtesy)
  bot.action(/^admin_activate_select_type_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;

      const userId = ctx.match[1];
      const user = await UserModel.getById(userId);

      if (!user) {
        return;
      }

      const safeName = sanitize.telegramMarkdown(user.firstName) + ' ' + sanitize.telegramMarkdown(user.lastName || '');
      let text = '🎁 **Activar Membresía**\n\n';
      text += `👤 ${safeName}\n`;
      text += `🆔 ${userId}\n`;
      text += `📧 ${user.email || 'Sin email'}\n`;
      text += `💎 Estado actual: ${user.subscriptionStatus || 'free'}\n`;
      if (user.subscriptionExpiry && new Date(user.subscriptionExpiry) > new Date()) {
        text += `⏰ Expira: ${new Date(user.subscriptionExpiry).toLocaleDateString('es-ES')}\n`;
      }
      text += '\n¿Qué tipo de membresía deseas activar?\n';

      await ctx.editMessageText(
        text,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💎 Plan Existente', `admin_activate_type_${userId}_plan`)],
            [Markup.button.callback('🎁 Pase de Cortesía', `admin_activate_type_${userId}_courtesy`)],
            [Markup.button.callback('◀️ Volver', 'admin_activate_membership')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error showing type selection:', error);
      await ctx.answerCbQuery('Error al mostrar opciones');
    }
  });
};

/**
 * Send broadcast with buttons
 */
async function sendBroadcastWithButtons(ctx, bot) {
  logger.info('Starting sendBroadcastWithButtons', { adminId: ctx.from.id });
  try {
    const { broadcastTarget, broadcastData } = ctx.session.temp;
    const { getLanguage } = require('../../utils/helpers');
    const emailService = require('../../../services/emailService');
    const lang = getLanguage(ctx);

    if (!broadcastData || (!broadcastData.textEn && !broadcastData.textEs)) {
      logger.error('Broadcast data missing', { broadcastData: !!broadcastData, textEn: !!broadcastData?.textEn, textEs: !!broadcastData?.textEs });
      await ctx.reply('❌ Error: Faltan datos del broadcast');
      return;
    }

    // Use available text, fallback to the other language if one is missing
    const textEn = broadcastData.textEn || broadcastData.textEs;
    const textEs = broadcastData.textEs || broadcastData.textEn;

    // Get admin ID to send completion notification
    const adminId = ctx.from.id;
    const sendEmail = broadcastData.sendEmail || false;

    // Get target users
    let users = [];
    if (broadcastTarget === 'all') {
      const result = await UserModel.getAll(10000);
      users = result.users;
    } else if (broadcastTarget === 'premium') {
      users = await UserModel.getBySubscriptionStatus('active');
    } else if (broadcastTarget === 'free') {
      users = await UserModel.getBySubscriptionStatus('free');
    } else if (broadcastTarget === 'churned') {
      users = await UserModel.getChurnedUsers();
    } else if (broadcastTarget === 'payment_incomplete') {
      const days = ctx.session.temp?.broadcastFilters?.paymentIncompleteDays ?? null;
      users = await UserModel.getUsersWithIncompletePayments({ sinceDays: days });
    }

    let sent = 0;
    let failed = 0;

    // Build button markup
    const buildButtonMarkup = (buttons, userLang) => {
      if (!buttons || buttons.length === 0) {
        return undefined; // No buttons
      }

      try {
        // If buttons is a JSON string, parse it
        let buttonArray = buttons;
        if (typeof buttons === 'string') {
          buttonArray = JSON.parse(buttons);
        }

        if (!Array.isArray(buttonArray) || buttonArray.length === 0) {
          return undefined;
        }

        const buttonRows = [];
        for (const btn of buttonArray) {
          const buttonObj = typeof btn === 'string' ? JSON.parse(btn) : btn;

          // Validate button object structure
          if (!buttonObj || typeof buttonObj !== 'object') {
            logger.warn('Invalid button object structure:', buttonObj);
            continue;
          }

          if (buttonObj.type === 'url') {
            if (buttonObj.text && buttonObj.target) {
              buttonRows.push([Markup.button.url(buttonObj.text, buttonObj.target)]);
            }
          } else if (buttonObj.type === 'callback') {
            if (buttonObj.text && buttonObj.data) {
              buttonRows.push([Markup.button.callback(buttonObj.text, buttonObj.data)]);
            }
          } else if (buttonObj.type === 'command') {
            if (buttonObj.text && buttonObj.target) {
              buttonRows.push([Markup.button.callback(buttonObj.text, `broadcast_action_${buttonObj.target}`)]);
            }
          } else if (buttonObj.type === 'plan') {
            if (buttonObj.text && buttonObj.target) {
              buttonRows.push([Markup.button.callback(buttonObj.text, `broadcast_plan_${buttonObj.target}`)]);
            }
          } else if (buttonObj.type === 'feature') {
            if (buttonObj.text && buttonObj.target) {
              buttonRows.push([Markup.button.callback(buttonObj.text, `broadcast_feature_${buttonObj.target}`)]);
            }
          }
        }

        return buttonRows.length > 0 ? Markup.inlineKeyboard(buttonRows) : undefined;
      } catch (error) {
        logger.warn('Error building button markup:', error);
        return undefined;
      }
    };

    // Send to each user
    for (const user of users) {
      try {
        const userLang = user.language || 'en';
        const textToSend = userLang === 'es' ? textEs : textEn;
        const buttonMarkup = buildButtonMarkup(broadcastData.buttons, userLang);

        // Send with media if available
        if (broadcastData.mediaType && broadcastData.mediaFileId) {
          const sendMethod = {
            photo: 'sendPhoto',
            video: 'sendVideo',
            document: 'sendDocument',
          }[broadcastData.mediaType];

          if (sendMethod) {
            const options = {
              caption: `📢 ${textToSend}`,
              parse_mode: 'Markdown',
            };
            if (buttonMarkup) {
              options.reply_markup = buttonMarkup.reply_markup;
            }

            await ctx.telegram[sendMethod](user.id, broadcastData.mediaFileId, options);
          }
        } else {
          // Text only
          const options = {
            parse_mode: 'Markdown',
          };
          if (buttonMarkup) {
            options.reply_markup = buttonMarkup.reply_markup;
          }

          await ctx.telegram.sendMessage(user.id, `📢 ${textToSend}`, options);
        }

        sent++;
      } catch (error) {
        failed++;
        const errorMsg = error.message || '';

        if (errorMsg.includes('bot was blocked') || errorMsg.includes('user is deactivated') || errorMsg.includes('chat not found')) {
          logger.debug('User unavailable for broadcast:', { userId: user.id });
        } else {
          logger.warn('Failed to send broadcast to user:', { userId: user.id, error: errorMsg });
        }
      }
    }

    // Send emails if enabled
    let emailSent = 0;
    let emailFailed = 0;

    if (sendEmail) {
      try {
        // Filter users with valid emails
        const usersWithEmail = users.filter(u => u.email && emailService.isEmailSafe(u.email));
        logger.info('Email broadcast stats', {
          totalUsers: users.length,
          usersWithEmail: usersWithEmail.length,
          usersWithoutEmail: users.length - usersWithEmail.length,
        });

        logger.info('Starting email broadcast', {
          totalUsers: usersWithEmail.length,
          adminId
        });

        const emailResult = await emailService.sendBroadcastEmails(usersWithEmail, {
          messageEn: textEn,
          messageEs: textEs,
          mediaUrl: broadcastData.mediaUrl || null,
          buttons: broadcastData.buttons || [],
          subjectEn: broadcastData.emailSubjectEn || null,
          subjectEs: broadcastData.emailSubjectEs || null,
          preheaderEn: broadcastData.emailPreheaderEn || null,
          preheaderEs: broadcastData.emailPreheaderEs || null
        });

        emailSent = emailResult.sent;
        emailFailed = emailResult.failed;

        logger.info('Email broadcast completed', {
          sent: emailSent,
          failed: emailFailed,
          adminId
        });
      } catch (emailError) {
        logger.error('Error sending broadcast emails:', emailError);
      }
    }

    // Clear broadcast session data
    ctx.session.temp.broadcastTarget = null;
    ctx.session.temp.broadcastStep = null;
    ctx.session.temp.broadcastData = null;
    await ctx.saveSession();

    // Show results - send notification to admin
    const buttonInfo = broadcastData.buttons && broadcastData.buttons.length > 0
      ? `\n🔘 Botones: ${Array.isArray(broadcastData.buttons) ? broadcastData.buttons.length : JSON.parse(broadcastData.buttons).length}`
      : '';

    const emailInfo = sendEmail
      ? `\n\n📧 *Email:*\n✓ Enviados: ${emailSent}\n✗ Fallidos: ${emailFailed}`
      : '';

    await bot.telegram.sendMessage(
      adminId,
      `✅ *Broadcast Completado*\n\n`
      + `📱 *Telegram:*\n`
      + `✓ Enviados: ${sent}\n`
      + `✗ Fallidos: ${failed}\n`
      + `📈 Total intentos: ${sent + failed}\n`
      + `🎯 Audiencia: ${formatBroadcastTargetLabel(broadcastTarget, lang)}\n`
      + `🌐 Mensajes bilingües: EN / ES`
      + buttonInfo
      + emailInfo,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Volver al Panel Admin', 'admin_cancel')],
        ]),
      }
    );

    logger.info('Broadcast with buttons sent', {
      adminId: ctx.from.id,
      sent,
      failed,
      buttons: broadcastData.buttons ? (Array.isArray(broadcastData.buttons) ? broadcastData.buttons.length : JSON.parse(broadcastData.buttons).length) : 0,
    });
  } catch (error) {
    logger.error('Error sending broadcast with buttons:', error);
    // Try to notify admin of error
    try {
      const adminId = ctx.from?.id;
      if (adminId && bot) {
        await bot.telegram.sendMessage(
          adminId,
          '❌ *Error al Enviar Broadcast*\n\n'
          + 'Ocurrió un error durante el envío del broadcast.\n\n'
          + 'Por favor revisa los logs o intenta de nuevo.',
          { parse_mode: 'Markdown' }
        );
      }
    } catch (notifyError) {
      logger.error('Failed to notify admin of broadcast error:', notifyError);
    }
  }
}

// Import and register audio management handlers
const registerAudioManagementHandlers = require('./audioManagement');
const registerDateTimePickerHandlers = require('./dateTimePickerHandlers');
const registerNearbyPlacesAdminHandlers = require('./nearbyPlacesAdmin');
const registerEnhancedBusinessAdminHandlers = require('./enhancedBusinessAdmin');
const ChatCleanupService = require('../../services/chatCleanupService');

// Group cleanup command for admins
const registerGroupCleanupCommand = (bot) => {
  bot.command('cleanupcommunity', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.reply(t('unauthorized', getLanguage(ctx)));
        return;
      }

      const lang = getLanguage(ctx);
      const groupId = process.env.GROUP_ID || '-1003291737499';

      // Send status message
      const statusMsg = await ctx.reply(
        lang === 'es'
          ? '🧹 Limpiando mensajes del bot en la comunidad...\n\n⚠️ Nota: Solo se eliminan mensajes del bot\n✨ Las fotos y videos del Muro de la Fama NO se eliminan NUNCA'
          : '🧹 Cleaning bot messages in community...\n\n⚠️ Note: Only bot messages are deleted\n✨ Wall of Fame photos and videos are NEVER deleted'
      );

      try {
        // Get the Telegram instance
        const telegram = ctx.telegram;

        // Delete all previous bot messages except the status message itself
        const deletedCount = await ChatCleanupService.deleteAllPreviousBotMessages(
          telegram,
          groupId,
          statusMsg.message_id // Keep only the most recent message (this one)
        );

        // Build detailed results message
        const detailedResults = lang === 'es'
          ? `✅ Limpieza completada\n\n📊 Estadísticas:\n• Mensajes del bot eliminados: ${deletedCount}\n• Mensaje actual: ✨ Conservado (más reciente)\n\n🛡️ Excepciones:\n• Muro de la Fama: NUNCA se eliminan ♾️\n• Fotos/Videos: Permanentes en el Muro ♾️\n• Solo mensajes del bot anterior: Eliminados`
          : `✅ Cleanup completed\n\n📊 Statistics:\n• Bot messages deleted: ${deletedCount}\n• Current message: ✨ Kept (most recent)\n\n🛡️ Exceptions:\n• Wall of Fame: NEVER deleted ♾️\n• Photos/Videos: Permanent on Wall ♾️\n• Only previous bot messages: Deleted`;

        // Update status message with results
        await ctx.telegram.editMessageText(
          groupId,
          statusMsg.message_id,
          undefined,
          detailedResults
        );

        // Also send confirmation to admin
        await ctx.reply(
          lang === 'es'
            ? `✅ Limpieza completada exitosamente\n\n📊 Mensajes eliminados: ${deletedCount}\n\n🔐 Regla de Eliminación:\n✅ Se eliminan: Todos los mensajes previos del bot\n✨ Se conservan: Solo el mensaje más reciente\n♾️ NUNCA se eliminan: Fotos/Videos del Muro de la Fama`
            : `✅ Cleanup completed successfully\n\n📊 Messages deleted: ${deletedCount}\n\n🔐 Deletion Rule:\n✅ Deleted: All previous bot messages\n✨ Kept: Only the most recent message\n♾️ NEVER deleted: Wall of Fame photos/videos`
        );

        logger.info('Group cleanup completed', {
          groupId,
          deletedCount,
          keptMessage: statusMsg.message_id,
          rule: 'Only previous bot messages deleted, keep most recent, Wall of Fame forever',
        });
      } catch (cleanupError) {
        logger.error('Error during cleanup:', cleanupError);
        await ctx.telegram.editMessageText(
          groupId,
          statusMsg.message_id,
          undefined,
          lang === 'es'
            ? '❌ Error durante la limpieza'
            : '❌ Error during cleanup'
        );
        await ctx.reply(
          lang === 'es'
            ? '❌ Error al limpiar los mensajes'
            : '❌ Error cleaning messages'
        );
      }
    } catch (error) {
      logger.error('Error in cleanupcommunity command:', error);
      await ctx.reply('❌ ' + (getLanguage(ctx) === 'es' ? 'Error en el comando' : 'Command error')).catch(() => {});
    }
  });

  /**
   * Send PRIME channel invite links to all active users
   * Usage: /send_prime_links
   */
  bot.command('send_prime_links', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const isAdmin = await PermissionService.isAdmin(userId);

      if (!isAdmin) {
        logger.warn(`Unauthorized send_prime_links attempt from user ${userId}`);
        await ctx.reply(getLanguage(ctx) === 'es' ? '❌ No autorizado' : '❌ Unauthorized');
        return;
      }

      const lang = getLanguage(ctx);
      await handleSendPrimeLinks(ctx, lang, ctx.telegram);
    } catch (error) {
      logger.error('Error in send_prime_links command:', error);
      await ctx.reply(
        getLanguage(ctx) === 'es'
          ? '❌ Error procesando comando'
          : '❌ Error processing command'
      ).catch(() => {});
    }
  });
};

/**
 * Handle sending PRIME channel invite links to all active users
 */
async function handleSendPrimeLinks(ctx, lang, telegram) {
  try {
    const statusMsg = await ctx.reply(
      lang === 'es'
        ? '⏳ Obteniendo usuarios activos...'
        : '⏳ Fetching active users...'
    );

    // Get all active users
    const activeUsers = await UserModel.getBySubscriptionStatus('active');
    logger.info(`Found ${activeUsers.length} active users to send PRIME links to`);

    if (activeUsers.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        lang === 'es'
          ? '❌ No hay usuarios activos'
          : '❌ No active users found'
      );
      return;
    }

    const groupId = process.env.PRIME_CHANNEL_ID || '-1002997324714';
    let sentCount = 0;
    let failedCount = 0;
    let blockedCount = 0;

    logger.info('Using PRIME channel ID for invite links', { channelId: groupId });

    // Send to each user
    for (let i = 0; i < activeUsers.length; i++) {
      const user = activeUsers[i];

      try {
        // Generate unique invite link for PRIME channel
        let inviteLink = 'https://t.me/PNPTV_PRIME'; // Fallback
        try {
          const response = await telegram.createChatInviteLink(groupId, {
            member_limit: 1,
            name: `PrimeLink ${user.id}_${Date.now()}`,
          });
          inviteLink = response.invite_link;
        } catch (linkError) {
          logger.warn('Failed to create invite link for user, using fallback', {
            userId: user.id,
            error: linkError.message,
          });
        }

        // Determine user language
        const userLang = user.language || 'es';

        // Build message
        const message = userLang === 'es'
          ? `🌟 *¡Acceso a PRIME Disponible!*\n\n` +
            `Hola ${user.firstName || 'Usuario'}! 👋\n\n` +
            `Te enviamos el enlace directo para acceder al canal exclusivo PRIME:\n\n` +
            `👉 [🔗 Ingresar a PRIME](${inviteLink})\n\n` +
            `✨ Disfruta de todo el contenido premium y beneficios exclusivos.\n\n` +
            `💎 *Beneficios PRIME:*\n` +
            `• Acceso a contenido exclusivo\n` +
            `• Videollamadas premium\n` +
            `• Transmisiones en vivo\n` +
            `• Comunidad privada\n\n` +
            `📱 Usa /menu para ver todas las funciones.`
          : `🌟 *PRIME Access Available!*\n\n` +
            `Hi ${user.firstName || 'User'}! 👋\n\n` +
            `We sent you the direct link to access the exclusive PRIME channel:\n\n` +
            `👉 [🔗 Join PRIME](${inviteLink})\n\n` +
            `✨ Enjoy all premium content and exclusive benefits.\n\n` +
            `💎 *PRIME Benefits:*\n` +
            `• Access to exclusive content\n` +
            `• Premium video calls\n` +
            `• Live streams\n` +
            `• Private community\n\n` +
            `📱 Use /menu to see all features.`;

        // Send message to user
        await telegram.sendMessage(user.id, message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
        });

        sentCount++;
        logger.info(`PRIME link sent to user ${user.id}`, { username: user.username });
      } catch (userError) {
        const errorMsg = userError?.response?.description || userError?.message || '';

        if (errorMsg.includes('blocked by the user') || errorMsg.includes('bot was blocked')) {
          blockedCount++;
          logger.warn(`User ${user.id} has blocked the bot`);
        } else {
          failedCount++;
          logger.warn(`Failed to send PRIME link to user ${user.id}`, {
            error: errorMsg,
          });
        }
      }

      // Update progress every 10 users
      if ((i + 1) % 10 === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          lang === 'es'
            ? `📤 Enviando enlaces PRIME...\n\n📊 Progreso: ${i + 1}/${activeUsers.length}\n✅ Enviados: ${sentCount}\n❌ Fallidos: ${failedCount}\n🚫 Bloqueados: ${blockedCount}`
            : `�� Sending PRIME links...\n\n📊 Progress: ${i + 1}/${activeUsers.length}\n✅ Sent: ${sentCount}\n❌ Failed: ${failedCount}\n🚫 Blocked: ${blockedCount}`
        );
      }

      // Add small delay between sends to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 80));
    }

    // Final update
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      lang === 'es'
        ? `✅ *Envío Completado*\n\n📊 *Estadísticas:*\n✅ Enviados: ${sentCount}/${activeUsers.length}\n❌ Fallidos: ${failedCount}\n🚫 Bloqueados: ${blockedCount}\n\n🎉 ¡Enlaces PRIME enviados a todos los usuarios activos!`
        : `✅ *Sending Complete*\n\n📊 *Statistics:*\n✅ Sent: ${sentCount}/${activeUsers.length}\n❌ Failed: ${failedCount}\n🚫 Blocked: ${blockedCount}\n\n🎉 PRIME links sent to all active users!`
    );

    logger.info('PRIME links broadcast completed', {
      totalUsers: activeUsers.length,
      sentCount,
      failedCount,
      blockedCount,
    });
  } catch (error) {
    logger.error('Error in handleSendPrimeLinks:', error);
    await ctx.reply(
      lang === 'es'
        ? '❌ Error al enviar los enlaces PRIME'
        : '❌ Error sending PRIME links'
    ).catch(() => {});
  }
}

// After registerAdminHandlers is defined, wrap it to add additional handlers
const wrappedRegisterAdminHandlers = registerAdminHandlers;

// Add broadcast button action handlers
const addBroadcastButtonHandlers = (bot) => {
  // Handle broadcast action buttons (command type)
  bot.action(/^broadcast_action_(\S+)$/, async (ctx) => {
    try {
      const action = ctx.match[1]; // Extract the action from callback data
      const lang = ctx.session?.language || 'en';
      
      // Map broadcast actions to actual callback handlers
      const actionMapping = {
        '/plans': 'show_subscription_plans',
        '/support': 'support',
        '/share': 'share',
        '/features': 'features',
        '/nearby': 'menu_nearby',
        '/profile': 'show_profile'
      };
      
      const targetAction = actionMapping[action];
      
      if (targetAction) {
        // For most actions, redirect to main menu where these are available
        // This is the safest approach that won't break existing functionality
        await ctx.answerCbQuery();

        // Show a helpful message
        const messages = {
          'show_subscription_plans': '💎 Abriendo planes de membresía...',
          'menu_nearby': '📍 Mostrando usuarios cercanos...',
          'show_profile': '👤 Abriendo tu perfil...',
          'support': '💬 Abriendo soporte...',
          'share': '📢 Abriendo opciones para compartir...',
          'features': '✨ Mostrando todas las funciones...'
        };

        await ctx.reply(messages[targetAction] || '💡 Abriendo función solicitada...');
        
        // Enter main menu where all these features are accessible
        await ctx.scene.enter('main_menu');
      } else {
        await ctx.answerCbQuery('❌ Acción no soportada');
      }
    } catch (error) {
      logger.error('Error handling broadcast action:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Handle broadcast plan buttons
  bot.action(/^broadcast_plan_(\S+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      // Show message and redirect to main menu where plans are accessible
      await ctx.reply('💎 Abriendo planes de membresía...');
      await ctx.scene.enter('main_menu');
    } catch (error) {
      logger.error('Error handling broadcast plan:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Handle broadcast feature buttons
  bot.action(/^broadcast_feature_(\S+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();

      // Show message and redirect to main menu where features are accessible
      await ctx.reply('✨ Mostrando todas las funciones...');
      await ctx.scene.enter('main_menu');
    } catch (error) {
      logger.error('Error handling broadcast feature:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Handle back buttons
  bot.action(/^broadcast_back_(\S+)$/, async (ctx) => {
    try {
      const targetScene = ctx.match[1]; // Extract the target scene
      const lang = ctx.session?.language || 'en';
      
      await ctx.answerCbQuery();
      
      // Go back to the specified scene
      await ctx.scene.enter(targetScene);
    } catch (error) {
      logger.error('Error handling broadcast back button:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
};

// Register Playlist Admin handlers
const registerPlaylistAdminHandlers = (bot) => {
  const playlistAdminService = new PlaylistAdminService(bot);

  // Command to create playlist
  bot.command('createplaylist', async (ctx) => {
    try {
      const userId = ctx.from.id;
      if (!PermissionService.isEnvSuperAdmin(userId) && !PermissionService.isEnvAdmin(userId)) {
        await ctx.reply('This command is only available to admins.');
        return;
      }
      await playlistAdminService.startPlaylistCreation(ctx);
    } catch (error) {
      logger.error('Error in /createplaylist command:', error);
      await ctx.reply('Failed to start playlist creation.');
    }
  });

  // Handle playlist callbacks
  bot.action(/^playlist_(create|category|visibility|add_more|done|confirm|cancel|select_media):?.*/, async (ctx) => {
    try {
      await playlistAdminService.handleCallbackQuery(ctx);
    } catch (error) {
      logger.error('Error in playlist callback:', error);
    }
  });

  logger.info('Playlist admin handlers registered');
};

// Register Radio Admin handlers
const registerRadioAdminHandlers = (bot) => {
  const radioAdminService = new RadioAdminService(bot);

  // Command to manage radio
  bot.command('radioadmin', async (ctx) => {
    try {
      const userId = ctx.from.id;
      if (!PermissionService.isEnvSuperAdmin(userId) && !PermissionService.isEnvAdmin(userId)) {
        await ctx.reply('This command is only available to admins.');
        return;
      }
      await radioAdminService.showRadioAdminMenu(ctx);
    } catch (error) {
      logger.error('Error in /radioadmin command:', error);
      await ctx.reply('Failed to open radio admin.');
    }
  });

  // Handle radio admin callbacks
  bot.action(/^radio_(admin|action):.*/, async (ctx) => {
    try {
      await radioAdminService.handleCallbackQuery(ctx);
    } catch (error) {
      logger.error('Error in radio callback:', error);
    }
  });

  logger.info('Radio admin handlers registered');
};

// Create wrapper function that also registers audio management and group cleanup
const finalRegisterAdminHandlers = (bot) => {
  wrappedRegisterAdminHandlers(bot);
  registerBroadcastHandlers(bot);
  registerAudioManagementHandlers(bot);
  registerDateTimePickerHandlers(bot);
  registerNearbyPlacesAdminHandlers(bot);
  registerEnhancedBusinessAdminHandlers(bot);
  registerGroupCleanupCommand(bot);
  addBroadcastButtonHandlers(bot);
  registerPlaylistAdminHandlers(bot);
  registerRadioAdminHandlers(bot);
  registerUserManagementHandlers(bot);
  XFollowersManagement.registerHandlers(bot);
};

module.exports = finalRegisterAdminHandlers;
module.exports.showAdminPanel = showAdminPanel;
