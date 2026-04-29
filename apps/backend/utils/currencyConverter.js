const logger = require('./logger');

// Routes all ePayco COP conversions through the single authoritative FX source.
// Loaded lazily to avoid circular require (paymentService → currencyConverter → paymentService).
function _getEpaycoCopRate() {
  return require('../services/paymentService').getEpaycoCopRate();
}

/**
 * Currency conversion utility
 * Converts between USD and COP using the live FX rate managed by paymentService.
 * All callers that use this class for ePayco payments will get the same rate as
 * the checkout and webhook validation paths.
 */
class CurrencyConverter {
  /**
   * Get exchange rate from USD to COP.
   * Delegates to getEpaycoCopRate() — Redis-backed, self-healing, fail-closed.
   * @returns {Promise<number>} Exchange rate
   */
  static async getExchangeRate() {
    return _getEpaycoCopRate();
  }

  /**
   * Convert USD to COP
   * @param {number} usdAmount - Amount in USD
   * @returns {Promise<number>} Amount in COP
   */
  static async usdToCop(usdAmount) {
    const rate = await _getEpaycoCopRate();
    const copAmount = Math.round(usdAmount * rate);
    logger.debug('USD to COP conversion', { usdAmount, copAmount, rate });
    return copAmount;
  }

  /**
   * Convert COP to USD
   * @param {number} copAmount - Amount in COP
   * @returns {Promise<number>} Amount in USD
   */
  static async copToUsd(copAmount) {
    const rate = await _getEpaycoCopRate();
    const usdAmount = Math.round((copAmount / rate) * 100) / 100;
    logger.debug('COP to USD conversion', { copAmount, usdAmount, rate });
    return usdAmount;
  }

  /**
   * Get both USD and COP amounts for display
   * @param {number} baseAmount - Base amount
   * @param {string} [baseCurrency='USD'] - Base currency ('USD' or 'COP')
   * @returns {Promise<{usd: number, cop: number, rate: number}>} Display amounts and exchange rate
   */
  static async getDisplayAmounts(baseAmount, baseCurrency = 'USD') {
    const rate = await _getEpaycoCopRate();
    if (baseCurrency === 'USD') {
      return { usd: baseAmount, cop: Math.round(baseAmount * rate), rate };
    }
    return { usd: Math.round((baseAmount / rate) * 100) / 100, cop: baseAmount, rate };
  }

  /**
   * Format currency for display
   * @param {number} amount - Amount
   * @param {string} currency - Currency code ('USD', 'COP', etc.)
   * @returns {string} Formatted currency string
   */
  static formatCurrency(amount, currency) {
    if (currency === 'USD') {
      return `$${amount.toFixed(2)} USD`;
    }
    if (currency === 'COP') {
      return `$${amount.toLocaleString('es-CO')} COP`;
    }
    return `${amount} ${currency}`;
  }
}

module.exports = CurrencyConverter;
