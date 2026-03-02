#!/usr/bin/env node
'use strict';

/**
 * migrateWallOfFameToSocialFeed.js
 *
 * One-time migration: scans the Telegram community group for Wall of Fame
 * topic messages (bot-posted photos/videos with the "👑" caption marker) and
 * imports them into social_posts with is_wof = true.
 *
 * Since wall_of_fame_posts is empty (messages were never tracked in the DB),
 * this script iterates a range of message IDs in the group, forwards each to
 * a helper chat, detects WoF posts by caption, and imports them.
 *
 * Usage (inside Docker):
 *   docker exec pnptv-bot node apps/backend/scripts/migrateWallOfFameToSocialFeed.js
 *
 * Env vars:
 *   MIGRATE_START_ID  - First message ID to try (default: 1)
 *   MIGRATE_END_ID    - Last message ID to try (default: 10000)
 *   MIGRATE_DRY_RUN   - If 'true', detect but don't write
 *
 * Flags:
 *   --dry-run   Same as MIGRATE_DRY_RUN=true
 */

const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const axios = require('axios');

const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { Telegraf } = require('telegraf');
const { getPool, query } = require(path.join(BACKEND_ROOT, 'config/postgres'));

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const FORWARD_TARGET = process.env.MIGRATE_FORWARD_TARGET
  || process.env.NOTIFICATION_CHANNEL_ID
  || process.env.SUPPORT_GROUP_ID;

const START_ID = parseInt(process.env.MIGRATE_START_ID || '1', 10);
const END_ID = parseInt(process.env.MIGRATE_END_ID || '10000', 10);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.MIGRATE_DRY_RUN === 'true';
const DELAY_MS = 500;
const UPLOAD_DIR = path.join(BACKEND_ROOT, '../public/uploads/posts');

if (!BOT_TOKEN) { console.error('ERROR: BOT_TOKEN required'); process.exit(1); }
if (!GROUP_ID) { console.error('ERROR: GROUP_ID required'); process.exit(1); }
if (!FORWARD_TARGET) { console.error('ERROR: No forward target (set NOTIFICATION_CHANNEL_ID or SUPPORT_GROUP_ID)'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detect if a forwarded message is a Wall of Fame post.
 * WoF messages were sent by the bot and contain the "👑" marker in the caption.
 */
function isWofMessage(msg, botId) {
  if (!msg.photo && !msg.video) return false;
  const caption = msg.caption || msg.text || '';
  // WoF captions always contain the 👑 crown emoji (Featured Member / Miembro Destacado)
  if (!caption.includes('👑')) return false;
  // Verify it was originally sent by the bot
  if (msg.forward_from?.id !== botId) return false;
  return true;
}

/**
 * Extract the @username from a WoF caption.
 * Caption format: "...Username: @handle..." or "...Usuario: @handle..."
 */
function extractUsername(caption) {
  const match = caption.match(/@(\w+)/);
  return match ? match[1] : null;
}

async function processImage(buffer, userId, ts) {
  const filename = `wof-${userId}-${ts}.webp`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await sharp(buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70, progressive: true })
    .toFile(filePath);
  return { mediaUrl: `/uploads/posts/${filename}`, mediaType: 'image' };
}

async function processVideo(buffer, mimetype, userId, ts) {
  const ext = mimetype && mimetype.includes('webm') ? 'webm' : 'mp4';
  const filename = `wof-${userId}-${ts}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return { mediaUrl: `/uploads/posts/${filename}`, mediaType: 'video' };
}

async function main() {
  console.log('=== Wall of Fame → Social Feed Migration ===');
  console.log(`Group: ${GROUP_ID}`);
  console.log(`Forward target: ${FORWARD_TARGET}`);
  console.log(`Range: message IDs ${START_ID} to ${END_ID}`);
  if (DRY_RUN) console.log('>>> DRY RUN — no writes <<<');
  console.log();

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const botInfo = await bot.telegram.getMe();
  console.log(`Bot: @${botInfo.username} (${botInfo.id})\n`);

  let total = 0;
  let success = 0;
  let skippedDeleted = 0;
  let skippedNotWof = 0;
  let skippedDup = 0;
  let skippedNoUser = 0;
  let skippedTooBig = 0;
  let failed = 0;
  let consecutiveNotFound = 0;

  for (let msgId = START_ID; msgId <= END_ID; msgId++) {
    total++;
    const label = `[${msgId}/${END_ID}]`;

    // Dedup: already in social_posts?
    const { rows: existing } = await query(
      'SELECT 1 FROM social_posts WHERE telegram_message_id = $1 LIMIT 1',
      [msgId]
    );
    if (existing.length > 0) {
      skippedDup++;
      continue;
    }

    // Forward message from group to helper chat
    let forwarded;
    try {
      forwarded = await bot.telegram.forwardMessage(
        Number(FORWARD_TARGET),
        Number(GROUP_ID),
        msgId
      );
      consecutiveNotFound = 0;
    } catch (fwdErr) {
      const errMsg = fwdErr.message || '';
      if (errMsg.includes('message to forward not found') ||
          errMsg.includes('message not found') ||
          errMsg.includes('MESSAGE_ID_INVALID') ||
          errMsg.includes("message can't be forwarded") ||
          errMsg.includes('protected content')) {
        skippedDeleted++;
        consecutiveNotFound++;
        if (consecutiveNotFound >= 200 && msgId > START_ID + 20) {
          console.log(`\n${label} — 200 consecutive not-found — assuming end of messages`);
          break;
        }
        continue;
      }
      failed++;
      console.error(`${label} — FORWARD ERROR: ${errMsg}`);
      await sleep(DELAY_MS * 2);
      continue;
    }

    // Check if this is a WoF message
    if (!isWofMessage(forwarded, botInfo.id)) {
      try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
      skippedNotWof++;
      await sleep(DELAY_MS);
      continue;
    }

    // Extract username from caption and look up user
    const caption = forwarded.caption || '';
    const username = extractUsername(caption);
    let userId = null;

    if (username) {
      const { rows: userRows } = await query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [username]
      );
      if (userRows.length > 0) {
        userId = userRows[0].id;
      }
    }

    if (!userId) {
      console.log(`${label} — WoF detected but user not found (@${username || '?'}), skipping`);
      try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
      skippedNoUser++;
      await sleep(DELAY_MS);
      continue;
    }

    const originalDate = new Date((forwarded.forward_date || forwarded.date) * 1000);

    if (DRY_RUN) {
      const type = forwarded.photo ? 'image' : 'video';
      console.log(`${label} — DRY RUN: WoF ${type} by @${username} (${userId}), date: ${originalDate.toISOString()}`);
      try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
      await sleep(DELAY_MS);
      success++;
      continue;
    }

    // Extract file_id
    let fileId = null;
    let mediaType = 'image';
    let mimetype = 'image/jpeg';

    if (forwarded.photo && forwarded.photo.length > 0) {
      fileId = forwarded.photo[forwarded.photo.length - 1].file_id;
    } else if (forwarded.video) {
      fileId = forwarded.video.file_id;
      mediaType = 'video';
      mimetype = forwarded.video.mime_type || 'video/mp4';
    }

    try {
      // Download from Telegram
      let buffer;
      try {
        const fileLink = await bot.telegram.getFileLink(fileId);
        const response = await axios.get(fileLink.href, {
          responseType: 'arraybuffer',
          timeout: 60000,
        });
        buffer = Buffer.from(response.data);
      } catch (dlErr) {
        if (dlErr.message?.includes('file is too big')) {
          skippedTooBig++;
          console.log(`${label} — skipped (file too big for Bot API >20MB)`);
          try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
          await sleep(DELAY_MS);
          continue;
        }
        throw dlErr;
      }

      const ts = Date.now();

      // Process media
      let mediaUrl;
      if (mediaType === 'image') {
        ({ mediaUrl } = await processImage(buffer, userId, ts));
      } else {
        ({ mediaUrl } = await processVideo(buffer, mimetype, userId, ts));
      }

      // Insert into social_posts
      const { rows: inserted } = await query(
        `INSERT INTO social_posts
           (user_id, content, media_url, media_type, telegram_message_id, source_channel,
            is_wof, is_exclusive, is_shareable, created_at, updated_at)
         VALUES ($1, '', $2, $3, $4, 'wall_of_fame', true, false, true, $5, $5)
         ON CONFLICT (telegram_message_id) WHERE telegram_message_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [userId, mediaUrl, mediaType, msgId, originalDate]
      );

      if (inserted.length > 0) {
        success++;
        console.log(`${label} — OK (${mediaType} by @${username}, post #${inserted[0].id})`);
      } else {
        skippedDup++;
      }
    } catch (err) {
      failed++;
      console.error(`${label} — FAILED: ${err.message}`);
    }

    // Cleanup forwarded message
    try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
    await sleep(DELAY_MS);
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total scanned:       ${total}`);
  console.log(`Success (imported):  ${success}`);
  console.log(`Skipped (deleted):   ${skippedDeleted}`);
  console.log(`Skipped (not WoF):   ${skippedNotWof}`);
  console.log(`Skipped (dup):       ${skippedDup}`);
  console.log(`Skipped (no user):   ${skippedNoUser}`);
  console.log(`Skipped (too big):   ${skippedTooBig}`);
  console.log(`Failed:              ${failed}`);

  const pool = getPool();
  await pool.end();
  process.exit(failed > 10 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
