const axios = require('axios');

/**
 * Convierte USD a COP usando la API exchangerate.host
 * @param {number} usdAmount
 * @returns {Promise<number>} Monto en COP
 */
async function convertUsdToCop(usdAmount) {
  try {
    const res = await axios.get('https://api.exchangerate.host/latest', {
      params: {
        base: 'USD',
        symbols: 'COP',
      },
    });
    const rate = res.data.rates.COP;
    return Math.round(usdAmount * rate);
  } catch (err) {
    // Fallback: valor fijo si falla la API
    return Math.round(usdAmount * 4000);
  }
}

module.exports = { convertUsdToCop };
