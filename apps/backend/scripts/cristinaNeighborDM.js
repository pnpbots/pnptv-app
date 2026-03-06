#!/usr/bin/env node
'use strict';

/**
 * Script: cristinaNeighborDM.js
 * For each active user with a known location, finds their closest neighbor
 * and sends a DM from Cristina (pnptv-official) encouraging them to connect
 * + sharing their referral link.
 *
 * Safe to run multiple times — uses Redis key to prevent duplicate sends.
 * Usage: node scripts/cristinaNeighborDM.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const { query, pool } = require('../bot/config/postgres');
const { getRedis } = require('../bot/config/redis');
const sendSystemDM = require('../bot/services/sendSystemDM');
const { getOrCreateRefCode } = require('../bot/services/referralService');

const CRISTINA_ID = 'pnptv-official';
const DRY_RUN = process.argv.includes('--dry-run');
const REDIS_PREFIX = 'cristina:neighbor_dm:';
const REDIS_TTL = 60 * 60 * 24 * 30; // 30 days — don't re-send for a month

async function run() {
  const redis = getRedis();
  console.log(`[CristinaNeighborDM] Starting${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  // Get all active users with location, active in last 30 days
  const { rows: users } = await query(`
    SELECT id, username, first_name, location_lat, location_lng, ref_code
    FROM users
    WHERE location_lat IS NOT NULL
      AND location_lng IS NOT NULL
      AND tier != 'banned'
      AND is_active = true
      AND last_active > NOW() - INTERVAL '30 days'
    ORDER BY last_active DESC
    LIMIT 2000
  `);

  console.log(`[CristinaNeighborDM] Found ${users.length} eligible users`);

  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    const redisKey = `${REDIS_PREFIX}${user.id}`;
    const alreadySent = await redis.get(redisKey);
    if (alreadySent) { skipped++; continue; }

    // Find closest other user (within 100km using ST_Distance)
    const { rows: neighbors } = await query(`
      SELECT id, username, first_name,
        ST_Distance(
          ST_SetSRID(ST_Point($2, $1), 4326)::geography,
          ST_SetSRID(ST_Point(location_lng, location_lat), 4326)::geography
        ) / 1000 AS dist_km
      FROM users
      WHERE id != $3
        AND location_lat IS NOT NULL
        AND location_lng IS NOT NULL
        AND tier != 'banned'
        AND is_active = true
      ORDER BY dist_km ASC
      LIMIT 1
    `, [user.location_lat, user.location_lng, user.id]);

    if (!neighbors.length) { skipped++; continue; }

    const neighbor = neighbors[0];
    const neighborName = neighbor.username || neighbor.first_name || 'someone';
    const userName = user.username || user.first_name || 'there';

    // Get or generate referral code
    const refCode = user.ref_code || await getOrCreateRefCode(user.id);
    const refLink = `https://pnptv.app/join?ref=${refCode}`;
    const distKm = parseFloat(neighbor.dist_km).toFixed(1);

    const message = [
      `Hey ${userName}! Did you know @${neighborName} is the closest PNPtv member to you right now — only ${distKm}km away?`,
      ``,
      `Send them a DM and say hello! You might be surprised who's around.`,
      ``,
      `Want more members nearby? Share your personal invite link and both you AND your friend get 3 days of FREE PRIME:`,
      refLink,
    ].join('\n');

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would DM ${user.id} (${userName}): ${message.slice(0, 80)}...`);
    } else {
      try {
        await sendSystemDM(CRISTINA_ID, user.id, message, query);
        await redis.set(redisKey, '1', 'EX', REDIS_TTL);
        sent++;
        if (sent % 50 === 0) console.log(`[CristinaNeighborDM] Sent ${sent} DMs so far...`);
        // Small delay to avoid hammering DB
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        console.error(`[CristinaNeighborDM] Error DMing ${user.id}:`, err.message);
      }
    }
  }

  console.log(`[CristinaNeighborDM] Done. Sent: ${sent}, Skipped (already sent): ${skipped}`);
  await pool.end();
  process.exit(0);
}

run().catch(err => {
  console.error('[CristinaNeighborDM] Fatal error:', err);
  process.exit(1);
});
