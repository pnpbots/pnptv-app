import { UserManager, WebStorageStateStore, User } from "oidc-client-ts";

const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";
const CLIENT_ID = import.meta.env.VITE_AUTHENTIK_CLIENT_ID || "pnptv-web";
const APP_URL = import.meta.env.VITE_APP_URL || "https://app.pnptv.app";

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
