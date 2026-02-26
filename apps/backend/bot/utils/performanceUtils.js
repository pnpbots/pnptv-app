/**
 * Performance Utilities
 * Optimization helpers for broadcast and share post functionality
 */

const logger = require('../../utils/logger');

/**
 * Execute multiple async operations in parallel with error handling
 * @param {Array<Function>} operations - Array of async functions to execute
 * @returns {Promise<Array>} Array of results
 */
async function parallelOperations(operations) {
  try {
    return await Promise.all(operations.map(op => op().catch(error => {
      logger.warn('Parallel operation failed:', error.message);
      return null;
    })));
  } catch (error) {
    logger.error('Parallel operations failed:', error);
    return [];
  }
}

/**
 * Batch session updates to reduce database writes
 * @param {Object} ctx - Telegraf context
 * @param {Array<Object>} updates - Array of {key, value} pairs to update
 * @returns {Promise<void>}
 */
async function batchSessionUpdates(ctx, updates) {
  if (!ctx.session) {
    ctx.session = {};
  }
  
  updates.forEach(update => {
    // Handle nested updates (e.g., 'broadcastData.textEn')
    const keys = update.key.split('.');
    let current = ctx.session;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = update.value;
  });
  
  await ctx.saveSession();
}

/**
 * Cache frequently accessed data to reduce database queries
 */
class BroadcastCache {
  constructor(ttl = 300000) { // 5 minutes default TTL
    this.cache = new Map();
    this.ttl = ttl;
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (item.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }
  
  set(key, value) {
    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttl
    });
  }
  
  clear() {
    this.cache.clear();
  }
}

// Global cache instance
const broadcastCache = new BroadcastCache();

/**
 * Optimized user targeting with caching
 * @param {String} targetType - Target type (all, premium, free, churned)
 * @param {Function} getUsersFn - Function to get users from database
 * @returns {Promise<Array>} Array of user IDs
 */
async function getTargetUsersOptimized(targetType, getUsersFn) {
  const cacheKey = `targetUsers_${targetType}`;
  
  // Check cache first
  const cached = broadcastCache.get(cacheKey);
  if (cached) {
    logger.debug(`Using cached user list for ${targetType}`);
    return cached;
  }
  
  // Get from database
  const users = await getUsersFn(targetType);
  
  // Cache the result
  broadcastCache.set(cacheKey, users);
  
  return users;
}

/**
 * Chunk large operations to avoid memory issues
 * @param {Array} array - Array to process
 * @param {Number} chunkSize - Size of each chunk
 * @param {Function} processFn - Function to process each chunk
 * @returns {Promise<Array>} Array of results
 */
async function processInChunks(array, chunkSize = 100, processFn) {
  const results = [];
  
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    const result = await processFn(chunk);
    results.push(...result);
    
    // Small delay to prevent rate limiting
    if (i > 0 && i % (chunkSize * 3) === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

/**
 * Debounce rapid successive calls
 * @param {Function} fn - Function to debounce
 * @param {Number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle function calls
 * @param {Function} fn - Function to throttle
 * @param {Number} limit - Maximum calls per time period
 * @param {Number} time - Time period in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(fn, limit, time) {
  let calls = [];
  let inProgress = false;
  
  return function(...args) {
    calls.push({ args, resolve: null, reject: null });
    
    if (!inProgress) {
      processQueue();
    }
    
    return new Promise((resolve, reject) => {
      const lastCall = calls[calls.length - 1];
      lastCall.resolve = resolve;
      lastCall.reject = reject;
    });
  };
  
  async function processQueue() {
    if (calls.length === 0) {
      inProgress = false;
      return;
    }
    
    inProgress = true;
    const batch = calls.splice(0, limit);
    
    try {
      const results = await Promise.all(batch.map(call => fn(...call.args)));
      batch.forEach((call, index) => call.resolve(results[index]));
    } catch (error) {
      batch.forEach(call => call.reject(error));
    }
    
    setTimeout(processQueue, time);
  }
}

/**
 * Measure and log performance metrics
 * @param {String} operationName - Name of the operation
 * @param {Function} fn - Function to measure
 * @returns {Promise<any>} Result of the function
 */
async function measurePerformance(operationName, fn) {
  const start = process.hrtime.bigint();
  
  try {
    const result = await fn();
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    
    logger.info(`${operationName} completed in ${duration.toFixed(2)}ms`);
    
    return result;
  } catch (error) {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000;
    
    logger.error(`${operationName} failed after ${duration.toFixed(2)}ms:`, error.message);
    
    throw error;
  }
}

/**
 * Optimized media handling with size validation
 * @param {Object} media - Media object from Telegram
 * @param {String} type - Media type (photo, video, document)
 * @param {Number} maxSizeMB - Maximum allowed size in MB
 * @returns {Object} Media info with validation
 */
function validateMedia(media, type, maxSizeMB = 50) {
  const result = {
    valid: true,
    error: null,
    mediaInfo: {}
  };
  
  try {
    if (type === 'photo') {
      const photo = media[media.length - 1]; // Get highest resolution
      result.mediaInfo = {
        fileId: photo.file_id,
        width: photo.width,
        height: photo.height,
        fileSize: photo.file_size || 0
      };
    } else if (type === 'video') {
      result.mediaInfo = {
        fileId: media.file_id,
        width: media.width,
        height: media.height,
        duration: media.duration,
        fileSize: media.file_size || 0
      };
      
      // Check video size
      const sizeMB = media.file_size ? media.file_size / (1024 * 1024) : 0;
      if (sizeMB > maxSizeMB) {
        result.valid = false;
        result.error = `Video too large (${sizeMB.toFixed(2)}MB). Maximum: ${maxSizeMB}MB`;
      }
    } else if (type === 'document') {
      result.mediaInfo = {
        fileId: media.file_id,
        fileName: media.file_name,
        mimeType: media.mime_type,
        fileSize: media.file_size || 0
      };
    }
  } catch (error) {
    result.valid = false;
    result.error = 'Invalid media format';
  }
  
  return result;
}

module.exports = {
  parallelOperations,
  batchSessionUpdates,
  BroadcastCache,
  broadcastCache,
  getTargetUsersOptimized,
  processInChunks,
  debounce,
  throttle,
  measurePerformance,
  validateMedia
};
