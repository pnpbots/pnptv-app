/**
 * Materialious Configuration
 * Integrates modern Material Design Invidious client with PNPtv
 */

module.exports = {
  // Materialious Web Client Configuration
  web: {
    // Enable/disable Materialious web interface
    enabled: process.env.MATERIALIOUS_ENABLED !== 'false',

    // Web base URL for client-side links
    baseUrl: process.env.MATERIALIOUS_BASE_URL || 'http://localhost:3000',

    // Routes
    routes: {
      materialious: '/materialious',
      api: '/api/materialious',
    },

    // Theme settings
    theme: {
      default: 'light', // light, dark, or auto
      colors: {
        primary: '#1976d2',
        secondary: '#424242',
      },
    },

    // Features
    features: {
      // Invidious integration
      invidious: {
        enabled: true,
        searchEnabled: true,
        playlistsEnabled: true,
        channelsEnabled: true,
        subscriptionsEnabled: true,
        watchHistoryEnabled: true,
        watchProgressEnabled: true,
      },

      // Video enhancement features
      sponsorblock: {
        enabled: process.env.SPONSORBLOCK_ENABLED !== 'false',
      },

      returnYoutubeDislikes: {
        enabled: process.env.RYD_ENABLED !== 'false',
      },

      deArrow: {
        enabled: process.env.DEARROW_ENABLED !== 'false',
      },

      chapters: {
        enabled: true,
      },

      // Playback features
      playback: {
        audioOnly: true,
        dashSupport: true,
        hlsSupport: true,
        liveStreamSupport: true,
      },

      // Sync features
      sync: {
        watchProgress: true,
        syncParties: true,
        subscriptions: true,
      },
    },
  },

  // Telegram Bot Integration
  telegram: {
    enabled: true,

    // Menu integration
    menu: {
      // Show link to Materialious in player menu
      showMaterializousLink: true,
    },

    // Commands
    commands: {
      materialious: {
        enabled: true,
        description: 'Open Materialious web client',
      },
      invidiousSearch: {
        enabled: true,
        description: 'Search videos on Invidious',
      },
    },
  },

  // Invidious Instance Configuration
  invidious: {
    // Custom instance (optional, will fallback to public instances)
    customInstance: process.env.INVIDIOUS_INSTANCE || null,

    // Public instances with priority
    publicInstances: [
      {
        url: 'https://invidious.io',
        priority: 1,
        region: 'US',
      },
      {
        url: 'https://inv.nadeko.net',
        priority: 2,
        region: 'EU',
      },
      {
        url: 'https://invidious.snopyta.org',
        priority: 3,
        region: 'EU',
      },
      {
        url: 'https://iv.ggtyler.dev',
        priority: 4,
        region: 'US',
      },
      {
        url: 'https://invidious.nerdvpn.org',
        priority: 5,
        region: 'US',
      },
    ],

    // API settings
    api: {
      timeout: 10000, // ms
      retries: 3,
      cacheDuration: {
        search: 3600, // 1 hour
        videoDetails: 86400, // 24 hours
        channelInfo: 86400, // 24 hours
        trending: 300, // 5 minutes
        popular: 300, // 5 minutes
      },
    },

    // Certificate validation (for homelab users)
    certificateValidation: process.env.INVIDIOUS_VERIFY_CERT !== 'false',

    // Fallback options
    fallback: {
      // Use YouTube.js if Invidious fails
      youtubeJsEnabled: process.env.YOUTUBE_JS_FALLBACK !== 'false',
    },
  },

  // Video Enhancement Services
  enhancements: {
    // SponsorBlock integration
    sponsorblock: {
      enabled: process.env.SPONSORBLOCK_ENABLED !== 'false',
      apiUrl: 'https://sponsor.ajay.app',
      categories: [
        'sponsor',
        'intro',
        'outro',
        'interaction',
        'selfpromo',
        'music_offtopic',
        'filler',
      ],
    },

    // Return YouTube Dislikes integration
    returnYoutubeDislikes: {
      enabled: process.env.RYD_ENABLED !== 'false',
      apiUrl: 'https://returnyoutubedislikeapi.com',
    },

    // DeArrow integration (titles and thumbnails)
    deArrow: {
      enabled: process.env.DEARROW_ENABLED !== 'false',
      apiUrl: 'https://dearrow-server.ajay.app',
      // Local processing fallback
      localProcessing: process.env.DEARROW_LOCAL !== 'true',
    },
  },

  // User Data & Privacy
  privacy: {
    // Enable watch progress sync between sessions
    watchProgressSync: true,

    // Enable local caching of watch progress
    localCache: true,

    // Data retention policy
    dataRetention: {
      watchHistory: 30 * 24 * 60 * 60 * 1000, // 30 days
      searchHistory: 7 * 24 * 60 * 60 * 1000, // 7 days
    },

    // No tracking policies
    disableAnalytics: true,
    disableTracking: true,
    noCookieTracking: true,
  },

  // Performance Settings
  performance: {
    // Image proxy for privacy
    imageProxy: {
      enabled: process.env.MATERIALIOUS_IMAGE_PROXY !== 'false',
    },

    // Video streaming optimization
    videoStreaming: {
      // Adaptive bitrate streaming
      adaptiveBitrate: true,

      // Quality selection
      autoQuality: true,
      defaultQuality: 'auto',
    },

    // Caching
    cache: {
      enabledCaching: true,
      maxCacheSize: 100 * 1024 * 1024, // 100MB
    },
  },

  // API Rate Limiting
  rateLimit: {
    // Search endpoint
    search: {
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requests per minute
    },

    // Video endpoint
    video: {
      windowMs: 60 * 1000, // 1 minute
      max: 60, // 60 requests per minute
    },

    // Channel endpoint
    channel: {
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requests per minute
    },
  },

  // Logging
  logging: {
    enabled: true,
    level: process.env.LOG_LEVEL || 'info',
  },
};
