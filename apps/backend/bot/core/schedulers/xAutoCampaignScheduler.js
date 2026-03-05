'use strict';

const XAutoCampaignService = require('../../services/xAutoCampaignService');
const logger = require('../../../utils/logger');

const CHECK_INTERVAL = 60 * 1000; // 60 seconds

class XAutoCampaignScheduler {
  constructor(bot = null) {
    this.interval = null;
    this.isRunning = false;
    this.isProcessing = false;
    this.bot = bot;
  }

  start() {
    if (this.isRunning) {
      logger.warn('X auto campaign scheduler already running');
      return;
    }

    this.isRunning = true;
    this.processQueue();
    this.interval = setInterval(() => this.processQueue(), CHECK_INTERVAL);
    logger.info('X auto campaign scheduler started (60s interval)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.isRunning = false;
      logger.info('X auto campaign scheduler stopped');
    }
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const dueCampaigns = await XAutoCampaignService.getDueCampaigns();
      if (!dueCampaigns.length) return;

      logger.info(`Processing ${dueCampaigns.length} due X auto campaigns`);

      for (const campaign of dueCampaigns) {
        try {
          await XAutoCampaignService.generateAndQueue(campaign);
          logger.info('Auto campaign post generated', {
            campaignId: campaign.campaign_id,
            name: campaign.name,
          });
        } catch (err) {
          logger.error('Auto campaign generation failed', {
            campaignId: campaign.campaign_id,
            name: campaign.name,
            error: err.message,
          });
          await XAutoCampaignService.recordFailure(campaign.campaign_id);
        }
      }
    } catch (err) {
      logger.error(`Error in X auto campaign scheduler: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  getStatus() {
    return { isRunning: this.isRunning };
  }
}

module.exports = XAutoCampaignScheduler;
