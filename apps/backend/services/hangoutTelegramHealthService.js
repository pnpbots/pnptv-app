'use strict';

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TELEGRAM_API_BASE = 'https://api.telegram.org';

async function telegramGetChat(botToken, chatId) {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/getChat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  return { status: res.status, data };
}

class HangoutTelegramHealthService {
  static async getSnapshot() {
    const checkedAt = new Date().toISOString();
    const botToken = process.env.BOT_TOKEN || '';

    const summary = {
      totalLinked: 0,
      ok: 0,
      stale: 0,
      missingInviteLink: 0,
      telegramConfigured: !!botToken,
    };

    if (!botToken) {
      return { success: true, checkedAt, summary, items: [] };
    }

    let rows = [];
    try {
      const result = await query(`
        SELECT id, name, telegram_chat_id, telegram_invite_link
        FROM hangout_groups
        WHERE telegram_chat_id IS NOT NULL
        ORDER BY id ASC
      `);
      rows = result.rows || [];
    } catch (err) {
      logger.warn(`hangoutTelegramHealth: pg query failed: ${err.message}`);
      return {
        success: false,
        checkedAt,
        summary,
        items: [],
        error: 'database_unreachable',
      };
    }

    const items = [];
    for (const row of rows) {
      const item = {
        groupId: row.id,
        groupName: row.name || `Hangout ${row.id}`,
        telegramChatId: row.telegram_chat_id,
        telegramInviteLink: row.telegram_invite_link || null,
        status: 'unknown',
        chatType: null,
        telegramTitle: null,
        error: null,
      };

      summary.totalLinked += 1;
      if (!item.telegramInviteLink) summary.missingInviteLink += 1;

      try {
        const { status, data } = await telegramGetChat(botToken, row.telegram_chat_id);
        if (status >= 200 && status < 300 && data?.ok && data?.result) {
          item.status = 'ok';
          item.chatType = data.result.type || null;
          item.telegramTitle = data.result.title || data.result.username || null;
          summary.ok += 1;
        } else {
          const description = data?.description || `telegram_http_${status}`;
          item.status = description === 'Bad Request: chat not found' ? 'stale' : 'error';
          item.error = description;
          if (item.status === 'stale') summary.stale += 1;
        }
      } catch (err) {
        item.status = 'error';
        item.error = err.message;
      }

      items.push(item);
    }

    return {
      success: true,
      checkedAt,
      summary,
      items,
    };
  }
}

module.exports = HangoutTelegramHealthService;
