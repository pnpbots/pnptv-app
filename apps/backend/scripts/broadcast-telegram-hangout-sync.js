#!/usr/bin/env node
'use strict';

/**
 * broadcast-telegram-hangout-sync.js
 *
 * Community message explaining how to sync a Telegram group to a PNPtv! Hangout,
 * why it matters (Telegram privacy / group shutdowns), and how PNPtv is a safer home.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-telegram-hangout-sync.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-telegram-hangout-sync.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-telegram-hangout-sync.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-telegram-hangout-sync.js --skip-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }               = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const nodemailer              = require('nodemailer');
const { Telegram }            = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const FORCE         = process.argv.includes('--force');

const ENTITY_ID   = 'telegram-to-hangout-2026-06';
const HANGOUT_URL = 'https://pnptv.app/chat';
const TG_DELAY_MS = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── In-app bell (short) ──────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🔗 Move your Telegram group to PNPtv! — sync it to a Hangout in 3 steps. Telegram can shut down groups without warning. Your PNPtv Hangout can't. pnptv.app/chat →`,
  es: `🔗 Mueve tu grupo de Telegram a PNPtv! — sincronízalo con un Hangout en 3 pasos. Telegram puede cerrar grupos sin aviso. Tu Hangout en PNPtv no. pnptv.app/chat →`,
};

// ── Web push ─────────────────────────────────────────────────────────────────

const PUSH = {
  en: { title: 'Your Telegram group belongs on PNPtv!', body: 'Sync it to a Hangout in 3 steps — messages bridge both ways. Safe space, no shutdowns.' },
  es: { title: 'Tu grupo de Telegram tiene un hogar en PNPtv!', body: 'Sincronízalo con un Hangout en 3 pasos — los mensajes van y vienen. Espacio seguro, sin cierres.' },
};

// ── Telegram message (HTML) ───────────────────────────────────────────────────

const TG = {
  en: `📱 <b>Move your Telegram group to PNPtv!</b>

Telegram's privacy policy (§4.3) explicitly allows them to monitor group content. They have closed LGBTQ+ and PNP-related groups at scale — no appeal, no warning, community gone overnight.

<b>PNPtv! is your safe space.</b> We're built for this community. We don't share your data, we don't censor consensual adult content, and we don't shut down your group.

The best part: you don't have to choose. <b>Sync your Telegram group to a PNPtv Hangout</b> — messages flow both ways in real time.

<b>How to sync in 3 steps:</b>

1️⃣ Open <a href="https://pnptv.app/chat">pnptv.app/chat</a>, create a Hangout (or open one you own). Note the ID in the URL — e.g. <code>pnptv.app/chat/42</code> → ID is <b>42</b>.

2️⃣ Add <b>@PNPLatinoTV_bot</b> to your Telegram group and make it an <b>admin</b>.

3️⃣ Inside the Telegram group, type:
<code>/link 42</code>  (replace 42 with your real Hangout ID)

That's it. ✅ Messages from the app go to Telegram. Messages from Telegram appear in the app. Edits and media sync too.

<b>Why it matters:</b>
✓ Your Hangout on PNPtv never gets shut down
✓ Members can chat from the app without a Telegram account
✓ No surveillance from a mainstream company
✓ You own your community space

👉 <a href="https://pnptv.app/chat">pnptv.app/chat</a> — open your Hangouts now`,

  es: `📱 <b>Mueve tu grupo de Telegram a PNPtv!</b>

La política de privacidad de Telegram (§4.3) les permite explícitamente monitorear el contenido de los grupos. Han cerrado grupos LGBTQ+ y PNP a escala — sin apelación, sin aviso, la comunidad desaparece de la noche a la mañana.

<b>PNPtv! es tu espacio seguro.</b> Estamos construidos para esta comunidad. No compartimos tus datos, no censuramos contenido adulto consensual, y no cerramos tu grupo.

Lo mejor: no tienes que elegir. <b>Sincroniza tu grupo de Telegram con un Hangout de PNPtv</b> — los mensajes fluyen en ambas direcciones en tiempo real.

<b>Cómo sincronizar en 3 pasos:</b>

1️⃣ Abre <a href="https://pnptv.app/chat">pnptv.app/chat</a>, crea un Hangout (o abre uno que ya tengas). Anota el ID en la URL — ej: <code>pnptv.app/chat/42</code> → el ID es <b>42</b>.

2️⃣ Agrega <b>@PNPLatinoTV_bot</b> a tu grupo de Telegram y hazlo <b>administrador</b>.

3️⃣ Dentro del grupo de Telegram, escribe:
<code>/link 42</code>  (cambia 42 por el ID real de tu Hangout)

Listo. ✅ Los mensajes de la app van a Telegram. Los mensajes de Telegram aparecen en la app. Las ediciones y los medios también se sincronizan.

<b>Por qué importa:</b>
✓ Tu Hangout en PNPtv nunca se cierra
✓ Los miembros pueden chatear desde la app sin tener Telegram
✓ Sin vigilancia de una empresa convencional
✓ Tú eres dueño de tu espacio comunitario

👉 <a href="https://pnptv.app/chat">pnptv.app/chat</a> — abre tus Hangouts ahora`,
};

// ── Email subject ─────────────────────────────────────────────────────────────

const EMAIL_SUBJECT = {
  en: '🔗 Move your Telegram group to PNPtv! — sync it in 3 steps',
  es: '🔗 Mueve tu grupo de Telegram a PNPtv! — sincronízalo en 3 pasos',
};

// ── Email HTML ────────────────────────────────────────────────────────────────

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Sync your Telegram group to PNPtv!' : 'Sincroniza tu grupo de Telegram con PNPtv!'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.30);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#E69138);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            🔗 ${en ? 'Your Telegram group has a safer home on PNPtv!' : 'Tu grupo de Telegram tiene un hogar más seguro en PNPtv!'}
          </h1>

          <!-- Why -->
          <p style="margin:0 0 8px;font-size:15px;font-weight:800;color:#ffffff;">${en ? 'Why this matters' : 'Por qué importa'}</p>
          <p style="margin:0 0 16px;font-size:14px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'Telegram\'s privacy policy (§4.3) explicitly allows them to <b style="color:#fff">monitor group content</b>. They have shut down LGBTQ+ and PNP groups at scale — no appeal, no warning. PNPtv! is built for this community. We don\'t share your data, we don\'t censor consensual adult content, and we don\'t shut down your group.'
              : 'La política de privacidad de Telegram (§4.3) les permite explícitamente <b style="color:#fff">monitorear el contenido de los grupos</b>. Han cerrado grupos LGBTQ+ y PNP a escala — sin apelación, sin aviso. PNPtv! está construido para esta comunidad. No compartimos tus datos, no censuramos contenido adulto consensual, y no cerramos tu grupo.'}
          </p>

          <!-- Good news -->
          <div style="padding:16px 20px;background:rgba(212,0,122,0.06);border:1px solid rgba(212,0,122,0.25);border-radius:12px;margin-bottom:20px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:800;color:#D4007A;text-transform:uppercase;letter-spacing:0.05em;">
              ${en ? 'The best part — you don\'t have to choose' : 'Lo mejor — no tienes que elegir'}
            </p>
            <p style="margin:0;font-size:14px;color:#e5e7eb;line-height:1.5;">
              ${en
                ? 'Sync your existing Telegram group to a PNPtv Hangout. Messages flow <b>both ways in real time</b> — post from the app, it appears in Telegram. Someone types in Telegram, it shows in the app.'
                : 'Sincroniza tu grupo de Telegram existente con un Hangout de PNPtv. Los mensajes fluyen <b>en ambas direcciones en tiempo real</b> — publica desde la app, aparece en Telegram. Alguien escribe en Telegram, se ve en la app.'}
            </p>
          </div>

          <!-- Steps -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">${en ? 'How to sync in 3 steps' : 'Cómo sincronizar en 3 pasos'}</p>

          <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:8px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#ffffff;">1️⃣ ${en ? 'Create a Hangout (or open one you own)' : 'Crea un Hangout (o abre uno que tengas)'}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? 'Go to' : 'Ve a'} <a href="https://pnptv.app/chat" style="color:#D4007A;">pnptv.app/chat</a>. ${en ? 'Note the ID in the URL — e.g. pnptv.app/chat/<b style="color:#fff">42</b>' : 'Anota el ID en la URL — ej: pnptv.app/chat/<b style="color:#fff">42</b>'}</p>
          </div>

          <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:8px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#ffffff;">2️⃣ ${en ? 'Add @PNPLatinoTV_bot to your Telegram group as admin' : 'Agrega @PNPLatinoTV_bot a tu grupo de Telegram como administrador'}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? 'The bot needs admin rights to bridge messages.' : 'El bot necesita permisos de administrador para sincronizar mensajes.'}</p>
          </div>

          <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#ffffff;">3️⃣ ${en ? 'Type /link in your Telegram group' : 'Escribe /link en tu grupo de Telegram'}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">${en ? 'Inside the Telegram group, type:' : 'Dentro del grupo de Telegram, escribe:'} <span style="font-family:monospace;background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;color:#fff;">/link 42</span> (${en ? 'replace 42 with your actual Hangout ID' : 'reemplaza 42 con el ID real de tu Hangout'})</p>
          </div>

          <!-- Benefits -->
          <p style="margin:0 0 10px;font-size:15px;font-weight:800;color:#ffffff;">${en ? 'What you get' : 'Qué obtienes'}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${['✓ ' + (en ? 'Your Hangout on PNPtv <b style="color:#fff">never gets shut down</b>' : 'Tu Hangout en PNPtv <b style="color:#fff">nunca se cierra</b>'),
               '✓ ' + (en ? 'Members can chat from the <b style="color:#fff">app without a Telegram account</b>' : 'Los miembros pueden chatear desde la <b style="color:#fff">app sin tener Telegram</b>'),
               '✓ ' + (en ? 'Text, media, edits — <b style="color:#fff">all sync both ways</b>' : 'Texto, medios, ediciones — <b style="color:#fff">todo sincroniza en ambas direcciones</b>'),
               '✓ ' + (en ? '<b style="color:#fff">No surveillance</b> from a mainstream company' : '<b style="color:#fff">Sin vigilancia</b> de una empresa convencional'),
            ].map(row => `<tr><td style="padding:4px 0;font-size:13px;color:#9ca3af;">${row}</td></tr>`).join('')}
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="https://pnptv.app/chat" style="display:inline-block;padding:14px 36px;background:linear-gradient(90deg,#D4007A,#E69138);border-radius:12px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;">
                ${en ? 'Open my Hangouts →' : 'Abrir mis Hangouts →'}
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:11px;color:#6b7280;text-align:center;">
            ${en
              ? 'PNPtv! — built by and for the queer PNP community. Your space, your rules.'
              : 'PNPtv! — construido por y para la comunidad queer PNP. Tu espacio, tus reglas.'}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Telegram → PNPtv Hangout Sync Broadcast');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email: email channel skipped\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram: Telegram channel skipped\n');

  console.log('\n── Fetching broadcast targets...');
  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.email, u.telegram, u.language
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
    ORDER BY u.id
  `);

  let alreadySent = new Set();
  if (!FORCE) {
    const { rows: alreadyRows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_id = $1 AND entity_type = 'system' AND actor_id IS NULL
    `, [ENTITY_ID]);
    alreadySent = new Set(alreadyRows.map(r => r.target_user_id));
  }
  const isNew = (u) => !alreadySent.has(u.id);

  const withTelegram = users.filter(u => u.telegram && isNew(u));
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app') && isNew(u));

  console.log(`   Total users:      ${users.length}`);
  console.log(`   Already sent:     ${alreadySent.size}`);
  console.log(`   With Telegram:    ${withTelegram.length}`);
  console.log(`   With real email:  ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // ── 1. In-app bell ──
  console.log('\n1/4  In-app notifications...');
  if (!DRY_RUN) {
    try {
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT 'announcement', 'system', 'high', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: HANGOUT_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Inserted: ${stats.inApp}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else {
    console.log(`     [DRY] Would insert for ${users.length} users`);
  }

  // ── 2. Web push ──
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: HANGOUT_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: HANGOUT_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ Push sent: ${pushSent}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // ── 3. Telegram ──
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
  if (!SKIP_TELEGRAM && !DRY_RUN) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const msg = isEn(u.language) ? TG.en : TG.es;
      try {
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 100 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 100 === 0) console.log(`     TG progress: ${i + 1}/${withTelegram.length}`);
    }
    console.log(`     ✓ Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would send to ${withTelegram.length} users`);
  } else {
    console.log('     [SKIPPED]');
  }

  // ── 4. Email ──
  console.log(`4/4  Email to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log('     [SKIPPED] --skip-email');
  } else if (!DRY_RUN) {
    const transporter = nodemailer.createTransport({
      host:           process.env.PNPTV_SMTP_HOST || process.env.SMTP_HOST,
      port:           parseInt(process.env.PNPTV_SMTP_PORT || process.env.SMTP_PORT || '587', 10),
      secure:         (process.env.PNPTV_SMTP_SECURE || process.env.SMTP_SECURE) === 'true',
      auth:           {
        user: process.env.PNPTV_SMTP_USER || process.env.SMTP_USER,
        pass: process.env.PNPTV_SMTP_PASS || process.env.SMTP_PASS,
      },
      pool:           true,
      maxConnections: 1,
      maxMessages:    Infinity,
      rateDelta:      1000,
      rateLimit:      1,
    });

    await new Promise((resolveAll) => {
      let sent = 0, failed = 0, completed = 0;
      if (!withEmail.length) { resolveAll(); return; }
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        transporter.sendMail({
          from:    '"PNPtv!" <support@pnptv.app>',
          to:      u.email,
          subject: EMAIL_SUBJECT[lang],
          html:    buildEmailHtml(lang, name),
        }, (err) => {
          completed++;
          if (err) {
            failed++;
            if (failed <= 5 || failed % 50 === 0) console.warn(`     Email err [${u.email}]: ${err.message}`);
          } else { sent++; }
          if (completed % 100 === 0 || completed === withEmail.length) {
            console.log(`     Email progress: ${completed}/${withEmail.length} (${sent} ok / ${failed} failed)`);
          }
          if (completed === withEmail.length) { stats.email = sent; stats.emailFailed = failed; transporter.close(); resolveAll(); }
        });
      }
    });
    console.log(`     ✓ Email: ${stats.email} sent / ${stats.emailFailed} failed`);
  } else {
    console.log(`     [DRY] Would email ${withEmail.length} users`);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(' BROADCAST COMPLETE');
  console.log(`  In-app: ${stats.inApp} | Push: ${stats.push} | TG: ${stats.telegram} (${stats.telegramFailed} failed) | Email: ${stats.email} (${stats.emailFailed} failed)`);
  console.log('══════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
