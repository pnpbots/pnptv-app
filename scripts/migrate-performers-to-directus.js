#!/usr/bin/env node
/**
 * Migrate performers from pnptv PostgreSQL → Directus CMS
 *
 * Steps:
 *  1. Add missing fields to Directus performers collection
 *  2. Import all performers from pnptv PostgreSQL into Directus
 */

const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config({ path: '/opt/pnptvapp/.env' });
require('dotenv').config({ path: '/opt/pnptvapp/.env.production', override: true });

const DIRECTUS_URL = 'http://172.20.0.18:8055';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || 'daf858a8f7a12fe7ac687a8a4bf9cd26e51238e190f1815971d3aa133d10440b';

const api = axios.create({
  baseURL: DIRECTUS_URL,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  timeout: 15000,
});

const pool = new Pool({
  host: '172.20.0.6',
  port: 5432,
  database: 'pnptvbot',
  user: 'pnptvbot',
  password: 'Apelo801050#',
});

async function addField(field) {
  try {
    await api.post('/fields/performers', field);
    console.log(`  + field: ${field.field}`);
  } catch (err) {
    if (err.response?.data?.errors?.[0]?.message?.includes('already exists') ||
        err.response?.status === 400) {
      console.log(`  ~ field exists: ${field.field}`);
    } else {
      console.error(`  ! field ${field.field} failed:`, err.response?.data?.errors?.[0]?.message || err.message);
    }
  }
}

async function addMissingFields() {
  console.log('\n[1/2] Adding missing fields to Directus performers...');

  const fields = [
    {
      field: 'bio_short',
      type: 'text',
      meta: { interface: 'input', note: 'Short bio for cards (1-2 sentences)', width: 'full' },
      schema: {},
    },
    {
      field: 'pnptv_id',
      type: 'string',
      meta: { interface: 'input', note: 'UUID of the corresponding pnptv performers record', width: 'half', readonly: true },
      schema: { is_unique: true },
    },
    {
      field: 'is_available',
      type: 'boolean',
      meta: { interface: 'boolean', note: 'Currently accepting bookings', width: 'half', default_value: true },
      schema: { default_value: true },
    },
    {
      field: 'availability_message',
      type: 'text',
      meta: { interface: 'input', note: 'Message shown when unavailable', width: 'full' },
      schema: {},
    },
    {
      field: 'base_price_cents',
      type: 'integer',
      meta: { interface: 'input', note: 'Base price per call in cents (e.g. 10000 = $100)', width: 'half' },
      schema: { default_value: 10000 },
    },
    {
      field: 'currency',
      type: 'string',
      meta: { interface: 'select-dropdown', note: 'Billing currency', width: 'half',
        options: { choices: [{ text: 'USD', value: 'USD' }, { text: 'COP', value: 'COP' }] } },
      schema: { default_value: 'USD' },
    },
    {
      field: 'timezone',
      type: 'string',
      meta: { interface: 'input', note: 'Performer timezone (IANA)', width: 'half' },
      schema: { default_value: 'America/Bogota' },
    },
    {
      field: 'durations_minutes',
      type: 'json',
      meta: { interface: 'tags', note: 'Available call durations in minutes (e.g. 15, 30, 60)', width: 'half',
        options: { presets: ['15', '30', '60', '90'] } },
      schema: {},
    },
  ];

  for (const field of fields) {
    await addField(field);
  }
}

async function importPerformers() {
  console.log('\n[2/2] Importing performers from pnptv PostgreSQL → Directus...');

  const { rows } = await pool.query(`
    SELECT id, display_name, bio, bio_short, photo_url, is_featured, status,
           is_available, availability_message, base_price_cents, currency,
           timezone, durations_minutes
    FROM performers
    ORDER BY created_at
  `);

  console.log(`  Found ${rows.length} performer(s) in pnptv PostgreSQL`);

  for (const p of rows) {
    // Check if already exists in Directus by pnptv_id
    const existing = await api.get('/items/performers', {
      params: { 'filter[pnptv_id][_eq]': p.id, limit: 1 },
    }).then(r => r.data?.data?.[0]).catch(() => null);

    const slug = p.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const durationsArr = Array.isArray(p.durations_minutes) ? p.durations_minutes :
      (typeof p.durations_minutes === 'string' ? JSON.parse(p.durations_minutes) : [15, 30, 60]);

    const payload = {
      status: p.status === 'active' ? 'published' : 'draft',
      name: p.display_name,
      slug,
      bio: p.bio || null,
      bio_short: p.bio_short || null,
      is_featured: p.is_featured || false,
      is_available: p.is_available !== false,
      availability_message: p.availability_message || null,
      base_price_cents: p.base_price_cents || 10000,
      currency: p.currency || 'USD',
      timezone: p.timezone || 'America/Bogota',
      durations_minutes: durationsArr,
      pnptv_id: p.id,
      // photo_url is a path — link as external URL via social_links if no Directus upload exists
      social_links: p.photo_url ? JSON.stringify({ photo_url: p.photo_url }) : null,
    };

    if (existing) {
      await api.patch(`/items/performers/${existing.id}`, payload);
      console.log(`  ~ updated: ${p.display_name} (Directus id: ${existing.id})`);
    } else {
      const res = await api.post('/items/performers', payload);
      console.log(`  + created: ${p.display_name} (Directus id: ${res.data?.data?.id})`);
    }
  }
}

(async () => {
  try {
    await addMissingFields();
    await importPerformers();
    console.log('\n✓ Migration complete');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
