#!/usr/bin/env node
'use strict';

/**
 * dm-creator-getting-started-guide.js
 *
 * Sends a Telegram DM (+ email fallback) to all active creators
 * linking them to the new Getting Started section in the Creator Guidelines.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/dm-creator-getting-started-guide.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/dm-creator-getting-started-guide.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const nodemailer = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN     = process.argv.includes('--dry-run');
const TG_DELAY_MS = 400;
const GUIDE_URL   = 'https://pnptv.app/creators/guidelines';
const sleep       = (ms) => new Promise((r) => setTimeout(r, ms));
const isEs        = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

function tgMsg(name, lang) {
  if (isEs(lang)) {
    return `<b>PNPtv! — Guía de inicio para creadores 🚀</b>\n\n` +
      `Hola ${name}, hemos publicado una guía completa de inicio para creadores en el Studio.\n\n` +
      `La guía cubre todo lo que necesitas para arrancar:\n` +
      `• Configurar tu foto de perfil y álbum (ahora puedes subir archivos directamente desde el Studio)\n` +
      `• Publicar tu primer contenido\n` +
      `• Estrategia en X/Twitter — cómo usar CTAs, frecuencia de publicación y cómo etiquetarnos para que te reposteemos\n` +
      `• Lista de acciones para tu primera semana\n\n` +
      `👉 <a href="${GUIDE_URL}">pnptv.app/creators/guidelines</a>\n\n` +
      `También puedes acceder desde Studio → Guías en el menú de tu creador.`;
  }
  return `<b>PNPtv! — Creator Getting Started Guide 🚀</b>\n\n` +
    `Hey ${name}, we just published a complete Getting Started guide for creators in the Studio.\n\n` +
    `It covers everything you need to hit the ground running:\n` +
    `• Setting up your profile photo and album (you can now upload files directly from the Studio)\n` +
    `• Posting your first content\n` +
    `• X/Twitter strategy — how to write CTAs, posting frequency, and how to tag us for reposts\n` +
    `• A day-by-day action checklist for your first week\n\n` +
    `👉 <a href="${GUIDE_URL}">pnptv.app/creators/guidelines</a>\n\n` +
    `You can also get there from Studio → Guidelines in your creator menu.`;
}

function emailHtml(name, lang) {
  const es = isEs(lang);
  if (es) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#1C1C1E;border-radius:16px;padding:36px 28px;border:1px solid rgba(212,0,122,0.2);">
  <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px;">PNPtv<span style="color:#D4007A;">!</span></div>
  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:28px;">Studio para Creadores</div>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">Hola <strong>${name}</strong>,</p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    Publicamos una <strong style="color:#fff;">guía completa de inicio para creadores</strong> en el Studio de PNPtv.
    Está diseñada para ayudarte a configurar tu perfil, crecer tu audiencia y monetizar desde el primer día.
  </p>
  <p style="color:#ccc;font-size:14px;line-height:1.8;">La guía incluye:<br>
    ✓ Cómo subir tu foto de perfil y álbum directamente desde el Studio<br>
    ✓ Qué publicar primero y con qué frecuencia<br>
    ✓ Estrategia en X/Twitter con ejemplos de CTAs reales<br>
    ✓ Cómo etiquetarnos para que te reposteemos a nuestra audiencia<br>
    ✓ Lista de acciones día a día para tu primera semana
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${GUIDE_URL}" style="display:inline-block;background:linear-gradient(135deg,#D4007A,#E69138);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">Ver la Guía →</a>
  </div>
  <p style="color:#666;font-size:12px;">También puedes acceder desde Studio → Guías en el menú de tu perfil de creador.</p>
  <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);color:#555;font-size:11px;">
    PNPtv! — pnptv.app &nbsp;·&nbsp; support@pnptv.app
  </div>
</div>
</body></html>`;
  }
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#1C1C1E;border-radius:16px;padding:36px 28px;border:1px solid rgba(212,0,122,0.2);">
  <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px;">PNPtv<span style="color:#D4007A;">!</span></div>
  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:28px;">Creator Studio</div>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">Hey <strong>${name}</strong>,</p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    We just published a <strong style="color:#fff;">complete Getting Started guide for creators</strong> in the PNPtv Studio.
    It's designed to help you set up your profile, grow your audience, and start earning from day one.
  </p>
  <p style="color:#ccc;font-size:14px;line-height:1.8;">The guide covers:<br>
    ✓ Uploading your profile photo and album directly from the Studio<br>
    ✓ What to post first and how often<br>
    ✓ X/Twitter strategy with real CTA examples<br>
    ✓ How to tag us so we repost you to our audience<br>
    ✓ A day-by-day action checklist for your first week
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${GUIDE_URL}" style="display:inline-block;background:linear-gradient(135deg,#D4007A,#E69138);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">View the Guide →</a>
  </div>
  <p style="color:#666;font-size:12px;">You can also access it from Studio → Guidelines in your creator menu.</p>
  <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);color:#555;font-size:11px;">
    PNPtv! — pnptv.app &nbsp;·&nbsp; support@pnptv.app
  </div>
</div>
</body></html>`;
}

async function main() {
  await initializePostgres();
  console.log(`[dm-creator-getting-started-guide] ${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'}`);

  const { rows: creators } = await query(`
    SELECT id, username, first_name, telegram, email, language, role
    FROM users
    WHERE role IN ('model', 'creator', 'superadmin')
      AND COALESCE(is_deleted, false) = false
    ORDER BY role, username
  `);

  console.log(`\nCreators to notify: ${creators.length}`);

  const withTg    = creators.filter(c => c.telegram);
  const emailOnly = creators.filter(c => !c.telegram && c.email && !c.email.includes('@telegram.pnptv.app'));

  console.log(`Telegram: ${withTg.length} | Email-only: ${emailOnly.length}\n`);

  const tg = process.env.BOT_TOKEN ? new Telegram(process.env.BOT_TOKEN) : null;

  // ── Telegram DMs ──────────────────────────────────────────────────────────
  let tgSent = 0, tgFailed = 0;
  for (const c of withTg) {
    const name = c.first_name || c.username || 'there';
    const lang = c.language || 'en';
    console.log(`[TG:${c.telegram}] @${c.username} (${lang}) ${DRY_RUN ? '[DRY]' : ''}`);
    if (DRY_RUN) { tgSent++; continue; }
    try {
      await tg.sendMessage(c.telegram, tgMsg(name, lang), { parse_mode: 'HTML', disable_web_page_preview: false });
      tgSent++;
      console.log(`  ✓ sent`);
    } catch (err) {
      tgFailed++;
      console.warn(`  ✗ ${err.message}`);
    }
    await sleep(TG_DELAY_MS);
  }

  // ── Email (no-Telegram creators only) ─────────────────────────────────────
  let emailSent = 0, emailFailed = 0;
  if (emailOnly.length) {
    const transporter = nodemailer.createTransport({
      host:   process.env.EASYBOTS_SMTP_HOST || process.env.PNPTV_SMTP_HOST || 'smtp.hostinger.com',
      port:   parseInt(process.env.EASYBOTS_SMTP_PORT || process.env.PNPTV_SMTP_PORT || '587', 10),
      secure: (process.env.EASYBOTS_SMTP_SECURE || process.env.PNPTV_SMTP_SECURE) === 'true',
      auth: {
        user: process.env.EASYBOTS_SMTP_USER || process.env.PNPTV_SMTP_USER,
        pass: process.env.EASYBOTS_SMTP_PASS || process.env.PNPTV_SMTP_PASS,
      },
    });

    for (const c of emailOnly) {
      const name = c.first_name || c.username || 'there';
      const lang = c.language || 'en';
      const subject = isEs(lang)
        ? 'PNPtv! — Tu guía de inicio como creador está lista'
        : 'PNPtv! — Your creator Getting Started guide is live';
      console.log(`[Email:${c.email}] @${c.username} (${lang}) ${DRY_RUN ? '[DRY]' : ''}`);
      if (DRY_RUN) { emailSent++; continue; }
      try {
        await transporter.sendMail({ from: 'PNPtv! <hello@easybots.store>', to: c.email, subject, html: emailHtml(name, lang) });
        emailSent++;
        console.log(`  ✓ sent`);
      } catch (err) {
        emailFailed++;
        console.warn(`  ✗ ${err.message}`);
      }
      await sleep(1200);
    }
  }

  console.log(`
═══════════════════════════════════════
 DONE
═══════════════════════════════════════
 Telegram: ${tgSent} sent / ${tgFailed} failed
 Email:    ${emailSent} sent / ${emailFailed} failed
═══════════════════════════════════════
`);
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
