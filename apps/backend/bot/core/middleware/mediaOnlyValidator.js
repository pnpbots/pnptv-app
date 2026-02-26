const logger = require('../../../utils/logger');
const TopicConfigModel = require('../../../models/topicConfigModel');

/**
 * Media-Only Validator Middleware
 * Enforces media-only content rules for specific topics (e.g., Uncensored Room)
 */
function mediaOnlyValidator() {
  return async (ctx, next) => {
  const messageThreadId = ctx.message?.message_thread_id;

  if (!messageThreadId) {
    return next(); // Not in a topic
  }

  // Skip if message is from bot
  if (ctx.from?.is_bot) {
    return next();
  }

  try {
    // Get topic configuration
    const topicConfig = await TopicConfigModel.getByThreadId(messageThreadId);

    if (!topicConfig || !topicConfig.media_required) {
      return next(); // No media-only restriction
    }

    const message = ctx.message;
    const userId = ctx.from.id;

    // Check if message is a reply
    const isReply = !!message.reply_to_message;

    // Check if message contains allowed media
    const hasPhoto = !!message.photo;
    const hasVideo = !!message.video;
    const hasAnimation = !!message.animation;
    const hasSticker = !!message.sticker;
    const hasDocument = !!message.document;
    const hasVideoNote = !!message.video_note;
    const hasVoice = !!message.voice;
    const hasAudio = !!message.audio;

    // Parse allowed media from config (handle both string and object)
    let allowedMedia = [];
    try {
      if (typeof topicConfig.allowed_media === 'string') {
        allowedMedia = JSON.parse(topicConfig.allowed_media || '[]');
      } else if (Array.isArray(topicConfig.allowed_media)) {
        allowedMedia = topicConfig.allowed_media;
      }
    } catch (e) {
      logger.warn('Failed to parse allowed_media config:', e);
      allowedMedia = [];
    }

    const hasAllowedMedia = (
      (hasPhoto && allowedMedia.includes('photo')) ||
      (hasVideo && allowedMedia.includes('video')) ||
      (hasAnimation && allowedMedia.includes('animation')) ||
      (hasSticker && topicConfig.allow_stickers) ||
      (hasDocument && topicConfig.allow_documents) ||
      (hasVideoNote && allowedMedia.includes('video')) ||
      (hasVoice && allowedMedia.includes('voice')) ||
      (hasAudio && allowedMedia.includes('audio'))
    );

    // Allow if:
    // 1. Has allowed media (with or without caption if captions allowed)
    // 2. Is a reply to another message (text replies allowed)
    if (hasAllowedMedia || (isReply && topicConfig.allow_text_in_replies)) {
      // Track analytics if enabled
      if (topicConfig.track_posts && hasAllowedMedia) {
        const username = ctx.from.username || ctx.from.first_name;
        await TopicConfigModel.updateAnalytics(
          messageThreadId,
          userId,
          username,
          {
            posts: 1,
            media: 1
          }
        );
      }

      return next(); // Valid message, continue
    }

    // Text-only message (not a reply) - VIOLATION
    const lang = ctx.from.language_code === 'es' ? 'es' : 'en';

    // Delete the message
    try {
      await ctx.deleteMessage();
    } catch (error) {
      logger.error('Failed to delete text-only message:', error);
    }

    // Send warning to user (DM)
    const warningMessage = lang === 'es'
      ? `⚠️ **Tema: ${topicConfig.topic_name}**\n\n`
        + 'Este tema es solo para compartir medios.\n\n'
        + '✅ **Permitido:**\n'
        + '📸 Fotos, videos, GIFs\n'
        + '💬 Respuestas a publicaciones\n\n'
        + '❌ **No permitido:**\n'
        + '📝 Mensajes de solo texto\n\n'
        + '_Tu mensaje fue eliminado._'
      : `⚠️ **Topic: ${topicConfig.topic_name}**\n\n`
        + 'This topic is for media sharing only.\n\n'
        + '✅ **Allowed:**\n'
        + '📸 Photos, videos, GIFs\n'
        + '💬 Replies to posts\n\n'
        + '❌ **Not allowed:**\n'
        + '📝 Text-only messages\n\n'
        + '_Your message was deleted._';

    try {
      await ctx.telegram.sendMessage(userId, warningMessage, {
        parse_mode: 'Markdown'
      });
    } catch (error) {
      // User may have blocked the bot, log but don't fail
      logger.warn('Could not send DM warning to user:', userId);
    }

    // Track violation
    const violations = await TopicConfigModel.trackViolation(
      userId,
      messageThreadId,
      'text_only_in_media_topic'
    );

    // Check if user has too many violations (3 strikes)
    if (violations >= 3) {
      logger.warn(`User ${userId} has ${violations} violations in topic ${messageThreadId}`);
      // Could implement auto-mute here if needed
    }

    return; // Stop processing this message

  } catch (error) {
    logger.error('Error in media-only validator:', error);
    return next(); // Continue on error to avoid breaking bot
  }
  };
}

module.exports = mediaOnlyValidator;
