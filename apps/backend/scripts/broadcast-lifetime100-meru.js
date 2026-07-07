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

const MESSAGE = `💳 ¡Ya puedes pagar tu Lifetime PRIME con tarjeta!

El acceso de por vida a PNPtv! está de vuelta — ahora con pago fácil por tarjeta de crédito, débito, Nequi, PSE y más.

✅ Paga una vez — PRIME completo para siempre
✅ Sin renovaciones, nunca
✅ Precio especial de fundadores: $100 USD

👉 https://pnptv.app/lifetime100

Solo quedan 13 cupos disponibles.

— PNPtv! 🏳️‍🌈`;

async function main() {
  await initializePostgres();

  const { rows } = await query(`
    SELECT id, username
    FROM users
    WHERE is_deleted IS NOT TRUE
      AND username IS NOT NULL AND username != ''
      AND username NOT LIKE 'deleted_%'
      AND tier IN ('prime','member','free')
    ORDER BY created_at ASC
  `);

  console.log(`Sending Lifetime100 Meru broadcast to ${rows.length} users${DRY_RUN ? ' (DRY RUN)' : ''}...`);
  let sent = 0, failed = 0;

  for (const user of rows) {
    if (DRY_RUN) {
      if (sent < 5) console.log(`  [DRY RUN] → ${user.username} (${user.id})`);
      sent++;
      continue;
    }
    try {
      await sendSystemDM(SYSTEM_SENDER_ID, user.id, MESSAGE, query);
      sent++;
      if (sent % 100 === 0) console.log(`  ${sent}/${rows.length} sent...`);
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
