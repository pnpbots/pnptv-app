#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Ingest free social_posts videos into Directus.
 *
 *   - Creates folder "Short Videos" in Directus if missing.
 *   - For each free video on disk:
 *       - duration >= 240s  → upload + create prime_videos row (status='draft'), no folder
 *       - duration <  240s  → upload into the "Short Videos" folder (no prime_videos row)
 *   - Skips rows whose disk file is missing.
 *   - Resumable: writes a manifest /opt/pnptvapp/prime-ingest-log.json with already-processed post_ids.
 *   - Idempotent per post: skipped if already in the log.
 */
require('dotenv').config({ path: '/opt/pnptvapp/.env' });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const FormData = require('form-data');
const axios = require('axios');

const PUBLIC_DIR = '/opt/pnptvapp/public';
const MIN_PRIME_SECONDS = 240;
const FOLDER_NAME = 'Short Videos';
const LOG_PATH = '/opt/pnptvapp/prime-ingest-log.json';
const DIRECTUS_URL = process.env.DIRECTUS_BASE_URL || 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

if (!DIRECTUS_TOKEN) { console.error('FATAL: DIRECTUS_ADMIN_TOKEN missing'); process.exit(1); }

const dx = axios.create({
  baseURL: DIRECTUS_URL,
  headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  timeout: 600000,
});

function ffprobeDuration(filePath) {
  const r = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) return null;
  const sec = parseFloat((r.stdout || '').trim());
  return Number.isFinite(sec) ? sec : null;
}

async function ensureFolder(name) {
  const { data } = await dx.get(`/folders?filter[name][_eq]=${encodeURIComponent(name)}&fields=id,name`);
  if (data?.data?.length) return data.data[0].id;
  const { data: created } = await dx.post('/folders', { name });
  return created.data.id;
}

async function uploadFile(filePath, title, folderId) {
  const fd = new FormData();
  if (folderId) fd.append('folder', folderId);
  fd.append('title', title.slice(0, 200));
  fd.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'video/mp4',
  });
  const { data } = await dx.post('/files', fd, { headers: fd.getHeaders() });
  return data.data;
}

async function createPrimeDraft({ title, description, fileId, durationSec }) {
  const payload = {
    title: title.slice(0, 255),
    description,
    status: 'draft',
    type: 'video',
    category: 'prime_videos',
    video_file: fileId,
    thumbnail: fileId,
    url: `/assets/${fileId}`,
    duration: durationSec,
    is_explicit: false,
    is_featured: false,
    plays: 0,
    likes: 0,
  };
  const { data } = await dx.post('/items/prime_videos', payload);
  return data.data;
}

function loadLog() {
  if (!fs.existsSync(LOG_PATH)) return { processed: {} };
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return { processed: {} }; }
}

function saveLog(log) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

async function main() {
  const pg = new Client({
    host: process.env.PG_HOST || 'pg-pnptv',
    port: Number(process.env.PG_PORT || 5432),
    user: process.env.PG_PNPTV_USER || process.env.POSTGRES_USER,
    password: process.env.PG_PNPTV_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.PG_PNPTV_DB || process.env.POSTGRES_DATABASE,
  });
  await pg.connect();

  console.log(`Ensuring folder "${FOLDER_NAME}"...`);
  const folderId = await ensureFolder(FOLDER_NAME);
  console.log(`  folder id = ${folderId}`);

  const { rows } = await pg.query(`
    SELECT id, user_id, content, media_url, video_title, video_description, created_at
    FROM social_posts
    WHERE content_tier = 'free'
      AND media_type = 'video'
      AND is_deleted = false
      AND media_url IS NOT NULL
    ORDER BY id
  `);
  await pg.end();

  const log = loadLog();
  console.log(`Inspecting ${rows.length} free video posts (already-processed: ${Object.keys(log.processed).length})...`);

  let primeCreated = 0, shortCreated = 0, missing = 0, skipped = 0, failed = 0;
  let bytesUploaded = 0;
  const t0 = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tag = `[${i + 1}/${rows.length}] post=${r.id}`;
    if (log.processed[r.id]) { skipped++; continue; }

    const rel = (r.media_url || '').replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(filePath)) { missing++; continue; }

    const sec = ffprobeDuration(filePath);
    if (sec === null) { console.warn(`${tag} :: FFPROBE FAILED`); failed++; continue; }

    const isPrime = sec >= MIN_PRIME_SECONDS;
    const baseTitle = (r.video_title || (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 90) || path.basename(filePath)).trim() || path.basename(filePath);
    const stat = fs.statSync(filePath);

    try {
      const file = await uploadFile(filePath, baseTitle, isPrime ? null : folderId);
      let primeId = null;
      if (isPrime) {
        const pv = await createPrimeDraft({
          title: baseTitle,
          description: (r.video_description || r.content || '').slice(0, 4000),
          fileId: file.id,
          durationSec: Math.round(sec),
        });
        primeId = pv.id;
        primeCreated++;
      } else {
        shortCreated++;
      }
      bytesUploaded += stat.size;
      log.processed[r.id] = { file_id: file.id, prime_id: primeId, duration_sec: Math.round(sec), bytes: stat.size, ts: new Date().toISOString() };
      saveLog(log);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`${tag} :: ${isPrime ? 'PRIME-DRAFT' : 'SHORT'} dur=${Math.round(sec)}s size=${(stat.size/1048576).toFixed(1)}MB → file=${file.id}${primeId ? ' prime=' + primeId : ''} [${elapsed}s, ${primeCreated + shortCreated}/${rows.length}]`);
    } catch (err) {
      const isConnRefused = /ECONNREFUSED/.test(err.message || '');
      console.error(`${tag} :: UPLOAD FAILED ${err.response?.status || ''} ${err.response?.data?.errors?.[0]?.message || err.message}`);
      failed++;
      if (isConnRefused) {
        // Directus likely restarting (OOM). Wait for /server/health.
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const h = await dx.get('/server/health', { timeout: 3000 });
            if (h.status === 200) { console.log(`${tag} :: directus recovered`); break; }
          } catch { /* keep waiting */ }
        }
      }
    }
    // Throttle to give Directus time to GC between uploads (mainly thumbnail extraction).
    await new Promise((r) => setTimeout(r, 600));
  }

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('---');
  console.log(`DONE in ${totalSec}s. prime-drafts=${primeCreated}, short-uploads=${shortCreated}, missing=${missing}, already-done=${skipped}, failed=${failed}, bytes=${(bytesUploaded/1048576).toFixed(0)} MB`);
  console.log(`Manifest: ${LOG_PATH}`);
}

main().catch((e) => { console.error('FATAL', e?.response?.data || e); process.exit(2); });
