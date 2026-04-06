'use strict';
/**
 * callPackageService.js
 * Manages creator call packages, SKU generation, and call credit grants.
 */
const { query, getPool } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Generate a deterministic SKU for a call package.
 * Format: CALL-{creatorId}-{duration}M-Q{quantity}
 * creatorId is truncated/slugified to first 8 alphanum chars for readability.
 */
function generateSKU(creatorId, durationMinutes, quantity) {
  const slug = String(creatorId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return `CALL-${slug}-${durationMinutes}M-Q${quantity}`;
}

/** Create a call package for a creator. Handles duplicate SKU by appending a counter. */
async function createPackage(creatorId, { durationMinutes, quantity, priceUsd, title }) {
  let sku = generateSKU(creatorId, durationMinutes, quantity);

  // Ensure SKU uniqueness if creator already has a package with same params
  const existing = await query(
    'SELECT sku FROM call_packages WHERE creator_id = $1 AND sku = $2',
    [creatorId, sku]
  );
  if (existing.rows.length > 0) {
    sku = `${sku}-${Date.now().toString(36).toUpperCase()}`;
  }

  // MED-02: Handle 23505 unique violation by retrying with timestamp suffix
  try {
    const result = await query(
      `INSERT INTO call_packages (creator_id, duration_minutes, quantity, price_usd, sku, title)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [creatorId, durationMinutes, quantity, priceUsd, sku, title || null]
    );
    logger.info('call_package created', { id: result.rows[0].id, sku });
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      // Unique violation — retry with timestamp suffix
      sku = `${sku}-${Date.now().toString(36).toUpperCase()}`;
      const result = await query(
        `INSERT INTO call_packages (creator_id, duration_minutes, quantity, price_usd, sku, title)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [creatorId, durationMinutes, quantity, priceUsd, sku, title || null]
      );
      logger.info('call_package created (retry after 23505)', { id: result.rows[0].id, sku });
      return result.rows[0];
    }
    throw err;
  }
}

/** List active packages for a creator. */
async function getPackages(creatorId) {
  const result = await query(
    `SELECT * FROM call_packages WHERE creator_id = $1 AND is_active = true ORDER BY duration_minutes, quantity`,
    [creatorId]
  );
  return result.rows;
}

/** Deactivate a package. */
async function deactivatePackage(packageId, creatorId) {
  const result = await query(
    `UPDATE call_packages SET is_active = false WHERE id = $1 AND creator_id = $2`,
    [packageId, creatorId]
  );
  return result.rowCount > 0;
}

/**
 * Grant call credits to a member after purchase.
 * Called by payment webhook after successful payment.
 */
async function grantCallCredits(memberId, packageId, paymentId = null) {
  const pkgResult = await query('SELECT * FROM call_packages WHERE id = $1', [packageId]);
  if (!pkgResult.rows[0]) throw new Error(`Package ${packageId} not found`);
  const { creator_id, quantity } = pkgResult.rows[0];

  const result = await query(
    `INSERT INTO call_credits
       (member_id, creator_id, package_id, quantity_total, payment_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [memberId, creator_id, packageId, quantity, paymentId]
  );
  logger.info('call_credits granted', { memberId, packageId, quantity });
  return result.rows[0];
}

/** Get a member's available (unused/partial) credits for a specific creator. */
async function getMemberCredits(memberId, creatorId = null) {
  if (creatorId) {
    const result = await query(
      `SELECT cc.*, cp.duration_minutes, cp.title AS package_title
       FROM call_credits cc
       JOIN call_packages cp ON cp.id = cc.package_id
       WHERE cc.member_id = $1 AND cc.creator_id = $2
         AND cc.status IN ('unused','partial')
         AND (cc.expires_at IS NULL OR cc.expires_at > NOW())
       ORDER BY cc.created_at`,
      [memberId, creatorId]
    );
    return result.rows;
  }

  const result = await query(
    `SELECT cc.*, cp.duration_minutes, cp.title AS package_title,
            u.username AS creator_username, u.photo_url AS creator_photo
     FROM call_credits cc
     JOIN call_packages cp ON cp.id = cc.package_id
     JOIN users u ON u.id = cc.creator_id
     WHERE cc.member_id = $1
       AND cc.status IN ('unused','partial')
       AND (cc.expires_at IS NULL OR cc.expires_at > NOW())
     ORDER BY cc.created_at`,
    [memberId]
  );
  return result.rows;
}

/**
 * Consume one call credit (called when a booking is confirmed).
 * Returns the updated credit row.
 */
async function consumeCredit(creditId, client = null) {
  const execute = client
    ? (sql, params) => client.query(sql, params)
    : (sql, params) => query(sql, params);

  const result = await execute(
    `UPDATE call_credits
     SET quantity_used = quantity_used + 1,
         quantity_scheduled = GREATEST(0, quantity_scheduled - 1),
         status = CASE
           WHEN quantity_used + 1 >= quantity_total THEN 'completed'
           ELSE 'partial'
         END
     WHERE id = $1
       AND quantity_used + quantity_scheduled < quantity_total
     RETURNING *`,
    [creditId]
  );
  if (!result.rows[0]) throw new Error(`Credit ${creditId} not available or already consumed`);
  return result.rows[0];
}

/**
 * Reserve a credit slot (quantity_scheduled++) when a booking is initiated.
 */
async function reserveCredit(creditId, client = null) {
  const execute = client
    ? (sql, params) => client.query(sql, params)
    : (sql, params) => query(sql, params);

  const result = await execute(
    `UPDATE call_credits
     SET quantity_scheduled = quantity_scheduled + 1
     WHERE id = $1
       AND quantity_used + quantity_scheduled < quantity_total
     RETURNING *`,
    [creditId]
  );
  if (!result.rows[0]) throw new Error(`Credit ${creditId} not available`);
  return result.rows[0];
}

module.exports = {
  generateSKU,
  createPackage,
  getPackages,
  deactivatePackage,
  grantCallCredits,
  getMemberCredits,
  consumeCredit,
  reserveCredit,
};
