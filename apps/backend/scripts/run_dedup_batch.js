'use strict';

/**
 * run_dedup_batch.js — Process Category A merges + Category B renames
 * in small per-pair transactions via accountMergeService.
 *
 * Each pair runs in its own transaction, with a 200ms sleep between pairs
 * to avoid lock contention with live app traffic. Stops on first unexpected
 * error (but keeps going past "already-handled" and "collision-on-unique" cases).
 *
 * Usage:
 *   node scripts/run_dedup_batch.js --dry-run           # preview only
 *   node scripts/run_dedup_batch.js --apply             # execute all
 *   node scripts/run_dedup_batch.js --apply --limit 10  # execute first 10
 *   node scripts/run_dedup_batch.js --apply --cat A     # only Cat A merges
 *   node scripts/run_dedup_batch.js --apply --cat B     # only Cat B renames
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env.production') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const { query, getPool } = require('../config/postgres');
const accountMergeService = require('../services/accountMergeService');
const logger = require('../utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();
const CAT = (() => {
  const i = args.indexOf('--cat');
  return i >= 0 ? String(args[i + 1]).toUpperCase() : 'ALL';
})();
const SLEEP_MS = 200;
const PERFORMED_BY = 'run_dedup_batch_2026_04_22';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findCategoryA() {
  const { rows } = await query(
    `SELECT u_loser.id AS loser_id, u_winner.id AS winner_id,
            u_loser.username AS loser_username, u_winner.username AS winner_username,
            u_loser.tier AS loser_tier, u_winner.tier AS winner_tier,
            u_loser.plan_id AS loser_plan, u_winner.plan_id AS winner_plan
       FROM users u_loser
       JOIN users u_winner
         ON u_loser.telegram = u_winner.id
        AND u_winner.id ~ '^[0-9]+$'
      WHERE u_loser.id !~ '^[0-9]+$'
        AND u_loser.telegram IS NOT NULL
        AND u_loser.telegram <> ''
        AND u_loser.id <> 'SYSTEM'
        AND COALESCE(u_loser.is_deleted, false) = false
        AND COALESCE(u_winner.is_deleted, false) = false
      ORDER BY CASE WHEN u_loser.tier = 'PRIME' THEN 0 ELSE 1 END, u_loser.created_at`
  );
  return rows;
}

async function findCategoryB() {
  const { rows } = await query(
    `SELECT u.id AS src_uuid, u.telegram AS dst_tg, u.username AS src_username, u.tier AS src_tier
       FROM users u
      WHERE u.id !~ '^[0-9]+$'
        AND u.id <> 'SYSTEM'
        AND u.telegram IS NOT NULL
        AND u.telegram ~ '^[0-9]+$'
        AND COALESCE(u.is_deleted, false) = false
        AND NOT EXISTS (SELECT 1 FROM users t WHERE t.id = u.telegram)
      ORDER BY CASE WHEN u.tier = 'PRIME' THEN 0 ELSE 1 END, u.created_at`
  );
  return rows;
}

async function runCategoryA(pairs) {
  const results = { ok: 0, failed: 0, errors: [] };
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const label = `[A ${i + 1}/${pairs.length}] ${p.loser_username || p.loser_id} → ${p.winner_username || p.winner_id}`;
    try {
      if (DRY_RUN) {
        const preview = await accountMergeService.previewMerge(p.loser_id, p.winner_id);
        const tableSummary = Object.keys(preview.tablesAffected).length;
        console.log(`${label} DRY tier ${p.loser_tier}→${p.winner_tier} (${tableSummary} tables affected)`);
      } else {
        const res = await accountMergeService.mergeUserAccounts(p.loser_id, p.winner_id, {
          reason: 'Cat A batch: UUID.telegram matches existing TG-ID row',
          dimension: 'telegram',
          performedBy: PERFORMED_BY,
        });
        console.log(`${label} OK log=${res.mergeLogId} rows=${Object.keys(res.rowsTransferred).length}`);
        results.ok++;
      }
    } catch (err) {
      console.error(`${label} FAILED: ${err.message}`);
      results.failed++;
      results.errors.push({ pair: `${p.loser_id}→${p.winner_id}`, error: err.message });
      if (!err.message.startsWith('MERGE_COLLISION:')) {
        console.error('Non-collision error — stopping batch.');
        break;
      }
    }
    if (!DRY_RUN) await sleep(SLEEP_MS);
  }
  return results;
}

async function runCategoryB(pairs) {
  const results = { ok: 0, failed: 0, errors: [] };
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const label = `[B ${i + 1}/${pairs.length}] ${p.src_username || p.src_uuid} → ${p.dst_tg}`;
    try {
      if (DRY_RUN) {
        console.log(`${label} DRY tier=${p.src_tier}`);
      } else {
        const res = await accountMergeService.renameToTelegramId(p.src_uuid, p.dst_tg, {
          performedBy: PERFORMED_BY,
        });
        console.log(`${label} OK log=${res.mergeLogId}`);
        results.ok++;
      }
    } catch (err) {
      console.error(`${label} FAILED: ${err.message}`);
      results.failed++;
      results.errors.push({ pair: `${p.src_uuid}→${p.dst_tg}`, error: err.message });
      if (!err.message.startsWith('MERGE_COLLISION:')) {
        console.error('Non-collision error — stopping batch.');
        break;
      }
    }
    if (!DRY_RUN) await sleep(SLEEP_MS);
  }
  return results;
}

async function main() {
  const startedAt = Date.now();
  console.log(`run_dedup_batch: mode=${DRY_RUN ? 'DRY-RUN' : 'APPLY'} cat=${CAT} limit=${LIMIT}`);

  let catAResults = null;
  let catBResults = null;

  if (CAT === 'A' || CAT === 'ALL') {
    const catA = (await findCategoryA()).slice(0, LIMIT);
    console.log(`Category A pairs found: ${catA.length}`);
    catAResults = await runCategoryA(catA);
  }

  if (CAT === 'B' || CAT === 'ALL') {
    const catB = (await findCategoryB()).slice(0, LIMIT);
    console.log(`Category B pairs found: ${catB.length}`);
    catBResults = await runCategoryB(catB);
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n=== SUMMARY ===');
  if (catAResults) console.log(`Cat A: ok=${catAResults.ok} failed=${catAResults.failed}`);
  if (catBResults) console.log(`Cat B: ok=${catBResults.ok} failed=${catBResults.failed}`);
  console.log(`Elapsed: ${elapsedSec}s`);

  if ((catAResults?.errors.length || 0) + (catBResults?.errors.length || 0) > 0) {
    console.log('\nERRORS:');
    [...(catAResults?.errors || []), ...(catBResults?.errors || [])].forEach((e) => {
      console.log(`  ${e.pair}: ${e.error}`);
    });
  }

  await getPool().end().catch(() => {});
  process.exit(catAResults?.failed || catBResults?.failed ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  getPool().end().catch(() => {});
  process.exit(2);
});
