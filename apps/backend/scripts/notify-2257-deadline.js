#!/usr/bin/env node
'use strict';

const path    = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM                  = require(path.join(BACKEND, 'services/sendSystemDM'));

const SYSTEM_SENDER_ID = '8552451957';
const DRY_RUN = process.argv.includes('--dry-run');

const MESSAGE = `⚠️ Verificación de identidad requerida — fecha límite: viernes 11 de julio

Hola, necesitamos que completes tu verificación de identidad (18 U.S.C. § 2257) antes del viernes 11 de julio a las 11:59 p.m. UTC.

Sin esta verificación, tu cuenta quedará bloqueada para subir contenido, transmitir en vivo y publicar.

Para verificar:
1. Ve a tu perfil → Configuración del creador → Verificación de identidad
2. Ingresa tu nombre legal completo y fecha de nacimiento
3. Sube una foto de tu documento de identidad oficial (pasaporte, licencia de conducir o ID nacional)

Es un proceso de 2 minutos. Si tienes dudas, responde este mensaje.

— PNPtv!`;

async function main() {
  await initializePostgres();

  const { rows: creators } = await query(`
    SELECT id, username
    FROM users
    WHERE identity_verified = false
      AND identity_verification_required_by IS NOT NULL
      AND username NOT LIKE 'deleted_%'
      AND username IS NOT NULL
      AND username != ''
    ORDER BY username
  `);

  console.log(`Sending 2257 deadline DMs to ${creators.length} creators${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  let sent = 0;
  let failed = 0;

  for (const creator of creators) {
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would DM ${creator.username} (${creator.id})`);
      continue;
    }
    try {
      await sendSystemDM(SYSTEM_SENDER_ID, creator.id, MESSAGE, query);
      console.log(`✓ ${creator.username} (${creator.id})`);
      sent++;
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`✗ ${creator.username} (${creator.id}): ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
