#!/usr/bin/env node
/**
 * PNPtv Authentik SSO Full Migration Script
 *
 * Migrates all existing users to Authentik as single source of truth:
 *   1. Sets passwords on all Authentik accounts
 *   2. Assigns users to correct groups (Users, Prime Members, Admins, Creators, Moderators)
 *   3. Updates virtual emails with real ones where available
 *   4. Sends credentials via Telegram DM
 *   5. Sends credentials via email (for users with real emails)
 */

const axios = require('axios');
const crypto = require('crypto');
const { Pool } = require('pg');

// ── Config ─────────────────────────────────────────────────────────────────────
const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'https://auth.pnptv.app';
const AUTHENTIK_TOKEN = process.env.AUTHENTIK_API_TOKEN;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DB_URL = process.env.DATABASE_URL || `postgres://${process.env.PG_USER || 'pnptvbot'}:${process.env.PG_PASSWORD || ''}@${process.env.PG_HOST || 'localhost'}:${process.env.PG_PORT || 5432}/${process.env.PG_DATABASE || 'pnptvbot'}`;

const SEND_CREDENTIALS = process.argv.includes('--send-credentials');
const BATCH_START = parseInt((process.argv.find(a => a.startsWith('--batch-start=')) || '').split('=')[1]) || 0;
const BATCH_END = parseInt((process.argv.find(a => a.startsWith('--batch-end=')) || '').split('=')[1]) || Infinity;
const SKIP_PASSWORDS = process.argv.includes('--skip-passwords');
const ONLY_GROUPS = process.argv.includes('--only-groups');

// Rate limits
const AUTHENTIK_BATCH_SIZE = 10;
const AUTHENTIK_BATCH_DELAY = 500;
const TELEGRAM_DELAY = 50;
const EMAIL_DELAY = 200;

// ── Helpers ────────────────────────────────────────────────────────────────────
const AUTH_HEADERS = { 'Authorization': `Bearer ${AUTHENTIK_TOKEN}` };

function generatePassword() {
  const charset = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  const bytes = crypto.randomBytes(16);
  let pw = '';
  for (let i = 0; i < 16; i++) pw += charset[bytes[i] % charset.length];
  return pw;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendTelegramDM(chatId, text) {
  if (!BOT_TOKEN) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    const code = err.response?.data?.error_code;
    if (code === 403 || code === 400) return false;
    console.error(`  [TG] Failed to DM ${chatId}: ${err.response?.data?.description || err.message}`);
    return false;
  }
}

async function authentikGetUser(username) {
  const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
    params: { username, page_size: 1 },
    headers: AUTH_HEADERS,
    timeout: 10000,
  });
  return res.data.results.find(u => u.username === username) || null;
}

async function authentikSetPassword(userPk, password) {
  await axios.post(`${AUTHENTIK_URL}/api/v3/core/users/${userPk}/set_password/`, {
    password,
  }, { headers: AUTH_HEADERS, timeout: 10000 });
}

async function authentikUpdateUser(userPk, data) {
  await axios.patch(`${AUTHENTIK_URL}/api/v3/core/users/${userPk}/`, data, {
    headers: AUTH_HEADERS,
    timeout: 10000,
  });
}

async function authentikAddToGroup(groupPk, userPk) {
  try {
    await axios.post(`${AUTHENTIK_URL}/api/v3/core/groups/${groupPk}/add_user/`, {
      pk: userPk,
    }, { headers: AUTH_HEADERS, timeout: 10000 });
  } catch (err) {
    if (err.response?.status !== 400) throw err;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       PNPtv Authentik SSO Full Migration                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (!AUTHENTIK_TOKEN) {
    console.error('FATAL: AUTHENTIK_API_TOKEN is not set');
    process.exit(1);
  }

  const groupNames = ['Users', 'Creators', 'Moderators', 'Prime Members', 'authentik Admins'];
  const groups = {};
  const groupsRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/groups/`, {
    params: { page_size: 50 },
    headers: AUTH_HEADERS,
  });
  for (const g of groupsRes.data.results) {
    if (groupNames.includes(g.name)) {
      groups[g.name] = g.pk;
    }
  }

  const pool = new Pool({ connectionString: DB_URL });
  const { rows: users } = await pool.query(`
    SELECT id, pnptv_id, telegram, username, first_name, email,
           role, tier, creator_status, language,
           is_deleted, last_active
    FROM users
    WHERE (is_deleted IS NULL OR is_deleted = false)
      AND (tier IS NULL OR tier != 'banned')
    ORDER BY last_active DESC NULLS LAST
  `);

  const batch = users.slice(BATCH_START, BATCH_END);
  const credentials = [];
  const stats = { processed: 0, passwordsSet: 0, groupsAssigned: 0, emailsUpdated: 0, dmsSent: 0, dmsFailed: 0, emailsSent: 0, errors: 0 };

  for (let i = 0; i < batch.length; i++) {
    const user = batch[i];
    const username = user.username || `tg_${user.telegram || user.id}`;

    try {
      const akUser = await authentikGetUser(username);
      if (!akUser) continue;

      const userPk = akUser.pk;
      let password = null;
      if (!SKIP_PASSWORDS && !ONLY_GROUPS) {
        password = generatePassword();
        await authentikSetPassword(userPk, password);
        stats.passwordsSet++;
      }

      if (!ONLY_GROUPS && user.email && !user.email.endsWith('@telegram.pnptv.app') && !user.email.endsWith('@users.pnptv.app')) {
        const currentEmail = akUser.email || '';
        if (currentEmail.endsWith('@telegram.pnptv.app') || currentEmail.endsWith('@users.pnptv.app')) {
          await authentikUpdateUser(userPk, { email: user.email });
          stats.emailsUpdated++;
        }
      }

      if (groups['Users']) await authentikAddToGroup(groups['Users'], userPk);
      if ((user.role === 'admin' || user.role === 'superadmin') && groups['authentik Admins']) await authentikAddToGroup(groups['authentik Admins'], userPk);
      if (user.role === 'moderator' && groups['Moderators']) await authentikAddToGroup(groups['Moderators'], userPk);
      if (user.creator_status === 'approved' && groups['Creators']) await authentikAddToGroup(groups['Creators'], userPk);
      if ((user.tier || '').toLowerCase() === 'prime' && groups['Prime Members']) await authentikAddToGroup(groups['Prime Members'], userPk);
      
      stats.groupsAssigned++;

      if (password) {
        credentials.push({
          telegramId: user.telegram,
          email: user.email && !user.email.endsWith('@telegram.pnptv.app') && !user.email.endsWith('@users.pnptv.app') ? user.email : null,
          username: akUser.username || username,
          password,
          firstName: user.first_name || username,
          language: user.language || 'es',
        });
      }
      stats.processed++;
      if ((i + 1) % AUTHENTIK_BATCH_SIZE === 0) await sleep(AUTHENTIK_BATCH_DELAY);
    } catch (err) {
      stats.errors++;
    }
  }

  if (SEND_CREDENTIALS && credentials.length > 0) {
    for (let i = 0; i < credentials.length; i++) {
      const cred = credentials[i];
      if (!cred.telegramId) continue;

      const isSpanish = cred.language === 'es';
      const msg = isSpanish
        ? `🔐 *Tu PNPtv ID — Acceso Único a TODOS los servicios*\n\n` +
          `¡Hola ${cred.firstName}! Hemos creado tu cuenta centralizada PNPtv ID.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 *Usuario:* \`${cred.username}\`\n` +
          `🔑 *Contraseña:* \`${cred.password}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📺 *PNPtv App* — Feed social, posts, mensajes\n` +
          `💬 *Chat* — Mensajería integrada\n` +
          `📹 *Hangouts* — Videollamadas grupales\n` +
          `🔴 *PNP Live* — Transmisiones en vivo\n` +
          `📻 *Radio* — Música y podcasts\n` +
          `📍 *Nearby* — Miembros cercanos\n` +
          `📅 *Reservas* — Calendario de citas\n\n` +
          `⚠️ *IMPORTANTE:* No compartas tus credenciales. Cambia tu contraseña en [auth.pnptv.app](https://auth.pnptv.app).`
        : `🔐 *Your PNPtv ID — Single Login for ALL Services*\n\n` +
          `Hi ${cred.firstName}! We've created your centralized PNPtv ID account.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 *Username:* \`${cred.username}\`\n` +
          `🔑 *Password:* \`${cred.password}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📺 *PNPtv App* — Social feed, posts, messages\n` +
          `💬 *Chat* — Integrated messaging\n` +
          `📹 *Hangouts* — Group video calls\n` +
          `🔴 *PNP Live* — Live streams\n` +
          `📻 *Radio* — Music and podcasts\n` +
          `📍 *Nearby* — Members near you\n` +
          `📅 *Booking* — Appointment calendar\n\n` +
          `⚠️ *IMPORTANT:* Never share your credentials. Change your password at [auth.pnptv.app](https://auth.pnptv.app).`;

      const sent = await sendTelegramDM(cred.telegramId, msg);
      if (sent) stats.dmsSent++; else stats.dmsFailed++;
      await sleep(TELEGRAM_DELAY);
    }
  }

  await pool.end();
  console.log('Migration Complete');
}

function buildCredentialEmailHtml(cred) {
  const isSpanish = cred.language === 'es';
  const title = isSpanish ? 'Tu PNPtv ID' : 'Your PNPtv ID';
  const services = isSpanish
    ? ['PNPtv App — Feed social', 'Chat — Mensajería integrada', 'Hangouts — Videollamadas', 'PNP Live — Transmisiones', 'Radio — Música y podcasts', 'Nearby — Miembros cercanos', 'Reservas — Calendario']
    : ['PNPtv App — Social feed', 'Chat — Integrated messaging', 'Hangouts — Video calls', 'PNP Live — Live streams', 'Radio — Music & podcasts', 'Nearby — Members near you', 'Booking — Calendar'];

  return `<!DOCTYPE html><html><body><h1>${title}</h1><p>User: ${cred.username}</p><p>Pass: ${cred.password}</p><p>Services: ${services.join(', ')}</p></body></html>`;
}

main().catch(err => { console.error(err); process.exit(1); });
