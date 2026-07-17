# Flash Sale $100 → 11,000 Tokens — Support Triage Runbook

**Sale window:** 2026-07-17 through 2026-07-19 (weekend).
**Payment link:** `https://sag.efipay.co/checkout/payment-gateway/019f6f60-c199-7251-8037-0984721ecf07`
**Manual activation SLA:** ≤6 hours after receipt.

## Reply templates (copy-paste ready)

- **User sent a valid receipt + username** → `flash-100-reply-en.txt` / `flash-100-reply-es.txt`
- **User asked but missed a detail** → `flash-100-missing-info.txt` (has both languages)

Substitute the placeholders: `{NAME}`, `{EFIPAY_TX}`.

## Crediting one user

```bash
docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
  --user @santino --tx efipay-abc-123
```

`--user` accepts any of:
- numeric user id (Telegram or internal): `8599671840`
- `@username`
- `email@example.com`

`--tx` must be unique — it's the idempotency key. Re-running with the same
`--tx` is safe (script detects duplicate and skips).

Add `--dry-run` first to verify without writing:
```bash
docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
  --user @santino --tx efipay-abc-123 --dry-run
```

## Crediting a batch of users

Write a CSV — one row per receipt:

```csv
# receipts-2026-07-17.csv
# format: <user_input>,<tx_id>[,<notes>]
@santino,efipay-abc-123,paid 12:34 UTC
8599671840,efipay-def-456
someone@example.com,efipay-ghi-789,delayed payment
```

Copy into the container and run:

```bash
docker cp receipts-2026-07-17.csv pnptv-bot:/tmp/
docker exec pnptv-bot node apps/backend/scripts/credit-flash-100usd-tokens.js \
  --csv /tmp/receipts-2026-07-17.csv
```

Or pipe via stdin (no file copy):

```bash
cat receipts-2026-07-17.csv | docker exec -i pnptv-bot node \
  apps/backend/scripts/credit-flash-100usd-tokens.js --stdin
```

The batch mode is idempotent per row — safe to re-run the same CSV if network
blips or a few users failed.

## What the credit does

For each user:
1. `+10,000` to `user_token_wallets.balance_tokens` (spendable everywhere).
2. `+1,000` to `user_token_wallets.creator_gifts.<SANTINO_ID>` (Santino-only spend).
3. `INSERT INTO payments` for audit + duplicate protection (idempotency key = `efipay:flash-100:<tx>`).
4. In-app notification "🎉 11,000 tokens credited..." with deep-link to `/live`.
5. Cache invalidation on both `wallet:` and `wallet:obj:` keys.
6. Real-time socket `wallet:updated` event.
7. Confirmation email (best-effort; skipped if user has no real email).

## Verification queries

Confirm a user was credited:

```sql
SELECT id, amount, metadata->>'efipay_tx' AS tx, created_at
  FROM payments
 WHERE user_id = '<user-id>'
   AND metadata->>'promo' = 'flash-100-weekend-2026-07-17'
 ORDER BY created_at DESC;
```

Aggregate: how much did the flash sale generate?

```sql
SELECT COUNT(*) AS credits,
       SUM(amount) AS total_usd
  FROM payments
 WHERE metadata->>'promo' = 'flash-100-weekend-2026-07-17'
   AND status = 'completed';
```

Duplicate detection (should return zero rows):

```sql
SELECT metadata->>'external_ref' AS ref, COUNT(*)
  FROM payments
 WHERE metadata->>'promo' = 'flash-100-weekend-2026-07-17'
 GROUP BY 1
HAVING COUNT(*) > 1;
```

## Common issues

**User email says "I paid but no tokens yet"**
- Check the payments table by their tx_id (see verification query above).
- If missing: run the credit command. Reply with the standard template.
- If present + credited: ask them to hard-refresh the wallet page (cache TTL is 30s).

**User says "I paid the wrong amount"**
- EFIPay link is fixed at $100. If they see a different figure it's usually FX
  display in their local currency. Confirm the USD charge on their receipt.

**User says "I paid but the receipt just shows my email"**
- EFIPay confirmation page has the transaction ID at the top. Ask for the URL
  they landed on after paying (contains the tx id in the path).

**Refunds**
- If EFIPay refunds the $100, the tokens must be clawed back manually — there's
  no automated hook. See `payments.metadata.external_ref`, then reverse the
  `balance_tokens` and `creator_gifts` deltas by hand. Warn Carlos.
