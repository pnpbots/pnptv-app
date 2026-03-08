#!/usr/bin/env node
'use strict';

/**
 * sendCreatorTerms.js
 *
 * Sends Creator Terms & Conditions + legal documentation via Telegram DM
 * AND email (with CC to support@pnptv.app) to specific creators.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendCreatorTerms.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendCreatorTerms.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const emailService = require(path.join(BACKEND_ROOT, 'bot/services/emailservice'));

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1500;
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

const TARGET_USERNAMES = ['miloenleche', 'Lexboytv', 'FrankBoXReal'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    console.log('  [TG SKIP] No BOT_TOKEN configured');
    return { success: false, error: 'No BOT_TOKEN' };
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API error' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function buildTelegramMessage(firstName) {
  const name = firstName || 'Creador';

  return `<b>Felicidades ${name}! Ya eres Creador Diamond en PNPtv!</b>

A continuacion te compartimos los documentos legales importantes de tu cuenta de creador. Por favor leelos con atencion.

<b>ACUERDO DE CREADOR PNPtv v1.0</b>

<b>1. Reparto de Ingresos</b>
Los creadores reciben el 70% de los ingresos netos generados por su contenido y transmisiones en vivo. PNPtv retiene el 30% como tarifa de plataforma. Los pagos se procesan cada martes antes de las 2:00 PM UTC para saldos superiores a $10 USD.

<b>2. Propiedad del Contenido</b>
Tu conservas todos los derechos de propiedad sobre tu contenido. Al subirlo, otorgas a PNPtv una licencia no exclusiva y mundial para alojar, mostrar y distribuir tu contenido en la plataforma.

<b>3. Politica de Contenido</b>
Todo el contenido debe cumplir con las leyes aplicables. Contenido prohibido incluye: contenido que involucre menores de edad, actos no consensuales, bestialidad o cualquier actividad ilegal. PNPtv se reserva el derecho de eliminar contenido a su sola discrecion.

<b>4. Cumplimiento 18 U.S.C. 2257</b>
Certificas que tienes al menos 18 anos de edad y que todas las personas que aparecen en tu contenido tienen al menos 18 anos. Aceptas mantener los registros requeridos por la ley federal.

<b>5. Responsabilidad Fiscal</b>
Eres responsable de declarar y pagar todos los impuestos sobre los ingresos obtenidos a traves de PNPtv. PNPtv puede emitir formularios 1099 (EE.UU.) o documentacion equivalente segun lo requiera la ley.

<b>6. Terminacion</b>
Cualquiera de las partes puede terminar este acuerdo en cualquier momento. Al terminar, tu contenido sera eliminado dentro de 30 dias y cualquier saldo pendiente sera pagado.

<b>7. Ley Aplicable</b>
Este acuerdo se rige por las leyes del Estado de California, EE.UU.

<b>TERMINOS DEL PROGRAMA DE CREADORES</b>

- Los ingresos por suscripciones se dividen 70% para ti / 30% para PNPtv.
- Los pagos se procesan cada martes antes de las 2:00 PM UTC.
- Pago minimo: $10 USD. Ganancias por debajo del umbral se acumulan para la siguiente semana.
- Te comprometes a mantener actividad regular de publicacion.
- Minimo 1 publicacion de media por semana.
- Al menos 10% de publicaciones deben ser gratuitas (publicas).
- Al menos 10% de publicaciones deben ser accesibles para miembros PRIME.
- Hasta 80% de publicaciones pueden ser exclusivas para tus suscriptores.
- PNPtv se reserva el derecho de desactivar perfiles de creadores por violaciones a los estandares comunitarios o la politica de strikes (3 strikes = suspension).
- Puedes desactivar voluntariamente en cualquier momento.

<b>POLITICA DE STRIKES</b>
- Strike 1: Advertencia
- Strike 2: Restriccion temporal
- Strike 3: Suspension de cuenta de creador

Al continuar usando tu cuenta de creador en PNPtv, aceptas estos terminos y condiciones.

Revisa tus terminos completos en la app:
https://pnptv.app/creator-terms

Cualquier duda, contacta a @SantinoFurioso

Con amor,
<b>El equipo de PNPtv!</b>`;
}

// ── Email ────────────────────────────────────────────────────────────────────

function buildEmailHtml(firstName) {
  const name = firstName || 'Creador';

  const styles = `
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #0d0d0d; margin: 0; padding: 0; }
    .container { max-width: 700px; margin: 20px auto; background: #1a1a1a; padding: 30px; border-radius: 12px; box-shadow: 0 2px 20px rgba(212,0,122,0.15); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #D4007A; }
    .header h1 { background: linear-gradient(135deg, #D4007A, #E69138); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0; font-size: 32px; }
    .badge { background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; padding: 20px; border-radius: 10px; text-align: center; margin: 24px 0; }
    .badge h2 { margin: 0; font-size: 22px; }
    .content { padding: 10px 0; color: #ccc; }
    .content p { color: #ccc; }
    h3 { color: #E69138; margin-top: 24px; }
    .section { background: #111; border: 1px solid rgba(212,0,122,0.3); padding: 16px 20px; border-radius: 8px; margin: 16px 0; }
    .section h4 { color: #D4007A; margin: 0 0 8px 0; }
    .section p, .section li { color: #ccc; font-size: 14px; }
    ul { padding-left: 20px; }
    ul li { margin: 6px 0; color: #ccc; font-size: 14px; }
    .strike-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .strike-table td { padding: 8px 12px; border: 1px solid #333; color: #ccc; font-size: 14px; }
    .strike-table td:first-child { color: #E69138; font-weight: bold; width: 100px; }
    .button { display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white !important; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: bold; font-size: 16px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
  `;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terminos y Condiciones de Creador - PNPtv!</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>

    <div class="badge">
      <h2>Felicidades ${name}! Eres Creador Diamond</h2>
      <p style="margin:8px 0 0 0; opacity:0.9;">A continuacion tus documentos legales importantes</p>
    </div>

    <div class="content">
      <h3>ACUERDO DE CREADOR PNPtv v1.0</h3>

      <div class="section">
        <h4>1. Reparto de Ingresos</h4>
        <p>Los creadores reciben el <strong>70%</strong> de los ingresos netos generados por su contenido y transmisiones en vivo. PNPtv retiene el 30% como tarifa de plataforma. Los pagos se procesan cada martes antes de las 2:00 PM UTC para saldos superiores a $10 USD.</p>
      </div>

      <div class="section">
        <h4>2. Propiedad del Contenido</h4>
        <p>Tu conservas todos los derechos de propiedad sobre tu contenido. Al subirlo, otorgas a PNPtv una licencia no exclusiva y mundial para alojar, mostrar y distribuir tu contenido en la plataforma.</p>
      </div>

      <div class="section">
        <h4>3. Politica de Contenido</h4>
        <p>Todo el contenido debe cumplir con las leyes aplicables. Contenido prohibido incluye: contenido que involucre menores de edad, actos no consensuales, bestialidad o cualquier actividad ilegal. PNPtv se reserva el derecho de eliminar contenido a su sola discrecion.</p>
      </div>

      <div class="section">
        <h4>4. Cumplimiento 18 U.S.C. 2257</h4>
        <p>Certificas que tienes al menos 18 anos de edad y que todas las personas que aparecen en tu contenido tienen al menos 18 anos. Aceptas mantener los registros requeridos por la ley federal.</p>
      </div>

      <div class="section">
        <h4>5. Responsabilidad Fiscal</h4>
        <p>Eres responsable de declarar y pagar todos los impuestos sobre los ingresos obtenidos a traves de PNPtv. PNPtv puede emitir formularios 1099 (EE.UU.) o documentacion equivalente segun lo requiera la ley.</p>
      </div>

      <div class="section">
        <h4>6. Terminacion</h4>
        <p>Cualquiera de las partes puede terminar este acuerdo en cualquier momento. Al terminar, tu contenido sera eliminado dentro de 30 dias y cualquier saldo pendiente sera pagado.</p>
      </div>

      <div class="section">
        <h4>7. Ley Aplicable</h4>
        <p>Este acuerdo se rige por las leyes del Estado de California, EE.UU.</p>
      </div>

      <h3>TERMINOS DEL PROGRAMA DE CREADORES</h3>
      <ul>
        <li>Los ingresos por suscripciones se dividen <strong>70% para ti / 30% para PNPtv</strong>.</li>
        <li>Los pagos se procesan cada martes antes de las 2:00 PM UTC.</li>
        <li>Pago minimo: $10 USD. Ganancias por debajo del umbral se acumulan para la siguiente semana.</li>
        <li>Te comprometes a mantener actividad regular de publicacion.</li>
        <li>Minimo 1 publicacion de media por semana.</li>
        <li>Al menos 10% de publicaciones deben ser gratuitas (publicas).</li>
        <li>Al menos 10% de publicaciones deben ser accesibles para miembros PRIME.</li>
        <li>Hasta 80% de publicaciones pueden ser exclusivas para tus suscriptores.</li>
        <li>PNPtv se reserva el derecho de desactivar perfiles de creadores por violaciones a los estandares comunitarios o la politica de strikes.</li>
        <li>Puedes desactivar voluntariamente en cualquier momento.</li>
      </ul>

      <h3>POLITICA DE STRIKES</h3>
      <table class="strike-table">
        <tr><td>Strike 1</td><td>Advertencia</td></tr>
        <tr><td>Strike 2</td><td>Restriccion temporal</td></tr>
        <tr><td>Strike 3</td><td>Suspension de cuenta de creador</td></tr>
      </table>

      <p style="margin-top:24px;">Al continuar usando tu cuenta de creador en PNPtv, aceptas estos terminos y condiciones.</p>

      <div style="text-align:center; margin:30px 0;">
        <a href="https://pnptv.app/creator-terms" class="button">Ver Terminos en la App</a>
      </div>

      <p>Cualquier duda, contacta a <strong style="color:#E69138">@SantinoFurioso</strong> en Telegram o responde a este correo.</p>

      <p>Con amor,<br><strong style="color:#E69138">El equipo de PNPtv!</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv! &bull; <a href="https://pnptv.app" style="color:#D4007A">pnptv.app</a></p>
      <p>Este correo fue enviado como parte de tu activacion como creador en PNPtv!</p>
    </div>
  </div>
</body>
</html>`.trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Send Creator Terms & Legal Docs ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  const placeholders = TARGET_USERNAMES.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: creators } = await query(
    `SELECT id, username, first_name, email, language FROM users WHERE username IN (${placeholders})`,
    TARGET_USERNAMES
  );

  console.log(`Found ${creators.length} of ${TARGET_USERNAMES.length} target creators.\n`);

  if (creators.length === 0) {
    console.log('No creators found. Exiting.');
    process.exit(0);
  }

  let tgOk = 0, tgFail = 0, emOk = 0, emFail = 0, emSkip = 0;

  for (const creator of creators) {
    const chatId = creator.id;
    const lang = creator.language || 'es';
    const tgMsg = buildTelegramMessage(creator.first_name);

    // ── Telegram ──
    console.log(`[TG] Sending to ${creator.username} (${chatId})...`);
    if (DRY_RUN) {
      console.log(`  [DRY] Would send TG to ${chatId}`);
      tgOk++;
    } else {
      const result = await sendTelegramMessage(chatId, tgMsg);
      if (result.success) {
        tgOk++;
        console.log(`  [OK] TG sent to ${creator.username}`);
      } else {
        tgFail++;
        console.log(`  [FAIL] TG ${creator.username}: ${result.error}`);
      }
      await sleep(DELAY_MS);
    }

    // ── Email ──
    if (creator.email && creator.email.includes('@')) {
      console.log(`[EMAIL] Sending to ${creator.username} (${creator.email})...`);
      if (DRY_RUN) {
        console.log(`  [DRY] Would send email to ${creator.email} (CC: support@pnptv.app)`);
        emOk++;
      } else {
        try {
          const transporter = emailService.transporters.pnptv;
          if (!transporter) {
            console.log('  [SKIP] PNPtv email transporter not configured');
            emSkip++;
            continue;
          }
          await transporter.sendMail({
            from: '"PNPtv!" <noreply@pnptv.app>',
            to: creator.email,
            cc: 'support@pnptv.app',
            subject: 'Terminos y Condiciones de Creador Diamond - PNPtv!',
            html: buildEmailHtml(creator.first_name),
          });
          emOk++;
          console.log(`  [OK] Email sent to ${creator.email}`);
        } catch (err) {
          emFail++;
          console.log(`  [FAIL] Email ${creator.email}: ${err.message}`);
        }
        await sleep(500);
      }
    } else {
      console.log(`  [SKIP] ${creator.username} has no email address`);
      emSkip++;
    }
  }

  console.log(`\nTelegram: ${tgOk} sent, ${tgFail} failed`);
  console.log(`Email: ${emOk} sent, ${emFail} failed, ${emSkip} skipped (no email)`);
  console.log('\n=== Done ===\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('sendCreatorTerms failed:', err);
  process.exit(1);
});
