const logger = require('../../../utils/logger');
const { getPool } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');
const MediaPlayerModel = require('../../../models/mediaPlayerModel');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

/**
 * Media and Radio Admin Controller
 * Handles management of media library and radio station
 */

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mp3'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  }
});

/**
 * GET /api/admin/media/library
 * Get media library with filters
 */
const getMediaLibrary = async (req, res) => {
  const user = req.user;

  try {
    const { type = 'all', category, page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let countQuery = 'SELECT COUNT(*) as count FROM media_library WHERE 1=1';
    let dataQuery = `SELECT * FROM media_library WHERE 1=1`;
    const params = [];

    if (type !== 'all') {
      params.push(type);
      countQuery += ` AND type = $${params.length}`;
      dataQuery += ` AND type = $${params.length}`;
    }

    if (category) {
      params.push(category);
      const paramNum = params.length;
      countQuery += ` AND category = $${paramNum}`;
      dataQuery += ` AND category = $${paramNum}`;
    }

    if (search) {
      params.push(`%${search}%`);
      const paramNum = params.length;
      countQuery += ` AND (title ILIKE $${paramNum} OR artist ILIKE $${paramNum})`;
      dataQuery += ` AND (title ILIKE $${paramNum} OR artist ILIKE $${paramNum})`;
    }

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    dataQuery += ` ORDER BY created_at DESC LIMIT $${limitParam} OFFSET $${offsetParam}`;
    params.push(parseInt(limit), offset);

    const [countResult, dataResult] = await Promise.all([
      getPool().query(countQuery, params.slice(0, params.length - 2)),
      getPool().query(dataQuery, params),
    ]);

    const total = parseInt(countResult.rows[0]?.count || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    logger.info('Admin fetched media library', { adminId: user.id, type, category, search });

    return res.json({
      success: true,
      media: dataResult.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages },
    });
  } catch (error) {
    logger.error('Error fetching media library:', error);
    return res.status(500).json({ error: 'Failed to fetch media library' });
  }
};

/**
 * GET /api/admin/media/categories
 * Get all available categories
 */
const getCategories = async (req, res) => {
  const user = req.user;

  try {
    const cacheKey = 'admin:media:categories';
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, categories: JSON.parse(cached) });
    }

    const result = await getPool().query(
      `SELECT DISTINCT category FROM media_library WHERE category IS NOT NULL ORDER BY category`
    );

    const categories = result.rows.map(r => r.category);
    await cache.setex(cacheKey, 300, JSON.stringify(categories));

    logger.info('Admin fetched categories', { adminId: user.id });
    return res.json({ success: true, categories });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

/**
 * POST /api/admin/media/upload
 * Upload new media (audio or video)
 */
const uploadMedia = async (req, res) => {
  const user = req.user;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { title, artist, description, category = 'general', isExplicit = false, type = 'audio' } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // TODO: In production, upload to S3 or persistent storage
    // For now, we'll store the file path as a placeholder
    const mediaId = uuidv4();
    const fileExt = path.extname(req.file.originalname);
    const fileName = `${mediaId}${fileExt}`;
    const uploadDir = path.join('/root/pnptvbot-production', 'uploads', 'media');

    // Create upload directory if it doesn't exist
    await fs.mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, req.file.buffer);

    // Create media record in database
    const mediaData = {
      title,
      artist: artist || 'Unknown',
      url: `/uploads/media/${fileName}`, // Relative URL to the uploaded file
      type: type || 'audio',
      duration: 0, // TODO: Extract from file metadata
      coverUrl: null,
      description: description || null,
      category: category || 'general',
      uploaderId: user.id,
      uploaderName: user.username,
      isPublic: true,
      isExplicit: isExplicit === 'true' || isExplicit === true,
      metadata: {
        fileName,
        uploadedAt: new Date().toISOString(),
      },
    };

    const newMedia = await MediaPlayerModel.createMedia(mediaData);

    if (!newMedia) {
      // Clean up file if DB insert failed
      await fs.unlink(filePath).catch(() => {});
      return res.status(500).json({ error: 'Failed to create media record' });
    }

    logger.info('Admin uploaded media', { adminId: user.id, mediaId: newMedia.id, title });

    return res.json({
      success: true,
      media: newMedia,
      message: 'Media uploaded successfully',
    });
  } catch (error) {
    logger.error('Error uploading media:', error);
    return res.status(500).json({ error: error.message || 'Failed to upload media' });
  }
};

/**
 * PUT /api/admin/media/:mediaId
 * Edit media metadata
 */
const updateMedia = async (req, res) => {
  const user = req.user;
  const { mediaId } = req.params;

  try {
    const { title, artist, description, category, isExplicit, is_prime } = req.body;

    const updateFields = [];
    const values = [mediaId];
    let paramIndex = 2;

    if (title !== undefined) {
      updateFields.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (artist !== undefined) {
      updateFields.push(`artist = $${paramIndex++}`);
      values.push(artist);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (category !== undefined) {
      updateFields.push(`category = $${paramIndex++}`);
      values.push(category);
    }
    if (isExplicit !== undefined) {
      updateFields.push(`is_explicit = $${paramIndex++}`);
      values.push(isExplicit);
    }
    if (is_prime !== undefined) {
      updateFields.push(`is_prime = $${paramIndex++}`);
      values.push(is_prime);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push('updated_at = NOW()');
    const query = `UPDATE media_library SET ${updateFields.join(', ')} WHERE id = $1 RETURNING *`;

    const result = await getPool().query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Invalidate cache
    await cache.del('media:library:all');
    await cache.del(`media:category:${category || 'general'}`);

    logger.info('Admin updated media', { adminId: user.id, mediaId });

    return res.json({ success: true, media: result.rows[0] });
  } catch (error) {
    logger.error('Error updating media:', error);
    return res.status(500).json({ error: 'Failed to update media' });
  }
};

/**
 * DELETE /api/admin/media/:mediaId
 * Delete media
 */
const deleteMedia = async (req, res) => {
  const user = req.user;
  const { mediaId } = req.params;

  try {
    // Get media to find the file
    const media = await MediaPlayerModel.getMediaById(mediaId);

    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Delete from database
    await getPool().query('DELETE FROM media_library WHERE id = $1', [mediaId]);

    // Delete physical file if it exists (optional)
    if (media.url && media.url.startsWith('/uploads/')) {
      const filePath = path.join('/root/pnptvbot-production', media.url);
      await fs.unlink(filePath).catch(() => {});
    }

    // Invalidate cache
    await cache.del('media:library:all');
    await cache.del(`media:category:${media.category || 'general'}`);

    logger.info('Admin deleted media', { adminId: user.id, mediaId });

    return res.json({ success: true, message: 'Media deleted successfully' });
  } catch (error) {
    logger.error('Error deleting media:', error);
    return res.status(500).json({ error: 'Failed to delete media' });
  }
};

/**
 * GET /api/admin/radio/now-playing
 * Get current radio track
 */
const getNowPlaying = async (req, res) => {
  const user = req.user;

  try {
    const cacheKey = 'radio:admin:now_playing';
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, nowPlaying: JSON.parse(cached) });
    }

    const result = await getPool().query(
      'SELECT * FROM radio_now_playing WHERE id = 1'
    );

    const nowPlaying = result.rows[0] || null;
    if (nowPlaying) {
      await cache.setex(cacheKey, 30, JSON.stringify(nowPlaying));
    }

    logger.info('Admin fetched radio now playing', { adminId: user.id });

    return res.json({ success: true, nowPlaying });
  } catch (error) {
    logger.error('Error fetching radio now playing:', error);
    return res.status(500).json({ error: 'Failed to fetch now playing' });
  }
};

/**
 * POST /api/admin/radio/now-playing
 * Set current radio track
 */
const setNowPlaying = async (req, res) => {
  const user = req.user;
  const { mediaId, title, artist, duration, coverUrl } = req.body;

  try {
    let finalTitle = title;
    let finalArtist = artist;
    let finalDuration = duration;
    let finalCoverUrl = coverUrl;

    // If mediaId is provided, fetch details from media library
    if (mediaId) {
      const media = await MediaPlayerModel.getMediaById(mediaId);
      if (!media) {
        return res.status(404).json({ error: 'Media not found' });
      }
      finalTitle = media.title;
      finalArtist = media.artist;
      finalDuration = media.duration;
      finalCoverUrl = media.cover_url;
    }

    if (!finalTitle) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Insert or update now playing
    const result = await getPool().query(
      `INSERT INTO radio_now_playing (id, title, artist, duration, cover_url, started_at, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = $1, artist = $2, duration = $3, cover_url = $4, started_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [finalTitle, finalArtist || 'Unknown', finalDuration || 0, finalCoverUrl]
    );

    // Invalidate cache
    await cache.del('radio:admin:now_playing');
    await cache.del('radio:now_playing');

    logger.info('Admin set radio now playing', { adminId: user.id, title: finalTitle });

    return res.json({
      success: true,
      nowPlaying: result.rows[0],
      message: 'Now playing updated successfully',
    });
  } catch (error) {
    logger.error('Error setting radio now playing:', error);
    return res.status(500).json({ error: 'Failed to set now playing' });
  }
};

/**
 * GET /api/admin/radio/queue
 * Get radio queue
 */
const getQueue = async (req, res) => {
  const user = req.user;

  try {
    const result = await getPool().query(
      `SELECT * FROM radio_queue ORDER BY position ASC`
    );

    logger.info('Admin fetched radio queue', { adminId: user.id });

    return res.json({
      success: true,
      queue: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching radio queue:', error);
    return res.status(500).json({ error: 'Failed to fetch queue' });
  }
};

/**
 * POST /api/admin/radio/queue
 * Add media to radio queue
 */
const addToQueue = async (req, res) => {
  const user = req.user;
  const { mediaId } = req.body;

  try {
    if (!mediaId) {
      return res.status(400).json({ error: 'Media ID is required' });
    }

    const media = await MediaPlayerModel.getMediaById(mediaId);

    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Get next position
    const posResult = await getPool().query(
      'SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM radio_queue'
    );

    const result = await getPool().query(
      `INSERT INTO radio_queue (media_id, title, artist, duration, cover_url, position, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [mediaId, media.title, media.artist, media.duration, media.cover_url, posResult.rows[0].next_pos, user.id]
    );

    logger.info('Admin added to radio queue', { adminId: user.id, mediaId });

    return res.json({ success: true, queueItem: result.rows[0] });
  } catch (error) {
    logger.error('Error adding to queue:', error);
    return res.status(500).json({ error: 'Failed to add to queue' });
  }
};

/**
 * DELETE /api/admin/radio/queue/:queueId
 * Remove item from radio queue
 */
const removeFromQueue = async (req, res) => {
  const user = req.user;
  const { queueId } = req.params;

  try {
    await getPool().query('DELETE FROM radio_queue WHERE id = $1', [queueId]);

    logger.info('Admin removed from radio queue', { adminId: user.id, queueId });

    return res.json({ success: true, message: 'Item removed from queue' });
  } catch (error) {
    logger.error('Error removing from queue:', error);
    return res.status(500).json({ error: 'Failed to remove from queue' });
  }
};

/**
 * POST /api/admin/radio/queue/clear
 * Clear entire radio queue
 */
const clearQueue = async (req, res) => {
  const user = req.user;

  try {
    await getPool().query('DELETE FROM radio_queue');

    logger.info('Admin cleared radio queue', { adminId: user.id });

    return res.json({ success: true, message: 'Queue cleared successfully' });
  } catch (error) {
    logger.error('Error clearing queue:', error);
    return res.status(500).json({ error: 'Failed to clear queue' });
  }
};

/**
 * GET /api/admin/radio/requests
 * Get pending radio requests
 */
const getRequests = async (req, res) => {
  const user = req.user;
  const { status = 'pending' } = req.query;

  try {
    const query = status
      ? `SELECT * FROM radio_requests WHERE status = $1 ORDER BY requested_at DESC`
      : `SELECT * FROM radio_requests ORDER BY requested_at DESC`;

    const params = status ? [status] : [];

    const result = await getPool().query(query, params);

    logger.info('Admin fetched radio requests', { adminId: user.id, status });

    return res.json({ success: true, requests: result.rows });
  } catch (error) {
    logger.error('Error fetching radio requests:', error);
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

/**
 * PUT /api/admin/radio/requests/:requestId
 * Approve or reject radio request
 */
const updateRequest = async (req, res) => {
  const user = req.user;
  const { requestId } = req.params;
  const { status } = req.body;

  try {
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await getPool().query(
      `UPDATE radio_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, requestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    logger.info('Admin updated radio request', { adminId: user.id, requestId, status });

    return res.json({ success: true, request: result.rows[0] });
  } catch (error) {
    logger.error('Error updating radio request:', error);
    return res.status(500).json({ error: 'Failed to update request' });
  }
};

module.exports = {
  getMediaLibrary,
  getCategories,
  uploadMedia: [upload.single('file'), uploadMedia],
  updateMedia,
  deleteMedia,
  getNowPlaying,
  setNowPlaying,
  getQueue,
  addToQueue,
  removeFromQueue,
  clearQueue,
  getRequests,
  updateRequest,
};
