#!/usr/bin/env node
'use strict';

/**
 * One-time notice to all magic-link users: sign-in email delivery is fixed.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/notify-magic-link-fixed.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/notify-magic-link-fixed.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query } = require(path.join(BACKEND, 'config/postgres'));
const emailService = require(path.join(BACKEND, 'services/emailService'));

const DRY_RUN = process.argv.includes('--dry-run');

const SUBJECT = 'PNPtv! — Sign-in emails are working again';

const html = (firstName) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#fff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#121220;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px">
        <tr><td>
          <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">PNPtv!</p>
          <p style="margin:0 0 16px;font-size:14px;color:rgba(255,255,255,0.85)">Hi ${firstName || 'there'},</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.7)">
            We had a brief issue with our sign-in email delivery — magic link emails were not going through. This has now been fixed.
          </p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.7)">
            You can sign in normally again. Just enter your email on the login page and you'll receive your sign-in link right away.
          </p>
          <p style="margin:0 0 24px;text-align:center">
            <a href="https://pnptv.app/login" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#D4007A,#E69138);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px">Sign in to PNPtv!</a>
          </p>
          <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.4);line-height:1.5">Sorry for the inconvenience. — The PNPtv! team</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

async function main() {
  const result = await query(`
    SELECT id, email, first_name FROM users
    WHERE last_login_method = 'magic_link'
      AND email IS NOT NULL
      AND email NOT ILIKE '%@telegram.pnptv.app%'
      AND is_deleted = false
    ORDER BY last_login_at DESC
  `);

  console.log(`Sending to ${result.rows.length} users${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  let sent = 0, failed = 0;
  for (const user of result.rows) {
    if (DRY_RUN) {
      console.log(`[DRY-RUN] ${user.email}`);
      continue;
    }
    try {
      await emailService.send({ to: user.email, subject: SUBJECT, html: html(user.first_name) });
      sent++;
      if (sent % 10 === 0) console.log(`  Sent ${sent}/${result.rows.length}...`);
    } catch (err) {
      console.error(`  FAILED ${user.email}: ${err.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
