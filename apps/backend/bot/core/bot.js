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
// Media popularity tracking
const MediaPopularityService = require('../services/mediaPopularityService');
const MediaPopularityScheduler = require('../services/mediaPopularityScheduler');
// Handlers
const registerUserHandlers = require('../handlers/user');
const registerAdminHandlers = require('../handlers/admin');
const registerPaymentHandlers = require('../handlers/payments');
const registerMediaHandlers = require('../handlers/media');
const registerModerationHandlers = require('../handlers/moderation');
const registerModerationAdminHandlers = require('../handlers/moderation/adminCommands');
const registerAccessControlHandlers = require('../handlers/moderation/accessControlCommands');
const registerJitsiModeratorHandlers = require('../handlers/moderation/jitsiModerator');
const registerCallManagementHandlers = require('../handlers/admin/callManagement');
const registerRoleManagementHandlers = require('../handlers/admin/roleManagement');
const registerPerformerManagementHandlers = require('../handlers/admin/performerManagement');

const registerPNPLiveModelHandlers = require('../handlers/model/pnpLiveModelHandler');
const { registerWallOfFameHandlers } = require('../handlers/group/wallOfFame');
const registerPrivateCallHandlers = require('../handlers/user/privateCalls');
const registerPrivateCallsProntoHandlers = require('../handlers/user/privateCallsPronto');
const registerPaymentHistoryHandlers = require('../handlers/user/paymentHistory');
const registerPaymentAnalyticsHandlers = require('../handlers/admin/paymentAnalytics');
const registerUserCallManagementHandlers = require('../handlers/user/callManagement');
const registerCallFeedbackHandlers = require('../handlers/user/callFeedback');
const registerCallPackageHandlers = require('../handlers/user/callPackages');
const { registerPromoHandlers } = require('../handlers/promo/promoHandler');
const { getLanguage } = require('../utils/helpers');
const { t } = require('../../utils/i18n');
const { buildOnboardingPrompt } = require('../handlers/user/menu');
const UserService = require('../services/userService');
// Middleware
const { setupAgeVerificationMiddleware } = require('./middleware/ageVerificationRequired');
// Services
const CallReminderService = require('../services/callReminderService');
const GroupCleanupService = require('../services/groupCleanupService');
const broadcastScheduler = require('../../services/broadcastScheduler');
const SubscriptionReminderService = require('../../services/subscriptionReminderEmailService');
const MembershipCleanupService = require('../services/membershipCleanupService');
const BusinessNotificationService = require('../services/businessNotificationService');
const TutorialReminderService = require('../services/tutorialReminderService');
const MessageRateLimiter = require('../services/messageRateLimiter');

const CommunityPostScheduler = require('./schedulers/communityPostScheduler');
const XPostScheduler = require('./schedulers/xPostScheduler');
const { initializeWorker: initializePrivateCallsWorker } = require('../../workers/privateCallsWorker');
const PNPLiveWorker = require('../../workers/pnpLiveWorker');
const { startCronJobs } = require('../../../../scripts/cron');
// Models for cache prewarming
// Support model for ticket tracking
const SupportTopicModel = require('../../models/supportTopicModel');
// Support routing service and handlers
const supportRoutingService = require('../services/supportRoutingService');
const registerSupportRoutingHandlers = require('../handlers/support/supportRouting');
const slaMonitor = require('../services/slaMonitor');
// Async Broadcast Queue
const { initializeAsyncBroadcastQueue } = require('../services/initializeQueue');
// API Server
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { initSocketIO } = require('../api/socketHandlers');
const apiApp = require('../api/routes');
// Broadcast buttons presets
const BroadcastButtonModel = require('../../models/broadcastButtonModel');
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
    cors: { origin: process.env.WEBAPP_ORIGIN || ['https://app.pnptv.app', 'https://pnptv.app'], credentials: true },
    path: '/socket.io',
  });
  apiApp.set('io', io);
  initSocketIO(io);

  server.listen(PORT, '0.0.0.0', () => {
    const prefix = modeLabel ? `${modeLabel} ` : '';
    logger.info(`✓ ${prefix}API server running on port ${PORT} (Socket.IO attached)`);
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
      logger.warn('Sentry initialization failed, continuing without monitoring:', error.message);
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
          logger.warn('Support topics table initialization failed:', tableError.message);
        }
        try {
          await initializeCoreTables();
          logger.info('✓ Core tables initialized');
        } catch (coreTablesError) {
          logger.warn('Core tables initialization failed:', coreTablesError.message);
        }
        // Initialize Meru Link tracking in background (fire and forget)
        meruLinkInitializer.initialize();
      } else {
        logger.warn('⚠️ PostgreSQL connection test failed, but will retry on first query');
      }
    } catch (error) {
      logger.error('PostgreSQL initialization failed. Bot will run in DEGRADED mode without database.');
      logger.error('Error:', error.message);
      logger.warn('⚠️  Bot features requiring database will not work!');
    }
    // Initialize Redis (optional, will use default localhost if not configured)
    try {
      initializeRedis();
      logger.info('✓ Redis initialized');
    } catch (error) {
      logger.warn('Redis initialization failed, continuing without cache:', error.message);
      logger.warn('⚠️  Performance may be degraded without caching');
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

    // FIX: Register /menu command early to avoid middleware conflicts
    const { showMainMenu: showPrivateMenu } = require('../handlers/user/menu');
    bot.command('menu', async (ctx) => {
      logger.info('/menu command handler reached', { userId: ctx.from?.id, chatType: ctx.chat?.type });
      try {
        logger.info('Calling showPrivateMenu...');
        const result = await showPrivateMenu(ctx);
        logger.info('showPrivateMenu completed', { result });
      } catch (error) {
        logger.error('Error in /menu handler:', error.message, error.stack);
        await ctx.reply('Error loading menu. Please try again.');
      }
    });

    // FIX: Register /admin command early using admin handler directly  
    bot.command('admin', async (ctx) => {
      logger.info('[ADMIN-EARLY] /admin command received');
      try {
        const PermissionService = require('../services/permissionService');
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

    // DEBUG: Log all updates
    bot.use(async (ctx, next) => {
      if (ctx.message?.text?.startsWith('/')) {
        logger.info(`[TELEGRAF] Command received: text="${ctx.message.text}", from=${ctx.from?.id}, chat=${ctx.chat?.id}`);
      }
      return next();
    });

    // Register middleware
    bot.use(sessionMiddleware());
    bot.use(privateOutboundGuardMiddleware());
    bot.use(userExistsMiddleware()); // Check if user exists in DB, force onboarding if not
    bot.use(globalBanCheck()); // Block globally banned users
    bot.use(rateLimitMiddleware());

    // CRITICAL: Group security enforcement - MUST be early in the chain
    // This prevents the bot from operating in unauthorized groups/channels
    bot.use(groupSecurityEnforcementMiddleware());

    bot.use(chatCleanupMiddleware());
    bot.use(groupMessageAutoDeleteMiddleware()); // Auto-delete bot messages in groups after 5 minutes
    // DISABLED: bot.use(usernameEnforcement()); // Username enforcement rules disabled
    bot.use(botAdditionPreventionMiddleware()); // Prevent unauthorized bot additions
    bot.use(autoModerationMiddleware()); // Auto-moderation for links, spam, flooding
    bot.use(moderationFilter());

    // Group behavior rules (OVERRIDE all previous rules)
    bot.use(primeChannelSilentRedirectMiddleware()); // PRIME channel: silent redirect to private (no messages in channel)
    bot.use(groupBehaviorMiddleware()); // Route all bot messages to topic 3135, 3-min delete
    bot.use(cristinaGroupFilterMiddleware()); // Filter personal info from Cristina in groups
    bot.use(groupMenuRedirectMiddleware()); // Redirect menu button clicks to private
    bot.use(groupCallbackRedirectMiddleware()); // Redirect inline button callbacks to deep links
    bot.use(wallOfFameGuard()); // Wall of Fame topic is bot-only
    bot.use(notificationsTopicGuard()); // Notifications topic is bot-only (and env admins)
    bot.use(groupCommandRestrictionMiddleware()); // Block all commands except /menu in groups

    // Topic-specific middlewares
    bot.use(notificationsAutoDelete()); // Auto-delete in notifications topic
    bot.use(mediaMirrorMiddleware()); // Mirror media to PNPtv Gallery
    bot.use(topicPermissionsMiddleware()); // Admin-only and approval queue
    bot.use(topicModerationMiddleware()); // Anti-spam, anti-flood for topics
    bot.use(mediaOnlyValidator()); // Media-only validation for PNPtv Gallery

    // CRITICAL: Register group security handlers (my_chat_member events)
    // This auto-leaves unauthorized groups when bot is added
    registerGroupSecurityHandlers(bot);
    logger.info('✓ Group security handlers registered');

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
          const PermissionService = require('../services/permissionService');
          isAdminUser = await PermissionService.isAdmin(ctx.from?.id);
        } catch (adminCheckError) {
          logger.warn('Admin permission check failed during support routing guard:', adminCheckError.message);
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
        // Only prompt onboarding when the user isn't mid-onboarding input
        const user = await UserService.getOrCreateFromContext(ctx);
        if (!user?.onboardingComplete && !isWaitingForEmail) {
          const lang = getLanguage(ctx);
          const botUsername = ctx.botInfo?.username || 'PNPtvbot';
          const { message, keyboard } = buildOnboardingPrompt(lang, botUsername);
          await ctx.reply(message, { ...keyboard });
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
            logger.error('Failed to send message to support group:', routingError.message);
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


    registerUserHandlers(bot);
    registerAdminHandlers(bot); // This registers radio, live streams, community premium, and community posts handlers
    registerPNPLiveModelHandlers(bot); // Register PNP Live model self-service handlers
    registerPaymentHandlers(bot);
    registerMediaHandlers(bot);
    registerModerationHandlers(bot);
    registerModerationAdminHandlers(bot);
    registerAccessControlHandlers(bot);
    registerJitsiModeratorHandlers(bot);
    registerCallManagementHandlers(bot);
    registerRoleManagementHandlers(bot);
    registerPerformerManagementHandlers(bot);
    registerWallOfFameHandlers(bot);
    registerPrivateCallHandlers(bot);
    registerPrivateCallsProntoHandlers(bot);
    registerPaymentHistoryHandlers(bot);
    registerPaymentAnalyticsHandlers(bot);
    registerUserCallManagementHandlers(bot);
    registerCallFeedbackHandlers(bot);
    registerCallPackageHandlers(bot);
    // Register promo handlers (for promotional offers via deep links)
    registerPromoHandlers(bot);
    // Register support routing handlers (for forum topic-based support)
    registerSupportRoutingHandlers(bot);

    // Initialize support routing service with telegram instance
    supportRoutingService.initialize(bot.telegram);
    logger.info('✓ Support routing service initialized');
    // Start SLA monitor if configured (after support routing is ready)
    const slaCheckInterval = parseInt(process.env.SLA_CHECK_INTERVAL) || 3600000;
    if (process.env.SUPPORT_GROUP_ID && process.env.SLA_MONITOR_ENABLED !== 'false') {
      slaMonitor.start(slaCheckInterval);
      logger.info('SLA monitor initialized', { intervalMs: slaCheckInterval });
    } else {
      logger.info('SLA monitor disabled (SUPPORT_GROUP_ID not configured or SLA_MONITOR_ENABLED=false)');
    }
    // Setup age verification middleware for protected features
    setupAgeVerificationMiddleware(bot);
    logger.info('✓ Age verification middleware configured');
    // Initialize call reminder service
    CallReminderService.initialize(bot);
    logger.info('✓ Call reminder service initialized');
    // Initialize private calls pronto worker (expiry, reminders, auto-end)
    try {
      const privateCallsWorker = initializePrivateCallsWorker(bot);
      privateCallsWorker.start();
      logger.info('✓ Private calls pronto worker initialized and started');
    } catch (workerError) {
      logger.warn('Private calls worker initialization failed, continuing without background jobs:', workerError.message);
    }

    // Initialize PNP Live worker (notifications, auto-complete, model status)
    try {
      const pnpLiveWorker = new PNPLiveWorker(bot);
      pnpLiveWorker.start();
      logger.info('✓ PNP Live worker initialized and started');
    } catch (workerError) {
      logger.warn('PNP Live worker initialization failed, continuing without background jobs:', workerError.message);
    }
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
      logger.warn('Cron jobs initialization failed, continuing without scheduled tasks:', cronError.message);
    }
    // Initialize message rate limiter (to limit group messages to 6/day)
    MessageRateLimiter.initialize();
    logger.info('✓ Message rate limiter initialized');

    // Initialize tutorial reminder service (proactive tutorials for FREE and PRIME users)
    TutorialReminderService.initialize(bot);
    TutorialReminderService.startScheduling();
    logger.info('✓ Tutorial reminder service initialized and started');
    // Initialize group cleanup service
    const groupCleanup = new GroupCleanupService(bot);
    groupCleanup.initialize();
    // Initialize broadcast scheduler service
    try {
      broadcastScheduler.initialize(bot);
      broadcastScheduler.start();
      logger.info('✓ Broadcast scheduler initialized and started');
    } catch (error) {
      logger.warn('Broadcast scheduler initialization failed, continuing without scheduler:', error.message);
    }
    // Initialize broadcast buttons tables (presets/custom CTAs)
    try {
      await BroadcastButtonModel.initializeTables();
    } catch (error) {
      logger.warn('Broadcast button tables initialization failed (broadcasts will run without presets until fixed):', error.message);
    }
    // Initialize media popularity scheduler
    try {
      const mediaPopularityScheduler = new MediaPopularityScheduler(bot);
      await mediaPopularityScheduler.initialize();
      logger.info('✓ Media popularity scheduler initialized');
    } catch (error) {
      logger.error('Media popularity scheduler initialization failed:', error.message);
      logger.warn('⚠️  Automated media announcements will not work');
    }
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
      logger.warn('Async broadcast queue initialization failed, continuing without async processing:', error.message);
    }

    // Initialize community post scheduler
    try {
      const communityPostScheduler = new CommunityPostScheduler(bot);
      communityPostScheduler.start();
      global.communityPostScheduler = communityPostScheduler;
      logger.info('✓ Community post scheduler initialized and started');
    } catch (error) {
      logger.warn('Community post scheduler initialization failed, continuing without community posts:', error.message);
    }

    // Initialize X post scheduler
    try {
      const xPostScheduler = new XPostScheduler(bot);
      xPostScheduler.start();
      global.xPostScheduler = xPostScheduler;
      logger.info('✓ X post scheduler initialized and started (with admin notifications)');
    } catch (error) {
      logger.warn('X post scheduler initialization failed, continuing without X posts:', error.message);
    }

    // Initialize proactive reminder service
    try {
      const ProactiveReminderService = require('../services/proactiveReminderService');

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
      logger.warn('Proactive reminder service initialization failed, continuing without reminders:', error.message);
    }
    // Register commands with Telegram
    try {
      const commands = [
        { command: 'start', description: 'Start the bot and select your language' },
        { command: 'menu', description: 'Show main menu with all features' },
        { command: 'admin', description: 'Open admin panel (admin only)' },
        { command: 'stats', description: 'View real-time statistics (admin only)' },
        { command: 'viewas', description: 'Preview as different user type (admin only)' },
        { command: 'support', description: 'Get help and support' },
        { command: 'about', description: 'Learn about PNPtv' },
      ];
      await bot.telegram.setMyCommands(commands);
      logger.info('✓ Bot commands registered with Telegram:', commands.map(c => `/${c.command}`).join(', '));
    } catch (error) {
      logger.warn('Failed to register bot commands with Telegram:', error.message);
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
      ];

      // Try to set webhook with retry logic and fallback
      let webhookSet = false;
      const maxRetries = 3;
      for (let i = 0; i < maxRetries; i++) {
        try {
          const webhookOpts = {
            allowed_updates: allowedUpdates,
            drop_pending_updates: false
          };
          if (process.env.WEBHOOK_SECRET_TOKEN) {
            webhookOpts.secret_token = process.env.WEBHOOK_SECRET_TOKEN;
          }
          await bot.telegram.setWebhook(webhookUrl, webhookOpts);
          logger.info(`✓ Webhook set to: ${webhookUrl}`);
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
          logger.error('Failed to enable polling fallback:', pollingError.message);
          logger.warn('Bot will continue in degraded mode. Manual webhook setup required.');
          logger.warn('You can set webhook later using: curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook?url=' + webhookUrl);
        }
      }
      // Register webhook callback
      apiApp.post(webhookPath, async (req, res) => {
        req.setTimeout(0);
        res.setTimeout(0);
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Type', 'application/json');

        // Validate webhook secret token
        if (process.env.WEBHOOK_SECRET_TOKEN) {
          const token = req.headers['x-telegram-bot-api-secret-token'];
          if (token !== process.env.WEBHOOK_SECRET_TOKEN) {
            logger.warn('Webhook rejected: invalid secret token');
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
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
    }
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
    logger.info('🚀 PNPtv Telegram Bot is running!');
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
