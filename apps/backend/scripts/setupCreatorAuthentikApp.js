#!/usr/bin/env node
// Usage: docker exec pnptv-bot node apps/backend/scripts/setupCreatorAuthentikApp.js
//
// One-time setup: Creates the "Creators" group in Authentik via the Admin API.
// The OIDC provider / application for the Creator Mini-App should be created via
// the Authentik Admin UI at https://auth.pnptv.app.
//
// Prerequisites (add to .env before running):
//   AUTHENTIK_API_TOKEN — an API token generated in Authentik Admin → Users → [admin user] → Tokens
//   AUTHENTIK_CREATORS_GROUP_NAME — optional override (default: "Creators")

'use strict';

const axios = require('axios');

const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'http://authentik-server:9000';
const AUTHENTIK_TOKEN = process.env.AUTHENTIK_API_TOKEN;
const GROUP_NAME = process.env.AUTHENTIK_CREATORS_GROUP_NAME || 'Creators';

if (!AUTHENTIK_TOKEN) {
  console.error(
    '[setup] ERROR: AUTHENTIK_API_TOKEN is not set.\n' +
    '  1. Log in to https://auth.pnptv.app/if/admin/\n' +
    '  2. Go to Directory → Tokens and App passwords → Create\n' +
    '  3. Set Intent = "API Token", copy the key\n' +
    '  4. Add AUTHENTIK_API_TOKEN=<key> to /opt/pnptvapp/.env\n' +
    '  5. Re-run this script inside the pnptv-bot container.'
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${AUTHENTIK_TOKEN}`,
  'Content-Type': 'application/json',
};

async function findGroup(name) {
  const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/groups/`, {
    params: { name },
    headers,
    timeout: 15000,
  });
  return res.data.results.find(g => g.name === name) || null;
}

async function createGroup(name) {
  const res = await axios.post(
    `${AUTHENTIK_URL}/api/v3/core/groups/`,
    { name, is_superuser: false, attributes: { pnptv_role: 'creator' } },
    { headers, timeout: 15000 }
  );
  return res.data;
}

async function run() {
  console.log(`[setup] Connecting to Authentik at ${AUTHENTIK_URL}`);
  console.log(`[setup] Looking for existing group: "${GROUP_NAME}"`);

  let group = null;

  try {
    group = await findGroup(GROUP_NAME);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || err.message;
    console.error(`[setup] ERROR: Failed to query groups endpoint (HTTP ${status}): ${detail}`);
    console.error('[setup] Check that AUTHENTIK_URL and AUTHENTIK_API_TOKEN are correct and reachable from within the container.');
    process.exit(1);
  }

  if (group) {
    console.log(`[setup] Group "${GROUP_NAME}" already exists — nothing to do.`);
    console.log(`[setup]   PK (UUID): ${group.pk}`);
    console.log(`[setup]   Name:      ${group.name}`);
    return;
  }

  console.log(`[setup] Group not found. Creating "${GROUP_NAME}"...`);

  try {
    group = await createGroup(GROUP_NAME);
    console.log(`[setup] SUCCESS: Group "${GROUP_NAME}" created.`);
    console.log(`[setup]   PK (UUID): ${group.pk}`);
    console.log(`[setup]   Name:      ${group.name}`);
    console.log('');
    console.log('[setup] Next steps:');
    console.log(`[setup]   1. Add AUTHENTIK_CREATORS_GROUP_NAME=${GROUP_NAME} to .env (if using a non-default name)`);
    console.log('[setup]   2. Create the Creator Mini-App OIDC provider in the Authentik Admin UI');
    console.log('[setup]   3. Bind the "Creators" group to that application in Authentik → Applications → Bindings');
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data) || err.message;
    console.error(`[setup] ERROR: Failed to create group (HTTP ${status}): ${detail}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('[setup] Unhandled error:', err.message);
  process.exit(1);
});
