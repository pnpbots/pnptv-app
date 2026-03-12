'use strict';

const XAutoCampaignService = require('../../services/xAutoCampaignService');
const XPostService = require('../../services/xPostService');
const logger = require('../../../utils/logger');

const ITEMS_PER_PAGE = 20;

const getStats = async (req, res) => {
  try {
    const [stats, accounts, mediaFolderId] = await Promise.all([
      XAutoCampaignService.getStats(),
      XPostService.listActiveAccounts(),
      XAutoCampaignService.ensureMediaFolder().catch(() => null),
    ]);
    return res.json({ success: true, stats, accounts, mediaFolderId });
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

const VALID_GROK_MODES = new Set(['xPost', 'broadcast', 'salesPost', 'sharePost', 'post', 'videoDescription']);

const createCampaign = async (req, res) => {
  try {
    let {
      name, accountId, topic, grokMode, language, customPrompt,
      intervalMinutes, activeHoursStart, activeHoursEnd, maxPosts,
      mediaFolderId,
    } = req.body;

    if (!name || !accountId || !topic) {
      return res.status(400).json({ error: 'name, accountId, and topic are required' });
    }

    if (grokMode && !VALID_GROK_MODES.has(grokMode)) {
      return res.status(400).json({ error: 'Invalid grokMode' });
    }

    if (intervalMinutes !== undefined) {
      intervalMinutes = Math.max(15, Number(intervalMinutes) || 15);
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
      mediaFolderId: mediaFolderId || null,
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
    const updates = { ...req.body };

    if (updates.grokMode && !VALID_GROK_MODES.has(updates.grokMode)) {
      return res.status(400).json({ error: 'Invalid grokMode' });
    }

    if (updates.intervalMinutes !== undefined) {
      updates.intervalMinutes = Math.max(15, Number(updates.intervalMinutes) || 15);
    }

    await XAutoCampaignService.updateCampaign(id, updates);
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

const getMediaFolder = async (req, res) => {
  try {
    const folderId = await XAutoCampaignService.ensureMediaFolder();
    return res.json({
      success: true,
      folderId,
      cmsUrl: `https://cms.pnptv.app/admin/files?folder=${folderId}`,
    });
  } catch (error) {
    logger.error('Error getting media folder:', error);
    return res.status(500).json({ error: error.message });
  }
};

const getRandomVideo = async (req, res) => {
  try {
    const folderId = await XAutoCampaignService.ensureMediaFolder();
    const campaignId = req.query.campaignId || null;
    const mediaUrl = await XAutoCampaignService._getRandomMediaUrl(folderId, campaignId);
    if (!mediaUrl) {
      return res.status(404).json({ error: 'No videos found in media folder' });
    }
    return res.json({ success: true, mediaUrl });
  } catch (error) {
    logger.error('Error getting random video:', error);
    return res.status(500).json({ error: error.message });
  }
};

const previewCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await XAutoCampaignService.getCampaign(id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const options = await XAutoCampaignService.generatePreviewOptions(campaign);
    return res.json({ success: true, options });
  } catch (error) {
    logger.error('Error previewing campaign:', error);
    return res.status(500).json({ error: error.message });
  }
};

const duplicateCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const campaignId = await XAutoCampaignService.duplicateCampaign(
      id,
      req.session?.user?.id,
      req.session?.user?.username
    );
    logger.info('X auto campaign duplicated', {
      original: id, new: campaignId, adminId: req.session?.user?.id,
    });
    return res.json({ success: true, campaignId });
  } catch (error) {
    logger.error('Error duplicating campaign:', error);
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
  getMediaFolder,
  getRandomVideo,
  previewCampaign,
  duplicateCampaign,
};
