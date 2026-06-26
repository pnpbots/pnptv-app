#!/usr/bin/env node
'use strict';

/**
 * broadcast-lex-referral-dm-june-2026.js
 *
 * In-app DM from PNPLATINOBOY / Lex (7246621722) to all Spanish-speaking
 * users asking them to share their referral link.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lex-referral-dm-june-2026.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lex-referral-dm-june-2026.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query } = require(path.join(BACKEND, 'config/postgres'));

const DRY_RUN      = process.argv.includes('--dry-run');
const SENDER_ID    = '7246621722'; // PNPLATINOBOY (Lex)
const BROADCAST_ID = 'lex-referral-dm-june-2026';
const BATCH_SIZE   = 200;

const MESSAGE =
`Hola guapo, es Lex de nuevo. Como ya probablemente sabes Santino y yo estamos de vuelta con toda a trabajar en PNPtv! y quería pedirte por favor que nos ayudes compartiendo tu link de referido que encuentras en https://pnptv.app/referrals  besos y felices nubes`;

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Lex Referral DM — Spanish users — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN — nothing will be written\n');

  const { rows: users } = await query(`
    SELECT id
    FROM users
    WHERE COALESCE(is_deleted, false) = false
      AND role != 'banned'
      AND id != $1
      AND language LIKE 'es%'
    ORDER BY id
  `, [SENDER_ID]);

  const { rows: alreadyRows } = await query(`
    SELECT recipient_id
    FROM direct_messages
    WHERE sender_id = $1
      AND meta->>'broadcastId' = $2
  `, [SENDER_ID, BROADCAST_ID]);
  const alreadySent = new Set(alreadyRows.map(r => r.recipient_id));

  const targets = users.filter(u => !alreadySent.has(u.id));

  console.log(`\n   Spanish users:  ${users.length}`);
  console.log(`   Already sent:   ${alreadySent.size}`);
  console.log(`   New targets:    ${targets.length}`);

  if (DRY_RUN) {
    console.log('\n── Sample DM ──\n');
    console.log(MESSAGE);
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' DRY RUN COMPLETE');
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(0);
  }

  if (!targets.length) {
    console.log('\n   Nothing to send.\n');
    process.exit(0);
  }

  const meta = JSON.stringify({ broadcastId: BROADCAST_ID });
  let inserted = 0;
  let failed   = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    try {
      const result = await query(`
        INSERT INTO direct_messages (sender_id, recipient_id, content, meta)
        SELECT $1, t.id, $2, $3::jsonb
        FROM unnest($4::text[]) AS t(id)
        ON CONFLICT DO NOTHING
      `, [SENDER_ID, MESSAGE, meta, batch.map(u => u.id)]);
      inserted += result.rowCount ?? batch.length;
    } catch (err) {
      failed += batch.length;
      console.error(`   ✗ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
    }
    if (i + BATCH_SIZE >= targets.length || (i + BATCH_SIZE) % 1000 === 0) {
      console.log(`   Progress: ${Math.min(i + BATCH_SIZE, targets.length)}/${targets.length}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' DONE');
  console.log('═══════════════════════════════════════════════════');
  console.log(` DMs inserted: ${inserted}`);
  if (failed) console.log(` Failed:       ${failed}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
