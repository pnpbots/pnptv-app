const { getBroadcastTypeMenu, getConfirmationMenu, getBackButton } = require('../../utils/menus');
const { getLanguage } = require('../../utils/helpers');
const adminService = require('../../services/adminService');
const logger = require('../../../utils/logger');

/**
 * Handle broadcast menu
 */
async function handleBroadcastMenu(ctx) {
  try {
    const lang = getLanguage(ctx);
    const title = lang === 'es' ? '📢 **Mensajes de Difusión**' : '📢 **Broadcast Messages**';
    const subtitle = lang === 'es' ? '\n\nSelecciona el tipo de mensaje que quieres difundir:' : '\n\nSelect the type of message you want to broadcast:';

    await ctx.editMessageText(
      title + subtitle,
      {
        parse_mode: 'Markdown',
        reply_markup: getBroadcastTypeMenu(lang),
      }
    );

    logger.info(`Broadcast menu accessed by ${ctx.from.id}`);
  } catch (error) {
    logger.error('Error in broadcast menu:', error);
    const lang = getLanguage(ctx);
    const errorMsg = lang === 'es' ? '❌ Error cargando el menú de difusión' : '❌ Error loading broadcast menu';
    await ctx.answerCbQuery(errorMsg);
  }
}

/**
 * Handle broadcast type selection
 */
async function handleBroadcastType(ctx) {
  try {
    const lang = getLanguage(ctx);
    const type = ctx.callbackQuery.data.split('_')[1]; // 'broadcast_text' -> 'text'

    const typeLabels = {
      en: {
        text: 'text',
        photo: 'photo',
        video: 'video',
        enter: 'Enter the',
        forText: 'For text: Just type your message',
        forMedia: 'For media: Send the photo/video with a caption',
      },
      es: {
        text: 'texto',
        photo: 'foto',
        video: 'video',
        enter: 'Ingresa el',
        forText: 'Para texto: Solo escribe tu mensaje',
        forMedia: 'Para media: Envía la foto/video con una leyenda',
      },
    };

    const l = typeLabels[lang] || typeLabels.en;

    await ctx.editMessageText(
      `📝 ${l.enter} ${l[type]} message to broadcast:\n\n` +
      `${l.forText}\n` +
      `${l.forMedia}`
    );

    // Save session
    await ctx.saveSession({ broadcastType: type, waitingForBroadcast: true });

    logger.info(`Admin ${ctx.from.id} selected broadcast type: ${type}`);
  } catch (error) {
    logger.error('Error in broadcast type selection:', error);
    const lang = getLanguage(ctx);
    const errorMsg = lang === 'es' ? '❌ Error' : '❌ Error';
    await ctx.answerCbQuery(errorMsg);
  }
}

/**
 * Handle broadcast message input
 */
async function handleBroadcastInput(ctx, bot) {
  try {
    const session = ctx.session || {};

    if (!session.waitingForBroadcast) {
      return false;
    }

    const type = session.broadcastType;
    let message = '';
    let mediaUrl = null;
    let mediaType = null;

    if (type === 'text' && ctx.message.text) {
      message = ctx.message.text;
    } else if (type === 'photo' && ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      mediaUrl = photo.file_id;
      mediaType = 'photo';
      message = ctx.message.caption || '';
    } else if (type === 'video' && ctx.message.video) {
      mediaUrl = ctx.message.video.file_id;
      mediaType = 'video';
      message = ctx.message.caption || '';
    } else {
      const lang = getLanguage(ctx);
      const errorMsg = lang === 'es' ? '❌ Tipo de mensaje inválido. Por favor intente nuevamente.' : '❌ Invalid message type. Please try again.';
      await ctx.reply(errorMsg);
      return true;
    }

    // Show preview and confirmation
    const lang = getLanguage(ctx);
    const previewTitle = lang === 'es' ? '📢 **Vista Previa de Difusión**' : '📢 **Broadcast Preview**';
    const previewQuestion = lang === 'es' ? '\n\nEste mensaje será enviado a todos los usuarios. ¿Continuar?' : '\n\nThis message will be sent to all users. Continue?';

    const previewMessage = `${previewTitle}\n\n${message}${previewQuestion}`;

    await ctx.reply(previewMessage, {
      parse_mode: 'Markdown',
      reply_markup: getConfirmationMenu('broadcast', lang),
    });

    // Save broadcast data
    await ctx.saveSession({
      broadcastMessage: message,
      broadcastMediaUrl: mediaUrl,
      broadcastMediaType: mediaType,
      waitingForBroadcastConfirm: true,
      waitingForBroadcast: false,
    });

    return true;
  } catch (error) {
    logger.error('Error in broadcast input:', error);
    const lang = getLanguage(ctx);
    const errorMsg = lang === 'es' ? '❌ Error procesando la difusión' : '❌ Error processing broadcast';
    await ctx.reply(errorMsg);
    return false;
  }
}

/**
 * Handle broadcast confirmation
 */
async function handleBroadcastConfirm(ctx, bot) {
  try {
    const lang = getLanguage(ctx);
    const session = ctx.session || {};
    const confirmed = ctx.callbackQuery.data === 'confirm_broadcast';

    if (!confirmed) {
      const cancelledMsg = lang === 'es' ? '❌ Difusión cancelada' : '❌ Broadcast cancelled';
      await ctx.editMessageText(cancelledMsg);
      await ctx.clearSession();
      return;
    }

    const sendingMsg = lang === 'es' ? '📢 Enviando difusión...' : '📢 Sending broadcast...';
    await ctx.editMessageText(sendingMsg);

    // Send broadcast
    const results = await adminService.sendBroadcast(
      bot,
      ctx.from.id,
      session.broadcastMessage,
      {
        mediaUrl: session.broadcastMediaUrl,
        mediaType: session.broadcastMediaType,
      }
    );

    const resultLabels = {
      en: {
        completed: '✅ Broadcast completed!',
        total: '• Total users:',
        sent: '• Sent successfully:',
        failed: '• Failed:',
      },
      es: {
        completed: '✅ ¡Difusión completada!',
        total: '• Usuarios totales:',
        sent: '• Enviados con éxito:',
        failed: '• Fallidos:',
      },
    };

    const l = resultLabels[lang] || resultLabels.en;

    const resultMessage = `${l.completed}\n\n` +
      `${l.total} ${results.total}\n` +
      `${l.sent} ${results.sent}\n` +
      `${l.failed} ${results.failed}`;

    await ctx.editMessageText(resultMessage);
    await ctx.clearSession();

    logger.info(`Broadcast sent by admin ${ctx.from.id}: ${results.sent} sent, ${results.failed} failed`);
  } catch (error) {
    logger.error('Error in broadcast confirm:', error);
    const lang = getLanguage(ctx);
    const errorMsg = lang === 'es' ? '❌ Error enviando la difusión' : '❌ Error sending broadcast';
    await ctx.editMessageText(errorMsg);
  }
}

module.exports = {
  handleBroadcastMenu,
  handleBroadcastType,
  handleBroadcastInput,
  handleBroadcastConfirm,
};
