# Non-Telegram Account Dedup Audit

**Date:** 2026-04-22
**DB:** pnptvbot @ pg-pnptv
**Total users:** 1,715 — 1,148 Telegram-ID (numeric) + 567 non-Telegram
**Goal:** Ensure PRIME memberships land on Telegram-ID profiles; remove non-Telegram duplicates safely.

---

## Categorization of the 567 non-Telegram accounts

| Cat | Name | Users | PRIME | Action |
|---|---|---:|---:|---|
| **A** | `telegram` col points to an existing Telegram-ID user row | 5 | 1 | Merge UUID → existing TG row |
| **B** | `telegram` col populated, but no TG-ID row exists yet | 348 | 9 | Rename UUID `id` → declared numeric TG id (preserves all FKs; next TG login lands on same row) |
| **C** | PRIME, no TG link at all | 8 | 8 | **Do not delete.** Outreach email; 30-day grace to link TG. |
| **C2** | Free tier, no TG link | 174 | 0 | Outreach email; after 30-day grace, hard delete if inactive |
| **D_akadmin** | Authentik system account `support@pnptv.app` | 1 | 1 | Soft-delete — superadmin is already `@SantinoFurioso` (id 8599671840) |
| **D_test** | `meru-test-user-uuid`, `SYSTEM` | 2 | 1 | Hard delete test user; keep `SYSTEM` |
| **D_tombstone** | `username LIKE 'deleted_*'` or `is_deleted=true` | 29 | 1 | Leave as-is (already tombstoned) |

**Total** → 567 ✓

---

## Why duplicates happen (root cause)

| Entry point | File | Creates UUID? | Cross-checks TG col? |
|---|---|---|---|
| Telegram WebApp (`/api/telegram-auth`) | `bot/api/handlers/telegramAuthHandler.js:117` | No (uses Telegram numeric id) | Yes — `WHERE telegram = $1 OR pnptv_id = $2` ✓ |
| OIDC / Authentik callback | `services/authentikService.js` | Yes (`uuidv4()`) | No — does not check `telegram` or `email` against numeric-id rows |
| Email/password register | `bot/api/controllers/authController.js:313` | Yes | Partial — checks email but never cross-refs Telegram |
| Email-capture during ePayco checkout | `services/userService.js:565 ensureEmailCredentials` | No (updates existing row) | N/A — but creates new row via `createWebUser` upstream when user is anon |
| ATProto/Bluesky OAuth | `services/atprotoOAuthService.js` | Yes | No |
| X OAuth | `services/xOAuthService.js` | Yes | No |

**Key insight:** Once a user opens the Telegram WebApp AFTER previously registering via web, `telegramAuthHandler.js` already matches them correctly via `WHERE telegram = $1`. So **Category B will auto-resolve** on next Telegram login — the UUID row already matches the Telegram user. But the UUID id never gets rewritten to the numeric Telegram id; both forms of the record coexist logically. Migration 219 normalizes this.

---

## The one truly active duplicate

| UUID row | Telegram row |
|---|---|
| `8bf8352a-88cc-439c-93c6-c5a46ffdd09c` (MANU23_01) | `1684976172` (MANU23_01) |
| tier=PRIME, plan=lifetime-pass | tier=free, plan=prime-week-pass-7d |
| email=juanmaruiz.s23@gmail.com | (no email) |
| created 2026-03-27 | (earlier, via bot) |

**Merge direction:** winner = `1684976172` (Telegram-id is canonical per user request); loser = UUID.

---

## Category B rename safety check

Before renaming a UUID row's `id` to its declared numeric TG id, we must verify:
1. `declared_tg` is a valid numeric string (✓ all 348 match `^[0-9]+$`)
2. No existing row has that id (✓ by definition of Category B)
3. No referential collision (handled by `UPDATE users SET id = X` cascading via `ON UPDATE CASCADE`)

**Problem:** Most FK constraints on `users.id` use `ON DELETE CASCADE` only, not `ON UPDATE CASCADE`. Direct `UPDATE users SET id = ...` would fail on FK violation. So the migration uses the same pattern as migration 127: **transfer all FK references** (update child tables' `user_id`, then insert new row, then soft-delete old).

Actual operation for each Category B user:
```sql
-- 1. Insert new numeric-id row copying all columns from the UUID row
INSERT INTO users (id, ...) SELECT telegram AS id, ... FROM users WHERE id = :uuid;
-- 2. Re-point every FK-bearing table
UPDATE user_entitlements SET user_id = :tg_id WHERE user_id = :uuid;
UPDATE payments          SET user_id = :tg_id WHERE user_id = :uuid;
-- ... (see accountMergeService for full table list)
-- 3. Soft-delete the UUID row with merge_notes
```

---

## Category C PRIME users (keep, email, wait)

These 8 accounts paid for PRIME via web (ePayco) but have no Telegram link. Auto-delete would destroy paying customer data:

| UUID | Username | Email | Plan | Expiry |
|---|---|---|---|---|
| `f562df56-…` | CHASINGTHERT | ratty_button.7v@icloud.com | lifetime-pass | 2026-04-04 |
| `5c26584e-…` | DUKEOFDENSITY | jefferywtaylor@gmail.com | lifetime100 | 2026-05-16 |
| `9acb2d2b-…` | PNPTELEVISION | — | lifetime-pass | — |
| `bd63486e-…` | adidas76 | jw.jeremy@gmail.com | lifetime100 | 2026-05-26 |
| `6c699cbb-…` | criistianaaron | criistianaaron@gmail.com | lifetime100 | 2026-06-03 |
| `c3d0d5d8-…` | park2544 | dnice0843@gmail.com | lifetime100 | 2026-06-17 |
| `3ef5d079-…` | tg_7161185920 | sneaksluverau@outlook.com | lifetime100 | 2026-06-16 |
| `fe20b76b-…` | FRANKBOXREAL_X | dasilvafrankbox@gmail.com | lifetime-pass | — |

**Action:** Outreach email with deep link to Telegram bot + admin UI entry for manual linking.

---

## Safety summary

- `user_merge_log` audit table already exists (migration 127)
- `users.is_deleted`, `merge_winner_id`, `merge_notes` columns already exist
- Partial index `idx_users_not_deleted` already exists
- Protected fields trigger (`protect_users_lifetime_fields`) present → migration uses `SET LOCAL pnptv.superadmin_bypass = 'true'`
- Lifetime entitlements trigger present → same bypass required
- Backup: `pg_dump` before execution
- All changes in a single transaction, ROLLBACK on any error
