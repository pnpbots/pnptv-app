const { query } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Model Management System
 * Handles all model-related database operations
 */
class ModelManagementModel {
  /**
   * Initialize model tables
   */
  static async initTables() {
    try {
      const initSql = require('fs').readFileSync(
        require('path').join(__dirname, '../../database/migrations/004_create_models_system.sql'),
        'utf8'
      );

      // Split and execute individual statements
      const statements = initSql.split(';').filter(stmt => stmt.trim());
      for (const statement of statements) {
        if (statement.trim()) {
          await query(statement);
        }
      }
      logger.info('Model tables initialized successfully');
      return true;
    } catch (error) {
      logger.error('Error initializing model tables:', error);
      throw error;
    }
  }

  /**
   * Create a new model
   */
  static async createModel({
    model_id,
    username,
    display_name,
    bio,
    photo_url,
    price_per_minute,
    min_duration_minutes = 15,
    max_duration_minutes = 120
  }) {
    const sql = `
      INSERT INTO models (
        model_id, username, display_name, bio, photo_url,
        price_per_minute, min_duration_minutes, max_duration_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    try {
      const result = await query(sql, [
        model_id,
        username,
        display_name,
        bio,
        photo_url,
        price_per_minute,
        min_duration_minutes,
        max_duration_minutes
      ]);

      // Initialize status
      await this.updateModelStatus(model_id, 'offline');

      logger.info('Model created', { model_id, username });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating model:', error);
      throw error;
    }
  }

  /**
   * Get all active models
   */
  static async getAllModels(onlyActive = true) {
    const sql = onlyActive
      ? 'SELECT * FROM models WHERE is_active = true ORDER BY display_name'
      : 'SELECT * FROM models ORDER BY display_name';

    try {
      const result = await query(sql);
      return result.rows;
    } catch (error) {
      logger.error('Error getting models:', error);
      throw error;
    }
  }

  /**
   * Get model by ID with full details
   */
  static async getModelDetails(model_id) {
    const sql = `
      SELECT
        m.*,
        ms.status,
        COUNT(DISTINCT p.id) as photo_count,
        AVG(r.rating) as avg_rating,
        COUNT(DISTINCT r.id) as review_count
      FROM models m
      LEFT JOIN model_status ms ON m.model_id = ms.model_id
      LEFT JOIN model_photos p ON m.model_id = p.model_id AND p.is_active = true
      LEFT JOIN model_reviews r ON m.model_id = r.model_id
      WHERE m.model_id = $1
      GROUP BY m.id, ms.id
    `;

    try {
      const result = await query(sql, [model_id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting model details:', error);
      throw error;
    }
  }

  /**
   * Update model information
   */
  static async updateModel(model_id, updates) {
    const {
      display_name,
      bio,
      photo_url,
      price_per_minute,
      min_duration_minutes,
      max_duration_minutes,
      is_active
    } = updates;

    const setClause = [];
    const values = [model_id];
    let paramCount = 2;

    if (display_name !== undefined) {
      setClause.push(`display_name = $${paramCount++}`);
      values.push(display_name);
    }
    if (bio !== undefined) {
      setClause.push(`bio = $${paramCount++}`);
      values.push(bio);
    }
    if (photo_url !== undefined) {
      setClause.push(`photo_url = $${paramCount++}`);
      values.push(photo_url);
    }
    if (price_per_minute !== undefined) {
      setClause.push(`price_per_minute = $${paramCount++}`);
      values.push(price_per_minute);
    }
    if (min_duration_minutes !== undefined) {
      setClause.push(`min_duration_minutes = $${paramCount++}`);
      values.push(min_duration_minutes);
    }
    if (max_duration_minutes !== undefined) {
      setClause.push(`max_duration_minutes = $${paramCount++}`);
      values.push(max_duration_minutes);
    }
    if (is_active !== undefined) {
      setClause.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);

    const sql = `
      UPDATE models
      SET ${setClause.join(', ')}
      WHERE model_id = $1
      RETURNING *
    `;

    try {
      const result = await query(sql, values);
      logger.info('Model updated', { model_id });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating model:', error);
      throw error;
    }
  }

  /**
   * Set model status (online, offline, busy)
   */
  static async updateModelStatus(model_id, status, current_booking_id = null) {
    const sql = `
      INSERT INTO model_status (model_id, status, current_booking_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (model_id) DO UPDATE SET
        status = $2,
        current_booking_id = $3,
        last_updated = CURRENT_TIMESTAMP
      RETURNING *
    `;

    try {
      const result = await query(sql, [model_id, status, current_booking_id]);
      logger.info('Model status updated', { model_id, status });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating model status:', error);
      throw error;
    }
  }

  /**
   * Get model current status
   */
  static async getModelStatus(model_id) {
    const sql = 'SELECT * FROM model_status WHERE model_id = $1';

    try {
      const result = await query(sql, [model_id]);
      return result.rows[0] || { model_id, status: 'offline', current_booking_id: null };
    } catch (error) {
      logger.error('Error getting model status:', error);
      return { model_id, status: 'offline', current_booking_id: null };
    }
  }

  /**
   * Set model availability schedule (weekly recurring)
   */
  static async setAvailability(model_id, dayOfWeek, startTime, endTime) {
    const sql = `
      INSERT INTO model_availability (model_id, day_of_week, start_time, end_time)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (model_id, day_of_week) DO UPDATE SET
        start_time = $3,
        end_time = $4,
        is_available = true
      RETURNING *
    `;

    try {
      const result = await query(sql, [model_id, dayOfWeek, startTime, endTime]);
      logger.info('Model availability set', { model_id, dayOfWeek, startTime, endTime });
      return result.rows[0];
    } catch (error) {
      logger.error('Error setting availability:', error);
      throw error;
    }
  }

  /**
   * Get model availability schedule
   */
  static async getAvailability(model_id) {
    const sql = `
      SELECT * FROM model_availability
      WHERE model_id = $1 AND is_available = true
      ORDER BY day_of_week
    `;

    try {
      const result = await query(sql, [model_id]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting availability:', error);
      throw error;
    }
  }

  /**
   * Add photo to model gallery
   */
  static async addPhoto(model_id, photo_url, caption, displayOrder) {
    const sql = `
      INSERT INTO model_photos (model_id, photo_url, caption, display_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    try {
      const result = await query(sql, [model_id, photo_url, caption, displayOrder || 0]);
      logger.info('Photo added to model gallery', { model_id });
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding photo:', error);
      throw error;
    }
  }

  /**
   * Get model photos
   */
  static async getModelPhotos(model_id) {
    const sql = `
      SELECT * FROM model_photos
      WHERE model_id = $1 AND is_active = true
      ORDER BY display_order
    `;

    try {
      const result = await query(sql, [model_id]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting model photos:', error);
      throw error;
    }
  }

  /**
   * Create a booking
   */
  static async createBooking({
    model_id,
    user_id,
    telegram_user_id,
    username,
    scheduled_date,
    start_time,
    duration_minutes,
    total_price,
    payment_method,
    notes
  }) {
    const endTime = this.calculateEndTime(start_time, duration_minutes);

    const sql = `
      INSERT INTO model_bookings (
        model_id, user_id, telegram_user_id, username,
        scheduled_date, start_time, duration_minutes, end_time,
        total_price, payment_method, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    try {
      const result = await query(sql, [
        model_id,
        user_id,
        telegram_user_id,
        username,
        scheduled_date,
        start_time,
        duration_minutes,
        endTime,
        total_price,
        payment_method,
        notes
      ]);

      logger.info('Booking created', {
        model_id,
        telegram_user_id,
        scheduled_date,
        duration_minutes
      });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating booking:', error);
      throw error;
    }
  }

  /**
   * Get user bookings
   */
  static async getUserBookings(telegram_user_id) {
    const sql = `
      SELECT b.*, m.display_name, m.photo_url
      FROM model_bookings b
      JOIN models m ON b.model_id = m.model_id
      WHERE b.telegram_user_id = $1
      ORDER BY b.scheduled_date DESC, b.start_time DESC
    `;

    try {
      const result = await query(sql, [telegram_user_id]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user bookings:', error);
      throw error;
    }
  }

  /**
   * Get model bookings
   */
  static async getModelBookings(model_id, start_date, end_date) {
    const sql = `
      SELECT * FROM model_bookings
      WHERE model_id = $1
      AND scheduled_date BETWEEN $2 AND $3
      AND status NOT IN ('cancelled')
      ORDER BY scheduled_date ASC, start_time ASC
    `;

    try {
      const result = await query(sql, [model_id, start_date, end_date]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting model bookings:', error);
      throw error;
    }
  }

  /**
   * Get available slots for a model on a specific date
   */
  static async getAvailableSlots(model_id, date) {
    try {
      // Get day of week (0-6, where 0 is Sunday)
      const dateObj = new Date(date);
      const dayOfWeek = dateObj.getDay();

      // Get model's scheduled availability for this day
      const availSql = `
        SELECT start_time, end_time FROM model_availability
        WHERE model_id = $1 AND day_of_week = $2 AND is_available = true
      `;
      const availResult = await query(availSql, [model_id, dayOfWeek]);

      if (availResult.rows.length === 0) {
        return []; // Model not available this day
      }

      // Get existing bookings for this date
      const bookingSql = `
        SELECT start_time, end_time FROM model_bookings
        WHERE model_id = $1 AND scheduled_date = $2
        AND status NOT IN ('cancelled')
      `;
      const bookingResult = await query(bookingSql, [model_id, date]);

      const availability = availResult.rows[0];
      const bookings = bookingResult.rows;

      // Calculate available slots
      const slots = this.calculateAvailableSlots(
        availability.start_time,
        availability.end_time,
        bookings
      );

      return slots;
    } catch (error) {
      logger.error('Error getting available slots:', error);
      throw error;
    }
  }

  /**
   * Update booking status
   */
  static async updateBookingStatus(booking_id, status, additionalData = {}) {
    const {
      payment_status,
      transaction_id,
      call_room_url
    } = additionalData;

    const setClauses = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [booking_id, status];
    let paramCount = 3;

    if (payment_status !== undefined) {
      setClauses.push(`payment_status = $${paramCount++}`);
      values.push(payment_status);
    }
    if (transaction_id !== undefined) {
      setClauses.push(`transaction_id = $${paramCount++}`);
      values.push(transaction_id);
    }
    if (call_room_url !== undefined) {
      setClauses.push(`call_room_url = $${paramCount++}`);
      values.push(call_room_url);
    }

    const sql = `
      UPDATE model_bookings
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await query(sql, values);
      logger.info('Booking status updated', { booking_id, status });
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating booking status:', error);
      throw error;
    }
  }

  /**
   * Get booking details
   */
  static async getBookingDetails(booking_id) {
    const sql = `
      SELECT b.*, m.display_name, m.photo_url, m.price_per_minute
      FROM model_bookings b
      JOIN models m ON b.model_id = m.model_id
      WHERE b.id = $1
    `;

    try {
      const result = await query(sql, [booking_id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting booking details:', error);
      throw error;
    }
  }

  /**
   * Record model earnings from booking
   */
  static async recordEarnings(booking_id, amount, commissionPercentage = 30) {
    const modelEarnings = amount * (1 - commissionPercentage / 100);

    const sql = `
      INSERT INTO model_earnings (booking_id, amount, commission_percentage, model_earnings)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    try {
      const result = await query(sql, [booking_id, amount, commissionPercentage, modelEarnings]);
      logger.info('Earnings recorded', { booking_id, amount, modelEarnings });
      return result.rows[0];
    } catch (error) {
      logger.error('Error recording earnings:', error);
      throw error;
    }
  }

  /**
   * Utility: Calculate end time from start time and duration
   */
  static calculateEndTime(startTime, durationMinutes) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date(2000, 0, 1, hours, minutes);
    date.setMinutes(date.getMinutes() + durationMinutes);

    const endHours = String(date.getHours()).padStart(2, '0');
    const endMinutes = String(date.getMinutes()).padStart(2, '0');
    return `${endHours}:${endMinutes}`;
  }

  /**
   * Utility: Calculate available time slots
   */
  static calculateAvailableSlots(startTime, endTime, bookings) {
    const slots = [];
    const slotDuration = 15; // 15-minute slots

    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);

    let currentTime = new Date(2000, 0, 1, startHours, startMinutes);
    const availUntil = new Date(2000, 0, 1, endHours, endMinutes);

    while (currentTime < availUntil) {
      const slotStart = this.formatTime(currentTime);
      const nextSlot = new Date(currentTime);
      nextSlot.setMinutes(nextSlot.getMinutes() + slotDuration);

      const isBooked = bookings.some(booking => {
        const bStart = new Date(2000, 0, 1, ...booking.start_time.split(':').map(Number));
        const bEnd = new Date(2000, 0, 1, ...booking.end_time.split(':').map(Number));
        return currentTime < bEnd && nextSlot > bStart;
      });

      if (!isBooked) {
        slots.push(slotStart);
      }

      currentTime = nextSlot;
    }

    return slots;
  }

  /**
   * Utility: Format time
   */
  static formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}

module.exports = ModelManagementModel;
