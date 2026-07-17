'use strict';
// Rescues channel_videos stuck in status='failed' that have a valid directus_file_id.
// These uploads succeeded but were never published (wizard abandoned, cron flipped them to failed).
// Sets them to status='published' silently — no promo post, no broadcast (old content).
//
// Usage:
//   node rescue-failed-channel-videos.js          # dry run
//   node rescue-failed-channel-videos.js --commit # apply

const { getPool } = require('../config/postgres');

const DRY_RUN = !process.argv.includes('--commit');

async function main() {
  const pool = getPool();

  const { rows: failed } = await pool.query(`
    SELECT cv.id, cv.channel_id, cv.title, cv.directus_file_id, cv.thumbnail_url,
           cc.slug, cc.name AS channel_name
    FROM channel_videos cv
    JOIN creator_channels cc ON cc.id = cv.channel_id
    WHERE cv.status = 'failed' AND cv.directus_file_id IS NOT NULL
    ORDER BY cv.channel_id, cv.created_at
  `);

  console.log(`\nFound ${failed.length} failed channel_videos with Directus uploads`);
  if (DRY_RUN) console.log('DRY RUN — pass --commit to apply changes\n');

  const changedChannels = new Set();

  for (const cv of failed) {
    console.log(`  ${DRY_RUN ? '[DRY]' : 'RESCUE'} cv.id=${cv.id} [${cv.slug}] "${cv.title}"`);
    console.log(`    directus_file_id=${cv.directus_file_id}`);
    console.log(`    thumbnail_url=${cv.thumbnail_url || 'none'}`);

    if (!DRY_RUN) {
      await pool.query(
        `UPDATE channel_videos SET status = 'published', post_to_feed = false WHERE id = $1`,
        [cv.id]
      );
      changedChannels.add(cv.channel_id);
    }
  }

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

  console.log(`\n${DRY_RUN ? '[DRY RUN COMPLETE]' : 'DONE'} — ${failed.length} video(s) ${DRY_RUN ? 'would be' : 'were'} rescued`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
