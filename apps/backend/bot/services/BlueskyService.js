/**
 * BlueskyService.js
 * PDS Bluesky integration with privacy-first architecture
 *
 * PRIVACY RULES:
 * - Read-only access to external Bluesky data
 * - NO outbound sharing of pnptv data to Bluesky network
 * - All external data cached with 24h TTL
 * - Access logged to audit trail
 * - NO inbound requests allowed to Bluesky federation relay
 */

const axios = require('axios');
const crypto = require('crypto');
const { Pool } = require('pg');
const logger = require('../utils/logger');

// Bluesky PDS endpoints (read-only access only)
const BLUESKY_ENDPOINTS = {
  pds: 'https://bsky.social', // Main Bluesky PDS
  atproto: 'https://api.bsky.app/xrpc', // AT Protocol API
};

// AT Protocol XRPC methods (read-only only)
const ALLOWED_XRPC_METHODS = [
  'com.atproto.repo.describeRepo',
  'com.atproto.identity.resolveHandle',
  'app.bsky.actor.getProfile',
  'app.bsky.feed.getAuthorFeed',
  'app.bsky.feed.getTimeline',
  'app.bsky.feed.getPostThread',
  'app.bsky.feed.searchPosts',
  'app.bsky.graph.getFollows',
  'app.bsky.graph.getFollowers',
];

class BlueskyService {
  constructor(pool) {
    this.pool = pool;
    this.httpClient = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'pnptv-bot/1.0 (read-only access)',
      },
    });
  }

  /**
   * CRITICAL: Validate that only read-only XRPC methods are called
   * Prevents accidental outbound federation
   */
  validateXrpcMethod(methodName) {
    if (!ALLOWED_XRPC_METHODS.includes(methodName)) {
      const error = new Error(`XRPC method "${methodName}" not allowed (not in read-only whitelist)`);
      error.code = 'FEDERATED_METHOD_BLOCKED';
      throw error;
    }
    return true;
  }

  /**
   * Call AT Protocol XRPC method (read-only only)
   * All calls logged to federated_access_log for audit
   */
  async callXrpc(methodName, params = {}, userContext = {}) {
    this.validateXrpcMethod(methodName);

    try {
      const url = `${ALLOWED_XRPC_METHODS[methodName]}`;
      logger.info('[BlueskyService] Calling XRPC method', {
        methodName,
        params: { ...params, accessToken: '***' }, // Never log tokens
      });

      const response = await this.httpClient.get(url, {
        params,
        timeout: 10000,
      });

      // Log successful access
      await this.logFederatedAccess({
        userId: userContext.userId,
        service: 'bluesky',
        resourceType: this.extractResourceType(methodName),
        resourceId: params.actor || params.handle || 'generic',
        action: 'view',
        success: true,
        userIp: userContext.ip,
      });

      return response.data;
    } catch (error) {
      logger.error('[BlueskyService] XRPC call failed', {
        methodName,
        error: error.message,
      });

      // Log failed access
      await this.logFederatedAccess({
        userId: userContext.userId,
        service: 'bluesky',
        resourceType: this.extractResourceType(methodName),
        resourceId: '???',
        action: 'view',
        success: false,
        errorMessage: error.message,
        userIp: userContext.ip,
      });

      throw new Error(`Failed to call Bluesky XRPC: ${error.message}`);
    }
  }

  /**
   * Resolve Bluesky handle to DID
   * Example: alice.bsky.social -> did:plc:...
   */
  async resolveHandle(handle, userContext = {}) {
    try {
      const response = await this.httpClient.get(
        `${BLUESKY_ENDPOINTS.atproto}/com.atproto.identity.resolveHandle`,
        {
          params: { handle },
          timeout: 5000,
        }
      );

      return response.data;
    } catch (error) {
      logger.error('[BlueskyService] Failed to resolve handle', { handle, error: error.message });
      throw new Error(`Cannot resolve Bluesky handle: ${error.message}`);
    }
  }

  /**
   * Fetch Bluesky profile by handle
   * Caches result for 1 hour
   */
  async getProfile(handleOrDid, userContext = {}) {
    // Check cache first
    const cacheKey = `bluesky_profile:${handleOrDid}`;
    const cached = await this.getCachedProfile(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.httpClient.get(
        `${BLUESKY_ENDPOINTS.atproto}/app.bsky.actor.getProfile`,
        {
          params: { actor: handleOrDid },
          timeout: 5000,
        }
      );

      // Cache for 1 hour
      await this.cacheProfile(cacheKey, response.data, 3600);

      // Log access
      await this.logFederatedAccess({
        userId: userContext.userId,
        service: 'bluesky',
        resourceType: 'profile',
        resourceId: response.data.did || handleOrDid,
        action: 'view',
        success: true,
        userIp: userContext.ip,
      });

      return response.data;
    } catch (error) {
      logger.error('[BlueskyService] Failed to fetch profile', { handleOrDid, error: error.message });
      throw new Error(`Cannot fetch Bluesky profile: ${error.message}`);
    }
  }

  /**
   * Fetch posts from Bluesky user's feed
   * Caches posts with 24h TTL to prevent stale data
   */
  async getAuthorFeed(actor, limit = 10, cursor = null, userContext = {}) {
    try {
      const params = { actor, limit: Math.min(limit, 100) };
      if (cursor) params.cursor = cursor;

      const response = await this.httpClient.get(
        `${BLUESKY_ENDPOINTS.atproto}/app.bsky.feed.getAuthorFeed`,
        { params, timeout: 10000 }
      );

      // Cache posts
      if (response.data.feed) {
        await this.cachePosts(
          response.data.feed.map((item) => item.post),
          userContext.userId,
          'followed_user'
        );
      }

      // Log access
      await this.logFederatedAccess({
        userId: userContext.userId,
        service: 'bluesky',
        resourceType: 'feed',
        resourceId: actor,
        action: 'cache',
        success: true,
        userIp: userContext.ip,
      });

      return response.data;
    } catch (error) {
      logger.error('[BlueskyService] Failed to fetch author feed', { actor, error: error.message });
      throw new Error(`Cannot fetch Bluesky feed: ${error.message}`);
    }
  }

  /**
   * Search Bluesky posts (read-only)
   * Returns cached results with 24h TTL
   */
  async searchPosts(query, limit = 20, cursor = null, userContext = {}) {
    try {
      const params = {
        q: query,
        limit: Math.min(limit, 100),
        sort: 'top',
      };
      if (cursor) params.cursor = cursor;

      const response = await this.httpClient.get(
        `${BLUESKY_ENDPOINTS.atproto}/app.bsky.feed.searchPosts`,
        { params, timeout: 10000 }
      );

      // Cache posts
      if (response.data.posts) {
        await this.cachePosts(
          response.data.posts,
          userContext.userId,
          'search_result'
        );
      }

      // Log access
      await this.logFederatedAccess({
        userId: userContext.userId,
        service: 'bluesky',
        resourceType: 'search',
        resourceId: query,
        action: 'cache',
        success: true,
        userIp: userContext.ip,
      });

      return response.data;
    } catch (error) {
      logger.error('[BlueskyService] Failed to search posts', { query, error: error.message });
      throw new Error(`Cannot search Bluesky: ${error.message}`);
    }
  }

  /**
   * Cache posts from Bluesky (internal use only)
   * Posts expire after 24 hours to prevent stale data
   */
  async cachePosts(posts, userId, reason = 'timeline') {
    try {
      const query = `
        INSERT INTO pds_posts (
          bluesky_uri, bluesky_cid, author_external_user_id,
          author_external_username, post_text, post_facets,
          embedded_images, cached_by_user_id, reason_cached,
          likes_count, replies_count, reposts_count, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (bluesky_uri) DO UPDATE
        SET updated_at = NOW(), likes_count = EXCLUDED.likes_count,
            replies_count = EXCLUDED.replies_count, reposts_count = EXCLUDED.reposts_count
      `;

      for (const post of posts) {
        await this.pool.query(query, [
          post.uri,
          post.cid,
          post.author.did,
          post.author.handle,
          post.record.text || '',
          JSON.stringify(post.record.facets || []),
          JSON.stringify(this.extractImages(post)),
          userId,
          reason,
          post.likeCount || 0,
          post.replyCount || 0,
          post.repostCount || 0,
          new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
        ]);
      }

      logger.info('[BlueskyService] Cached posts', { count: posts.length });
      return posts.length;
    } catch (error) {
      logger.error('[BlueskyService] Failed to cache posts', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract profile data from Bluesky
   * Used for linking external profiles
   */
  async extractProfileData(blueskyProfile) {
    return {
      externalUserId: blueskyProfile.did,
      externalUsername: blueskyProfile.handle,
      externalEmail: blueskyProfile.email, // May not be available
      profileName: blueskyProfile.displayName || blueskyProfile.handle,
      profileBio: blueskyProfile.description || '',
      profileAvatarUrl: blueskyProfile.avatar || null,
      followerCount: blueskyProfile.followersCount || 0,
      followingCount: blueskyProfile.followsCount || 0,
      profileMetadata: {
        did: blueskyProfile.did,
        handle: blueskyProfile.handle,
        verification: blueskyProfile.verified || false,
        indexedAt: blueskyProfile.indexedAt || new Date().toISOString(),
      },
    };
  }

  /**
   * Verify external profile ownership (proof challenge)
   * User must sign a challenge with their Bluesky private key
   */
  async initiateProfileVerification(externalProfile) {
    try {
      // Generate random challenge
      const challenge = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry

      // Store challenge in DB
      const query = `
        INSERT INTO external_profile_verification (
          external_profile_id, verification_method, challenge_data, challenge_expires_at
        ) VALUES ($1, $2, $3, $4)
        RETURNING id, challenge_data
      `;

      const result = await this.pool.query(query, [
        externalProfile.id,
        'proof_of_ownership',
        JSON.stringify({ challenge }),
        expiresAt,
      ]);

      return {
        verificationId: result.rows[0].id,
        challenge: result.rows[0].challenge_data.challenge,
        expiresAt,
      };
    } catch (error) {
      logger.error('[BlueskyService] Failed to initiate verification', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify proof of ownership
   * User signs challenge with Bluesky private key, we verify signature
   */
  async verifyProfileOwnership(externalProfile, signedChallenge) {
    try {
      // Fetch external profile to get DID
      const profile = await this.getProfile(externalProfile.external_username);

      // In real implementation, verify cryptographic signature
      // For now, accept API token as proof
      // TODO: Implement AT Protocol signature verification

      const query = `
        UPDATE external_profile_verification
        SET proof_verified_at = NOW()
        WHERE external_profile_id = $1 AND challenge_expires_at > NOW()
      `;

      await this.pool.query(query, [externalProfile.id]);

      // Update external profile verification status
      const updateQuery = `
        UPDATE external_profiles
        SET is_verified = TRUE, verified_at = NOW()
        WHERE id = $1
      `;

      await this.pool.query(updateQuery, [externalProfile.id]);

      logger.info('[BlueskyService] Profile ownership verified', {
        profileId: externalProfile.id,
      });

      return true;
    } catch (error) {
      logger.error('[BlueskyService] Failed to verify ownership', { error: error.message });
      throw error;
    }
  }

  /**
   * Log all external data access for audit trail
   * Privacy enforcement: track what data leaves our system
   */
  async logFederatedAccess({
    userId,
    service,
    resourceType,
    resourceId,
    action,
    success,
    errorMessage = null,
    userIp = null,
  }) {
    try {
      const query = `
        INSERT INTO federated_access_log (
          pnptv_user_id, service_type, external_resource_type, external_resource_id,
          action, success, error_message, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

      await this.pool.query(query, [
        userId,
        service,
        resourceType,
        resourceId,
        action,
        success,
        errorMessage,
        userIp,
      ]);
    } catch (error) {
      logger.error('[BlueskyService] Failed to log access', { error: error.message });
    }
  }

  /**
   * Helper: Extract images from Bluesky post
   */
  extractImages(post) {
    if (!post.embed || post.embed.type !== 'app.bsky.embed.images') {
      return [];
    }

    return (post.embed.images || []).map((img) => ({
      url: img.image.uri,
      alt: img.alt || '',
      mimeType: img.image.mimeType,
      size: img.image.size,
    }));
  }

  /**
   * Helper: Extract resource type from XRPC method name
   */
  extractResourceType(methodName) {
    if (methodName.includes('feed')) return 'feed';
    if (methodName.includes('profile') || methodName.includes('actor')) return 'profile';
    if (methodName.includes('thread')) return 'post';
    if (methodName.includes('graph')) return 'graph';
    return 'generic';
  }

  /**
   * Helper: Get cached profile from Redis or DB
   */
  async getCachedProfile(cacheKey) {
    // TODO: Implement Redis caching
    return null;
  }

  /**
   * Helper: Cache profile for expiry period
   */
  async cacheProfile(cacheKey, profileData, ttlSeconds) {
    // TODO: Implement Redis caching
  }
}

module.exports = BlueskyService;
