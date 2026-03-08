/**
 * CMS Creator Controller
 * Proxies Directus CMS operations for active creators — performers profile, content library, shows.
 * All requests are scoped to the authenticated creator's pnptv_id.
 */

const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

// Multer: memory storage for media uploads (pass-through to Directus)
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  },
});

const directusHeaders = () => ({ Authorization: `Bearer ${DIRECTUS_TOKEN}` });

/** Verify caller is an active creator and return their pnptv_id */
async function requireActiveCreator(req, res) {
  const userId = req.user?.id;
  if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return null; }

  const result = await query(
    `SELECT pnptv_id, creator_status, username, first_name, photo_file_id, bio FROM users WHERE id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user || user.creator_status !== 'active') {
    res.status(403).json({ error: 'Active creator account required' });
    return null;
  }
  return user;
}

/** Find or auto-create the performer record linked to this creator */
async function getOrCreatePerformer(pnptvId, user) {
  // Look for existing record
  const listRes = await axios.get(`${DIRECTUS_URL}/items/performers`, {
    headers: directusHeaders(),
    params: { filter: JSON.stringify({ pnptv_id: { _eq: pnptvId } }), limit: 1 },
  });
  const existing = listRes.data?.data?.[0];
  if (existing) return existing;

  // Auto-create from user data
  const createRes = await axios.post(
    `${DIRECTUS_URL}/items/performers`,
    {
      status: 'draft',
      name: user.first_name || user.username || 'Creator',
      slug: user.username || pnptvId,
      pnptv_id: pnptvId,
      bio: user.bio || '',
      bio_short: '',
      categories: [],
      is_featured: false,
      is_available: false,
    },
    { headers: directusHeaders() }
  );
  return createRes.data?.data;
}

// ─── Performer Profile ────────────────────────────────────────────────────────

const getProfile = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);
    return res.json({ success: true, performer });
  } catch (err) {
    logger.error('cms.getProfile error', err);
    return res.status(500).json({ error: 'Failed to load CMS profile' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);

    const allowed = ['name', 'slug', 'bio', 'bio_short', 'categories', 'social_links',
      'is_available', 'availability_message', 'base_price_cents', 'currency',
      'timezone', 'durations_minutes', 'status'];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const updateRes = await axios.patch(
      `${DIRECTUS_URL}/items/performers/${performer.id}`,
      patch,
      { headers: directusHeaders() }
    );
    return res.json({ success: true, performer: updateRes.data?.data });
  } catch (err) {
    logger.error('cms.updateProfile error', err);
    return res.status(500).json({ error: 'Failed to update CMS profile' });
  }
};

// ─── Content Library ──────────────────────────────────────────────────────────

const listContent = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);
    const { page = 1, limit = 20, type } = req.query;

    const filter = { performer: { _eq: performer.id } };
    if (type) filter.type = { _eq: type };

    const listRes = await axios.get(`${DIRECTUS_URL}/items/content`, {
      headers: directusHeaders(),
      params: {
        filter: JSON.stringify(filter),
        sort: '-date_created',
        limit: Math.min(Number(limit), 50),
        page: Number(page),
        fields: 'id,status,title,description,type,media_url,thumbnail,duration_seconds,is_premium,tags,series,episode_number,publish_to_feed,social_post_id,date_created,date_updated',
      },
    });

    return res.json({
      success: true,
      content: listRes.data?.data || [],
      meta: listRes.data?.meta || {},
    });
  } catch (err) {
    logger.error('cms.listContent error', err);
    return res.status(500).json({ error: 'Failed to load content' });
  }
};

const createContent = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);

    const allowed = ['title', 'description', 'type', 'media_url', 'duration_seconds',
      'is_premium', 'tags', 'series', 'episode_number', 'status', 'publish_to_feed'];
    const item = { performer: performer.id, status: 'draft' };
    for (const k of allowed) {
      if (req.body[k] !== undefined) item[k] = req.body[k];
    }

    if (!item.title || !item.type) {
      return res.status(400).json({ error: 'title and type are required' });
    }

    const createRes = await axios.post(`${DIRECTUS_URL}/items/content`, item, {
      headers: directusHeaders(),
    });
    return res.status(201).json({ success: true, content: createRes.data?.data });
  } catch (err) {
    logger.error('cms.createContent error', err);
    return res.status(500).json({ error: 'Failed to create content' });
  }
};

const updateContent = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);
    const { id } = req.params;

    // Verify ownership
    const checkRes = await axios.get(`${DIRECTUS_URL}/items/content/${id}`, {
      headers: directusHeaders(),
      params: { fields: 'id,performer' },
    });
    const item = checkRes.data?.data;
    if (!item || String(item.performer) !== String(performer.id)) {
      return res.status(403).json({ error: 'Not your content' });
    }

    const allowed = ['title', 'description', 'type', 'media_url', 'duration_seconds',
      'is_premium', 'tags', 'series', 'episode_number', 'status', 'publish_to_feed'];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const updateRes = await axios.patch(`${DIRECTUS_URL}/items/content/${id}`, patch, {
      headers: directusHeaders(),
    });
    return res.json({ success: true, content: updateRes.data?.data });
  } catch (err) {
    logger.error('cms.updateContent error', err);
    return res.status(500).json({ error: 'Failed to update content' });
  }
};

const deleteContent = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);
    const { id } = req.params;

    // Verify ownership
    const checkRes = await axios.get(`${DIRECTUS_URL}/items/content/${id}`, {
      headers: directusHeaders(),
      params: { fields: 'id,performer' },
    });
    const item = checkRes.data?.data;
    if (!item || String(item.performer) !== String(performer.id)) {
      return res.status(403).json({ error: 'Not your content' });
    }

    await axios.delete(`${DIRECTUS_URL}/items/content/${id}`, { headers: directusHeaders() });
    return res.json({ success: true });
  } catch (err) {
    logger.error('cms.deleteContent error', err);
    return res.status(500).json({ error: 'Failed to delete content' });
  }
};

// ─── Shows ────────────────────────────────────────────────────────────────────

const listShows = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);
    const { upcoming } = req.query;

    const filter = { performer: { _eq: performer.id } };
    if (upcoming === '1') filter.scheduled_at = { _gte: new Date().toISOString() };

    const listRes = await axios.get(`${DIRECTUS_URL}/items/shows`, {
      headers: directusHeaders(),
      params: {
        filter: JSON.stringify(filter),
        sort: 'scheduled_at',
        limit: 50,
        fields: 'id,status,title,description,scheduled_at,duration_minutes,category,is_premium,date_created,date_updated',
      },
    });

    return res.json({ success: true, shows: listRes.data?.data || [] });
  } catch (err) {
    logger.error('cms.listShows error', err);
    return res.status(500).json({ error: 'Failed to load shows' });
  }
};

const createShow = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);

    const { title, description, scheduled_at, duration_minutes, category, is_premium } = req.body;
    if (!title || !scheduled_at) {
      return res.status(400).json({ error: 'title and scheduled_at are required' });
    }

    const createRes = await axios.post(
      `${DIRECTUS_URL}/items/shows`,
      { performer: performer.id, status: 'draft', title, description, scheduled_at, duration_minutes, category, is_premium: !!is_premium },
      { headers: directusHeaders() }
    );
    return res.status(201).json({ success: true, show: createRes.data?.data });
  } catch (err) {
    logger.error('cms.createShow error', err);
    return res.status(500).json({ error: 'Failed to create show' });
  }
};

const updateShow = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);
    const { id } = req.params;

    const checkRes = await axios.get(`${DIRECTUS_URL}/items/shows/${id}`, {
      headers: directusHeaders(),
      params: { fields: 'id,performer' },
    });
    const show = checkRes.data?.data;
    if (!show || String(show.performer) !== String(performer.id)) {
      return res.status(403).json({ error: 'Not your show' });
    }

    const allowed = ['title', 'description', 'scheduled_at', 'duration_minutes', 'category', 'is_premium', 'status'];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const updateRes = await axios.patch(`${DIRECTUS_URL}/items/shows/${id}`, patch, {
      headers: directusHeaders(),
    });
    return res.json({ success: true, show: updateRes.data?.data });
  } catch (err) {
    logger.error('cms.updateShow error', err);
    return res.status(500).json({ error: 'Failed to update show' });
  }
};

const deleteShow = async (req, res) => {
  try {
    const user = await requireActiveCreator(req, res);
    if (!user) return;

    const performer = await getOrCreatePerformer(user.pnptv_id, user);
    const { id } = req.params;

    const checkRes = await axios.get(`${DIRECTUS_URL}/items/shows/${id}`, {
      headers: directusHeaders(),
      params: { fields: 'id,performer' },
    });
    const show = checkRes.data?.data;
    if (!show || String(show.performer) !== String(performer.id)) {
      return res.status(403).json({ error: 'Not your show' });
    }

    await axios.delete(`${DIRECTUS_URL}/items/shows/${id}`, { headers: directusHeaders() });
    return res.json({ success: true });
  } catch (err) {
    logger.error('cms.deleteShow error', err);
    return res.status(500).json({ error: 'Failed to delete show' });
  }
};

// ─── File Upload ──────────────────────────────────────────────────────────────

const uploadMedia = [
  mediaUpload.single('file'),
  async (req, res) => {
    try {
      const user = await requireActiveCreator(req, res);
      if (!user) return;

      if (!req.file) return res.status(400).json({ error: 'No file provided' });

      const form = new FormData();
      form.append('file', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      // Optional folder
      if (req.body.folder) form.append('folder', req.body.folder);

      const uploadRes = await axios.post(`${DIRECTUS_URL}/files`, form, {
        headers: { ...directusHeaders(), ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const file = uploadRes.data?.data;
      return res.json({
        success: true,
        fileId: file?.id,
        url: `${process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app'}/assets/${file?.id}`,
      });
    } catch (err) {
      logger.error('cms.uploadMedia error', err?.response?.data || err);
      return res.status(500).json({ error: 'File upload failed' });
    }
  },
];

module.exports = {
  getProfile,
  updateProfile,
  listContent,
  createContent,
  updateContent,
  deleteContent,
  listShows,
  createShow,
  updateShow,
  deleteShow,
  uploadMedia,
};
