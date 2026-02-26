const axios = require('axios');
const db = require('../../utils/db');
const logger = require('../../utils/logger');

const X_API_BASE = 'https://api.twitter.com/2';

class XFollowersService {
  /**
   * Get bearer token for followers app (separate from posts app)
   * Uses dedicated X_FOLLOWERS app credentials
   */
  static getBearerToken() {
    // Prefer dedicated followers app token
    const followersToken = process.env.X_FOLLOWERS_BEARER_TOKEN;
    if (followersToken && !followersToken.startsWith('YOUR_')) {
      return followersToken;
    }

    // Fallback to main bearer token
    const mainToken = process.env.TWITTER_BEARER_TOKEN;
    if (mainToken && !mainToken.startsWith('YOUR_')) {
      return mainToken;
    }

    // Last resort: access token
    return process.env.TWITTER_ACCESS_TOKEN;
  }

  /**
   * Get followers of a user
   * @param {string} userId - X/Twitter user ID
   * @param {number} maxResults - Pagination limit (10-100, default 100)
   * @param {string} paginationToken - For fetching next page
   */
  static async getFollowers(userId, maxResults = 100, paginationToken = null) {
    try {
      const bearerToken = this.getBearerToken();

      const params = new URLSearchParams({
        'user.fields': 'id,name,username,created_at,public_metrics',
        'max_results': Math.min(Math.max(maxResults, 10), 100),
      });

      if (paginationToken) {
        params.append('pagination_token', paginationToken);
      }

      const response = await axios.get(
        `${X_API_BASE}/users/${userId}/followers?${params.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'User-Agent': 'PNPtvBot/1.0',
          },
        }
      );

      return {
        followers: response.data.data || [],
        nextToken: response.data.meta?.next_token || null,
        meta: response.data.meta || {},
      };
    } catch (error) {
      logger.error('Error fetching followers', {
        userId,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * Get users that this account is following
   */
  static async getFollowing(userId, maxResults = 100, paginationToken = null) {
    try {
      const bearerToken = this.getBearerToken();

      const params = new URLSearchParams({
        'user.fields': 'id,name,username,created_at,public_metrics',
        'max_results': Math.min(Math.max(maxResults, 10), 100),
      });

      if (paginationToken) {
        params.append('pagination_token', paginationToken);
      }

      const response = await axios.get(
        `${X_API_BASE}/users/${userId}/following?${params.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'User-Agent': 'PNPtvBot/1.0',
          },
        }
      );

      return {
        following: response.data.data || [],
        nextToken: response.data.meta?.next_token || null,
        meta: response.data.meta || {},
      };
    } catch (error) {
      logger.error('Error fetching following', {
        userId,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * Unfollow a user (requires user context - uses auth token)
   */
  static async unfollowUser(userId, targetUserId) {
    try {
      const bearerToken = this.getBearerToken();

      const response = await axios.delete(
        `${X_API_BASE}/users/${userId}/following/${targetUserId}`,
        {
          headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'User-Agent': 'PNPtvBot/1.0',
          },
        }
      );

      return {
        success: response.data.data?.following === false,
        data: response.data.data,
      };
    } catch (error) {
      logger.error('Error unfollowing user', {
        userId,
        targetUserId,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * Get all followers (paginated)
   */
  static async getAllFollowers(userId) {
    const allFollowers = [];
    let paginationToken = null;
    let page = 0;
    const maxPages = 50; // Safety limit

    try {
      while (page < maxPages) {
        const result = await this.getFollowers(userId, 100, paginationToken);
        allFollowers.push(...result.followers);

        if (!result.nextToken) break;

        paginationToken = result.nextToken;
        page++;

        // Rate limiting: wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('Fetched all followers', { userId, count: allFollowers.length, pages: page });
      return allFollowers;
    } catch (error) {
      logger.error('Error fetching all followers', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get all following (paginated)
   */
  static async getAllFollowing(userId) {
    const allFollowing = [];
    let paginationToken = null;
    let page = 0;
    const maxPages = 50; // Safety limit

    try {
      while (page < maxPages) {
        const result = await this.getFollowing(userId, 100, paginationToken);
        allFollowing.push(...result.following);

        if (!result.nextToken) break;

        paginationToken = result.nextToken;
        page++;

        // Rate limiting: wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('Fetched all following', { userId, count: allFollowing.length, pages: page });
      return allFollowing;
    } catch (error) {
      logger.error('Error fetching all following', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Find users to unfollow (not following back)
   */
  static async findNonMutuals(userId) {
    try {
      logger.info('Starting non-mutual analysis', { userId });

      // Fetch both lists in parallel
      const [followers, following] = await Promise.all([
        this.getAllFollowers(userId),
        this.getAllFollowing(userId),
      ]);

      // Create sets for fast lookup
      const followerIds = new Set(followers.map(f => f.id));
      const followingIds = new Set(following.map(f => f.id));

      // Find non-mutuals: people we follow but don't follow back
      const nonMutuals = following.filter(user => !followerIds.has(user.id));

      logger.info('Non-mutual analysis complete', {
        userId,
        followers: followers.length,
        following: following.length,
        nonMutuals: nonMutuals.length,
      });

      return {
        followers: followers.length,
        following: following.length,
        nonMutuals,
        nonMutualsCount: nonMutuals.length,
      };
    } catch (error) {
      logger.error('Error analyzing non-mutuals', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Unfollow all non-mutuals
   */
  static async unfollowNonMutuals(userId, dryRun = false) {
    try {
      const analysis = await this.findNonMutuals(userId);
      const { nonMutuals } = analysis;

      if (nonMutuals.length === 0) {
        logger.info('No non-mutuals to unfollow', { userId });
        return {
          totalNonMutuals: 0,
          unfollowed: 0,
          failed: 0,
          errors: [],
        };
      }

      const results = {
        totalNonMutuals: nonMutuals.length,
        unfollowed: 0,
        failed: 0,
        errors: [],
        dryRun,
      };

      for (const user of nonMutuals) {
        try {
          if (!dryRun) {
            await this.unfollowUser(userId, user.id);
          }

          results.unfollowed++;
          logger.info('Unfollowed user', { userId, targetUserId: user.id, username: user.username });

          // Rate limiting: wait 2 seconds between unfollows to avoid API limits
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          results.failed++;
          results.errors.push({
            username: user.username,
            userId: user.id,
            error: error.message,
          });
          logger.error('Failed to unfollow user', {
            userId,
            targetUserId: user.id,
            username: user.username,
            error: error.message,
          });
        }
      }

      logger.info('Unfollow non-mutuals complete', results);
      return results;
    } catch (error) {
      logger.error('Error unfollowing non-mutuals', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Save unfollow results to database for audit trail
   */
  static async saveUnfollowResults(userId, results) {
    try {
      const query = `
        INSERT INTO x_unfollow_logs (user_id, total_analyzed, total_unfollowed, total_failed, results, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
      `;

      await db.query(query, [
        userId,
        results.totalNonMutuals,
        results.unfollowed,
        results.failed,
        JSON.stringify(results),
      ]);

      logger.info('Unfollow results saved to database', { userId });
    } catch (error) {
      logger.error('Error saving unfollow results', { userId, error: error.message });
      // Don't throw, as this is non-critical
    }
  }
}

module.exports = XFollowersService;
