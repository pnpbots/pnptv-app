/**
 * appealService
 * --------------
 * Public appeal flow for banned/suspended users. Submitter is unauthenticated;
 * we resolve them to a user row at submit time (best-effort) and reinstate on
 * admin approval.
 *
 * Rate limits per IP: 1 per hour, 3 per day.
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_EXPLANATION = 20;
const MAX_EXPLANATION = 2000;

/**
 * Best-effort resolve of a user-typed identifier to an internal user.id.
 * Accepts:
 *   - bare numeric Telegram id: "1234567"
 *   - @username / username
 *   - email (must match email column)
 */
async function resolveIdentifier(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Email
  if (trimmed.includes('@') && trimmed.includes('.') && !trimmed.startsWith('@')) {
    const r = await query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [trimmed]
    );
    if (r.rowCount > 0) return r.rows[0].id;
  }

  // Numeric id
  if (/^\d{5,}$/.test(trimmed)) {
    const r = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [trimmed]);
    if (r.rowCount > 0) return r.rows[0].id;
  }

  // Username (strip leading @)
  const uname = trimmed.replace(/^@+/, '');
  if (uname) {
    const r = await query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [uname]
    );
    if (r.rowCount > 0) return r.rows[0].id;
  }

  return null;
}

class AppealService {
  async submitAppeal({ submittedIdentifier, contactEmail, explanation, ip, userAgent, honeypot }) {
    // Honeypot — silent-accept if a bot filled the hidden field
    if (honeypot && String(honeypot).trim() !== '') {
      logger.info('Appeal honeypot triggered; silently ignoring', { ip });
      return { success: true, appeal: { id: 0, status: 'pending' } };
    }

    if (!submittedIdentifier || String(submittedIdentifier).trim().length === 0) {
      return { success: false, code: 'MISSING_IDENTIFIER', error: 'Please enter your Telegram username, ID, or email.' };
    }
    if (!contactEmail || !EMAIL_RE.test(String(contactEmail).trim())) {
      return { success: false, code: 'INVALID_EMAIL', error: 'Please enter a valid contact email.' };
    }
    const expl = String(explanation || '').trim();
    if (expl.length < MIN_EXPLANATION) {
      return { success: false, code: 'EXPLANATION_TOO_SHORT', error: `Please add at least ${MIN_EXPLANATION} characters explaining your appeal.` };
    }
    if (expl.length > MAX_EXPLANATION) {
      return { success: false, code: 'EXPLANATION_TOO_LONG', error: `Explanation too long (max ${MAX_EXPLANATION}).` };
    }

    // Per-IP rate limit: 1/hour and 3/day
    if (ip) {
      const hour = await query(
        `SELECT COUNT(*) AS c FROM report_appeals WHERE ip = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [ip]
      );
      if (parseInt(hour.rows[0].c, 10) >= 1) {
        return { success: false, code: 'RATE_LIMITED_HOUR', error: 'Please wait an hour before submitting another appeal.' };
      }
      const day = await query(
        `SELECT COUNT(*) AS c FROM report_appeals WHERE ip = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [ip]
      );
      if (parseInt(day.rows[0].c, 10) >= 3) {
        return { success: false, code: 'RATE_LIMITED_DAY', error: "You've reached the daily appeal limit. Please try again tomorrow." };
      }
    }

    const resolvedId = await resolveIdentifier(submittedIdentifier);

    // Enforce "one pending appeal per resolved user" — DB has a partial unique index.
    try {
      const result = await query(
        `INSERT INTO report_appeals
           (submitted_identifier, resolved_user_id, contact_email, explanation, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, status, created_at`,
        [
          String(submittedIdentifier).trim().slice(0, 255),
          resolvedId,
          String(contactEmail).trim().toLowerCase().slice(0, 255),
          expl,
          ip || null,
          userAgent ? String(userAgent).slice(0, 500) : null,
        ]
      );
      logger.info('Appeal submitted', { id: result.rows[0].id, resolvedId, ip });
      return { success: true, appeal: result.rows[0] };
    } catch (err) {
      if (err.code === '23505') {
        return {
          success: false,
          code: 'DUPLICATE_PENDING',
          error: 'We already have a pending appeal for this account. Our team will respond by email.',
        };
      }
      logger.error('Failed to insert appeal', err);
      return { success: false, code: 'SERVER_ERROR', error: 'Could not submit appeal. Please try again later.' };
    }
  }

  async listAppeals({ status = 'pending', limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    let where = '';
    const params = [];
    if (status && status !== 'all') {
      params.push(status);
      where = `WHERE a.status = $${params.length}`;
    }
    params.push(safeLimit, safeOffset);

    const result = await query(
      `SELECT
         a.id, a.submitted_identifier, a.resolved_user_id,
         a.contact_email, a.explanation, a.status,
         a.admin_notes, a.reviewer_id, a.reviewed_at,
         a.ip, a.created_at, a.updated_at,
         u.first_name  AS resolved_first_name,
         u.username    AS resolved_username,
         u.role        AS resolved_role,
         u.is_active   AS resolved_is_active,
         u.photo_file_id AS resolved_photo
       FROM report_appeals a
       LEFT JOIN users u ON u.id = a.resolved_user_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const counts = await query(
      `SELECT status, COUNT(*) AS c FROM report_appeals GROUP BY status`
    );
    const countsByStatus = counts.rows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.c, 10);
      return acc;
    }, {});

    return {
      appeals: result.rows,
      counts: countsByStatus,
      pending: countsByStatus.pending || 0,
    };
  }

  async reviewAppeal({ appealId, reviewerId, action, notes }) {
    if (!appealId || !reviewerId || !action) {
      return { success: false, code: 'MISSING_PARAMS', error: 'Missing params' };
    }
    if (action !== 'approve' && action !== 'deny') {
      return { success: false, code: 'INVALID_ACTION', error: 'Invalid action' };
    }

    const appealRes = await query(`SELECT * FROM report_appeals WHERE id = $1`, [appealId]);
    if (appealRes.rowCount === 0) {
      return { success: false, code: 'NOT_FOUND', error: 'Appeal not found' };
    }
    const appeal = appealRes.rows[0];
    const newStatus = action === 'approve' ? 'approved' : 'denied';

    // If approving and we resolved the user, reinstate them
    if (action === 'approve' && appeal.resolved_user_id) {
      try {
        await query(
          `UPDATE users
              SET is_active = TRUE,
                  role = CASE WHEN role = 'banned' THEN 'user' ELSE role END
            WHERE id = $1`,
          [appeal.resolved_user_id]
        );
        logger.info('Appeal approved — user reinstated', {
          appealId,
          userId: appeal.resolved_user_id,
          reviewerId,
        });
      } catch (err) {
        logger.error('Reinstate on appeal-approve failed', err);
      }
    }

    const updated = await query(
      `UPDATE report_appeals
          SET status = $1,
              reviewer_id = $2,
              reviewed_at = NOW(),
              admin_notes = $3
        WHERE id = $4
        RETURNING *`,
      [newStatus, reviewerId, notes ? String(notes).slice(0, 2000) : null, appealId]
    );

    return { success: true, appeal: updated.rows[0] };
  }
}

module.exports = new AppealService();
