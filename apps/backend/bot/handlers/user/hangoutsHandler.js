const { Markup } = require('telegraf');
const VideoCallModel = require('../../../models/videoCallModel');
const MainRoomModel = require('../../../models/mainRoomModel');
const logger = require('../../../utils/logger');
const { hasFullAccess, safeReplyOrEdit } = require('../../utils/helpers');
const { consumeRateLimit, getRateLimitInfo } = require('../../core/middleware/rateLimitGranular');
const { buildHangoutsWebAppUrl } = require('../../utils/hangoutsWebApp');
const { buildJitsiHangoutsUrl, buildJitsiRoomConfig } = require('../../utils/jitsiHangoutsWebApp');
const jaasService = require('../../services/jaasService');
const FeatureUrlService = require('../../services/featureUrlService');

/**
 * Hangouts handlers for video calls and main rooms
 * @param {Telegraf} bot - Bot instance
 */
const registerHangoutsHandlers = (bot) => {
  const HANGOUTS_WEB_APP_URL = process.env.HANGOUTS_WEB_APP_URL || 'https://pnptv.app/hangouts';

  /**
   * Web-first /hangout command
   * Calls backend API to get the Hangouts web app URL
   */
  bot.command('hangout', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const userId = ctx.from?.id;

      if (!userId) {
        await ctx.reply(lang === 'es' ? '❌ Usuario no identificado.' : '❌ User not identified.');
        return;
      }

      // Call the API service to get the hangout URL
      const webAppUrl = await FeatureUrlService.getHangoutUrl(userId);

      const message = lang === 'es'
        ? '🎥 *PNP Hangouts* ha sido movido a nuestra aplicación web para una mejor experiencia.'
        : '🎥 *PNP Hangouts* has been moved to our web app for a better experience.';

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp(lang === 'es' ? '🚀 Abrir Hangouts' : '🚀 Open Hangouts', webAppUrl)],
        ]),
      });
    } catch (error) {
      logger.error('Error in /hangout command:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.reply(lang === 'es' ? '❌ No se pudo cargar Hangouts.' : '❌ Could not load Hangouts.');
    }
  });

  // ==========================================
  // HANGOUTS MENU
  // ==========================================

  /**
   * Show hangouts menu (replaces menu_hangouts in menu.js)
   * This provides the full hangouts experience with video calls and main rooms
   */
  bot.action('hangouts_menu', async (ctx) => {
    try {
      const lang = ctx.session?.language || 'en';
      const user = ctx.session?.user || {};
      const userId = ctx.from?.id;

      // Check if admin for pre-launch testing
      const PermissionService = require('../../services/permissionService');
      const isAdmin = PermissionService.isEnvSuperAdmin(userId) || PermissionService.isEnvAdmin(userId);

      if (isAdmin) {
        // Show full hangouts menu for admin testing
        await showHangoutsMenu(ctx);
      } else {
        // Coming soon for regular users
        await ctx.answerCbQuery(
          lang === 'es' ? '🚧 ESTRENO EL FIN DE SEMANA' : '🚧 COMING OUT THIS WEEKEND',
          { show_alert: true }
        );
      }
    } catch (error) {
      logger.error('Error in hangouts_menu:', error);
    }
  });

  /**
   * Show the full hangouts menu
   * @param {Context} ctx - Telegraf context
   */
  async function showHangoutsMenu(ctx) {
    try {
      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'en';
      const user = ctx.session?.user || {};
      const userId = ctx.from?.id;

      // Get public calls
      let publicCalls = [];
      try {
        publicCalls = await VideoCallModel.getAllPublic();
      } catch (e) {
        logger.warn('Error fetching public calls:', e.message);
      }

      // Get main rooms
      let mainRooms = [];
      try {
        mainRooms = await MainRoomModel.getAll();
      } catch (e) {
        logger.warn('Error fetching main rooms:', e.message);
      }

      const message = lang === 'es'
        ? `🎥 *PNP Hangouts*\n\n` +
          `Videollamadas y salas comunitarias.\n\n` +
          `📞 *Llamadas Activas:* ${publicCalls.length}\n` +
          `🏠 *Salas Principales:* ${mainRooms.length}\n\n` +
          `Elige una opción:`
        : `🎥 *PNP Hangouts*\n\n` +
          `Video calls and community rooms.\n\n` +
          `📞 *Active Calls:* ${publicCalls.length}\n` +
          `🏠 *Main Rooms:* ${mainRooms.length}\n\n` +
          `Choose an option:`;

      // Build room buttons
      const roomButtons = mainRooms.slice(0, 3).map(room => [
        Markup.button.callback(
          `🏠 ${room.name} (${room.currentParticipants}/${room.maxParticipants})`,
          `join_main_room_${room.id}`
        )
      ]);

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(lang === 'es' ? '🎥 Crear Videollamada' : '🎥 Create Video Call', 'create_video_call')],
          [Markup.button.callback(lang === 'es' ? '📋 Mis Llamadas' : '📋 My Calls', 'my_active_calls')],
          ...roomButtons,
          [Markup.button.callback(lang === 'es' ? '⬅️ Menú Principal' : '⬅️ Main Menu', 'back_to_main')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing hangouts menu:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        lang === 'es' ? '❌ Error cargando menú' : '❌ Error loading menu',
        { show_alert: true }
      );
    }
  }

  // ==========================================
  // VIDEO CALLS (PRIME ONLY)
  // ==========================================

  /**
   * Create a new video call
   */
  bot.action('create_video_call', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'en';
      const user = ctx.session?.user || {};
      const userId = ctx.from?.id;

      // Check access (PRIME or Admin for pre-launch testing)
      if (!hasFullAccess(user, userId)) {
        const message = lang === 'es'
          ? '🔒 *Función PRIME*\n\nLas videollamadas requieren membresía PRIME.'
          : '🔒 *PRIME Feature*\n\nVideo calls require PRIME membership.';

        await safeReplyOrEdit(ctx, message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '💎 Ver Planes' : '💎 View Plans', 'show_subscription_plans')],
            [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'hangouts_menu')],
          ]),
        });
        return;
      }

      // Rate limit check (max 5 calls per hour)
      const allowed = await consumeRateLimit(userId.toString(), 'videocall');
      if (!allowed) {
        const rateLimitInfo = await getRateLimitInfo(userId.toString(), 'videocall');
        const waitTime = rateLimitInfo?.resetIn || 1800;
        const waitMinutes = Math.ceil(waitTime / 60);

        const message = lang === 'es'
          ? `⏱ *Límite Alcanzado*\n\nHas creado demasiadas llamadas. Por favor espera ${waitMinutes} minutos antes de crear otra.`
          : `⏱ *Limit Reached*\n\nYou've created too many calls. Please wait ${waitMinutes} minutes before creating another.`;

        await safeReplyOrEdit(ctx, message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '📋 Mis Llamadas' : '📋 My Calls', 'my_active_calls')],
            [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'hangouts_menu')],
          ]),
        });
        return;
      }

      // Create the call
      const call = await VideoCallModel.create({
        creatorId: ctx.from.id,
        creatorName: ctx.from.first_name || ctx.from.username || 'User',
        isPublic: false,
        maxParticipants: 10,
      });

      const displayName = ctx.from.first_name || ctx.from.username || 'User';

      // Generate Jitsi URL with JAAS authentication (primary)
      const jitsiUrl = buildJitsiHangoutsUrl({
        roomName: call.channelName,
        userId: ctx.from.id,
        userName: displayName,
        isModerator: true,
        callId: call.id,
        type: call.isPublic ? 'public' : 'private',
      });

      // Generate Agora WebApp URL (fallback)
      const agoraUrl = buildHangoutsWebAppUrl({
        baseUrl: HANGOUTS_WEB_APP_URL,
        room: call.channelName,
        token: call.rtcToken,
        uid: ctx.from.id,
        username: displayName,
        type: call.isPublic ? 'public' : 'private',
        appId: call.appId,
        callId: call.id,
      });

      const joinLink = `https://t.me/${ctx.botInfo.username}?start=call_${call.id}`;

      const message = lang === 'es'
        ? `✅ *¡Videollamada Creada!*\n\n` +
          `👥 Capacidad: 0/10 personas\n` +
          `🔗 Comparte: \`${joinLink}\`\n\n` +
          `Elige cómo quieres entrar:`
        : `✅ *Video Call Created!*\n\n` +
          `👥 Capacity: 0/10 people\n` +
          `🔗 Share: \`${joinLink}\`\n\n` +
          `Choose how to join:`;

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(lang === 'es' ? '🎥 Entrar (Jitsi)' : '🎥 Join (Jitsi)', jitsiUrl)],
          [Markup.button.webApp(lang === 'es' ? '📱 Entrar (App)' : '📱 Join (App)', agoraUrl)],
          [Markup.button.callback(lang === 'es' ? '❌ Terminar Llamada' : '❌ End Call', `end_call_${call.id}`)],
          [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'hangouts_menu')],
        ]),
      });

      logger.info('Video call created', { callId: call.id, creatorId: ctx.from.id });
    } catch (error) {
      logger.error('Error creating video call:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        lang === 'es' ? '❌ Error creando llamada' : '❌ Error creating call',
        { show_alert: true }
      );
    }
  });

  /**
   * End a video call (creator only)
   */
  bot.action(/^end_call_(.+)$/, async (ctx) => {
    try {
      const callId = ctx.match[1];
      const lang = ctx.session?.language || 'en';

      await VideoCallModel.endCall(callId, ctx.from.id);

      await ctx.answerCbQuery(
        lang === 'es' ? '✅ Llamada terminada' : '✅ Call ended',
        { show_alert: true }
      );

      // Return to hangouts menu
      await ctx.editMessageText(
        lang === 'es' ? '📞 Llamada terminada. Volviendo al menú...' : '📞 Call ended. Returning to menu...',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '📞 Hangouts' : '📞 Hangouts', 'hangouts_menu')],
          ]),
        }
      );
    } catch (error) {
      logger.error('Error ending call:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        lang === 'es' ? '❌ Error terminando llamada' : '❌ Error ending call',
        { show_alert: true }
      );
    }
  });

  /**
   * Delete a video call (creator only, when empty)
   */
  bot.action(/^delete_call_(.+)$/, async (ctx) => {
    try {
      const callId = ctx.match[1];
      const lang = ctx.session?.language || 'en';

      await VideoCallModel.deleteCall(callId, ctx.from.id);

      await ctx.answerCbQuery(
        lang === 'es' ? '✅ Llamada eliminada' : '✅ Call deleted',
        { show_alert: true }
      );

      // Return to active calls
      await showActiveCalls(ctx);
    } catch (error) {
      logger.error('Error deleting call:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        error.message.includes('active participants')
          ? (lang === 'es' ? '❌ No se puede eliminar con participantes activos' : '❌ Cannot delete with active participants')
          : (lang === 'es' ? '❌ Error eliminando llamada' : '❌ Error deleting call'),
        { show_alert: true }
      );
    }
  });

  /**
   * Show user's active calls
   */
  bot.action('my_active_calls', async (ctx) => {
    await showActiveCalls(ctx);
  });

  async function showActiveCalls(ctx) {
    try {
      await ctx.answerCbQuery();
      const lang = ctx.session?.language || 'en';

      const calls = await VideoCallModel.getActiveByCreator(ctx.from.id);

      if (calls.length === 0) {
        const message = lang === 'es'
          ? '📋 *Mis Llamadas Activas*\n\nNo tienes llamadas activas.'
          : '📋 *My Active Calls*\n\nYou have no active calls.';

        await safeReplyOrEdit(ctx, message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '🎥 Crear Llamada' : '🎥 Create Call', 'create_video_call')],
            [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'hangouts_menu')],
          ]),
        });
        return;
      }

      const callButtons = calls.map(call => {
        const label = `📞 ${call.title || 'Call'} (${call.currentParticipants}/${call.maxParticipants})`;
        return [Markup.button.callback(label, `view_call_${call.id}`)];
      });

      const message = lang === 'es'
        ? `📋 *Mis Llamadas Activas*\n\nTienes ${calls.length} llamada(s) activa(s):`
        : `📋 *My Active Calls*\n\nYou have ${calls.length} active call(s):`;

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          ...callButtons,
          [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'hangouts_menu')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing active calls:', error);
    }
  }

  /**
   * View call details
   */
  bot.action(/^view_call_(.+)$/, async (ctx) => {
    try {
      const callId = ctx.match[1];
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery();
      const displayName = ctx.from.first_name || ctx.from.username || 'User';

      const joinResult = await VideoCallModel.joinCall(
        callId,
        ctx.from.id,
        displayName,
        false
      );

      const call = joinResult.call;
      const participantCount = call.currentParticipants + (joinResult.alreadyJoined ? 0 : 1);

      // Check if user is creator (moderator)
      const isModerator = call.creatorId === ctx.from.id;

      // Generate Jitsi URL with appropriate permissions
      const jitsiUrl = buildJitsiHangoutsUrl({
        roomName: call.channelName,
        userId: ctx.from.id,
        userName: displayName,
        isModerator,
        callId: call.id,
        type: call.isPublic ? 'public' : 'private',
      });

      // Generate Agora WebApp URL (fallback)
      const agoraUrl = buildHangoutsWebAppUrl({
        baseUrl: HANGOUTS_WEB_APP_URL,
        room: call.channelName,
        token: joinResult.rtcToken,
        uid: ctx.from.id,
        username: displayName,
        type: call.isPublic ? 'public' : 'private',
        appId: joinResult.appId,
        callId: call.id,
      });
      const joinLink = `https://t.me/${ctx.botInfo.username}?start=call_${call.id}`;

      const message = lang === 'es'
        ? `📞 *Detalles de Llamada*\n\n` +
          `👥 Participantes: ${participantCount}/${call.maxParticipants}\n` +
          `📅 Creada: ${new Date(call.createdAt).toLocaleString()}\n` +
          `🔗 Compartir: \`${joinLink}\`\n\n` +
          `Elige cómo quieres entrar:`
        : `📞 *Call Details*\n\n` +
          `👥 Participants: ${participantCount}/${call.maxParticipants}\n` +
          `📅 Created: ${new Date(call.createdAt).toLocaleString()}\n` +
          `🔗 Share: \`${joinLink}\`\n\n` +
          `Choose how to join:`;

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(lang === 'es' ? '🎥 Entrar (Jitsi)' : '🎥 Join (Jitsi)', jitsiUrl)],
          [Markup.button.webApp(lang === 'es' ? '📱 Entrar (App)' : '📱 Join (App)', agoraUrl)],
          [Markup.button.callback(lang === 'es' ? '❌ Terminar' : '❌ End', `end_call_${call.id}`)],
          [Markup.button.callback(lang === 'es' ? '🗑️ Eliminar' : '🗑️ Delete', `delete_call_${call.id}`)],
          [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'my_active_calls')],
        ]),
      });
    } catch (error) {
      logger.error('Error viewing call:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.answerCbQuery(
        error.message.includes('full')
          ? (lang === 'es' ? '❌ La llamada está llena' : '❌ Call is full')
          : (lang === 'es' ? '❌ Error cargando llamada' : '❌ Error loading call'),
        { show_alert: true }
      );
    }
  });

  // ==========================================
  // MAIN ROOMS (PRIME ONLY)
  // ==========================================

  /**
   * Join a main room
   */
  const joinMainRoom = async (ctx, roomId) => {
    try {
      const resolvedRoomId = Number(roomId);
      if (!Number.isFinite(resolvedRoomId)) {
        return;
      }
      const lang = ctx.session?.language || 'en';
      const user = ctx.session?.user || {};
      const userId = ctx.from?.id;

      // Check access - main rooms require PRIME or admin access
      if (!hasFullAccess(user, userId)) {
        const message = lang === 'es'
          ? '🔒 *Función PRIME*\n\nLas salas comunitarias requieren membresía PRIME.'
          : '🔒 *PRIME Feature*\n\nCommunity rooms require PRIME membership.';

        await safeReplyOrEdit(ctx, message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(lang === 'es' ? '💎 Ver Planes' : '💎 View Plans', 'show_subscription_plans')],
            [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'hangouts_menu')],
          ]),
        });
        return;
      }

      const room = await MainRoomModel.getById(resolvedRoomId);

      if (!room) {
        try {
          await ctx.answerCbQuery(
            lang === 'es' ? '❌ Sala no encontrada' : '❌ Room not found',
            { show_alert: true }
          );
        } catch {}
        return;
      }

      // Join the room (as viewer by default)
      const { rtcToken, appId } = await MainRoomModel.joinRoom(
        resolvedRoomId,
        ctx.from.id,
        ctx.from.first_name || ctx.from.username || 'User',
        false // Start as viewer
      );

      const displayName = ctx.from.first_name || ctx.from.username || 'User';

      // Generate authenticated Jitsi URL using JAAS (primary option)
      const roomNameForJitsi = `pnptv-main-room-${resolvedRoomId}`;
      const jitsiUrl = buildJitsiHangoutsUrl({
        roomName: roomNameForJitsi,
        userId: ctx.from.id,
        userName: displayName,
        isModerator: false, // Main room participants join as viewers
        type: 'main',
      });

      // Generate Agora WebApp URL (fallback)
      const agoraUrl = buildHangoutsWebAppUrl({
        baseUrl: HANGOUTS_WEB_APP_URL,
        room: room.channelName,
        token: rtcToken,
        uid: ctx.from.id,
        username: displayName,
        type: 'main',
        appId,
      });

      const message = lang === 'es'
        ? `🏠 *${room.name}*\n\n` +
          `${room.description}\n\n` +
          `👥 ${room.currentParticipants}/50 participantes\n\n` +
          `Elige cómo quieres entrar:`
        : `🏠 *${room.name}*\n\n` +
          `${room.description}\n\n` +
          `👥 ${room.currentParticipants}/50 participants\n\n` +
          `Choose how to join:`;

      await safeReplyOrEdit(ctx, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(lang === 'es' ? '🎥 Entrar (Jitsi)' : '🎥 Join (Jitsi)', jitsiUrl)],
          [Markup.button.webApp(lang === 'es' ? '📱 Entrar (App)' : '📱 Join (App)', agoraUrl)],
          [Markup.button.callback(lang === 'es' ? '⬅️ Volver' : '⬅️ Back', 'hangouts_menu')],
        ]),
      });

      logger.info('User joining main room', { roomId, userId: ctx.from.id });
    } catch (error) {
      logger.error('Error joining main room:', error);
      const lang = ctx.session?.language || 'en';

      if (error.message.includes('full')) {
        try {
          await ctx.answerCbQuery(
            lang === 'es' ? '❌ La sala está llena' : '❌ Room is full',
            { show_alert: true }
          );
        } catch {}
      } else {
        try {
          await ctx.answerCbQuery(
            lang === 'es' ? '❌ Error al entrar' : '❌ Error joining',
            { show_alert: true }
          );
        } catch {}
      }
    }
  };

  bot.action(/^join_main_room_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const roomId = parseInt(ctx.match[1], 10);
    return joinMainRoom(ctx, roomId);
  });

  bot.action('hangouts_join_main', async (ctx) => {
    await ctx.answerCbQuery();
    return joinMainRoom(ctx, 1);
  });

};

module.exports = registerHangoutsHandlers;
module.exports.registerHangoutsHandlers = registerHangoutsHandlers;
