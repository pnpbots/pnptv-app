const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const TopicConfigModel = require('../../../models/topicConfigModel');
const UserModel = require('../../../models/userModel');

// Counter for featured member selection (every 10th media post)
let mediaPostCounter = 0;
const FEATURED_INTERVAL = 10;

/**
 * Media Mirror Middleware
 * Features every 10th media post as "Miembro Destacado" (Featured Member)
 * Includes rich user profile information with bio and clickable profile links
 */
function mediaMirrorMiddleware() {
  return async (ctx, next) => {
  const chatId = ctx.chat?.id;
  const message = ctx.message;
  const currentTopicId = message?.message_thread_id;

  // Skip if from bot
  if (ctx.from?.is_bot) {
    return next();
  }

  try {
    // Check if message contains media
    const hasPhoto = !!message?.photo;
    const hasVideo = !!message?.video;
    const hasAnimation = !!message?.animation;
    const hasMedia = hasPhoto || hasVideo || hasAnimation;

    if (!hasMedia) {
      return next(); // No media, skip
    }

    // Increment counter for every media post
    mediaPostCounter++;

    // Only feature every 10th post
    if (mediaPostCounter % FEATURED_INTERVAL !== 0) {
      return next(); // Not the 10th post, skip featuring
    }

    logger.info(`Featuring member - media post #${mediaPostCounter}`);

    // Get all topic configurations for this group
    const groupId = chatId.toString();
    const topicConfigs = await TopicConfigModel.getByGroupId(groupId);

    // Find topics with auto-mirror enabled
    const mirrorTopics = topicConfigs.filter(config =>
      config.auto_mirror_enabled &&
      config.mirror_from_general &&
      config.topic_id !== currentTopicId // Don't mirror to same topic
    );

    if (mirrorTopics.length === 0) {
      return next(); // No mirror configured
    }

    // Get user info
    const username = ctx.from.username || ctx.from.first_name;
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || username;

    // Create direct Telegram profile link
    let profileLink = '';
    if (ctx.from.username) {
      // User has username - direct link works
      profileLink = `[${firstName}](https://t.me/${ctx.from.username})`;
    } else {
      // No username - use tg:// deep link
      profileLink = `[${firstName}](tg://user?id=${userId})`;
    }

    const caption = message.caption || '';

    // Get user profile data from database for richer display
    let userProfile = null;
    try {
      userProfile = await UserModel.getById(userId);
    } catch (e) {
      logger.debug('Could not fetch user profile for mirror:', e.message);
    }

    // Detect user language (Spanish if 'es', otherwise English)
    const userLang = ctx.from?.language_code?.startsWith('es') ? 'es' : 'en';
    const texts = {
      es: {
        title: 'MIEMBRO DESTACADO',
        lookingFor: 'busca...',
        footer: 'posible fuckbuddy 😏'
      },
      en: {
        title: 'FEATURED MEMBER',
        lookingFor: 'is looking for...',
        footer: 'potential fuckbuddy 😏'
      }
    };
    const t = texts[userLang];

    // Mirror to each configured topic
    for (const mirrorTopic of mirrorTopics) {
      try {
        // Build cute monospace caption with profile info
        let mirrorCaption = '';

        // Header box
        mirrorCaption += '```\n';
        mirrorCaption += '══════════════════════════════\n';
        mirrorCaption += `   ⭐ ${t.title} ⭐   \n`;
        mirrorCaption += '══════════════════════════════\n';
        mirrorCaption += '```\n\n';

        // Username with looking for text (no bold, just plain text, escape special chars)
        const displayName = ctx.from.username ? `@${ctx.from.username.replace(/[_*[\]()~`>#+\-.!]/g, '\\$&')}` : firstName;
        mirrorCaption += `👤 ${displayName} ${t.lookingFor}\n\n`;

        // Add badges if user has any
        if (userProfile?.badges && userProfile.badges.length > 0) {
          const badgeEmojis = userProfile.badges.slice(0, 5).join(' ');
          mirrorCaption += `🏆 ${badgeEmojis}\n\n`;
        }

        // Add bio if exists (escape Markdown special characters)
        if (userProfile?.bio && userProfile.bio.trim()) {
          const shortBio = userProfile.bio.length > 80
            ? userProfile.bio.substring(0, 80) + '...'
            : userProfile.bio;
          const escapedBio = shortBio.replace(/[_*[\]()~`>#+\-.!]/g, '\\$&');
          mirrorCaption += `💭 "${escapedBio}"\n\n`;
        }

        // Add social media links if user has any
        const socials = [];
        if (userProfile?.twitter) socials.push(`𝕏 ${userProfile.twitter}`);
        if (userProfile?.instagram) socials.push(`IG ${userProfile.instagram}`);
        if (userProfile?.tiktok) socials.push(`TT ${userProfile.tiktok}`);
        if (userProfile?.onlyfans) socials.push(`OF ${userProfile.onlyfans}`);
        
        if (socials.length > 0) {
          mirrorCaption += `🔗 ${socials.join(' • ')}\n\n`;
        }

        // Add original caption if exists  
        if (caption && caption.trim()) {
          mirrorCaption += `💬 ${caption.trim()}\n\n`;
        }

        // Fun footer
        mirrorCaption += '```\n';
        mirrorCaption += '┌───────────────────────────┐\n';
        mirrorCaption += `│  ${t.footer.padEnd(23)} │\n`;
        mirrorCaption += '└───────────────────────────┘\n';
        mirrorCaption += '```';

        // Build inline keyboard with DM button
        let inlineKeyboard;
        if (ctx.from.username) {
          inlineKeyboard = Markup.inlineKeyboard([
            [Markup.button.url(`💬 Message ${firstName}`, `https://t.me/${ctx.from.username}`)]
          ]);
        } else {
          inlineKeyboard = Markup.inlineKeyboard([
            [Markup.button.url(`💬 Message ${firstName}`, `tg://user?id=${userId}`)]
          ]);
        }

        // Send media to mirror topic with inline button
        if (hasPhoto) {
          const photo = message.photo[message.photo.length - 1]; // Highest resolution
          await ctx.telegram.sendPhoto(
            chatId,
            photo.file_id,
            {
              caption: mirrorCaption,
              message_thread_id: mirrorTopic.topic_id,
              parse_mode: 'Markdown',
              ...inlineKeyboard
            }
          );
        } else if (hasVideo) {
          await ctx.telegram.sendVideo(
            chatId,
            message.video.file_id,
            {
              caption: mirrorCaption,
              message_thread_id: mirrorTopic.topic_id,
              parse_mode: 'Markdown',
              supports_streaming: true,
              ...inlineKeyboard
            }
          );
        } else if (hasAnimation) {
          await ctx.telegram.sendAnimation(
            chatId,
            message.animation.file_id,
            {
              caption: mirrorCaption,
              message_thread_id: mirrorTopic.topic_id,
              parse_mode: 'Markdown',
              ...inlineKeyboard
            }
          );
        }

        logger.info('Media mirrored to topic', {
          from_user: userId,
          from_topic: currentTopicId || 'general',
          to_topic: mirrorTopic.topic_id,
          media_type: hasPhoto ? 'photo' : hasVideo ? 'video' : 'animation'
        });

        // Track analytics
        if (mirrorTopic.track_posts) {
          await TopicConfigModel.updateAnalytics(
            mirrorTopic.topic_id,
            userId,
            username,
            {
              posts: 1,
              media: 1
            }
          );
        }

      } catch (error) {
        logger.error(`Error mirroring media to topic ${mirrorTopic.topic_id}:`, error);
      }
    }

  } catch (error) {
    logger.error('Error in media mirror middleware:', error);
  }

  // Continue processing the original message
  return next();
  };
}

/**
 * Track reactions for leaderboard
 */
async function trackReaction(ctx, next) {
  try {
    const messageReaction = ctx.messageReaction;
    if (!messageReaction) {
      return next();
    }

    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const message = messageReaction.message;

    // Get topic from message (if applicable)
    // Note: messageReaction doesn't always include message_thread_id
    // We might need to track this differently

    // For now, we'll track all reactions
    // In production, you'd need to map message IDs to topics

    if (userId) {
      logger.debug('Reaction tracked', {
        user_id: userId,
        chat_id: chatId
      });

      // Update analytics for reaction giver
      // Would need to determine which topic this message belongs to
    }

  } catch (error) {
    logger.error('Error tracking reaction:', error);
  }

  return next();
}

module.exports = {
  mediaMirrorMiddleware,
  trackReaction
};
