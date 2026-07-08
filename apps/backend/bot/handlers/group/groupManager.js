'use strict';

const logger = require('../../../utils/logger');
const groupManagerService = require('../../../../services/groupManagerService');

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

// Welcome new members with PNPtv CTA
async function handleNewChatMembers(ctx) {
  if (!['group', 'supergroup'].includes(ctx.chat?.type)) return;
  try {
    const newMembers = ctx.message?.new_chat_members || [];
    const realMembers = newMembers.filter((m) => !m.is_bot);
    if (realMembers.length === 0) return;

    const botInfo = await ctx.telegram.getMe().catch(() => null);
    const botUsername = botInfo?.username || 'PNPManagerBot';

    const chatId = String(ctx.chat.id);
    const names = realMembers.map((m) => m.first_name || 'there').join(', ');
    const deepLink = `https://t.me/${botUsername}?start=grp_${chatId}`;

    const msg = `Welcome, *${names}*!\n\nThis group is connected to PNPtv - the queer PNP community platform.\n\nJoin PNPtv to unlock the full experience: live streams, hangouts, exclusive content, and earn community points!`;

    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Join PNPtv - Get Started', url: deepLink }]],
      },
    });
  } catch (err) {
    logger.error('handleNewChatMembers error', { error: err.message });
  }
}

function registerGroupManagerHandlers(bot) {
  bot.command('stats', handleStats);
  bot.command('progress', handleProgress);
  bot.command('leaderboard', handleLeaderboard);
  bot.command('pnptop', handleLeaderboard);
  bot.command('announce', handleAnnounce);
  bot.on('new_chat_members', handleNewChatMembers);
}

module.exports = { registerGroupManagerHandlers };
