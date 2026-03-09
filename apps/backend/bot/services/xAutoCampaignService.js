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
    const result = await db.query(
      `UPDATE x_auto_campaigns
       SET status = 'paused', next_run_at = NULL, updated_at = NOW()
       WHERE campaign_id = $1 AND status = 'active'`,
      [campaignId]
    );
    if (result.rowCount === 0) {
      throw new Error('Campaign not found or not in active status');
    }
  }

  /**
   * Resume a campaign — set active and schedule next run.
   */
  static async resumeCampaign(campaignId) {
    const result = await db.query(
      `UPDATE x_auto_campaigns
       SET status = 'active',
           next_run_at = NOW() + (interval_minutes || ' minutes')::INTERVAL,
           updated_at = NOW()
       WHERE campaign_id = $1 AND status = 'paused'`,
      [campaignId]
    );
    if (result.rowCount === 0) {
      throw new Error('Campaign not found or not in paused status');
    }
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
    // For all other modes, still strip any label artifacts Grok may have included
    let postText;
    if (campaign.grok_mode === 'xPost') {
      postText = this._extractRandomOption(grokResponse);
    } else {
      postText = this._stripOptionLabel(grokResponse);
    }

    // Smart truncation: X allows 280 chars, URLs count as 23 via t.co.
    // Reserve 24 chars (23 for link + 1 newline) for the pnptv.app link.
    const X_TEXT_BUDGET = 280 - 24; // 256 chars for text body
    if (postText.length > X_TEXT_BUDGET) {
      logger.warn('Post text exceeds X limit, smart-truncating', {
        campaignId: campaign.campaign_id,
        originalLength: postText.length,
        budget: X_TEXT_BUDGET,
      });
      postText = this._smartTruncate(postText, X_TEXT_BUDGET);
    }

    // Normalize for X character limits and ensure required links
    const requiredLinks = ['pnptv.app'];
    const { text: normalizedText } = XPostService.ensureRequiredLinks(postText, requiredLinks);

    // Attach a random video if campaign has media folder
    let mediaUrl = null;
    if (campaign.media_folder_id) {
      try {
        mediaUrl = await this._getRandomMediaUrl(campaign.media_folder_id, campaign.campaign_id);
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
   * Pick a random video URL from a Directus folder, avoiding recently used videos.
   * Tracks used media per campaign to prevent repeats until all videos have been used.
   * Returns the asset URL or null if no videos found.
   */
  static async _getRandomMediaUrl(folderId, campaignId = null) {
    if (!DIRECTUS_TOKEN) return null;

    const res = await fetch(
      `${DIRECTUS_URL}/files?filter[folder][_eq]=${folderId}&filter[type][_starts_with]=video&fields[]=id&limit=200`,
      { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } }
    );
    const data = await res.json();

    if (!data.data || data.data.length === 0) return null;

    const allIds = data.data.map((f) => f.id);

    // Get recently used media IDs for this campaign to avoid repeats
    let usedIds = new Set();
    if (campaignId) {
      try {
        const usedResult = await db.query(
          `SELECT media_url FROM x_post_jobs
           WHERE campaign_id = $1 AND media_url IS NOT NULL
           ORDER BY created_at DESC
           LIMIT $2`,
          [campaignId, Math.max(allIds.length - 1, 1)]
        );
        for (const row of usedResult.rows) {
          // Extract file ID from the Directus asset URL
          const match = row.media_url && row.media_url.match(/\/assets\/([a-f0-9-]+)/i);
          if (match) usedIds.add(match[1]);
        }
      } catch (err) {
        logger.warn('Failed to check used media for campaign', {
          campaignId, error: err.message,
        });
      }
    }

    // Filter out recently used videos
    let available = allIds.filter((id) => !usedIds.has(id));

    // If all videos have been used, reset and allow all
    if (available.length === 0) {
      available = allIds;
      logger.info('All media used for campaign, resetting pool', {
        campaignId, totalVideos: allIds.length,
      });
    }

    const chosen = available[Math.floor(Math.random() * available.length)];
    return `${DIRECTUS_URL}/assets/${chosen}`;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Smart truncate text to fit within a character budget.
   * Tries to cut at the last complete sentence, then at word boundary.
   * Removes any trailing incomplete URLs.
   */
  static _smartTruncate(text, maxChars) {
    if (text.length <= maxChars) return text;

    // Try cutting at the last sentence boundary (. ! ? followed by space or end)
    const sentenceRegex = /[.!?]\s/g;
    let lastSentenceEnd = -1;
    let match;
    while ((match = sentenceRegex.exec(text)) !== null) {
      if (match.index + 1 <= maxChars) {
        lastSentenceEnd = match.index + 1; // include the punctuation
      }
    }

    // If we found a sentence boundary with at least 40% of the budget used, use it
    if (lastSentenceEnd > maxChars * 0.4) {
      return text.slice(0, lastSentenceEnd).trim();
    }

    // Fall back to word boundary
    const truncated = text.slice(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.4) {
      let result = truncated.slice(0, lastSpace).trim();
      // Remove any trailing incomplete URL (e.g. "pnptv" or "pnptv.app/jo")
      result = result.replace(/\s+\S*\.?\S*$/, (m) => {
        // Only remove if it looks like a partial URL
        if (/https?:|\.app|\.com|pnptv/i.test(m)) return '';
        return m;
      });
      return result.trim();
    }

    return truncated.trim();
  }

  /**
   * Extract a random option from Grok's xPost response (3 options A/B/C).
   */
  static _extractRandomOption(text) {
    // Try to split by "OPCIÓN A/B/C" or "OPTION A/B/C" patterns
    const optionRegex = /(?:OPCI[OÓ]N|OPTION)\s+[ABC][\s:.\-—]*([\s\S]*?)(?=(?:OPCI[OÓ]N|OPTION)\s+[ABC]|$)/gi;
    const matches = [];
    let match;
    while ((match = optionRegex.exec(text)) !== null) {
      const cleaned = this._stripOptionLabel(match[1].trim());
      if (cleaned) matches.push(cleaned);
    }

    if (matches.length > 0) {
      return matches[Math.floor(Math.random() * matches.length)];
    }

    // Fallback: try splitting by "Post 1 (Focus: ...)" / "Post 2 —" patterns
    const postSections = text.split(/\n(?=Post\s+\d+[\s(—\-:])/i).filter(Boolean);
    if (postSections.length > 1) {
      const chosen = postSections[Math.floor(Math.random() * postSections.length)].trim();
      return this._stripOptionLabel(chosen);
    }

    // Fallback: try splitting by numbered options (1., 2., 3.)
    const numbered = text.split(/\n\s*[123]\.\s+/).filter(Boolean);
    if (numbered.length > 1) {
      return this._stripOptionLabel(numbered[Math.floor(Math.random() * numbered.length)].trim());
    }

    // Last resort: return the full text stripped of any leading label
    return this._stripOptionLabel(text.trim());
  }

  /**
   * Remove any leading option label line from extracted tweet text.
   * Handles all label formats Grok has been observed to output:
   *   "OPTION A (El Gancho Directo):\n..."
   *   "(El Aportador de Valor):\n..."
   *   "El Gancho Directo:\n..."
   *   "Post 1 (Focus: Launch Hype)\n..."
   *   "**Post 1 (Focus: ...)**\n..."
   */
  static _stripOptionLabel(text) {
    return text
      // "OPCIÓN A / OPTION A ..." at line start (with or without trailing newline)
      .replace(/^[\s]*(?:OPCI[OÓ]N|OPTION)\s+[ABC][^\n]*\n?/gim, '')
      // "(El Gancho Directo):" or "(El Aportador de Valor):" — parenthesized label lines
      .replace(/^\s*\([^)\n]{2,60}\)\s*:?\s*\n?/gim, '')
      // "El Gancho Directo:" / "El Aportador de Valor:" bare label lines
      .replace(/^El\s+\w+[\s\w]{1,40}:\s*\n?/gim, '')
      // "Post 1 (Focus: ...)" or "Post 2 — ..." style series labels (whole line)
      .replace(/^Post\s+\d+[^\n]*\n?/gim, '')
      // "**Post 1 (Focus: ...)**" markdown-wrapped series labels
      .replace(/^\*{1,2}Post\s+\d+[^\n]*\*{0,2}\n?/gim, '')
      // Any remaining lone markdown-wrapped header lines e.g. **¡NUBES, ARRIBA!** at very start
      .replace(/^\*{1,2}([^*\n]{1,80})\*{1,2}\n/m, '$1\n')
      .trim();
  }
}

module.exports = XAutoCampaignService;
