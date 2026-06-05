#!/usr/bin/env node
'use strict';

/**
 * x-retweet-own-madrugada.js
 *
 * Quote-tweets the last 20 original tweets from @PNPMethDaddy stored in x_post_jobs.
 * Uses OAuth 1.0a via stored encrypted credentials (consumer_key_ref=santino).
 * Designed to run at madrugada (3 AM server time). Works on X free tier.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/x-retweet-own-madrugada.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/x-retweet-own-madrugada.js
 *
 * Cron (daily at 3 AM server time):
 *   0 3 * * * docker exec pnptv-bot node apps/backend/scripts/x-retweet-own-madrugada.js >> /opt/pnptvapp/logs/retweet-madrugada.log 2>&1
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const axios                 = require('axios');
const { query }             = require(path.join(BACKEND, 'config/postgres'));
const XPostService          = require(path.join(BACKEND, 'services/xPostService'));
const PaymentSecurityService = require(path.join(BACKEND, 'services/paymentSecurityService'));
const XOAuth1Service        = require(path.join(BACKEND, 'services/xOAuth1Service'));

const DRY_RUN     = process.argv.includes('--dry-run');
const ACCOUNT_ID  = '2ff3f4df-d154-4293-ad68-1beabd0662b8'; // @PNPMethDaddy
const X_USER_ID   = '1614126754892767233';
const MAX_TWEETS  = 20;
const DELAY_MS    = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTweetIds() {
  const { rows } = await query(`
    SELECT
      response_json->'data'->>'id' AS tweet_id,
      LEFT(text, 80)               AS preview,
      sent_at
    FROM x_post_jobs
    WHERE account_id = $1
      AND status = 'sent'
      AND response_json->'data'->>'id' IS NOT NULL
    ORDER BY sent_at DESC
    LIMIT $2
  `, [ACCOUNT_ID, MAX_TWEETS]);
  return rows;
}

async function buildOAuth1Credentials(account) {
  const ref = (account.consumer_key_ref || 'generic').toUpperCase();
  const consumerKey    = process.env[`${ref}_CONSUMER_KEY`]    || process.env.TWITTER_CONSUMER_KEY;
  const consumerSecret = process.env[`${ref}_CONSUMER_SECRET`] || process.env.TWITTER_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error(`OAuth 1.0a consumer key/secret not configured for ref="${ref}"`);
  }

  const decryptedToken = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token);
  const accessToken = decryptedToken?.accessToken || decryptedToken?.token;
  if (!accessToken) throw new Error('OAuth 1.0a: no access token found');

  const decryptedSecret = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token_secret);
  const tokenSecret = decryptedSecret?.accessToken || decryptedSecret?.token;
  if (!tokenSecret) throw new Error('OAuth 1.0a: no token secret found');

  return { consumerKey, consumerSecret, accessToken, tokenSecret };
}

async function quoteTweet(tweetId, credentials) {
  const url  = 'https://api.twitter.com/2/tweets';
  // Empty text with quote_tweet_id = minimal quote tweet (just embeds the original)
  const body = { text: '🔁', quote_tweet_id: tweetId };
  const authHeader = XOAuth1Service.buildAuthHeader('POST', url, {}, credentials);
  const { data } = await axios.post(url, body, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  return data?.data?.id || null;
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log(' X Auto-Retweet — @PNPMethDaddy — Madrugada');
  console.log('══════════════════════════════════════════════');
  console.log(` Started: ${new Date().toISOString()}`);
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  const account = await XPostService.getAccount(ACCOUNT_ID);
  if (!account) throw new Error('Account @PNPMethDaddy not found in x_accounts');

  const credentials = await buildOAuth1Credentials(account);
  console.log(` Account: @${account.handle} (oauth_version=${account.oauth_version}, ref=${account.consumer_key_ref})`);
  console.log(' Credentials: OK\n');

  const tweets = await getTweetIds();
  console.log(` Found ${tweets.length} stored tweets to retweet\n`);

  if (tweets.length === 0) {
    console.log(' No hay tweet IDs en x_post_jobs para esta cuenta.\n');
    process.exit(0);
  }

  let retweeted = 0, skipped = 0, failed = 0;

  for (const tweet of tweets) {
    const preview = (tweet.preview || '').replace(/\n/g, ' ').slice(0, 60);
    process.stdout.write(` → [${tweet.tweet_id}] "${preview}..." `);

    if (DRY_RUN) {
      console.log('(dry-run)');
      continue;
    }

    try {
      const newId = await quoteTweet(tweet.tweet_id, credentials);
      if (newId) {
        console.log(`✓ QT → ${newId}`);
        retweeted++;
      } else {
        console.log('⚠ no-op');
        skipped++;
      }
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail
        || err?.response?.data?.errors?.[0]?.message
        || err.message;
      console.log(`✗ ${status || ''} ${detail}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n══════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(` DRY RUN — would quote-tweet ${tweets.length} tweets`);
  } else {
    console.log(` DONE — ${retweeted} QT'd / ${skipped} skipped / ${failed} failed`);
  }
  console.log(` Finished: ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  if (err?.response?.data) console.error('X API:', JSON.stringify(err.response.data));
  process.exit(1);
});
