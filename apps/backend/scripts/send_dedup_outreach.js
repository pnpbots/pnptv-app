'use strict';

/**
 * send_dedup_outreach.js — Send the dedup outreach email to flagged users.
 *
 * Targets users flagged by migration 219 with:
 *   merge_notes[*].action = 'flagged_for_outreach'       (PRIME, 8 users)
 *   merge_notes[*].action = 'flagged_for_deletion'       (free, 174 users)
 *
 * Only sends to rows with a valid email. Writes a "sent" marker to merge_notes
 * so repeat runs don't double-send.
 *
 * Usage:
 *   node scripts/send_dedup_outreach.js --dry-run
 *   node scripts/send_dedup_outreach.js --apply
 *   node scripts/send_dedup_outreach.js --apply --limit 5
 *   node scripts/send_dedup_outreach.js --apply --prime-only
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env.production') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const { query, getPool } = require('../config/postgres');
const emailService = require('../services/emailservice');
const { renderEn, renderEs } = require('../services/templates/dedup_outreach_email');
const logger = require('../utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();
const PRIME_ONLY = args.includes('--prime-only');
const SLEEP_MS = 800;  // polite to SMTP

const TG_BOT_URL = 'https://t.me/PNPtelevisionBot';
const SUPPORT_EMAIL = 'support@pnptv.app';
const FROM = process.env.PNPTV_FROM_EMAIL || 'noreply@pnptv.app';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTargets() {
  const primeFilter = PRIME_ONLY ? `AND tier = 'PRIME'` : '';
  const { rows } = await query(
    `SELECT id, username, first_name, email, tier, language, merge_notes
       FROM users
      WHERE COALESCE(is_deleted, false) = false
        AND email IS NOT NULL AND email <> ''
        AND (merge_notes::text LIKE '%flagged_for_outreach%'
             OR merge_notes::text LIKE '%flagged_for_deletion%')
        AND merge_notes::text NOT LIKE '%dedup_outreach_sent%'
        ${primeFilter}
      ORDER BY tier DESC, created_at`
  );
  return rows;
}

async function markSent(userId, messageId) {
  await query(
    `UPDATE users
        SET merge_notes = COALESCE(merge_notes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'action', 'dedup_outreach_sent',
          'at', NOW()::text,
          'message_id', $2::text
        ))
      WHERE id = $1`,
    [userId, messageId || '']
  );
}

async function main() {
  console.log(`send_dedup_outreach: mode=${DRY_RUN ? 'DRY-RUN' : 'APPLY'} prime-only=${PRIME_ONLY} limit=${LIMIT}`);

  const targets = (await findTargets()).slice(0, LIMIT);
  console.log(`Targets found: ${targets.length}`);

  if (targets.length === 0) {
    await getPool().end().catch(() => {});
    return;
  }

  const transporter = emailService.transporters?.pnptv;
  if (!DRY_RUN && !transporter) {
    console.error('PNPtv SMTP transporter not available — cannot send emails.');
    await getPool().end().catch(() => {});
    process.exit(3);
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    const lang = (u.language || 'es').startsWith('es') ? 'es' : 'en';
    const ctx = {
      username: u.username || u.first_name || 'PNPtv user',
      email: u.email,
      accountId: u.id,
      telegramBotUrl: TG_BOT_URL,
      supportEmail: SUPPORT_EMAIL,
    };
    const rendered = lang === 'es' ? renderEs(ctx) : renderEn(ctx);

    const label = `[${i + 1}/${targets.length}] ${u.email} (${u.tier}, ${lang})`;

    if (DRY_RUN) {
      console.log(`${label} DRY subject="${rendered.subject}"`);
      skipped++;
      continue;
    }

    try {
      const info = await transporter.sendMail({
        from: FROM,
        to: u.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await markSent(u.id, info.messageId || '');
      console.log(`${label} SENT id=${info.messageId || '(unknown)'}`);
      sent++;
    } catch (err) {
      console.error(`${label} FAILED: ${err.message}`);
      errors++;
    }

    await sleep(SLEEP_MS);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`sent=${sent} skipped=${skipped} errors=${errors}`);
  await getPool().end().catch(() => {});
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  getPool().end().catch(() => {});
  process.exit(2);
});
