/**
 * Improved Share Post to Channel/Group Handler
 * Multi-step wizard for creating and scheduling posts with media, text, and buttons
 * Based on broadcast feature structure but simplified for channel/group posting
 */

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const communityPostService = require('../../../services/communityPostService');
const PermissionService = require('../../../services/permissionService');
const { getLanguage } = require('../../utils/helpers');
const GrokService = require('../../../services/grokService');
const broadcastUtils = require('../../utils/broadcastUtils');
const performanceUtils = require('../../utils/performanceUtils');
const uxUtils = require('../../utils/uxUtils');
const XPostService = require('../../../services/xPostService');
const { registerXAccountHandlers } = require('./xAccountWizard');
const dateTimePicker = require('../../utils/dateTimePicker');

// Use shared utilities
const {
  getStandardButtonOptions,
  normalizeButtons,
  buildInlineKeyboard,
  buildPostCaption
} = broadcastUtils;

function getSharePostButtonOptions() {
  return getStandardButtonOptions();
}

/**
 * Build X post text with deep links from buttons
 * @param {string} text - Original post text
 * @param {Array} buttons - Button configurations
 * @returns {string} Text with deep links appended
 */
function buildXTextWithDeepLinks(text, buttons) {
  const normalized = normalizeButtons(buttons);
  if (!normalized.length) return text;

  // Filter buttons that have deep links (t.me URLs)
  const deepLinkButtons = normalized.filter(btn => {
    const b = typeof btn === 'string' ? JSON.parse(btn) : btn;
    return b.type === 'url' && b.target && b.target.includes('t.me/');
  });

  if (!deepLinkButtons.length) return text;

  // Build the links section
  const links = deepLinkButtons.map(btn => {
    const b = typeof btn === 'string' ? JSON.parse(btn) : btn;
    // Clean the button text (remove emojis for cleaner X post)
    const cleanText = b.text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
    return `${cleanText}: ${b.target}`;
  });

  // Append links to text (X has 280 char limit, so be concise)
  const linkSection = '\n\n🔗 ' + links.join('\n🔗 ');
  return text + linkSection;
}

/**
 * Register improved share post handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerImprovedSharePostHandlers = (bot) => {
  registerXAccountHandlers(bot, {
    sessionKey: 'sharePostData',
    actionPrefix: 'share_post',
    backAction: 'share_post_preview',
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Main entry point - Show channel/group selection
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('admin_improved_share_post', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      if (!ctx.session.temp) ctx.session.temp = {};

      // Initialize session data
      ctx.session.temp.sharePostStep = 'select_destinations';
      ctx.session.temp.sharePostData = {
        destinations: [], // Array of {chatId, threadId, name}
        mediaType: null,
        mediaFileId: null,
        fileSizeMB: 0,
        text: '',
        buttons: [getSharePostButtonOptions()[0]], // default: home button only
        scheduledAt: null,
        isScheduled: false,
        postToX: false,
        xAccountId: null,
        xAccountHandle: null,
        xAccountDisplayName: null,
        includeLex: false,
        includeSantino: false
      };
      await ctx.saveSession();

      await ctx.answerCbQuery();

      // Hardcoded destinations - Prime Channel and Community Group topics
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error in improved share post entry:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DESTINATION CONFIGURATION - From environment variables
  // ═══════════════════════════════════════════════════════════════════════════

  // Parse topic IDs from env (handles both numeric and URL format like t.me/c/xxx/2)
  const parseTopicId = (value) => {
    if (!value) return null;
    const str = String(value);
    // If it's already numeric, parse directly
    if (/^\d+$/.test(str)) {
      return parseInt(str);
    }
    // Otherwise extract from URL format
    const parsed = parseInt(str.replace(/.*\//, ''));
    return isNaN(parsed) ? null : parsed;
  };

  // Available destinations - dynamically configured from env
  const SHARE_DESTINATIONS = [
    { id: 'prime', chatId: process.env.PRIME_CHANNEL_ID, threadId: null, name: '💎 Prime Channel', type: 'channel' },
    { id: 'community', chatId: process.env.GROUP_ID, threadId: null, name: '👥 Community (General)', type: 'group' },
    { id: 'news', chatId: process.env.GROUP_ID, threadId: 5525, name: '📰 PNP Latino News', type: 'topic' },
    { id: 'walloffame', chatId: process.env.GROUP_ID, threadId: parseTopicId(process.env.WALL_OF_FAME_TOPIC_ID), name: '🏆 Wall Of Fame', type: 'topic' },
  ].filter(d => d && d.chatId);

  // Log destinations at startup for debugging
  logger.info('Share post destinations configured:', SHARE_DESTINATIONS.map(d => ({
    id: d.id,
    chatId: d.chatId,
    threadId: d.threadId,
    name: d.name
  })));

  // ═══════════════════════════════════════════════════════════════════════════
  // DESTINATION SELECTION HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Toggle destination selection
  bot.action(/^share_post_dest_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      const destId = ctx.match[1];
      const destinations = ctx.session.temp?.sharePostData?.destinations || [];

      // Toggle destination selection
      const index = destinations.findIndex(d => d.id === destId);
      if (index > -1) {
        destinations.splice(index, 1);
      } else {
        const dest = SHARE_DESTINATIONS.find(d => d.id === destId);
        if (dest) {
          destinations.push({ ...dest });
        }
      }

      ctx.session.temp.sharePostData.destinations = destinations;
      await ctx.saveSession();

      const isSelected = destinations.some(d => d.id === destId);
      await ctx.answerCbQuery(isSelected ? '✅ Agregado' : '⬜ Removido');
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error selecting destination:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Select all destinations
  bot.action('share_post_select_all', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.temp.sharePostData.destinations = SHARE_DESTINATIONS.map(d => ({ ...d }));
      await ctx.saveSession();

      await ctx.answerCbQuery('✅ Todos seleccionados');
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error selecting all destinations:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Clear all destinations
  bot.action('share_post_clear_selection', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.temp.sharePostData.destinations = [];
      await ctx.saveSession();

      await ctx.answerCbQuery('⬜ Seleccion borrada');
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error clearing destinations:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Helper function to show destination selection UI
  async function showDestinationSelection(ctx) {
    const selectedDestinations = ctx.session.temp?.sharePostData?.destinations || [];
    const buttons = [];

    // Prime Channel section
    buttons.push([Markup.button.callback('━━ Canal ━━', 'share_post_header_channel')]);
    const primeChannel = SHARE_DESTINATIONS.find(d => d.id === 'prime');
    if (primeChannel) {
      const isPrimeSelected = selectedDestinations.some(d => d.id === 'prime');
      buttons.push([
        Markup.button.callback(
          (isPrimeSelected ? '✅ ' : '⬜ ') + primeChannel.name,
          'share_post_dest_prime'
        ),
      ]);
    }

    // Community Group section (General + Topics)
    buttons.push([Markup.button.callback('━━ Comunidad ━━', 'share_post_header_topics')]);
    const communityDest = SHARE_DESTINATIONS.find(d => d.id === 'community');
    if (communityDest) {
      const isCommunitySelected = selectedDestinations.some(d => d.id === 'community');
      buttons.push([
        Markup.button.callback(
          (isCommunitySelected ? '✅ ' : '⬜ ') + communityDest.name,
          'share_post_dest_community'
        ),
      ]);
    }
    const topicDestinations = SHARE_DESTINATIONS.filter(d => d.type === 'topic');
    for (const dest of topicDestinations) {
      const isSelected = selectedDestinations.some(d => d.id === dest.id);
      buttons.push([
        Markup.button.callback(
          (isSelected ? '✅ ' : '⬜ ') + dest.name,
          'share_post_dest_' + dest.id
        ),
      ]);
    }

    // Action buttons
    buttons.push([Markup.button.callback('✅ Seleccionar Todo', 'share_post_select_all')]);
    buttons.push([Markup.button.callback('⬜ Limpiar', 'share_post_clear_selection')]);
    buttons.push([Markup.button.callback('➡️ Continuar', 'share_post_continue_to_media')]);
    buttons.push([Markup.button.callback('❌ Cancelar', 'share_post_cancel')]);

    const selectedCount = selectedDestinations.length;
    const message = '📤 *Compartir Publicación*\n\n'
      + '*Paso 1/6: Selecciona Destinos*\n\n'
      + 'Destinos seleccionados: *' + selectedCount + '*\n\n'
      + '━━━━━━━━━━━━━━━━━\n\n'
      + '💎 *Prime Channel:* Canal principal\n'
      + '👥 *Comunidad (General):* Post sin topic\n'
      + '📰 *Topics:* Post en topic específico\n\n'
      + '💡 Selecciona donde quieres publicar.';

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Continue to media upload
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('share_post_continue_to_media', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      const postData = ctx.session.temp?.sharePostData || {};
      const destinations = postData.destinations || [];

      if (destinations.length === 0 && !postData.postToX) {
        await ctx.answerCbQuery('❌ Debes seleccionar al menos un destino o habilitar X');
        return;
      }

      ctx.session.temp.sharePostStep = 'upload_media';
      await ctx.saveSession();

      await ctx.answerCbQuery();

      await ctx.editMessageText(
        '📤 *Compartir Publicacion*\n\n'
        + '*Paso 2/6: Subir Media (Opcional)*\n\n'
        + '📸 Puedes subir una foto o video para acompanar tu publicacion.\n\n'
        + '💡 *Opciones:*\n'
        + '• 📷 Envia una foto (JPEG, PNG)\n'
        + '• 🎥 Envia un video (MP4, MOV)\n'
        + '• ➡️ Click "Sin Media" para continuar sin imagen/video\n\n'
        + '✅ *Videos grandes:* Se publican usando Telegram (sin re-subir) para soportar archivos muy grandes.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬜ Sin Media', 'share_post_skip_media')],
            [Markup.button.callback('❌ Cancelar', 'share_post_cancel')],
          ]),
        }
      );

      // Wait for media upload via middleware
      ctx.session.temp.waitingForMedia = true;
      await ctx.saveSession();
    } catch (error) {
      logger.error('Error continuing to media:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action('share_post_skip_media', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.temp.sharePostStep = 'write_text';
      ctx.session.temp.waitingForMedia = false;
      await ctx.saveSession();

      await ctx.answerCbQuery('⬜ Media omitida');
      await showTextInputStep(ctx);
    } catch (error) {
      logger.error('Error skipping media:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Media upload middleware (handle photo/video from user)
  // ═══════════════════════════════════════════════════════════════════════════
  bot.on('photo', async (ctx, next) => {
    try {
      if (!ctx.session.temp?.waitingForMedia) return next();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();

      const photo = ctx.message.photo[ctx.message.photo.length - 1];

      // Use batch session updates for better performance
      await performanceUtils.batchSessionUpdates(ctx, [
        { key: 'temp.sharePostData.sourceChatId', value: ctx.chat.id },
        { key: 'temp.sharePostData.sourceMessageId', value: ctx.message.message_id },
        { key: 'temp.sharePostData.mediaType', value: 'photo' },
        { key: 'temp.sharePostData.mediaFileId', value: photo.file_id },
        { key: 'temp.sharePostStep', value: 'write_text' },
        { key: 'temp.waitingForMedia', value: false }
      ]);

      await ctx.reply('✅ Foto guardada');
      await showTextInputStep(ctx);
    } catch (error) {
      logger.error('Error handling photo upload:', error);
      await ctx.reply('❌ Error al cargar la foto');
    }
  });

  bot.on('video', async (ctx, next) => {
    try {
      if (!ctx.session.temp?.waitingForMedia) return next();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();

      const video = ctx.message.video;

      const fileSizeMB = video.file_size ? Math.round((video.file_size / (1024 * 1024)) * 10) / 10 : 0;
      // Use batch session updates for better performance
      await performanceUtils.batchSessionUpdates(ctx, [
        { key: 'temp.sharePostData.sourceChatId', value: ctx.chat.id },
        { key: 'temp.sharePostData.sourceMessageId', value: ctx.message.message_id },
        { key: 'temp.sharePostData.mediaType', value: 'video' },
        { key: 'temp.sharePostData.mediaFileId', value: video.file_id },
        { key: 'temp.sharePostData.fileSizeMB', value: fileSizeMB },
        { key: 'temp.sharePostStep', value: 'write_text' },
        { key: 'temp.waitingForMedia', value: false }
      ]);

      await ctx.reply('✅ Video guardado' + (fileSizeMB ? ' (' + fileSizeMB + ' MB)' : ''));
      await showTextInputStep(ctx);
    } catch (error) {
      logger.error('Error handling video upload:', error);
      await ctx.reply('❌ Error al cargar el video');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Write post text
  // ═══════════════════════════════════════════════════════════════════════════
  async function showTextInputStep(ctx) {
    ctx.session.temp.sharePostStep = 'write_text';
    await ctx.saveSession();

    const aiButtons = [
      [Markup.button.callback('🤖 AI Write (General)', 'share_post_ai_text')],
      [Markup.button.callback('🎬 Create Video Description', 'share_post_ai_video_desc')],
      [Markup.button.callback('💰 Create Sales Post', 'share_post_ai_sales')],
      [
        Markup.button.callback('👤 Incluir Lex', 'share_post_toggle_lex'),
        Markup.button.callback('😈 Incluir Santino', 'share_post_toggle_santino'),
      ],
      [Markup.button.callback('❌ Cancelar', 'share_post_cancel')],
    ];

    try {
      await ctx.editMessageText(
        '📤 *Compartir Publicacion*\n\n'
        + '*Paso 3/6: Escribir Texto*\n\n'
        + '✍️ Envia el texto de tu publicacion o usa AI:\n\n'
        + '🤖 *AI Write* - General share post\n'
        + '🎬 *Video Description* - TITLE + narrative description\n'
        + '💰 *Sales Post* - HOOK + price/benefits/CTA\n\n'
        + '📝 *Limites:* 1024 si hay media / 4096 si es solo texto',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(aiButtons),
        }
      );
    } catch (editError) {
      if (editError.response?.description?.includes("can't be edited")) {
        // Message can't be edited, send as new message instead
        await ctx.reply(
          '📤 *Compartir Publicacion*\n\n'
          + '*Paso 3/6: Escribir Texto*\n\n'
          + '✍️ Envia el texto de tu publicacion o usa AI:\n\n'
          + '🤖 *AI Write* - General share post\n'
          + '🎬 *Video Description* - TITLE + narrative description\n'
          + '💰 *Sales Post* - HOOK + price/benefits/CTA\n\n'
          + '📝 *Limites:* 1024 si hay media / 4096 si es solo texto',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(aiButtons),
          }
        );
      } else {
        throw editError; // Re-throw other errors
      }
    }

    ctx.session.temp.waitingForText = true;
    await ctx.saveSession();
  }

  // Toggle Lex inclusion
  bot.action('share_post_toggle_lex', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      
      let includeLex = ctx.session.temp.sharePostData.includeLex || false;
      ctx.session.temp.sharePostData.includeLex = !includeLex;
      await ctx.saveSession();

      await ctx.answerCbQuery(ctx.session.temp.sharePostData.includeLex ? '✅ Incluido Lex' : '⬜ Excluido Lex');
      await showTextInputStep(ctx);
    } catch (error) {
      logger.error('Error toggling Lex inclusion:', error);
    }
  });

  // Toggle Santino inclusion
  bot.action('share_post_toggle_santino', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      
      let includeSantino = ctx.session.temp.sharePostData.includeSantino || false;
      ctx.session.temp.sharePostData.includeSantino = !includeSantino;
      await ctx.saveSession();

      await ctx.answerCbQuery(ctx.session.temp.sharePostData.includeSantino ? '✅ Incluido Santino' : '⬜ Excluido Santino');
      await showTextInputStep(ctx);
    } catch (error) {
      logger.error('Error toggling Santino inclusion:', error);
    }
  });

  // AI text generation - General
  bot.action('share_post_ai_text', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.sharePostStep = 'ai_prompt';
      ctx.session.temp.aiMode = 'sharePost';
      await ctx.saveSession();
      await ctx.reply(
        '🤖 *AI Write (Grok)*\n\nDescribe el post que quieres publicar.\nEjemplo:\n`Anuncia un evento hoy, tono sexy, incluye CTA a membership`',
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('Error in share_post_ai_text:', error);
    }
  });

  // AI video description generation
  bot.action('share_post_ai_video_desc', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.sharePostStep = 'ai_prompt';
      ctx.session.temp.aiMode = 'videoDescription';
      await ctx.saveSession();
      await ctx.reply(
        '🎬 *Create Video Description*\n\n'
        + 'Describe el video que quieres promocionar.\n\n'
        + '*Formato de salida:*\n'
        + '• TÍTULO EN MAYÚSCULAS (bold)\n'
        + '• Descripción narrativa (max 6 líneas)\n'
        + '• Hashtags\n\n'
        + '*Ejemplo:*\n'
        + '`Video de Santino en la ducha, mucho vapor y nubes`',
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('Error in share_post_ai_video_desc:', error);
    }
  });

  // AI sales post generation
  bot.action('share_post_ai_sales', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.sharePostStep = 'ai_prompt';
      ctx.session.temp.aiMode = 'salesPost';
      await ctx.saveSession();
      await ctx.reply(
        '💰 *Create Sales Post*\n\n'
        + 'Describe la oferta o producto a vender.\n\n'
        + '*Formato de salida:*\n'
        + '• HOOK EN MAYÚSCULAS (bold)\n'
        + '• Precio y beneficios\n'
        + '• CTA con link aprobado\n\n'
        + '*Ejemplo:*\n'
        + '`Membresía PRIME a $9.99, acceso ilimitado, descuento 50% esta semana`',
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('Error in share_post_ai_sales:', error);
    }
  });

  // Use AI-generated text as-is
  bot.action('share_post_use_ai', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      const aiDraft = ctx.session.temp?.aiDraft;
      if (!aiDraft) {
        await ctx.answerCbQuery('❌ No hay texto AI guardado');
        return;
      }

      ctx.session.temp.sharePostData.text = aiDraft;
      ctx.session.temp.sharePostStep = 'select_buttons';
      ctx.session.temp.aiDraft = null;
      await ctx.saveSession();

      await ctx.answerCbQuery('✅ Texto guardado');
      await showButtonSelectionStep(ctx);
    } catch (error) {
      logger.error('Error in share_post_use_ai:', error);
      try { await ctx.answerCbQuery('❌ Error'); } catch (e) { /* ignore */ }
    }
  });

  // Edit AI-generated text manually
  bot.action('share_post_edit_ai', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.temp.sharePostStep = 'edit_ai_share';
      await ctx.saveSession();

      await ctx.answerCbQuery();

      const aiDraft = ctx.session.temp?.aiDraft || '';
      const hasMedia = !!ctx.session.temp.sharePostData?.mediaFileId;
      const maxLen = hasMedia ? 1024 : 4096;

      // Send without parse_mode to avoid conflicts with AI-generated text
      await ctx.reply(
        '✏️ Editar Texto\n\n' +
        'Texto actual generado por AI:\n\n' +
        '---\n' + aiDraft + '\n---\n\n' +
        '📝 Envia tu versión editada del texto.\n' +
        '(Máximo ' + maxLen + ' caracteres)',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Volver', 'share_post_back_to_review')],
            [Markup.button.callback('❌ Cancelar', 'share_post_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in share_post_edit_ai:', error);
      try { await ctx.answerCbQuery('❌ Error'); } catch (e) { /* ignore */ }
    }
  });

  // Back to AI review from edit mode
  bot.action('share_post_back_to_review', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      const aiDraft = ctx.session.temp?.aiDraft;
      if (!aiDraft) {
        // No draft, go back to text input
        ctx.session.temp.sharePostStep = 'write_text';
        await ctx.saveSession();
        await ctx.answerCbQuery();
        await showTextInputStep(ctx);
        return;
      }

      ctx.session.temp.sharePostStep = 'review_ai_share';
      await ctx.saveSession();

      await ctx.answerCbQuery();
      // No parse_mode to avoid conflicts with AI-generated text
      await ctx.editMessageText(
        '🤖 AI Draft (Bilingual):\n\n' + aiDraft + '\n\n' +
        'Puedes usar este texto o editarlo manualmente.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Usar texto', 'share_post_use_ai')],
            [Markup.button.callback('✏️ Editar manualmente', 'share_post_edit_ai')],
            [Markup.button.callback('🔄 Regenerar', 'share_post_ai_text')],
            [Markup.button.callback('❌ Cancelar', 'share_post_cancel')],
          ]),
        },
      );
    } catch (error) {
      logger.error('Error in share_post_back_to_review:', error);
      try { await ctx.answerCbQuery('❌ Error'); } catch (e) { /* ignore */ }
    }
  });

  // Text input handling
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (!ctx.session.temp?.sharePostStep) return next();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();

      const step = ctx.session.temp.sharePostStep;
      const text = ctx.message.text;

      // Check if this is a command (starts with /) - if so, pass to other handlers
      if (text && text.startsWith('/')) {
        return next();
      }

      if (step === 'ai_prompt') {
        const prompt = (text || '').trim();
        if (!prompt) return;
        try {
          const hasMedia = !!ctx.session.temp.sharePostData.mediaFileId;
          const aiMode = ctx.session.temp.aiMode || 'sharePost';

          await ctx.reply('⏳ Generando texto con AI...');

          const includeLex = ctx.session.temp.sharePostData.includeLex;
          const includeSantino = ctx.session.temp.sharePostData.includeSantino;

          let result;
          let modeLabel;

          // Use the appropriate generation function based on mode
          if (aiMode === 'videoDescription') {
            result = await GrokService.generateVideoDescription({
              prompt,
              hasMedia,
              includeLex,
              includeSantino,
            });
            modeLabel = '🎬 Video Description';
          } else if (aiMode === 'salesPost') {
            result = await GrokService.generateSalesPost({
              prompt,
              hasMedia,
              includeLex,
              includeSantino,
            });
            modeLabel = '💰 Sales Post';
          } else {
            // Default: sharePost
            result = await GrokService.generateSharePost({
              prompt,
              hasMedia,
              includeLex,
              includeSantino,
            });
            modeLabel = '🤖 Share Post';
          }

          // Store AI draft temporarily for review/edit
          ctx.session.temp.aiDraft = result.combined;
          ctx.session.temp.sharePostStep = 'review_ai_share';
          await ctx.saveSession();

          // Determine regenerate button based on mode
          const regenerateAction = aiMode === 'videoDescription' ? 'share_post_ai_video_desc'
            : aiMode === 'salesPost' ? 'share_post_ai_sales'
            : 'share_post_ai_text';

          // Show preview with edit options (no parse_mode to avoid conflicts with AI-generated text)
          await ctx.reply(
            `${modeLabel} AI Draft (Bilingual):\n\n` + result.combined + '\n\n' +
            'Puedes usar este texto o editarlo manualmente.',
            {
              ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Usar texto', 'share_post_use_ai')],
                [Markup.button.callback('✏️ Editar manualmente', 'share_post_edit_ai')],
                [Markup.button.callback('🔄 Regenerar', regenerateAction)],
                [Markup.button.callback('❌ Cancelar', 'share_post_cancel')],
              ]),
            },
          );
        } catch (e) {
          logger.error('AI generation error:', e);
          await ctx.reply('❌ AI error: ' + e.message);
        }
        return;
      }

      // Handle manual text edit for AI-generated content
      if (step === 'edit_ai_share') {
        const hasMedia = !!ctx.session.temp.sharePostData.mediaFileId;
        const maxLen = hasMedia ? 1024 : 4096;
        if (text.length > maxLen) {
          await ctx.reply('❌ El texto es demasiado largo (maximo ' + maxLen + ' caracteres)');
          return;
        }

        ctx.session.temp.sharePostData.text = text;
        ctx.session.temp.sharePostStep = 'select_buttons';
        ctx.session.temp.aiDraft = null;
        await ctx.saveSession();

        await ctx.reply('✅ Texto guardado');
        await showButtonSelectionStep(ctx);
        return;
      }

      // Text input during write_text step
      if (step === 'write_text') {
        const hasMedia = !!ctx.session.temp.sharePostData.mediaFileId;
        const maxLen = hasMedia ? 1024 : 4096;
        if (text.length > maxLen) {
          await ctx.reply('❌ El texto es demasiado largo (maximo ' + maxLen + ' caracteres)');
          return;
        }

        ctx.session.temp.sharePostData.text = text;
        ctx.session.temp.sharePostStep = 'select_buttons';
        ctx.session.temp.waitingForText = false;
        await ctx.saveSession();

        await showButtonSelectionStep(ctx);
        return;
      }
      
      // If we get here and it's not a handled step, pass to other handlers
      return next();
    } catch (error) {
      logger.error('Error handling text input:', error);
      await ctx.reply('❌ Error al procesar el texto').catch(() => {});
      return next(); // Pass to other handlers even on error
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Select buttons
  // ═══════════════════════════════════════════════════════════════════════════
  async function showButtonSelectionStep(ctx) {
    try {
      const options = getSharePostButtonOptions();
      const currentButtons = normalizeButtons(ctx.session.temp.sharePostData.buttons) || [];
      const selected = new Set(currentButtons.map((b) => (typeof b === 'string' ? JSON.parse(b).key : b.key)));

      const buttons = options.map((opt) => {
        const on = selected.has(opt.key);
        return [Markup.button.callback((on ? '✅' : '➕') + ' ' + opt.text, 'share_post_toggle_' + opt.key)];
      });

      // Show any custom buttons that have been added (not in preset options)
      const presetKeys = new Set(options.map(opt => opt.key));
      const customButtons = currentButtons.filter(b => {
        const btn = typeof b === 'string' ? JSON.parse(b) : b;
        return !presetKeys.has(btn.key) || btn.key === 'custom';
      });

      for (let i = 0; i < customButtons.length; i++) {
        const btn = typeof customButtons[i] === 'string' ? JSON.parse(customButtons[i]) : customButtons[i];
        buttons.push([Markup.button.callback(`✅ ${btn.text} 🔗`, `share_post_remove_custom_${i}`)]);
      }

      buttons.push([Markup.button.callback('➕ Custom Link', 'share_post_add_custom_link')]);
      buttons.push([Markup.button.callback('👀 Preview', 'share_post_preview')]);
      buttons.push([Markup.button.callback('❌ Cancelar', 'share_post_cancel')]);

      try {
        await ctx.editMessageText(
          '📤 *Compartir Publicacion*\n\n'
          + '*Paso 4/6: Seleccionar Botones*\n\n'
          + '🔗 Selecciona 1 o varios botones (o deja solo el default):',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          }
        );
      } catch (editError) {
        if (editError.response?.description?.includes("can't be edited")) {
          // Message can't be edited, send as new message instead
          await ctx.reply(
            '📤 *Compartir Publicacion*\n\n'
            + '*Paso 4/6: Seleccionar Botones*\n\n'
            + '🔗 Selecciona 1 o varios botones (o deja solo el default):',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard(buttons),
            }
          );
        } else {
          throw editError; // Re-throw other errors
        }
      }

      ctx.session.temp.sharePostStep = 'select_buttons';
      await ctx.saveSession();
    } catch (error) {
      logger.error('Error showing button selection:', error);
      await ctx.reply('❌ Error al mostrar botones').catch(() => {});
    }
  }

  // Button toggle handlers
  bot.action(/^share_post_toggle_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      const key = ctx.match?.[1];
      if (!key) return;

      const options = getSharePostButtonOptions();
      const opt = options.find((o) => o.key === key);
      if (!opt) {
        await ctx.answerCbQuery('❌ Boton no encontrado');
        return;
      }

      const current = normalizeButtons(ctx.session.temp.sharePostData.buttons);
      const idx = current.findIndex((b) => (typeof b === 'string' ? JSON.parse(b).key : b.key) === key);
      if (idx >= 0) {
        current.splice(idx, 1);
        await ctx.answerCbQuery('Removed');
      } else {
        current.push(opt);
        await ctx.answerCbQuery('Added');
      }
      ctx.session.temp.sharePostData.buttons = current;
      await ctx.saveSession();
      await showButtonSelectionStep(ctx);
    } catch (error) {
      logger.error('Error toggling share post button:', error);
    }
  });

  // Remove custom link
  bot.action(/^share_post_remove_custom_(\d+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      if (!ctx.session.temp?.sharePostData?.buttons) return;

      const index = parseInt(ctx.match[1]);
      const options = getSharePostButtonOptions();
      const presetKeys = new Set(options.map(opt => opt.key));

      // Find and remove the custom button at the given index
      const buttons = normalizeButtons(ctx.session.temp.sharePostData.buttons);
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

      ctx.session.temp.sharePostData.buttons = buttons;
      await ctx.saveSession();

      await ctx.answerCbQuery('Removed');
      await showButtonSelectionStep(ctx);
    } catch (error) {
      logger.error('Error removing custom button:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Custom link handling
  bot.action('share_post_add_custom_link', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.sharePostStep = 'custom_link';
      await ctx.saveSession();
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '🔗 *Custom Link*\n\nEnvia: `Texto|https://link.com`',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', 'share_post_back_to_buttons')],
            [Markup.button.callback('❌ Cancelar', 'share_post_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error starting custom link for share post:', error);
    }
  });

  bot.action('share_post_back_to_buttons', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.sharePostStep = 'select_buttons';
      await ctx.saveSession();
      await showButtonSelectionStep(ctx);
    } catch (error) {
      logger.error('Error in share_post_back_to_buttons:', error);
    }
  });

  // Custom link text handling
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (!ctx.session.temp?.sharePostStep) return next();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();

      const step = ctx.session.temp.sharePostStep;
      const text = ctx.message.text;

      // Check if this is a command (starts with /) - if so, pass to other handlers
      if (text && text.startsWith('/')) {
        return next();
      }

      if (step === 'custom_link') {
        const parts = (text || '').split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2) {
          await ctx.reply('❌ Formato invalido. Usa: `Texto|https://link.com`', { parse_mode: 'Markdown' });
          return;
        }
        const [label, url] = parts;
        if (!/^https?:\/\//i.test(url)) {
          await ctx.reply('❌ El link debe comenzar con http:// o https://', { parse_mode: 'Markdown' });
          return;
        }
        const buttons = normalizeButtons(ctx.session.temp.sharePostData.buttons);
        buttons.push({ key: 'custom', text: label, type: 'url', target: url });
        ctx.session.temp.sharePostData.buttons = buttons;
        ctx.session.temp.sharePostStep = 'select_buttons';
        await ctx.saveSession();
        await ctx.reply('✅ Custom link agregado');
        await showButtonSelectionStep(ctx);
        return;
      }
      
      // If we get here and it's not a handled step, pass to other handlers
      return next();
    } catch (error) {
      logger.error('Error handling custom link input:', error);
      return next();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Preview
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('share_post_preview', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();

      const postData = ctx.session.temp.sharePostData;
      const text = postData.text || '';
      const hasMedia = !!(postData.mediaFileId || postData.sourceMessageId);
      const maxLen = hasMedia ? 1024 : 4096;
      const kb = buildInlineKeyboard(postData.buttons);

      // Check caption length
      let lengthWarning = '';
      let xWarning = '';
      if (text.length > maxLen) {
        lengthWarning = `\n\n⚠️ ADVERTENCIA: El texto tiene ${text.length} caracteres (máximo ${maxLen} para ${hasMedia ? 'posts con media' : 'posts sin media'}). Será truncado al enviar.`;
      }

      const xStatus = postData.postToX
        ? `🐦 X: @${postData.xAccountHandle || 'cuenta seleccionada'}`
        : '🐦 X: No se publicará';

      if (postData.postToX) {
        const { truncated } = XPostService.normalizeXText(text);
        if (truncated) {
          xWarning = '\n\n⚠️ ADVERTENCIA: El texto supera 280 caracteres para X y será truncado.';
        }
      }

      // Show text preview (truncated if too long)
      const previewText = text.length > 500 ? text.substring(0, 500) + '...\n\n[Texto truncado para preview]' : text;

      // Try to show media preview if available
      if (postData.sourceChatId && postData.sourceMessageId) {
        try {
          // Use shorter caption for preview to avoid errors
          const shortCaption = text.length > 800 ? text.substring(0, 800) + '...' : text;
          await ctx.telegram.copyMessage(ctx.chat.id, postData.sourceChatId, postData.sourceMessageId, {
            caption: shortCaption,
            ...(kb ? { reply_markup: kb.reply_markup } : {}),
          });
        } catch (e) {
          logger.warn(`Preview copyMessage failed: ${e.message}`);
          // Fallback: just show text
          await ctx.reply('📷 [Media adjunta]\n\n' + previewText, {
            ...(kb ? { reply_markup: kb.reply_markup } : {}),
          });
        }
      } else if (text) {
        await ctx.reply(previewText, { ...(kb ? { reply_markup: kb.reply_markup } : {}) });
      }

      await ctx.reply(
        '👀 Preview\n\n' + xStatus + lengthWarning + xWarning + '\n\n¿Enviar ahora o programar para mas tarde?',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📤 Send Now', 'share_post_send_now')],
            [Markup.button.callback('📅 Schedule', 'share_post_schedule')],
            [Markup.button.callback('✏️ Edit Text', 'share_post_edit_text')],
            [Markup.button.callback('🔘 Edit Buttons', 'share_post_back_to_buttons')],
            [Markup.button.callback('🐦 Configurar X', 'share_post_configure_x')],
            [Markup.button.callback('❌ Cancel', 'share_post_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in share_post_preview:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Edit text from preview
  bot.action('share_post_edit_text', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      ctx.session.temp.sharePostStep = 'write_text';
      await ctx.saveSession();
      await showTextInputStep(ctx);
    } catch (error) {
      logger.error('Error in share_post_edit_text:', error);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Send/Schedule options
  // ═══════════════════════════════════════════════════════════════════════════

  // Send now
  bot.action('share_post_send_now', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await ctx.answerCbQuery();
      await sendPostNow(ctx);
    } catch (error) {
      logger.error('Error sending post now:', error);
      await ctx.reply('❌ Error al enviar publicacion').catch(() => {});
    }
  });

  // Schedule for later (inline date/time picker)
  bot.action('share_post_schedule', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      ctx.session.temp.sharePostStep = 'schedule_datetime_picker';
      ctx.session.temp.sharePostTimezone = ctx.session.temp.sharePostTimezone || DEFAULT_TZ;
      await ctx.saveSession();

      await ctx.answerCbQuery();

      const PREFIX = 'share_post_sched';
      const { text, keyboard } = dateTimePicker.getSchedulingMenu('es', PREFIX);
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } catch (error) {
      logger.error('Error scheduling post:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Inline picker handlers for scheduling
  const SCHED_PREFIX = 'share_post_sched';
  const DEFAULT_TZ = 'America/Bogota';
  const presetCount = dateTimePicker.getQuickPresetHours().length;
  for (let i = 0; i < presetCount; i++) {
    bot.action(`${SCHED_PREFIX}_preset_${i}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) return;
        await ctx.answerCbQuery();
        const scheduledDate = dateTimePicker.calculatePresetDate(i);
        if (!scheduledDate) return;
        const tz = ctx.session.temp.sharePostTimezone || DEFAULT_TZ;
        const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', SCHED_PREFIX);
        ctx.session.temp.sharePostTempDate = scheduledDate.toISOString();
        await ctx.saveSession();
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
      } catch (error) {
        logger.error('Error handling share post preset:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  bot.action(`${SCHED_PREFIX}_open_calendar`, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const now = new Date();
      const { text, keyboard } = dateTimePicker.getCalendarView(now.getFullYear(), now.getMonth(), 'es', SCHED_PREFIX);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error opening share post calendar:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${SCHED_PREFIX}_month_(\\d{4})_(-?\\d+)$`), async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const parsed = dateTimePicker.parseMonthCallback(ctx.match[0]);
      if (!parsed) return;
      let { year, month } = parsed;
      while (month < 0) { month += 12; year--; }
      while (month > 11) { month -= 12; year++; }
      const now = new Date();
      if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())) return;
      const { text, keyboard } = dateTimePicker.getCalendarView(year, month, 'es', SCHED_PREFIX);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error navigating share post month:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${SCHED_PREFIX}_date_(\\d{4})_(\\d+)_(\\d+)$`), async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const parsed = dateTimePicker.parseDateCallback(ctx.match[0]);
      if (!parsed) return;
      const { year, month, day } = parsed;
      const { text, keyboard } = dateTimePicker.getTimeSelectionView(year, month, day, 'es', SCHED_PREFIX);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error selecting share post date:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${SCHED_PREFIX}_time_(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})_(\\d{2})$`), async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const parsed = dateTimePicker.parseTimeCallback(ctx.match[0]);
      if (!parsed) return;
      const { year, month, day, hour, minute } = parsed;
      const tz = ctx.session.temp.sharePostTimezone || DEFAULT_TZ;
      const scheduledDate = dateTimePicker.buildDateInTimeZone(
        { year, month, day, hour, minute },
        tz
      );
      if (scheduledDate <= new Date()) {
        await ctx.answerCbQuery('❌ La hora seleccionada ya pasó', { show_alert: true });
        return;
      }
      const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', SCHED_PREFIX);
      ctx.session.temp.sharePostTempDate = scheduledDate.toISOString();
      await ctx.saveSession();
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error selecting share post time:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${SCHED_PREFIX}_custom_time_(\\d{4})-(\\d{2})-(\\d{2})$`), async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const match = ctx.match[0].match(/custom_time_(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return;
      const [, year, month, day] = match;
      ctx.session.temp.sharePostCustomDate = { year: parseInt(year, 10), month: parseInt(month, 10) - 1, day: parseInt(day, 10) };
      ctx.session.temp.sharePostStep = 'schedule_custom_time';
      await ctx.saveSession();
      const monthName = dateTimePicker.MONTHS_FULL.es[parseInt(month, 10) - 1];
      const formattedDate = `${day} ${monthName} ${year}`;
      await ctx.editMessageText(
        `⌨️ *Hora Personalizada*\n\n📅 Fecha: *${formattedDate}*\n\nEscribe la hora en formato HH:MM (24 horas)`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver', `${SCHED_PREFIX}_date_${year}_${parseInt(month, 10) - 1}_${day}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error requesting share post custom time:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(`${SCHED_PREFIX}_confirm`, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const scheduledIso = ctx.session.temp.sharePostTempDate;
      if (!scheduledIso) return;
      const scheduledDate = new Date(scheduledIso);
      ctx.session.temp.sharePostData.scheduledAt = scheduledDate;
      ctx.session.temp.sharePostData.isScheduled = true;
      await ctx.saveSession();
      await confirmScheduledPost(ctx);
    } catch (error) {
      logger.error('Error confirming share post schedule:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(`${SCHED_PREFIX}_change_tz`, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '🌍 *Zona Horaria*\n\nSelecciona tu zona horaria:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🇨🇴 Bogotá', `${SCHED_PREFIX}_tz_America/Bogota`)],
            [Markup.button.callback('🇺🇸 New York', `${SCHED_PREFIX}_tz_America/New_York`)],
            [Markup.button.callback('🇺🇸 Los Angeles', `${SCHED_PREFIX}_tz_America/Los_Angeles`)],
            [Markup.button.callback('🇲🇽 Mexico City', `${SCHED_PREFIX}_tz_America/Mexico_City`)],
            [Markup.button.callback('🇪🇸 Madrid', `${SCHED_PREFIX}_tz_Europe/Madrid`)],
            [Markup.button.callback('🇬🇧 London', `${SCHED_PREFIX}_tz_Europe/London`)],
            [Markup.button.callback('🌐 UTC', `${SCHED_PREFIX}_tz_UTC`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error changing share post timezone:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  const sharePostTimezones = [
    'America/Bogota',
    'America/New_York',
    'America/Los_Angeles',
    'America/Mexico_City',
    'Europe/Madrid',
    'Europe/London',
    'UTC',
  ];

  for (const tz of sharePostTimezones) {
    bot.action(`${SCHED_PREFIX}_tz_${tz}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) return;
        await ctx.answerCbQuery();
        ctx.session.temp.sharePostTimezone = tz;
        await ctx.saveSession();
        const scheduledIso = ctx.session.temp.sharePostTempDate;
        if (!scheduledIso) return;
        const scheduledDate = new Date(scheduledIso);
        const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', SCHED_PREFIX);
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
      } catch (error) {
        logger.error('Error setting share post timezone:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  // Handle custom time input (HH:MM)
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (ctx.session.temp?.sharePostStep !== 'schedule_custom_time') return next();

      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();

      const input = ctx.message.text.trim();
      if (input.startsWith('/')) return next();

      const match = input.match(/^(\d{1,2}):(\d{2})$/);
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

      const dateInfo = ctx.session.temp.sharePostCustomDate;
      if (!dateInfo) {
        await ctx.reply('❌ Sesión expirada. Selecciona la fecha de nuevo.');
        return;
      }

      const tz = ctx.session.temp.sharePostTimezone || DEFAULT_TZ;
      const scheduledDate = dateTimePicker.buildDateInTimeZone(
        {
          year: dateInfo.year,
          month: dateInfo.month,
          day: dateInfo.day,
          hour,
          minute,
        },
        tz
      );
      if (scheduledDate <= new Date()) {
        await ctx.reply('❌ La fecha debe estar en el futuro.');
        return;
      }

      ctx.session.temp.sharePostTempDate = scheduledDate.toISOString();
      ctx.session.temp.sharePostStep = 'schedule_datetime_picker';
      await ctx.saveSession();

      const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', SCHED_PREFIX);
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      return;
    } catch (error) {
      logger.error('Error handling share post custom time input:', error);
      await ctx.reply('❌ Error al procesar la hora').catch(() => {});
      return next();
    }
  });

  // Confirm scheduled post
  async function confirmScheduledPost(ctx) {
    try {
      const postData = ctx.session.temp.sharePostData;
      const scheduledAt = postData.scheduledAt;
      const destinations = postData.destinations || [];

      const tz = ctx.session.temp.sharePostTimezone || DEFAULT_TZ;
      const formattedDate = dateTimePicker.formatDate(scheduledAt, 'es', tz);
      await ctx.reply(
        '📅 *Publicación Programada*\n\n'
        + `🗓️ Fecha: ${formattedDate} ${tz}\n`
        + '📢 Destinos: ' + destinations.length + '\n\n'
        + '✅ ¿Confirmar programación?',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirmar', 'share_post_confirm_schedule')],
            [Markup.button.callback('❌ Cancelar', 'share_post_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error confirming scheduled post:', error);
      await ctx.reply('❌ Error al confirmar programacion').catch(() => {});
    }
  }

  // Confirm and schedule post
  bot.action('share_post_confirm_schedule', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      await ctx.answerCbQuery('⏳ Programando...');
      await schedulePost(ctx);
    } catch (error) {
      logger.error('Error confirming scheduled post:', error);
      await ctx.answerCbQuery('❌ Error al programar').catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL: Send post now
  // ═══════════════════════════════════════════════════════════════════════════
  async function sendPostNow(ctx) {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      const postData = ctx.session.temp.sharePostData;
      const destinations = postData.destinations || [];

      // Validate all required fields
      if (destinations.length === 0 && !postData.postToX) {
        await ctx.answerCbQuery('❌ Debes seleccionar al menos un destino o habilitar X');
        return;
      }

      if (!postData.text) {
        await ctx.answerCbQuery('❌ Debes escribir el texto');
        return;
      }

      await ctx.answerCbQuery('⏳ Enviando...');

      const kb = buildInlineKeyboard(postData.buttons);

      let sent = 0;
      let failed = 0;
      let xResult = null;

      // Send to each destination directly
      for (const dest of destinations) {
        try {
          const options = {
            parse_mode: 'Markdown',
            ...(kb?.reply_markup ? { reply_markup: kb.reply_markup } : {}),
          };

          // Add thread_id for topics
          if (dest.threadId) {
            options.message_thread_id = dest.threadId;
          }

          // Try with Markdown first, fall back to plain text if it fails
          const sendWithFallback = async () => {
            try {
              if (postData.mediaType === 'photo' && postData.mediaFileId) {
                await ctx.telegram.sendPhoto(dest.chatId, postData.mediaFileId, {
                  caption: postData.text,
                  ...options,
                });
              } else if (postData.mediaType === 'video' && postData.mediaFileId) {
                await ctx.telegram.sendVideo(dest.chatId, postData.mediaFileId, {
                  caption: postData.text,
                  ...options,
                });
              } else {
                await ctx.telegram.sendMessage(dest.chatId, postData.text, options);
              }
            } catch (markdownError) {
              // If Markdown parsing fails, retry without parse_mode
              if (markdownError.response?.description?.includes("can't parse")) {
                logger.warn(`Markdown parse failed for ${dest.name}, retrying as plain text`);
                delete options.parse_mode;
                if (postData.mediaType === 'photo' && postData.mediaFileId) {
                  await ctx.telegram.sendPhoto(dest.chatId, postData.mediaFileId, {
                    caption: postData.text,
                    ...options,
                  });
                } else if (postData.mediaType === 'video' && postData.mediaFileId) {
                  await ctx.telegram.sendVideo(dest.chatId, postData.mediaFileId, {
                    caption: postData.text,
                    ...options,
                  });
                } else {
                  await ctx.telegram.sendMessage(dest.chatId, postData.text, options);
                }
              } else {
                throw markdownError;
              }
            }
          };

          await sendWithFallback();

          sent++;
          logger.info(`Post sent to ${dest.name}`, { chatId: dest.chatId, threadId: dest.threadId });
        } catch (sendError) {
          failed++;
          const errMsg = sendError.response?.description || sendError.message || 'Unknown error';
          logger.error(`Failed to send to ${dest.name}`, {
            chatId: dest.chatId,
            threadId: dest.threadId,
            error: errMsg
          });
        }
      }

      if (postData.postToX && postData.xAccountId) {
        try {
          // Build X text with deep links from buttons
          const xText = buildXTextWithDeepLinks(postData.text, postData.buttons);
          xResult = await XPostService.sendPostNow({
            accountId: postData.xAccountId,
            adminId: ctx.from.id,
            adminUsername: ctx.from.username || 'unknown',
            text: xText,
          });
        } catch (xError) {
          xResult = { error: xError.message || 'Error desconocido' };
        }
      }

      // Clear session
      ctx.session.temp = {};
      await ctx.saveSession();

      const xSummary = postData.postToX
        ? `\n🐦 X: ${xResult?.response?.data?.id ? 'Publicado' : 'Error'}`
        : '';

      const message = '✅ *Publicación Enviada*\n\n'
        + '📊 Destinos: ' + destinations.length + '\n'
        + '✓ Enviados: ' + sent + '\n'
        + '✗ Fallidos: ' + failed
        + xSummary;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📤 Nueva Publicación', 'admin_improved_share_post')],
          [Markup.button.callback('⬅️ Panel Admin', 'admin_home')],
        ]),
      });

      logger.info('Shared post sent now', {
        adminId: ctx.from.id,
        destinations: destinations.length,
        sent,
        failed,
      });
    } catch (error) {
      logger.error('Error sending post now:', error);
      await ctx.answerCbQuery('❌ Error al enviar publicacion').catch(() => {});
      await ctx.reply('❌ Error: ' + error.message).catch(() => {});
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Schedule post for later
  // ═══════════════════════════════════════════════════════════════════════════
  async function schedulePost(ctx) {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }

      const postData = ctx.session.temp.sharePostData;
      const destinations = postData.destinations || [];

      // Validate all required fields
      if (destinations.length === 0 && !postData.postToX) {
        await ctx.answerCbQuery('❌ Debes seleccionar al menos un destino o habilitar X');
        return;
      }

      if (!postData.text) {
        await ctx.answerCbQuery('❌ Debes escribir el texto');
        return;
      }

      if (!postData.scheduledAt) {
        await ctx.answerCbQuery('❌ Debes seleccionar una fecha');
        return;
      }

      await ctx.answerCbQuery('⏳ Programando...');

      // Extract channel, group, and topic IDs for compatibility with database
      const channelDests = destinations.filter(d => d.type === 'channel');
      const groupDests = destinations.filter(d => d.type === 'group');
      const topicDests = destinations.filter(d => d.type === 'topic');

      // Create the post in database for scheduling
      const postId = await communityPostService.createCommunityPost({
        adminId: ctx.from.id,
        adminUsername: ctx.from.username || 'unknown',
        title: postData.text.substring(0, 100),
        messageEn: postData.text,
        messageEs: postData.text,
        mediaType: postData.mediaType,
        mediaUrl: postData.mediaFileId,
        telegramFileId: postData.mediaFileId,
        targetGroupIds: [...topicDests.map(d => d.chatId), ...groupDests.map(d => d.chatId)],
        targetChannelIds: channelDests.map(d => d.chatId),
        targetTopics: [
          ...topicDests.map(d => ({ chatId: d.chatId, threadId: d.threadId, name: d.name })),
          ...groupDests.map(d => ({ chatId: d.chatId, threadId: null, name: d.name })),
        ],
        targetAllGroups: false,
        postToPrimeChannel: channelDests.length > 0,
        templateType: 'standard',
        buttonLayout: 'single_row',
        scheduledAt: postData.scheduledAt,
        timezone: 'UTC',
        isRecurring: false,
        status: 'scheduled',
      });

      let xPostId = null;
      if (postData.postToX && postData.xAccountId) {
        // Build X text with deep links from buttons
        const xText = buildXTextWithDeepLinks(postData.text, postData.buttons);
        const normalized = XPostService.normalizeXText(xText);
        xPostId = await XPostService.createPostJob({
          accountId: postData.xAccountId,
          adminId: ctx.from.id,
          adminUsername: ctx.from.username || 'unknown',
          text: normalized.text,
          scheduledAt: postData.scheduledAt,
          status: 'scheduled',
        });
      }

      // Clear session
      ctx.session.temp = {};
      await ctx.saveSession();

      const xInfo = postData.postToX
        ? `\n🐦 X: ${xPostId ? 'Programado' : 'Error'}`
        : '';

      const message = '✅ *Publicación Programada*\n\n'
        + '🗓️ Fecha: ' + postData.scheduledAt.toISOString().replace('T', ' ').substring(0, 16) + ' UTC\n'
        + '📢 Destinos: ' + destinations.length + '\n'
        + '📝 ID: ' + postId
        + xInfo;

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📤 Nueva Publicación', 'admin_improved_share_post')],
          [Markup.button.callback('⬅️ Panel Admin', 'admin_home')],
        ]),
      });

      logger.info('Shared post scheduled', {
        adminId: ctx.from.id,
        postId,
        scheduledAt: postData.scheduledAt,
        destinations: destinations.length,
      });
    } catch (error) {
      logger.error('Error scheduling post:', error);
      await ctx.answerCbQuery('❌ Error al programar publicacion').catch(() => {});
      await ctx.reply('❌ Error: ' + error.message).catch(() => {});
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cancel action for share post
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('share_post_cancel', async (ctx) => {
    try {
      ctx.session.temp = {};
      await ctx.saveSession();

      await ctx.answerCbQuery('❌ Cancelado');
      await ctx.editMessageText(
        '❌ Publicacion cancelada',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📤 Nueva Publicacion', 'admin_improved_share_post')],
            [Markup.button.callback('⬅️ Panel Admin', 'admin_home')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error cancelling:', error);
    }
  });
};

module.exports = registerImprovedSharePostHandlers;
