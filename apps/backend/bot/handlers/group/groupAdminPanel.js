'use strict';

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const groupManagerService = require('../../../services/groupManagerService');
const { query } = require('../../../config/postgres');

// In-memory banned words cache per chatId to avoid a DB hit on every message
const bannedWordsCache = new Map();
// Spam tracker: `${chatId}:${userId}` → { text, count, lastSeen }
const spamTracker = new Map();
// Pending multi-step actions: userId → { action, chatId }
const pendingActions = new Map();

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getGroupSettings(chatId) {
  const result = await query(
    'SELECT * FROM telegram_group_settings WHERE telegram_chat_id = $1',
    [String(chatId)]
  );
  return result.rows[0] || {
    telegram_chat_id: String(chatId),
    banned_words: [],
    filter_external_links: false,
    spam_threshold: 3,
    spam_action: 'warn',
  };
}

async function upsertSettings(chatId, patch) {
  const fields = Object.keys(patch);
  const values = Object.values(patch);
  const setCols = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const insertCols = fields.join(', ');
  const insertVals = fields.map((_, i) => `$${i + 2}`).join(', ');
  await query(
    `INSERT INTO telegram_group_settings (telegram_chat_id, ${insertCols}, updated_at)
     VALUES ($1, ${insertVals}, NOW())
     ON CONFLICT (telegram_chat_id) DO UPDATE SET ${setCols}, updated_at = NOW()`,
    [String(chatId), ...values]
  );
  bannedWordsCache.delete(String(chatId));
}

async function getCachedBannedWords(chatId) {
  const key = String(chatId);
  if (bannedWordsCache.has(key)) return bannedWordsCache.get(key);
  try {
    const s = await getGroupSettings(key);
    bannedWordsCache.set(key, s.banned_words || []);
    return s.banned_words || [];
  } catch (_) { return []; }
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getAdminGroups(ctx) {
  const groups = await groupManagerService.getLinkedGroups();
  const adminGroups = [];
  for (const g of groups) {
    try {
      const member = await ctx.telegram.getChatMember(Number(g.telegram_chat_id), ctx.from.id);
      if (['creator', 'administrator'].includes(member.status)) adminGroups.push(g);
    } catch (_) {}
  }
  return adminGroups;
}

// ── Message moderation middleware ─────────────────────────────────────────────

async function moderateMessage(ctx, next) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return next();
  const text = ctx.message?.text || ctx.message?.caption || '';
  if (!text) return next();

  const chatId = String(ctx.chat.id);
  const userId = ctx.from?.id;
  const displayName = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');

  // Banned words
  try {
    const banned = await getCachedBannedWords(chatId);
    if (banned.length > 0) {
      const lower = text.toLowerCase();
      if (banned.some((w) => lower.includes(w.toLowerCase()))) {
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply(`${displayName}, that word isn't allowed here.`).catch(() => {});
        return;
      }
    }
  } catch (_) {}

  // Settings-dependent checks
  try {
    const settings = await getGroupSettings(chatId);

    // External link filter (non-admins only)
    if (settings.filter_external_links && /https?:\/\/|t\.me\//i.test(text)) {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, userId).catch(() => null);
      const isAdmin = member && ['creator', 'administrator'].includes(member.status);
      if (!isAdmin) {
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply(`${displayName}, links are not allowed in this group.`).catch(() => {});
        return;
      }
    }

    // Spam check
    const key = `${chatId}:${userId}`;
    const prev = spamTracker.get(key);
    if (prev && prev.text === text) {
      const count = prev.count + 1;
      spamTracker.set(key, { text, count, lastSeen: Date.now() });
      if (count >= settings.spam_threshold) {
        await ctx.deleteMessage().catch(() => {});
        if (count === settings.spam_threshold) {
          await ctx.reply(`${displayName}, please don't repeat the same message.`).catch(() => {});
        }
        return;
      }
    } else {
      spamTracker.set(key, { text, count: 1, lastSeen: Date.now() });
    }
  } catch (_) {}

  return next();
}

// ── Panel UI ──────────────────────────────────────────────────────────────────

async function showGroupPanel(ctx, group) {
  const chatId = String(group.telegram_chat_id);
  const [settings, stats] = await Promise.all([
    getGroupSettings(chatId).catch(() => null),
    groupManagerService.getGroupStats(chatId).catch(() => null),
  ]);

  let msg = `*Managing: ${group.name}*\n\n`;
  if (stats) msg += `👥 Members on PNPtv: *${stats.migrationCount}*\n`;
  if (settings) {
    msg += `🚫 Banned words: *${settings.banned_words.length}*\n`;
    msg += `🔗 Link filter: *${settings.filter_external_links ? 'ON' : 'OFF'}*\n`;
    msg += `📵 Spam threshold: *${settings.spam_threshold}* repeated messages`;
  }

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🚫 Banned Words', `gadmin:words:${chatId}`), Markup.button.callback('⚙️ Filters', `gadmin:filters:${chatId}`)],
      [Markup.button.callback('📣 Broadcast', `gadmin:broadcast:${chatId}`)],
      [Markup.button.callback('🎯 Set Challenge', `gadmin:challenge:${chatId}`)],
      [Markup.button.callback('📊 Stats', `gadmin:stats:${chatId}`)],
    ]),
  });
}

// ── /groupadmin entry point ───────────────────────────────────────────────────

async function handleGroupAdmin(ctx) {
  if (ctx.chat?.type !== 'private') {
    return ctx.reply('Please use /groupadmin in a private chat with me.');
  }
  try {
    const adminGroups = await getAdminGroups(ctx);
    if (adminGroups.length === 0) {
      return ctx.reply(
        "You're not an admin of any connected group yet.\n\n" +
        "Add me to your Telegram group as admin, then run /link <hangoutId> inside the group to connect it."
      );
    }
    if (adminGroups.length === 1) return showGroupPanel(ctx, adminGroups[0]);
    const buttons = adminGroups.map((g) => [Markup.button.callback(`🏘 ${g.name}`, `gadmin:select:${g.telegram_chat_id}`)]);
    await ctx.reply('Which group do you want to manage?', Markup.inlineKeyboard(buttons));
  } catch (err) {
    logger.error('handleGroupAdmin error', { error: err.message });
    await ctx.reply('Could not load your groups. Try again.');
  }
}

// ── Callback handler ──────────────────────────────────────────────────────────

async function handleAdminCallback(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  const action = parts[1];
  const chatId = parts[2];

  // Re-verify admin rights on every callback
  try {
    const member = await ctx.telegram.getChatMember(Number(chatId), ctx.from.id);
    if (!['creator', 'administrator'].includes(member.status)) {
      return ctx.reply('You are no longer an admin of this group.');
    }
  } catch (_) {
    return ctx.reply('Could not verify your admin status.');
  }

  const groups = await groupManagerService.getLinkedGroups().catch(() => []);
  const group = groups.find((g) => String(g.telegram_chat_id) === chatId) || { name: chatId, telegram_chat_id: chatId };

  if (action === 'select') return showGroupPanel(ctx, group);

  if (action === 'stats') {
    const [stats, weekly, top] = await Promise.all([
      groupManagerService.getGroupStats(chatId).catch(() => null),
      groupManagerService.getWeeklyStats(chatId).catch(() => null),
      groupManagerService.getLeaderboard(chatId, 3).catch(() => []),
    ]);
    let msg = `*${group.name} — Stats*\n\n`;
    if (stats) { msg += `Members on PNPtv: *${stats.migrationCount}*\nPoint earners: *${stats.participants}*\n`; }
    if (weekly) msg += `New this week: *${weekly.newMigrations}*\n`;
    if (top.length) {
      msg += '\n*Top members:*\n';
      top.forEach((u, i) => { msg += `${i + 1}. ${u.username ? '@' + u.username : 'Member'} — ${u.total_points} pts\n`; });
    }
    return ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:select:${chatId}`)]]) });
  }

  if (action === 'words') {
    const settings = await getGroupSettings(chatId);
    const list = settings.banned_words.length ? settings.banned_words.map((w) => `• ${w}`).join('\n') : '_None yet_';
    pendingActions.set(ctx.from.id, { action: 'add_banned_word', chatId });
    return ctx.reply(
      `*Banned words for ${group.name}:*\n\n${list}\n\nSend a word to add it. Use /removebanned <word> to remove.`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:select:${chatId}`)]]) }
    );
  }

  if (action === 'filters') {
    const settings = await getGroupSettings(chatId);
    return ctx.reply(`*Filters for ${group.name}:*`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`🔗 Link filter: ${settings.filter_external_links ? '✅ ON' : '❌ OFF'}  — tap to toggle`, `gadmin:togglelinks:${chatId}`)],
        [Markup.button.callback('⬅️ Back', `gadmin:select:${chatId}`)],
      ]),
    });
  }

  if (action === 'togglelinks') {
    const settings = await getGroupSettings(chatId);
    const newVal = !settings.filter_external_links;
    await upsertSettings(chatId, { filter_external_links: newVal });
    return ctx.reply(`Link filter is now *${newVal ? 'ON' : 'OFF'}* for ${group.name}.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:filters:${chatId}`)]]),
    });
  }

  if (action === 'broadcast') {
    pendingActions.set(ctx.from.id, { action: 'broadcast', chatId });
    return ctx.reply(
      `*Broadcast to ${group.name}*\n\nType your message and send it here. It will be posted to the group.`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)]]) }
    );
  }

  if (action === 'challenge') {
    pendingActions.set(ctx.from.id, { action: 'set_challenge', chatId });
    const current = await groupManagerService.getActiveChallenge(chatId).catch(() => null);
    const currentTxt = current ? `\n\n_Current:_ ${current.description}` : '';
    return ctx.reply(
      `*Set challenge for ${group.name}*${currentTxt}\n\nType the new challenge description (max 300 chars).`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)]]) }
    );
  }
}

// ── join_group callback (from /groups and post-onboarding) ───────────────────

async function handleJoinGroupCallback(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.callbackQuery?.data?.replace('join_group:', '');
  if (!chatId) return;
  try {
    const inviteLink = await ctx.telegram.createChatInviteLink(Number(chatId), {
      member_limit: 1,
      name: `pnptv-${ctx.from.id}-${Date.now()}`,
      expire_date: Math.floor(Date.now() / 1000) + 86400,
    });
    const groups = await groupManagerService.getLinkedGroups().catch(() => []);
    const group = groups.find((g) => String(g.telegram_chat_id) === String(chatId));
    const name = group?.name || 'the group';
    await ctx.reply(
      `🎉 Here's your personal invite to *${name}*:\n\n${inviteLink.invite_link}\n\n_One-time use · expires in 24 hours._`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
  } catch (err) {
    logger.error('handleJoinGroupCallback error', { chatId, error: err.message });
    await ctx.reply('Could not generate invite link. Make sure I have admin rights in that group.');
  }
}

// ── Pending action handler (private chat text messages) ───────────────────────

async function handlePendingAction(ctx, next) {
  if (ctx.chat?.type !== 'private') return next();
  const pending = pendingActions.get(ctx.from.id);
  if (!pending) return next();

  const text = (ctx.message?.text || '').trim();
  if (!text || text.startsWith('/')) {
    pendingActions.delete(ctx.from.id);
    return next();
  }

  const { action, chatId } = pending;

  if (action === 'add_banned_word') {
    pendingActions.delete(ctx.from.id);
    const word = text.toLowerCase().slice(0, 50);
    const settings = await getGroupSettings(chatId);
    const words = settings.banned_words || [];
    if (words.includes(word)) return ctx.reply(`"${word}" is already in the list.`);
    words.push(word);
    await upsertSettings(chatId, { banned_words: words });
    return ctx.reply(`✅ Added *"${word}"* to banned words.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
    });
  }

  if (action === 'broadcast') {
    pendingActions.delete(ctx.from.id);
    if (text.length > 4000) return ctx.reply('Message too long (max 4000 chars). Try again.');
    try {
      await ctx.telegram.sendMessage(Number(chatId), text);
      return ctx.reply('✅ Message posted to the group.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
      });
    } catch (err) {
      return ctx.reply(`❌ Failed to send: ${err.message}`);
    }
  }

  if (action === 'set_challenge') {
    pendingActions.delete(ctx.from.id);
    if (text.length > 300) return ctx.reply('Too long (max 300 chars). Try again.');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await groupManagerService.setChallenge(chatId, text, String(ctx.from.id), expiresAt);
    try {
      await ctx.telegram.sendMessage(Number(chatId), `🎯 *New Challenge!*\n\n${text}\n\n_Runs for 7 days — good luck!_`, { parse_mode: 'Markdown' });
    } catch (_) {}
    return ctx.reply('✅ Challenge set and posted to the group.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
    });
  }

  return next();
}

// ── /removebanned <word> ──────────────────────────────────────────────────────

async function handleRemoveBanned(ctx) {
  if (ctx.chat?.type !== 'private') return;
  const word = ctx.message.text.replace(/^\/removebanned\s*/i, '').trim().toLowerCase();
  if (!word) return ctx.reply('Usage: /removebanned <word>');
  const pending = pendingActions.get(ctx.from.id);
  const chatId = pending?.chatId;
  if (!chatId) return ctx.reply('Open /groupadmin first to select a group.');
  const settings = await getGroupSettings(chatId);
  const words = (settings.banned_words || []).filter((w) => w !== word);
  await upsertSettings(chatId, { banned_words: words });
  return ctx.reply(`✅ Removed *"${word}"* from banned words.`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:words:${chatId}`)]]),
  });
}

// ── Registration ──────────────────────────────────────────────────────────────

function registerGroupAdminPanelHandlers(bot) {
  bot.use(moderateMessage);
  bot.use(handlePendingAction);
  bot.command('groupadmin', handleGroupAdmin);
  bot.command('removebanned', handleRemoveBanned);
  bot.action(/^gadmin:/, handleAdminCallback);
  bot.action(/^join_group:/, handleJoinGroupCallback);
}

module.exports = { registerGroupAdminPanelHandlers };
