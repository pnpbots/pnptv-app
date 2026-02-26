const invidiousService = require('../../services/invidiousService');
const logger = require('../../../utils/logger');

/**
 * Materialious API Controller
 * Handles Invidious API requests for the Materialious web client
 */

/**
 * Search videos
 */
const searchVideos = async (req, res) => {
  try {
    const { q, page = 1, sortBy = 'relevance' } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const videos = await invidiousService.searchVideos(q, {
      page: parseInt(page, 10),
      sortBy,
    });

    res.json(videos);
  } catch (error) {
    logger.error('Error searching videos:', error);
    res.status(500).json({ error: 'Failed to search videos' });
  }
};

/**
 * Get trending videos
 */
const getTrendingVideos = async (req, res) => {
  try {
    const { region = 'US' } = req.query;

    const videos = await invidiousService.getTrendingVideos({ region });

    res.json(videos);
  } catch (error) {
    logger.error('Error getting trending videos:', error);
    res.status(500).json({ error: 'Failed to get trending videos' });
  }
};

/**
 * Get popular videos
 */
const getPopularVideos = async (req, res) => {
  try {
    const videos = await invidiousService.getPopularVideos();
    res.json(videos);
  } catch (error) {
    logger.error('Error getting popular videos:', error);
    res.status(500).json({ error: 'Failed to get popular videos' });
  }
};

/**
 * Get video details
 */
const getVideoDetails = async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    const video = await invidiousService.getVideoDetails(videoId);
    res.json(video);
  } catch (error) {
    logger.error('Error getting video details:', error);
    res.status(500).json({ error: 'Failed to get video details' });
  }
};

/**
 * Get channel information
 */
const getChannelInfo = async (req, res) => {
  try {
    const { channelId } = req.params;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }

    const channel = await invidiousService.getChannelInfo(channelId);
    res.json(channel);
  } catch (error) {
    logger.error('Error getting channel info:', error);
    res.status(500).json({ error: 'Failed to get channel info' });
  }
};

/**
 * Get channel videos
 */
const getChannelVideos = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { page = 1, sortBy = 'newest' } = req.query;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }

    const videos = await invidiousService.getChannelVideos(channelId, {
      page: parseInt(page, 10),
      sortBy,
    });

    res.json(videos);
  } catch (error) {
    logger.error('Error getting channel videos:', error);
    res.status(500).json({ error: 'Failed to get channel videos' });
  }
};

/**
 * Get playlist information
 */
const getPlaylistInfo = async (req, res) => {
  try {
    const { playlistId } = req.params;

    if (!playlistId) {
      return res.status(400).json({ error: 'Playlist ID is required' });
    }

    const playlist = await invidiousService.getPlaylistInfo(playlistId);
    res.json(playlist);
  } catch (error) {
    logger.error('Error getting playlist info:', error);
    res.status(500).json({ error: 'Failed to get playlist info' });
  }
};

/**
 * Get subtitles for a video
 */
const getSubtitles = async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    const subtitles = await invidiousService.getSubtitles(videoId);

    if (!subtitles) {
      return res.status(404).json({ error: 'No subtitles available' });
    }

    res.json(subtitles);
  } catch (error) {
    logger.error('Error getting subtitles:', error);
    res.status(500).json({ error: 'Failed to get subtitles' });
  }
};

/**
 * Get instance status
 */
const getInstanceStatus = async (req, res) => {
  try {
    const status = await invidiousService.getInstanceStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error getting instance status:', error);
    res.status(500).json({ error: 'Failed to get instance status' });
  }
};

/**
 * Configure custom Invidious instance
 */
const setCustomInstance = async (req, res) => {
  try {
    const { instanceUrl } = req.body;

    if (!instanceUrl) {
      return res.status(400).json({ error: 'Instance URL is required' });
    }

    invidiousService.setCustomInstance(instanceUrl);

    res.json({
      success: true,
      message: 'Custom instance configured',
      instance: instanceUrl,
    });
  } catch (error) {
    logger.error('Error setting custom instance:', error);
    res.status(500).json({ error: 'Failed to set custom instance' });
  }
};

module.exports = {
  searchVideos,
  getTrendingVideos,
  getPopularVideos,
  getVideoDetails,
  getChannelInfo,
  getChannelVideos,
  getPlaylistInfo,
  getSubtitles,
  getInstanceStatus,
  setCustomInstance,
};
