const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const logDir = process.env.LOG_DIR || './logs';
const logLevel = process.env.LOG_LEVEL || 'info';

const safeStringify = (value) => {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'bigint') return val.toString();
    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack };
    }
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    if (typeof val === 'function') {
      return `[Function${val.name ? `: ${val.name}` : ''}]`;
    }
    return val;
  });
};

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({
    timestamp, level, message, ...meta
  }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${safeStringify(meta)}`;
    }
    return msg;
  }),
);

// Create transports
const transports = [
  // Console transport with error handling
  new winston.transports.Console({
    format: consoleFormat,
    level: logLevel,
    handleExceptions: true,
    handleRejections: true,
  }),

  // Error log file
  new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    format: logFormat,
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
  }),

  // Combined log file
  new DailyRotateFile({
    filename: path.join(logDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    format: logFormat,
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
  }),
];

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports,
  exitOnError: false,
  handleExceptions: true,
  handleRejections: true,
});

// Handle uncaught exceptions and rejections
logger.on('error', (error) => {
  // Ignore EPIPE errors as they are not critical
  if (error.code === 'EPIPE') {
    return;
  }
  console.error('Logger error:', error.message);
});

/**
 * Add user context to logs
 * @param {string|number} userId - User ID
 * @param {string} action - Action being performed
 * @returns {{userId: string|number, action: string, timestamp: string}} User context object
 */
logger.addUserContext = (userId, action) => ({
  userId,
  action,
  timestamp: new Date().toISOString(),
});

// Stream for Morgan (HTTP request logging)
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = logger;
