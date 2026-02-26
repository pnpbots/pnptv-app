/**
 * Access Control & Permissions Configuration
 */

const ACCESS_CONTROL_CONFIG = {
  // Topic IDs
  TOPICS: {
    ADMIN_ONLY: 3131,        // Admin-only topic
    APPROVAL_REQUIRED: 3134, // Requires approval from admins
    NOTIFICATIONS: 3135,     // Notifications topic (referenced but not restricted)
  },

  // User roles hierarchy (higher number = more permissions)
  ROLES: {
    USER: 0,           // Default user
    CONTRIBUTOR: 10,   // Can post in approval topic
    PERFORMER: 20,     // Can post in approval topic + additional permissions
    MODERATOR: 50,     // Can moderate content, limited admin access
    ADMIN: 100,        // Full access
    SUPERADMIN: 200,   // God mode
  },

  // Role names for display
  ROLE_NAMES: {
    0: 'User',
    10: 'Contributor',
    20: 'Performer',
    50: 'Moderator',
    100: 'Admin',
    200: 'Super Admin',
  },

  // Topic permissions
  TOPIC_PERMISSIONS: {
    // Topic 3131: Admin-only posting
    3131: {
      name: 'Admin Announcements',
      allowedRoles: ['ADMIN'],
      requireSubscription: false,
      autoDelete: true,           // Auto-delete unauthorized posts
      deleteDelay: 5000,           // 5 seconds delay before deletion
      notifyUser: true,            // Send notification to user
      rateLimit: null,             // No rate limiting for admins
    },

    // Topic 3134: Post approval required
    3134: {
      name: 'Podcasts & Thoughts',
      allowedRoles: ['ADMIN', 'PERFORMER', 'CONTRIBUTOR'],
      requireSubscription: false,
      autoDelete: false,           // Don't auto-delete (use approval system)
      requireApproval: true,       // Posts need admin approval
      notifyUser: true,
      rateLimit: {
        maxPosts: 5,               // Max 5 posts
        windowMs: 60 * 60 * 1000,  // Per hour
      },
    },

    // Topic 3135: Notifications (no restrictions, just rate limiting)
    3135: {
      name: 'Notifications',
      allowedRoles: ['USER', 'CONTRIBUTOR', 'PERFORMER', 'ADMIN'],
      requireSubscription: false,
      autoDelete: false,
      rateLimit: {
        maxPosts: 10,
        windowMs: 5 * 60 * 1000,   // 5 minutes
      },
    },
  },

  // Approval system settings
  APPROVAL: {
    // Messages that need approval
    requireApproval: true,

    // Auto-approve for certain roles
    autoApproveRoles: ['ADMIN'],

    // Pending approval timeout (24 hours)
    pendingTimeout: 24 * 60 * 60 * 1000,

    // Notification settings
    notifyAdmins: true,
    notifyUser: true,
  },

  // Rate limiting settings
  RATE_LIMIT: {
    // Global rate limits (if topic doesn't specify)
    default: {
      maxPosts: 10,
      windowMs: 60 * 1000, // 1 minute
    },

    // Track rate limits in memory
    trackInMemory: true,

    // Cleanup old entries every 10 minutes
    cleanupInterval: 10 * 60 * 1000,
  },

  // Subscription requirements
  SUBSCRIPTION: {
    // Topics that require PRIME subscription
    primeRequired: [],

    // Topics that require any active subscription
    subscriptionRequired: [],

    // Free tier limits per topic
    freeTierLimits: {},
  },

  // Auto-delete settings
  AUTO_DELETE: {
    // Delay before deleting unauthorized posts
    deleteDelay: 5000, // 5 seconds

    // Show warning message
    showWarning: true,

    // Warning message auto-delete delay
    warningDelay: 30000, // 30 seconds
  },

  // Notification messages
  MESSAGES: {
    unauthorized: {
      en: '⛔ You do not have permission to post in this topic.\n\nThis topic is restricted to {roles}.\n\nYour message will be deleted in {seconds} seconds.',
      es: '⛔ No tienes permiso para publicar en este tema.\n\nEste tema está restringido a {roles}.\n\nTu mensaje será eliminado en {seconds} segundos.',
    },
    pendingApproval: {
      en: '⏳ Your post is pending approval.\n\nAn admin will review it shortly. You\'ll be notified when it\'s approved.',
      es: '⏳ Tu publicación está pendiente de aprobación.\n\nUn administrador la revisará pronto. Se te notificará cuando sea aprobada.',
    },
    approved: {
      en: '✅ Your post in {topic} has been approved!',
      es: '✅ ¡Tu publicación en {topic} ha sido aprobada!',
    },
    rejected: {
      en: '❌ Your post in {topic} was rejected.\n\nReason: {reason}',
      es: '❌ Tu publicación en {topic} fue rechazada.\n\nRazón: {reason}',
    },
    rateLimitExceeded: {
      en: '⚠️ Rate limit exceeded.\n\nYou can post {max} times per {window}. Please wait {wait} before posting again.',
      es: '⚠️ Límite de velocidad excedido.\n\nPuedes publicar {max} veces por {window}. Espera {wait} antes de publicar de nuevo.',
    },
    subscriptionRequired: {
      en: '💎 This topic requires a PRIME subscription.\n\nType /prime to upgrade your membership.',
      es: '💎 Este tema requiere una suscripción PRIME.\n\nEscribe /prime para actualizar tu membresía.',
    },
  },
};

module.exports = ACCESS_CONTROL_CONFIG;
