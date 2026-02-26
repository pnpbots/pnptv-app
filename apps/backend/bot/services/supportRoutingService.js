const logger = require('../../utils/logger');
const SupportTopicModel = require('../../models/supportTopicModel');
const { addReaction } = require('../utils/telegramReactions');

/**
 * Support Routing Service
 * Manages forum topic creation and message routing between users and support group
 */
class SupportRoutingService {
  constructor() {
    this.telegram = null;
    this.supportGroupId = null;
  }

  /**
   * Initialize the service with bot telegram instance
   * @param {Object} telegram - Telegraf telegram instance
   */
  initialize(telegram) {
    this.telegram = telegram;
    this.supportGroupId = process.env.SUPPORT_GROUP_ID;

    if (!this.supportGroupId) {
      logger.warn('SUPPORT_GROUP_ID not configured. Support routing will not work.');
    } else {
      logger.info('Support routing service initialized', { supportGroupId: this.supportGroupId });
    }
  }

  /**
   * Get or create a forum topic for a user in the support group
   * @param {Object} user - Telegram user object (from, id, first_name, username, etc.)
   * @param {string} requestType - Type of request ('support', 'activation', 'escalation')
   * @param {string} messageText - Optional message text for category/priority detection
   * @returns {Promise<Object>} Support topic data with thread_id
   */
  async getOrCreateUserTopic(user, requestType = 'support', messageText = '') {
    if (!this.telegram || !this.supportGroupId) {
      throw new Error('Support routing service not initialized');
    }

    const userId = String(user.id);
    const firstName = user.first_name || 'User';
    const username = user.username ? `@${user.username}` : '';

    // Check if user already has a topic
    let supportTopic = await SupportTopicModel.getByUserId(userId);

    if (supportTopic) {
      // Update last message and reopen if closed
      await SupportTopicModel.updateLastMessage(userId);
      if (supportTopic.status !== 'open') {
        await SupportTopicModel.updateStatus(userId, 'open');
        // Reopen the forum topic in Telegram
        try {
          await this.telegram.reopenForumTopic(this.supportGroupId, supportTopic.thread_id);
          logger.info('Forum topic reopened', { userId, threadId: supportTopic.thread_id });

          // Send reopen notification with quick actions
          const reopenMessage = `🔄 *TICKET REABIERTO*

👤 *Usuario:* ${firstName} ${username}
🆔 *User ID:* \`${userId}\`
📅 *Reabierto:* ${new Date().toLocaleString('es-ES')}

⚡ *Comandos Rápidos:*
\`/activate_${userId}_30\` - Activar 30 días
\`/activate_${userId}_lifetime\` - Lifetime
\`/user_${userId}\` - Ver info
\`/solved_${userId}\` - Resolver
\`/r2\` - Pedir comprobante

⚡ *Acciones rápidas:* Usa los botones abajo.`;

          const quickActionsKeyboard = {
            inline_keyboard: [
              [
                { text: '✅ Activar 30 días', callback_data: `support_cmd:activate:${userId}:30` },
                { text: '♾️ Activar lifetime', callback_data: `support_cmd:activate:${userId}:lifetime` },
              ],
              [
                { text: '👤 Ver usuario', callback_data: `support_cmd:user:${userId}` },
                { text: '✅ Marcar resuelto', callback_data: `support_cmd:solved:${userId}` },
              ],
              [
                { text: '📄 Pedir comprobante', callback_data: `support_cmd:quick:${userId}:2` },
              ],
            ],
          };

          await this.telegram.sendMessage(this.supportGroupId, reopenMessage, {
            message_thread_id: supportTopic.thread_id,
            parse_mode: 'Markdown',
            reply_markup: quickActionsKeyboard,
          });
        } catch (reopenError) {
          logger.warn('Could not reopen forum topic:', reopenError.message);
        }
      }
      logger.info('Using existing support topic', { userId, threadId: supportTopic.thread_id });
      return supportTopic;
    }

    // Detect category and priority from user message
    const category = this.detectCategory(messageText || '');
    const priority = this.detectPriority(messageText || '', user);
    const language = user.language_code || 'es';

    // Create descriptive topic name with user info
    const requestEmoji = this.getRequestEmoji(requestType);
    const displayName = username || firstName;
    const topicName = `${requestEmoji} ${displayName} (${userId})`;
    const iconColor = this.getIconColor(requestType);

    try {
      // Create forum topic using Telegram API
      const topic = await this.telegram.createForumTopic(
        this.supportGroupId,
        topicName,
        { icon_color: iconColor }
      );

      const threadId = topic.message_thread_id;

      // Save to database with enhanced metadata
      supportTopic = await SupportTopicModel.create({
        userId,
        threadId,
        threadName: topicName,
      });

      // Update with additional metadata
      await SupportTopicModel.updateCategory(userId, category);
      await SupportTopicModel.updatePriority(userId, priority);
      await SupportTopicModel.updateLanguage(userId, language);

      // Auto-assign ticket if enabled
      if (process.env.AUTO_ASSIGN_TICKETS === 'true') {
        await this.autoAssignTicket(userId);
      }

      // Send initial info message in the topic with enhanced details
      const infoEmoji = this.getRequestEmoji(requestType);
      const requestLabel = this.getRequestLabel(requestType);
      const priorityEmoji = this.getPriorityEmoji(priority);
      const categoryEmoji = this.getCategoryEmoji(category);

      const infoMessage = `${infoEmoji} *${requestLabel}*

${priorityEmoji} *Prioridad:* ${priority}
${categoryEmoji} *Categoría:* ${category}
👤 *Usuario:* ${firstName} ${username}
🆔 *User ID:* \`${userId}\`
🌍 *Idioma:* ${language}
📅 *Creado:* ${new Date().toLocaleString('es-ES')}

⚡ *Acciones rápidas:* Usa los botones abajo.

⚡ *Acciones rápidas:* Usa los botones abajo.

_Responde en este topic para enviar mensajes al usuario._`;

      const quickActionsKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Activar 30 días', callback_data: `support_cmd:activate:${userId}:30` },
            { text: '♾️ Activar lifetime', callback_data: `support_cmd:activate:${userId}:lifetime` },
          ],
          [
            { text: '👤 Ver usuario', callback_data: `support_cmd:user:${userId}` },
            { text: '✅ Marcar resuelto', callback_data: `support_cmd:solved:${userId}` },
          ],
          [
            { text: '📄 Pedir comprobante', callback_data: `support_cmd:quick:${userId}:2` },
          ],
        ],
      };

      await this.telegram.sendMessage(this.supportGroupId, infoMessage, {
        message_thread_id: threadId,
        parse_mode: 'Markdown',
        reply_markup: quickActionsKeyboard,
      });

      logger.info('Created new support topic', { userId, threadId, topicName, priority, category });
      return supportTopic;

    } catch (error) {
      // If topic creation fails (e.g., group is not a forum), fall back to regular messages
      logger.error('Failed to create forum topic, using fallback:', error.message);

      // Create entry with pseudo thread_id (timestamp-based)
      const fallbackThreadId = Date.now();
      supportTopic = await SupportTopicModel.create({
        userId,
        threadId: fallbackThreadId,
        threadName: topicName,
      });

      return supportTopic;
    }
  }

  /**
   * Send a user message to their support topic
   * @param {Object} ctx - Telegraf context
   * @param {string} messageType - Type of message ('text', 'photo', 'document', etc.)
   * @param {string} requestType - Type of request ('support', 'activation')
   */
  async forwardUserMessage(ctx, messageType = 'text', requestType = 'support') {
    logger.info('forwardUserMessage called', { messageType, requestType, userId: ctx.from?.id });

    if (!this.telegram || !this.supportGroupId) {
      logger.warn('Support routing not configured');
      return null;
    }

    const user = ctx.from;
    const userId = String(user.id);
    const firstName = user.first_name || 'Unknown';
    const username = user.username ? user.username.replace(/@/g, '\\@') : 'No username';

    try {
      // Extract message text for category/priority detection
      const messageText = ctx.message?.text || ctx.message?.caption || '';

      // Get or create user's support topic
      const supportTopic = await this.getOrCreateUserTopic(user, requestType, messageText);
      const threadId = supportTopic.thread_id;

      // Build file info if attachment present
      let fileInfo = '';
      if (ctx.message?.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileInfo = `\n📎 *Archivo:* Imagen (${photo.width}x${photo.height})`;
      } else if (ctx.message?.document) {
        const doc = ctx.message.document;
        const sizeKB = doc.file_size ? Math.round(doc.file_size / 1024) : '?';
        fileInfo = `\n📎 *Archivo:* ${doc.file_name || 'documento'} (${sizeKB} KB)`;
      } else if (ctx.message?.video) {
        const video = ctx.message.video;
        const sizeMB = video.file_size ? Math.round(video.file_size / (1024 * 1024)) : '?';
        fileInfo = `\n📎 *Archivo:* Video (${video.duration}s, ${sizeMB} MB)`;
      } else if (ctx.message?.voice) {
        fileInfo = `\n📎 *Archivo:* Nota de voz (${ctx.message.voice.duration}s)`;
      } else if (ctx.message?.audio) {
        const audio = ctx.message.audio;
        fileInfo = `\n📎 *Archivo:* Audio - ${audio.title || audio.file_name || 'audio'} (${audio.duration}s)`;
      }

      // Build message header with file info
      const requestEmoji = this.getRequestEmoji(requestType);
      const header = `${requestEmoji} *${firstName}* (@${username}):${fileInfo}\n\n`;

      // Send based on message type
      if (messageType === 'text' && ctx.message?.text) {
        await this.telegram.sendMessage(
          this.supportGroupId,
          header + ctx.message.text,
          {
            message_thread_id: threadId,
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'photo' && ctx.message?.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        await this.telegram.sendPhoto(
          this.supportGroupId,
          photo.file_id,
          {
            message_thread_id: threadId,
            caption: header + (ctx.message.caption || ''),
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'document' && ctx.message?.document) {
        await this.telegram.sendDocument(
          this.supportGroupId,
          ctx.message.document.file_id,
          {
            message_thread_id: threadId,
            caption: header + (ctx.message.caption || ''),
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'video' && ctx.message?.video) {
        await this.telegram.sendVideo(
          this.supportGroupId,
          ctx.message.video.file_id,
          {
            message_thread_id: threadId,
            caption: header + (ctx.message.caption || ''),
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'voice' && ctx.message?.voice) {
        await this.telegram.sendVoice(
          this.supportGroupId,
          ctx.message.voice.file_id,
          {
            message_thread_id: threadId,
            caption: header,
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'sticker' && ctx.message?.sticker) {
        // Send header first, then sticker
        await this.telegram.sendMessage(
          this.supportGroupId,
          header.trim(),
          { message_thread_id: threadId, parse_mode: 'Markdown' }
        );
        await this.telegram.sendSticker(
          this.supportGroupId,
          ctx.message.sticker.file_id,
          { message_thread_id: threadId }
        );
      } else {
        // Forward the original message as fallback
        await this.telegram.forwardMessage(
          this.supportGroupId,
          ctx.chat.id,
          ctx.message.message_id,
          { message_thread_id: threadId }
        );
      }

      // Update message count
      await SupportTopicModel.updateLastMessage(userId);

      logger.info('User message forwarded to support topic', { userId, threadId, messageType });
      return supportTopic;

    } catch (error) {
      logger.error('Failed to forward user message to support:', error);
      throw error;
    }
  }

  /**
   * Send admin reply from support topic to user
   * @param {number} threadId - Forum topic thread ID
   * @param {Object} ctx - Telegraf context with admin message
   * @returns {Promise<boolean>} Success status
   */
  async sendReplyToUser(threadId, ctx) {
    if (!this.telegram) {
      logger.warn('Support routing not initialized');
      return false;
    }

    try {
      // Get user ID from thread ID
      const supportTopic = await SupportTopicModel.getByThreadId(threadId);

      if (!supportTopic) {
        logger.warn('No user found for thread ID:', threadId);
        return false;
      }

      const userId = supportTopic.user_id;
      const adminName = ctx.from.first_name || 'Support';
      
      // Check if this is the first response
      const isFirstResponse = !supportTopic.first_response_at;
      
      if (isFirstResponse) {
        await SupportTopicModel.updateFirstResponse(userId);
        logger.info('First response recorded', { userId, threadId });
      }
      
      // Update last agent message timestamp
      await SupportTopicModel.updateLastAgentMessage(userId);

      // Reply instructions in both languages
      const replyInstructions = `\n\n💡 _Para responder: Mantén presionado este mensaje y selecciona "Responder"._\n💡 _To reply: Tap and hold this message and select "Reply"._`;

      // Determine message type and send accordingly
      const message = ctx.message;

      if (message.text) {
        await this.telegram.sendMessage(
          userId,
          `💬 *${adminName} (Soporte):*\n\n${message.text}${replyInstructions}`,
          { parse_mode: 'Markdown' }
        );
      } else if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        await this.telegram.sendPhoto(
          userId,
          photo.file_id,
          {
            caption: `💬 *${adminName} (Soporte):*\n\n${message.caption || ''}${replyInstructions}`,
            parse_mode: 'Markdown',
          }
        );
      } else if (message.document) {
        await this.telegram.sendDocument(
          userId,
          message.document.file_id,
          {
            caption: `💬 *${adminName} (Soporte):*\n\n${message.caption || ''}${replyInstructions}`,
            parse_mode: 'Markdown',
          }
        );
      } else if (message.video) {
        await this.telegram.sendVideo(
          userId,
          message.video.file_id,
          {
            caption: `💬 *${adminName} (Soporte):*\n\n${message.caption || ''}${replyInstructions}`,
            parse_mode: 'Markdown',
          }
        );
      } else if (message.voice) {
        // Send voice with a text header including instructions
        await this.telegram.sendMessage(
          userId,
          `💬 *${adminName} (Soporte):*${replyInstructions}`,
          { parse_mode: 'Markdown' }
        );
        await this.telegram.sendVoice(userId, message.voice.file_id);
      } else if (message.sticker) {
        await this.telegram.sendMessage(
          userId,
          `💬 *${adminName} (Soporte):*${replyInstructions}`,
          { parse_mode: 'Markdown' }
        );
        await this.telegram.sendSticker(userId, message.sticker.file_id);
      } else if (message.animation) {
        await this.telegram.sendAnimation(
          userId,
          message.animation.file_id,
          {
            caption: `💬 *${adminName} (Soporte):*\n\n${message.caption || ''}${replyInstructions}`,
            parse_mode: 'Markdown',
          }
        );
      } else {
        // Forward as-is for other types, send instructions separately
        await this.telegram.forwardMessage(userId, ctx.chat.id, message.message_id);
        await this.telegram.sendMessage(userId, replyInstructions.trim(), { parse_mode: 'Markdown' });
      }

      await this.addDeliveryReaction(ctx);
      logger.info('Admin reply sent to user', { userId, threadId, adminId: ctx.from.id });
      return true;

    } catch (error) {
      logger.error('Failed to send reply to user:', error);

      // Check if user blocked the bot
      if (error.description?.includes('bot was blocked') ||
          error.description?.includes('user is deactivated') ||
          error.description?.includes('chat not found')) {
        logger.warn('User has blocked the bot or is deactivated');
        // Notify in the topic that the user can't receive messages
        try {
          await this.telegram.sendMessage(
            ctx.chat.id,
            '⚠️ *No se pudo enviar el mensaje*\n\nEl usuario ha bloqueado el bot o su cuenta está desactivada.',
            {
              message_thread_id: threadId,
              parse_mode: 'Markdown',
            }
          );
        } catch (notifyError) {
          logger.error('Failed to send notification in topic:', notifyError);
        }
      }

      return false;
    }
  }

  /**
   * Close a support topic
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async closeUserTopic(userId) {
    try {
      const supportTopic = await SupportTopicModel.getByUserId(userId);

      if (!supportTopic) {
        return false;
      }

      // Update resolution time
      await SupportTopicModel.updateResolutionTime(userId);
      
      // Update status to closed
      await SupportTopicModel.updateStatus(userId, 'closed');

      // Try to close the forum topic (optional)
      if (this.telegram && this.supportGroupId) {
        try {
          await this.telegram.closeForumTopic(this.supportGroupId, supportTopic.thread_id);
          logger.info('Forum topic closed', { userId, threadId: supportTopic.thread_id });
        } catch (closeError) {
          // Topic might already be closed or doesn't exist
          logger.warn('Could not close forum topic:', closeError.message);
        }
      }

      // Send satisfaction survey after closing
      if (process.env.SEND_SATISFACTION_SURVEY === 'true') {
        const language = supportTopic.language || 'es';
        await this.sendSatisfactionSurvey(userId, language);
      }

      return true;
    } catch (error) {
      logger.error('Error closing user topic:', error);
      return false;
    }
  }

  /**
   * Get icon color based on request type
   * @param {string} requestType - Type of request
   * @returns {number} Telegram icon color ID
   */
  getIconColor(requestType) {
    const colors = {
      support: 0x6FB9F0,     // Blue
      activation: 0xFFD67E,  // Yellow/Gold
      escalation: 0xFF93B2,  // Pink/Red
      default: 0x8EEE98,     // Green
    };
    return colors[requestType] || colors.default;
  }

  /**
   * Get icon color based on priority level
   * @param {string} priority - Priority level
   * @returns {number} Telegram icon color ID
   */
  getPriorityIconColor(priority) {
    const colors = {
      critical: 0xFF0000,    // Red
      high: 0xFFA500,       // Orange
      medium: 0xFFFF00,     // Yellow
      low: 0x00FF00,        // Green
      default: 0x8EEE98,     // Default Green
    };
    return colors[priority] || colors.default;
  }

  /**
   * Get emoji based on priority level
   * @param {string} priority - Priority level
   * @returns {string} Emoji
   */
  getPriorityEmoji(priority) {
    const emojis = {
      critical: '🚨',
      high: '⚠️',
      medium: 'ℹ️',
      low: '📌',
      default: '💬',
    };
    return emojis[priority] || emojis.default;
  }

  /**
   * Get category emoji
   * @param {string} category - Category name
   * @returns {string} Emoji
   */
  getCategoryEmoji(category) {
    const emojis = {
      billing: '💳',
      technical: '🛠️',
      subscription: '🎫',
      account: '👤',
      payment: '💰',
      general: 'ℹ️',
      bug: '🐛',
      feature: '🚀',
      default: '📋',
    };
    return emojis[category] || emojis.default;
  }

  /**
   * Detect message category based on keywords
   * @param {string} message - User message
   * @returns {string} Detected category
   */
  detectCategory(message) {
    if (!message) return 'general';

    const lowerMessage = message.toLowerCase();

    // Billing/payment keywords
    if (lowerMessage.includes('pago') || lowerMessage.includes('payment') ||
        lowerMessage.includes('factura') || lowerMessage.includes('invoice') ||
        lowerMessage.includes('tarjeta') || lowerMessage.includes('card') ||
        lowerMessage.includes('paypal') || lowerMessage.includes('epayco')) {
      return 'billing';
    }

    // Subscription keywords
    if (lowerMessage.includes('suscripción') || lowerMessage.includes('subscription') ||
        lowerMessage.includes('membresía') || lowerMessage.includes('membership') ||
        lowerMessage.includes('renovar') || lowerMessage.includes('renew') ||
        lowerMessage.includes('cancelar') || lowerMessage.includes('cancel')) {
      return 'subscription';
    }

    // Technical keywords
    if (lowerMessage.includes('error') || lowerMessage.includes('bug') ||
        lowerMessage.includes('fallo') || lowerMessage.includes('crash') ||
        lowerMessage.includes('no funciona') || lowerMessage.includes('not working') ||
        lowerMessage.includes('problema técnico') || lowerMessage.includes('technical issue')) {
      return 'technical';
    }

    // Account keywords
    if (lowerMessage.includes('cuenta') || lowerMessage.includes('account') ||
        lowerMessage.includes('usuario') || lowerMessage.includes('user') ||
        lowerMessage.includes('contraseña') || lowerMessage.includes('password') ||
        lowerMessage.includes('login') || lowerMessage.includes('iniciar sesión')) {
      return 'account';
    }

    return 'general';
  }

  /**
   * Detect message priority based on keywords and context
   * @param {string} message - User message
   * @param {Object} user - User information
   * @returns {string} Detected priority (low, medium, high, critical)
   */
  detectPriority(message, user) {
    if (!message) return 'medium';

    const lowerMessage = message.toLowerCase();

    // Critical priority - urgent issues
    if (lowerMessage.includes('urgente') || lowerMessage.includes('urgent') ||
        lowerMessage.includes('emergencia') || lowerMessage.includes('emergency') ||
        lowerMessage.includes('inmediato') || lowerMessage.includes('immediate') ||
        lowerMessage.includes('ahora mismo') || lowerMessage.includes('right now')) {
      return 'critical';
    }

    // High priority - important issues
    if (lowerMessage.includes('importante') || lowerMessage.includes('important') ||
        lowerMessage.includes('prioridad') || lowerMessage.includes('priority') ||
        lowerMessage.includes('problema grave') || lowerMessage.includes('serious issue') ||
        lowerMessage.includes('no puedo acceder') || lowerMessage.includes('cannot access') ||
        lowerMessage.includes('pago fallido') || lowerMessage.includes('payment failed')) {
      return 'high';
    }

    // Low priority - minor issues or questions
    if (lowerMessage.includes('pregunta') || lowerMessage.includes('question') ||
        lowerMessage.includes('consulta') || lowerMessage.includes('inquiry') ||
        lowerMessage.includes('información') || lowerMessage.includes('information') ||
        lowerMessage.includes('cómo funciona') || lowerMessage.includes('how does it work')) {
      return 'low';
    }

    // Default to medium priority
    return 'medium';
  }

  /**
   * Check if SLA is breached for a ticket
   * @param {Object} topic - Support topic data
   * @returns {boolean} True if SLA is breached
   */
  checkSlaBreach(topic) {
    if (!topic || !topic.created_at) return false;

    const createdAt = new Date(topic.created_at);
    const now = new Date();
    const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);

    // SLA rules:
    // Critical: 1 hour response time
    // High: 4 hours response time  
    // Medium: 8 hours response time
    // Low: 24 hours response time

    const prioritySlaHours = {
      critical: 1,
      high: 4,
      medium: 8,
      low: 24,
    };

    const slaHours = prioritySlaHours[topic.priority] || 8;
    
    // If first response hasn't been made yet
    if (!topic.first_response_at && hoursSinceCreation > slaHours) {
      return true;
    }

    // If first response was made, check resolution SLA
    if (topic.first_response_at && topic.status === 'open') {
      const firstResponseAt = new Date(topic.first_response_at);
      const hoursSinceFirstResponse = (now - firstResponseAt) / (1000 * 60 * 60);
      
      // Resolution SLA: 2x the initial response SLA
      if (hoursSinceFirstResponse > slaHours * 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Auto-assign ticket to available agent
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} Assigned agent ID or null
   */
  async autoAssignTicket(userId) {
    // This would be enhanced with actual agent availability logic
    // For now, we'll implement a simple round-robin assignment
    
    const admins = process.env.ADMIN_USER_IDS?.split(',').map(id => id.trim()) || [];
    
    if (admins.length === 0) {
      logger.warn('No admin users configured for auto-assignment');
      return null;
    }

    // Simple round-robin: assign to first admin (would be enhanced with load balancing)
    const assignedAgent = admins[0];
    
    try {
      await SupportTopicModel.assignTo(userId, assignedAgent);
      logger.info('Ticket auto-assigned', { userId, agentId: assignedAgent });
      return assignedAgent;
    } catch (error) {
      logger.error('Error auto-assigning ticket:', error);
      return null;
    }
  }

  /**
   * Send satisfaction survey to user
   * @param {string} userId - User ID
   * @param {string} language - Language code
   */
  async sendSatisfactionSurvey(userId, language) {
    if (!this.telegram) {
      logger.warn('Support routing not initialized');
      return;
    }

    const messages = {
      es: `🌟 *Valora tu experiencia de soporte*

¿Cómo calificarías la atención recibida?

🌟🌟🌟🌟🌟 (5) - Excelente
🌟🌟🌟🌟 (4) - Muy bueno  
🌟🌟🌟 (3) - Bueno
🌟🌟 (2) - Regular
🌟 (1) - Malo

Responde con un número del 1 al 5 o comparte tus comentarios.`,
      en: `🌟 *Rate your support experience*

How would you rate the support you received?

🌟🌟🌟🌟🌟 (5) - Excellent
🌟🌟🌟🌟 (4) - Very Good
🌟🌟🌟 (3) - Good
🌟🌟 (2) - Fair
🌟 (1) - Poor

Reply with a number from 1 to 5 or share your feedback.`
    };

    const message = messages[language] || messages.en;

    try {
      await this.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
      logger.info('Satisfaction survey sent', { userId });
    } catch (error) {
      logger.error('Error sending satisfaction survey:', error);
    }
  }

  /**
   * Handle satisfaction feedback from user
   * @param {string} userId - User ID
   * @param {string} message - User message containing feedback
   * @returns {Promise<boolean>} True if feedback was processed
   */
  async handleSatisfactionFeedback(userId, message) {
    if (!message) return false;

    try {
      const supportTopic = await SupportTopicModel.getByUserId(userId);
      
      if (!supportTopic || supportTopic.status !== 'closed') {
        return false;
      }

      // Check if message is a rating (1-5)
      const ratingMatch = message.match(/^\s*(\d)\s*$/);
      if (ratingMatch) {
        const rating = parseInt(ratingMatch[1]);
        if (rating >= 1 && rating <= 5) {
          await SupportTopicModel.updateSatisfaction(userId, rating, null);
          
          // Send thank you message
          if (this.telegram) {
            const thankYouMessages = {
              es: '🙏 *¡Gracias por tu valoración!*\n\nTu feedback nos ayuda a mejorar el servicio.',
              en: '🙏 *Thank you for your rating!*\n\nYour feedback helps us improve our service.'
            };
            const language = supportTopic.language || 'es';
            const thankYouMessage = thankYouMessages[language] || thankYouMessages.en;
            
            await this.telegram.sendMessage(userId, thankYouMessage, { parse_mode: 'Markdown' });
          }
          
          logger.info('Satisfaction rating received', { userId, rating });
          return true;
        }
      }

      // If not a rating, treat as text feedback
      await SupportTopicModel.updateSatisfaction(userId, null, message);
      
      // Send thank you message for text feedback
      if (this.telegram) {
        const thankYouMessages = {
          es: '🙏 *¡Gracias por tu feedback!*\n\nApreciamos que compartas tu experiencia con nosotros.',
          en: '🙏 *Thank you for your feedback!*\n\nWe appreciate you sharing your experience with us.'
        };
        const language = supportTopic.language || 'es';
        const thankYouMessage = thankYouMessages[language] || thankYouMessages.en;
        
        await this.telegram.sendMessage(userId, thankYouMessage, { parse_mode: 'Markdown' });
      }
      
      logger.info('Satisfaction feedback received', { userId, feedback: message.substring(0, 50) });
      return true;
      
    } catch (error) {
      logger.error('Error handling satisfaction feedback:', error);
      return false;
    }
  }

  /**
   * Check and update SLA breaches for all open tickets
   * This should be called periodically (e.g., every hour)
   */
  async checkSlaBreaches() {
    if (!this.telegram || !this.supportGroupId) {
      logger.warn('Support routing not initialized for SLA checking');
      return;
    }

    try {
      const openTopics = await SupportTopicModel.getOpenTopics();
      
      for (const topic of openTopics) {
        const isBreached = this.checkSlaBreach(topic);
        
        if (isBreached && !topic.sla_breached) {
          // Mark as breached
          await SupportTopicModel.updateSlaBreach(topic.user_id, true);
          
          // Notify in the support group
          const priorityEmoji = this.getPriorityEmoji(topic.priority);
          const categoryEmoji = this.getCategoryEmoji(topic.category);
          
          const alertMessage = `${priorityEmoji} *ALERTA: SLA INCUMPLIDO*

${categoryEmoji} *Ticket:* ${topic.user_id}
👤 *Usuario:* ${topic.thread_name}
⏰ *Tiempo sin respuesta:* ${this.getSlaBreachTime(topic)}
📅 *Creado:* ${new Date(topic.created_at).toLocaleString('es-ES')}

*Prioridad:* ${topic.priority}
*Categoría:* ${topic.category}`;
          
          try {
            await this.telegram.sendMessage(
              this.supportGroupId,
              alertMessage,
              {
                message_thread_id: topic.thread_id,
                parse_mode: 'Markdown',
              }
            );
            
            logger.warn('SLA breach alert sent', { userId: topic.user_id, threadId: topic.thread_id });
          } catch (notifyError) {
            logger.error('Failed to send SLA breach alert:', notifyError.message);
          }
        }
      }
      
      logger.info('SLA breach check completed', { checked: openTopics.length });
    } catch (error) {
      logger.error('Error checking SLA breaches:', error);
    }
  }

  /**
   * Get SLA breach time description
   * @param {Object} topic - Support topic data
   * @returns {string} Human-readable breach time
   */
  getSlaBreachTime(topic) {
    if (!topic.created_at) return 'Desconocido';
    
    const createdAt = new Date(topic.created_at);
    const now = new Date();
    const hours = Math.floor((now - createdAt) / (1000 * 60 * 60));
    const minutes = Math.floor(((now - createdAt) % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}h ${minutes}m`;
  }

  /**
   * Get emoji based on request type
   * @param {string} requestType - Type of request
   * @returns {string} Emoji
   */
  getRequestEmoji(requestType) {
    const emojis = {
      support: '📬',
      activation: '🎁',
      escalation: '🚨',
      default: '💬',
    };
    return emojis[requestType] || emojis.default;
  }

  /**
   * Get label based on request type
   * @param {string} requestType - Type of request
   * @returns {string} Label
   */
  getRequestLabel(requestType) {
    const labels = {
      support: 'SOLICITUD DE SOPORTE',
      activation: 'SOLICITUD DE ACTIVACIÓN',
      escalation: 'AUTO-ESCALACIÓN',
      default: 'NUEVO MENSAJE',
    };
    return labels[requestType] || labels.default;
  }

  /**
   * Send a message directly to the support group (centralized method)
   * @param {string} message - Message text
   * @param {string} requestType - Type of request ('support', 'activation', 'escalation')
   * @param {Object} user - User information
   * @param {string} messageType - Type of message ('text', 'photo', 'document', etc.)
   * @param {Object} ctx - Telegraf context (optional, for media messages)
   * @returns {Promise<Object>} Support topic data
   */
  async sendToSupportGroup(message, requestType, user, messageType = 'text', ctx = null) {
    if (!this.telegram || !this.supportGroupId) {
      logger.warn('Support routing service not initialized');
      throw new Error('Support routing not configured');
    }

    try {
      // Get or create user's support topic (pass message for category/priority detection)
      const supportTopic = await this.getOrCreateUserTopic(user, requestType, message);
      const threadId = supportTopic.thread_id;

      // Build message header
      const requestEmoji = this.getRequestEmoji(requestType);
      const requestLabel = this.getRequestLabel(requestType);
      const firstName = user.first_name || 'Unknown';
      const username = user.username ? `@${user.username}` : 'No username';

      const header = `${requestEmoji} *${requestLabel}*

👤 *Usuario:* ${firstName} ${username}
🆔 *User ID:* \`${user.id}\`
📅 *Fecha:* ${new Date().toLocaleString('es-ES')}

`;

      // Send based on message type
      if (messageType === 'text') {
        await this.telegram.sendMessage(
          this.supportGroupId,
          header + message,
          {
            message_thread_id: threadId,
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'photo' && ctx?.message?.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        await this.telegram.sendPhoto(
          this.supportGroupId,
          photo.file_id,
          {
            message_thread_id: threadId,
            caption: header + (ctx.message.caption || ''),
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'document' && ctx?.message?.document) {
        await this.telegram.sendDocument(
          this.supportGroupId,
          ctx.message.document.file_id,
          {
            message_thread_id: threadId,
            caption: header + (ctx.message.caption || ''),
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'video' && ctx?.message?.video) {
        await this.telegram.sendVideo(
          this.supportGroupId,
          ctx.message.video.file_id,
          {
            message_thread_id: threadId,
            caption: header + (ctx.message.caption || ''),
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'voice' && ctx?.message?.voice) {
        await this.telegram.sendVoice(
          this.supportGroupId,
          ctx.message.voice.file_id,
          {
            message_thread_id: threadId,
            caption: header,
            parse_mode: 'Markdown',
          }
        );
      } else if (messageType === 'sticker' && ctx?.message?.sticker) {
        // Send header first, then sticker
        await this.telegram.sendMessage(
          this.supportGroupId,
          header.trim(),
          { message_thread_id: threadId, parse_mode: 'Markdown' }
        );
        await this.telegram.sendSticker(
          this.supportGroupId,
          ctx.message.sticker.file_id,
          { message_thread_id: threadId }
        );
      } else {
        // Fallback to text message
        await this.telegram.sendMessage(
          this.supportGroupId,
          header + message,
          {
            message_thread_id: threadId,
            parse_mode: 'Markdown',
          }
        );
      }

      // Update message count
      await SupportTopicModel.updateLastMessage(user.id);

      logger.info('Message sent to support group', { userId: user.id, threadId, messageType });
      return supportTopic;

    } catch (error) {
      logger.error('Failed to send message to support group:', error);
      
      // Enhanced error handling for common Telegram API issues
      if (error.description && error.description.includes('Forbidden')) {
        logger.error('❌ Bot does not have permission to send messages to support group');
        logger.error('   Please ensure the bot is an admin in the support group with post permissions');
      } else if (error.description && error.description.includes('chat not found')) {
        logger.error('❌ Support group chat not found');
        logger.error('   Please verify SUPPORT_GROUP_ID is correct');
      } else if (error.description && error.description.includes('topic not found')) {
        logger.error('❌ Forum topic not found - the support group may not have topics enabled');
        logger.error('   Please ensure the support group is a supergroup with forum topics enabled');
      }
      
      throw error;
    }
  }

  /**
   * Try to react with the delivered indicator on the topic message
   * @param {Object} ctx - Telegraf context for the incoming support group reply
   */
  async addDeliveryReaction(ctx) {
    try {
      await addReaction(ctx, '👍');
    } catch (reactError) {
      logger.debug('Could not add delivery reaction:', reactError.message);
    }
  }

  async indicateQuickAnswerDelivery(ctx) {
    try {
      await addReaction(ctx, '🤝');
      logger.info('Quick answer delivery indicator added', {
        adminId: ctx.from?.id,
        messageId: ctx.message?.message_id,
      });
    } catch (reactError) {
      logger.debug('Could not add quick answer reaction:', reactError.message);
    }
  }
}

// Export singleton instance
const supportRoutingService = new SupportRoutingService();
module.exports = supportRoutingService;
