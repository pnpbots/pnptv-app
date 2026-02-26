/**
 * ExternalProfileService.js
 * Manages linking pnptv users to external Bluesky/Element profiles
 * Handles verification, privacy settings, and profile synchronization
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ExternalProfileService {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Link pnptv user to external Bluesky profile
   * Creates new external_profile record with verification pending
   */
  async linkBlueskyProfile(userId, blueskyHandle, blueskyDid, encryptedToken) {
    try {
      const query = `
        INSERT INTO external_profiles (
          pnptv_user_id, service_type, external_user_id, external_username,
          access_token_encrypted, is_verified
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (pnptv_user_id, service_type, external_user_id) DO UPDATE
        SET updated_at = NOW(), access_token_encrypted = $5
        RETURNING *
      `;

      const result = await this.pool.query(query, [
        userId,
        'bluesky',
        blueskyDid,
        blueskyHandle,
        encryptedToken, // Must be encrypted at controller level
        false, // Verification required
      ]);

      logger.info('[ExternalProfileService] Bluesky profile linked', {
        userId,
        handle: blueskyHandle,
        profileId: result.rows[0].id,
      });

      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to link profile', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch user's linked external profiles
   */
  async getUserExternalProfiles(userId, verified = null) {
    try {
      let query = `
        SELECT id, service_type, external_user_id, external_username,
               profile_name, profile_bio, profile_avatar_url,
               is_verified, verified_at, follower_count, following_count,
               show_on_profile, show_follower_count, show_activity_status,
               public_linking, last_synced_at, created_at
        FROM external_profiles
        WHERE pnptv_user_id = $1
      `;

      const params = [userId];

      if (verified !== null) {
        query += ` AND is_verified = $2`;
        params.push(verified);
      }

      query += ` ORDER BY created_at DESC`;

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to fetch profiles', { error: error.message });
      throw error;
    }
  }

  /**
   * Get single external profile by ID
   */
  async getExternalProfile(profileId) {
    try {
      const query = `
        SELECT * FROM external_profiles WHERE id = $1
      `;

      const result = await this.pool.query(query, [profileId]);

      if (result.rows.length === 0) {
        throw new Error('External profile not found');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to fetch profile', { error: error.message });
      throw error;
    }
  }

  /**
   * Update external profile metadata (sync with external service)
   */
  async syncProfileMetadata(profileId, profileData) {
    try {
      const query = `
        UPDATE external_profiles
        SET profile_name = $2,
            profile_bio = $3,
            profile_avatar_url = $4,
            profile_metadata = $5,
            follower_count = $6,
            following_count = $7,
            last_synced_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const result = await this.pool.query(query, [
        profileId,
        profileData.profileName,
        profileData.profileBio,
        profileData.profileAvatarUrl,
        JSON.stringify(profileData.profileMetadata),
        profileData.followerCount,
        profileData.followingCount,
      ]);

      logger.info('[ExternalProfileService] Profile metadata synced', { profileId });
      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to sync metadata', { error: error.message });
      throw error;
    }
  }

  /**
   * Update privacy settings for external profile display
   */
  async updatePrivacySettings(profileId, settings) {
    try {
      const query = `
        UPDATE external_profiles
        SET show_on_profile = $2,
            show_follower_count = $3,
            show_activity_status = $4,
            public_linking = $5,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const result = await this.pool.query(query, [
        profileId,
        settings.showOnProfile !== undefined ? settings.showOnProfile : true,
        settings.showFollowerCount !== undefined ? settings.showFollowerCount : true,
        settings.showActivityStatus !== undefined ? settings.showActivityStatus : true,
        settings.publicLinking !== undefined ? settings.publicLinking : false,
      ]);

      logger.info('[ExternalProfileService] Privacy settings updated', { profileId });
      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to update settings', { error: error.message });
      throw error;
    }
  }

  /**
   * Unlink external profile from pnptv account
   */
  async unlinkProfile(profileId) {
    try {
      const query = `
        DELETE FROM external_profiles
        WHERE id = $1
        RETURNING *
      `;

      const result = await this.pool.query(query, [profileId]);

      if (result.rows.length === 0) {
        throw new Error('Profile not found');
      }

      logger.info('[ExternalProfileService] Profile unlinked', { profileId });
      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to unlink', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify external profile ownership
   * Sets is_verified = true after proof is provided
   */
  async markProfileVerified(profileId) {
    try {
      const query = `
        UPDATE external_profiles
        SET is_verified = TRUE,
            verified_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const result = await this.pool.query(query, [profileId]);

      logger.info('[ExternalProfileService] Profile verified', { profileId });
      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to verify profile', { error: error.message });
      throw error;
    }
  }

  /**
   * Get feed preferences for user
   */
  async getFeedPreferences(userId) {
    try {
      let query = `
        SELECT * FROM pds_feed_preferences
        WHERE pnptv_user_id = $1
      `;

      const result = await this.pool.query(query, [userId]);

      // If no preferences exist, return defaults
      if (result.rows.length === 0) {
        return this.getDefaultPreferences(userId);
      }

      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to fetch preferences', { error: error.message });
      throw error;
    }
  }

  /**
   * Update feed preferences
   */
  async updateFeedPreferences(userId, preferences) {
    try {
      const query = `
        INSERT INTO pds_feed_preferences (
          pnptv_user_id, show_bluesky_feed, bluesky_feed_enabled,
          bluesky_auto_sync, muted_external_users, blocked_external_users,
          filter_retweets, filter_replies, show_element_rooms,
          element_notifications, combined_feed_order, external_content_ratio,
          public_activity, share_reading_history
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (pnptv_user_id) DO UPDATE
        SET show_bluesky_feed = COALESCE($2, EXCLUDED.show_bluesky_feed),
            bluesky_feed_enabled = COALESCE($3, EXCLUDED.bluesky_feed_enabled),
            bluesky_auto_sync = COALESCE($4, EXCLUDED.bluesky_auto_sync),
            muted_external_users = COALESCE($5, EXCLUDED.muted_external_users),
            blocked_external_users = COALESCE($6, EXCLUDED.blocked_external_users),
            filter_retweets = COALESCE($7, EXCLUDED.filter_retweets),
            filter_replies = COALESCE($8, EXCLUDED.filter_replies),
            show_element_rooms = COALESCE($9, EXCLUDED.show_element_rooms),
            element_notifications = COALESCE($10, EXCLUDED.element_notifications),
            combined_feed_order = COALESCE($11, EXCLUDED.combined_feed_order),
            external_content_ratio = COALESCE($12, EXCLUDED.external_content_ratio),
            public_activity = COALESCE($13, EXCLUDED.public_activity),
            share_reading_history = COALESCE($14, EXCLUDED.share_reading_history),
            updated_at = NOW()
        RETURNING *
      `;

      const result = await this.pool.query(query, [
        userId,
        preferences.showBlueskyFeed,
        preferences.blueskyFeedEnabled,
        preferences.blueskyAutoSync,
        JSON.stringify(preferences.mutedExternalUsers || []),
        JSON.stringify(preferences.blockedExternalUsers || []),
        preferences.filterRetweets,
        preferences.filterReplies,
        preferences.showElementRooms,
        preferences.elementNotifications,
        preferences.combinedFeedOrder,
        preferences.externalContentRatio,
        preferences.publicActivity,
        preferences.shareReadingHistory,
      ]);

      logger.info('[ExternalProfileService] Preferences updated', { userId });
      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to update preferences', { error: error.message });
      throw error;
    }
  }

  /**
   * Mute/unmute external user
   */
  async toggleMuteUser(userId, externalUserId, mute = true) {
    try {
      const preferences = await this.getFeedPreferences(userId);
      let mutedList = preferences.muted_external_users || [];

      if (mute) {
        // Add to muted list
        if (!mutedList.includes(externalUserId)) {
          mutedList.push(externalUserId);
        }
      } else {
        // Remove from muted list
        mutedList = mutedList.filter((id) => id !== externalUserId);
      }

      const query = `
        UPDATE pds_feed_preferences
        SET muted_external_users = $2, updated_at = NOW()
        WHERE pnptv_user_id = $1
        RETURNING *
      `;

      const result = await this.pool.query(query, [userId, JSON.stringify(mutedList)]);

      logger.info('[ExternalProfileService] User mute toggled', {
        userId,
        externalUserId,
        mute,
      });

      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to toggle mute', { error: error.message });
      throw error;
    }
  }

  /**
   * Block/unblock external user
   */
  async toggleBlockUser(userId, externalUserId, block = true) {
    try {
      const preferences = await this.getFeedPreferences(userId);
      let blockedList = preferences.blocked_external_users || [];

      if (block) {
        // Add to blocked list
        if (!blockedList.includes(externalUserId)) {
          blockedList.push(externalUserId);
        }
      } else {
        // Remove from blocked list
        blockedList = blockedList.filter((id) => id !== externalUserId);
      }

      const query = `
        UPDATE pds_feed_preferences
        SET blocked_external_users = $2, updated_at = NOW()
        WHERE pnptv_user_id = $1
        RETURNING *
      `;

      const result = await this.pool.query(query, [userId, JSON.stringify(blockedList)]);

      logger.info('[ExternalProfileService] User block toggled', {
        userId,
        externalUserId,
        block,
      });

      return result.rows[0];
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to toggle block', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch user's Bluesky feed (cached posts)
   */
  async getBlueskyFeed(userId, limit = 20, offset = 0) {
    try {
      // Get user's linked Bluesky profiles
      const profiles = await this.getUserExternalProfiles(userId);
      const blueskyProfiles = profiles.filter((p) => p.service_type === 'bluesky');

      if (blueskyProfiles.length === 0) {
        return { posts: [], total: 0 };
      }

      // Fetch cached posts from these profiles
      const userIds = blueskyProfiles.map((p) => p.external_user_id);

      const query = `
        SELECT * FROM pds_posts
        WHERE author_external_user_id = ANY($1)
        AND expires_at > NOW()
        AND cached_by_user_id = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
      `;

      const countResult = await this.pool.query(
        `SELECT COUNT(*) FROM pds_posts WHERE author_external_user_id = ANY($1) AND expires_at > NOW()`,
        [userIds]
      );

      const result = await this.pool.query(query, [userIds, userId, limit, offset]);

      return {
        posts: result.rows,
        total: parseInt(countResult.rows[0].count, 10),
      };
    } catch (error) {
      logger.error('[ExternalProfileService] Failed to fetch feed', { error: error.message });
      throw error;
    }
  }

  /**
   * Default feed preferences for new users
   */
  getDefaultPreferences(userId) {
    return {
      pnptv_user_id: userId,
      show_bluesky_feed: true,
      bluesky_feed_enabled: false,
      bluesky_auto_sync: false,
      muted_external_users: [],
      blocked_external_users: [],
      filter_retweets: false,
      filter_replies: false,
      show_element_rooms: true,
      element_notifications: true,
      element_auto_sync: false,
      combined_feed_order: 'recent',
      external_content_ratio: 30,
      public_activity: false,
      share_reading_history: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }
}

module.exports = ExternalProfileService;
