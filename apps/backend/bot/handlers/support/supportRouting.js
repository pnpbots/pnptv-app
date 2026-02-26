const logger = require('../../../utils/logger');
const supportRoutingService = require('../../services/supportRoutingService');
const SupportTopicModel = require('../../../models/supportTopicModel');
const UserModel = require('../../../models/userModel');
const { getLanguage } = require('../../utils/helpers');
const { addReaction } = require('../../utils/telegramReactions');
const { createChatInviteLink } = require('../../utils/telegramAdmin');

/**
 * Support Routing Handlers
 * Handles message routing between users and the support group
 */
const registerSupportRoutingHandlers = (bot) => {
  const SUPPORT_GROUP_ID = process.env.SUPPORT_GROUP_ID;
  const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS?.split(',').map(id => id.trim()) || [];
  const escapeMarkdown = (text) => {
    if (!text) return '';
    return text.replace(/([_*\[\]`])/g, '\\$1');
  };

  if (!SUPPORT_GROUP_ID) {
    logger.warn('SUPPORT_GROUP_ID not configured. Support routing handlers will not work.');
    return;
  }

  logger.info('[DEBUG] Support routing registering with SUPPORT_GROUP_ID:', { SUPPORT_GROUP_ID });

  const getThreadIdFromContext = (ctx) => (
    ctx.message?.message_thread_id || ctx.update?.callback_query?.message?.message_thread_id
  );

  const sendQuickAnswer = async ({
    ctx,
    answerId,
    langOption,
    threadId,
    userId,
  }) => {
    if (!threadId) {
      await ctx.reply('❌ Este comando solo puede usarse dentro de un topic de soporte.');
      return;
    }

    const supportTopic = await SupportTopicModel.getByThreadId(threadId)
      || (userId ? await SupportTopicModel.getByUserId(userId) : null);

    if (!supportTopic) {
      await ctx.reply('❌ No se encontró el ticket de soporte para este topic.', {
        message_thread_id: threadId,
      });
      return;
    }

    const answer = QUICK_ANSWERS[answerId];
    if (!answer) {
      await ctx.reply('❌ Respuesta rápida no encontrada.', {
        message_thread_id: threadId,
      });
      return;
    }

    const targetUserId = supportTopic.user_id;
    const adminName = ctx.from.first_name || 'Soporte';

    let messageToSend = '';

    if (langOption === 'en') {
      messageToSend = answer.en;
    } else if (langOption === 'es') {
      messageToSend = answer.es;
    } else if (langOption === 'both') {
      messageToSend = `🇪🇸 *Español:*\n${answer.es}\n\n---\n\n🇺🇸 *English:*\n${answer.en}`;
    } else {
      messageToSend = supportTopic.language === 'en' ? answer.en : answer.es;
    }

    await ctx.telegram.sendMessage(
      targetUserId,
      `💬 *${adminName} (Soporte):*\n\n${messageToSend}`,
      { parse_mode: 'Markdown' }
    );

    try {
      await addReaction(ctx, '✅');
    } catch (reactError) {
      logger.debug('Could not add reaction:', reactError.message);
    }

    await SupportTopicModel.updateLastAgentMessage(targetUserId);

    if (!supportTopic.first_response_at) {
      await SupportTopicModel.updateFirstResponse(targetUserId);
    }

    logger.info('Quick answer sent', {
      answerId,
      lang: langOption || 'auto',
      userId: targetUserId,
      adminId: ctx.from.id,
    });
    await supportRoutingService.indicateQuickAnswerDelivery(ctx);
  };

  const activateMembershipForUser = async (ctx, targetUserId, planOrDays, threadId) => {
    try {
      const user = await UserModel.getById(targetUserId);

      if (!user) {
        await ctx.reply(`❌ Usuario ${targetUserId} no encontrado en la base de datos.`, {
          message_thread_id: threadId,
        });
        return;
      }

      let durationDays = 30;
      let planId = 'monthly_pass';
      let planName = 'Monthly Pass (30 días)';
      let isLifetime = false;

      if (planOrDays) {
        const input = planOrDays.toLowerCase();
        const planMappings = {
          lifetime: { planId: 'lifetime_pass', planName: 'Lifetime Pass', days: 36500, isLifetime: true },
          lifetime_pass: { planId: 'lifetime_pass', planName: 'Lifetime Pass', days: 36500, isLifetime: true },
          forever: { planId: 'lifetime_pass', planName: 'Lifetime Pass', days: 36500, isLifetime: true },
          week: { planId: 'week_pass', planName: 'Week Pass (7 días)', days: 7 },
          week_pass: { planId: 'week_pass', planName: 'Week Pass (7 días)', days: 7 },
          weekly: { planId: 'week_pass', planName: 'Week Pass (7 días)', days: 7 },
          semanal: { planId: 'week_pass', planName: 'Week Pass (7 días)', days: 7 },
          month: { planId: 'monthly_pass', planName: 'Monthly Pass (30 días)', days: 30 },
          monthly: { planId: 'monthly_pass', planName: 'Monthly Pass (30 días)', days: 30 },
          monthly_pass: { planId: 'monthly_pass', planName: 'Monthly Pass (30 días)', days: 30 },
          mensual: { planId: 'monthly_pass', planName: 'Monthly Pass (30 días)', days: 30 },
          crystal: { planId: 'crystal_pass', planName: 'Crystal Pass (120 días)', days: 120 },
          crystal_pass: { planId: 'crystal_pass', planName: 'Crystal Pass (120 días)', days: 120 },
          year: { planId: 'yearly_pass', planName: 'Yearly Pass (365 días)', days: 365 },
          yearly: { planId: 'yearly_pass', planName: 'Yearly Pass (365 días)', days: 365 },
          yearly_pass: { planId: 'yearly_pass', planName: 'Yearly Pass (365 días)', days: 365 },
          anual: { planId: 'yearly_pass', planName: 'Yearly Pass (365 días)', days: 365 },
        };

        if (/^\d+$/.test(input)) {
          durationDays = parseInt(input);
          if (durationDays === 7) {
            planId = 'week_pass';
            planName = 'Week Pass (7 días)';
          } else if (durationDays === 30) {
            planId = 'monthly_pass';
            planName = 'Monthly Pass (30 días)';
          } else if (durationDays === 120) {
            planId = 'crystal_pass';
            planName = 'Crystal Pass (120 días)';
          } else if (durationDays === 365) {
            planId = 'yearly_pass';
            planName = 'Yearly Pass (365 días)';
          } else if (durationDays >= 36500) {
            planId = 'lifetime_pass';
            planName = 'Lifetime Pass';
            isLifetime = true;
          } else {
            planId = 'custom';
            planName = `Custom (${durationDays} días)`;
          }
        } else if (planMappings[input]) {
          const plan = planMappings[input];
          planId = plan.planId;
          planName = plan.planName;
          durationDays = plan.days;
          isLifetime = plan.isLifetime || false;
        }
      }

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + durationDays);

      await UserModel.updateSubscription(targetUserId, {
        status: 'active',
        planId: planId,
        expiry: isLifetime ? null : expiryDate.toISOString(),
      });

      const adminName = ctx.from.first_name || 'Soporte';
      const userLang = user.language || 'es';

      const primeChannelLink = await createChatInviteLink(ctx, process.env.PRIME_CHANNEL_ID, `support_activation_${targetUserId}`, 1);

      const notificationMessage = userLang === 'en'
      ? `🎉 *Membership Activated!*\n\n✅ Your *${planName}* membership has been activated by ${adminName}.\n\n${isLifetime ? '♾️ This is a lifetime membership - enjoy forever!' : `📅 Expires: ${expiryDate.toLocaleDateString()}`}\n\nYou now have full access to:\n🔥 Videorama\n📍 Nearby\n🎥 Hangouts\n📺 PNP Live\n\n- PNP Latino TV PRIME content: ${primeChannelLink}\n- PNP Live: Latinos streaming on webcam.\n- PNP Hangouts: video call rooms.\n- PNP Videorama: Podcasts and Music Playlist in the PNP Latino style you love.\n\nEnjoy! 🎊`
      : `🎉 *¡Membresía Activada!*\n\n✅ Tu membresía *${planName}* ha sido activada por ${adminName}.\n\n${isLifetime ? '♾️ Esta es una membresía de por vida - ¡disfruta para siempre!' : `📅 Expira: ${expiryDate.toLocaleDateString()}`}\n\nAhora tienes acceso completo a:\n🔥 Videorama\n📍 Nearby (Quién está cerca)\n🎥 Hangouts\n📺 PNP Live\n\n- Contenido PRIME de PNP Latino TV: ${primeChannelLink}\n- PNP Live: Latinos transmitiendo en vivo por webcam.\n- PNP Hangouts: salas de videollamadas.\n- PNP Videorama: Podcasts y listas de reproducción de música al estilo que te encanta de PNP Latino.\n\n¡Disfruta! 🎊`;


      try {
        await ctx.telegram.sendMessage(targetUserId, notificationMessage, { parse_mode: 'Markdown' });

        // Send PRIME main menu after activation message
        const { sendPrimeMenuToUser } = require('../user/menu');
        await sendPrimeMenuToUser(ctx.telegram, targetUserId, userLang || 'es');
      } catch (notifyError) {
        logger.warn('Could not notify user about membership activation:', notifyError.message);
      }

      const userName = user.firstName || user.username || targetUserId;
      await ctx.reply(`✅ *Membresía Activada*

👤 *Usuario:* ${userName} (\`${targetUserId}\`)
📋 *Plan:* ${planName}
📅 *Expira:* ${isLifetime ? 'Nunca (Lifetime)' : expiryDate.toLocaleDateString()}
👨‍💼 *Activado por:* ${adminName}

_El usuario ha sido notificado._`, {
        parse_mode: 'Markdown',
        message_thread_id: threadId,
      });

      logger.info('Membership activated via support', {
        userId: targetUserId,
        planId,
        durationDays,
        activatedBy: ctx.from.id,
      });
      await resolveSupportTicket(ctx, targetUserId, threadId, 'Membership activated.');
    } catch (error) {
      logger.error('Error activating membership:', error);
      await ctx.reply('❌ Error al activar membresía: ' + error.message, {
        message_thread_id: threadId,
      });
    }
  };

  const resolveSupportTicket = async (ctx, userId, threadId, resolutionNote) => {
    let supportTopic = await SupportTopicModel.getByUserId(String(userId));
    let effectiveUserId = String(userId);

    // Handle stale callback payloads by recovering topic from current thread.
    if (!supportTopic && threadId) {
      const topicByThread = await SupportTopicModel.getByThreadId(threadId);
      if (topicByThread) {
        supportTopic = topicByThread;
        effectiveUserId = String(topicByThread.user_id);
        logger.warn('Support ticket recovered by thread fallback', {
          requestedUserId: String(userId),
          effectiveUserId,
          threadId,
        });
      }
    }

    if (!supportTopic) {
      await ctx.reply('❌ No se encontró el ticket de soporte para este usuario.', {
        message_thread_id: threadId,
      });
      return;
    }

    try {
      await SupportTopicModel.updateStatus(effectiveUserId, 'resolved');
      await SupportTopicModel.updateResolutionTime(effectiveUserId);

      if (supportTopic.thread_id) {
        try {
          await ctx.telegram.closeForumTopic(SUPPORT_GROUP_ID, supportTopic.thread_id);
        } catch (closeError) {
          logger.debug('Could not close forum topic:', closeError.message);
        }
      }

      const user = await UserModel.getById(effectiveUserId);
      const userName = escapeMarkdown(user?.firstName || user?.username || effectiveUserId);
      const adminName = escapeMarkdown(ctx.from.first_name || 'Soporte');
      const userLang = user?.language || 'es';
      const safeResolutionNote = escapeMarkdown(resolutionNote || '');
      const resolvedMessage = userLang === 'en'
      ? `✅ *Case Resolved*\n\nYour support ticket has been marked as resolved by ${adminName}.\n\n${safeResolutionNote ? `📝 *Note:* ${safeResolutionNote}\n\n` : ''}If you need anything else in the future, don't hesitate to reach out.\n\n⭐ _We'd love to hear about your experience! Please rate us 1-4._\n\nThanks for being part of PNP! 💜`
      : `✅ *Caso Resuelto*\n\nTu ticket de soporte ha sido marcado como resuelto por ${adminName}.\n\n${safeResolutionNote ? `📝 *Nota:* ${safeResolutionNote}\n\n` : ''}Si necesitas algo más en el futuro, no dudes en contactarnos.\n\n⭐ _¡Nos encantaría saber tu experiencia! Por favor califícanos del 1 al 4._\n\n¡Gracias por ser parte de PNP! 💜`;

    const ratingButtons = [
      { text: '⭐️', callback_data: `rate_ticket:${effectiveUserId}:1` },
      { text: '⭐️⭐️', callback_data: `rate_ticket:${effectiveUserId}:2` },
      { text: '⭐️⭐️⭐️', callback_data: `rate_ticket:${effectiveUserId}:3` },
      { text: '⭐️⭐️⭐️⭐️', callback_data: `rate_ticket:${effectiveUserId}:4` },
    ];
    const reopenButton = { text: 'Re-open Ticket', callback_data: `reopen_ticket:${effectiveUserId}` };

    try {
      await ctx.telegram.sendMessage(effectiveUserId, resolvedMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [ratingButtons, [reopenButton]],
        },
      });
    } catch (notifyError) {
      logger.warn('Could not notify user about resolution:', notifyError.message);
    }

      let resolutionTime = 'N/A';
      if (supportTopic.created_at) {
        const createdAt = new Date(supportTopic.created_at);
        const now = new Date();
        const diffMs = now - createdAt;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        resolutionTime = diffHours > 0 ? `${diffHours}h ${diffMins}m` : `${diffMins}m`;
      }

      await ctx.reply(`✅ *Caso Resuelto*

👤 *Usuario:* ${userName} (\`${escapeMarkdown(String(effectiveUserId))}\`)
⏱️ *Tiempo de resolución:* ${resolutionTime}
👨‍💼 *Resuelto por:* ${adminName}
${safeResolutionNote ? `📝 *Nota:* ${safeResolutionNote}` : ''}

_El usuario ha sido notificado y se le pidió calificación._
_El topic ha sido cerrado._`, {
        parse_mode: 'Markdown',
        message_thread_id: threadId || supportTopic.thread_id,
      });

      logger.info('Support ticket resolved', {
        userId: effectiveUserId,
        resolvedBy: ctx.from.id,
        resolutionTime,
        note: resolutionNote,
      });
    } catch (error) {
      logger.error('Error resolving support ticket:', error);
      await ctx.reply('❌ Error al resolver el ticket: ' + error.message, {
        message_thread_id: threadId,
      });
    }
  };

  const sendUserInfo = async (ctx, targetUserId, threadId) => {
    try {
      const user = await UserModel.getById(targetUserId);

      if (!user) {
        await ctx.reply(`❌ Usuario ${targetUserId} no encontrado.`, {
          message_thread_id: threadId,
        });
        return;
      }

      const subscriptionEmoji = user.subscriptionStatus === 'active' ? '✅' : '❌';
      const tierEmoji = {
        Free: '🆓',
        Prime: '👑',
        Silver: '⭐',
        Golden: '👑',
      }[user.tier] || '❓';

      let expiryText = 'N/A';
      if (user.planExpiry) {
        const expiry = new Date(user.planExpiry);
        const now = new Date();
        const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        expiryText = daysLeft > 0
          ? `${expiry.toLocaleDateString()} (${daysLeft} días restantes)`
          : `${expiry.toLocaleDateString()} (EXPIRADO)`;
      } else if (user.subscriptionStatus === 'active' && user.planId?.includes('lifetime')) {
        expiryText = '♾️ Lifetime (Nunca expira)';
      }

      const firstName = escapeMarkdown(user.firstName || 'N/A');
      const lastName = escapeMarkdown(user.lastName || '');
      const username = escapeMarkdown(user.username || 'N/A');
      const email = escapeMarkdown(user.email || 'N/A');
      const tier = escapeMarkdown(user.tier || 'Free');
      const subscriptionStatus = escapeMarkdown(user.subscriptionStatus || 'free');
      const planId = escapeMarkdown(user.planId || 'Ninguno');
      const safeExpiryText = escapeMarkdown(expiryText);
      const language = escapeMarkdown(user.language || 'es');
      const createdAt = escapeMarkdown(
        user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'
      );
      const lastActive = escapeMarkdown(
        user.lastActive ? new Date(user.lastActive).toLocaleDateString() : 'N/A'
      );

      const message = `👤 *Información del Usuario*

🆔 *ID:* \`${escapeMarkdown(String(user.id || 'N/A'))}\`
👤 *Nombre:* ${firstName} ${lastName}
📧 *Username:* @${username}
📩 *Email:* ${email}

${tierEmoji} *Tier:* ${tier}
${subscriptionEmoji} *Estado:* ${subscriptionStatus}
📋 *Plan:* ${planId}
📅 *Expira:* ${safeExpiryText}

🌐 *Idioma:* ${language}
📝 *Onboarding:* ${user.onboardingComplete ? '✅ Completo' : '⏳ Pendiente'}
📆 *Registro:* ${createdAt}
🕐 *Última actividad:* ${lastActive}`;

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        message_thread_id: threadId,
      });
    } catch (error) {
      logger.error('Error getting user info:', error);
      await ctx.reply('❌ Error al obtener información del usuario: ' + error.message, {
        message_thread_id: threadId,
      });
    }
  };

  /**
   * Extract user ID from message text
   * Looks for patterns like "User ID: 123456789" or "🔢 *User ID:* `123456789`"
   */
  const extractUserIdFromText = (text) => {
    if (!text) return null;

    // Pattern 1: User ID: 123456789 or User ID: `123456789`
    const pattern1 = /User ID[:\s]*`?(\d{6,15})`?/i;
    // Pattern 2: 🔢 *User ID:* `123456789`
    const pattern2 = /User ID[:\s]*\*?`?(\d{6,15})`?\*?/i;
    // Pattern 3: ID: 123456789
    const pattern3 = /\bID[:\s]*`?(\d{6,15})`?/i;
    // Pattern 4: from=123456789 or from User 123456789
    const pattern4 = /from[=\s]+(?:User\s+)?(\d{6,15})/i;

    for (const pattern of [pattern1, pattern2, pattern3, pattern4]) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  };

  /**
   * Handler for messages in support group topics
   * Routes admin replies to users
   */
  bot.on('message', async (ctx, next) => {
    // Only process messages in the support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return next();
    }

    // Skip bot's own messages
    if (ctx.from?.is_bot) {
      return next();
    }

    // Skip messages that start with / (commands)
    if (ctx.message?.text?.startsWith('/')) {
      return next();
    }

    const threadId = ctx.message?.message_thread_id;

    try {
      // CASE 1: Message is in a support topic (has threadId)
      if (threadId) {
        const supportTopic = await SupportTopicModel.getByThreadId(threadId);

        if (supportTopic) {
          // Send the admin's reply to the user
          await supportRoutingService.sendReplyToUser(threadId, ctx);
          return;
        }
      }

      // CASE 2: Message is a reply to an old message (no topic, but has reply_to_message)
      const replyToMessage = ctx.message?.reply_to_message;
      if (replyToMessage) {
        let targetUserId = null;

        // Try to extract user ID from the replied message text
        const replyText = replyToMessage.text || replyToMessage.caption || '';
        targetUserId = extractUserIdFromText(replyText);

        // Also check if the replied message was forwarded from a user
        if (!targetUserId && replyToMessage.forward_from) {
          targetUserId = String(replyToMessage.forward_from.id);
        }

        // Check forward_sender_name for hidden forwards
        if (!targetUserId && replyToMessage.forward_sender_name) {
          // Try to extract from the message text itself
          targetUserId = extractUserIdFromText(replyText);
        }

        if (targetUserId) {
          logger.info('Extracted user ID from reply', { targetUserId, adminId: ctx.from.id });

          // Send the reply to the user
          const adminName = ctx.from.first_name || 'Soporte';
          const message = ctx.message;

          // Reply instructions in both languages
          const replyInstructions = `\n\n💡 _Para responder: Mantén presionado este mensaje y selecciona "Responder"._\n💡 _To reply: Tap and hold this message and select "Reply"._`;

          try {
            if (message.text) {
              await ctx.telegram.sendMessage(
                targetUserId,
                `💬 *${adminName} (Soporte):*\n\n${message.text}${replyInstructions}`,
                { parse_mode: 'Markdown' }
              );
            } else if (message.photo) {
              const photo = message.photo[message.photo.length - 1];
              await ctx.telegram.sendPhoto(
                targetUserId,
                photo.file_id,
                {
                  caption: `💬 *${adminName} (Soporte):*\n\n${message.caption || ''}${replyInstructions}`,
                  parse_mode: 'Markdown',
                }
              );
            } else if (message.document) {
              await ctx.telegram.sendDocument(
                targetUserId,
                message.document.file_id,
                {
                  caption: `💬 *${adminName} (Soporte):*\n\n${message.caption || ''}${replyInstructions}`,
                  parse_mode: 'Markdown',
                }
              );
            } else if (message.voice) {
              await ctx.telegram.sendMessage(targetUserId, `💬 *${adminName} (Soporte):*${replyInstructions}`, { parse_mode: 'Markdown' });
              await ctx.telegram.sendVoice(targetUserId, message.voice.file_id);
            } else if (message.video) {
              await ctx.telegram.sendVideo(
                targetUserId,
                message.video.file_id,
                {
                  caption: `💬 *${adminName} (Soporte):*\n\n${message.caption || ''}${replyInstructions}`,
                  parse_mode: 'Markdown',
                }
              );
            } else if (message.sticker) {
              await ctx.telegram.sendMessage(targetUserId, `💬 *${adminName} (Soporte):*${replyInstructions}`, { parse_mode: 'Markdown' });
              await ctx.telegram.sendSticker(targetUserId, message.sticker.file_id);
            } else {
              // Forward as-is for other types
              await ctx.telegram.forwardMessage(targetUserId, ctx.chat.id, message.message_id);
              await ctx.telegram.sendMessage(targetUserId, replyInstructions.trim(), { parse_mode: 'Markdown' });
            }

            // React with checkmark
            try {
            await addReaction(ctx, '👍');
            } catch (reactError) {
              logger.debug('Could not add reaction:', reactError.message);
            }

            logger.info('Reply sent to user from old message', { targetUserId, adminId: ctx.from.id });

            // Create topic for future conversations if it doesn't exist
            try {
              const existingTopic = await SupportTopicModel.getByUserId(targetUserId);
              if (!existingTopic) {
                // Create a topic for this user
                const userInfo = await ctx.telegram.getChat(targetUserId).catch(() => null);
                if (userInfo) {
                  await supportRoutingService.getOrCreateUserTopic(userInfo, 'support');
                  logger.info('Created topic for user from old message reply', { targetUserId });
                }
              }
            } catch (topicError) {
              logger.warn('Could not create topic for user:', topicError.message);
            }

            return;
          } catch (sendError) {
            logger.error('Failed to send reply to user:', sendError);

            if (sendError.description?.includes('bot was blocked')) {
              await ctx.reply('⚠️ No se pudo enviar: El usuario ha bloqueado el bot.', { reply_to_message_id: ctx.message.message_id });
            } else if (sendError.description?.includes('chat not found')) {
              await ctx.reply('⚠️ No se pudo enviar: Usuario no encontrado o nunca inició el bot.', { reply_to_message_id: ctx.message.message_id });
            }
            return;
          }
        }
      }

      // Not a support-related message, let other handlers process
      return next();

    } catch (error) {
      logger.error('Error processing support group message:', error);
      return next();
    }
  });

  /**
   * Handle satisfaction feedback from users
   * This should be registered after other handlers to catch unprocessed messages
   */
  bot.on('message', async (ctx, next) => {
    try {
      // Skip if not a text message
      if (!ctx.message?.text) {
        return next();
      }

      const userId = String(ctx.from?.id);
      const messageText = ctx.message.text.trim();

      // Check if this is satisfaction feedback (1-5 rating or text feedback)
      const isRating = /^\s*[1-5]\s*$/.test(messageText);
      const isTextFeedback = messageText.length > 10 && messageText.length < 500;

      if (isRating || isTextFeedback) {
        // Check if user has a recently closed ticket
        const supportTopic = await SupportTopicModel.getByUserId(userId);
        
        if (supportTopic && supportTopic.status === 'closed' && !supportTopic.user_satisfaction) {
          // Handle the feedback
          const handled = await supportRoutingService.handleSatisfactionFeedback(userId, messageText);
          
          if (handled) {
            // Don't process this message further
            return;
          }
        }
      }

      // Continue with other handlers
      return next();
      
    } catch (error) {
      logger.error('Error handling satisfaction feedback:', error);
      return next();
    }
  });

  /**
   * Command to close a support ticket
   * Usage: /close_USER_ID or /close (in support topic)
   */
  bot.hears(/^\/(close|cerrar)(?:_(\d+))?(?:\s+(\d+))?$/i, async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const match = ctx.match;

    try {
      let userId = match[2] || match[3]; // From underscore or space format
      let supportTopic = null;

      // If in a topic and no user ID specified, close that topic
      if (!userId && threadId) {
        supportTopic = await SupportTopicModel.getByThreadId(threadId);
        if (supportTopic) {
          userId = supportTopic.user_id;
        }
      }

      // Get support topic if we have user ID but no topic yet
      if (userId && !supportTopic) {
        supportTopic = await SupportTopicModel.getByUserId(userId);
      }

      if (!userId || !supportTopic) {
        await ctx.reply('❌ Ticket no encontrado.\n\nUso: `/close_USERID` o `/close` en el topic', { parse_mode: 'Markdown' });
        return;
      }

      // Close the topic
      const closed = await supportRoutingService.closeUserTopic(userId);

      if (closed) {
        await ctx.reply(`✅ Ticket cerrado para usuario ${userId}.\n\nEl topic se ha marcado como resuelto.`, {
          message_thread_id: threadId || supportTopic.thread_id,
        });

        // Notify user that their ticket was closed
        try {
          await ctx.telegram.sendMessage(
            userId,
            '✅ *Ticket Cerrado*\n\nTu solicitud de soporte ha sido resuelta. Si necesitas más ayuda, puedes abrir un nuevo ticket desde el menú de soporte.',
            { parse_mode: 'Markdown' }
          );
        } catch (notifyError) {
          logger.warn('Could not notify user about ticket closure:', notifyError.message);
        }
      } else {
        await ctx.reply('❌ No se pudo cerrar el ticket.');
      }

    } catch (error) {
      logger.error('Error closing support ticket:', error);
      await ctx.reply('❌ Error al cerrar el ticket: ' + error.message);
    }
  });

  /**
   * Command to reopen a support ticket
   * Usage: /reopen_USER_ID or /reopen (in support topic)
   */
  bot.hears(/^\/(reopen|reabrir)(?:_(\d+))?(?:\s+(\d+))?$/i, async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const match = ctx.match;

    try {
      let userId = match[2] || match[3]; // From underscore or space format
      let supportTopic = null;

      if (!userId && threadId) {
        supportTopic = await SupportTopicModel.getByThreadId(threadId);
        if (supportTopic) {
          userId = supportTopic.user_id;
        }
      }

      if (!userId) {
        await ctx.reply('❌ Ticket no encontrado.\n\nUso: `/reopen_USERID` o `/reopen` en el topic', { parse_mode: 'Markdown' });
        return;
      }

      if (!supportTopic) {
        supportTopic = await SupportTopicModel.getByUserId(userId);
      }

      await SupportTopicModel.updateStatus(userId, 'open');

      // Reopen the forum topic if possible
      if (supportTopic && ctx.telegram) {
        try {
          await ctx.telegram.reopenForumTopic(SUPPORT_GROUP_ID, supportTopic.thread_id);
        } catch (reopenError) {
          logger.warn('Could not reopen forum topic:', reopenError.message);
        }
      }

      await ctx.reply(`✅ Ticket reabierto para usuario ${userId}.`, {
        message_thread_id: threadId || (supportTopic?.thread_id),
      });

    } catch (error) {
      logger.error('Error reopening support ticket:', error);
      await ctx.reply('❌ Error al reabrir el ticket: ' + error.message);
    }
  });

  /**
   * Command to get support statistics
   * Usage: /supportstats
   */
  bot.command('supportstats', async (ctx) => {
    // Only in support group or from admins
    const isInSupportGroup = String(ctx.chat?.id) === String(SUPPORT_GROUP_ID);
    const isAdmin = ADMIN_USER_IDS.includes(String(ctx.from?.id));

    if (!isInSupportGroup && !isAdmin) {
      return;
    }

    try {
      const stats = await SupportTopicModel.getStatistics();

      const message = `📊 *Estadísticas de Soporte*

📋 Total de tickets: ${stats.total_topics || 0}
🟢 Abiertos: ${stats.open_topics || 0}
✅ Resueltos: ${stats.resolved_topics || 0}
🔒 Cerrados: ${stats.closed_topics || 0}

💬 Total de mensajes: ${stats.total_messages || 0}
📝 Promedio msgs/ticket: ${Math.round(stats.avg_messages_per_topic || 0)}`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error getting support stats:', error);
      await ctx.reply('❌ Error al obtener estadísticas: ' + error.message);
    }
  });

  /**
   * Command to list open tickets
   * Usage: /opentickets
   */
  bot.command('opentickets', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    try {
      const openTopics = await SupportTopicModel.getOpenTopics();

      if (openTopics.length === 0) {
        await ctx.reply('✅ No hay tickets abiertos.');
        return;
      }

      let message = `📋 *Tickets Abiertos (${openTopics.length})*\n\n`;

      for (const topic of openTopics.slice(0, 20)) { // Limit to 20
        const lastMsg = topic.last_message_at ? new Date(topic.last_message_at).toLocaleString('es-ES') : 'N/A';
        const priorityEmoji = supportRoutingService.getPriorityEmoji(topic.priority);
        const categoryEmoji = supportRoutingService.getCategoryEmoji(topic.category);
        message += `${priorityEmoji} ${categoryEmoji} **${topic.user_id}** - ${topic.message_count || 0} msgs\n  _Prioridad:_ ${topic.priority} | _Categoría:_ ${topic.category}\n  _Último:_ ${lastMsg}\n`;
      }

      if (openTopics.length > 20) {
        message += `\n_...y ${openTopics.length - 20} más_`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error listing open tickets:', error);
      await ctx.reply('❌ Error al listar tickets: ' + error.message);
    }
  });

  /**
   * Command to change ticket priority
   * Usage: /prioridad [alta|media|baja|crítica]
   */
  bot.command('prioridad', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const priority = args[0]?.toLowerCase();

    const validPriorities = {
      'alta': 'high',
      'media': 'medium',
      'baja': 'low',
      'crítica': 'critical',
      'high': 'high',
      'medium': 'medium',
      'low': 'low',
      'critical': 'critical'
    };

    if (!priority || !validPriorities[priority]) {
      await ctx.reply('❌ Uso: /prioridad [alta|media|baja|crítica|high|medium|low|critical]');
      return;
    }

    try {
      let supportTopic = null;
      
      // If in a topic, use that topic
      if (threadId) {
        supportTopic = await SupportTopicModel.getByThreadId(threadId);
      }

      if (!supportTopic) {
        await ctx.reply('❌ Este comando solo puede usarse dentro de un topic de soporte.');
        return;
      }

      const normalizedPriority = validPriorities[priority];
      await SupportTopicModel.updatePriority(supportTopic.user_id, normalizedPriority);

      const priorityEmoji = supportRoutingService.getPriorityEmoji(normalizedPriority);
      await ctx.reply(`✅ Prioridad actualizada a: ${priorityEmoji} *${normalizedPriority}*`, {
        message_thread_id: threadId,
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('Error changing ticket priority:', error);
      await ctx.reply('❌ Error al cambiar prioridad: ' + error.message);
    }
  });

  /**
   * Command to change ticket category
   * Usage: /categoria [facturación|técnico|suscripción|cuenta|general]
   */
  bot.command('categoria', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const category = args[0]?.toLowerCase();

    const validCategories = {
      'facturación': 'billing',
      'técnico': 'technical',
      'suscripción': 'subscription',
      'cuenta': 'account',
      'general': 'general',
      'billing': 'billing',
      'technical': 'technical',
      'subscription': 'subscription',
      'account': 'account'
    };

    if (!category || !validCategories[category]) {
      await ctx.reply('❌ Uso: /categoria [facturación|técnico|suscripción|cuenta|general|billing|technical|subscription|account]');
      return;
    }

    try {
      let supportTopic = null;
      
      // If in a topic, use that topic
      if (threadId) {
        supportTopic = await SupportTopicModel.getByThreadId(threadId);
      }

      if (!supportTopic) {
        await ctx.reply('❌ Este comando solo puede usarse dentro de un topic de soporte.');
        return;
      }

      const normalizedCategory = validCategories[category];
      await SupportTopicModel.updateCategory(supportTopic.user_id, normalizedCategory);

      const categoryEmoji = supportRoutingService.getCategoryEmoji(normalizedCategory);
      await ctx.reply(`✅ Categoría actualizada a: ${categoryEmoji} *${normalizedCategory}*`, {
        message_thread_id: threadId,
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('Error changing ticket category:', error);
      await ctx.reply('❌ Error al cambiar categoría: ' + error.message);
    }
  });

  /**
   * Command to assign ticket to agent
   * Usage: /asignar AGENT_ID
   */
  bot.command('asignar', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const agentId = args[0];

    if (!agentId) {
      await ctx.reply('❌ Uso: /asignar AGENT_ID');
      return;
    }

    try {
      let supportTopic = null;
      
      // If in a topic, use that topic
      if (threadId) {
        supportTopic = await SupportTopicModel.getByThreadId(threadId);
      }

      if (!supportTopic) {
        await ctx.reply('❌ Este comando solo puede usarse dentro de un topic de soporte.');
        return;
      }

      await SupportTopicModel.assignTo(supportTopic.user_id, agentId);

      // Get agent name if possible
      let agentName = agentId;
      try {
        const agentInfo = await ctx.telegram.getChat(agentId);
        agentName = agentInfo.first_name || agentName;
      } catch (agentError) {
        // Agent might not have started the bot
      }

      await ctx.reply(`✅ Ticket asignado a: *${agentName}* (ID: ${agentId})`, {
        message_thread_id: threadId,
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('Error assigning ticket:', error);
      await ctx.reply('❌ Error al asignar ticket: ' + error.message);
    }
  });

  /**
   * Command to escalate ticket
   * Usage: /escalar NIVEL (1-3)
   */
  bot.command('escalar', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const level = parseInt(args[0]);

    if (isNaN(level) || level < 1 || level > 3) {
      await ctx.reply('❌ Uso: /escalar NIVEL (1-3)');
      return;
    }

    try {
      let supportTopic = null;
      
      // If in a topic, use that topic
      if (threadId) {
        supportTopic = await SupportTopicModel.getByThreadId(threadId);
      }

      if (!supportTopic) {
        await ctx.reply('❌ Este comando solo puede usarse dentro de un topic de soporte.');
        return;
      }

      await SupportTopicModel.updateEscalationLevel(supportTopic.user_id, level);
      await SupportTopicModel.updatePriority(supportTopic.user_id, 'high'); // Escalated tickets become high priority

      const escalationEmojis = {1: '⚠️', 2: '🚨', 3: '🔥'};
      const emoji = escalationEmojis[level] || '⚠️';

      await ctx.reply(`✅ Ticket escalado a nivel: ${emoji} *${level}*\nPrioridad actualizada a: *high*`, {
        message_thread_id: threadId,
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('Error escalating ticket:', error);
      await ctx.reply('❌ Error al escalar ticket: ' + error.message);
    }
  });

  /**
   * Command to get enhanced statistics
   * Usage: /stats
   */
  bot.command('stats', async (ctx) => {
    // Only in support group or from admins
    const isInSupportGroup = String(ctx.chat?.id) === String(SUPPORT_GROUP_ID);
    const isAdmin = ADMIN_USER_IDS.includes(String(ctx.from?.id));

    if (!isInSupportGroup && !isAdmin) {
      return;
    }

    try {
      const stats = await SupportTopicModel.getStatistics();

      const message = `📊 *Estadísticas de Soporte Mejoradas*

📋 *Tickets Totales:* ${stats.total_topics || 0}
🟢 *Abiertos:* ${stats.open_topics || 0}
✅ *Resueltos:* ${stats.resolved_topics || 0}
🔒 *Cerrados:* ${stats.closed_topics || 0}

💬 *Mensajes Totales:* ${stats.total_messages || 0}
📝 *Promedio msgs/ticket:* ${Math.round(stats.avg_messages_per_topic || 0)}

🔥 *Prioridad Alta:* ${stats.high_priority || 0}
🚨 *Prioridad Crítica:* ${stats.critical_priority || 0}
⚠️ *Incumplimientos SLA:* ${stats.sla_breaches || 0}`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error getting enhanced stats:', error);
      await ctx.reply('❌ Error al obtener estadísticas: ' + error.message);
    }
  });

  /**
   * Command to search tickets
   * Usage: /buscar TERMINO
   */
  bot.command('buscar', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const searchTerm = args.join(' ');

    if (!searchTerm) {
      await ctx.reply('❌ Uso: /buscar TERMINO_O_USUARIO_ID');
      return;
    }

    try {
      const results = await SupportTopicModel.searchTopics(searchTerm);

      if (results.length === 0) {
        await ctx.reply('🔍 No se encontraron tickets que coincidan con: *' + searchTerm + '*', {
          parse_mode: 'Markdown'
        });
        return;
      }

      let message = `🔍 *Resultados de búsqueda para "${searchTerm}" (${results.length})*\n\n`;

      for (const topic of results.slice(0, 10)) { // Limit to 10
        const lastMsg = topic.last_message_at ? new Date(topic.last_message_at).toLocaleString('es-ES') : 'N/A';
        const priorityEmoji = supportRoutingService.getPriorityEmoji(topic.priority);
        const categoryEmoji = supportRoutingService.getCategoryEmoji(topic.category);
        const statusEmoji = topic.status === 'open' ? '🟢' : topic.status === 'closed' ? '🔴' : '🟡';
        
        message += `${statusEmoji} ${priorityEmoji} ${categoryEmoji} **${topic.user_id}**\n`;
        message += `   *Estado:* ${topic.status} | *Prioridad:* ${topic.priority}\n`;
        message += `   *Categoría:* ${topic.category} | *Último:* ${lastMsg}\n`;
      }

      if (results.length > 10) {
        message += `\n_...y ${results.length - 10} más_`;
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error searching tickets:', error);
      await ctx.reply('❌ Error al buscar tickets: ' + error.message);
    }
  });

  /**
   * Command to show SLA breached tickets
   * Usage: /sla
   */
  bot.command('sla', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    try {
      const breachedTopics = await SupportTopicModel.getSlaBreachedTopics();

      if (breachedTopics.length === 0) {
        await ctx.reply('✅ No hay incumplimientos de SLA activos.');
        return;
      }

      let message = `⚠️ *Incumplimientos de SLA (${breachedTopics.length})*\n\n`;

      for (const topic of breachedTopics.slice(0, 15)) { // Limit to 15
        const lastMsg = topic.last_message_at ? new Date(topic.last_message_at).toLocaleString('es-ES') : 'N/A';
        const priorityEmoji = supportRoutingService.getPriorityEmoji(topic.priority);
        const categoryEmoji = supportRoutingService.getCategoryEmoji(topic.category);
        
        // Calculate time since creation
        const createdAt = new Date(topic.created_at);
        const now = new Date();
        const hours = Math.floor((now - createdAt) / (1000 * 60 * 60));
        
        message += `${priorityEmoji} ${categoryEmoji} **${topic.user_id}**\n`;
        message += `   *Prioridad:* ${topic.priority} | *Categoría:* ${topic.category}\n`;
        message += `   *Tiempo:* ${hours}h sin respuesta | *Creado:* ${lastMsg}\n`;
      }

      if (breachedTopics.length > 15) {
        message += `\n_...y ${breachedTopics.length - 15} más_`;
      }

      message += `\n\n💡 *Sugerencia:* Usa /buscar USER_ID para encontrar y responder a estos tickets.`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error getting SLA breached tickets:', error);
      await ctx.reply('❌ Error al obtener incumplimientos de SLA: ' + error.message);
    }
  });

  /**
   * Command to show tickets needing first response
   * Usage: /sinrespuesta
   */
  bot.command('sinrespuesta', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    try {
      const noResponseTopics = await SupportTopicModel.getTopicsNeedingFirstResponse();

      if (noResponseTopics.length === 0) {
        await ctx.reply('✅ Todos los tickets tienen respuesta inicial.');
        return;
      }

      let message = `📩 *Tickets sin Primera Respuesta (${noResponseTopics.length})*\n\n`;

      for (const topic of noResponseTopics.slice(0, 15)) { // Limit to 15
        const createdAt = new Date(topic.created_at);
        const now = new Date();
        const hours = Math.floor((now - createdAt) / (1000 * 60 * 60));
        const priorityEmoji = supportRoutingService.getPriorityEmoji(topic.priority);
        const categoryEmoji = supportRoutingService.getCategoryEmoji(topic.category);
        
        message += `${priorityEmoji} ${categoryEmoji} **${topic.user_id}**\n`;
        message += `   *Prioridad:* ${topic.priority} | *Categoría:* ${topic.category}\n`;
        message += `   *Esperando:* ${hours}h | *Creado:* ${createdAt.toLocaleString('es-ES')}\n`;
      }

      if (noResponseTopics.length > 15) {
        message += `\n_...y ${noResponseTopics.length - 15} más_`;
      }

      message += `\n\n💡 *Sugerencia:* Responde a los tickets de mayor prioridad primero.`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error getting tickets needing first response:', error);
      await ctx.reply('❌ Error al obtener tickets sin respuesta: ' + error.message);
    }
  });

  /**
   * Command to send a message to a user
   * Usage: /msg USER_ID message text
   */
  bot.command('msg', async (ctx) => {
    // Only in support group or from admins
    const isInSupportGroup = String(ctx.chat?.id) === String(SUPPORT_GROUP_ID);
    const isAdmin = ADMIN_USER_IDS.includes(String(ctx.from?.id));

    if (!isInSupportGroup && !isAdmin) {
      return;
    }

    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length < 2) {
      await ctx.reply('❌ Uso: /msg USER_ID mensaje\n\nEjemplo: /msg 123456789 Hola, tu cuenta ha sido activada!');
      return;
    }

    const targetUserId = args[0];
    const messageText = args.slice(1).join(' ');
    const adminName = ctx.from.first_name || 'Soporte';

    try {
      await ctx.telegram.sendMessage(
        targetUserId,
        `💬 *${adminName} (Soporte):*\n\n${messageText}`,
        { parse_mode: 'Markdown' }
      );

      await ctx.reply(`✅ Mensaje enviado a usuario ${targetUserId}`);

      // Create/update support topic for tracking
      try {
        let supportTopic = await SupportTopicModel.getByUserId(targetUserId);
        if (supportTopic) {
          await SupportTopicModel.updateLastMessage(targetUserId);
        }
      } catch (dbError) {
        logger.warn('Could not update support topic:', dbError.message);
      }

    } catch (error) {
      logger.error('Error sending message to user:', error);

      if (error.description?.includes('bot was blocked')) {
        await ctx.reply('❌ No se pudo enviar el mensaje: El usuario ha bloqueado el bot.');
      } else if (error.description?.includes('chat not found')) {
        await ctx.reply('❌ No se pudo enviar el mensaje: Usuario no encontrado o nunca inició el bot.');
      } else {
        await ctx.reply('❌ Error al enviar mensaje: ' + error.message);
      }
    }
  });

  // ============================================
  // QUICK ANSWERS SYSTEM
  // ============================================

  /**
   * Quick answers for common support responses (bilingual)
   */
  const QUICK_ANSWERS = {
    1: {
      id: 'welcome',
      title: 'Bienvenida / Welcome',
      es: '👋 ¡Hola! Gracias por contactar a soporte de PNP. ¿En qué podemos ayudarte hoy?\n\n_Estamos aquí para resolver cualquier duda sobre tu membresía, pagos, o el uso de la plataforma._',
      en: '👋 Hi! Thanks for contacting PNP support. How can we help you today?\n\n_We\'re here to help with any questions about your membership, payments, or platform usage._',
    },
    2: {
      id: 'proof_of_payment',
      title: 'Pedir comprobante / Ask for Proof',
      es: '📸 *Comprobante de Pago Requerido*\n\nPara verificar tu pago, por favor envíanos:\n\n1️⃣ Captura de pantalla del comprobante de pago\n2️⃣ Fecha y hora de la transacción\n3️⃣ Método de pago utilizado (tarjeta, Daimo, etc.)\n4️⃣ Monto pagado\n\n_Sin esta información no podemos procesar tu solicitud._',
      en: '📸 *Proof of Payment Required*\n\nTo verify your payment, please send us:\n\n1️⃣ Screenshot of payment receipt/confirmation\n2️⃣ Date and time of the transaction\n3️⃣ Payment method used (card, Daimo, etc.)\n4️⃣ Amount paid\n\n_Without this information we cannot process your request._',
    },
    3: {
      id: 'membership_confirmed',
      title: 'Confirmar activación / Confirm Activation',
      es: '✅ *¡Membresía Confirmada!*\n\nHemos verificado tu pago y tu membresía está activa.\n\nAhora tienes acceso completo a:\n🔥 Videorama - Contenido exclusivo\n📍 Nearby - Encuentra gente cerca\n🎥 Hangouts - Videollamadas grupales\n📺 PNP Live - Transmisiones en vivo\n\n💡 _Usa /menu para acceder a todas las funciones._\n\n¡Disfruta! 🎉',
      en: '✅ *Membership Confirmed!*\n\nWe have verified your payment and your membership is now active.\n\nYou now have full access to:\n🔥 Videorama - Exclusive content\n📍 Nearby - Find people near you\n🎥 Hangouts - Group video calls\n📺 PNP Live - Live streams\n\n💡 _Use /menu to access all features._\n\nEnjoy! 🎉',
    },
    4: {
      id: 'refund_denied',
      title: 'Rechazar reembolso / Deny Refund',
      es: '❌ *Solicitud de Reembolso No Aplicable*\n\nLamentamos informarte que tu solicitud de reembolso no puede ser procesada debido a que:\n\n⏰ Ha pasado más de 1 hora desde la activación de tu membresía.\n\n📋 *Nuestra política de reembolsos:*\n• Solo se aceptan solicitudes dentro de la primera hora de activación\n• Debes no haber usado los servicios premium\n\nSi tienes problemas técnicos con tu membresía, con gusto te ayudamos a resolverlos.\n\n_Gracias por tu comprensión._',
      en: '❌ *Refund Request Not Applicable*\n\nWe regret to inform you that your refund request cannot be processed because:\n\n⏰ More than 1 hour has passed since your membership activation.\n\n📋 *Our refund policy:*\n• Requests are only accepted within the first hour of activation\n• Premium services must not have been used\n\nIf you\'re experiencing technical issues with your membership, we\'ll be happy to help resolve them.\n\n_Thank you for your understanding._',
    },
    5: {
      id: 'refund_policy',
      title: 'Política reembolso / Refund Policy',
      es: '💰 *Política de Reembolsos PNP*\n\n📋 *Requisitos:*\n• Solicitud dentro de la *primera hora* de activación\n• No haber utilizado servicios premium\n• Proporcionar comprobante de pago\n\n⏱️ *Tiempos:*\n• Resolución de solicitud: hasta 72 horas\n• Procesamiento del reembolso: hasta 15 días hábiles (dependiendo del método de pago)\n\n📝 *Para solicitar:*\nEnvía tu comprobante de pago y motivo de la solicitud.\n\n⚠️ _Reembolsos fuera de estos términos no serán procesados._',
      en: '💰 *PNP Refund Policy*\n\n📋 *Requirements:*\n• Request within the *first hour* of activation\n• Premium services must not have been used\n• Provide proof of payment\n\n⏱️ *Timeframes:*\n• Request resolution: up to 72 hours\n• Refund processing: up to 15 business days (depending on payment method)\n\n📝 *To request:*\nSend your proof of payment and reason for the request.\n\n⚠️ _Refunds outside these terms will not be processed._',
    },
    6: {
      id: 'case_resolved',
      title: 'Caso resuelto / Case Resolved',
      es: '✅ *Caso Resuelto*\n\nNos alegra haber podido ayudarte. Tu ticket de soporte ha sido marcado como resuelto.\n\nSi necesitas algo más en el futuro, no dudes en contactarnos.\n\n⭐ _¿Cómo fue tu experiencia? Responde del 1 al 5._\n\n¡Gracias por ser parte de PNP! 💜',
      en: '✅ *Case Resolved*\n\nWe\'re glad we could help. Your support ticket has been marked as resolved.\n\nIf you need anything else in the future, don\'t hesitate to reach out.\n\n⭐ _How was your experience? Reply with a number from 1 to 5._\n\nThanks for being part of PNP! 💜',
    },
    7: {
      id: 'payment_not_found',
      title: 'Pago no encontrado / Payment Not Found',
      es: '🔍 *Pago No Encontrado*\n\nNo hemos podido localizar tu pago en nuestro sistema.\n\nPor favor verifica:\n• Que el pago fue completado (no pendiente)\n• Que usaste el email correcto\n• Que no fue rechazado por el banco\n\n📸 Envía una captura del comprobante de pago para investigar.\n\n_Responderemos en cuanto verifiquemos la información._',
      en: '🔍 *Payment Not Found*\n\nWe could not locate your payment in our system.\n\nPlease verify:\n• The payment was completed (not pending)\n• You used the correct email\n• It wasn\'t declined by your bank\n\n📸 Send a screenshot of your payment receipt so we can investigate.\n\n_We\'ll respond once we verify the information._',
    },
    8: {
      id: 'how_to_pay',
      title: 'Cómo pagar / How to Pay',
      es: '💳 *Cómo Activar tu Membresía*\n\n1️⃣ Abre el bot y usa /menu\n2️⃣ Selecciona "💎 Membresía"\n3️⃣ Elige tu plan preferido\n4️⃣ Completa el pago\n\n*Métodos aceptados:*\n• 💳 Tarjeta de crédito/débito\n• 📱 Daimo (USDC crypto)\n\n💡 _El acceso se activa inmediatamente después del pago._\n\n¿Necesitas ayuda? ¡Aquí estamos!',
      en: '💳 *How to Activate Your Membership*\n\n1️⃣ Open the bot and use /menu\n2️⃣ Select "💎 Membership"\n3️⃣ Choose your preferred plan\n4️⃣ Complete the payment\n\n*Accepted methods:*\n• 💳 Credit/debit card\n• 📱 Daimo (USDC crypto)\n\n💡 _Access is activated immediately after payment._\n\nNeed help? We\'re here!',
    },
    9: {
      id: 'technical_issue',
      title: 'Problema técnico / Technical Issue',
      es: '🔧 *Soporte Técnico*\n\nPara ayudarte mejor, por favor envíanos:\n\n1️⃣ Descripción del problema\n2️⃣ Captura de pantalla del error\n3️⃣ Dispositivo que usas (iPhone, Android, etc.)\n4️⃣ ¿Cuándo comenzó el problema?\n\n_Revisaremos tu caso lo antes posible._',
      en: '🔧 *Technical Support*\n\nTo help you better, please send us:\n\n1️⃣ Description of the problem\n2️⃣ Screenshot of the error\n3️⃣ Device you\'re using (iPhone, Android, etc.)\n4️⃣ When did the problem start?\n\n_We\'ll review your case as soon as possible._',
    },
  };

  /**
   * Command to show quick answers menu
   * Usage: /respuestas
   */
  bot.command('respuestas', async (ctx) => {
    logger.info('[DEBUG /respuestas] Command triggered', {
      chatId: ctx.chat?.id,
      supportGroupId: SUPPORT_GROUP_ID,
      match: String(ctx.chat?.id) === String(SUPPORT_GROUP_ID)
    });

    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      logger.info('[DEBUG /respuestas] Chat ID mismatch, returning');
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    if (!threadId) {
      await ctx.reply('❌ Este comando solo puede usarse dentro de un topic de soporte.');
      return;
    }

    const supportTopic = await SupportTopicModel.getByThreadId(threadId);
    if (!supportTopic) {
      await ctx.reply('❌ No se encontró el ticket de soporte para este topic.', {
        message_thread_id: threadId,
      });
      return;
    }

    const message = `📋 *Respuestas Rápidas / Quick Answers*

Usa los botones para enviar una respuesta rápida al usuario del topic actual.
También puedes ejecutar acciones del ticket con los botones superiores.`;

    const actionButtons = [
      [
        { text: '✅ Activar Semana', callback_data: `support_cmd:activate:${supportTopic.user_id}:week` },
        { text: '✅ Activar Mes', callback_data: `support_cmd:activate:${supportTopic.user_id}:month` },
        { text: '✅ Activar Crystal', callback_data: `support_cmd:activate:${supportTopic.user_id}:crystal` },
      ],
      [
        { text: '✅ Activar Año', callback_data: `support_cmd:activate:${supportTopic.user_id}:year` },
        { text: '♾️ Activar Lifetime', callback_data: `support_cmd:activate:${supportTopic.user_id}:lifetime` },
      ],
      [
        { text: '👤 Ver usuario', callback_data: `support_cmd:user:${supportTopic.user_id}` },
        { text: '✅ Marcar resuelto', callback_data: `support_cmd:solved:${supportTopic.user_id}` },
        { text: '❌ Cerrar Ticket', callback_data: `support_cmd:close:${supportTopic.user_id}` },
      ],
    ];

    const quickButtons = Object.keys(QUICK_ANSWERS).map((key) => {
      const answerId = Number(key);
      const answer = QUICK_ANSWERS[answerId];
      return {
        text: `${answerId}. ${answer.title}`,
        callback_data: `support_cmd:quick:${supportTopic.user_id}:${answerId}`,
      };
    });

    const inlineKeyboard = [...actionButtons];
    for (let i = 0; i < quickButtons.length; i += 2) {
      inlineKeyboard.push(quickButtons.slice(i, i + 2));
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      message_thread_id: threadId,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  });

  /**
   * Quick answer commands (/r1, /r2, ... /r9) with underscore language option
   * Also registers /r1_en, /r1_es, /r1_both variants
   */
  for (let i = 1; i <= 9; i++) {
    // Register base command and language variants
    const commands = [`r${i}`, `r${i}_en`, `r${i}_es`, `r${i}_both`];

    bot.command(commands, async (ctx) => {
      // Only in support group
      if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
        return;
      }

      const threadId = ctx.message?.message_thread_id;
      const commandText = ctx.message?.text?.split(' ')[0] || '';

      // Extract language from command (e.g., /r1_en -> en)
      let langOption = null;
      if (commandText.includes('_en')) langOption = 'en';
      else if (commandText.includes('_es')) langOption = 'es';
      else if (commandText.includes('_both')) langOption = 'both';

      try {
        await sendQuickAnswer({
          ctx,
          answerId: i,
          langOption,
          threadId,
        });
      } catch (error) {
        logger.error('Error sending quick answer:', error);

        if (error.description?.includes('bot was blocked')) {
          await ctx.reply('⚠️ No se pudo enviar: El usuario ha bloqueado el bot.', {
            message_thread_id: threadId
          });
        } else {
          await ctx.reply('❌ Error al enviar respuesta: ' + error.message, {
            message_thread_id: threadId
          });
        }
      }
    });
  }

  bot.action(/^support_cmd:(\w+):(\d+)(?::([\w-]+))?$/i, async (ctx) => {
    const chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;

    if (String(chatId) !== String(SUPPORT_GROUP_ID)) {
      try {
        await ctx.answerCbQuery('Solo disponible en el grupo de soporte.');
      } catch (error) {
        logger.debug('Could not answer callback query:', error.message);
      }
      return;
    }

    const threadId = getThreadIdFromContext(ctx);
    const action = ctx.match[1];
    const userId = ctx.match[2];
    const option = ctx.match[3];

    try {
      await ctx.answerCbQuery();
    } catch (error) {
      logger.debug('Could not answer callback query:', error.message);
    }

    try {
      if (action === 'activate') {
        await activateMembershipForUser(ctx, userId, option, threadId);
        return;
      }

      if (action === 'user') {
        await sendUserInfo(ctx, userId, threadId);
        return;
      }

      if (action === 'solved') {
        await resolveSupportTicket(ctx, userId, threadId, '');
        return;
      }

      if (action === 'quick') {
        const answerId = Number(option);
        await sendQuickAnswer({
          ctx,
          answerId,
          langOption: null,
          threadId,
          userId,
        });
        return;
      }

      if (action === 'close') {
        await closeSupportTicket(ctx, userId, threadId);
        return;
      }

      await ctx.reply('❌ Acción no reconocida.', {
        message_thread_id: threadId,
      });
    } catch (error) {
      logger.error('Error handling quick action:', error);
      await ctx.reply('❌ Error al ejecutar la acción: ' + error.message, {
        message_thread_id: threadId,
      });
    }
  });

  // ============================================
  // MEMBERSHIP ACTIVATION FROM SUPPORT
  // ============================================

  /**
   * Command to activate membership for a user
   * Supports both formats:
   *   /activate_USER_ID_PLAN (underscore format)
   *   /activar USER_ID PLAN (space format - legacy)
   *
   * Examples:
   *   /activate_123456789_lifetime
   *   /activate_123456789_30
   *   /activate_123456789_weekly
   *   /activar 123456789 lifetime
   */
  bot.hears(/^\/(activate|activar)(?:_(\d+))?(?:_(\w+))?(?:\s+(\d+))?(?:\s+(\w+))?$/i, async (ctx) => {
    // Only in support group or from admins
    const isInSupportGroup = String(ctx.chat?.id) === String(SUPPORT_GROUP_ID);
    const isAdmin = ADMIN_USER_IDS.includes(String(ctx.from?.id));

    if (!isInSupportGroup && !isAdmin) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;

    // Parse from regex match groups:
    // [1] = command (activate|activar)
    // [2] = user_id from underscore format
    // [3] = plan from underscore format
    // [4] = user_id from space format
    // [5] = plan from space format
    const match = ctx.match;
    let targetUserId = match[2] || match[4];
    let planOrDays = match[3] || match[5];

    // Also try parsing from space-separated args for legacy format
    const args = ctx.message?.text?.split(/[\s_]+/).slice(1).filter(a => a) || [];
    if (!targetUserId && args.length > 0 && /^\d+$/.test(args[0])) {
      targetUserId = args[0];
      planOrDays = args[1];
    }

    // If no user ID provided but we're in a topic, use that user
    if (!targetUserId && threadId) {
      const supportTopic = await SupportTopicModel.getByThreadId(threadId);
      if (supportTopic) {
        targetUserId = supportTopic.user_id;
        // Check if there's a plan in the args
        if (args.length > 0 && !/^\d{6,}$/.test(args[0])) {
          planOrDays = args[0];
        }
      }
    }

    if (!targetUserId) {
      await ctx.reply(`❌ *Activar Membresía / Activate Membership*

*Formato con guión bajo (recomendado):*
\`/activate_USERID_PLAN\`

*Ejemplos / Examples:*
• \`/activate_123456789_30\` - 30 días
• \`/activate_123456789_lifetime\` - De por vida
• \`/activate_123456789_weekly\` - 7 días
• \`/activate_123456789_monthly\` - 30 días
• \`/activate_123456789_yearly\` - 365 días

*En un topic / In a topic:*
• \`/activate_lifetime\` - Activa usuario del topic
• \`/activate_30\` - Activa 30 días

*Planes disponibles / Available plans:*
• \`weekly\` / \`7\` (7 días)
• \`monthly\` / \`30\` (30 días)
• \`crystal\` / \`120\` (120 días)
• \`yearly\` / \`365\` (365 días)
• \`lifetime\` (de por vida / forever)`, {
        parse_mode: 'Markdown',
        message_thread_id: threadId,
      });
      return;
    }

    await activateMembershipForUser(ctx, targetUserId, planOrDays, threadId);
  });

  // ============================================
  // MARK CASE AS SOLVED/RESOLVED
  // ============================================

  /**
   * Command to mark a case as solved/resolved
   * Usage: /resuelto_USER_ID or /solved_USER_ID or /resuelto USER_ID [note]
   * This is an improved version of /close with better UX
   */
  bot.hears(/^\/(resuelto|solved|resolve)(?:_(\d+))?(?:\s+(.*))?$/i, async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const match = ctx.match;

    // Parse from regex or space-separated args
    const args = ctx.message?.text?.split(/[\s_]+/).slice(1).filter(a => a) || [];

    try {
      let userId = match[2]; // From underscore format
      let supportTopic = null;
      let resolutionNote = match[3] || '';

      // If no underscore user ID, check space-separated args
      if (!userId && args.length > 0 && /^\d{6,}$/.test(args[0])) {
        userId = args[0];
        resolutionNote = args.slice(1).join(' ');
      }

      // If still no user ID but we're in a topic, use that user
      if (!userId && threadId) {
        supportTopic = await SupportTopicModel.getByThreadId(threadId);
        if (supportTopic) {
          userId = supportTopic.user_id;
          // Use all args as note since no user ID was specified
          if (!resolutionNote && args.length > 0) {
            resolutionNote = args.join(' ');
          }
        }
      }

      // Get support topic if not already retrieved
      if (userId && !supportTopic) {
        supportTopic = await SupportTopicModel.getByUserId(userId);
      }

      if (!userId || !supportTopic) {
        await ctx.reply(`❌ *Marcar como Resuelto / Mark as Solved*

*Formato con guión bajo:*
\`/solved_USERID\`
\`/resuelto_USERID\`

*En un topic (sin USER_ID):*
\`/solved\` o \`/resuelto\`

*Con nota:*
\`/solved Pago verificado\`
\`/resuelto_123456789 Membresía activada\``, {
          parse_mode: 'Markdown',
          message_thread_id: threadId,
        });
        return;
      }

      await resolveSupportTicket(ctx, userId, threadId, resolutionNote);

    } catch (error) {
      logger.error('Error resolving support ticket:', error);
      await ctx.reply('❌ Error al resolver el ticket: ' + error.message, {
        message_thread_id: threadId,
      });
    }
  });

  /**
   * Command to view user info from support
   * Usage: /usuario_USER_ID or /user_USER_ID or /usuario USER_ID
   */
  bot.hears(/^\/(usuario|user)(?:_(\d+))?(?:\s+(\d+))?$/i, async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const match = ctx.match;

    // Parse user ID from underscore or space format
    let targetUserId = match[2] || match[3];

    // If no user ID provided but we're in a topic, use that user
    if (!targetUserId && threadId) {
      const supportTopic = await SupportTopicModel.getByThreadId(threadId);
      if (supportTopic) {
        targetUserId = supportTopic.user_id;
      }
    }

    if (!targetUserId) {
      await ctx.reply('❌ Uso: /usuario USER_ID o usar dentro de un topic de soporte', {
        message_thread_id: threadId,
      });
      return;
    }

    await sendUserInfo(ctx, targetUserId, threadId);
  });

  /**
   * Command to show support commands help
   * Usage: /ayuda or /supporthelp
   */
  bot.command(['ayuda', 'supporthelp'], async (ctx) => {
    logger.info('[DEBUG /ayuda] Command triggered', {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      supportGroupId: SUPPORT_GROUP_ID,
      fromId: ctx.from?.id,
      match: String(ctx.chat?.id) === String(SUPPORT_GROUP_ID)
    });

    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      logger.info('[DEBUG /ayuda] Chat ID mismatch, returning');
      return;
    }

    logger.info('[DEBUG /ayuda] Passed chat check, sending help message');

    const helpMessage = `📚 *Comandos de Soporte / Support Commands*

*Gestión de Tickets / Ticket Management:*
• \`/solved_USERID\` - Marcar resuelto
• \`/resuelto\` - Resolver ticket actual
• \`/close_USERID\` - Cerrar ticket
• \`/reopen_USERID\` - Reabrir ticket
• \`/prioridad alta|media|baja\`
• \`/categoria billing|technical\`
• \`/escalar 1-3\`

*Respuestas Rápidas / Quick Answers:*
• \`/respuestas\` - Ver menú completo
• \`/r1\` Bienvenida | \`/r2\` Pedir comprobante
• \`/r3\` Confirmar activación | \`/r4\` Rechazar reembolso
• \`/r5\` Política reembolso | \`/r6\` Caso resuelto
• \`/r7\` Pago no encontrado | \`/r8\` Cómo pagar
• \`/r9\` Problema técnico
• Añade \`_en\` \`_es\` \`_both\` para idioma

*Membresías / Memberships:*
• \`/activate_USERID_PLAN\`
• \`/activate_123456_lifetime\`
• \`/activate_123456_30\`
• \`/user_USERID\` - Ver info usuario

*Estadísticas / Stats:*
• \`/stats\` \`/opentickets\` \`/sinrespuesta\`
• \`/sla\` \`/buscar TERM\`

*Comunicación:*
• \`/msg USERID mensaje\``;

    await ctx.reply(helpMessage, {
      parse_mode: 'Markdown',
      message_thread_id: ctx.message?.message_thread_id,
    });
  });

  bot.action(/^rate_ticket:(\d+):([1-4])$/i, async (ctx) => {
    const userId = ctx.match[1];
    const rating = parseInt(ctx.match[2]);

    try {
      await SupportTopicModel.updateRating(userId, ctx.from?.id, rating);
      await ctx.answerCbQuery('Gracias por tu calificación!');
      await ctx.editMessageText('Gracias por tu calificación!', {
        reply_markup: { inline_keyboard: [] },
      });
    } catch (error) {
      logger.error('Error saving rating:', error);
      await ctx.answerCbQuery('Error al guardar la calificación.');
    }
  });

  bot.action(/^reopen_ticket:(\d+)$/i, async (ctx) => {
    const userId = ctx.match[1];

    try {
      await SupportTopicModel.updateStatus(userId, 'open');
      await ctx.answerCbQuery('Ticket reabierto.');
      await ctx.editMessageText('El ticket ha sido reabierto.', {
        reply_markup: { inline_keyboard: [] },
      });
      // Notify support group
      const supportTopic = await SupportTopicModel.getByUserId(userId);
      if (supportTopic) {
        await bot.telegram.sendMessage(SUPPORT_GROUP_ID, `Ticket reabierto por el usuario ${userId}`, {
          message_thread_id: supportTopic.thread_id,
        });
      }
    } catch (error) {
      logger.error('Error reopening ticket:', error);
      await ctx.answerCbQuery('Error al reabrir el ticket.');
    }
  });
  
  const closeSupportTicket = async (ctx, userId, threadId) => {
    let supportTopic = await SupportTopicModel.getByUserId(String(userId));
    let effectiveUserId = String(userId);

    // Handle stale callback payloads by recovering topic from current thread.
    if (!supportTopic && threadId) {
      const topicByThread = await SupportTopicModel.getByThreadId(threadId);
      if (topicByThread) {
        supportTopic = topicByThread;
        effectiveUserId = String(topicByThread.user_id);
        logger.warn('Support close recovered by thread fallback', {
          requestedUserId: String(userId),
          effectiveUserId,
          threadId,
        });
      }
    }

    if (!supportTopic) {
      await ctx.reply('❌ No se encontró el ticket de soporte para este usuario.', {
        message_thread_id: threadId,
      });
      return;
    }

    try {
      await SupportTopicModel.updateStatus(effectiveUserId, 'closed');

      if (supportTopic.thread_id) {
        try {
          await ctx.telegram.closeForumTopic(SUPPORT_GROUP_ID, supportTopic.thread_id);
        } catch (closeError) {
          logger.debug('Could not close forum topic:', closeError.message);
        }
      }

      const user = await UserModel.getById(effectiveUserId);
      const adminName = ctx.from.first_name || 'Soporte';
      const userLang = user?.language || 'es';
      const closedMessage = userLang === 'en'
        ? `✅ *Case Closed*\n\nWe haven't heard back from you, so we've closed this ticket. If you need more help, please open a new ticket. Thanks for contacting PNP! 💜`
        : `✅ *Caso Cerrado*\n\nNo hemos recibido respuesta de tu parte, por lo que hemos cerrado este ticket. Si necesitas más ayuda, por favor abre un nuevo ticket. ¡Gracias por contactar a PNP! 💜`;

      try {
        await ctx.telegram.sendMessage(effectiveUserId, closedMessage, { parse_mode: 'Markdown' });
      } catch (notifyError) {
        logger.warn('Could not notify user about closure:', notifyError.message);
      }

      await ctx.reply(`✅ *Caso Cerrado*

👤 *Usuario:* ${user?.firstName || user?.username || effectiveUserId} (\`${effectiveUserId}\`)
👨‍💼 *Cerrado por:* ${adminName}

_El usuario ha sido notificado._
_El topic ha sido cerrado._`, {
        parse_mode: 'Markdown',
        message_thread_id: threadId || supportTopic.thread_id,
      });

      logger.info('Support ticket closed', {
        userId: effectiveUserId,
        closedBy: ctx.from.id,
      });
    } catch (error) {
      logger.error('Error closing support ticket:', error);
      await ctx.reply('❌ Error al cerrar el ticket: ' + error.message, {
        message_thread_id: threadId,
      });
    }
  };

  bot.command('kpis', async (ctx) => {
    // Only in support group or from admins
    const isInSupportGroup = String(ctx.chat?.id) === String(SUPPORT_GROUP_ID);
    const isAdmin = ADMIN_USER_IDS.includes(String(ctx.from?.id));

    if (!isInSupportGroup && !isAdmin) {
      return;
    }

    try {
      const stats = await SupportTopicModel.getStatistics();
      const ratings = await getPool().query('SELECT AVG(rating) as avg_rating FROM ticket_ratings');
      const avgRating = ratings.rows[0].avg_rating || 'N/A';

      const message = `📊 *Estadísticas de Soporte*

📋 Total de tickets: ${stats.total_topics || 0}
🟢 Abiertos: ${stats.open_topics || 0}
✅ Resueltos: ${stats.resolved_topics || 0}
🔒 Cerrados: ${stats.closed_topics || 0}

⏱️ Tiempo promedio de resolución: ${stats.avg_resolution_hours ? `${stats.avg_resolution_hours.toFixed(2)} hours` : 'N/A'}
⭐ Calificación promedio: ${avgRating.toFixed(2)}
      `;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error getting support stats:', error);
      await ctx.reply('❌ Error al obtener estadísticas: ' + error.message);
    }
  });

  bot.command('close', async (ctx) => {
    // Only in support group
    if (String(ctx.chat?.id) !== String(SUPPORT_GROUP_ID)) {
      return;
    }

    const threadId = ctx.message?.message_thread_id;
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    let userId = args[0];

    if (!userId && threadId) {
      const supportTopic = await SupportTopicModel.getByThreadId(threadId);
      if (supportTopic) {
        userId = supportTopic.user_id;
      }
    }

    if (!userId) {
      await ctx.reply('❌ Uso: /close USER_ID o usar dentro de un topic de soporte', {
        message_thread_id: threadId,
      });
      return;
    }

    await closeSupportTicket(ctx, userId, threadId);
  });

  logger.info('✓ Support routing handlers registered');
};

module.exports = registerSupportRoutingHandlers;
