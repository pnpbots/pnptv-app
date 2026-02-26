/**
 * General Application Configuration
 * Centralizes all environment variables and app-wide settings
 */

module.exports = {
  // ==================== BOT CONFIGURATION ====================
  BOT_TOKEN: process.env.BOT_TOKEN,
  BOT_USERNAME: process.env.BOT_USERNAME,

  // ==================== URLS ====================
  BOT_WEBHOOK_DOMAIN: process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app',
  BOT_WEBHOOK_PATH: process.env.BOT_WEBHOOK_PATH || '/webhook/telegram',
  EPAYCO_WEBHOOK_PATH: process.env.EPAYCO_WEBHOOK_PATH || '/api/webhooks/epayco',
  DAIMO_WEBHOOK_PATH: process.env.DAIMO_WEBHOOK_PATH || '/api/webhooks/daimo',

  // ==================== ADMIN & CHANNELS ====================
  ADMIN_USER_IDS: process.env.ADMIN_USER_IDS?.split(',').map(id => id.trim()) || [],
  ADMIN_ID: process.env.ADMIN_ID,
  PRIME_CHANNEL_ID: process.env.PRIME_CHANNEL_ID,
  GROUP_ID: process.env.GROUP_ID,
  GROUP_INVITE_LINK: process.env.GROUP_INVITE_LINK || 'https://t.me/pnptvgroup',
  SUPPORT_GROUP_ID: process.env.SUPPORT_GROUP_ID,
  SUPPORT_GROUP_NAME: process.env.SUPPORT_GROUP_NAME || 'PNPtv Support Team',
  NOTIFICATIONS_TOPIC_ID: process.env.NOTIFICATIONS_TOPIC_ID ? parseInt(process.env.NOTIFICATIONS_TOPIC_ID) : null,
  WALL_OF_FAME_TOPIC_ID: process.env.WALL_OF_FAME_TOPIC_ID ? parseInt(process.env.WALL_OF_FAME_TOPIC_ID.replace(/.*\//, '')) : null,
  GENERAL_TOPIC_ID: process.env.GENERAL_TOPIC_ID ? parseInt(process.env.GENERAL_TOPIC_ID) : 1,
  HANGOUTS_TOPIC_ID: process.env.HANGOUTS_TOPIC_ID ? parseInt(process.env.HANGOUTS_TOPIC_ID) : null,

  // Videorama Configuration
  VIDEORAMA_ADMIN_UPLOAD_CHANNEL_ID: process.env.VIDEORAMA_ADMIN_UPLOAD_CHANNEL_ID,


  // ==================== ENVIRONMENT ====================
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 3001,

  // ==================== POSTGRESQL ====================
  POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
  POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT) || 5432,
  POSTGRES_DATABASE: process.env.POSTGRES_DATABASE,
  POSTGRES_USER: process.env.POSTGRES_USER,
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
  POSTGRES_SSL: process.env.POSTGRES_SSL === 'true',
  POSTGRES_POOL_MIN: parseInt(process.env.POSTGRES_POOL_MIN) || 2,
  POSTGRES_POOL_MAX: parseInt(process.env.POSTGRES_POOL_MAX) || 10,
  DATABASE_URL: process.env.DATABASE_URL,

  // ==================== REDIS ====================
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT) || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_DB: parseInt(process.env.REDIS_DB) || 0,
  REDIS_TTL: parseInt(process.env.REDIS_TTL) || 300,
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX || 'pnptv:',

  // ==================== SENTRY ====================
  SENTRY_DSN: process.env.SENTRY_DSN,
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,

  // ==================== PAYMENT PROVIDERS ====================
  // ePayco
  EPAYCO_PUBLIC_KEY: process.env.EPAYCO_PUBLIC_KEY,
  EPAYCO_PRIVATE_KEY: process.env.EPAYCO_PRIVATE_KEY,
  EPAYCO_P_CUST_ID: process.env.EPAYCO_P_CUST_ID,
  EPAYCO_P_KEY: process.env.EPAYCO_P_KEY,
  EPAYCO_TEST_MODE: process.env.EPAYCO_TEST_MODE === 'true',

  // Daimo
  DAIMO_API_KEY: process.env.DAIMO_API_KEY,
  DAIMO_APP_ID: process.env.DAIMO_APP_ID,
  DAIMO_TREASURY_ADDRESS: process.env.DAIMO_TREASURY_ADDRESS,
  DAIMO_REFUND_ADDRESS: process.env.DAIMO_REFUND_ADDRESS,
  DAIMO_WEBHOOK_SECRET: process.env.DAIMO_WEBHOOK_SECRET,

  // ==================== EMAIL CONFIGURATION ====================
  // SendGrid
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,

  // Generic SMTP
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  EMAIL_FROM: process.env.EMAIL_FROM,

  // EasyBots SMTP
  EASYBOTS_SMTP_HOST: process.env.EASYBOTS_SMTP_HOST,
  EASYBOTS_SMTP_PORT: parseInt(process.env.EASYBOTS_SMTP_PORT) || 587,
  EASYBOTS_SMTP_SECURE: process.env.EASYBOTS_SMTP_SECURE === 'true',
  EASYBOTS_SMTP_USER: process.env.EASYBOTS_SMTP_USER,
  EASYBOTS_SMTP_PASS: process.env.EASYBOTS_SMTP_PASS,
  EASYBOTS_FROM_EMAIL: process.env.EASYBOTS_FROM_EMAIL,

  // PNPtv SMTP
  PNPTV_SMTP_HOST: process.env.PNPTV_SMTP_HOST,
  PNPTV_SMTP_PORT: parseInt(process.env.PNPTV_SMTP_PORT) || 587,
  PNPTV_SMTP_SECURE: process.env.PNPTV_SMTP_SECURE === 'true',
  PNPTV_SMTP_USER: process.env.PNPTV_SMTP_USER,
  PNPTV_SMTP_PASS: process.env.PNPTV_SMTP_PASS,
  PNPTV_FROM_EMAIL: process.env.PNPTV_FROM_EMAIL,

  // ==================== AGORA (LIVE STREAMING) ====================
  AGORA_APP_ID: process.env.AGORA_APP_ID,
  AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE,



  // ==================== SECURITY ====================
  JWT_SECRET: process.env.JWT_SECRET,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,

  // ==================== RATE LIMITING ====================
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,

  // ==================== SESSION ====================
  SESSION_TTL: parseInt(process.env.SESSION_TTL) || 86400,

  // ==================== FILE UPLOAD ====================
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 10485760,
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',

  // ==================== GEOLOCATION ====================
  GEOCODER_PROVIDER: process.env.GEOCODER_PROVIDER,
  GEOCODER_API_KEY: process.env.GEOCODER_API_KEY,

  // ==================== CRON JOBS ====================
  ENABLE_CRON: process.env.ENABLE_CRON !== 'false',
  SUBSCRIPTION_CHECK_CRON: process.env.SUBSCRIPTION_CHECK_CRON || '0 0 * * *',
  REMINDER_3DAY_CRON: process.env.REMINDER_3DAY_CRON || '0 10 * * *',
  REMINDER_1DAY_CRON: process.env.REMINDER_1DAY_CRON || '0 10 * * *',

  // ==================== JITSI (JAAS) ====================
  JAAS_APP_ID: process.env.JAAS_APP_ID,
  JAAS_API_KEY_ID: process.env.JAAS_API_KEY_ID,
  JAAS_PRIVATE_KEY: process.env.JAAS_PRIVATE_KEY,

  // ==================== HANGOUTS/VIDEO CALLS ====================
  HANGOUTS_WEB_APP_URL: process.env.HANGOUTS_WEB_APP_URL,
  MAIN_ROOM_COUNT: parseInt(process.env.MAIN_ROOM_COUNT) || 10,
  MAX_CALL_PARTICIPANTS: parseInt(process.env.MAX_CALL_PARTICIPANTS) || 50,
  MAX_ROOM_PARTICIPANTS: parseInt(process.env.MAX_ROOM_PARTICIPANTS) || 100,
  WEBINAR_MAX_ATTENDEES: parseInt(process.env.WEBINAR_MAX_ATTENDEES) || 500,

  // ==================== FEATURE FLAGS ====================
  ENABLE_MODERATION: process.env.ENABLE_MODERATION !== 'false',
  ENABLE_PREMIUM: process.env.ENABLE_PREMIUM !== 'false',
  ENABLE_LIVE_STREAMS: process.env.ENABLE_LIVE_STREAMS !== 'false',
};
