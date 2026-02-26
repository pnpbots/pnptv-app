/**
 * Coordinate Utility Functions
 *
 * Privacy & Anonymization Helpers
 * - Reduce geolocation precision to 3 decimals (~111m)
 * - Used when storing/querying location data
 * - Prevents excessive precision that could deanonymize users
 *
 * Precision Reference:
 * - 8 decimals: ~1.1mm (current, GDPR risk)
 * - 5 decimals: ~1.1m (still too precise)
 * - 3 decimals: ~111m (anonymization-friendly)
 * - 2 decimals: ~1.1km (too coarse)
 *
 * Usage:
 * const { latitude, longitude } = truncateCoordinates(40.71281, -74.00603);
 * // Returns: { latitude: 40.713, longitude: -74.006 }
 */

const logger = require('./logger');

/**
 * Truncate latitude and longitude to 3 decimal places
 * Rounds down to nearest 0.001 degree (~111m precision)
 *
 * @param {number} latitude - User's latitude (-90 to 90)
 * @param {number} longitude - User's longitude (-180 to 180)
 * @returns {Object} { latitude, longitude } truncated to 3 decimals
 * @throws {Error} If coordinates are invalid
 */
function truncateCoordinates(latitude, longitude) {
  // Validate input types
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    const error = new Error(
      `Invalid coordinate types: expected numbers, got ${typeof latitude} and ${typeof longitude}`
    );
    logger.error('truncateCoordinates validation failed:', error);
    throw error;
  }

  // Validate coordinate ranges
  if (latitude < -90 || latitude > 90) {
    const error = new Error(`Invalid latitude: ${latitude} (must be -90 to 90)`);
    logger.error('truncateCoordinates validation failed:', error);
    throw error;
  }

  if (longitude < -180 || longitude > 180) {
    const error = new Error(`Invalid longitude: ${longitude} (must be -180 to 180)`);
    logger.error('truncateCoordinates validation failed:', error);
    throw error;
  }

  // Truncate to 3 decimal places
  // Math.round(value * 1000) / 1000 → rounds to nearest 0.001
  const truncatedLat = Math.round(latitude * 1000) / 1000;
  const truncatedLon = Math.round(longitude * 1000) / 1000;

  logger.debug(
    `Coordinates truncated: (${latitude}, ${longitude}) → (${truncatedLat}, ${truncatedLon})`
  );

  return {
    latitude: truncatedLat,
    longitude: truncatedLon
  };
}

/**
 * Truncate a single coordinate value to 3 decimals
 * Used for independent latitude or longitude processing
 *
 * @param {number} value - Latitude or longitude value
 * @returns {number} Value rounded to 3 decimals
 * @throws {Error} If value is not a number
 */
function truncateCoordinate(value) {
  if (typeof value !== 'number') {
    const error = new Error(
      `Invalid coordinate value type: expected number, got ${typeof value}`
    );
    logger.error('truncateCoordinate validation failed:', error);
    throw error;
  }

  const truncated = Math.round(value * 1000) / 1000;
  logger.debug(`Single coordinate truncated: ${value} → ${truncated}`);
  return truncated;
}

/**
 * Validate coordinates before truncation
 * Useful for pre-flight checks before expensive operations
 *
 * @param {number} latitude - User's latitude
 * @param {number} longitude - User's longitude
 * @returns {boolean} True if coordinates are valid
 */
function isValidCoordinates(latitude, longitude) {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Useful for nearby user calculations
 *
 * @param {number} lat1 - First latitude
 * @param {number} lon1 - First longitude
 * @param {number} lat2 - Second latitude
 * @param {number} lon2 - Second longitude
 * @returns {Object} { km, meters } - Distance in both units
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km

  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R * c;
  const meters = km * 1000;

  return { km: Math.round(km * 100) / 100, meters: Math.round(meters) };
}

/**
 * Get precision level description
 * Explains what precision means in practical terms
 *
 * @param {number} decimals - Number of decimal places (1-8)
 * @returns {Object} { decimals, precision_meters, use_case }
 */
function getPrecisionInfo(decimals = 3) {
  const precisionMap = {
    1: { meters: 11100, use_case: 'Country/region level' },
    2: { meters: 1100, use_case: 'City level' },
    3: { meters: 111, use_case: 'Neighborhood/anonymization' },
    4: { meters: 11, use_case: 'Street level' },
    5: { meters: 1.1, use_case: 'House level' },
    6: { meters: 0.11, use_case: 'Meter level' },
    7: { meters: 0.011, use_case: 'Decimeter level' },
    8: { meters: 0.0011, use_case: 'Millimeter level (GDPR risk)' }
  };

  const info = precisionMap[decimals] || precisionMap[3];
  return {
    decimals,
    precision_meters: info.meters,
    use_case: info.use_case
  };
}

module.exports = {
  truncateCoordinates,
  truncateCoordinate,
  isValidCoordinates,
  calculateDistance,
  getPrecisionInfo
};
