const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE = 'call_sessions';

/**
 * Call Session Model - Manages video call room sessions
 * Statuses: scheduled -> live -> ended -> destroyed
 */
class CallSessionModel {
  // =====================================================
  // ROW MAPPING
  // =====================================================

  static mapRowToSession(row) {
    if (!row) return null;
    return {
      id: row.id,
      bookingId: row.booking_id,
      roomProvider: row.room_provider,
      roomId: row.room_id,
      roomName: row.room_name,
      joinUrlUser: row.join_url_user,
      joinUrlPerformer: row.join_url_performer,
      tokenUser: row.token_user,
      tokenPerformer: row.token_performer,
      maxParticipants: row.max_participants,
      recordingDisabled: row.recording_disabled,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      actualDurationSeconds: row.actual_duration_seconds,
      createdAt: row.created_at,
    };
  }

  // =====================================================
  // CRUD OPERATIONS
  // =====================================================

  /**
   * Create a new call session
   */
  static async create(data) {
    try {
      const id = uuidv4();
      const roomId = data.roomId || `pnptv-${id.slice(0, 8)}`;
      const roomName = data.roomName || `Private Call ${roomId}`;

      const sql = `
        INSERT INTO ${TABLE} (
          id, booking_id, room_provider, room_id, room_name,
          join_url_user, join_url_performer, token_user, token_performer,
          max_participants, recording_disabled, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'scheduled')
        RETURNING *
      `;

      const result = await query(sql, [
        id,
        data.bookingId,
        data.roomProvider || 'jitsi',
        roomId,
        roomName,
        data.joinUrlUser || null,
        data.joinUrlPerformer || null,
        data.tokenUser || null,
        data.tokenPerformer || null,
        data.maxParticipants || 2,
        data.recordingDisabled !== false,
      ]);

      logger.info('Call session created', { sessionId: id, bookingId: data.bookingId, roomId });
      return this.mapRowToSession(result.rows[0]);
    } catch (error) {
      logger.error('Error creating call session:', error);
      throw error;
    }
  }

  /**
   * Get session by ID
   */
  static async getById(sessionId) {
    try {
      const sql = `SELECT * FROM ${TABLE} WHERE id = $1`;
      const result = await query(sql, [sessionId]);
      return this.mapRowToSession(result.rows[0]);
    } catch (error) {
      logger.error('Error getting session by ID:', error);
      return null;
    }
  }

  /**
   * Get session by booking ID
   */
  static async getByBookingId(bookingId) {
    try {
      const sql = `SELECT * FROM ${TABLE} WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`;
      const result = await query(sql, [bookingId]);
      return this.mapRowToSession(result.rows[0]);
    } catch (error) {
      logger.error('Error getting session by booking ID:', error);
      return null;
    }
  }

  /**
   * Get session by room ID
   */
  static async getByRoomId(roomId) {
    try {
      const sql = `SELECT * FROM ${TABLE} WHERE room_id = $1 ORDER BY created_at DESC LIMIT 1`;
      const result = await query(sql, [roomId]);
      return this.mapRowToSession(result.rows[0]);
    } catch (error) {
      logger.error('Error getting session by room ID:', error);
      return null;
    }
  }

  // =====================================================
  // SESSION LIFECYCLE
  // =====================================================

  /**
   * Update session with join URLs and tokens
   */
  static async updateJoinInfo(sessionId, data) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET join_url_user = COALESCE($2, join_url_user),
            join_url_performer = COALESCE($3, join_url_performer),
            token_user = COALESCE($4, token_user),
            token_performer = COALESCE($5, token_performer)
        WHERE id = $1
        RETURNING *
      `;

      const result = await query(sql, [
        sessionId,
        data.joinUrlUser || null,
        data.joinUrlPerformer || null,
        data.tokenUser || null,
        data.tokenPerformer || null,
      ]);

      logger.info('Session join info updated', { sessionId });
      return this.mapRowToSession(result.rows[0]);
    } catch (error) {
      logger.error('Error updating session join info:', error);
      return null;
    }
  }

  /**
   * Start a call session
   */
  static async start(sessionId) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET status = 'live',
            started_at = NOW()
        WHERE id = $1 AND status = 'scheduled'
        RETURNING *
      `;
      const result = await query(sql, [sessionId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'session_not_found_or_invalid_status' };
      }

      logger.info('Call session started', { sessionId });
      return { success: true, session: this.mapRowToSession(result.rows[0]) };
    } catch (error) {
      logger.error('Error starting session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * End a call session
   */
  static async end(sessionId) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET status = 'ended',
            ended_at = NOW(),
            actual_duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
        WHERE id = $1 AND status = 'live'
        RETURNING *
      `;
      const result = await query(sql, [sessionId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'session_not_found_or_invalid_status' };
      }

      logger.info('Call session ended', { sessionId, duration: result.rows[0].actual_duration_seconds });
      return { success: true, session: this.mapRowToSession(result.rows[0]) };
    } catch (error) {
      logger.error('Error ending session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Destroy a call session (cleanup room resources)
   */
  static async destroy(sessionId) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET status = 'destroyed',
            ended_at = COALESCE(ended_at, NOW())
        WHERE id = $1 AND status IN ('scheduled', 'live', 'ended')
        RETURNING *
      `;
      const result = await query(sql, [sessionId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'session_not_found_or_already_destroyed' };
      }

      logger.info('Call session destroyed', { sessionId });
      return { success: true, session: this.mapRowToSession(result.rows[0]) };
    } catch (error) {
      logger.error('Error destroying session:', error);
      return { success: false, error: error.message };
    }
  }

  // =====================================================
  // QUERIES
  // =====================================================

  /**
   * Get active (live) sessions
   */
  static async getActiveSessions() {
    try {
      const sql = `
        SELECT s.*,
               b.user_id, b.performer_id, b.start_time_utc, b.end_time_utc
        FROM ${TABLE} s
        LEFT JOIN bookings b ON s.booking_id = b.id
        WHERE s.status = 'live'
        ORDER BY s.started_at ASC
      `;
      const result = await query(sql);
      return result.rows.map(row => ({
        ...this.mapRowToSession(row),
        userId: row.user_id,
        performerId: row.performer_id,
        scheduledStart: row.start_time_utc,
        scheduledEnd: row.end_time_utc,
      }));
    } catch (error) {
      logger.error('Error getting active sessions:', error);
      return [];
    }
  }

  /**
   * Get sessions that should auto-end (past their scheduled end time)
   */
  static async getOverdueSessions() {
    try {
      const sql = `
        SELECT s.*,
               b.end_time_utc
        FROM ${TABLE} s
        LEFT JOIN bookings b ON s.booking_id = b.id
        WHERE s.status = 'live'
          AND b.end_time_utc < NOW()
        ORDER BY b.end_time_utc ASC
      `;
      const result = await query(sql);
      return result.rows.map(row => ({
        ...this.mapRowToSession(row),
        scheduledEnd: row.end_time_utc,
      }));
    } catch (error) {
      logger.error('Error getting overdue sessions:', error);
      return [];
    }
  }

  /**
   * Get scheduled sessions that should start soon
   */
  static async getUpcomingSessions(minutesAhead = 5) {
    try {
      const sql = `
        SELECT s.*,
               b.user_id, b.performer_id, b.start_time_utc
        FROM ${TABLE} s
        LEFT JOIN bookings b ON s.booking_id = b.id
        WHERE s.status = 'scheduled'
          AND b.status = 'confirmed'
          AND b.start_time_utc <= NOW() + ($1 || ' minutes')::INTERVAL
          AND b.start_time_utc > NOW() - INTERVAL '5 minutes'
        ORDER BY b.start_time_utc ASC
      `;
      const result = await query(sql, [minutesAhead]);
      return result.rows.map(row => ({
        ...this.mapRowToSession(row),
        userId: row.user_id,
        performerId: row.performer_id,
        scheduledStart: row.start_time_utc,
      }));
    } catch (error) {
      logger.error('Error getting upcoming sessions:', error);
      return [];
    }
  }

  // =====================================================
  // STATISTICS
  // =====================================================

  /**
   * Get session statistics
   */
  static async getStatistics(options = {}) {
    try {
      let whereClause = 'WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (options.fromDate) {
        whereClause += ` AND created_at >= $${paramIndex++}`;
        params.push(options.fromDate);
      }

      if (options.toDate) {
        whereClause += ` AND created_at <= $${paramIndex++}`;
        params.push(options.toDate);
      }

      const sql = `
        SELECT
          COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled_count,
          COUNT(*) FILTER (WHERE status = 'live') as live_count,
          COUNT(*) FILTER (WHERE status = 'ended') as ended_count,
          COUNT(*) FILTER (WHERE status = 'destroyed') as destroyed_count,
          COUNT(*) as total_count,
          COALESCE(AVG(actual_duration_seconds) FILTER (WHERE status IN ('ended', 'destroyed')), 0) as avg_duration_seconds,
          COALESCE(SUM(actual_duration_seconds) FILTER (WHERE status IN ('ended', 'destroyed')), 0) as total_duration_seconds
        FROM ${TABLE}
        ${whereClause}
      `;

      const result = await query(sql, params);
      const row = result.rows[0];

      return {
        scheduled: parseInt(row.scheduled_count) || 0,
        live: parseInt(row.live_count) || 0,
        ended: parseInt(row.ended_count) || 0,
        destroyed: parseInt(row.destroyed_count) || 0,
        total: parseInt(row.total_count) || 0,
        avgDurationSeconds: parseFloat(row.avg_duration_seconds) || 0,
        totalDurationSeconds: parseInt(row.total_duration_seconds) || 0,
      };
    } catch (error) {
      logger.error('Error getting session statistics:', error);
      return { scheduled: 0, live: 0, ended: 0, destroyed: 0, total: 0, avgDurationSeconds: 0, totalDurationSeconds: 0 };
    }
  }
}

module.exports = CallSessionModel;
