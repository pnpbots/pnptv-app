/**
 * Event Model
 * Handles scheduled Live Stream and Hangout events
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE = 'events';
const RSVP_TABLE = 'event_rsvps';

class EventModel {
  static _map(row) {
    if (!row) return null;
    return {
      id: row.id,
      creatorId: row.creator_id,
      creatorName: row.creator_name || null,
      creatorUsername: row.creator_username || null,
      creatorPhoto: row.creator_photo || null,
      type: row.type,
      title: row.title,
      description: row.description,
      coverImage: row.cover_image,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      status: row.status,
      isFeatured: row.is_featured,
      maxAttendees: row.max_attendees,
      hangoutGroupId: row.hangout_group_id,
      tags: row.tags || [],
      rsvpCount: parseInt(row.rsvp_count, 10) || 0,
      userRsvpd: row.user_rsvpd || false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static async create({ creatorId, type, title, description, coverImage, scheduledAt, durationMinutes, maxAttendees, hangoutGroupId, tags }) {
    const result = await query(
      `INSERT INTO ${TABLE}
        (creator_id, type, title, description, cover_image, scheduled_at, duration_minutes, max_attendees, hangout_group_id, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        String(creatorId), type, title,
        description || null, coverImage || null,
        scheduledAt, durationMinutes || 60,
        maxAttendees || null, hangoutGroupId || null,
        tags || [],
      ]
    );
    return this._map(result.rows[0]);
  }

  static async getById(id, viewerUserId = null) {
    const result = await query(
      `SELECT e.*,
              u.first_name || COALESCE(' ' || u.last_name, '') AS creator_name,
              u.username AS creator_username,
              u.photo_file_id AS creator_photo,
              CASE WHEN r.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS user_rsvpd
       FROM ${TABLE} e
       LEFT JOIN users u ON u.id = e.creator_id
       LEFT JOIN ${RSVP_TABLE} r ON r.event_id = e.id AND r.user_id = $2
       WHERE e.id = $1`,
      [id, viewerUserId ? String(viewerUserId) : null]
    );
    return this._map(result.rows[0]);
  }

  static async getUpcoming({ limit = 10, type = null, hangoutGroupId = null, viewerUserId = null } = {}) {
    const params = [limit];
    const filters = [];
    if (type) {
      params.push(type);
      filters.push(`e.type = $${params.length}`);
    }
    if (hangoutGroupId) {
      params.push(hangoutGroupId);
      filters.push(`e.hangout_group_id = $${params.length}`);
    }
    const extraFilters = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const viewerParam = viewerUserId ? String(viewerUserId) : null;
    params.push(viewerParam);
    const rsvpIdx = params.length;

    const result = await query(
      `SELECT e.*,
              u.first_name || COALESCE(' ' || u.last_name, '') AS creator_name,
              u.username AS creator_username,
              u.photo_file_id AS creator_photo,
              CASE WHEN r.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS user_rsvpd
       FROM ${TABLE} e
       LEFT JOIN users u ON u.id = e.creator_id
       LEFT JOIN ${RSVP_TABLE} r ON r.event_id = e.id AND r.user_id = $${rsvpIdx}
       WHERE e.status = 'upcoming'
         AND e.scheduled_at > NOW() - INTERVAL '1 hour'
         ${extraFilters}
       ORDER BY e.is_featured DESC, e.scheduled_at ASC
       LIMIT $1`,
      params
    );
    return result.rows.map((r) => this._map(r));
  }

  static async getFeatured({ viewerUserId = null } = {}) {
    const result = await query(
      `SELECT e.*,
              u.first_name || COALESCE(' ' || u.last_name, '') AS creator_name,
              u.username AS creator_username,
              u.photo_file_id AS creator_photo,
              CASE WHEN r.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS user_rsvpd
       FROM ${TABLE} e
       LEFT JOIN users u ON u.id = e.creator_id
       LEFT JOIN ${RSVP_TABLE} r ON r.event_id = e.id AND r.user_id = $1
       WHERE e.status = 'upcoming'
         AND e.is_featured = TRUE
         AND e.scheduled_at > NOW() - INTERVAL '1 hour'
       ORDER BY e.scheduled_at ASC
       LIMIT 5`,
      [viewerUserId ? String(viewerUserId) : null]
    );
    return result.rows.map((r) => this._map(r));
  }

  static async getByCreator(creatorId) {
    const result = await query(
      `SELECT e.*,
              u.first_name || COALESCE(' ' || u.last_name, '') AS creator_name,
              u.username AS creator_username,
              u.photo_file_id AS creator_photo
       FROM ${TABLE} e
       LEFT JOIN users u ON u.id = e.creator_id
       WHERE e.creator_id = $1
       ORDER BY e.scheduled_at DESC
       LIMIT 50`,
      [String(creatorId)]
    );
    return result.rows.map((r) => this._map(r));
  }

  static async update(id, creatorId, { title, description, coverImage, scheduledAt, durationMinutes, maxAttendees, hangoutGroupId, tags, status }) {
    const fields = [];
    const params = [id, String(creatorId)];

    const set = (col, val) => {
      if (val !== undefined) {
        params.push(val);
        fields.push(`${col} = $${params.length}`);
      }
    };
    set('title', title);
    set('description', description);
    set('cover_image', coverImage);
    set('scheduled_at', scheduledAt);
    set('duration_minutes', durationMinutes);
    set('max_attendees', maxAttendees);
    set('hangout_group_id', hangoutGroupId);
    set('tags', tags);
    set('status', status);

    if (fields.length === 0) throw new Error('No fields to update');

    const result = await query(
      `UPDATE ${TABLE} SET ${fields.join(', ')}
       WHERE id = $1 AND creator_id = $2
       RETURNING *`,
      params
    );
    if (result.rowCount === 0) return null;
    return this._map(result.rows[0]);
  }

  static async setFeatured(id, isFeatured) {
    await query(`UPDATE ${TABLE} SET is_featured = $2 WHERE id = $1`, [id, isFeatured]);
  }

  static async cancel(id, creatorId) {
    const result = await query(
      `UPDATE ${TABLE} SET status = 'cancelled'
       WHERE id = $1 AND creator_id = $2 AND status = 'upcoming'
       RETURNING id`,
      [id, String(creatorId)]
    );
    return result.rowCount > 0;
  }

  static async rsvp(eventId, userId) {
    try {
      await query(
        `INSERT INTO ${RSVP_TABLE} (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [eventId, String(userId)]
      );
      const updated = await query(
        `UPDATE ${TABLE} SET rsvp_count = (SELECT COUNT(*) FROM ${RSVP_TABLE} WHERE event_id = $1)
         WHERE id = $1 RETURNING rsvp_count`,
        [eventId]
      );
      return { rsvpCount: parseInt(updated.rows[0]?.rsvp_count, 10) || 0, userRsvpd: true };
    } catch (err) {
      logger.error('EventModel.rsvp error:', err);
      throw err;
    }
  }

  static async unrsvp(eventId, userId) {
    await query(
      `DELETE FROM ${RSVP_TABLE} WHERE event_id = $1 AND user_id = $2`,
      [eventId, String(userId)]
    );
    const updated = await query(
      `UPDATE ${TABLE} SET rsvp_count = (SELECT COUNT(*) FROM ${RSVP_TABLE} WHERE event_id = $1)
       WHERE id = $1 RETURNING rsvp_count`,
      [eventId]
    );
    return { rsvpCount: parseInt(updated.rows[0]?.rsvp_count, 10) || 0, userRsvpd: false };
  }

  static async getUserRsvps(userId) {
    const result = await query(
      `SELECT e.*, r.created_at AS rsvp_at,
              u.first_name || COALESCE(' ' || u.last_name, '') AS creator_name,
              u.username AS creator_username,
              u.photo_file_id AS creator_photo,
              TRUE AS user_rsvpd
       FROM ${RSVP_TABLE} r
       JOIN ${TABLE} e ON e.id = r.event_id
       LEFT JOIN users u ON u.id = e.creator_id
       WHERE r.user_id = $1
         AND e.status IN ('upcoming', 'live')
         AND e.scheduled_at > NOW() - INTERVAL '1 hour'
       ORDER BY e.scheduled_at ASC`,
      [String(userId)]
    );
    return result.rows.map((r) => this._map(r));
  }

  // Auto-expire past events (called by scheduler or on read)
  static async expirePastEvents() {
    await query(
      `UPDATE ${TABLE} SET status = 'ended'
       WHERE status = 'upcoming'
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') < NOW()`
    );
  }
}

module.exports = EventModel;
