#!/usr/bin/env node
'use strict';

/**
 * credit-flash-100usd-tokens.js
 *
 * Admin helper for the 2026-07-17 weekend flash sale. Credits 11,000 PNP Tokens
 * (10,000 base + 1,000 bonus) to a paying user once their EFIPay receipt has
 * been verified. Sends confirmation email + in-app notification.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
 *     --user <userId|@username|email> --tx <efipay-tx-id>
 *
 *   docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
 *     --user 8599671840 --tx 019f6f60-c199-abc123 --dry-run
 *
 *   docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
 *     --user santino --tx efipay:abc123 --amount 11000 --usd 100 --bonus 1000
 *
 * Flags:
 *   --user       userId (numeric TG id or UUID) OR @username OR email
 *   --tx         EFIPay transaction ID (must be unique — used for idempotency)
 *   --amount     total tokens to credit (default: 11000 = 10k base + 1k bonus)
 *   --usd        USD amount (default: 100)
 *   --bonus      bonus tokens to route to Santino creator_gifts pool (default: 1000)
 *   --dry-run    show what would happen without writing
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { getPool, query } = require(path.join(BACKEND, 'config/postgres'));
const { cache } = require(path.join(BACKEND, 'config/redis'));

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DRY_RUN     = process.argv.includes('--dry-run');
const USER_INPUT  = argOf('user');
const TX_ID       = argOf('tx');
const TOTAL       = parseInt(argOf('amount') || '11000', 10);
const USD         = parseFloat(argOf('usd') || '100');
const BONUS       = parseInt(argOf('bonus') || '1000', 10);
const BASE        = TOTAL - BONUS;

const SANTINO_ID = require(path.join(BACKEND, 'config/monetizationConfig')).SANTINO_USER_ID;

async function resolveUser(input) {
  if (!input) return null;
  if (input.startsWith('@')) {
    const { rows } = await query(
      'SELECT id, username, first_name, email, telegram, language FROM users WHERE LOWER(username) = LOWER($1) AND COALESCE(is_deleted,false)=false',
      [input.slice(1)]
    );
    return rows[0] || null;
  }
  if (input.includes('@')) {
    const { rows } = await query(
      'SELECT id, username, first_name, email, telegram, language FROM users WHERE LOWER(email) = LOWER($1) AND COALESCE(is_deleted,false)=false',
      [input]
    );
    return rows[0] || null;
  }
  const { rows } = await query(
    'SELECT id, username, first_name, email, telegram, language FROM users WHERE id = $1 OR telegram = $1 AND COALESCE(is_deleted,false)=false LIMIT 1',
    [input]
  );
  return rows[0] || null;
}

async function main() {
  if (!USER_INPUT || !TX_ID) {
    console.error('Usage: --user <userId|@username|email> --tx <efipay-tx-id> [--amount 11000] [--usd 100] [--bonus 1000] [--dry-run]');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Flash Sale Manual Credit — $100 → 11,000 tokens');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  const user = await resolveUser(USER_INPUT);
  if (!user) { console.error(`✗ User not found: ${USER_INPUT}`); process.exit(1); }

  const externalRef = `efipay:flash-100:${TX_ID}`;

  console.log(`   User:     ${user.id} (${user.username || user.first_name || 'no name'})`);
  console.log(`   Email:    ${user.email || '(none)'}`);
  console.log(`   Amount:   ${TOTAL} tokens ($${USD})`);
  console.log(`   Base:     ${BASE} → balance_tokens`);
  console.log(`   Bonus:    ${BONUS} → creator_gifts.${SANTINO_ID} (Santino-restricted)`);
  console.log(`   TX ID:    ${TX_ID}`);
  console.log(`   Ref key:  ${externalRef}\n`);

  // Idempotency: check payments table for external_ref
  const { rows: dupRows } = await query(
    `SELECT id, status FROM payments WHERE metadata->>'external_ref' = $1 LIMIT 1`,
    [externalRef]
  );
  if (dupRows.length > 0) {
    console.error(`✗ Already credited: payments.id=${dupRows[0].id} status=${dupRows[0].status}`);
    console.error('  Refusing to double-credit. Use a different TX ID if this is a separate purchase.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[DRY] Would credit. Stop.');
    process.exit(0);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Credit balance_tokens
    const balRow = await client.query(
      `INSERT INTO user_token_wallets (user_id, balance_tokens)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_tokens = user_token_wallets.balance_tokens + $2,
             updated_at = NOW()
       RETURNING balance_tokens, gifted_balance`,
      [String(user.id), BASE]
    );

    // 2. Credit bonus to creator_gifts.SANTINO
    if (BONUS > 0) {
      await client.query(
        `INSERT INTO user_token_wallets (user_id, creator_gifts)
              VALUES ($1, jsonb_build_object($2::text, $3::numeric))
         ON CONFLICT (user_id) DO UPDATE
           SET creator_gifts = jsonb_set(
                 COALESCE(user_token_wallets.creator_gifts, '{}'),
                 ARRAY[$2],
                 to_jsonb(COALESCE((user_token_wallets.creator_gifts->>$2)::numeric, 0) + $3)
               ),
               updated_at = NOW()`,
        [String(user.id), String(SANTINO_ID), BONUS]
      );
    }

    // 3. Ledger: payments row for audit / duplicate protection
    await client.query(
      `INSERT INTO payments
         (id, user_id, plan_id, plan_name, amount, currency, status, provider, payment_method, metadata, created_at, completed_at)
       VALUES
         (gen_random_uuid(), $1, 'token_purchase', $2, $3, 'USD', 'completed', 'efipay', 'card',
          $4::jsonb, NOW(), NOW())`,
      [
        String(user.id),
        `${TOTAL} PNP Tokens (Flash $100)`,
        USD,
        JSON.stringify({
          type: 'token_purchase',
          tokens: TOTAL,
          baseTokens: BASE,
          bonusTokens: BONUS,
          external_ref: externalRef,
          efipay_tx: TX_ID,
          promo: 'flash-100-weekend-2026-07-17',
        }),
      ]
    );

    // 4. In-app notification
    await client.query(
      `INSERT INTO notifications
         (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
       VALUES
         ('announcement', 'commerce', 'high', NULL, $1, 'system', $2, $3, $4::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        String(user.id),
        `flash-100-credited:${TX_ID}`,
        `🎉 ${TOTAL.toLocaleString()} PNP Tokens credited to your wallet. Enjoy!`,
        JSON.stringify({ url: 'https://pnptv.app/live' }),
      ]
    );

    await client.query('COMMIT');
    console.log(`✓ Credited ${TOTAL} tokens (base=${BASE}, bonus=${BONUS})`);
    console.log(`  New balance_tokens: ${balRow.rows[0].balance_tokens}`);

    // Invalidate both wallet cache keys
    await Promise.all([
      cache.del(`wallet:${user.id}`).catch(() => {}),
      cache.del(`wallet:obj:${user.id}`).catch(() => {}),
    ]);

    // Real-time socket push
    try {
      const io = require(path.join(BACKEND, 'services/socketSingleton')).get();
      if (io) {
        io.to(`user:${user.id}`).emit('wallet:updated', {
          balance: Number(balRow.rows[0].balance_tokens) + Number(balRow.rows[0].gifted_balance || 0),
          credited: TOTAL,
        });
      }
    } catch (_) {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`✗ Transaction rolled back: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
  }

  // 5. Confirmation email (best-effort, outside transaction)
  if (user.email && !user.email.includes('@telegram.pnptv.app')) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.PNPTV_SMTP_HOST,
        port: parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
        secure: process.env.PNPTV_SMTP_SECURE === 'true',
        auth: { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
      });
      const isEn = String(user.language || '').toLowerCase().startsWith('en');
      const name = user.first_name || user.username || (isEn ? 'Member' : 'Miembro');
      const subject = isEn
        ? `✅ ${TOTAL.toLocaleString()} PNP Tokens credited`
        : `✅ ${TOTAL.toLocaleString()} Tokens PNP acreditados`;
      const html = isEn
        ? `<p>Hey ${name},</p><p>Your <b>${TOTAL.toLocaleString()} PNP Tokens</b> from the weekend flash sale have been credited to your wallet.</p><ul><li>${BASE.toLocaleString()} tokens available across all creators</li><li>${BONUS.toLocaleString()} bonus tokens for Santino streams (creator-restricted)</li></ul><p>Open PNP Live: <a href="https://pnptv.app/live">https://pnptv.app/live</a></p><p>— PNPtv!</p>`
        : `<p>¡Hola ${name}!</p><p>Tus <b>${TOTAL.toLocaleString()} Tokens PNP</b> del flash del fin de semana ya están en tu wallet.</p><ul><li>${BASE.toLocaleString()} tokens disponibles con todos los creadores</li><li>${BONUS.toLocaleString()} tokens de bono para los streams de Santino (restringidos al creador)</li></ul><p>Abre PNP Live: <a href="https://pnptv.app/live">https://pnptv.app/live</a></p><p>— PNPtv!</p>`;
      await transporter.sendMail({
        from: '"PNPtv!" <support@pnptv.app>',
        to: user.email, subject, html,
      });
      console.log(`✓ Confirmation email sent to ${user.email}`);
      transporter.close();
    } catch (mailErr) {
      console.warn(`⚠ Email failed: ${mailErr.message}`);
    }
  } else {
    console.log(`  (no email on file — user will see the in-app notification instead)`);
  }

  console.log('\n═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message, err.stack); process.exit(1); });
