const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const { getPool } = require('../../../config/postgres');
const { chatWithCristina, isCristinaAIAvailable } = require('../../services/cristinaAIService');
const { buildCristinaSystemPrompt } = require('../../handlers/support/cristinaAI');

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
        const tierLabel = u.tier === 'PRIME' ? 'PRIME' : 'FREE';
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
        { id: 'privacy', label: 'Privacidad y seguridad', icon: '🔒' },
        { id: 'help', label: 'Necesito ayuda técnica', icon: '🆘' },
      ]
    : [
        { id: 'membership', label: 'What is my membership?', icon: '📱' },
        { id: 'subscribe', label: 'How do I subscribe to PRIME?', icon: '⭐' },
        { id: 'payments', label: 'Payment methods', icon: '💳' },
        { id: 'features', label: 'What can I do here?', icon: '🎬' },
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

module.exports = {
  chat,
  suggestions,
  clearHistory,
};
