#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * DRY RUN: scan all free social_posts videos, ffprobe duration, list those ≥ 4 min.
 * Writes manifest JSON to /tmp/prime-promotion.json.
 */
require('dotenv').config({ path: '/opt/pnptvapp/.env' });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const PUBLIC_DIR = '/opt/pnptvapp/public';
const MIN_SECONDS = 240;

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

async function main() {
  const pg = new Client({
    host: process.env.PG_HOST || process.env.POSTGRES_HOST || 'pg-pnptv',
    port: Number(process.env.PG_PORT || 5432),
    user: process.env.PG_PNPTV_USER || process.env.POSTGRES_USER,
    password: process.env.PG_PNPTV_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.PG_PNPTV_DB || process.env.POSTGRES_DATABASE,
  });
  await pg.connect();

  const { rows } = await pg.query(`
    SELECT id, user_id, content, media_url, video_title, video_description, created_at
    FROM social_posts
    WHERE content_tier = 'free'
      AND media_type = 'video'
      AND is_deleted = false
      AND media_url IS NOT NULL
    ORDER BY id
  `);
  console.log(`Inspecting ${rows.length} free video posts...`);

  const manifest = [];
  let probed = 0, missing = 0, under4 = 0, over4 = 0, errored = 0;
  for (const r of rows) {
    const rel = (r.media_url || '').replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(filePath)) { missing++; continue; }
    const sec = ffprobeDuration(filePath);
    probed++;
    if (sec === null) { errored++; continue; }
    if (sec < MIN_SECONDS) { under4++; continue; }
    over4++;
    manifest.push({
      post_id: r.id,
      user_id: r.user_id,
      file_path: filePath,
      file_size: fs.statSync(filePath).size,
      duration_sec: Math.round(sec),
      title: (r.video_title || (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 90) || path.basename(filePath)).slice(0, 200),
      description: (r.video_description || r.content || '').slice(0, 4000),
      created_at: r.created_at,
    });
  }
  await pg.end();

  const out = process.env.MANIFEST_OUT || '/opt/pnptvapp/prime-promotion.json';
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  const totalBytes = manifest.reduce((s, m) => s + (m.file_size || 0), 0);
  console.log('---');
  console.log(`Probed:    ${probed}`);
  console.log(`Missing:   ${missing}`);
  console.log(`Errored:   ${errored}`);
  console.log(`Under 4m:  ${under4}`);
  console.log(`OVER 4m:   ${over4}  (${(totalBytes/1048576).toFixed(0)} MB)`);
  console.log(`Manifest:  /tmp/prime-promotion.json (${over4} entries)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
