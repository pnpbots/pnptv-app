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

const MESSAGE = `📞 ¡Llama en privado con tu creador favorito!

Ahora puedes reservar una videollamada privada 1 a 1 directamente a través de Mercado Pago.

⏱ 30 minutos — $60 USD
👉 https://mpago.li/2Hn5kNA

⏱ 60 minutos — $100 USD
👉 https://mpago.li/1k4oZNu

💳 El cobro se realiza en pesos colombianos (COP). El equivalente en USD es referencial según la tasa del día.

Para reservar: haz clic en el enlace, paga con tu tarjeta, Nequi, PSE u otro método disponible, y envíanos el comprobante para confirmar tu sesión.

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

  console.log(`Sending video call broadcast to ${rows.length} users${DRY_RUN ? ' (DRY RUN)' : ''}...`);
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
