'use strict';
// Backfills social_posts video entries (old "wall post to channel" system) into channel_videos.
//
// For each active video social_post with channel_id set that has no corresponding channel_video:
//  1. Checks the file exists on disk (skips missing files)
//  2. Generates a thumbnail via ffmpeg (falls back to null on failure)
//  3. Inserts a channel_videos row (status=published, promo_post_id=sp.id, post_to_feed=false)
//  4. NULLs out social_posts.channel_id so the post no longer appears in the channel Posts section
//     (the video is now in the proper Videos section; the social_post remains in the general feed)
//  5. Updates post_count on the affected channels
//
// Also handles social_posts with Directus URLs (cms.pnptv.app/assets/UUID) — extracts the UUID.
//
// Usage:
//   node backfill-social-posts-to-channel-videos.js          # dry run
//   node backfill-social-posts-to-channel-videos.js --commit # apply

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getPool } = require('../config/postgres');

const DRY_RUN = !process.argv.includes('--commit');
const PUBLIC_DIR = path.join(__dirname, '../../../public');

function extractTitle(content, mediaUrl) {
  if (content && content.trim()) {
    const firstLine = content.trim().split(/[\r\n]+/)[0].trim();
    if (firstLine.length >= 3) return firstLine.slice(0, 255);
  }
  if (mediaUrl && mediaUrl.includes('/assets/')) return 'Untitled Video';
  const base = path.basename(mediaUrl || '', path.extname(mediaUrl || ''));
  const cleaned = base.replace(/^vid-\d+-\d+/, '').replace(/^-/, '').trim();
  return (cleaned || 'Video').slice(0, 255);
}

function generateThumbnail(videoPath, thumbPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-y',
      '-i', videoPath,
      '-ss', '00:00:03',
      '-vframes', '1',
      '-vf', 'scale=640:-2',
      thumbPath,
    ]);
    const timer = setTimeout(() => { proc.kill(); reject(new Error('ffmpeg timeout (30s)')); }, 30000);
    proc.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`));
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

async function main() {
  const pool = getPool();

  // Find social_post videos with channel_id that don't yet have a channel_video entry
  const { rows: posts } = await pool.query(`
    SELECT sp.id, sp.user_id, sp.channel_id, sp.media_url, sp.content, sp.created_at,
           cc.slug, cc.name AS channel_name
    FROM social_posts sp
    JOIN creator_channels cc ON cc.id = sp.channel_id
    WHERE sp.channel_id IS NOT NULL
      AND sp.media_type = 'video'
      AND sp.is_deleted = false
      AND NOT EXISTS (
        SELECT 1 FROM channel_videos cv
        WHERE cv.promo_post_id = sp.id AND cv.status != 'removed'
      )
    ORDER BY sp.channel_id, sp.created_at
  `);

  console.log(`\nFound ${posts.length} social_post video(s) to backfill`);
  if (DRY_RUN) console.log('DRY RUN — pass --commit to apply changes\n');

  const changedChannels = new Set();
  let ok = 0, skipped = 0, errors = 0;

  for (const sp of posts) {
    const isDirectus = sp.media_url && sp.media_url.includes('cms.pnptv.app/assets/');
    const title = extractTitle(sp.content, sp.media_url);

    let directusFileId = null;
    let videoUrl = null;
    let thumbnailUrl = null;
    let filesizeBytes = null;

    if (isDirectus) {
      const match = sp.media_url.match(/\/assets\/([0-9a-f-]{36})/i);
      if (!match) {
        console.warn(`  SKIP post ${sp.id}: can't parse Directus UUID from "${sp.media_url}"`);
        skipped++;
        continue;
      }
      directusFileId = match[1];
      thumbnailUrl = `https://cms.pnptv.app/video-thumb/${directusFileId}.jpg`;

      // If a channel_video already exists with this directus_file_id, don't create a duplicate.
      // Just un-tag the social_post from the channel so it stops appearing in the Posts section.
      const { rows: existing } = await pool.query(
        `SELECT id FROM channel_videos WHERE directus_file_id = $1 AND status != 'removed' LIMIT 1`,
        [directusFileId]
      );
      if (existing.length > 0) {
        console.log(`  UN-TAG post ${sp.id} [${sp.slug}]: already in cv.id=${existing[0].id}, clearing channel_id`);
        if (!DRY_RUN) {
          await pool.query(`UPDATE social_posts SET channel_id = NULL WHERE id = $1`, [sp.id]);
          changedChannels.add(sp.channel_id);
        }
        ok++;
        continue;
      }

      console.log(`  ${DRY_RUN ? '[DRY]' : 'INSERT'} post ${sp.id} [${sp.slug}] (Directus) "${title.slice(0, 70)}"`);
    } else if (sp.media_url && sp.media_url.startsWith('/uploads/')) {
      const localPath = path.join(PUBLIC_DIR, sp.media_url);
      if (!fs.existsSync(localPath)) {
        console.warn(`  SKIP post ${sp.id}: file missing — ${sp.media_url}`);
        skipped++;
        continue;
      }
      try { filesizeBytes = fs.statSync(localPath).size; } catch (_) {}
      videoUrl = sp.media_url;

      // Generate thumbnail next to the video file
      const base = path.basename(sp.media_url, path.extname(sp.media_url));
      const thumbName = `thumb-${base}.jpg`;
      const thumbPath = path.join(PUBLIC_DIR, 'uploads/posts', thumbName);
      thumbnailUrl = `/uploads/posts/${thumbName}`;

      if (!DRY_RUN && !fs.existsSync(thumbPath)) {
        try {
          await generateThumbnail(localPath, thumbPath);
        } catch (err) {
          console.warn(`    WARN thumbnail failed for post ${sp.id}: ${err.message}`);
          thumbnailUrl = null;
        }
      }

      console.log(`  ${DRY_RUN ? '[DRY]' : 'INSERT'} post ${sp.id} [${sp.slug}] "${title.slice(0, 70)}" (${filesizeBytes ? Math.round(filesizeBytes / 1e6) + 'MB' : '?'})`);
    } else {
      console.warn(`  SKIP post ${sp.id}: unrecognized URL "${sp.media_url}"`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      ok++;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [cv] } = await client.query(`
        INSERT INTO channel_videos (
          channel_id, uploader_id, title, description,
          video_url, directus_file_id, thumbnail_url,
          filesize_bytes, status, promo_post_id, post_to_feed,
          tags, ai_generated_meta, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9, false, '{}', '{}', $10)
        RETURNING id
      `, [
        sp.channel_id, sp.user_id, title, sp.content || null,
        videoUrl, directusFileId, thumbnailUrl,
        filesizeBytes, sp.id, sp.created_at,
      ]);

      // Un-tag the social_post from the channel — it's now represented in channel_videos.
      // The post stays in the general feed; it just no longer appears in the channel Posts section.
      await client.query(
        `UPDATE social_posts SET channel_id = NULL WHERE id = $1`,
        [sp.id]
      );

      await client.query('COMMIT');
      changedChannels.add(sp.channel_id);
      ok++;
      console.log(`    -> channel_video id=${cv.id} created`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ERROR post ${sp.id}: ${err.message}`);
      errors++;
    } finally {
      client.release();
    }
  }

  // Sync post_count for all affected channels
  if (!DRY_RUN && changedChannels.size > 0) {
    for (const channelId of changedChannels) {
      await pool.query(`
        UPDATE creator_channels
        SET post_count = (SELECT COUNT(*) FROM social_posts WHERE channel_id = $1 AND is_deleted = false)
        WHERE id = $1
      `, [channelId]);
    }
    console.log(`\nSynced post_count for ${changedChannels.size} channel(s)`);
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN COMPLETE]' : 'DONE'}`);
  console.log(`  ok=${ok}  skipped=${skipped}  errors=${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
