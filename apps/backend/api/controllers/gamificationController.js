const gamificationService = require('../../services/gamificationService');
const { resolveUserId } = require('../../utils/helpers');

// GET /api/webapp/gamification/categories
async function getCategories(req, res) {
  try {
    const categories = await gamificationService.getCategories();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('getCategories error:', err);
    res.status(500).json({ success: false, error: 'Failed to load categories' });
  }
}

// GET /api/webapp/gamification/badges?category=wellness
async function getBadges(req, res) {
  try {
    const badges = await gamificationService.getBadges(req.query.category);
    res.json({ success: true, badges });
  } catch (err) {
    console.error('getBadges error:', err);
    res.status(500).json({ success: false, error: 'Failed to load badges' });
  }
}

// GET /api/webapp/gamification/user/:userId/badges
async function getUserBadges(req, res) {
  try {
    const userId = await resolveUserId(req.params.userId);
    if (!userId) return res.status(404).json({ success: false, error: 'User not found' });
    const badges = await gamificationService.getUserBadges(userId);
    res.json({ success: true, badges });
  } catch (err) {
    console.error('getUserBadges error:', err);
    res.status(500).json({ success: false, error: 'Failed to load user badges' });
  }
}

// POST /api/webapp/gamification/award (admin only)
async function awardBadge(req, res) {
  try {
    const { userId, badgeSlug, note } = req.body;
    if (!userId || !badgeSlug) return res.status(400).json({ success: false, error: 'userId and badgeSlug required' });
    const adminId = req.user?.id || null;
    const result = await gamificationService.awardBadge(userId, badgeSlug, adminId, note);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('awardBadge error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/webapp/gamification/revoke (admin only)
async function revokeBadge(req, res) {
  try {
    const { userId, badgeSlug } = req.body;
    if (!userId || !badgeSlug) return res.status(400).json({ success: false, error: 'userId and badgeSlug required' });
    const result = await gamificationService.revokeBadge(userId, badgeSlug);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('revokeBadge error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/webapp/gamification/award-creators-mecuido (admin only)
async function awardMeCuidoToCreators(req, res) {
  try {
    const adminId = req.user?.id || null;
    const result = await gamificationService.awardMeCuidoToCreators(adminId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('awardMeCuidoToCreators error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/webapp/gamification/badge/:badgeSlug/holders
async function getBadgeHolders(req, res) {
  try {
    const holders = await gamificationService.getBadgeHolders(req.params.badgeSlug);
    res.json({ success: true, holders });
  } catch (err) {
    console.error('getBadgeHolders error:', err);
    res.status(500).json({ success: false, error: 'Failed to load badge holders' });
  }
}

module.exports = { getCategories, getBadges, getUserBadges, awardBadge, revokeBadge, awardMeCuidoToCreators, getBadgeHolders };
