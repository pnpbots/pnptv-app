const { query } = require('./postgres');
const RoleService = require('../services/roleService');
const ApprovalService = require('../services/approvalService');
const logger = require('../utils/logger');

/**
 * Ensure broadcast retry queue table exists.
 */
async function ensureBroadcastRetryQueueTable() {
  const statements = [
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
    `
    CREATE TABLE IF NOT EXISTS broadcast_retry_queue (
      id SERIAL PRIMARY KEY,
      retry_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
      broadcast_id UUID NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      attempt_number INTEGER DEFAULT 1,
      max_attempts INTEGER DEFAULT 5,
      next_retry_at TIMESTAMP NOT NULL,
      retry_delay_seconds INTEGER DEFAULT 60,
      backoff_multiplier DECIMAL(3,1) DEFAULT 2.0,
      last_error_code VARCHAR(100),
      last_error_message TEXT,
      error_history JSONB,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    `,
    'CREATE INDEX IF NOT EXISTS idx_retry_queue_status ON broadcast_retry_queue(status)',
    'CREATE INDEX IF NOT EXISTS idx_retry_queue_next_retry_at ON broadcast_retry_queue(next_retry_at)',
    'CREATE INDEX IF NOT EXISTS idx_retry_queue_broadcast_id ON broadcast_retry_queue(broadcast_id)',
    'CREATE INDEX IF NOT EXISTS idx_retry_queue_user_id ON broadcast_retry_queue(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_retry_queue_attempt_number ON broadcast_retry_queue(attempt_number)',
  ];

  for (const statement of statements) {
    await query(statement);
  }

  // Only create the updated_at helper if it does not already exist (skip if owned by another user)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'update_updated_at_column' AND n.nspname = 'public'
      ) THEN
        CREATE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $func$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
      END IF;
    END;
    $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_retry_queue_updated_at'
      ) THEN
        CREATE TRIGGER trigger_retry_queue_updated_at
        BEFORE UPDATE ON broadcast_retry_queue
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END;
    $$;
  `);

  logger.info('✓ broadcast_retry_queue table verified');
}

/**
 * Initialize core PostgreSQL tables required for bot startup.
 */
async function initializeCoreTables() {
  try {
    await RoleService.initializeTables();
    await ApprovalService.initializeTables();
    await ensureBroadcastRetryQueueTable();
    logger.info('✓ Core database tables initialized');
  } catch (error) {
    logger.error('Error initializing core database tables:', error);
    throw error;
  }
}

module.exports = {
  initializeCoreTables,
  ensureBroadcastRetryQueueTable,
};
