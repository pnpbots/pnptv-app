'use strict';

const logger = require('../../../utils/logger');
const groupManagerService = require('../../../services/groupManagerService');

// Only group admins may run admin-level commands
async function isGroupAdmin(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
  } catch {
    return false;
  }
}

// /stats — migration + points summary (admin only)
async function handleStats(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  if (!(await isGroupAdmin(ctx))) {
    return ctx.reply('Warning: This command is for group admins only.');
  }
  try {
    const chatId = String(ctx.chat.id);
    const [stats, hangout] = await Promise.all([
      groupManagerService.getGroupStats(chatId),
      groupManagerService.getLinkedHangout(chatId),
    ]);
    const top = await groupManagerService.getLeaderboard(chatId, 3);

    let msg = `*Group Stats*\n\n`;
    msg += `PNPtv Hangout: ${hangout ? `*${hangout.name}*` : '_Not linked yet_'}\n`;
    msg += `Members migrated to PNPtv: *${stats.migrationCount}*\n`;
    msg += `Active point earners: *${stats.participants}*\n`;
    msg += `Total points awarded: *${stats.totalPoints}*\n`;

    if (top.length > 0) {
      msg += `\n*Top members:*\n`;
      top.forEach((u, i) => {
        const medal = ['1.', '2.', '3.'][i] || `${i + 1}.`;
        msg += `${medal} ${u.username ? `@${u.username}` : 'Member'} - ${u.total_points} pts\n`;
      });
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('handleStats error', { error: err.message });
    await ctx.reply('Could not load stats. Try again later.');
  }
}

// /progress — migration funnel
async function handleProgress(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  try {
    const chatId = String(ctx.chat.id);
    const count = await groupManagerService.getMigrationCount(chatId);
    const next = [10, 25, 50, 100, 250, 500].find((m) => m > count) || null;
    const fillCount = next
      ? Math.min(10, Math.round((count / next) * 10))
      : count > 0 ? 10 : 0;
    const bar = '▓'.repeat(fillCount) + '░'.repeat(10 - fillCount);

    let msg = `*Migration Progress*\n\n`;
    msg += `${bar} *${count}* member${count !== 1 ? 's' : ''} have joined PNPtv from this group!\n`;
    if (next) {
      msg += `\nNext milestone: *${next} members* - ${next - count} to go!`;
    } else {
      msg += `\nYou've hit all milestones - incredible community!`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('handleProgress error', { error: err.message });
    await ctx.reply('Could not load progress.');
  }
}

// /leaderboard or /pnptop — points leaderboard
async function handleLeaderboard(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  try {
    const chatId = String(ctx.chat.id);
    const rows = await groupManagerService.getLeaderboard(chatId, 10);

    if (rows.length === 0) {
      return ctx.reply('No points yet! Members earn points by joining PNPtv, inviting friends, and engaging.');
    }

    let msg = `*PNPtv Leaderboard*\n\n`;
    rows.forEach((u, i) => {
      const medal = ['1st', '2nd', '3rd'][i] || `${i + 1}.`;
      msg += `${medal} ${u.username ? `@${u.username}` : 'Member'} - *${u.total_points} pts*\n`;
    });
    msg += `\n_Earn points: join PNPtv (+100), invite friends (+50), subscribe (+200)_`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('handleLeaderboard error', { error: err.message });
    await ctx.reply('Could not load leaderboard.');
  }
}

// /announce <text> — sends to Telegram group with PNPtv Hangout context (admin only)
async function handleAnnounce(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  if (!(await isGroupAdmin(ctx))) {
    return ctx.reply('Warning: This command is for group admins only.');
  }

  const text = ctx.message.text.replace(/^\/announce\s*/i, '').trim();
  if (!text) return ctx.reply('Usage: /announce Your message here');

  try {
    const chatId = String(ctx.chat.id);
    const hangout = await groupManagerService.getLinkedHangout(chatId);

    const confirmMsg = hangout
      ? `Announced in this group and *${hangout.name}* on PNPtv!`
      : `Announced! (This group is not yet linked to a PNPtv Hangout)`;

    await ctx.reply(confirmMsg, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('handleAnnounce error', { error: err.message });
    await ctx.reply('Could not send announcement.');
  }
}


// /groups — discover and join connected communities
async function handleGroupsCommand(ctx) {
  try {
    const groups = await groupManagerService.getLinkedGroups();
    if (groups.length === 0) return ctx.reply('No connected communities found yet.');

    if (ctx.chat?.type === 'private') {
      const buttons = groups.map((g) => [{ text: `🏘 ${g.name}`, callback_data: `join_group:${g.telegram_chat_id}` }]);
      await ctx.reply('*Connected communities* — tap one to get your personal invite link:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      let msg = '*Connected communities:*\n\n';
      groups.forEach((g, i) => { msg += `${i + 1}. ${g.name}\n`; });
      msg += '\n_DM me /groups to get your invite links._';
      await ctx.reply(msg, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    logger.error('handleGroupsCommand error', { error: err.message });
    await ctx.reply('Could not load communities. Try again.');
  }
}

// /challenge — view or set the current group challenge
async function handleChallenge(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;

  const text = ctx.message.text.replace(/^\/challenge\s*/i, '').trim();
  const chatId = String(ctx.chat.id);

  // /challenge set <text> — admin only
  if (text.toLowerCase().startsWith('set ')) {
    if (!(await isGroupAdmin(ctx))) {
      return ctx.reply('Warning: Only group admins can set challenges.');
    }
    const description = text.slice(4).trim();
    if (!description) return ctx.reply('Usage: /challenge set <description>');
    if (description.length > 300) return ctx.reply('Challenge description must be under 300 characters.');

    try {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await groupManagerService.setChallenge(chatId, description, String(ctx.from.id), expiresAt);
      await ctx.reply(`*Challenge set!* 🎯\n\n${description}\n\n_Challenge runs for 7 days. Good luck!_`, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error('handleChallenge set error', { error: err.message });
      await ctx.reply('Could not set challenge. Try again.');
    }
    return;
  }

  // /challenge — view current challenge
  try {
    const challenge = await groupManagerService.getActiveChallenge(chatId);
    if (!challenge) {
      return ctx.reply('No active challenge right now.\n\nAdmins can set one with: /challenge set <description>');
    }
    const expires = challenge.expires_at
      ? `\n_Expires: ${new Date(challenge.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}_`
      : '';
    await ctx.reply(`*Current Challenge* 🎯\n\n${challenge.description}${expires}`, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('handleChallenge view error', { error: err.message });
    await ctx.reply('Could not load challenge. Try again.');
  }
}

function registerGroupManagerHandlers(bot) {
  bot.command('stats', handleStats);
  bot.command('progress', handleProgress);
  bot.command('leaderboard', handleLeaderboard);
  bot.command('pnptop', handleLeaderboard);
  bot.command('announce', handleAnnounce);
  bot.command('challenge', handleChallenge);
  bot.command('groups', handleGroupsCommand);
  // new_chat_members is handled by groupAdminPanel (custom welcome message support)
}

module.exports = { registerGroupManagerHandlers };
