const { Markup } = require('telegraf');
const { t } = require('../../../utils/i18n');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const SupportTopicModel = require('../../../models/supportTopicModel');
const supportRoutingService = require('../../../services/supportRoutingService');
const { chatWithCristina, isCristinaAIAvailable } = require('../../../services/cristinaAIService');

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
- Meru Code recovery: If a user forgot their Meru code, they MUST provide a screenshot of the bank transaction showing amount, date, and exact hour of payment. No other support is accepted for this.
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
          [
            Markup.button.callback(lang === 'es' ? '🎁 Activar Código Meru' : '🎁 Redeem Meru Code', 'support_request_activation'),
            Markup.button.callback(lang === 'es' ? '🔑 Recuperar mi Código' : '🔑 Recover my Code', 'support_recover_meru_code'),
          ],
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

  // Request Activation
  bot.action('support_request_activation', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.requestingActivation = true;
      await ctx.saveSession();

      const activationText = lang === 'es'
        ? '`🎁 Canjear Código Meru`\n\n' +
          '¿Ya realizaste tu pago y tienes tu código Meru?\n\n' +
          '📝 Por favor envía tu código de 6-8 caracteres.\n\n' +
          '⚠️ *¿Olvidaste anotar tu código?*\n' +
          'Si olvidaste escribir tu código Meru, por favor usa la opción "Recuperar mi Código" en el menú anterior. Deberás enviar un screenshot del movimiento bancario donde se vea el monto, fecha y hora exacta del pago.\n\n' +
          '*IMPORTANTE:* No se aceptará ningún otro tipo de soporte para recuperación de códigos.'
        : '`🎁 Redeem Meru Code`\n\n' +
          'Already made your payment and have your Meru code?\n\n' +
          '📝 Please send your 6-8 character code.\n\n' +
          '⚠️ *Forgot to write down your code?*\n' +
          'If you forgot to write your Meru code, please use the "Recover my Code" option in the previous menu. You must send a screenshot of the bank transaction showing the amount, date, and exact hour of payment.\n\n' +
          '*IMPORTANT:* No other support will be accepted for code recovery.';

      await ctx.answerCbQuery();
      await ctx.editMessageText(activationText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback(t('cancel', lang), 'show_support')]]),
      });
    } catch (error) {
      logger.error('Error in request activation:', error);
    }
  });

  // Recover Meru Code
  bot.action('support_recover_meru_code', async (ctx) => {
    try {
      const lang = getLanguage(ctx);
      ctx.session.temp = ctx.session.temp || {};
      ctx.session.temp.recoveringMeruCode = true;
      await ctx.saveSession();

      const recoveryText = lang === 'es'
        ? '`🔑 Recuperar Código Meru`\n\n' +
          'Si olvidaste tu código, necesitamos verificar la transacción manualmente.\n\n' +
          '📸 *REQUISITO ÚNICO:* Envía un screenshot de la transacción en tu banca móvil/estado de cuenta donde se vea claramente:\n' +
          '• Monto exacto pagado\n' +
          '• Fecha del pago\n' +
          '• Hora exacta del pago\n\n' +
          '⚠️ *IMPORTANTE:* No se aceptará ningún otro soporte o mensaje sin el screenshot detallado. Nuestro equipo verificará y te enviará tu código o activará tu cuenta.'
        : '`🔑 Recover Meru Code`\n\n' +
          'If you forgot your code, we need to manually verify the transaction.\n\n' +
          '📸 *ONLY REQUIREMENT:* Send a screenshot of the transaction from your mobile banking/bank statement where we can clearly see:\n' +
          '• Exact amount paid\n' +
          '• Date of payment\n' +
          '• Exact hour of payment\n\n' +
          '⚠️ *IMPORTANT:* No other support or messages will be accepted without the detailed screenshot. Our team will verify and send your code or activate your account.';

      await ctx.answerCbQuery();
      await ctx.editMessageText(recoveryText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback(t('cancel', lang), 'show_support')]]),
      });
    } catch (error) {
      logger.error('Error in recover meru code:', error);
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
      const isRecoveringMeruCode = ctx.session.temp?.recoveringMeruCode;

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
      if (!isAIChatActive && !isContactingAdmin && !isRequestingActivation && !isRecoveringMeruCode) {
        return next();
      }
      ctx.cristinaMessage = rawUserMessage;
    }

    // AI CHAT: Process messages
    // Special modes are handled after this block
    if (!ctx.session.temp?.contactingAdmin && !ctx.session.temp?.requestingActivation && !ctx.session.temp?.recoveringMeruCode) {
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
            logger.warn(`Failed to create auto-escalation ticket: ${escalationError.message}`);
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
          logger.error(`Failed to send message to support group: ${routingError.message}`);
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
          logger.error(`Failed to send activation request to support group: ${routingError.message}`);
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

    // Handle Meru Code recovery
    if (ctx.session.temp?.recoveringMeruCode) {
      try {
        const lang = getLanguage(ctx);
        const message = ctx.message?.text || ctx.message?.caption || '';

        // Exit recovery mode if user sends a command
        if (message.startsWith('/')) { ctx.session.temp.recoveringMeruCode = false; await ctx.saveSession(); return next(); }

        const userId = ctx.from.id;
        const firstName = ctx.from.first_name || 'Unknown';

        // Use support routing service to create forum topic and forward message
        // If it's just text without a photo, remind them about the screenshot
        const hasPhoto = ctx.message?.photo || ctx.message?.document;
        
        let supportTopic = null;
        try {
          const prefix = '🔑 *REUPERACIÓN MERU*';
          const fullMessage = `${prefix}\n\n${message || '[No text provided]'}`;
          
          let messageType = 'text';
          if (ctx.message.photo) messageType = 'photo';
          else if (ctx.message.document) messageType = 'document';

          supportTopic = await supportRoutingService.sendToSupportGroup(fullMessage, 'meru_recovery', ctx.from, messageType, ctx);
          logger.info(`Meru recovery request sent to group for user ${userId}`, { threadId: supportTopic?.thread_id });
        } catch (routingError) {
          logger.error(`Failed to send Meru recovery request to support group: ${routingError.message}`);
        }

        ctx.session.temp.recoveringMeruCode = false; await ctx.saveSession();

        const replyInstructions = lang === 'es'
          ? `\n\n💡 *Para responder:* Mantén presionado el mensaje de soporte y selecciona "Responder".`
          : `\n\n💡 *To reply:* Tap and hold the support message and select "Reply".`;

        let confirmationMessage;
        if (hasPhoto) {
          confirmationMessage = supportTopic
            ? (lang === 'es'
                ? `✅ *Solicitud de recuperación enviada*\n\n🎫 Tu ticket: #${supportTopic.thread_id}\n\nNuestro equipo revisará el screenshot y te enviará tu código pronto.${replyInstructions}`
                : `✅ *Recovery request sent*\n\n🎫 Your ticket: #${supportTopic.thread_id}\n\nOur team will review the screenshot and send your code shortly.${replyInstructions}`)
            : (lang === 'es' ? '✅ Solicitud recibida. Te contactaremos pronto.' : '✅ Request received. We\'ll contact you soon.');
        } else {
          confirmationMessage = lang === 'es'
            ? `⚠️ *Recuerda adjuntar el screenshot*\n\nHemos recibido tu mensaje, pero recuerda que para recuperar tu código es *OBLIGATORIO* enviar el screenshot del movimiento bancario.\n\nPuedes enviarlo ahora mismo respondiendo a este mensaje.`
            : `⚠️ *Remember to attach the screenshot*\n\nWe received your message, but remember that to recover your code it is *MANDATORY* to send the screenshot of the bank transaction.\n\nYou can send it right now by replying to this message.`;
        }

        await ctx.reply(confirmationMessage, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]])
        });
      } catch (error) { logger.error('Error processing Meru recovery request:', error); }
      return;
    }

    return next();
  });

  // Handle photos and documents for support modes
  bot.on(['photo', 'document'], async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next();

    const isAIChatActive = ctx.session.temp?.aiChatActive;
    const isContactingAdmin = ctx.session.temp?.contactingAdmin;
    const isRequestingActivation = ctx.session.temp?.requestingActivation;
    const isRecoveringMeruCode = ctx.session.temp?.recoveringMeruCode;

    if (!isContactingAdmin && !isRequestingActivation && !isRecoveringMeruCode) {
      // If not in a special mode, check if it's a reply to a support message
      const replyToMessage = ctx.message?.reply_to_message;
      const isReplyToSupport = replyToMessage && (
        replyToMessage.text?.includes('(Soporte):') ||
        replyToMessage.caption?.includes('(Soporte):') ||
        replyToMessage.text?.includes('Para responder:') ||
        replyToMessage.text?.includes('To reply:')
      );

      if (isReplyToSupport) {
        try {
          const messageType = ctx.message.photo ? 'photo' : 'document';
          const supportTopic = await supportRoutingService.forwardUserMessage(ctx, messageType, 'support');
          if (supportTopic) {
            const lang = getLanguage(ctx);
            await ctx.reply(lang === 'es' ? '✅ Foto enviada a soporte.' : '✅ Photo sent to support.', { reply_to_message_id: ctx.message.message_id });
          }
        } catch (error) {
          logger.error('Error forwarding media reply to support:', error);
        }
        return;
      }
      return next();
    }

    // Process based on mode (reuse logic from text handler or call it)
    // For simplicity, we can just trigger the same logic as if it was text with caption
    // Or we can manually handle it here
    
    if (isRequestingActivation) {
      try {
        const lang = getLanguage(ctx);
        const caption = ctx.message.caption || '';
        const userId = ctx.from.id;
        const messageType = ctx.message.photo ? 'photo' : 'document';

        const supportTopic = await supportRoutingService.sendToSupportGroup(caption || 'Activation request with media', 'activation', ctx.from, messageType, ctx);
        
        ctx.session.temp.requestingActivation = false;
        await ctx.saveSession();

        const replyInstructions = lang === 'es' ? `\n\n💡 *Para responder:* Responde a este mensaje.` : `\n\n💡 *To reply:* Reply to this message.`;
        await ctx.reply(lang === 'es' ? `✅ Solicitud enviada (Ticket #${supportTopic?.thread_id})${replyInstructions}` : `✅ Request sent (Ticket #${supportTopic?.thread_id})${replyInstructions}`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]])
        });
      } catch (error) { logger.error('Error processing media activation request:', error); }
      return;
    }

    if (isRecoveringMeruCode) {
      // Same logic as text handler but we know it has a photo
      try {
        const lang = getLanguage(ctx);
        const caption = ctx.message.caption || '';
        const userId = ctx.from.id;
        const messageType = ctx.message.photo ? 'photo' : 'document';

        const prefix = '🔑 *RECUPERACIÓN MERU*';
        const fullMessage = `${prefix}\n\n${caption || '[Screenshot provided]'}`;

        const supportTopic = await supportRoutingService.sendToSupportGroup(fullMessage, 'meru_recovery', ctx.from, messageType, ctx);
        
        ctx.session.temp.recoveringMeruCode = false;
        await ctx.saveSession();

        const replyInstructions = lang === 'es' ? `\n\n💡 *Para responder:* Responde a este mensaje.` : `\n\n💡 *To reply:* Reply to this message.`;
        await ctx.reply(lang === 'es' 
          ? `✅ *Solicitud de recuperación enviada*\n\n🎫 Tu ticket: #${supportTopic?.thread_id}\n\nNuestro equipo revisará el screenshot y te enviará tu código pronto.${replyInstructions}` 
          : `✅ *Recovery request sent*\n\n🎫 Your ticket: #${supportTopic?.thread_id}\n\nOur team will review the screenshot and send your code shortly.${replyInstructions}`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]])
        });
      } catch (error) { logger.error('Error processing media Meru recovery request:', error); }
      return;
    }

    if (isContactingAdmin) {
      try {
        const lang = getLanguage(ctx);
        const caption = ctx.message.caption || '';
        const messageType = ctx.message.photo ? 'photo' : 'document';

        const supportTopic = await supportRoutingService.sendToSupportGroup(caption || 'Message with media', 'support', ctx.from, messageType, ctx);
        
        ctx.session.temp.contactingAdmin = false;
        await ctx.saveSession();

        await ctx.reply(lang === 'es' ? '✅ Mensaje enviado.' : '✅ Message sent.', {
          ...Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]])
        });
      } catch (error) { logger.error('Error processing media contact admin:', error); }
      return;
    }
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
