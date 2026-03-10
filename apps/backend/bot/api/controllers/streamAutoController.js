'use strict';

const { getPool } = require('../../../config/postgres');
const grokService = require('../../services/grokService');
const socketSingleton = require('../../services/socketSingleton');
const logger = require('../../../utils/logger');

/**
 * Module-level map of active auto-chat timers.
 * Key: userId (string)
 * Value: { timeoutId: ReturnType<setTimeout>, messageIndex: number, messages: string[], streamId: string }
 */
const activeTimers = new Map();

/** Returns a random delay in milliseconds between 3 and 5 minutes. */
function randomDelayMs() {
  return (3 * 60 + Math.floor(Math.random() * 2 * 60)) * 1000;
}

/**
 * Derives the stream room ID for a user.
 * Uses live_channel (e.g. "pnptv-frank") if set, otherwise falls back to pnptv-live-<userId>.
 */
async function resolveStreamId(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT live_channel FROM users WHERE id = $1 OR telegram = $1 LIMIT 1',
    [String(userId)]
  );
  const row = rows[0];
  if (row && row.live_channel) return row.live_channel;
  return `pnptv-live-${userId}`;
}

/**
 * Schedules the next auto-chat emission for a given user.
 * Cycles through the messages array infinitely.
 */
function scheduleNext(userId, state) {
  const delay = randomDelayMs();
  const timeoutId = setTimeout(async () => {
    // Check still active in map (might have been stopped)
    if (!activeTimers.has(userId)) return;

    const io = socketSingleton.get();
    if (!io) {
      logger.warn('streamAutoController: io not available for auto-chat emission', { userId });
    } else {
      const { messages, messageIndex, streamId } = activeTimers.get(userId);
      const content = messages[messageIndex % messages.length];
      const nextIndex = (messageIndex + 1) % messages.length;

      io.to(`live:${streamId}`).emit('live:message', {
        id: `auto-${Date.now()}-${userId}`,
        streamId,
        userId: 'bot',
        username: 'PNPtv',
        content,
        createdAt: new Date(),
        isBot: true,
      });

      logger.info('streamAutoController: emitted auto-chat message', { userId, streamId, messageIndex, content });

      // Advance index in stored state
      activeTimers.set(userId, {
        ...activeTimers.get(userId),
        messageIndex: nextIndex,
      });
    }

    // Schedule the next one
    const current = activeTimers.get(userId);
    if (current) {
      scheduleNext(userId, current);
    }
  }, delay);

  // Store updated state with the new timeoutId
  activeTimers.set(userId, { ...state, timeoutId });
}

/**
 * Parse the numbered list returned by Grok into a string[].
 * Accepts lines like "1. message", "1) message", or bare lines.
 */
function parseGrokMessages(rawText) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const messages = [];
  for (const line of lines) {
    // Strip leading "1." or "1)" numbering
    const stripped = line.replace(/^\d+[.)]\s*/, '').trim();
    if (stripped.length > 0 && stripped.length <= 200) {
      messages.push(stripped);
    }
  }

  // Return up to 12 valid messages; if parsing failed return raw lines capped at 12
  if (messages.length >= 1) return messages.slice(0, 12);

  return lines.slice(0, 12);
}

// ── GET /api/webapp/live/stream-profile ─────────────────────────────────────

async function getStreamProfile(req, res) {
  const userId = String(req.session.user.id || req.session.user.telegram_id);
  const pool = getPool();

  try {
    const { rows } = await pool.query(
      `SELECT boundaries, turn_ons, stream_goal, messages
       FROM stream_auto_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (!rows.length) {
      return res.json({ success: true, profile: null });
    }

    const row = rows[0];
    return res.json({
      success: true,
      profile: {
        boundaries: row.boundaries,
        turnOns: row.turn_ons,
        streamGoal: row.stream_goal,
        messages: Array.isArray(row.messages) ? row.messages : [],
      },
    });
  } catch (err) {
    logger.error('getStreamProfile error', { userId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch stream profile' });
  }
}

// ── POST /api/webapp/live/stream-profile ────────────────────────────────────

async function saveStreamProfile(req, res) {
  const userId = String(req.session.user.id || req.session.user.telegram_id);
  const { boundaries, turnOns, streamGoal } = req.body || {};

  if (!boundaries || !turnOns || !streamGoal) {
    return res.status(400).json({
      success: false,
      error: 'boundaries, turnOns, and streamGoal are all required',
    });
  }

  if (String(boundaries).length > 500 || String(turnOns).length > 500 || String(streamGoal).length > 500) {
    return res.status(400).json({
      success: false,
      error: 'Each field must be 500 characters or fewer',
    });
  }

  const prompt = `Generate exactly 12 short chat messages for a live stream on pnptv.app.

Model's stream profile:
- Not comfortable with: ${boundaries}
- What turns them on: ${turnOns}
- Stream goal: ${streamGoal}

Output the 12 messages numbered 1-12, one per line. Each message under 150 characters. Mix of English and Spanish (Spanglish OK). Fun, flirty, playful PNP community vibe. Encourage tips, private calls, engagement.`;

  let messages;
  try {
    const rawText = await grokService.chat({
      mode: 'streamChat',
      language: 'Spanglish',
      prompt,
      maxTokens: 800,
    });
    messages = parseGrokMessages(rawText);
    if (messages.length === 0) {
      throw new Error('Grok returned no parseable messages');
    }
  } catch (err) {
    logger.error('saveStreamProfile: Grok generation failed', { userId, error: err.message });
    return res.status(502).json({ success: false, error: 'Failed to generate messages. Try again.' });
  }

  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO stream_auto_messages (user_id, boundaries, turn_ons, stream_goal, messages, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW())
       ON CONFLICT DO NOTHING`,
      [userId, String(boundaries), String(turnOns), String(streamGoal), JSON.stringify(messages)]
    );

    // Upsert: delete old and insert fresh so we always have one active profile
    await pool.query(
      `DELETE FROM stream_auto_messages WHERE user_id = $1`,
      [userId]
    );
    await pool.query(
      `INSERT INTO stream_auto_messages (user_id, boundaries, turn_ons, stream_goal, messages, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW())`,
      [userId, String(boundaries), String(turnOns), String(streamGoal), JSON.stringify(messages)]
    );

    logger.info('saveStreamProfile: saved stream profile', { userId, messageCount: messages.length });
    return res.json({ success: true, messages });
  } catch (err) {
    logger.error('saveStreamProfile: DB error', { userId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save stream profile' });
  }
}

// ── POST /api/webapp/live/stream-auto-start ─────────────────────────────────

async function startAutoMessages(req, res) {
  const userId = String(req.session.user.id || req.session.user.telegram_id);
  const pool = getPool();

  try {
    const { rows } = await pool.query(
      `SELECT messages FROM stream_auto_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (!rows.length || !Array.isArray(rows[0].messages) || rows[0].messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No stream profile found. Generate messages first.',
      });
    }

    const messages = rows[0].messages;

    // Clear any existing timer for this user
    if (activeTimers.has(userId)) {
      clearTimeout(activeTimers.get(userId).timeoutId);
      activeTimers.delete(userId);
    }

    // Mark as active in DB
    await pool.query(
      `UPDATE stream_auto_messages SET is_active = true WHERE user_id = $1`,
      [userId]
    );

    const streamId = await resolveStreamId(userId);

    const state = { messages, messageIndex: 0, streamId, timeoutId: null };
    activeTimers.set(userId, state);
    scheduleNext(userId, state);

    logger.info('startAutoMessages: started auto-chat', { userId, streamId, messageCount: messages.length });
    return res.json({ success: true });
  } catch (err) {
    logger.error('startAutoMessages error', { userId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to start auto-chat' });
  }
}

// ── POST /api/webapp/live/stream-auto-stop ──────────────────────────────────

async function stopAutoMessages(req, res) {
  const userId = String(req.session.user.id || req.session.user.telegram_id);
  const pool = getPool();

  try {
    if (activeTimers.has(userId)) {
      clearTimeout(activeTimers.get(userId).timeoutId);
      activeTimers.delete(userId);
    }

    await pool.query(
      `UPDATE stream_auto_messages SET is_active = false WHERE user_id = $1`,
      [userId]
    );

    logger.info('stopAutoMessages: stopped auto-chat', { userId });
    return res.json({ success: true });
  } catch (err) {
    logger.error('stopAutoMessages error', { userId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to stop auto-chat' });
  }
}

module.exports = {
  getStreamProfile,
  saveStreamProfile,
  startAutoMessages,
  stopAutoMessages,
};
