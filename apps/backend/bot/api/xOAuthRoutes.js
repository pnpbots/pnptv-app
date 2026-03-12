const express = require('express');
const { asyncHandler } = require('./middleware/errorHandler');
const xOAuthController = require('./controllers/xOAuthController');

const router = express.Router();

router.get('/start', asyncHandler(xOAuthController.startOAuth));
router.get('/callback', asyncHandler(xOAuthController.handleCallback));
router.get('/1a/start', asyncHandler(xOAuthController.startOAuth1));
router.get('/1a/callback', asyncHandler(xOAuthController.callbackOAuth1));

module.exports = router;
