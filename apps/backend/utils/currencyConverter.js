const logger = require('./logger');

class CurrencyConverter {
  static formatCurrency(amount, currency) {
    if (currency === 'USD') {
      return `$${amount.toFixed(2)} USD`;
    }
    return `${amount} ${currency}`;
  }
}

module.exports = CurrencyConverter;
