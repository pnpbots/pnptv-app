#!/usr/bin/env node
'use strict';
const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));

const SYSTEM_SENDER_ID = '8552451957';
const DRY_RUN = process.argv.includes('--dry-run');

const MP_LINKS = {
  week:     'https://mpago.li/2SbKo8i',   // COP $50,000
  monthly:  'https://mpago.li/1Av4AAQ',   // COP $85,000
  yearly:   'https://mpago.li/1WoLUZ4',   // COP $330,000
  lifetime: 'https://mpago.li/2jx7YH4',   // COP $825,000
};

function planToLink(planId) {
  if (['lifetime-pass','lifetime80','lifetime100'].includes(planId)) return { tier: 'lifetime',  link: MP_LINKS.lifetime };
  if (planId === 'prime-diamond-pass-365d')                          return { tier: 'yearly',   link: MP_LINKS.yearly };
  if (['monthly-pass','member_monthly','creator_monthly'].includes(planId)) return { tier: 'monthly', link: MP_LINKS.monthly };
  if (planId === 'prime-week-pass-7d')                               return { tier: 'week',     link: MP_LINKS.week };
  return null;
}

const TIER_LABEL = {
  week:     'PRIME Week Pass (COP $50.000)',
  monthly:  'PRIME Monthly Pass (COP $85.000)',
  yearly:   'PRIME Yearly Pass (COP $330.000)',
  lifetime: 'PRIME Lifetime Pass (COP $825.000)',
};

function buildMessage(planId) {
  const mapped = planToLink(planId);
  if (!mapped) return null;
  const { tier, link } = mapped;
  return `Hola, notamos que tuviste un inconveniente al completar tu pago en PNPtv! 🙏

Tuvimos una falla técnica temporal en nuestro sistema de pagos crypto que impidió que algunas transacciones se completaran. El problema ya fue resuelto.

Queremos asegurarnos de que puedas acceder al plan que elegiste. Puedes completar tu pago fácilmente con Mercado Pago (tarjeta, Nequi, PSE y más):

👉 ${TIER_LABEL[tier]}
${link}

Si ya tienes acceso activo o pagaste por otro medio, ignora este mensaje. Para cualquier duda, responde aquí.

— PNPtv! 🏳️‍🌈`;
}

async function main() {
  await initializePostgres();

  const { rows } = await query(`
    SELECT DISTINCT ON (o.user_id)
      u.id AS user_id,
      u.username,
      o.plan_id,
      o.usd_amount
    FROM dash_subscription_orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.btcpay_invoice_id LIKE 'pnptv-nowp-%'
      AND o.status = 'expired'
      AND o.notes LIKE '%reconciler_np_400%'
      AND o.created_at > NOW() - INTERVAL '48 hours'
      AND u.username NOT LIKE 'deleted_%'
      AND u.username IS NOT NULL
      AND u.is_deleted IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id = u.id
          AND ue.add_on_id = 'prime'
          AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
          AND ue.source_plan_id != 'prime-trial-3d'
      )
    ORDER BY o.user_id, o.usd_amount DESC
  `);

  console.log(`Found ${rows.length} users to contact${DRY_RUN ? ' (DRY RUN)' : ''}:`);
  let sent = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const mapped = planToLink(row.plan_id);
    if (!mapped) { console.log(`  SKIP ${row.username} — no link for plan ${row.plan_id}`); skipped++; continue; }
    const message = buildMessage(row.plan_id);
    if (DRY_RUN) {
      console.log(`  [DRY RUN] → ${row.username} (${row.user_id}) | ${row.plan_id} $${row.usd_amount} → ${mapped.tier}`);
      continue;
    }
    try {
      await sendSystemDM(SYSTEM_SENDER_ID, row.user_id, message, query);
      console.log(`  ✓ ${row.username} (${row.plan_id} → ${mapped.tier})`);
      sent++;
      await new Promise(r => setTimeout(r, 350));
    } catch (err) {
      console.error(`  ✗ ${row.username}: ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. Sent: ${sent}, Skipped: ${skipped}, Failed: ${failed}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
