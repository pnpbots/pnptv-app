import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { isTelegramContext, getTelegramWebApp, waitForTelegramSdk } from "@/lib/telegram";
import { telegramAuth, checkAuthStatus, apiLogout, oidcLogout, ApiError, NetworkError, type TelegramAuthResponse } from "@/lib/api";
import { disconnectSocket } from "@/lib/socket";
import React from "react";

interface PnptvUser {
  id: string; // Authentik UUID (pnptv_id)
  dbId: string; // Database row ID (telegram ID or legacy ID)
  telegramId: string | number;
  username?: string;
  firstName: string;
  lastName?: string;
  displayName: string;
  language: string;
  photoUrl?: string;
  termsAccepted: boolean;
  ageVerified: boolean;
  subscriptionType: string;
  tier: string;
  role: string;
  creator_status?: string;
  creator_type?: string | null;
  contentDisclaimer?: boolean;
  hasSeenTutorial?: boolean;
  lastLoginMethod?: string | null;
  city?: string | null;
  country?: string | null;
}

interface AuthState {
  user: PnptvUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isCreatorAdmin: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function mapTelegramUser(u: NonNullable<TelegramAuthResponse["user"]>): PnptvUser {
  // DB id is always the numeric row ID (telegram ID or legacy ID)
  // pnptv_id / pnptvId is the Authentik UUID
  const rawId = String(u.id || u.telegram_id);
  const uuid = String(u.pnptv_id || rawId);
  return {
    id: uuid,
    dbId: rawId,
    telegramId: u.telegram_id || Number(u.id) || 0,
    username: u.username,
    firstName: u.first_name,
    displayName: u.display_name || u.first_name || u.username || "Member",
    language: u.language,
    termsAccepted: u.terms_accepted,
    ageVerified: u.age_verified,
    photoUrl: u.photo_url || undefined,
    subscriptionType: u.subscription_type,
    tier: u.tier || "free",
    role: u.role || "user",
    creator_status: u.creator_status,
    creator_type: u.creator_type,
    contentDisclaimer: u.contentDisclaimer || false,
    hasSeenTutorial: u.hasSeenTutorial || false,
    lastLoginMethod: u.last_login_method ?? null,
    city: u.city ?? null,
    country: u.country ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PnptvUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        await waitForTelegramSdk();

        const webapp = isTelegramContext() ? getTelegramWebApp() : null;
        if (webapp?.initData) {
          const res = await telegramAuth(webapp.initData);
          if (res.success && res.user) {
            setUser(mapTelegramUser(res.user));
          }
        } else {
          // Detect post-OIDC landing: backend redirects here with ?oidc_linked=1
          // after establishing the server-side session. Clean the URL immediately
          // so the param doesn't persist in browser history.
          const searchParams = new URLSearchParams(window.location.search);
          const isOidcReturn = searchParams.has("oidc_linked");
          const oidcError = searchParams.get("oidc_error");
          if (isOidcReturn || oidcError) {
            const cleanUrl = window.location.pathname +
              (searchParams.toString().replace(/oidc_linked=1?&?|oidc_error=[^&]*&?/g, "").replace(/&$|\?$/, "") || "");
            window.history.replaceState(null, "", cleanUrl);
          }

          // Browser or Telegram without initData: check existing session.
          // After OIDC return, retry more aggressively — the session cookie
          // from the 302 redirect may take one extra round-trip to be sent.
          const SESSION_RETRIES = isOidcReturn ? 4 : 2;
          const SESSION_RETRY_DELAY = isOidcReturn ? 500 : 1000;
          let lastErr: unknown;
          for (let attempt = 0; attempt <= SESSION_RETRIES; attempt++) {
            try {
              const status = await checkAuthStatus();
              if (status.authenticated && status.user) {
                setUser(mapTelegramUser(status.user));
              }
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              // Don't retry on explicit 401 — the session is genuinely gone
              if (err instanceof ApiError && err.status === 401) break;
              if (attempt < SESSION_RETRIES) {
                await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAY));
              }
            }
          }
          if (lastErr) {
            console.warn("[AuthProvider] Session check failed after retries:", lastErr);
          }
        }
      } catch (err) {
        console.error("[AuthProvider] Initialization failed:", err);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, []);

  const handleLogin = useCallback(async () => {
    const webapp = getTelegramWebApp();
    if (webapp?.initData) {
      const res = await telegramAuth(webapp.initData);
      if (res.success && res.user) {
        setUser(mapTelegramUser(res.user));
      }
    } else {
      // Browser context without Telegram initData — redirect to Authentik OIDC
      const { login: oidcLogin } = await import("@/lib/auth");
      await oidcLogin();
    }
  }, []);

  const handleLogout = useCallback(async () => {
    disconnectSocket();
    // Revoke OIDC session on the backend before clearing local state
    if (user?.lastLoginMethod === "oidc") {
      await oidcLogout().catch(() => {});
    }
    await apiLogout();
    setUser(null);
  }, [user]);

  const refreshUser = useCallback(async () => {
    try {
      const status = await checkAuthStatus();
      if (status.authenticated && status.user) {
        setUser(mapTelegramUser(status.user));
      }
    } catch {
      // Silently fail refresh
    }
  }, []);

  const isAdmin = !!user && (user.role === "admin" || user.role === "superadmin" || user.role === "creator");
  const isCreatorAdmin = !!user && user.role === "creator";

  const value: AuthState = {
    user,
    isAuthenticated: !!user,
    isAdmin,
    isCreatorAdmin,
    isLoading,
    login: handleLogin,
    logout: handleLogout,
    refreshUser,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
