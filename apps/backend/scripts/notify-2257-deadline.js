#!/usr/bin/env node
'use strict';

const path    = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM                  = require(path.join(BACKEND, 'services/sendSystemDM'));

const SYSTEM_SENDER_ID = '8552451957';
const DRY_RUN = process.argv.includes('--dry-run');

function buildMessage(username, verificationStatus) {
  const name = username ? `@${username}` : 'Creator';

  if (verificationStatus === 'rejected') {
    return `⚠️ ${name} — your ID verification was rejected and must be resubmitted before July 11.

Your submission did not pass review. Without an approved submission, your account will be blocked from uploading content and going live starting July 12.

Please resubmit at: https://pnptv.app/creators/apply

— PNPtv! Compliance Team`;
  }

  if (verificationStatus === 'pending') {
    return `⏳ ${name} — your ID verification is still under review.

If it is not approved before July 11, your account will be temporarily blocked from uploading content and going live until verification is complete.

Check your status at: https://pnptv.app/creators/apply

— PNPtv! Compliance Team`;
  }

  // no submission
  return `⚠️ ${name} — you must complete ID verification before July 11.

18 U.S.C. §2257 requires us to verify the age and identity of all content creators. Without an approved submission, your account will be blocked from uploading content and going live starting July 12.

Submit your documents now (2 minutes): https://pnptv.app/creators/apply

— PNPtv! Compliance Team`;
}

async function main() {
  await initializePostgres();

  const { rows: creators } = await query(`
    SELECT u.id, u.username, u.telegram,
           r.verification_status
    FROM users u
    LEFT JOIN creator_2257_records r ON r.user_id = u.id
    WHERE u.identity_verified IS NOT TRUE
      AND u.identity_verification_required_by IS NOT NULL
      AND u.identity_verification_required_by <= NOW() + INTERVAL '5 days'
      AND (u.username IS NULL OR u.username NOT LIKE 'deleted_%')
    ORDER BY u.username
  `);

  console.log(`Sending 2257 deadline notifications to ${creators.length} creators${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  let dmSent = 0, dmFailed = 0;
  let bellSent = 0, bellFailed = 0;
  let tgSent = 0, tgFailed = 0, tgSkipped = 0;

  for (const creator of creators) {
    const msg = buildMessage(creator.username, creator.verification_status);
    const entityId = `2257_deadline_jul11_${creator.id}`;

    if (DRY_RUN) {
      const preview = msg.split('\n')[0];
      console.log(`[DRY RUN] ${creator.username || creator.id} (status=${creator.verification_status ?? 'none'}, tg=${creator.telegram ?? 'none'})`);
      console.log(`  → ${preview}`);
      continue;
    }

    // 1) In-app DM from system account
    try {
      await sendSystemDM(SYSTEM_SENDER_ID, creator.id, msg, query);
      console.log(`✓ DM  ${creator.username || creator.id}`);
      dmSent++;
    } catch (err) {
      console.error(`✗ DM  ${creator.username || creator.id}: ${err.message}`);
      dmFailed++;
    }

    // 2) Bell notification
    try {
      await query(
        `INSERT INTO notifications
           (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
         VALUES ('announcement', 'system', 'high', NULL, $1, '2257', $2, $3, $4::jsonb)
         ON CONFLICT DO NOTHING`,
        [creator.id, entityId, msg.split('\n')[0], JSON.stringify({ url: 'https://pnptv.app/creators/apply' })]
      );
      console.log(`✓ Bell ${creator.username || creator.id}`);
      bellSent++;
    } catch (err) {
      console.error(`✗ Bell ${creator.username || creator.id}: ${err.message}`);
      bellFailed++;
    }

    // 3) Telegram bot message (for those with a telegram handle)
    if (creator.telegram) {
      try {
        const { Telegram } = require('telegraf');
        const tg = new Telegram(process.env.BOT_TOKEN);
        await tg.sendMessage(creator.telegram, msg, { parse_mode: undefined });
        console.log(`✓ TG   ${creator.username || creator.id} (${creator.telegram})`);
        tgSent++;
      } catch (err) {
        console.error(`✗ TG   ${creator.username || creator.id}: ${err.message}`);
        tgFailed++;
      }
    } else {
      tgSkipped++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\nDone.`);
  console.log(`  In-app DM:   ${dmSent} sent, ${dmFailed} failed`);
  console.log(`  Bell notif:  ${bellSent} sent, ${bellFailed} failed`);
  if (!DRY_RUN) {
    console.log(`  Telegram:    ${tgSent} sent, ${tgFailed} failed, ${tgSkipped} skipped (no handle)`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
