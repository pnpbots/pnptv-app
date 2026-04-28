#!/usr/bin/env node
/**
 * migrate-videos-to-r2.js — copy existing /uploads/posts/* to R2.
 *
 * Walks the local uploads dir and uploads each vid-* and thumb-* file to R2
 * with the matching key. Idempotent: skips files already present in R2 (HEAD
 * check before upload).
 *
 * Does NOT delete local files — that's a separate cleanup step you can run
 * once you've verified R2 delivery works in production for a few days.
 *
 * Usage:
 *   node apps/backend/scripts/migrate-videos-to-r2.js              # dry run
 *   node apps/backend/scripts/migrate-videos-to-r2.js --execute    # actually upload
 */

const path = require('path');
const fs = require('fs').promises;

const backendPath = path.join(__dirname, '..');
const objectStorage = require(path.join(backendPath, 'services/objectStorageService'));

const EXECUTE = process.argv.includes('--execute');
const UPLOADS_DIR = path.join(backendPath, '../../public/uploads/posts');

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

async function main() {
  if (!objectStorage.isConfigured()) {
    console.error('S3_* env vars not set — cannot migrate. Configure first.');
    process.exit(1);
  }

  console.log(`\n=== Video R2 migration ===`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Source: ${UPLOADS_DIR}`);
  console.log(`Bucket: ${process.env.S3_BUCKET}\n`);

  let entries;
  try {
    entries = await fs.readdir(UPLOADS_DIR);
  } catch (err) {
    console.error(`Cannot read source dir: ${err.message}`);
    process.exit(1);
  }

  const candidates = entries.filter(f => /^(vid|thumb)-/.test(f));
  console.log(`Found ${candidates.length} candidate files (vid-* and thumb-*).\n`);

  const summary = { uploaded: 0, skipped_exists: 0, errors: 0, totalBytes: 0, skippedBytes: 0 };
  let i = 0;

  for (const filename of candidates) {
    i++;
    const localPath = path.join(UPLOADS_DIR, filename);
    const key = `posts/${filename}`;
    let stat;
    try { stat = await fs.stat(localPath); } catch { continue; }
    if (!stat.isFile()) continue;

    const tag = `[${i}/${candidates.length}] ${filename} (${fmtBytes(stat.size)})`;

    try {
      const exists = await objectStorage.exists(key);
      if (exists) {
        console.log(`${tag} skip — already in R2`);
        summary.skipped_exists++;
        summary.skippedBytes += stat.size;
        continue;
      }
      if (!EXECUTE) {
        console.log(`${tag} would upload`);
        summary.uploaded++;
        summary.totalBytes += stat.size;
        continue;
      }
      const start = Date.now();
      await objectStorage.uploadFile(localPath, key);
      const ms = Date.now() - start;
      const mbps = (stat.size / 1024 / 1024) / (ms / 1000);
      console.log(`${tag} OK in ${(ms / 1000).toFixed(1)}s (${mbps.toFixed(1)} MB/s)`);
      summary.uploaded++;
      summary.totalBytes += stat.size;
    } catch (err) {
      console.error(`${tag} FAIL — ${err.message}`);
      summary.errors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Uploaded:           ${summary.uploaded}  (${fmtBytes(summary.totalBytes)})`);
  console.log(`  Skipped (in R2):    ${summary.skipped_exists}  (${fmtBytes(summary.skippedBytes)})`);
  console.log(`  Errors:             ${summary.errors}`);
  if (!EXECUTE) console.log(`\n  This was a DRY RUN. Re-run with --execute to actually upload.`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
