const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

/**
 * MeruPaymentService - Verifica pagos de Meru usando un navegador headless
 * Lee el contenido real de la página después de que JavaScript se ejecuta
 */
class MeruPaymentService {
  constructor() {
    this.browser = null;
    // Simple rate limiting: track recent verifications per code
    this._recentChecks = new Map(); // code -> timestamp
    this.RATE_LIMIT_MS = 10000; // 10 seconds between checks for same code
  }

  /**
   * Inicializa el navegador una sola vez (with crash recovery)
   */
  async initBrowser() {
    // Check if existing browser is still connected
    if (this.browser) {
      if (this.browser.connected) {
        return this.browser;
      }
      // Browser crashed or disconnected — clean up and relaunch
      logger.warn('Puppeteer browser disconnected, relaunching...');
      this.browser = null;
    }

    try {
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      // Auto-recover on unexpected disconnect
      this.browser.on('disconnected', () => {
        logger.warn('Puppeteer browser disconnected unexpectedly');
        this.browser = null;
      });

      logger.info('Puppeteer browser initialized');
      return this.browser;
    } catch (error) {
      logger.error('Failed to initialize Puppeteer browser:', error);
      throw error;
    }
  }

  /**
   * Verifica si un link de Meru fue pagado
   * @param {string} meruCode - El código del link (ej: "abc123xyz")
   * @param {string} userLanguage - Idioma del usuario ('es' o 'en')
   * @returns {Promise<{isPaid: boolean, message: string}>}
   */
  async verifyPayment(meruCode, userLanguage = 'es') {
    // Rate limiting: prevent rapid repeated checks for same code
    const lastCheck = this._recentChecks.get(meruCode);
    if (lastCheck && Date.now() - lastCheck < this.RATE_LIMIT_MS) {
      logger.warn(`Rate limited: Meru code ${meruCode} checked too recently`);
      return {
        isPaid: false,
        message: 'Please wait a few seconds before checking again',
      };
    }
    this._recentChecks.set(meruCode, Date.now());

    // Clean up old entries periodically (keep map from growing)
    if (this._recentChecks.size > 100) {
      const cutoff = Date.now() - this.RATE_LIMIT_MS;
      for (const [code, ts] of this._recentChecks) {
        if (ts < cutoff) this._recentChecks.delete(code);
      }
    }

    let page = null;
    try {
      const browser = await this.initBrowser();
      page = await browser.newPage();

      // Establecer idioma del navegador según el usuario
      const languageMap = {
        es: 'es-ES,es;q=0.9,en;q=0.8',
        en: 'en-US,en;q=0.9,es;q=0.8',
      };
      const acceptLanguage = languageMap[userLanguage] || 'es-ES,es;q=0.9,en;q=0.8';

      await page.setExtraHTTPHeaders({
        'Accept-Language': acceptLanguage,
      });

      // Timeout de 15 segundos para la página
      await page.setDefaultTimeout(15000);

      const meruUrl = `https://pay.getmeru.com/${meruCode}`;
      logger.info(`Verifying Meru payment link: ${meruUrl}`);

      // Ir a la página y esperar a que se cargue
      await page.goto(meruUrl, { waitUntil: 'networkidle2' });

      // Obtener el contenido HTML después de que JavaScript se ejecute
      const pageContent = await page.content();

      // Esperar un poco más para animaciones
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Obtener el texto visible
      const visibleText = await page.evaluate(() => {
        return document.body.innerText;
      });

      logger.info(`Meru page loaded for code ${meruCode}`, {
        contentLength: pageContent.length,
        textLength: visibleText.length,
      });

      // Detectar si fue pagado — check both languages regardless of user preference
      // (Meru may respond in either language)
      const paidPatterns = [
        'El enlace de pago ha caducado o ya ha sido pagado',
        'El link de pago ha caducado',
        'ya ha sido pagado',
        'Payment link expired or already paid',
        'payment link has expired',
        'already paid',
      ];

      const isPaid = paidPatterns.some(
        (pattern) =>
          pageContent.includes(pattern) || visibleText.includes(pattern)
      );

      logger.info(`Payment verification for ${meruCode}: isPaid=${isPaid}`);

      return {
        isPaid,
        message: isPaid
          ? 'Payment link already used or expired'
          : 'Payment link is still active',
      };
    } catch (error) {
      logger.error(`Error verifying Meru payment for ${meruCode}:`, error);
      return {
        isPaid: false,
        message: `Error checking payment: ${error.message}`,
      };
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Cierra el navegador (llamar cuando se apague la aplicación)
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Puppeteer browser closed');
    }
  }
}

// Singleton
const meruPaymentService = new MeruPaymentService();

// Cleanup al apagar
process.on('SIGTERM', async () => {
  await meruPaymentService.closeBrowser();
});

process.on('SIGINT', async () => {
  await meruPaymentService.closeBrowser();
});

module.exports = meruPaymentService;
