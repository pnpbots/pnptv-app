const fs = require('fs');
const path = require('path');

class I18n {
  constructor() {
    this.translations = {};
    this.defaultLanguage = 'en';
    this.loadTranslations();
  }

  /**
   * Load all translation files
   */
  loadTranslations() {
    const localesPath = path.join(__dirname, '../../locales');
    const languages = ['en', 'es'];

    for (const lang of languages) {
      const filePath = path.join(localesPath, `${lang}.json`);
      try {
        this.translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        console.error(`Failed to load translations for ${lang}:`, error);
        this.translations[lang] = {};
      }
    }
  }

  /**
   * Get translated message
   */
  t(key, language = 'en', params = {}) {
    const lang = this.translations[language] || this.translations[this.defaultLanguage];
    let message = lang[key] || this.translations[this.defaultLanguage][key] || key;

    // Replace parameters in message
    for (const [param, value] of Object.entries(params)) {
      message = message.replace(new RegExp(`\\{${param}\\}`, 'g'), value);
    }

    return message;
  }

  /**
   * Middleware to add i18n to context
   */
  middleware() {
    return async (ctx, next) => {
      ctx.i18n = {
        t: (key, params) => this.t(key, ctx.user?.language || 'en', params),
        language: ctx.user?.language || 'en',
      };
      return next();
    };
  }
}

module.exports = new I18n();
