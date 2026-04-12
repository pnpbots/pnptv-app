/**
 * Cristina Ticket Worker
 * Periodically scans open support tickets, generates AI replies using Grok,
 * sends them to the user via Telegram DM and the support group thread,
 * persists them to the DB, and resolves tickets when appropriate.
 *
 * Env vars:
 *   CRISTINA_TICKET_WORKER_INTERVAL_MS  — polling interval (default: 600000 = 10 min)
 *   CRISTINA_TICKET_WORKER_BATCH        — max tickets per run (default: 10)
 *   CRISTINA_TICKET_WORKER_ENABLED      — set 'false' to disable (default: true)
 */

const logger = require('../utils/logger');
const { getPool } = require('../config/postgres');
const { chatWithCristina, isCristinaAIAvailable } = require('./cristinaAIService');
const { buildCristinaSystemPrompt } = require('../bot/handlers/support/cristinaAI');
const SupportTopicModel = require('../models/supportTopicModel');
const SupportTicketMessageModel = require('../models/supportTicketMessageModel');

const WORKER_INTERVAL_MS = parseInt(process.env.CRISTINA_TICKET_WORKER_INTERVAL_MS || '600000', 10);
const WORKER_BATCH = parseInt(process.env.CRISTINA_TICKET_WORKER_BATCH || '10', 10);
const WORKER_ENABLED = process.env.CRISTINA_TICKET_WORKER_ENABLED !== 'false';

// Instruction appended to Cristina's system prompt when reviewing tickets
const TICKET_WORKER_INSTRUCTIONS = `

---
🎫 TICKET WORKER MODE

You are reviewing an open support ticket. Read the full conversation and reply to the user's latest message.

RESPONSE FORMAT — choose exactly one:

1. If you can fully and confidently resolve the user's issue with available information, start your response with:
   [RESOLVE]
   (followed by your helpful reply)

2. If the issue genuinely requires a human agent (manual account activation, payment dispute with proof, server outage, permanent ban, etc.), respond with ONLY:
   [NEEDS_HUMAN]

3. Otherwise, respond normally without any prefix (ticket stays open).

RULES:
- Use the real user data provided to give precise, personalized answers.
- Only use [RESOLVE] when the issue is truly addressed — not just acknowledged.
- Only use [NEEDS_HUMAN] when you truly cannot help with available tools.
- Keep your reply to 2–3 paragraphs maximum.
- Do NOT include [RESOLVE] or [NEEDS_HUMAN] in any other part of your response.
`;

class CristinaTicketWorker {
  constructor() {
    this.telegram = null;
    this.supportGroupId = null;
    this.isRunning = false;
    this.intervalId = null;
  }

  /**
   * Initialize and start the worker.
   * @param {import('telegraf').Telegraf} bot
   */
  initialize(bot) {
    if (!WORKER_ENABLED) {
      logger.info('CristinaTicketWorker disabled (CRISTINA_TICKET_WORKER_ENABLED=false)');
      return;
    }

    this.telegram = bot.telegram;
    this.supportGroupId = process.env.SUPPORT_GROUP_ID;

    if (!this.supportGroupId) {
      logger.warn('CristinaTicketWorker: SUPPORT_GROUP_ID not set — thread visibility disabled');
    }

    // First run after 60 seconds, then at regular interval
    setTimeout(() => this.processOpenTickets(), 60000);
    this.intervalId = setInterval(() => this.processOpenTickets(), WORKER_INTERVAL_MS);

    logger.info('CristinaTicketWorker initialized', { intervalMs: WORKER_INTERVAL_MS, batchSize: WORKER_BATCH });
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Main processing loop — queries unresponded open tickets and handles each one.
   */
  async processOpenTickets() {
    if (this.isRunning) {
      logger.debug('CristinaTicketWorker: previous run still in progress, skipping');
      return;
    }

    if (!isCristinaAIAvailable()) {
      logger.debug('CristinaTicketWorker: Grok API not configured, skipping');
      return;
    }

    this.isRunning = true;
    let processed = 0;
    let resolved = 0;
    let needsHuman = 0;

    try {
      const pool = getPool();

      // Find open tickets where the latest message came from the user
      // (i.e. last_message_at is newer than last_agent_message_at, or no agent has replied yet)
      const result = await pool.query(`
        SELECT * FROM support_topics
        WHERE status = 'open'
          AND last_message_at > COALESCE(last_agent_message_at, created_at - INTERVAL '1 second')
        ORDER BY last_message_at ASC
        LIMIT $1
      `, [WORKER_BATCH]);

      const tickets = result.rows;
      logger.info(`CristinaTicketWorker: found ${tickets.length} unresponded tickets`);

      for (const ticket of tickets) {
        try {
          const outcome = await this.processTicket(ticket);
          processed++;
          if (outcome === 'resolved') resolved++;
          if (outcome === 'needs_human') needsHuman++;
        } catch (err) {
          logger.error('CristinaTicketWorker: failed to process ticket', {
            userId: ticket.user_id,
            error: err.message,
          });
        }
      }

      if (processed > 0) {
        logger.info('CristinaTicketWorker: run complete', { processed, resolved, needsHuman });
      }
    } catch (err) {
      logger.error('CristinaTicketWorker: processOpenTickets error', { error: err.message });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Handle a single open ticket.
   * @param {object} ticket — row from support_topics
   * @returns {Promise<'replied'|'resolved'|'needs_human'|'skipped'>}
   */
  async processTicket(ticket) {
    const userId = ticket.user_id;
    const language = ticket.language || 'es';

    // 1. Load message history
    const messages = await SupportTicketMessageModel.getByUserId(userId);
    if (!messages.length) return 'skipped';

    // Only process if the last message is from the user
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.sender_type !== 'user') return 'skipped';

    // 2. Load real user data from DB
    const pool = getPool();
    let userRow = {};
    try {
      const userResult = await pool.query(
        `SELECT username, first_name, tier, subscription_status, plan_id, plan_expiry,
                language, created_at, email
         FROM users WHERE id = $1`,
        [userId]
      );
      userRow = userResult.rows[0] || {};
    } catch (err) {
      logger.warn('CristinaTicketWorker: could not load user row', { userId, error: err.message });
    }

    // 3. Build user context block
    const tierLabel = (userRow.tier || '').toLowerCase() === 'prime' ? 'PRIME' : 'FREE';
    const expiry = userRow.plan_expiry ? new Date(userRow.plan_expiry).toLocaleDateString() : 'N/A';
    const memberSince = userRow.created_at ? new Date(userRow.created_at).toLocaleDateString() : 'N/A';
    const userContext = `

---
REAL USER DATA FOR THIS TICKET:
- Name: ${userRow.first_name || userRow.username || 'Unknown'}
- Membership Tier: ${tierLabel}
- Subscription Status: ${userRow.subscription_status || 'free'}
- Plan: ${userRow.plan_id || 'None'}
- Plan Expiry: ${expiry}
- Member Since: ${memberSince}
- Language: ${userRow.language || language}
- Ticket Category: ${ticket.category || 'general'}
- Ticket Priority: ${ticket.priority || 'medium'}
- Ticket Open Since: ${new Date(ticket.created_at).toLocaleDateString()}`;

    // 4. Build full system prompt
    const basePrompt = await buildCristinaSystemPrompt(language);
    const systemPrompt = basePrompt + userContext + TICKET_WORKER_INSTRUCTIONS;

    // 5. Build message array for Grok (full conversation history)
    const grokMessages = messages.map((m) => ({
      role: m.sender_type === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    // 6. Call Grok
    let rawResponse;
    try {
      rawResponse = await chatWithCristina({
        systemPrompt,
        messages: grokMessages,
        maxTokens: parseInt(process.env.CRISTINA_MAX_TOKENS || '600', 10),
        temperature: 0.5,
      });
    } catch (err) {
      logger.error('CristinaTicketWorker: Grok call failed', { userId, error: err.message });
      return 'skipped';
    }

    // 7. Parse directives
    const shouldResolve = rawResponse.startsWith('[RESOLVE]');
    const needsHuman = rawResponse.startsWith('[NEEDS_HUMAN]');

    if (needsHuman) {
      // Escalate: bump priority and notify admins in support thread
      await SupportTopicModel.updatePriority(userId, 'high');
      await this.postToSupportThread(ticket, '🚨 *Cristina AI:* Ticket requires human attention. Escalated to high priority.');
      logger.info('CristinaTicketWorker: escalated to human', { userId });
      return 'needs_human';
    }

    // 8. Clean response text
    const replyText = shouldResolve ? rawResponse.replace('[RESOLVE]', '').trim() : rawResponse.trim();

    // 9. Send DM to user via Telegram
    await this.sendDirectMessage(userId, replyText, language);

    // 10. Post to support group thread (admin visibility)
    const adminNote = shouldResolve
      ? `🤖 *Cristina AI Reply* _(resolving ticket)_:\n\n${replyText}`
      : `🤖 *Cristina AI Reply*:\n\n${replyText}`;
    await this.postToSupportThread(ticket, adminNote);

    // 11. Persist reply for web widget
    const savedMsg = await SupportTicketMessageModel.create({
      userId,
      senderType: 'agent',
      senderName: 'Cristina AI',
      content: replyText,
    });

    // 11b. Push to web widget in real-time via Socket.IO
    try {
      const io = require('./socketSingleton').get();
      if (io && savedMsg) {
        io.to(`user:${userId}`).emit('support:newMessage', {
          id: savedMsg.id,
          sender_type: 'agent',
          sender_name: 'Cristina AI',
          content: replyText,
          created_at: savedMsg.created_at || new Date().toISOString(),
        });
      }
    } catch (socketErr) {
      logger.debug('CristinaTicketWorker: socket emit failed', { error: socketErr.message });
    }

    // 12. Update ticket metadata
    await SupportTopicModel.updateLastAgentMessage(userId);
    if (!ticket.first_response_at) {
      await SupportTopicModel.updateFirstResponse(userId);
    }

    // 13. Close ticket if resolved
    if (shouldResolve) {
      await SupportTopicModel.updateStatus(userId, 'resolved');
      await SupportTopicModel.updateResolutionTime(userId);

      // Notify web widget of status change
      try {
        const io = require('./socketSingleton').get();
        if (io) io.to(`user:${userId}`).emit('support:statusChange', { status: 'resolved', updatedAt: new Date().toISOString() });
      } catch (_) { /* silent */ }

      if (this.telegram && this.supportGroupId && ticket.thread_id) {
        try {
          await this.telegram.closeForumTopic(this.supportGroupId, ticket.thread_id);
          logger.info('CristinaTicketWorker: forum topic closed', { userId, threadId: ticket.thread_id });
        } catch (e) {
          logger.warn('CristinaTicketWorker: could not close forum topic', { error: e.message });
        }
      }

      logger.info('CristinaTicketWorker: ticket resolved', { userId });
      return 'resolved';
    }

    logger.info('CristinaTicketWorker: replied to ticket', { userId });
    return 'replied';
  }

  /**
   * Send a direct Telegram message to the user.
   */
  async sendDirectMessage(userId, replyText, language) {
    if (!this.telegram) return;

    const header = language === 'es'
      ? '🤖 *Cristina (Soporte AI):*\n\n'
      : '🤖 *Cristina (AI Support):*\n\n';

    const footer = language === 'es'
      ? '\n\n_Para más ayuda, responde a este mensaje o usa /support._'
      : '\n\n_For more help, reply to this message or use /support._';

    try {
      await this.telegram.sendMessage(
        userId,
        header + replyText + footer,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      // User may have blocked the bot — log and continue
      logger.warn('CristinaTicketWorker: could not DM user', { userId, error: err.message });
    }
  }

  /**
   * Post a message to the support group thread for admin visibility.
   */
  async postToSupportThread(ticket, text) {
    if (!this.telegram || !this.supportGroupId || !ticket.thread_id) return;

    try {
      await this.telegram.sendMessage(
        this.supportGroupId,
        text,
        {
          message_thread_id: ticket.thread_id,
          parse_mode: 'Markdown',
        }
      );
    } catch (err) {
      logger.warn('CristinaTicketWorker: could not post to support thread', {
        threadId: ticket.thread_id,
        error: err.message,
      });
    }
  }
}

module.exports = new CristinaTicketWorker();
