/**
 * Identity Verification Service — 18 U.S.C. § 2257 compliance
 *
 * Manages the creator_2257_records table and the identity_verified / grace-period
 * columns on users. Used as a hard gate before enrollment submission, content
 * uploads, and live-stream provisioning.
 *
 * Persona hosted-flow integration: startPersonaInquiry / handlePersonaWebhook
 * provide automated government-ID verification as an alternative to manual upload.
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const axios = require('axios');
const crypto = require('crypto');

class IdentityVerificationService {
  /**
   * Submit (or re-submit on rejection) a 2257 identity record for a user.
   * Uses an upsert on user_id so a re-submission after rejection replaces the
   * previous record and resets status to 'pending'.
   *
   * @param {string} userId
   * @param {{ legalName: string, dateOfBirth: string, idType: string, idDocumentPath: string, ip?: string }} data
   * @returns {Promise<object>} The inserted/updated record row
   */
  static async submit2257Record(userId, { legalName, dateOfBirth, idType, idDocumentPath, ip = null }) {
    if (!userId) throw new Error('userId is required');
    if (!legalName || !legalName.trim()) throw new Error('Legal name is required');
    if (!dateOfBirth) throw new Error('Date of birth is required');

    const VALID_ID_TYPES = new Set(['passport', 'drivers_license', 'national_id', 'state_id', 'other']);
    if (!VALID_ID_TYPES.has(idType)) {
      throw new Error('Invalid id_type. Must be one of: passport, drivers_license, national_id, state_id, other');
    }

    // Validate date of birth — must be a real date and performer must be at least 18
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) throw new Error('Invalid date of birth');
    const now = new Date();
    const age = (now - dob) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 18) {
      throw new Error('Performers must be 18 years of age or older');
    }
    if (age > 130) {
      throw new Error('Invalid date of birth');
    }

    // Check if user is currently banned from resubmitting
    const { rows: banCheck } = await query(
      `SELECT banned_from_applying_until FROM creator_2257_records WHERE user_id = $1`,
      [userId]
    );
    if (banCheck.length && banCheck[0].banned_from_applying_until) {
      const banUntil = new Date(banCheck[0].banned_from_applying_until);
      if (banUntil > new Date()) {
        const formatted = banUntil.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        throw new Error(`You are not allowed to resubmit until ${formatted}. Contact support if you believe this is an error.`);
      }
    }

    const { rows } = await query(
      `INSERT INTO creator_2257_records
         (user_id, legal_name, date_of_birth, id_type, id_document_path,
          verification_status, submitted_at, ip_address)
       VALUES ($1, $2, $3::date, $4, $5, 'pending', NOW(), $6::inet)
       ON CONFLICT (user_id) DO UPDATE SET
         legal_name              = EXCLUDED.legal_name,
         date_of_birth           = EXCLUDED.date_of_birth,
         id_type                 = EXCLUDED.id_type,
         id_document_path        = EXCLUDED.id_document_path,
         verification_status     = 'pending',
         submitted_at            = NOW(),
         verified_at             = NULL,
         verified_by             = NULL,
         admin_notes             = NULL,
         ip_address              = EXCLUDED.ip_address,
         resubmission_count      = CASE
           WHEN creator_2257_records.verification_status = 'rejected'
           THEN creator_2257_records.resubmission_count + 1
           ELSE creator_2257_records.resubmission_count
         END,
         banned_from_applying_until = NULL
       RETURNING *`,
      [userId, legalName.trim(), dateOfBirth, idType, idDocumentPath, ip]
    );
    return rows[0];
  }

  /**
   * Approve a 2257 record. Sets verification_status='approved' on the record
   * and identity_verified=TRUE on the users row.
   *
   * @param {string} userId - The creator being approved
   * @param {string} adminId - The admin performing the approval
   * @param {string|null} notes
   * @returns {Promise<object>} Updated record row
   */
  static async approve2257Record(userId, adminId, notes = null) {
    if (!userId) throw new Error('userId is required');
    if (!adminId) throw new Error('adminId is required');

    const { rows: recordRows } = await query(
      `UPDATE creator_2257_records
         SET verification_status = 'approved',
             verified_at         = NOW(),
             verified_by         = $2,
             admin_notes         = $3
       WHERE user_id = $1
       RETURNING *`,
      [userId, adminId, notes]
    );
    if (!recordRows.length) {
      throw new Error('No 2257 record found for this user');
    }

    await query(
      `UPDATE users
         SET identity_verified    = TRUE,
             identity_verified_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    logger.info(`2257: record approved for user ${userId} by admin ${adminId}`);

    // Notify the creator their ID was approved so they know creator tools are unblocked.
    try {
      const { rows: userRows } = await query(
        'SELECT telegram FROM users WHERE id = $1',
        [userId]
      );
      const telegramId = userRows[0]?.telegram;
      if (telegramId) {
        const bot = require('../bot/core/bot');
        await bot.telegram.sendMessage(
          telegramId,
          '✅ Your 2257 identity verification has been approved. You can now post, upload content, and go live on PNPtv.app.'
        );
      }
    } catch (notifyErr) {
      logger.warn('2257: failed to notify creator of approval (non-fatal)', { userId, error: notifyErr.message });
    }

    return recordRows[0];
  }

  /**
   * Reject a 2257 record. Does NOT set identity_verified on users.
   * Notes (rejection reason) are mandatory.
   *
   * @param {string} userId
   * @param {string} adminId
   * @param {string} notes - Reason for rejection (required)
   * @returns {Promise<object>} Updated record row
   */
  static async reject2257Record(userId, adminId, notes) {
    if (!userId) throw new Error('userId is required');
    if (!adminId) throw new Error('adminId is required');
    if (!notes || !notes.trim()) throw new Error('Rejection reason (notes) is required');

    // If the record was previously approved, determine ban status based on resubmission_count
    const { rows: existing } = await query(
      `SELECT verification_status, resubmission_count FROM creator_2257_records WHERE user_id = $1`,
      [userId]
    );
    if (!existing.length) throw new Error('No 2257 record found for this user');

    const wasApproved = existing[0].verification_status === 'approved';
    // Ban on second rejection: first rejection allows one resubmit; if they've already resubmitted once, ban them
    const banUser = existing[0].resubmission_count >= 1;

    const { rows } = await query(
      `UPDATE creator_2257_records
         SET verification_status        = 'rejected',
             verified_at                = NOW(),
             verified_by                = $2,
             admin_notes                = $3,
             banned_from_applying_until = CASE WHEN $4 THEN NOW() + INTERVAL '6 months' ELSE banned_from_applying_until END
       WHERE user_id = $1
       RETURNING *`,
      [userId, adminId, notes.trim(), banUser]
    );

    // Revoke identity_verified on users table when re-rejecting a previously approved record
    if (wasApproved) {
      await query(
        `UPDATE users SET identity_verified = FALSE, identity_verified_at = NULL WHERE id = $1`,
        [userId]
      );
    }

    logger.info(`2257: record rejected for user ${userId} by admin ${adminId}, wasApproved=${wasApproved}, banned=${banUser}, reason: ${notes.trim()}`);

    try {
      const { rows: userRows } = await query(
        'SELECT telegram FROM users WHERE id = $1',
        [userId]
      );
      const telegramId = userRows[0]?.telegram;
      if (telegramId) {
        const bot = require('../bot/core/bot');
        let msg;
        if (banUser) {
          const banDate = rows[0].banned_from_applying_until
            ? new Date(rows[0].banned_from_applying_until).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            : '6 months from now';
          msg = `🚫 Your 2257 identity verification was rejected again.\n\nReason: ${notes.trim()}\n\nDue to repeated failed submissions, you cannot resubmit until ${banDate}. Contact support if you believe this is an error.`;
        } else {
          msg = `⚠️ Your 2257 identity verification was not approved.\n\nReason: ${notes.trim()}\n\nYou may resubmit once with corrected documents at pnptv.app/creators/apply`;
        }
        await bot.telegram.sendMessage(telegramId, msg);
      }
    } catch (notifyErr) {
      logger.warn('2257: failed to notify creator of rejection (non-fatal)', { userId, error: notifyErr.message });
    }

    return rows[0];
  }

  /**
   * Fetch the 2257 record for a user, or null if none exists.
   *
   * @param {string} userId
   * @returns {Promise<object|null>}
   */
  static async get2257Record(userId) {
    if (!userId) return null;
    const { rows } = await query(
      `SELECT * FROM creator_2257_records WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  }

  /**
   * Determine whether a user is 2257-compliant.
   *
   * A user is compliant if:
   *   (a) identity_verified is TRUE, OR
   *   (b) identity_verification_required_by is set and is in the future
   *       (grace period for existing active creators)
   *
   * Accepts a plain user object — does NOT hit the database. The caller is
   * responsible for loading the necessary columns from users.
   *
   * @param {{ identity_verified: boolean, identity_verification_required_by: Date|string|null }} user
   * @returns {boolean}
   */
  static is2257Compliant(user) {
    if (!user) return false;
    if (user.identity_verified === true) return true;
    if (user.identity_verification_required_by) {
      const deadline = new Date(user.identity_verification_required_by);
      if (!isNaN(deadline.getTime()) && deadline > new Date()) {
        return true; // within grace period
      }
    }
    return false;
  }

  /**
   * List all 2257 records, optionally filtered by status.
   * Joins with users to include username and display_name.
   *
   * @param {string|null} status - 'pending' | 'approved' | 'rejected' | null (all)
   * @returns {Promise<Array>}
   */
  static async list2257Records(status = null) {
    const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);
    const params = [];
    let whereClause = '';
    if (status && VALID_STATUSES.has(status)) {
      whereClause = 'WHERE r.verification_status = $1';
      params.push(status);
    }

    const { rows } = await query(
      `SELECT
         r.id,
         r.user_id,
         r.legal_name,
         r.date_of_birth,
         r.id_type,
         r.id_document_path,
         r.verification_status,
         r.submitted_at,
         r.verified_at,
         r.verified_by,
         r.admin_notes,
         r.ip_address,
         r.resubmission_count,
         r.banned_from_applying_until,
         u.username,
         u.first_name,
         u.last_name,
         u.creator_status
       FROM creator_2257_records r
       JOIN users u ON u.id = r.user_id
       ${whereClause}
       ORDER BY
         CASE r.verification_status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
         r.submitted_at DESC`,
      params
    );
    return rows;
  }

  /**
   * Export all approved 2257 records as a JSON-serializable array.
   * Includes the id_document_path for compliance record inspection.
   * This endpoint must be admin-only and audit-logged at the route level.
   *
   * @returns {Promise<Array>}
   */
  static async export2257Records() {
    const { rows } = await query(
      `SELECT
         r.id,
         r.user_id,
         r.legal_name,
         r.date_of_birth,
         r.id_type,
         r.id_document_path,
         r.verification_status,
         r.submitted_at,
         r.verified_at,
         r.verified_by,
         r.admin_notes,
         r.ip_address,
         u.username,
         u.first_name,
         u.last_name
       FROM creator_2257_records r
       JOIN users u ON u.id = r.user_id
       WHERE r.verification_status = 'approved'
       ORDER BY r.submitted_at DESC`
    );
    // Stamp the export with the records custodian (28 C.F.R. § 75.1(c)).
    // Missing env vars are flagged inline so an operator can see the gap.
    return {
      custodian: {
        name: process.env.CUSTODIAN_NAME || null,
        address: process.env.CUSTODIAN_ADDRESS || null,
        email: process.env.CUSTODIAN_EMAIL || null,
      },
      exported_at: new Date().toISOString(),
      records: rows,
    };
  }
  /**
   * Returns true when both PERSONA_API_KEY and PERSONA_TEMPLATE_ID env vars are set.
   * Used by controllers to decide whether to surface the Persona path in the UI.
   *
   * @returns {boolean}
   */
  static isPersonaConfigured() {
    return !!(process.env.PERSONA_API_KEY && process.env.PERSONA_TEMPLATE_ID);
  }

  /**
   * Create a Persona hosted-flow inquiry for a user and upsert the inquiry ID
   * into creator_2257_records (placeholder row — real data arrives via webhook).
   *
   * @param {string} userId
   * @param {string} redirectUri  - Where Persona redirects after the user completes the flow
   * @returns {Promise<{ inquiryId: string, sessionToken: string, hostedFlowUrl: string }>}
   */
  static async startPersonaInquiry(userId, redirectUri) {
    if (!process.env.PERSONA_API_KEY) {
      throw new Error('Persona not configured');
    }
    if (!userId) throw new Error('userId is required');

    const response = await axios.post(
      'https://withpersona.com/api/v1/inquiries',
      {
        data: {
          attributes: {
            inquiryTemplateId: process.env.PERSONA_TEMPLATE_ID,
            referenceId: `pnptv_${userId}`,
            redirectUri: redirectUri,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
          'Persona-Version': '2023-01-05',
          'Content-Type': 'application/json',
          'Key-Inflection': 'camel',
        },
        timeout: 15000,
      }
    );

    const inquiryId = response.data?.data?.id;
    const sessionToken = response.data?.data?.attributes?.sessionToken;

    if (!inquiryId) {
      throw new Error('Persona API returned no inquiry ID');
    }

    // Upsert a placeholder 2257 record so the inquiry_id is tracked immediately.
    // Real legal_name / date_of_birth will be populated when the webhook fires.
    await query(
      `INSERT INTO creator_2257_records
         (user_id, legal_name, date_of_birth, id_type, id_document_path,
          persona_inquiry_id, persona_status, verification_status, submitted_at)
       VALUES ($1, '', '1900-01-01', 'passport', '', $2, 'pending', 'pending', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         persona_inquiry_id  = EXCLUDED.persona_inquiry_id,
         persona_status      = 'pending',
         verification_status = 'pending',
         submitted_at        = NOW(),
         verified_at         = NULL,
         verified_by         = NULL,
         admin_notes         = NULL`,
      [userId, inquiryId]
    );

    logger.info(`2257: Persona inquiry created for user ${userId}`, { inquiryId });

    return {
      inquiryId,
      sessionToken: sessionToken || null,
      hostedFlowUrl: `https://withpersona.com/verify?inquiry-id=${inquiryId}${sessionToken ? `&session-token=${sessionToken}` : ''}`,
    };
  }

  /**
   * Process an incoming Persona webhook. Verifies the HMAC-SHA256 signature,
   * then handles inquiry.approved / inquiry.declined / inquiry.failed events.
   *
   * @param {string} rawBody      - Raw request body string (before JSON.parse)
   * @param {string} signatureHeader  - Value of the `persona-signature` HTTP header
   * @returns {Promise<{ processed: boolean, event: string }>}
   */
  static async handlePersonaWebhook(rawBody, signatureHeader) {
    if (!process.env.PERSONA_WEBHOOK_SECRET) {
      throw new Error('PERSONA_WEBHOOK_SECRET is not configured');
    }

    // Persona signature format: "t=<timestamp>,v1=<hex-sig>"
    // Signed payload: "<timestamp>.<rawBody>"
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => {
        const idx = p.indexOf('=');
        return [p.slice(0, idx), p.slice(idx + 1)];
      })
    );
    const timestamp = parts.t;
    const expectedSig = parts.v1;

    if (!timestamp || !expectedSig) {
      throw new Error('Invalid Persona-Signature format — missing t or v1');
    }

    const MAX_DRIFT_SECONDS = 300; // 5 minutes
    const tsSeconds = parseInt(timestamp, 10);
    if (isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > MAX_DRIFT_SECONDS) {
      throw new Error('Persona webhook timestamp invalid or too old — possible replay attack');
    }

    const hmac = crypto
      .createHmac('sha256', process.env.PERSONA_WEBHOOK_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedSig, 'hex'))) {
      throw new Error('Invalid Persona webhook signature');
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload?.data?.type;
    const attributes = payload?.data?.attributes || {};
    const referenceId = attributes.referenceId;
    const userId = referenceId?.replace(/^pnptv_/, '') || null;

    if (!userId) {
      logger.warn('Persona webhook: no userId extracted from referenceId', { referenceId, eventType });
      return { processed: true, event: eventType };
    }

    if (eventType === 'inquiry.approved') {
      // Extract name + birthdate from Persona fields if present
      const fields = attributes.fields || {};
      const nameFirst = fields.nameFirst?.value || fields['name-first']?.value || '';
      const nameLast = fields.nameLast?.value || fields['name-last']?.value || '';
      const birthdate = fields.birthdate?.value || fields.dateOfBirth?.value || null;
      const legalName = [nameFirst, nameLast].filter(Boolean).join(' ') || null;

      // Approve the record in our system
      await IdentityVerificationService.approve2257Record(
        userId,
        'persona-system',
        'Auto-approved via Persona identity verification'
      );

      // Update persona_status and backfill legal_name / date_of_birth if available
      await query(
        `UPDATE creator_2257_records
           SET persona_status  = 'approved',
               legal_name      = COALESCE(NULLIF($2, ''), legal_name),
               date_of_birth   = COALESCE($3::date, date_of_birth)
         WHERE user_id = $1`,
        [userId, legalName || '', birthdate || null]
      );

      logger.info(`2257: Persona inquiry approved for user ${userId}`);

    } else if (eventType === 'inquiry.declined') {
      await query(
        `UPDATE creator_2257_records SET persona_status = 'declined' WHERE user_id = $1`,
        [userId]
      );

      await IdentityVerificationService.reject2257Record(
        userId,
        'persona-system',
        'Identity verification declined by Persona automated review'
      );

      logger.info(`2257: Persona inquiry declined for user ${userId}`);

    } else if (eventType === 'inquiry.failed') {
      // Technical failure — do NOT reject. User should retry.
      await query(
        `UPDATE creator_2257_records SET persona_status = 'failed' WHERE user_id = $1`,
        [userId]
      );

      logger.warn(`2257: Persona inquiry failed (technical) for user ${userId}`, { eventType });

    } else {
      // Unhandled event type — no-op
      logger.info(`2257: Persona webhook no-op for event type '${eventType}'`, { userId });
    }

    return { processed: true, event: eventType };
  }
}

module.exports = IdentityVerificationService;
