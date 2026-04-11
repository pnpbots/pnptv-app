// DEPRECATED: JaaS/Jitsi replaced by LiveKit. All methods are no-ops. Do not re-enable without security review.
const logger = require('../../utils/logger');

logger.info('jaasService: DEPRECATED — all methods are no-ops (LiveKit is the active video provider)');

module.exports = {
  isConfigured: () => false,
  generateToken: () => null,
  generateViewerToken: () => null,
  generateModeratorToken: () => null,
  generateViewerConfig: () => null,
  generateModeratorConfig: () => null,
  generateMeetingUrl: () => null,
  generatePNPLiveRoom: () => null,
  generatePNPLiveModelToken: () => null,
  generatePNPLiveClientToken: () => null,
};
