const { Markup } = require('telegraf');
const UserModel = require('../../../models/userModel');
const WallOfFameModel = require('../../../models/wallOfFameModel');
const CultEventModel = require('../../../models/cultEventModel');
const CultEventService = require('../../services/cultEventService');
const { cache } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const SubscriptionService = require('../../services/subscriptionService');

const BADGE_HIGH_LEGEND = 'High Legend of the Cult';
const BADGE_TRIBUTE = 'Tribute of the Cult';
const BADGE_LOYAL = 'The Loyal Disciple';
const CULT_BADGES = [BADGE_HIGH_LEGEND, BADGE_TRIBUTE, BADGE_LOYAL];
const { EVENT_TYPES } = CultEventService;
let lastProcessedDateKey = null;

/**
 * Wall of Fame Handler - Cult Titles
 * Automatically posts photos/videos to Wall of Fame TOPIC with member info
 * Tracks daily cult titles based on interactions and activity
 * Deletes the original message from the group to avoid duplicates
 *
 * IMPORTANT RULES:
 * - Wall of Fame is a TOPIC in the GROUP (not a separate channel)
 * - Photos/videos posted to Wall of Fame topic are PERMANENT (NEVER deleted)
 * - Original user messages in general group are deleted (to avoid duplicates)
 * - Wall of Fame messages are excluded from /cleanupcommunity command
 * - Only bot messages in main GROUP are deleted, not Wall of Fame topic
 * - Daily titles are calculated from reactions and activity
 */

// Wall of Fame Topic ID in the group
// This is a topic within GROUP_ID where photos/videos are posted permanently
// Default: 3132 (from the community group structure)
const WALL_OF_FAME_TOPIC_ID = parseInt(process.env.WALL_OF_FAME_TOPIC_ID || '3132');
const GROUP_ID = process.env.GROUP_ID || '-1003291737499';

/**
 * Track Wall of Fame message IDs to exclude from cleanup
 * Maps: topicId => Set of message IDs that should NEVER be deleted
 * These are protected from /cleanupcommunity cleanup command
 */
const wallOfFameMessageIds = new Map();

const getDateKey = (date = new Date()) => date.toISOString().split('T')[0];
const getMonthKey = (date = new Date()) => date.toISOString().slice(0, 7);

const getPreviousDateKey = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return getDateKey(date);
};

const getSecondsUntilNextMonth = (date = new Date()) => {
  const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return Math.max(3600, Math.floor((nextMonth.getTime() - date.getTime()) / 1000));
};

async function maybeResetMonthlyBadges(currentDate) {
  if (currentDate.getUTCDate() !== 1) {
    return;
  }

  const monthKey = getMonthKey(currentDate);
  const lockKey = `wall_of_fame:monthly_reset:${monthKey}`;
  const lockTtl = getSecondsUntilNextMonth(currentDate);
  const acquired = await cache.setNX(lockKey, { processedAt: new Date().toISOString() }, lockTtl);
  if (!acquired) {
    return;
  }

  for (const badge of CULT_BADGES) {
    await UserModel.removeBadgeFromAll(badge);
  }
}

async function processDailyWinners(dateKey, telegram) {
  const existing = await WallOfFameModel.getDailyWinners(dateKey);
  if (existing) {
    return;
  }

  const winners = await WallOfFameModel.calculateDailyWinners(dateKey);
  await WallOfFameModel.setDailyWinners(dateKey, winners);

  if (!winners.legendUserId && !winners.activeUserId && !winners.newMemberUserId) {
    return;
  }

  await Promise.all([
    notifyLegendWinner(telegram, winners.legendUserId, dateKey),
    notifyNewMemberWinner(telegram, winners.newMemberUserId, dateKey),
    notifyActiveWinner(telegram, winners.activeUserId, dateKey),
  ]);
}

async function ensureDailyProcessing(currentDate, telegram) {
  await maybeResetMonthlyBadges(currentDate);

  const currentDateKey = getDateKey(currentDate);
  if (!lastProcessedDateKey) {
    lastProcessedDateKey = currentDateKey;
    await processDailyWinners(getPreviousDateKey(currentDateKey), telegram);
    return;
  }

  if (currentDateKey === lastProcessedDateKey) {
    return;
  }

  await processDailyWinners(getPreviousDateKey(currentDateKey), telegram);
  lastProcessedDateKey = currentDateKey;
}

async function notifyLegendWinner(telegram, userId, dateKey) {
  if (!userId) return;

  try {
    await UserModel.addBadge(userId, BADGE_HIGH_LEGEND);
    await sendWinnerMessage(telegram, userId, BADGE_HIGH_LEGEND, dateKey, {
      es: 'Has ganado 3 días PRIME por ser quien recibió más interacciones.',
      en: 'You earned 3 PRIME days for getting the most interactions.',
    }, EVENT_TYPES.PRIME);
    await announceWinner(telegram, userId, BADGE_HIGH_LEGEND, {
      es: 'Premio: 3 días PRIME gratis.',
      en: 'Prize: 3 FREE PRIME days.',
    });
  } catch (error) {
    logger.error('Error rewarding High Legend winner:', error);
  }
}

async function notifyNewMemberWinner(telegram, userId, dateKey) {
  if (!userId) return;

  try {
    await UserModel.addBadge(userId, BADGE_TRIBUTE);
    await sendWinnerMessage(telegram, userId, BADGE_TRIBUTE, dateKey, {
      es: 'Fuiste el Nuevo Miembro Destacado. Estás invitado al próximo hangout privado con Santino.',
      en: 'You were the Featured New Member. You are invited to the next private hangout with Santino.',
    }, EVENT_TYPES.SANTINO);
    await announceWinner(telegram, userId, BADGE_TRIBUTE, {
      es: 'Premio: invitación al próximo hangout privado con Santino.',
      en: 'Prize: invitation to the next private hangout with Santino.',
    });
  } catch (error) {
    logger.error('Error rewarding Tribute of the Cult winner:', error);
  }
}

async function notifyActiveWinner(telegram, userId, dateKey) {
  if (!userId) return;

  try {
    await UserModel.addBadge(userId, BADGE_LOYAL);
    await sendWinnerMessage(telegram, userId, BADGE_LOYAL, dateKey, {
      es: 'Fuiste el Miembro Activo Destacado. Estás invitado al próximo hangout privado con Lex.',
      en: 'You were the Featured Active Member. You are invited to the next private hangout with Lex.',
    }, EVENT_TYPES.LEX);
    await announceWinner(telegram, userId, BADGE_LOYAL, {
      es: 'Premio: invitación al próximo hangout privado con Lex.',
      en: 'Prize: invitation to the next private hangout with Lex.',
    });
  } catch (error) {
    logger.error('Error rewarding Loyal Disciple winner:', error);
  }
}

async function sendWinnerMessage(telegram, userId, badge, dateKey, extra, primaryEvent) {
  try {
    const user = await UserModel.getById(userId);
    const lang = user?.language || 'en';
    const monthKey = getMonthKey(new Date(`${dateKey}T00:00:00.000Z`));
    const keyboard = buildWinnerKeyboard(primaryEvent, monthKey, lang);
    const message = lang === 'es'
      ? `🏆 ¡Ganaste el título ${badge}!\n\n${extra.es}\n\n✅ Tu título se mantiene hasta el último día del mes.\n\n📅 Horarios oficiales (UTC):\n• Hangout con Lex: segundo sábado 20:00–22:00\n• Hangout con Santino: segundo sábado 22:00–00:00\n• The Meth Gala: último sábado desde las 20:00\n\n⚠️ Términos y condiciones:\n• Debes reclamar tu premio desde los botones abajo.\n• Si no se canjea antes de fin de mes, el premio expira.\n• Los premios son personales e intransferibles.\n• PNPtv no se responsabiliza por premios no reclamados.\n\n🎉 Con cualquier badge del culto tienes invitación a la Meth Gala.\n\nRevisa los botones para reclamar o registrarte.`
      : `🏆 You won the ${badge} title!\n\n${extra.en}\n\n✅ Your title remains active until the last day of this month.\n\n📅 Official times (UTC):\n• Lex hangout: 2nd Saturday 20:00–22:00\n• Santino hangout: 2nd Saturday 22:00–00:00\n• The Meth Gala: last Saturday from 20:00 onward\n\n⚠️ Terms & conditions:\n• Claim your prize using the buttons below.\n• Unclaimed prizes expire at month end.\n• Prizes are personal and non-transferable.\n• PNPtv is not responsible for unclaimed prizes.\n\n🎉 Any cult-title badge grants a Meth Gala invite.\n\nUse the buttons to claim or register.`;

    await telegram.sendMessage(userId, message, {
      ...keyboard,
    });
  } catch (error) {
    logger.debug('Could not send winner DM', { userId, error: error.message });
  }
}

function buildWinnerKeyboard(primaryEvent, monthKey, lang) {
  const buttons = [];

  if (primaryEvent === EVENT_TYPES.PRIME) {
    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '✅ Activar PRIME 3 días' : '✅ Activate 3-Day PRIME',
        `cult_claim_prime_${monthKey}`
      ),
    ]);
  }

  if (primaryEvent === EVENT_TYPES.SANTINO) {
    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '🗓️ Register for Santino\'s Hangout' : "🗓️ Register for Santino's Hangout",
        `cult_register_santino_${monthKey}`
      ),
    ]);
  }

  if (primaryEvent === EVENT_TYPES.LEX) {
    buttons.push([
      Markup.button.callback(
        lang === 'es' ? '🗓️ Register for Lex\'s Hangout' : "🗓️ Register for Lex's Hangout",
        `cult_register_lex_${monthKey}`
      ),
    ]);
  }

  buttons.push([
    Markup.button.callback(
      lang === 'es' ? '🎉 Register for The Meth Gala' : '🎉 Register for The Meth Gala',
      `cult_register_gala_${monthKey}`
    ),
  ]);

  return Markup.inlineKeyboard(buttons);
}

async function announceWinner(telegram, userId, badge, reward) {
  try {
    const user = await UserModel.getById(userId);
    const username = user?.username ? `@${user.username}` : (user?.firstName || 'Miembro');
    const message = `🏆 Usuario destacado: ${username}\nDesde ahora será conocido como **${badge}**.\n\n🏆 Featured member: ${username}\nFrom now on he shall be known as **${badge}**.\n\n${reward.es}\n${reward.en}\n\n⏳ Ostentará el título hasta el último día del mes.\n📩 Revisa el bot: se envió un mensaje con detalles para reclamar el premio.\n📌 Anuncio publicado en el Wall of Fame.`;

    await telegram.sendMessage(GROUP_ID, message, { parse_mode: 'Markdown' });
    await telegram.sendMessage(GROUP_ID, message, {
      parse_mode: 'Markdown',
      message_thread_id: WALL_OF_FAME_TOPIC_ID,
    });
  } catch (error) {
    logger.error('Error announcing cult winner:', error);
  }
}

/**
 * Register wall of fame handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerWallOfFameHandlers = (bot) => {
  // Listen for photos/videos in groups
  bot.on(['photo', 'video'], async (ctx) => {
    try {
      // Only apply in groups
      if (!['group', 'supergroup'].includes(ctx.chat?.type)) {
        return;
      }

      // CRITICAL: Only process photos/videos from the TARGET group
      const chatIdStr = ctx.chat?.id?.toString();
      if (chatIdStr !== GROUP_ID) {
        return; // Not our target group, skip
      }

      // Skip if photo/video is already in Wall of Fame topic (prevent re-posting)
      const messageThreadId = ctx.message?.message_thread_id;
      if (messageThreadId && Number(messageThreadId) === WALL_OF_FAME_TOPIC_ID) {
        return; // Already in Wall of Fame, skip
      }

      // Skip if it's a forwarded message or reply
      if (ctx.message.forward_from || ctx.message.reply_to_message) {
        return;
      }

      const userId = ctx.from.id;
      const lang = getLanguage(ctx);
      const now = new Date();

      // Get user info
      const user = await UserModel.getById(userId);
      if (!user) {
        logger.warn('User not found for wall of fame', { userId });
        return;
      }

      await ensureDailyProcessing(now, ctx.telegram);

      const joinData = await cache.get(`group_joined_at:${userId}`);
      const joinedAt = joinData?.joinedAt ? new Date(joinData.joinedAt) : null;
      const isNewMember = joinedAt ? (now.getTime() - joinedAt.getTime()) <= 3 * 60 * 60 * 1000 : false;
      const groupIdValue = Number(GROUP_ID);

      // Build member info caption
      const caption = buildMemberInfoCaption(user, lang);
      const inlineKeyboard = buildMemberInlineKeyboard(user, userId, lang);

      // Prepare to forward to Wall of Fame
      const isPhoto = ctx.message.photo;
      const isVideo = ctx.message.video;

      try {
        if (isPhoto) {
          // Get the largest photo size
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          const fileId = photo.file_id;

          // Send photo to Wall of Fame TOPIC with member info
          const sentMessage = await ctx.telegram.sendPhoto(
            GROUP_ID,
            fileId,
            {
              caption,
              parse_mode: 'HTML',
              disable_notification: false,
              message_thread_id: WALL_OF_FAME_TOPIC_ID, // Post to the specific topic
              ...(inlineKeyboard ? inlineKeyboard : {}),
            }
          );

          // Track this Wall of Fame message so it's NEVER deleted
          trackWallOfFameMessage(WALL_OF_FAME_TOPIC_ID, sentMessage.message_id);
          await WallOfFameModel.recordPost({
            groupId: groupIdValue,
            messageId: sentMessage.message_id,
            userId,
            dateKey: getDateKey(now),
            isNewMember,
            createdAt: now,
          });

          logger.info('Photo posted to Wall of Fame TOPIC (PERMANENT)', {
            userId,
            username: user.username,
            groupId: ctx.chat.id,
            topicId: WALL_OF_FAME_TOPIC_ID,
            wallOfFameMessageId: sentMessage.message_id,
          });
        } else if (isVideo) {
          const video = ctx.message.video;
          const fileId = video.file_id;

          // Send video to Wall of Fame TOPIC with member info
          const sentMessage = await ctx.telegram.sendVideo(
            GROUP_ID,
            fileId,
            {
              caption,
              parse_mode: 'HTML',
              disable_notification: false,
              duration: video.duration,
              message_thread_id: WALL_OF_FAME_TOPIC_ID, // Post to the specific topic
              ...(inlineKeyboard ? inlineKeyboard : {}),
            }
          );

          // Track this Wall of Fame message so it's NEVER deleted
          trackWallOfFameMessage(WALL_OF_FAME_TOPIC_ID, sentMessage.message_id);
          await WallOfFameModel.recordPost({
            groupId: groupIdValue,
            messageId: sentMessage.message_id,
            userId,
            dateKey: getDateKey(now),
            isNewMember,
            createdAt: now,
          });

          logger.info('Video posted to Wall of Fame TOPIC (PERMANENT)', {
            userId,
            username: user.username,
            groupId: ctx.chat.id,
            topicId: WALL_OF_FAME_TOPIC_ID,
            wallOfFameMessageId: sentMessage.message_id,
          });
        }

        // Delete the original message from the group to avoid duplicates
        try {
          await ctx.deleteMessage();
          logger.info('Original message deleted from group', {
            userId,
            messageId: ctx.message.message_id,
            groupId: ctx.chat.id,
          });
        } catch (deleteError) {
          logger.warn('Failed to delete original message', {
            userId,
            messageId: ctx.message.message_id,
            error: deleteError.message,
          });
        }

        // Send confirmation to user in private chat
        try {
          const confirmMsg = lang === 'es'
            ? `✨ Tu foto/video ha sido publicado en el Muro de la Fama.\n\n🏆 Los títulos diarios se definen por interacciones y actividad.\n\n💫 ¡Sigue compartiendo contenido increíble!`
            : `✨ Your photo/video has been posted to the Wall of Fame.\n\n🏆 Daily titles are decided by interactions and activity.\n\n💫 Keep sharing amazing content!`;

          await ctx.telegram.sendMessage(userId, confirmMsg);
        } catch (dmError) {
          logger.debug('Could not send DM confirmation', { userId, error: dmError.message });
        }
      } catch (postError) {
        logger.error('Error posting to Wall of Fame', {
          userId,
          error: postError.message,
        });

        // Try to notify user of the error
        try {
          const errorMsg = lang === 'es'
            ? '❌ Hubo un error al publicar en el Muro de la Fama'
            : '❌ There was an error posting to the Wall of Fame';
          await ctx.telegram.sendMessage(userId, errorMsg);
        } catch (dmError) {
          logger.debug('Could not send error DM', { userId });
        }
      }
    } catch (error) {
      logger.error('Error in wallOfFame handler:', error);
    }
  });

  bot.on('message_reaction', async (ctx) => {
    try {
      const messageReaction = ctx.messageReaction;
      if (!messageReaction?.message) {
        return;
      }

      const chatIdStr = messageReaction.message.chat?.id?.toString();
      if (chatIdStr !== GROUP_ID) {
        return;
      }

      await ensureDailyProcessing(new Date(), ctx.telegram);

      const newReactions = messageReaction.new_reaction || [];
      const oldReactions = messageReaction.old_reaction || [];
      const delta = newReactions.length - oldReactions.length;
      if (delta === 0) {
        return;
      }

      await WallOfFameModel.incrementReactions({
        groupId: Number(GROUP_ID),
        messageId: messageReaction.message.message_id,
        delta,
      });
    } catch (error) {
      logger.error('Error tracking Wall of Fame reactions:', error);
    }
  });

  bot.action(/^cult_claim_prime_(\d{4}-\d{2})$/, async (ctx) => {
    try {
      const monthKey = ctx.match[1];
      const userId = ctx.from.id.toString();
      const currentMonthKey = getMonthKey(new Date());
      const user = await UserModel.getById(userId);
      const lang = user?.language || 'en';
      if (monthKey !== currentMonthKey) {
        await ctx.answerCbQuery(lang === 'es' ? 'Este premio ya expiró.' : 'This reward has expired.');
        return;
      }
      const existing = await CultEventModel.getRegistration({
        userId,
        eventType: EVENT_TYPES.PRIME,
        monthKey,
      });

      if (existing?.status === 'claimed') {
        await ctx.answerCbQuery(lang === 'es' ? 'PRIME ya fue activado.' : 'PRIME already activated.');
        return;
      }

      if (!existing) {
        await CultEventService.register({
          userId,
          eventType: EVENT_TYPES.PRIME,
          monthKey,
          eventAt: new Date(),
        });
      }

      const result = await SubscriptionService.addFreeTrial(userId, 3, 'cult_high_legend');
      if (result.success) {
        await CultEventModel.markClaimed({ userId, eventType: EVENT_TYPES.PRIME, monthKey });
        await ctx.answerCbQuery(lang === 'es' ? '¡PRIME activado! 🎉' : 'PRIME activated! 🎉');
      } else {
        await ctx.answerCbQuery(lang === 'es' ? 'Fallo al activar. Intenta de nuevo.' : 'Activation failed. Try again.');
      }
    } catch (error) {
      logger.error('Error activating PRIME claim:', error);
      await ctx.answerCbQuery('Error activating PRIME.');
    }
  });

  bot.action(/^cult_register_(santino|lex|gala)_(\d{4}-\d{2})$/, async (ctx) => {
    try {
      const eventKey = ctx.match[1];
      const monthKey = ctx.match[2];
      const userId = ctx.from.id.toString();
      const currentMonthKey = getMonthKey(new Date());
      const eventType = eventKey === 'santino'
        ? EVENT_TYPES.SANTINO
        : eventKey === 'lex'
          ? EVENT_TYPES.LEX
          : EVENT_TYPES.GALA;

      const user = await UserModel.getById(userId);
      const lang = user?.language || 'en';
      if (monthKey !== currentMonthKey) {
        await ctx.answerCbQuery(lang === 'es' ? 'Registro fuera de fecha.' : 'Registration period ended.');
        return;
      }

      const registration = await CultEventService.register({
        userId,
        eventType,
        monthKey,
      });

      if (!registration) {
        await ctx.answerCbQuery(lang === 'es' ? 'Registro fallido.' : 'Registration failed.');
        return;
      }

      const eventAt = new Date(registration.event_at);
      const dateStr = eventAt.toISOString().split('T')[0];
      const timeStr = `${eventAt.getUTCHours().toString().padStart(2, '0')}:00 UTC`;
      await ctx.answerCbQuery(lang === 'es' ? '¡Registrado!' : 'Registered!');
      await ctx.reply(
        lang === 'es'
          ? `✅ Registro confirmado\n\n📅 Fecha: ${dateStr}\n🕗 Hora: ${timeStr}\n\nTe enviaremos recordatorios 1 semana antes, 3 días antes y el día del evento.`
          : `✅ Registration confirmed\n\n📅 Date: ${dateStr}\n🕗 Time: ${timeStr}\n\nWe will send reminders 1 week before, 3 days before, and on the day.`,
      );
    } catch (error) {
      logger.error('Error registering cult event:', error);
      await ctx.answerCbQuery('Error registering.');
    }
  });
};

/**
 * Build member information caption for Wall of Fame
 * @param {Object} user - User object
 * @param {string} lang - Language code
 * @returns {string} HTML formatted caption
 */
function buildMemberInfoCaption(user, lang) {
  const label = lang === 'es' ? '👑 Miembro Destacado' : '👑 Featured Member';
  const nameLabel = lang === 'es' ? 'Nombre:' : 'Name:';
  const usernameLabel = lang === 'es' ? 'Usuario:' : 'Username:';
  const bioLabel = lang === 'es' ? 'Bio:' : 'Bio:';
  const lookingForLabel = lang === 'es' ? 'Buscando:' : 'Looking for:';
  const interestsLabel = lang === 'es' ? 'Intereses:' : 'Interests:';
  const socialLabel = lang === 'es' ? 'Redes Sociales:' : 'Social Media:';

  let caption = `<b>${label}</b>\n\n`;

  // Display name (firstName + lastName if available, fallback to username)
  const displayName = user.firstName && user.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || user.username || 'Member';

  caption += `<b>${nameLabel}</b> ${displayName}\n`;

  if (user.username) {
    caption += `<b>${usernameLabel}</b> @${user.username}\n`;
  }

  if (user.bio) {
    caption += `<b>${bioLabel}</b> ${escapeHtml(user.bio)}\n`;
  }

  if (user.looking_for) {
    caption += `<b>${lookingForLabel}</b> ${escapeHtml(user.looking_for)}\n`;
  }

  if (Array.isArray(user.interests) && user.interests.length > 0) {
    const interests = user.interests.filter(Boolean).slice(0, 8).map((i) => escapeHtml(String(i)));
    if (interests.length > 0) {
      caption += `<b>${interestsLabel}</b> ${interests.join(', ')}\n`;
    }
  }

  // Add social media links if available
  const socialLinks = [];

  if (user.instagram) {
    socialLinks.push(`<a href="https://instagram.com/${escapeHtml(String(user.instagram).replace(/^@/, ''))}">📸 Instagram</a>`);
  }

  if (user.twitter) {
    socialLinks.push(`<a href="https://x.com/${escapeHtml(String(user.twitter).replace(/^@/, ''))}">𝕏 X</a>`);
  }

  if (user.tiktok) {
    socialLinks.push(`<a href="https://www.tiktok.com/@${escapeHtml(String(user.tiktok).replace(/^@/, ''))}">🎵 TikTok</a>`);
  }

  if (user.youtube) {
    const youtubeValue = String(user.youtube).trim();
    const youtubeUrl = youtubeValue.startsWith('http') ? youtubeValue : `https://www.youtube.com/@${youtubeValue.replace(/^@/, '')}`;
    socialLinks.push(`<a href="${escapeHtml(youtubeUrl)}">▶️ YouTube</a>`);
  }

  if (user.telegram) {
    socialLinks.push(`<a href="https://t.me/${escapeHtml(String(user.telegram).replace(/^@/, ''))}">✈️ Telegram</a>`);
  }

  if (socialLinks.length > 0) {
    caption += `\n<b>${socialLabel}</b>\n${socialLinks.join(' | ')}\n`;
  }

  caption += `\n✨ <i>${lang === 'es' ? 'Destacado en el Muro de la Fama' : 'Featured on Wall of Fame'}</i>`;

  return caption;
}

function buildMemberInlineKeyboard(user, userId, lang) {
  try {
    const keyboard = [];

    // Interests as callback buttons (shows alert)
    if (Array.isArray(user.interests) && user.interests.length > 0) {
      const interestButtons = user.interests
        .map((interest, index) => ({ interest, index }))
        .filter(({ interest }) => Boolean(interest))
        .slice(0, 6)
        .map(({ interest, index }) => Markup.button.callback(String(interest).slice(0, 24), `profile_interest_${userId}_${index}`));

      for (let i = 0; i < interestButtons.length; i += 2) {
        keyboard.push(interestButtons.slice(i, i + 2));
      }
    }

    const normalizeHandle = (value) => String(value || '').trim().replace(/^@/, '');
    const socialButtons = [];

    if (user.instagram) {
      socialButtons.push(Markup.button.url('Instagram', `https://instagram.com/${encodeURIComponent(normalizeHandle(user.instagram))}`));
    }
    if (user.twitter) {
      socialButtons.push(Markup.button.url('X', `https://x.com/${encodeURIComponent(normalizeHandle(user.twitter))}`));
    }
    if (user.tiktok) {
      socialButtons.push(Markup.button.url('TikTok', `https://www.tiktok.com/@${encodeURIComponent(normalizeHandle(user.tiktok))}`));
    }
    if (user.youtube) {
      const youtubeValue = String(user.youtube).trim();
      const youtubeUrl = youtubeValue.startsWith('http') ? youtubeValue : `https://www.youtube.com/@${encodeURIComponent(normalizeHandle(youtubeValue))}`;
      socialButtons.push(Markup.button.url('YouTube', youtubeUrl));
    }
    if (user.telegram) {
      socialButtons.push(Markup.button.url('Telegram', `https://t.me/${encodeURIComponent(normalizeHandle(user.telegram))}`));
    }

    for (let i = 0; i < socialButtons.length; i += 2) {
      keyboard.push(socialButtons.slice(i, i + 2));
    }

    if (keyboard.length === 0) return null;
    return Markup.inlineKeyboard(keyboard);
  } catch (error) {
    logger.error('Error building Wall of Fame inline keyboard:', error);
    return null;
  }
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Track a Wall of Fame message as permanent (NEVER to be deleted)
 * @param {string} channelId - Wall of Fame channel ID
 * @param {number} messageId - Message ID to track
 */
function trackWallOfFameMessage(channelId, messageId) {
  if (!wallOfFameMessageIds.has(channelId)) {
    wallOfFameMessageIds.set(channelId, new Set());
  }
  wallOfFameMessageIds.get(channelId).add(messageId);
  logger.debug('Wall of Fame message tracked (PERMANENT)', { channelId, messageId });
}

/**
 * Check if a message is a Wall of Fame message (should never be deleted)
 * @param {string} channelId - Channel ID
 * @param {number} messageId - Message ID
 * @returns {boolean} True if this is a Wall of Fame message
 */
function isWallOfFameMessage(channelId, messageId) {
  const fameMessages = wallOfFameMessageIds.get(channelId);
  return fameMessages ? fameMessages.has(messageId) : false;
}

/**
 * Get all tracked Wall of Fame messages
 * @returns {Map} Map of channel IDs to message ID sets
 */
function getWallOfFameMessages() {
  return wallOfFameMessageIds;
}

module.exports = {
  registerWallOfFameHandlers,
  buildMemberInfoCaption,
  trackWallOfFameMessage,
  isWallOfFameMessage,
  getWallOfFameMessages,
};
