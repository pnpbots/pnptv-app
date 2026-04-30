#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * One-shot: DM every known PRIME/lifetime user that the channel has migrated
 * to the webapp, then kick them from the PRIME Telegram channel.
 *
 * Excludes: SantinoFurioso, PNPtvOficial, the bot, PNPTVADMIN.
 * Rate-limited to one operation every 300ms to stay well under Telegram's
 * global limits (~30/s).
 */

const { Pool } = require('pg');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PRIME_CHANNEL_ID = process.env.PRIME_CHANNEL_ID || '-1003546644678';
const RATE_LIMIT_MS = 300;
const EXCLUDED_TELEGRAM_IDS = new Set([
  '8599671840', // SantinoFurioso
  '8370209084', // PNPtvOficial (creator)
  '8571930103', // bot itself
  '8552451957', // PNPTVADMIN
]);

const DM_TEXT = [
  '📱 *¡PNPtv ahora vive en la app!*',
  '',
  'El canal PRIME de Telegram ha sido migrado completamente a nuestra nueva web app. Tu acceso, contenido exclusivo y comunidad están ahora en:',
  '',
  '👉 https://pnptv.app',
  '',
  'Inicia sesión con tu cuenta de siempre. Si tenías PRIME, tu acceso ya está activo.',
  '',
  '———',
  '',
  '📱 *PNPtv now lives in the app!*',
  '',
  'The Telegram PRIME channel has fully migrated to our new web app. Your access, exclusive content, and community are now at:',
  '',
  '👉 https://pnptv.app',
  '',
  'Log in with the same account. If you had PRIME, your access is already active there.',
].join('\n');

if (!BOT_TOKEN) {
  console.error('FATAL: BOT_TOKEN env var is required');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DATABASE || 'pnptvbot',
    user: process.env.POSTGRES_USER || 'pnptvbot',
    password: process.env.POSTGRES_PASSWORD || '',
  });

  const { rows } = await pool.query(`
    SELECT DISTINCT u.id, u.telegram, u.username, u.first_name, u.tier
    FROM users u
    LEFT JOIN user_entitlements ue ON ue.user_id = u.id
    WHERE u.telegram IS NOT NULL
      AND u.telegram != ''
      AND (
        u.tier = 'PRIME'
        OR ue.is_lifetime = true
        OR u.plan_id ILIKE '%lifetime%'
        OR u.plan_id ILIKE '%prime%'
      )
    ORDER BY u.telegram
  `);

  const targets = rows.filter((r) => !EXCLUDED_TELEGRAM_IDS.has(String(r.telegram)));
  console.log(`Total candidates: ${rows.length}, after exclusions: ${targets.length}`);
  console.log(`Channel: ${PRIME_CHANNEL_ID}, rate: ${RATE_LIMIT_MS}ms/op\n`);

  const stats = {
    dm_ok: 0, dm_blocked: 0, dm_other_err: 0,
    kick_ok: 0, kick_not_member: 0, kick_other_err: 0,
  };

  const errors = [];

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const tgId = u.telegram;
    const label = `${u.username || u.first_name || ''} (${tgId})`;

    // 1. DM
    const dmRes = await tg('sendMessage', {
      chat_id: tgId,
      text: DM_TEXT,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });
    if (dmRes.ok) {
      stats.dm_ok++;
    } else if (
      dmRes.description?.includes('blocked') ||
      dmRes.description?.includes('deactivated') ||
      dmRes.description?.includes("can't initiate") ||
      dmRes.description?.includes("Forbidden")
    ) {
      stats.dm_blocked++;
    } else {
      stats.dm_other_err++;
      errors.push({ phase: 'dm', user: label, err: dmRes.description });
    }

    await sleep(RATE_LIMIT_MS);

    // 2. Kick = ban + unban
    const banRes = await tg('banChatMember', {
      chat_id: PRIME_CHANNEL_ID,
      user_id: Number(tgId),
      revoke_messages: false,
    });
    if (banRes.ok) {
      // Immediately unban so they can rejoin via invite if needed later
      await tg('unbanChatMember', {
        chat_id: PRIME_CHANNEL_ID,
        user_id: Number(tgId),
        only_if_banned: true,
      });
      stats.kick_ok++;
    } else if (
      banRes.description?.includes('PARTICIPANT_ID_INVALID') ||
      banRes.description?.includes('USER_NOT_PARTICIPANT') ||
      banRes.description?.includes('user not found')
    ) {
      stats.kick_not_member++;
    } else {
      stats.kick_other_err++;
      errors.push({ phase: 'kick', user: label, err: banRes.description });
    }

    if ((i + 1) % 20 === 0 || i === targets.length - 1) {
      console.log(`[${i + 1}/${targets.length}] ${label} dm:${stats.dm_ok}/${stats.dm_blocked}/${stats.dm_other_err} kick:${stats.kick_ok}/${stats.kick_not_member}/${stats.kick_other_err}`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log('\n═══ FINAL SUMMARY ═══');
  console.log(`Targets processed: ${targets.length}`);
  console.log(`DM sent OK: ${stats.dm_ok}`);
  console.log(`DM blocked/forbidden: ${stats.dm_blocked}`);
  console.log(`DM other errors: ${stats.dm_other_err}`);
  console.log(`Kicked successfully: ${stats.kick_ok}`);
  console.log(`Not a channel member: ${stats.kick_not_member}`);
  console.log(`Kick other errors: ${stats.kick_other_err}`);

  if (errors.length > 0) {
    console.log(`\n═══ ${errors.length} ERRORS (first 20) ═══`);
    errors.slice(0, 20).forEach((e) => {
      console.log(`  [${e.phase}] ${e.user}: ${e.err}`);
    });
  }

  // Final channel headcount
  const countRes = await tg('getChatMemberCount', { chat_id: PRIME_CHANNEL_ID });
  console.log(`\nChannel member count after: ${countRes.result || 'unknown'}`);

  await pool.end();
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
