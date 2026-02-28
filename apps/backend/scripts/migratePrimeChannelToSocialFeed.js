#!/usr/bin/env node
'use strict';

/**
 * migratePrimeChannelToSocialFeed.js
 *
 * One-time migration script: imports existing PRIME channel content from
 * Telegram into the Directus CMS `content` collection (for the PRIME video page)
 * and text-only posts into social_posts.
 *
 * Usage (inside Docker):
 *   docker exec pnptv-bot node apps/backend/scripts/migratePrimeChannelToSocialFeed.js
 *
 * Env vars:
 *   MIGRATE_START_ID  - First message ID to try (default: 1)
 *   MIGRATE_END_ID    - Last message ID to try (default: 5000)
 *   MIGRATE_DRY_RUN   - If 'true', forward and extract but don't write
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const FormData = require('form-data');

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
const FORWARD_TARGET = process.env.MIGRATE_FORWARD_TARGET || process.env.NOTIFICATION_CHANNEL_ID || process.env.SUPPORT_GROUP_ID;

// Directus CMS
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

const START_ID = parseInt(process.env.MIGRATE_START_ID || '1', 10);
const END_ID = parseInt(process.env.MIGRATE_END_ID || '5000', 10);
const DRY_RUN = process.env.MIGRATE_DRY_RUN === 'true';
const DELAY_MS = 500;

const UPLOAD_DIR = path.join(BACKEND_ROOT, '../../public/uploads/posts');

if (!BOT_TOKEN) { console.error('ERROR: BOT_TOKEN required'); process.exit(1); }
if (!PRIME_CHANNEL_ID) { console.error('ERROR: PRIME_CHANNEL_ID required'); process.exit(1); }
if (!FORWARD_TARGET) { console.error('ERROR: No forward target (set NOTIFICATION_CHANNEL_ID or SUPPORT_GROUP_ID)'); process.exit(1); }
if (!DIRECTUS_TOKEN) { console.error('ERROR: DIRECTUS_ADMIN_TOKEN required'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);
const directusApi = axios.create({
  baseURL: DIRECTUS_URL,
  headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a video buffer to Directus files API, returns the file UUID.
 */
async function uploadToDirectus(buffer, filename, mimetype) {
  const form = new FormData();
  form.append('title', filename);
  form.append('file', buffer, { filename, contentType: mimetype });
  const resp = await directusApi.post('/files', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  });
  return resp.data.data.id; // UUID
}

/**
 * Create a Directus content item for PRIME video.
 */
async function createDirectusContent({ title, description, mediaUrl, thumbnailId, type, durationSeconds }) {
  const resp = await directusApi.post('/items/content', {
    status: 'published',
    title: title || 'PRIME Video',
    description: description || null,
    type: type || 'video',
    media_url: mediaUrl,
    thumbnail: thumbnailId || null,
    duration_seconds: durationSeconds || null,
    is_premium: true,
    tags: ['prime', 'migrated'],
  });
  return resp.data.data;
}

/**
 * Save video locally and return the public URL path.
 */
async function saveVideoLocally(buffer, mimetype, ts) {
  const ext = mimetype && mimetype.includes('webm') ? 'webm' : 'mp4';
  const filename = `vid-prime-${ts}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return `/uploads/posts/${filename}`;
}

/**
 * Generate a thumbnail from the first frame of a video using sharp.
 * Falls back to null if it fails (sharp can't extract video frames).
 */
async function generateThumbnailFromImage(buffer) {
  try {
    const thumbBuffer = await sharp(buffer)
      .resize(480, 270, { fit: 'cover' })
      .webp({ quality: 60 })
      .toBuffer();
    return thumbBuffer;
  } catch {
    return null;
  }
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
  console.log('=== PRIME Channel → Directus PRIME + Social Feed Migration ===');
  console.log(`Channel: ${PRIME_CHANNEL_ID}`);
  console.log(`Directus: ${DIRECTUS_URL}`);
  console.log(`Range: message IDs ${START_ID} to ${END_ID}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('');

  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });

  // Verify Directus connectivity
  try {
    await directusApi.get('/server/ping');
    console.log('Directus: connected');
  } catch (e) {
    console.error(`ERROR: Cannot reach Directus at ${DIRECTUS_URL}: ${e.message}`);
    process.exit(1);
  }

  const botInfo = await bot.telegram.getMe();
  console.log(`Bot: @${botInfo.username} (${botInfo.id})`);
  console.log(`Forward target: ${FORWARD_TARGET}`);
  console.log('');

  let total = 0;
  let successVideo = 0;
  let successImage = 0;
  let successText = 0;
  let skippedDeleted = 0;
  let skippedDup = 0;
  let skippedNoContent = 0;
  let skippedAlbum = 0;
  let skippedTooBig = 0;
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

    // Forward message from PRIME channel to helper chat
    let forwarded;
    try {
      forwarded = await bot.telegram.forwardMessage(
        Number(FORWARD_TARGET),
        Number(PRIME_CHANNEL_ID),
        msgId
      );
      consecutiveNotFound = 0;
    } catch (fwdErr) {
      const errMsg = fwdErr.message || '';
      if (errMsg.includes('message to forward not found') ||
          errMsg.includes('message not found') ||
          errMsg.includes('MESSAGE_ID_INVALID') ||
          errMsg.includes('message to copy not found') ||
          errMsg.includes("message can't be copied") ||
          errMsg.includes("message can't be forwarded") ||
          errMsg.includes('protected content')) {
        skippedDeleted++;
        await logMigration(msgId, 'deleted', null, null, errMsg);
        consecutiveNotFound++;
        if (consecutiveNotFound >= 100 && msgId > START_ID + 10) {
          console.log(`\n${label} — 100 consecutive "not found" — assuming end of channel`);
          break;
        }
        continue;
      }
      failed++;
      await logMigration(msgId, 'failed', null, null, errMsg);
      console.error(`${label} — FORWARD ERROR: ${errMsg}`);
      await sleep(DELAY_MS * 2);
      continue;
    }

    // Album handling
    if (forwarded.media_group_id) {
      if (forwarded.media_group_id === lastMediaGroupId) {
        try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
        skippedAlbum++;
        await logMigration(msgId, 'skipped', null, null, 'album_non_first');
        await sleep(DELAY_MS);
        continue;
      }
      lastMediaGroupId = forwarded.media_group_id;
    } else {
      lastMediaGroupId = null;
    }

    // Extract content and media
    const text = forwarded.text || forwarded.caption || '';
    const entities = forwarded.entities || forwarded.caption_entities || [];
    const content = entitiesToPlainText(text, entities);
    const mediaInfo = extractMedia(forwarded);

    if (!content.trim() && !mediaInfo) {
      try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
      skippedNoContent++;
      await logMigration(msgId, 'skipped', null, null, 'no_content');
      await sleep(DELAY_MS);
      continue;
    }

    const originalDate = new Date((forwarded.forward_date || forwarded.date) * 1000);

    if (DRY_RUN) {
      const mediaLabel = mediaInfo ? `${mediaInfo.mediaType} (${mediaInfo.mimetype})` : 'text-only';
      console.log(`${label} — DRY RUN: ${mediaLabel}, ${content.length} chars, date: ${originalDate.toISOString()}`);
      try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
      await sleep(DELAY_MS);
      continue;
    }

    try {
      if (mediaInfo && (mediaInfo.mediaType === 'video' || mediaInfo.mediaType === 'image')) {
        // ── VIDEO/IMAGE → Directus PRIME content ──────────────────────────
        let buffer;
        try {
          const fileLink = await bot.telegram.getFileLink(mediaInfo.fileId);
          const response = await axios.get(fileLink.href, {
            responseType: 'arraybuffer',
            timeout: 120000,
          });
          buffer = Buffer.from(response.data);
        } catch (dlErr) {
          if (dlErr.message?.includes('file is too big')) {
            skippedTooBig++;
            await logMigration(msgId, 'skipped', null, mediaInfo.mediaType, 'file_too_big_for_bot_api');
            console.log(`${label} — skipped (file too big for Bot API >20MB)`);
            try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
            await sleep(DELAY_MS);
            continue;
          }
          throw dlErr;
        }

        const ts = Date.now();

        // Save locally for direct serving
        const localUrl = await saveVideoLocally(buffer, mediaInfo.mimetype, ts);

        // Upload to Directus files
        const ext = mediaInfo.mimetype?.includes('webm') ? 'webm' : 'mp4';
        const filename = `prime-${msgId}-${ts}.${ext}`;
        const fileId = await uploadToDirectus(buffer, filename, mediaInfo.mimetype || 'video/mp4');

        // Generate title from caption (first line or first 80 chars)
        const title = (content.split('\n')[0] || `PRIME Video #${msgId}`).slice(0, 200);

        // Get video duration if available
        const duration = forwarded.video?.duration || forwarded.animation?.duration || null;

        // Create Directus content item
        const item = await createDirectusContent({
          title,
          description: content || null,
          mediaUrl: localUrl,
          thumbnailId: fileId, // Use the video file itself as thumbnail (Directus generates previews)
          type: 'video',
          durationSeconds: duration,
        });

        await logMigration(msgId, 'success', item.id, 'video', null);
        successVideo++;
        console.log(`${label} — OK (video → Directus #${item.id}, ${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

      } else {
        // ── TEXT-ONLY → social_posts ──────────────────────────────────────
        const { rows } = await query(
          `INSERT INTO social_posts
             (user_id, content, media_url, media_type, telegram_message_id, source_channel,
              is_wof, is_exclusive, is_shareable, created_at, updated_at)
           VALUES ($1, $2, NULL, NULL, $3, 'prime_channel', false, false, true, $4, $4)
           ON CONFLICT (telegram_message_id) WHERE telegram_message_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [ADMIN_USER_ID, content || '', msgId, originalDate]
        );

        const postId = rows[0]?.id;
        if (postId) {
          await logMigration(msgId, 'success', postId, 'text', null);
          successText++;
          console.log(`${label} — OK (text → social post #${postId})`);
        } else {
          skippedDup++;
          await logMigration(msgId, 'skipped', null, null, 'duplicate');
        }
      }
    } catch (err) {
      failed++;
      await logMigration(msgId, 'failed', null, null, err.message);
      console.error(`${label} — FAILED: ${err.message}`);
    }

    try { await bot.telegram.deleteMessage(Number(FORWARD_TARGET), forwarded.message_id); } catch (_) {}
    await sleep(DELAY_MS);
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total attempted:     ${total}`);
  console.log(`Success (video→CMS): ${successVideo}`);
  console.log(`Success (text→feed): ${successText}`);
  console.log(`Skipped (deleted):   ${skippedDeleted}`);
  console.log(`Skipped (dup):       ${skippedDup}`);
  console.log(`Skipped (too big):   ${skippedTooBig}`);
  console.log(`Skipped (no data):   ${skippedNoContent}`);
  console.log(`Skipped (album):     ${skippedAlbum}`);
  console.log(`Failed:              ${failed}`);

  const pool = getPool();
  await pool.end();
  process.exit(failed > 10 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
