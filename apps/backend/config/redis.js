const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;

/**
 * Initialize Redis client
 * @returns {Redis} Redis client instance
 */
const initializeRedis = () => {
  try {
    if (redisClient) {
      return redisClient;
    }

    const config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      db: parseInt(process.env.REDIS_DB || '0', 10),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'pnptv:',
      // Enable offline queue to buffer commands while connecting
      enableOfflineQueue: true,
      // Lazy connect - don't fail startup if Redis is not ready
      lazyConnect: false,
      // More aggressive retry strategy with exponential backoff
      retryStrategy: (times) => {
        if (times > 20) {
          // After 20 attempts (~2 minutes), give up
          logger.error('Redis connection failed after 20 retry attempts');
          return null; // Stop retrying
        }
        // Exponential backoff: 200ms, 400ms, 800ms, 1600ms, up to 5s
        const delay = Math.min(times * 200, 5000);
        logger.info(`Redis retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
      // Allow more retries per request
      maxRetriesPerRequest: 10,
      // Connection timeout
      connectTimeout: 10000,
      // Keep connection alive
      keepAlive: 30000,
      // Reconnect on error
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          // Reconnect on READONLY errors
          return true;
        }
        return false;
      },
    };

    if (process.env.REDIS_PASSWORD) {
      config.password = process.env.REDIS_PASSWORD;
    }

    redisClient = new Redis(config);

    redisClient.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    throw error;
  }
};

/**
 * Get Redis client instance
 * @returns {Redis}
 */
const getRedis = () => {
  if (!redisClient) {
    return initializeRedis();
  }
  return redisClient;
};

/**
 * Cache helper functions
 */
const cache = {
  /**
   * Get cached value
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or null
   */
  async get(key) {
    try {
      const client = getRedis();
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  },

  /**
   * Set cache value with optional TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (default from env)
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttl = null) {
    try {
      const client = getRedis();
      const stringValue = JSON.stringify(value);
      const cacheTTL = ttl || parseInt(process.env.REDIS_TTL || '300', 10);

      await client.set(key, stringValue, 'EX', cacheTTL);
      return true;
    } catch (error) {
      logger.error('Cache set error:', error);
      return false;
    }
  },

  /**
   * Delete cached value
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    try {
      const client = getRedis();
      await client.del(key);
      return true;
    } catch (error) {
      logger.error('Cache delete error:', error);
      return false;
    }
  },

  /**
   * Delete all keys matching pattern using SCAN (non-blocking)
   * @param {string} pattern - Key pattern (e.g., 'user:*')
   * @returns {Promise<number>} Number of deleted keys
   */
  async delPattern(pattern) {
    try {
      const client = getRedis();
      let deletedCount = 0;
      const batchSize = 100;

      // Use SCAN instead of KEYS to avoid blocking Redis
      const stream = client.scanStream({
        match: pattern,
        count: batchSize,
      });

      for await (const keys of stream) {
        if (keys.length > 0) {
          await client.del(...keys);
          deletedCount += keys.length;
        }
      }

      logger.info(`Deleted ${deletedCount} keys matching pattern: ${pattern}`);
      return deletedCount;
    } catch (error) {
      logger.error('Cache delete pattern error:', error);
      return 0;
    }
  },

  /**
   * Check if key exists
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Existence status
   */
  async exists(key) {
    try {
      const client = getRedis();
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return false;
    }
  },

  /**
   * Increment counter
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<number>} New value
   */
  async incr(key, ttl = 3600) {
    try {
      const client = getRedis();
      const value = await client.incr(key);
      if (value === 1) {
        await client.expire(key, ttl);
      }
      return value;
    } catch (error) {
      logger.error('Cache increment error:', error);
      return 0;
    }
  },

  /**
   * Set a key only if it doesn't exist (idempotency)
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} True if key was set, false if already exists
   */
  async setNX(key, value, ttl = 3600) {
    try {
      const client = getRedis();
      const stringValue = JSON.stringify(value);
      const result = await client.set(key, stringValue, 'EX', ttl, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error('Cache setNX error:', error);
      return false;
    }
  },

  /**
   * Acquire a lock for idempotent operations
   * @param {string} lockKey - Lock identifier
   * @param {number} ttl - Lock duration in seconds (default 300s = 5 min)
   * @returns {Promise<boolean>} True if lock acquired, false if already locked
   */
  async acquireLock(lockKey, ttl = 300) {
    return this.setNX(`lock:${lockKey}`, { acquiredAt: new Date().toISOString() }, ttl);
  },

  /**
   * Release a lock
   * @param {string} lockKey - Lock identifier
   * @returns {Promise<boolean>} Success status
   */
  async releaseLock(lockKey) {
    return this.del(`lock:${lockKey}`);
  },

  /**
   * Get or set cache value (cache-aside pattern)
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Async function to fetch value if not cached
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<any>} Cached or fetched value
   */
  async getOrSet(key, fetchFn, ttl = null) {
    try {
      // Try to get from cache first
      const cached = await this.get(key);
      if (cached !== null) {
        return cached;
      }

      // Not in cache, fetch the value
      const value = await fetchFn();

      // Store in cache for next time
      if (value !== null && value !== undefined) {
        await this.set(key, value, ttl);
      }

      return value;
    } catch (error) {
      logger.error('Cache getOrSet error:', error);
      // Fallback to fetching if cache fails
      return fetchFn();
    }
  },

  /**
   * Get multiple keys at once
   * @param {Array<string>} keys - Array of cache keys
   * @returns {Promise<Object>} Object with key-value pairs
   */
  async mget(keys) {
    try {
      const client = getRedis();
      const values = await client.mget(...keys);

      const result = {};
      keys.forEach((key, index) => {
        try {
          result[key] = values[index] ? JSON.parse(values[index]) : null;
        } catch (error) {
          result[key] = null;
        }
      });

      return result;
    } catch (error) {
      logger.error('Cache mget error:', error);
      return {};
    }
  },

  /**
   * Set multiple key-value pairs at once
   * @param {Object} keyValuePairs - Object with key-value pairs
   * @param {number} ttl - Time to live in seconds (applied to all keys)
   * @returns {Promise<boolean>} Success status
   */
  async mset(keyValuePairs, ttl = null) {
    try {
      const client = getRedis();
      const cacheTTL = ttl || parseInt(process.env.REDIS_TTL || '300', 10);

      // Use pipeline for efficiency
      const pipeline = client.pipeline();

      Object.entries(keyValuePairs).forEach(([key, value]) => {
        const stringValue = JSON.stringify(value);
        pipeline.set(key, stringValue, 'EX', cacheTTL);
      });

      await pipeline.exec();
      return true;
    } catch (error) {
      logger.error('Cache mset error:', error);
      return false;
    }
  },

  /**
   * Get all keys matching a pattern using SCAN (non-blocking)
   * @param {string} pattern - Key pattern (e.g., 'user:*')
   * @param {number} limit - Maximum number of keys to return (default: 1000)
   * @returns {Promise<Array<string>>} Array of matching keys
   */
  async scanKeys(pattern, limit = 1000) {
    try {
      const client = getRedis();
      const keys = [];
      const batchSize = 100;

      const stream = client.scanStream({
        match: pattern,
        count: batchSize,
      });

      for await (const batch of stream) {
        keys.push(...batch);
        if (keys.length >= limit) {
          stream.destroy(); // Stop scanning once limit is reached
          break;
        }
      }

      return keys.slice(0, limit);
    } catch (error) {
      logger.error('Cache scanKeys error:', error);
      return [];
    }
  },
};

/**
 * Close Redis connection
 */
const closeRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
};

module.exports = {
  initializeRedis,
  getRedis,
  cache,
  closeRedis,
};
