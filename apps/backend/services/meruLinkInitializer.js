const logger = require('../utils/logger');
const { query } = require('../utils/db');
const meruLinkService = require('./meruLinkService');
const paymentHistoryService = require('./paymentHistoryService');

/**
 * Initialize Meru Link tracking system
 * Creates table and initializes with existing links from lifetime-pass.html
 */
class MeruLinkInitializer {
  async initialize() {
    try {
      logger.info('Initializing Meru Link tracking system...');

      // Create tables with timeout to prevent hanging
      Promise.all([
        this.createPaymentHistoryTable().catch(e => logger.warn(`Payment history table creation failed: ${e.message}`)),
        this.createMeruLinksTable().catch(e => logger.warn(`Meru links table creation failed: ${e.message}`)),
        this.initializeKnownLinks().catch(e => logger.warn(`Meru links initialization failed: ${e.message}`))
      ]).then(() => {
        logger.info('✓ Meru Link tracking system initialized');
      });

      return true;
    } catch (error) {
      logger.error('Error initializing Meru Link system:', error);
      return false;
    }
  }

  async createPaymentHistoryTable() {
    try {
      // Create payment_history table
      await query(`
        CREATE TABLE IF NOT EXISTS payment_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          payment_method VARCHAR(50) NOT NULL,
          amount DECIMAL(12, 2) NOT NULL,
          currency VARCHAR(10) DEFAULT 'USD',
          plan_id VARCHAR(100),
          plan_name VARCHAR(255),
          product VARCHAR(100),
          payment_reference VARCHAR(255) NOT NULL UNIQUE,
          provider_transaction_id VARCHAR(255),
          provider_payment_id VARCHAR(255),
          webhook_data JSONB,
          status VARCHAR(50) DEFAULT 'completed',
          payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ip_address INET,
          user_agent TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes (run in parallel, don't wait for all)
      Promise.allSettled([
        query(`CREATE INDEX IF NOT EXISTS idx_payment_history_user_id ON payment_history(user_id)`),
        query(`CREATE INDEX IF NOT EXISTS idx_payment_history_payment_date ON payment_history(payment_date DESC)`),
        query(`CREATE INDEX IF NOT EXISTS idx_payment_history_reference ON payment_history(payment_reference)`)
      ]).catch(() => {});

      // Add columns to users table if they don't exist
      await query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMP,
        ADD COLUMN IF NOT EXISTS last_payment_amount DECIMAL(12, 2),
        ADD COLUMN IF NOT EXISTS last_payment_method VARCHAR(50),
        ADD COLUMN IF NOT EXISTS last_payment_reference VARCHAR(255)
      `);

      // Create index on users
      await query(`
        CREATE INDEX IF NOT EXISTS idx_users_last_payment_date ON users(last_payment_date)
      `);

      logger.info('✓ payment_history table created');
    } catch (error) {
      logger.error('Error creating payment_history table:', error);
      throw error;
    }
  }

  async createMeruLinksTable() {
    try {
      // Create the main table
      await query(`
        CREATE TABLE IF NOT EXISTS meru_payment_links (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          code VARCHAR(50) NOT NULL UNIQUE,
          meru_link VARCHAR(255) NOT NULL UNIQUE,
          product VARCHAR(100) DEFAULT 'lifetime-pass',
          status VARCHAR(50) DEFAULT 'active',
          activation_code VARCHAR(50),
          used_by VARCHAR(255),
          used_by_username VARCHAR(255),
          used_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          invalidated_at TIMESTAMP,
          invalidation_reason TEXT
        )
      `);

      // Create indexes (run in parallel, don't wait for all)
      Promise.allSettled([
        query(`CREATE INDEX IF NOT EXISTS idx_meru_links_status ON meru_payment_links(status)`),
        query(`CREATE INDEX IF NOT EXISTS idx_meru_links_code ON meru_payment_links(code)`)
      ]).catch(() => {});

      logger.info('✓ meru_payment_links table created');
    } catch (error) {
      logger.error('Error creating meru_payment_links table:', error);
      throw error;
    }
  }

  async initializeKnownLinks() {
    try {
      const knownLinks = [
        { code: 'eEnWer', url: 'https://pay.getmeru.com/eEnWer' },
        { code: 'UBKonc', url: 'https://pay.getmeru.com/UBKonc' },
        { code: '5gJF8u', url: 'https://pay.getmeru.com/5gJF8u' },
        { code: 'rVuKhL', url: 'https://pay.getmeru.com/rVuKhL' },
        { code: '9x9bhA', url: 'https://pay.getmeru.com/9x9bhA' },
        { code: 'QrHN40', url: 'https://pay.getmeru.com/QrHN40' },
        { code: 'CEc_tE', url: 'https://pay.getmeru.com/CEc_tE' },
        { code: 'ONYdvU', url: 'https://pay.getmeru.com/ONYdvU' },
        { code: 'AhWBch', url: 'https://pay.getmeru.com/AhWBch' },
        { code: 'YNLiew', url: 'https://pay.getmeru.com/YNLiew' },
        { code: 'hfFBA-', url: 'https://pay.getmeru.com/hfFBA-' },
        { code: 'mzETr3', url: 'https://pay.getmeru.com/mzETr3' },
        { code: 'f9C1EZ', url: 'https://pay.getmeru.com/f9C1EZ' },
        { code: 'FfaRGs', url: 'https://pay.getmeru.com/FfaRGs' },
        { code: 'fllJfg', url: 'https://pay.getmeru.com/fllJfg' },
        { code: 'gnXNVP', url: 'https://pay.getmeru.com/gnXNVP' },
        { code: 'eS8-wC', url: 'https://pay.getmeru.com/eS8-wC' },
      ];

      let addedCount = 0;
      for (const link of knownLinks) {
        const success = await meruLinkService.addLink(link.code, link.url, 'lifetime-pass');
        if (success) addedCount++;
      }

      logger.info(`✓ Initialized ${addedCount}/${knownLinks.length} known Meru links`);
    } catch (error) {
      logger.error('Error initializing known Meru links:', error);
      throw error;
    }
  }
}

module.exports = new MeruLinkInitializer();
