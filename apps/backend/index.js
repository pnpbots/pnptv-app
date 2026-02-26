// Force IPv4 for DNS resolution (fixes IPv6 timeout issues with Telegram API)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const { startBot } = require('./bot/core/bot');
const logger = require('./utils/logger');

/**
 * Main entry point for the bot
 */
async function main() {
  try {
    logger.info('Starting PNPtv Telegram Bot...');

    // Start the bot (handles webhook/polling mode internally)
    await startBot();

  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the bot
main();
