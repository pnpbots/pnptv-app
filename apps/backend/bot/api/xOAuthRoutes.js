const express = require('express');
const { asyncHandler } = require('./middleware/errorHandler');
const xOAuthController = require('./controllers/xOAuthController');

const router = express.Router();

router.get('/start', asyncHandler(xOAuthController.startOAuth));
router.get('/callback', asyncHandler(xOAuthController.handleCallback));

module.exports = router;
