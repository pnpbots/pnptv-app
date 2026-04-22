'use strict';

/**
 * accountMergeService.js
 *
 * Handles deduplication of user accounts: preview, merge, rename-to-telegram-id,
 * candidate discovery, and merge-log retrieval.
 *
 * Every write operation:
 *  - runs inside BEGIN/COMMIT on a dedicated pool client
 *  - sets SET LOCAL pnptv.superadmin_bypass = 'true' so lifetime-protection
 *    triggers do not block the operation
 *  - invalidates Redis caches for both affected users afterwards
 */

const { getPool } = require('../config/postgres');
const { cache } = require('../config/redis');
const EntitlementAccessService = require('./entitlementAccessService');
const logger = require('../utils/logger');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true when `id` looks like a numeric Telegram id (all digits, no
 * hyphens, not a UUID).
 */
function isNumericId(id) {
  return typeof id === 'string' && /^\d+$/.test(id);
}

/**
 * Return true when `id` looks like a UUID (8-4-4-4-12 hex groups).
 */
function isUuidId(id) {
  return typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Build a lightweight snapshot of a user row for preview / candidate display.
 */
function buildSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username || null,
    firstName: row.first_name || null,
    email: row.email || null,
    tier: row.tier || 'free',
    planId: row.plan_id || null,
    planExpiry: row.plan_expiry || null,
    createdAt: row.created_at || null,
    lastActive: row.last_active || null,
    telegram: row.telegram || null,
    xUserId: row.x_user_id || null,
    pnptvId: row.pnptv_id || null,
    role: row.role || 'user',
    isDeleted: row.is_deleted || false,
  };
}

/**
 * Plan tier strength order for deciding which plan to keep.
 * Higher index = stronger plan.
 */
const TIER_RANK = { free: 0, member: 1, PRIME: 2 };

function tierRank(tier) {
  return TIER_RANK[tier] ?? 0;
}

/**
 * Invalidate all Redis caches for a user after a merge/rename.
 */
async function invalidateUserCaches(userId) {
  if (!userId) return;
  try {
    await EntitlementAccessService.invalidateCache(userId);
    // Also clear plans cache (affects plan-listing queries that may reference this user)
    await cache.delPattern('pnpapp:plans:*');
    logger.debug('accountMergeService: cache invalidated', { userId });
  } catch (err) {
    // Non-fatal — caches will expire naturally
    logger.warn('accountMergeService: cache invalidation warning', { userId, error: err.message });
  }
}

/**
 * Wrap a pg constraint violation (code 23505) in a user-friendly error.
 */
function wrapConstraintError(err, context) {
  if (err.code === '23505') {
    const detail = err.detail || err.message || 'unique constraint violation';
    logger.error('accountMergeService: unique constraint violation', { context, detail });
    throw new Error(`MERGE_COLLISION: ${detail}`);
  }
  throw err;
}

// ─── Per-table row counts for preview ────────────────────────────────────────

// Tables that have direct FK to users(id). We count rows for the source user
// to give the admin a picture of what will be transferred.
const FK_TABLES = [
  { table: 'payments',               col: 'user_id' },
  { table: 'payment_history',        col: 'user_id' },
  { table: 'user_entitlements',      col: 'user_id' },
  { table: 'token_purchases',        col: 'user_id' },
  { table: 'social_posts',           col: 'user_id' },
  { table: 'community_posts',        col: 'admin_id' },
  { table: 'post_reactions',         col: 'user_id' },
  { table: 'social_post_likes',      col: 'user_id' },
  { table: 'user_follows',           col: 'follower_id' },
  { table: 'direct_messages',        col: 'sender_id' },
  { table: 'chat_messages',          col: 'user_id' },
  { table: 'hangout_group_members',  col: 'user_id' },
  { table: 'notifications',          col: 'target_user_id' },
  { table: 'gamification',           col: 'user_id' },
  { table: 'push_subscriptions',     col: 'user_id' },
  { table: 'creator_earnings',       col: 'creator_id' },
  { table: 'creator_payouts',        col: 'creator_id' },
  { table: 'creator_subscriptions',  col: 'subscriber_id' },
  { table: 'bookings',               col: 'user_id' },
  { table: 'calls',                  col: 'caller_id' },
  { table: 'user_badges',            col: 'user_id' },
  { table: 'stream_sessions',        col: 'creator_id' },
];

async function countTablesForUser(pool, userId) {
  const result = {};
  // Run all counts in parallel for speed
  await Promise.all(
    FK_TABLES.map(async ({ table, col }) => {
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM ${table} WHERE ${col} = $1`,
          [userId]
        );
        const n = rows[0]?.cnt ?? 0;
        if (n > 0) result[table] = n;
      } catch {
        // Table might not exist or column might not match — skip silently
      }
    })
  );
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Preview a merge without writing anything.
 *
 * @param {string} sourceId
 * @param {string} targetId
 * @returns {Promise<{ sourceSnapshot, targetSnapshot, tablesAffected: Object, warnings: string[] }>}
 */
async function previewMerge(sourceId, targetId) {
  if (!sourceId || !targetId) throw new Error('sourceId and targetId are required');
  if (sourceId === targetId) throw new Error('sourceId and targetId must be different');

  const pool = getPool();

  const [srcRes, dstRes] = await Promise.all([
    pool.query('SELECT * FROM users WHERE id = $1', [sourceId]),
    pool.query('SELECT * FROM users WHERE id = $1', [targetId]),
  ]);

  if (srcRes.rows.length === 0) throw new Error(`Source user not found: ${sourceId}`);
  if (dstRes.rows.length === 0) throw new Error(`Target user not found: ${targetId}`);

  const src = srcRes.rows[0];
  const dst = dstRes.rows[0];

  const warnings = [];

  if (src.is_deleted) warnings.push('Source account is already soft-deleted.');
  if (dst.is_deleted) warnings.push('Target account is already soft-deleted.');
  if (src.role === 'superadmin' || dst.role === 'superadmin') {
    warnings.push('One of the accounts has role=superadmin — proceed with caution.');
  }
  if (src.tier === 'banned') warnings.push('Source account is banned.');
  if (dst.tier === 'banned') warnings.push('Target account is banned.');
  if (src.email && dst.email && src.email.toLowerCase() !== dst.email.toLowerCase()) {
    warnings.push(`Email mismatch: source="${src.email}", target="${dst.email}". Target email will be kept.`);
  }

  // Count entitlements & payments separately for the snapshot
  const [srcEntRes, dstEntRes, srcPayRes, dstPayRes] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS cnt FROM user_entitlements WHERE user_id = $1 AND is_consumed = false AND (is_lifetime = true OR expires_at > NOW())', [sourceId]),
    pool.query('SELECT COUNT(*)::int AS cnt FROM user_entitlements WHERE user_id = $1 AND is_consumed = false AND (is_lifetime = true OR expires_at > NOW())', [targetId]),
    pool.query('SELECT COUNT(*)::int AS cnt FROM payments WHERE user_id = $1', [sourceId]),
    pool.query('SELECT COUNT(*)::int AS cnt FROM payments WHERE user_id = $1', [targetId]),
  ]);

  const tablesAffected = await countTablesForUser(pool, sourceId);

  const sourceSnapshot = {
    ...buildSnapshot(src),
    activeEntitlements: srcEntRes.rows[0].cnt,
    paymentCount: srcPayRes.rows[0].cnt,
  };
  const targetSnapshot = {
    ...buildSnapshot(dst),
    activeEntitlements: dstEntRes.rows[0].cnt,
    paymentCount: dstPayRes.rows[0].cnt,
  };

  return { sourceSnapshot, targetSnapshot, tablesAffected, warnings };
}

/**
 * Perform the full merge in a single transaction.
 *
 * @param {string} sourceId
 * @param {string} targetId
 * @param {{ reason: string, dimension: string, performedBy: string }} opts
 * @returns {Promise<{ success: boolean, mergeLogId: number, rowsTransferred: Object }>}
 */
async function mergeUserAccounts(sourceId, targetId, { reason, dimension, performedBy }) {
  if (!sourceId || !targetId) throw new Error('sourceId and targetId are required');
  if (sourceId === targetId) throw new Error('sourceId and targetId must be different');
  if (!performedBy) throw new Error('performedBy is required');

  const pool = getPool();
  const client = await pool.connect();

  let mergeLogId;
  let rowsTransferred = {};

  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL pnptv.superadmin_bypass = 'true'");

    // 1. Validate both users exist, are not already deleted, and are not the same
    const srcRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [sourceId]);
    const dstRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [targetId]);

    if (srcRes.rows.length === 0) throw new Error(`Source user not found: ${sourceId}`);
    if (dstRes.rows.length === 0) throw new Error(`Target user not found: ${targetId}`);

    const src = srcRes.rows[0];
    const dst = dstRes.rows[0];

    if (src.is_deleted) throw new Error(`Source user is already deleted: ${sourceId}`);

    // 2. Absorb attributes from source to target
    const updateFields = {};

    // Telegram: if target has none and source has one, take source's
    if (!dst.telegram && src.telegram) {
      updateFields.telegram = src.telegram;
    }
    // Email: if target has none and source has one
    if (!dst.email && src.email) {
      updateFields.email = src.email;
    }
    // first_name: if target is empty
    if (!dst.first_name && src.first_name) {
      updateFields.first_name = src.first_name;
    }
    // Plan: absorb if source has a stronger tier
    if (tierRank(src.tier) > tierRank(dst.tier)) {
      updateFields.plan_id = src.plan_id;
      updateFields.plan_expiry = src.plan_expiry;
      updateFields.tier = src.tier;
    }
    // ATProto did: if target has none
    if (!dst.atproto_did && src.atproto_did) {
      updateFields.atproto_did = src.atproto_did;
      updateFields.atproto_handle = src.atproto_handle;
      updateFields.atproto_pds_url = src.atproto_pds_url;
    }
    // X identity: if target has none
    if (!dst.x_user_id && src.x_user_id) {
      updateFields.x_user_id = src.x_user_id;
      updateFields.x_username = src.x_username;
    }

    if (Object.keys(updateFields).length > 0) {
      const setClauses = Object.keys(updateFields)
        .map((k, i) => `${k} = $${i + 2}`)
        .join(', ');
      await client.query(
        `UPDATE users SET ${setClauses} WHERE id = $1`,
        [targetId, ...Object.values(updateFields)]
      ).catch((err) => wrapConstraintError(err, 'absorb-attributes'));
    }

    // 3. Transfer all FK relationships via the Postgres function (returns JSONB)
    const transferRes = await client.query(
      'SELECT pnptv_transfer_user_fks($1, $2) AS result',
      [sourceId, targetId]
    ).catch((err) => wrapConstraintError(err, 'transfer-fks'));

    rowsTransferred = transferRes.rows[0]?.result || {};

    // 4. Soft-delete source: null out email to prevent false-positive matches
    const mergeNotesEntry = {
      action: 'merged_into',
      winner: targetId,
      reason: reason || null,
      dimension: dimension || 'manual',
      performedBy,
      at: new Date().toISOString(),
    };

    await client.query(
      `UPDATE users
          SET is_deleted      = true,
              deleted_at      = NOW(),
              merge_winner_id = $2,
              email           = NULL,
              merge_notes     = COALESCE(merge_notes, '[]'::jsonb) || $3::jsonb
        WHERE id = $1`,
      [sourceId, targetId, JSON.stringify([mergeNotesEntry])]
    );

    // 5. Insert merge log
    const logRes = await client.query(
      `INSERT INTO user_merge_log
         (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        sourceId,
        targetId,
        reason || 'admin_manual',
        dimension || 'manual',
        JSON.stringify(rowsTransferred),
        performedBy,
      ]
    );

    mergeLogId = logRes.rows[0].id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('accountMergeService.mergeUserAccounts failed', {
      sourceId, targetId, error: err.message,
    });
    throw err;
  } finally {
    client.release();
  }

  // 6. Invalidate Redis caches (outside transaction — non-fatal)
  await Promise.all([
    invalidateUserCaches(sourceId),
    invalidateUserCaches(targetId),
  ]);

  logger.info('accountMergeService.mergeUserAccounts complete', {
    sourceId, targetId, mergeLogId, rowsTransferred,
  });

  return { success: true, mergeLogId, rowsTransferred };
}

/**
 * Rename a UUID source account to a numeric Telegram id.
 *
 * Steps:
 *  1. Validate telegramId is numeric and not already taken
 *  2. INSERT new users row with id=telegramId copying all columns from source
 *  3. Transfer FKs
 *  4. Soft-delete UUID source
 *  5. Log
 *
 * @param {string} sourceId  — UUID-style id
 * @param {string} telegramId — numeric string
 * @param {{ performedBy: string }} opts
 * @returns {Promise<{ success: boolean, mergeLogId: number }>}
 */
async function renameToTelegramId(sourceId, telegramId, { performedBy }) {
  if (!sourceId || !telegramId) throw new Error('sourceId and telegramId are required');
  if (!isNumericId(telegramId)) throw new Error('telegramId must be a numeric string');
  if (!performedBy) throw new Error('performedBy is required');

  const pool = getPool();
  const client = await pool.connect();
  let mergeLogId;

  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL pnptv.superadmin_bypass = 'true'");

    // 1. Validate source exists and target id is free
    const srcRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [sourceId]);
    if (srcRes.rows.length === 0) throw new Error(`Source user not found: ${sourceId}`);

    const src = srcRes.rows[0];
    if (src.is_deleted) throw new Error(`Source user is already deleted: ${sourceId}`);

    const existingRes = await client.query('SELECT id FROM users WHERE id = $1', [telegramId]);
    if (existingRes.rows.length > 0) {
      throw new Error(`MERGE_COLLISION: A user with id ${telegramId} already exists`);
    }

    // 2a. Generate a fresh pnptv_id for the new row so we don't collide with
    //     the source. We will re-point streamer_settings (FK to pnptv_id)
    //     from source's pnptv_id to the new row's pnptv_id before nulling.
    const newPnptvIdRes = await client.query("SELECT gen_random_uuid()::text AS new_id");
    const newPnptvId = newPnptvIdRes.rows[0].new_id;

    // Null out username/email/telegram/x_id on source (nullable uniques).
    // Do NOT touch pnptv_id yet — other tables (streamer_settings) FK it.
    await client.query(
      `UPDATE users
          SET username = NULL, email = NULL, telegram = NULL, x_id = NULL
        WHERE id = $1`,
      [sourceId]
    );

    // 2b. INSERT new row copying source columns using the snapshot captured above.
    //     Uses NULL for telegram col (redundant since id IS the tg numeric).
    await client.query(
      `INSERT INTO users (
          id, username, first_name, last_name, email, email_verified, bio, photo_file_id,
          plan_id, plan_expiry, tier, subscription_status, role, role_assigned_at,
          last_active, created_at, updated_at, is_active, terms_accepted, age_verified,
          language, privacy,
          pnptv_id,
          password_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16, NOW(), true, $17, $18,
          $19, $20,
          $21,
          $22
        )`,
      [
        telegramId,
        src.username,
        src.first_name,
        src.last_name,
        src.email,
        src.email_verified || false,
        src.bio,
        src.photo_file_id,
        src.plan_id,
        src.plan_expiry,
        src.tier || 'free',
        src.subscription_status || 'free',
        src.role || 'user',
        src.role_assigned_at,
        src.last_active,
        src.created_at,
        src.terms_accepted || false,
        src.age_verified || false,
        src.language || 'en',
        src.privacy || {},
        newPnptvId,
        src.password_hash,
      ]
    ).catch((err) => wrapConstraintError(err, 'rename-insert'));

    // 2c. Re-point any table whose FK references users(pnptv_id) rather than
    //     users(id). streamer_settings is the known one; guard defensively.
    if (src.pnptv_id) {
      await client.query(
        `UPDATE streamer_settings SET user_id = $1 WHERE user_id = $2`,
        [newPnptvId, src.pnptv_id]
      ).catch((err) => {
        // If streamer_settings doesn't exist for this user, ignore
        if (err.code !== '42P01') throw err;
      });

      // Now safe to null source's pnptv_id
      await client.query(
        `UPDATE users SET pnptv_id = gen_random_uuid()::text WHERE id = $1`,
        [sourceId]
      );
    }

    // 3. Transfer all FK relationships (users.id-based FKs)
    const transferRes = await client.query(
      'SELECT pnptv_transfer_user_fks($1, $2) AS result',
      [sourceId, telegramId]
    ).catch((err) => wrapConstraintError(err, 'rename-transfer-fks'));
    const rowsTransferred = transferRes.rows[0]?.result || {};

    // 4. Soft-delete UUID source
    const mergeNotesEntry = {
      action: 'renamed_to_tg_id',
      winner: telegramId,
      dimension: 'rename_tg',
      performedBy,
      at: new Date().toISOString(),
    };

    await client.query(
      `UPDATE users
          SET is_deleted      = true,
              deleted_at      = NOW(),
              merge_winner_id = $2,
              email           = NULL,
              merge_notes     = COALESCE(merge_notes, '[]'::jsonb) || $3::jsonb
        WHERE id = $1`,
      [sourceId, telegramId, JSON.stringify([mergeNotesEntry])]
    );

    // 5. Insert merge log
    const logRes = await client.query(
      `INSERT INTO user_merge_log
         (loser_id, winner_id, merge_reason, dimension, rows_transferred, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        sourceId,
        telegramId,
        'rename_uuid_to_telegram_id',
        'rename_tg',
        JSON.stringify(rowsTransferred),
        performedBy,
      ]
    );

    mergeLogId = logRes.rows[0].id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('accountMergeService.renameToTelegramId failed', {
      sourceId, telegramId, error: err.message,
    });
    throw err;
  } finally {
    client.release();
  }

  await Promise.all([
    invalidateUserCaches(sourceId),
    invalidateUserCaches(telegramId),
  ]);

  logger.info('accountMergeService.renameToTelegramId complete', {
    sourceId, telegramId, mergeLogId,
  });

  return { success: true, mergeLogId };
}

/**
 * Find duplicate candidate pairs.
 *
 * Dimensions checked:
 *  - email: same lowercased email across numeric-id and UUID-id rows
 *  - telegram: UUID row whose `telegram` column equals an existing numeric-id row
 *  - x_id: same non-null x_id across id types
 *  - pnptv_id: shared pnptv_id across id types (should not happen but can)
 *
 * @param {{ limit?: number }} opts
 * @returns {Promise<Array>}
 */
async function findCandidates({ limit = 50 } = {}) {
  const pool = getPool();

  // System accounts to exclude
  const SYSTEM_EXCLUSIONS = ['SYSTEM', 'akadmin'];
  const systemPattern = 'meru-%';

  const sql = `
    WITH base AS (
      SELECT
        id,
        username,
        first_name,
        email,
        tier,
        plan_id,
        plan_expiry,
        created_at,
        last_active,
        telegram,
        x_id,
        x_user_id,
        pnptv_id,
        role,
        is_deleted
      FROM users
      WHERE is_deleted = false
        AND id NOT IN (${SYSTEM_EXCLUSIONS.map((_, i) => `$${i + 2}`).join(', ')})
        AND id NOT LIKE $1
    ),
    uuid_rows AS (
      SELECT * FROM base
      WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    numeric_rows AS (
      SELECT * FROM base
      WHERE id ~ '^[0-9]+$'
    ),

    -- Dimension A: same email
    by_email AS (
      SELECT
        u.id   AS source_id,
        n.id   AS target_id,
        'email'::text AS dimension,
        0.95   AS confidence
      FROM uuid_rows u
      JOIN numeric_rows n ON LOWER(u.email) = LOWER(n.email)
        AND u.email IS NOT NULL AND n.email IS NOT NULL
    ),

    -- Dimension B: UUID row's telegram column points to a numeric-id row
    by_telegram AS (
      SELECT
        u.id   AS source_id,
        n.id   AS target_id,
        'telegram'::text AS dimension,
        0.98   AS confidence
      FROM uuid_rows u
      JOIN numeric_rows n ON u.telegram = n.id
        AND u.telegram IS NOT NULL
    ),

    -- Dimension C: same non-null x_id
    by_x_id AS (
      SELECT
        u.id   AS source_id,
        n.id   AS target_id,
        'x_id'::text AS dimension,
        0.90   AS confidence
      FROM uuid_rows u
      JOIN numeric_rows n ON u.x_id = n.x_id
        AND u.x_id IS NOT NULL AND n.x_id IS NOT NULL
    ),

    -- Dimension D: same pnptv_id (should be unique, but check anyway)
    by_pnptv_id AS (
      SELECT
        u.id   AS source_id,
        n.id   AS target_id,
        'pnptv_id'::text AS dimension,
        0.70   AS confidence
      FROM uuid_rows u
      JOIN numeric_rows n ON u.pnptv_id = n.pnptv_id
        AND u.pnptv_id IS NOT NULL AND n.pnptv_id IS NOT NULL
    ),

    combined AS (
      SELECT * FROM by_email
      UNION ALL
      SELECT * FROM by_telegram
      UNION ALL
      SELECT * FROM by_x_id
      UNION ALL
      SELECT * FROM by_pnptv_id
    ),

    -- Deduplicate: keep highest-confidence dimension per (source, target) pair
    deduped AS (
      SELECT DISTINCT ON (source_id, target_id)
        source_id, target_id, dimension, confidence
      FROM combined
      ORDER BY source_id, target_id, confidence DESC
    )

    SELECT
      d.source_id, d.target_id, d.dimension, d.confidence,
      s.username  AS src_username,
      s.first_name AS src_first_name,
      s.email     AS src_email,
      s.tier      AS src_tier,
      s.plan_id   AS src_plan_id,
      s.plan_expiry AS src_plan_expiry,
      s.created_at AS src_created_at,
      s.last_active AS src_last_active,
      s.telegram  AS src_telegram,
      s.pnptv_id  AS src_pnptv_id,
      s.is_deleted AS src_is_deleted,
      t.username  AS tgt_username,
      t.first_name AS tgt_first_name,
      t.email     AS tgt_email,
      t.tier      AS tgt_tier,
      t.plan_id   AS tgt_plan_id,
      t.plan_expiry AS tgt_plan_expiry,
      t.created_at AS tgt_created_at,
      t.last_active AS tgt_last_active,
      t.telegram  AS tgt_telegram,
      t.pnptv_id  AS tgt_pnptv_id,
      t.is_deleted AS tgt_is_deleted
    FROM deduped d
    JOIN users s ON s.id = d.source_id
    JOIN users t ON t.id = d.target_id
    ORDER BY d.confidence DESC, d.source_id
    LIMIT $${SYSTEM_EXCLUSIONS.length + 2}
  `;

  const params = [systemPattern, ...SYSTEM_EXCLUSIONS, limit];

  const { rows } = await pool.query(sql, params);

  // Fetch active entitlement counts in parallel for all unique user ids
  const allIds = new Set();
  rows.forEach((r) => { allIds.add(r.source_id); allIds.add(r.target_id); });
  const idList = [...allIds];

  let entCounts = {};
  let payCounts = {};
  if (idList.length > 0) {
    const placeholders = idList.map((_, i) => `$${i + 1}`).join(', ');
    const [entRes, payRes] = await Promise.all([
      pool.query(
        `SELECT user_id, COUNT(*)::int AS cnt
           FROM user_entitlements
          WHERE user_id IN (${placeholders})
            AND is_consumed = false
            AND (is_lifetime = true OR expires_at > NOW())
          GROUP BY user_id`,
        idList
      ),
      pool.query(
        `SELECT user_id, COUNT(*)::int AS cnt
           FROM payments
          WHERE user_id IN (${placeholders})
          GROUP BY user_id`,
        idList
      ),
    ]);
    entRes.rows.forEach((r) => { entCounts[r.user_id] = r.cnt; });
    payRes.rows.forEach((r) => { payCounts[r.user_id] = r.cnt; });
  }

  return rows.map((r) => ({
    sourceId: r.source_id,
    targetId: r.target_id,
    dimension: r.dimension,
    confidence: r.confidence,
    sourceSnapshot: {
      id: r.source_id,
      username: r.src_username,
      firstName: r.src_first_name,
      email: r.src_email,
      tier: r.src_tier,
      planId: r.src_plan_id,
      planExpiry: r.src_plan_expiry,
      createdAt: r.src_created_at,
      lastActive: r.src_last_active,
      telegram: r.src_telegram,
      pnptvId: r.src_pnptv_id,
      activeEntitlements: entCounts[r.source_id] ?? 0,
      paymentCount: payCounts[r.source_id] ?? 0,
    },
    targetSnapshot: {
      id: r.target_id,
      username: r.tgt_username,
      firstName: r.tgt_first_name,
      email: r.tgt_email,
      tier: r.tgt_tier,
      planId: r.tgt_plan_id,
      planExpiry: r.tgt_plan_expiry,
      createdAt: r.tgt_created_at,
      lastActive: r.tgt_last_active,
      telegram: r.tgt_telegram,
      pnptvId: r.tgt_pnptv_id,
      activeEntitlements: entCounts[r.target_id] ?? 0,
      paymentCount: payCounts[r.target_id] ?? 0,
    },
  }));
}

/**
 * Retrieve merge log entries for admin display.
 *
 * @param {{ limit?: number, offset?: number }} opts
 * @returns {Promise<Array>}
 */
async function listMergeLog({ limit = 100, offset = 0 } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       ml.*,
       src.username AS loser_username,
       src.first_name AS loser_first_name,
       dst.username AS winner_username,
       dst.first_name AS winner_first_name,
       pb.username AS performed_by_username
     FROM user_merge_log ml
     LEFT JOIN users src ON src.id = ml.loser_id
     LEFT JOIN users dst ON dst.id = ml.winner_id
     LEFT JOIN users pb  ON pb.id  = ml.performed_by
     ORDER BY ml.merged_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

module.exports = {
  previewMerge,
  mergeUserAccounts,
  renameToTelegramId,
  findCandidates,
  listMergeLog,
};
