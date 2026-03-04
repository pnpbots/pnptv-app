'use strict';

const XAutoCampaignService = require('../../services/xAutoCampaignService');
const XPostService = require('../../services/xPostService');
const logger = require('../../../utils/logger');

const ITEMS_PER_PAGE = 20;

const getStats = async (req, res) => {
  try {
    const [stats, accounts] = await Promise.all([
      XAutoCampaignService.getStats(),
      XPostService.listActiveAccounts(),
    ]);
    return res.json({ success: true, stats, accounts });
  } catch (error) {
    logger.error('Error getting X campaign stats:', error);
    return res.status(500).json({ error: error.message });
  }
};

const listCampaigns = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const status = req.query.status || null;

    const { campaigns, total } = await XAutoCampaignService.listCampaigns({
      status,
      page,
      limit: ITEMS_PER_PAGE,
    });

    return res.json({
      success: true,
      campaigns,
      pagination: {
        page,
        limit: ITEMS_PER_PAGE,
        total,
        totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      },
    });
  } catch (error) {
    logger.error('Error listing X campaigns:', error);
    return res.status(500).json({ error: error.message });
  }
};

const createCampaign = async (req, res) => {
  try {
    const {
      name, accountId, topic, grokMode, language, customPrompt,
      intervalMinutes, activeHoursStart, activeHoursEnd, maxPosts,
    } = req.body;

    if (!name || !accountId || !topic) {
      return res.status(400).json({ error: 'name, accountId, and topic are required' });
    }

    const campaignId = await XAutoCampaignService.createCampaign({
      name,
      accountId,
      topic,
      grokMode,
      language,
      customPrompt,
      intervalMinutes,
      activeHoursStart,
      activeHoursEnd,
      maxPosts: maxPosts || null,
      createdBy: req.session?.user?.id,
      createdByUsername: req.session?.user?.username,
    });

    logger.info('X auto campaign created', {
      campaignId,
      adminId: req.session?.user?.id,
      adminUsername: req.session?.user?.username,
    });

    return res.json({ success: true, campaignId });
  } catch (error) {
    logger.error('Error creating X campaign:', error);
    return res.status(500).json({ error: error.message });
  }
};

const updateCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    await XAutoCampaignService.updateCampaign(id, req.body);
    logger.info('X auto campaign updated', {
      campaignId: id,
      adminId: req.session?.user?.id,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Error updating X campaign:', error);
    return res.status(500).json({ error: error.message });
  }
};

const pauseCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    await XAutoCampaignService.pauseCampaign(id);
    logger.info('X auto campaign paused', {
      campaignId: id,
      adminId: req.session?.user?.id,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Error pausing X campaign:', error);
    return res.status(500).json({ error: error.message });
  }
};

const resumeCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    await XAutoCampaignService.resumeCampaign(id);
    logger.info('X auto campaign resumed', {
      campaignId: id,
      adminId: req.session?.user?.id,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Error resuming X campaign:', error);
    return res.status(500).json({ error: error.message });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    await XAutoCampaignService.deleteCampaign(id);
    logger.info('X auto campaign deleted', {
      campaignId: id,
      adminId: req.session?.user?.id,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting X campaign:', error);
    return res.status(500).json({ error: error.message });
  }
};

const getCampaignHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page || '1'));

    const { posts, total } = await XAutoCampaignService.getCampaignHistory(id, page);

    return res.json({
      success: true,
      posts,
      pagination: {
        page,
        limit: ITEMS_PER_PAGE,
        total,
        totalPages: Math.ceil(total / ITEMS_PER_PAGE),
      },
    });
  } catch (error) {
    logger.error('Error getting campaign history:', error);
    return res.status(500).json({ error: error.message });
  }
};

const triggerGenerate = async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await XAutoCampaignService.getCampaign(id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const postId = await XAutoCampaignService.generateAndQueue(campaign);
    logger.info('X auto campaign manual generate', {
      campaignId: id,
      postId,
      adminId: req.session?.user?.id,
    });

    return res.json({ success: true, postId });
  } catch (error) {
    logger.error('Error triggering campaign generate:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getStats,
  listCampaigns,
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  deleteCampaign,
  getCampaignHistory,
  triggerGenerate,
};
