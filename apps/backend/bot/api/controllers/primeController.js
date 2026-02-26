const { getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

exports.getLatestPrimeVideo = async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, title, artist, cover_url, category FROM media_library
       WHERE is_prime = true AND type IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const video = result.rows[0];
    res.json({
      success: true,
      data: {
        id: video.id,
        title: video.title || 'Prime Video',
        artist: video.artist || '',
        cover: video.cover_url || 'https://via.placeholder.com/300x150.png?text=Prime',
        category: video.category,
      },
    });
  } catch (error) {
    logger.error('getLatestPrimeVideo error:', error);
    res.status(500).json({ error: 'Failed to load prime video' });
  }
};

exports.getLatestVideoramaVideo = async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, title, artist, cover_url, category FROM media_library
       WHERE is_prime = false AND type IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const video = result.rows[0];
    res.json({
      success: true,
      data: {
        id: video.id,
        title: video.title || 'Videorama',
        artist: video.artist || '',
        cover: video.cover_url || 'https://via.placeholder.com/300x150.png?text=Videorama',
        category: video.category,
      },
    });
  } catch (error) {
    logger.error('getLatestVideoramaVideo error:', error);
    res.status(500).json({ error: 'Failed to load videorama video' });
  }
};
