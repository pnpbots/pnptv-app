const MediaPlayerModel = require('../../../models/mediaPlayerModel');
const db = require('../../../config/postgres');
const logger = require('../../../utils/logger');

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
    const userId = req.query.userId || req.headers['x-user-id'];

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
    const userId = req.body.userId || req.headers['x-user-id'];
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
 * Add video to playlist
 */
const addToPlaylist = async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { videoId } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
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
 * Remove video from playlist
 */
const removeFromPlaylist = async (req, res) => {
  try {
    const { playlistId, videoId } = req.params;

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
 * Delete playlist
 */
const deletePlaylist = async (req, res) => {
  try {
    const { playlistId } = req.params;

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
  deletePlaylist,
};
