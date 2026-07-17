#!/usr/bin/env node
'use strict';

/**
 * credit-flash-100usd-tokens.js
 *
 * Admin helper for the 2026-07-17 weekend flash sale. Credits 11,000 PNP Tokens
 * (10,000 base + 1,000 bonus to Santino creator_gifts) to a paying user once
 * their EFIPay receipt has been verified. Sends confirmation email + in-app
 * notification. Real-time socket push. Idempotent via payments.metadata.external_ref.
 *
 * SINGLE MODE:
 *   docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
 *     --user 8599671840 --tx efipay-abc-123
 *
 *   docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
 *     --user @santino --tx efipay-abc-123 --dry-run
 *
 * BATCH MODE (CSV):
 *   Create a CSV where each line is `<user_input>,<tx_id>[,<notes>]`
 *     (lines starting with # or blank lines are skipped)
 *
 *     # example receipts CSV
 *     @santino,efipay-abc-123,paid 12:34 UTC
 *     8599671840,efipay-def-456
 *     someone@example.com,efipay-ghi-789,delayed payment
 *
 *   Copy into container and run:
 *     docker cp receipts.csv pnptv-bot:/tmp/
 *     docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
 *       --csv /tmp/receipts.csv
 *
 *   Or pipe in from stdin:
 *     cat receipts.csv | docker exec -i pnptv-bot node \
 *       apps/backend/scripts/credit-flash-100usd-tokens.js --stdin
 *
 * FLAGS:
 *   --user <id|@name|email>  single-user mode: who to credit
 *   --tx <id>                single-user mode: EFIPay transaction id (idempotency key)
 *   --csv <path>             batch mode: process receipts from a CSV file
 *   --stdin                  batch mode: read CSV lines from stdin
 *   --amount N               total tokens (default 11000)
 *   --usd N                  USD amount (default 100)
 *   --bonus N                bonus tokens to creator_gifts.SANTINO (default 1000)
 *   --dry-run                show what would happen, no writes
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
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
const CSV_PATH    = argOf('csv');
const FROM_STDIN  = process.argv.includes('--stdin');
const TOTAL       = parseInt(argOf('amount') || '11000', 10);
const USD         = parseFloat(argOf('usd') || '100');
const BONUS       = parseInt(argOf('bonus') || '1000', 10);
const BASE        = TOTAL - BONUS;

const SANTINO_ID = require(path.join(BACKEND, 'config/monetizationConfig')).SANTINO_USER_ID;

async function resolveUser(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (s.startsWith('@')) {
    const { rows } = await query(
      'SELECT id, username, first_name, email, telegram, language FROM users WHERE LOWER(username) = LOWER($1) AND COALESCE(is_deleted,false)=false',
      [s.slice(1)]
    );
    return rows[0] || null;
  }
  if (s.includes('@')) {
    const { rows } = await query(
      'SELECT id, username, first_name, email, telegram, language FROM users WHERE LOWER(email) = LOWER($1) AND COALESCE(is_deleted,false)=false',
      [s]
    );
    return rows[0] || null;
  }
  const { rows } = await query(
    'SELECT id, username, first_name, email, telegram, language FROM users WHERE (id = $1 OR telegram = $1) AND COALESCE(is_deleted,false)=false LIMIT 1',
    [s]
  );
  return rows[0] || null;
}

/**
 * Credit one user. Returns { ok: boolean, reason?: string, credited?: boolean }.
 * `reason` is only set on failure. `credited=false` means already-credited
 * (idempotent skip), not an error.
 */
async function creditOne(userInput, txId) {
  const user = await resolveUser(userInput);
  if (!user) return { ok: false, reason: `user not found: ${userInput}` };

  const externalRef = `efipay:flash-100:${txId}`;
  const dup = await query(
    `SELECT id, status FROM payments WHERE metadata->>'external_ref' = $1 LIMIT 1`,
    [externalRef]
  );
  if (dup.rows.length > 0) {
    return { ok: true, credited: false, user, reason: `already credited (payments.id=${dup.rows[0].id})` };
  }

  if (DRY_RUN) return { ok: true, credited: false, user, reason: '[DRY] would credit' };

  const pool = getPool();
  const client = await pool.connect();
  let newBalance = 0;
  try {
    await client.query('BEGIN');
    const balRow = await client.query(
      `INSERT INTO user_token_wallets (user_id, balance_tokens)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_tokens = user_token_wallets.balance_tokens + $2,
             updated_at = NOW()
       RETURNING balance_tokens, gifted_balance`,
      [String(user.id), BASE]
    );
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
          efipay_tx: txId,
          promo: 'flash-100-weekend-2026-07-17',
        }),
      ]
    );
    await client.query(
      `INSERT INTO notifications
         (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
       VALUES
         ('announcement', 'commerce', 'high', NULL, $1, 'system', $2, $3, $4::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        String(user.id),
        `flash-100-credited:${txId}`,
        `🎉 ${TOTAL.toLocaleString()} PNP Tokens credited to your wallet. Enjoy!`,
        JSON.stringify({ url: 'https://pnptv.app/live' }),
      ]
    );
    await client.query('COMMIT');
    newBalance = Number(balRow.rows[0].balance_tokens) + Number(balRow.rows[0].gifted_balance || 0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, user, reason: err.message };
  } finally {
    client.release();
  }

  // Cache invalidation
  await Promise.all([
    cache.del(`wallet:${user.id}`).catch(() => {}),
    cache.del(`wallet:obj:${user.id}`).catch(() => {}),
  ]);

  // Real-time push
  try {
    const io = require(path.join(BACKEND, 'services/socketSingleton')).get();
    if (io) io.to(`user:${user.id}`).emit('wallet:updated', { balance: newBalance, credited: TOTAL });
  } catch (_) {}

  // Confirmation email (best-effort)
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
      transporter.close();
    } catch (_) { /* non-fatal */ }
  }

  return { ok: true, credited: true, user, newBalance };
}

async function readCsvLines(source) {
  const rl = readline.createInterface({ input: source, crlfDelay: Infinity });
  const rows = [];
  let lineNo = 0;
  for await (const rawLine of rl) {
    lineNo++;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',').map(s => s.trim());
    const [userInput, txId, notes] = parts;
    if (!userInput || !txId) {
      console.warn(`  ! line ${lineNo}: missing user or tx — skipped: "${rawLine}"`);
      continue;
    }
    rows.push({ userInput, txId, notes: notes || null, lineNo });
  }
  return rows;
}

async function runBatch(rows) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(` Flash Sale Batch Credit — ${rows.length} row(s)`);
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  const stats = { credited: 0, alreadyCredited: 0, failed: 0 };
  for (const { userInput, txId, notes, lineNo } of rows) {
    const label = notes ? ` (${notes})` : '';
    process.stdout.write(`[${lineNo}] ${userInput} / ${txId}${label} ... `);
    try {
      const r = await creditOne(userInput, txId);
      if (!r.ok) {
        stats.failed++;
        console.log(`✗ ${r.reason}`);
      } else if (r.credited) {
        stats.credited++;
        console.log(`✓ credited ${TOTAL} tokens (balance ${r.newBalance})`);
      } else {
        stats.alreadyCredited++;
        console.log(`↻ skipped (${r.reason})`);
      }
    } catch (err) {
      stats.failed++;
      console.log(`✗ exception: ${err.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(` credited: ${stats.credited}  skipped: ${stats.alreadyCredited}  failed: ${stats.failed}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(stats.failed > 0 ? 1 : 0);
}

async function main() {
  // Batch mode: CSV file
  if (CSV_PATH) {
    if (!fs.existsSync(CSV_PATH)) {
      console.error(`✗ CSV not found: ${CSV_PATH}`);
      process.exit(1);
    }
    const rows = await readCsvLines(fs.createReadStream(CSV_PATH));
    if (rows.length === 0) { console.error('✗ no valid rows in CSV'); process.exit(1); }
    return runBatch(rows);
  }

  // Batch mode: stdin
  if (FROM_STDIN) {
    const rows = await readCsvLines(process.stdin);
    if (rows.length === 0) { console.error('✗ no valid rows on stdin'); process.exit(1); }
    return runBatch(rows);
  }

  // Single-user mode
  if (!USER_INPUT || !TX_ID) {
    console.error('Usage: --user <id|@name|email> --tx <efipay-tx-id> [--amount 11000] [--usd 100] [--bonus 1000] [--dry-run]');
    console.error('   or: --csv <path> [--dry-run]');
    console.error('   or: --stdin [--dry-run]  (pipe CSV via stdin)');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Flash Sale Manual Credit — $100 → 11,000 tokens');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  const r = await creditOne(USER_INPUT, TX_ID);
  if (!r.ok) { console.error(`✗ ${r.reason}`); process.exit(1); }

  console.log(`   User:     ${r.user.id} (${r.user.username || r.user.first_name || 'no name'})`);
  console.log(`   Email:    ${r.user.email || '(none)'}`);
  if (r.credited) {
    console.log(`✓ Credited ${TOTAL} tokens (base=${BASE}, bonus=${BONUS} to Santino pool)`);
    console.log(`  New total balance: ${r.newBalance}`);
  } else {
    console.log(`↻ Skipped: ${r.reason}`);
  }
  console.log('\n═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
