#!/usr/bin/env node
'use strict';

/**
 * migrateWallOfFameToHangout.js
 *
 * One-time migration script: imports existing Wall of Fame photos/videos from
 * the Telegram forum topic into the hangout group system so they appear in the
 * web app's chat gallery.
 *
 * Usage (inside Docker):
 *   docker exec -it pnptv-bot node apps/backend/scripts/migrateWallOfFameToHangout.js
 *
 * Or directly:
 *   node apps/backend/scripts/migrateWallOfFameToHangout.js
 *
 * The script:
 * 1. Connects to Postgres, gets the WoF hangout group ID
 * 2. Queries all wall_of_fame_posts ordered by created_at ASC
 * 3. For each post, forwards the Telegram message to the bot's private chat
 *    to obtain the media file_id, downloads it, processes through
 *    processHangoutMedia, and inserts a chat_messages row with the original
 *    created_at timestamp
 * 4. Deletes the forwarded copy from the bot's chat
 * 5. 500ms delay between posts to respect Telegram rate limits
 */

const path = require('path');

// Ensure we resolve config correctly from the monorepo root
const BACKEND_ROOT = path.resolve(__dirname, '..');

// Load env if available
try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {
  // dotenv may not be installed; env vars should be set in the container
}

const { Telegraf } = require('telegraf');
const axios = require('axios');
const { getPool, query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const { processHangoutMedia } = require(path.join(BACKEND_ROOT, 'services/hangoutMediaService'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID || '-1003291737499';
const DELAY_MS = 500;

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN environment variable is required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Wall of Fame → Hangout Group Migration ===\n');

  // 1. Get the WoF hangout group ID
  const { rows: wofRows } = await query(
    'SELECT id FROM hangout_groups WHERE is_wall_of_fame = TRUE LIMIT 1'
  );

  if (wofRows.length === 0) {
    console.error('ERROR: No Wall of Fame hangout group found. Run migration 079 first.');
    process.exit(1);
  }

  const wofGroupId = wofRows[0].id;
  console.log(`Wall of Fame hangout group ID: ${wofGroupId}`);

  // 2. Get the bot's own user ID (for forwarding)
  const botInfo = await bot.telegram.getMe();
  console.log(`Bot: @${botInfo.username} (${botInfo.id})`);

  // 3. Query all wall_of_fame_posts
  const { rows: posts } = await query(
    'SELECT id, group_id, message_id, user_id, date_key, created_at FROM wall_of_fame_posts ORDER BY created_at ASC'
  );

  console.log(`Found ${posts.length} Wall of Fame posts to migrate\n`);

  if (posts.length === 0) {
    console.log('Nothing to migrate. Exiting.');
    process.exit(0);
  }

  // Check how many are already migrated (avoid duplicates)
  const room = `hangout:${wofGroupId}`;
  const { rows: existingCount } = await query(
    'SELECT COUNT(*)::int as cnt FROM chat_messages WHERE room = $1',
    [room]
  );
  if (existingCount[0].cnt > 0) {
    console.log(`WARNING: ${existingCount[0].cnt} messages already exist in room ${room}.`);
    console.log('Skipping posts whose user_id + created_at already have a matching message.\n');
  }

  let total = 0;
  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const post of posts) {
    total++;
    const label = `[${total}/${posts.length}] Post #${post.id} (msg ${post.message_id}, user ${post.user_id})`;

    try {
      // Check if already migrated
      const { rows: existing } = await query(
        `SELECT 1 FROM chat_messages
         WHERE room = $1 AND user_id = $2 AND created_at = $3
         LIMIT 1`,
        [room, post.user_id, post.created_at]
      );
      if (existing.length > 0) {
        console.log(`${label} — already migrated, skipping`);
        skipped++;
        continue;
      }

      // Forward the message from the group to the bot's private chat
      let forwarded;
      try {
        forwarded = await bot.telegram.forwardMessage(
          botInfo.id,
          Number(GROUP_ID),
          post.message_id
        );
      } catch (fwdErr) {
        if (fwdErr.message?.includes('message to forward not found') ||
            fwdErr.message?.includes('message not found') ||
            fwdErr.message?.includes('MESSAGE_ID_INVALID')) {
          console.log(`${label} — Telegram message deleted/unavailable, skipping`);
          skipped++;
          continue;
        }
        throw fwdErr;
      }

      // Extract file_id and media type
      let fileId = null;
      let mediaType = 'image';
      let mimetype = 'image/jpeg';

      if (forwarded.photo && forwarded.photo.length > 0) {
        fileId = forwarded.photo[forwarded.photo.length - 1].file_id;
        mediaType = 'image';
        mimetype = 'image/jpeg';
      } else if (forwarded.video) {
        fileId = forwarded.video.file_id;
        mediaType = 'video';
        mimetype = forwarded.video.mime_type || 'video/mp4';
      } else {
        console.log(`${label} — no photo/video in forwarded message, skipping`);
        // Clean up forwarded message
        try { await bot.telegram.deleteMessage(botInfo.id, forwarded.message_id); } catch (_) {}
        skipped++;
        continue;
      }

      // Download the file from Telegram
      const fileLink = await bot.telegram.getFileLink(fileId);
      const response = await axios.get(fileLink.href, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });
      const buffer = Buffer.from(response.data);

      // Process through hangoutMediaService
      const file = { buffer, mimetype };
      const mediaResult = await processHangoutMedia(file, wofGroupId, post.user_id);

      // Get user info for the chat message
      const { rows: userRows } = await query(
        'SELECT username, first_name, photo_file_id FROM users WHERE id = $1',
        [post.user_id]
      );
      const userRow = userRows[0] || {};
      const isValidUrl = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));
      const photoUrl = isValidUrl(userRow.photo_file_id) ? userRow.photo_file_id : null;

      // Insert chat_messages row with preserved created_at
      await query(
        `INSERT INTO chat_messages
           (room, user_id, username, first_name, photo_url, content,
            media_url, media_type, media_mime, media_thumb_url,
            media_width, media_height, media_metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          room,
          post.user_id,
          userRow.username || null,
          userRow.first_name || null,
          photoUrl,
          null,
          mediaResult.mediaUrl,
          mediaResult.mediaType,
          mediaResult.mediaMime,
          mediaResult.thumbUrl || null,
          mediaResult.width || null,
          mediaResult.height || null,
          mediaResult.metadata ? JSON.stringify(mediaResult.metadata) : null,
          post.created_at,
        ]
      );

      // Delete the forwarded copy from bot's chat
      try {
        await bot.telegram.deleteMessage(botInfo.id, forwarded.message_id);
      } catch (_) {
        // Non-critical
      }

      success++;
      console.log(`${label} — OK (${mediaType})`);
    } catch (err) {
      failed++;
      console.error(`${label} — FAILED: ${err.message}`);
    }

    // Rate-limit delay
    await sleep(DELAY_MS);
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total:   ${total}`);
  console.log(`Success: ${success}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed:  ${failed}`);

  // Close the pool
  const pool = getPool();
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
