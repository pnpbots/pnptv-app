/**
 * externalProfileController.js
 * API endpoints for linking and managing external profiles (Bluesky, Element)
 * All endpoints enforce privacy boundaries and read-only access
 */

const joi = require('joi');
const crypto = require('crypto');
const logger = require('../../utils/logger');

// Import services
const BlueskyService = require('../../services/BlueskyService');
const ExternalProfileService = require('../../services/ExternalProfileService');

// Validation schemas
const linkProfileSchema = joi.object({
  handle: joi.string().alphanum().required().messages({
    'string.alphanum': 'Bluesky handle must contain only alphanumeric characters and underscores',
    'any.required': 'Bluesky handle is required',
  }),
  serviceType: joi.string().valid('bluesky', 'element').default('bluesky'),
  publicLinking: joi.boolean().default(false),
});

const profilePrivacySchema = joi.object({
  showOnProfile: joi.boolean(),
  showFollowerCount: joi.boolean(),
  showActivityStatus: joi.boolean(),
  publicLinking: joi.boolean(),
});

const feedPreferencesSchema = joi.object({
  showBlueskyFeed: joi.boolean(),
  blueskyFeedEnabled: joi.boolean(),
  blueskyAutoSync: joi.boolean(),
  showElementRooms: joi.boolean(),
  elementNotifications: joi.boolean(),
  combinedFeedOrder: joi.string().valid('recent', 'engagement', 'relevance'),
  externalContentRatio: joi.number().min(0).max(100),
  publicActivity: joi.boolean(),
  shareReadingHistory: joi.boolean(),
});

const muteUserSchema = joi.object({
  externalUserId: joi.string().required(),
  mute: joi.boolean().default(true),
});

const blockUserSchema = joi.object({
  externalUserId: joi.string().required(),
  block: joi.boolean().default(true),
});

class ExternalProfileController {
  constructor(pool) {
    this.pool = pool;
    this.blueskyService = new BlueskyService(pool);
    this.externalProfileService = new ExternalProfileService(pool);
  }

  /**
   * GET /api/webapp/profile/external
   * Fetch user's linked external profiles
   */
  async getExternalProfiles(req, res) {
    try {
      const userId = req.user.id;

      const profiles = await this.externalProfileService.getUserExternalProfiles(userId);

      // Remove sensitive data
      const sanitized = profiles.map((p) => ({
        id: p.id,
        service_type: p.service_type,
        external_username: p.external_username,
        profile_name: p.profile_name,
        profile_bio: p.profile_bio,
        profile_avatar_url: p.profile_avatar_url,
        is_verified: p.is_verified,
        verified_at: p.verified_at,
        follower_count: p.show_follower_count ? p.follower_count : null,
        show_on_profile: p.show_on_profile,
        public_linking: p.public_linking,
        last_synced_at: p.last_synced_at,
        created_at: p.created_at,
      }));

      return res.json({
        success: true,
        data: {
          profiles: sanitized,
          total: sanitized.length,
        },
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to fetch profiles', {
        userId: req.user.id,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_PROFILES_FAILED',
          message: 'Failed to fetch external profiles',
        },
      });
    }
  }

  /**
   * POST /api/webapp/profile/external/link
   * Link Bluesky profile to pnptv account
   * Step 1: Initiate linking (user provides handle)
   */
  async initiateBlueskyLink(req, res) {
    try {
      const { error, value } = linkProfileSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const userId = req.user.id;
      const { handle } = value;

      // Fetch Bluesky profile to verify it exists
      const profile = await this.blueskyService.getProfile(handle, {
        userId,
        ip: this.extractClientIp(req),
      });

      if (!profile) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BLUESKY_PROFILE_NOT_FOUND',
            message: 'Bluesky profile not found',
          },
        });
      }

      // Create external profile record (unverified)
      const externalProfile = await this.externalProfileService.linkBlueskyProfile(
        userId,
        handle,
        profile.did,
        null // Token set in next step after verification
      );

      // Initiate verification challenge
      const verification = await this.blueskyService.initiateProfileVerification(externalProfile);

      // Extract profile data
      const profileData = await this.blueskyService.extractProfileData(profile);

      // Sync profile metadata
      await this.externalProfileService.syncProfileMetadata(externalProfile.id, profileData);

      return res.json({
        success: true,
        data: {
          profileId: externalProfile.id,
          externalUsername: profile.handle,
          profileName: profile.displayName || profile.handle,
          verificationId: verification.verificationId,
          challenge: verification.challenge,
          challengeExpiresAt: verification.expiresAt,
          nextStep: 'Provide proof of profile ownership by signing the challenge',
        },
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to initiate link', {
        userId: req.user.id,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'LINK_INITIATION_FAILED',
          message: 'Failed to initiate profile linking',
        },
      });
    }
  }

  /**
   * POST /api/webapp/profile/external/:profileId/verify
   * Verify external profile ownership
   * Step 2: User provides signed challenge as proof
   */
  async verifyProfileOwnership(req, res) {
    try {
      const { profileId } = req.params;
      const { signedChallenge, accessToken } = req.body;
      const userId = req.user.id;

      // Fetch profile
      const externalProfile = await this.externalProfileService.getExternalProfile(profileId);

      if (externalProfile.pnptv_user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'You do not own this external profile',
          },
        });
      }

      // Verify proof
      await this.blueskyService.verifyProfileOwnership(externalProfile, signedChallenge);

      // Encrypt and store access token
      const encryptedToken = this.encryptToken(accessToken);

      // Update profile with verified status and token
      const updated = await this.externalProfileService.markProfileVerified(profileId);

      return res.json({
        success: true,
        data: {
          profileId: updated.id,
          isVerified: true,
          verifiedAt: updated.verified_at,
          message: 'External profile verified and linked successfully',
        },
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Verification failed', {
        profileId: req.params.profileId,
        error: error.message,
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'Failed to verify profile ownership',
        },
      });
    }
  }

  /**
   * PATCH /api/webapp/profile/external/:profileId
   * Update external profile privacy settings
   */
  async updateProfileSettings(req, res) {
    try {
      const { profileId } = req.params;
      const { error, value } = profilePrivacySchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const userId = req.user.id;

      // Verify ownership
      const externalProfile = await this.externalProfileService.getExternalProfile(profileId);

      if (externalProfile.pnptv_user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'You do not own this external profile',
          },
        });
      }

      // Update settings
      const updated = await this.externalProfileService.updatePrivacySettings(profileId, value);

      return res.json({
        success: true,
        data: {
          profileId: updated.id,
          settings: {
            showOnProfile: updated.show_on_profile,
            showFollowerCount: updated.show_follower_count,
            showActivityStatus: updated.show_activity_status,
            publicLinking: updated.public_linking,
          },
        },
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to update settings', {
        profileId: req.params.profileId,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: 'Failed to update profile settings',
        },
      });
    }
  }

  /**
   * DELETE /api/webapp/profile/external/:profileId
   * Unlink external profile
   */
  async unlinkProfile(req, res) {
    try {
      const { profileId } = req.params;
      const userId = req.user.id;

      // Verify ownership
      const externalProfile = await this.externalProfileService.getExternalProfile(profileId);

      if (externalProfile.pnptv_user_id !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'You do not own this external profile',
          },
        });
      }

      // Unlink
      await this.externalProfileService.unlinkProfile(profileId);

      return res.json({
        success: true,
        data: {
          message: 'External profile unlinked successfully',
        },
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to unlink', {
        profileId: req.params.profileId,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'UNLINK_FAILED',
          message: 'Failed to unlink external profile',
        },
      });
    }
  }

  /**
   * GET /api/webapp/feed/preferences
   * Fetch user's feed preferences
   */
  async getFeedPreferences(req, res) {
    try {
      const userId = req.user.id;

      const preferences = await this.externalProfileService.getFeedPreferences(userId);

      return res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to fetch preferences', {
        userId: req.user.id,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_PREFERENCES_FAILED',
          message: 'Failed to fetch feed preferences',
        },
      });
    }
  }

  /**
   * PUT /api/webapp/feed/preferences
   * Update user's feed preferences
   */
  async updateFeedPreferences(req, res) {
    try {
      const { error, value } = feedPreferencesSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const userId = req.user.id;

      const updated = await this.externalProfileService.updateFeedPreferences(userId, value);

      return res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to update preferences', {
        userId: req.user.id,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_PREFERENCES_FAILED',
          message: 'Failed to update feed preferences',
        },
      });
    }
  }

  /**
   * POST /api/webapp/feed/mute
   * Mute external user
   */
  async muteUser(req, res) {
    try {
      const { error, value } = muteUserSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const userId = req.user.id;
      const { externalUserId, mute } = value;

      const updated = await this.externalProfileService.toggleMuteUser(
        userId,
        externalUserId,
        mute
      );

      return res.json({
        success: true,
        data: {
          message: mute ? 'User muted' : 'User unmuted',
          mutedCount: updated.muted_external_users.length,
        },
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to mute user', { error: error.message });

      return res.status(500).json({
        success: false,
        error: {
          code: 'MUTE_FAILED',
          message: 'Failed to mute user',
        },
      });
    }
  }

  /**
   * POST /api/webapp/feed/block
   * Block external user
   */
  async blockUser(req, res) {
    try {
      const { error, value } = blockUserSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const userId = req.user.id;
      const { externalUserId, block } = value;

      const updated = await this.externalProfileService.toggleBlockUser(
        userId,
        externalUserId,
        block
      );

      return res.json({
        success: true,
        data: {
          message: block ? 'User blocked' : 'User unblocked',
          blockedCount: updated.blocked_external_users.length,
        },
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to block user', { error: error.message });

      return res.status(500).json({
        success: false,
        error: {
          code: 'BLOCK_FAILED',
          message: 'Failed to block user',
        },
      });
    }
  }

  /**
   * GET /api/webapp/feed/bluesky
   * Fetch user's Bluesky feed
   */
  async getBlueskyFeed(req, res) {
    try {
      const userId = req.user.id;
      const { limit = 20, offset = 0 } = req.query;

      const feed = await this.externalProfileService.getBlueskyFeed(
        userId,
        Math.min(parseInt(limit, 10), 100),
        parseInt(offset, 10)
      );

      return res.json({
        success: true,
        data: feed,
      });
    } catch (error) {
      logger.error('[ExternalProfileController] Failed to fetch feed', {
        userId: req.user.id,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FEED_FAILED',
          message: 'Failed to fetch Bluesky feed',
        },
      });
    }
  }

  /**
   * Helper: Encrypt token for storage
   * Uses algorithm: AES-256-GCM
   */
  encryptToken(token) {
    const key = process.env.FEDERATION_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('FEDERATION_ENCRYPTION_KEY not configured');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);

    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Helper: Extract client IP
   */
  extractClientIp(req) {
    return (
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      'unknown'
    );
  }
}

module.exports = ExternalProfileController;
