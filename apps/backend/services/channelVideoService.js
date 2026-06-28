'use strict';
/**
 * channelVideoService — universal "upload a video to my channel" pipeline.
 *
 * Replaces the admin-only /admin/prime-videos/upload flow for non-admin
 * creators. Each creator who owns a creator_channels row (or is in the
 * collaborators array) can:
 *
 *   1. uploadVideo()       → POST file to Directus, INSERT channel_videos (status=processing)
 *   2. aiTitle/aiDesc/aiTags → Grok-assisted metadata generation, stored on the row
 *   3. updateVideo()       → patch title/description/tags pre-publish
 *   4. publishVideo()      → generate 3s GIF via ffmpeg, create promo social_post,
 *                            mark status=published. GIF failures fall back to JPG.
 *   5. deleteVideo()       → soft-delete + tombstone the promo post
 *
 * Per-channel access_type ('free'|'subscription'|'prime'|'paid') is captured in
 * the promo post's `metadata` JSON so the frontend renders the right CTA per
 * viewer state without further DB writes.
 *
 * Storage: Directus (matches existing prime_videos pipeline). FK to
 * creator_channels handled in DB; FK to the file lives in Directus by uuid.
 */

const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const { query, getPool } = require('../config/postgres');
const { getRedis } = require('../config/redis');
const grokService = require('./grokService');
const logger = require('../utils/logger');

// ── Directus helpers ─────────────────────────────────────────────────────────

function directusBaseUrl() {
  return (
    process.env.DIRECTUS_URL ||
    process.env.DIRECTUS_INTERNAL_URL ||
    'http://directus:8055'
  ).replace(/\/$/, '');
}
function directusHeaders() {
  return {
    Authorization: `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`,
  };
}
function directusFileUrl(fileId) {
  // Public CDN URL the SPA uses.
  return `https://cms.pnptv.app/assets/${fileId}`;
}
function directusThumbUrl(fileId) {
  // The cms video-thumb extension generates JPG poster frames asynchronously.
  return `https://cms.pnptv.app/video-thumb/${fileId}.jpg`;
}

// ── Per-creator Directus folder helpers ───────────────────────────────────────
// Each creator's channel videos land in Directus under "Creators/creator-<id>/".
// Matches the folder structure used by cmsCreatorController for CMS uploads.

const _creatorFolderCache = new Map(); // uploaderId → folderId
let _creatorsParentFolderIdPromise = null;

async function _getOrCreateCreatorsParentFolder() {
  if (_creatorsParentFolderIdPromise) return _creatorsParentFolderIdPromise;
  _creatorsParentFolderIdPromise = (async () => {
    const res = await axios.get(`${directusBaseUrl()}/folders`, {
      headers: directusHeaders(),
      params: { filter: JSON.stringify({ name: { _eq: 'Creators' }, parent: { _null: true } }), limit: 1 },
    });
    const found = res.data?.data?.[0];
    if (found) return found.id;
    const created = await axios.post(`${directusBaseUrl()}/folders`, { name: 'Creators' }, { headers: directusHeaders() });
    return created.data?.data?.id;
  })().catch((err) => { _creatorsParentFolderIdPromise = null; throw err; });
  return _creatorsParentFolderIdPromise;
}

async function _getOrCreateCreatorFolder(uploaderId) {
  const cached = _creatorFolderCache.get(uploaderId);
  if (cached) return cached;
  const parentId = await _getOrCreateCreatorsParentFolder();
  const folderName = `creator-${uploaderId}`;
  const listRes = await axios.get(`${directusBaseUrl()}/folders`, {
    headers: directusHeaders(),
    params: { filter: JSON.stringify({ name: { _eq: folderName }, parent: { _eq: parentId } }), limit: 1 },
  });
  let folderId = listRes.data?.data?.[0]?.id;
  if (!folderId) {
    const cr = await axios.post(`${directusBaseUrl()}/folders`, { name: folderName, parent: parentId }, { headers: directusHeaders() });
    folderId = cr.data?.data?.id;
  }
  if (folderId) _creatorFolderCache.set(uploaderId, folderId);
  return folderId;
}

// ── Tag taxonomy used by Grok suggestSafeTags ────────────────────────────────
//
// Bounded taxonomy keeps the LLM honest: it can only pick tags the platform
// already knows how to filter / surface. Operators can extend this list
// (and reload the bot) without DB migrations.

const TAG_TAXONOMY = [
  // cast size
  'solo', 'duo', 'group', 'orgy',
  // experience level
  'amateur', 'professional',
  // body type / age
  'twink', 'bear', 'daddy', 'jock', 'otter', 'muscle', 'chub',
  // ethnicity
  'latino', 'black', 'asian', 'white', 'mixed',
  // substance play
  'clouds', 'party', 'sober',
  // sex type
  'breeding', 'raw', 'condom', 'oral', 'rim',
  // kink & fetish
  'leather', 'gear', 'bdsm', 's&m', 'bondage', 'sex-slave', 'golden-shower',
  'fisting', 'spanking', 'foot', 'spit', 'watersports', 'pig-play',
  // style
  'roleplay', 'voyeur', 'exhibition', 'outdoor', 'public',
  // format
  'live', 'recorded', 'show', 'private',
];

// ── Ownership check ─────────────────────────────────────────────────────────

/**
 * Returns the creator_channels row if user can manage it (owner, collaborator,
 * or platform admin). Throws ChannelOwnershipError otherwise.
 */
async function loadOwnedChannel(channelId, userId, isAdmin = false) {
  const r = await query(
    `SELECT * FROM creator_channels WHERE id = $1 AND is_active = true`,
    [channelId]
  );
  const ch = r.rows[0];
  if (!ch) {
    const e = new Error('Channel not found');
    e.code = 'CHANNEL_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  if (isAdmin) return ch;
  if (String(ch.creator_id) === String(userId)) return ch;
  const collab = Array.isArray(ch.collaborators) ? ch.collaborators : [];
  if (collab.map(String).includes(String(userId))) return ch;
  const e = new Error('You are not a manager of this channel');
  e.code = 'CHANNEL_NOT_OWNED';
  e.status = 403;
  throw e;
}

async function loadOwnedVideo(videoId, userId, isAdmin = false) {
  const r = await query(
    `SELECT cv.*, cc.creator_id AS channel_creator_id, cc.collaborators AS channel_collaborators
       FROM channel_videos cv
       JOIN creator_channels cc ON cc.id = cv.channel_id
      WHERE cv.id = $1`,
    [videoId]
  );
  const v = r.rows[0];
  if (!v) {
    const e = new Error('Video not found');
    e.code = 'VIDEO_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  if (isAdmin) return v;
  if (String(v.uploader_id) === String(userId)) return v;
  if (String(v.channel_creator_id) === String(userId)) return v;
  const collab = Array.isArray(v.channel_collaborators) ? v.channel_collaborators : [];
  if (collab.map(String).includes(String(userId))) return v;
  const e = new Error('You cannot manage this video');
  e.code = 'VIDEO_NOT_OWNED';
  e.status = 403;
  throw e;
}

// ── Upload ──────────────────────────────────────────────────────────────────

/**
 * Push the multer file to Directus then create a channel_videos row in
 * status='processing'. Caller (route handler) is responsible for size/MIME
 * gating before this function — we trust the input here.
 */
async function uploadVideo({ channelId, uploaderId, isAdmin, file, title }) {
  const channel = await loadOwnedChannel(channelId, uploaderId, isAdmin);

  // Step 1 — push file to Directus into the creator's private folder
  let fileId;
  try {
    const folderId = await _getOrCreateCreatorFolder(uploaderId).catch(() => null);
    const fd = new FormData();
    fd.append('title', (title || file.originalname || 'Untitled').slice(0, 255));
    if (folderId) fd.append('folder', folderId);
    fd.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    const { data } = await axios.post(`${directusBaseUrl()}/files`, fd, {
      headers: { ...fd.getHeaders(), ...directusHeaders() },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 600_000,
    });
    fileId = data?.data?.id;
  } catch (err) {
    logger.error('channel_videos: directus file upload failed', { channelId, error: err.message });
    const e = new Error(`File storage failed: ${err.message}`);
    e.code = 'FILE_STORAGE_FAILED';
    e.status = 502;
    throw e;
  }
  if (!fileId) {
    const e = new Error('File storage returned no id');
    e.code = 'FILE_STORAGE_FAILED';
    e.status = 502;
    throw e;
  }

  // Step 2 — fetch Directus metadata for duration / size (non-fatal on failure)
  let durationSec = null;
  let filesizeBytes = file.size || null;
  try {
    const { data } = await axios.get(
      `${directusBaseUrl()}/files/${fileId}?fields=id,duration,filesize`,
      { headers: directusHeaders(), timeout: 5000 }
    );
    if (data?.data?.duration) durationSec = Math.round(data.data.duration / 1000);
    if (data?.data?.filesize) filesizeBytes = Number(data.data.filesize) || filesizeBytes;
  } catch (_) {
    /* non-fatal */
  }

  // Step 3 — insert row
  const fallbackTitle = (title || file.originalname || 'Untitled').slice(0, 255);
  const inserted = await query(
    `INSERT INTO channel_videos
        (channel_id, uploader_id, directus_file_id, title, duration_sec,
         filesize_bytes, thumbnail_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
     RETURNING *`,
    [channel.id, uploaderId, fileId, fallbackTitle, durationSec, filesizeBytes, directusThumbUrl(fileId)]
  );

  return shapeForApi(inserted.rows[0], channel);
}

// ── AI helpers ──────────────────────────────────────────────────────────────

async function aiTitle({ videoId, userId, isAdmin }) {
  const v = await loadOwnedVideo(videoId, userId, isAdmin);
  // Build a prompt from whatever the human has written + filename
  const prompt =
    (v.title && v.title !== 'Untitled' ? v.title + '. ' : '') +
    (v.description ? v.description : '') +
    (v.tags?.length ? ' Tags: ' + v.tags.join(', ') : '');
  const text = await grokService.generateSafeVideoTitle({
    prompt: prompt.trim() || 'A new video uploaded to a creator channel.',
  });
  await query(
    `UPDATE channel_videos
        SET title = $2,
            ai_generated_meta = ai_generated_meta || '{"title": "ai"}'::jsonb
      WHERE id = $1`,
    [videoId, text.slice(0, 255)]
  );
  return { title: text };
}

async function aiDescription({ videoId, userId, isAdmin }) {
  const v = await loadOwnedVideo(videoId, userId, isAdmin);
  const text = await grokService.generateImprovedVideoDescription({
    title: v.title || '',
    currentDescription: v.description || '',
    tags: v.tags || [],
  });
  await query(
    `UPDATE channel_videos
        SET description = $2,
            ai_generated_meta = ai_generated_meta || '{"description": "ai"}'::jsonb
      WHERE id = $1`,
    [videoId, text]
  );
  return { description: text };
}

async function aiTags({ videoId, userId, isAdmin }) {
  const v = await loadOwnedVideo(videoId, userId, isAdmin);
  const prompt = (v.title || '') + ' ' + (v.description || '');
  const tags = await grokService.suggestSafeTags({
    prompt: prompt.trim() || 'a creator video',
    taxonomy: TAG_TAXONOMY,
  });
  await query(
    `UPDATE channel_videos
        SET tags = $2,
            ai_generated_meta = ai_generated_meta || '{"tags": "ai"}'::jsonb
      WHERE id = $1`,
    [videoId, tags]
  );
  return { tags };
}

// ── Edit ────────────────────────────────────────────────────────────────────

async function updateVideo({ videoId, userId, isAdmin, fields }) {
  const v = await loadOwnedVideo(videoId, userId, isAdmin);
  if (v.status === 'removed') {
    const e = new Error('Video has been removed');
    e.code = 'VIDEO_REMOVED';
    e.status = 410;
    throw e;
  }
  const sets = [];
  const params = [videoId];
  // Track which fields the human edits (for ai_generated_meta delta)
  const humanizedFields = {};
  if (typeof fields.title === 'string') {
    params.push(fields.title.slice(0, 255));
    sets.push(`title = $${params.length}`);
    humanizedFields.title = 'human';
  }
  if (typeof fields.description === 'string' || fields.description === null) {
    params.push(fields.description);
    sets.push(`description = $${params.length}`);
    if (fields.description) humanizedFields.description = 'human';
  }
  if (Array.isArray(fields.tags)) {
    const cleanTags = fields.tags
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    params.push(cleanTags);
    sets.push(`tags = $${params.length}::text[]`);
    if (cleanTags.length) humanizedFields.tags = 'human';
  }
  if (typeof fields.status === 'string' && ['published', 'draft'].includes(fields.status)) {
    params.push(fields.status);
    sets.push(`status = $${params.length}`);
  }
  if (typeof fields.is_featured === 'boolean') {
    params.push(fields.is_featured);
    sets.push(`is_featured = $${params.length}`);
  }
  if (typeof fields.post_to_feed === 'boolean') {
    params.push(fields.post_to_feed);
    sets.push(`post_to_feed = $${params.length}`);
  }
  if (sets.length === 0) return shapeForApi(v);
  if (Object.keys(humanizedFields).length) {
    params.push(JSON.stringify(humanizedFields));
    sets.push(`ai_generated_meta = ai_generated_meta || $${params.length}::jsonb`);
  }
  const updated = await query(
    `UPDATE channel_videos SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return shapeForApi(updated.rows[0]);
}

// ── Publish ─────────────────────────────────────────────────────────────────

// ── Broadcast fan-out (fire-and-forget) ─────────────────────────────────────

async function broadcastNewVideo({ videoId, channelId, creatorId, title, description, thumbnailUrl, gifUrl }) {
  const redis = getRedis();
  const dedupKey = `pnp:video:notified:${videoId}`;
  const alreadySent = await redis.set(dedupKey, '1', 'EX', 86400, 'NX');
  if (alreadySent === null) return; // already broadcast

  const appUrl = (process.env.APP_PUBLIC_URL || 'https://pnptv.app').replace(/\/$/, '');
  const watchUrl = `${appUrl}/channels`;
  const previewUrl = gifUrl || thumbnailUrl;
  const descSnippet = description ? description.slice(0, 100) + (description.length > 100 ? '…' : '') : '';

  // Load followers of this creator (non-free, non-banned)
  let followers = [];
  try {
    const { rows } = await query(
      `SELECT u.id, u.telegram, u.email, u.first_name, u.username, u.language
         FROM user_follows uf
         JOIN users u ON u.id = uf.follower_id
        WHERE uf.following_id = $1
          AND u.tier NOT IN ('free', 'banned')
        LIMIT 3000`,
      [String(creatorId)]
    );
    followers = rows;
  } catch (err) {
    logger.warn('broadcastNewVideo: failed to load followers', { creatorId, error: err.message });
    return;
  }

  // ── Telegram DMs ──────────────────────────────────────────────────────────
  try {
    const bot = require('../bot/core/bot');
    const telegramFollowers = followers.filter((f) => f.telegram);
    const escapeMd = (s) => String(s).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
    const safeTitle = escapeMd(title);
    const tgMessage = `🎬 *Nuevo video\\!* ${safeTitle}\n\n${descSnippet ? escapeMd(descSnippet) + '\n\n' : ''}👉 [Ver ahora](${watchUrl})`;
    for (const f of telegramFollowers) {
      try {
        await bot.telegram.sendMessage(f.telegram, tgMessage, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        if (err.code !== 403 && err.code !== 400) {
          logger.warn('broadcastNewVideo: tg DM failed', { telegram: f.telegram, code: err.code });
        }
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    logger.info('broadcastNewVideo: telegram DMs sent', { videoId, count: telegramFollowers.length });
  } catch (err) {
    logger.warn('broadcastNewVideo: telegram fan-out failed', { videoId, error: err.message });
  }

  // ── Push notifications ────────────────────────────────────────────────────
  try {
    const PushNotificationService = require('./pushNotificationService');
    const pushUserIds = followers.map((f) => f.id);
    if (pushUserIds.length > 0) {
      await PushNotificationService.sendToUsers(pushUserIds, {
        title: `🎬 Nuevo video: ${title}`,
        body: descSnippet || 'Ver en PNP Channels →',
        url: watchUrl,
        icon: previewUrl || undefined,
      });
    }
    logger.info('broadcastNewVideo: push notifications queued', { videoId, count: pushUserIds.length });
  } catch (err) {
    logger.warn('broadcastNewVideo: push notifications failed', { videoId, error: err.message });
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  try {
    const emailService = require('./emailService');
    const emailFollowers = followers.filter((f) => f.email);
    if (emailFollowers.length > 0) {
      await emailService.sendBroadcastEmails(emailFollowers, {
        subjectEn: `🎬 New video: ${title}`,
        subjectEs: `🎬 Nuevo video: ${title}`,
        messageEn: `A new video has been published on PNP Channels!\n\n**${title}**\n\n${descSnippet}\n\n[Watch now →](${watchUrl})`,
        messageEs: `¡Nuevo video en PNP Channels!\n\n**${title}**\n\n${descSnippet}\n\n[Ver ahora →](${watchUrl})`,
        mediaUrl: previewUrl || null,
        buttons: [{ labelEn: 'Watch now →', labelEs: 'Ver ahora →', url: watchUrl }],
        preheaderEn: `New on PNP Channels: ${title}`,
        preheaderEs: `Nuevo en PNP Channels: ${title}`,
      });
    }
    logger.info('broadcastNewVideo: emails sent', { videoId, count: emailFollowers.length });
  } catch (err) {
    logger.warn('broadcastNewVideo: email broadcast failed', { videoId, error: err.message });
  }
}

/**
 * Mark the video published. When post_to_feed is true (default), creates a
 * promo post on the official PNPtv! account and broadcasts to channel
 * followers (Telegram DM / push / email). When false, the video is published
 * silently into the channel only — no feed post, no broadcast. The GIF is
 * always generated as the channel-page hover preview.
 */
async function publishVideo({ videoId, userId, isAdmin }) {
  const v = await loadOwnedVideo(videoId, userId, isAdmin);
  if (v.status === 'published') {
    return shapeForApi(v); // idempotent
  }
  if (v.status === 'removed') {
    const e = new Error('Cannot publish a removed video');
    e.code = 'VIDEO_REMOVED';
    e.status = 410;
    throw e;
  }
  if (!v.title || v.title.trim() === '' || v.title === 'Untitled') {
    const e = new Error('Title is required to publish');
    e.code = 'TITLE_REQUIRED';
    e.status = 400;
    throw e;
  }

  const ch = (await query(
    `SELECT cc.*, u.username AS creator_username, u.first_name AS creator_first_name
       FROM creator_channels cc
       JOIN users u ON u.id = cc.creator_id
      WHERE cc.id = $1`,
    [v.channel_id]
  )).rows[0];

  let gifUrl = null;
  try {
    gifUrl = await Promise.race([
      generateGifFromVideo(v.directus_file_id),
      new Promise((_, reject) => setTimeout(() => reject(new Error('GIF generation timed out')), 60_000)),
    ]);
  } catch (err) {
    logger.warn('channel_videos: GIF generation failed, falling back to static JPG', {
      videoId, channelId: v.channel_id, error: err.message,
    });
    gifUrl = null;
  }

  await query(
    `UPDATE channel_videos
        SET status = 'published', gif_url = $2
      WHERE id = $1`,
    [videoId, gifUrl]
  );

  let final = (await query(`SELECT * FROM channel_videos WHERE id = $1`, [videoId])).rows[0];

  // Honor the creator's "announce on social feed" toggle (default true).
  // Gates BOTH the promo post AND the follower broadcast below.
  const shouldAnnounce = final.post_to_feed !== false;

  // Create promo post on the official PNPtv! account (channel_id=NULL — appears in general feed)
  const OFFICIAL_USER_ID = '8552451957';
  try {
    const previewUrl = final.gif_url || final.thumbnail_url;
    if (shouldAnnounce && previewUrl && !final.promo_post_id) {
      const appUrl = (process.env.APP_PUBLIC_URL || 'https://pnptv.app').replace(/\/$/, '');
      const directusBase = (process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app').replace(/\/$/, '');
      // Only include description snippet if it adds something beyond the title
      const rawDesc = (final.description || '').trim();
      const titleNorm = (final.title || '').trim().toLowerCase();
      const descNorm = rawDesc.toLowerCase();
      const descDifferent = rawDesc && !descNorm.startsWith(titleNorm) && descNorm !== titleNorm;
      const descSnippet = descDifferent
        ? rawDesc.slice(0, 140) + (rawDesc.length > 140 ? '…' : '')
        : '';
      const promoContent = [
        `🎬 NEW on PNP Channels: ${final.title}`,
        descSnippet,
        `🔒 Subscribe to watch → ${appUrl}/channels`,
      ].filter(Boolean).join('\n\n').slice(0, 1000);
      const metadata = {
        kind: 'channel_promo',
        channel_id: ch.id,
        channel_slug: ch.slug ?? '',
        channel_name: ch.name ?? '',
        creator_id: ch.creator_id ?? '',
        creator_username: ch.creator_username ?? null,
        access_type: ch.access_type ?? 'prime',
        price_usd: null,
        video_id: videoId,
        video_directus_id: final.directus_file_id ?? '',
        video_url: final.video_url || (final.directus_file_id ? `${directusBase}/assets/${final.directus_file_id}` : ''),
        has_animated_gif: !!(final.gif_url),
      };
      const promoInsert = await query(
        `INSERT INTO social_posts (user_id, content, media_url, media_type, metadata, is_exclusive, content_tier, created_at)
         VALUES ($1, $2, $3, 'image', $4, true, 'PRIME', NOW())
         RETURNING id`,
        [OFFICIAL_USER_ID, promoContent, previewUrl, JSON.stringify(metadata)]
      );
      const promoPostId = promoInsert.rows[0]?.id ?? null;
      if (promoPostId) {
        await query(`UPDATE channel_videos SET promo_post_id = $2 WHERE id = $1`, [videoId, promoPostId]);
        final = { ...final, promo_post_id: promoPostId };
        // Tag channel creator + any tagged_creator_ids in post_mentions
        const taggedIds = [ch.creator_id, ...(final.tagged_creator_ids || [])].filter(Boolean);
        const uniqueTagged = [...new Set(taggedIds)];
        for (const uid of uniqueTagged) {
          await query(
            `INSERT INTO post_mentions (post_id, mentioned_user_id, mentioner_id, mention_type) VALUES ($1, $2, $3, 'tag') ON CONFLICT DO NOTHING`,
            [promoPostId, uid, OFFICIAL_USER_ID]
          ).catch(() => {});
        }
      }
    }
  } catch (err) {
    logger.warn('channel_videos: promo post creation failed (non-fatal)', { videoId, error: err.message });
  }

  // Fire-and-forget broadcast — never blocks publish. Skipped when the
  // creator unticked the "announce on social feed" toggle.
  if (shouldAnnounce) {
    void broadcastNewVideo({
      videoId,
      channelId: final.channel_id,
      creatorId: ch.creator_id,
      title: final.title,
      description: final.description || '',
      thumbnailUrl: final.thumbnail_url,
      gifUrl: final.gif_url,
    }).catch((err) => logger.warn('broadcastNewVideo: unexpected error', { videoId, error: err.message }));
  }

  return shapeForApi(final, ch);
}

// ── Delete (soft) ───────────────────────────────────────────────────────────

async function deleteVideo({ videoId, userId, isAdmin }) {
  const v = await loadOwnedVideo(videoId, userId, isAdmin);
  if (v.status === 'removed') return { ok: true, alreadyRemoved: true };

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE channel_videos SET status = 'removed' WHERE id = $1`,
      [videoId]
    );
    if (v.promo_post_id) {
      await client.query(
        `UPDATE social_posts SET is_deleted = true WHERE id = $1`,
        [v.promo_post_id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

// ── List ────────────────────────────────────────────────────────────────────

async function listChannelVideos({ channelId, viewerId, includeDrafts = false }) {
  // Drafts are visible only to the channel owner / collaborators
  const visibilityClause = includeDrafts
    ? `cv.status IN ('published','processing','draft')`
    : `cv.status = 'published'`;
  const r = await query(
    `SELECT cv.id, cv.title, cv.description, cv.tags, cv.duration_sec,
            cv.thumbnail_url, cv.gif_url, cv.status, cv.created_at,
            cv.directus_file_id, cv.uploader_id, cv.view_count, cv.promo_post_id,
            cv.tagged_creator_ids,
            cc.access_type, cc.price_usd, cc.creator_id, cc.slug AS channel_slug
       FROM channel_videos cv
       JOIN creator_channels cc ON cc.id = cv.channel_id
      WHERE cv.channel_id = $1
        AND ${visibilityClause}
      ORDER BY cv.created_at DESC
      LIMIT 100`,
    [channelId]
  );
  void viewerId;
  return r.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    tags: row.tags || [],
    duration_sec: row.duration_sec,
    thumbnail_url: row.thumbnail_url,
    gif_url: row.gif_url,
    video_url: directusFileUrl(row.directus_file_id),
    status: row.status,
    created_at: row.created_at,
    view_count: row.view_count ?? 0,
    promo_post_id: row.promo_post_id ?? null,
    tagged_creator_ids: row.tagged_creator_ids || [],
    channel: {
      slug: row.channel_slug,
      access_type: row.access_type,
      price_usd: row.price_usd ? Number(row.price_usd) : null,
    },
  }));
}

// ── ffmpeg GIF generation ───────────────────────────────────────────────────

/**
 * Generate a 3-second 480p GIF from the source video. Streams input from
 * Directus, writes GIF to a tmp file, uploads it back to Directus, returns
 * the public URL. Resolves on success; rejects on error/timeout.
 */
async function generateGifFromVideo(directusFileId) {
  const inputUrl = `${directusBaseUrl()}/assets/${directusFileId}?download&access_token=${process.env.DIRECTUS_ADMIN_TOKEN}`;
  const tmpDir = os.tmpdir();
  const tmpName = `cv-gif-${crypto.randomBytes(6).toString('hex')}.gif`;
  const tmpPath = path.join(tmpDir, tmpName);

  // 3 seconds of 15 fps GIF, 480px wide, lanczos scale, infinite loop. We seek
  // to t=2s so we skip black frames / leader. nice -19 keeps the bot's event
  // loop responsive when ffmpeg consumes a CPU.
  const args = [
    '-loglevel', 'error',
    '-y',
    '-ss', '2',
    '-i', inputUrl,
    '-t', '3',
    '-vf', 'fps=15,scale=480:-1:flags=lanczos',
    '-loop', '0',
    tmpPath,
  ];

  await new Promise((resolve, reject) => {
    const ff = spawn('nice', ['-n', '19', 'ffmpeg', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += String(d); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 200)}`));
    });
  });

  // Re-upload the GIF to Directus
  const buf = await fs.readFile(tmpPath);
  await fs.unlink(tmpPath).catch(() => {});

  const fd = new FormData();
  fd.append('title', `Channel video promo GIF for ${directusFileId}`);
  fd.append('file', buf, { filename: tmpName, contentType: 'image/gif' });
  const { data } = await axios.post(`${directusBaseUrl()}/files`, fd, {
    headers: { ...fd.getHeaders(), ...directusHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 30_000,
  });
  const gifId = data?.data?.id;
  if (!gifId) throw new Error('GIF re-upload returned no id');
  return `https://cms.pnptv.app/assets/${gifId}`;
}

// ── Shape for API ───────────────────────────────────────────────────────────

function shapeForApi(row, channel, extra = {}) {
  return {
    id: row.id,
    channel_id: row.channel_id,
    title: row.title,
    description: row.description,
    tags: row.tags || [],
    duration_sec: row.duration_sec,
    filesize_bytes: row.filesize_bytes ? Number(row.filesize_bytes) : null,
    thumbnail_url: row.thumbnail_url,
    gif_url: row.gif_url,
    video_url: directusFileUrl(row.directus_file_id),
    status: row.status,
    promo_post_id: row.promo_post_id ? Number(row.promo_post_id) : null,
    is_featured: row.is_featured ?? false,
    post_to_feed: row.post_to_feed ?? true,
    tagged_creator_ids: row.tagged_creator_ids || [],
    ai_generated_meta: row.ai_generated_meta || {},
    created_at: row.created_at,
    channel: channel
      ? {
          id: channel.id,
          slug: channel.slug,
          name: channel.name,
          access_type: channel.access_type,
          price_usd: channel.price_usd ? Number(channel.price_usd) : null,
        }
      : undefined,
    ...extra,
  };
}

// ── Maintenance ──────────────────────────────────────────────────────────────

async function failStuckVideoUploads() {
  const result = await query(
    `UPDATE channel_videos
     SET status = 'failed', updated_at = NOW()
     WHERE status = 'processing'
       AND created_at < NOW() - INTERVAL '1 hour'
     RETURNING id`
  );
  const count = result.rowCount || 0;
  if (count > 0) {
    logger.warn('channel_videos: flipped stuck processing rows to failed', { count, ids: result.rows.map(r => r.id) });
  }
  return count;
}

module.exports = {
  uploadVideo,
  aiTitle,
  aiDescription,
  aiTags,
  updateVideo,
  publishVideo,
  deleteVideo,
  listChannelVideos,
  failStuckVideoUploads,
  TAG_TAXONOMY,
};
