'use strict';
const mentionService = require('../../services/mentionService');
const logger = require('../../utils/logger');

// GET /api/webapp/users/mention-search?q=username
async function mentionSearch(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { q } = req.query;
  if (!q || typeof q !== 'string') return res.json({ users: [] });

  const sanitized = q.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
  if (sanitized.length < 1) return res.json({ users: [] });

  try {
    const users = await mentionService.searchUsersForMention(sanitized);
    return res.json({ users });
  } catch (err) {
    logger.error('[mentionController] mentionSearch:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { mentionSearch };
