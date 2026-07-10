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

function getGatekeeperId() {
  return String(process.env.JOIN_REQUEST_GATEKEEPER_TG_ID || DEFAULT_GATEKEEPER_TG_ID);
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
 * chat_join_request handler — forward to gatekeeper.
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

    const description = await describeUser(req.from);
    const bio = req.bio ? `\n\n💬 <i>"${esc(req.bio).slice(0, 400)}"</i>` : '';
    const text =
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
  } catch (err) {
    logger.error('joinRequestGate: handleJoinRequest error', { error: err.message });
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
}

module.exports = { registerJoinRequestGate, handleJoinRequest, handleJoinRequestCallback, DEFAULT_GATEKEEPER_TG_ID };
