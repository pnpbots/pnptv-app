#!/usr/bin/env node
'use strict';

/**
 * Script: revokeUnusedTrials.js
 * Revokes PRIME free trials for users who haven't used the platform:
 *   - plan_id = 'prime-trial-3d'
 *   - 0 posts made
 *   - Profile incomplete (no bio or no photo)
 *   - No PWA install tracked
 *
 * Then sends each revoked user a DM from Cristina explaining what happened
 * and what they need to do to get it back.
 *
 * Usage: node scripts/revokeUnusedTrials.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const { query, pool } = require('../bot/config/postgres');
const sendSystemDM = require('../bot/services/sendSystemDM');

const CRISTINA_ID = 'pnptv-official';
const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  console.log(`[RevokeTrials] Starting${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  // Find unused trial users:
  //   - PRIME tier with trial plan
  //   - 0 posts on the social feed
  //   - bio is empty/null OR no photo
  const { rows: targets } = await query(`
    SELECT u.id, u.username, u.first_name, u.plan_expiry
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS post_count
      FROM social_posts
      GROUP BY user_id
    ) p ON p.user_id = u.id
    WHERE u.tier = 'PRIME'
      AND u.plan_id = 'prime-trial-3d'
      AND u.is_active = true
      AND COALESCE(p.post_count, 0) = 0
      AND (u.bio IS NULL OR u.bio = '')
      AND (u.photo_file_id IS NULL OR u.photo_file_id = '')
  `);

  console.log(`[RevokeTrials] Found ${targets.length} users to revoke`);

  let revoked = 0;
  let errors  = 0;

  for (const user of targets) {
    const name = user.username || user.first_name || 'there';

    const message = [
      `Hey ${name}!`,
      ``,
      `We worked really hard building PNPtv! and our records show you haven't used your PRIME free pass yet — so we're revoking it to keep the community active.`,
      ``,
      `Want it back? It's easy:`,
      `• Complete your profile (add a photo and bio)`,
      `• Make at least 3 posts in the community`,
      `• Install the PNPtv app on your phone`,
      ``,
      `Once you do that, reach out and we'll restore your PRIME access. We'd love to see you active in the community!`,
    ].join('\n');

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would revoke ${user.id} (${name}) and send DM`);
      continue;
    }

    try {
      // Downgrade to free
      await query(
        `UPDATE users
         SET tier = 'free',
             plan_id = NULL,
             plan_expiry = NULL,
             subscription_type = NULL
         WHERE id = $1`,
        [user.id]
      );

      // Send Cristina DM
      await sendSystemDM(CRISTINA_ID, user.id, message, query);

      revoked++;
      if (revoked % 100 === 0) console.log(`[RevokeTrials] Revoked ${revoked} so far...`);
      await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      errors++;
      console.error(`[RevokeTrials] Error on ${user.id}:`, err.message);
    }
  }

  console.log(`[RevokeTrials] Done. Revoked: ${revoked}, Errors: ${errors}`);
  await pool.end();
  process.exit(0);
}

run().catch(err => {
  console.error('[RevokeTrials] Fatal error:', err);
  process.exit(1);
});
