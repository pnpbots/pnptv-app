const DEFAULT_BASE_URL = 'https://pnptv.app/hangouts';

const normalizeBaseUrl = (baseUrl) => {
  if (!baseUrl) return DEFAULT_BASE_URL;
  const trimmed = String(baseUrl).trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `https://pnptv.app${trimmed}`;
  return `https://${trimmed}`;
};

const buildHangoutsWebAppUrl = ({
  baseUrl = process.env.HANGOUTS_WEB_APP_URL || DEFAULT_BASE_URL,
  room,
  token,
  uid,
  username,
  type,
  appId,
  callId,
} = {}) => {
  const safeBase = normalizeBaseUrl(baseUrl || DEFAULT_BASE_URL);
  const url = new URL(safeBase);

  if (room) url.searchParams.set('room', String(room));
  if (token) url.searchParams.set('token', String(token));
  if (uid) url.searchParams.set('uid', String(uid));
  if (username) url.searchParams.set('username', String(username));
  if (type) url.searchParams.set('type', String(type));
  if (appId) url.searchParams.set('appId', String(appId));
  if (callId) url.searchParams.set('callId', String(callId));

  return url.toString();
};

module.exports = {
  buildHangoutsWebAppUrl,
};
