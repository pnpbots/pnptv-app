import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { User } from "oidc-client-ts";
import { getUser, login as oidcLogin, logout as oidcLogout, getAccessToken, userManager } from "@/lib/auth";
import { isTelegramContext, getTelegramWebApp, waitForTelegramSdk } from "@/lib/telegram";
import { telegramAuth, checkAuthStatus, apiLogout, type TelegramAuthResponse } from "@/lib/api";
import { disconnectSocket } from "@/lib/socket";
import React from "react";

type AuthMode = "telegram" | "oidc" | null;

interface PnptvUser {
  id: number | string;
  dbId?: string;
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
  mode: AuthMode;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function mapTelegramUser(u: NonNullable<TelegramAuthResponse["user"]>): PnptvUser {
  return {
    id: u.pnptv_id || u.id || u.telegram_id,
    dbId: u.id,
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

function mapOidcUser(u: User): PnptvUser {
  return {
    id: u.profile.sub,
    username: u.profile.preferred_username,
    firstName: u.profile.given_name || u.profile.name || "",
    displayName: u.profile.name || u.profile.preferred_username || "",
    language: "en",
    termsAccepted: true,
    ageVerified: false,
    subscriptionType: "free",
    tier: "free",
    role: (u.profile as Record<string, unknown>).role as string || "user",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PnptvUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<AuthMode>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await waitForTelegramSdk();
        if (isTelegramContext()) {
          // Telegram Mini App: authenticate via bot API
          setMode("telegram");
          const webapp = getTelegramWebApp();
          if (webapp?.initData) {
            const res = await telegramAuth(webapp.initData);
            if (res.success && res.user) {
              setUser(mapTelegramUser(res.user));
            }
          }
        } else {
          // Web browser: check for existing session first, then OIDC
          setMode("oidc");

          // Check if we have a bot API session (from previous Telegram auth)
          try {
            const status = await checkAuthStatus();
            if (status.authenticated && status.user) {
              setUser(mapTelegramUser(status.user));
              setMode("telegram");
              return;
            }
          } catch {
            // No bot session, try OIDC
          }

          // Try OIDC
          const oidcUser = await getUser();
          if (oidcUser && !oidcUser.expired) {
            // Set initial state from OIDC token, then enrich with real tier/role from DB.
            // Note: isLoading remains true during checkAuthStatus(), so TierGate will not
            // render until we have the real tier — the OIDC defaults are never surfaced.
            setUser(mapOidcUser(oidcUser));
            try {
              const status = await checkAuthStatus();
              if (status.authenticated && status.user) {
                setUser(mapTelegramUser(status.user));
                setMode("telegram");
              }
            } catch (err) {
              // Backend session not yet established — tier defaults to 'free' from OIDC token.
              // This is expected on first OIDC login before the backend session is created.
              console.warn("[useAuth] checkAuthStatus failed after OIDC login — tier may be stale:", err);
            }
          }
        }
      } catch {
        // Auth init failed silently
      } finally {
        setIsLoading(false);
      }
    };

    init();

    // Listen for OIDC user changes (e.g. silent token renewal)
    const handleUserLoaded = (u: User) => {
      if (mode === "oidc") {
        // Apply OIDC defaults first, then enrich with DB tier/role
        setUser(mapOidcUser(u));
        checkAuthStatus()
          .then((status) => {
            if (status.authenticated && status.user) {
              setUser(mapTelegramUser(status.user));
            }
          })
          .catch(() => {
            // Backend session unavailable — keep OIDC defaults
          });
      }
    };
    const handleUserUnloaded = () => {
      if (mode === "oidc") setUser(null);
    };

    userManager.events.addUserLoaded(handleUserLoaded);
    userManager.events.addUserUnloaded(handleUserUnloaded);

    return () => {
      userManager.events.removeUserLoaded(handleUserLoaded);
      userManager.events.removeUserUnloaded(handleUserUnloaded);
    };
  }, []);

  const handleLogin = useCallback(async () => {
    if (isTelegramContext()) {
      // Re-auth via Telegram
      const webapp = getTelegramWebApp();
      if (webapp?.initData) {
        const res = await telegramAuth(webapp.initData);
        if (res.success && res.user) {
          setUser(mapTelegramUser(res.user));
          setMode("telegram");
        }
      }
    } else {
      await oidcLogin();
    }
  }, []);

  const handleLogout = useCallback(async () => {
    disconnectSocket();
    if (mode === "telegram") {
      await apiLogout();
    } else {
      await oidcLogout();
    }
    setUser(null);
  }, [mode]);

  const getToken = useCallback(async () => {
    if (mode === "telegram") {
      // Telegram uses session cookies, no separate token needed
      return null;
    }
    return getAccessToken();
  }, [mode]);

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
    mode,
    login: handleLogin,
    logout: handleLogout,
    getToken,
    refreshUser,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
