const logger = require('../../../utils/logger');
const PermissionService = require('../../services/permissionService');

function isCrossChatAllowed(ctx) {
  if (ctx?.state?.allowCrossChatSend) return true;

  const temp = ctx?.session?.temp || {};
  if (
    temp.sharePostStep ||
    temp.sharePostData ||
    temp.communityPostData ||
    temp.broadcastStep ||
    temp.broadcastData ||
    temp.broadcastTarget ||
    temp.broadcastQueueMessage ||
    temp.adminMode ||
    temp.adminAction ||
    temp.adminSearchingUser
  ) {
    return true;
  }

  return false;
}

/**
 * Private Outbound Guard Middleware
 * Prevents bot messages initiated in private chat from being sent to other chats
 * unless explicitly allowed by session state.
 */
function privateOutboundGuardMiddleware() {
  return async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();
    if (!ctx.from?.id) return next();

    const originalSendMessage = ctx.telegram.sendMessage.bind(ctx.telegram);
    const originalSendPhoto = ctx.telegram.sendPhoto?.bind(ctx.telegram);
    const originalSendVideo = ctx.telegram.sendVideo?.bind(ctx.telegram);
    const originalSendDocument = ctx.telegram.sendDocument?.bind(ctx.telegram);
    const originalSendAnimation = ctx.telegram.sendAnimation?.bind(ctx.telegram);
    const originalSendVoice = ctx.telegram.sendVoice?.bind(ctx.telegram);
    const originalSendSticker = ctx.telegram.sendSticker?.bind(ctx.telegram);
    const originalSendMediaGroup = ctx.telegram.sendMediaGroup?.bind(ctx.telegram);
    const originalCopyMessage = ctx.telegram.copyMessage?.bind(ctx.telegram);
    const originalForwardMessage = ctx.telegram.forwardMessage?.bind(ctx.telegram);

    const isAdmin = await PermissionService.isAdmin(ctx.from.id).catch(() => false);

    const shouldBlock = (targetChatId) => {
      const targetId = targetChatId?.toString?.();
      const userId = ctx.from.id.toString();
      if (targetId === userId) return false;
      if (isCrossChatAllowed(ctx)) return false;
      if (isAdmin && isCrossChatAllowed(ctx)) return false;
      return true;
    };

    ctx.telegram.sendMessage = async (targetChatId, text, extra = {}) => {
      if (shouldBlock(targetChatId)) {
        logger.warn('Blocked cross-chat sendMessage from private chat', {
          from: ctx.from.id,
          targetChatId,
        });
        return null;
      }
      return originalSendMessage(targetChatId, text, extra);
    };

    if (originalSendPhoto) {
      ctx.telegram.sendPhoto = async (targetChatId, photo, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat sendPhoto from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalSendPhoto(targetChatId, photo, extra);
      };
    }

    if (originalSendVideo) {
      ctx.telegram.sendVideo = async (targetChatId, video, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat sendVideo from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalSendVideo(targetChatId, video, extra);
      };
    }

    if (originalSendDocument) {
      ctx.telegram.sendDocument = async (targetChatId, document, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat sendDocument from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalSendDocument(targetChatId, document, extra);
      };
    }

    if (originalSendAnimation) {
      ctx.telegram.sendAnimation = async (targetChatId, animation, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat sendAnimation from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalSendAnimation(targetChatId, animation, extra);
      };
    }

    if (originalSendVoice) {
      ctx.telegram.sendVoice = async (targetChatId, voice, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat sendVoice from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalSendVoice(targetChatId, voice, extra);
      };
    }

    if (originalSendSticker) {
      ctx.telegram.sendSticker = async (targetChatId, sticker, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat sendSticker from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalSendSticker(targetChatId, sticker, extra);
      };
    }

    if (originalSendMediaGroup) {
      ctx.telegram.sendMediaGroup = async (targetChatId, media, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat sendMediaGroup from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalSendMediaGroup(targetChatId, media, extra);
      };
    }

    if (originalCopyMessage) {
      ctx.telegram.copyMessage = async (targetChatId, fromChatId, messageId, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat copyMessage from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalCopyMessage(targetChatId, fromChatId, messageId, extra);
      };
    }

    if (originalForwardMessage) {
      ctx.telegram.forwardMessage = async (targetChatId, fromChatId, messageId, extra = {}) => {
        if (shouldBlock(targetChatId)) {
          logger.warn('Blocked cross-chat forwardMessage from private chat', {
            from: ctx.from.id,
            targetChatId,
          });
          return null;
        }
        return originalForwardMessage(targetChatId, fromChatId, messageId, extra);
      };
    }

    return next();
  };
}

module.exports = privateOutboundGuardMiddleware;
