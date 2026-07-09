import { UserManager, WebStorageStateStore, User } from "oidc-client-ts";

const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";
const CLIENT_ID = import.meta.env.VITE_AUTHENTIK_CLIENT_ID || "pnptv-web";

// Use current origin so SSO works correctly
const APP_URL = typeof window !== "undefined" ? window.location.origin : (import.meta.env.VITE_APP_URL || "https://pnptv.app");

const userManager = new UserManager({
  authority: `${AUTHENTIK_URL}/application/o/pnptv-web/`,
  client_id: CLIENT_ID,
  redirect_uri: `${APP_URL}/auth/callback`,
  post_logout_redirect_uri: APP_URL,
  response_type: "code",
  scope: "openid profile email",
  userStore: new WebStorageStateStore({ store: sessionStorage }),
  automaticSilentRenew: true,
  silent_redirect_uri: `${APP_URL}/auth/silent-renew`,
});

const ALLOWED_RETURN_HOSTS = new Set([
  "pnptv.app",
  "app.pnptv.app",
]);

export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Must start with a single slash — reject protocol-relative URLs (//evil.com)
  if (/^\/(?!\/)/.test(raw)) {
    return raw.startsWith('/') ? raw : null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_RETURN_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const RETURN_TO_KEY = "pnptv:returnTo";

export function rememberReturnTo(url: string | null): void {
  if (typeof window === "undefined") return;
  if (url) sessionStorage.setItem(RETURN_TO_KEY, url);
  else sessionStorage.removeItem(RETURN_TO_KEY);
}

export function consumeReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(RETURN_TO_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  return sanitizeReturnTo(raw);
}

export async function login(): Promise<void> {
  await userManager.signinRedirect();
}

export async function handleCallback(): Promise<User> {
  return userManager.signinRedirectCallback();
}

export async function logout(): Promise<void> {
  await userManager.signoutRedirect();
}

export async function getUser(): Promise<User | null> {
  return userManager.getUser();
}

export async function getAccessToken(): Promise<string | null> {
  const user = await userManager.getUser();
  if (!user || user.expired) return null;
  return user.access_token;
}

export { userManager };
