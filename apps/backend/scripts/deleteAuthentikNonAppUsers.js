const fs = require('fs');
const axios = require('axios');
const { Pool } = require('pg');

const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'http://authentik-server:9000';
const AUTHENTIK_TOKEN = process.env.AUTHENTIK_API_TOKEN;

if (!AUTHENTIK_TOKEN) {
  throw new Error('AUTHENTIK_API_TOKEN missing');
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'pg-pnptv',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DATABASE || 'pnptvbot',
  user: process.env.POSTGRES_USER || 'pnptvbot',
  password: process.env.POSTGRES_PASSWORD || '',
  max: 4,
});

async function fetchAllAuthentikUsers() {
  const users = [];
  let page = 1;

  for (;;) {
    const res = await axios.get(`${AUTHENTIK_URL}/api/v3/core/users/`, {
      params: { page_size: 200, page },
      headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
      timeout: 30000,
    });

    const results = res.data?.results || [];
    users.push(...results);

    const next = res.data?.pagination?.next || 0;
    if (!next) break;
    page = next;
  }

  return users;
}

async function main() {
  const appRes = await pool.query(
    `SELECT pnptv_id
       FROM users
      WHERE pnptv_id IS NOT NULL
        AND pnptv_id <> ''`
  );
  const appIds = new Set(appRes.rows.map((row) => String(row.pnptv_id)));
  const authentikUsers = await fetchAllAuthentikUsers();
  const orphanUsers = authentikUsers.filter((user) => !appIds.has(String(user.uuid)));

  const backup = {
    generatedAt: new Date().toISOString(),
    appLinkedPnptvIds: appIds.size,
    authentikUsers: authentikUsers.length,
    orphanUsers: orphanUsers.length,
    users: orphanUsers,
  };
  fs.writeFileSync('/tmp/authentik_non_app_users_backup.json', JSON.stringify(backup, null, 2));
  console.log(JSON.stringify({
    phase: 'prepared',
    appLinkedPnptvIds: appIds.size,
    authentikUsers: authentikUsers.length,
    orphanUsers: orphanUsers.length,
  }, null, 2));

  let deleted = 0;
  let failed = 0;
  const failures = [];
  const workers = 6;
  let index = 0;

  async function worker() {
    while (index < orphanUsers.length) {
      const current = orphanUsers[index++];
      try {
        await axios.delete(`${AUTHENTIK_URL}/api/v3/core/users/${current.pk}/`, {
          headers: { Authorization: `Bearer ${AUTHENTIK_TOKEN}` },
          timeout: 30000,
        });
        deleted += 1;
        if (deleted % 100 === 0) {
          console.log(JSON.stringify({
            phase: 'deleting',
            deleted,
            remaining: orphanUsers.length - deleted - failed,
          }, null, 2));
        }
      } catch (error) {
        failed += 1;
        failures.push({
          pk: current.pk,
          uuid: current.uuid,
          username: current.username,
          email: current.email,
          status: error.response?.status || null,
          error: error.response?.data || error.message,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  fs.writeFileSync('/tmp/authentik_non_app_users_delete_failures.json', JSON.stringify(failures, null, 2));
  console.log(JSON.stringify({ phase: 'done', deleted, failed }, null, 2));

  await pool.end();
  if (failed > 0) process.exitCode = 2;
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
