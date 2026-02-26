const { Markup } = require('telegraf');
const UserModel = require('../../../models/userModel');
const ChatCleanupService = require('../../services/chatCleanupService');
const { cache } = require('../../../config/redis');
const logger = require('../../../utils/logger');

// Authorized group ID from environment
const GROUP_ID = process.env.GROUP_ID;
const BOT_ID = process.env.BOT_TOKEN?.split(':')[0]; // Extract bot ID from token

/**
 * Badge options for "Which vibe are you?"
 */
const BADGE_OPTIONS = {
  meth_alpha: { emoji: '🔥', name: 'Meth Alpha' },
  chem_mermaids: { emoji: '🧜', name: 'Chem Mermaids' },
  slam_slut: { emoji: '💉', name: 'Slam Slut' },
  spun_royal: { emoji: '👑', name: 'Spun Royal' },
};

/**
 * Register group welcome handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerGroupWelcomeHandlers = (bot) => {
  // PRIMARY: Handle chat_member updates (modern, webhook-compatible)
  // This is the preferred method for detecting new members
  bot.on('chat_member', handleMemberJoin);

  // FALLBACK: Handle new_chat_members message (legacy, polling-compatible)
  // Kept for backward compatibility and edge cases
  bot.on('new_chat_members', handleMemberJoin);

  // Handle badge selection
  bot.action(/^badge_select_(.+)$/, handleBadgeSelection);

  // Handle view rules button
  bot.action('group_view_rules', handleViewRules);
};

/**
 * Unified handler for member join events
 * Works with both chat_member updates and new_chat_members messages
 */
async function handleMemberJoin(ctx) {
  try {
    const chatType = ctx.chat?.type;

    // Only process in groups
    if (!chatType || (chatType !== 'group' && chatType !== 'supergroup')) {
      return;
    }

    // Only process events from the authorized GROUP_ID
    const chatIdStr = ctx.chat?.id?.toString();
    if (GROUP_ID && chatIdStr !== GROUP_ID) {
      return;
    }

    // Extract members based on event type
    const members = extractNewMembers(ctx);
    if (!members || members.length === 0) {
      return;
    }

    // Process each new member
    for (const member of members) {
      await processNewMember(ctx, member);
    }
  } catch (error) {
    logger.error('Error handling member join:', error);
  }
}

/**
 * Extract new members from context based on event type
 * Supports both chat_member updates and new_chat_members messages
 */
function extractNewMembers(ctx) {
  // Check for chat_member update (modern way)
  if (ctx.chatMember) {
    const { old_chat_member: oldMember, new_chat_member: newMember } = ctx.chatMember;

    // Check if this is a join event (user wasn't in chat, now is)
    const wasInChat = oldMember?.status && ['member', 'administrator', 'creator'].includes(oldMember.status);
    const isNowInChat = newMember?.status && ['member', 'administrator', 'creator'].includes(newMember.status);

    if (!wasInChat && isNowInChat && newMember?.user) {
      logger.debug('New member detected via chat_member update', {
        userId: newMember.user.id,
        username: newMember.user.username,
      });
      return [newMember.user];
    }
    return [];
  }

  // Check for new_chat_members message (legacy way)
  if (ctx.message?.new_chat_members) {
    const members = ctx.message.new_chat_members;
    if (members.length > 0) {
      logger.debug('New members detected via new_chat_members', {
        count: members.length,
        userIds: members.map(m => m.id),
      });
    }
    return members;
  }

  return [];
}

/**
 * Process a new member joining
 */
async function processNewMember(ctx, member) {
  try {
    const userId = member.id;

    // Handle bots (remove unauthorized bots)
    if (member.is_bot) {
      await handleBotJoin(ctx, member);
      return;
    }

    // Atomic deduplication check - prevents race condition when both events fire
    if (!ChatCleanupService.tryMarkWelcomeSent(userId)) {
      logger.debug('User already welcomed (dedup)', { userId });
      return;
    }

    // Get or create user
    const user = await UserModel.createOrUpdate({
      userId: member.id,
      username: member.username,
      firstName: member.first_name,
      lastName: member.last_name,
    });

    if (!user) {
      logger.error('Failed to get/create user for new member', { userId: member.id });
      return;
    }

    const lang = user.language || 'en';
    const username = member.first_name || 'Friend';

    await cache.set(`group_joined_at:${userId}`, { joinedAt: new Date().toISOString() }, 3 * 60 * 60);

    // Send welcome message
    await sendWelcomeMessage(ctx, username, user, lang);

    // Send badge selection message
    await sendBadgeSelectionMessage(ctx, username, lang);

    logger.info('New member welcomed', {
      userId,
      username: member.username,
      chatId: ctx.chat.id,
    });
  } catch (error) {
    logger.error('Error processing new member:', error);
  }
}

/**
 * Handle bot joining the group (remove unauthorized bots)
 */
async function handleBotJoin(ctx, member) {
  // Don't remove ourselves
  const memberIdStr = member.id?.toString();
  if (BOT_ID && memberIdStr === BOT_ID) {
    logger.debug('Skipping self-removal');
    return;
  }

  try {
    await ctx.banChatMember(member.id);

    const botName = member.first_name || 'Bot';
    const message = `🚫 **Bot Removed**\n\nNo other bots are allowed in this group. Only the official PNPtv bot is permitted.`;

    const sentMessage = await ctx.reply(message, { parse_mode: 'Markdown' });
    ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 2 * 60 * 1000);

    logger.info('Unauthorized bot removed', {
      botName,
      botId: member.id,
      chatId: ctx.chat.id,
    });
  } catch (error) {
    logger.error('Error removing bot:', error);
  }
}

/**
 * Send welcome message with membership info
 */
async function sendWelcomeMessage(ctx, username, user, lang) {
  try {
    const subscriptionStatus = user.subscriptionStatus === 'active' ? 'PRIME Member' : 'Free Member';

    const message = lang === 'es'
      ? `👋 Ey ${username}, bienvenidx a PNPtv!

Aquí la vuelta es simple: gente real, buena vibra, cero filtro.

⭐ Tu membresía actual: ${subscriptionStatus}

🔥 Lo que tienes por ahora:
• Acceso al grupo
• Contenido corto
• Music Library gratis
• 3 vistas en Nearby

💎 Si te haces PRIME, desbloqueas:
• Videos completos de Santino, Lex y latinos hot 🔥
• Nearby ilimitado
• Canal PRIME exclusivo

💰 $14.99/semana
🔥 HOT PNP LIFETIME: $100 → pnptv.app/lifetime100

📸 Comparte fotos para competir por títulos del culto diarios:
• High Legend of the Cult (más interacciones) = 3 días PRIME
• Tribute of the Cult (nuevo miembro rápido)
• The Loyal Disciple (más fotos)
👉 /subscribe`
      : `👋 Hey ${username}, welcome to PNPtv!

This place is simple: real people, real vibes, no filters.

⭐ Your current membership: ${subscriptionStatus}

🔥 What you get right now:
• Group access
• Short content
• Free Music Library
• 3 views in Nearby Members

💎 If you go PRIME, you unlock:
• Full-length videos from Santino, Lex & hot latinos 🔥
• Unlimited Nearby Members
• Exclusive PRIME Channel

💰 $14.99/week
🔥 HOT PNP LIFETIME: $100 → pnptv.app/lifetime100

📸 Share pics to compete for daily cult titles:
• High Legend of the Cult (most interactions) = 3 days PRIME
• Tribute of the Cult (fast new member)
• The Loyal Disciple (most photos)
👉 /subscribe`;

    const sentMessage = await ctx.reply(message, { parse_mode: 'Markdown' });
    ChatCleanupService.scheduleWelcomeMessage(ctx.telegram, sentMessage);

    logger.info('Welcome message sent', {
      userId: user.userId,
      chatId: ctx.chat.id,
      language: lang,
    });
  } catch (error) {
    logger.error('Error sending welcome message:', error);
  }
}

/**
 * Send badge selection message
 */
async function sendBadgeSelectionMessage(ctx, username, lang) {
  try {
    const message = lang === 'es'
      ? `👑 Ahora dinos… qué vibra eres tú?

Escoge tu energía y te damos tu primera insignia. Se guarda al instante.`
      : `👑 Tell us… what's your vibe?

Pick your energy and get your first badge. It saves instantly.`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          `${BADGE_OPTIONS.meth_alpha.emoji} ${BADGE_OPTIONS.meth_alpha.name}`,
          'badge_select_meth_alpha'
        ),
        Markup.button.callback(
          `${BADGE_OPTIONS.chem_mermaids.emoji} ${BADGE_OPTIONS.chem_mermaids.name}`,
          'badge_select_chem_mermaids'
        ),
      ],
      [
        Markup.button.callback(
          `${BADGE_OPTIONS.slam_slut.emoji} ${BADGE_OPTIONS.slam_slut.name}`,
          'badge_select_slam_slut'
        ),
        Markup.button.callback(
          `${BADGE_OPTIONS.spun_royal.emoji} ${BADGE_OPTIONS.spun_royal.name}`,
          'badge_select_spun_royal'
        ),
      ],
    ]);

    const sentMessage = await ctx.reply(message, keyboard);
    ChatCleanupService.scheduleMenuMessage(ctx.telegram, sentMessage);

    logger.info('Badge selection sent', {
      chatId: ctx.chat.id,
      language: lang,
    });
  } catch (error) {
    logger.error('Error sending badge selection:', error);
  }
}

/**
 * Send photo sharing invitation after badge selection
 */
async function sendPhotoSharingInvitation(ctx, username, lang) {
  try {
    const message = lang === 'es'
      ? `📸 ¡COMPARTE TU ESTILO Y GANA! 📸

🏆 Títulos diarios del culto:
• High Legend of the Cult = más interacciones (3 días PRIME)
• Tribute of the Cult = nuevo miembro en 3 horas
• The Loyal Disciple = más fotos del día

📢 Tu foto/video se publica en el Muro de la Fama
🎉 Con un badge del culto quedas invitado a la Meth Gala de fin de mes

👉 Sube fotos/videos de calidad en el grupo
👉 Usa tu mejor energía y estilo
👉 ¡Sé auténtico y destaca!

💎 ¿Listo para competir? ¡Sube tu mejor contenido ahora!`
      : `📸 SHARE YOUR STYLE AND WIN! 📸

🏆 Daily cult titles:
• High Legend of the Cult = most interactions (3 days PRIME)
• Tribute of the Cult = new member within 3 hours
• The Loyal Disciple = most photos of the day

📢 Your photo/video is posted on the Wall of Fame
🎉 Any cult-title badge invites you to the Meth Gala at month end

👉 Upload quality photos/videos in the group
👉 Show your best energy and style
👉 Be authentic and stand out!

💎 Ready to compete? Upload your best content now!`;

    const sentMessage = await ctx.reply(message);
    ChatCleanupService.scheduleMenuMessage(ctx.telegram, sentMessage);

    logger.info('Photo sharing invitation sent', {
      chatId: ctx.chat.id,
      language: lang,
    });
  } catch (error) {
    logger.error('Error sending photo sharing invitation:', error);
  }
}

/**
 * Handle badge selection
 */
async function handleBadgeSelection(ctx) {
  try {
    if (!ctx.match || !ctx.match[1]) {
      logger.error('Invalid badge selection format');
      return;
    }

    const badgeKey = ctx.match[1];
    const badge = BADGE_OPTIONS[badgeKey];

    if (!badge) {
      logger.error('Invalid badge key:', badgeKey);
      return;
    }

    const userId = ctx.from.id;
    const user = await UserModel.getById(userId);

    if (!user) {
      await ctx.answerCbQuery('Error: User not found. Please use /start first.');
      return;
    }

    const lang = user.language || 'en';
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

    // Save badge to user profile
    await UserModel.addBadge(userId, badgeKey);

    // Delete the badge selection message
    try {
      await ctx.deleteMessage();
    } catch (error) {
      logger.warn('Could not delete badge selection message:', error.message);
    }

    // Send congratulations message
    await sendCongratsMessage(ctx, username, badge, lang);

    // Send rules menu
    await sendRulesMenu(ctx, lang);

    // Send photo sharing invitation
    await sendPhotoSharingInvitation(ctx, username, lang);

    // Answer the callback query
    await ctx.answerCbQuery(`${badge.emoji} Badge saved!`);

    logger.info('Badge selected', {
      userId,
      badge: badgeKey,
      chatId: ctx.chat.id,
    });
  } catch (error) {
    logger.error('Error handling badge selection:', error);
    await ctx.answerCbQuery('An error occurred. Please try again.');
  }
}

/**
 * Send congratulations message after badge selection
 */
async function sendCongratsMessage(ctx, username, badge, lang) {
  try {
    const message = lang === 'es'
      ? `${badge.emoji} Listo ${username}, ya tienes tu primera insignia.

Eres ${badge.name} y oficialmente parte de la familia PNPtv!. Aquí ya entraste de verdad.`
      : `${badge.emoji} Nice ${username} — you just earned your first badge.

You're officially a ${badge.name} and now part of the PNPtv! family for real.`;

    await ctx.reply(message);

    logger.info('Congrats message sent', {
      userId: ctx.from.id,
      chatId: ctx.chat.id,
      badge: badge.name,
    });
  } catch (error) {
    logger.error('Error sending congrats message:', error);
  }
}

/**
 * Send rules menu with inline button
 */
async function sendRulesMenu(ctx, lang) {
  try {
    const buttonText = lang === 'es' ? '📘 Ver Reglas del Grupo' : '📘 View Group Rules';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(buttonText, 'group_view_rules')],
    ]);

    await ctx.reply(
      lang === 'es'
        ? '📋 Lee las reglas del grupo:'
        : '📋 Check out the group rules:',
      keyboard
    );

    logger.info('Rules menu sent', {
      chatId: ctx.chat.id,
      language: lang,
    });
  } catch (error) {
    logger.error('Error sending rules menu:', error);
  }
}

/**
 * Handle view rules button click
 */
async function handleViewRules(ctx) {
  try {
    const userId = ctx.from.id;
    const user = await UserModel.getById(userId);
    const lang = user?.language || 'en';

    const rulesMessage = lang === 'es'
      ? `📘 *Normas de la Comunidad PNPtv* 📘

💙 *Respeto y Seguridad:*
• Trata a todos con respeto y amabilidad
• Prohibido: discriminación, acoso, lenguaje de odio
• Consentimiento obligatorio para contenido sensible
• Reporta comportamiento inapropiado

💬 *Contenido de Calidad:*
• Prohibido spam o autopromoción excesiva
• Mantén conversaciones relevantes y valiosas
• Comparte contenido significativo y positivo

🛡️ *Normas de la Comunidad:*
• No ventas o promociones externas
• Sigue las reglas de Telegram y PNPtv
• Ayuda a mantener un ambiente positivo

❤️ *Cuidado Personal y Apoyo:*
• Cuídate y cuida a los demás
• Apoya a los miembros de la comunidad
• Recursos de salud mental disponibles`
      : `📘 *PNPtv Community Guidelines* 📘

💙 *Respect & Safety:*
• Be kind and respectful to all members
• No discrimination, harassment, or hate speech
• Consent required for sensitive content
• Report inappropriate behavior

💬 *Quality Content:*
• No spam or excessive self-promotion
• Keep conversations relevant and valuable
• Share meaningful, positive content

🛡️ *Community Standards:*
• No external selling or promotions
• Follow Telegram and PNPtv guidelines
• Help maintain a positive environment

❤️ *Self-Care & Support:*
• Take care of yourself and others
• Support fellow community members
• Mental health resources available`;

    // Try to edit the message, fallback to new message
    try {
      await ctx.editMessageText(rulesMessage, { parse_mode: 'Markdown' });
    } catch {
      const sentMessage = await ctx.reply(rulesMessage, { parse_mode: 'Markdown' });
      ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMessage, 2 * 60 * 1000);
    }

    await ctx.answerCbQuery();

    logger.info('Rules displayed', {
      userId,
      chatId: ctx.chat.id,
      language: lang,
    });
  } catch (error) {
    logger.error('Error handling view rules:', error);
    await ctx.answerCbQuery('Error loading rules. Please try again.');
  }
}

module.exports = registerGroupWelcomeHandlers;
