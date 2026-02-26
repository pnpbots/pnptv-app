const XFollowersService = require('../../services/xFollowersService');
const logger = require('../../../utils/logger');
const { validateTelegramWebAppInitData } = require('../../services/telegramWebAppAuth');
const { query } = require('../../../config/postgres');

const BOT_TOKEN = process.env.BOT_TOKEN;

const checkAdminRole = async (userId) => {
  try {
    const result = await query(
      'SELECT role FROM users WHERE id = $1',
      [String(userId)]
    );
    const user = result.rows[0];
    return user && (user.role === 'admin' || user.role === 'superadmin');
  } catch (error) {
    logger.error('Error checking admin role', { userId, error });
    return false;
  }
};

class XFollowersController {
  /**
   * GET /api/x/followers/non-mutuals
   * Analyze non-mutual followers (analyze without unfollowing)
   */
  static async analyzNonMutuals(req, res) {
    try {
      const { xUserId } = req.query;
      const initData = req.get('x-telegram-init-data');

      if (!xUserId) {
        return res.status(400).json({ error: 'xUserId required' });
      }

      if (!initData) {
        return res.status(401).json({ error: 'Telegram authentication required' });
      }

      // Validate Telegram init data
      const user = await validateTelegramWebAppInitData(initData, BOT_TOKEN);
      if (!user) {
        return res.status(401).json({ error: 'Invalid Telegram authentication' });
      }

      // Get access token from environment
      const accessToken = process.env.TWITTER_ACCESS_TOKEN;

      if (!accessToken || accessToken.startsWith('YOUR_')) {
        return res.status(401).json({ error: 'No valid X/Twitter access token configured' });
      }

      const analysis = await XFollowersService.findNonMutuals(xUserId, accessToken);

      res.json({
        success: true,
        data: analysis,
        message: `Found ${analysis.nonMutualsCount} non-mutual followers`,
      });
    } catch (error) {
      logger.error('Error analyzing non-mutuals', { error: error.message });
      res.status(500).json({
        error: 'Error analyzing non-mutuals',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/x/followers/unfollow-non-mutuals
   * Actually unfollow non-mutual followers
   */
  static async unfollowNonMutuals(req, res) {
    try {
      const { xUserId, dryRun = true } = req.body;
      const initData = req.get('x-telegram-init-data');

      if (!xUserId) {
        return res.status(400).json({ error: 'xUserId required' });
      }

      if (!initData) {
        return res.status(401).json({ error: 'Telegram authentication required' });
      }

      // Validate Telegram init data
      const user = await validateTelegramWebAppInitData(initData, BOT_TOKEN);
      if (!user) {
        return res.status(401).json({ error: 'Invalid Telegram authentication' });
      }

      // Require admin role
      const isAdmin = await checkAdminRole(user.id);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const accessToken = process.env.TWITTER_ACCESS_TOKEN;

      if (!accessToken || accessToken.startsWith('YOUR_')) {
        return res.status(401).json({ error: 'No valid X/Twitter access token configured' });
      }

      const results = await XFollowersService.unfollowNonMutuals(xUserId, accessToken, dryRun);

      // Save to database for audit trail
      await XFollowersService.saveUnfollowResults(xUserId, results);

      res.json({
        success: true,
        data: results,
        message: dryRun
          ? `Dry run: Would unfollow ${results.unfollowed} non-mutuals`
          : `Successfully unfollowed ${results.unfollowed} non-mutuals`,
      });
    } catch (error) {
      logger.error('Error unfollowing non-mutuals', { error: error.message });
      res.status(500).json({
        error: 'Error unfollowing non-mutuals',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/x/followers/stats
   * Get follower/following stats
   */
  static async getStats(req, res) {
    try {
      const { xUserId } = req.query;
      const initData = req.get('x-telegram-init-data');

      if (!xUserId) {
        return res.status(400).json({ error: 'xUserId required' });
      }

      if (!initData) {
        return res.status(401).json({ error: 'Telegram authentication required' });
      }

      // Validate Telegram init data
      const user = await validateTelegramWebAppInitData(initData, BOT_TOKEN);
      if (!user) {
        return res.status(401).json({ error: 'Invalid Telegram authentication' });
      }

      const accessToken = process.env.TWITTER_ACCESS_TOKEN;

      if (!accessToken || accessToken.startsWith('YOUR_')) {
        return res.status(401).json({ error: 'No valid X/Twitter access token configured' });
      }

      // Quick stats without fetching all followers
      const [followers, following] = await Promise.all([
        XFollowersService.getFollowers(xUserId, accessToken, 1),
        XFollowersService.getFollowing(xUserId, accessToken, 1),
      ]);

      res.json({
        success: true,
        data: {
          followers: followers.meta?.result_count || 0,
          following: following.meta?.result_count || 0,
        },
      });
    } catch (error) {
      logger.error('Error fetching stats', { error: error.message });
      res.status(500).json({
        error: 'Error fetching stats',
        message: error.message,
      });
    }
  }
}

module.exports = XFollowersController;
