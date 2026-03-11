'use strict';

const crypto = require('crypto');
const { query, getClient } = require('../../../config/postgres');
const { getPool } = require('../../../config/postgres');
const EntitlementModel = require('../../../models/entitlementModel');
const logger = require('../../../utils/logger');

const APP_URL = process.env.APP_PUBLIC_URL || 'https://app.pnptv.app';

/**
 * Resolve DB user row by internal UUID id.
 * Returns { pnptv_id, role, creator_status } or null.
 */
async function resolveUser(userId) {
  const { rows } = await query(
    'SELECT pnptv_id, role, creator_status FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

/**
 * Returns true if the session role is admin/superadmin.
 */
function sessionIsAdmin(sessionUser) {
  const role = sessionUser?.role || '';
  return role === 'admin' || role === 'superadmin';
}

/**
 * Returns true if the session role is model or above (model, admin, superadmin).
 */
function sessionIsModelOrAbove(sessionUser) {
  const role = sessionUser?.role || '';
  return role === 'model' || role === 'admin' || role === 'superadmin';
}

/**
 * POST /api/courtesy-invites
 * Create a new invite link. Requires admin or model role.
 */
async function createInvite(req, res) {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!sessionIsModelOrAbove(sessionUser)) {
    return res.status(403).json({ success: false, error: 'Only admins and models can create invite links' });
  }

  const dbUser = await resolveUser(sessionUser.id);
  if (!dbUser || !dbUser.pnptv_id) {
    return res.status(404).json({ success: false, error: 'User account not found' });
  }

  const {
    label,
    max_uses: rawMaxUses,
    grant_days: rawGrantDays,
    expires_at: rawExpiresAt,
  } = req.body;

  // Sanitize and clamp inputs
  const maxUses = rawMaxUses === 0 || rawMaxUses === '0' ? 0 : Math.max(1, parseInt(rawMaxUses, 10) || 1);
  const grantDays = Math.min(365, Math.max(1, parseInt(rawGrantDays, 10) || 30));
  const labelSafe = typeof label === 'string' ? label.trim().slice(0, 200) || null : null;
  let expiresAt = null;
  if (rawExpiresAt) {
    const parsed = new Date(rawExpiresAt);
    if (!isNaN(parsed.getTime()) && parsed > new Date()) {
      expiresAt = parsed.toISOString();
    }
  }

  const code = crypto.randomBytes(12).toString('hex'); // 24-char hex

  const { rows } = await query(
    `INSERT INTO courtesy_invites
       (code, created_by, label, max_uses, grant_days, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [code, dbUser.pnptv_id, labelSafe, maxUses, grantDays, expiresAt]
  );

  const invite = rows[0];
  const inviteUrl = `${APP_URL}/?courtesy=${code}`;

  logger.info('Courtesy invite created', { code, createdBy: dbUser.pnptv_id, grantDays, maxUses });

  return res.status(201).json({
    success: true,
    invite: {
      ...invite,
      invite_url: inviteUrl,
    },
  });
}

/**
 * GET /api/courtesy-invites
 * List invites. Admins see all; models see their own only.
 */
async function listInvites(req, res) {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!sessionIsModelOrAbove(sessionUser)) {
    return res.status(403).json({ success: false, error: 'Only admins and models can view invite links' });
  }

  const dbUser = await resolveUser(sessionUser.id);
  if (!dbUser || !dbUser.pnptv_id) {
    return res.status(404).json({ success: false, error: 'User account not found' });
  }

  let rows;
  if (sessionIsAdmin(sessionUser)) {
    // Admins see all, with creator name
    const result = await query(
      `SELECT ci.*,
              u.username  AS creator_username,
              u.first_name AS creator_first_name,
              (
                SELECT COUNT(*) FROM courtesy_invite_redemptions cir
                WHERE cir.invite_id = ci.id
              )::int AS redemption_count
       FROM courtesy_invites ci
       LEFT JOIN users u ON u.pnptv_id = ci.created_by
       ORDER BY ci.created_at DESC`
    );
    rows = result.rows;
  } else {
    // Models see only their own
    const result = await query(
      `SELECT ci.*,
              (
                SELECT COUNT(*) FROM courtesy_invite_redemptions cir
                WHERE cir.invite_id = ci.id
              )::int AS redemption_count
       FROM courtesy_invites ci
       WHERE ci.created_by = $1
       ORDER BY ci.created_at DESC`,
      [dbUser.pnptv_id]
    );
    rows = result.rows;
  }

  const invites = rows.map((r) => ({
    ...r,
    invite_url: `${APP_URL}/?courtesy=${r.code}`,
  }));

  return res.json({ success: true, invites });
}

/**
 * DELETE /api/courtesy-invites/:id
 * Deactivate an invite. Creator or admin only.
 */
async function deactivateInvite(req, res) {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!sessionIsModelOrAbove(sessionUser)) {
    return res.status(403).json({ success: false, error: 'Only admins and models can manage invite links' });
  }

  const inviteId = parseInt(req.params.id, 10);
  if (isNaN(inviteId)) {
    return res.status(400).json({ success: false, error: 'Invalid invite ID' });
  }

  const { rows } = await query('SELECT * FROM courtesy_invites WHERE id = $1 LIMIT 1', [inviteId]);
  if (!rows.length) {
    return res.status(404).json({ success: false, error: 'Invite not found' });
  }

  const invite = rows[0];

  // Only the creator or an admin may deactivate
  if (!sessionIsAdmin(sessionUser)) {
    const dbUser = await resolveUser(sessionUser.id);
    if (!dbUser || invite.created_by !== dbUser.pnptv_id) {
      return res.status(403).json({ success: false, error: 'You can only deactivate your own invite links' });
    }
  }

  await query('UPDATE courtesy_invites SET is_active = false WHERE id = $1', [inviteId]);

  logger.info('Courtesy invite deactivated', { inviteId, by: sessionUser.id });

  return res.json({ success: true });
}

/**
 * POST /api/courtesy-invites/:code/redeem
 * Redeem an invite — grants PRIME to the authenticated user.
 */
async function redeemInvite(req, res) {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { code } = req.params;
  if (!code || typeof code !== 'string' || code.length !== 24 || !/^[0-9a-f]+$/.test(code)) {
    return res.status(400).json({ success: false, error: 'Invalid invite code format' });
  }

  const dbUser = await resolveUser(sessionUser.id);
  if (!dbUser || !dbUser.pnptv_id) {
    return res.status(404).json({ success: false, error: 'User account not found' });
  }

  const reedemerPnptvId = dbUser.pnptv_id;

  // Load invite
  const inviteResult = await query(
    'SELECT * FROM courtesy_invites WHERE code = $1 LIMIT 1',
    [code]
  );
  if (!inviteResult.rows.length) {
    return res.status(404).json({ success: false, error: 'Invite link not found or has been removed' });
  }

  const invite = inviteResult.rows[0];

  if (!invite.is_active) {
    return res.status(410).json({ success: false, error: 'This invite link is no longer active' });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ success: false, error: 'This invite link has expired' });
  }

  if (invite.max_uses > 0 && invite.uses_count >= invite.max_uses) {
    return res.status(410).json({ success: false, error: 'This invite link has reached its maximum number of uses' });
  }

  if (invite.created_by === reedemerPnptvId) {
    return res.status(400).json({ success: false, error: 'You cannot redeem your own invite link' });
  }

  // Check if user already redeemed this invite
  const alreadyResult = await query(
    'SELECT 1 FROM courtesy_invite_redemptions WHERE invite_id = $1 AND redeemed_by = $2 LIMIT 1',
    [invite.id, reedemerPnptvId]
  );
  if (alreadyResult.rows.length) {
    return res.status(409).json({ success: false, error: 'You have already redeemed this invite link' });
  }

  const grantDays = invite.grant_days;
  const newExpiry = new Date(Date.now() + grantDays * 24 * 60 * 60 * 1000);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Insert redemption record — unique constraint prevents double-redeem under race
    const redemptionInsert = await client.query(
      `INSERT INTO courtesy_invite_redemptions (invite_id, redeemed_by)
       VALUES ($1, $2)
       ON CONFLICT (redeemed_by, invite_id) DO NOTHING
       RETURNING id`,
      [invite.id, reedemerPnptvId]
    );

    if (!redemptionInsert.rows.length) {
      // Lost the race — already redeemed
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'You have already redeemed this invite link' });
    }

    // Increment uses_count
    await client.query(
      'UPDATE courtesy_invites SET uses_count = uses_count + 1 WHERE id = $1',
      [invite.id]
    );

    // If max_uses reached after this increment, deactivate
    if (invite.max_uses > 0 && invite.uses_count + 1 >= invite.max_uses) {
      await client.query(
        'UPDATE courtesy_invites SET is_active = false WHERE id = $1',
        [invite.id]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Grant entitlements outside the transaction (EntitlementModel has its own
  // client for upsert logic; running inside the invite transaction would cause
  // nested client contention).
  const actorIdStr = String(sessionUser.id);

  try {
    await EntitlementModel.grantEntitlement(sessionUser.id, 'prime', {
      isLifetime: false,
      durationDays: grantDays,
      sourcePlanId: 'courtesy_invite_30d',
      source: 'system',
      actorId: actorIdStr,
      reason: `Courtesy invite redemption (code: ${code})`,
    });
  } catch (err) {
    logger.warn('courtesyInvite: prime entitlement grant failed (non-fatal)', { userId: sessionUser.id, err: err.message });
  }

  try {
    await EntitlementModel.grantEntitlement(sessionUser.id, 'pnp-member', {
      isLifetime: false,
      durationDays: grantDays,
      sourcePlanId: 'courtesy_invite_30d',
      source: 'system',
      actorId: actorIdStr,
      reason: `Courtesy invite redemption (code: ${code})`,
    });
  } catch (err) {
    logger.warn('courtesyInvite: pnp-member entitlement grant failed (non-fatal)', { userId: sessionUser.id, err: err.message });
  }

  // Update legacy tier fields — only upgrade; never downgrade an existing PRIME subscription.
  try {
    await query(
      `UPDATE users
       SET tier = 'PRIME',
           plan_id = 'courtesy_invite_30d',
           plan_expiry = $1,
           subscription_status = 'active'
       WHERE id = $2
         AND (plan_expiry IS NULL OR plan_expiry < $1)`,
      [newExpiry.toISOString(), sessionUser.id]
    );
  } catch (err) {
    logger.warn('courtesyInvite: legacy tier update failed (non-fatal)', { userId: sessionUser.id, err: err.message });
  }

  logger.info('Courtesy invite redeemed', {
    code,
    redeemedBy: reedemerPnptvId,
    grantDays,
    expiresAt: newExpiry.toISOString(),
  });

  return res.json({
    success: true,
    grant_days: grantDays,
    expires_at: newExpiry.toISOString(),
    message: `You now have ${grantDays} days of PRIME access. Enjoy!`,
  });
}

/**
 * GET /api/courtesy-invites/check/:code
 * PUBLIC — no auth required.
 * Returns invite metadata for the banner preview before login.
 */
async function checkInvite(req, res) {
  const { code } = req.params;
  if (!code || typeof code !== 'string' || code.length !== 24 || !/^[0-9a-f]+$/.test(code)) {
    return res.status(400).json({ valid: false, error: 'Invalid invite code format' });
  }

  const { rows } = await query(
    `SELECT ci.grant_days, ci.label, ci.is_active, ci.expires_at,
            ci.max_uses, ci.uses_count,
            u.first_name AS creator_first_name, u.username AS creator_username
     FROM courtesy_invites ci
     LEFT JOIN users u ON u.pnptv_id = ci.created_by
     WHERE ci.code = $1
     LIMIT 1`,
    [code]
  );

  if (!rows.length) {
    return res.status(404).json({ valid: false, error: 'Invite not found' });
  }

  const invite = rows[0];

  if (!invite.is_active) {
    return res.json({ valid: false, error: 'This invite link is no longer active' });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.json({ valid: false, error: 'This invite link has expired' });
  }

  if (invite.max_uses > 0 && invite.uses_count >= invite.max_uses) {
    return res.json({ valid: false, error: 'This invite link has reached its maximum uses' });
  }

  const creatorName =
    invite.creator_first_name ||
    (invite.creator_username ? `@${invite.creator_username}` : 'PNPtv');

  return res.json({
    valid: true,
    grant_days: invite.grant_days,
    label: invite.label || null,
    creator_name: creatorName,
    uses_remaining: invite.max_uses === 0 ? null : invite.max_uses - invite.uses_count,
  });
}

module.exports = {
  createInvite,
  listInvites,
  deactivateInvite,
  redeemInvite,
  checkInvite,
};
