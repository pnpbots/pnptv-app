const axios = require('axios');
const { cache } = require('../config/redis');
const logger = require('./logger');

/**
 * Currency conversion utility
 * Converts between USD and COP with caching
 */
class CurrencyConverter {
  /**
   * Get exchange rate from USD to COP
   * Uses an external API with caching
   * @returns {Promise<number>} Exchange rate
   */
  static async getExchangeRate() {
    try {
      const cacheKey = 'exchange:usd_cop';

      return await cache.getOrSet(
        cacheKey,
        async () => {
          try {
            // Using a free exchange rate API
            // You can also use: https://api.exchangerate-api.com/v4/latest/USD
            const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
              timeout: 5000,
            });

            if (response.data && response.data.rates && response.data.rates.COP) {
              const rate = response.data.rates.COP;
              logger.info('Exchange rate fetched successfully', { rate });
              return rate;
            }

            // Fallback to default rate if API fails
            logger.warn('Exchange rate API returned invalid data, using default rate');
            return this.getDefaultRate();
          } catch (error) {
            logger.error('Error fetching exchange rate from API:', error);
            return this.getDefaultRate();
          }
        },
        3600, // Cache for 1 hour
      );
    } catch (error) {
      logger.error('Error getting exchange rate:', error);
      return this.getDefaultRate();
    }
  }

  /**
   * Get default exchange rate (fallback)
   * @returns {number} Default rate
   */
  static getDefaultRate() {
    // Default fallback rate (update this periodically)
    // As of 2025, approximate rate
    return 4100;
  }

  /**
   * Convert USD to COP
   * @param {number} usdAmount - Amount in USD
   * @returns {Promise<number>} Amount in COP
   */
  static async usdToCop(usdAmount) {
    try {
      const rate = await this.getExchangeRate();
      const copAmount = Math.round(usdAmount * rate);
      logger.debug('USD to COP conversion', { usdAmount, copAmount, rate });
      return copAmount;
    } catch (error) {
      logger.error('Error converting USD to COP:', error);
      // Fallback calculation
      return Math.round(usdAmount * this.getDefaultRate());
    }
  }

  /**
   * Convert COP to USD
   * @param {number} copAmount - Amount in COP
   * @returns {Promise<number>} Amount in USD
   */
  static async copToUsd(copAmount) {
    try {
      const rate = await this.getExchangeRate();
      const usdAmount = Math.round((copAmount / rate) * 100) / 100;
      logger.debug('COP to USD conversion', { copAmount, usdAmount, rate });
      return usdAmount;
    } catch (error) {
      logger.error('Error converting COP to USD:', error);
      // Fallback calculation
      return Math.round((copAmount / this.getDefaultRate()) * 100) / 100;
    }
  }

  /**
   * Get both USD and COP amounts for display
   * @param {number} baseAmount - Base amount
   * @param {string} [baseCurrency='USD'] - Base currency ('USD' or 'COP')
   * @returns {Promise<{usd: number, cop: number, rate: number}>} Display amounts and exchange rate
   */
  static async getDisplayAmounts(baseAmount, baseCurrency = 'USD') {
    try {
      const rate = await this.getExchangeRate();

      let usd;
      let cop;

      if (baseCurrency === 'USD') {
        usd = baseAmount;
        cop = Math.round(baseAmount * rate);
      } else {
        cop = baseAmount;
        usd = Math.round((baseAmount / rate) * 100) / 100;
      }

      return { usd, cop, rate };
    } catch (error) {
      logger.error('Error getting display amounts:', error);
      const rate = this.getDefaultRate();

      if (baseCurrency === 'USD') {
        return {
          usd: baseAmount,
          cop: Math.round(baseAmount * rate),
          rate,
        };
      }
      return {
        usd: Math.round((baseAmount / rate) * 100) / 100,
        cop: baseAmount,
        rate,
      };
    }
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
