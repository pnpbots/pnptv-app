const axios = require('axios');
const logger = require('../../../utils/logger');

const DIRECTUS_INTERNAL_URL = process.env.DIRECTUS_URL || 'http://172.20.0.14:8055';
const DIRECTUS_ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '';

// GET /api/proxy/social/posts — Public read of social_posts from Directus
const getPosts = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const resp = await axios.get(`${DIRECTUS_INTERNAL_URL}/items/social_posts`, {
      params: {
        sort: '-date_created',
        limit: +limit,
        offset: +offset,
        'fields[]': ['*', 'media.id', 'media.type', 'media.width', 'media.height', 'media.filename_download'],
        'filter[status][_eq]': 'published',
      },
      timeout: 10000,
    });
    const posts = resp.data?.data || [];
    res.json({ success: true, posts });
  } catch (error) {
    logger.error('Social posts proxy GET error:', error.message);
    res.json({ success: true, posts: [], message: 'Posts temporarily unavailable' });
  }
};

// POST /api/proxy/social/posts — Create a new social post (auth required)
const createPost = async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ success: false, error: 'Text must be 500 characters or less' });
    }

    if (!DIRECTUS_ADMIN_TOKEN) {
      return res.status(500).json({ success: false, error: 'Directus admin token not configured' });
    }

    let mediaFileId = null;

    if (req.file) {
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      const uploadResp = await axios.post(`${DIRECTUS_INTERNAL_URL}/files`, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${DIRECTUS_ADMIN_TOKEN}`,
        },
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
      });
      mediaFileId = uploadResp.data?.data?.id || null;
    }

    const authorId = String(user.telegram_id || user.id || '');
    const authorName = user.display_name || user.first_name || user.username || 'Anonymous';
    const authorSource = user.telegram_id ? 'telegram' : 'oidc';

    const createResp = await axios.post(`${DIRECTUS_INTERNAL_URL}/items/social_posts`, {
      status: 'published',
      text: text.trim(),
      media: mediaFileId,
      author_name: authorName,
      author_id: authorId,
      author_source: authorSource,
    }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DIRECTUS_ADMIN_TOKEN}`,
      },
      timeout: 10000,
    });

    const post = createResp.data?.data;
    logger.info(`Social post created by user ${authorId}: post #${post?.id}`);
    res.json({ success: true, post });
  } catch (error) {
    logger.error('Social posts proxy POST error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create post' });
  }
};

// DELETE /api/proxy/social/posts/:id — Delete own post (auth required)
const deletePost = async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const postId = req.params.id;
    const authorId = String(user.telegram_id || user.id || '');

    if (!DIRECTUS_ADMIN_TOKEN) {
      return res.status(500).json({ success: false, error: 'Directus admin token not configured' });
    }

    const fetchResp = await axios.get(`${DIRECTUS_INTERNAL_URL}/items/social_posts/${postId}`, {
      headers: { Authorization: `Bearer ${DIRECTUS_ADMIN_TOKEN}` },
      timeout: 5000,
    });

    const post = fetchResp.data?.data;
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    if (post.author_id !== authorId && !isAdmin) {
      return res.status(403).json({ success: false, error: 'You can only delete your own posts' });
    }

    if (post.media) {
      try {
        await axios.delete(`${DIRECTUS_INTERNAL_URL}/files/${post.media}`, {
          headers: { Authorization: `Bearer ${DIRECTUS_ADMIN_TOKEN}` },
          timeout: 5000,
        });
      } catch (_) { /* media cleanup is best-effort */ }
    }

    await axios.delete(`${DIRECTUS_INTERNAL_URL}/items/social_posts/${postId}`, {
      headers: { Authorization: `Bearer ${DIRECTUS_ADMIN_TOKEN}` },
      timeout: 5000,
    });

    logger.info(`Social post #${postId} deleted by user ${authorId}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Social posts proxy DELETE error:', error.message);
    if (error.response?.status === 403) {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this post' });
    }
    res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
};

module.exports = { getPosts, createPost, deletePost };
