const { Markup } = require('telegraf');
const logger = require('../../utils/logger');
const { getPool } = require('../../config/postgres');
const { cache } = require('../../config/redis');
const MediaPlayerModel = require('../../models/mediaPlayerModel');

/**
 * RadioAdminService - Admin controls for PNP Radio
 * Manages now playing, queue, schedule, and requests
 */
class RadioAdminService {
  constructor(bot) {
    this.bot = bot;
    this.radioSessions = new Map();
    this.adminChannelId = process.env.VIDEORAMA_ADMIN_UPLOAD_CHANNEL_ID;
  }

  /**
   * Show radio admin menu
   */
  async showRadioAdminMenu(ctx) {
    const userId = ctx.from.id;

    try {
      // Get current now playing
      const nowPlaying = await this.getNowPlaying();
      const queueCount = await this.getQueueCount();
      const pendingRequests = await this.getPendingRequestsCount();

      const statusText = nowPlaying
        ? `🎵 *Now Playing:* ${nowPlaying.title}\n   by ${nowPlaying.artist || 'Unknown'}`
        : '🔇 *Radio is idle*';

      await ctx.reply(
        `📻 *PNP Radio Admin*\n\n` +
        `${statusText}\n\n` +
        `📋 Queue: ${queueCount} tracks\n` +
        `📩 Pending Requests: ${pendingRequests}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🎵 Set Now Playing', 'radio_admin:set_now_playing')],
            [Markup.button.callback('📋 Manage Queue', 'radio_admin:manage_queue')],
            [Markup.button.callback('📩 View Requests', 'radio_admin:view_requests')],
            [Markup.button.callback('📅 Schedule', 'radio_admin:schedule')],
            [Markup.button.callback('📊 History', 'radio_admin:history')],
            [Markup.button.callback('❌ Close', 'radio_admin:close')],
          ])
        }
      );
    } catch (error) {
      logger.error('Error showing radio admin menu:', error);
      await ctx.reply('Failed to load radio admin menu.');
    }
  }

  /**
   * Handle callback queries
   */
  async handleCallbackQuery(ctx) {
    const userId = ctx.from.id;
    const callbackData = ctx.callbackQuery?.data || '';

    if (!callbackData.startsWith('radio_admin:') && !callbackData.startsWith('radio_action:')) {
      return false;
    }

    try {
      await ctx.answerCbQuery();
      const [prefix, action, ...params] = callbackData.split(':');

      switch (action) {
        case 'set_now_playing':
          return this.showSetNowPlaying(ctx);
        case 'manage_queue':
          return this.showQueue(ctx);
        case 'view_requests':
          return this.showRequests(ctx);
        case 'schedule':
          return this.showSchedule(ctx);
        case 'history':
          return this.showHistory(ctx);
        case 'close':
          await ctx.deleteMessage().catch(() => {});
          return true;
        case 'select_track':
          return this.handleTrackSelection(ctx, params[0]);
        case 'approve_request':
          return this.handleApproveRequest(ctx, params[0]);
        case 'reject_request':
          return this.handleRejectRequest(ctx, params[0]);
        case 'add_to_queue':
          return this.handleAddToQueue(ctx, params[0]);
        case 'remove_from_queue':
          return this.handleRemoveFromQueue(ctx, params[0]);
        case 'play_next':
          return this.playNextInQueue(ctx);
        case 'stop_radio':
          return this.stopRadio(ctx);
        case 'back':
          return this.showRadioAdminMenu(ctx);
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error in radio callback:', error);
      await ctx.reply('An error occurred.');
      return true;
    }
  }

  /**
   * Handle message inputs during radio admin sessions
   */
  async handleMessage(ctx) {
    const userId = ctx.from.id;
    const session = this.radioSessions.get(userId);

    if (!session) return false;

    const text = ctx.message?.text;
    if (!text) return false;

    try {
      switch (session.step) {
        case 'waiting_now_playing_title':
          return this.handleNowPlayingTitle(ctx, session, text);
        case 'waiting_now_playing_artist':
          return this.handleNowPlayingArtist(ctx, session, text);
        case 'waiting_schedule_program':
          return this.handleScheduleProgram(ctx, session, text);
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error handling radio message:', error);
      return true;
    }
  }

  /**
   * Show set now playing options
   */
  async showSetNowPlaying(ctx) {
    const userId = ctx.from.id;

    // Get recent media from library
    const media = await MediaPlayerModel.getMediaLibrary('audio', 10);

    const rows = media.slice(0, 6).map(item => [
      Markup.button.callback(
        `🎵 ${item.title.substring(0, 25)}`,
        `radio_action:select_track:${item.id}`
      )
    ]);

    rows.push([Markup.button.callback('✏️ Enter Manually', 'radio_action:manual_now_playing')]);
    rows.push([Markup.button.callback('⬅️ Back', 'radio_admin:back')]);

    await ctx.editMessageText(
      '*Set Now Playing*\n\nSelect from library or enter manually:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(rows)
      }
    );

    return true;
  }

  /**
   * Handle track selection for now playing
   */
  async handleTrackSelection(ctx, mediaId) {
    try {
      const media = await MediaPlayerModel.getMediaById(mediaId);

      if (!media) {
        await ctx.answerCbQuery('Track not found');
        return true;
      }

      await this.setNowPlaying({
        title: media.title,
        artist: media.artist,
        duration: media.duration ? this.formatDuration(media.duration) : null,
        coverUrl: media.cover_url,
      });

      await ctx.editMessageText(
        `✅ *Now Playing Updated!*\n\n` +
        `🎵 ${media.title}\n` +
        `👤 ${media.artist || 'Unknown'}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back to Menu', 'radio_admin:back')]
          ])
        }
      );
    } catch (error) {
      logger.error('Error selecting track:', error);
      await ctx.reply('Failed to update now playing.');
    }

    return true;
  }

  /**
   * Show queue management
   */
  async showQueue(ctx) {
    try {
      const queue = await this.getQueue();

      if (queue.length === 0) {
        await ctx.editMessageText(
          '*Radio Queue*\n\n_Queue is empty_',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('➕ Add from Library', 'radio_admin:set_now_playing')],
              [Markup.button.callback('⬅️ Back', 'radio_admin:back')],
            ])
          }
        );
        return true;
      }

      const queueList = queue.slice(0, 8).map((item, i) =>
        `${i + 1}. ${item.title} - ${item.artist || 'Unknown'}`
      ).join('\n');

      const rows = [
        [Markup.button.callback('▶️ Play Next', 'radio_action:play_next')],
        [Markup.button.callback('➕ Add Track', 'radio_admin:set_now_playing')],
        [Markup.button.callback('🗑️ Clear Queue', 'radio_action:clear_queue')],
        [Markup.button.callback('⬅️ Back', 'radio_admin:back')],
      ];

      await ctx.editMessageText(
        `*Radio Queue* (${queue.length} tracks)\n\n${queueList}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(rows)
        }
      );
    } catch (error) {
      logger.error('Error showing queue:', error);
      await ctx.reply('Failed to load queue.');
    }

    return true;
  }

  /**
   * Show pending requests
   */
  async showRequests(ctx) {
    try {
      const requests = await this.getPendingRequests();

      if (requests.length === 0) {
        await ctx.editMessageText(
          '*Song Requests*\n\n_No pending requests_',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Back', 'radio_admin:back')]
            ])
          }
        );
        return true;
      }

      const requestsList = requests.slice(0, 5).map((req, i) =>
        `${i + 1}. "${req.song_name}" by User ${req.user_id.substring(0, 8)}`
      ).join('\n');

      const rows = requests.slice(0, 3).flatMap(req => [
        [
          Markup.button.callback(`✅ ${req.song_name.substring(0, 15)}`, `radio_action:approve_request:${req.id}`),
          Markup.button.callback('❌', `radio_action:reject_request:${req.id}`),
        ]
      ]);

      rows.push([Markup.button.callback('⬅️ Back', 'radio_admin:back')]);

      await ctx.editMessageText(
        `*Song Requests* (${requests.length} pending)\n\n${requestsList}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(rows)
        }
      );
    } catch (error) {
      logger.error('Error showing requests:', error);
      await ctx.reply('Failed to load requests.');
    }

    return true;
  }

  /**
   * Show schedule
   */
  async showSchedule(ctx) {
    try {
      const schedule = await this.getSchedule();

      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const today = new Date().getDay();

      let scheduleText = '*Radio Schedule*\n\n';

      if (schedule.length === 0) {
        scheduleText += '_No programs scheduled_';
      } else {
        const groupedByDay = {};
        schedule.forEach(item => {
          if (!groupedByDay[item.day_of_week]) {
            groupedByDay[item.day_of_week] = [];
          }
          groupedByDay[item.day_of_week].push(item);
        });

        for (let day = 0; day <= 6; day++) {
          const dayPrograms = groupedByDay[day] || [];
          const isToday = day === today;
          const dayName = isToday ? `📍 ${days[day]} (Today)` : days[day];

          if (dayPrograms.length > 0) {
            scheduleText += `\n*${dayName}*\n`;
            dayPrograms.forEach(prog => {
              scheduleText += `  ${prog.time_slot}: ${prog.program_name}\n`;
            });
          }
        }
      }

      await ctx.editMessageText(
        scheduleText,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Program', 'radio_action:add_schedule')],
            [Markup.button.callback('⬅️ Back', 'radio_admin:back')],
          ])
        }
      );
    } catch (error) {
      logger.error('Error showing schedule:', error);
      await ctx.reply('Failed to load schedule.');
    }

    return true;
  }

  /**
   * Show history
   */
  async showHistory(ctx) {
    try {
      const history = await this.getHistory(10);

      if (history.length === 0) {
        await ctx.editMessageText(
          '*Radio History*\n\n_No history yet_',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Back', 'radio_admin:back')]
            ])
          }
        );
        return true;
      }

      const historyList = history.map((item, i) => {
        const playedAt = new Date(item.played_at).toLocaleString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        return `${i + 1}. ${item.title} (${playedAt})`;
      }).join('\n');

      await ctx.editMessageText(
        `*Radio History* (Last ${history.length} tracks)\n\n${historyList}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', 'radio_admin:back')]
          ])
        }
      );
    } catch (error) {
      logger.error('Error showing history:', error);
      await ctx.reply('Failed to load history.');
    }

    return true;
  }

  /**
   * Handle approve request
   */
  async handleApproveRequest(ctx, requestId) {
    try {
      await getPool().query(
        `UPDATE radio_requests SET status = 'approved', updated_at = NOW() WHERE id = $1`,
        [requestId]
      );
      await ctx.answerCbQuery('Request approved!');
      await this.showRequests(ctx);
    } catch (error) {
      logger.error('Error approving request:', error);
    }
    return true;
  }

  /**
   * Handle reject request
   */
  async handleRejectRequest(ctx, requestId) {
    try {
      await getPool().query(
        `UPDATE radio_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
        [requestId]
      );
      await ctx.answerCbQuery('Request rejected');
      await this.showRequests(ctx);
    } catch (error) {
      logger.error('Error rejecting request:', error);
    }
    return true;
  }

  /**
   * Play next track in queue
   */
  async playNextInQueue(ctx) {
    try {
      const queue = await this.getQueue();

      if (queue.length === 0) {
        await ctx.answerCbQuery('Queue is empty');
        return true;
      }

      const nextTrack = queue[0];

      // Add current to history first
      const currentNowPlaying = await this.getNowPlaying();
      if (currentNowPlaying && currentNowPlaying.title !== 'PNPtv Radio') {
        await this.addToHistory(currentNowPlaying);
      }

      // Set next as now playing
      await this.setNowPlaying({
        title: nextTrack.title,
        artist: nextTrack.artist,
        duration: nextTrack.duration,
        coverUrl: nextTrack.cover_url,
      });

      // Remove from queue
      await this.removeFromQueue(nextTrack.id);

      await ctx.answerCbQuery(`Now playing: ${nextTrack.title}`);
      await this.showQueue(ctx);
    } catch (error) {
      logger.error('Error playing next:', error);
    }
    return true;
  }

  /**
   * Stop radio
   */
  async stopRadio(ctx) {
    try {
      await this.setNowPlaying({
        title: 'PNPtv Radio',
        artist: 'Off Air',
        duration: '0:00',
        coverUrl: null,
      });
      await ctx.answerCbQuery('Radio stopped');
      await this.showRadioAdminMenu(ctx);
    } catch (error) {
      logger.error('Error stopping radio:', error);
    }
    return true;
  }

  // ==========================================
  // DATABASE OPERATIONS
  // ==========================================

  /**
   * Get current now playing
   */
  async getNowPlaying() {
    try {
      const cacheKey = 'radio:now_playing';
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await getPool().query(
        'SELECT * FROM radio_now_playing WHERE id = 1'
      );

      const nowPlaying = result.rows[0] || null;
      if (nowPlaying) {
        await cache.setex(cacheKey, 30, JSON.stringify(nowPlaying));
      }
      return nowPlaying;
    } catch (error) {
      logger.error('Error getting now playing:', error);
      return null;
    }
  }

  /**
   * Set now playing
   */
  async setNowPlaying({ title, artist, duration, coverUrl }) {
    try {
      await getPool().query(
        `INSERT INTO radio_now_playing (id, title, artist, duration, cover_url, started_at)
         VALUES (1, $1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = $1, artist = $2, duration = $3, cover_url = $4, started_at = NOW(), updated_at = NOW()`,
        [title, artist || 'Unknown', duration || '0:00', coverUrl]
      );

      await cache.del('radio:now_playing');
      logger.info('Radio now playing updated:', { title, artist });
      return true;
    } catch (error) {
      logger.error('Error setting now playing:', error);
      return false;
    }
  }

  /**
   * Get queue
   */
  async getQueue() {
    try {
      const result = await getPool().query(
        `SELECT * FROM radio_queue ORDER BY position ASC`
      );
      return result.rows;
    } catch (error) {
      // Table might not exist
      logger.warn('Radio queue table might not exist:', error.message);
      return [];
    }
  }

  /**
   * Get queue count
   */
  async getQueueCount() {
    try {
      const result = await getPool().query('SELECT COUNT(*) FROM radio_queue');
      return parseInt(result.rows[0].count) || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Add to queue
   */
  async addToQueue(mediaId) {
    try {
      const media = await MediaPlayerModel.getMediaById(mediaId);
      if (!media) return false;

      const posResult = await getPool().query(
        'SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM radio_queue'
      );

      await getPool().query(
        `INSERT INTO radio_queue (media_id, title, artist, duration, cover_url, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [mediaId, media.title, media.artist, media.duration, media.cover_url, posResult.rows[0].next_pos]
      );
      return true;
    } catch (error) {
      logger.error('Error adding to queue:', error);
      return false;
    }
  }

  /**
   * Remove from queue
   */
  async removeFromQueue(queueId) {
    try {
      await getPool().query('DELETE FROM radio_queue WHERE id = $1', [queueId]);
      return true;
    } catch (error) {
      logger.error('Error removing from queue:', error);
      return false;
    }
  }

  /**
   * Get pending requests
   */
  async getPendingRequests() {
    try {
      const result = await getPool().query(
        `SELECT * FROM radio_requests WHERE status = 'pending' ORDER BY requested_at ASC`
      );
      return result.rows;
    } catch (error) {
      logger.error('Error getting pending requests:', error);
      return [];
    }
  }

  /**
   * Get pending requests count
   */
  async getPendingRequestsCount() {
    try {
      const result = await getPool().query(
        `SELECT COUNT(*) FROM radio_requests WHERE status = 'pending'`
      );
      return parseInt(result.rows[0].count) || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get schedule
   */
  async getSchedule() {
    try {
      const result = await getPool().query(
        'SELECT * FROM radio_schedule ORDER BY day_of_week, time_slot'
      );
      return result.rows;
    } catch (error) {
      logger.error('Error getting schedule:', error);
      return [];
    }
  }

  /**
   * Add to history
   */
  async addToHistory({ title, artist, duration, coverUrl }) {
    try {
      await getPool().query(
        `INSERT INTO radio_history (title, artist, duration, cover_url)
         VALUES ($1, $2, $3, $4)`,
        [title, artist, duration, coverUrl]
      );
      return true;
    } catch (error) {
      logger.error('Error adding to history:', error);
      return false;
    }
  }

  /**
   * Get history
   */
  async getHistory(limit = 20) {
    try {
      const result = await getPool().query(
        'SELECT * FROM radio_history ORDER BY played_at DESC LIMIT $1',
        [limit]
      );
      return result.rows;
    } catch (error) {
      logger.error('Error getting history:', error);
      return [];
    }
  }

  /**
   * Format duration in seconds to MM:SS
   */
  formatDuration(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

module.exports = RadioAdminService;
