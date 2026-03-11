require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const crypto = require('crypto');
const { query, closePool } = require('../apps/backend/config/postgres');

const APP_URL = process.env.APP_PUBLIC_URL || 'https://app.pnptv.app';

async function generateCourtesyLink() {
  try {
    // 1. Find an admin user
    const { rows: users } = await query(
      "SELECT pnptv_id FROM users WHERE role = 'admin' OR role = 'superadmin' LIMIT 1"
    );

    let adminPnptvId;
    if (users.length > 0 && users[0].pnptv_id) {
      adminPnptvId = users[0].pnptv_id;
    } else {
      console.error(
        "No admin user with a pnptv_id found. Please provide a user with admin privileges and a valid pnptv_id."
      );
      return;
    }
    
    // 2. Generate a random code
    const code = crypto.randomBytes(12).toString('hex'); // 24-char hex

    // 3. Insert into courtesy_invites table
    const { rows } = await query(
      `INSERT INTO courtesy_invites
         (code, created_by, label, max_uses, grant_days)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [code, adminPnptvId, 'PRIME Monthly Pass Courtesy Link', 20, 30]
    );

    const invite = rows[0];
    const inviteUrl = `${APP_URL}/?courtesy=${code}`;

    console.log('Courtesy invite created successfully!');
    console.log('Invite URL:', inviteUrl);
    console.log('Details:', invite);

  } catch (error) {
    console.error('Error generating courtesy link:', error);
  } finally {
    await closePool();
  }
}

generateCourtesyLink();
