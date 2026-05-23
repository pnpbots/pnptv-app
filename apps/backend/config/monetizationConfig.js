/**
 * Monetization Configuration
 * Centralized configuration for all monetization features
 */

// ── Revenue-split constants ──────────────────────────────────────────────────
// Single source of truth for the 70/30 platform commission split.
// CREATOR_REVENUE_RATE + PLATFORM_COMMISSION_RATE MUST equal exactly 1.
const PLATFORM_COMMISSION_RATE = 0.30;
const CREATOR_REVENUE_RATE = 0.70; // must equal 1 - PLATFORM_COMMISSION_RATE

// Earnings hold period: newly-recorded earnings sit in 'holding' status for this
// many hours before maturing to 'available'. This gives the platform time to
// process any refund or chargeback before paying out the creator.
const EARNINGS_HOLD_HOURS = 168; // 7 days

module.exports = {
  // Exported as top-level named constants for direct destructured imports.
  PLATFORM_COMMISSION_RATE,
  CREATOR_REVENUE_RATE,
  EARNINGS_HOLD_HOURS,
  // ==========================================
  // SUBSCRIPTION SETTINGS
  // ==========================================
  subscription: {
    // Default currency
    currency: process.env.DEFAULT_CURRENCY || 'USD',

    // Billing cycles
    billingCycles: {
      monthly: 30,
      yearly: 365,
    },

    // Renewal settings
    renewal: {
      gracePeriodDays: 3,
      autoRenewDays: 7,
      expirationCheckInterval: '0 0 * * *', // Daily at midnight
    },

    // Free trial (if enabled)
    freeTrialDays: parseInt(process.env.FREE_TRIAL_DAYS || '1'),

    // Features by plan
    features: {
      user: {
        free: {
          socialFeed: 'free_only',
          nearby: 'count_only',
          dms: 'limited',
          hangouts: 'browse_only',
          live: 'preview_only',
          profileBrowsing: 'interacted_only',
        },
        member: {
          socialFeed: 'free_and_member',
          nearby: 'blurred_profiles',
          dms: 'unlimited',
          hangouts: 'join',
          live: 'watch',
          profileBrowsing: 'all_blurred_prime',
        },
        prime: {
          socialFeed: 'all',
          nearby: 'full',
          dms: 'unlimited',
          hangouts: 'join_and_create',
          live: 'watch_and_stream',
          profileBrowsing: 'full',
        },
      },
    },

    freeTier: {
      dmLimits: { default: 3, afterDay14: 1 },
      decay: { deprioritizeAfterDays: 30 },
    },
  },

  // ==========================================
  // PAYMENT SETTINGS
  // ==========================================
  payment: {
    // Supported providers — Daimo retired 2026-04-21; PayPal never implemented
    providers: ['epayco', 'btcpay', 'dash'],

    // Default provider
    defaultProvider: process.env.DEFAULT_PAYMENT_PROVIDER || 'epayco',

    // Payment methods
    methods: {
      epayco: ['credit_card', 'pse', 'bank_transfer'],
      btcpay: ['btc', 'lightning'],
      dash: ['dash'],
    },

    // Minimum amounts
    minimums: {
      usd: 1.0,
      cop: 5000,
    },

    // Maximum amounts (fraud prevention)
    maximums: {
      usd: 10000,
      cop: 50000000,
    },

    // Retry settings
    retry: {
      maxAttempts: 3,
      delayMs: 5000,
      backoffMultiplier: 2,
    },

    // Webhook timeout
    webhookTimeout: parseInt(process.env.WEBHOOK_TIMEOUT || '30000'),

    // 3DS settings
    threeDs: {
      enabled: process.env.ENABLE_3DS !== 'false',
      timeout: parseInt(process.env.THREED_DS_TIMEOUT || '360000'), // 6 minutes
    },
  },

  // ==========================================
  // MONETIZATION SETTINGS
  // ==========================================
  monetization: {
    // Revenue split percentages (model gets %)
    revenueSplit: {
      contentSale: {
        standard: 70,
      },
      streaming: {
        tips: 85,
      },
    },

    // Platform fees (in USD)
    platformFees: {
      perTransaction: 0.50,
      percentage: 2.5,
    },

    // Minimum earnings for withdrawal
    minimumWithdrawal: {
      usd: parseFloat(process.env.MIN_WITHDRAWAL_USD || '10'),
      cop: parseFloat(process.env.MIN_WITHDRAWAL_COP || '50000'),
    },

    // Maximum daily withdrawals per model
    maxWithdrawalsPerDay: 5,

    // Processing time
    processingTime: {
      bankTransfer: {
        min: 1,
        max: 3,
      },
      paypal: {
        min: 1,
        max: 2,
      },
    },
  },

  // ==========================================
  // CONTENT SETTINGS
  // ==========================================
  content: {
    // Supported content types
    types: ['photo', 'video', 'audio', 'document', 'bundle'],

    // Storage
    storage: {
      maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE || '500'),
      maxFilesPerMonth: 100,
    },

    // Pricing
    pricing: {
      minPrice: 0.99,
      maxPrice: 999.99,
      currency: 'USD',
    },

    // Exclusivity
    exclusivity: {
      enabled: true,
      duration: 30, // days
    },
  },

  // ==========================================
  // STREAMING SETTINGS
  // ==========================================
  streaming: {
    // Live stream limits (free tier)
    freeTierLimits: {
      maxDurationMinutes: 60,
      maxViewers: 100,
      maxStreamsPerWeek: 1,
    },

    // Monetization
    monetization: {
      tipsEnabled: true,
      subscriptionRequired: false,
      premiumStreamingEnabled: true,
    },

    // Recording
    recording: {
      enabled: true,
      retentionDays: 30,
    },
  },

  // ==========================================
  // AUDIT & COMPLIANCE
  // ==========================================
  audit: {
    // Log all transactions
    logTransactions: true,

    // Retention period (days)
    retentionDays: 365,

    // PCI compliance
    pciCompliance: true,

    // Data encryption
    encryption: {
      enabled: true,
      algorithm: 'AES-256-GCM',
    },
  },

  // ==========================================
  // EXCHANGE RATES
  // ==========================================
  // NOTE: USD→COP rate is managed exclusively by getEpaycoCopRate() in services/paymentService.js.
  // These config entries are kept for structural compatibility only — do NOT read defaultRate
  // or fallback.COP in payment code. Use getEpaycoCopRate() and fail closed if unavailable.
  exchangeRates: {
    // Update interval (hours)
    updateInterval: 24,

    // Fallback rates — for non-payment display purposes only (NOT used for ePayco charges)
    fallback: {
      'USD': 1.0,
      'EUR': 1.10,
    },
  },

  // ==========================================
  // NOTIFICATIONS
  // ==========================================
  notifications: {
    // Send email on events
    email: {
      subscriptionCreated: true,
      subscriptionExpiring: true,
      subscriptionExpired: true,
      paymentProcessed: true,
      withdrawalRequested: true,
      withdrawalApproved: true,
      withdrawalProcessed: true,
      withdrawalFailed: true,
      earningsAccrued: true,
    },

    // Send push notifications
    push: {
      enabled: process.env.ENABLE_PUSH_NOTIFICATIONS !== 'false',
      subscriptionCreated: true,
      paymentProcessed: true,
      withdrawalProcessed: true,
    },

    // Send SMS
    sms: {
      enabled: process.env.ENABLE_SMS !== 'false',
      withdrawalApproved: true,
      withdrawalProcessed: true,
    },
  },

  // ==========================================
  // FEATURE FLAGS
  // ==========================================
  features: {
    // Enable/disable features
    subscriptions: process.env.ENABLE_SUBSCRIPTIONS !== 'false',
    paidContent: process.env.ENABLE_PAID_CONTENT !== 'false',
    streaming: process.env.ENABLE_STREAMING !== 'false',
    tips: process.env.ENABLE_TIPS !== 'false',
    withdrawals: process.env.ENABLE_WITHDRAWALS !== 'false',
    crypto: process.env.ENABLE_CRYPTO !== 'false',
  },

  // ==========================================
  // VALIDATION
  // ==========================================
  validation: {
    email: {
      required: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    password: {
      minLength: 8,
      requireUppercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
    },
    username: {
      minLength: 3,
      maxLength: 50,
      pattern: /^[a-zA-Z0-9_-]+$/,
    },
  },

  // ==========================================
  // RATE LIMITING
  // ==========================================
  rateLimit: {
    login: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5,
    },
    checkout: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 10,
    },
    withdrawal: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3,
    },
  },

  // ==========================================
  // ERROR MESSAGES
  // ==========================================
  errors: {
    INVALID_CREDENTIALS: 'Invalid email or password',
    UNAUTHORIZED: 'Authentication required',
    FORBIDDEN: 'Access denied',
    PLAN_NOT_FOUND: 'Subscription plan not found',
    NO_ACTIVE_SUBSCRIPTION: 'No active subscription',
    LIMIT_EXCEEDED: 'Limit exceeded',
    MINIMUM_WITHDRAWAL: 'Below minimum withdrawal amount',
    INVALID_PAYMENT_METHOD: 'Invalid payment method',
    PAYMENT_FAILED: 'Payment failed',
    INSUFFICIENT_BALANCE: 'Insufficient balance',
    INVALID_CONTENT: 'Invalid content',
    STORAGE_LIMIT: 'Storage limit exceeded',
    INVALID_AMOUNT: 'Invalid amount',
  },
};
