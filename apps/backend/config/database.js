const logger = require('../utils/logger');

const throwError = (functionName) => {
  const errorMessage = `❌ ${functionName}() called but Firebase is DISABLED. This is a BUG. Please update the calling code to use PostgreSQL via postgres.js instead.`;
  logger.error(errorMessage);
  throw new Error(errorMessage);
};

const initializeDatabase = () => throwError('initializeDatabase');
const getDatabase = () => throwError('getDatabase');
const testConnection = async () => throwError('testConnection');
const syncDatabase = async () => throwError('syncDatabase');
const closeDatabase = async () => throwError('closeDatabase');

module.exports = {
  initializeDatabase,
  getDatabase,
  testConnection,
  syncDatabase,
  closeDatabase,
};

