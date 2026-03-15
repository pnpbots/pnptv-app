'use strict';

/**
 * X Post Analytics Ingestion Scheduler
 *
 * Runs every 6 hours. Fetches engagement metrics (likes, retweets, replies,
 * impressions) for recently sent posts via X API v2 and upserts them into
 * the x_post_analytics table.
 *
 * Only processes posts sent in the last 7 days that haven't been fetched
 * in the last 6 hours, to stay within rate limits.
 */

const db = require('../../../utils/db');
const logger = require('../../../utils/logger');
const PaymentSecurityService = require('../../services/paymentSecurityService');
const { refreshAccountTokens } = require('../../services/xPostService');
const axios = require('axios');

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_SIZE = 20; // X API allows up to 100 tweet IDs per request
const X_API_BASE = 'https://api.twitter.com/2';

class XAnalyticsIngestionScheduler {
  constructor() {
    this.interval = null;
    this.isRunning = false;
    this.isProcessing = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // First run after 5 minutes (let other schedulers settle)
    setTimeout(() => this.ingest(), 5 * 60 * 1000);
    this.interval = setInterval(() => this.ingest(), POLL_INTERVAL_MS);
    logger.info('[XAnalyticsIngestion] Scheduler started (6h interval)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.isRunning = false;
      logger.info('[XAnalyticsIngestion] Scheduler stopped');
    }
  }

  async ingest() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Get sent posts from last 7 days that need analytics refresh
      const postsResult = await db.query(`
        SELECT j.post_id, j.account_id, j.campaign_id,
               j.response_json, j.sent_at
        FROM x_post_jobs j
        WHERE j.status = 'sent'
          AND j.sent_at >= NOW() - INTERVAL '7 days'
          AND j.response_json IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM x_post_analytics a
            WHERE a.post_id = j.post_id
              AND a.fetched_at >= NOW() - INTERVAL '6 hours'
          )
        ORDER BY j.sent_at DESC
        LIMIT 100
      `);

      const posts = postsResult.rows;
      if (posts.length === 0) {
        logger.debug('[XAnalyticsIngestion] No posts need analytics refresh');
        return;
      }

      // Group posts by account_id for batched API calls
      const byAccount = new Map();
      for (const post of posts) {
        let tweetId = null;
        try {
          const resp = typeof post.response_json === 'string'
            ? JSON.parse(post.response_json)
            : post.response_json;
          tweetId = resp?.data?.id;
        } catch { /* skip malformed response */ }

        if (!tweetId) continue;

        if (!byAccount.has(post.account_id)) {
          byAccount.set(post.account_id, []);
        }
        byAccount.get(post.account_id).push({
          postId: post.post_id,
          campaignId: post.campaign_id,
          tweetId,
        });
      }

      let totalFetched = 0;

      for (const [accountId, accountPosts] of byAccount) {
        try {
          const accessToken = await this._getAccessToken(accountId);
          if (!accessToken) continue;

          // Process in batches
          for (let i = 0; i < accountPosts.length; i += BATCH_SIZE) {
            const batch = accountPosts.slice(i, i + BATCH_SIZE);
            const tweetIds = batch.map(p => p.tweetId);
            const tweetIdToPost = new Map(batch.map(p => [p.tweetId, p]));

            try {
              const metrics = await this._fetchTweetMetrics(accessToken, tweetIds);

              for (const metric of metrics) {
                const postInfo = tweetIdToPost.get(metric.id);
                if (!postInfo) continue;

                await db.query(`
                  INSERT INTO x_post_analytics (post_id, campaign_id, impressions, likes, retweets, replies, link_clicks, fetched_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                  ON CONFLICT (post_id) DO UPDATE SET
                    impressions = EXCLUDED.impressions,
                    likes = EXCLUDED.likes,
                    retweets = EXCLUDED.retweets,
                    replies = EXCLUDED.replies,
                    link_clicks = EXCLUDED.link_clicks,
                    fetched_at = NOW()
                `, [
                  postInfo.postId,
                  postInfo.campaignId,
                  metric.impressions || 0,
                  metric.likes || 0,
                  metric.retweets || 0,
                  metric.replies || 0,
                  metric.linkClicks || 0,
                ]);

                totalFetched++;
              }
            } catch (batchErr) {
              logger.warn('[XAnalyticsIngestion] Batch fetch failed', {
                accountId,
                tweetIds: tweetIds.slice(0, 3),
                error: batchErr.message,
              });
            }
          }
        } catch (accountErr) {
          logger.warn('[XAnalyticsIngestion] Account processing failed', {
            accountId,
            error: accountErr.message,
          });
        }
      }

      if (totalFetched > 0) {
        logger.info('[XAnalyticsIngestion] Analytics ingested', {
          postsProcessed: totalFetched,
          accountsProcessed: byAccount.size,
        });
      }

      // Evaluate completed A/B tests (24h old with all variants sent)
      await this._evaluateABTests();

    } catch (err) {
      logger.error('[XAnalyticsIngestion] Ingestion failed', {
        error: err.message,
        stack: err.stack,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get a valid access token for an account.
   */
  async _getAccessToken(accountId) {
    try {
      const result = await db.query(
        `SELECT account_id, handle, encrypted_access_token, encrypted_refresh_token,
                token_expires_at, is_active, oauth_version
         FROM x_accounts WHERE account_id = $1`,
        [accountId]
      );
      const account = result.rows[0];
      if (!account || !account.is_active) return null;

      // OAuth 1.0a tokens don't expire — but v2 metrics endpoint needs OAuth2
      // Skip OAuth 1.0a accounts for now (they need app-level auth for metrics)
      if (account.oauth_version === '1.0a') return null;

      let decrypted;
      try {
        decrypted = PaymentSecurityService.decryptSensitiveData(account.encrypted_access_token);
      } catch {
        return null;
      }

      const accessToken = decrypted?.accessToken || decrypted?.token;
      const expiresAt = decrypted?.expiresAt ? new Date(decrypted.expiresAt) : account.token_expires_at;

      // Refresh if expiring soon
      if (expiresAt && expiresAt.getTime() - Date.now() <= 2 * 60 * 1000) {
        try {
          const refreshed = await refreshAccountTokens(account);
          return refreshed.accessToken;
        } catch {
          return null;
        }
      }

      return accessToken || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch tweet metrics from X API v2.
   * Uses the tweets lookup endpoint with public_metrics and non_public_metrics fields.
   */
  async _fetchTweetMetrics(accessToken, tweetIds) {
    if (!tweetIds.length) return [];

    try {
      const res = await axios.get(`${X_API_BASE}/tweets`, {
        params: {
          ids: tweetIds.join(','),
          'tweet.fields': 'public_metrics,non_public_metrics',
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 15000,
      });

      const tweets = res.data?.data || [];
      return tweets.map(tweet => {
        const pub = tweet.public_metrics || {};
        const nonPub = tweet.non_public_metrics || {};
        return {
          id: tweet.id,
          impressions: nonPub.impression_count || pub.impression_count || 0,
          likes: pub.like_count || 0,
          retweets: pub.retweet_count || 0,
          replies: pub.reply_count || 0,
          linkClicks: nonPub.url_link_clicks || 0,
        };
      });
    } catch (err) {
      // 401/403 = token can't read metrics (missing scope), skip silently
      if (err.response?.status === 401 || err.response?.status === 403) {
        logger.debug('[XAnalyticsIngestion] Token lacks metrics scope', {
          status: err.response.status,
        });
        return [];
      }
      throw err;
    }
  }

  /**
   * Evaluate A/B tests that are 24h+ old.
   * Sets winner_post_id to the variant with highest engagement_score.
   */
  async _evaluateABTests() {
    try {
      const testsResult = await db.query(`
        SELECT t.ab_test_id, t.variant_a, t.variant_b, t.variant_c
        FROM x_ab_tests t
        WHERE t.status = 'running'
          AND t.created_at <= NOW() - INTERVAL '24 hours'
        LIMIT 10
      `);

      for (const test of testsResult.rows) {
        const variantIds = [test.variant_a, test.variant_b, test.variant_c].filter(Boolean);
        if (variantIds.length === 0) continue;

        const scoresResult = await db.query(`
          SELECT post_id, engagement_score
          FROM x_post_analytics
          WHERE post_id = ANY($1)
          ORDER BY engagement_score DESC
          LIMIT 1
        `, [variantIds]);

        const winner = scoresResult.rows[0];
        await db.query(`
          UPDATE x_ab_tests
          SET status = 'completed',
              winner_post_id = $1,
              completed_at = NOW()
          WHERE ab_test_id = $2
        `, [winner?.post_id || null, test.ab_test_id]);

        logger.info('[XAnalyticsIngestion] A/B test evaluated', {
          abTestId: test.ab_test_id,
          winnerId: winner?.post_id,
          winnerScore: winner?.engagement_score,
        });
      }
    } catch (err) {
      logger.warn('[XAnalyticsIngestion] A/B test evaluation failed', {
        error: err.message,
      });
    }
  }
}

module.exports = XAnalyticsIngestionScheduler;
