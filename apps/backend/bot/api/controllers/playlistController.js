const MediaPlayerModel = require('../../../models/mediaPlayerModel');
const db = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { resolveUserId } = require('../../utils/helpers');

const normalizeKeyPart = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

const dedupePlaylists = (playlists) => {
  const seen = new Set();
  const out = [];
  for (const playlist of playlists || []) {
    const key = [
      normalizeKeyPart(playlist.category),
      normalizeKeyPart(playlist.title),
      normalizeKeyPart(playlist.creator),
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(playlist);
  }
  return out;
};

/**
 * Playlist API Controller
 * Handles playlist management for web interface
 */

/**
 * Get user playlists
 * Expects userId in query parameter or header
 */
const getUserPlaylists = async (req, res) => {
  try {
    const userId = await resolveUserId(req.query.userId || req.headers['x-user-id']);

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const result = await db.query(
      'SELECT * FROM user_playlists WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const playlists = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      icon: row.icon,
      thumbnail: row.thumbnail,
      videos: row.videos,
      videoCount: row.video_count,
      isPublic: row.is_public,
      creator: row.creator_name,
      creatorBadge: row.creator_badge,
      featured: row.featured,
      createdAt: row.created_at,
    }));

    res.json(dedupePlaylists(playlists));
  } catch (error) {
    logger.error('Error getting user playlists:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
};

/**
 * Get public playlists
 */
const getPublicPlaylists = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;

    const result = await db.query(
      'SELECT * FROM user_playlists WHERE is_public = true ORDER BY created_at DESC LIMIT $1',
      [limit]
    );

    const playlists = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      icon: row.icon,
      thumbnail: row.thumbnail,
      videos: row.videos,
      videoCount: row.video_count,
      isPublic: row.is_public,
      creator: row.creator_name,
      creatorBadge: row.creator_badge,
      featured: row.featured,
      createdAt: row.created_at,
    }));

    res.json(dedupePlaylists(playlists));
  } catch (error) {
    logger.error('Error getting public playlists:', error);
    res.status(500).json({ error: 'Failed to get public playlists' });
  }
};

/**
 * Create playlist
 */
const createPlaylist = async (req, res) => {
  try {
    const userId = await resolveUserId(req.body.userId || req.headers['x-user-id']);
    const {
      title,
      description,
      category,
      icon,
      thumbnail,
      videos,
      isPublic,
      creatorName,
      creatorBadge
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Playlist title is required' });
    }

    const videoCount = Array.isArray(videos) ? videos.length : 0;

    const result = await db.query(
      `INSERT INTO user_playlists
        (user_id, title, description, category, icon, thumbnail,
         videos, is_public, video_count, creator_name, creator_badge)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        userId,
        title.trim(),
        description || '',
        category || 'music',
        icon || '🎵',
        thumbnail || '',
        JSON.stringify(videos || []),
        isPublic === true,
        videoCount,
        creatorName || 'User',
        creatorBadge || '👤'
      ]
    );

    const playlist = {
      id: result.rows[0].id,
      title: result.rows[0].title,
      description: result.rows[0].description,
      category: result.rows[0].category,
      icon: result.rows[0].icon,
      thumbnail: result.rows[0].thumbnail,
      videos: result.rows[0].videos,
      videoCount: result.rows[0].video_count,
      isPublic: result.rows[0].is_public,
      creator: result.rows[0].creator_name,
      creatorBadge: result.rows[0].creator_badge,
      createdAt: result.rows[0].created_at,
    };

    res.status(201).json(playlist);
  } catch (error) {
    logger.error('Error creating playlist:', error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
};

/**
 * Add video to playlist (owner only)
 */
const addToPlaylist = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { playlistId } = req.params;
    const { videoId } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    // Ownership check
    const ownerCheck = await db.query('SELECT user_id FROM user_playlists WHERE id = $1', [playlistId]);
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    if (String(ownerCheck.rows[0].user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Only the playlist owner can add videos' });
    }

    const success = await MediaPlayerModel.addToPlaylist(playlistId, videoId);

    if (!success) {
      return res.status(500).json({ error: 'Failed to add video to playlist' });
    }

    res.json({ success: true, message: 'Video added to playlist' });
  } catch (error) {
    logger.error('Error adding to playlist:', error);
    res.status(500).json({ error: 'Failed to add video to playlist' });
  }
};

/**
 * Remove video from playlist (owner only)
 */
const removeFromPlaylist = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { playlistId, videoId } = req.params;

    // Ownership check
    const ownerCheck = await db.query('SELECT user_id FROM user_playlists WHERE id = $1', [playlistId]);
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    if (String(ownerCheck.rows[0].user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Only the playlist owner can remove videos' });
    }

    const success = await MediaPlayerModel.removeFromPlaylist(playlistId, videoId);

    if (!success) {
      return res.status(500).json({ error: 'Failed to remove video from playlist' });
    }

    res.json({ success: true, message: 'Video removed from playlist' });
  } catch (error) {
    logger.error('Error removing from playlist:', error);
    res.status(500).json({ error: 'Failed to remove video from playlist' });
  }
};

/**
 * Update playlist metadata (owner only)
 */
const updatePlaylist = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { playlistId } = req.params;
    const { title, description, category, icon, isPublic } = req.body;

    // Ownership check
    const ownerCheck = await db.query('SELECT user_id FROM user_playlists WHERE id = $1', [playlistId]);
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    if (String(ownerCheck.rows[0].user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Only the playlist owner can edit it' });
    }

    const sets = [];
    const vals = [];
    let idx = 1;

    if (title !== undefined) {
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      sets.push(`title = $${idx++}`); vals.push(title.trim());
    }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description || ''); }
    if (category !== undefined) { sets.push(`category = $${idx++}`); vals.push(category); }
    if (icon !== undefined) { sets.push(`icon = $${idx++}`); vals.push(icon); }
    if (isPublic !== undefined) { sets.push(`is_public = $${idx++}`); vals.push(Boolean(isPublic)); }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    vals.push(playlistId);
    const result = await db.query(
      `UPDATE user_playlists SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );

    const row = result.rows[0];
    res.json({
      id: row.id, title: row.title, description: row.description,
      category: row.category, icon: row.icon, thumbnail: row.thumbnail,
      videos: row.videos, videoCount: row.video_count, isPublic: row.is_public,
      creator: row.creator_name, creatorBadge: row.creator_badge, createdAt: row.created_at,
    });
  } catch (error) {
    logger.error('Error updating playlist:', error);
    res.status(500).json({ error: 'Failed to update playlist' });
  }
};

/**
 * Delete playlist (owner only)
 */
const deletePlaylist = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { playlistId } = req.params;

    // Ownership check
    const ownerCheck = await db.query('SELECT user_id FROM user_playlists WHERE id = $1', [playlistId]);
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    if (String(ownerCheck.rows[0].user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Only the playlist owner can delete it' });
    }

    const success = await MediaPlayerModel.deletePlaylist(playlistId);

    if (!success) {
      return res.status(500).json({ error: 'Failed to delete playlist' });
    }

    res.json({ success: true, message: 'Playlist deleted' });
  } catch (error) {
    logger.error('Error deleting playlist:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
};

module.exports = {
  getUserPlaylists,
  getPublicPlaylists,
  createPlaylist,
  addToPlaylist,
  removeFromPlaylist,
  updatePlaylist,
  deletePlaylist,
};
