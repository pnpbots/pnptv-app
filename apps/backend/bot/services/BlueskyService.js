/**
 * BlueskyService.js
 * Public Bluesky/ATProto read-only integration with Redis caching.
 *
 * PRIVACY RULES:
 * - Read-only access to external Bluesky data (unauthenticated public XRPC)
 * - NO outbound sharing of PNPtv user data to Bluesky network
 * - All external data cached with TTL via Redis
 * - Access logged to audit trail
 * - For authenticated user actions (like, follow, cross-post) use atprotoController
 *   which operates via the user's own OAuth session.
 */

'use strict';

const axios = require('axios');
const { getRedis } = require('../../config/redis');
const logger = require('../../utils/logger');

// Public Bluesky AppView endpoints — no auth required
const BSKY_APPVIEW = 'https://public.api.bsky.app/xrpc';

// Whitelisted read-only XRPC methods for unauthenticated access
const ALLOWED_XRPC_METHODS = new Set([
  'com.atproto.repo.describeRepo',
  'com.atproto.identity.resolveHandle',
  'app.bsky.actor.getProfile',
  'app.bsky.actor.getProfiles',
  'app.bsky.feed.getAuthorFeed',
  'app.bsky.feed.getTimeline',
  'app.bsky.feed.getPostThread',
  'app.bsky.feed.searchPosts',
  'app.bsky.graph.getFollows',
  'app.bsky.graph.getFollowers',
]);

class BlueskyService {
  constructor(pool) {
    // pool is kept for backward compatibility with ExternalProfileController.
    // Direct DB writes now go through the query() helper, not pool.query().
    this.pool = pool;
    this.httpClient = axios.create({
      baseURL: BSKY_APPVIEW,
      timeout: 10000,
      headers: {
        'User-Agent': 'pnptv-app/2.0 (https://pnptv.app; read-only)',
        Accept: 'application/json',
      },
    });
  }

  /**
   * Validate that only read-only XRPC methods are called (prevent federation leak).
   */
  validateXrpcMethod(methodName) {
    if (!ALLOWED_XRPC_METHODS.has(methodName)) {
      const error = new Error(`XRPC method "${methodName}" not in read-only whitelist`);
      error.code = 'FEDERATED_METHOD_BLOCKED';
      throw error;
    }
    return true;
  }

  /**
   * Call a public (unauthenticated) AT Protocol XRPC method.
   * All calls are read-only; mutation methods are blocked by the whitelist.
   */
  async callXrpc(methodName, params = {}, userContext = {}) {
    this.validateXrpcMethod(methodName);

    try {
      const url = `/${methodName}`;
      logger.debug('[BlueskyService] Calling XRPC method', { methodName, params });

      const response = await this.httpClient.get(url, {
        params,
        timeout: 10000,
      });

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
      logger.error('[BlueskyService] XRPC call failed', { methodName, error: error.message });

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
   * Resolve Bluesky handle to DID using the public AppView.
   */
  async resolveHandle(handle, userContext = {}) {
    try {
      const response = await this.httpClient.get('/com.atproto.identity.resolveHandle', {
        params: { handle },
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      logger.error('[BlueskyService] Failed to resolve handle', { handle, error: error.message });
      throw new Error(`Cannot resolve Bluesky handle: ${error.message}`);
    }
  }

  /**
   * Fetch Bluesky profile by handle or DID.
   * Cached in Redis for 1 hour to avoid hammering the AppView.
   */
  async getProfile(handleOrDid, userContext = {}) {
    const cacheKey = `bsky:profile:${handleOrDid}`;
    const cached = await this.getCachedJson(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.httpClient.get('/app.bsky.actor.getProfile', {
        params: { actor: handleOrDid },
        timeout: 5000,
      });

      await this.setCachedJson(cacheKey, response.data, 3600); // 1-hour TTL

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
   * Fetch posts from a Bluesky user's public author feed.
   * Results are cached in Redis for 15 minutes.
   */
  async getAuthorFeed(actor, limit = 10, cursor = null, userContext = {}) {
    const cacheKey = `bsky:feed:${actor}:${limit}:${cursor || ''}`;
    const cached = await this.getCachedJson(cacheKey);
    if (cached) return cached;

    try {
      const params = { actor, limit: Math.min(limit, 100) };
      if (cursor) params.cursor = cursor;

      const response = await this.httpClient.get('/app.bsky.feed.getAuthorFeed', {
        params,
        timeout: 10000,
      });

      await this.setCachedJson(cacheKey, response.data, 900); // 15-minute TTL

      await this.logFederatedAccess({
        userId: userContext.userId,
        service: 'bluesky',
        resourceType: 'feed',
        resourceId: actor,
        action: 'view',
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
   * Search Bluesky posts (read-only, unauthenticated AppView).
   * Results are cached in Redis for 5 minutes.
   */
  async searchPosts(q, limit = 20, cursor = null, userContext = {}) {
    const cacheKey = `bsky:search:${q}:${limit}:${cursor || ''}`;
    const cached = await this.getCachedJson(cacheKey);
    if (cached) return cached;

    try {
      const params = { q, limit: Math.min(limit, 100), sort: 'top' };
      if (cursor) params.cursor = cursor;

      const response = await this.httpClient.get('/app.bsky.feed.searchPosts', {
        params,
        timeout: 10000,
      });

      await this.setCachedJson(cacheKey, response.data, 300); // 5-minute TTL

      await this.logFederatedAccess({
        userId: userContext.userId,
        service: 'bluesky',
        resourceType: 'search',
        resourceId: q,
        action: 'view',
        success: true,
        userIp: userContext.ip,
      });

      return response.data;
    } catch (error) {
      logger.error('[BlueskyService] Failed to search posts', { q, error: error.message });
      throw new Error(`Cannot search Bluesky: ${error.message}`);
    }
  }

  /**
   * Cache posts from Bluesky into the pds_posts table.
   * Posts expire after 24 hours to prevent stale data.
   */
  async cachePosts(posts, userId, reason = 'timeline') {
    if (!Array.isArray(posts) || posts.length === 0) return 0;

    const { query: dbQuery } = require('../../config/postgres');

    let cached = 0;
    for (const post of posts) {
      try {
        await dbQuery(
          `INSERT INTO pds_posts (
             bluesky_uri, bluesky_cid, author_external_user_id,
             author_external_username, post_text, post_facets,
             embedded_images, cached_by_user_id, reason_cached,
             likes_count, replies_count, reposts_count, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (bluesky_uri) DO UPDATE
           SET updated_at = NOW(),
               likes_count = EXCLUDED.likes_count,
               replies_count = EXCLUDED.replies_count,
               reposts_count = EXCLUDED.reposts_count,
               expires_at = EXCLUDED.expires_at`,
          [
            post.uri,
            post.cid,
            post.author.did,
            post.author.handle,
            post.record?.text || '',
            JSON.stringify(post.record?.facets || []),
            JSON.stringify(this.extractImages(post)),
            userId,
            reason,
            post.likeCount || 0,
            post.replyCount || 0,
            post.repostCount || 0,
            new Date(Date.now() + 24 * 60 * 60 * 1000),
          ],
          { cache: false }
        );
        cached++;
      } catch (err) {
        logger.warn('[BlueskyService] Failed to cache post', { uri: post.uri, err: err.message });
      }
    }

    logger.info('[BlueskyService] Cached posts to pds_posts', { cached, total: posts.length });
    return cached;
  }

  /**
   * Extract profile data from a raw Bluesky profile response.
   */
  async extractProfileData(blueskyProfile) {
    return {
      externalUserId: blueskyProfile.did,
      externalUsername: blueskyProfile.handle,
      externalEmail: null, // Not exposed by Bluesky AppView
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
   * Initiate profile ownership verification challenge.
   * The user must add the challenge token to their Bluesky profile description.
   */
  async initiateProfileVerification(externalProfile) {
    const { query: dbQuery } = require('../../config/postgres');
    const crypto = require('crypto');

    const challenge = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute expiry

    const result = await dbQuery(
      `INSERT INTO external_profile_verification (
         external_profile_id, verification_method, challenge_data, challenge_expires_at
       ) VALUES ($1, $2, $3, $4)
       RETURNING id, challenge_data`,
      [
        externalProfile.id,
        'description_token',
        JSON.stringify({ challenge }),
        expiresAt,
      ],
      { cache: false }
    );

    return {
      verificationId: result.rows[0].id,
      challenge: result.rows[0].challenge_data.challenge,
      expiresAt,
      instructions: `Add this token to your Bluesky profile description: pnptv-verify:${challenge}`,
    };
  }

  /**
   * Verify profile ownership by checking for the challenge token in the
   * user's live Bluesky profile description.
   */
  async verifyProfileOwnership(externalProfile, signedChallenge) {
    const { query: dbQuery } = require('../../config/postgres');

    // Fetch the live profile from Bluesky
    const liveProfile = await this.getProfile(externalProfile.external_username);

    // Check if the description contains the expected token
    const description = liveProfile.description || '';
    if (!description.includes(`pnptv-verify:${signedChallenge}`)) {
      throw new Error('Verification token not found in Bluesky profile description');
    }

    // Mark the verification record as verified
    await dbQuery(
      `UPDATE external_profile_verification
       SET proof_verified_at = NOW()
       WHERE external_profile_id = $1 AND challenge_expires_at > NOW()`,
      [externalProfile.id],
      { cache: false }
    );

    await dbQuery(
      `UPDATE external_profiles SET is_verified = TRUE, verified_at = NOW() WHERE id = $1`,
      [externalProfile.id],
      { cache: false }
    );

    logger.info('[BlueskyService] Profile ownership verified', { profileId: externalProfile.id });
    return true;
  }

  /**
   * Log all external data access for the audit trail.
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
      const { query: dbQuery } = require('../../config/postgres');
      await dbQuery(
        `INSERT INTO federated_access_log (
           pnptv_user_id, service_type, external_resource_type, external_resource_id,
           action, success, error_message, ip_address
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, service, resourceType, resourceId, action, success, errorMessage, userIp],
        { cache: false }
      );
    } catch (error) {
      // Non-blocking — log failure doesn't break the request
      logger.error('[BlueskyService] Failed to write audit log', { error: error.message });
    }
  }

  /**
   * Extract image attachments from a Bluesky post embed.
   */
  extractImages(post) {
    const embed = post.embed;
    if (!embed) return [];

    // Images embedded directly
    if (embed.$type === 'app.bsky.embed.images#view' && Array.isArray(embed.images)) {
      return embed.images.map((img) => ({
        url: img.thumb || img.fullsize || '',
        alt: img.alt || '',
        aspectRatio: img.aspectRatio || null,
      }));
    }

    // Images embedded inside a record-with-media
    if (
      embed.$type === 'app.bsky.embed.recordWithMedia#view' &&
      embed.media?.$type === 'app.bsky.embed.images#view'
    ) {
      return (embed.media.images || []).map((img) => ({
        url: img.thumb || img.fullsize || '',
        alt: img.alt || '',
        aspectRatio: img.aspectRatio || null,
      }));
    }

    return [];
  }

  /**
   * Derive a generic resource type label from an XRPC method name.
   */
  extractResourceType(methodName) {
    if (methodName.includes('feed')) return 'feed';
    if (methodName.includes('profile') || methodName.includes('actor')) return 'profile';
    if (methodName.includes('thread')) return 'post';
    if (methodName.includes('graph')) return 'graph';
    if (methodName.includes('identity')) return 'identity';
    return 'generic';
  }

  // ---------------------------------------------------------------------------
  // Redis Caching Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get a cached JSON value from Redis.
   * Returns null on miss or any error (fail-open).
   */
  async getCachedJson(key) {
    try {
      const redis = getRedis();
      const raw = await redis.get(`bluesky:cache:${key}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      logger.debug('[BlueskyService] Redis cache get failed (non-fatal)', { key, err: err.message });
      return null;
    }
  }

  /**
   * Store a value in Redis with a TTL (seconds).
   * Fails silently so cache errors never break the request.
   */
  async setCachedJson(key, value, ttlSeconds) {
    try {
      const redis = getRedis();
      await redis.set(`bluesky:cache:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.debug('[BlueskyService] Redis cache set failed (non-fatal)', { key, err: err.message });
    }
  }
}

module.exports = BlueskyService;
