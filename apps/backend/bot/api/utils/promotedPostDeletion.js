const axios = require('axios');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL || process.env.DIRECTUS_URL || 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

async function archivePromotedSourceForSocialPost(postId) {
  const { rows } = await query(
    'SELECT id, is_promoted, directus_id FROM social_posts WHERE id = $1 LIMIT 1',
    [postId]
  );

  const post = rows[0];
  if (!post) return { exists: false, managed: false, archived: false };
  if (!post.is_promoted || !post.directus_id) {
    return { exists: true, managed: false, archived: false };
  }

  if (!DIRECTUS_TOKEN) {
    const err = new Error('Featured post is managed by CMS, but DIRECTUS_ADMIN_TOKEN is not configured');
    err.statusCode = 503;
    throw err;
  }

  try {
    await axios.patch(
      `${DIRECTUS_URL}/items/promoted_releases/${post.directus_id}`,
      { status: 'archived' },
      {
        headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
        timeout: 10000,
      }
    );
    return { exists: true, managed: true, archived: true, directusId: post.directus_id };
  } catch (err) {
    if (err?.response?.status === 404) {
      logger.warn('[PromotedDelete] Source item already missing in Directus', {
        postId,
        directusId: post.directus_id,
      });
      return { exists: true, managed: true, archived: true, directusId: post.directus_id };
    }
    const wrapped = new Error('Failed to archive featured post in CMS');
    wrapped.statusCode = 502;
    wrapped.cause = err;
    throw wrapped;
  }
}

module.exports = {
  archivePromotedSourceForSocialPost,
};
