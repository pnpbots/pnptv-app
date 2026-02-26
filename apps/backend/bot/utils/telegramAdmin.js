const logger = require('../../utils/logger');

async function createChatInviteLink(ctx, chatId, name, memberLimit) {
  try {
    const inviteLink = await ctx.telegram.createChatInviteLink(chatId, {
      name,
      member_limit: memberLimit,
    });
    return inviteLink.invite_link;
  } catch (error) {
    logger.error('Error creating chat invite link:', error);
    return null;
  }
}

module.exports = {
  createChatInviteLink,
};
