/**
 * Monetization Configuration
 * Centralized configuration for all monetization features
 */

module.exports = {
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
    freeTrialDays: parseInt(process.env.FREE_TRIAL_DAYS || '7'),

    // Features by plan
    features: {
      user: {
        free: {
          streams: 'limited',
          content: 'public_only',
          adFree: false,
          priorityChat: false,
        },
        prime: {
          streams: 'unlimited',
          content: 'exclusive',
          adFree: true,
          priorityChat: true,
        },
      },
      model: {
        starter: {
          maxStreamsPerWeek: 1,
          maxContentUploads: 10,
          prioritySupport: false,
          analytics: 'basic',
        },
        pro: {
          maxStreamsPerWeek: null,
          maxContentUploads: 100,
          prioritySupport: false,
          analytics: 'advanced',
        },
        elite: {
          maxStreamsPerWeek: null,
          maxContentUploads: null,
          prioritySupport: true,
          analytics: 'advanced',
          featuredPlacement: true,
        },
      },
    },
  },

  // ==========================================
  // PAYMENT SETTINGS
  // ==========================================
  payment: {
    // Supported providers
    providers: ['epayco', 'daimo', 'paypal'],

    // Default provider
    defaultProvider: process.env.DEFAULT_PAYMENT_PROVIDER || 'epayco',

    // Payment methods
    methods: {
      epayco: ['credit_card', 'pse', 'bank_transfer'],
      daimo: ['usdc'],
      paypal: ['paypal_wallet'],
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
      subscription: {
        starter: 75,
        pro: 80,
        elite: 85,
      },
      contentSale: {
        standard: 80,
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
  exchangeRates: {
    // Default rate: 1 USD = 4000 COP
    defaultRate: parseFloat(process.env.USD_TO_COP_RATE || '4000'),

    // Update interval (hours)
    updateInterval: 1,

    // Fallback rates
    fallback: {
      'USD': 1.0,
      'COP': 4000,
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
