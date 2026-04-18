// Force IPv4 for DNS resolution BEFORE any network requests
// This must be at the very top to fix IPv6 timeout issues with Telegram API
const dns = require('dns');
const fs = require('fs');
const os = require('os');
const path = require('path');
dns.setDefaultResultOrder('ipv4first');

const dotenv = require('dotenv');
if (process.env.NODE_ENV === 'production') {
  // In production, prefer .env.production as canonical source.
  dotenv.config({
    path: path.resolve(process.cwd(), '.env.production'),
    allowEmptyValues: true,
  });
  // Load .env only as non-overriding fallback for any missing key.
  dotenv.config({
    path: path.resolve(process.cwd(), '.env'),
    allowEmptyValues: true,
    override: false,
  });
} else {
  dotenv.config({ allowEmptyValues: true });
}
const { Telegraf, Markup } = require('telegraf');
const ADMIN_USER_IDS = [
  ...(process.env.ADMIN_USER_IDS || '').split(','),
  ...(process.env.ADMIN_IDS || '').split(','),
  ...(process.env.ADMIN_ID ? [process.env.ADMIN_ID] : []),
].map((id) => id.trim()).filter(Boolean);
const { initializePostgres, testConnection } = require('../../config/postgres');
const { initializeRedis } = require('../../config/redis');
const { initializeCoreTables } = require('../../config/ensureCoreTables');
const meruLinkInitializer = require('../../services/meruLinkInitializer');
const { initSentry } = require('./plugins/sentry');
const sessionMiddleware = require('./middleware/session');
const { userExistsMiddleware } = require('./middleware/userExistsMiddleware');
const globalBanCheck = require('./middleware/globalBanCheck');
const rateLimitMiddleware = require('./middleware/rateLimit');
const chatCleanupMiddleware = require('./middleware/chatCleanup');
const privateOutboundGuardMiddleware = require('./middleware/privateOutboundGuard');
const moderationFilter = require('./middleware/moderationFilter');
const groupCommandReminder = require('./middleware/groupCommandReminder');
const errorHandler = require('./middleware/errorHandler');
// Topic middleware
const { topicPermissionsMiddleware, registerApprovalHandlers } = require('./middleware/topicPermissions');
const mediaOnlyValidator = require('./middleware/mediaOnlyValidator');
const { mediaMirrorMiddleware } = require('./middleware/mediaMirror');
const topicModerationMiddleware = require('./middleware/topicModeration');
const botAdditionPreventionMiddleware = require('./middleware/botAdditionPrevention');
const autoModerationMiddleware = require('./middleware/autoModeration');
const { commandRedirectionMiddleware, notificationsAutoDelete } = require('./middleware/commandRedirection');
const { groupSecurityEnforcementMiddleware, registerGroupSecurityHandlers } = require('./middleware/groupSecurityEnforcement');
const { groupMessageAutoDeleteMiddleware } = require('./middleware/groupMessageAutoDelete');
// Group behavior rules (overrides previous rules)
const {
  groupBehaviorMiddleware,
  cristinaGroupFilterMiddleware,
  groupMenuRedirectMiddleware,
  groupCallbackRedirectMiddleware,
  groupCommandDeleteMiddleware,
  primeChannelSilentRedirectMiddleware
} = require('./middleware/groupBehavior');
const groupCommandRestrictionMiddleware = require('./middleware/groupCommandRestriction');
const wallOfFameGuard = require('./middleware/wallOfFameGuard');
const notificationsTopicGuard = require('./middleware/notificationsTopicGuard');
const logger = require('../../utils/logger');
const performanceMonitor = require('../../utils/performanceMonitor');

// ─── Safe require helper ────────────────────────────────────────────────────
// Prevents a broken handler/service module from crashing the entire process.
// The API server + auth MUST always start, even if individual modules fail.
const _noop = () => {};
const _noopObj = {};
function safeRequire(modulePath, fallback) {
  try { return require(modulePath); } catch (e) {
    const fb = fallback !== undefined ? fallback : _noop;
    console.error(`[SAFE_REQUIRE] Failed to load ${modulePath}: ${e.message}`);
    return fb;
  }
}

// ─── Core API server (MUST load — these are critical) ───────────────────────
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { initSocketIO } = safeRequire('../api/socketHandlers', { initSocketIO: _noop });
const apiApp = require('../api/routes');

// ─── Utilities (critical) ───────────────────────────────────────────────────
const { getLanguage } = require('../utils/helpers');
const { t } = require('../../utils/i18n');
const UserService = require('../../services/userService');

// ─── Handlers (non-critical — wrapped in safeRequire) ───────────────────────
const registerAdminHandlers = safeRequire('../handlers/admin');
const registerModerationAdminHandlers = safeRequire('../handlers/moderation/adminCommands');
const registerRoleManagementHandlers = safeRequire('../handlers/admin/roleManagement');
const { registerWallOfFameHandlers } = safeRequire('../handlers/group/wallOfFame', { registerWallOfFameHandlers: _noop });
const registerPaymentTutorialHandlers = safeRequire('../handlers/user/paymentTutorial');
const registerSupportRoutingHandlers = safeRequire('../handlers/support/supportRouting');
const { buildOnboardingPrompt } = safeRequire('../handlers/user/menu', { buildOnboardingPrompt: _noop });

// ─── Services (non-critical — wrapped in safeRequire) ───────────────────────
const supportRoutingService = safeRequire('../../services/supportRoutingService', _noopObj);
const slaMonitor = safeRequire('../../services/slaMonitor', _noopObj);
const GroupCleanupService = safeRequire('../../services/groupCleanupService', _noopObj);
const broadcastScheduler = safeRequire('../../services/broadcastScheduler', _noopObj);
const MembershipCleanupService = safeRequire('../../services/membershipCleanupService', _noopObj);
const BusinessNotificationService = safeRequire('../../services/businessNotificationService', _noopObj);
const MessageRateLimiter = safeRequire('../../services/messageRateLimiter', _noopObj);
const cristinaTicketWorker = safeRequire('../../services/cristinaTicketWorker', _noopObj);
const CristinaOnboardingReminders = safeRequire('../../services/cristinaOnboardingReminders', _noopObj);
const SupportTopicModel = safeRequire('../../models/supportTopicModel', _noopObj);
const BroadcastButtonModel = safeRequire('../../models/broadcastButtonModel', _noopObj);
const { initializeAsyncBroadcastQueue } = safeRequire('../../services/initializeQueue', { initializeAsyncBroadcastQueue: _noop });
const { startCronJobs } = safeRequire('../../scripts/cron', { startCronJobs: _noop });

// ─── Schedulers (non-critical) ──────────────────────────────────────────────
const CommunityPostScheduler = safeRequire('./schedulers/communityPostScheduler', null);
const XPostScheduler = safeRequire('./schedulers/xPostScheduler', null);
const CanvaExportScheduler = safeRequire('./schedulers/canvaExportScheduler', null);
// Variable de estado para saber si el bot está iniciado
let botStarted = false;
let botInstance = null;
let isWebhookMode = false;
let apiServer = null;

const LOCK_PATH = process.env.BOT_LOCK_PATH || path.join(os.tmpdir(), 'pnptvbot.lock');
const LOCK_ENABLED = process.env.BOT_LOCK_ENABLED !== 'false';
let hasProcessLock = false;

const acquireProcessLock = () => {
  if (!LOCK_ENABLED) return true;
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.closeSync(fd);
    hasProcessLock = true;
    logger.info(`✓ Process lock acquired: ${LOCK_PATH}`);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      logger.warn(`Failed to create process lock (${LOCK_PATH}); continuing without lock: ${error.message}`);
      return true;
    }
  }

  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    let lockedPid = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        lockedPid = Number(parsed.pid);
      } catch (_) {
        lockedPid = Number(raw);
      }
    }

    if (lockedPid) {
      try {
        process.kill(lockedPid, 0);
        logger.error(`Another bot instance is already running (pid ${lockedPid}).`);
        logger.error('If this is unexpected, stop the other process or remove the lock file.');
        return false;
      } catch (err) {
        if (err.code !== 'ESRCH') {
          logger.error(`Unable to verify existing lock pid ${lockedPid}: ${err.message}`);
          return false;
        }
      }
    }

    fs.unlinkSync(LOCK_PATH);
    return acquireProcessLock();
  } catch (error) {
    logger.warn(`Failed to validate existing lock; continuing without lock: ${error.message}`);
    return true;
  }
};

const releaseProcessLock = () => {
  if (!LOCK_ENABLED || !hasProcessLock) return;
  try {
    fs.unlinkSync(LOCK_PATH);
    hasProcessLock = false;
    logger.info(`✓ Process lock released: ${LOCK_PATH}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to remove process lock (${LOCK_PATH}): ${error.message}`);
    }
  }
};

const startApiServer = (modeLabel) => {
  if (apiServer) {
    logger.warn('API server already started; skipping additional listen.');
    return apiServer;
  }

  const PORT = process.env.PORT || 3001;
  const server = http.createServer(apiApp);

  // Attach Socket.IO for real-time chat/DM
  const io = new SocketIOServer(server, {
    cors: {
      // H5: Filter out wildcard '*' entries — WEBAPP_ORIGIN must never accept all origins.
      origin: (() => {
        const raw = process.env.WEBAPP_ORIGIN;
        if (!raw) return ['https://app.pnptv.app', 'https://pnptv.app'];
        const allowed = raw.split(',').map(o => o.trim()).filter(o => o && o !== '*');
        return allowed.length > 0 ? allowed : ['https://app.pnptv.app', 'https://pnptv.app'];
      })(),
      credentials: true,
    },
    path: '/socket.io',
  });
  apiApp.set('io', io);
  require('../../services/socketSingleton').set(io);
  require('../../services/notificationEmitter').setIO(io);
  require('../../services/pushNotificationService').initialize();
  initSocketIO(io);

  // NOTE: Daily notification digest scheduler is now managed by cron.js
  // (see scripts/cron.js — NOTIFICATION_DIGEST_CRON)

  server.listen(PORT, '0.0.0.0', () => {
    const prefix = modeLabel ? `${modeLabel} ` : '';
    logger.info(`✓ ${prefix}API server running on port ${PORT} (Socket.IO attached)`);

    // Reconcile call reminders on startup — restores any setTimeout reminders
    // that were lost when the container restarted.
    const callNotificationService = safeRequire('../../services/callNotificationService', {});
    if (typeof callNotificationService.reconcileReminders === 'function') {
      callNotificationService.reconcileReminders().catch((err) => {
        logger.warn('[bot.js] reconcileReminders startup error (non-fatal):', err.message);
      });
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`API port ${PORT} is already in use. Another instance may be running.`);
      releaseProcessLock();
      process.exit(1);
    }
    logger.error('API server error:', error);
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.timeout = 120000;
  apiServer = server;
  return server;
};

/**
 * Validate critical environment variables
 */
const validateCriticalEnvVars = () => {
  // Only BOT_TOKEN is critical - PostgreSQL can use defaults or DATABASE_URL
  const criticalVars = ['BOT_TOKEN'];
  const missing = criticalVars.filter((varName) => !process.env[varName]);
  if (missing.length > 0) {
    logger.error(`Missing critical environment variables: ${missing.join(', ')}`);
    logger.error('Please configure these variables in your .env file');
    throw new Error(`Missing critical environment variables: ${missing.join(', ')}`);
  }
};

/**
 * Initialize and start the bot
 */
const startBot = async () => {
  try {
    performanceMonitor.start('bot_startup');
    logger.info('Starting PNPtv Telegram Bot...');
    if (!acquireProcessLock()) {
      process.exit(1);
    }
    // Validate critical environment variables
    try {
      validateCriticalEnvVars();
      logger.info('✓ Environment variables validated');
    } catch (error) {
      logger.error('CRITICAL: Missing environment variables, cannot start bot');
      logger.error(error.message);
      logger.error('Please configure all required environment variables in your .env file');
      process.exit(1);
    }
    // Initialize Sentry (optional)
    try {
      initSentry();
      logger.info('✓ Sentry initialized');
    } catch (error) {
      logger.warn(`Sentry initialization failed, continuing without monitoring: ${error.message}`);
    }
    // Initialize PostgreSQL
    try {
      initializePostgres();
      const connected = await testConnection();
      if (connected) {
        logger.info('✓ PostgreSQL initialized');
        // Initialize support topics table
        try {
          await SupportTopicModel.initTable();
          logger.info('✓ Support topics table initialized');
        } catch (tableError) {
          logger.warn(`Support topics table initialization failed: ${tableError.message}`);
        }
        try {
          await initializeCoreTables();
          logger.info('✓ Core tables initialized');
        } catch (coreTablesError) {
          logger.warn(`Core tables initialization failed: ${coreTablesError.message}`);
        }
        // Initialize Meru Link tracking in background (fire and forget)
        meruLinkInitializer.initialize();
      } else {
        logger.warn('⚠️ PostgreSQL connection test failed, but will retry on first query');
      }
    } catch (error) {
      logger.error('PostgreSQL initialization failed. Bot will run in DEGRADED mode without database.');
      logger.error(`Error: ${error.message}`);
      logger.warn('⚠️  Bot features requiring database will not work!');
    }
    // Initialize Redis (optional, will use default localhost if not configured)
    try {
      initializeRedis();
      logger.info('✓ Redis initialized');
    } catch (error) {
      logger.warn(`Redis initialization failed, continuing without cache: ${error.message}`);
      logger.warn('⚠️  Performance may be degraded without caching');
    }

    // ─── CRITICAL: Start API server EARLY ───────────────────────────────
    // The Express API server (auth, webapp endpoints) MUST be available
    // even if bot handler registration fails later. This ensures login
    // and all webapp functionality keeps working no matter what.
    // startApiServer() is idempotent — subsequent calls are no-ops.
    try {
      startApiServer('Core');
      logger.info('✓ Core API server started (auth endpoints available)');
    } catch (apiStartError) {
      logger.error(`CRITICAL: Failed to start core API server: ${apiStartError.message}`);
      // Don't exit — continue and try again later in the startup sequence
    }

    // Create bot instance
    const bot = new Telegraf(process.env.BOT_TOKEN);

    // Global safeguard: ignore "message is not modified" errors on edits
    bot.use(async (ctx, next) => {
      if (ctx.editMessageText) {
        const originalEditMessageText = ctx.editMessageText.bind(ctx);
        ctx.editMessageText = async (...args) => {
          try {
            return await originalEditMessageText(...args);
          } catch (error) {
            const description = error?.response?.description || error?.description || error?.message || '';
            if (String(description).toLowerCase().includes('message is not modified')) {
              return null;
            }
            throw error;
          }
        };
      }
      return next();
    });

    // ─── EARLY GROUP COMMAND SILENCER ────────────────────────────────────────
    // Must be registered BEFORE any bot.command() calls so it intercepts first.
    // In the main community group, non-admins typing commands (e.g. /link,
    // /subscribe, /start) see their message deleted instantly with zero response.
    // This prevents the command handlers below from ever responding to the group.
    bot.use(async (ctx, next) => {
      const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
      if (!isGroup) return next();

      const text = ctx.message?.text || '';
      if (!text.startsWith('/') || !ctx.message?.message_id) return next();

      const chatIdStr = ctx.chat?.id?.toString();
      const mainGroupId = process.env.GROUP_ID;
      if (!mainGroupId || chatIdStr !== mainGroupId) return next();

      // Delete the command immediately regardless of who sent it
      try { await ctx.deleteMessage(); } catch (_) {}

      // Let env-level admins through so their commands still work
      const userId = ctx.from?.id;
      const PermSvc = require('../../services/permissionService');
      const isEnvAdmin = userId && (
        PermSvc.isEnvSuperAdmin(userId) || PermSvc.isEnvAdmin(userId)
      );
      if (isEnvAdmin) return next();

      // Non-admins: silently stop. No response, no Cristina, nothing.
      return;
    });

    // Mono — personal AI business assistant (admin-only)
    try {
      const { registerMonoHandlers } = require('../handlers/admin/monoHandler');
      registerMonoHandlers(bot);
    } catch (e) { logger.error(`Mono handler failed to load: ${e.message}`); }

    // FIX: Register /admin command early using admin handler directly
    bot.command('admin', async (ctx) => {
      logger.info('[ADMIN-EARLY] /admin command received');
      try {
        const PermissionService = require('../../services/permissionService');
        const { getLanguage, t } = require('../utils/helpers');
        const { showAdminPanel } = require('../handlers/admin/index');
        
        const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
        logger.info(`[ADMIN-EARLY] Permission check: isAdmin=${isAdmin}`);
        
        if (!isAdmin) {
          logger.info(`[ADMIN-EARLY] User not authorized`);
          await ctx.reply(t('unauthorized', getLanguage(ctx)));
          return;
        }

        logger.info('[ADMIN-EARLY] User authorized, calling showAdminPanel...');
        await showAdminPanel(ctx, false);
        logger.info('[ADMIN-EARLY] showAdminPanel completed successfully');
      } catch (error) {
        logger.error('[ADMIN-EARLY] Error in /admin handler:', error.message, error.stack);
        await ctx.reply('❌ Error loading admin panel.');
      }
    });

    // /start → handle web login deep links, then redirect all else to web app
    bot.command('start', async (ctx) => {
      if (ctx.chat.type !== 'private') return;

      // Handle web login deep links (/start weblogin_TOKEN)
      const startPayload = ctx.message.text.split(' ')[1] || '';
      if (startPayload.startsWith('weblogin_')) {
        const token = startPayload.replace('weblogin_', '');
        const { telegramConfirmLogin } = require('../api/controllers/webAppController');
        const success = await telegramConfirmLogin(
          {
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
          },
          token
        );
        if (success) {
          await ctx.reply('✅ ¡Login exitoso! Ya puedes volver al navegador.\n\n✅ Login successful! You can go back to your browser.');
        } else {
          await ctx.reply('❌ El enlace de login ha expirado. Intenta de nuevo desde la web.\n\n❌ Login link expired. Try again from the website.');
        }
        return;
      }

      await ctx.reply(
        '🌐 PNPtv! has moved to the web!\n\n' +
        'Visit our app for the full experience:\n' +
        '👉 https://pnptv.app\n\n' +
        'All features are now available on the web app.',
        { reply_markup: { inline_keyboard: [[{ text: '🚀 Open PNPtv!', url: 'https://pnptv.app' }]] } }
      );
    });

    // /link <hangoutId> — Link a Telegram group to a PNPtv hangout
    bot.command('link', async (ctx) => {
      if (ctx.chat.type === 'private') {
        return ctx.reply('❌ This command must be used inside a Telegram group.');
      }
      const args = ctx.message.text.split(' ').slice(1);
      const hangoutId = parseInt(args[0], 10);
      if (!Number.isFinite(hangoutId)) {
        // Try to find a hangout already linked to this Telegram group that the user owns
        try {
          const { query: dbQuery } = require('../../config/postgres');
          const { rows: linkedRows } = await dbQuery(
            `SELECT hg.id, hg.name
             FROM hangout_groups hg
             JOIN hangout_group_members hgm ON hgm.group_id = hg.id
             JOIN users u ON u.id = hgm.user_id
             WHERE hg.telegram_chat_id = $1
               AND u.telegram = $2
               AND hgm.role = 'owner'
             LIMIT 1`,
            [String(ctx.chat.id), String(ctx.from.id)]
          );
          if (linkedRows.length > 0) {
            const g = linkedRows[0];
            return ctx.reply(
              `🔗 This group is linked to the hangout *${g.name}*.\n\nOpen it here: https://app.pnptv.app/chat/${g.id}`,
              { parse_mode: 'Markdown' }
            );
          }
        } catch { /* fall through silently */ }
        return;
      }
      try {
        const { query: dbQuery } = require('../../config/postgres');
        // Verify caller owns this hangout
        const { rows: ownerRows } = await dbQuery(
          `SELECT gm.role FROM hangout_group_members gm WHERE gm.group_id=$1 AND gm.user_id=(SELECT id FROM users WHERE telegram=$2 LIMIT 1) AND gm.role='owner'`,
          [hangoutId, String(ctx.from.id)]
        );
        if (ownerRows.length === 0) {
          return ctx.reply('❌ You must be the owner of this hangout to link it.');
        }
        // Check hangout exists
        const { rows: groupRows } = await dbQuery('SELECT id, name FROM hangout_groups WHERE id=$1', [hangoutId]);
        if (groupRows.length === 0) {
          return ctx.reply('❌ Hangout group not found.');
        }
        // Generate invite link
        let inviteLink = null;
        try {
          const linkResult = await ctx.telegram.createChatInviteLink(ctx.chat.id, { creates_join_request: false });
          inviteLink = linkResult.invite_link;
        } catch (linkErr) {
          logger.warn('Failed to create invite link, bot may not be admin', { error: linkErr.message });
          try {
            inviteLink = await ctx.telegram.exportChatInviteLink(ctx.chat.id);
          } catch { /* no invite link available */ }
        }
        // Store link
        await dbQuery(
          `UPDATE hangout_groups SET telegram_chat_id=$1, telegram_invite_link=$2 WHERE id=$3`,
          [ctx.chat.id, inviteLink, hangoutId]
        );
        // Invalidate security cache so bot stays in newly linked groups
        try { require('./middleware/groupSecurityEnforcement').invalidateLinkedCache(); } catch {}
        await ctx.reply(`✅ Linked to hangout "${groupRows[0].name}" (ID: ${hangoutId}).\n\nMembers can now open this Telegram group from the PNPtv app.`);

        // Matrix bridge removed (migrated to LiveKit/Socket.IO)
        // ─────────────────────────────────────────────────────────────────────
      } catch (err) {
        logger.error('/link command error', { error: err.message, chatId: ctx.chat.id });
        await ctx.reply('❌ Something went wrong. Please try again.');
      }
    });

    // /unlink — Unlink this Telegram group from its PNPtv hangout
    bot.command('unlink', async (ctx) => {
      if (ctx.chat.type === 'private') {
        return ctx.reply('❌ This command must be used inside a Telegram group.');
      }
      try {
        const { query: dbQuery } = require('../../config/postgres');
        const chatId = ctx.chat.id;

        // Find hangout linked to this Telegram group
        const { rows: groupRows } = await dbQuery(
          'SELECT id, name FROM hangout_groups WHERE telegram_chat_id = $1',
          [chatId]
        );
        if (groupRows.length === 0) {
          return ctx.reply('❌ This Telegram group is not linked to any PNPtv hangout.');
        }

        const hangoutId = groupRows[0].id;
        const hangoutName = groupRows[0].name;

        // Verify caller owns this hangout
        const { rows: ownerRows } = await dbQuery(
          `SELECT gm.role FROM hangout_group_members gm WHERE gm.group_id=$1 AND gm.user_id=(SELECT id FROM users WHERE telegram=$2 LIMIT 1) AND gm.role='owner'`,
          [hangoutId, String(ctx.from.id)]
        );
        if (ownerRows.length === 0) {
          return ctx.reply('❌ You must be the owner of the linked hangout to unlink it.');
        }

        // Remove the link
        await dbQuery(
          'UPDATE hangout_groups SET telegram_chat_id = NULL, telegram_invite_link = NULL WHERE id = $1',
          [hangoutId]
        );

        // Invalidate security cache
        try { require('./middleware/groupSecurityEnforcement').invalidateLinkedCache(); } catch {}

        await ctx.reply(`✅ Unlinked from hangout "${hangoutName}" (ID: ${hangoutId}).`);
      } catch (err) {
        logger.error('/unlink command error', { error: err.message, chatId: ctx.chat.id });
        await ctx.reply('❌ Something went wrong. Please try again.');
      }
    });

    // /delete — workaround for Telegram's missing message-deletion webhook.
    // User replies to their own message with /delete; bot soft-deletes in the
    // webapp hangout and attempts to delete the original TG message.
    bot.command('delete', async (ctx) => {
      if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
        return ctx.reply('❌ Use /delete in a linked hangout group by replying to your own message.').catch(() => {});
      }

      const replyTo = ctx.message?.reply_to_message;
      if (!replyTo) {
        const warn = await ctx.reply('❌ Reply to the message you want to delete.').catch(() => null);
        setTimeout(() => {
          ctx.deleteMessage(ctx.message.message_id).catch(() => {});
          if (warn) ctx.deleteMessage(warn.message_id).catch(() => {});
        }, 5000);
        return;
      }

      try {
        const { query: dbQuery } = require('../../config/postgres');
        const socketIO = require('../../services/socketSingleton').get();

        const senderTgId = String(ctx.from.id);
        const targetTgId = String(replyTo.from?.id || '');
        const isReplyingToOwn = senderTgId === targetTgId;

        const { rows: groupRows } = await dbQuery(
          'SELECT id FROM hangout_groups WHERE telegram_chat_id = $1',
          [ctx.chat.id]
        );
        if (groupRows.length === 0) return; // not a linked group
        const hangoutId = groupRows[0].id;
        const room = `hangout:${hangoutId}`;

        const { rows: msgRows } = await dbQuery(
          `SELECT id, user_id, is_deleted FROM chat_messages
           WHERE room = $1 AND (media_metadata->>'telegramMsgId')::bigint = $2
           LIMIT 1`,
          [room, replyTo.message_id]
        );
        if (msgRows.length === 0) {
          await ctx.reply('❌ Could not find this message in the PNPtv hangout.').catch(() => {});
          return;
        }
        const chatMsg = msgRows[0];
        if (chatMsg.is_deleted) return;

        // Permission: must be the message author OR a mod/owner of the hangout
        let allowed = isReplyingToOwn;
        if (!allowed) {
          const { rows: roleRows } = await dbQuery(
            `SELECT 1 FROM hangout_group_members
             WHERE group_id=$1 AND user_id=(SELECT id FROM users WHERE telegram=$2 LIMIT 1)
               AND role IN ('owner','moderator') LIMIT 1`,
            [hangoutId, senderTgId]
          );
          allowed = roleRows.length > 0;
        }
        if (!allowed) {
          await ctx.reply('❌ You can only delete your own messages (or be a mod).').catch(() => {});
          return;
        }

        await dbQuery(
          `UPDATE chat_messages SET is_deleted=true, deleted_by=$1, deleted_for_all=true WHERE id=$2`,
          [chatMsg.user_id, chatMsg.id]
        );

        if (socketIO) {
          socketIO.to(room).emit('hangout:message:deleted', {
            messageId: chatMsg.id,
            deletedBy: chatMsg.user_id,
            forAll: true,
          });
        }

        // Try to delete the TG message (requires bot admin rights if not own)
        await ctx.deleteMessage(replyTo.message_id).catch(() => {});
        // Clean up the /delete command itself
        await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

        logger.info(`[TG→App Bridge] /delete processed on hangout ${hangoutId} msg ${chatMsg.id}`);
      } catch (err) {
        logger.error('/delete command error', { error: err.message, chatId: ctx.chat.id });
        await ctx.reply('❌ Delete failed. Please try again.').catch(() => {});
      }
    });

    // DEBUG: Log all updates
    bot.use(async (ctx, next) => {
      if (ctx.message?.text?.startsWith('/')) {
        logger.info(`[TELEGRAF] Command received: text="${ctx.message.text}", from=${ctx.from?.id}, chat=${ctx.chat?.id}`);
      }
      return next();
    });

    // ─── Register middleware (best-effort — failures must not crash startup) ───
    const middlewareList = [
      ['sessionMiddleware', () => bot.use(sessionMiddleware())],
      ['privateOutboundGuard', () => bot.use(privateOutboundGuardMiddleware())],
      ['userExists', () => bot.use(userExistsMiddleware())],
      ['globalBanCheck', () => bot.use(globalBanCheck())],
      ['rateLimit', () => bot.use(rateLimitMiddleware())],
      ['groupSecurityEnforcement', () => bot.use(groupSecurityEnforcementMiddleware())],
      ['chatCleanup', () => bot.use(chatCleanupMiddleware())],
      ['groupMessageAutoDelete', () => bot.use(groupMessageAutoDeleteMiddleware())],
      ['botAdditionPrevention', () => bot.use(botAdditionPreventionMiddleware())],
      ['autoModeration', () => bot.use(autoModerationMiddleware())],
      ['moderationFilter', () => bot.use(moderationFilter())],
      ['primeChannelSilentRedirect', () => bot.use(primeChannelSilentRedirectMiddleware())],
      ['groupBehavior', () => bot.use(groupBehaviorMiddleware())],
      ['cristinaGroupFilter', () => bot.use(cristinaGroupFilterMiddleware())],
      ['groupMenuRedirect', () => bot.use(groupMenuRedirectMiddleware())],
      ['groupCallbackRedirect', () => bot.use(groupCallbackRedirectMiddleware())],
      ['wallOfFameGuard', () => bot.use(wallOfFameGuard())],
      ['notificationsTopicGuard', () => bot.use(notificationsTopicGuard())],
      ['groupCommandRestriction', () => bot.use(groupCommandRestrictionMiddleware())],
      ['notificationsAutoDelete', () => bot.use(notificationsAutoDelete())],
      ['mediaMirror', () => bot.use(mediaMirrorMiddleware())],
      ['topicPermissions', () => bot.use(topicPermissionsMiddleware())],
      ['topicModeration', () => bot.use(topicModerationMiddleware())],
      ['mediaOnlyValidator', () => bot.use(mediaOnlyValidator())],
    ];
    let mwLoaded = 0;
    for (const [name, register] of middlewareList) {
      try { register(); mwLoaded++; } catch (e) {
        logger.error(`Middleware "${name}" failed to register: ${e.message}`);
      }
    }
    logger.info(`✓ Middleware registered (${mwLoaded}/${middlewareList.length})`);

    // Group security handlers (my_chat_member events)
    try {
      registerGroupSecurityHandlers(bot);
      logger.info('✓ Group security handlers registered');
    } catch (e) { logger.error(`Group security handlers failed: ${e.message}`); }

    // PRIME channel → social feed mirror
    try {
      const { registerPrimeChannelMirrorHandler } = require('../handlers/channel/primeChannelMirrorHandler');
      registerPrimeChannelMirrorHandler(bot);
    } catch (e) { logger.error(`Prime channel mirror handler failed: ${e.message}`); }

    // ── Telegram → Webapp hangout chat bridge ────────────────────────────────
    // When a message arrives in a linked Telegram group, insert it into
    // chat_messages and broadcast to webapp clients via Socket.IO.

    /**
     * Download a Telegram CDN file and save it locally for the hangout media feed.
     * Images are processed through sharp (resize + WebP conversion).
     * Videos are saved as-is.
     *
     * @param {string} telegramFileUrl - Direct URL to the Telegram CDN file
     * @param {'image'|'video'} mediaType - The type of media
     * @param {number} hangoutId - Hangout group ID (used in filename)
     * @param {string|number} chatMsgId - chat_messages.id (used in filename for deduplication)
     * @returns {Promise<string>} Public URL path (e.g. /uploads/posts/tg-h1-m42.webp)
     */
    const downloadAndSaveHangoutMedia = async (telegramFileUrl, mediaType, hangoutId, chatMsgId) => {
      const sharp = require('sharp');
      const uploadsDir = path.join(__dirname, '../../../public/uploads/posts');
      fs.mkdirSync(uploadsDir, { recursive: true });

      const response = await fetch(telegramFileUrl);
      if (!response.ok) {
        throw new Error(`Telegram CDN fetch failed: ${response.status} ${response.statusText}`);
      }

      if (mediaType === 'image') {
        const filename = `tg-h${hangoutId}-m${chatMsgId}.webp`;
        const destPath = path.join(uploadsDir, filename);
        const buffer = Buffer.from(await response.arrayBuffer());
        await sharp(buffer)
          .resize(800, 800, { fit: 'inside' })
          .webp({ quality: 70 })
          .toFile(destPath);
        return `/uploads/posts/${filename}`;
      } else {
        // video — save raw
        const filename = `tg-h${hangoutId}-m${chatMsgId}.mp4`;
        const destPath = path.join(uploadsDir, filename);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(destPath, buffer);
        return `/uploads/posts/${filename}`;
      }
    };

    /**
     * Download TG DM media to local storage — required because Telegram CDN
     * links expire after 1 hour. Returns a persistent /uploads/dm-media/... URL.
     */
    const downloadAndSaveDmMedia = async (telegramFileUrl, mediaType, telegramUserId, telegramMsgId) => {
      const sharp = require('sharp');
      const uploadsDir = path.join(__dirname, '../../../../public/uploads/dm-media');
      fs.mkdirSync(uploadsDir, { recursive: true });

      const response = await fetch(telegramFileUrl);
      if (!response.ok) {
        throw new Error(`Telegram CDN fetch failed: ${response.status} ${response.statusText}`);
      }

      const ext = mediaType === 'image' ? 'webp' : mediaType === 'video' ? 'mp4' : 'ogg';
      const filename = `tg-${telegramUserId}-${telegramMsgId}.${ext}`;
      const destPath = path.join(uploadsDir, filename);
      const buffer = Buffer.from(await response.arrayBuffer());

      if (mediaType === 'image') {
        await sharp(buffer)
          .resize(1280, 1280, { fit: 'inside' })
          .webp({ quality: 80 })
          .toFile(destPath);
      } else {
        fs.writeFileSync(destPath, buffer);
      }
      return `/uploads/dm-media/${filename}`;
    };

    bot.on('message', async (ctx, next) => {
      // Only handle group/supergroup messages
      if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return next();
      // Skip bot commands — they're handled by dedicated handlers
      if (ctx.message?.text?.startsWith('/')) return next();
      // Skip messages from bots (including our own bridge forwards)
      if (ctx.from?.is_bot) return next();

      const chatId = ctx.chat.id;
      try {
        const { query: dbQuery } = require('../../config/postgres');
        const socketIO = require('../../services/socketSingleton').get();
        if (!socketIO) return next();

        // Check if this Telegram group is linked to a hangout
        const { getRedis } = require('../../config/redis');
        const redis = getRedis();
        const cacheKey = `tg-hangout-link:${chatId}`;
        let hangoutId = null;

        // Cache the link lookup for 60s to avoid DB hits on every message
        const cached = await redis.get(cacheKey);
        if (cached === 'none') return next();
        if (cached) {
          hangoutId = parseInt(cached, 10);
        } else {
          const { rows } = await dbQuery(
            'SELECT id FROM hangout_groups WHERE telegram_chat_id = $1',
            [chatId]
          );
          if (rows.length === 0) {
            await redis.set(cacheKey, 'none', 'EX', 60);
            return next();
          }
          hangoutId = rows[0].id;
          await redis.set(cacheKey, String(hangoutId), 'EX', 60);
        }

        // Resolve the PNPtv user from their Telegram ID
        const telegramId = String(ctx.from.id);
        const { rows: userRows } = await dbQuery(
          'SELECT id, username, first_name, photo_file_id FROM users WHERE telegram = $1 LIMIT 1',
          [telegramId]
        );

        // Use PNPtv user data if found, otherwise use Telegram profile
        const userId = userRows[0]?.id || null;
        const username = userRows[0]?.username || ctx.from.username || null;
        const firstName = userRows[0]?.first_name || ctx.from.first_name || 'Telegram User';
        const rawPhoto = userRows[0]?.photo_file_id || null;
        const isValidPhoto = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));
        const photoUrl = isValidPhoto(rawPhoto) ? rawPhoto : null;

        const room = `hangout:${hangoutId}`;

        // Auto-add Telegram user as hangout member if they're a registered PNPtv user
        if (userId) {
          const addResult = await dbQuery(
            `INSERT INTO hangout_group_members (group_id, user_id, role)
             VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
            [hangoutId, userId]
          );
          // Send welcome message only if this is a first-time join
          if (addResult.rowCount > 0) {
            (async () => {
              try {
                const { rows: grpRows } = await dbQuery('SELECT name, rules FROM hangout_groups WHERE id = $1', [hangoutId]);
                if (!grpRows.length) return;
                const { name: grpName, rules: grpRules } = grpRows[0];
                const rulesBlock = grpRules
                  ? `📋 *Group rules:*\n${grpRules}`
                  : `No special rules set yet — just respect and good vibes! 🌈`;
                const displayFirst = firstName || username || 'there';
                const welcomeText =
                  `🧜‍♀️ *Cristina AI agent says:*\n\n` +
                  `Welcome to *${grpName}*, ${displayFirst}! 🎉\n\n` +
                  `I'm Cristina, your PNPtv AI guide. Here's what you need to know:\n\n` +
                  `📱 *Use the PNPtv app* for the full experience — live chat, media feed, video calls, and more. This Telegram group mirrors the conversation, but the full features are in the app.\n\n` +
                  `💡 *Tip:* Photos and videos shared here automatically appear in the group's media feed. Text messages stay in chat. Everything is only visible to members.\n\n` +
                  `${rulesBlock}\n\n` +
                  `Questions? Say "Hey Cristina" in the app anytime.`;

                const { rows: ins } = await dbQuery(
                  `INSERT INTO chat_messages (room, user_id, username, first_name, content)
                   VALUES ($1, 'cristina-ai', 'cristina', 'Cristina', $2) RETURNING id, created_at`,
                  [room, welcomeText]
                );
                if (socketIO && ins[0]) {
                  socketIO.to(room).emit('chat:message', {
                    id: ins[0].id, room,
                    user_id: 'cristina-ai', username: 'cristina', first_name: 'Cristina',
                    photo_url: null, content: welcomeText, created_at: ins[0].created_at,
                  });
                }
                // Also send TG DM
                if (botInstance && telegramId) {
                  await botInstance.telegram.sendMessage(telegramId, welcomeText, { parse_mode: 'Markdown' })
                    .catch(() => {}); // user may have DMs disabled
                }
              } catch (wErr) {
                logger.warn('[TG Bridge] Welcome message failed', { error: wErr.message, hangoutId });
              }
            })();
          }
        }

        // ── Extract content from various Telegram message types ──
        let textContent = null;
        let mediaUrl = null;
        let mediaType = null;
        let mediaMime = null;
        let mediaThumbUrl = null;
        let mediaWidth = null;
        let mediaHeight = null;

        const msg = ctx.message;

        if (msg.text) {
          textContent = msg.text.slice(0, 2000);
        }

        if (msg.caption) {
          textContent = msg.caption.slice(0, 2000);
        }

        // Photo
        if (msg.photo && msg.photo.length > 0) {
          try {
            const largest = msg.photo[msg.photo.length - 1];
            const fileLink = await ctx.telegram.getFileLink(largest.file_id);
            mediaUrl = fileLink.href || fileLink.toString();
            mediaType = 'image';
            mediaMime = 'image/jpeg';
            mediaWidth = largest.width;
            mediaHeight = largest.height;
          } catch (e) { logger.warn('Bridge: failed to get photo link', { error: e.message }); }
        }

        // Video / video note
        if (msg.video || msg.video_note) {
          try {
            const vid = msg.video || msg.video_note;
            const fileLink = await ctx.telegram.getFileLink(vid.file_id);
            mediaUrl = fileLink.href || fileLink.toString();
            mediaType = 'video';
            mediaMime = vid.mime_type || 'video/mp4';
            mediaWidth = vid.width;
            mediaHeight = vid.height;
          } catch (e) { logger.warn('Bridge: failed to get video link', { error: e.message }); }
        }

        // Voice / audio
        if (msg.voice || msg.audio) {
          try {
            const aud = msg.voice || msg.audio;
            const fileLink = await ctx.telegram.getFileLink(aud.file_id);
            mediaUrl = fileLink.href || fileLink.toString();
            mediaType = 'audio';
            mediaMime = aud.mime_type || 'audio/ogg';
          } catch (e) { logger.warn('Bridge: failed to get audio link', { error: e.message }); }
        }

        // Sticker → treat as image
        if (msg.sticker && !msg.sticker.is_animated && !msg.sticker.is_video) {
          try {
            const fileLink = await ctx.telegram.getFileLink(msg.sticker.file_id);
            mediaUrl = fileLink.href || fileLink.toString();
            mediaType = 'image';
            mediaMime = 'image/webp';
            mediaWidth = msg.sticker.width;
            mediaHeight = msg.sticker.height;
            if (!textContent) textContent = msg.sticker.emoji || null;
          } catch (e) { logger.warn('Bridge: failed to get sticker link', { error: e.message }); }
        }

        // Skip if no useful content
        if (!textContent && !mediaUrl) return next();

        // Mark message as originating from Telegram bridge (store in metadata)
        const metadata = { source: 'telegram', telegramMsgId: msg.message_id, telegramUserId: telegramId };

        // Insert into chat_messages
        const { rows: inserted } = await dbQuery(
          `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content,
             media_url, media_type, media_mime, media_thumb_url, media_width, media_height, media_metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id, room, user_id, username, first_name, photo_url, content,
                     media_url, media_type, media_mime, media_thumb_url,
                     media_width, media_height, media_metadata, reply_to_id, created_at`,
          [
            room, userId, username, firstName, photoUrl, textContent,
            mediaUrl, mediaType, mediaMime, mediaThumbUrl, mediaWidth, mediaHeight,
            JSON.stringify(metadata),
          ]
        );

        const chatMsg = { ...inserted[0], photo_url: isValidPhoto(inserted[0].photo_url) ? inserted[0].photo_url : null };

        // Broadcast to webapp clients
        socketIO.to(room).emit('chat:message', chatMsg);

        // ── Auto-promote media to hangout feed ──────────────────────────────────────
        // Photos and videos from Telegram are downloaded locally and published as
        // social posts in the hangout feed. source_message_id deduplicates.
        if (mediaUrl && (mediaType === 'image' || mediaType === 'video') && userId) {
          const chatMsgId = chatMsg.id;
          (async () => {
            try {
              const SocialPostService = require('../../services/socialPostService');
              const localUrl = await downloadAndSaveHangoutMedia(mediaUrl, mediaType, hangoutId, chatMsgId);
              await SocialPostService.createPost(
                userId, textContent || null, localUrl, mediaType,
                null, null, false, false, true, null, null, null,
                hangoutId, chatMsgId
              );
              socketIO.to(room).emit('hangout:feed:new_post', { groupId: hangoutId });
              logger.info(`[TG→Feed] Media promoted to hangout ${hangoutId} feed`, { chatMsgId });
            } catch (feedErr) {
              // Unique constraint violation = already promoted (idempotent)
              if (feedErr.code !== '23505') {
                logger.warn('[TG→Feed] Failed to promote media to feed', { error: feedErr.message, chatMsgId: chatMsg.id });
              }
            }
          })();
        }

        // ── Bridge TG replies to media social posts ──────────────────────────────────
        // If this message is a reply to a TG message that has a social post,
        // create a social post reply so the thread appears in the hangout feed.
        if (msg.reply_to_message && textContent && userId) {
          const replyTgMsgId = msg.reply_to_message.message_id;
          (async () => {
            try {
              const SocialPostService = require('../../services/socialPostService');
              // Find chat_message for the replied-to TG message
              const { rows: parentChatRows } = await dbQuery(
                `SELECT id FROM chat_messages
                 WHERE room = $1 AND (media_metadata->>'telegramMsgId')::bigint = $2 LIMIT 1`,
                [room, replyTgMsgId]
              );
              if (!parentChatRows.length) return;
              // Find social post linked to that chat message
              const { rows: parentPostRows } = await dbQuery(
                `SELECT id FROM social_posts WHERE source_message_id = $1 LIMIT 1`,
                [parentChatRows[0].id]
              );
              if (!parentPostRows.length) return;
              await SocialPostService.createPost(
                userId, textContent, null, null,
                parentPostRows[0].id, null,
                false, false, true, null, null, null,
                hangoutId, null
              );
              socketIO.to(room).emit('hangout:feed:new_post', { groupId: hangoutId });
              logger.info(`[TG→Feed] Reply bridged to social post ${parentPostRows[0].id}`, { hangoutId });
            } catch (replyErr) {
              logger.warn('[TG→Feed] Reply bridge failed', { error: replyErr.message });
            }
          })();
        }

        // Touch activity timestamp
        await dbQuery('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [hangoutId]);

        logger.info(`[TG→App Bridge] ${firstName} in hangout ${hangoutId}: ${textContent?.slice(0, 50) || '[media]'}`);
      } catch (err) {
        logger.error('[TG→App Bridge] Error', { error: err.message, chatId });
      }
      return next();
    });

    // ── Telegram video chat events → Webapp bridge ───────────────────────────
    // Catches video_chat_started / video_chat_ended / video_chat_participants_invited
    // service messages and emits real-time Socket.IO events to webapp clients.
    bot.on('message', async (ctx, next) => {
      // Only handle group/supergroup service messages
      if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return next();

      const msg = ctx.message;
      // Only care about video chat service messages
      const isVideoEvent = msg.video_chat_started || msg.video_chat_ended || msg.video_chat_participants_invited;
      if (!isVideoEvent) return next();

      const chatId = ctx.chat.id;
      try {
        const { query: dbQuery } = require('../../config/postgres');
        const socketIO = require('../../services/socketSingleton').get();
        if (!socketIO) return next();

        // Resolve hangout group via Redis-cached lookup (same pattern as message bridge)
        const { getRedis } = require('../../config/redis');
        const redis = getRedis();
        const cacheKey = `tg-hangout-link:${chatId}`;
        let hangoutId = null;

        const cached = await redis.get(cacheKey);
        if (cached === 'none') return next();
        if (cached) {
          hangoutId = parseInt(cached, 10);
        } else {
          const { rows } = await dbQuery(
            'SELECT id FROM hangout_groups WHERE telegram_chat_id = $1',
            [chatId]
          );
          if (rows.length === 0) {
            await redis.set(cacheKey, 'none', 'EX', 60);
            return next();
          }
          hangoutId = rows[0].id;
          await redis.set(cacheKey, String(hangoutId), 'EX', 60);
        }

        const room = `hangout:${hangoutId}`;

        if (msg.video_chat_started) {
          // Fetch invite link from DB to embed in the event
          const { rows: groupRows } = await dbQuery(
            'SELECT telegram_invite_link FROM hangout_groups WHERE id = $1',
            [hangoutId]
          );
          const inviteLink = groupRows[0]?.telegram_invite_link || null;

          const firstName = ctx.from?.first_name || ctx.from?.username || 'Someone';
          const username = ctx.from?.username || null;

          socketIO.to(room).emit('hangout:call:started', {
            groupId: hangoutId,
            startedBy: { firstName, username },
            inviteLink,
          });
          logger.info(`[TG Video Bridge] Call started in hangout ${hangoutId} by ${firstName}`);

        } else if (msg.video_chat_ended) {
          socketIO.to(room).emit('hangout:call:ended', { groupId: hangoutId });
          logger.info(`[TG Video Bridge] Call ended in hangout ${hangoutId}`);

        } else if (msg.video_chat_participants_invited) {
          const count = msg.video_chat_participants_invited?.users?.length ?? 1;
          socketIO.to(room).emit('hangout:call:participant-joined', { groupId: hangoutId, count });
          logger.info(`[TG Video Bridge] ${count} participant(s) invited to call in hangout ${hangoutId}`);
        }
      } catch (err) {
        logger.error('[TG Video Bridge] Error', { error: err.message, chatId });
      }
      return next();
    });
    // ── Telegram edited_message → Webapp hangout edit bridge ────────────────
    bot.on('edited_message', async (ctx, next) => {
      if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return next();
      if (ctx.from?.is_bot) return next();

      const chatId = ctx.chat.id;
      try {
        const { query: dbQuery } = require('../../config/postgres');
        const socketIO = require('../../services/socketSingleton').get();
        if (!socketIO) return next();

        const { getRedis } = require('../../config/redis');
        const redis = getRedis();
        const cacheKey = `tg-hangout-link:${chatId}`;
        let hangoutId = null;

        const cached = await redis.get(cacheKey);
        if (cached === 'none') return next();
        if (cached) {
          hangoutId = parseInt(cached, 10);
        } else {
          const { rows } = await dbQuery(
            'SELECT id FROM hangout_groups WHERE telegram_chat_id = $1',
            [chatId]
          );
          if (rows.length === 0) {
            await redis.set(cacheKey, 'none', 'EX', 60);
            return next();
          }
          hangoutId = rows[0].id;
          await redis.set(cacheKey, String(hangoutId), 'EX', 60);
        }

        const editedMsg = ctx.editedMessage;
        const tgMsgId = editedMsg.message_id;
        const newText = editedMsg.text || editedMsg.caption || null;
        if (!newText) return next();

        const room = `hangout:${hangoutId}`;

        // Find the chat_message by Telegram message ID
        const { rows: msgRows } = await dbQuery(
          `SELECT id, user_id, content FROM chat_messages
           WHERE room = $1 AND (media_metadata->>'telegramMsgId')::bigint = $2
           LIMIT 1`,
          [room, tgMsgId]
        );
        if (msgRows.length === 0) return next();

        const chatMsg = msgRows[0];
        const newContent = newText.slice(0, 2000);

        const { rows: updated } = await dbQuery(
          `UPDATE chat_messages
           SET content = $1,
               edited_at = NOW(),
               edit_count = edit_count + 1,
               original_content = COALESCE(original_content, content)
           WHERE id = $2
           RETURNING id, content, edited_at, edit_count`,
          [newContent, chatMsg.id]
        );

        if (updated.length > 0) {
          socketIO.to(room).emit('hangout:message:edited', {
            messageId: updated[0].id,
            content:   updated[0].content,
            editedAt:  updated[0].edited_at,
            editCount: updated[0].edit_count,
          });
          logger.info(`[TG→App Bridge] Message ${chatMsg.id} edited in hangout ${hangoutId}`);
        }
      } catch (err) {
        logger.error('[TG→App Bridge] edited_message error', { error: err.message, chatId });
      }
      return next();
    });

    // ── Telegram message_reaction → Webapp hangout reaction bridge ──────────
    bot.on('message_reaction', async (ctx, next) => {
      const mr = ctx.messageReaction;
      if (!mr?.message?.chat?.id) return next();
      if (mr.user?.is_bot) return next();

      const chatId = mr.message.chat.id;
      try {
        const { query: dbQuery } = require('../../config/postgres');
        const socketIO = require('../../services/socketSingleton').get();
        if (!socketIO) return next();

        const { getRedis } = require('../../config/redis');
        const redis = getRedis();
        const cacheKey = `tg-hangout-link:${chatId}`;
        let hangoutId = null;

        const cached = await redis.get(cacheKey);
        if (cached === 'none') return next();
        if (cached) {
          hangoutId = parseInt(cached, 10);
        } else {
          const { rows } = await dbQuery(
            'SELECT id FROM hangout_groups WHERE telegram_chat_id = $1',
            [chatId]
          );
          if (rows.length === 0) {
            await redis.set(cacheKey, 'none', 'EX', 60);
            return next();
          }
          hangoutId = rows[0].id;
          await redis.set(cacheKey, String(hangoutId), 'EX', 60);
        }

        // Resolve PNPtv user from Telegram reactor — skip anonymous/channel reactions
        const telegramReactorId = String(mr.user?.id || '');
        if (!telegramReactorId) return next();
        const { rows: userRows } = await dbQuery(
          'SELECT id FROM users WHERE telegram = $1 LIMIT 1',
          [telegramReactorId]
        );
        const pnptvUserId = userRows[0]?.id;
        if (!pnptvUserId) return next(); // unregistered TG user — can't attribute reaction

        const room = `hangout:${hangoutId}`;
        const tgMsgId = mr.message.message_id;

        // Find the chat_message by its TG message ID
        const { rows: msgRows } = await dbQuery(
          `SELECT id FROM chat_messages
           WHERE room = $1 AND (media_metadata->>'telegramMsgId')::bigint = $2
           LIMIT 1`,
          [room, tgMsgId]
        );
        if (msgRows.length === 0) return next();
        const chatMsgId = msgRows[0].id;

        // Extract emoji from reactions (type: 'emoji' only — custom emoji won't render cleanly)
        const toEmoji = (r) => (r?.type === 'emoji' ? r.emoji : null);
        const newSet = new Set((mr.new_reaction || []).map(toEmoji).filter(Boolean));
        const oldSet = new Set((mr.old_reaction || []).map(toEmoji).filter(Boolean));

        const added = [...newSet].filter(e => !oldSet.has(e));
        const removed = [...oldSet].filter(e => !newSet.has(e));

        // Remove cleared reactions
        for (const emoji of removed) {
          await dbQuery(
            `DELETE FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
            [chatMsgId, String(pnptvUserId), emoji]
          );
        }
        // Add new reactions (respect 20-emoji-per-message cap)
        for (const emoji of added) {
          const { rows: capRows } = await dbQuery(
            `SELECT COUNT(DISTINCT emoji)::int AS cnt FROM chat_message_reactions WHERE message_id=$1`,
            [chatMsgId]
          );
          if (capRows[0].cnt >= 20) break;
          await dbQuery(
            `INSERT INTO chat_message_reactions (message_id, user_id, emoji)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [chatMsgId, String(pnptvUserId), emoji]
          );
        }

        if (added.length === 0 && removed.length === 0) return next();

        // Aggregate and broadcast
        const { rows: agg } = await dbQuery(
          `SELECT emoji, COUNT(*)::int AS cnt,
                  json_agg(json_build_object('id', u.id, 'username', u.username)) AS users
           FROM chat_message_reactions cr
           JOIN users u ON u.id = cr.user_id
           WHERE message_id=$1
           GROUP BY emoji`,
          [chatMsgId]
        );

        socketIO.to(room).emit('hangout:reaction:updated', {
          messageId: chatMsgId,
          reactions: agg,
        });
        logger.info(`[TG→App Bridge] Reaction synced on hangout ${hangoutId} msg ${chatMsgId}`);
      } catch (err) {
        logger.error('[TG→App Bridge] message_reaction error', { error: err.message, chatId });
      }
      return next();
    });

    // ── Telegram private message → Webapp DM bridge ─────────────────────────
    // When a user sends a private message to the bot, bridge it as a webapp DM
    // to the person they were last chatting with (tracked via Redis).
    // If the message is a reply to a DM notification, use that specific sender.
    bot.on('message', async (ctx, next) => {
      if (ctx.chat.type !== 'private') return next();
      if (ctx.message?.text?.startsWith('/')) return next();
      if (ctx.from?.is_bot) return next();

      const telegramId = String(ctx.from.id);
      try {
        const { query: dbQuery } = require('../../config/postgres');
        const { getRedis } = require('../../config/redis');
        const redis = getRedis();

        // Look up PNPtv user by Telegram ID
        const { rows: userRows } = await dbQuery(
          'SELECT id, username, first_name, photo_file_id, role FROM users WHERE telegram = $1 LIMIT 1',
          [telegramId]
        );
        if (userRows.length === 0) return next(); // not a registered user

        const pnptvUser = userRows[0];
        let dmPartnerId = null;

        // Check if this is a reply to a DM bridge notification
        const replyToMsg = ctx.message.reply_to_message;
        if (replyToMsg) {
          const bridgeKey = `dm:tg-bridge:${telegramId}:${replyToMsg.message_id}`;
          const bridgeData = await redis.get(bridgeKey);
          if (bridgeData) {
            const parsed = JSON.parse(bridgeData);
            dmPartnerId = parsed.senderId; // reply to the original sender
          }
        }

        // Fallback: use last DM partner
        if (!dmPartnerId) {
          dmPartnerId = await redis.get(`dm:tg-last-partner:${telegramId}`);
        }

        if (!dmPartnerId) return next(); // no DM context — let other handlers handle it

        // Extract content
        const msg = ctx.message;
        let textContent = msg.text || msg.caption || null;
        let mediaUrl = null;
        let mediaType = null;
        let mediaMime = null;
        let mediaThumbUrl = null;

        // Handle media — download locally since TG CDN URLs expire after 1h
        const tgMsgId = msg.message_id;
        if (msg.photo && msg.photo.length > 0) {
          try {
            const largest = msg.photo[msg.photo.length - 1];
            const fileLink = await ctx.telegram.getFileLink(largest.file_id);
            mediaUrl = await downloadAndSaveDmMedia(fileLink.href || fileLink.toString(), 'image', telegramId, tgMsgId);
            mediaType = 'image';
            mediaMime = 'image/webp';
          } catch (e) { logger.warn('[TG→App DM] Failed to save photo', { error: e.message }); }
        }
        if (msg.video || msg.video_note) {
          try {
            const vid = msg.video || msg.video_note;
            const fileLink = await ctx.telegram.getFileLink(vid.file_id);
            mediaUrl = await downloadAndSaveDmMedia(fileLink.href || fileLink.toString(), 'video', telegramId, tgMsgId);
            mediaType = 'video';
            mediaMime = vid.mime_type || 'video/mp4';
          } catch (e) { logger.warn('[TG→App DM] Failed to save video', { error: e.message }); }
        }
        if (msg.voice || msg.audio) {
          try {
            const aud = msg.voice || msg.audio;
            const fileLink = await ctx.telegram.getFileLink(aud.file_id);
            mediaUrl = await downloadAndSaveDmMedia(fileLink.href || fileLink.toString(), 'audio', telegramId, tgMsgId);
            mediaType = 'audio';
            mediaMime = aud.mime_type || 'audio/ogg';
          } catch (e) { logger.warn('[TG→App DM] Failed to save audio', { error: e.message }); }
        }

        if (!textContent && !mediaUrl) return next();

        // Send DM via DmService
        const DmService = require('../../services/dmService');
        const isAdmin = pnptvUser.role === 'admin' || pnptvUser.role === 'superadmin';
        const dmData = {
          content: textContent ? textContent.slice(0, 4000) : null,
          mediaUrl, mediaType, mediaMime, mediaThumbUrl,
        };

        const message = await DmService.sendMessage(pnptvUser.id, dmPartnerId, dmData, { isAdmin });

        // Emit to recipient via Socket.IO
        const socketIO = require('../../services/socketSingleton').get();
        if (socketIO) {
          socketIO.to(`user:${dmPartnerId}`).emit('dm:message', {
            ...message,
            senderName: pnptvUser.first_name || pnptvUser.username || 'User',
            senderPhoto: pnptvUser.photo_file_id || null,
          });
        }

        // Update last partner for the recipient too (so they can reply from TG)
        await redis.set(`dm:tg-last-partner:${telegramId}`, String(dmPartnerId), 'EX', 86400);

        // Look up partner's display name for the confirmation
        const { rows: partnerRows } = await dbQuery(
          'SELECT username, first_name FROM users WHERE id = $1',
          [dmPartnerId]
        );
        const partnerName = partnerRows[0]?.first_name || partnerRows[0]?.username || 'your contact';

        // Confirm to the Telegram user
        await ctx.reply(`✅ Delivered to ${partnerName} on PNPtv.`, { reply_to_message_id: msg.message_id })
          .catch(() => {}); // silent if reply fails

        logger.info(`[TG→App DM Bridge] ${pnptvUser.username || telegramId} → ${dmPartnerId}`);
        return; // Don't pass to next — this message was handled as a DM bridge
      } catch (err) {
        if (err.statusCode) {
          // DmService threw a policy error — inform user
          await ctx.reply(`❌ ${err.message}`).catch(() => {});
          return;
        }
        logger.error('[TG→App DM Bridge] Error', { error: err.message, telegramId });
      }
      return next();
    });

    // ── End Telegram → Webapp bridge ───────────────────────────────────────────

    // Register handlers

    // Generic message handler for private chats to route to support
    bot.on('message', async (ctx, next) => {
      // Only process messages from private chats
      if (ctx.chat.type !== 'private') {
        return next();
      }

      // Skip commands as they are handled elsewhere
      if (ctx.message?.text?.startsWith('/')) {
        return next();
      }

      const isAwaitingSupportMessage = Boolean(ctx.session?.awaitingSupportMessage);
      const isContactingAdmin = Boolean(ctx.session?.temp?.contactingAdmin);
      const isRequestingActivation = Boolean(ctx.session?.temp?.requestingActivation);
      const isWaitingForEmail = Boolean(ctx.session?.temp?.waitingForEmail);
      const adminSessionFlags = Boolean(
        ctx.session?.temp?.broadcastStep ||
        ctx.session?.temp?.broadcastTarget ||
        ctx.session?.temp?.broadcastData ||
        ctx.session?.temp?.customButtons ||
        ctx.session?.temp?.adminSearchingUser ||
        ctx.session?.temp?.activatingMembership ||
        ctx.session?.temp?.activationStep ||
        ctx.session?.temp?.awaitingMessageInput ||
        ctx.session?.temp?.adminMode ||
        ctx.session?.temp?.adminAction
      );
      let isAdminUser = ADMIN_USER_IDS.includes(String(ctx.from?.id));
      const needsAdminCheck = adminSessionFlags || isAwaitingSupportMessage || isContactingAdmin || isRequestingActivation;
      if (!isAdminUser && needsAdminCheck) {
        try {
          const PermissionService = require('../../services/permissionService');
          isAdminUser = await PermissionService.isAdmin(ctx.from?.id);
        } catch (adminCheckError) {
          logger.warn(`Admin permission check failed during support routing guard: ${adminCheckError.message}`);
        }
      }
      const isAdminFlow = isAdminUser && adminSessionFlags;

      const replyToMessage = ctx.message?.reply_to_message;
      const isReplyToSupport = Boolean(replyToMessage && (
        replyToMessage.text?.includes('(Soporte):') ||
        replyToMessage.caption?.includes('(Soporte):') ||
        replyToMessage.text?.includes('Para responder:') ||
        replyToMessage.text?.includes('To reply:')
      ));

      if (isWaitingForEmail) {
        return next();
      }

      if (isAdminUser) {
        if (isAwaitingSupportMessage || isContactingAdmin || isRequestingActivation) {
          ctx.session.awaitingSupportMessage = false;
          if (ctx.session?.temp) {
            ctx.session.temp.contactingAdmin = false;
            ctx.session.temp.requestingActivation = false;
          }
          await ctx.saveSession();
        }
        if (isAdminFlow) {
          return next();
        }
        // Avoid routing admin messages to support even if stale support flags exist
        return next();
      }

      const isSupportIntent = isAwaitingSupportMessage || isContactingAdmin || isRequestingActivation || isReplyToSupport;

      if (!isSupportIntent) {
        // Redirect non-onboarded users to web app (bot features migrated to pnptv.app)
        const user = await UserService.getOrCreateFromContext(ctx);
        if (!user?.onboardingComplete && !isWaitingForEmail) {
          await ctx.reply(
            '🌐 PNPtv! has moved to the web!\n\nVisit https://pnptv.app to get started.',
            { reply_markup: { inline_keyboard: [[{ text: '🚀 Open PNPtv!', url: 'https://pnptv.app' }]] } }
          );
          return;
        }
        return next();
      }

      // Handle support-intent text flows here to avoid double-processing
      if (ctx.message?.text && (isContactingAdmin || isRequestingActivation || isReplyToSupport)) {
        const lang = getLanguage(ctx);

        if (isReplyToSupport) {
          try {
            await supportRoutingService.forwardUserMessage(ctx, 'text', 'support');
            const confirmMsg = lang === 'es'
              ? '✅ Tu respuesta ha sido enviada al equipo de soporte.'
              : '✅ Your reply has been sent to the support team.';
            await ctx.reply(confirmMsg, { reply_to_message_id: ctx.message.message_id });
          } catch (error) {
            logger.error('Error forwarding user reply to support:', error);
          }
          return;
        }

        try {
          const requestType = isRequestingActivation ? 'activation' : 'support';
          const message = ctx.message.text;
          let supportTopic = null;
          try {
            supportTopic = await supportRoutingService.sendToSupportGroup(message, requestType, ctx.from, 'text', ctx);
          } catch (routingError) {
            logger.error(`Failed to send message to support group: ${routingError.message}`);
          }

          const adminIds = process.env.ADMIN_USER_IDS?.split(',').filter((id) => id.trim()) || [];
          for (const adminId of adminIds) {
            try {
              const escapedUsername = ctx.from.username ? ctx.from.username.replace(/@/g, '\\@') : 'no username';
              const prefix = requestType === 'activation' ? '🎁 Activation Request' : '📬 Support Message';
              await ctx.telegram.sendMessage(adminId.trim(), `${prefix} from User ${ctx.from.id} (@${escapedUsername}):\n\n${message}`);
            } catch (sendError) {
              logger.error('Error sending to admin:', sendError);
            }
          }

          if (ctx.session?.temp) {
            ctx.session.temp.contactingAdmin = false;
            ctx.session.temp.requestingActivation = false;
          }
          if (ctx.session?.awaitingSupportMessage) {
            ctx.session.awaitingSupportMessage = false;
          }
          await ctx.saveSession();

          const replyInstructions = lang === 'es'
            ? '\n\n💡 *Para responder:* Mantén presionado el mensaje de soporte y selecciona "Responder".'
            : '\n\n💡 *To reply:* Tap and hold the support message and select "Reply".';

          const confirmationMessage = supportTopic
            ? (lang === 'es'
                ? `✅ *Mensaje enviado*\n\n🎫 Tu ticket de soporte: #${supportTopic.thread_id}\n\nNuestro equipo te responderá pronto. Recibirás las respuestas directamente aquí.${replyInstructions}`
                : `✅ *Message sent*\n\n🎫 Your support ticket: #${supportTopic.thread_id}\n\nOur team will respond shortly. You'll receive responses directly here.${replyInstructions}`)
            : t('messageSent', lang);

          await ctx.reply(confirmationMessage, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback(t('back', lang), 'show_support')]])
          });
        } catch (error) {
          logger.error('Error processing support-intent text:', error);
        }
        return;
      }

      // Check if the message is media or text
      let messageType = 'text';
      if (ctx.message.photo) messageType = 'photo';
      else if (ctx.message.document) messageType = 'document';
      else if (ctx.message.video) messageType = 'video';
      else if (ctx.message.voice) messageType = 'voice';
      else if (ctx.message.audio) messageType = 'audio';
      else if (ctx.message.sticker) messageType = 'sticker';
      else if (ctx.message.animation) messageType = 'animation';
      
      // Forward the message to the support routing service
      try {
        const requestType = isRequestingActivation ? 'activation' : 'support';
        await supportRoutingService.forwardUserMessage(ctx, messageType, requestType);
        if (isAwaitingSupportMessage) {
          ctx.session.awaitingSupportMessage = false;
          await ctx.saveSession();
        }
        // Add a reaction to indicate the message was received
        try {
          await ctx.react('👍');
        } catch (reactError) {
          logger.debug('Could not add reaction to user message:', reactError.message);
        }
      } catch (error) {
        logger.error('Error forwarding user message to support:', error);
        await ctx.reply('❌ Hubo un error al enviar tu mensaje al soporte. Por favor, inténtalo de nuevo más tarde.');
      }
      // Do not call next() as this message has been handled by the support system
    });


    // ─── Register bot handlers (best-effort — failures must not crash startup) ───
    const handlerList = [
      ['adminHandlers', () => registerAdminHandlers(bot)],
      ['moderationAdminHandlers', () => registerModerationAdminHandlers(bot)],
      ['roleManagementHandlers', () => registerRoleManagementHandlers(bot)],
      ['wallOfFameHandlers', () => registerWallOfFameHandlers(bot)],
      ['paymentTutorialHandlers', () => registerPaymentTutorialHandlers(bot)],
      ['supportRoutingHandlers', () => registerSupportRoutingHandlers(bot)],
    ];
    let hLoaded = 0;
    for (const [name, register] of handlerList) {
      try { register(); hLoaded++; } catch (e) {
        logger.error(`Handler "${name}" failed to register: ${e.message}`);
      }
    }
    logger.info(`✓ Bot handlers registered (${hLoaded}/${handlerList.length})`);

    // Initialize support routing service with telegram instance
    try {
      supportRoutingService.initialize(bot.telegram);
      logger.info('✓ Support routing service initialized');
    } catch (e) { logger.error(`Support routing service init failed: ${e.message}`); }
    // Start SLA monitor if configured (after support routing is ready)
    const slaCheckInterval = parseInt(process.env.SLA_CHECK_INTERVAL) || 3600000;
    if (process.env.SUPPORT_GROUP_ID && process.env.SLA_MONITOR_ENABLED !== 'false') {
      slaMonitor.start(slaCheckInterval);
      logger.info('SLA monitor initialized', { intervalMs: slaCheckInterval });
    } else {
      logger.info('SLA monitor disabled (SUPPORT_GROUP_ID not configured or SLA_MONITOR_ENABLED=false)');
    }
    // --- User-facing services DISABLED (migrated to web app) ---
    // setupAgeVerificationMiddleware(bot);
    // CallReminderService.initialize(bot);
    // Private calls pronto worker — disabled
    // PNP Live worker — disabled
    // --- End disabled user-facing services ---
    // Initialize membership cleanup service (for daily status updates and channel management)
    MembershipCleanupService.initialize(bot);
    logger.info('✓ Membership cleanup service initialized');
    BusinessNotificationService.initialize(bot);
    logger.info('✓ Business notification service initialized');
    // Start cron jobs for scheduled tasks (membership sync, cleanup, etc.)
    try {
      await startCronJobs(bot);
      logger.info('✓ Cron jobs started');
    } catch (cronError) {
      logger.warn(`Cron jobs initialization failed, continuing without scheduled tasks: ${cronError.message}`);
    }
    // Initialize message rate limiter (to limit group messages to 6/day)
    MessageRateLimiter.initialize();
    logger.info('✓ Message rate limiter initialized');

    // TutorialReminderService — disabled (migrated to web app)
    // TutorialReminderService.initialize(bot);
    // TutorialReminderService.startScheduling();
    // Initialize group cleanup service
    const groupCleanup = new GroupCleanupService(bot);
    groupCleanup.initialize();
    // Initialize broadcast scheduler service
    try {
      broadcastScheduler.initialize(bot);
      broadcastScheduler.start();
      logger.info('✓ Broadcast scheduler initialized and started');
    } catch (error) {
      logger.warn(`Broadcast scheduler initialization failed, continuing without scheduler: ${error.message}`);
    }
    // Initialize broadcast buttons tables (presets/custom CTAs)
    try {
      await BroadcastButtonModel.initializeTables();
    } catch (error) {
      logger.warn(`Broadcast button tables initialization failed (broadcasts will run without presets until fixed): ${error.message}`);
    }
    // Media popularity scheduler (removed in X integration purge)
    // Initialize async broadcast queue
    try {
      const queueIntegration = await initializeAsyncBroadcastQueue(bot, {
        concurrency: 2,
        maxAttempts: 3,
        autoStart: true,
      });
      global.broadcastQueueIntegration = queueIntegration;
      logger.info('✓ Async broadcast queue initialized and started');
    } catch (error) {
      logger.warn(`Async broadcast queue initialization failed, continuing without async processing: ${error.message}`);
    }

    // Initialize community post scheduler
    try {
      const communityPostScheduler = new CommunityPostScheduler(bot);
      communityPostScheduler.start();
      global.communityPostScheduler = communityPostScheduler;
      logger.info('✓ Community post scheduler initialized and started');
    } catch (error) {
      logger.warn(`Community post scheduler initialization failed, continuing without community posts: ${error.message}`);
    }

    // Initialize X post scheduler
    try {
      const xPostScheduler = new XPostScheduler(bot);
      xPostScheduler.start();
      global.xPostScheduler = xPostScheduler;
      logger.info('✓ X post scheduler initialized and started (with admin notifications)');
    } catch (error) {
      logger.warn(`X post scheduler initialization failed, continuing without X posts: ${error.message}`);
    }

    // Initialize Canva export scheduler
    try {
      const canvaExportScheduler = new CanvaExportScheduler();
      canvaExportScheduler.start();
      global.canvaExportScheduler = canvaExportScheduler;
      logger.info('✓ Canva export scheduler initialized and started');
    } catch (error) {
      logger.warn(`Canva export scheduler initialization failed, continuing without Canva exports: ${error.message}`);
    }

    // Initialize X auto campaign scheduler
    try {
      const XAutoCampaignScheduler = require('./schedulers/xAutoCampaignScheduler');
      const xAutoCampaignScheduler = new XAutoCampaignScheduler(bot);
      xAutoCampaignScheduler.start();
      global.xAutoCampaignScheduler = xAutoCampaignScheduler;
      logger.info('✓ X auto campaign scheduler initialized and started');
    } catch (error) {
      logger.warn(`X auto campaign scheduler initialization failed: ${error.message}`);
    }

    // Initialize X token refresh scheduler (proactive refresh before expiry)
    try {
      const XTokenRefreshScheduler = require('./schedulers/xTokenRefreshScheduler');
      const xTokenRefreshScheduler = new XTokenRefreshScheduler(bot);
      xTokenRefreshScheduler.start();
      global.xTokenRefreshScheduler = xTokenRefreshScheduler;
      logger.info('✓ X token refresh scheduler initialized and started');
    } catch (error) {
      logger.warn(`X token refresh scheduler initialization failed: ${error.message}`);
    }

    // Initialize Bogota daily X campaign analysis scheduler (10:00 AM America/Bogota)
    try {
      const { startBogotaAnalysisScheduler } = require('./schedulers/xBogotaAnalysisScheduler');
      startBogotaAnalysisScheduler();
      logger.info('✓ Bogota daily X analysis scheduler initialized');
    } catch (error) {
      logger.warn(`Bogota analysis scheduler initialization failed: ${error.message}`);
    }

    // Initialize X post analytics ingestion scheduler (every 6h)
    try {
      const XAnalyticsIngestionScheduler = require('./schedulers/xAnalyticsIngestionScheduler');
      const xAnalyticsScheduler = new XAnalyticsIngestionScheduler();
      xAnalyticsScheduler.start();
      global.xAnalyticsScheduler = xAnalyticsScheduler;
      logger.info('✓ X analytics ingestion scheduler initialized and started');
    } catch (error) {
      logger.warn(`X analytics ingestion scheduler initialization failed: ${error.message}`);
    }

    // Initialize proactive reminder service
    try {
      const ProactiveReminderService = require('../../services/proactiveReminderService');

      // Check if proactive reminders are enabled (disabled by default if bot is kicked from group)
      const PROACTIVE_REMINDERS_ENABLED = process.env.PROACTIVE_REMINDERS_ENABLED === 'true';

      if (PROACTIVE_REMINDERS_ENABLED) {
        // Start reminders for main group (replace with your actual group ID)
        const GROUP_ID = process.env.GROUP_ID || '-1001234567890'; // Default fallback
        const GROUP_LANGUAGE = 'en'; // Default language

        ProactiveReminderService.startReminders(bot.telegram, GROUP_ID, GROUP_LANGUAGE);
        logger.info('✓ Proactive reminder service initialized and started');
      } else {
        logger.info('✓ Proactive reminder service skipped (PROACTIVE_REMINDERS_ENABLED=false)');
      }
      
      // Store reference for potential future use
      global.proactiveReminderService = ProactiveReminderService;
    } catch (error) {
      logger.warn(`Proactive reminder service initialization failed, continuing without reminders: ${error.message}`);
    }
    // Initialize Daimo payment recovery scheduler (every 5 min)
    try {
      const PaymentRecoveryService = require('../../services/paymentRecoveryService');
      setInterval(() => PaymentRecoveryService.processStuckDaimoPayments().catch(err =>
        logger.error('Daimo payment recovery error:', err)
      ), 5 * 60 * 1000);
      // Run once on startup after 30s delay
      setTimeout(() => PaymentRecoveryService.processStuckDaimoPayments().catch(err =>
        logger.error('Daimo payment recovery error:', err)
      ), 30 * 1000);
      logger.info('✓ Daimo payment recovery scheduler started (5min interval)');
      // Cleanup abandoned Daimo payments every hour (marks 24h+ unpaid as abandoned)
      setInterval(() => PaymentRecoveryService.cleanupAbandonedPayments().catch(err =>
        logger.error('Daimo cleanup error:', err)
      ), 60 * 60 * 1000);
      // Run immediately on startup to clear existing stuck payments
      PaymentRecoveryService.cleanupAbandonedPayments().catch(err =>
        logger.error('Daimo cleanup (startup) error:', err)
      );
      logger.info('✓ Daimo abandoned payment cleanup scheduled (1h interval)');
    } catch (error) {
      logger.warn(`Daimo payment recovery scheduler failed: ${error.message}`);
    }

    // Initialize Cristina proactive ticket worker
    try {
      cristinaTicketWorker.initialize(bot);
      logger.info('✓ Cristina ticket worker initialized');
    } catch (error) {
      logger.warn(`Cristina ticket worker initialization failed: ${error.message}`);
    }

    // Initialize Cristina onboarding reminders (every 30 min)
    try {
      setInterval(() => CristinaOnboardingReminders.process().catch(err =>
        logger.error('Cristina onboarding reminders error:', err)
      ), 30 * 60 * 1000);
      // Run once on startup after a short delay
      setTimeout(() => CristinaOnboardingReminders.process().catch(err =>
        logger.error('Cristina onboarding reminders error:', err)
      ), 10 * 1000);
      logger.info('✓ Cristina onboarding reminders scheduled (30min interval)');
    } catch (error) {
      logger.warn(`Cristina onboarding reminders setup failed: ${error.message}`);
    }

    // Initialize Cristina Stage Bot — 24/7 LiveKit presence with radio
    try {
      const cristinaStageBot = require('../../services/cristinaStageBot');
      // Delay 15s to let LiveKit and DB settle
      setTimeout(() => {
        cristinaStageBot.start();
      }, 15_000);
      global.cristinaStageBot = cristinaStageBot;
      logger.info('✓ Cristina Stage Bot scheduled (starts in 15s)');
    } catch (error) {
      logger.warn(`Cristina Stage Bot initialization failed: ${error.message}`);
    }

    // Register commands with Telegram
    try {
      const commands = [
        { command: 'start', description: 'Start the bot and select your language' },
        { command: 'admin', description: 'Open admin panel (admin only)' },
        { command: 'mono', description: 'Ask Mono — AI business assistant (admin only)' },
        { command: 'stats', description: 'View real-time statistics (admin only)' },
        { command: 'viewas', description: 'Preview as different user type (admin only)' },
        { command: 'support', description: 'Get help and support' },
        { command: 'pay', description: 'How to pay — step-by-step tutorials' },
        { command: 'about', description: 'Learn about PNPtv' },
      ];
      await bot.telegram.setMyCommands(commands);
      logger.info('✓ Bot commands registered with Telegram:', commands.map(c => `/${c.command}`).join(', '));
    } catch (error) {
      logger.warn(`Failed to register bot commands with Telegram: ${error.message}`);
    }
    // Error handling
    bot.catch(errorHandler);
    // Start bot
    if (process.env.NODE_ENV === 'production' && process.env.BOT_WEBHOOK_DOMAIN) {
      // Webhook mode for production
      const webhookPath = process.env.BOT_WEBHOOK_PATH || '/webhook/telegram';
      const webhookUrl = `${process.env.BOT_WEBHOOK_DOMAIN}${webhookPath}`;

      // Configure allowed updates to include member join/leave events
      const allowedUpdates = [
        'message',
        'callback_query',
        'my_chat_member',  // Bot added/removed from group
        'chat_member',     // User joined/left group (for welcome messages)
        'channel_post',
        'edited_message',
        'message_reaction', // TG emoji reactions on messages (for hangout bridge + wallOfFame)
      ];

      // IMPORTANT: Register the webhook route handler and start the API server
      // BEFORE telling Telegram to send updates. This prevents a race condition
      // where Telegram delivers updates before the server is ready, causing
      // "invalid secret token" rejections on restart.
      const webhookSecretToken = process.env.WEBHOOK_SECRET_TOKEN;

      // Register webhook callback FIRST (before setWebhook)
      apiApp.post(webhookPath, async (req, res) => {
        req.setTimeout(0);
        res.setTimeout(0);
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Type', 'application/json');

        // Validate webhook secret token
        if (webhookSecretToken) {
          const token = req.headers['x-telegram-bot-api-secret-token'];
          if (token !== webhookSecretToken) {
            logger.warn('Webhook rejected: invalid secret token', {
              hasHeader: token !== undefined,
              headerLength: token ? token.length : 0,
              expectedLength: webhookSecretToken.length,
              ip: req.headers['x-real-ip'] || req.ip,
            });
            // Return 200 to prevent Telegram from disabling the webhook
            // after too many non-2xx responses. The update is silently dropped.
            return res.status(200).json({ ok: true });
          }
        }

        try {
          logger.info('Telegram webhook received:', {
            hasBody: !!req.body,
            bodySize: req.body ? JSON.stringify(req.body).length : 0,
            contentType: req.headers['content-type'],
            method: req.method,
            path: req.path,
          });
          if (!req.body || Object.keys(req.body).length === 0) {
            logger.warn('Webhook received empty body');
            return res.status(200).json({ ok: true, message: 'Empty body received' });
          }

          // Deduplicate incoming webhook updates using Redis
          try {
            const { cache } = require('../../config/redis');
            const updateId = req.body.update_id;
            if (updateId) {
              const key = `telegram:processed_update:${updateId}`;
              const set = await cache.setNX(key, true, 60); // keep for 60s
              if (!set) {
                logger.warn('Duplicate webhook update ignored', { updateId });
                return res.status(200).json({ ok: true, message: 'Duplicate update ignored' });
              }
            }
          } catch (err) {
            // If Redis fails we don't want to block processing — log and continue
            logger.warn('Failed to dedupe update via Redis, continuing', { error: err.message });
          }
          // Log the callback query data if present
          if (req.body.callback_query) {
            logger.info(`>>> CALLBACK_QUERY received: data=${req.body.callback_query.data}, from=${req.body.callback_query.from?.id}`);
          }
          if (req.body.message) {
            const entities = req.body.message.entities || [];
            const hasBotCommand = entities.some(e => e.type === 'bot_command');
            logger.info(`>>> MESSAGE received: text="${req.body.message.text || 'N/A'}", from=${req.body.message.from?.id}, hasBotCommand=${hasBotCommand}, entities=${JSON.stringify(entities)}`);
            if (req.body.message.text && req.body.message.text.startsWith('/')) {
              logger.info(`>>> COMMAND MESSAGE detected: text="${req.body.message.text}", hasBotCommand=${hasBotCommand}`);
            }
          }
          await bot.handleUpdate(req.body);
          res.status(200).json({ ok: true });
          logger.info('Webhook processed successfully');
        } catch (error) {
          logger.error('Error processing Telegram webhook:', {
            error: error.message,
            stack: error.stack,
            body: req.body,
          });
          res.status(200).json({ ok: false, error: error.message });
        }
      });
      logger.info(`✓ Webhook callback registered at: ${webhookPath}`);
      apiApp.get(webhookPath, (req, res) => {
        res.status(200).json({
          status: 'ok',
          message: 'Telegram webhook endpoint is active',
          path: webhookPath,
          webhookUrl,
          note: 'This endpoint only accepts POST requests from Telegram',
        });
      });
      logger.info(`✓ Webhook test endpoint registered at: ${webhookPath} (GET)`);

      // Add 404 and error handlers before starting the server
      const {
        errorHandler: expressErrorHandler,
        notFoundHandler: expressNotFoundHandler
      } = require('../api/middleware/errorHandler');
      apiApp.use(expressNotFoundHandler);
      apiApp.use(expressErrorHandler);
      logger.info('✓ Error handlers registered');

      // Start API server BEFORE setWebhook so we can receive updates immediately
      startApiServer();
      logger.info('✓ API server started, ready to receive webhook updates');

      // NOW tell Telegram to send updates — the server is already listening
      let webhookSet = false;
      const maxRetries = 3;
      for (let i = 0; i < maxRetries; i++) {
        try {
          const webhookOpts = {
            allowed_updates: allowedUpdates,
            drop_pending_updates: false
          };
          if (webhookSecretToken) {
            webhookOpts.secret_token = webhookSecretToken;
          }
          await bot.telegram.setWebhook(webhookUrl, webhookOpts);
          logger.info(`✓ Webhook set to: ${webhookUrl} (secret_token: ${webhookSecretToken ? 'configured' : 'none'})`);
          webhookSet = true;
          break;
        } catch (webhookError) {
          logger.warn(`Webhook setup attempt ${i + 1}/${maxRetries} failed:`, webhookError.message);
          if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
          }
        }
      }

      if (!webhookSet) {
        logger.error('Failed to set webhook after multiple attempts');
        logger.warn('Webhook setup failed. Falling back to polling mode for bot functionality.');
        try {
          await bot.telegram.deleteWebhook();
          await bot.launch();
          botInstance = bot;
          botStarted = true;
          logger.info('✓ Bot started in polling mode (webhook fallback)');
          return; // Exit webhook setup, polling is now active
        } catch (pollingError) {
          logger.error(`Failed to enable polling fallback: ${pollingError.message}`);
          logger.warn('Bot will continue in degraded mode. Manual webhook setup required.');
          logger.warn('You can set webhook later using: curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook?url=' + webhookUrl);
        }
      }

      botInstance = bot; // Asignar la instancia del bot
      botStarted = true; // Actualizar el estado
      isWebhookMode = true; // Marcar que estamos en modo webhook
      logger.info('✓ Bot started in webhook mode');
    } else {
      // Polling mode for development
      await bot.telegram.deleteWebhook();
      await bot.launch();
      botInstance = bot; // Asignar la instancia del bot
      botStarted = true; // Actualizar el estado
      logger.info('✓ Bot started in polling mode');

      // Add 404 and error handlers
      const {
        errorHandler: expressErrorHandler,
        notFoundHandler: expressNotFoundHandler
      } = require('../api/middleware/errorHandler');
      apiApp.use(expressNotFoundHandler);
      apiApp.use(expressErrorHandler);
      logger.info('✓ Error handlers registered');

      // Start API server
      startApiServer();
    }
    logger.info('PNPtv Telegram Bot is running!');
    performanceMonitor.end('bot_startup', { mode: isWebhookMode ? 'webhook' : 'polling' });
    performanceMonitor.logSummary();

    // Signal PM2 that process is ready for graceful shutdown
    if (process.send) {
      process.send('ready');
      logger.info('✓ Sent ready signal to PM2');
    }
  } catch (error) {
    logger.error('❌ CRITICAL ERROR during bot startup:', error);
    logger.error('Stack trace:', error.stack);
    logger.warn('⚠️  Bot encountered a critical error but will attempt to keep process alive');
    logger.warn('⚠️  Some features may not work properly. Check logs above for details.');
    try {
      startApiServer('Emergency');
      logger.info('Bot is NOT fully functional. Fix configuration and restart.');
    } catch (apiError) {
      logger.error('Failed to start emergency API server:', apiError);
      logger.warn('Process will stay alive but non-functional. Manual intervention required.');
    }
  }
};

// Handle graceful shutdown on SIGINT
process.once('SIGINT', async () => {
  logger.info('SIGINT received, starting graceful shutdown...');

  try {
    // 1. Stop accepting new requests
    if (apiServer) {
      logger.info('Closing HTTP server to stop accepting new requests...');
      await new Promise((resolve, reject) => {
        apiServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info('✓ HTTP server closed');
    }

    // 2. Stop Telegram bot gracefully
    if (botStarted && botInstance && !isWebhookMode) {
      logger.info('Stopping Telegram bot...');
      try {
        await botInstance.stop('SIGINT');
        logger.info('✓ Bot stopped successfully');
      } catch (err) {
        logger.error('Error stopping bot:', err);
      }
    } else if (isWebhookMode) {
      logger.info('Bot running in webhook mode, skipping stop()');
    }

    // 3. Close database connections
    const { getPool } = require('../../config/postgres');
    try {
      const pool = getPool();
      if (pool) {
        await pool.end();
        logger.info('✓ PostgreSQL connections closed');
      }
    } catch (err) {
      logger.error('Error closing database connections:', err);
    }

    // 4. Close Redis connections
    const { getRedis } = require('../../config/redis');
    try {
      const redis = getRedis();
      if (redis) {
        await redis.quit();
        logger.info('✓ Redis connections closed');
      }
    } catch (err) {
      logger.error('Error closing Redis connections:', err);
    }

    // 5. Release process lock and exit
    releaseProcessLock();
    logger.info('✓ Graceful shutdown completed successfully');
    process.exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown:', err);
    releaseProcessLock();
    process.exit(1);
  }
});

process.once('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown...');

  try {
    // 1. Stop accepting new requests
    if (apiServer) {
      logger.info('Closing HTTP server to stop accepting new requests...');
      await new Promise((resolve, reject) => {
        apiServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info('✓ HTTP server closed');
    }

    // 2. Stop Telegram bot gracefully
    if (botStarted && botInstance && !isWebhookMode) {
      logger.info('Stopping Telegram bot...');
      try {
        await botInstance.stop('SIGTERM');
        logger.info('✓ Bot stopped successfully');
      } catch (err) {
        logger.error('Error stopping bot:', err);
      }
    } else if (isWebhookMode) {
      logger.info('Bot running in webhook mode, skipping stop()');
    }

    // 3. Close database connections
    const { getPool } = require('../../config/postgres');
    try {
      const pool = getPool();
      if (pool) {
        await pool.end();
        logger.info('✓ PostgreSQL connections closed');
      }
    } catch (err) {
      logger.error('Error closing database connections:', err);
    }

    // 4. Close Redis connections
    const { getRedis } = require('../../config/redis');
    try {
      const redis = getRedis();
      if (redis) {
        await redis.quit();
        logger.info('✓ Redis connections closed');
      }
    } catch (err) {
      logger.error('Error closing Redis connections:', err);
    }

    // 5. Release process lock and exit
    releaseProcessLock();
    logger.info('✓ Graceful shutdown completed successfully');
    process.exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown:', err);
    releaseProcessLock();
    process.exit(1);
  }
});

// Manejadores globales de errores
process.on('uncaughtException', (error) => {
  logger.error('❌ UNCAUGHT EXCEPTION:', error);
  logger.error('Stack:', error.stack);
  logger.warn('Process will continue despite uncaught exception');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ UNHANDLED PROMISE REJECTION:', reason);
  logger.error('Promise:', promise);
  logger.warn('Process will continue despite unhandled rejection');
});

process.once('exit', () => {
  releaseProcessLock();
});

// Start the bot
if (require.main === module) {
  startBot().catch((err) => {
    logger.error('Unhandled error in startBot():', err);
    logger.warn('Process will stay alive despite error');
  });
}

/**
 * Get the bot instance for sending messages from services
 * @returns {Telegraf|null} The bot instance or null if not started
 */
const getBotInstance = () => botInstance;

module.exports = { startBot, getBotInstance };
