'use strict';

/**
 * hangoutVideoCallRoutes.js
 *
 * Express router for JaaS-backed video calls within hangout groups.
 * Mounted at /api/webapp/hangouts/groups in routes.js.
 *
 * Routes:
 *   POST /:id/calls              -- start or join existing call
 *   GET  /:id/calls/active       -- get the active call + participants
 *   POST /:id/calls/:callId/join -- join a specific call (get fresh JWT)
 *   POST /:id/calls/:callId/end  -- end a call (creator / group owner)
 *   POST /:id/calls/:callId/leave -- leave without ending
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/hangoutVideoCallController');

const router = Router();

router.post('/:id/calls', asyncHandler(controller.startCall));
router.get('/:id/calls/active', asyncHandler(controller.getActiveCall));
router.post('/:id/calls/:callId/join', asyncHandler(controller.joinCall));
router.post('/:id/calls/:callId/end', asyncHandler(controller.endCall));
router.post('/:id/calls/:callId/leave', asyncHandler(controller.leaveCall));

module.exports = router;
