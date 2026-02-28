#!/usr/bin/env node
'use strict';

/**
 * migratePrimeChannelToSocialFeed.js
 *
 * One-time migration script: imports existing PRIME channel content from
 * Telegram into the webapp's social_posts table.
 *
 * Usage (inside Docker):
 *   docker exec -it pnptv-bot node apps/backend/scripts/migratePrimeChannelToSocialFeed.js
 *
 * With options:
 *   docker exec -e MIGRATE_START_ID=1 -e MIGRATE_END_ID=2000 -it pnptv-bot \
 *     node apps/backend/scripts/migratePrimeChannelToSocialFeed.js
 *
 * Env vars:
 *   MIGRATE_START_ID  - First message ID to try (default: 1)
 *   MIGRATE_END_ID    - Last message ID to try (default: 5000)
 *   MIGRATE_DRY_RUN   - If 'true', forward and extract but don't write to DB
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { Telegraf } = require('telegraf');
const axios = require('axios');
const { getPool, query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));
const { entitiesToPlainText, extractMedia } = require(path.join(BACKEND_ROOT, 'bot/utils/telegramTextUtils'));

const BOT_TOKEN = process.env.BOT_TOKEN;
const PRIME_CHANNEL_ID = process.env.PRIME_CHANNEL_ID;
const ADMIN_USER_ID = '8552451957'; // @pnptvadmin

const START_ID = parseInt(process.env.MIGRATE_START_ID || '1', 10);
const END_ID = parseInt(process.env.MIGRATE_END_ID || '5000', 10);
const DRY_RUN = process.env.MIGRATE_DRY_RUN === 'true';
const DELAY_MS = 500;

const UPLOAD_DIR = path.join(BACKEND_ROOT, '../../public/uploads/posts');

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!PRIME_CHANNEL_ID) {
  console.error('ERROR: PRIME_CHANNEL_ID environment variable is required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processImage(buffer, ts) {
  const filename = `img-${ADMIN_USER_ID}-${ts}.webp`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await sharp(buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70, progressive: true })
    .toFile(filePath);
  return { mediaUrl: `/uploads/posts/${filename}`, mediaType: 'image' };
}

async function processVideo(buffer, mimetype, ts) {
  const ext = mimetype && mimetype.includes('webm') ? 'webm' : 'mp4';
  const filename = `vid-${ADMIN_USER_ID}-${ts}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return { mediaUrl: `/uploads/posts/${filename}`, mediaType: 'video' };
}

async function logMigration(messageId, status, postId, mediaType, errorMsg) {
  if (DRY_RUN) return;
  await query(
    `INSERT INTO prime_channel_migration_log (message_id, status, post_id, media_type, error_msg)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (message_id) DO UPDATE SET status=$2, post_id=$3, error_msg=$5, attempted_at=NOW()`,
    [messageId, status, postId || null, mediaType || null, errorMsg || null]
  );
}

async function main() {
  console.log('=== PRIME Channel → Social Feed Migration ===');
  console.log(`Channel: ${PRIME_CHANNEL_ID}`);
  console.log(`Range: message IDs ${START_ID} to ${END_ID}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('');

  // Ensure upload directory exists
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });

  // Get bot info
  const botInfo = await bot.telegram.getMe();
  console.log(`Bot: @${botInfo.username} (${botInfo.id})`);

  let total = 0;
  let successImage = 0;
  let successVideo = 0;
  let successText = 0;
  let skippedDeleted = 0;
  let skippedDup = 0;
  let skippedNoContent = 0;
  let skippedAlbum = 0;
  let failed = 0;
  let consecutiveNotFound = 0;
  let lastMediaGroupId = null;

  for (let msgId = START_ID; msgId <= END_ID; msgId++) {
    total++;
    const label = `[${msgId}/${END_ID}]`;

    // Check if already processed
    if (!DRY_RUN) {
      const { rows: logRows } = await query(
        'SELECT status FROM prime_channel_migration_log WHERE message_id = $1',
        [msgId]
      );
      if (logRows.length > 0) {
        if (logRows[0].status === 'success') skippedDup++;
        else if (logRows[0].status === 'deleted') skippedDeleted++;
        else skippedNoContent++;
        continue;
      }
    }

    // Forward message from PRIME channel to bot's own chat
    let forwarded;
    try {
      forwarded = await bot.telegram.forwardMessage(
        botInfo.id,
        Number(PRIME_CHANNEL_ID),
        msgId
      );
      consecutiveNotFound = 0;
    } catch (fwdErr) {
      const errMsg = fwdErr.message || '';
      if (errMsg.includes('message to forward not found') ||
          errMsg.includes('message not found') ||
          errMsg.includes('MESSAGE_ID_INVALID') ||
          errMsg.includes('message to copy not found')) {
        skippedDeleted++;
        await logMigration(msgId, 'deleted', null, null, errMsg);
        consecutiveNotFound++;

        // If we've seen 100 consecutive "not found" past the first 10 messages,
        // we've likely reached the end of the channel
        if (consecutiveNotFound >= 100 && msgId > START_ID + 10) {
          console.log(`\n${label} — 100 consecutive "not found" — assuming end of channel`);
          break;
        }
        continue;
      }
      // Rate limit or other error
      failed++;
      await logMigration(msgId, 'failed', null, null, errMsg);
      console.error(`${label} — FORWARD ERROR: ${errMsg}`);
      await sleep(DELAY_MS * 2);
      continue;
    }

    // Album handling: skip non-first items in media groups
    if (forwarded.media_group_id) {
      if (forwarded.media_group_id === lastMediaGroupId) {
        // Non-first album item — skip
        try { await bot.telegram.deleteMessage(botInfo.id, forwarded.message_id); } catch (_) {}
        skippedAlbum++;
        await logMigration(msgId, 'skipped', null, null, 'album_non_first');
        await sleep(DELAY_MS);
        continue;
      }
      lastMediaGroupId = forwarded.media_group_id;
    } else {
      lastMediaGroupId = null;
    }

    // Extract content
    const text = forwarded.text || forwarded.caption || '';
    const entities = forwarded.entities || forwarded.caption_entities || [];
    const content = entitiesToPlainText(text, entities);

    // Extract media
    const mediaInfo = extractMedia(forwarded);

    // Skip service messages and unsupported content
    if (!content.trim() && !mediaInfo) {
      try { await bot.telegram.deleteMessage(botInfo.id, forwarded.message_id); } catch (_) {}
      skippedNoContent++;
      await logMigration(msgId, 'skipped', null, null, 'no_content');
      await sleep(DELAY_MS);
      continue;
    }

    // Get original date from forwarded message
    const originalDate = new Date((forwarded.forward_date || forwarded.date) * 1000);

    if (DRY_RUN) {
      const mediaLabel = mediaInfo ? `${mediaInfo.mediaType} (${mediaInfo.mimetype})` : 'text-only';
      console.log(`${label} — DRY RUN: ${mediaLabel}, ${content.length} chars, date: ${originalDate.toISOString()}`);
      try { await bot.telegram.deleteMessage(botInfo.id, forwarded.message_id); } catch (_) {}
      await sleep(DELAY_MS);
      continue;
    }

    try {
      let mediaUrl = null;
      let mediaType = null;
      const ts = Date.now();

      if (mediaInfo) {
        const fileLink = await bot.telegram.getFileLink(mediaInfo.fileId);
        const response = await axios.get(fileLink.href, {
          responseType: 'arraybuffer',
          timeout: 60000,
        });
        const buffer = Buffer.from(response.data);

        if (mediaInfo.mediaType === 'image') {
          const result = await processImage(buffer, ts);
          mediaUrl = result.mediaUrl;
          mediaType = result.mediaType;
        } else {
          const result = await processVideo(buffer, mediaInfo.mimetype, ts);
          mediaUrl = result.mediaUrl;
          mediaType = result.mediaType;
        }
      }

      // Insert into social_posts
      const { rows } = await query(
        `INSERT INTO social_posts
           (user_id, content, media_url, media_type, telegram_message_id, source_channel,
            is_wof, is_exclusive, is_shareable, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'prime_channel', false, false, true, $6, $6)
         ON CONFLICT (telegram_message_id) WHERE telegram_message_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [ADMIN_USER_ID, content || '', mediaUrl, mediaType, msgId, originalDate]
      );

      const postId = rows[0]?.id;

      if (postId) {
        await logMigration(msgId, 'success', postId, mediaType, null);
        if (mediaType === 'image') successImage++;
        else if (mediaType === 'video') successVideo++;
        else successText++;
        console.log(`${label} — OK (${mediaType || 'text'}, post #${postId})`);
      } else {
        skippedDup++;
        await logMigration(msgId, 'skipped', null, null, 'duplicate');
        console.log(`${label} — already exists (duplicate)`);
      }
    } catch (err) {
      failed++;
      await logMigration(msgId, 'failed', null, null, err.message);
      console.error(`${label} — FAILED: ${err.message}`);
    }

    // Clean up forwarded copy
    try { await bot.telegram.deleteMessage(botInfo.id, forwarded.message_id); } catch (_) {}

    await sleep(DELAY_MS);
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total attempted:    ${total}`);
  console.log(`Success (image):    ${successImage}`);
  console.log(`Success (video):    ${successVideo}`);
  console.log(`Success (text):     ${successText}`);
  console.log(`Skipped (deleted):  ${skippedDeleted}`);
  console.log(`Skipped (dup):      ${skippedDup}`);
  console.log(`Skipped (no data):  ${skippedNoContent}`);
  console.log(`Skipped (album):    ${skippedAlbum}`);
  console.log(`Failed:             ${failed}`);

  const pool = getPool();
  await pool.end();
  process.exit(failed > 10 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
