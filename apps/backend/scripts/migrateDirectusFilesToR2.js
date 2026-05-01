#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * One-shot migration: move Directus files from local disk to Cloudflare R2.
 *
 * Per row in directus_files where storage='local':
 *   1. PUT original to R2 at key=filename_disk
 *   2. HEAD R2 object, verify size matches DB filesize
 *   3. UPDATE directus_files SET storage='cloud' WHERE id=...
 *   4. Delete local original + any <id>__*.{avif,jpg,webp,png} transform caches
 *
 * Resumable: skips rows already 'cloud'. Safe to re-run.
 *
 * Run from host (has bind-mounted uploads dir at INFRA_UPLOADS_DIR).
 */

require('dotenv').config({ path: '/opt/pnptvapp/.env' });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const UPLOADS_DIR = process.env.INFRA_UPLOADS_DIR || '/opt/pnptvapp/infrastructure/data/directus/uploads';

const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'PG_DIRECTUS_USER', 'PG_DIRECTUS_PASSWORD', 'PG_DIRECTUS_DB'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`FATAL: missing env ${k}`);
    process.exit(1);
  }
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const pg = new Client({
  host: process.env.PG_DIRECTUS_HOST || 'pg-directus',
  port: Number(process.env.PG_DIRECTUS_PORT || 5432),
  user: process.env.PG_DIRECTUS_USER,
  password: process.env.PG_DIRECTUS_PASSWORD,
  database: process.env.PG_DIRECTUS_DB,
});

async function r2Has(key, expectedSize) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    if (expectedSize != null && Number(head.ContentLength) !== Number(expectedSize)) {
      return { exists: true, sizeMatch: false, actual: head.ContentLength };
    }
    return { exists: true, sizeMatch: true, actual: head.ContentLength };
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return { exists: false };
    throw err;
  }
}

async function uploadFile(key, filePath, contentType) {
  const stream = fs.createReadStream(filePath);
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: stream,
    ContentType: contentType || 'application/octet-stream',
  }));
}

function deleteTransformCaches(id) {
  // Filename pattern: <uuid>__<hash>.<ext>
  let count = 0;
  try {
    const entries = fs.readdirSync(UPLOADS_DIR);
    const prefix = `${id}__`;
    for (const f of entries) {
      if (f.startsWith(prefix)) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); count++; } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return count;
}

async function main() {
  await pg.connect();
  const { rows } = await pg.query(
    `SELECT id, filename_disk, filesize, type FROM directus_files WHERE storage='local' ORDER BY uploaded_on NULLS LAST, created_on`
  );
  console.log(`Found ${rows.length} local rows to migrate.`);
  console.log(`Uploads dir: ${UPLOADS_DIR}`);
  console.log(`R2 bucket:   ${process.env.S3_BUCKET}`);
  console.log('---');

  let ok = 0, skipped = 0, missing = 0, failed = 0, sizeMismatch = 0;
  let bytesUploaded = 0;
  const t0 = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const localPath = path.join(UPLOADS_DIR, r.filename_disk);
    const tag = `[${i + 1}/${rows.length}] ${r.id} ${r.filename_disk}`;

    // Local file present?
    let stat;
    try { stat = fs.statSync(localPath); }
    catch {
      console.warn(`${tag} :: LOCAL MISSING — marking cloud anyway? skipping (manual review)`);
      missing++;
      continue;
    }

    // Already in R2?
    let head;
    try { head = await r2Has(r.filename_disk, stat.size); }
    catch (err) { console.error(`${tag} :: HEAD ERROR ${err.message}`); failed++; continue; }

    if (head.exists && head.sizeMatch) {
      // Already uploaded — flip DB + clean local
      await pg.query(`UPDATE directus_files SET storage='cloud' WHERE id=$1`, [r.id]);
      try { fs.unlinkSync(localPath); } catch { /* ignore */ }
      const tx = deleteTransformCaches(r.id);
      console.log(`${tag} :: ALREADY IN R2 — DB flipped, local removed (tx=${tx})`);
      skipped++;
      continue;
    }
    if (head.exists && !head.sizeMatch) {
      console.warn(`${tag} :: SIZE MISMATCH r2=${head.actual} local=${stat.size} — re-uploading`);
      sizeMismatch++;
    }

    // Upload
    try {
      await uploadFile(r.filename_disk, localPath, r.type);
    } catch (err) {
      console.error(`${tag} :: UPLOAD FAILED ${err.message}`);
      failed++;
      continue;
    }

    // Verify
    let verify;
    try { verify = await r2Has(r.filename_disk, stat.size); }
    catch (err) { console.error(`${tag} :: VERIFY ERROR ${err.message}`); failed++; continue; }
    if (!verify.exists || !verify.sizeMatch) {
      console.error(`${tag} :: VERIFY FAILED r2=${verify.actual ?? 'absent'} local=${stat.size}`);
      failed++;
      continue;
    }

    // Flip DB + cleanup
    await pg.query(`UPDATE directus_files SET storage='cloud' WHERE id=$1`, [r.id]);
    try { fs.unlinkSync(localPath); } catch { /* ignore */ }
    const tx = deleteTransformCaches(r.id);
    bytesUploaded += stat.size;
    ok++;
    const mb = (stat.size / 1048576).toFixed(2);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${tag} :: OK ${mb} MB (tx=${tx}) [${elapsed}s elapsed, ${ok}+${skipped}/${rows.length}]`);
  }

  await pg.end();
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  const totalMB = (bytesUploaded / 1048576).toFixed(2);
  console.log('---');
  console.log(`DONE in ${totalSec}s. uploaded=${ok}, already-cloud=${skipped}, local-missing=${missing}, size-mismatch=${sizeMismatch}, failed=${failed}, bytes-uploaded=${totalMB} MB`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(2); });
