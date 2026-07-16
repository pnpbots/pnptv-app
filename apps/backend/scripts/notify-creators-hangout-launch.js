'use strict';

require('dotenv').config();
const NotificationService = require('../services/notificationService');

// Active creators, eligible creators, and creator candidates (pending_review)
// Split by language preference so each gets the message in their language.

const ES_IDS = [
  '1002190052',
  '229547af-11da-4743-8ad7-6fdc56b22f5f',
  '7246621722',
  '7454293437',
  '7894585080',
  '8038373618',
  '8599671840',
  '8668655116',
  'a6a0c712-8df3-4864-9cb8-21fc417c7743',
  '5917729629',
  '7122345447',
  '8296896065',
  'fe20b76b-6451-49ec-84c8-1e4bffab96eb',
  '5994313923',
  'd6d34495-925a-4859-8ce9-bd2a837a7712',
];

const EN_IDS = [
  '0521b08f-63e4-4783-ab38-508d457cba47',
  '1215151270',
  '1966945732',
  '50da5ca8-08fa-4a71-a6f0-cab5331391eb',
  '5374511130',
  '5598791888',
  '5643392748',
  '5951629484',
  '5bf9d0c0-497c-45d2-8bc1-d9aef2868a85',
  '6044736811',
  '6341493008',
  '6385726840',
  '6733801448',
  '6762852968',
  '7166356500',
  '7205636669',
  '7250101394',
  '7514983625',
  '7581552455',
  '7879412085',
  '7926587506',
  '7ea341de-3d00-496e-b97a-4260c2130320',
  '8041255631',
  '8192241178',
  '8312901004',
  '8436373325',
  '8553652686',
  '8666563080',
  '8874289080',
  'a3b3c9a2-0cdc-445c-bab7-ddf0a609c7d2',
  'e0da5844-ce6a-4976-a14a-b5c9d0b643ed',
  'eba04639-e25b-4d32-abcf-c51f31aaeb4e',
  'fd25374a-1753-463d-b2f8-b51e1574a8d7',
  '15b6d61e-e6cf-46d5-9152-628fa0b30e89',
  '2016884721',
  '3abe90fc-ec39-4e96-9553-996eb220bd86',
  '3b461fdc-5311-4c94-9ec2-fe9983ff0bcf',
  '4aa85f41-2ce3-4382-a010-f2b11dac6f58',
  '6775323898',
  '4232de8f-3816-49a4-abbf-7361b7757d9a',
  '5335510713',
  '5626179706',
  '8418763546',
  '8478417366',
  '8721021455',
  'c1ba593a-c2bc-457e-86c8-f53fb328207a',
  'ecd72517-f71d-4c42-8852-e0b069d3a425',
  'f562df56-91ff-4c79-876c-2f3e15f9146e',
];

const URL = '/chat/118';

(async () => {
  console.log(`Sending to ${EN_IDS.length} EN creators…`);
  const enResult = await NotificationService.broadcastNotification(
    EN_IDS,
    'Your Creators Hangout is live 🎬 Connect with fellow creators, share tips & coordinate. Drop in →',
    { url: URL }
  );
  console.log(`EN — success: ${enResult.success}, failed: ${enResult.failed}`);

  console.log(`Sending to ${ES_IDS.length} ES creators…`);
  const esResult = await NotificationService.broadcastNotification(
    ES_IDS,
    'Tu Hangout de Creadores ya está activo 🎬 Conéctate con otros creadores, comparte tips y coordina. Entra →',
    { url: URL }
  );
  console.log(`ES — success: ${esResult.success}, failed: ${esResult.failed}`);

  const total = enResult.success + esResult.success;
  const failed = enResult.failed + esResult.failed;
  console.log(`\nTotal — sent: ${total}/${EN_IDS.length + ES_IDS.length}, failed: ${failed}`);
  process.exit(0);
})();
