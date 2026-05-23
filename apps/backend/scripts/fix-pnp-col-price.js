#!/usr/bin/env node
/**
 * fix-pnp-col-price.js
 *
 * Creates a new Stripe Price for pnp_col_monthly at $5.00/month (replacing the
 * existing $50 price), then updates the plans table directly.
 *
 * Run from repo root:
 *   node apps/backend/scripts/fix-pnp-col-price.js
 *
 * Requires env: STRIPE_SECRET_KEY, DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE).
 * The restricted key must include "Prices: write". If it doesn't the script
 * prints the equivalent Stripe CLI command and exits — apply that manually,
 * then rerun with --price-id=price_xxx to skip creation and only patch the DB.
 */

'use strict';

require('dotenv').config();

const Stripe   = require('stripe');
const { Pool } = require('pg');

const PLAN_ID           = 'pnp_col_monthly';
const OLD_PRICE_ID      = 'price_1TZyhP2cOQFhFdEW4wEknTRM';
const NEW_PRICE_USD     = 5.00;
const NEW_PRICE_CENTS   = 500; // $5.00

async function main() {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeKey) {
    console.error('❌  STRIPE_SECRET_KEY not set');
    process.exit(1);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });

  // --- Parse --price-id flag (skip Stripe creation, go straight to DB patch) ---
  const priceFlag = process.argv.find((a) => a.startsWith('--price-id='));
  let newPriceId = priceFlag ? priceFlag.split('=')[1] : null;

  if (!newPriceId) {
    // 1. Look up the product from the existing price
    console.log(`Looking up product for existing price ${OLD_PRICE_ID} …`);
    let productId;
    try {
      const oldPrice = await stripe.prices.retrieve(OLD_PRICE_ID);
      productId = typeof oldPrice.product === 'string'
        ? oldPrice.product
        : oldPrice.product?.id;
      console.log(`  product: ${productId}  (current amount: ${oldPrice.unit_amount} cents)`);
    } catch (err) {
      console.error('❌  Could not retrieve existing price:', err.message);
      printManualInstructions();
      process.exit(1);
    }

    // 2. Create new $5/month price on the same product
    console.log(`Creating new $${NEW_PRICE_USD}/month price on product ${productId} …`);
    try {
      const newPrice = await stripe.prices.create({
        product:    productId,
        unit_amount: NEW_PRICE_CENTS,
        currency:   'usd',
        recurring:  { interval: 'month', interval_count: 1 },
        nickname:   'PNP Col Monthly — $5 community price',
        metadata:   { pnptv_plan_id: PLAN_ID },
      });
      newPriceId = newPrice.id;
      console.log(`  ✅ New price created: ${newPriceId}`);
    } catch (err) {
      if (err.type === 'StripePermissionError' || err.statusCode === 403) {
        console.error('❌  Stripe key lacks Prices: write scope.');
        printManualInstructions(productId);
        process.exit(1);
      }
      throw err;
    }
  } else {
    console.log(`Using supplied price ID: ${newPriceId}`);
  }

  // 3. Patch the DB
  console.log('Updating plans table …');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rowCount } = await pool.query(
      `UPDATE plans
          SET price           = $1,
              price_in_cop    = ROUND($1::numeric * 4000)::numeric(10,2),
              stripe_price_id = $2,
              updated_at      = NOW()
        WHERE id = $3`,
      [NEW_PRICE_USD, newPriceId, PLAN_ID]
    );
    if (rowCount === 0) {
      console.error(`❌  No row updated — plan '${PLAN_ID}' not found`);
      process.exit(1);
    }
    console.log(`  ✅ plans.${PLAN_ID} → price=$${NEW_PRICE_USD}, stripe_price_id=${newPriceId}`);

    // Flush Redis plan cache so the Subscribe page picks up the new price immediately
    const redis = require('../config/redis').getRedis();
    await redis.del('pnpapp:plans:all');
    console.log('  ✅ Redis plan cache flushed');
    await redis.quit();
  } finally {
    await pool.end();
  }

  console.log('\n✅  Done. pnp_col_monthly is now $5.00/month (Stripe + DB).');
  console.log(`   Archive the old price in Stripe dashboard if desired: ${OLD_PRICE_ID}`);
}

function printManualInstructions(productId) {
  console.log('\n─── Manual steps ────────────────────────────────────────────────────');
  console.log('1. Create the $5 price via Stripe CLI or Dashboard:');
  if (productId) {
    console.log(`   stripe prices create \\`);
    console.log(`     --product=${productId} \\`);
    console.log(`     --unit-amount=500 \\`);
    console.log(`     --currency=usd \\`);
    console.log(`     --recurring[interval]=month \\`);
    console.log(`     --nickname="PNP Col Monthly — \\$5 community price"`);
  } else {
    console.log('   (find product ID in Stripe Dashboard → Products → PNP Col Monthly)');
  }
  console.log('2. Copy the new price_xxx ID from the output.');
  console.log('3. Rerun this script with:');
  console.log('   node apps/backend/scripts/fix-pnp-col-price.js --price-id=price_xxx');
  console.log('─────────────────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
