#!/usr/bin/env node
/**
 * Daimo Webhook Registration Utility
 *
 * Manages webhook endpoints for the PNPtv Daimo Pay integration via the
 * Daimo API. The HMAC secret returned on registration is used by the backend
 * to verify every incoming webhook payload. It is shown ONLY ONCE — save it.
 *
 * Usage:
 *   node scripts/register-daimo-webhook.js              # list existing webhooks
 *   node scripts/register-daimo-webhook.js --register   # register new webhook
 *   node scripts/register-daimo-webhook.js --test       # send test event to first webhook
 *   node scripts/register-daimo-webhook.js --delete <id>  # delete a webhook by ID
 *
 * Requires:  DAIMO_API_KEY in /opt/pnptvapp/.env
 * Runtime:   Node.js 18+ (uses global fetch)
 */

'use strict';

// Load .env.production first (has Daimo keys), then .env as fallback
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.production') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const DAIMO_API_BASE      = 'https://api.daimo.com/v1';
const WEBHOOK_URL         = 'https://pnptv.app/api/webhooks/daimo';
const WEBHOOK_DESCRIPTION = 'PNPtv production webhook';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey() {
  const key = process.env.DAIMO_API_KEY;
  if (!key || key === 'YOUR_DAIMO_API_KEY') {
    console.error('\nERROR: DAIMO_API_KEY is not set in .env');
    console.error('Add your Daimo API key to /opt/pnptvapp/.env and retry.\n');
    process.exit(1);
  }
  return key;
}

function buildHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function daimoRequest(method, path, body, apiKey) {
  const url = `${DAIMO_API_BASE}${path}`;
  const options = { method, headers: buildHeaders(apiKey) };
  if (body !== undefined) options.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    throw new Error(`Network error reaching Daimo API: ${networkErr.message}`);
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const detail = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    throw new Error(`Daimo API ${method} ${path} returned HTTP ${res.status}\n${detail}`);
  }

  return data;
}

function extractWebhooks(responseData) {
  if (Array.isArray(responseData))            return responseData;
  if (Array.isArray(responseData.webhooks))   return responseData.webhooks;
  if (Array.isArray(responseData.data))       return responseData.data;
  return [];
}

function printWebhookTable(webhooks) {
  if (webhooks.length === 0) { console.log('  (no webhooks registered)\n'); return; }

  console.log(`  Found ${webhooks.length} webhook(s):\n`);
  for (const wh of webhooks) {
    const events  = Array.isArray(wh.events) ? wh.events.join(', ') : String(wh.events ?? '');
    console.log(`  ID:          ${wh.id}`);
    console.log(`  URL:         ${wh.url}`);
    console.log(`  Events:      ${events}`);
    console.log(`  Description: ${wh.description || '(none)'}`);
    console.log(`  Created:     ${wh.createdAt ?? '(unknown)'}`);
    console.log(`  Secret:      ${wh.secret ?? '(redacted)'}`);
    console.log('  ' + '-'.repeat(60));
  }
  console.log('');
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function listWebhooks(apiKey) {
  console.log('\nFetching existing Daimo webhooks...\n');
  const webhooks = extractWebhooks(await daimoRequest('GET', '/webhooks', undefined, apiKey));
  printWebhookTable(webhooks);
  return webhooks;
}

async function registerWebhook(apiKey) {
  console.log('\nRegistering new Daimo webhook...');
  console.log(`  Target URL : ${WEBHOOK_URL}`);
  console.log('  Events     : * (all)\n');

  const response = await daimoRequest('POST', '/webhooks', {
    url:         WEBHOOK_URL,
    events:      ['*'],
    description: WEBHOOK_DESCRIPTION,
  }, apiKey);

  // Response may be nested under `webhook` key
  const wh = response.webhook || response;

  console.log('Webhook registered successfully!\n');
  console.log(`  ID      : ${wh.id}`);
  console.log(`  URL     : ${wh.url}`);
  console.log(`  Created : ${wh.createdAt ?? '(unknown)'}`);
  console.log('');

  if (wh.secret) {
    console.log('================================================================');
    console.log('  !! SAVE THIS SECRET -- IT IS SHOWN ONLY ONCE !!');
    console.log('================================================================');
    console.log(`  ${wh.secret}`);
    console.log('================================================================');
    console.log('');
    console.log('ACTION REQUIRED:');
    console.log('  1. Copy the secret above (it will NEVER be shown again).');
    console.log('  2. Open /opt/pnptvapp/.env');
    console.log('  3. Set:');
    console.log('');
    console.log(`     DAIMO_WEBHOOK_HMAC_SECRET=${wh.secret}`);
    console.log('');
    console.log('  4. Restart the backend:');
    console.log('');
    console.log('     cd /opt/pnptvapp && docker compose up -d pnptv-bot');
    console.log('');
  } else {
    console.warn('WARNING: No secret returned. Contact Daimo support.\n');
  }
}

async function sendTestEvent(apiKey) {
  console.log('\nFetching webhooks to locate a test target...\n');
  const webhooks = extractWebhooks(await daimoRequest('GET', '/webhooks', undefined, apiKey));

  if (webhooks.length === 0) {
    console.error('ERROR: No webhooks registered. Run --register first.\n');
    process.exit(1);
  }

  const target = webhooks[0];
  console.log(`Sending test event to: ${target.id}`);
  console.log(`  URL: ${target.url}\n`);

  await daimoRequest('POST', `/webhooks/${target.id}/test`, {}, apiKey);

  console.log('Test event dispatched.');
  console.log('Verify receipt in server logs:\n');
  console.log('  docker logs pnptv-bot --tail 50\n');
}

async function deleteWebhook(id, apiKey) {
  if (!id || id.trim() === '') {
    console.error('\nERROR: --delete requires a webhook ID.\n');
    console.error('Usage: node scripts/register-daimo-webhook.js --delete <id>\n');
    process.exit(1);
  }

  console.log(`\nDeleting webhook ${id}...\n`);
  await daimoRequest('DELETE', `/webhooks/${id}`, undefined, apiKey);
  console.log('Webhook deleted.\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const flagRegister = args.includes('--register');
  const flagTest     = args.includes('--test');
  const deleteIdx    = args.indexOf('--delete');
  const flagDelete   = deleteIdx !== -1;
  const deleteId     = flagDelete ? args[deleteIdx + 1] : null;

  if ([flagRegister, flagTest, flagDelete].filter(Boolean).length > 1) {
    console.error('\nERROR: Only one of --register, --test, or --delete may be used at a time.\n');
    process.exit(1);
  }

  const apiKey = getApiKey();

  try {
    if (flagDelete) {
      await deleteWebhook(deleteId, apiKey);
      await listWebhooks(apiKey);
    } else if (flagRegister) {
      await listWebhooks(apiKey);
      await registerWebhook(apiKey);
    } else if (flagTest) {
      await sendTestEvent(apiKey);
    } else {
      await listWebhooks(apiKey);
      console.log('Run with a flag to take action:');
      console.log('  --register       Register a new webhook endpoint');
      console.log('  --test           Send a test event to the first webhook');
      console.log('  --delete <id>    Delete a webhook by ID\n');
    }
  } catch (err) {
    console.error('\nERROR:', err.message, '\n');
    process.exit(1);
  }
}

main();
