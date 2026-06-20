'use strict';

require('dotenv').config();
const NotificationService = require('../services/notificationService');

const USER_IDS = [
  '8192241178',
  '721644409',
  '5867063315',
  '8269683341',
  '1071160931',
  '7246621722',
  '7166356500',
  '4672ba67-498b-49b7-b9e3-be08c4053691',
  '8039520242',
  '8b9b073f-b65c-49a5-8bc7-14d3956b120f',
  '5935084902',
  'f562df56-91ff-4c79-876c-2f3e15f9146e',
  '5643392748',
  '8599671840',
  '7489239467',
  '832f35b0-47b7-4d2d-aa29-5d67c94faede',
];

const MESSAGE =
  'New creator guidelines are live! Your membership fee is paused — upload your exclusive content first, then turn it on from Settings. Read the full guide in your Creator Dashboard.';

(async () => {
  const result = await NotificationService.broadcastNotification(USER_IDS, MESSAGE, {
    url: '/creators/overview',
  });
  console.log(`Done — success: ${result.success}, failed: ${result.failed}`);
  process.exit(0);
})();
