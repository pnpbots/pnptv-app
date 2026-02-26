const ioredis = require('ioredis');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function main() {
  const r = new ioredis();
  const keys = await r.keys('sess:*');
  console.log('Total sessions:', keys.length);

  let userId = null;
  let sessionKey = null;

  for (const k of keys.slice(0, 50)) {
    const d = await r.get(k);
    if (d) {
      try {
        const p = JSON.parse(d);
        if (p.user && p.user.id) {
          console.log('Found session:', k.substring(0, 30) + '...');
          console.log('User:', p.user.id, p.user.username || '(no username)');
          console.log('Current photoUrl:', p.user.photoUrl || '(none)');
          userId = p.user.id;
          sessionKey = k;
          break;
        }
      } catch (e) {}
    }
  }

  if (!userId) {
    console.log('No active user session found');
    await r.quit();
    return;
  }

  const sharp = require('sharp');
  const testFile = '/tmp/test-avatar.png';
  const uploadDir = '/opt/pnptvapp/public/uploads/avatars';
  const filename = `${userId}-test-${Date.now()}.webp`;
  const filePath = path.join(uploadDir, filename);
  const relativeUrl = `/uploads/avatars/${filename}`;

  await fs.promises.mkdir(uploadDir, { recursive: true });

  const buffer = await fs.promises.readFile(testFile);
  await sharp(buffer)
    .resize(256, 256, { fit: 'cover', position: 'center' })
    .webp({ quality: 75, progressive: true })
    .toFile(filePath);

  console.log('Sharp processed OK:', filename);

  const stat = await fs.promises.stat(filePath);
  console.log('File size:', stat.size, 'bytes');

  // Test HTTP access
  const url = `http://localhost:3001/uploads/avatars/${filename}`;
  await new Promise((resolve) => {
    http.get(url, (res) => {
      console.log('HTTP access status:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);
      resolve();
    });
  });

  // Update session photoUrl
  const sessionData = await r.get(sessionKey);
  if (sessionData) {
    const parsed = JSON.parse(sessionData);
    parsed.user.photoUrl = relativeUrl;
    await r.set(sessionKey, JSON.stringify(parsed));
    console.log('Session updated with new photoUrl');
  }

  await r.quit();
  console.log('TEST COMPLETE - avatar saved at:', relativeUrl);
}

main().catch(e => console.error('ERROR:', e.message));
