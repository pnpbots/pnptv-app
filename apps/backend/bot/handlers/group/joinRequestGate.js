'use strict';

/**
 * Group-invite approval gate.
 *
 * Every Telegram `chat_join_request` update is forwarded as an approve /
 * decline card to a single trusted user (the "gatekeeper"). That user is
 * the only account whose click actually approves the request — any other
 * user tapping the buttons gets a rejection.
 *
 * Rationale: the operator wants membership decisions to route through
 * one person (@Dougiekyle) regardless of how many admins exist. Building
 * on `chat_join_request` (not `new_chat_members`) means the applicant is
 * held in Telegram's pending queue until Dougiekyle acts.
 *
 * Environment override:
 *   JOIN_REQUEST_GATEKEEPER_TG_ID — Telegram numeric ID. Defaults to
 *   Dougiekyle's TG id (8500031395). Change without a code deploy.
 *
 * Bot admin requirement: for join requests to be emitted, the bot must
 * be an admin in the group AND the group must be set to "request to
 * join" (create_join_request) or have a join-request-only invite link.
 * If the bot lacks the "invite users" admin permission it cannot
 * approve/decline via API — the callback logs and surfaces the error.
 */

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');

const DEFAULT_GATEKEEPER_TG_ID = '8500031395'; // @Dougiekyle
const REQUEST_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d — Telegram auto-expires anyway

// CAPTCHA challenge config
const CAPTCHA_ENABLED = process.env.JOIN_REQUEST_CAPTCHA_ENABLED !== 'false';
const CAPTCHA_TIMEOUT_SECONDS = parseInt(process.env.JOIN_REQUEST_CAPTCHA_TIMEOUT_SECONDS || '90', 10);
// Emoji pool for the challenge — targets are picked at random each time so a bot
// that always clicks button 1 will fail. All are visually distinct + universal.
const CAPTCHA_EMOJI_POOL = ['🎯', '🌸', '🎈', '🎪', '🍀', '⚡', '🔑', '🌈', '🎨', '🎁'];
const CAPTCHA_CHOICES = 4;

function getGatekeeperId() {
  return String(process.env.JOIN_REQUEST_GATEKEEPER_TG_ID || DEFAULT_GATEKEEPER_TG_ID);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/**
 * Build a short user description for the approval card. Includes anything
 * useful to a gatekeeper deciding whether to admit: username, real name,
 * platform account status (registered/verified), photo file id.
 */
async function describeUser(tgUser) {
  const parts = [];
  const first = (tgUser.first_name || '').trim();
  const last = (tgUser.last_name || '').trim();
  const username = tgUser.username ? `@${tgUser.username}` : null;
  const name = [first, last].filter(Boolean).join(' ') || username || `user ${tgUser.id}`;
  parts.push(`👤 <b>${esc(name)}</b>${username ? ` (${esc(username)})` : ''}`);
  parts.push(`🆔 <code>${esc(tgUser.id)}</code>`);

  // Look up whether this Telegram user is registered on PNPtv already
  try {
    const { rows } = await query(
      `SELECT id, role, creator_status, identity_verified, is_deleted, created_at
         FROM users WHERE telegram = $1 OR id::text = $1 LIMIT 1`,
      [String(tgUser.id)]
    );
    if (rows[0]) {
      const u = rows[0];
      const flags = [];
      if (u.role && u.role !== 'user') flags.push(u.role);
      if (u.creator_status && u.creator_status !== 'none') flags.push(`creator:${u.creator_status}`);
      if (u.identity_verified) flags.push('✅ID');
      if (u.is_deleted) flags.push('🗑 deleted');
      parts.push(`💠 PNPtv account since ${new Date(u.created_at).toISOString().slice(0, 10)}${flags.length ? ' — ' + flags.join(', ') : ''}`);
    } else {
      parts.push('❓ Not registered on PNPtv yet');
    }
  } catch (err) {
    logger.warn('joinRequestGate: user lookup failed', { tgId: tgUser.id, error: err.message });
  }

  return parts.join('\n');
}

/**
 * Send the approve/decline card to the gatekeeper.
 * `captchaStatus` is a short badge string prepended to the card (e.g.
 * "✅ CAPTCHA passed"). Left blank when CAPTCHA is disabled / bypassed.
 */
async function notifyGatekeeper(ctx, req, captchaStatus = '') {
  const chatId = String(req.chat.id);
  const applicantId = String(req.from.id);
  const chatTitle = req.chat.title || 'the group';
  const gatekeeperId = getGatekeeperId();
  if (!gatekeeperId) return;

  const description = await describeUser(req.from);
  const bio = req.bio ? `\n\n💬 <i>"${esc(req.bio).slice(0, 400)}"</i>` : '';
  const statusLine = captchaStatus ? `${captchaStatus}\n` : '';
  const text =
    statusLine +
    `📥 <b>New join request</b>\n` +
    `Group: <b>${esc(chatTitle)}</b> (<code>${esc(chatId)}</code>)\n\n` +
    description + bio;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve', `jr:ok:${chatId}:${applicantId}`),
      Markup.button.callback('🚫 Decline', `jr:no:${chatId}:${applicantId}`),
    ],
  ]);

  try {
    await ctx.telegram.sendMessage(gatekeeperId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...kb,
    });
  } catch (sendErr) {
    logger.warn('joinRequestGate: failed to notify gatekeeper', {
      gatekeeperId, chatId, applicantId, error: sendErr.message,
    });
  }
}

/**
 * Try to send the applicant a CAPTCHA challenge in DM. Returns:
 *   - 'sent'      — challenge DM'd, waiting for click / timeout
 *   - 'no_dm'     — bot couldn't message the user (they haven't started the bot).
 *                    Caller should fall back to notifying the gatekeeper directly.
 *   - 'error'     — other failure, treat as no_dm.
 * When 'sent' is returned, this function also schedules a timeout that either
 * forwards to the gatekeeper (with a ⏰ marker) or does nothing if the user
 * has already responded.
 */
async function sendCaptchaChallenge(ctx, req) {
  const chatId = String(req.chat.id);
  const applicantId = String(req.from.id);
  const chatTitle = req.chat.title || 'the group';

  const chosen = shuffle(CAPTCHA_EMOJI_POOL).slice(0, CAPTCHA_CHOICES);
  const correctIdx = Math.floor(Math.random() * CAPTCHA_CHOICES);
  const correctEmoji = chosen[correctIdx];

  const redis = getRedis();
  const capKey = `captcha:joinreq:${chatId}:${applicantId}`;
  await redis.set(
    capKey,
    JSON.stringify({ correctIdx, correctEmoji, sentAt: Date.now() }),
    'EX',
    CAPTCHA_TIMEOUT_SECONDS,
  ).catch(() => {});

  const text =
    `👋 Hey ${esc(req.from.first_name || 'there')}!\n\n` +
    `You just requested to join <b>${esc(chatTitle)}</b>. To make sure you're human, ` +
    `tap the <b>${correctEmoji}</b> button below within ${CAPTCHA_TIMEOUT_SECONDS} seconds.\n\n` +
    `If you tap the wrong one or don't answer in time, your request will be declined.`;

  const kb = Markup.inlineKeyboard([
    chosen.map((emoji, i) => Markup.button.callback(emoji, `cap:${chatId}:${applicantId}:${i}`)),
  ]);

  try {
    const sent = await ctx.telegram.sendMessage(applicantId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...kb,
    });
    // Remember the DM message id so we can edit it on completion / timeout.
    await redis.set(
      `${capKey}:msg`,
      JSON.stringify({ messageId: sent.message_id }),
      'EX',
      CAPTCHA_TIMEOUT_SECONDS,
    ).catch(() => {});
  } catch (err) {
    // 403 Forbidden = bot can't DM the user (they haven't started the bot).
    // 400 chat not found = ditto in some cases. Both -> fall back to gatekeeper.
    const code = err?.response?.description || err.message || '';
    if (/Forbidden|chat not found|blocked/i.test(code)) {
      await redis.del(capKey).catch(() => {});
      return 'no_dm';
    }
    logger.warn('joinRequestGate: sendCaptchaChallenge unexpected error', {
      chatId, applicantId, error: code,
    });
    await redis.del(capKey).catch(() => {});
    return 'error';
  }

  // Schedule timeout: if the user hasn't responded in CAPTCHA_TIMEOUT_SECONDS,
  // notify the gatekeeper for manual review. setTimeout is intentional here —
  // Redis TTL handles the correctness bit, the timer just triggers the follow-up.
  setTimeout(async () => {
    try {
      const still = await redis.get(capKey).catch(() => null);
      if (!still) return; // already resolved (correct or wrong click)
      await redis.del(capKey).catch(() => {});
      await redis.del(`${capKey}:msg`).catch(() => {});
      await notifyGatekeeper(ctx, req, '⏰ <b>CAPTCHA TIMEOUT</b> — review manually');
      // Politely close the DM challenge so the user doesn't think it's still live.
      try {
        const msgMeta = await redis.get(`${capKey}:msg`).catch(() => null);
        if (msgMeta) {
          const { messageId } = JSON.parse(msgMeta);
          await ctx.telegram.editMessageText(
            applicantId, messageId, undefined,
            '⏰ Time is up. Your join request is now under manual review.',
          ).catch(() => {});
        }
      } catch (_) {}
    } catch (err) {
      logger.warn('joinRequestGate: captcha timeout handler error', { error: err.message });
    }
  }, CAPTCHA_TIMEOUT_SECONDS * 1000).unref?.();

  return 'sent';
}

/**
 * chat_join_request handler — send CAPTCHA to applicant (if possible),
 * otherwise forward directly to gatekeeper.
 */
async function handleJoinRequest(ctx) {
  try {
    const req = ctx.chatJoinRequest;
    if (!req) return;
    const gatekeeperId = getGatekeeperId();
    if (!gatekeeperId) return;

    const chatId = String(req.chat.id);
    const applicantId = String(req.from.id);
    const chatTitle = req.chat.title || 'the group';

    // Stash the request in Redis so the callback handler can validate on click
    // (the callback carries chatId + applicantId but Telegram doesn't guarantee
    // the request is still pending — Redis TTL matches Telegram's own window).
    const redis = getRedis();
    const key = `joinreq:${chatId}:${applicantId}`;
    await redis.set(
      key,
      JSON.stringify({
        chatId,
        chatTitle,
        applicantId,
        applicantUsername: req.from.username || null,
        firstName: req.from.first_name || null,
        lastName: req.from.last_name || null,
        requestedAt: new Date().toISOString(),
      }),
      'EX',
      REQUEST_TTL_SECONDS,
    ).catch(() => {});

    if (!CAPTCHA_ENABLED) {
      await notifyGatekeeper(ctx, req);
      return;
    }

    // Try CAPTCHA first; fall back to direct gatekeeper if we can't DM the user.
    const result = await sendCaptchaChallenge(ctx, req);
    if (result !== 'sent') {
      await notifyGatekeeper(ctx, req, '⚠️ CAPTCHA skipped — bot cannot DM applicant');
    }
  } catch (err) {
    logger.error('joinRequestGate: handleJoinRequest error', { error: err.message });
  }
}

/**
 * Callback: applicant tapped one of the CAPTCHA buttons.
 * Correct button → forward to gatekeeper with ✅ marker.
 * Wrong button   → auto-decline immediately (with a friendly note in DM).
 */
async function handleCaptchaCallback(ctx) {
  try {
    const match = ctx.match; // /^cap:(-?\d+):(\d+):(\d+)$/
    const chatId = match[1];
    const applicantId = match[2];
    const pickedIdx = Number(match[3]);

    // The button-taker must be the applicant themselves.
    const clickerId = String(ctx.from?.id || '');
    if (clickerId !== applicantId) {
      await ctx.answerCbQuery('This challenge is for someone else.', { show_alert: false }).catch(() => {});
      return;
    }

    const redis = getRedis();
    const capKey = `captcha:joinreq:${chatId}:${applicantId}`;
    const raw = await redis.get(capKey).catch(() => null);
    if (!raw) {
      await ctx.answerCbQuery('This challenge has expired.', { show_alert: true }).catch(() => {});
      try { await ctx.editMessageText('⏰ This challenge has expired.').catch(() => {}); } catch (_) {}
      return;
    }
    const { correctIdx } = JSON.parse(raw);
    // Consume the challenge immediately — no retries.
    await redis.del(capKey).catch(() => {});
    await redis.del(`${capKey}:msg`).catch(() => {});

    const reqKey = `joinreq:${chatId}:${applicantId}`;
    const reqRaw = await redis.get(reqKey).catch(() => null);
    if (!reqRaw) {
      // Original join request has expired from our side; nothing meaningful to do.
      await ctx.answerCbQuery('This join request is no longer active.', { show_alert: true }).catch(() => {});
      return;
    }
    const stored = JSON.parse(reqRaw);
    // Rebuild a minimal req shape for notifyGatekeeper / describeUser.
    const reqShape = {
      chat: { id: stored.chatId, title: stored.chatTitle },
      from: {
        id: applicantId,
        username: stored.applicantUsername,
        first_name: stored.firstName,
        last_name: stored.lastName,
      },
      bio: null,
    };

    if (pickedIdx === correctIdx) {
      // ✅ Passed. Forward to gatekeeper with the CAPTCHA marker.
      await notifyGatekeeper(ctx, reqShape, '✅ <b>CAPTCHA passed</b>');
      await ctx.answerCbQuery('Nice — a moderator will approve shortly.').catch(() => {});
      try {
        await ctx.editMessageText(
          '✅ Thanks! Your request is now with a moderator and should be approved shortly.',
        );
      } catch (_) {}
    } else {
      // 🚫 Wrong button. Auto-decline immediately.
      try {
        await ctx.telegram.declineChatJoinRequest(chatId, Number(applicantId));
      } catch (apiErr) {
        logger.warn('joinRequestGate: auto-decline after failed CAPTCHA failed', {
          chatId, applicantId, error: apiErr?.response?.description || apiErr.message,
        });
      }
      await redis.del(reqKey).catch(() => {});
      await ctx.answerCbQuery('Wrong button — request declined.', { show_alert: true }).catch(() => {});
      try {
        await ctx.editMessageText(
          '🚫 That was the wrong button, so your request was declined.\n\n' +
          'If you\'re a real person and want to try again, you can send a new join request.',
        );
      } catch (_) {}
      // Also notify gatekeeper so they see the failure (not just silent decline)
      await notifyGatekeeper(ctx, reqShape, '🚫 <b>CAPTCHA FAILED</b> — auto-declined').catch(() => {});
    }
  } catch (err) {
    logger.error('joinRequestGate: handleCaptchaCallback error', { error: err.message });
    await ctx.answerCbQuery('Error — try again later.', { show_alert: true }).catch(() => {});
  }
}

/**
 * Callback: gatekeeper tapped Approve or Decline.
 * Only the configured gatekeeper's userId can trigger the action.
 */
async function handleJoinRequestCallback(ctx) {
  try {
    const gatekeeperId = getGatekeeperId();
    const clickerId = String(ctx.from?.id || '');
    if (clickerId !== gatekeeperId) {
      await ctx.answerCbQuery('Only the gatekeeper can approve join requests.', { show_alert: true }).catch(() => {});
      return;
    }

    const match = ctx.match; // /^jr:(ok|no):(-?\d+):(\d+)$/
    const decision = match[1];
    const chatId = match[2];
    const applicantId = match[3];

    try {
      if (decision === 'ok') {
        await ctx.telegram.approveChatJoinRequest(chatId, Number(applicantId));
      } else {
        await ctx.telegram.declineChatJoinRequest(chatId, Number(applicantId));
      }
    } catch (apiErr) {
      // Telegram returns USER_ALREADY_PARTICIPANT if someone approved in-app,
      // or HIDE_REQUESTER_MISSING when the request already expired. Treat as
      // idempotent success from the gatekeeper's perspective.
      const code = apiErr?.response?.description || apiErr.message || '';
      if (/USER_ALREADY_PARTICIPANT|HIDE_REQUESTER_MISSING|USER_NOT_PARTICIPANT/i.test(code)) {
        logger.info('joinRequestGate: request already resolved', { chatId, applicantId, code });
      } else {
        logger.warn('joinRequestGate: API decision call failed', { chatId, applicantId, decision, error: code });
        await ctx.answerCbQuery(`Failed: ${code.slice(0, 180)}`, { show_alert: true }).catch(() => {});
        return;
      }
    }

    // Clean up the Redis entry
    try {
      const redis = getRedis();
      await redis.del(`joinreq:${chatId}:${applicantId}`);
    } catch (_) { /* non-fatal */ }

    // Edit the original card so the gatekeeper can see the decision was recorded
    const stamp = decision === 'ok' ? '✅ <b>APPROVED</b>' : '🚫 <b>DECLINED</b>';
    try {
      const original = ctx.callbackQuery.message?.text || '';
      const html = `${stamp}\n<i>${new Date().toISOString()}</i>\n\n${esc(original)}`;
      await ctx.editMessageText(html, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (editErr) {
      // Message may be too old to edit — fall back to a short reply
      await ctx.reply(stamp, { parse_mode: 'HTML' }).catch(() => {});
    }
    await ctx.answerCbQuery(decision === 'ok' ? 'Approved.' : 'Declined.').catch(() => {});
  } catch (err) {
    logger.error('joinRequestGate: callback error', { error: err.message });
    await ctx.answerCbQuery('Error — check bot logs.', { show_alert: true }).catch(() => {});
  }
}

function registerJoinRequestGate(bot) {
  bot.on('chat_join_request', handleJoinRequest);
  bot.action(/^jr:(ok|no):(-?\d+):(\d+)$/, handleJoinRequestCallback);
  bot.action(/^cap:(-?\d+):(\d+):(\d+)$/, handleCaptchaCallback);
}

module.exports = {
  registerJoinRequestGate,
  handleJoinRequest,
  handleJoinRequestCallback,
  handleCaptchaCallback,
  DEFAULT_GATEKEEPER_TG_ID,
};
