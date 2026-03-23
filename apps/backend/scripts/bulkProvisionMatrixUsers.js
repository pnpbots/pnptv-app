#!/usr/bin/env node
'use strict';

/**
 * bulkProvisionMatrixUsers.js
 *
 * One-time script: provisions Matrix accounts for all PNPtv users who don't
 * yet have one, using the canonical user.id-based Matrix username format.
 *
 * Usage (inside Docker):
 *   docker exec pnptv-bot node apps/backend/scripts/bulkProvisionMatrixUsers.js
 *
 * Dry-run mode:
 *   docker exec pnptv-bot node apps/backend/scripts/bulkProvisionMatrixUsers.js --dry-run
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.resolve(BACKEND_ROOT, '../../.env') });
  require('dotenv').config({ path: path.resolve(BACKEND_ROOT, '../../.env.production'), override: true });
} catch (_) { /* dotenv may not be needed inside Docker */ }

const { query, closePool } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const matrixService = require(path.join(BACKEND_ROOT, 'bot/services/matrixService'));

const DRY_RUN     = process.argv.includes('--dry-run');
const SYNC_AVATARS = process.argv.includes('--sync-avatars');
const BATCH_SIZE  = 5;        // concurrent provisions per batch
const DELAY_MS    = 500;      // pause between batches to avoid hammering Synapse

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`\n=== Bulk Matrix Provisioning ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const { rows: users } = await query(
    `SELECT id, telegram, username, first_name,
            matrix_user_id, matrix_access_token, matrix_device_id
     FROM users
     WHERE is_deleted = false
       AND matrix_user_id IS NULL
     ORDER BY created_at ASC`
  );

  console.log(`Found ${users.length} users without Matrix accounts.\n`);

  if (users.length === 0 || DRY_RUN) {
    if (DRY_RUN) {
      for (const u of users) {
        console.log(`  [DRY] Would provision: ${u.id} (${u.username || u.first_name || 'no name'})`);
      }
    }
    if (!SYNC_AVATARS) {
      console.log('\nDone (no changes made).');
      if (closePool) await closePool();
      return;
    }
  }

  let success = 0;
  let failed  = 0;
  const errors = [];

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(user =>
        matrixService.provisionMatrixUser(user)
          .then(creds => {
            success++;
            console.log(`  [OK]  ${user.id} -> ${creds.matrixUserId}`);
          })
          .catch(err => {
            failed++;
            errors.push({ userId: user.id, error: err.message });
            console.error(`  [ERR] ${user.id}: ${err.message}`);
          })
      )
    );

    if (i + BATCH_SIZE < users.length) {
      await sleep(DELAY_MS);
    }

    // Progress
    const done = Math.min(i + BATCH_SIZE, users.length);
    console.log(`  --- Progress: ${done}/${users.length} ---`);
  }

  console.log(`\n=== Results ===`);
  console.log(`  Provisioned: ${success}`);
  console.log(`  Failed:      ${failed}`);

  if (errors.length > 0) {
    console.log(`\nFailed users:`);
    for (const e of errors) {
      console.log(`  ${e.userId}: ${e.error}`);
    }
  }

  // ─── Avatar sync mode ────────────────────────────────────────────────────
  if (SYNC_AVATARS) {
    console.log(`\n=== Bulk Avatar Sync ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

    const { rows: avatarUsers } = await query(
      `SELECT id, photo_file_id, matrix_user_id, matrix_access_token
       FROM users
       WHERE is_deleted = false
         AND matrix_user_id IS NOT NULL
         AND matrix_access_token IS NOT NULL
         AND photo_file_id IS NOT NULL
       ORDER BY id ASC`
    );

    console.log(`Found ${avatarUsers.length} users with avatars to sync.\n`);

    if (!DRY_RUN) {
      let avatarOk = 0, avatarFail = 0;
      for (let i = 0; i < avatarUsers.length; i += BATCH_SIZE) {
        const batch = avatarUsers.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(u =>
            matrixService.syncMatrixAvatar(u)
              .then(() => { avatarOk++; console.log(`  [OK]  Avatar synced: ${u.id}`); })
              .catch(err => { avatarFail++; console.error(`  [ERR] Avatar ${u.id}: ${err.message}`); })
          )
        );
        if (i + BATCH_SIZE < avatarUsers.length) await sleep(DELAY_MS);
        console.log(`  --- Progress: ${Math.min(i + BATCH_SIZE, avatarUsers.length)}/${avatarUsers.length} ---`);
      }
      console.log(`\nAvatar sync: ${avatarOk} ok, ${avatarFail} failed`);
    } else {
      for (const u of avatarUsers) {
        console.log(`  [DRY] Would sync avatar: ${u.id} (${u.photo_file_id})`);
      }
    }
  }

  console.log('\nDone.');
  if (closePool) await closePool();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
