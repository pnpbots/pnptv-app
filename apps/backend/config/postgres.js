const { Pool } = require('pg');
const logger = require('../utils/logger');
const performanceMonitor = require('../utils/performanceMonitor');

let pool = null;

/**
 * Initialize PostgreSQL connection pool
 * @returns {Pool} PostgreSQL pool instance
 */
const initializePostgres = () => {
  if (pool) {
    return pool;
  }

  try {
    // Use individual connection parameters instead of connection string
    // to avoid URL encoding issues with special characters in password
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = parseInt(process.env.POSTGRES_PORT || '5432');
    const database = process.env.POSTGRES_DATABASE || 'pnptvbot';
    const user = process.env.POSTGRES_USER || 'pnptvbot';
    const password = process.env.POSTGRES_PASSWORD || '';

    // Configure SSL based on environment variable
    // In production, set POSTGRES_SSL=true for secure connections
    let sslConfig = false;
    if (process.env.POSTGRES_SSL === 'true') {
      sslConfig = {
        rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false',
      };
    }

    pool = new Pool({
      host,
      port,
      database,
      user,
      password,
      ssl: sslConfig,
      max: parseInt(process.env.POSTGRES_POOL_MAX || '20'),
      min: parseInt(process.env.POSTGRES_POOL_MIN || '2'),
      idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '10000'),
      connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '5000'),
      maxUses: parseInt(process.env.POSTGRES_MAX_USES || '5000'),
      // Statement timeout in milliseconds (30 seconds max query time)
      statement_timeout: parseInt(process.env.POSTGRES_STATEMENT_TIMEOUT || '30000'),
      // Enable connection validation to prevent using stale connections
      validate: process.env.POSTGRES_VALIDATE_CONNECTIONS !== 'false',
      // Log connection events for monitoring
      log: (message) => {
        if (message.includes('connect') || message.includes('disconnect') || message.includes('error')) {
          logger.debug(`PostgreSQL pool event: ${message}`);
        }
      }
    });

    pool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL pool error:', err);
    });

    logger.info('PostgreSQL pool initialized successfully');
    return pool;
  } catch (error) {
    logger.error('Failed to initialize PostgreSQL pool:', error);
    throw error;
  }
};

/**
 * Get PostgreSQL pool instance
 * @returns {Pool} PostgreSQL pool instance
 */
const getPool = () => {
  if (!pool) {
    return initializePostgres();
  }
  return pool;
};

/**
 * Test PostgreSQL connection
 * @returns {Promise<boolean>} true if connection successful
 */
const testConnection = async () => {
  try {
    const client = await getPool().connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('PostgreSQL connection successful');
    return true;
  } catch (error) {
    logger.error('PostgreSQL connection failed:', error);
    return false;
  }
};

/**
 * Close PostgreSQL pool
 * @returns {Promise<void>}
 */
const closePool = async () => {
  if (pool) {
    try {
      await pool.end();
      pool = null;
      logger.info('PostgreSQL pool closed');
    } catch (error) {
      logger.error('Error closing PostgreSQL pool:', error);
    }
  }
  // Stop cache cleanup when pool is closed
  stopCacheCleanup();
};

/**
 * Get a client from the pool with error handling
 * @returns {Promise<Object>} PostgreSQL client
 */
const getClient = async () => {
  try {
    const client = await getPool().connect();
    return client;
  } catch (error) {
    logger.error('Failed to get PostgreSQL client:', error);
    throw new Error('Database connection error');
  }
};

/**
 * Execute a query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
/**
 * Query cache configuration
 */
const queryCache = {
  enabled: process.env.POSTGRES_QUERY_CACHE_ENABLED !== 'false',
  ttl: process.env.POSTGRES_QUERY_CACHE_TTL ? parseInt(process.env.POSTGRES_QUERY_CACHE_TTL) : 120, // 120 seconds default
  maxSize: process.env.POSTGRES_QUERY_CACHE_MAX_SIZE ? parseInt(process.env.POSTGRES_QUERY_CACHE_MAX_SIZE) : 2000,
  cache: new Map(),
  cleanupEnabled: process.env.POSTGRES_QUERY_CACHE_CLEANUP !== 'false',
  // Add cache cleanup interval
  cleanupInterval: null
};

// Start cache cleanup interval
const startCacheCleanup = () => {
  if (!queryCache.cleanupEnabled || process.env.NODE_ENV === 'test') return;
  if (queryCache.cleanupInterval) return;
  
  queryCache.cleanupInterval = setInterval(() => {
    const now = Date.now();
    let deleted = 0;
    
    for (const [key, value] of queryCache.cache.entries()) {
      if (value.expires < now) {
        queryCache.cache.delete(key);
        deleted++;
      }
    }
    
    if (deleted > 0) {
      logger.debug(`Cleaned up ${deleted} expired query cache entries`);
    }
  }, 300000); // Run every 5 minutes
};

// Stop cache cleanup interval
const stopCacheCleanup = () => {
  if (queryCache.cleanupInterval) {
    clearInterval(queryCache.cleanupInterval);
    queryCache.cleanupInterval = null;
  }
};

// Start cache cleanup when module is loaded
startCacheCleanup();

/**
 * Generate cache key for query
 */
const generateCacheKey = (text, params) => {
  return `${text}:${JSON.stringify(params || [])}`;
};

/**
 * Clear query cache
 */
const clearQueryCache = () => {
  queryCache.cache.clear();
  logger.info('PostgreSQL query cache cleared');
};

/**
 * Detect if a SQL statement is a mutation (INSERT, UPDATE, DELETE, etc.)
 * Mutations must never be cached and must invalidate related cache entries.
 */
const isMutationQuery = (text) => {
  const trimmed = text.trimStart().toUpperCase();
  return /^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/.test(trimmed);
};

/**
 * Extract table names from a SQL statement for targeted cache invalidation.
 * Returns an array of lowercase table names found in the query.
 */
const extractTableNames = (text) => {
  const tables = new Set();
  // Match FROM/JOIN/UPDATE/INTO/TABLE followed by a table name
  const patterns = [
    /\bFROM\s+(\w+)/gi,
    /\bJOIN\s+(\w+)/gi,
    /\bUPDATE\s+(\w+)/gi,
    /\bINTO\s+(\w+)/gi,
    /\bTABLE\s+(\w+)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      tables.add(match[1].toLowerCase());
    }
  }
  return Array.from(tables);
};

/**
 * Invalidate all cache entries that reference any of the given table names.
 */
const invalidateCacheForTables = (tableNames) => {
  if (!tableNames.length || !queryCache.cache.size) return;
  let invalidated = 0;
  for (const [key] of queryCache.cache.entries()) {
    const keyLower = key.toLowerCase();
    for (const table of tableNames) {
      if (keyLower.includes(table)) {
        queryCache.cache.delete(key);
        invalidated++;
        break;
      }
    }
  }
  if (invalidated > 0) {
    logger.debug(`Invalidated ${invalidated} cache entries for tables: ${tableNames.join(', ')}`);
  }
};

const query = async (text, params, { cache = queryCache.enabled, ttl = queryCache.ttl } = {}) => {
  performanceMonitor.start('postgres_query');

  const isMutation = isMutationQuery(text);

  // Never use cache for mutation queries
  const useCache = cache && queryCache.enabled && !isMutation;

  // Check cache first if enabled (SELECT queries only)
  if (useCache) {
    const cacheKey = generateCacheKey(text, params);
    const cachedResult = queryCache.cache.get(cacheKey);

    if (cachedResult && cachedResult.expires > Date.now()) {
      performanceMonitor.end('postgres_query', {
        duration: 0,
        rows: cachedResult.result.rowCount,
        query: text.length > 100 ? `${text.substring(0, 100)}...` : text,
        source: 'cache'
      });
      // Track cache hit
      module.exports.incrementCacheHits();
      return cachedResult.result;
    }
    // Track cache miss
    module.exports.incrementCacheMisses();
  }

  try {
    const start = Date.now();
    const result = await getPool().query(text, params);
    const duration = Date.now() - start;

    // Invalidate cache entries for tables affected by mutations
    if (isMutation && queryCache.enabled) {
      const affectedTables = extractTableNames(text);
      invalidateCacheForTables(affectedTables);
    }

    // Only cache SELECT query results
    if (useCache && queryCache.cache.size < queryCache.maxSize) {
      const cacheKey = generateCacheKey(text, params);
      queryCache.cache.set(cacheKey, {
        result,
        expires: Date.now() + (ttl * 1000)
      });
    }

    performanceMonitor.end('postgres_query', {
      duration,
      rows: result.rowCount,
      query: text.length > 100 ? `${text.substring(0, 100)}...` : text,
      source: isMutation ? 'database(mutation)' : 'database'
    });

    if (duration > 100) { // Log slow queries
      logger.warn('Slow query detected', {
        duration,
        rows: result.rowCount,
        query: text.length > 200 ? `${text.substring(0, 200)}...` : text,
        params: params ? params.length : 0
      });
    }

    return result;
  } catch (error) {
    performanceMonitor.end('postgres_query', { error: error.message });
    logger.error('Query failed', {
      error: error.message,
      query: text.length > 200 ? `${text.substring(0, 200)}...` : text
    });
    throw error;
  }
};

module.exports = {
  initializePostgres,
  getPool,
  getClient,
  testConnection,
  closePool,
  query,
  clearQueryCache,
  getQueryCacheStats: () => ({
    size: queryCache.cache.size,
    enabled: queryCache.enabled,
    ttl: queryCache.ttl,
    maxSize: queryCache.maxSize,
    hitRate: queryCache.hits ? (queryCache.hits / (queryCache.hits + queryCache.misses || 1)) * 100 : 0
  }),
  // Add cache statistics tracking
  incrementCacheHits: () => {
    queryCache.hits = (queryCache.hits || 0) + 1;
  },
  incrementCacheMisses: () => {
    queryCache.misses = (queryCache.misses || 0) + 1;
  }
};
