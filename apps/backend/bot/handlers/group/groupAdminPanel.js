'use strict';

const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const sanitize = require('../../../utils/sanitizer');
const grokService = require('../../../services/grokService');
const groupManagerService = require('../../../services/groupManagerService');
const inviteLinkService = require('../../../services/inviteLinkService');
const ChatCleanupService = require('../../../services/chatCleanupService');
const { query } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');

// In-memory banned words cache and pending multi-step actions
const bannedWordsCache = new Map();
const spamTracker = new Map();
const pendingActions = new Map(); // userId → { action, chatId, subStep?, data? }
const adminStatusCache = new Map(); // `${chatId}:${userId}` → { isAdmin: bool, ts: number }

// Sweep spamTracker every 10 min: entries older than 10 min are dead.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of spamTracker.entries()) {
    if (v.lastSeen < cutoff) spamTracker.delete(k);
  }
  // Also cap adminStatusCache growth
  if (adminStatusCache.size > 5000) {
    const keys = Array.from(adminStatusCache.keys()).slice(0, adminStatusCache.size - 4000);
    for (const k of keys) adminStatusCache.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

const DEFAULT_WELCOME =
  '👋 Welcome, {name}! Say hi and enjoy the vibe. 🙌';

const DEFAULT_RULES = `*📋 House Rules*

1️⃣ Respect everyone — no hate, no drama
2️⃣ Consenting adults only, and only *your own* content
3️⃣ Keep it in the group — no external links or offers
4️⃣ No IV talk, no weapons, no illegal stuff
5️⃣ CSAM = instant permanent ban
6️⃣ Got a problem? Use /report (never Telegram's report button)

💬 [PNPtv!](https://pnptv.app)`;

const SLOW_MODE_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1 min', value: 60 },
  { label: '5 min', value: 300 },
  { label: '15 min', value: 900 },
  { label: '1 hour', value: 3600 },
];

// ── Invite link helper ────────────────────────────────────────────────────────

const GROUP_INVITE_CACHE_TTL = 86400 * 30; // 30 days

async function _getGroupInviteLink(chatId) {
  const redis = getRedis();
  const cacheKey = `grp:invite:${chatId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch (_) {}

  const link = await inviteLinkService.createLink({
    createdBy: '8552451957',
    note: `Group welcome — chatId ${chatId}`,
    maxUses: null,
    isLifetime: false,
    primeHours: 72,
    durationHours: 72,
    badgeSlug: 'cloudy-days-pig',
  });

  const url = `https://pnptv.app/invite/${link.code}`;
  try {
    await redis.set(cacheKey, url, 'EX', GROUP_INVITE_CACHE_TTL);
  } catch (_) {}
  return url;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getGroupSettings(chatId) {
  const result = await query(
    'SELECT * FROM telegram_group_settings WHERE telegram_chat_id = $1',
    [String(chatId)]
  );
  const row = result.rows[0] || {};
  return {
    telegram_chat_id: String(chatId),
    banned_words: row.banned_words || [],
    filter_external_links: row.filter_external_links || false,
    spam_threshold: row.spam_threshold || 3,
    spam_action: row.spam_action || 'warn',
    welcome_message: row.welcome_message || null,
    // Onboarding gate is OPT-IN. Default OFF so a stale users.onboarding_complete
    // flag can never silently delete messages from active members.
    require_onboarding: row.require_onboarding === true,
    // Whether to mute new joiners until they complete onboarding via DM /start.
    // Default OFF for the same reason — Telegram members who skip the DM would
    // otherwise stay permanently gagged.
    mute_until_onboarding: row.mute_until_onboarding === true,
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

async function getHangoutRules(chatId) {
  const r = await query(
    'SELECT rules, slow_mode_seconds, name FROM hangout_groups WHERE telegram_chat_id = $1 LIMIT 1',
    [String(chatId)]
  );
  return r.rows[0] || null;
}

async function setHangoutRules(chatId, rules) {
  await query(
    'UPDATE hangout_groups SET rules = $1, updated_at = NOW() WHERE telegram_chat_id = $2',
    [rules, String(chatId)]
  );
}

async function setHangoutSlowMode(chatId, seconds) {
  await query(
    'UPDATE hangout_groups SET slow_mode_seconds = $1, updated_at = NOW() WHERE telegram_chat_id = $2',
    [seconds, String(chatId)]
  );
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

async function verifyAdminInChat(ctx, chatId) {
  try {
    const member = await ctx.telegram.getChatMember(Number(chatId), ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
  } catch (_) { return false; }
}

// ── Message moderation middleware ─────────────────────────────────────────────

async function moderateMessage(ctx, next) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return next();
  const text = ctx.message?.text || ctx.message?.caption || '';
  if (!text) return next();

  const chatId = String(ctx.chat.id);
  const userId = ctx.from?.id;
  const displayName = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');

  // ── Admin status (cached, but never cache false on API error) ────────────────
  const adminKey = `${chatId}:${userId}`;
  const now = Date.now();
  const cached = adminStatusCache.get(adminKey);
  let isAdmin = false;
  if (cached && now - cached.ts < 5 * 60 * 1000) {
    isAdmin = cached.isAdmin;
  } else {
    let lookupOk = false;
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
      isAdmin = ['creator', 'administrator'].includes(member.status);
      lookupOk = true;
    } catch (_) {
      // Transient Telegram error — do NOT cache false, otherwise a real admin
      // would be treated as a regular member for 5 minutes and moderated.
    }
    if (lookupOk) adminStatusCache.set(adminKey, { isAdmin, ts: now });
  }

  // ── Onboarding gate (OPT-IN per group, default OFF) ─────────────────────────
  try {
    if (!isAdmin) {
      const settingsForGate = await getGroupSettings(chatId);
      if (settingsForGate.require_onboarding) {
        const redis = getRedis();
        const doneFlag = await redis.get(`onboard:done:${userId}`);
        let onboardingComplete = doneFlag === '1';
        let dbLookupOk = false;

        if (!onboardingComplete) {
          try {
            const dbRes = await query(
              'SELECT onboarding_complete FROM users WHERE telegram = $1 LIMIT 1',
              [String(userId)]
            );
            dbLookupOk = true;
            if (dbRes.rows.length > 0 && dbRes.rows[0].onboarding_complete === true) {
              onboardingComplete = true;
              await redis.set(`onboard:done:${userId}`, '1', 'EX', 86400 * 30);
            }
          } catch (dbErr) {
            logger.warn('moderateMessage: onboarding DB lookup failed, allowing message', {
              userId, chatId, error: dbErr.message,
            });
          }
        }

        if (dbLookupOk && !onboardingComplete) {
          await ctx.deleteMessage().catch(() => {});
          const notice = await ctx.reply(
            `${displayName}, please complete your registration first — DM me /start`
          ).catch(() => null);
          if (notice) {
            setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, notice.message_id).catch(() => {}), 30000);
          }
          return;
        }
      }
    }
  } catch (_) {}
  // ────────────────────────────────────────────────────────────────────────────

  // ── Username change detection ────────────────────────────────────────────────
  try {
    const redis = getRedis();
    const currentUsername = ctx.from.username || '';
    const unameKey = `grp:uname:${chatId}:${userId}`;
    const stored = await redis.get(unameKey);
    if (stored !== null && stored !== currentUsername) {
      const oldDisplay = stored ? `@${stored}` : `(no username)`;
      const newDisplay = currentUsername ? `@${currentUsername}` : `(removed username)`;
      const name = ctx.from.first_name || String(userId);
      await ctx.reply(
        `ℹ️ *Username change detected*\n\n*${name}* changed their username:\n${oldDisplay} → ${newDisplay}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      try {
        const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
        for (const admin of admins) {
          if (admin.user.is_bot) continue;
          await ctx.telegram.sendMessage(
            admin.user.id,
            `ℹ️ *Username change in ${ctx.chat.title || 'your group'}*\n\n` +
            `*${name}* (ID: \`${userId}\`) changed their Telegram username:\n` +
            `${oldDisplay} → ${newDisplay}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      } catch (_) {}
    }
    await redis.set(unameKey, currentUsername, 'EX', 60 * 60 * 24 * 90);
  } catch (_) {}
  // ────────────────────────────────────────────────────────────────────────────

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

  try {
    const settings = await getGroupSettings(chatId);

    if (settings.filter_external_links && /https?:\/\/|t\.me\//i.test(text)) {
      if (!isAdmin) {
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply(`${displayName}, links are not allowed in this group.`).catch(() => {});
        return;
      }
    }

    const key = `${chatId}:${userId}`;
    const prev = spamTracker.get(key);
    if (prev && prev.text === text) {
      const count = prev.count + 1;
      spamTracker.set(key, { text, count, lastSeen: Date.now() });
      if (count >= settings.spam_threshold) {
        await ctx.deleteMessage().catch(() => {});
        if (count === settings.spam_threshold) {
          await ctx.reply(`${displayName}, please don't repeat the same message.`).catch(() => {});
          if (settings.spam_action === 'kick') {
            await ctx.telegram.banChatMember(ctx.chat.id, userId).catch(() => {});
            await ctx.telegram.unbanChatMember(ctx.chat.id, userId).catch(() => {});
          } else if (settings.spam_action === 'mute') {
            await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
              permissions: { can_send_messages: false },
              until_date: Math.floor(Date.now() / 1000) + 3600,
            }).catch(() => {});
          }
        }
        return;
      }
    } else {
      spamTracker.set(key, { text, count: 1, lastSeen: Date.now() });
    }
  } catch (_) {}

  // ── Award activity points for weekly ranking ────────────────────────────────
  // Rules: 1 point per text message, +1 bonus for media (photo/video/animation).
  // Daily per-user cap of 20 points via Redis to prevent gaming.
  try {
    if (!isAdmin && ctx.from && !ctx.from.is_bot) {
      const redis = getRedis();
      const day = new Date().toISOString().slice(0, 10);
      const dailyKey = `grp:pts:day:${chatId}:${userId}:${day}`;
      const currentDaily = parseInt((await redis.get(dailyKey)) || '0', 10);
      const DAILY_CAP = 20;
      if (currentDaily < DAILY_CAP) {
        const hasMedia = !!(ctx.message?.photo || ctx.message?.video ||
                            ctx.message?.animation || ctx.message?.voice ||
                            ctx.message?.video_note);
        const award = Math.min(hasMedia ? 2 : 1, DAILY_CAP - currentDaily);
        // Resolve users.id (uuid or telegram fallback) once
        let pnptvUserId = String(userId);
        try {
          const uRes = await query(
            'SELECT id FROM users WHERE telegram = $1 LIMIT 1',
            [String(userId)]
          );
          if (uRes.rows[0]?.id) pnptvUserId = String(uRes.rows[0].id);
        } catch (_) {}
        const username = ctx.from?.username || null;
        await groupManagerService.awardPoints(
          chatId, pnptvUserId, userId, username, award, 'group_message'
        );
        await redis.set(dailyKey, String(currentDaily + award), 'EX', 60 * 60 * 26);
      }
    }
  } catch (_) {}

  return next();
}

// Welcome new members with rich PNPtv partnership message
async function handleNewChatMemberWithCustomWelcome(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  try {
    const newMembers = ctx.message?.new_chat_members || [];
    const realMembers = newMembers.filter((m) => !m.is_bot);
    if (realMembers.length === 0) return;

    const chatId = String(ctx.chat.id);
    let groupName = ctx.chat.title || 'the group';
    try {
      const grpRow = await getHangoutRules(chatId);
      if (grpRow?.name) groupName = grpRow.name;
    } catch (_) {}

    const redis = getRedis();

    // Fetch invite link once for the whole batch (cached per chatId)
    let inviteUrl = null;
    try {
      inviteUrl = await _getGroupInviteLink(chatId);
    } catch (linkErr) {
      logger.warn('handleNewChatMemberWithCustomWelcome: invite link failed', { chatId, error: linkErr.message });
    }

    for (const member of realMembers) {
      const userId = member.id;
      const firstName = member.first_name || 'there';

      try {
        await redis.set(
          `onboard:grp:${userId}`,
          JSON.stringify({ chatId, name: groupName }),
          'EX',
          7 * 24 * 60 * 60
        );
      } catch (_) {}

      // Auto-mute-on-join is OPT-IN per group. Default OFF so members who don't
      // DM the bot are never silently gagged. Enable via telegram_group_settings.mute_until_onboarding.
      try {
        const gSettings = await getGroupSettings(chatId).catch(() => null);
        if (gSettings?.mute_until_onboarding) {
          await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
            permissions: { can_send_messages: false },
          }).catch(() => {});
        }
      } catch (_) {}

      // Clear previous bot welcome messages before sending a new one
      try {
        await ChatCleanupService.deleteAllPreviousBotMessages(ctx.telegram, chatId);
      } catch (_) {}

      const safeGroup = groupName.replace(/[_*[\]`]/g, '\\$&');
      const safeName = firstName.replace(/[_*[\]`]/g, '\\$&');
      const welcomeText =
        `👋 Hey *${safeName}*, welcome to *${safeGroup}*.\n\n` +
        `Tap *Register* to set up your PNPtv! account — 3 days PRIME + 🐷 Cloudy Days Pig badge on us.`;

      // Build buttons: if the wizard is enabled, prefer the DM deep-link so the
      // member lands directly in the language/age/terms flow. Otherwise fall
      // back to the web invite.
      const buttons = [];
      const botUsername = ctx.botInfo?.username;
      const wizardEnabled = process.env.BOT_WIZARD_ENABLED === 'true' && botUsername;
      if (wizardEnabled) {
        const deepLink = `https://t.me/${botUsername}?start=grp_${chatId}`;
        buttons.push([Markup.button.url('🚀 Register', deepLink)]);
      } else if (inviteUrl) {
        buttons.push([Markup.button.url('🚀 Register on PNPtv!', inviteUrl)]);
      }
      buttons.push([Markup.button.callback('📜 Rules', `grp_rules:${chatId}`)]);
      buttons.push([Markup.button.callback('✅ I\'m done', 'grp_close')]);

      let sentMsg;
      try {
        sentMsg = await ctx.reply(welcomeText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        });
      } catch (sendErr) {
        logger.warn('handleNewChatMemberWithCustomWelcome: send failed', { chatId, userId, error: sendErr.message });
        continue;
      }

      // Auto-delete welcome after 5 minutes
      if (sentMsg) {
        ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMsg, 5 * 60 * 1000);
      }
    }
  } catch (err) {
    logger.error('handleNewChatMemberWithCustomWelcome error', { error: err.message });
  }
}

// ── Panel UI ──────────────────────────────────────────────────────────────────

async function showGroupPanel(ctx, group) {
  const chatId = String(group.telegram_chat_id);
  const [settings, stats, hangout] = await Promise.all([
    getGroupSettings(chatId).catch(() => null),
    groupManagerService.getGroupStats(chatId).catch(() => null),
    getHangoutRules(chatId).catch(() => null),
  ]);

  const spamActionLabel = { warn: '⚠️ Warn', delete: '🗑 Delete', kick: '🚫 Kick', mute: '🔇 Mute' }[settings?.spam_action || 'warn'] || '⚠️ Warn';
  const slowLabel = SLOW_MODE_OPTIONS.find(o => o.value === (hangout?.slow_mode_seconds || 0))?.label || 'Off';

  let msg = `*Managing: ${group.name}*\n\n`;
  if (stats) msg += `👥 PNPtv members: *${stats.migrationCount}*\n`;
  if (settings) {
    msg += `🚫 Banned words: *${settings.banned_words.length}*\n`;
    msg += `🔗 Link filter: *${settings.filter_external_links ? 'ON' : 'OFF'}*\n`;
    msg += `📵 Spam: threshold *${settings.spam_threshold}*, action *${spamActionLabel}*\n`;
  }
  if (hangout?.rules) msg += `📜 Rules: *set*\n`;
  msg += `🐢 Slow mode: *${slowLabel}*`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📣 Broadcast', `gadmin:broadcast:${chatId}`), Markup.button.callback('📋 Scheduled', `gadmin:scheduled:${chatId}`)],
      [Markup.button.callback('⚙️ Filters', `gadmin:filters:${chatId}`), Markup.button.callback('👋 Welcome', `gadmin:welcome:${chatId}`)],
      [Markup.button.callback('📜 Rules', `gadmin:rules:${chatId}`), Markup.button.callback('🎯 Challenge', `gadmin:challenge:${chatId}`)],
      [Markup.button.callback('📊 Stats', `gadmin:stats:${chatId}`), Markup.button.callback('🐢 Slow Mode', `gadmin:slowmode:${chatId}`)],
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

// ── Schedule step helper ──────────────────────────────────────────────────────

async function _showScheduleStep(ctx, chatId, groupName) {
  const pending = pendingActions.get(ctx.from.id);
  const hasMedia = !!(pending?.data?.mediaFileId);
  const mediaInfo = hasMedia ? ` + ${pending.data.mediaType}` : '';
  return ctx.reply(
    `📅 *When to send to ${groupName || chatId}?*${mediaInfo ? `\n_Includes attached ${pending.data.mediaType}_` : ''}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📤 Send Now', `gadmin:bcast_sched:${chatId}:now`)],
        [
          Markup.button.callback('⏰ 1h', `gadmin:bcast_sched:${chatId}:1h`),
          Markup.button.callback('⏰ 6h', `gadmin:bcast_sched:${chatId}:6h`),
          Markup.button.callback('⏰ 24h', `gadmin:bcast_sched:${chatId}:24h`),
          Markup.button.callback('⏰ 48h', `gadmin:bcast_sched:${chatId}:48h`),
        ],
        [Markup.button.callback('📅 Custom date/time', `gadmin:bcast_sched:${chatId}:custom`)],
        [
          Markup.button.callback('🔁 Daily', `gadmin:bcast_sched:${chatId}:daily`),
          Markup.button.callback('🔁 Weekly', `gadmin:bcast_sched:${chatId}:weekly`),
          Markup.button.callback('🔁 Monthly', `gadmin:bcast_sched:${chatId}:monthly`),
        ],
        [Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)],
      ]),
    }
  );
}

// ── Save/send broadcast helper ────────────────────────────────────────────────

async function _saveBroadcast(ctx, chatId, schedType) {
  const pending = pendingActions.get(ctx.from.id);
  if (!pending?.data) return ctx.reply('Session expired. Start again with /groupadmin.');
  pendingActions.delete(ctx.from.id);

  const { draftText, mediaFileId, mediaType } = pending.data;

  const now = new Date();
  const delayMap = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '48h': 172800000 };
  const recurringPatterns = ['daily', 'weekly', 'monthly'];

  if (schedType === 'now') {
    if (!draftText && !mediaFileId) {
      return ctx.reply('Nothing to send — message is empty. Start again with /groupadmin.');
    }
    try {
      const tg = ctx.telegram;
      const opts = draftText ? { caption: draftText, parse_mode: 'Markdown' } : {};
      if (mediaFileId && mediaType) {
        if (mediaType === 'photo') await tg.sendPhoto(Number(chatId), mediaFileId, opts);
        else if (mediaType === 'video') await tg.sendVideo(Number(chatId), mediaFileId, opts);
        else if (mediaType === 'animation') await tg.sendAnimation(Number(chatId), mediaFileId, opts);
        else await tg.sendDocument(Number(chatId), mediaFileId, opts);
      } else if (draftText) {
        await tg.sendMessage(Number(chatId), draftText, { parse_mode: 'Markdown' });
      }
      return ctx.reply('✅ Message sent to the group!', {
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
      });
    } catch (err) {
      return ctx.reply(`❌ Failed to send: ${err.message}`);
    }
  }

  if (!draftText && !mediaFileId) {
    return ctx.reply('Nothing to send — message is empty. Start again with /groupadmin.');
  }

  let nextRunAt;
  let recurrencePattern = null;

  if (delayMap[schedType]) {
    nextRunAt = new Date(now.getTime() + delayMap[schedType]);
  } else if (recurringPatterns.includes(schedType)) {
    nextRunAt = now;
    recurrencePattern = schedType;
  } else {
    return ctx.reply('Unknown schedule type. Start again with /groupadmin.');
  }

  try {
    await query(`
      INSERT INTO group_broadcast_schedules
        (chat_id, text, media_file_id, media_type, parse_mode,
         scheduled_at, next_run_at, recurrence_pattern, status, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Markdown', $5, $6, $7, 'scheduled', $8, NOW(), NOW())
    `, [
      chatId,
      draftText || null,
      mediaFileId || null,
      mediaType || null,
      nextRunAt,
      nextRunAt,
      recurrencePattern,
      String(ctx.from.id),
    ]);

    const schedLabels = {
      '1h': 'in 1 hour', '6h': 'in 6 hours', '24h': 'in 24 hours', '48h': 'in 2 days',
      daily: 'daily (starting within 60s)', weekly: 'weekly (starting within 60s)', monthly: 'monthly (starting within 60s)',
    };
    return ctx.reply(
      `✅ Broadcast scheduled — will be sent *${schedLabels[schedType] || 'soon'}*.\n\nManage from 📋 Scheduled in the panel.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
      }
    );
  } catch (err) {
    logger.error('groupAdminPanel: _saveBroadcast error', { error: err.message });
    return ctx.reply(`❌ Failed to schedule: ${err.message}`);
  }
}

// ── Callback handler ──────────────────────────────────────────────────────────

async function handleAdminCallback(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  const action = parts[1];
  const chatId = parts[2];

  if (!await verifyAdminInChat(ctx, chatId)) {
    return ctx.reply('You are no longer an admin of this group.');
  }

  const groups = await groupManagerService.getLinkedGroups().catch(() => []);
  const group = groups.find((g) => String(g.telegram_chat_id) === chatId) || { name: chatId, telegram_chat_id: chatId };

  // ── select ───────────────────────────────────────────────────────────────
  if (action === 'select') {
    pendingActions.delete(ctx.from.id); // clear any in-progress wizard state
    return showGroupPanel(ctx, group);
  }

  // ── stats ────────────────────────────────────────────────────────────────
  if (action === 'stats') {
    const [stats, weekly, top] = await Promise.all([
      groupManagerService.getGroupStats(chatId).catch(() => null),
      groupManagerService.getWeeklyStats(chatId).catch(() => null),
      groupManagerService.getLeaderboard(chatId, 10).catch(() => []),
    ]);
    let msg = `*${group.name} — Stats*\n\n`;
    if (stats) {
      msg += `👥 PNPtv members: *${stats.migrationCount}*\n`;
      msg += `🏆 Point earners: *${stats.participants}*\n`;
      msg += `⭐ Total points awarded: *${stats.totalPoints}*\n`;
    }
    if (weekly) {
      msg += `\n📅 *This week:*\n`;
      msg += `  New joins: *${weekly.newMigrations}*\n`;
      if (weekly.topContributor) msg += `  Top contributor: @${weekly.topContributor.username || 'unknown'} (${weekly.topContributor.weekly_points} pts)\n`;
    }
    if (top.length) {
      msg += '\n🥇 *All-time leaderboard:*\n';
      top.forEach((u, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
        msg += `${medal} ${u.username ? '@' + u.username : 'Member'} — *${u.total_points} pts*\n`;
      });
    }
    return ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:select:${chatId}`)]]) });
  }

  // ── banned words ─────────────────────────────────────────────────────────
  if (action === 'words') {
    const settings = await getGroupSettings(chatId);
    const list = settings.banned_words.length ? settings.banned_words.map((w) => `• \`${w}\``).join('\n') : '_None yet_';
    pendingActions.set(ctx.from.id, { action: 'add_banned_word', chatId });
    return ctx.reply(
      `*Banned words for ${group.name}:*\n\n${list}\n\nSend a word to add it. Use /removebanned <word> to remove.`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:select:${chatId}`)]]) }
    );
  }

  // ── filters ──────────────────────────────────────────────────────────────
  if (action === 'filters') {
    const settings = await getGroupSettings(chatId);
    const spamActionLabel = { warn: '⚠️ Warn', delete: '🗑 Delete', kick: '🚫 Kick', mute: '🔇 Mute' }[settings.spam_action || 'warn'];
    return ctx.reply(`*Filters for ${group.name}:*`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`🔗 Link filter: ${settings.filter_external_links ? '✅ ON' : '❌ OFF'} — tap to toggle`, `gadmin:togglelinks:${chatId}`)],
        [Markup.button.callback(`📵 Spam action: ${spamActionLabel} — tap to change`, `gadmin:spamaction:${chatId}`)],
        [Markup.button.callback('🚫 Banned Words', `gadmin:words:${chatId}`)],
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
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Filters', `gadmin:filters:${chatId}`)]]),
    });
  }

  if (action === 'spamaction') {
    const settings = await getGroupSettings(chatId);
    const cycle = { warn: 'delete', delete: 'mute', mute: 'kick', kick: 'warn' };
    const newAction = cycle[settings.spam_action || 'warn'];
    await upsertSettings(chatId, { spam_action: newAction });
    const label = { warn: '⚠️ Warn', delete: '🗑 Delete', kick: '🚫 Kick', mute: '🔇 Mute' }[newAction];
    return ctx.reply(`Spam action is now *${label}* for ${group.name}.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Filters', `gadmin:filters:${chatId}`)]]),
    });
  }

  // ── AI broadcast ──────────────────────────────────────────────────────────
  if (action === 'broadcast') {
    return ctx.reply(
      `*📣 Broadcast to ${group.name}*\n\nChoose how to write the message:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🤖 AI — English', `gadmin:bcast_ai_lang:${chatId}:en`)],
          [Markup.button.callback('🤖 AI — Español', `gadmin:bcast_ai_lang:${chatId}:es`)],
          [Markup.button.callback('🤖 AI — Spanglish', `gadmin:bcast_ai_lang:${chatId}:sx`)],
          [Markup.button.callback('✏️ Write manually', `gadmin:bcast_manual:${chatId}`)],
          [Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)],
        ]),
      }
    );
  }

  if (action === 'bcast_ai_lang') {
    const lang = parts[3];
    const langLabel = { en: 'English', es: 'Spanish', sx: 'Spanglish' }[lang] || 'English';
    pendingActions.set(ctx.from.id, { action: 'bcast_ai_prompt', chatId, data: { lang, langLabel } });
    return ctx.reply(
      `🤖 *AI Broadcast (${langLabel})*\n\nDescribe the topic or give a short brief for the message (e.g. "announce Friday night event, PNP vibe, invite people to join"):`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)]]) }
    );
  }

  if (action === 'bcast_manual') {
    pendingActions.set(ctx.from.id, { action: 'bcast_text', chatId });
    return ctx.reply(
      `✏️ *Write your message for ${group.name}:*\n\nType the message you want to broadcast.`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)]]) }
    );
  }

  if (action === 'bcast_edit') {
    const pending = pendingActions.get(ctx.from.id);
    pendingActions.set(ctx.from.id, { ...pending, action: 'bcast_text', chatId });
    return ctx.reply('✏️ Send your edited message text:', {
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)]]),
    });
  }

  if (action === 'bcast_regen') {
    const pending = pendingActions.get(ctx.from.id);
    const { lang, langLabel, aiPrompt } = pending?.data || {};
    if (!aiPrompt) return ctx.reply('Session expired. Start again with /groupadmin.');
    return _runAiBroadcast(ctx, chatId, group.name, lang, langLabel, aiPrompt);
  }

  // ── Broadcast: attach media step ──────────────────────────────────────────
  if (action === 'bcast_attach') {
    const pending = pendingActions.get(ctx.from.id);
    if (!pending?.data?.draftText && !pending?.data) return ctx.reply('Session expired. Start again.');
    pendingActions.set(ctx.from.id, { ...pending, action: 'bcast_await_media', chatId });
    return ctx.reply(
      '📷 *Attach media*\n\nSend a photo, video, animation, or document now:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏭️ Skip (no media)', `gadmin:bcast_no_media:${chatId}`)],
          [Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)],
        ]),
      }
    );
  }

  if (action === 'bcast_no_media') {
    const pending = pendingActions.get(ctx.from.id);
    if (pending) pendingActions.set(ctx.from.id, { ...pending, action: 'bcast_confirm', chatId });
    return _showScheduleStep(ctx, chatId, group.name);
  }

  // ── Broadcast: schedule selection ─────────────────────────────────────────
  if (action === 'bcast_sched') {
    const schedType = parts[3];
    if (schedType === 'custom') {
      const pending = pendingActions.get(ctx.from.id);
      if (pending) pendingActions.set(ctx.from.id, { ...pending, action: 'bcast_sched_custom', chatId });
      return ctx.reply(
        '📅 *Enter date and time*\n\nFormat: `DD/MM HH:MM` or `DD/MM/YYYY HH:MM`\nExample: `25/07 20:00` or `25/07/2026 20:00`\n\n_Bogotá time (America/Bogota, UTC-5)_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)]]),
        }
      );
    }
    return _saveBroadcast(ctx, chatId, schedType);
  }

  // ── Scheduled broadcasts list ─────────────────────────────────────────────
  if (action === 'scheduled') {
    const result = await query(`
      SELECT id, text, media_type, next_run_at, recurrence_pattern, status, run_count, max_runs
      FROM group_broadcast_schedules
      WHERE chat_id = $1 AND status IN ('scheduled','active')
      ORDER BY next_run_at ASC
      LIMIT 10
    `, [chatId]);

    if (result.rows.length === 0) {
      return ctx.reply(
        `No scheduled broadcasts for *${group.name}* right now.\n\nTap 📣 Broadcast to create one.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:select:${chatId}`)]]),
        }
      );
    }

    let msg = `*📋 Scheduled Broadcasts — ${group.name}:*\n\n`;
    result.rows.forEach((row, i) => {
      const pattern = row.recurrence_pattern || 'once';
      const nextRun = row.next_run_at
        ? new Date(row.next_run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '?';
      const preview = (row.text || `[${row.media_type || 'media'}]`).slice(0, 50);
      const runs = row.recurrence_pattern ? ` (${row.run_count || 0}${row.max_runs ? `/${row.max_runs}` : ''} sent)` : '';
      msg += `*${i + 1}.* \`${pattern}\`${runs}\n⏰ ${nextRun}\n_${preview}_\n\n`;
    });

    const cancelButtons = result.rows.map((row, i) => [
      Markup.button.callback(`🗑 Cancel #${i + 1}`, `gadmin:bcast_cancel:${chatId}:${row.id}`),
    ]);

    return ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        ...cancelButtons,
        [Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)],
      ]),
    });
  }

  if (action === 'bcast_cancel') {
    const broadcastId = parts[3];
    await query(
      `UPDATE group_broadcast_schedules SET status='cancelled', updated_at=NOW() WHERE id=$1 AND chat_id=$2`,
      [broadcastId, chatId]
    );
    return ctx.reply('✅ Broadcast cancelled.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Scheduled list', `gadmin:scheduled:${chatId}`)]]),
    });
  }

  // ── welcome message ───────────────────────────────────────────────────────
  if (action === 'welcome') {
    const settings = await getGroupSettings(chatId);
    const current = settings.welcome_message || DEFAULT_WELCOME;
    pendingActions.set(ctx.from.id, { action: 'set_welcome', chatId });
    return ctx.reply(
      `*👋 Welcome Message for ${group.name}*\n\n_Current:_\n${current}\n\nUse \`{name}\` to include the new member's name.\n\nSend a new message text to replace it:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reset to default', `gadmin:welcome_reset:${chatId}`)],
          [Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)],
        ]),
      }
    );
  }

  if (action === 'welcome_reset') {
    pendingActions.delete(ctx.from.id);
    await upsertSettings(chatId, { welcome_message: null });
    return ctx.reply('✅ Welcome message reset to default.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
    });
  }

  // ── group rules ───────────────────────────────────────────────────────────
  if (action === 'rules') {
    const hangout = await getHangoutRules(chatId).catch(() => null);
    const current = hangout?.rules || '_No rules set yet._';
    pendingActions.set(ctx.from.id, { action: 'set_rules', chatId });
    return ctx.reply(
      `*📜 Group Rules for ${group.name}*\n\n${current}\n\nSend the new rules text (max 2000 chars). Members can see them with /rules in the group.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🗑 Clear rules', `gadmin:rules_clear:${chatId}`)],
          [Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)],
        ]),
      }
    );
  }

  if (action === 'rules_clear') {
    pendingActions.delete(ctx.from.id);
    await setHangoutRules(chatId, null);
    return ctx.reply('✅ Rules cleared.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
    });
  }

  if (action === 'rules_post') {
    const hangout = await getHangoutRules(chatId).catch(() => null);
    const rules = hangout?.rules;
    if (!rules) return ctx.reply('No rules set. Add them first.');
    try {
      await ctx.telegram.sendMessage(Number(chatId), `📜 *Group Rules*\n\n${rules}`, { parse_mode: 'Markdown' });
      return ctx.reply('✅ Rules posted to the group.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
      });
    } catch (err) {
      return ctx.reply(`❌ Failed to post: ${err.message}`);
    }
  }

  // ── challenge ─────────────────────────────────────────────────────────────
  if (action === 'challenge') {
    pendingActions.set(ctx.from.id, { action: 'set_challenge', chatId });
    const current = await groupManagerService.getActiveChallenge(chatId).catch(() => null);
    const currentTxt = current ? `\n\n_Current:_ ${current.description}` : '';
    return ctx.reply(
      `*🎯 Set challenge for ${group.name}*${currentTxt}\n\nType the new challenge description (max 300 chars).`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)]]) }
    );
  }

  // ── slow mode ─────────────────────────────────────────────────────────────
  if (action === 'slowmode') {
    const hangout = await getHangoutRules(chatId).catch(() => null);
    const current = hangout?.slow_mode_seconds || 0;
    const buttons = SLOW_MODE_OPTIONS.map(o => [
      Markup.button.callback(
        `${o.value === current ? '✅ ' : ''}${o.label}`,
        `gadmin:slowset:${chatId}:${o.value}`
      ),
    ]);
    buttons.push([Markup.button.callback('⬅️ Back', `gadmin:select:${chatId}`)]);
    return ctx.reply(`*🐢 Slow Mode for ${group.name}*\n\nCurrent: *${SLOW_MODE_OPTIONS.find(o => o.value === current)?.label || 'Off'}*\n\nSelect new setting:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  if (action === 'slowset') {
    const seconds = parseInt(parts[3], 10) || 0;
    const label = SLOW_MODE_OPTIONS.find(o => o.value === seconds)?.label || 'Off';
    try {
      await ctx.telegram.setChatSlowModeDelay(Number(chatId), seconds);
    } catch (err) {
      logger.warn('setChatSlowModeDelay failed', { chatId, seconds, error: err.message });
    }
    await setHangoutSlowMode(chatId, seconds);
    return ctx.reply(`✅ Slow mode set to *${label}* for ${group.name}.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
    });
  }
}

// ── AI broadcast helper ───────────────────────────────────────────────────────

async function _runAiBroadcast(ctx, chatId, groupName, lang, langLabel, aiPrompt) {
  await ctx.reply('🤖 Generating broadcast...').catch(() => {});
  try {
    const langMap = { en: 'English', es: 'Spanish', sx: 'Spanglish' };
    const result = await grokService.chat({
      mode: 'broadcast',
      language: langMap[lang] || 'English',
      prompt: aiPrompt,
    });

    pendingActions.set(ctx.from.id, {
      action: 'bcast_confirm',
      chatId,
      data: { lang, langLabel, aiPrompt, draftText: result },
    });

    const safeDraft = sanitize.telegramMarkdown(result);
    return ctx.reply(
      `🤖 *AI Draft (${langLabel}):*\n\n${safeDraft}\n\n_Review before sending to ${groupName}._`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📷 Attach media', `gadmin:bcast_attach:${chatId}`), Markup.button.callback('⏭️ No media', `gadmin:bcast_no_media:${chatId}`)],
          [Markup.button.callback('✏️ Edit text', `gadmin:bcast_edit:${chatId}`), Markup.button.callback('🔄 Regenerate', `gadmin:bcast_regen:${chatId}`)],
          [Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)],
        ]),
      }
    );
  } catch (err) {
    logger.error('groupAdminPanel: AI broadcast error', { error: err.message });
    return ctx.reply(`❌ AI error: ${err.message}\n\nTry again or write manually.`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', `gadmin:broadcast:${chatId}`)]]),
    });
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

// ── Pending action handler (private chat text + media messages) ───────────────

async function handlePendingAction(ctx, next) {
  if (ctx.chat?.type !== 'private') return next();
  const pending = pendingActions.get(ctx.from.id);
  if (!pending) return next();

  const { action, chatId } = pending;

  // ── Handle media messages for bcast_await_media ──────────────────────────
  if (action === 'bcast_await_media') {
    const msg = ctx.message;
    let fileId = null;
    let mediaType = null;

    if (msg?.photo?.length) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      mediaType = 'photo';
    } else if (msg?.video) {
      fileId = msg.video.file_id;
      mediaType = 'video';
    } else if (msg?.animation) {
      fileId = msg.animation.file_id;
      mediaType = 'animation';
    } else if (msg?.document) {
      fileId = msg.document.file_id;
      mediaType = 'document';
    }

    if (fileId) {
      pendingActions.set(ctx.from.id, {
        ...pending,
        action: 'bcast_confirm',
        data: { ...pending.data, mediaFileId: fileId, mediaType },
      });
      const groups = await groupManagerService.getLinkedGroups().catch(() => []);
      const group = groups.find((g) => String(g.telegram_chat_id) === chatId) || { name: chatId };
      return _showScheduleStep(ctx, chatId, group.name);
    }

    // If it's a slash command, cancel
    const text = ctx.message?.text || '';
    if (text.startsWith('/')) {
      pendingActions.delete(ctx.from.id);
      return next();
    }
    // Otherwise prompt again
    return ctx.reply('Please send a photo, video, animation, or document. Or tap ⏭️ Skip above.');
  }

  // ── All other actions require text ───────────────────────────────────────
  const text = (ctx.message?.text || '').trim();
  if (!text || text.startsWith('/')) {
    pendingActions.delete(ctx.from.id);
    return next();
  }

  // ── banned word add ──────────────────────────────────────────────────────
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

  // ── AI broadcast prompt ──────────────────────────────────────────────────
  if (action === 'bcast_ai_prompt') {
    const { lang, langLabel } = pending.data || {};
    pendingActions.set(ctx.from.id, { ...pending, data: { ...pending.data, aiPrompt: text } });
    const groups = await groupManagerService.getLinkedGroups().catch(() => []);
    const group = groups.find((g) => String(g.telegram_chat_id) === chatId) || { name: chatId };
    return _runAiBroadcast(ctx, chatId, group.name, lang, langLabel, text);
  }

  // ── manual broadcast text ────────────────────────────────────────────────
  if (action === 'bcast_text') {
    if (text.length > 4000) return ctx.reply('Message too long (max 4000 chars). Try again.');
    pendingActions.set(ctx.from.id, { action: 'bcast_confirm', chatId, data: { ...pending.data, draftText: text } });
    const safe = sanitize.telegramMarkdown(text);
    const groups = await groupManagerService.getLinkedGroups().catch(() => []);
    const group = groups.find((g) => String(g.telegram_chat_id) === chatId) || { name: chatId };
    return ctx.reply(
      `*Preview for ${group.name}:*\n\n${safe}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📷 Attach media', `gadmin:bcast_attach:${chatId}`), Markup.button.callback('⏭️ No media', `gadmin:bcast_no_media:${chatId}`)],
          [Markup.button.callback('✏️ Edit text', `gadmin:bcast_edit:${chatId}`)],
          [Markup.button.callback('❌ Cancel', `gadmin:select:${chatId}`)],
        ]),
      }
    );
  }

  // ── custom schedule date/time ────────────────────────────────────────────
  if (action === 'bcast_sched_custom') {
    const match = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
    if (!match) {
      return ctx.reply('Invalid format. Use `DD/MM HH:MM` (e.g. `25/07 20:00`):', { parse_mode: 'Markdown' });
    }
    const [, day, month, year, hour, minute] = match;
    const d = parseInt(day), mo = parseInt(month) - 1, y = year ? parseInt(year) : new Date().getFullYear();
    const h = parseInt(hour), min = parseInt(minute);
    // Input is Bogotá time (UTC-5) — shift to UTC for storage
    const schedDate = new Date(Date.UTC(y, mo, d, h + 5, min));
    // Detect JS date rollover (e.g. month=13 silently becomes next year)
    if (isNaN(schedDate.getTime()) || schedDate.getUTCMonth() !== mo || schedDate <= new Date()) {
      return ctx.reply('That date is invalid or in the past. Use `DD/MM HH:MM` in Bogotá time (e.g. `25/07 20:00`):', { parse_mode: 'Markdown' });
    }

    pendingActions.delete(ctx.from.id);
    const { data } = pending;

    try {
      await query(`
        INSERT INTO group_broadcast_schedules
          (chat_id, text, media_file_id, media_type, parse_mode,
           scheduled_at, next_run_at, recurrence_pattern, status, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'Markdown', $5, $6, 'once', 'scheduled', $7, NOW(), NOW())
      `, [
        chatId,
        data?.draftText || null,
        data?.mediaFileId || null,
        data?.mediaType || null,
        schedDate,
        schedDate,
        String(ctx.from.id),
      ]);
      const label = schedDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return ctx.reply(
        `✅ Scheduled for *${label}*.\n\nManage from 📋 Scheduled in the panel.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
        }
      );
    } catch (err) {
      return ctx.reply(`❌ Failed to schedule: ${err.message}`);
    }
  }

  // ── welcome message set ──────────────────────────────────────────────────
  if (action === 'set_welcome') {
    pendingActions.delete(ctx.from.id);
    if (text.length > 1000) return ctx.reply('Too long (max 1000 chars). Try again.');
    await upsertSettings(chatId, { welcome_message: text });
    const preview = text.replace(/\{name\}/gi, '*NewMember*');
    return ctx.reply(
      `✅ Welcome message saved.\n\n_Preview:_\n${preview}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to panel', `gadmin:select:${chatId}`)]]),
      }
    );
  }

  // ── group rules set ──────────────────────────────────────────────────────
  if (action === 'set_rules') {
    pendingActions.delete(ctx.from.id);
    if (text.length > 2000) return ctx.reply('Too long (max 2000 chars). Try again.');
    await setHangoutRules(chatId, text);
    return ctx.reply(
      `✅ Rules saved.\n\nPost them to the group now?`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📣 Post to group', `gadmin:rules_post:${chatId}`)],
          [Markup.button.callback('Not now', `gadmin:select:${chatId}`)],
        ]),
      }
    );
  }

  // ── challenge set ────────────────────────────────────────────────────────
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

  // ── inline report text ──────────────────────────────────────────────────
  if (action === 'grp_report') {
    pendingActions.delete(ctx.from.id);
    if (text.length > 2000) return ctx.reply('Too long. Keep it under 2000 characters and try again.');
    await _forwardReportToAdmins(ctx, chatId, text);
    return;
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

// ── /rules command (in group) ─────────────────────────────────────────────────

async function handleRulesCommand(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  try {
    const hangout = await getHangoutRules(String(ctx.chat.id)).catch(() => null);
    const rulesText = hangout?.rules || DEFAULT_RULES;
    await ctx.reply(rulesText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚨 Report an Issue', `grp_report:${ctx.chat.id}`)],
      ]),
    });
  } catch (err) {
    logger.error('handleRulesCommand error', { error: err.message });
  }
}

// ── /report command and report callback ──────────────────────────────────────

async function handleReportCommand(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  const chatId = String(ctx.chat.id);
  const text = (ctx.message?.text || '').replace(/^\/report\s*/i, '').trim();

  if (!text) {
    return ctx.reply(
      '🚨 *Report an Issue*\n\nDescribe the problem in one message:\n`/report <your description>`\n\nExample: `/report User @someone is sharing links`',
      { parse_mode: 'Markdown' }
    );
  }
  await _forwardReportToAdmins(ctx, chatId, text);
}

async function handleReportCallback(ctx) {
  await ctx.answerCbQuery('Opening report — check your DMs with me').catch(() => {});
  const chatId = ctx.callbackQuery?.data?.replace('grp_report:', '');
  if (!chatId) return;
  pendingActions.set(ctx.from.id, { action: 'grp_report', chatId });
  // DM the user so the complaint stays private
  try {
    await ctx.telegram.sendMessage(
      ctx.from.id,
      '🚨 *Report an Issue*\n\nDescribe the problem and I\'ll notify all group admins immediately.\n\nSend your message now:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', `grp_report_cancel:${chatId}`)]]),
      }
    );
  } catch (_) {
    // User hasn't started the bot — fall back to inline prompt in group
    await ctx.reply(
      '🚨 To report privately, please start a DM with me first and then tap the button again. Or use: `/report <description>` right here.',
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

async function handleReportCancelCallback(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  pendingActions.delete(ctx.from.id);
  return ctx.reply('Report cancelled.');
}

async function handleViewRulesCallback(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  const chatId = ctx.callbackQuery?.data?.replace('grp_rules:', '');
  if (!chatId) return;
  try {
    const hangout = await getHangoutRules(chatId).catch(() => null);
    const rulesText = hangout?.rules || DEFAULT_RULES;
    const sentMsg = await ctx.reply(rulesText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚨 Report an Issue', `grp_report:${chatId}`)],
        [
          Markup.button.callback('⬅️ Back', 'grp_close'),
          Markup.button.callback('✅ I\'m done', 'grp_close'),
        ],
      ]),
    });
    if (sentMsg) ChatCleanupService.scheduleBotMessage(ctx.telegram, sentMsg, 5 * 60 * 1000);
  } catch (err) {
    logger.warn('handleViewRulesCallback error', { chatId, error: err.message });
  }
}

// Simple dismiss handler — deletes whichever bot message the button lives on.
// Wired to both "⬅️ Back" and "✅ I'm done" so tapping either clears the
// bot's post from the group chat without leaving stale UI.
async function handleGroupCloseCallback(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  try {
    await ctx.deleteMessage();
  } catch (err) {
    // Fallback: strip the buttons if we can't delete (older than 48h, missing perms).
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}
  }
}

async function _forwardReportToAdmins(ctx, chatId, reportText) {
  const reporter = ctx.from;
  const reporterDisplay = reporter.username ? `@${reporter.username}` : `${reporter.first_name || 'User'} (ID: ${reporter.id})`;
  const groupName = ctx.chat?.title || chatId;

  const adminMsg =
    `🚨 *Issue Report — ${groupName}*\n\n` +
    `👤 From: ${reporterDisplay}\n` +
    `📝 Report:\n${reportText}`;

  let notified = 0;
  try {
    const admins = await ctx.telegram.getChatAdministrators(Number(chatId));
    for (const admin of admins) {
      if (admin.user.is_bot) continue;
      await ctx.telegram.sendMessage(admin.user.id, adminMsg, { parse_mode: 'Markdown' }).catch(() => {});
      notified++;
    }
  } catch (_) {}

  if (notified > 0) {
    await ctx.reply(
      `✅ Your report has been sent to *${notified}* admin${notified !== 1 ? 's' : ''}. They will address it shortly.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  } else {
    await ctx.reply(
      '⚠️ Report received but admins couldn\'t be reached right now. Try messaging an admin directly.'
    ).catch(() => {});
  }

  logger.info('grp_report: forwarded to admins', { chatId, reporterId: reporter.id, notified });
}

// ── Unrestrict helper (called after onboarding completes) ─────────────────────

async function unrestrictUserInGroup(telegram, chatId, userId) {
  try {
    await telegram.restrictChatMember(Number(chatId), Number(userId), {
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: true,
        can_pin_messages: false,
      },
    });
  } catch (err) {
    logger.warn('unrestrictUserInGroup failed (non-fatal)', { chatId, userId, error: err.message });
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

function registerGroupAdminPanelHandlers(bot) {
  // Moderation middleware runs on every group message
  bot.use(moderateMessage);

  // Replace the old plain welcome with the custom-message-aware one
  bot.on('new_chat_members', handleNewChatMemberWithCustomWelcome);

  // Private commands
  bot.command('groupadmin', handleGroupAdmin);
  bot.command('removebanned', handleRemoveBanned);

  // Group commands
  bot.command('rules', handleRulesCommand);
  bot.command('report', handleReportCommand);

  // Callback routing
  bot.action(/^gadmin:/, handleAdminCallback);
  bot.action(/^grp_report:/, handleReportCallback);
  bot.action(/^grp_report_cancel:/, handleReportCancelCallback);
  bot.action(/^grp_rules:/, handleViewRulesCallback);
  bot.action('grp_close', handleGroupCloseCallback);

  // join_group callback (from /groups discovery)
  bot.action(/^join_group:/, handleJoinGroupCallback);

  // Pending text/media input (must be last so other handlers can run first)
  bot.use(handlePendingAction);
}

module.exports = { registerGroupAdminPanelHandlers, moderateMessage, handleNewChatMemberWithCustomWelcome, unrestrictUserInGroup };
