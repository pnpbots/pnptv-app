#!/usr/bin/env node
/**
 * audit_broken_video_posts.js
 *
 * Surveys every social_posts row with media_type='video' and classifies its
 * media_url as either OK or broken (one of: local_missing, cms_dead,
 * telegram_url, http_error). Soft-deletes the broken rows on --commit so
 * they stop appearing in the feed.
 *
 * Usage:
 *   node apps/backend/scripts/audit_broken_video_posts.js              # dry-run, prints CSV
 *   node apps/backend/scripts/audit_broken_video_posts.js --commit     # actually soft-deletes
 *   node apps/backend/scripts/audit_broken_video_posts.js --commit --csv=/tmp/audit.csv
 *
 * Soft-delete sets:
 *   is_deleted = true
 *
 * (social_posts has no deleted_at / delete_reason columns; the classification
 * is logged to stdout and to the optional CSV instead.)
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Resolve the backend root regardless of where this script is invoked from.
const BACKEND_ROOT = path.resolve(__dirname, '..');
process.chdir(BACKEND_ROOT);

const { query } = require('./../config/postgres');

const COMMIT = process.argv.includes('--commit');
const csvArg = process.argv.find((a) => a.startsWith('--csv='));
const CSV_PATH = csvArg ? csvArg.slice('--csv='.length) : null;

// Public-uploads root — where /uploads/* relative URLs resolve to on disk.
const PUBLIC_UPLOADS_ROOT = path.resolve(BACKEND_ROOT, '..', '..', 'public');

const REQUEST_TIMEOUT_MS = 8000;
const CONCURRENCY = 8;

// ── HTTP probe (HEAD, follows one redirect) ───────────────────────────────────
function httpProbe(rawUrl) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return resolve({ status: 0, ok: false }); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      { method: 'HEAD', hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'PNPtv-VideoAudit/1.0' } },
      (res) => {
        const status = res.statusCode || 0;
        // One-shot redirect follow
        if (status >= 300 && status < 400 && res.headers.location) {
          httpProbe(new URL(res.headers.location, rawUrl).toString()).then(resolve);
          return;
        }
        resolve({ status, ok: status >= 200 && status < 400 });
        res.resume();
      }
    );
    req.on('error', () => resolve({ status: 0, ok: false }));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => { req.destroy(); resolve({ status: 0, ok: false }); });
    req.end();
  });
}

// ── Classification ────────────────────────────────────────────────────────────
async function classify(mediaUrl) {
  if (!mediaUrl) return { kind: 'no_url', detail: '' };

  // Telegram bot file URLs expire and shouldn't be persistent media.
  if (/^https?:\/\/api\.telegram\.org\/file\//i.test(mediaUrl)) {
    return { kind: 'telegram_url', detail: 'expires on Telegram side' };
  }

  // Directus / CMS URLs are being decommissioned.
  if (/^https?:\/\/cms\.pnptv\.app\//i.test(mediaUrl)) {
    const probe = await httpProbe(mediaUrl);
    if (probe.ok) return { kind: 'ok', detail: `cms ${probe.status}` };
    return { kind: 'cms_dead', detail: `HTTP ${probe.status}` };
  }

  // Other absolute URLs — probe.
  if (/^https?:\/\//i.test(mediaUrl)) {
    const probe = await httpProbe(mediaUrl);
    if (probe.ok) return { kind: 'ok', detail: `http ${probe.status}` };
    return { kind: 'http_error', detail: `HTTP ${probe.status}` };
  }

  // Local /uploads/* — verify the file exists on disk.
  if (mediaUrl.startsWith('/uploads/')) {
    const onDisk = path.join(PUBLIC_UPLOADS_ROOT, mediaUrl);
    try {
      const stat = fs.statSync(onDisk);
      if (stat.isFile() && stat.size > 0) return { kind: 'ok', detail: `${stat.size}b` };
      return { kind: 'local_missing', detail: 'empty or not a file' };
    } catch {
      return { kind: 'local_missing', detail: 'ENOENT' };
    }
  }

  return { kind: 'unknown', detail: 'unrecognized url shape' };
}

// ── Concurrency-limited map ───────────────────────────────────────────────────
async function pmap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[audit] mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'} concurrency=${CONCURRENCY}`);
  console.log(`[audit] PUBLIC_UPLOADS_ROOT=${PUBLIC_UPLOADS_ROOT}`);

  const { rows } = await query(
    `SELECT id, user_id, media_url, media_type, created_at
     FROM social_posts
     WHERE media_type = 'video'
       AND COALESCE(is_deleted, false) = false
       AND media_url IS NOT NULL
     ORDER BY created_at DESC`
  );

  console.log(`[audit] checking ${rows.length} video posts…`);

  const classified = await pmap(rows, CONCURRENCY, async (row) => {
    const c = await classify(row.media_url);
    return { ...row, classification: c.kind, detail: c.detail };
  });

  const summary = classified.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] || 0) + 1;
    return acc;
  }, {});

  console.log('\n[audit] classification breakdown:');
  Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(18)} ${v}`);
  });

  const broken = classified.filter((r) => r.classification !== 'ok' && r.classification !== 'no_url');
  console.log(`\n[audit] broken total: ${broken.length} of ${classified.length}`);

  // CSV emit
  if (CSV_PATH || broken.length > 0) {
    const lines = ['id,user_id,classification,detail,created_at,media_url'];
    for (const r of broken) {
      const safe = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      lines.push([r.id, r.user_id, r.classification, safe(r.detail), r.created_at?.toISOString() || '', safe(r.media_url)].join(','));
    }
    if (CSV_PATH) {
      fs.writeFileSync(CSV_PATH, lines.join('\n'));
      console.log(`[audit] CSV written → ${CSV_PATH}`);
    } else if (!COMMIT) {
      console.log('\n--- broken posts (first 30) ---');
      lines.slice(0, 31).forEach((l) => console.log(l));
      if (broken.length > 30) console.log(`... +${broken.length - 30} more`);
    }
  }

  if (!COMMIT) {
    console.log('\n[audit] dry-run only — pass --commit to soft-delete the broken rows.');
    process.exit(0);
  }

  if (broken.length === 0) {
    console.log('[audit] nothing to delete.');
    process.exit(0);
  }

  // Group ids by classification so delete_reason is descriptive.
  const groups = broken.reduce((acc, r) => {
    (acc[r.classification] ||= []).push(r.id);
    return acc;
  }, {});

  let totalDeleted = 0;
  for (const [kind, ids] of Object.entries(groups)) {
    const res = await query(
      `UPDATE social_posts
          SET is_deleted = true
        WHERE id = ANY($1::int[])
          AND COALESCE(is_deleted, false) = false`,
      [ids]
    );
    console.log(`[audit] soft-deleted ${res.rowCount} (${kind})`);
    totalDeleted += res.rowCount;
  }

  console.log(`\n[audit] done — ${totalDeleted} posts soft-deleted.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[audit] fatal:', err);
  process.exit(1);
});
