#!/usr/bin/env node
'use strict';
const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM = require(path.join(BACKEND, 'services/sendSystemDM'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));

const SYSTEM_SENDER_ID = '8552451957';
const DRY_RUN = process.argv.includes('--dry-run');

const DM_MESSAGE = `💳 ¡Ya puedes pagar tu Lifetime PRIME con tarjeta!

El acceso de por vida a PNPtv! está de vuelta — ahora con pago fácil por tarjeta de crédito, débito, Nequi, PSE y más.

✅ Paga una vez — PRIME completo para siempre
✅ Sin renovaciones, nunca
✅ Precio especial de fundadores: $100 USD

👉 https://pnptv.app/lifetime100

Solo quedan 13 cupos disponibles.

— PNPtv! 🏳️‍🌈`;

const PUSH_OPTS = {
  title: '💳 Lifetime PRIME — ahora con tarjeta',
  body: 'Paga una vez, PRIME para siempre. $100 USD — solo 13 cupos. ¡Entra ya!',
  url: '/lifetime100',
  icon: '/icon-192.png',
};

async function main() {
  await initializePostgres();
  await PushNotificationService.initialize();

  const { rows } = await query(`
    SELECT id, username
    FROM users
    WHERE is_deleted IS NOT TRUE
      AND username IS NOT NULL AND username != ''
      AND username NOT LIKE 'deleted_%'
      AND tier IN ('prime', 'member', 'free')
    ORDER BY created_at ASC
  `);

  console.log(`\n=== DM broadcast to ${rows.length} users${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
  let dmSent = 0, dmFailed = 0;

  for (const user of rows) {
    if (DRY_RUN) {
      if (dmSent < 5) console.log(`  [DRY RUN DM] → ${user.username}`);
      dmSent++;
      continue;
    }
    try {
      await sendSystemDM(SYSTEM_SENDER_ID, user.id, DM_MESSAGE, query);
      dmSent++;
      if (dmSent % 200 === 0) console.log(`  DM ${dmSent}/${rows.length}...`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`  ✗ DM ${user.username}: ${err.message}`);
      dmFailed++;
    }
  }
  console.log(`DMs done — Sent: ${dmSent}, Failed: ${dmFailed}`);

  console.log(`\n=== Push notification to all subscribers${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
  if (DRY_RUN) {
    console.log('  [DRY RUN] Would call PushNotificationService.sendToAll(...)');
  } else {
    const pushSent = await PushNotificationService.sendToAll(PUSH_OPTS);
    console.log(`Push done — Sent: ${pushSent}`);
  }

  console.log('\nAll done.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
