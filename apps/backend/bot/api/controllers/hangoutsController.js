const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const VideoCallModel = require('../../../models/videoCallModel');
const { validateTelegramWebAppInitData } = require('../../services/telegramWebAppAuth');
const { consumeRateLimit, getRateLimitInfo } = require('../../core/middleware/rateLimitGranular');
const { buildJitsiHangoutsUrl } = require('../../utils/jitsiHangoutsWebApp');
const jaasService = require('../../services/jaasService');

const BOT_TOKEN = process.env.BOT_TOKEN;
const IS_PROD = process.env.NODE_ENV === 'production';

const extractInitData = (req) =>
  req.get('x-telegram-init-data') || req.body?.initData || null;

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const normalizeTitle = (title) => {
  if (!title) return null;
  const trimmed = String(title).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
};

const normalizeSubscriptionStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'prime' || normalized === 'trial') {
    return 'active';
  }
  return 'inactive';
};

const fetchUserRecord = async (userId) => {
  const result = await query(
    `SELECT id, subscription_status, tier, role, accepted_terms, is_active
     FROM users WHERE id = $1`,
    [String(userId)]
  );
  return result.rows[0] || null;
};

const isPrimeUserRecord = (user) => {
  if (!user) return false;
  return (user.tier || '').toLowerCase() === 'prime';
};

const isAdminRecord = (user) => {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'superadmin';
};

const resolveTelegramUser = (req) => {
  const initData = extractInitData(req);
  if (!initData) {
    return { ok: false, user: null, initData: null, reason: 'missing_init_data' };
  }

  const validation = validateTelegramWebAppInitData(initData, { botToken: BOT_TOKEN });
  if (!validation.ok) {
    return { ok: false, user: null, initData, reason: validation.reason };
  }

  return { ok: true, user: validation.user, initData };
};

class HangoutsController {
  /**
   * Get most active hangout
   * GET /api/hangouts/most-active
   */
  static async getMostActiveHangout(req, res) {
    res.json({
      success: true,
      data: {
        title: 'Community Hangout',
        currentParticipants: 25,
        link: '/hangouts/community',
      },
    });
  }

  /**
   * List public hangouts
   * GET /api/hangouts/public
   */
  static async listPublic(req, res) {
    try {
      const calls = await VideoCallModel.getAllPublic();
      const rooms = calls.map((call) => ({
        id: call.id,
        title: call.title,
        creatorName: call.creatorName,
        currentParticipants: call.currentParticipants,
        maxParticipants: call.maxParticipants,
        createdAt: call.createdAt,
      }));

      res.json({ success: true, rooms, count: rooms.length });
    } catch (error) {
      logger.error('Error listing public hangouts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load rooms',
      });
    }
  }

  /**
   * Create a new hangouts room
   * POST /api/hangouts/create
   */
  static async create(req, res) {
    try {
      const isPublic = Boolean(req.body?.isPublic);
      const auth = resolveTelegramUser(req);

      if (!auth.ok && auth.initData) {
        return res.status(401).json({
          success: false,
          error: 'Telegram authentication failed',
          reason: auth.reason,
        });
      }

      if (!auth.ok && isPublic && IS_PROD) {
        return res.status(401).json({
          success: false,
          error: 'Telegram authentication required',
          reason: auth.reason,
        });
      }

      const creatorId = auth.user?.id || req.body?.creatorId;
      const creatorName = auth.user?.displayName || req.body?.creatorName || 'User';

      if (!creatorId) {
        return res.status(400).json({
          success: false,
          error: 'creatorId is required',
        });
      }

      const user = await fetchUserRecord(creatorId);
      if (!user) {
        return res.status(403).json({
          success: false,
          error: 'User not registered',
        });
      }

      if (user.is_active === false) {
        return res.status(403).json({
          success: false,
          error: 'User is deactivated',
        });
      }

      const hasPrimeAccess = isPrimeUserRecord(user) || isAdminRecord(user);
      if (!isPublic && !hasPrimeAccess) {
        return res.status(403).json({
          success: false,
          error: 'Prime membership required for private rooms',
        });
      }

      const allowed = await consumeRateLimit(String(creatorId), 'videocall');
      if (!allowed) {
        const rateLimitInfo = await getRateLimitInfo(String(creatorId), 'videocall');
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: rateLimitInfo?.resetIn || 1800,
        });
      }

      const maxParticipants = clampNumber(req.body?.maxParticipants, 2, 50, 10);
      const allowGuests = req.body?.allowGuests === undefined ? true : Boolean(req.body.allowGuests);
      const enforceCamera = req.body?.enforceCamera === undefined ? true : Boolean(req.body.enforceCamera);
      const title = normalizeTitle(req.body?.title);

      const call = await VideoCallModel.create({
        creatorId,
        creatorName,
        title,
        maxParticipants,
        allowGuests,
        enforceCamera,
        isPublic,
      });

      // Generate Jitsi URL if JAAS is configured
      let jitsiUrl = null;
      if (jaasService.isConfigured()) {
        try {
          jitsiUrl = buildJitsiHangoutsUrl({
            roomName: call.channelName,
            userId: creatorId,
            userName: creatorName,
            isModerator: true,
            callId: call.id,
            type: isPublic ? 'public' : 'private',
          });
        } catch (error) {
          logger.warn('Failed to generate Jitsi URL:', error.message);
        }
      }

      res.json({
        success: true,
        id: call.id,
        callId: call.id,
        room: call.channelName,
        // Agora credentials (fallback)
        token: call.rtcToken,
        uid: String(creatorId),
        appId: call.appId || process.env.AGORA_APP_ID,
        // Jitsi URL (primary)
        jitsiUrl,
        platform: jitsiUrl ? 'jitsi' : 'agora',
        isPublic: call.isPublic,
        maxParticipants: call.maxParticipants,
      });
    } catch (error) {
      logger.error('Error creating hangouts room:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create room',
      });
    }
  }

  /**
   * Join a public hangouts room
   * POST /api/hangouts/join/:callId
   */
  static async join(req, res) {
    try {
      const callId = req.params.callId;
      const auth = resolveTelegramUser(req);

      if (!auth.ok && auth.initData) {
        return res.status(401).json({
          success: false,
          error: 'Telegram authentication failed',
          reason: auth.reason,
        });
      }

      if (!auth.ok && IS_PROD) {
        return res.status(401).json({
          success: false,
          error: 'Telegram authentication required',
          reason: auth.reason,
        });
      }

      const userId = auth.user?.id || req.body?.userId;
      const userName = auth.user?.displayName || req.body?.userName || 'User';

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required',
        });
      }

      const user = await fetchUserRecord(userId);
      if (!user) {
        return res.status(403).json({
          success: false,
          error: 'User not registered',
        });
      }

      if (user.is_active === false) {
        return res.status(403).json({
          success: false,
          error: 'User is deactivated',
        });
      }

      const call = await VideoCallModel.getById(callId);
      if (!call) {
        return res.status(404).json({
          success: false,
          error: 'Room not found',
        });
      }

      if (!call.isActive) {
        return res.status(410).json({
          success: false,
          error: 'Room is no longer active',
        });
      }

      if (!call.isPublic) {
        return res.status(403).json({
          success: false,
          error: 'Room is private',
        });
      }

      const joinResult = await VideoCallModel.joinCall(
        callId,
        userId,
        userName,
        false
      );

      // Generate Jitsi URL if JAAS is configured
      const isModerator = joinResult.call.creatorId === userId;
      let jitsiUrl = null;
      if (jaasService.isConfigured()) {
        try {
          jitsiUrl = buildJitsiHangoutsUrl({
            roomName: joinResult.call.channelName,
            userId,
            userName,
            isModerator,
            callId: joinResult.call.id,
            type: joinResult.call.isPublic ? 'public' : 'private',
          });
        } catch (error) {
          logger.warn('Failed to generate Jitsi URL:', error.message);
        }
      }

      res.json({
        success: true,
        room: joinResult.call.channelName,
        // Agora credentials (fallback)
        token: joinResult.rtcToken,
        uid: String(userId),
        appId: joinResult.appId || process.env.AGORA_APP_ID,
        // Jitsi URL (primary)
        jitsiUrl,
        platform: jitsiUrl ? 'jitsi' : 'agora',
        callId: joinResult.call.id,
        isPublic: joinResult.call.isPublic,
        isModerator,
      });
    } catch (error) {
      logger.error('Error joining hangouts room:', error);
      if (error.message?.includes('full')) {
        return res.status(409).json({
          success: false,
          error: 'Room is full',
        });
      }
      if (error.message?.includes('ended')) {
        return res.status(410).json({
          success: false,
          error: 'Room has ended',
        });
      }
      res.status(500).json({
        success: false,
        error: 'Failed to join room',
      });
    }
  }
}

module.exports = HangoutsController;
