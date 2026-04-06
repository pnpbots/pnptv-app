'use strict';

const axios = require('axios');
const logger = require('../../utils/logger');

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL || 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const DIRECTUS_PUBLIC_URL = process.env.DIRECTUS_PUBLIC_URL || 'https://cms.pnptv.app';

/**
 * GET /api/webapp/admin/overlay-library
 * Admin only. Returns all published overlay assets from the CMS.
 * Query params: ?type=logo|banner (optional filter)
 */
const listAssets = async (req, res) => {
  const user = req.session?.user;
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const filter = { status: { _eq: 'published' } };
    const typeParam = req.query.type;
    if (typeParam === 'logo' || typeParam === 'banner') {
      filter.type = { _eq: typeParam };
    }

    const resp = await axios.get(`${DIRECTUS_URL}/items/overlay_assets`, {
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
      params: {
        filter: JSON.stringify(filter),
        fields: 'id,type,name,image.id,image.filename_download,image.type,category,sort_order',
        sort: 'sort_order,name',
        limit: 200,
      },
      timeout: 10000,
    });

    const items = (resp.data?.data || []).map(item => ({
      id: item.id,
      type: item.type,
      name: item.name,
      category: item.category || null,
      sort_order: item.sort_order || 0,
      image_url: item.image?.id
        ? `${DIRECTUS_PUBLIC_URL}/assets/${item.image.id}`
        : null,
      image_filename: item.image?.filename_download || null,
      image_mime: item.image?.type || null,
    }));

    return res.json({ success: true, assets: items });
  } catch (err) {
    logger.error('overlayLibrary listAssets error', { error: err.message });
    return res.status(502).json({ error: 'Failed to load overlay library from CMS' });
  }
};

module.exports = { listAssets };
