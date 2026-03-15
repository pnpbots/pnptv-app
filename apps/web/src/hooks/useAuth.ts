import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { isTelegramContext, getTelegramWebApp, waitForTelegramSdk } from "@/lib/telegram";
import { telegramAuth, checkAuthStatus, apiLogout, ApiError, NetworkError, type TelegramAuthResponse } from "@/lib/api";
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
  lastLoginMethod?: string | null;
  city?: string | null;
  country?: string | null;
}

interface AuthState {
  user: PnptvUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
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
  const uuid = String(u.pnptv_id || u.pnptvId || rawId);
  return {
    id: uuid,
    dbId: rawId,
    telegramId: u.telegram_id || u.id,
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
          // Browser or Telegram without initData: check existing session
          // Retry up to 2 extra times on transient failures to avoid flashing
          // the landing page when the session is actually valid
          const SESSION_RETRIES = 2;
          const SESSION_RETRY_DELAY = 1000;
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
    }
  }, []);

  const handleLogout = useCallback(async () => {
    disconnectSocket();
    await apiLogout();
    setUser(null);
  }, []);

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

  const isAdmin = !!user && (user.role === "admin" || user.role === "superadmin");

  const value: AuthState = {
    user,
    isAuthenticated: !!user,
    isAdmin,
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
