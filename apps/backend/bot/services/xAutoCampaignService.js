'use strict';

const db = require('../../utils/db');
const logger = require('../../utils/logger');
const GrokService = require('./grokService');
const XPostService = require('./xPostService');

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

let _cachedMediaFolderId = null;

const ITEMS_PER_PAGE = 20;

const ALLOWED_UPDATE_COLUMNS = new Set([
  'name', 'topic', 'grok_mode', 'language', 'custom_prompt',
  'interval_minutes', 'active_hours_start', 'active_hours_end', 'max_posts',
  'media_folder_id',
]);

class XAutoCampaignService {
  /**
   * Create a new campaign.
   */
  static async createCampaign({
    name, accountId, topic, grokMode = 'xPost', language = 'es',
    customPrompt = null, intervalMinutes = 240, activeHoursStart = 8,
    activeHoursEnd = 23, maxPosts = null, createdBy, createdByUsername,
    mediaFolderId = null,
  }) {
    const result = await db.query(
      `INSERT INTO x_auto_campaigns
        (name, account_id, topic, grok_mode, language, custom_prompt,
         interval_minutes, active_hours_start, active_hours_end, max_posts,
         created_by, created_by_username, media_folder_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING campaign_id`,
      [name, accountId, topic, grokMode, language, customPrompt,
       intervalMinutes, activeHoursStart, activeHoursEnd, maxPosts,
       createdBy, createdByUsername, mediaFolderId]
    );
    return result.rows[0].campaign_id;
  }

  /**
   * Update campaign config (allowlisted columns only).
   */
  static async updateCampaign(campaignId, fields) {
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      const snakeKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      if (!ALLOWED_UPDATE_COLUMNS.has(snakeKey)) continue;
      setClauses.push(`${snakeKey} = $${idx}`);
      values.push(value);
      idx++;
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = NOW()');
    values.push(campaignId);

    await db.query(
      `UPDATE x_auto_campaigns SET ${setClauses.join(', ')} WHERE campaign_id = $${idx}`,
      values
    );
  }

  /**
   * Get single campaign with account handle.
   */
  static async getCampaign(campaignId) {
    const result = await db.query(
      `SELECT c.*, a.handle, a.display_name AS account_display_name
       FROM x_auto_campaigns c
       LEFT JOIN x_accounts a ON a.account_id = c.account_id
       WHERE c.campaign_id = $1`,
      [campaignId]
    );
    return result.rows[0] || null;
  }

  /**
   * List campaigns with pagination and optional status filter.
   */
  static async listCampaigns({ status = null, page = 1, limit = ITEMS_PER_PAGE } = {}) {
    const offset = (page - 1) * limit;
    const params = [];
    let where = '';

    if (status) {
      params.push(status);
      where = `WHERE c.status = $${params.length}`;
    }

    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const [campaignsResult, countResult] = await Promise.all([
      db.query(
        `SELECT c.*, a.handle, a.display_name AS account_display_name
         FROM x_auto_campaigns c
         LEFT JOIN x_accounts a ON a.account_id = c.account_id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      ),
      db.query(
        `SELECT COUNT(*) AS total FROM x_auto_campaigns c ${where}`,
        status ? [status] : []
      ),
    ]);

    return {
      campaigns: campaignsResult.rows,
      total: parseInt(countResult.rows[0].total) || 0,
    };
  }

  /**
   * Pause a campaign.
   */
  static async pauseCampaign(campaignId) {
    await db.query(
      `UPDATE x_auto_campaigns
       SET status = 'paused', next_run_at = NULL, updated_at = NOW()
       WHERE campaign_id = $1`,
      [campaignId]
    );
  }

  /**
   * Resume a campaign — set active and schedule next run.
   */
  static async resumeCampaign(campaignId) {
    await db.query(
      `UPDATE x_auto_campaigns
       SET status = 'active',
           next_run_at = NOW() + (interval_minutes || ' minutes')::INTERVAL,
           updated_at = NOW()
       WHERE campaign_id = $1`,
      [campaignId]
    );
  }

  /**
   * Delete a campaign. Posts keep campaign_id = NULL via ON DELETE SET NULL.
   */
  static async deleteCampaign(campaignId) {
    await db.query('DELETE FROM x_auto_campaigns WHERE campaign_id = $1', [campaignId]);
  }

  /**
   * Get aggregate stats.
   */
  static async getStats() {
    const result = await db.query(`
      SELECT
        COUNT(*) AS total_campaigns,
        COUNT(*) FILTER (WHERE status = 'active') AS active_campaigns,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused_campaigns,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_campaigns,
        COALESCE(SUM(total_generated), 0) AS total_generated,
        COALESCE(SUM(total_posted), 0) AS total_posted,
        COALESCE(SUM(total_failed), 0) AS total_failed
      FROM x_auto_campaigns
    `);
    const row = result.rows[0];
    return {
      totalCampaigns: parseInt(row.total_campaigns) || 0,
      activeCampaigns: parseInt(row.active_campaigns) || 0,
      pausedCampaigns: parseInt(row.paused_campaigns) || 0,
      completedCampaigns: parseInt(row.completed_campaigns) || 0,
      totalGenerated: parseInt(row.total_generated) || 0,
      totalPosted: parseInt(row.total_posted) || 0,
      totalFailed: parseInt(row.total_failed) || 0,
    };
  }

  /**
   * Get due campaigns atomically (FOR UPDATE SKIP LOCKED).
   * Advances next_run_at immediately to prevent double-processing.
   */
  static async getDueCampaigns() {
    const result = await db.query(`
      UPDATE x_auto_campaigns
      SET next_run_at = NOW() + (interval_minutes || ' minutes')::INTERVAL,
          updated_at = NOW()
      WHERE campaign_id IN (
        SELECT campaign_id FROM x_auto_campaigns
        WHERE status = 'active'
          AND next_run_at IS NOT NULL
          AND next_run_at <= NOW()
          AND EXTRACT(HOUR FROM NOW()) >= active_hours_start
          AND EXTRACT(HOUR FROM NOW()) < active_hours_end
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    return result.rows;
  }

  /**
   * Core: generate content via Grok and queue into x_post_jobs.
   */
  static async generateAndQueue(campaign) {
    const prompt = campaign.custom_prompt
      ? `${campaign.topic}\n\nAdditional instructions: ${campaign.custom_prompt}`
      : campaign.topic;

    const langMap = { es: 'Spanish', en: 'English', bilingual: 'Spanish' };
    const grokLanguage = langMap[campaign.language] || 'Spanish';

    // Generate text via Grok
    const grokResponse = await GrokService.chat({
      mode: campaign.grok_mode,
      language: grokLanguage,
      prompt,
    });

    // For xPost mode, Grok returns 3 options (A/B/C) — pick one randomly
    let postText = grokResponse;
    if (campaign.grok_mode === 'xPost') {
      postText = this._extractRandomOption(grokResponse);
    }

    // Normalize for X character limits and ensure required links
    const requiredLinks = ['pnptv.app'];
    const { text: normalizedText } = XPostService.ensureRequiredLinks(postText, requiredLinks);

    // Attach a random video if campaign has media folder
    let mediaUrl = null;
    if (campaign.media_folder_id) {
      try {
        mediaUrl = await this._getRandomMediaUrl(campaign.media_folder_id);
      } catch (err) {
        logger.warn('Failed to get random media for campaign', {
          campaignId: campaign.campaign_id, error: err.message,
        });
      }
    }

    // Queue into existing x_post_jobs pipeline
    const postId = await XPostService.createPostJob({
      accountId: campaign.account_id,
      adminId: campaign.created_by,
      adminUsername: campaign.created_by_username || 'auto-campaign',
      text: normalizedText,
      mediaUrl,
      scheduledAt: new Date(),
      status: 'scheduled',
    });

    // Link campaign_id
    await db.query(
      'UPDATE x_post_jobs SET campaign_id = $1 WHERE post_id = $2',
      [campaign.campaign_id, postId]
    );

    // Update campaign counters
    const updateResult = await db.query(
      `UPDATE x_auto_campaigns
       SET total_generated = total_generated + 1,
           last_generated_at = NOW(),
           updated_at = NOW()
       WHERE campaign_id = $1
       RETURNING total_generated, max_posts`,
      [campaign.campaign_id]
    );

    // Auto-complete if max_posts reached
    const updated = updateResult.rows[0];
    if (updated.max_posts && updated.total_generated >= updated.max_posts) {
      await db.query(
        `UPDATE x_auto_campaigns SET status = 'completed', updated_at = NOW()
         WHERE campaign_id = $1`,
        [campaign.campaign_id]
      );
    }

    logger.info('Auto campaign generated post', {
      campaignId: campaign.campaign_id,
      postId,
      textLength: normalizedText.length,
    });

    return postId;
  }

  /**
   * Record a generation failure — increment counter, advance next_run_at.
   */
  static async recordFailure(campaignId) {
    await db.query(
      `UPDATE x_auto_campaigns
       SET total_failed = total_failed + 1, updated_at = NOW()
       WHERE campaign_id = $1`,
      [campaignId]
    );
  }

  /**
   * Get post history for a campaign (paginated).
   */
  static async getCampaignHistory(campaignId, page = 1, limit = ITEMS_PER_PAGE) {
    const offset = (page - 1) * limit;

    const [postsResult, countResult] = await Promise.all([
      db.query(
        `SELECT j.post_id, j.text, j.status, j.scheduled_at, j.sent_at,
                j.error_message, j.created_at, a.handle
         FROM x_post_jobs j
         LEFT JOIN x_accounts a ON a.account_id = j.account_id
         WHERE j.campaign_id = $1
         ORDER BY j.created_at DESC
         LIMIT $2 OFFSET $3`,
        [campaignId, limit, offset]
      ),
      db.query(
        'SELECT COUNT(*) AS total FROM x_post_jobs WHERE campaign_id = $1',
        [campaignId]
      ),
    ]);

    return {
      posts: postsResult.rows,
      total: parseInt(countResult.rows[0].total) || 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Directus media folder integration
  // ---------------------------------------------------------------------------

  /**
   * Ensure the "X Campaign Videos" folder exists in Directus, creating it if needed.
   * Returns the folder UUID.
   */
  static async ensureMediaFolder() {
    if (_cachedMediaFolderId) return _cachedMediaFolderId;

    if (!DIRECTUS_TOKEN) {
      throw new Error('DIRECTUS_ADMIN_TOKEN not configured');
    }

    // Check if folder already exists
    const searchRes = await fetch(
      `${DIRECTUS_URL}/folders?filter[name][_eq]=X Campaign Videos`,
      { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } }
    );
    const searchData = await searchRes.json();

    if (searchData.data && searchData.data.length > 0) {
      _cachedMediaFolderId = searchData.data[0].id;
      return _cachedMediaFolderId;
    }

    // Create the folder
    const createRes = await fetch(`${DIRECTUS_URL}/folders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'X Campaign Videos' }),
    });
    const createData = await createRes.json();

    if (!createData.data?.id) {
      throw new Error('Failed to create Directus media folder');
    }

    _cachedMediaFolderId = createData.data.id;
    logger.info('Created Directus folder "X Campaign Videos"', { folderId: _cachedMediaFolderId });
    return _cachedMediaFolderId;
  }

  /**
   * Pick a random video URL from a Directus folder.
   * Returns the asset URL or null if no videos found.
   */
  static async _getRandomMediaUrl(folderId) {
    if (!DIRECTUS_TOKEN) return null;

    const res = await fetch(
      `${DIRECTUS_URL}/files?filter[folder][_eq]=${folderId}&filter[type][_starts_with]=video&fields[]=id&limit=200`,
      { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } }
    );
    const data = await res.json();

    if (!data.data || data.data.length === 0) return null;

    const randomFile = data.data[Math.floor(Math.random() * data.data.length)];
    return `${DIRECTUS_URL}/assets/${randomFile.id}`;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract a random option from Grok's xPost response (3 options A/B/C).
   */
  static _extractRandomOption(text) {
    // Try to split by "OPCIÓN A", "OPCIÓN B", "OPCIÓN C" patterns
    const optionRegex = /OPCI[OÓ]N\s+[ABC][\s:.\-—]*([\s\S]*?)(?=OPCI[OÓ]N\s+[ABC]|$)/gi;
    const matches = [];
    let match;
    while ((match = optionRegex.exec(text)) !== null) {
      const cleaned = match[1].trim();
      if (cleaned) matches.push(cleaned);
    }

    if (matches.length > 0) {
      return matches[Math.floor(Math.random() * matches.length)];
    }

    // Fallback: try splitting by numbered options (1., 2., 3.)
    const numbered = text.split(/\n\s*[123]\.\s+/).filter(Boolean);
    if (numbered.length > 1) {
      return numbered[Math.floor(Math.random() * numbered.length)].trim();
    }

    // Last resort: return the full text
    return text.trim();
  }
}

module.exports = XAutoCampaignService;
