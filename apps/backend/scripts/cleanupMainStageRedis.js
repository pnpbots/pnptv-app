'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { createClient } = require('redis');

const KEYS = ['mainstage:mode', 'mainstage:master', 'mainstage:knock-queue'];

async function main() {
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  client.on('error', (err) => {
    console.error('Redis error:', err.message);
    process.exit(1);
  });

  await client.connect();

  let deleted = 0;
  for (const key of KEYS) {
    const result = await client.del(key);
    if (result > 0) {
      console.log(`Deleted: ${key}`);
      deleted++;
    } else {
      console.log(`Not found (already gone): ${key}`);
    }
  }

  await client.quit();
  console.log(`\nDone. ${deleted}/${KEYS.length} keys deleted.`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
