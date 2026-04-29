// Routes all COP conversions through the single authoritative FX source.
// Loaded lazily to avoid circular require.
function _getEpaycoCopRate() {
  return require('../../services/paymentService').getEpaycoCopRate();
}

/**
 * Convierte USD a COP usando la tasa en vivo de getEpaycoCopRate().
 * Fail-closed: si la tasa no está disponible, lanza FX_RATE_UNAVAILABLE.
 * PNPtv displays prices in USD to international users but settles via ePayco's
 * Colombian acquiring network in COP. Do not hardcode a fallback — fail closed instead.
 * @param {number} usdAmount
 * @returns {Promise<number>} Monto en COP
 */
async function convertUsdToCop(usdAmount) {
  const rate = await _getEpaycoCopRate();
  return Math.round(usdAmount * rate);
}

module.exports = { convertUsdToCop };
