#!/usr/bin/env node
'use strict';

/**
 * bulkSyncHangoutsToMatrix.js
 *
 * Bulk migration script:
 * 1. Provisions Matrix accounts for all users who don't have one
 * 2. Creates Matrix rooms for groups that don't have one
 * 3. Syncs ALL group members into their respective Matrix rooms
 * 4. Migrates chat_messages from PostgreSQL to Matrix rooms
 *
 * Usage:
 *   docker exec pnptv-bot node /app/apps/backend/scripts/bulkSyncHangoutsToMatrix.js
 *   docker exec pnptv-bot node /app/apps/backend/scripts/bulkSyncHangoutsToMatrix.js --dry-run
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

// Bootstrap env
try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env.production'), override: true });
} catch {}

const { query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const matrixService = require(path.join(BACKEND_ROOT, 'bot/services/matrixService'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 20; // concurrent Matrix API calls per batch
const DELAY_MS = 500;  // pause between batches to avoid overloading Synapse

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`\n=== Bulk Hangouts → Matrix Sync ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  // ─── Step 1: Provision Matrix accounts for users without one ───────────────
  console.log('--- Step 1: Provisioning Matrix accounts ---');
  const { rows: unprovisioned } = await query(
    `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token, matrix_device_id
     FROM users
     WHERE (matrix_user_id IS NULL OR matrix_access_token IS NULL)
       AND is_deleted = false
     ORDER BY id`
  );
  console.log(`  ${unprovisioned.length} users need Matrix provisioning`);

  let provisioned = 0;
  for (let i = 0; i < unprovisioned.length; i += BATCH_SIZE) {
    const batch = unprovisioned.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (user) => {
      try {
        if (!DRY_RUN) {
          await matrixService.provisionMatrixUser(user);
        }
        provisioned++;
        console.log(`  ✓ Provisioned user ${user.id} (${user.username || user.first_name || user.telegram})`);
      } catch (err) {
        console.warn(`  ✗ Failed to provision user ${user.id}: ${err.message}`);
      }
    }));
    if (i + BATCH_SIZE < unprovisioned.length) await sleep(DELAY_MS);
  }
  console.log(`  Provisioned: ${provisioned}/${unprovisioned.length}\n`);

  // ─── Step 2: Ensure all groups have Matrix rooms ───────────────────────────
  console.log('--- Step 2: Creating Matrix rooms for groups ---');
  const { rows: groups } = await query(
    `SELECT g.id, g.name, g.creator_id, g.is_main,
            hmr.matrix_room_id,
            (SELECT COUNT(*)::int FROM hangout_group_members WHERE group_id = g.id) AS member_count
     FROM hangout_groups g
     LEFT JOIN hangout_matrix_rooms hmr ON hmr.hangout_group_id = g.id
     ORDER BY g.id`
  );

  for (const group of groups) {
    if (group.matrix_room_id) {
      console.log(`  ✓ Group ${group.id} (${group.name}): already has room ${group.matrix_room_id}`);
      continue;
    }
    if (group.member_count === 0) {
      console.log(`  ⊘ Group ${group.id} (${group.name}): 0 members, skipping`);
      continue;
    }

    // Get creator user record
    const { rows: creatorRows } = await query(
      `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token, matrix_device_id
       FROM users WHERE id = $1`, [group.creator_id]
    );
    if (creatorRows.length === 0) {
      console.warn(`  ✗ Group ${group.id}: creator ${group.creator_id} not found`);
      continue;
    }

    try {
      if (!DRY_RUN) {
        const roomId = await matrixService.getOrCreateHangoutRoom(group.id, creatorRows[0], group.name);
        group.matrix_room_id = roomId;
        console.log(`  ✓ Created room for group ${group.id} (${group.name}): ${roomId}`);
      } else {
        console.log(`  [DRY] Would create room for group ${group.id} (${group.name})`);
      }
    } catch (err) {
      console.warn(`  ✗ Failed to create room for group ${group.id}: ${err.message}`);
    }
  }
  console.log();

  // ─── Step 3: Sync all members into their Matrix rooms ──────────────────────
  console.log('--- Step 3: Syncing members into Matrix rooms ---');
  for (const group of groups) {
    if (!group.matrix_room_id) continue;

    const { rows: members } = await query(
      `SELECT gm.user_id, u.telegram, u.username, u.first_name,
              u.matrix_user_id, u.matrix_access_token, u.matrix_device_id
       FROM hangout_group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND gm.is_banned = false AND u.is_deleted = false
       ORDER BY gm.joined_at`,
      [group.id]
    );

    console.log(`  Group ${group.id} (${group.name}): ${members.length} members to sync`);
    let synced = 0, failed = 0, skipped = 0;

    for (let i = 0; i < members.length; i += BATCH_SIZE) {
      const batch = members.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (member) => {
        if (!member.matrix_user_id || !member.matrix_access_token) {
          skipped++;
          return;
        }
        try {
          if (!DRY_RUN) {
            await matrixService.ensureUserInRoom(group.matrix_room_id, {
              matrixUserId: member.matrix_user_id,
              accessToken: require(path.join(BACKEND_ROOT, 'bot/services/matrixService')).provisionMatrixUser ?
                (await matrixService.provisionMatrixUser(member)).accessToken : null,
            });
          }
          synced++;
        } catch (err) {
          // Try admin force-join as fallback
          try {
            if (!DRY_RUN) {
              await matrixService.inviteToHangoutRoom(group.id, member);
            }
            synced++;
          } catch {
            failed++;
          }
        }
      }));

      // Progress update every 100 members
      if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= members.length) {
        process.stdout.write(`    Progress: ${Math.min(i + BATCH_SIZE, members.length)}/${members.length} (synced: ${synced}, failed: ${failed}, skipped: ${skipped})\r`);
      }
      if (i + BATCH_SIZE < members.length) await sleep(DELAY_MS);
    }
    console.log(`    Done: synced=${synced} failed=${failed} skipped=${skipped}                    `);
  }
  console.log();

  // ─── Step 4: Migrate chat messages to Matrix ───────────────────────────────
  console.log('--- Step 4: Migrating chat messages to Matrix ---');
  for (const group of groups) {
    if (!group.matrix_room_id) continue;

    const { rows: messages } = await query(
      `SELECT cm.id, cm.user_id, cm.content, cm.created_at,
              cm.media_url, cm.media_type, cm.media_mime, cm.media_thumb_url,
              u.telegram, u.username, u.first_name,
              u.matrix_user_id, u.matrix_access_token, u.matrix_device_id
       FROM chat_messages cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.room = $1 AND cm.is_deleted = false
       ORDER BY cm.created_at ASC`,
      [`hangout:${group.id}`]
    );

    if (messages.length === 0) {
      console.log(`  Group ${group.id} (${group.name}): 0 messages to migrate`);
      continue;
    }

    console.log(`  Group ${group.id} (${group.name}): ${messages.length} messages to migrate`);
    let migrated = 0, msgFailed = 0;
    const tokenCache = new Map();

    for (const msg of messages) {
      if (!msg.matrix_user_id || !msg.matrix_access_token) {
        msgFailed++;
        continue;
      }

      try {
        // Cache tokens per user
        let senderToken = tokenCache.get(msg.user_id);
        if (!senderToken) {
          const creds = await matrixService.provisionMatrixUser(msg);
          senderToken = creds.accessToken;
          tokenCache.set(msg.user_id, senderToken);

          // Ensure sender is in the room
          if (!DRY_RUN) {
            await matrixService.ensureUserInRoom(group.matrix_room_id, creds);
          }
        }

        if (!DRY_RUN) {
          if (msg.media_url && msg.media_type) {
            // Media message
            const msgtype = msg.media_type === 'image' ? 'm.image' : msg.media_type === 'video' ? 'm.video' : 'm.file';
            await matrixService.sendRoomMediaMessage(group.matrix_room_id, senderToken, {
              url: msg.media_url,
              msgtype,
              body: msg.content || 'media',
              info: msg.media_mime ? { mimetype: msg.media_mime } : undefined,
            });
          } else if (msg.content) {
            // Text message
            await matrixService.sendRoomMessage(group.matrix_room_id, senderToken, msg.content);
          }
        }
        migrated++;

        // Rate limit: pause every 10 messages
        if (migrated % 10 === 0) {
          process.stdout.write(`    Progress: ${migrated}/${messages.length}\r`);
          await sleep(200);
        }
      } catch (err) {
        msgFailed++;
        if (msgFailed <= 5) {
          console.warn(`    ✗ Message ${msg.id} from user ${msg.user_id}: ${err.message}`);
        }
      }
    }
    console.log(`    Done: migrated=${migrated} failed=${msgFailed}                    `);
  }

  console.log('\n=== Migration complete ===\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
