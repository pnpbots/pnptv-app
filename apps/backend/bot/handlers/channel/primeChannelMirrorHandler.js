'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const axios = require('axios');
const { query } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const { entitiesToPlainText, extractMedia } = require('../../utils/telegramTextUtils');

const ADMIN_USER_ID = '8552451957'; // @pnptvadmin
const UPLOAD_DIR = path.join(__dirname, '../../../../public/uploads/posts');

async function isMirrorEnabled() {
  try {
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE key = 'prime_channel_mirror_enabled'"
    );
    return rows[0]?.value === 'true';
  } catch {
    return false;
  }
}

async function processAndSaveImage(buffer, userId, ts) {
  const filename = `img-${userId}-${ts}.webp`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  await sharp(buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70, progressive: true })
    .toFile(filePath);
  return { mediaUrl: `/uploads/posts/${filename}`, mediaType: 'image' };
}

async function processAndSaveVideo(buffer, userId, mimetype, ts) {
  const ext = mimetype && mimetype.includes('webm') ? 'webm' : 'mp4';
  const filename = `vid-${userId}-${ts}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.promises.writeFile(filePath, buffer);
  return { mediaUrl: `/uploads/posts/${filename}`, mediaType: 'video' };
}

async function downloadMedia(ctx, mediaInfo, userId, ts) {
  const fileLink = await ctx.telegram.getFileLink(mediaInfo.fileId);
  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 60000 });
  const buffer = Buffer.from(response.data);
  if (mediaInfo.mediaType === 'image') {
    return processAndSaveImage(buffer, userId, ts);
  }
  return processAndSaveVideo(buffer, userId, mediaInfo.mimetype, ts);
}

function registerPrimeChannelMirrorHandler(bot) {
  const PRIME_CHANNEL_ID = process.env.PRIME_CHANNEL_ID;

  if (!PRIME_CHANNEL_ID) {
    logger.warn('[PrimeMirror] PRIME_CHANNEL_ID not set — prime mirror disabled, but creator bridge still active');
  }

  bot.on('channel_post', async (ctx) => {
    try {
      const chatId = ctx.chat?.id?.toString();
      const msg = ctx.channelPost;
      if (!msg) return;

      // Skip service messages
      if (msg.new_chat_members || msg.left_chat_member || msg.pinned_message ||
          msg.new_chat_title || msg.new_chat_photo || msg.delete_chat_photo) {
        return;
      }

      const messageId = msg.message_id;
      const text = msg.text || msg.caption || '';
      const entities = msg.entities || msg.caption_entities || [];
      const content = entitiesToPlainText(text, entities);
      const mediaInfo = extractMedia(msg);

      // Skip posts with no content and no media
      if (!content.trim() && !mediaInfo) return;

      const originalDate = new Date(msg.date * 1000);
      const ts = Date.now();

      // ── Prime channel mirror ──────────────────────────────────────────────
      if (PRIME_CHANNEL_ID && chatId === PRIME_CHANNEL_ID) {
        const enabled = await isMirrorEnabled();
        if (enabled) {
          // Deduplication
          const { rows: existing } = await query(
            'SELECT 1 FROM social_posts WHERE telegram_message_id = $1 LIMIT 1',
            [messageId]
          );
          if (existing.length === 0) {
            // Album deduplication via Redis
            if (msg.media_group_id) {
              try {
                const redis = getRedis();
                const key = `prime_mirror:album:${msg.media_group_id}`;
                const seen = await redis.get(key);
                if (seen) return;
                await redis.set(key, '1', 'EX', 5);
              } catch (redisErr) {
                logger.warn(`[PrimeMirror] Redis album check failed, continuing: ${redisErr.message}`);
              }
            }

            let mediaUrl = null;
            let mediaType = null;
            if (mediaInfo) {
              ({ mediaUrl, mediaType } = await downloadMedia(ctx, mediaInfo, ADMIN_USER_ID, ts));
            }

            const { rows } = await query(
              `INSERT INTO social_posts
                 (user_id, content, media_url, media_type, telegram_message_id, source_channel,
                  is_wof, is_exclusive, is_shareable, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'prime_channel', false, false, true, $6, $6)
               ON CONFLICT (telegram_message_id) WHERE telegram_message_id IS NOT NULL DO NOTHING
               RETURNING id`,
              [ADMIN_USER_ID, content || '', mediaUrl, mediaType, messageId, originalDate]
            );

            const postId = rows[0]?.id;
            if (postId) {
              await query(
                `INSERT INTO prime_channel_migration_log (message_id, status, post_id, media_type)
                 VALUES ($1, 'success', $2, $3)
                 ON CONFLICT (message_id) DO UPDATE SET status='success', post_id=$2`,
                [messageId, postId, mediaType]
              );
              logger.info(`[PrimeMirror] Mirrored channel_post ${messageId} → social post #${postId}`);
            }
          }
        }
      }

      // ── Creator channel bridge ────────────────────────────────────────────
      // Look up any active creator channel linked to this Telegram channel.
      // Bridge posts use NULL telegram_message_id to avoid conflicts with prime posts.
      const { rows: linked } = await query(
        `SELECT id, creator_id FROM creator_channels
         WHERE telegram_channel_id = $1 AND bridge_enabled = true AND is_active = true
         LIMIT 1`,
        [chatId]
      );

      if (linked.length > 0) {
        const { id: creatorChannelId, creator_id: creatorId } = linked[0];
        const bridgeTs = ts + 1; // distinct timestamp from prime

        let bridgeMediaUrl = null;
        let bridgeMediaType = null;
        if (mediaInfo) {
          try {
            ({ mediaUrl: bridgeMediaUrl, mediaType: bridgeMediaType } = await downloadMedia(ctx, mediaInfo, creatorId, bridgeTs));
          } catch (mediaErr) {
            logger.warn(`[ChannelBridge] Media download failed for channel ${creatorChannelId}: ${mediaErr.message}`);
          }
        }

        const { rows: bridgeRows } = await query(
          `INSERT INTO social_posts
             (user_id, content, media_url, media_type, channel_id,
              source_channel, is_wof, is_exclusive, is_shareable, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'channel_bridge', false, false, true, $6, $6)
           RETURNING id`,
          [creatorId, content || '', bridgeMediaUrl, bridgeMediaType, creatorChannelId, originalDate]
        );

        if (bridgeRows[0]?.id) {
          await query(
            `UPDATE creator_channels SET post_count = post_count + 1, updated_at = NOW() WHERE id = $1`,
            [creatorChannelId]
          );
          logger.info(`[ChannelBridge] Bridged TG ${chatId} → app channel #${creatorChannelId} post #${bridgeRows[0].id}`);
        }
      }
    } catch (err) {
      logger.error(`[PrimeMirror] Error handling channel_post:`, err.message);
    }
  });

  logger.info('[PrimeMirror] Channel post handler registered (prime mirror + creator bridge)');
}

module.exports = { registerPrimeChannelMirrorHandler };
