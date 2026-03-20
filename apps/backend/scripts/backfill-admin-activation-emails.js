#!/usr/bin/env node
/**
 * One-time backfill script: send invoice emails, welcome/onboarding emails,
 * Telegram DM notifications, and Socket.IO notifications to all users whose
 * memberships were historically activated by an admin (manual_activation).
 *
 * Usage:
 *   cd /opt/pnptvapp
 *   node scripts/backfill-admin-activation-emails.js [--dry-run]
 *
 * Flags:
 *   --dry-run   Print what would be sent without actually sending anything.
 */
'use strict';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Bootstrap app environment ──
// Run: docker exec pnptv-bot node /app/scripts/backfill-admin-activation-emails.js [--dry-run]
const path = require('path');
const BE = path.join(__dirname, '..', 'apps', 'backend');

const { query } = require(path.join(BE, 'config/postgres'));
const logger = require(path.join(BE, 'utils/logger'));
const InvoiceService = require(path.join(BE, 'bot/services/invoiceservice'));
const EmailService = require(path.join(BE, 'bot/services/emailservice'));
const NotificationEmitter = require(path.join(BE, 'bot/services/notificationEmitter'));
const PaymentHistoryService = require(path.join(BE, 'services/paymentHistoryService'));
const { Telegraf } = require(path.join(BE, 'node_modules/telegraf'));

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN not set');
  process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

const DELAY_MS = 2000; // 2s between users to avoid rate limits
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n=== Backfill Admin Activation Emails ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  // Deduplicated: one row per active user, most recent manual_activation payment
  const { rows: users } = await query(`
    SELECT DISTINCT ON (u.id)
      u.id AS user_id,
      u.first_name,
      u.email,
      u.language,
      u.plan_id AS current_plan_id,
      u.plan_expiry,
      p.id AS payment_id,
      p.plan_id AS payment_plan_id,
      p.amount,
      p.currency,
      p.created_at AS activation_date,
      p.metadata->>'planName' AS plan_name_meta,
      pl.name AS plan_name,
      pl.display_name,
      pl.duration,
      pl.duration_days
    FROM users u
    JOIN payments p ON p.user_id = u.id AND p.provider = 'manual_activation'
    LEFT JOIN plans pl ON pl.id = u.plan_id
    WHERE u.subscription_status = 'active'
    ORDER BY u.id, p.created_at DESC
  `);

  console.log(`Found ${users.length} admin-activated users with active subscriptions.\n`);

  const results = {
    total: users.length,
    invoiceEmailSent: 0,
    welcomeEmailSent: 0,
    telegramDmSent: 0,
    socketNotifSent: 0,
    paymentHistoryRecorded: 0,
    noEmail: 0,
    errors: [],
  };

  for (const row of users) {
    const {
      user_id: userId,
      first_name: firstName,
      email,
      language,
      current_plan_id: planId,
      plan_expiry: planExpiry,
      payment_id: paymentId,
      amount,
      currency,
      activation_date: activationDate,
      plan_name_meta: planNameMeta,
      plan_name: planName,
      display_name: displayName,
      duration,
      duration_days: durationDays,
    } = row;

    const customerName = firstName || 'Valued Customer';
    const planDisplayName = displayName || planNameMeta || planName || planId;
    const lang = language || 'es';
    const expiryDate = planExpiry ? new Date(planExpiry) : null;
    const planDuration = durationDays || duration || 30;
    const transactionId = paymentId || `backfill-${userId}-${Date.now()}`;

    console.log(`\n--- [${userId}] ${customerName} | ${planDisplayName} | email: ${email || 'NONE'} | lang: ${lang} ---`);

    if (DRY_RUN) {
      if (!email) {
        console.log('  [SKIP] No email — would send Telegram DM + Socket.IO only');
        results.noEmail++;
      } else {
        console.log(`  [DRY] Would send invoice email to ${email}`);
        console.log(`  [DRY] Would send welcome email to ${email}`);
      }
      console.log(`  [DRY] Would send Telegram DM to ${userId}`);
      console.log(`  [DRY] Would emit Socket.IO notification`);
      console.log(`  [DRY] Would record payment history`);
      continue;
    }

    // 1. Invoice Email (if has email)
    if (email) {
      try {
        const { buffer: invoicePdf } = await InvoiceService.generateInvoice({
          invoiceNumber: transactionId,
          customerName,
          planName: planDisplayName,
          amount: parseFloat(amount) || 0,
          currency: currency || 'USD',
          provider: 'manual_activation',
          transactionId,
          purchaseDate: new Date(activationDate),
          expiryDate: expiryDate || undefined,
          language: lang,
        });

        const invoiceResult = await EmailService.sendInvoiceEmail({
          to: email,
          customerName,
          invoiceNumber: transactionId,
          amount: parseFloat(amount) || 0,
          planName: planDisplayName,
          invoicePdf,
        });

        if (invoiceResult.success) {
          console.log(`  [OK] Invoice email sent to ${email}`);
          results.invoiceEmailSent++;
        } else {
          console.log(`  [WARN] Invoice email failed: ${invoiceResult.error}`);
        }
      } catch (err) {
        console.log(`  [ERR] Invoice email: ${err.message}`);
        results.errors.push({ userId, step: 'invoice_email', error: err.message });
      }
    } else {
      console.log('  [SKIP] No email — skipping invoice email');
      results.noEmail++;
    }

    // 2. Welcome / Onboarding Email (if has email)
    if (email) {
      try {
        const { buffer: guidePdf } = await InvoiceService.generateOnboardingGuide({
          customerName,
          planName: planDisplayName,
          language: lang,
        });

        const welcomeResult = await EmailService.sendWelcomeEmail({
          to: email,
          customerName,
          planName: planDisplayName,
          duration: planDuration,
          expiryDate: expiryDate || undefined,
          language: lang,
          onboardingGuidePdf: guidePdf,
        });

        if (welcomeResult.success) {
          console.log(`  [OK] Welcome email sent to ${email}`);
          results.welcomeEmailSent++;
        } else {
          console.log(`  [WARN] Welcome email failed: ${welcomeResult.error}`);
        }
      } catch (err) {
        console.log(`  [ERR] Welcome email: ${err.message}`);
        results.errors.push({ userId, step: 'welcome_email', error: err.message });
      }
    }

    // 3. Telegram DM
    try {
      const expiryText = expiryDate
        ? (lang === 'es'
            ? `hasta el **${expiryDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}**`
            : `until **${expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}**`)
        : (lang === 'es' ? '**sin vencimiento (Lifetime)**' : '**no expiration (Lifetime)**');

      const message = lang === 'es'
        ? `📧 **¡Información de tu Membresía!**\n\n` +
          `Hola ${customerName},\n\n` +
          `Tu plan **${planDisplayName}** está activo ${expiryText}.\n\n` +
          (email
            ? `📨 Te hemos enviado por email:\n• Tu factura en PDF\n• Tu guía de uso de PNPtv\n\n`
            : '') +
          `🌟 Accede a todo el contenido en:\n` +
          `👉 https://pnptv.app\n\n` +
          `📱 Usa /menu para ver todas las funciones disponibles.`
        : `📧 **Your Membership Info!**\n\n` +
          `Hi ${customerName},\n\n` +
          `Your **${planDisplayName}** plan is active ${expiryText}.\n\n` +
          (email
            ? `📨 We've sent you by email:\n• Your PDF invoice\n• Your PNPtv user guide\n\n`
            : '') +
          `🌟 Access all content at:\n` +
          `👉 https://pnptv.app\n\n` +
          `📱 Use /menu to see all available features.`;

      await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
      console.log(`  [OK] Telegram DM sent to ${userId}`);
      results.telegramDmSent++;
    } catch (err) {
      console.log(`  [ERR] Telegram DM: ${err.message}`);
      results.errors.push({ userId, step: 'telegram_dm', error: err.message });
    }

    // 4. Socket.IO notification
    try {
      await NotificationEmitter.emit({
        targetUserId: userId,
        type: 'payment',
        category: 'commerce',
        entityType: 'payment',
        entityId: paymentId || null,
        message: lang === 'es'
          ? `Membresía activada: ${planDisplayName}`
          : `Membership activated: ${planDisplayName}`,
        metadata: {
          planName: planDisplayName,
          amount: parseFloat(amount) || 0,
          currency: currency || 'USD',
          expiryDate: expiryDate?.toISOString?.() || null,
          provider: 'manual_activation',
          backfill: true,
        },
      });
      console.log(`  [OK] Socket.IO notification emitted`);
      results.socketNotifSent++;
    } catch (err) {
      console.log(`  [ERR] Socket.IO notification: ${err.message}`);
      results.errors.push({ userId, step: 'socket_notif', error: err.message });
    }

    // 5. Payment history record
    try {
      await PaymentHistoryService.recordPayment({
        userId,
        paymentMethod: 'manual_activation',
        amount: parseFloat(amount) || 0,
        currency: currency || 'USD',
        planId,
        planName: planDisplayName,
        product: planDisplayName,
        paymentReference: transactionId,
        status: 'completed',
        metadata: {
          activationType: 'admin_activation',
          backfill: true,
          originalActivationDate: activationDate,
        },
      });
      console.log(`  [OK] Payment history recorded`);
      results.paymentHistoryRecorded++;
    } catch (err) {
      console.log(`  [ERR] Payment history: ${err.message}`);
      results.errors.push({ userId, step: 'payment_history', error: err.message });
    }

    // Rate limit delay between users
    await sleep(DELAY_MS);
  }

  // ── Summary ──
  console.log('\n\n========== SUMMARY ==========');
  console.log(`Total users:               ${results.total}`);
  console.log(`Invoice emails sent:       ${results.invoiceEmailSent}`);
  console.log(`Welcome emails sent:       ${results.welcomeEmailSent}`);
  console.log(`Telegram DMs sent:         ${results.telegramDmSent}`);
  console.log(`Socket.IO notifications:   ${results.socketNotifSent}`);
  console.log(`Payment history recorded:  ${results.paymentHistoryRecorded}`);
  console.log(`Users without email:       ${results.noEmail}`);
  console.log(`Errors:                    ${results.errors.length}`);
  if (results.errors.length > 0) {
    console.log('\nError details:');
    for (const e of results.errors) {
      console.log(`  [${e.userId}] ${e.step}: ${e.error}`);
    }
  }
  console.log('=============================\n');
}

main()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
