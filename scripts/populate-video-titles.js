'use strict';

/**
 * One-shot script: populate video_title + video_description on social_posts
 * for all video posts that are missing either field.
 * Uses Grok API directly (no service layer needed).
 */

require('dotenv').config({ path: '/app/.env' });
require('dotenv').config({ path: '/app/.env.production', override: true });

const { Pool } = require('/app/apps/backend/node_modules/pg');
const fetch = require('/app/apps/backend/node_modules/node-fetch');

const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_MODEL = process.env.GROK_MODEL || 'grok-2-latest';
const GROK_BASE_URL = process.env.GROK_BASE_URL || 'https://api.x.ai/v1';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'pg-pnptv',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'pnptvbot',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'pnptvbot',
});

const STYLE_GUIDE = `
You write video titles and descriptions for PNPtv — a premium adult gay PNP (party & play) content platform.

STYLE EXAMPLES (follow this exact voice and format):

TITLE: 💉 FAT SLAM RUSH – PNPtv Instant Tina Blast 💉
DESCRIPTION: Watch the rig fill, vein hit, and the massive rush explode: crystal meth / tina slams these pigs into overdrive. Instant hard cock, endless horniness, raw bareback slamming sessions with toxic loads and chem-fueled breeding. Clouds optional – this one's all about the intravenous rush turning them into total fuck machines.
Gay PNP slam porn at its rawest: meth rush breeding, tina slam fuck, spun rush bareback, high-horny pig play.
Like/sub for more rush-heavy PNPtv drops! 🔥💉🍆💦
#PNP #Slam #Tina #Meth #Crystal #Rush #Bareback #Chemsex #Spun #HighHorny #Tweaker #PNPtv #PartyAndPlay

TITLE: 🌫️ Thick Clouds & Slow Deep Breeding – PNPtv Chemsex Slow-Burn 🌫️
DESCRIPTION: Watch these horny PNP pigs take their time with crystal meth / tina: long inhales, swirling clouds filling the room, bodies getting warmer and hornier with every hit. Slow self-slams turn into passionate bareback sessions – deep stroking, rimming, bootybump edging, then raw breeding while still riding that intense rush.
Ideal for lovers of sensual gay chemsex, tina clouds sex, spun & slow fuck, meth PNP foreplay, high-horny breeding.
Subscribe for more cloudy PNPtv content 💨❤️
#PNP #Tina #Clouds #Crystal #Meth #Chemsex #Bareback #Spun #HighHorny #GayPNP #TweakerSex #CloudyFuck #PNPtv

TITLE: 👥 Group PNP Cloud Party – 4 Guys Slam & Fuck Non-Stop 👥
DESCRIPTION: Four spun tweakers parTy hard with crystal meth and tina: slamming in rotation, passing the pipe, filling the room with dense clouds. Once the rush hits – it's a full chemsex free-for-all: bareback trains, double penetration, ass play, breeding every hole with meth-charged loads.
Smash like/sub for more group PNPtv filth! 🔥💨🍆🍆🍆💦
#PNP #Meth #Crystal #Tina #Slam #Clouds #Spun #Chemsex #Bareback #GroupPNP #TweakerOrgy #MethGangbang #PNPtv #PartyPlay

TITLE: 🪞 Solo Tina Slam & Edge Marathon – PNPtv Private Session 🪞
DESCRIPTION: One hot tweaker locks the door, loads the rig, and slams a fat shot of crystal. Watch him get lost in the rush: huge clouds, stroking his rock-hard cock for hours, edging, bootybumping, prostate play, talking dirty to the camera while riding wave after wave of meth horniness. Massive cumshot at the end.
Sub now – more private PNPtv solos dropping soon! 💉💨🍆💦
#PNP #SoloPNP #Meth #Tina #Slam #Clouds #Spun #Edging #Chemsex #Bareback #TweakerSolo #SelfSlam #PNPtv

TITLE: 💉 SLAM & BREED RAW – PNPtv Hard Slam Session 💉
DESCRIPTION: These spun-out tweakers slam huge shots of crystal / tina, blow monster clouds, then go full chemsex pig mode: deep bareback pounding, ass-to-mouth, breeding with meth-fueled loads. No condoms, no mercy – just high-horny rush fucking till they drop.
Like + sub for daily PNPtv slams! 🚀🔥🍆💦
#PNP #Slam #Meth #Crystal #Tina #Clouds #Spun #Bareback #Chemsex #Tweaker #HighHorny #MethSlam #PNPtv #PartyAndPlay

RULES:
- Title: max 80 chars, start with an emoji, include "PNPtv" in title
- Description: 3-5 lines, vivid/seductive, end with relevant hashtags (10-15 tags)
- Always include #PNPtv in hashtags
- Voice: raw, explicit, community-coded PNP language
- Vary the format (solo/group/slam/clouds/rush) based on the filename hints
`;

async function callGrok(prompt) {
  const res = await fetch(`${GROK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [
        {
          role: 'system',
          content: STYLE_GUIDE,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.85,
      max_tokens: 400,
    }),
    timeout: 30000,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function parseGrokResponse(text) {
  // Extract TITLE: and DESCRIPTION: sections
  const titleMatch = text.match(/^TITLE:\s*(.+)$/m);
  const descMatch = text.match(/DESCRIPTION:\s*([\s\S]+?)(?=$|\n\nTITLE:)/);

  if (titleMatch && descMatch) {
    return {
      title: titleMatch[1].trim().slice(0, 150),
      description: descMatch[1].trim().slice(0, 2000),
    };
  }

  // Fallback: first line = title, rest = description
  const lines = text.split('\n').filter(l => l.trim());
  return {
    title: lines[0]?.trim().slice(0, 150) || 'PNPtv Video',
    description: lines.slice(1).join('\n').trim().slice(0, 2000) || '',
  };
}

function getVideoHints(mediaUrl) {
  const filename = mediaUrl.split('/').pop() || '';
  // Extract hints from filename pattern: vid-{userId}-{timestamp}.ext
  const hints = [];
  if (filename.includes('mov') || filename.includes('mp4')) hints.push('video content');
  return hints.join(', ') || 'PNP video content';
}

async function main() {
  console.log('🚀 Starting video title/description population...');
  console.log(`   Grok model: ${GROK_MODEL}`);

  const client = await pool.connect();
  try {
    // Fetch all videos missing title OR description
    const { rows } = await client.query(`
      SELECT id, media_url, content, video_title, video_description
      FROM social_posts
      WHERE media_type = 'video'
        AND (video_title IS NULL OR video_title = '' OR video_description IS NULL OR video_description = '')
      ORDER BY created_at DESC
    `);

    console.log(`   Found ${rows.length} videos to populate\n`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const post = rows[i];
      const hints = getVideoHints(post.media_url || '');
      const existingTitle = post.video_title?.trim() || '';
      const existingDesc = post.video_description?.trim() || '';
      const postContent = post.content?.trim() || '';

      // Build prompt with context clues
      const needsTitle = !existingTitle;
      const needsDesc = !existingDesc;

      let prompt = `Generate a video ${needsTitle ? 'TITLE and ' : ''}DESCRIPTION for a PNPtv video post.\n`;
      if (existingTitle) prompt += `Existing title (keep this): ${existingTitle}\n`;
      if (postContent) prompt += `Post caption/context: "${postContent.slice(0, 200)}"\n`;
      prompt += `File: ${hints}\n`;
      prompt += `\nRespond with:\nTITLE: [your title here]\nDESCRIPTION: [your description here]`;

      process.stdout.write(`[${i + 1}/${rows.length}] Post #${post.id} ... `);

      try {
        const raw = await callGrok(prompt);
        const { title, description } = parseGrokResponse(raw);

        const finalTitle = existingTitle || title;
        const finalDesc = existingDesc || description;

        await client.query(
          `UPDATE social_posts SET video_title = $1, video_description = $2 WHERE id = $3`,
          [finalTitle, finalDesc, post.id]
        );

        console.log(`✅ "${finalTitle.slice(0, 50)}..."`);
        success++;

        // Rate limit: 1 req/sec to avoid hammering Grok
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
        failed++;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log(`\n✅ Done! Success: ${success} | Failed: ${failed}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
