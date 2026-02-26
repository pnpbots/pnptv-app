const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const agoraTokenService = require('../services/agora/agoraTokenService');

const CATEGORIES = {
  MUSIC: 'music',
  GAMING: 'gaming',
  TALK_SHOW: 'talk_show',
  EDUCATION: 'education',
  ENTERTAINMENT: 'entertainment',
  SPORTS: 'sports',
  NEWS: 'news',
  OTHER: 'other',
};

class LiveStreamModel {
  static _tableInfoCache = new Map();

  static async _getTableInfo(tableName) {
    if (this._tableInfoCache.has(tableName)) {
      return this._tableInfoCache.get(tableName);
    }

    try {
      const result = await query(
        `SELECT column_name, data_type, udt_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [tableName],
        { cache: false }
      );

      const columns = new Set();
      const types = new Map();

      result.rows.forEach((row) => {
        columns.add(row.column_name);
        types.set(row.column_name, row.udt_name || row.data_type);
      });

      const info = {
        exists: columns.size > 0,
        columns,
        types,
      };

      this._tableInfoCache.set(tableName, info);
      return info;
    } catch (error) {
      logger.error('Error loading table info', { tableName, error: error.message });
      const info = { exists: false, columns: new Set(), types: new Map() };
      this._tableInfoCache.set(tableName, info);
      return info;
    }
  }

  static async _tableExists(tableName) {
    const info = await this._getTableInfo(tableName);
    return info.exists;
  }

  static _normalizeStatus(status) {
    if (!status) return 'scheduled';
    const normalized = String(status).toLowerCase();
    if (normalized === 'live') return 'active';
    return normalized;
  }

  static _statusToDb(status) {
    if (!status) return 'scheduled';
    const normalized = String(status).toLowerCase();
    if (normalized === 'active') return 'live';
    return normalized;
  }

  static _toArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
  }

  static _resolveTelegramId(userId, telegramId) {
    if (telegramId !== undefined && telegramId !== null) return Number(telegramId);
    const numeric = Number(userId);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  static _safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  static _coalesce(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  static async _getStreamIdColumn() {
    const info = await this._getTableInfo('live_streams');
    if (info.columns.has('stream_id')) return 'stream_id';
    if (info.columns.has('id')) return 'id';
    return 'stream_id';
  }

  static async _getStreamRefForTable(stream, tableName) {
    const info = await this._getTableInfo(tableName);
    if (!info.exists) return stream.streamId;

    const type = info.types.get('stream_id');
    if (!type) return stream.streamId;

    const normalized = String(type).toLowerCase();
    if (normalized.includes('uuid') || normalized.startsWith('int')) {
      return stream.dbId || stream.streamId;
    }

    return stream.streamId;
  }

  static _mapRowToStream(row) {
    if (!row) return null;

    const streamId = row.stream_id || row.id;
    const hostId = row.host_user_id || row.host_id;
    const maxViewers = this._coalesce(row.max_viewers, row.maxViewers, row.max_viewers_count);

    const durationSeconds = this._coalesce(row.duration_seconds, row.duration);
    const durationMinutes = durationSeconds !== undefined && durationSeconds !== null
      ? Math.round(this._safeNumber(durationSeconds) / 60)
      : null;

    return {
      dbId: row.id,
      streamId: streamId ? String(streamId) : null,
      channelName: row.channel_name || row.jaas_room_name || row.room_name || row.stream_url || (streamId ? String(streamId) : null),
      hostId: hostId ? String(hostId) : null,
      hostTelegramId: row.host_telegram_id ? Number(row.host_telegram_id) : null,
      hostName: row.host_name || row.streamer_name || (hostId ? String(hostId) : 'Host'),
      title: row.title,
      description: row.description || '',
      category: row.category || (Array.isArray(row.tags) && row.tags.length > 0 ? row.tags[0] : CATEGORIES.OTHER),
      tags: row.tags || [],
      thumbnailUrl: row.thumbnail_url || null,
      streamUrl: row.stream_url || null,
      status: this._normalizeStatus(row.status),
      scheduledFor: row.scheduled_for || row.scheduled_start_time || row.scheduled_at || null,
      startedAt: row.actual_start_time || row.started_at || null,
      endedAt: row.end_time || row.ended_at || null,
      duration: durationMinutes !== null ? durationMinutes : (row.duration || row.duration_seconds || null),
      isPublic: row.is_public !== undefined && row.is_public !== null ? row.is_public : true,
      isSubscribersOnly: row.is_subscribers_only || false,
      allowedPlanTiers: row.allowed_plan_tiers || [],
      currentViewers: this._safeNumber(this._coalesce(row.current_viewers, row.viewers_count, row.viewers_count_old), 0),
      peakViewers: this._safeNumber(row.peak_viewers, 0),
      totalViews: this._safeNumber(this._coalesce(row.total_views, row.viewers_count), 0),
      totalComments: this._safeNumber(this._coalesce(row.total_comments, row.total_messages), 0),
      likes: this._safeNumber(row.likes, 0),
      isPaid: row.is_paid || false,
      price: this._safeNumber(row.price, 0),
      maxViewers: this._safeNumber(maxViewers, 0),
      allowComments: row.allow_comments !== undefined && row.allow_comments !== null ? row.allow_comments : true,
      recordStream: row.record_stream || row.recording_enabled || false,
      recordingUrl: row.recording_url || null,
      language: row.language || 'en',
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      analytics: row.analytics || null,
    };
  }

  static async create(streamData) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists) {
        throw new Error('live_streams table not found');
      }

      const streamId = streamData.streamId || uuidv4();
      const channelName = streamData.channelName || streamData.roomName || streamId;
      const status = this._statusToDb(streamData.status || (streamData.scheduledFor ? 'scheduled' : 'live'));
      const now = new Date();

      const hostId = String(streamData.hostId);
      const hostName = streamData.hostName || 'Host';
      const hostTelegramId = this._resolveTelegramId(hostId, streamData.hostTelegramId);

      const columns = info.columns;
      const fields = [];
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      const addField = (column, value) => {
        if (!columns.has(column)) return;
        if (value === undefined) return;
        fields.push(column);
        values.push(value);
        placeholders.push(`$${paramIndex++}`);
      };

      addField('stream_id', streamId);
      addField('room_name', channelName);
      addField('jaas_room_name', streamData.jaasRoomName);
      addField('channel_name', channelName);
      addField('host_user_id', hostId);
      addField('host_id', hostId);
      addField('host_telegram_id', hostTelegramId);
      addField('host_name', hostName);
      addField('title', streamData.title);
      addField('description', streamData.description || '');
      addField('thumbnail_url', streamData.thumbnailUrl || null);
      addField('status', status);

      if (status === 'live') {
        addField('actual_start_time', now);
        addField('started_at', now);
      }

      addField('scheduled_start_time', streamData.scheduledFor || null);
      addField('scheduled_for', streamData.scheduledFor || null);
      addField('scheduled_at', streamData.scheduledFor || null);

      addField('is_public', streamData.isPublic !== undefined ? streamData.isPublic : true);
      addField('is_subscribers_only', streamData.isSubscribersOnly || false);
      addField('allowed_plan_tiers', this._toArray(streamData.allowedPlanTiers));

      addField('current_viewers', 0);
      addField('total_views', 0);
      addField('peak_viewers', 0);
      addField('total_messages', 0);
      addField('total_comments', 0);
      addField('likes', 0);

      addField('recording_enabled', streamData.recordStream || false);
      addField('record_stream', streamData.recordStream || false);
      addField('recording_url', streamData.recordingUrl || null);

      addField('is_paid', streamData.isPaid || false);
      addField('price', streamData.price || 0);

      addField('tags', this._toArray(streamData.tags));
      addField('allow_comments', streamData.allowComments !== false);
      addField('language', streamData.language || 'en');
      addField('category', streamData.category);
      addField('max_viewers', streamData.maxViewers || null);
      addField('stream_url', streamData.streamUrl || null);

      if (fields.length === 0) {
        throw new Error('No columns available for live_streams insert');
      }

      const result = await query(
        `INSERT INTO live_streams (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        values
      );

      const stream = this._mapRowToStream(result.rows[0]);
      const hostToken = agoraTokenService.generateHostToken(channelName, hostId);

      return {
        ...stream,
        hostToken,
        channelName,
      };
    } catch (error) {
      logger.error('Error creating live stream', { error: error.message });
      throw error;
    }
  }

  static async updateChannelName(streamId, channelName) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists) return false;

      const updates = [];
      const values = [];
      let paramIndex = 1;

      const addUpdate = (column, value) => {
        if (!info.columns.has(column)) return;
        updates.push(`${column} = $${paramIndex++}`);
        values.push(value);
      };

      addUpdate('channel_name', channelName);
      addUpdate('jaas_room_name', channelName);
      addUpdate('room_name', channelName);

      if (updates.length === 0) return false;

      const streamIdColumn = await this._getStreamIdColumn();
      values.push(streamId);

      const whereClause = streamIdColumn === 'id'
        ? 'id::text = $' + paramIndex
        : `${streamIdColumn} = $${paramIndex}`;

      await query(
        `UPDATE live_streams SET ${updates.join(', ')}, updated_at = NOW() WHERE ${whereClause}`,
        values
      );

      return true;
    } catch (error) {
      logger.error('Error updating channel name', { error: error.message, streamId });
      return false;
    }
  }

  static async getById(streamId) {
    try {
      const streamIdColumn = await this._getStreamIdColumn();
      const whereClause = streamIdColumn === 'id'
        ? 'id::text = $1'
        : `${streamIdColumn} = $1`;

      const result = await query(
        `SELECT * FROM live_streams WHERE ${whereClause} LIMIT 1`,
        [streamId]
      );

      return this._mapRowToStream(result.rows[0]);
    } catch (error) {
      logger.error('Error getting live stream', { streamId, error: error.message });
      return null;
    }
  }

  static async getActiveStreams(limit = 20) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists) return [];

      const conditions = [];
      const values = [];
      let paramIndex = 1;

      if (info.columns.has('status')) {
        conditions.push(`status IN ($${paramIndex++}, $${paramIndex++})`);
        values.push('live', 'active');
      }

      let sql = 'SELECT * FROM live_streams';
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      const orderColumn = info.columns.has('actual_start_time')
        ? 'actual_start_time'
        : info.columns.has('started_at')
          ? 'started_at'
          : 'created_at';

      sql += ` ORDER BY ${orderColumn} DESC LIMIT $${paramIndex}`;
      values.push(limit);

      const result = await query(sql, values);
      return result.rows.map((row) => this._mapRowToStream(row));
    } catch (error) {
      logger.error('Error getting active streams', { error: error.message });
      return [];
    }
  }

  static async getByHostId(hostId, limit = 20) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists) return [];

      const hostColumns = [];
      if (info.columns.has('host_user_id')) hostColumns.push('host_user_id');
      if (info.columns.has('host_id')) hostColumns.push('host_id');

      if (hostColumns.length === 0) return [];

      const conditions = hostColumns.map((column, index) => `${column} = $${index + 1}`);
      const values = hostColumns.map(() => String(hostId));

      const orderColumn = info.columns.has('created_at') ? 'created_at' : 'updated_at';

      const result = await query(
        `SELECT * FROM live_streams WHERE ${conditions.join(' OR ')} ORDER BY ${orderColumn} DESC LIMIT $${values.length + 1}`,
        [...values, limit]
      );

      return result.rows.map((row) => this._mapRowToStream(row));
    } catch (error) {
      logger.error('Error getting host streams', { hostId, error: error.message });
      return [];
    }
  }

  static async getByCategory(category, limit = 20) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists) return [];

      const values = [];
      let paramIndex = 1;

      const conditions = [];

      if (info.columns.has('category')) {
        conditions.push(`category = $${paramIndex++}`);
        values.push(category);
      }

      if (info.columns.has('status')) {
        conditions.push(`status IN ($${paramIndex++}, $${paramIndex++})`);
        values.push('live', 'active');
      }

      let sql = 'SELECT * FROM live_streams';
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
      values.push(limit);

      const result = await query(sql, values);
      return result.rows.map((row) => this._mapRowToStream(row));
    } catch (error) {
      logger.error('Error getting streams by category', { category, error: error.message });
      return [];
    }
  }

  static async joinStream(streamId, userId, userName) {
    try {
      const stream = await this.getById(streamId);
      if (!stream) {
        throw new Error('Stream not found');
      }

      if (!['active', 'live'].includes(stream.status)) {
        throw new Error('Stream is not active');
      }

      const info = await this._getTableInfo('live_streams');
      const maxViewers = info.columns.has('max_viewers') ? this._safeNumber(stream.maxViewers || 0) : 0;
      if (maxViewers > 0 && stream.currentViewers >= maxViewers) {
        throw new Error('Stream has reached maximum viewers');
      }

      if (await this._tableExists('stream_viewers')) {
        await this._trackViewerJoin(stream, userId, userName);
      }

      const updatedStream = await this._incrementViewerCounts(streamId, 1);
      const viewerToken = agoraTokenService.generateViewerToken(stream.channelName || stream.streamId, userId);

      return {
        stream: updatedStream || stream,
        viewerToken,
      };
    } catch (error) {
      logger.error('Error joining stream', { streamId, userId, error: error.message });
      throw error;
    }
  }

  static async leaveStream(streamId, userId) {
    try {
      const stream = await this.getById(streamId);
      if (!stream) return false;

      if (await this._tableExists('stream_viewers')) {
        await this._trackViewerLeave(stream, userId);
      }

      await this._incrementViewerCounts(streamId, -1);
      return true;
    } catch (error) {
      logger.error('Error leaving stream', { streamId, userId, error: error.message });
      return false;
    }
  }

  static async _trackViewerJoin(stream, userId, userName) {
    const viewerInfo = await this._getTableInfo('stream_viewers');
    if (!viewerInfo.exists) return;

    const streamRef = await this._getStreamRefForTable(stream, 'stream_viewers');

    const columns = viewerInfo.columns;
    const fields = [];
    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    const addField = (column, value) => {
      if (!columns.has(column)) return;
      if (value === undefined) return;
      fields.push(column);
      values.push(value);
      placeholders.push(`$${paramIndex++}`);
    };

    const userIdString = String(userId);

    addField('stream_id', streamRef);
    addField('user_id', userIdString);
    addField('viewer_id', userIdString);
    addField('telegram_id', this._resolveTelegramId(userId, null));
    addField('username', userName);
    addField('display_name', userName);
    addField('viewer_name', userName);
    addField('joined_at', new Date());

    if (fields.length === 0) return;

    await query(
      `INSERT INTO stream_viewers (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    );
  }

  static async _trackViewerLeave(stream, userId) {
    const viewerInfo = await this._getTableInfo('stream_viewers');
    if (!viewerInfo.exists) return;

    const streamRef = await this._getStreamRefForTable(stream, 'stream_viewers');
    const columns = viewerInfo.columns;
    const userIdString = String(userId);

    const updates = [];
    const values = [];
    let paramIndex = 1;

    const addUpdate = (column, expression) => {
      if (!columns.has(column)) return;
      updates.push(`${column} = ${expression}`);
    };

    addUpdate('left_at', 'NOW()');
    addUpdate('updated_at', 'NOW()');

    if (columns.has('watch_duration_seconds')) {
      updates.push('watch_duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::int');
    }

    if (updates.length === 0) return;

    const userColumn = columns.has('user_id') ? 'user_id' : 'viewer_id';

    values.push(streamRef, userIdString);

    const sql = `
      UPDATE stream_viewers
      SET ${updates.join(', ')}
      WHERE stream_id = $1 AND ${userColumn} = $2 AND left_at IS NULL
    `;

    await query(sql, values);
  }

  static async _incrementViewerCounts(streamId, delta) {
    const info = await this._getTableInfo('live_streams');
    if (!info.exists) return null;

    const updates = [];
    if (info.columns.has('current_viewers')) {
      updates.push(`current_viewers = GREATEST(COALESCE(current_viewers, 0) + ${delta}, 0)`);
    }
    if (info.columns.has('viewers_count')) {
      updates.push(`viewers_count = GREATEST(COALESCE(viewers_count, 0) + ${delta}, 0)`);
    }
    if (delta > 0 && info.columns.has('total_views')) {
      updates.push('total_views = COALESCE(total_views, 0) + 1');
    }
    if (delta > 0 && info.columns.has('peak_viewers')) {
      if (info.columns.has('current_viewers')) {
        updates.push('peak_viewers = GREATEST(COALESCE(peak_viewers, 0), COALESCE(current_viewers, 0) + 1)');
      } else if (info.columns.has('viewers_count')) {
        updates.push('peak_viewers = GREATEST(COALESCE(peak_viewers, 0), COALESCE(viewers_count, 0) + 1)');
      }
    }

    if (updates.length === 0) return null;

    const streamIdColumn = await this._getStreamIdColumn();
    const whereClause = streamIdColumn === 'id'
      ? 'id::text = $1'
      : `${streamIdColumn} = $1`;

    const result = await query(
      `UPDATE live_streams SET ${updates.join(', ')}, updated_at = NOW() WHERE ${whereClause} RETURNING *`,
      [streamId]
    );

    return this._mapRowToStream(result.rows[0]);
  }

  static async addComment(streamId, userId, userName, text) {
    try {
      const stream = await this.getById(streamId);
      if (!stream) {
        throw new Error('Stream not found');
      }

      if (!stream.allowComments) {
        throw new Error('Comments are disabled');
      }

      const commentsTable = await this._getCommentsTable();
      if (!commentsTable) {
        throw new Error('Comments are disabled');
      }

      if (await this._tableExists('stream_banned_users')) {
        const bannedStreamRef = await this._getStreamRefForTable(stream, 'stream_banned_users');
        const bannedResult = await query(
          'SELECT 1 FROM stream_banned_users WHERE stream_id = $1 AND user_id = $2 LIMIT 1',
          [bannedStreamRef, String(userId)]
        );
        if (bannedResult.rows.length > 0) {
          throw new Error('User is banned from commenting on this stream');
        }
      }

      const commentId = uuidv4();
      const commentData = await this._insertComment(commentsTable, stream, commentId, userId, userName, text);
      await this._incrementCommentCount(streamId);

      return commentData;
    } catch (error) {
      logger.error('Error adding comment', { streamId, userId, error: error.message });
      throw error;
    }
  }

  static async _getCommentsTable() {
    if (await this._tableExists('stream_comments')) {
      return 'stream_comments';
    }
    if (await this._tableExists('stream_chat_messages')) {
      return 'stream_chat_messages';
    }
    return null;
  }

  static async _insertComment(tableName, stream, commentId, userId, userName, text) {
    const info = await this._getTableInfo(tableName);
    const columns = info.columns;
    const streamRef = await this._getStreamRefForTable(stream, tableName);

    const fields = [];
    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    const addField = (column, value) => {
      if (!columns.has(column)) return;
      if (value === undefined) return;
      fields.push(column);
      values.push(value);
      placeholders.push(`$${paramIndex++}`);
    };

    const userIdString = String(userId);

    if (tableName === 'stream_comments') {
      addField('id', commentId);
      addField('stream_id', streamRef);
      addField('user_id', userIdString);
      addField('user_name', userName);
      addField('text', text);
      addField('timestamp', new Date());
    } else {
      addField('message_id', commentId);
      addField('stream_id', streamRef);
      addField('user_id', userIdString);
      addField('telegram_id', this._resolveTelegramId(userId, null));
      addField('username', userName);
      addField('display_name', userName);
      addField('message_text', text);
      addField('message_type', 'text');
      addField('sent_at', new Date());
    }

    if (fields.length === 0) {
      throw new Error('Comments are disabled');
    }

    await query(
      `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    );

    return {
      commentId,
      userId: userIdString,
      userName,
      text,
      timestamp: new Date(),
      likes: 0,
    };
  }

  static async _incrementCommentCount(streamId) {
    const info = await this._getTableInfo('live_streams');
    if (!info.exists) return;

    const updates = [];
    if (info.columns.has('total_comments')) {
      updates.push('total_comments = COALESCE(total_comments, 0) + 1');
    }
    if (info.columns.has('total_messages')) {
      updates.push('total_messages = COALESCE(total_messages, 0) + 1');
    }

    if (updates.length === 0) return;

    const streamIdColumn = await this._getStreamIdColumn();
    const whereClause = streamIdColumn === 'id'
      ? 'id::text = $1'
      : `${streamIdColumn} = $1`;

    await query(
      `UPDATE live_streams SET ${updates.join(', ')}, updated_at = NOW() WHERE ${whereClause}`,
      [streamId]
    );
  }

  static async getComments(streamId, limit = 50, before = null) {
    try {
      const tableName = await this._getCommentsTable();
      if (!tableName) return [];

      const info = await this._getTableInfo(tableName);
      const stream = await this.getById(streamId);
      if (!stream) return [];

      const streamRef = await this._getStreamRefForTable(stream, tableName);
      const columns = info.columns;
      const values = [streamRef];
      let paramIndex = 2;

      const conditions = ['stream_id = $1'];

      if (columns.has('is_deleted')) {
        conditions.push('is_deleted = false');
      }

      const timeColumn = tableName === 'stream_comments' ? 'timestamp' : 'sent_at';
      if (before) {
        conditions.push(`${timeColumn} < $${paramIndex++}`);
        values.push(before);
      }

      const sql = `
        SELECT * FROM ${tableName}
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${timeColumn} DESC
        LIMIT $${paramIndex}
      `;

      values.push(limit);

      const result = await query(sql, values);
      return result.rows.map((row) => {
        if (tableName === 'stream_comments') {
          return {
            commentId: row.id,
            userId: row.user_id,
            userName: row.user_name,
            text: row.text,
            timestamp: row.timestamp,
            likes: row.likes || 0,
          };
        }
        return {
          commentId: row.message_id,
          userId: row.user_id,
          userName: row.display_name || row.username,
          text: row.message_text,
          timestamp: row.sent_at,
          likes: 0,
        };
      });
    } catch (error) {
      logger.error('Error getting comments', { streamId, error: error.message });
      return [];
    }
  }

  static async likeStream(streamId) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists || !info.columns.has('likes')) return null;

      const streamIdColumn = await this._getStreamIdColumn();
      const whereClause = streamIdColumn === 'id'
        ? 'id::text = $1'
        : `${streamIdColumn} = $1`;

      const result = await query(
        `UPDATE live_streams
         SET likes = COALESCE(likes, 0) + 1, updated_at = NOW()
         WHERE ${whereClause}
         RETURNING *`,
        [streamId]
      );

      return this._mapRowToStream(result.rows[0]);
    } catch (error) {
      logger.error('Error liking stream', { streamId, error: error.message });
      return null;
    }
  }

  static async endStream(streamId, hostId = null) {
    try {
      const stream = await this.getById(streamId);
      if (!stream) return false;

      if (hostId && stream.hostId && String(stream.hostId) !== String(hostId)) {
        throw new Error('Unauthorized');
      }

      const info = await this._getTableInfo('live_streams');
      const updates = [];
      const values = [];
      let paramIndex = 1;

      const addUpdate = (column, value) => {
        if (!info.columns.has(column)) return;
        updates.push(`${column} = $${paramIndex++}`);
        values.push(value);
      };

      const now = new Date();
      const startTime = stream.startedAt || stream.createdAt || now;
      const durationSeconds = Math.max(0, Math.round((now - new Date(startTime)) / 1000));

      addUpdate('status', this._statusToDb('ended'));
      addUpdate('end_time', now);
      addUpdate('ended_at', now);
      addUpdate('duration_seconds', durationSeconds);
      addUpdate('duration', durationSeconds);
      addUpdate('current_viewers', 0);
      addUpdate('viewers_count', 0);

      if (updates.length === 0) return false;

      const streamIdColumn = await this._getStreamIdColumn();
      values.push(streamId);

      const whereClause = streamIdColumn === 'id'
        ? 'id::text = $' + paramIndex
        : `${streamIdColumn} = $${paramIndex}`;

      await query(
        `UPDATE live_streams SET ${updates.join(', ')}, updated_at = NOW() WHERE ${whereClause}`,
        values
      );

      return true;
    } catch (error) {
      logger.error('Error ending stream', { streamId, error: error.message });
      throw error;
    }
  }

  static async startStream(streamId, hostId = null) {
    try {
      const stream = await this.getById(streamId);
      if (!stream) return false;

      if (hostId && stream.hostId && String(stream.hostId) !== String(hostId)) {
        throw new Error('Unauthorized');
      }

      const info = await this._getTableInfo('live_streams');
      const updates = [];
      const values = [];
      let paramIndex = 1;

      const addUpdate = (column, value) => {
        if (!info.columns.has(column)) return;
        updates.push(`${column} = $${paramIndex++}`);
        values.push(value);
      };

      const now = new Date();
      addUpdate('status', this._statusToDb('live'));
      addUpdate('actual_start_time', now);
      addUpdate('started_at', now);

      if (updates.length === 0) return false;

      const streamIdColumn = await this._getStreamIdColumn();
      values.push(streamId);

      const whereClause = streamIdColumn === 'id'
        ? 'id::text = $' + paramIndex
        : `${streamIdColumn} = $${paramIndex}`;

      await query(
        `UPDATE live_streams SET ${updates.join(', ')}, updated_at = NOW() WHERE ${whereClause}`,
        values
      );

      return true;
    } catch (error) {
      logger.error('Error starting stream', { streamId, error: error.message });
      throw error;
    }
  }

  static async getVODs(filters = {}, limit = 20) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists) return [];

      const conditions = [];
      const values = [];
      let paramIndex = 1;

      if (info.columns.has('status')) {
        conditions.push(`status = $${paramIndex++}`);
        values.push('ended');
      }

      if (info.columns.has('recording_url')) {
        conditions.push('recording_url IS NOT NULL');
      }

      if (filters.hostId) {
        if (info.columns.has('host_user_id')) {
          conditions.push(`host_user_id = $${paramIndex++}`);
          values.push(String(filters.hostId));
        } else if (info.columns.has('host_id')) {
          conditions.push(`host_id = $${paramIndex++}`);
          values.push(String(filters.hostId));
        }
      }

      let sql = 'SELECT * FROM live_streams';
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      const orderColumn = info.columns.has('end_time')
        ? 'end_time'
        : info.columns.has('ended_at')
          ? 'ended_at'
          : 'created_at';

      sql += ` ORDER BY ${orderColumn} DESC LIMIT $${paramIndex}`;
      values.push(limit);

      const result = await query(sql, values);
      return result.rows.map((row) => this._mapRowToStream(row));
    } catch (error) {
      logger.error('Error getting VODs', { error: error.message });
      return [];
    }
  }

  static generateShareLink(streamId, botUsername) {
    const base = botUsername ? `https://t.me/${botUsername}` : 'https://t.me';
    return `${base}?start=live_${streamId}`;
  }

  static async incrementShareCount(streamId) {
    try {
      const info = await this._getTableInfo('live_streams');
      if (!info.exists || !info.columns.has('analytics')) return false;

      const streamIdColumn = await this._getStreamIdColumn();
      const whereClause = streamIdColumn === 'id'
        ? 'id::text = $1'
        : `${streamIdColumn} = $1`;

      await query(
        `UPDATE live_streams
         SET analytics = jsonb_set(
           COALESCE(analytics, '{}'::jsonb),
           '{share_count}',
           to_jsonb(COALESCE((analytics->>'share_count')::int, 0) + 1),
           true
         ),
         updated_at = NOW()
         WHERE ${whereClause}`,
        [streamId]
      );

      return true;
    } catch (error) {
      logger.error('Error incrementing share count', { streamId, error: error.message });
      return false;
    }
  }

  static async subscribeToStreamer(userId, streamerId) {
    try {
      if (!await this._tableExists('stream_notifications')) return false;

      await query(
        `INSERT INTO stream_notifications (user_id, streamer_id, notifications_enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (user_id, streamer_id)
         DO UPDATE SET notifications_enabled = true, subscribed_at = NOW()`,
        [String(userId), String(streamerId)]
      );

      return true;
    } catch (error) {
      logger.error('Error subscribing to streamer', { userId, streamerId, error: error.message });
      return false;
    }
  }

  static async unsubscribeFromStreamer(userId, streamerId) {
    try {
      if (!await this._tableExists('stream_notifications')) return false;

      await query(
        `UPDATE stream_notifications
         SET notifications_enabled = false
         WHERE user_id = $1 AND streamer_id = $2`,
        [String(userId), String(streamerId)]
      );

      return true;
    } catch (error) {
      logger.error('Error unsubscribing from streamer', { userId, streamerId, error: error.message });
      return false;
    }
  }

  static async isSubscribedToStreamer(userId, streamerId) {
    try {
      if (!await this._tableExists('stream_notifications')) return false;

      const result = await query(
        `SELECT 1 FROM stream_notifications
         WHERE user_id = $1 AND streamer_id = $2 AND notifications_enabled = true
         LIMIT 1`,
        [String(userId), String(streamerId)]
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking streamer subscription', { userId, streamerId, error: error.message });
      return false;
    }
  }

  static async notifyFollowers(streamerId, streamData, sendFn) {
    try {
      if (!await this._tableExists('stream_notifications')) return;

      const result = await query(
        `SELECT user_id FROM stream_notifications
         WHERE streamer_id = $1 AND notifications_enabled = true`,
        [String(streamerId)]
      );

      if (!result.rows.length) return;

      const message = `🔴 ${streamData.hostName} is live!\n🎤 ${streamData.title}`;

      for (const row of result.rows) {
        await sendFn(row.user_id, message, streamData.streamId);
      }
    } catch (error) {
      logger.error('Error notifying followers', { streamerId, error: error.message });
    }
  }

  static getCategoryEmoji(category) {
    switch (category) {
      case CATEGORIES.MUSIC:
        return '🎵';
      case CATEGORIES.GAMING:
        return '🎮';
      case CATEGORIES.TALK_SHOW:
        return '🎙';
      case CATEGORIES.EDUCATION:
        return '📚';
      case CATEGORIES.ENTERTAINMENT:
        return '🎭';
      case CATEGORIES.SPORTS:
        return '⚽';
      case CATEGORIES.NEWS:
        return '📰';
      default:
        return '📺';
    }
  }
}

module.exports = LiveStreamModel;
module.exports.CATEGORIES = CATEGORIES;
