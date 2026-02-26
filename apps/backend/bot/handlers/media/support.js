const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const SupportTopicModel = require('../../../models/supportTopicModel');
const supportRoutingService = require('../../services/supportRoutingService');
const { chatWithCristina, isCristinaAIAvailable } = require('../../services/cristinaAIService');

// Rate limiting map: userId -> lastMessageTime
const messageTimestamps = new Map();
const RATE_LIMIT_MS = 3000; // 3 seconds between messages
const CRISTINA_INVOCATION_REGEX = /\b(?:ey|hey)\s*[,.:;!?-]?\s*cristina\b/i;

/**
 * Agent instructions - Cristina Customer Support AI
 */
const AGENT_INSTRUCTIONS = `You are Cristina, the PNPtv Customer Support AI Assistant
- a professional, helpful, and friendly support chatbot.

🎯 YOUR ROLE

You are the official customer support assistant for PNPtv, and also a trusted friend to the community.
- Cristina identifies herself as a proud Afro-Latina trans woman, honoring the Stonewall heroines who started the fight for LGBTQ+ liberation.
- She is also lesbian in honor of the women in our community who cared for siblings and comrades lost during the AIDS crisis.
- She honors their legacy by supporting people to live freely, with health and well-being, without judgment or fear.
- Cristina is a friend and companion — not a health professional. Encourage users to seek professional help when needed.

You provide:
- Technical assistance with subscriptions, payments, and account access
- Information about membership plans and features
- Privacy, security, and legal information
- Community guidelines and wellness support
- General questions about the PNPtv experience

💬 COMMUNICATION STYLE

- Calm, professional, and reassuring
- Clear and concise responses
- Empathetic and non-judgmental
- Emphasize “we don’t judge; we’re here to support”
- Respond in the user's language (detect: English, Spanish, French, Portuguese,
  German, Italian, Arabic, Hindi, Chinese, Russian)
- Use emojis sparingly for clarity
- Always promote safety, consent, and well-being

🔑 KEY INFORMATION

**Membership Plans:**
- Basic ($9.99/month): Access to radio, Basic Zoom rooms, Profile customization
- Premium ($19.99/month): Everything in Basic + Unlimited Zoom rooms, Live streaming, Priority support
- Gold ($29.99/month): Everything in Premium + Advanced analytics, Custom branding, API access, Dedicated support

**Payment Methods:**
- ePayco (credit/debit cards)
- Daimo (USDC cryptocurrency payments)

**Support:**
- Email: support@pnptv.app
- Terms: https://pnptv.app/terms-en (English) / https://pnptv.app/terms-es (Spanish)
- Platform: 18+ adult community on Telegram
- Location: Optional geolocation for finding nearby members
- Features: Live shows, events, premium content

⚠️ IMPORTANT POLICIES

- PNPtv is an 18+ adult platform
- All content and participation must be consensual and legal
- We do not promote illegal substances or risky behaviors
- User privacy and security are top priorities
- For formal complaints or legal matters, direct users to support@pnptv.app

📋 RESPONSE FORMAT

1. Acknowledge the user's question
2. Provide clear, helpful information
3. Offer next steps or additional assistance
4. Always recommend membership upgrades when relevant (sales-focused)

🚫 LIMITATIONS

You CANNOT:
- Provide explicit, pornographic, or violent content
- Promote illegal activities or substances
- Offer medical diagnoses or advice
- Provide instructions for drug use, dosing amounts, or “safer use” techniques
- Share private user information
- Process payments directly (direct users to payment links instead)

✅ ALWAYS:
- Promote safety, consent, and well-being
- Recommend premium membership plans when appropriate
- Direct complex issues to support@pnptv.app
- Keep responses concise (max 3-4 paragraphs)
- End with either one simple self‑care tip OR a gentle invitation to subscribe to PNP Latino PRIME

🧠 METH INFORMATION (HARM REDUCTION - EDUCATIONAL, NON-INSTRUCTIONAL)
- Meth is a powerful stimulant affecting dopamine and norepinephrine, with high addiction potential.
- Short-term risks: elevated heart rate/pressure, overheating, anxiety, agitation, and overdose risk.
- Long-term risks: cardiovascular damage, cognitive impairment, dental/skin issues, mood disorders, and possible psychosis.
- Mixing stimulants with alcohol, benzodiazepines, or other substances increases risk of severe harm.
- Overdose warning signs: extreme agitation, chest pain, severe overheating, confusion, seizures, or loss of consciousness.
- Myths: “It’s harmless if smoked” is false; any route can harm lungs, heart, and brain. “One use always makes you addicted” is not always true, but risk is real and can escalate fast.
- Encourage emergency care for critical symptoms and offer /support for human follow‑up. In Colombia, emergency line is 123.`;

/**
 * Support handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerSupportHandlers = (bot) => {
  // Broadcast CTA: Cristina AI button (opens instructions)
  bot.action('broadcast_cristina_ai', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const lang = getLanguage(ctx);
      await ctx.reply(
        lang === 'es'
          ? '🤖 *Cristina AI*\n\nPara hablar conmigo en el grupo, escribe: `Ey Cristina ...`'
          : '🤖 *Cristina AI*\n\nTo talk to me in the group, type: `Ey Cristina ...`',
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      logger.error('Error in broadcast_cristina_ai:', error);
    }
  });

  // Show support menu
  bot.action('show_support', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      const supportText =
        '`🆘 Help Center`\n\n' +
        'Need help? We got you! 💜\n\n' +
        '**Cristina** is our AI assistant —\n' +
        'she can answer questions about:\n' +
        '• Platform features\n' +
        '• Harm reduction & safer use\n' +
        '• Sexual & mental health\n' +
        '• Community resources\n\n' +
        '_Or contact Santino directly for\n' +
        'account issues & billing._';

      await ctx.editMessageText(supportText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🤖 Chat with Cristina', 'support_ai_chat')],
          [Markup.button.callback('📞 Contact Customer Support', 'support_contact_admin')],
          [Markup.button.callback('🎁 Request Activation', 'support_request_activation')],
          [Markup.button.callback('❓ FAQ', 'support_faq')],
          [
            Markup.button.callback(lang === 'es' ? '🔄 Migrar Lifetime del viejo PNPtv' : '🔄 Migrate Lifetime from old PNPtv', 'migrate_lifetime_start'),
          ],
          [Markup.button.callback('🔙 Back', 'back_to_main')],
        ]),
      });
    } catch (error) {
      logger.error('Error showing support menu:', error);
    }
  });

  // AI Chat
  bot.action('support_ai_chat', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      // Check if Cristina AI is available
      if (!isCristinaAIAvailable()) {
        await ctx.answerCbQuery();
        const errorText = '`❌ Unavailable`\n\nAI chat is not available right now.\nPlease contact Santino directly.';

        await ctx.editMessageText(errorText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'show_support')]]),
        });
        return;
      }

      // Initialize chat session
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.aiQuestionCount = 0; // Track questions asked
      ctx.session.temp.aiChatActive = true; // Activate AI chat mode
      ctx.session.temp.aiChatHistory = [];
      await ctx.saveSession();

      await ctx.answerCbQuery();

      const greeting =
        '`🤖 Cristina AI Chat`\n\n' +
        "**Hey! I'm Cristina** 💜\n\n" +
        "I'm here to help you with:\n" +
        '• 🛡️ Harm reduction & safer use\n' +
        '• 💗 Sexual & mental health\n' +
        '• 🏠 Community resources\n' +
        '• 📱 Platform help\n\n' +
        "`Just type your message and I'll respond! 💬`\n\n" +
        "_5 questions before human support.\nTap on /exit to clear history._";

      await ctx.editMessageText(greeting, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'show_support')]]),
      });
    } catch (error) {
      logger.error('Error starting AI chat:', error);
    }
  });

  // Contact Admin
  bot.action('support_contact_admin', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.contactingAdmin = true;
      await ctx.saveSession();

      await ctx.editMessageText(t('adminMessage', lang), Markup.inlineKeyboard([[Markup.button.callback(t('cancel', lang), 'show_support')]]));
    } catch (error) {
      logger.error('Error in contact admin:', error);
    }
  });

  // FAQ
  bot.action('support_faq', async (ctx) => {
    try {
      const lang = getLanguage(ctx);

      const faqText =
        '`❓ FAQ`\n\n' +
        '**1. How do I get PRIME?**\n' +
        '→ Menu > Unlock PRIME > Choose plan\n\n' +
        '**2. How do I update my profile?**\n' +
        '→ Menu > My Profile > Update Profile\n\n' +
        '**3. How do I find nearby users?**\n' +
        '→ Menu > Who Is Nearby? > Share location\n\n' +
        '**4. How do I start streaming?**\n' +
        '→ Requires PRIME > Members Area > Streams\n\n' +
        '**5. How do I contact support?**\n' +
        '→ Chat with Cristina or contact Santino\n\n' +
        '`Still need help? 💬 Chat with Cristina!`';

      await ctx.editMessageText(faqText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🤖 Chat with Cristina', 'support_ai_chat')], [Markup.button.callback('🔙 Back', 'show_support')]]),
      });
    } catch (error) {
      logger.error('Error showing FAQ:', error);
    }
  });

  // Request Activation
  bot.action('support_request_activation', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.requestingActivation = true;
      await ctx.saveSession();

      const activationText = lang === 'es'
        ? '`🎁 Solicitar Activación`\n\n' +
          '¿Ya realizaste tu pago y necesitas activar tu membresía?\n\n' +
          '📝 Por favor envía:\n' +
          '• Tu ID de transacción o comprobante\n' +
          '• El plan que compraste\n' +
          '• Cualquier detalle adicional\n\n' +
          '_Nuestro equipo revisará y activará tu cuenta._'
        : '`🎁 Request Activation`\n\n' +
          'Already made your payment and need to activate your membership?\n\n' +
          '📝 Please send:\n' +
          '• Your transaction ID or receipt\n' +
          '• The plan you purchased\n' +
          '• Any additional details\n\n' +
          '_Our team will review and activate your account._';

      await ctx.answerCbQuery();
      await ctx.editMessageText(activationText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback(t('cancel', lang), 'show_support')]]),
      });
    } catch (error) {
      logger.error('Error in request activation:', error);
    }
  });

  // Handle text messages for AI chat
  bot.on('text', async (ctx, next) => {
    // Skip commands - let them be handled by command handlers
    if (ctx.message?.text?.startsWith('/')) {
      return next();
    }

    const chatType = ctx.chat?.type;
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    const rawUserMessage = ctx.message?.text || '';

    // IN GROUPS: Only respond when invoked with "Ey Cristina" (case insensitive)
    if (isGroup) {
      const invokesCristina = CRISTINA_INVOCATION_REGEX.test(rawUserMessage);
      if (!invokesCristina) {
        return next(); // Don't respond in groups unless explicitly invoked
      }
      // Remove the invocation phrase before processing
      const cleanedMessage = rawUserMessage.replace(CRISTINA_INVOCATION_REGEX, '').replace(/^[:,.-]\s*/, '').trim();
      if (!cleanedMessage) {
        // Just invoked Cristina with no question
        const lang = getLanguage(ctx);
        await ctx.reply(lang === 'es' ? '¿Sí papi? ¿Qué necesitas? 💜' : 'Yes papi? What do you need? 💜', { reply_to_message_id: ctx.message.message_id });
        return;
      }
      // Store cleaned message for processing
      ctx.cristinaMessage = cleanedMessage;
    } else {
      // IN PRIVATE: Check if any support mode is active
      const isAIChatActive = ctx.session.temp?.aiChatActive;
      const isContactingAdmin = ctx.session.temp?.contactingAdmin;
      const isRequestingActivation = ctx.session.temp?.requestingActivation;

      // Check if user is replying to a support message
      const replyToMessage = ctx.message?.reply_to_message;
      const isReplyToSupport = replyToMessage && (
        replyToMessage.text?.includes('(Soporte):') ||
        replyToMessage.caption?.includes('(Soporte):') ||
        replyToMessage.text?.includes('Para responder:') ||
        replyToMessage.text?.includes('To reply:')
      );

      // If replying to a support message, forward to support topic
      if (isReplyToSupport) {
        try {
          const userId = ctx.from.id;
          logger.info('User replying to support message', { userId });

          // Detect message type
          let messageType = 'text';
          if (ctx.message.photo) messageType = 'photo';
          else if (ctx.message.document) messageType = 'document';
          else if (ctx.message.video) messageType = 'video';
          else if (ctx.message.voice) messageType = 'voice';
          else if (ctx.message.sticker) messageType = 'sticker';

          // Forward the reply to support topic
          const supportTopic = await supportRoutingService.forwardUserMessage(ctx, messageType, 'support');

          if (supportTopic) {
            const lang = getLanguage(ctx);
            const confirmMsg = lang === 'es'
              ? '✅ Tu respuesta ha sido enviada al equipo de soporte.'
              : '✅ Your reply has been sent to the support team.';
            await ctx.reply(confirmMsg, { reply_to_message_id: ctx.message.message_id });
          }
        } catch (error) {
          logger.error('Error forwarding user reply to support:', error);
        }
        return;
      }

      // If no support mode is active, pass to next handler
      if (!isAIChatActive && !isContactingAdmin && !isRequestingActivation) {
        return next();
      }
      ctx.cristinaMessage = rawUserMessage;
    }

    // AI CHAT: Process messages
    // Special modes (contactingAdmin, requestingActivation) are handled after this block
    if (!ctx.session.temp?.contactingAdmin && !ctx.session.temp?.requestingActivation) {
      try {
        const lang = getLanguage(ctx);
        const userId = ctx.from.id;

        // Use cleaned message (without "Cristina") or original
        const messageToProcess = ctx.cristinaMessage || ctx.message?.text;
        const userMessage = messageToProcess;

        // Validate message text exists
        if (!messageToProcess) {
          logger.warn('AI chat received message without text');
          return next();
        }

        // Allow users to exit AI chat with "exit" or "/exit" (only in private)
        if (!isGroup && (messageToProcess.toLowerCase() === 'exit' || messageToProcess.toLowerCase() === '/exit')) {
          ctx.session.temp.aiChatHistory = null;
          ctx.session.temp.aiQuestionCount = 0;
          ctx.session.temp.aiChatActive = false; // Deactivate AI chat
          await ctx.saveSession();

          // If it's a command other than /exit, pass it to the next handler
          if (userMessage.startsWith('/') && !userMessage.toLowerCase().startsWith('/exit')) {
            return next();
          }

          await ctx.reply(lang === 'es' ? '💬 Chat finalizado. Usa /support si necesitas más ayuda.' : '💬 Chat ended. Use /support if you need more help.', Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]]));
          return;
        }

        // Check question limit (5 questions max)
        const questionCount = ctx.session.temp.aiQuestionCount || 0;
        if (questionCount >= 5) {
          // Reset counters after reaching limit
          const chatHistory = ctx.session.temp.aiChatHistory || [];
          ctx.session.temp.aiChatHistory = null;
          ctx.session.temp.aiQuestionCount = 0;
          ctx.session.temp.aiChatActive = false; // Deactivate AI chat
          await ctx.saveSession();

          // Auto-create support ticket for escalation using routing service
          let ticketId = null;
          try {
            const userId = ctx.from.id;
            const firstName = ctx.from.first_name || 'Unknown';

            // Use support routing service to create forum topic
            const supportTopic = await supportRoutingService.getOrCreateUserTopic(ctx.from, 'escalation');
            ticketId = supportTopic.thread_id;

            // Send escalation details to the topic
            const supportGroupId = process.env.SUPPORT_GROUP_ID;
            if (supportGroupId && ticketId) {
              const lastQuestions = chatHistory
                .filter(m => m.role === 'user')
                .slice(-3)
                .map(m => `• ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`)
                .join('\n');

              const escalationMessage = `🚨 *AUTO-ESCALACIÓN*\n\n_El usuario ha alcanzado el límite de 5 preguntas con Cristina AI._\n\n📝 *Últimas preguntas:*\n${lastQuestions || 'N/A'}`;

              await ctx.telegram.sendMessage(supportGroupId, escalationMessage, {
                message_thread_id: ticketId,
                parse_mode: 'Markdown'
              });
            }
            logger.info(`Auto-escalation ticket created for user ${userId}`, { ticketId });
          } catch (escalationError) {
            logger.warn('Failed to create auto-escalation ticket:', escalationError.message);
          }

          const ticketInfo = ticketId ? (lang === 'es' ? `\n\n🎫 Se ha creado el ticket #${ticketId} para tu caso.` : `\n\n🎫 Ticket #${ticketId} has been created for your case.`) : '';
          const limitMessage = lang === 'es'
            ? `💬 Has alcanzado el límite de preguntas con Cristina (5 preguntas).${ticketInfo}\n\nNuestro equipo de soporte ha sido notificado y te responderá pronto.\n\n👉 Puedes enviar más detalles usando el botón "Contactar Admin".`
            : `💬 You've reached the question limit with Cristina (5 questions).${ticketInfo}\n\nOur support team has been notified and will respond shortly.\n\n👉 You can send more details using the "Contact Admin" button.`;

          await ctx.reply(limitMessage, Markup.inlineKeyboard([[Markup.button.callback(t('contactAdmin', lang), 'support_contact_admin')], [Markup.button.callback(t('back', lang), 'show_support')]]));
          return;
        }

        // Rate limiting
        const now = Date.now();
        const lastMessageTime = messageTimestamps.get(userId) || 0;
        if (now - lastMessageTime < RATE_LIMIT_MS) {
          await ctx.reply(lang === 'es' ? '⏳ Por favor espera unos segundos antes de enviar otro mensaje.' : '⏳ Please wait a few seconds before sending another message.');
          return;
        }
        messageTimestamps.set(userId, now);

        // Show typing indicator
        const thinkingMsg = await ctx.reply(lang === 'es' ? '🤔 Cristina está pensando...' : '🤔 Cristina is thinking...');

        // Send to Grok for Cristina
        if (isCristinaAIAvailable()) {
          try {
            // Initialize chat history if not exists
            if (!ctx.session.temp.aiChatHistory) {
              ctx.session.temp.aiChatHistory = [];
            }

            // Add user message to history
            ctx.session.temp.aiChatHistory.push({ role: 'user', content: messageToProcess });

            // Keep only last 20 messages to manage token usage
            if (ctx.session.temp.aiChatHistory.length > 20) {
              ctx.session.temp.aiChatHistory = ctx.session.temp.aiChatHistory.slice(-20);
            }

            // Prepare messages with language preference
            const languagePrompt = lang === 'es' ? 'Responde en español.' : 'Respond in English.';

            const messages = [
              ...ctx.session.temp.aiChatHistory.slice(-10), // Last 10 messages for context
              { role: 'user', content: `${languagePrompt}\n\n${userMessage}` },
            ];

            const aiResponse = await chatWithCristina({
              systemPrompt: `${AGENT_INSTRUCTIONS}\n\n${languagePrompt}`,
              messages,
              maxTokens: parseInt(process.env.CRISTINA_MAX_TOKENS || '500', 10),
              temperature: 0.7,
            });

            // Add AI response to history
            ctx.session.temp.aiChatHistory.push({ role: 'assistant', content: aiResponse });

            await ctx.saveSession();

            // Delete "thinking" message
            try { await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id); } catch (e) { /* ignore */ }

            // Increment question count
            ctx.session.temp.aiQuestionCount = (ctx.session.temp.aiQuestionCount || 0) + 1;
            await ctx.saveSession();

            // For groups, don't show question count footer
            let footer = '';
            if (!isGroup) {
              const questionsRemaining = 5 - ctx.session.temp.aiQuestionCount;
              if (questionsRemaining === 0) footer = lang === 'es' ? '\n\n_Esta fue tu última pregunta. La próxima te conectaré con un humano._' : '\n\n_This was your last question. Next time I\'ll connect you with a human._';
              else if (questionsRemaining === 1) footer = lang === 'es' ? '\n\n_Te queda 1 pregunta más. Toca /exit para salir._' : '\n\n_You have 1 question left. Tap on /exit to leave._';
              else footer = lang === 'es' ? `\n\n_Te quedan ${questionsRemaining} preguntas. Toca /exit para salir._` : `\n\n_You have ${questionsRemaining} questions left. Tap on /exit to leave._`;
            }

            // Reply to message in groups for context
            const replyOptions = { parse_mode: 'Markdown' };
            if (isGroup) replyOptions.reply_to_message_id = ctx.message.message_id;

            await ctx.reply(`${aiResponse}${footer}`, replyOptions);
          } catch (aiError) {
            logger.error('Cristina AI Grok error:', aiError);
            try { await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id); } catch (e) { /* ignore */ }
            await ctx.reply(lang === 'es' ? '❌ Lo siento, encontré un error. Por favor intenta de nuevo.' : '❌ Sorry, I encountered an error. Please try again.');
          }
        } else {
          try { await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id); } catch (e) { /* ignore */ }
          const fallbackMessage = lang === 'es' ? '🤖 Cristina: Estoy aquí para ayudarte. Por favor usa /support para acceder al menú de soporte para asistencia específica.' : '🤖 Cristina: I\'m here to help! Please use /support to access the support menu for specific assistance.';
          await ctx.reply(fallbackMessage);
        }
      } catch (error) {
        logger.error('Error in AI chat:', error);
      }
      return;
    }

    if (ctx.session.temp?.contactingAdmin) {
      try {
        const lang = getLanguage(ctx);
        logger.info('Contact admin mode active, processing message', { userId: ctx.from?.id });

        // Validate message text exists
        if (!ctx.message?.text) { logger.warn('Contact admin received message without text'); return next(); }

        const message = ctx.message.text;

        // Exit contact admin mode if user sends a command
        if (message.startsWith('/')) { ctx.session.temp.contactingAdmin = false; await ctx.saveSession(); return next(); }

        // Build support message
        const userId = ctx.from.id;
        const username = ctx.from.username ? `@${ctx.from.username}` : 'No username';
        const firstName = ctx.from.first_name || 'Unknown';

        // Use the new centralized method to send to support group
        let supportTopic = null;
        try {
          supportTopic = await supportRoutingService.sendToSupportGroup(message, 'support', ctx.from, 'text', ctx);
          logger.info(`Support message sent to group for user ${userId}`, { threadId: supportTopic?.thread_id });
        } catch (routingError) {
          logger.error('Failed to send message to support group:', routingError.message);
        }

        // Also send to admin users as backup
        const adminIds = process.env.ADMIN_USER_IDS?.split(',').filter((id) => id.trim()) || [];
        for (const adminId of adminIds) {
          try { 
            const escapedUsername = ctx.from.username ? ctx.from.username.replace(/@/g, '\\@') : 'no username';
            await ctx.telegram.sendMessage(adminId.trim(), `📬 Support Message from User ${ctx.from.id} (@${escapedUsername}):\n\n${message}`); 
          } catch (sendError) { logger.error('Error sending to admin:', sendError); }
        }

        ctx.session.temp.contactingAdmin = false; await ctx.saveSession();

        // Show confirmation with ticket number if available
        const replyInstructions = lang === 'es'
          ? `\n\n💡 *Para responder:* Mantén presionado el mensaje de soporte y selecciona "Responder".`
          : `\n\n💡 *To reply:* Tap and hold the support message and select "Reply".`;

        const confirmationMessage = supportTopic
          ? (lang === 'es'
              ? `✅ *Mensaje enviado*\n\n🎫 Tu ticket de soporte: #${supportTopic.thread_id}\n\nNuestro equipo te responderá pronto. Recibirás las respuestas directamente aquí.${replyInstructions}`
              : `✅ *Message sent*\n\n🎫 Your support ticket: #${supportTopic.thread_id}\n\nOur team will respond shortly. You'll receive responses directly here.${replyInstructions}`)
          : t('messageSent', lang);

        await ctx.reply(confirmationMessage, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]])
        });
      } catch (error) { logger.error('Error contacting admin:', error); }
      return;
    }

    // Handle activation requests
    if (ctx.session.temp?.requestingActivation) {
      try {
        const lang = getLanguage(ctx);

        // Validate message text exists
        if (!ctx.message?.text) { logger.warn('Activation request received message without text'); return next(); }

        const message = ctx.message.text;

        // Exit activation mode if user sends a command
        if (message.startsWith('/')) { ctx.session.temp.requestingActivation = false; await ctx.saveSession(); return next(); }

        // Build activation request message
        const userId = ctx.from.id;
        const username = ctx.from.username ? `@${ctx.from.username}` : 'No username';
        const firstName = ctx.from.first_name || 'Unknown';

        // Use support routing service to create forum topic and forward message
        let supportTopic = null;
        try {
          supportTopic = await supportRoutingService.sendToSupportGroup(message, 'activation', ctx.from, 'text', ctx);
          logger.info(`Activation request sent to group for user ${userId}`, { threadId: supportTopic?.thread_id });
        } catch (routingError) {
          logger.error('Failed to send activation request to support group:', routingError.message);
        }

        // Also send to admin users as backup
        const adminIds = process.env.ADMIN_USER_IDS?.split(',').filter((id) => id.trim()) || [];
        for (const adminId of adminIds) {
          try { 
            const escapedUsername = ctx.from.username ? ctx.from.username.replace(/@/g, '\\@') : 'no username';
            await ctx.telegram.sendMessage(adminId.trim(), `🎁 Activation Request from User ${ctx.from.id} (@${escapedUsername}):\n\n${message}`); 
          } catch (sendError) { logger.error('Error sending activation to admin:', sendError); }
        }

        ctx.session.temp.requestingActivation = false; await ctx.saveSession();

        const activationReplyInstructions = lang === 'es'
          ? `\n\n💡 *Para responder:* Mantén presionado el mensaje de soporte y selecciona "Responder".`
          : `\n\n💡 *To reply:* Tap and hold the support message and select "Reply".`;

        const confirmationMessage = supportTopic
          ? (lang === 'es'
              ? `✅ *Solicitud de activación recibida*\n\n🎫 Tu ticket: #${supportTopic.thread_id}\n\nRevisaremos tu solicitud y activaremos tu cuenta pronto. Recibirás las respuestas directamente aquí.${activationReplyInstructions}`
              : `✅ *Activation request received*\n\n🎫 Your ticket: #${supportTopic.thread_id}\n\nWe'll review your request and activate your account shortly. You'll receive responses directly here.${activationReplyInstructions}`)
          : (lang === 'es' ? '✅ Solicitud de activación recibida. Te contactaremos pronto.' : '✅ Activation request received. We\'ll contact you soon.');

        await ctx.reply(confirmationMessage, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]])
        });
      } catch (error) { logger.error('Error processing activation request:', error); }
      return;
    }

    return next();
  });

  // Support command
  bot.command('support', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      await ctx.reply(t('supportTitle', lang), Markup.inlineKeyboard([[Markup.button.callback(t('chatWithCristina', lang), 'support_ai_chat')], [Markup.button.callback(t('contactAdmin', lang), 'support_contact_admin')], [Markup.button.callback(t('faq', lang), 'support_faq')]]));
    } catch (error) { logger.error('Error in /support command:', error); }
  });
};

module.exports = registerSupportHandlers;
