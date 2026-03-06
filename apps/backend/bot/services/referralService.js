'use strict';

const { query, pool } = require('../config/postgres');
const crypto = require('crypto');

function generateCode(userId) {
  return crypto.createHash('md5').update(userId + 'pnptv2026ref').digest('hex').slice(0, 8).toUpperCase();
}

async function getOrCreateRefCode(userId) {
  const { rows } = await query('SELECT ref_code FROM users WHERE id=$1', [userId]);
  if (rows[0]?.ref_code) return rows[0].ref_code;
  const code = generateCode(userId);
  await query('UPDATE users SET ref_code=$1 WHERE id=$2', [code, userId]);
  return code;
}

async function getReferralStats(userId) {
  const code = await getOrCreateRefCode(userId);
  const { rows } = await query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status='completed') AS completed
     FROM referrals WHERE referrer_id=$1`,
    [userId]
  );
  return {
    code,
    total:     parseInt(rows[0].total,     10),
    completed: parseInt(rows[0].completed, 10),
  };
}

async function redeemReferral(code, refereeId) {
  const { rows: refRows } = await query(
    'SELECT id FROM users WHERE ref_code=$1',
    [code.toUpperCase()]
  );
  if (!refRows.length) throw new Error('Invalid referral code');
  const referrerId = refRows[0].id;
  if (referrerId === refereeId) throw new Error('Cannot use your own referral code');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: inserted } = await client.query(
      `INSERT INTO referrals (code, referrer_id, referee_id, status, completed_at)
       VALUES ($1, $2, $3, 'completed', NOW())
       ON CONFLICT (code, referee_id) DO NOTHING
       RETURNING id`,
      [code.toUpperCase(), referrerId, refereeId]
    );

    if (!inserted.length) {
      await client.query('ROLLBACK');
      return { alreadyRedeemed: true };
    }

    const expiryReferee = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    // Give referee 3 days PRIME (only if not already paying)
    await client.query(
      `UPDATE users
       SET tier='PRIME', plan_id='prime_referral_3d', plan_expiry=$1, subscription_type='referral'
       WHERE id=$2 AND tier IN ('free','member')`,
      [expiryReferee.toISOString(), refereeId]
    );

    // Give referrer +3 days PRIME
    await client.query(
      `UPDATE users
       SET tier='PRIME',
           plan_id=COALESCE(NULLIF(plan_id,''), 'prime_referral_3d'),
           plan_expiry=GREATEST(COALESCE(plan_expiry, NOW()), NOW()) + INTERVAL '3 days'
       WHERE id=$1`,
      [referrerId]
    );

    await client.query('COMMIT');
    return { success: true, referrerId, rewardDays: 3 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getOrCreateRefCode, getReferralStats, redeemReferral };
