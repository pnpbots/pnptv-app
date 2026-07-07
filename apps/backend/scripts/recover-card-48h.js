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

const MESSAGE = `💳 ¡Ahora puedes pagar con tarjeta en PNPtv!

Vimos que intentaste completar un pago pero no pudo procesarse. ¡Buenas noticias! Ya tenemos una nueva opción de pago fácil con tarjeta de crédito, débito, Nequi o PSE.

👉 Para tu membresía mensual/semanal o PRIME:
https://pnptv.app/subscribe
→ Elige tu plan y haz clic en 💳 Tarjeta

👉 Para el pase de por vida ($100 USD — acceso PRIME para siempre):
https://pnptv.app/lifetime100

Cómo funciona:
1. Haz clic en 💳 Tarjeta en el plan que quieres
2. Paga el monto exacto del plan en Meru
3. Envía el comprobante a support@pnptv.app
4. Tu membresía se activa en menos de 12 horas

¿Tienes dudas? Responde este mensaje y te ayudamos.

— PNPtv! 🏳️‍🌈`;

async function main() {
  await initializePostgres();

  const { rows } = await query(`
    SELECT DISTINCT ON (d.user_id) d.user_id, u.username, d.plan_id, d.usd_amount
    FROM dash_subscription_orders d
    JOIN users u ON u.id::text = d.user_id::text
    WHERE d.created_at > NOW() - INTERVAL '48 hours'
      AND d.status NOT IN ('completed', 'settled', 'paid')
      AND d.usd_amount > 0
      AND d.plan_id NOT IN ('prime-annual-50', 'lifetime100')
      AND u.username IS NOT NULL AND u.username != '' AND u.username NOT LIKE 'deleted_%'
      AND COALESCE(u.is_deleted, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id::text = d.user_id::text
          AND ue.add_on_id IN ('prime', 'pnp-member', 'member')
          AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
      )
    ORDER BY d.user_id, d.created_at DESC
  `);

  console.log(`Sending card recovery DM to ${rows.length} users${DRY_RUN ? ' (DRY RUN)' : ''}...`);
  let sent = 0, failed = 0;

  for (const user of rows) {
    if (DRY_RUN) {
      if (sent < 10) console.log(`  [DRY RUN] → ${user.username} (${user.user_id}) plan=${user.plan_id} $${user.usd_amount}`);
      sent++;
      continue;
    }
    try {
      await sendSystemDM(SYSTEM_SENDER_ID, user.user_id, MESSAGE, query);
      sent++;
      if (sent % 50 === 0) console.log(`  ${sent}/${rows.length} sent...`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`  ✗ ${user.username}: ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
