/**
 * Handler Registration Index
 * Central point for registering all bot handlers
 */

module.exports = {
  // User handlers
  user: {
    registerUserHandlers: require('./user'),
    registerPrivateCalls: () => {}, // Stub: privateCallsBooking deleted — booking flow unified in CallBookingService
    registerPrivateCallsPronto: require('./user/privateCallsPronto'),
    registerPaymentHandlers: require('./payments'),
    registerMediaHandlers: require('./media'),
    registerCallManagement: require('./user/callManagement'),
    registerPaymentHistory: require('./user/paymentHistory'),
    // registerCallFeedback removed — placeholder handler was deleted (it only logged a warn and exited)
    registerCallPackages: require('./user/callPackages')
  },

  // Admin handlers
  admin: {
    registerAdminHandlers: require('./admin'),
    registerModelManagement: require('./admin/modelManagement'),
    registerCallManagement: require('./admin/callManagement'),
    registerRoleManagement: require('./admin/roleManagement'),
    registerLiveStreamManagement: require('./admin/liveStreamManagement'),

    registerPaymentAnalytics: require('./admin/paymentAnalytics')
  },

  // Group/Moderation handlers
  group: {
    registerWallOfFame: require('./group/wallOfFame')
  },

  moderation: {
    registerModerationHandlers: require('./moderation'),
    registerModerationAdminHandlers: require('./moderation/adminCommands'),
    registerAccessControlHandlers: require('./moderation/accessControlCommands')
  },

  support: {
    registerSupportRouting: require('./support/supportRouting')
  }
};
