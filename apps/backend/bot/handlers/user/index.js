const onboardingHandlers = require('./onboarding');
const menuHandlers = require('./menu');
const profileHandlers = require('./profile');
const nearbyHandlers = require('./nearby');
const nearbyUnifiedHandlers = require('./nearbyUnified');
const nearbyPlacesHandlers = require('./nearbyPlaces');
const businessSubmissionHandlers = require('./businessSubmission');
const enhancedProfileCards = require('./enhancedProfileCards');
const settingsHandlers = require('./settings');
const groupWelcomeHandlers = require('./groupWelcome');
const { registerAgeVerificationHandlers } = require('./ageVerificationHandler');
const lifetimeMigrationHandlers = require('./lifetimeMigration');
const { registerSubscriptionHandlers } = require('./subscriptionManagement');
const registerPNPLiveHandlers = require('./pnpLiveHandler');
const PNPLiveNotificationService = require('../../services/pnpLiveNotificationService');
const registerHangoutsHandlers = require('./hangoutsHandler');

const registerVideoramaHandlers = require('./videoramaHandler');

/**
 * Register all user handlers
 * @param {Telegraf} bot - Bot instance
 */
const registerUserHandlers = (bot) => {
  onboardingHandlers(bot);
  registerAgeVerificationHandlers(bot);
  menuHandlers(bot);
  profileHandlers(bot);
  // Nearby handlers - unified must be first to handle main callbacks
  nearbyUnifiedHandlers(bot);
  nearbyPlacesHandlers(bot);
  nearbyHandlers(bot); // Legacy radius handler only
  businessSubmissionHandlers(bot);
  enhancedProfileCards(bot);
  settingsHandlers(bot);
  groupWelcomeHandlers(bot);
  lifetimeMigrationHandlers(bot);
  registerSubscriptionHandlers(bot);
  registerPNPLiveHandlers(bot);
  registerHangoutsHandlers(bot);

  registerVideoramaHandlers(bot);

  // Initialize PNP Live notification service with bot instance
  PNPLiveNotificationService.init(bot);
};

module.exports = registerUserHandlers;
