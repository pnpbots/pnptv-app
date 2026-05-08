/**
 * Identity Verification Service — 18 U.S.C. § 2257 compliance
 *
 * Manages the creator_2257_records table and the identity_verified / grace-period
 * columns on users. Used as a hard gate before enrollment submission, content
 * uploads, and live-stream provisioning.
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

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

    const { rows } = await query(
      `INSERT INTO creator_2257_records
         (user_id, legal_name, date_of_birth, id_type, id_document_path,
          verification_status, submitted_at, ip_address)
       VALUES ($1, $2, $3::date, $4, $5, 'pending', NOW(), $6::inet)
       ON CONFLICT (user_id) DO UPDATE SET
         legal_name          = EXCLUDED.legal_name,
         date_of_birth       = EXCLUDED.date_of_birth,
         id_type             = EXCLUDED.id_type,
         id_document_path    = EXCLUDED.id_document_path,
         verification_status = 'pending',
         submitted_at        = NOW(),
         verified_at         = NULL,
         verified_by         = NULL,
         admin_notes         = NULL,
         ip_address          = EXCLUDED.ip_address
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

    const { rows } = await query(
      `UPDATE creator_2257_records
         SET verification_status = 'rejected',
             verified_at         = NOW(),
             verified_by         = $2,
             admin_notes         = $3
       WHERE user_id = $1
       RETURNING *`,
      [userId, adminId, notes.trim()]
    );
    if (!rows.length) {
      throw new Error('No 2257 record found for this user');
    }

    logger.info(`2257: record rejected for user ${userId} by admin ${adminId}, reason: ${notes.trim()}`);
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
    return rows;
  }
}

module.exports = IdentityVerificationService;
