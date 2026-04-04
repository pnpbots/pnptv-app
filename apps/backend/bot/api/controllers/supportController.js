const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const { getPool } = require('../../../config/postgres');
const { chatWithCristina, isCristinaAIAvailable } = require('../../services/cristinaAIService');
const { buildCristinaSystemPrompt } = require('../../handlers/support/cristinaAI');
const supportRoutingService = require('../../services/supportRoutingService');
const SupportTopicModel = require('../../../models/supportTopicModel');
const SupportTicketMessageModel = require('../../../models/supportTicketMessageModel');

const REDIS_PREFIX = 'support:chat:';
const REDIS_TTL = 7200; // 2 hours
const MAX_HISTORY = 10; // max messages stored (5 pairs)
const MAX_MESSAGE_LENGTH = 1000;

/**
 * POST /api/webapp/support/chat
 * Send a message and get an AI response
 */
async function chat(req, res) {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { message, lang = 'en' } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  const sanitizedMessage = message.trim().substring(0, MAX_MESSAGE_LENGTH);
  const userId = String(user.id);
  const language = lang === 'es' ? 'es' : 'en';

  try {
    // Load conversation history from Redis
    const redis = getRedis();
    const redisKey = `${REDIS_PREFIX}${userId}`;
    let history = [];
    try {
      const stored = await redis.get(redisKey);
      if (stored) {
        history = JSON.parse(stored);
      }
    } catch (e) {
      logger.warn('Failed to load support chat history from Redis', { error: e.message, userId });
    }

    // Query user context from DB
    let userContext = '';
    try {
      const pool = getPool();
      const result = await pool.query(
        `SELECT username, first_name, tier, subscription_status, plan_id, plan_expiry, language, created_at FROM users WHERE id = $1`,
        [userId]
      );
      if (result.rows.length > 0) {
        const u = result.rows[0];
        const tierLabel = (u.tier || '').toLowerCase() === 'prime' ? 'PRIME' : 'FREE';
        const statusLabel = u.subscription_status || 'free';
        const expiry = u.plan_expiry ? new Date(u.plan_expiry).toLocaleDateString() : 'N/A';
        const memberSince = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A';
        userContext = `\n\n👤 USER CONTEXT (use this to personalize your response):
- Name: ${u.first_name || u.username || 'Unknown'}
- Membership Tier: ${tierLabel}
- Subscription Status: ${statusLabel}
- Plan: ${u.plan_id || 'None'}
- Plan Expiry: ${expiry}
- Member Since: ${memberSince}
- Language: ${u.language || language}`;
      }
    } catch (e) {
      logger.warn('Failed to query user context for support chat', { error: e.message, userId });
    }

    // Build system prompt with user context
    const basePrompt = await buildCristinaSystemPrompt(language);
    const systemPrompt = basePrompt + userContext;

    // Build messages array
    const messages = [...history, { role: 'user', content: sanitizedMessage }];

    // Check if AI is available
    if (!isCristinaAIAvailable()) {
      return res.status(503).json({
        success: false,
        error: language === 'es'
          ? 'Cristina AI no está disponible en este momento. Por favor intenta más tarde.'
          : 'Cristina AI is not available right now. Please try again later.',
      });
    }

    // Call Grok via Cristina service
    const aiResponse = await chatWithCristina({
      systemPrompt,
      messages,
      maxTokens: parseInt(process.env.CRISTINA_MAX_TOKENS || '500', 10),
      temperature: 0.7,
    });

    // Update history
    history.push({ role: 'user', content: sanitizedMessage });
    history.push({ role: 'assistant', content: aiResponse });
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    // Save to Redis
    try {
      await redis.set(redisKey, JSON.stringify(history), 'EX', REDIS_TTL);
    } catch (e) {
      logger.warn('Failed to save support chat history to Redis', { error: e.message, userId });
    }

    logger.info('Support chat response generated', { userId, msgLen: sanitizedMessage.length });

    return res.json({
      success: true,
      response: aiResponse,
      historyLength: history.length,
    });
  } catch (error) {
    logger.error('Support chat error', { error: error.message, userId, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: language === 'es'
        ? 'Error procesando tu mensaje. Por favor intenta de nuevo.'
        : 'Error processing your message. Please try again.',
    });
  }
}

/**
 * GET /api/webapp/support/suggestions
 * Returns quick-start suggestion chips
 */
async function suggestions(req, res) {
  const lang = req.query.lang === 'es' ? 'es' : 'en';

  const chips = lang === 'es'
    ? [
        { id: 'membership', label: '¿Cuál es mi membresía?', icon: '📱' },
        { id: 'subscribe', label: '¿Cómo me suscribo a PRIME?', icon: '⭐' },
        { id: 'payments', label: 'Métodos de pago', icon: '💳' },
        { id: 'features', label: '¿Qué puedo hacer aquí?', icon: '🎬' },
        { id: 'streams', label: 'Transmisiones en vivo y horarios', icon: '🎥' },
        { id: 'community', label: 'Normas de la comunidad', icon: '👥' },
        { id: 'login', label: 'Acceso y cuenta', icon: '🔑' },
        { id: 'getting-started', label: 'Guía de inicio', icon: '🚀' },
        { id: 'privacy', label: 'Privacidad y seguridad', icon: '🔒' },
        { id: 'help', label: 'Necesito ayuda técnica', icon: '🆘' },
      ]
    : [
        { id: 'membership', label: 'What is my membership?', icon: '📱' },
        { id: 'subscribe', label: 'How do I subscribe to PRIME?', icon: '⭐' },
        { id: 'payments', label: 'Payment methods', icon: '💳' },
        { id: 'features', label: 'What can I do here?', icon: '🎬' },
        { id: 'streams', label: 'Live streams & schedules', icon: '🎥' },
        { id: 'community', label: 'Community guidelines', icon: '👥' },
        { id: 'login', label: 'Login & account access', icon: '🔑' },
        { id: 'getting-started', label: 'Getting started guide', icon: '🚀' },
        { id: 'privacy', label: 'Privacy & security', icon: '🔒' },
        { id: 'help', label: 'I need technical help', icon: '🆘' },
      ];

  return res.json({ success: true, suggestions: chips });
}

/**
 * DELETE /api/webapp/support/history
 * Clear conversation history
 */
async function clearHistory(req, res) {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const userId = String(user.id);
  try {
    const redis = getRedis();
    await redis.del(`${REDIS_PREFIX}${userId}`);
    logger.info('Support chat history cleared', { userId });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to clear support chat history', { error: error.message, userId });
    return res.status(500).json({ success: false, error: 'Failed to clear history' });
  }
}

/**
 * POST /api/webapp/support/ticket
 * Create a new web support ticket — forwards to Telegram support group
 */
async function createTicket(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const { category, description } = req.body;
  const validCategories = ['payment', 'account', 'bug', 'feature', 'technical', 'general'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ success: false, error: 'Invalid category' });
  }
  if (!description || description.trim().length < 10 || description.trim().length > 2000) {
    return res.status(400).json({ success: false, error: 'Description must be 10-2000 characters' });
  }

  const categoryEmojis = { payment: '💳', account: '👤', bug: '🐛', feature: '🚀', technical: '🛠', general: '📋' };
  const categoryLabels = { payment: 'Payment Issue', account: 'Account Problem', bug: 'Bug Report', feature: 'Feature Request', technical: 'Technical Issue', general: 'General' };

  const userObj = {
    id: user.id,
    first_name: user.firstName || user.first_name || user.displayName || 'User',
    username: user.username || '',
  };

  const message = `🌐 *[WEB TICKET]*\n📂 *Category:* ${categoryEmojis[category]} ${categoryLabels[category]}\n\n${description.trim()}`;

  try {
    const topic = await supportRoutingService.sendToSupportGroup(message, 'support', userObj, 'text', null);

    // Update category on the topic
    await SupportTopicModel.updateCategory(String(user.id), category);

    // Persist user's message for web display
    await SupportTicketMessageModel.create({
      userId: String(user.id),
      senderType: 'user',
      senderName: userObj.first_name,
      content: description.trim(),
    });

    const ticket = await SupportTopicModel.getByUserId(String(user.id));
    return res.json({ success: true, ticket });
  } catch (error) {
    logger.error('Failed to create support ticket', { error: error.message, userId: user.id });
    return res.status(500).json({ success: false, error: 'Failed to create ticket' });
  }
}

/**
 * GET /api/webapp/support/ticket
 * Fetch the current user's open support ticket metadata
 */
async function getTicket(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

  try {
    const ticket = await SupportTopicModel.getByUserId(String(user.id));
    return res.json({ success: true, ticket: ticket || null });
  } catch (error) {
    logger.error('Failed to get ticket', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to get ticket' });
  }
}

/**
 * GET /api/webapp/support/ticket/messages
 * Fetch persisted ticket messages for the web widget
 */
async function getTicketMessages(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

  try {
    const since = req.query.since || null;
    const messages = await SupportTicketMessageModel.getByUserId(String(user.id), since);
    return res.json({ success: true, messages });
  } catch (error) {
    logger.error('Failed to get ticket messages', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to get messages' });
  }
}

/**
 * POST /api/webapp/support/ticket/message
 * Append a follow-up message to an existing open ticket
 */
async function addTicketMessage(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const { message } = req.body;
  if (!message || message.trim().length < 1 || message.trim().length > 2000) {
    return res.status(400).json({ success: false, error: 'Message must be 1-2000 characters' });
  }

  try {
    const ticket = await SupportTopicModel.getByUserId(String(user.id));
    if (!ticket || ticket.status === 'closed') {
      return res.status(404).json({ success: false, error: 'No open ticket found' });
    }

    const userObj = {
      id: user.id,
      first_name: user.firstName || user.first_name || user.displayName || 'User',
      username: user.username || '',
    };

    await supportRoutingService.sendToSupportGroup(
      `🌐 *[WEB REPLY]*\n\n${message.trim()}`,
      'support', userObj, 'text', null
    );

    await SupportTicketMessageModel.create({
      userId: String(user.id),
      senderType: 'user',
      senderName: userObj.first_name,
      content: message.trim(),
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to add ticket message', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to send message' });
  }
}

/**
 * POST /api/webapp/support/verify-payment
 * Admin-only: use Grok AI to analyze payment evidence and optionally activate membership
 */
async function verifyPayment(req, res) {
  const user = req.session?.user;
  if (!user?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { userId, provider, reference, amount, planId, notes, activate } = req.body;

  // Validate required fields
  if (!userId || !provider || !reference || !amount || !planId) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: userId, provider, reference, amount, planId',
    });
  }

  const validProviders = ['epayco', 'daimo', 'btcpay', 'visa'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ success: false, error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Amount must be a positive number' });
  }

  try {
    const { analyzePayment } = require('../../services/cristinaAIService');

    // Step 1: Run Grok analysis
    const analysis = await analyzePayment({
      userId: String(userId),
      provider,
      reference: String(reference),
      amount: parsedAmount,
      planId: String(planId),
      notes: notes || '',
    });

    logger.info('Payment verification analysis completed', {
      adminId: user.id,
      targetUserId: userId,
      provider,
      reference,
      verdict: analysis.valid,
      confidence: analysis.confidence,
      recommendation: analysis.recommendation,
    });

    // Step 2: If admin requested activation and analysis says valid
    let activationResult = null;
    if (activate === true) {
      if (!analysis.valid) {
        return res.json({
          success: true,
          analysis,
          activation: { success: false, error: 'Cannot activate: payment verification failed' },
        });
      }

      try {
        const PaymentService = require('../../services/paymentService');
        const grantResult = await PaymentService.grantEntitlementsForPlan(
          String(userId),
          String(planId),
          'admin'
        );

        // Write audit log
        const pool = getPool();
        await pool.query(
          `INSERT INTO subscription_audit_log (user_id, actor_id, actor_type, action, reason, new_values)
           VALUES ($1, $2, 'admin', 'grant', $3, $4)`,
          [
            String(userId),
            String(user.id),
            `Cristina AI payment verification: ${analysis.reason}`,
            JSON.stringify({
              planId,
              provider,
              reference,
              amount: parsedAmount,
              grokVerdict: analysis.valid,
              grokConfidence: analysis.confidence,
            }),
          ]
        );

        activationResult = {
          success: grantResult.granted > 0,
          granted: grantResult.granted,
          errors: grantResult.errors,
          warning: grantResult.warning || null,
        };

        logger.info('Payment verification: membership activated', {
          adminId: user.id,
          targetUserId: userId,
          planId,
          granted: grantResult.granted,
        });
      } catch (actErr) {
        logger.error('Payment verification: activation failed', {
          error: actErr.message,
          userId,
          planId,
        });
        activationResult = { success: false, error: actErr.message };
      }
    }

    return res.json({
      success: true,
      analysis,
      activation: activationResult,
    });
  } catch (error) {
    logger.error('Payment verification error', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Payment verification failed. Please try again.' });
  }
}

module.exports = {
  chat,
  suggestions,
  clearHistory,
  createTicket,
  getTicket,
  getTicketMessages,
  addTicketMessage,
  verifyPayment,
};
