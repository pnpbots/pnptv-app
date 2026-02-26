/**
 * Chat type detection middleware
 */

/**
 * Check if the chat is a group chat
 */
const isGroupChat = (ctx) => {
  return ['group', 'supergroup'].includes(ctx.chat?.type);
};

/**
 * Check if the chat is a private chat
 */
const isPrivateChat = (ctx) => {
  return ctx.chat?.type === 'private';
};

/**
 * Middleware to detect chat type and add to context
 */
const chatTypeMiddleware = () => {
  return async (ctx, next) => {
    ctx.chatType = ctx.chat?.type;
    ctx.isGroup = isGroupChat(ctx);
    ctx.isPrivate = isPrivateChat(ctx);
    return next();
  };
};

module.exports = {
  isGroupChat,
  isPrivateChat,
  chatTypeMiddleware,
};
