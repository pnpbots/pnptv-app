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
 *
 * Usage:
 *   node scripts/migrate-authentik-sso.js                    # dry-run (no DMs/emails)
 *   node scripts/migrate-authentik-sso.js --send-credentials # actually send DMs + emails
 *   node scripts/migrate-authentik-sso.js --batch-start=0 --batch-end=500  # process subset
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
const AUTHENTIK_BATCH_SIZE = 10;       // concurrent Authentik API calls
const AUTHENTIK_BATCH_DELAY = 500;     // ms between batches
const TELEGRAM_DELAY = 50;            // ms between Telegram DMs (20/sec safe limit)
const EMAIL_DELAY = 200;              // ms between emails

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
    // 403 = bot was blocked by user, 400 = chat not found — skip silently
    if (code === 403 || code === 400) return false;
    console.error(`  [TG] Failed to DM ${chatId}: ${err.response?.data?.description || err.message}`);
    return false;
  }
}

// ── Authentik API helpers ──────────────────────────────────────────────────────
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
    // 400 = already in group
    if (err.response?.status !== 400) throw err;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       PNPtv Authentik SSO Full Migration                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Mode: ${SEND_CREDENTIALS ? '🔴 LIVE (sending credentials)' : '🟡 DRY-RUN (no DMs/emails)'}`);
  console.log(`  Authentik: ${AUTHENTIK_URL}`);
  console.log(`  Batch: ${BATCH_START} → ${BATCH_END === Infinity ? 'END' : BATCH_END}`);
  console.log(`  Skip passwords: ${SKIP_PASSWORDS}`);
  console.log(`  Only groups: ${ONLY_GROUPS}`);
  console.log('');

  if (!AUTHENTIK_TOKEN) {
    console.error('FATAL: AUTHENTIK_API_TOKEN is not set');
    process.exit(1);
  }

  // ── 1. Resolve group PKs ──────────────────────────────────────────────────
  console.log('[1/5] Resolving Authentik groups...');
  const groupNames = ['Users', 'Creators', 'Moderators', 'Prime Members', 'authentik Admins'];
  const groups = {};
  const groupsRes = await axios.get(`${AUTHENTIK_URL}/api/v3/core/groups/`, {
    params: { page_size: 50 },
    headers: AUTH_HEADERS,
  });
  for (const g of groupsRes.data.results) {
    if (groupNames.includes(g.name)) {
      groups[g.name] = g.pk;
      console.log(`  ✓ ${g.name}: ${g.pk}`);
    }
  }

  // ── 2. Fetch all PNPtv users ──────────────────────────────────────────────
  console.log('\n[2/5] Fetching PNPtv users from database...');
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
  console.log(`  Total active users: ${users.length}`);

  // Apply batch limits
  const batch = users.slice(BATCH_START, BATCH_END);
  console.log(`  Processing batch: ${BATCH_START} → ${Math.min(BATCH_END, users.length)} (${batch.length} users)`);

  // ── 3. Process each user ──────────────────────────────────────────────────
  console.log('\n[3/5] Processing users...');
  const stats = {
    processed: 0,
    passwordsSet: 0,
    groupsAssigned: 0,
    emailsUpdated: 0,
    dmsSent: 0,
    dmsFailed: 0,
    emailsSent: 0,
    notInAuthentik: 0,
    errors: 0,
  };

  // Store credentials for later DM/email sending
  const credentials = [];

  for (let i = 0; i < batch.length; i++) {
    const user = batch[i];
    const username = user.username || `tg_${user.telegram || user.id}`;

    try {
      // Find user in Authentik
      const akUser = await authentikGetUser(username);
      if (!akUser) {
        // Try by telegram ID format
        const altUsername = user.telegram ? `tg_${user.telegram}` : null;
        const akUserAlt = altUsername ? await authentikGetUser(altUsername) : null;
        if (!akUserAlt) {
          stats.notInAuthentik++;
          if (i % 100 === 0) console.log(`  [${i}/${batch.length}] ${username} — not in Authentik (skipped)`);
          continue;
        }
        // Use the alt username
        Object.assign(akUser || {}, akUserAlt);
      }

      const userPk = (akUser || {}).pk;
      if (!userPk) { stats.notInAuthentik++; continue; }

      // ── Set password ────────────────────────────────────────────────────
      let password = null;
      if (!SKIP_PASSWORDS && !ONLY_GROUPS) {
        password = generatePassword();
        await authentikSetPassword(userPk, password);
        stats.passwordsSet++;
      }

      // ── Update real email ───────────────────────────────────────────────
      if (!ONLY_GROUPS && user.email && !user.email.endsWith('@telegram.pnptv.app') && !user.email.endsWith('@users.pnptv.app')) {
        const currentEmail = (akUser || {}).email || '';
        if (currentEmail.endsWith('@telegram.pnptv.app') || currentEmail.endsWith('@users.pnptv.app')) {
          await authentikUpdateUser(userPk, { email: user.email });
          stats.emailsUpdated++;
        }
      }

      // ── Assign groups ───────────────────────────────────────────────────
      // Everyone goes to Users group
      if (groups['Users']) {
        await authentikAddToGroup(groups['Users'], userPk);
      }

      const role = user.role || 'user';
      const tier = (user.tier || '').toLowerCase();

      if ((role === 'admin' || role === 'superadmin') && groups['authentik Admins']) {
        await authentikAddToGroup(groups['authentik Admins'], userPk);
      }
      if (role === 'moderator' && groups['Moderators']) {
        await authentikAddToGroup(groups['Moderators'], userPk);
      }
      if (user.creator_status === 'approved' && groups['Creators']) {
        await authentikAddToGroup(groups['Creators'], userPk);
      }
      if (tier === 'prime' && groups['Prime Members']) {
        await authentikAddToGroup(groups['Prime Members'], userPk);
      }
      stats.groupsAssigned++;

      // Store credentials for later sending
      if (password) {
        credentials.push({
          telegramId: user.telegram,
          email: user.email && !user.email.endsWith('@telegram.pnptv.app') && !user.email.endsWith('@users.pnptv.app') ? user.email : null,
          username: (akUser || {}).username || username,
          password,
          firstName: user.first_name || username,
          language: user.language || 'es',
        });
      }

      stats.processed++;

      // Progress logging
      if ((i + 1) % 50 === 0 || i === batch.length - 1) {
        console.log(`  [${i + 1}/${batch.length}] Processed: ${stats.processed} | Passwords: ${stats.passwordsSet} | Groups: ${stats.groupsAssigned} | Emails updated: ${stats.emailsUpdated}`);
      }

      // Rate limit Authentik API
      if ((i + 1) % AUTHENTIK_BATCH_SIZE === 0) {
        await sleep(AUTHENTIK_BATCH_DELAY);
      }

    } catch (err) {
      stats.errors++;
      console.error(`  [${i}] ERROR for ${username}: ${err.response?.data?.detail || err.message}`);
      // Don't abort — continue with next user
    }
  }

  // ── 4. Send credentials via Telegram DM ───────────────────────────────────
  if (SEND_CREDENTIALS && credentials.length > 0) {
    console.log(`\n[4/5] Sending credentials via Telegram DM (${credentials.filter(c => c.telegramId).length} users)...`);

    for (let i = 0; i < credentials.length; i++) {
      const cred = credentials[i];
      if (!cred.telegramId) continue;

      const isSpanish = cred.language === 'es';
      const msg = isSpanish
        ? `🔐 *Tu PNPtv ID — Acceso Único a TODOS los servicios*\n\n` +
          `¡Hola ${cred.firstName}! Hemos creado tu cuenta centralizada PNPtv ID. Con UN SOLO login accedes a toda la plataforma.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 *Usuario:* \`${cred.username}\`\n` +
          `🔑 *Contraseña:* \`${cred.password}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📋 *CÓMO CONFIGURAR TU CUENTA:*\n\n` +
          `*Paso 1 — Inicia sesión en PNPtv:*\n` +
          `Abre [pnptv.app](https://pnptv.app) en tu navegador. Toca "Iniciar sesión con PNPtv ID" e ingresa tu usuario y contraseña.\n\n` +
          `*Paso 2 — Cambia tu contraseña:*\n` +
          `Ve a [auth.pnptv.app](https://auth.pnptv.app), inicia sesión, y en tu perfil cambia la contraseña por una que recuerdes.\n\n` +
          `*Paso 3 — Accede a todos los servicios:*\n` +
          `Una vez logueado, TODO funciona automáticamente:\n` +
          `📺 *PNPtv App* — Feed social, posts, mensajes\n` +
          `💬 *Chat* — Mensajería Matrix integrada\n` +
          `📹 *Hangouts* — Videollamadas grupales\n` +
          `🔴 *PNP Live* — Transmisiones en vivo\n` +
          `📻 *Radio* — Música y podcasts\n` +
          `📍 *Nearby* — Miembros cercanos\n` +
          `📅 *Reservas* — Calendario de citas\n` +
          `🎬 *Videorama* — Videos exclusivos\n\n` +
          `⚠️ *IMPORTANTE:* No compartas tus credenciales. Si tienes problemas, usa "¿Olvidaste tu contraseña?" en la pantalla de login.`
        : `🔐 *Your PNPtv ID — Single Login for ALL Services*\n\n` +
          `Hi ${cred.firstName}! We've created your centralized PNPtv ID account. ONE login gives you access to the entire platform.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 *Username:* \`${cred.username}\`\n` +
          `🔑 *Password:* \`${cred.password}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📋 *HOW TO SET UP YOUR ACCOUNT:*\n\n` +
          `*Step 1 — Log in to PNPtv:*\n` +
          `Open [pnptv.app](https://pnptv.app) in your browser. Tap "Sign in with PNPtv ID" and enter your username and password.\n\n` +
          `*Step 2 — Change your password:*\n` +
          `Go to [auth.pnptv.app](https://auth.pnptv.app), log in, and change your password to one you'll remember.\n\n` +
          `*Step 3 — Access all services:*\n` +
          `Once logged in, EVERYTHING works automatically:\n` +
          `📺 *PNPtv App* — Social feed, posts, messages\n` +
          `💬 *Chat* — Integrated Matrix messaging\n` +
          `📹 *Hangouts* — Group video calls\n` +
          `🔴 *PNP Live* — Live streams\n` +
          `📻 *Radio* — Music and podcasts\n` +
          `📍 *Nearby* — Members near you\n` +
          `📅 *Booking* — Appointment calendar\n` +
          `🎬 *Videorama* — Exclusive videos\n\n` +
          `⚠️ *IMPORTANT:* Never share your credentials. If you have trouble, use "Forgot password?" on the login screen.`;

      const sent = await sendTelegramDM(cred.telegramId, msg);
      if (sent) {
        stats.dmsSent++;
      } else {
        stats.dmsFailed++;
      }

      if ((i + 1) % 100 === 0) {
        console.log(`  [${i + 1}/${credentials.length}] DMs sent: ${stats.dmsSent} | Failed: ${stats.dmsFailed}`);
      }

      await sleep(TELEGRAM_DELAY);
    }
  } else {
    console.log(`\n[4/5] Skipping Telegram DMs (dry-run or no credentials generated)`);
  }

  // ── 5. Send credentials via email ─────────────────────────────────────────
  if (SEND_CREDENTIALS && credentials.filter(c => c.email).length > 0) {
    console.log(`\n[5/5] Sending credentials via email (${credentials.filter(c => c.email).length} users)...`);

    // We'll use nodemailer directly here since we're outside the app context
    let transporter = null;
    try {
      const nodemailer = require('nodemailer');
      const smtpHost = process.env.PNPTV_SMTP_HOST;
      const smtpUser = process.env.PNPTV_SMTP_USER;
      const smtpPass = process.env.PNPTV_SMTP_PASS;
      if (smtpHost && smtpUser && smtpPass) {
        transporter = nodemailer.createTransport({
          host: smtpHost,
          port: parseInt(process.env.PNPTV_SMTP_PORT || '587'),
          secure: process.env.PNPTV_SMTP_SECURE === 'true',
          auth: { user: smtpUser, pass: smtpPass },
        });
        console.log(`  SMTP configured: ${smtpHost}`);
      }
    } catch {
      console.log('  SMTP not available (nodemailer not found or config missing)');
    }

    if (transporter) {
      for (let i = 0; i < credentials.length; i++) {
        const cred = credentials[i];
        if (!cred.email) continue;

        try {
          const isSpanish = cred.language === 'es';
          await transporter.sendMail({
            from: '"PNPtv" <noreply@pnptv.app>',
            to: cred.email,
            subject: isSpanish ? 'Tus nuevas credenciales de acceso a PNPtv' : 'Your new PNPtv access credentials',
            html: buildCredentialEmailHtml(cred),
          });
          stats.emailsSent++;
        } catch (err) {
          console.error(`  [Email] Failed for ${cred.email}: ${err.message}`);
        }

        if ((i + 1) % 50 === 0) {
          console.log(`  [${i + 1}] Emails sent: ${stats.emailsSent}`);
        }

        await sleep(EMAIL_DELAY);
      }
    }
  } else {
    console.log(`\n[5/5] Skipping emails (dry-run or no email users)`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    MIGRATION COMPLETE                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Processed:        ${stats.processed}`);
  console.log(`  Passwords set:    ${stats.passwordsSet}`);
  console.log(`  Groups assigned:  ${stats.groupsAssigned}`);
  console.log(`  Emails updated:   ${stats.emailsUpdated}`);
  console.log(`  DMs sent:         ${stats.dmsSent}`);
  console.log(`  DMs failed:       ${stats.dmsFailed}`);
  console.log(`  Emails sent:      ${stats.emailsSent}`);
  console.log(`  Not in Authentik: ${stats.notInAuthentik}`);
  console.log(`  Errors:           ${stats.errors}`);

  await pool.end();
  process.exit(0);
}

function buildCredentialEmailHtml(cred) {
  const isSpanish = cred.language === 'es';
  const title = isSpanish ? 'Tu PNPtv ID — Acceso a Todos los Servicios' : 'Your PNPtv ID — Access to All Services';
  const greeting = isSpanish ? `Hola <strong>${cred.firstName}</strong>,` : `Hello <strong>${cred.firstName}</strong>,`;
  const intro = isSpanish
    ? 'Hemos creado tu cuenta centralizada <strong>PNPtv ID</strong>. Con UN SOLO login accedes a toda la plataforma:'
    : 'We\'ve created your centralized <strong>PNPtv ID</strong> account. ONE login gives you access to the entire platform:';

  const step1 = isSpanish
    ? '<strong>Paso 1 — Inicia sesión:</strong> Abre <a href="https://pnptv.app" style="color:#667eea">pnptv.app</a> y toca "Iniciar sesión con PNPtv ID". Ingresa tu usuario y contraseña.'
    : '<strong>Step 1 — Log in:</strong> Open <a href="https://pnptv.app" style="color:#667eea">pnptv.app</a> and tap "Sign in with PNPtv ID". Enter your username and password.';
  const step2 = isSpanish
    ? '<strong>Paso 2 — Cambia tu contraseña:</strong> Ve a <a href="https://auth.pnptv.app" style="color:#667eea">auth.pnptv.app</a>, inicia sesión, y cambia tu contraseña por una que recuerdes.'
    : '<strong>Step 2 — Change your password:</strong> Go to <a href="https://auth.pnptv.app" style="color:#667eea">auth.pnptv.app</a>, log in, and change your password to one you\'ll remember.';
  const step3 = isSpanish
    ? '<strong>Paso 3 — Todo listo:</strong> Una vez logueado, todos los servicios funcionan automáticamente con tu PNPtv ID.'
    : '<strong>Step 3 — All set:</strong> Once logged in, all services work automatically with your PNPtv ID.';

  const services = isSpanish
    ? ['PNPtv App — Feed social', 'Chat — Mensajería Matrix', 'Hangouts — Videollamadas', 'PNP Live — Transmisiones', 'Radio — Música y podcasts', 'Nearby — Miembros cercanos', 'Reservas — Calendario', 'Videorama — Videos exclusivos']
    : ['PNPtv App — Social feed', 'Chat — Matrix messaging', 'Hangouts — Video calls', 'PNP Live — Live streams', 'Radio — Music & podcasts', 'Nearby — Members near you', 'Booking — Calendar', 'Videorama — Exclusive videos'];

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f4f4f4;margin:0;padding:0}.container{max-width:600px;margin:20px auto;background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.header{text-align:center;padding-bottom:20px;border-bottom:3px solid #667eea}.credentials-box{background:#1a1a2e;color:#fff;padding:25px;border-radius:8px;margin:25px 0;font-family:monospace}.label{color:#aaa;font-size:12px;text-transform:uppercase;margin-bottom:4px}.value{font-size:18px;font-weight:700;color:#D4007A;margin-bottom:15px;letter-spacing:1px}.button{display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:16px}.footer{text-align:center;padding-top:20px;border-top:1px solid #ddd;color:#888;font-size:12px}.step{background:#f8f9fa;padding:12px 16px;border-radius:6px;margin:8px 0;border-left:3px solid #667eea;font-size:14px}.service{display:inline-block;background:#f0f0ff;color:#667eea;padding:4px 12px;border-radius:16px;font-size:12px;margin:3px}</style></head>
<body><div class="container"><div class="header"><h1 style="color:#667eea;margin:0;font-size:28px">PNPtv</h1><p style="color:#666;margin:8px 0 0">${title}</p></div>
<div style="padding:20px 0"><p>${greeting}</p><p>${intro}</p>
<div class="credentials-box"><div class="label">${isSpanish ? 'Usuario' : 'Username'}</div><div class="value">${cred.username}</div><div class="label">${isSpanish ? 'Contraseña' : 'Password'}</div><div class="value">${cred.password}</div></div>
<h3 style="color:#667eea;margin:25px 0 15px">${isSpanish ? 'Cómo configurar tu cuenta:' : 'How to set up your account:'}</h3>
<div class="step">${step1}</div><div class="step">${step2}</div><div class="step">${step3}</div>
<h3 style="color:#667eea;margin:25px 0 15px">${isSpanish ? 'Servicios incluidos:' : 'Services included:'}</h3>
<div style="margin:10px 0">${services.map(s => `<span class="service">${s}</span>`).join('')}</div>
<div style="text-align:center;margin:30px 0"><a href="https://pnptv.app" class="button">${isSpanish ? 'Iniciar Sesión en PNPtv' : 'Log In to PNPtv'}</a></div>
<p style="background:#fff3e0;padding:15px;border-radius:5px;border-left:4px solid #FFB454;font-size:13px">${isSpanish ? 'No compartas tus credenciales. Si tienes problemas, usa "¿Olvidaste tu contraseña?" en' : 'Never share your credentials. If you have trouble, use "Forgot password?" at'} <a href="https://auth.pnptv.app" style="color:#667eea">auth.pnptv.app</a></p></div>
<div class="footer"><p>PNPtv | noreply@pnptv.app</p></div></div></body></html>`;
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
