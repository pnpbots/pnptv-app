const logger = require('./logger');

/**
 * Generate a unique room code for Jitsi/Zoom meetings
 * Format: ABC-1234 (3 letters + hyphen + 4 numbers)
 * @returns {string} Room code
 */
const generateRoomCode = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluding I and O to avoid confusion
  const numbers = '0123456789';

  let code = '';

  // Generate 3 random letters
  for (let i = 0; i < 3; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }

  code += '-';

  // Generate 4 random numbers
  for (let i = 0; i < 4; i++) {
    code += numbers.charAt(Math.floor(Math.random() * numbers.length));
  }

  return code;
};

/**
 * Format duration in minutes to human-readable string
 * @param {number} minutes - Duration in minutes
 * @param {string} lang - Language code
 * @returns {string} Formatted duration
 */
const formatDuration = (minutes, lang = 'en') => {
  if (minutes < 60) {
    return lang === 'es' ? `${minutes} minutos` : `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (mins === 0) {
    return lang === 'es' ? `${hours} hora${hours > 1 ? 's' : ''}` : `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  return lang === 'es'
    ? `${hours} hora${hours > 1 ? 's' : ''} y ${mins} minutos`
    : `${hours} hour${hours > 1 ? 's' : ''} and ${mins} minutes`;
};

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
const truncateText = (text, maxLength = 50) => {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + '...';
};

module.exports = {
  generateRoomCode,
  formatDuration,
  truncateText,
};
