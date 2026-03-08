const https = require('https');
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

function sendMessage(chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + BOT_TOKEN + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        console.log(chatId, parsed.ok ? 'SENT' : 'FAILED: ' + parsed.description);
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const msg = 'Tu Lifetime Pass ha sido restaurado! Disculpa las molestias. Ya tienes acceso PRIME activo.\n\nYour Lifetime Pass has been restored! Sorry for the inconvenience. Your PRIME access is now active.';

  await sendMessage('1946390276', msg); // BenBen785
  await sendMessage('5487462178', msg); // Kevieee513
  await sendMessage('7243392089', msg); // Shawn (no username)
}

main().catch(console.error);
