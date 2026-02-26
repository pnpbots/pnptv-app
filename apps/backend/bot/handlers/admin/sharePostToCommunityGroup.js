/**
 * Share Post to Community Group Handler
 * Multi-step wizard for creating and scheduling community posts with media, text, and buttons
 */
const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const communityPostService = require('../../services/communityPostService');
const PermissionService = require('../../services/permissionService');
const { getLanguage } = require('../../utils/helpers');
const GrokService = require('../../services/grokService');
const sanitize = require('../../../utils/sanitizer');
const broadcastUtils = require('../../utils/broadcastUtils'); // Changed from ../../utils/ to ../../utils/ (no change needed - already correct)
const performanceUtils = require('../../utils/performanceUtils');
const uxUtils = require('../../utils/uxUtils');
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
 * Register community post handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerCommunityPostHandlers = (bot) => {
  bot.action('share_post_ai_text', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.communityPostStep = 'ai_prompt';
      await ctx.saveSession();
      await ctx.reply(
        '🤖 *AI Write (Grok)*\n\nDescribe el post que quieres publicar.\nEjemplo:\n`Anuncia un evento hoy, tono sexy, incluye CTA a membership`',
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('Error in share_post_ai_text:', error);
    }
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Main entry point - Show community groups
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('admin_share_post_to_groups', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      if (!ctx.session.temp) ctx.session.temp = {};
      // Initialize session data
      ctx.session.temp.communityPostStep = 'select_destinations';
      ctx.session.temp.communityPostData = {
        targetGroups: [],
        targetPrimeChannel: false, // NEW: Prime channel support
        postDestinations: [], // NEW: Multiple destinations
        sourceChatId: null,
        sourceMessageId: null,
        mediaType: null,
        mediaFileId: null,
        fileSizeMB: 0, // Track size (info only)
        text: '',
        buttons: [getSharePostButtonOptions()[0]], // default: home button only
        templateType: 'standard',
        buttonLayout: 'single_row',
        isRecurring: false,
        recurrencePattern: 'daily',
        maxOccurrences: 1,
        scheduledTimes: [],
        scheduledCount: 1,
        currentScheduleIndex: 0,
        includeLex: false,
        includeSantino: false,
      };
      await ctx.saveSession();
      await ctx.answerCbQuery();
      // Show destination selection (groups + Prime channel)
      const destinations = await communityPostService.getPostingDestinations();
      const buttons = [];
      // Add Prime Channel button first
      buttons.push([
        Markup.button.callback(
          '💎 Prime Channel',
          'share_post_dest_prime_channel'
        ),
      ]);
      // Add group selection buttons
      buttons.push([Markup.button.callback('━━ Community Groups ━━', 'share_post_groups_header')]);
      for (const group of destinations.filter(d => d.destination_type === 'group')) {
        buttons.push([
          Markup.button.callback(
            `${group.icon} ${group.destination_name}`,
            `share_post_dest_${group.telegram_id}`
          ),
        ]);
      }
      // Add select all button
      buttons.push([Markup.button.callback('✅ Select All', 'share_post_select_all_dest')]);
      buttons.push([Markup.button.callback('⬜ Clear Selection', 'share_post_clear_selection_dest')]);
      buttons.push([Markup.button.callback('➡️ Continue', 'share_post_continue_to_media')]);
      buttons.push([Markup.button.callback('❌ Cancel', 'admin_cancel')]);
      await ctx.editMessageText(
        '📤 *Compartir Publicación*\n\n'
        + '*Paso 1/9: Selecciona Destinos*\n\n'
        + 'Selecciona uno o más destinos (grupos o canal):\n\n'
        + '━━━━━━━━━━━━━━━━━\n\n'
        + '💎 *Prime Channel:* Para miembros premium\n'
        + '👥 *Grupos Comunitarios:* Todos los usuarios\n\n'
        + '💡 *Tip:* Puedes compartir en múltiples destinos a la vez.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      logger.error('Error in share_post entry:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // DESTINATION SELECTION (Groups + Prime Channel)
  // ═══════════════════════════════════════════════════════════════════════════
  // Prime Channel selection
  bot.action('share_post_dest_prime_channel', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      // Ensure session structure exists
      if (!ctx.session.temp) ctx.session.temp = {};
      if (!ctx.session.temp.communityPostData) ctx.session.temp.communityPostData = {};
      const postDestinations = ctx.session.temp.communityPostData.postDestinations || [];
      const primeChannelId = '-1002997324714'; // From env
      // Toggle Prime Channel selection
      const index = postDestinations.indexOf(primeChannelId);
      if (index > -1) {
        postDestinations.splice(index, 1);
      } else {
        postDestinations.push(primeChannelId);
      }
      ctx.session.temp.communityPostData.postDestinations = postDestinations;
      ctx.session.temp.communityPostData.targetPrimeChannel = postDestinations.includes(primeChannelId);
      await ctx.saveSession();
      await ctx.answerCbQuery(postDestinations.includes(primeChannelId) ? '💎 Prime Channel añadido' : '💎 Prime Channel removido');
      // Refresh UI
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error selecting Prime Channel:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // Destination selection by ID (for groups)
  bot.action(/^share_post_dest_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      const destId = ctx.match[1];
      if (destId === 'prime_channel') return; // Handled by other handler
      // Ensure session structure exists
      if (!ctx.session.temp) ctx.session.temp = {};
      if (!ctx.session.temp.communityPostData) ctx.session.temp.communityPostData = {};
      const postDestinations = ctx.session.temp.communityPostData.postDestinations || [];
      // Toggle destination selection
      const index = postDestinations.indexOf(destId);
      if (index > -1) {
        postDestinations.splice(index, 1);
      } else {
        postDestinations.push(destId);
      }
      ctx.session.temp.communityPostData.postDestinations = postDestinations;
      await ctx.saveSession();
      await ctx.answerCbQuery(`✅ Destino ${postDestinations.length > 0 ? 'añadido' : 'removido'}`);
      // Refresh UI
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error selecting destination:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // Select all destinations
  bot.action('share_post_select_all_dest', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      // Ensure session structure exists
      if (!ctx.session.temp) ctx.session.temp = {};
      if (!ctx.session.temp.communityPostData) ctx.session.temp.communityPostData = {};
      const destinations = await communityPostService.getPostingDestinations();
      const destIds = destinations.map(d => d.telegram_id);
      ctx.session.temp.communityPostData.postDestinations = destIds;
      ctx.session.temp.communityPostData.targetPrimeChannel = destIds.some(id => id === '-1002997324714');
      await ctx.saveSession();
      await ctx.answerCbQuery(`✅ Todos los ${destinations.length} destinos seleccionados`);
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error selecting all destinations:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // Clear all destinations
  bot.action('share_post_clear_selection_dest', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      // Ensure session structure exists
      if (!ctx.session.temp) ctx.session.temp = {};
      if (!ctx.session.temp.communityPostData) ctx.session.temp.communityPostData = {};
      ctx.session.temp.communityPostData.postDestinations = [];
      ctx.session.temp.communityPostData.targetPrimeChannel = false;
      await ctx.saveSession();
      await ctx.answerCbQuery('⬜ Selección borrada');
      await showDestinationSelection(ctx);
    } catch (error) {
      logger.error('Error clearing destinations:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // Helper function to show destination selection UI
  async function showDestinationSelection(ctx) {
    const destinations = await communityPostService.getPostingDestinations();
    const postDestinations = ctx.session.temp?.communityPostData?.postDestinations || [];
    const buttons = [];
    // Prime Channel button
    const primeChannelId = '-1002997324714';
    const isPrimeSelected = postDestinations.includes(primeChannelId);
    const primePrefix = isPrimeSelected ? '💎✅' : '💎⬜';
    buttons.push([
      Markup.button.callback(
        `${primePrefix} Prime Channel`,
        'share_post_dest_prime_channel'
      ),
    ]);
    // Group buttons
    buttons.push([Markup.button.callback('━━ Community Groups ━━', 'share_post_groups_header')]);
    for (const dest of destinations.filter(d => d.destination_type === 'group')) {
      const isSelected = postDestinations.includes(dest.telegram_id);
      const prefix = isSelected ? '✅' : '⬜';
      buttons.push([
        Markup.button.callback(
          `${prefix} ${dest.icon} ${dest.destination_name}`,
          `share_post_dest_${dest.telegram_id}`
        ),
      ]);
    }
    buttons.push([Markup.button.callback('✅ Select All', 'share_post_select_all_dest')]);
    buttons.push([Markup.button.callback('⬜ Clear Selection', 'share_post_clear_selection_dest')]);
    buttons.push([Markup.button.callback('➡️ Continue', 'share_post_continue_to_media')]);
    buttons.push([Markup.button.callback('❌ Cancel', 'admin_cancel')]);
    const selectedCount = postDestinations.length;
    const message = `📤 *Compartir Publicación*\n\n`
      + `*Paso 1/9: Selecciona Destinos*\n\n`
      + `Destinos seleccionados: *${selectedCount}*\n\n`
      + `━━━━━━━━━━━━━━━━━\n\n`
      + `💎 *Prime Channel:* Contenido exclusivo para miembros\n`
      + `👥 *Grupos:* Contenido para todos\n\n`
      + `💡 *Tip:* Selecciona múltiples destinos para mayor alcance.`;
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // Group selection actions (legacy - keep for compatibility)
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action(/^share_post_group_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      // Ensure session structure exists
      if (!ctx.session.temp) ctx.session.temp = {};
      if (!ctx.session.temp.communityPostData) ctx.session.temp.communityPostData = {};
      const groupId = ctx.match[1];
      const targetGroups = ctx.session.temp.communityPostData.targetGroups || [];
      // Toggle group selection
      const index = targetGroups.indexOf(groupId);
      if (index > -1) {
        targetGroups.splice(index, 1);
      } else {
        targetGroups.push(groupId);
      }
      ctx.session.temp.communityPostData.targetGroups = targetGroups;
      await ctx.saveSession();
      await ctx.answerCbQuery(`✅ Grupo ${targetGroups.length > 0 ? 'añadido' : 'removido'}`);
      // Refresh the UI to show selected groups
      const groups = await communityPostService.getCommunityGroups();
      const buttons = [];
      for (const group of groups) {
        const isSelected = targetGroups.includes(group.group_id);
        const prefix = isSelected ? '✅' : '⬜';
        buttons.push([
          Markup.button.callback(
            `${prefix} ${group.icon} ${group.name}`,
            `share_post_group_${group.group_id}`
          ),
        ]);
      }
      buttons.push([Markup.button.callback('✅ Select All', 'share_post_select_all')]);
      buttons.push([Markup.button.callback('⬜ Clear Selection', 'share_post_clear_selection')]);
      buttons.push([Markup.button.callback('➡️ Continue', 'share_post_continue_to_media')]);
      buttons.push([Markup.button.callback('❌ Cancel', 'admin_cancel')]);
      const selectedCount = targetGroups.length;
      const message = `📤 *Compartir Publicación en Comunidad*\n\n`
        + `*Paso 1/9: Selecciona Grupos*\n\n`
        + `Grupos seleccionados: *${selectedCount}*\n\n`
        + `━━━━━━━━━━━━━━━━━\n\n`
        + `💡 *Tip:* Puedes seleccionar múltiples grupos o todos de una vez.`;
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      logger.error('Error selecting group:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  bot.action('share_post_select_all', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      // Ensure session structure exists
      if (!ctx.session.temp) ctx.session.temp = {};
      if (!ctx.session.temp.communityPostData) ctx.session.temp.communityPostData = {};
      const groups = await communityPostService.getCommunityGroups();
      const groupIds = groups.map((g) => g.group_id);
      ctx.session.temp.communityPostData.targetGroups = groupIds;
      await ctx.saveSession();
      await ctx.answerCbQuery(`✅ Todos los ${groups.length} grupos seleccionados`);
      // Refresh UI
      const buttons = [];
      for (const group of groups) {
        buttons.push([
          Markup.button.callback(
            `✅ ${group.icon} ${group.name}`,
            `share_post_group_${group.group_id}`
          ),
        ]);
      }
      buttons.push([Markup.button.callback('✅ Select All', 'share_post_select_all')]);
      buttons.push([Markup.button.callback('⬜ Clear Selection', 'share_post_clear_selection')]);
      buttons.push([Markup.button.callback('➡️ Continue', 'share_post_continue_to_media')]);
      buttons.push([Markup.button.callback('❌ Cancel', 'admin_cancel')]);
      await ctx.editMessageText(
        `📤 *Compartir Publicación en Comunidad*\n\n`
        + `*Paso 1/9: Selecciona Grupos*\n\n`
        + `Grupos seleccionados: *${groups.length}* (todos)`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      logger.error('Error selecting all groups:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  bot.action('share_post_clear_selection', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      // Ensure session structure exists
      if (!ctx.session.temp) ctx.session.temp = {};
      if (!ctx.session.temp.communityPostData) ctx.session.temp.communityPostData = {};
      ctx.session.temp.communityPostData.targetGroups = [];
      await ctx.saveSession();
      await ctx.answerCbQuery('⬜ Selección borrada');
      const groups = await communityPostService.getCommunityGroups();
      const buttons = [];
      for (const group of groups) {
        buttons.push([
          Markup.button.callback(
            `⬜ ${group.icon} ${group.name}`,
            `share_post_group_${group.group_id}`
          ),
        ]);
      }
      buttons.push([Markup.button.callback('✅ Select All', 'share_post_select_all')]);
      buttons.push([Markup.button.callback('⬜ Clear Selection', 'share_post_clear_selection')]);
      buttons.push([Markup.button.callback('➡️ Continue', 'share_post_continue_to_media')]);
      buttons.push([Markup.button.callback('❌ Cancel', 'admin_cancel')]);
      await ctx.editMessageText(
        `📤 *Compartir Publicación en Comunidad*\n\n`
        + `*Paso 1/9: Selecciona Grupos*\n\n`
        + `Grupos seleccionados: *0*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      logger.error('Error clearing selection:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
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
      const postDestinations = ctx.session.temp?.communityPostData?.postDestinations || [];
      if (postDestinations.length === 0) {
        await ctx.answerCbQuery('❌ Debes seleccionar al menos un destino');
        return;
      }
      ctx.session.temp.communityPostStep = 'upload_media';
      await ctx.saveSession();
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '📤 *Compartir Publicación en Comunidad*\n\n'
        + '*Paso 2/9: Subir Media (Opcional)*\n\n'
        + '📸 Puedes subir una foto o video para acompañar tu publicación.\n\n'
        + '💡 *Opciones:*\n'
        + '• 📷 Envía una foto (JPEG, PNG)\n'
        + '• 🎥 Envía un video (MP4, MOV)\n'
        + '• ➡️ Click "Sin Media" para continuar sin imagen/video\n\n'
        + '✅ *Videos grandes:* Se publican usando Telegram (sin re-subir) para soportar archivos muy grandes.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬜ Sin Media', 'share_post_skip_media')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
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
      ctx.session.temp.communityPostStep = 'write_text';
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
        { key: 'communityPostData.sourceChatId', value: ctx.chat.id },
        { key: 'communityPostData.sourceMessageId', value: ctx.message.message_id },
        { key: 'communityPostData.mediaType', value: 'photo' },
        { key: 'communityPostData.mediaFileId', value: photo.file_id },
        { key: 'communityPostStep', value: 'write_text' },
        { key: 'waitingForMedia', value: false }
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
        { key: 'communityPostData.sourceChatId', value: ctx.chat.id },
        { key: 'communityPostData.sourceMessageId', value: ctx.message.message_id },
        { key: 'communityPostData.mediaType', value: 'video' },
        { key: 'communityPostData.mediaFileId', value: video.file_id },
        { key: 'communityPostData.fileSizeMB', value: fileSizeMB },
        { key: 'communityPostStep', value: 'write_text' },
        { key: 'waitingForMedia', value: false }
      ]);
      await ctx.reply(`✅ Video guardado${fileSizeMB ? ` (${fileSizeMB} MB)` : ''}`);
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
    ctx.session.temp.communityPostStep = 'write_text';
    await ctx.saveSession();
    try {
      await ctx.editMessageText(
        '📤 *Compartir Publicación en Comunidad*\n\n'
        + '*Paso 3/9: Escribir Texto*\n\n'
        + '✍️ Envía el texto de tu publicación.\n\n'
        + '💡 *Tip:* Puedes usar *negrita* y _cursiva_.\n\n'
        + '📝 *Límites:* 1024 si hay media / 4096 si es solo texto',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🤖 AI Write (Grok)', 'share_post_ai_text')],
            [
              Markup.button.callback('👤 Incluir Lex', 'share_post_toggle_lex'),
              Markup.button.callback('😈 Incluir Santino', 'share_post_toggle_santino'),
            ],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (editError) {
      if (editError.response?.description?.includes("can't be edited")) {
        // Message can't be edited, send as new message instead
        await ctx.reply(
          '📤 *Compartir Publicación en Comunidad*\n\n'
          + '*Paso 3/9: Escribir Texto*\n\n'
          + '✍️ Envía el texto de tu publicación.\n\n'
          + '💡 *Tip:* Puedes usar *negrita* y _cursiva_.\n\n'
          + '📝 *Límites:* 1024 si hay media / 4096 si es solo texto',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🤖 AI Write (Grok)', 'share_post_ai_text')],
              [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
            ]),
          }
        );
      } else {
        throw editError; // Re-throw other errors
      }
    }
    ctx.session.temp.waitingForText = true;
    await ctx.saveSession();
  } // Added missing closing brace
  // Toggle Lex inclusion
  bot.action('share_post_toggle_lex', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      let includeLex = ctx.session.temp.communityPostData.includeLex || false;
      ctx.session.temp.communityPostData.includeLex = !includeLex;
      await ctx.saveSession();
      await ctx.answerCbQuery(ctx.session.temp.communityPostData.includeLex ? '✅ Incluido Lex' : '⬜ Excluido Lex');
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
      let includeSantino = ctx.session.temp.communityPostData.includeSantino || false;
      ctx.session.temp.communityPostData.includeSantino = !includeSantino;
      await ctx.saveSession();
      await ctx.answerCbQuery(ctx.session.temp.communityPostData.includeSantino ? '✅ Incluido Santino' : '⬜ Excluido Santino');
      await showTextInputStep(ctx);
    } catch (error) {
      logger.error('Error toggling Santino inclusion:', error);
    }
  });
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (!ctx.session.temp?.communityPostStep) return next();
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return next();
      const step = ctx.session.temp.communityPostStep;
      const text = ctx.message.text;
      // Check if this is a command (starts with /) - if so, pass to other handlers
      if (text && text.startsWith('/')) {
        return next();
      }
      if (step === 'ai_prompt') {
        const prompt = (text || '').trim();
        if (!prompt) return;
        try {
          const hasMedia = !!ctx.session.temp.communityPostData.mediaFileId;
          const includeLex = ctx.session.temp.communityPostData.includeLex;
          const includeSantino = ctx.session.temp.communityPostData.includeSantino;
          // Use optimized parallel bilingual generation
          const result = await GrokService.generateSharePost({
            prompt,
            hasMedia,
            includeLex,
            includeSantino,
          });
          ctx.session.temp.communityPostData.text = result.combined; // Use combined text
          ctx.session.temp.communityPostStep = 'select_buttons';
          await ctx.saveSession();
          const safeResult = sanitize.telegramMarkdown(result.combined);
          await ctx.reply(`✅ *AI draft saved*\n\n${safeResult}`, { parse_mode: 'Markdown' });
          await showButtonSelectionStep(ctx);
        } catch (e) {
          logger.error('AI generation error:', e);
          await ctx.reply(`❌ AI error: ${e.message}`);
        }
        return;
      }
      if (step === 'custom_link') {
        const parts = (text || '').split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2) {
          await ctx.reply('❌ Formato inválido. Usa: `Texto|https://link.com`', { parse_mode: 'Markdown' });
          return;
        }
        const [label, url] = parts;
        if (!/^https?:\/\//i.test(url)) {
          await ctx.reply('❌ El link debe comenzar con http:// o https://', { parse_mode: 'Markdown' });
          return;
        }
        const buttons = normalizeButtons(ctx.session.temp.communityPostData.buttons);
        buttons.push({ key: 'custom', text: label, type: 'url', target: url });
        ctx.session.temp.communityPostData.buttons = buttons;
        ctx.session.temp.communityPostStep = 'select_buttons';
        await ctx.saveSession();
        await ctx.reply('✅ Custom link agregado');
        await showButtonSelectionStep(ctx);
        return;
      }
      // Text input during write_text step
      if (step === 'write_text') {
        const hasMedia = !!ctx.session.temp.communityPostData.mediaFileId;
        const maxLen = hasMedia ? 1024 : 4096;
        if (text.length > maxLen) {
          await ctx.reply(`❌ El texto es demasiado largo (máximo ${maxLen} caracteres)`);
          return;
        }
        ctx.session.temp.communityPostData.text = text;
        ctx.session.temp.communityPostStep = 'select_buttons';
        ctx.session.temp.waitingForText = false;
        await ctx.saveSession();
        await showButtonSelectionStep(ctx);
        return;
      }
      // If no step matched, pass to other handlers
      return next();
    } catch (error) {
      logger.error('Error handling text input:', error);
      await ctx.reply('❌ Error al procesar el texto').catch(() => {});
      return next();
    }
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Select buttons
  // ═══════════════════════════════════════════════════════════════════════════
  async function showButtonSelectionStep(ctx) {
    try {
      const options = getSharePostButtonOptions();
      const selected = new Set((normalizeButtons(ctx.session.temp.communityPostData.buttons) || []).map((b) => (typeof b === 'string' ? JSON.parse(b).key : b.key)));
      const buttons = options.map((opt) => {
        const on = selected.has(opt.key);
        return [Markup.button.callback(`${on ? '✅' : '➕'} ${opt.text}`, `share_post_toggle_${opt.key}`)];
      });
      buttons.push([Markup.button.callback('➕ Custom Link', 'share_post_add_custom_link')]);
      buttons.push([Markup.button.callback('👀 Preview', 'share_post_preview')]);
      buttons.push([Markup.button.callback('❌ Cancelar', 'admin_cancel')]);
      try {
        await ctx.editMessageText(
          '📤 *Compartir Publicación en Comunidad*\n\n'
          + '*Paso 4/9: Seleccionar Botones*\n\n'
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
            '📤 *Compartir Publicación en Comunidad*\n\n'
            + '*Paso 4/9: Seleccionar Botones*\n\n'
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
      ctx.session.temp.communityPostStep = 'select_buttons';
      await ctx.saveSession();
    } catch (error) {
      logger.error('Error showing button selection:', error);
      await ctx.reply('❌ Error al mostrar botones').catch(() => {});
    }
  }
  bot.action(/^share_post_toggle_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      const key = ctx.match?.[1];
      if (!key) return;
      const options = getSharePostButtonOptions();
      const opt = options.find((o) => o.key === key);
      if (!opt) {
        await ctx.answerCbQuery('❌ Botón no encontrado');
        return;
      }
      const current = normalizeButtons(ctx.session.temp.communityPostData.buttons);
      const idx = current.findIndex((b) => (typeof b === 'string' ? JSON.parse(b).key : b.key) === key);
      if (idx >= 0) {
        current.splice(idx, 1);
        await ctx.answerCbQuery('Removed');
      } else {
        current.push(opt);
        await ctx.answerCbQuery('Added');
      }
      ctx.session.temp.communityPostData.buttons = current;
      await ctx.saveSession();
      await showButtonSelectionStep(ctx);
    } catch (error) {
      logger.error('Error toggling share post button:', error);
    }
  });
  bot.action('share_post_add_custom_link', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      ctx.session.temp.communityPostStep = 'custom_link';
      await ctx.saveSession();
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '🔗 *Custom Link*\n\nEnvía: `Texto|https://link.com`',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', 'share_post_back_to_buttons')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
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
      ctx.session.temp.communityPostStep = 'select_buttons';
      await ctx.saveSession();
      await showButtonSelectionStep(ctx);
    } catch (error) {
      logger.error('Error in share_post_back_to_buttons:', error);
    }
  });
  // Preview + send now (broadcast-like flow)
  bot.action('share_post_preview', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const postData = ctx.session.temp.communityPostData;
      const caption = buildPostCaption(postData);
      const kb = buildInlineKeyboard(postData.buttons);
      // Render a preview message (copy media to admin chat if present to support very large videos)
      if (postData.sourceChatId && postData.sourceMessageId) {
        try {
          await ctx.telegram.copyMessage(ctx.chat.id, postData.sourceChatId, postData.sourceMessageId, {
            caption,
            parse_mode: 'Markdown',
            ...(kb ? { reply_markup: kb.reply_markup } : {}),
          });
        } catch (e) {
          logger.warn('Preview copyMessage failed (continuing):', e.message);
        }
      } else if (caption) {
        await ctx.reply(caption, { parse_mode: 'Markdown', ...(kb ? { reply_markup: kb.reply_markup } : {}) });
      }
      await ctx.reply(
        '👀 *Preview*\n\n¿Enviar ahora a los destinos seleccionados?',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Send Now', 'share_post_confirm_and_send')],
            [Markup.button.callback('🔘 Edit Buttons', 'share_post_back_to_buttons')],
            [Markup.button.callback('❌ Cancel', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error in share_post_preview:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Select template
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('share_post_continue_to_template', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      ctx.session.temp.communityPostStep = 'select_template';
      await ctx.saveSession();
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '📤 *Compartir Publicación en Comunidad*\n\n'
        + '*Paso 5/9: Seleccionar Plantilla*\n\n'
        + '🎨 Elige el estilo visual de tu publicación:\n\n'
        + '📝 *Standard* - Formato limpio y simple\n'
        + '✨ *Featured* - Destacada con bordes\n'
        + '📢 *Announcement* - Anuncio importante\n'
        + '🎪 *Event* - Formato para eventos',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 Standard', 'share_post_template_standard')],
            [Markup.button.callback('✨ Featured', 'share_post_template_featured')],
            [Markup.button.callback('📢 Announcement', 'share_post_template_announcement')],
            [Markup.button.callback('🎪 Event', 'share_post_template_event')],
            [Markup.button.callback('➡️ Continuar', 'share_post_continue_to_recurrence')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing template selection:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  bot.action(/^share_post_template_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      const templateType = ctx.match[1];
      ctx.session.temp.communityPostData.templateType = templateType;
      await ctx.saveSession();
      await ctx.answerCbQuery(`✅ Plantilla: ${templateType}`);
    } catch (error) {
      logger.error('Error selecting template:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Select recurrence
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('share_post_continue_to_recurrence', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      ctx.session.temp.communityPostStep = 'select_recurrence';
      await ctx.saveSession();
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '📤 *Compartir Publicación en Comunidad*\n\n'
        + '*Paso 6/9: Configurar Recurrencia*\n\n'
        + '🔄 ¿Quieres que la publicación se repita?\n\n'
        + '📅 *Opciones:*\n'
        + '• Una sola vez\n'
        + '• Diariamente\n'
        + '• Semanalmente\n'
        + '• Mensualmente\n\n'
        + '💡 Para publicaciones únicas, elige "Una sola vez"',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('1️⃣ Una sola vez', 'share_post_recurrence_once')],
            [Markup.button.callback('📅 Diariamente', 'share_post_recurrence_daily')],
            [Markup.button.callback('📆 Semanalmente', 'share_post_recurrence_weekly')],
            [Markup.button.callback('📋 Mensualmente', 'share_post_recurrence_monthly')],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error showing recurrence selection:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  bot.action(/^share_post_recurrence_(.+)$/, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      const recurrenceType = ctx.match[1];
      if (recurrenceType === 'once') {
        ctx.session.temp.communityPostData.isRecurring = false;
        ctx.session.temp.communityPostData.recurrencePattern = null;
        await ctx.answerCbQuery('1️⃣ Una sola vez');
      } else {
        ctx.session.temp.communityPostData.isRecurring = true;
        ctx.session.temp.communityPostData.recurrencePattern = recurrenceType;
        await ctx.answerCbQuery(`✅ Recurrencia: ${recurrenceType}`);
      }
      ctx.session.temp.communityPostStep = 'select_schedule_count';
      await ctx.saveSession();
      // Show schedule count selection
      await ctx.editMessageText(
        '📤 *Compartir Publicación en Comunidad*\n\n'
        + '*Paso 7/9: Cantidad de Programaciones*\n\n'
        + '🗓️ ¿Cuántas veces deseas programar esta publicación?\n\n'
        + '💡 Ejemplo: Programa la misma publicación 3 veces en diferentes fechas/horas',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('1️⃣ Una', 'share_post_schedule_count_1'),
              Markup.button.callback('2️⃣ Dos', 'share_post_schedule_count_2'),
              Markup.button.callback('3️⃣ Tres', 'share_post_schedule_count_3'),
            ],
            [
              Markup.button.callback('4️⃣ Cuatro', 'share_post_schedule_count_4'),
              Markup.button.callback('5️⃣ Cinco', 'share_post_schedule_count_5'),
              Markup.button.callback('6️⃣ Seis', 'share_post_schedule_count_6'),
            ],
            [
              Markup.button.callback('7️⃣ Siete', 'share_post_schedule_count_7'),
              Markup.button.callback('8️⃣ Ocho', 'share_post_schedule_count_8'),
              Markup.button.callback('9️⃣ Nueve', 'share_post_schedule_count_9'),
            ],
            [
              Markup.button.callback('🔟 Diez', 'share_post_schedule_count_10'),
              Markup.button.callback('1️⃣1️⃣ Once', 'share_post_schedule_count_11'),
              Markup.button.callback('1️⃣2️⃣ Doce', 'share_post_schedule_count_12'),
            ],
            [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error selecting recurrence:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Schedule count
  // ═══════════════════════════════════════════════════════════════════════════
  for (let i = 1; i <= 12; i++) {
    bot.action(`share_post_schedule_count_${i}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) {
          await ctx.answerCbQuery('❌ No autorizado');
          return;
        }
        ctx.session.temp.communityPostData.scheduledCount = i;
        ctx.session.temp.communityPostData.currentScheduleIndex = 0;
        ctx.session.temp.communityPostData.scheduledTimes = [];
        ctx.session.temp.communityPostStep = 'enter_schedule_datetime';
        ctx.session.temp.communityPostTimezone = ctx.session.temp.communityPostTimezone || DEFAULT_TZ;
        await ctx.saveSession();
        await ctx.answerCbQuery();
        const { text, keyboard } = dateTimePicker.getSchedulingMenu('es', 'community_post_sched');
        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } catch (error) {
        logger.error('Error selecting schedule count:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Inline date/time picker for schedule dates
  // ═══════════════════════════════════════════════════════════════════════════
  const COMMUNITY_PREFIX = 'community_post_sched';
  const DEFAULT_TZ = 'America/Bogota';

  const handleCommunityScheduledDate = async (ctx, scheduledDate) => {
    const totalCount = ctx.session.temp.communityPostData.scheduledCount;
    const scheduledTimes = ctx.session.temp.communityPostData.scheduledTimes || [];
    scheduledTimes.push(scheduledDate);
    ctx.session.temp.communityPostData.scheduledTimes = scheduledTimes;
    await ctx.saveSession();

    const currentIndex = scheduledTimes.length;
    if (currentIndex < totalCount) {
      const tz = ctx.session.temp.communityPostTimezone || DEFAULT_TZ;
      const formattedDate = dateTimePicker.formatDate(scheduledDate, 'es', tz);
      const text = `✅ *Programación ${currentIndex}/${totalCount} Guardada*\n\n`
        + `📅 ${formattedDate} ${tz}\n\n`
        + '¿Programar la siguiente fecha?';
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Programar siguiente', `${COMMUNITY_PREFIX}_next`)],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      });
      return;
    }

    ctx.session.temp.communityPostStep = 'preview';
    await ctx.saveSession();
    await ctx.editMessageText('✅ Todas las fechas guardadas', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👀 Ver vista previa', 'share_post_preview_after_schedule')],
      ]),
    });
  };

  const presetCount = dateTimePicker.getQuickPresetHours().length;
  for (let i = 0; i < presetCount; i++) {
    bot.action(`${COMMUNITY_PREFIX}_preset_${i}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) return;
        await ctx.answerCbQuery();
        const scheduledDate = dateTimePicker.calculatePresetDate(i);
        if (!scheduledDate) return;
        const tz = ctx.session.temp.communityPostTimezone || DEFAULT_TZ;
        const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', COMMUNITY_PREFIX);
        ctx.session.temp.communityPostTempDate = scheduledDate.toISOString();
        await ctx.saveSession();
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
      } catch (error) {
        logger.error('Error handling community preset:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  bot.action(`${COMMUNITY_PREFIX}_open_calendar`, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const now = new Date();
      const { text, keyboard } = dateTimePicker.getCalendarView(now.getFullYear(), now.getMonth(), 'es', COMMUNITY_PREFIX);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error opening community calendar:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${COMMUNITY_PREFIX}_month_(\\d{4})_(-?\\d+)$`), async (ctx) => {
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
      const { text, keyboard } = dateTimePicker.getCalendarView(year, month, 'es', COMMUNITY_PREFIX);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error navigating community month:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${COMMUNITY_PREFIX}_date_(\\d{4})_(\\d+)_(\\d+)$`), async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const parsed = dateTimePicker.parseDateCallback(ctx.match[0]);
      if (!parsed) return;
      const { year, month, day } = parsed;
      const { text, keyboard } = dateTimePicker.getTimeSelectionView(year, month, day, 'es', COMMUNITY_PREFIX);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error selecting community date:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${COMMUNITY_PREFIX}_time_(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})_(\\d{2})$`), async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const parsed = dateTimePicker.parseTimeCallback(ctx.match[0]);
      if (!parsed) return;
      const { year, month, day, hour, minute } = parsed;
      const tz = ctx.session.temp.communityPostTimezone || DEFAULT_TZ;
      const scheduledDate = dateTimePicker.buildDateInTimeZone(
        { year, month, day, hour, minute },
        tz
      );
      if (scheduledDate <= new Date()) {
        await ctx.answerCbQuery('❌ La hora seleccionada ya pasó', { show_alert: true });
        return;
      }
      const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', COMMUNITY_PREFIX);
      ctx.session.temp.communityPostTempDate = scheduledDate.toISOString();
      await ctx.saveSession();
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error selecting community time:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(new RegExp(`^${COMMUNITY_PREFIX}_custom_time_(\\d{4})-(\\d{2})-(\\d{2})$`), async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const match = ctx.match[0].match(/custom_time_(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return;
      const [, year, month, day] = match;
      ctx.session.temp.communityPostCustomDate = { year: parseInt(year, 10), month: parseInt(month, 10) - 1, day: parseInt(day, 10) };
      ctx.session.temp.communityPostStep = 'custom_time_input';
      await ctx.saveSession();
      const monthName = dateTimePicker.MONTHS_FULL.es[parseInt(month, 10) - 1];
      const formattedDate = `${day} ${monthName} ${year}`;
      await ctx.editMessageText(
        `⌨️ *Hora Personalizada*\n\n📅 Fecha: *${formattedDate}*\n\nEscribe la hora en formato HH:MM (24 horas)`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Volver', `${COMMUNITY_PREFIX}_date_${year}_${parseInt(month, 10) - 1}_${day}`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error requesting community custom time:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(`${COMMUNITY_PREFIX}_confirm`, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const scheduledIso = ctx.session.temp.communityPostTempDate;
      if (!scheduledIso) return;
      const scheduledDate = new Date(scheduledIso);
      await handleCommunityScheduledDate(ctx, scheduledDate);
    } catch (error) {
      logger.error('Error confirming community schedule:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action(`${COMMUNITY_PREFIX}_change_tz`, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '🌍 *Zona Horaria*\n\nSelecciona tu zona horaria:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🇨🇴 Bogotá', `${COMMUNITY_PREFIX}_tz_America/Bogota`)],
            [Markup.button.callback('🇺🇸 New York', `${COMMUNITY_PREFIX}_tz_America/New_York`)],
            [Markup.button.callback('🇺🇸 Los Angeles', `${COMMUNITY_PREFIX}_tz_America/Los_Angeles`)],
            [Markup.button.callback('🇲🇽 Mexico City', `${COMMUNITY_PREFIX}_tz_America/Mexico_City`)],
            [Markup.button.callback('🇪🇸 Madrid', `${COMMUNITY_PREFIX}_tz_Europe/Madrid`)],
            [Markup.button.callback('🇬🇧 London', `${COMMUNITY_PREFIX}_tz_Europe/London`)],
            [Markup.button.callback('🌐 UTC', `${COMMUNITY_PREFIX}_tz_UTC`)],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error changing community timezone:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  const communityTimezones = [
    'America/Bogota',
    'America/New_York',
    'America/Los_Angeles',
    'America/Mexico_City',
    'Europe/Madrid',
    'Europe/London',
    'UTC',
  ];

  for (const tz of communityTimezones) {
    bot.action(`${COMMUNITY_PREFIX}_tz_${tz}`, async (ctx) => {
      try {
        const isAdmin = await PermissionService.isAdmin(ctx.from.id);
        if (!isAdmin) return;
        await ctx.answerCbQuery();
        ctx.session.temp.communityPostTimezone = tz;
        await ctx.saveSession();
        const scheduledIso = ctx.session.temp.communityPostTempDate;
        if (!scheduledIso) return;
        const scheduledDate = new Date(scheduledIso);
        const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', COMMUNITY_PREFIX);
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
      } catch (error) {
        logger.error('Error setting community timezone:', error);
        await ctx.answerCbQuery('❌ Error').catch(() => {});
      }
    });
  }

  bot.action(`${COMMUNITY_PREFIX}_next`, async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      const { text, keyboard } = dateTimePicker.getSchedulingMenu('es', COMMUNITY_PREFIX);
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      logger.error('Error moving to next community schedule:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  bot.action('share_post_preview_after_schedule', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) return;
      await ctx.answerCbQuery();
      await showPreviewStep(ctx);
    } catch (error) {
      logger.error('Error showing preview after schedule:', error);
      await ctx.answerCbQuery('❌ Error').catch(() => {});
    }
  });

  // Handle custom time input for community posts
  bot.on('text', async (ctx, next) => {
    try {
      if (ctx.chat?.type && ctx.chat.type !== 'private') return next();
      if (ctx.session.temp?.communityPostStep !== 'custom_time_input') return next();
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
      const dateInfo = ctx.session.temp.communityPostCustomDate;
      if (!dateInfo) {
        await ctx.reply('❌ Sesión expirada. Selecciona la fecha de nuevo.');
        return;
      }
      const tz = ctx.session.temp.communityPostTimezone || DEFAULT_TZ;
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
      ctx.session.temp.communityPostTempDate = scheduledDate.toISOString();
      ctx.session.temp.communityPostStep = 'enter_schedule_datetime';
      await ctx.saveSession();
      const { text, keyboard } = dateTimePicker.getConfirmationView(scheduledDate, tz, 'es', COMMUNITY_PREFIX);
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      return;
    } catch (error) {
      logger.error('Error handling community custom time input:', error);
      await ctx.reply('❌ Error al procesar la hora').catch(() => {});
      return next();
    }
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 9: Preview
  // ═══════════════════════════════════════════════════════════════════════════
  async function showPreviewStep(ctx) {
    try {
      const postData = ctx.session.temp.communityPostData;
      // Format preview message
      let previewText = '📤 *Compartir Publicación en Comunidad*\n\n'
        + '*Paso 9/9: Vista Previa*\n\n'
        + '━━━━━━━━━━━━━━━━━\n'
        + '*VISTA PREVIA:*\n'
        + '━━━━━━━━━━━━━━━━━\n\n';
      if (postData.mediaType) {
        previewText += `[${String(postData.mediaType).toUpperCase()}]\n\n`;
      }
      previewText += postData.text ? `📢 ${postData.text}\n\n` : '';
      previewText += '\n━━━━━━━━━━━━━━━━━\n'
        + '*CONFIGURACIÓN:*\n'
        + '━━━━━━━━━━━━━━━━━\n'
        + `Destinos: ${(postData.postDestinations || []).length}\n`
        + `Botones: ${postData.buttons.length}\n`;
      await ctx.editMessageText(previewText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Enviar', 'share_post_confirm_and_send')],
          [Markup.button.callback('❌ Cancelar', 'admin_cancel')],
        ]),
      });
      ctx.session.temp.communityPostStep = 'preview';
      await ctx.saveSession();
    } catch (error) {
      logger.error('Error showing preview:', error);
      await ctx.reply('❌ Error al mostrar vista previa').catch(() => {});
    }
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL: Confirm and send
  // ═══════════════════════════════════════════════════════════════════════════
  bot.action('share_post_confirm_and_send', async (ctx) => {
    try {
      const isAdmin = await PermissionService.isAdmin(ctx.from.id);
      if (!isAdmin) {
        await ctx.answerCbQuery('❌ No autorizado');
        return;
      }
      const postData = ctx.session.temp.communityPostData;
      // Validate all required fields
      if (!postData.postDestinations?.length) {
        await ctx.answerCbQuery('❌ Debes seleccionar al menos un destino');
        return;
      }
      if (!postData.text) {
        await ctx.answerCbQuery('❌ Debes escribir el texto');
        return;
      }
      await ctx.answerCbQuery('⏳ Enviando...');
      const caption = buildPostCaption(postData);
      const kb = buildInlineKeyboard(postData.buttons);
      let sent = 0;
      let failed = 0;
      for (const destId of postData.postDestinations) {
        try {
          if (postData.sourceChatId && postData.sourceMessageId) {
            await ctx.telegram.copyMessage(destId, postData.sourceChatId, postData.sourceMessageId, {
              caption,
              parse_mode: 'Markdown',
              ...(kb ? { reply_markup: kb.reply_markup } : {}),
            });
          } else {
            await ctx.telegram.sendMessage(destId, caption, {
              parse_mode: 'Markdown',
              ...(kb ? { reply_markup: kb.reply_markup } : {}),
            });
          }
          sent += 1;
        } catch (e) {
          failed += 1;
          logger.error('Failed to send shared post', { destId, error: e.message });
        }
      }
      // Clear session
      ctx.session.temp = {};
      await ctx.saveSession();
      const message = `✅ *Publicación Enviada*\n\n`
        + `📊 Destinos: ${postData.postDestinations.length}\n`
        + `✓ Enviados: ${sent}\n`
        + `✗ Fallidos: ${failed}`;
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📤 Nueva Publicación', 'admin_share_post_to_groups')],
          [Markup.button.callback('⬅️ Panel Admin', 'admin_dashboard')],
        ]),
      });
      logger.info('Community post sent now', {
        adminId: ctx.from.id,
        destinations: postData.postDestinations.length,
        sent,
        failed,
      });
    } catch (error) {
      logger.error('Error confirming and sending post:', error);
      await ctx.answerCbQuery('❌ Error al enviar publicación').catch(() => {});
      await ctx.reply(`❌ Error: ${error.message}`).catch(() => {});
    }
  });
};
module.exports = registerCommunityPostHandlers;
