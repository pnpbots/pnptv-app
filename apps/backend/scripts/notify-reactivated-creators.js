'use strict';

require('dotenv').config();
const NotificationService = require('../services/notificationService');

const USER_IDS = [
  '8192241178',
  '5643392748',
  '4672ba67-498b-49b7-b9e3-be08c4053691',
  '7166356500',
  '5935084902',
  '8269683341',
  'f562df56-91ff-4c79-876c-2f3e15f9146e',
  '8039520242',
  '1071160931',
  '7489239467',
];

const MESSAGE = 'Your creator account has been reactivated. Welcome back to PNPtv! 🎉';

(async () => {
  const result = await NotificationService.broadcastNotification(USER_IDS, MESSAGE, {
    url: '/profile',
  });
  console.log(`Done — success: ${result.success}, failed: ${result.failed}`);
  process.exit(0);
})();
