const { getPool } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * MediaPlayer Model - Handles music and video playback, playlists
 * Uses PostgreSQL for data storage
 */
class MediaPlayerModel {
  /**
   * Create media item (audio or video)
   * @param {Object} mediaData - Media data { title, artist, url, type, duration, coverUrl, category }
   * @returns {Promise<Object|null>} Created media item
   */
  static async createMedia(mediaData) {
    const query = `
      INSERT INTO media_library (
        title, artist, url, type, duration, category, cover_url,
        description, uploader_id, uploader_name, language, is_public, is_explicit, tags, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [
        mediaData.title,
        mediaData.artist || null,
        mediaData.url,
        mediaData.type || 'audio',
        mediaData.duration || 0,
        mediaData.category || 'general',
        mediaData.coverUrl || mediaData.cover_url || null,
        mediaData.description || null,
        mediaData.uploaderId || mediaData.uploader_id || null,
        mediaData.uploaderName || mediaData.uploader_name || null,
        mediaData.language || 'es',
        mediaData.isPublic !== false,
        mediaData.isExplicit || false,
        mediaData.tags || null,
        mediaData.metadata ? JSON.stringify(mediaData.metadata) : null,
      ]);

      // Invalidate cache
      await cache.del('media:library');
      await cache.del(`media:category:${mediaData.category || 'general'}`);

      logger.info('Media created', { mediaId: result.rows[0].id, title: mediaData.title });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating media:', error);
      return null;
    }
  }

  /**
   * Get all media items
   * @param {string} type - Filter by type ('all', 'audio', 'video')
   * @param {number} limit - Number of items to return
   * @returns {Promise<Array>} Media items
   */
  static async getMediaLibrary(type = 'all', limit = 50) {
    try {
      const cacheKey = `media:library:${type}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          let query = `
            SELECT * FROM media_library
            WHERE is_public = true
          `;
          const params = [];

          if (type !== 'all') {
            params.push(type);
            query += ` AND type = $${params.length}`;
          }

          params.push(limit);
          query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

          const result = await getPool().query(query, params);
          logger.info(`Retrieved ${result.rows.length} media items (type: ${type})`);
          return result.rows;
        },
        300, // Cache for 5 minutes
      );
    } catch (error) {
      logger.error('Error getting media library:', error);
      return [];
    }
  }

  /**
   * Get media by category
   * @param {string} category - Category name
   * @param {number} limit - Number of items to return
   * @returns {Promise<Array>} Media items
   */
  static async getMediaByCategory(category, limit = 20) {
    try {
      const cacheKey = `media:category:${category}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const query = `
            SELECT * FROM media_library
            WHERE category = $1 AND is_public = true
            ORDER BY created_at DESC
            LIMIT $2
          `;
          const result = await getPool().query(query, [category, limit]);
          logger.info(`Retrieved ${result.rows.length} media items for category: ${category}`);
          return result.rows;
        },
        300, // Cache for 5 minutes
      );
    } catch (error) {
      logger.error('Error getting media by category:', error);
      return [];
    }
  }

  /**
   * Get media item by ID
   * @param {string} mediaId - Media ID
   * @returns {Promise<Object|null>} Media item
   */
  static async getMediaById(mediaId) {
    try {
      const query = `SELECT * FROM media_library WHERE id = $1`;
      const result = await getPool().query(query, [mediaId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting media by ID:', error);
      return null;
    }
  }

  /**
   * Create playlist
   * @param {string} userId - User ID
   * @param {Object} playlistData - Playlist data { name, description, isPublic }
   * @returns {Promise<Object|null>} Created playlist
   */
  static async createPlaylist(userId, playlistData) {
    const query = `
      INSERT INTO media_playlists (name, owner_id, description, cover_url, is_public, is_collaborative)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [
        playlistData.name,
        userId.toString(),
        playlistData.description || null,
        playlistData.coverUrl || playlistData.cover_url || null,
        playlistData.isPublic || false,
        playlistData.isCollaborative || false,
      ]);

      // Invalidate cache
      await cache.del(`playlists:user:${userId}`);

      logger.info('Playlist created', { playlistId: result.rows[0].id, name: playlistData.name });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating playlist:', error);
      return null;
    }
  }

  /**
   * Add media to playlist
   * @param {string} playlistId - Playlist ID
   * @param {string} mediaId - Media ID
   * @param {string} addedBy - User ID who added it
   * @returns {Promise<boolean>} Success status
   */
  static async addToPlaylist(playlistId, mediaId, addedBy = null) {
    try {
      // Get the next position
      const posQuery = `SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM playlist_items WHERE playlist_id = $1`;
      const posResult = await getPool().query(posQuery, [playlistId]);
      const nextPos = posResult.rows[0].next_pos;

      const query = `
        INSERT INTO playlist_items (playlist_id, media_id, position, added_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (playlist_id, media_id) DO NOTHING
        RETURNING *
      `;

      await getPool().query(query, [playlistId, mediaId, nextPos, addedBy]);

      // Invalidate related caches
      await cache.del(`playlist:${playlistId}`);

      logger.info('Media added to playlist', { playlistId, mediaId });
      return true;
    } catch (error) {
      logger.error('Error adding to playlist:', error);
      return false;
    }
  }

  /**
   * Remove media from playlist
   * @param {string} playlistId - Playlist ID
   * @param {string} mediaId - Media ID
   * @returns {Promise<boolean>} Success status
   */
  static async removeFromPlaylist(playlistId, mediaId) {
    try {
      const query = `DELETE FROM playlist_items WHERE playlist_id = $1 AND media_id = $2`;
      await getPool().query(query, [playlistId, mediaId]);

      // Invalidate cache
      await cache.del(`playlist:${playlistId}`);

      logger.info('Media removed from playlist', { playlistId, mediaId });
      return true;
    } catch (error) {
      logger.error('Error removing from playlist:', error);
      return false;
    }
  }

  /**
   * Get user playlists
   * @param {string} userId - User ID
   * @returns {Promise<Array>} User playlists
   */
  static async getUserPlaylists(userId) {
    try {
      const cacheKey = `playlists:user:${userId}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const query = `
            SELECT p.*,
                   COUNT(pi.id) as track_count
            FROM media_playlists p
            LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
            WHERE p.owner_id = $1
            GROUP BY p.id
            ORDER BY p.created_at DESC
          `;
          const result = await getPool().query(query, [userId.toString()]);
          logger.info(`Retrieved ${result.rows.length} playlists for user ${userId}`);
          return result.rows;
        },
        180, // Cache for 3 minutes
      );
    } catch (error) {
      logger.error('Error getting user playlists:', error);
      return [];
    }
  }

  /**
   * Get public playlists
   * @param {number} limit - Number of playlists to return
   * @returns {Promise<Array>} Public playlists
   */
  static async getPublicPlaylists(limit = 20) {
    try {
      const cacheKey = 'playlists:public';

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const query = `
            SELECT p.*,
                   COUNT(pi.id) as track_count
            FROM media_playlists p
            LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
            WHERE p.is_public = true
            GROUP BY p.id
            ORDER BY p.total_likes DESC, p.created_at DESC
            LIMIT $1
          `;
          const result = await getPool().query(query, [limit]);
          logger.info(`Retrieved ${result.rows.length} public playlists`);
          return result.rows;
        },
        300, // Cache for 5 minutes
      );
    } catch (error) {
      logger.error('Error getting public playlists:', error);
      return [];
    }
  }

  /**
   * Get playlist by ID with tracks
   * @param {string} playlistId - Playlist ID
   * @returns {Promise<Object|null>} Playlist with tracks
   */
  static async getPlaylistById(playlistId) {
    try {
      const playlistQuery = `SELECT * FROM media_playlists WHERE id = $1`;
      const playlistResult = await getPool().query(playlistQuery, [playlistId]);

      if (playlistResult.rows.length === 0) {
        return null;
      }

      const tracksQuery = `
        SELECT m.*, pi.position, pi.added_at
        FROM playlist_items pi
        JOIN media_library m ON pi.media_id = m.id
        WHERE pi.playlist_id = $1
        ORDER BY pi.position ASC
      `;
      const tracksResult = await getPool().query(tracksQuery, [playlistId]);

      return {
        ...playlistResult.rows[0],
        tracks: tracksResult.rows,
        mediaItems: tracksResult.rows.map(t => t.id), // For backward compatibility
      };
    } catch (error) {
      logger.error('Error getting playlist by ID:', error);
      return null;
    }
  }

  /**
   * Get player state for user
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Player state
   */
  static async getPlayerState(userId) {
    try {
      const cacheKey = `player:state:${userId}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const query = `
            SELECT ps.*,
                   m.title as media_title, m.artist as media_artist, m.url as media_url,
                   m.type as media_type, m.cover_url as media_cover,
                   p.name as playlist_name
            FROM player_states ps
            LEFT JOIN media_library m ON ps.media_id = m.id
            LEFT JOIN media_playlists p ON ps.playlist_id = p.id
            WHERE ps.user_id = $1
          `;
          const result = await getPool().query(query, [userId.toString()]);

          if (result.rows.length === 0) {
            // Return default state
            return {
              currentMedia: null,
              currentPlaylist: null,
              isPlaying: false,
              volume: 100,
              repeat: false,
              shuffle: false,
              queue: [],
              position: 0,
            };
          }

          const row = result.rows[0];
          return {
            id: row.id,
            userId: row.user_id,
            currentMedia: row.media_id ? {
              id: row.media_id,
              title: row.media_title,
              artist: row.media_artist,
              url: row.media_url,
              type: row.media_type,
              coverUrl: row.media_cover,
            } : null,
            currentPlaylist: row.playlist_id ? {
              id: row.playlist_id,
              name: row.playlist_name,
            } : null,
            isPlaying: row.is_playing || false,
            position: row.current_position || 0,
            volume: 100,
            repeat: false,
            shuffle: false,
            queue: [],
            updatedAt: row.updated_at,
          };
        },
        30, // Cache for 30 seconds
      );
    } catch (error) {
      logger.error('Error getting player state:', error);
      return null;
    }
  }

  /**
   * Update player state
   * @param {string} userId - User ID
   * @param {Object} updates - State updates
   * @returns {Promise<boolean>} Success status
   */
  static async updatePlayerState(userId, updates) {
    try {
      const query = `
        INSERT INTO player_states (user_id, media_id, playlist_id, current_position, is_playing, last_played_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id)
        DO UPDATE SET
          media_id = COALESCE($2, player_states.media_id),
          playlist_id = COALESCE($3, player_states.playlist_id),
          current_position = COALESCE($4, player_states.current_position),
          is_playing = COALESCE($5, player_states.is_playing),
          last_played_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      await getPool().query(query, [
        userId.toString(),
        updates.mediaId || updates.currentMedia?.id || null,
        updates.playlistId || updates.currentPlaylist?.id || null,
        updates.position || updates.current_position || 0,
        updates.isPlaying || false,
      ]);

      // Invalidate cache
      await cache.del(`player:state:${userId}`);

      logger.info('Player state updated', { userId });
      return true;
    } catch (error) {
      logger.error('Error updating player state:', error);
      return false;
    }
  }

  /**
   * Increment media play count
   * @param {string} mediaId - Media ID
   * @param {string} userId - User ID (optional, for history tracking)
   * @returns {Promise<boolean>} Success status
   */
  static async incrementPlayCount(mediaId, userId = null) {
    try {
      // Update plays count
      const updateQuery = `UPDATE media_library SET plays = plays + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`;
      await getPool().query(updateQuery, [mediaId]);

      // Record play history if userId provided
      if (userId) {
        const historyQuery = `
          INSERT INTO media_play_history (user_id, media_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `;
        await getPool().query(historyQuery, [userId.toString(), mediaId]).catch(() => {});
      }

      // Invalidate cache
      await cache.del('media:library');
      await cache.del('media:trending:all');

      logger.info('Play count incremented', { mediaId });
      return true;
    } catch (error) {
      logger.error('Error incrementing play count:', error);
      return false;
    }
  }

  /**
   * Like/Unlike media
   * @param {string} mediaId - Media ID
   * @param {string} userId - User ID
   * @param {boolean} isLike - True to like, false to unlike
   * @returns {Promise<boolean>} Success status
   */
  static async toggleLike(mediaId, userId, isLike = true) {
    try {
      if (isLike) {
        // Add to favorites
        const insertQuery = `
          INSERT INTO media_favorites (user_id, media_id)
          VALUES ($1, $2)
          ON CONFLICT (user_id, media_id) DO NOTHING
        `;
        await getPool().query(insertQuery, [userId.toString(), mediaId]);

        // Increment likes
        await getPool().query(
          `UPDATE media_library SET likes = likes + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [mediaId]
        );
      } else {
        // Remove from favorites
        await getPool().query(
          `DELETE FROM media_favorites WHERE user_id = $1 AND media_id = $2`,
          [userId.toString(), mediaId]
        );

        // Decrement likes
        await getPool().query(
          `UPDATE media_library SET likes = GREATEST(0, likes - 1), updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [mediaId]
        );
      }

      logger.info(`Media ${isLike ? 'liked' : 'unliked'}`, { mediaId, userId });
      return true;
    } catch (error) {
      logger.error('Error toggling like:', error);
      return false;
    }
  }

  /**
   * Check if user has liked a media
   * @param {string} mediaId - Media ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if liked
   */
  static async hasUserLiked(mediaId, userId) {
    try {
      const query = `SELECT 1 FROM media_favorites WHERE user_id = $1 AND media_id = $2`;
      const result = await getPool().query(query, [userId.toString(), mediaId]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error checking if user liked:', error);
      return false;
    }
  }

  /**
   * Search media
   * @param {string} searchQuery - Search query
   * @param {string} type - Media type filter
   * @param {number} limit - Number of results
   * @returns {Promise<Array>} Matching media
   */
  static async searchMedia(searchQuery, type = 'all', limit = 20) {
    try {
      let query = `
        SELECT * FROM media_library
        WHERE is_public = true
          AND (
            title ILIKE $1
            OR artist ILIKE $1
            OR description ILIKE $1
          )
      `;
      const params = [`%${searchQuery}%`];

      if (type !== 'all') {
        params.push(type);
        query += ` AND type = $${params.length}`;
      }

      params.push(limit);
      query += ` ORDER BY plays DESC, created_at DESC LIMIT $${params.length}`;

      const result = await getPool().query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error searching media:', error);
      return [];
    }
  }

  /**
   * Get trending media (most played)
   * @param {string} type - Media type filter
   * @param {number} limit - Number of results
   * @returns {Promise<Array>} Trending media
   */
  static async getTrendingMedia(type = 'all', limit = 10) {
    try {
      const cacheKey = `media:trending:${type}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          let query = `
            SELECT * FROM media_library
            WHERE is_public = true
          `;
          const params = [];

          if (type !== 'all') {
            params.push(type);
            query += ` AND type = $${params.length}`;
          }

          params.push(limit);
          query += ` ORDER BY plays DESC, likes DESC LIMIT $${params.length}`;

          const result = await getPool().query(query, params);
          logger.info(`Retrieved ${result.rows.length} trending media (type: ${type})`);
          return result.rows;
        },
        600, // Cache for 10 minutes
      );
    } catch (error) {
      logger.error('Error getting trending media:', error);
      return [];
    }
  }

  /**
   * Delete media
   * @param {string} mediaId - Media ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteMedia(mediaId) {
    try {
      const query = `DELETE FROM media_library WHERE id = $1`;
      await getPool().query(query, [mediaId]);

      // Invalidate cache
      await cache.del('media:library');
      await cache.del('media:trending:all');

      logger.info('Media deleted', { mediaId });
      return true;
    } catch (error) {
      logger.error('Error deleting media:', error);
      return false;
    }
  }

  /**
   * Delete playlist
   * @param {string} playlistId - Playlist ID
   * @param {string} userId - User ID (for ownership check)
   * @returns {Promise<boolean>} Success status
   */
  static async deletePlaylist(playlistId, userId = null) {
    try {
      let query = `DELETE FROM media_playlists WHERE id = $1`;
      const params = [playlistId];

      if (userId) {
        params.push(userId.toString());
        query += ` AND owner_id = $${params.length}`;
      }

      await getPool().query(query, params);

      // Invalidate cache
      if (userId) {
        await cache.del(`playlists:user:${userId}`);
      }
      await cache.del('playlists:public');

      logger.info('Playlist deleted', { playlistId });
      return true;
    } catch (error) {
      logger.error('Error deleting playlist:', error);
      return false;
    }
  }

  /**
   * Get categories list
   * @returns {Promise<Array>} List of categories
   */
  static async getCategories() {
    try {
      const cacheKey = 'media:categories';

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const query = `
            SELECT DISTINCT category
            FROM media_library
            WHERE category IS NOT NULL AND is_public = true
            ORDER BY category
          `;
          const result = await getPool().query(query);
          const categories = result.rows.map(r => r.category);
          logger.info(`Retrieved ${categories.length} categories`);
          return categories.length > 0 ? categories : ['general', 'music', 'podcasts'];
        },
        600, // Cache for 10 minutes
      );
    } catch (error) {
      logger.error('Error getting categories:', error);
      return ['general', 'music', 'podcasts'];
    }
  }

  /**
   * Get user's favorite media
   * @param {string} userId - User ID
   * @param {number} limit - Number of items
   * @returns {Promise<Array>} Favorite media items
   */
  static async getUserFavorites(userId, limit = 50) {
    try {
      const query = `
        SELECT m.*, mf.created_at as favorited_at
        FROM media_favorites mf
        JOIN media_library m ON mf.media_id = m.id
        WHERE mf.user_id = $1
        ORDER BY mf.created_at DESC
        LIMIT $2
      `;
      const result = await getPool().query(query, [userId.toString(), limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user favorites:', error);
      return [];
    }
  }

  /**
   * Get user's play history
   * @param {string} userId - User ID
   * @param {number} limit - Number of items
   * @returns {Promise<Array>} Recently played media
   */
  static async getUserPlayHistory(userId, limit = 20) {
    try {
      const query = `
        SELECT m.*, mph.played_at
        FROM media_play_history mph
        JOIN media_library m ON mph.media_id = m.id
        WHERE mph.user_id = $1
        ORDER BY mph.played_at DESC
        LIMIT $2
      `;
      const result = await getPool().query(query, [userId.toString(), limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user play history:', error);
      return [];
    }
  }

  /**
   * Update media
   * @param {string} mediaId - Media ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object|null>} Updated media
   */
  static async updateMedia(mediaId, updates) {
    try {
      const allowedFields = ['title', 'artist', 'url', 'type', 'duration', 'category',
                            'cover_url', 'description', 'is_public', 'is_explicit', 'tags'];

      const setClause = [];
      const values = [];
      let paramIndex = 1;

      for (const field of allowedFields) {
        const camelField = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (updates[field] !== undefined || updates[camelField] !== undefined) {
          setClause.push(`${field} = $${paramIndex}`);
          values.push(updates[field] ?? updates[camelField]);
          paramIndex++;
        }
      }

      if (setClause.length === 0) {
        return await this.getMediaById(mediaId);
      }

      values.push(mediaId);
      const query = `
        UPDATE media_library
        SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await getPool().query(query, values);

      // Invalidate cache
      await cache.del('media:library');

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating media:', error);
      return null;
    }
  }
}

module.exports = MediaPlayerModel;
