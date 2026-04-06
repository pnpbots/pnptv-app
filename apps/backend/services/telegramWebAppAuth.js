const crypto = require('crypto');

function timingSafeEqualHex(a, b) {
  try {
    const ab = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function parseInitData(initData) {
  const params = new URLSearchParams(String(initData || ''));
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function buildDataCheckString(data) {
  const keys = Object.keys(data).filter((k) => k !== 'hash').sort();
  return keys.map((k) => `${k}=${data[k]}`).join('\n');
}

function computeHash(dataCheckString, botToken) {
  // Telegram WebApp auth:
  // secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
  // hash = HMAC_SHA256(key=secret_key, msg=data_check_string) as hex
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(String(botToken || ''))
    .digest();

  return crypto
    .createHmac('sha256', secretKey)
    .update(String(dataCheckString || ''))
    .digest('hex');
}

function normalizeTelegramDisplayName(user) {
  if (!user) return null;
  if (user.username) return `@${String(user.username).replace(/^@+/, '')}`;
  return String(user.first_name || user.last_name || '').trim() || null;
}

function validateTelegramWebAppInitData(initData, { botToken, maxAgeSeconds = 86400 } = {}) {
  if (!initData) return { ok: false, reason: 'missing_init_data' };
  if (!botToken) return { ok: false, reason: 'missing_bot_token' };

  const data = parseInitData(initData);
  const providedHash = data.hash;
  if (!providedHash) return { ok: false, reason: 'missing_hash' };

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'invalid_auth_date' };
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > maxAgeSeconds) return { ok: false, reason: 'auth_date_expired' };

  const dataCheckString = buildDataCheckString(data);
  const expectedHash = computeHash(dataCheckString, botToken);
  if (!timingSafeEqualHex(providedHash, expectedHash)) return { ok: false, reason: 'bad_hash' };

  let user = null;
  if (data.user) {
    try {
      user = JSON.parse(data.user);
    } catch {
      return { ok: false, reason: 'invalid_user_json' };
    }
  }

  const userId = user?.id;
  if (!userId) return { ok: false, reason: 'missing_user_id' };

  return {
    ok: true,
    user: {
      id: userId,
      username: user?.username || null,
      firstName: user?.first_name || null,
      displayName: normalizeTelegramDisplayName(user),
    },
  };
}

module.exports = {
  validateTelegramWebAppInitData,
};

