module.exports = {
  apps: [{
    name: 'pnptv-bot',
    script: './apps/backend/bot/core/bot.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    node_args: '--dns-result-order=ipv4first',
    exec_mode: 'fork',
    cwd: '/opt/pnptvapp',
    // SECURITY FIX: Remove all secrets from this file!
    // Secrets MUST come from .env.production only (loaded by dotenv in bot.js)
    // Never commit secrets to version control
    env: {
      NODE_ENV: 'production',
      PORT: '3001',
      NODE_OPTIONS: "--dns-result-order=ipv4first",
      AMPACHE_URL: "http://172.20.0.16:80",
      BOT_LOCK_ENABLED: 'false',
      AMPACHE_USER: 'admin',
      // All sensitive values must be in .env.production
      // See .env.example for required variables
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: '3001',
      NODE_OPTIONS: "--dns-result-order=ipv4first",
      AMPACHE_URL: "http://172.20.0.16:80",
      BOT_LOCK_ENABLED: 'false',
      AMPACHE_USER: 'admin',
      // SECURITY: All secrets must be in .env.production
      // Postgres pool settings (non-sensitive)
      POSTGRES_POOL_MAX: '20', // Increased from 10 for concurrency
      POSTGRES_POOL_MIN: '2',
      POSTGRES_IDLE_TIMEOUT: '10000',
      POSTGRES_CONNECTION_TIMEOUT: '5000',
      POSTGRES_STATEMENT_TIMEOUT: '30000', // 30s max query time
    },
    env_development: {
      NODE_ENV: 'development',
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    kill_timeout: 30000, // 30s for graceful shutdown (was 5s)
    wait_ready: true, // Wait for process.send('ready') signal
    listen_timeout: 10000,
    ignore_watch: ['node_modules', 'logs'],
  }],
};
