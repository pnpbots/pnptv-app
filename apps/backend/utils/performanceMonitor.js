const logger = require('./logger');

class PerformanceMonitor {
  constructor() {
    this.metrics = {};
    this.startTimes = {};
  }

  /**
   * Start timing a specific operation
   * @param {string} operationName - Name of the operation to time
   */
  start(operationName) {
    if (!this.startTimes[operationName]) {
      this.startTimes[operationName] = [];
    }
    this.startTimes[operationName].push(process.hrtime());
  }

  /**
   * End timing and record the duration
   * @param {string} operationName - Name of the operation
   * @param {Object} [context] - Additional context for logging
   */
  end(operationName, context = {}) {
    const startTimes = this.startTimes[operationName];
    if (!startTimes || startTimes.length === 0) {
      logger.warn(`Performance monitoring: No start time found for ${operationName}`);
      return;
    }

    const startTime = startTimes.pop();
    const diff = process.hrtime(startTime);
    const durationMs = (diff[0] * 1000) + (diff[1] / 1000000);
    
    // Store metric
    if (!this.metrics[operationName]) {
      this.metrics[operationName] = [];
    }
    this.metrics[operationName].push(durationMs);
    
    // Log if it's slow
    if (durationMs > 100) { // Log operations taking more than 100ms
      logger.debug(`Performance: ${operationName} took ${durationMs.toFixed(2)}ms`, context);
    }
    
    if (startTimes.length === 0) {
      delete this.startTimes[operationName];
    }
    return durationMs;
  }

  /**
   * Get average duration for an operation
   * @param {string} operationName - Name of the operation
   * @returns {number|null} Average duration in ms or null if no data
   */
  getAverage(operationName) {
    const durations = this.metrics[operationName];
    if (!durations || durations.length === 0) return null;
    
    const sum = durations.reduce((a, b) => a + b, 0);
    return sum / durations.length;
  }

  /**
   * Get all metrics
   * @returns {Object} All collected metrics
   */
  getAllMetrics() {
    const result = {};
    Object.keys(this.metrics).forEach(key => {
      result[key] = {
        count: this.metrics[key].length,
        average: this.getAverage(key),
        max: Math.max(...this.metrics[key]),
        min: Math.min(...this.metrics[key])
      };
    });
    return result;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {};
    this.startTimes = {};
  }

  /**
   * Wrap a function to automatically monitor its performance
   * @param {string} operationName - Name of the operation
   * @param {Function} fn - Function to wrap
   * @returns {Function} Wrapped function
   */
  monitor(operationName, fn) {
    return async (...args) => {
      this.start(operationName);
      try {
        const result = await fn(...args);
        this.end(operationName);
        return result;
      } catch (error) {
        this.end(operationName);
        throw error;
      }
    };
  }

  /**
   * Log performance summary
   */
  logSummary() {
    const metrics = this.getAllMetrics();
    Object.keys(metrics).forEach(key => {
      const metric = metrics[key];
      logger.info(`Performance Summary - ${key}:`, {
        count: metric.count,
        averageMs: metric.average.toFixed(2),
        maxMs: metric.max.toFixed(2),
        minMs: metric.min.toFixed(2)
      });
    });
  }
}

module.exports = new PerformanceMonitor();
