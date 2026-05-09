'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const axios = require('axios');
const { query } = require('../../../config/postgres');
const { getRedis } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const { entitiesToPlainText, extractMedia } = require('../../utils/telegramTextUtils');
const {
  uploadVideo,
  aiTitle,
  aiDescription,
  publishVideo,
  deleteVideo,
} = require('../../../services/channelVideoService');

const ADMIN_USER_ID = '8552451957'; // @pnptvadmin
const UPLOAD_DIR = path.join(__dirname, '../../../../public/uploads/posts');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function getUserByTelegramId(telegramId) {
  const { rows } = await query(
    'SELECT id, role FROM users WHERE telegram = $1 LIMIT 1',
    [String(telegramId)]
  );
  return rows[0] || null;
}

async function is2257Verified(userId) {
  const { rows } = await query(
    `SELECT 1 FROM creator_2257_records WHERE user_id = $1 AND verification_status = 'approved' LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

// Build the inline keyboard for a freshly imported video
function videoImportKeyboard(videoId) {
  return {
    inline_keyboard: [
      [
        { text: '✨ Título IA',       callback_data: `cv:title:${videoId}` },
        { text: '✨ Descripción IA',  callback_data: `cv:desc:${videoId}` },
      ],
      [
        { text: '✅ Publicar',        callback_data: `cv:pub:${videoId}` },
        { text: '🗑 Descartar',       callback_data: `cv:del:${videoId}` },
      ],
    ],
  };
}

// ─── Main registration ────────────────────────────────────────────────────────

function registerPrimeChannelMirrorHandler(bot) {
  const PRIME_CHANNEL_ID = process.env.PRIME_CHANNEL_ID;

  if (!PRIME_CHANNEL_ID) {
    logger.warn('[PrimeMirror] PRIME_CHANNEL_ID not set — prime mirror disabled, but creator bridge still active');
  }

  // ── channel_post: prime mirror + creator video bridge ──────────────────────

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

      if (!content.trim() && !mediaInfo) return;

      const originalDate = new Date(msg.date * 1000);
      const ts = Date.now();

      // ── Prime channel mirror ────────────────────────────────────────────────
      if (PRIME_CHANNEL_ID && chatId === PRIME_CHANNEL_ID) {
        const enabled = await isMirrorEnabled();
        if (enabled) {
          const { rows: existing } = await query(
            'SELECT 1 FROM social_posts WHERE telegram_message_id = $1 LIMIT 1',
            [messageId]
          );
          if (existing.length === 0) {
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

      // ── Creator channel bridge ──────────────────────────────────────────────
      const { rows: linked } = await query(
        `SELECT id, creator_id FROM creator_channels
         WHERE telegram_channel_id = $1 AND bridge_enabled = true AND is_active = true
         LIMIT 1`,
        [chatId]
      );

      if (linked.length === 0) return;

      const { id: creatorChannelId, creator_id: creatorId } = linked[0];
      const tgKey = `${chatId}:${messageId}`;

      // ── Video posts → channelVideoService pipeline ──────────────────────────
      if (mediaInfo && (mediaInfo.mediaType === 'video' || mediaInfo.mediaType === 'animation')) {
        const fileSizeBytes = msg.video?.file_size || msg.document?.file_size || msg.animation?.file_size || 0;
        const MAX_BOT_BYTES = 20 * 1024 * 1024; // 20 MB

        if (fileSizeBytes > MAX_BOT_BYTES) {
          // Too large for Bot API — notify creator to upload manually
          const sizeMb = Math.round(fileSizeBytes / 1024 / 1024);
          try {
            await ctx.telegram.sendMessage(
              creatorId,
              `⚠️ *Video demasiado grande para importar automáticamente*\n\n` +
              `El video de tu canal Telegram pesa ${sizeMb} MB (límite: 20 MB).\n\n` +
              `Súbelo directamente en PNPtv: https://pnptv.app`,
              { parse_mode: 'Markdown' }
            );
          } catch { /* non-fatal */ }
          return;
        }

        // Redis dedup — prevents double-processing the same message
        let redis;
        try { redis = getRedis(); } catch { /* continue without dedup */ }
        if (redis) {
          const dedupKey = `channel_bridge:video:${tgKey}`;
          const claimed = await redis.set(dedupKey, '1', 'EX', 86400, 'NX').catch(() => null);
          if (!claimed) return; // already imported
        }

        // Download video buffer
        let buffer;
        try {
          const fileLink = await ctx.telegram.getFileLink(mediaInfo.fileId);
          const resp = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 120000 });
          buffer = Buffer.from(resp.data);
        } catch (dlErr) {
          logger.warn(`[ChannelBridge] Video download failed for ${tgKey}: ${dlErr.message}`);
          if (redis) await redis.del(`channel_bridge:video:${tgKey}`).catch(() => {});
          return;
        }

        // Build multer-compatible file object for uploadVideo
        const mimeType = mediaInfo.mimetype || 'video/mp4';
        const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
        const pseudoFile = {
          buffer,
          originalname: `tg-${messageId}.${ext}`,
          mimetype: mimeType,
          size: buffer.length,
        };

        const importTitle = content.slice(0, 255) || `Importado de Telegram – ${new Date(msg.date * 1000).toLocaleDateString('es')}`;

        let video;
        try {
          // isAdmin:true bypasses loadOwnedChannel ownership check; ownership is
          // already verified by the telegram_channel_id ↔ creator_channels link above.
          video = await uploadVideo({
            channelId: creatorChannelId,
            uploaderId: creatorId,
            isAdmin: true,
            file: pseudoFile,
            title: importTitle,
          });
        } catch (uploadErr) {
          logger.error(`[ChannelBridge] uploadVideo failed for ${tgKey}: ${uploadErr.message}`);
          if (redis) await redis.del(`channel_bridge:video:${tgKey}`).catch(() => {});
          return;
        }

        // Store telegram_message_id on the video row (best-effort)
        await query(
          `UPDATE channel_videos SET telegram_message_id = $1 WHERE id = $2`,
          [tgKey, video.id]
        ).catch(() => {});

        logger.info(`[ChannelBridge] Video imported TG ${tgKey} → channel_video #${video.id}`);

        // DM creator with inline keyboard for review
        const webappUrl = `https://pnptv.app/channels/${creatorChannelId}/videos/${video.id}`;
        const durationStr = video.duration_sec
          ? `${Math.floor(video.duration_sec / 60)}:${String(video.duration_sec % 60).padStart(2, '0')} · `
          : '';
        const sizeMb = Math.round(buffer.length / 1024 / 1024);

        try {
          await ctx.telegram.sendMessage(
            creatorId,
            `📹 *Nuevo video importado* desde tu canal de Telegram\n\n` +
            `_${video.title}_\n` +
            `${durationStr}${sizeMb} MB\n\n` +
            `Revísalo y publícalo cuando estés listo. También puedes editarlo en:\n${webappUrl}`,
            {
              parse_mode: 'Markdown',
              reply_markup: videoImportKeyboard(video.id),
            }
          );
        } catch (dmErr) {
          logger.warn(`[ChannelBridge] Failed to DM creator ${creatorId}: ${dmErr.message}`);
        }

        return;
      }

      // ── Non-video posts → social_posts bridge (existing behaviour) ───────────
      const bridgeTs = ts + 1;
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
    } catch (err) {
      logger.error(`[PrimeMirror] Error handling channel_post:`, err.message);
    }
  });

  // ── Phase 2: my_chat_member — bot added as admin to a channel ──────────────

  bot.on('my_chat_member', async (ctx) => {
    try {
      const update = ctx.update.my_chat_member;
      if (!update) return;
      if (update.chat?.type !== 'channel') return;
      if (update.new_chat_member?.status !== 'administrator') return;

      const botId = ctx.botInfo?.id;
      if (!botId || update.new_chat_member?.user?.id !== botId) return;

      const fromTelegramId = String(update.from.id);
      const channelTgId   = String(update.chat.id);
      const channelTitle  = update.chat.title || channelTgId;

      // Require pending link state
      let redis;
      try { redis = getRedis(); } catch {
        return ctx.telegram.sendMessage(fromTelegramId,
          '⚠️ Error interno al vincular. Intenta de nuevo.').catch(() => {});
      }

      const pendingChannelId = await redis.get(`channel_bridge:pending:${fromTelegramId}`);
      if (!pendingChannelId) {
        // Bot was added without going through /linkchannel — ignore silently
        return;
      }

      // Look up PNPtv user
      const user = await getUserByTelegramId(fromTelegramId);
      if (!user) {
        return ctx.telegram.sendMessage(fromTelegramId,
          '⚠️ No se encontró tu cuenta PNPtv. Usa /start para registrarte.').catch(() => {});
      }

      // Verify 2257
      const verified = await is2257Verified(user.id);
      if (!verified) {
        await redis.del(`channel_bridge:pending:${fromTelegramId}`).catch(() => {});
        return ctx.telegram.sendMessage(fromTelegramId,
          '⚠️ Debes completar la verificación de identidad (2257) antes de activar el puente.\n\nhttps://pnptv.app/settings/identity'
        ).catch(() => {});
      }

      // Verify they own the pending channel
      const { rows: chRows } = await query(
        `SELECT id, name FROM creator_channels
         WHERE id = $1 AND creator_id = $2 AND is_active = true`,
        [pendingChannelId, user.id]
      );
      if (!chRows[0]) {
        await redis.del(`channel_bridge:pending:${fromTelegramId}`).catch(() => {});
        return ctx.telegram.sendMessage(fromTelegramId,
          '⚠️ El canal seleccionado no se encontró. Usa /linkchannel para intentarlo de nuevo.'
        ).catch(() => {});
      }

      // Check the Telegram channel ID isn't already linked to another PNPtv channel
      const { rows: conflict } = await query(
        `SELECT id FROM creator_channels WHERE telegram_channel_id = $1 AND id != $2`,
        [channelTgId, pendingChannelId]
      );
      if (conflict.length > 0) {
        await redis.del(`channel_bridge:pending:${fromTelegramId}`).catch(() => {});
        return ctx.telegram.sendMessage(fromTelegramId,
          `⚠️ El canal de Telegram *${channelTitle}* ya está vinculado a otro canal de PNPtv.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }

      // Link it
      await query(
        `UPDATE creator_channels
            SET telegram_channel_id = $1, bridge_enabled = true, updated_at = NOW()
          WHERE id = $2`,
        [channelTgId, pendingChannelId]
      );
      await redis.del(`channel_bridge:pending:${fromTelegramId}`).catch(() => {});

      logger.info(`[ChannelBridge] Linked TG channel ${channelTgId} → PNPtv channel #${pendingChannelId}`);

      await ctx.telegram.sendMessage(
        fromTelegramId,
        `✅ *Canal vinculado exitosamente*\n\n` +
        `Tu canal de Telegram *${channelTitle}* ahora está conectado a *${chRows[0].name}* en PNPtv.\n\n` +
        `A partir de ahora, los videos que publiques allí se importarán automáticamente como borradores para que los revises y publiques.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } catch (err) {
      logger.error('[ChannelBridge] my_chat_member error:', err.message);
    }
  });

  // ── Phase 2: /linkchannel command ──────────────────────────────────────────

  bot.command('linkchannel', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Usa este comando en privado con el bot.').catch(() => {});
    }

    try {
      const telegramId = String(ctx.from.id);

      const user = await getUserByTelegramId(telegramId);
      if (!user) {
        return ctx.reply('Primero conéctate a PNPtv en https://pnptv.app').catch(() => {});
      }

      const verified = await is2257Verified(user.id);
      if (!verified) {
        return ctx.reply(
          '⚠️ Para activar el puente de Telegram, primero completa la verificación de identidad (2257) en PNPtv.\n\nhttps://pnptv.app/settings/identity'
        ).catch(() => {});
      }

      const { rows: channels } = await query(
        `SELECT id, name, telegram_channel_id, bridge_enabled
           FROM creator_channels
          WHERE creator_id = $1 AND is_active = true
          ORDER BY name`,
        [user.id]
      );

      if (channels.length === 0) {
        return ctx.reply(
          'No tienes canales en PNPtv todavía. Crea uno primero en https://pnptv.app/channels'
        ).catch(() => {});
      }

      const keyboard = channels.map((ch) => [{
        text: ch.bridge_enabled ? `${ch.name} ✓ vinculado` : ch.name,
        callback_data: `cl:${ch.id}`,
      }]);

      return ctx.reply(
        '📡 *Vincular canal de Telegram*\n\n¿A cuál de tus canales deseas vincular?',
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
      ).catch(() => {});
    } catch (err) {
      logger.error('[ChannelBridge] /linkchannel error:', err.message);
    }
  });

  bot.action(/^cl:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      const channelId = ctx.match[1];
      const telegramId = String(ctx.from.id);

      const user = await getUserByTelegramId(telegramId);
      if (!user) return ctx.answerCbQuery('No autorizado').catch(() => {});

      const { rows } = await query(
        'SELECT id, name FROM creator_channels WHERE id = $1 AND creator_id = $2 AND is_active = true',
        [channelId, user.id]
      );
      if (!rows[0]) return ctx.editMessageText('Canal no encontrado.').catch(() => {});

      const redis = getRedis();
      await redis.set(`channel_bridge:pending:${telegramId}`, String(channelId), 'EX', 900);

      const botUsername = process.env.BOT_USERNAME || 'PNPLatinoTV_bot';
      await ctx.editMessageText(
        `📡 *Vincular "${rows[0].name}"*\n\n` +
        `Sigue estos pasos:\n\n` +
        `1️⃣ Abre tu canal en Telegram\n` +
        `2️⃣ Ve a *Gestionar canal › Administradores › Agregar admin*\n` +
        `3️⃣ Busca @${botUsername} y agrégalo como administrador\n\n` +
        `El bot confirmará automáticamente en cuanto sea agregado.\n` +
        `_(Esta ventana expira en 15 minutos)_`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } catch (err) {
      logger.error('[ChannelBridge] cl: callback error:', err.message);
    }
  });

  // ── Phase 3: Post-import inline keyboard callbacks ──────────────────────────

  bot.action(/^cv:(title|desc|pub|del):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const [, action, videoId] = ctx.match;

    try {
      const telegramId = String(ctx.from.id);
      const user = await getUserByTelegramId(telegramId);
      if (!user) return ctx.answerCbQuery('No autorizado').catch(() => {});

      switch (action) {
        case 'title': {
          const result = await aiTitle({ videoId: Number(videoId), userId: user.id, isAdmin: false });
          await ctx.editMessageText(
            `📹 *Título generado por IA*\n\n"${result.title}"\n\n_Puedes editarlo en PNPtv antes de publicar._`,
            { parse_mode: 'Markdown', reply_markup: videoImportKeyboard(videoId) }
          ).catch(() => {});
          break;
        }
        case 'desc': {
          const result = await aiDescription({ videoId: Number(videoId), userId: user.id, isAdmin: false });
          const preview = result.description.slice(0, 200);
          await ctx.editMessageText(
            `📹 *Descripción generada por IA*\n\n${preview}${result.description.length > 200 ? '…' : ''}\n\n_Puedes editarla en PNPtv antes de publicar._`,
            { parse_mode: 'Markdown', reply_markup: videoImportKeyboard(videoId) }
          ).catch(() => {});
          break;
        }
        case 'pub': {
          await publishVideo({ videoId: Number(videoId), userId: user.id, isAdmin: false });
          await ctx.editMessageText(
            `✅ *¡Video publicado en PNPtv!*\n\nTus seguidores han sido notificados.`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
          break;
        }
        case 'del': {
          await deleteVideo({ videoId: Number(videoId), userId: user.id, isAdmin: false });
          await ctx.editMessageText('🗑 Video descartado.').catch(() => {});
          break;
        }
      }
    } catch (err) {
      logger.error(`[ChannelBridge] cv:${action} callback error:`, err.message);
      await ctx.editMessageText(
        `⚠️ Error al procesar: ${err.message.slice(0, 120)}\n\nIntenta desde https://pnptv.app`
      ).catch(() => {});
    }
  });

  // ── Phase 4: /setchanneltier command ───────────────────────────────────────

  bot.command('setchanneltier', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Usa este comando en privado con el bot.').catch(() => {});
    }

    try {
      const telegramId = String(ctx.from.id);
      const user = await getUserByTelegramId(telegramId);
      if (!user) return ctx.reply('Conecta tu cuenta en https://pnptv.app').catch(() => {});

      const { rows: channels } = await query(
        `SELECT id, name, access_type, bridge_enabled
           FROM creator_channels
          WHERE creator_id = $1 AND is_active = true
          ORDER BY name`,
        [user.id]
      );

      if (channels.length === 0) {
        return ctx.reply('No tienes canales en PNPtv.').catch(() => {});
      }

      const TIER_LABELS = { free: '🆓 Gratis', subscription: '⭐ Suscripción', prime: '👑 Prime', paid: '💰 De pago' };

      const keyboard = channels.map((ch) => [{
        text: `${ch.name} · ${TIER_LABELS[ch.access_type] || ch.access_type}`,
        callback_data: `ct_ch:${ch.id}`,
      }]);

      return ctx.reply(
        '💰 *Nivel de acceso del canal*\n\n¿Para cuál canal deseas cambiar el nivel?',
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
      ).catch(() => {});
    } catch (err) {
      logger.error('[ChannelBridge] /setchanneltier error:', err.message);
    }
  });

  bot.action(/^ct_ch:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      const channelId = ctx.match[1];
      const telegramId = String(ctx.from.id);
      const user = await getUserByTelegramId(telegramId);
      if (!user) return;

      const { rows } = await query(
        'SELECT id, name, access_type FROM creator_channels WHERE id = $1 AND creator_id = $2',
        [channelId, user.id]
      );
      if (!rows[0]) return ctx.editMessageText('Canal no encontrado.').catch(() => {});

      const TIER_LABELS = { free: '🆓 Gratis', subscription: '⭐ Suscripción', prime: '👑 Prime', paid: '💰 De pago' };

      await ctx.editMessageText(
        `💰 *${rows[0].name}*\nNivel actual: ${TIER_LABELS[rows[0].access_type] || rows[0].access_type}\n\n¿Cuál nivel deseas establecer?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🆓 Gratis',       callback_data: `ct_set:${channelId}:free` },
                { text: '⭐ Suscripción', callback_data: `ct_set:${channelId}:subscription` },
              ],
              [
                { text: '👑 Prime',        callback_data: `ct_set:${channelId}:prime` },
                { text: '💰 De pago',      callback_data: `ct_set:${channelId}:paid` },
              ],
            ],
          },
        }
      ).catch(() => {});
    } catch (err) {
      logger.error('[ChannelBridge] ct_ch: callback error:', err.message);
    }
  });

  bot.action(/^ct_set:(\d+):(free|subscription|prime|paid)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      const [, channelId, tier] = ctx.match;
      const telegramId = String(ctx.from.id);
      const user = await getUserByTelegramId(telegramId);
      if (!user) return;

      const { rows } = await query(
        `UPDATE creator_channels
            SET access_type = $1, updated_at = NOW()
          WHERE id = $2 AND creator_id = $3
          RETURNING name`,
        [tier, channelId, user.id]
      );
      if (!rows[0]) return ctx.editMessageText('Canal no encontrado.').catch(() => {});

      const TIER_LABELS = { free: '🆓 Gratis', subscription: '⭐ Suscripción', prime: '👑 Prime', paid: '💰 De pago' };
      logger.info(`[ChannelBridge] Channel #${channelId} access_type set to ${tier} by ${user.id}`);

      await ctx.editMessageText(
        `✅ *${rows[0].name}* actualizado a ${TIER_LABELS[tier]}.\n\nNuevos videos importados de Telegram usarán este nivel.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } catch (err) {
      logger.error('[ChannelBridge] ct_set: callback error:', err.message);
    }
  });

  logger.info('[PrimeMirror] Channel post handler registered (prime mirror + creator bridge v2)');
}

module.exports = { registerPrimeChannelMirrorHandler };
