/**
 * userReportService
 * ------------------
 * Community reporting of users. A reporter files a report against a target
 * user for a rule violation; admins triage from /admin/reports.
 *
 * Features:
 *   - Rate limit: MAX_REPORTS_PER_DAY per reporter (default 5)
 *   - Auto-block: creating a report also blocks the target for the reporter
 *   - CSAM auto-escalation: the category 'csam' flags the report urgent and
 *     suspends the target account pending review.
 *
 * Notes on file placement: services live at apps/backend/services/ (single
 * source of truth — see CLAUDE.md).
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const VALID_CATEGORIES = new Set([
  'harassment',
  'hate',
  'spam_scam',
  'impersonation',
  'csam',
  'nudity_nonconsensual',
  'self_harm',
  'other',
]);

const VALID_EVIDENCE_TYPES = new Set(['profile', 'post', 'hangout_message', 'dm']);

const MAX_REPORTS_PER_DAY = 5;
const MAX_DESCRIPTION_LENGTH = 1000;

class UserReportService {
  /**
   * @param {object} opts
   * @param {string} opts.reporterId
   * @param {string} opts.reportedUserId
   * @param {string} opts.category
   * @param {string} [opts.description]
   * @param {string} [opts.evidenceType]
   * @param {string|number} [opts.evidenceId]
   * @returns {Promise<{success:boolean, report?:object, error?:string, code?:string}>}
   */
  async createReport({ reporterId, reportedUserId, category, description, evidenceType, evidenceId }) {
    if (!reporterId || !reportedUserId) {
      return { success: false, error: 'Missing reporter or reported user', code: 'MISSING_PARAMS' };
    }
    if (String(reporterId) === String(reportedUserId)) {
      return { success: false, error: 'You cannot report yourself', code: 'SELF_REPORT' };
    }
    if (!VALID_CATEGORIES.has(category)) {
      return { success: false, error: 'Invalid report category', code: 'INVALID_CATEGORY' };
    }
    if (description && String(description).length > MAX_DESCRIPTION_LENGTH) {
      return { success: false, error: `Description too long (max ${MAX_DESCRIPTION_LENGTH})`, code: 'DESCRIPTION_TOO_LONG' };
    }
    if (evidenceType && !VALID_EVIDENCE_TYPES.has(evidenceType)) {
      return { success: false, error: 'Invalid evidence type', code: 'INVALID_EVIDENCE_TYPE' };
    }

    // Ensure target user exists
    const target = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [reportedUserId]);
    if (target.rowCount === 0) {
      return { success: false, error: 'Reported user not found', code: 'TARGET_NOT_FOUND' };
    }

    // Rate limit
    const recent = await query(
      `SELECT COUNT(*) AS c FROM user_reports
        WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [reporterId]
    );
    const dailyCount = parseInt(recent.rows[0].c, 10);
    if (dailyCount >= MAX_REPORTS_PER_DAY) {
      return {
        success: false,
        error: `You've reached the daily report limit (${MAX_REPORTS_PER_DAY}). Try again tomorrow.`,
        code: 'RATE_LIMITED',
      };
    }

    // Insert report (catch unique constraint for open duplicate)
    let report;
    try {
      const result = await query(
        `INSERT INTO user_reports
           (reporter_id, reported_user_id, category, description, evidence_type, evidence_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          String(reporterId),
          String(reportedUserId),
          category,
          description ? String(description).trim().slice(0, MAX_DESCRIPTION_LENGTH) : null,
          evidenceType || null,
          evidenceId != null ? String(evidenceId) : null,
        ]
      );
      report = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        // unique_violation on idx_user_reports_unique_open
        return {
          success: false,
          error: 'You already have an open report against this user. Our team is reviewing it.',
          code: 'DUPLICATE_OPEN',
        };
      }
      logger.error('Failed to insert user_report', err);
      throw err;
    }

    // Auto-block so the reporter stops seeing the target's content
    try {
      await query(
        `INSERT INTO blocked_users (user_id, blocked_user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [reporterId, reportedUserId]
      );
    } catch (err) {
      logger.warn('Auto-block on report failed (non-fatal)', { err: err.message, reporterId, reportedUserId });
    }

    // CSAM auto-escalation: suspend the account immediately, pending review
    if (category === 'csam') {
      try {
        await query(
          `UPDATE users
              SET is_active = FALSE
            WHERE id = $1`,
          [reportedUserId]
        );
        logger.warn('CSAM report received — account auto-suspended pending review', {
          reporterId,
          reportedUserId,
          reportId: report.id,
        });
      } catch (err) {
        logger.error('CSAM auto-suspend failed', err);
      }
    }

    logger.info('User report created', {
      reportId: report.id,
      reporterId,
      reportedUserId,
      category,
    });

    return { success: true, report };
  }

  /**
   * Admin list — pending first, paginated.
   */
  async listReports({ status = 'pending', limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    let where = '';
    const params = [];
    if (status && status !== 'all') {
      params.push(status);
      where = `WHERE r.status = $${params.length}`;
    }
    params.push(safeLimit, safeOffset);

    const result = await query(
      `SELECT
         r.id, r.reporter_id, r.reported_user_id,
         r.category, r.description,
         r.evidence_type, r.evidence_id,
         r.status, r.reviewer_id, r.reviewed_at, r.action_notes,
         r.created_at, r.updated_at,
         rep.first_name  AS reporter_first_name,
         rep.username    AS reporter_username,
         rep.photo_file_id AS reporter_photo,
         tgt.first_name  AS reported_first_name,
         tgt.username    AS reported_username,
         tgt.photo_file_id AS reported_photo,
         tgt.role        AS reported_role,
         tgt.is_active   AS reported_is_active
       FROM user_reports r
       JOIN users rep ON rep.id = r.reporter_id
       JOIN users tgt ON tgt.id = r.reported_user_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const counts = await query(
      `SELECT status, COUNT(*) AS c FROM user_reports GROUP BY status`
    );
    const countsByStatus = counts.rows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.c, 10);
      return acc;
    }, {});

    return {
      reports: result.rows,
      counts: countsByStatus,
      pending: countsByStatus.pending || 0,
    };
  }

  /**
   * Admin review action. Optionally applies moderation to the target.
   *
   * action: 'dismiss' | 'warn' | 'suspend_7d' | 'ban'
   */
  async reviewReport({ reportId, reviewerId, action, notes }) {
    if (!reportId || !reviewerId || !action) {
      return { success: false, error: 'Missing params', code: 'MISSING_PARAMS' };
    }
    const ALLOWED = new Set(['dismiss', 'warn', 'suspend_7d', 'ban']);
    if (!ALLOWED.has(action)) {
      return { success: false, error: 'Invalid action', code: 'INVALID_ACTION' };
    }

    const reportResult = await query(
      `SELECT * FROM user_reports WHERE id = $1 LIMIT 1`,
      [reportId]
    );
    if (reportResult.rowCount === 0) {
      return { success: false, error: 'Report not found', code: 'NOT_FOUND' };
    }
    const report = reportResult.rows[0];
    const targetId = report.reported_user_id;

    let newStatus;
    switch (action) {
      case 'dismiss':
        newStatus = 'dismissed';
        break;
      case 'warn':
        newStatus = 'reviewed';
        // Warning delivery is out of scope for MVP — admin can DM manually.
        break;
      case 'suspend_7d': {
        newStatus = 'action_taken';
        try {
          await query(`UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [targetId]);
          // Invalidate cache and destroy sessions so user is kicked out immediately
          const { cache: suspendCache } = require('../config/redis');
          await suspendCache.del(`user:${targetId}`);
          try {
            const suspendRedis = require('../config/redis').client;
            const suspendKeys = await suspendRedis.keys('sess:*');
            for (const k of suspendKeys) {
              const v = await suspendRedis.get(k);
              if (v && v.includes(String(targetId))) await suspendRedis.del(k);
            }
          } catch (sessErr) {
            logger.warn('Failed to destroy sessions for suspended user', { targetId, error: sessErr.message });
          }
        } catch (err) {
          logger.error('Suspend failed', err);
        }
        break;
      }
      case 'ban': {
        newStatus = 'action_taken';
        try {
          // Mirror banUser(): set tier='banned', keep role='user', revoke subscription + creator status
          await query(
            `UPDATE users SET is_active = FALSE, tier = 'banned', role = 'user',
             creator_status = 'none', subscription_status = 'expired', updated_at = NOW()
             WHERE id = $1`,
            [targetId]
          );
          // Invalidate cache and destroy all active sessions
          const { cache: banCache } = require('../config/redis');
          await banCache.del(`user:${targetId}`);
          try {
            const banRedis = require('../config/redis').client;
            const banKeys = await banRedis.keys('sess:*');
            for (const k of banKeys) {
              const v = await banRedis.get(k);
              if (v && v.includes(String(targetId))) await banRedis.del(k);
            }
          } catch (sessErr) {
            logger.warn('Failed to destroy sessions for banned user', { targetId, error: sessErr.message });
          }
        } catch (err) {
          logger.error('Ban failed', err);
        }
        break;
      }
    }

    const updated = await query(
      `UPDATE user_reports
          SET status = $1,
              reviewer_id = $2,
              reviewed_at = NOW(),
              action_notes = $3
        WHERE id = $4
        RETURNING *`,
      [newStatus, reviewerId, notes ? String(notes).slice(0, 2000) : null, reportId]
    );

    logger.info('User report reviewed', {
      reportId,
      action,
      reviewerId,
      targetId,
      newStatus,
    });

    // Notify reporter with a DM from the reviewing admin
    try {
      const msg = this._buildResolutionMessage(action, report.category, reportId);
      await query(
        `INSERT INTO direct_messages (sender_id, recipient_id, content, message_type, meta)
         VALUES ($1, $2, $3, 'text', $4::jsonb)`,
        [
          reviewerId,
          report.reporter_id,
          msg,
          JSON.stringify({ report_id: reportId, report_action: action, system_notification: true }),
        ]
      );
    } catch (dmErr) {
      logger.warn('Failed to send resolution DM to reporter — non-fatal', {
        reportId,
        reporterId: report.reporter_id,
        error: dmErr.message,
      });
    }

    return { success: true, report: updated.rows[0] };
  }

  _buildResolutionMessage(action, category, reportId) {
    const categoryLabel = {
      harassment: 'harassment',
      hate: 'hate / discrimination',
      spam_scam: 'spam or scam',
      impersonation: 'impersonation',
      csam: 'child safety',
      nudity_nonconsensual: 'non-consensual content',
      self_harm: 'self-harm',
      other: 'a community violation',
    }[category] || 'a community violation';

    const thanks = `Thank you for reporting ${categoryLabel} — it helps keep PNPtv! a safer space for everyone. 💙`;

    switch (action) {
      case 'dismiss':
        return `Hi! ${thanks}\n\nAfter reviewing your report (#${reportId}), our team determined no action was needed at this time. We appreciate you looking out for the community.`;
      case 'warn':
        return `Hi! ${thanks}\n\nWe've reviewed your report (#${reportId}) and issued a warning to the account involved. Thank you for caring for our community.`;
      case 'suspend_7d':
        return `Hi! ${thanks}\n\nAfter reviewing your report (#${reportId}), we've temporarily suspended the reported account. Thank you for helping make PNPtv! a safer place.`;
      case 'ban':
        return `Hi! ${thanks}\n\nAfter reviewing your report (#${reportId}), the reported account has been permanently removed from our platform. Thank you for protecting our community.`;
      default:
        return `Hi! ${thanks}\n\nYour report (#${reportId}) has been reviewed by our team. Thank you for caring for our community.`;
    }
  }
}

module.exports = new UserReportService();
