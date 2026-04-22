'use strict';

/**
 * Dedup outreach email templates — bilingual (EN / ES).
 *
 * Sent to web-only accounts that were created without Telegram linkage.
 * Goal: warm, non-alarming call to action to link their Telegram account
 * before the 30-day retirement window closes.
 *
 * Usage:
 *   const { renderEn, renderEs } = require('./templates/dedup_outreach_email');
 *   const { subject, html, text } = renderEn({ username, email, accountId, telegramBotUrl, supportEmail });
 */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml({ headline, greeting, intro, steps, ctaLabel, ctaUrl, note, footer, accountLabel, accountId, supportEmail }) {
  const safeAccountId = escapeHtml(accountId);
  const safeSupportEmail = escapeHtml(supportEmail);
  const safeCtaUrl = escapeHtml(ctaUrl);
  const safeCtaLabel = escapeHtml(ctaLabel);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background:#111113;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111113;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#1C1C1E;border-radius:16px;overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background:#D4007A;padding:20px 28px;">
              <span style="font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:-0.3px;">PNPtv!</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 0 28px;color:#F5F5F7;">
              <p style="margin:0 0 6px 0;font-size:22px;font-weight:bold;color:#F5F5F7;">${escapeHtml(headline)}</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#A1A1A6;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#E5E5EA;line-height:1.6;">${escapeHtml(intro)}</p>

              <!-- Steps list -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
                ${steps.map((step, i) => `
                <tr>
                  <td valign="top" style="width:28px;padding:4px 0;">
                    <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#D4007A;color:#fff;border-radius:50%;font-size:11px;font-weight:bold;">${i + 1}</span>
                  </td>
                  <td style="padding:4px 0 4px 8px;font-size:14px;color:#E5E5EA;line-height:1.5;">${escapeHtml(step)}</td>
                </tr>`).join('')}
              </table>

              <!-- CTA button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                <tr>
                  <td align="center">
                    <a href="${safeCtaUrl}"
                       style="display:inline-block;padding:14px 32px;background:#D4007A;color:#ffffff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:0.2px;">
                      ${safeCtaLabel}
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:10px;">
                    <span style="font-size:11px;color:#6B6B6B;word-break:break-all;">${safeCtaUrl}</span>
                  </td>
                </tr>
              </table>

              <!-- Note / warning box -->
              <div style="background:rgba(255,180,84,0.08);border-left:4px solid #FFB454;border-radius:4px;padding:12px 14px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;color:#FFB454;line-height:1.5;">${escapeHtml(note)}</p>
              </div>

              <!-- Account ID reference -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;background:#252527;border-radius:8px;padding:12px 14px;">
                <tr>
                  <td>
                    <p style="margin:0 0 4px 0;font-size:11px;color:#A1A1A6;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(accountLabel)}</p>
                    <p style="margin:0;font-family:monospace;font-size:14px;color:#E5E5EA;word-break:break-all;">${safeAccountId}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:0 28px 28px 28px;border-top:1px solid #2C2C2E;margin-top:8px;">
              <p style="margin:20px 0 4px 0;font-size:12px;color:#6B6B6B;line-height:1.6;">${escapeHtml(footer)}</p>
              <p style="margin:0;font-size:12px;color:#6B6B6B;">
                ${escapeHtml('Need help? ')}
                <a href="mailto:${safeSupportEmail}" style="color:#D4007A;text-decoration:none;">${safeSupportEmail}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText({ headline, greeting, intro, steps, ctaLabel, ctaUrl, note, footer, accountLabel, accountId, supportEmail }) {
  const stepsText = steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  return [
    `PNPtv! — ${headline}`,
    '',
    greeting,
    '',
    intro,
    '',
    stepsText,
    '',
    `${ctaLabel}:`,
    ctaUrl,
    '',
    `IMPORTANT: ${note}`,
    '',
    `${accountLabel}: ${accountId}`,
    '',
    '─────────────────────────────',
    footer,
    `Support: ${supportEmail}`,
  ].join('\n');
}

/**
 * Render the English variant.
 * @param {{ username: string, email: string, accountId: string, telegramBotUrl: string, supportEmail: string }} ctx
 * @returns {{ subject: string, html: string, text: string }}
 */
function renderEn({ username, email, accountId, telegramBotUrl, supportEmail } = {}) {
  const botUrl = telegramBotUrl || 'https://t.me/PNPtelevisionBot';
  const support = supportEmail || 'support@pnptv.app';
  const safeUsername = username || email || 'PNPtv member';

  const data = {
    headline: 'Action needed to keep your membership active',
    greeting: `Hi ${safeUsername},`,
    intro:
      "We're making PNPtv accounts simpler and more secure. We noticed your account was created " +
      "without linking a Telegram — which is how most PNPtv members stay connected. " +
      "To keep your PRIME membership working smoothly and avoid any interruption, " +
      'please link your Telegram account in the next 30 days.',
    steps: [
      'Open PNPtv on Telegram using the button below.',
      'Send /start to confirm your account.',
      "That's it — your accounts will be merged automatically.",
    ],
    ctaLabel: 'Open PNPtv on Telegram',
    ctaUrl: botUrl,
    note:
      'After 30 days, web-only accounts that are not linked to Telegram will be retired. ' +
      "Your content and membership won't be lost — but you will need to use Telegram to log in.",
    accountLabel: 'Your account ID (quote this to support)',
    accountId: accountId || 'N/A',
    footer:
      'This is a transactional message sent to PNPtv members. ' +
      'No action is needed if you already log in via Telegram.',
    supportEmail: support,
  };

  return {
    subject: 'Link your Telegram to keep your PNPtv membership active',
    html: buildHtml(data),
    text: buildText(data),
  };
}

/**
 * Render the Spanish variant.
 * @param {{ username: string, email: string, accountId: string, telegramBotUrl: string, supportEmail: string }} ctx
 * @returns {{ subject: string, html: string, text: string }}
 */
function renderEs({ username, email, accountId, telegramBotUrl, supportEmail } = {}) {
  const botUrl = telegramBotUrl || 'https://t.me/PNPtelevisionBot';
  const support = supportEmail || 'support@pnptv.app';
  const safeUsername = username || email || 'miembro de PNPtv';

  const data = {
    headline: 'Acción requerida para mantener tu membresía activa',
    greeting: `Hola ${safeUsername},`,
    intro:
      'Estamos simplificando y mejorando la seguridad de las cuentas de PNPtv. ' +
      'Notamos que tu cuenta fue creada sin vincular un Telegram, que es la forma en que la mayoría de ' +
      'los miembros de PNPtv se mantienen conectados. Para que tu membresía PRIME siga funcionando ' +
      'sin interrupciones, vincula tu cuenta de Telegram en los próximos 30 días.',
    steps: [
      'Abre PNPtv en Telegram usando el botón de abajo.',
      'Envía /start para confirmar tu cuenta.',
      'Listo — tus cuentas se fusionarán automáticamente.',
    ],
    ctaLabel: 'Abrir PNPtv en Telegram',
    ctaUrl: botUrl,
    note:
      'Después de 30 días, las cuentas web que no estén vinculadas a Telegram serán desactivadas. ' +
      'Tu contenido y membresía no se perderán, pero necesitarás usar Telegram para iniciar sesión.',
    accountLabel: 'Tu ID de cuenta (indícalo al contactar soporte)',
    accountId: accountId || 'N/A',
    footer:
      'Este es un mensaje transaccional enviado a miembros de PNPtv. ' +
      'No necesitas hacer nada si ya inicias sesión con Telegram.',
    supportEmail: support,
  };

  return {
    subject: 'Vincula tu Telegram para mantener tu membresía de PNPtv activa',
    html: buildHtml(data),
    text: buildText(data),
  };
}

module.exports = { renderEn, renderEs };
