import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleCallback } from "@/lib/auth";
import { redeemReferralCode } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const API_BASE = window.location.origin;

export default function AuthCallback() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const exchangeToken = async (accessToken: string) => {
      const res = await fetch(
        `${API_BASE}/api/webapp/auth/oidc/token-exchange`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: accessToken }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.authenticated) {
        localStorage.setItem("pnptv_last_auth", "pnptv_id");
        if (data.user?.username) {
          localStorage.setItem("pnptv_last_username", data.user.username);
        }
        await refreshUser();
        return true;
      }
      console.warn("[AuthCallback] Token exchange rejected:", res.status, data);
      return false;
    };

    const exchangeCode = async (code: string) => {
      // Exchange authorization code for token via Authentik token endpoint
      const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";
      const CLIENT_ID = import.meta.env.VITE_AUTHENTIK_CLIENT_ID || "pnptv-web";
      const tokenRes = await fetch(`${AUTHENTIK_URL}/application/o/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${window.location.origin}/auth/callback`,
          client_id: CLIENT_ID,
        }),
      });
      if (!tokenRes.ok) throw new Error(`Token endpoint returned ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        return exchangeToken(tokenData.access_token);
      }
      return false;
    };

    const run = async () => {
      try {
        // Try oidc-client-ts callback first (handles PKCE state)
        const oidcUser = await handleCallback();
        if (oidcUser?.access_token) {
          await exchangeToken(oidcUser.access_token);
        }
      } catch (oidcErr) {
        console.warn("[AuthCallback] oidc-client-ts callback failed, trying code exchange:", oidcErr);
        // Fallback: extract code from URL and exchange directly
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (code) {
          try {
            await exchangeCode(code);
          } catch (codeErr) {
            console.error("[AuthCallback] Code exchange also failed:", codeErr);
            setError("Authentication failed. Please try again.");
            return;
          }
        } else {
          setError("No authorization code received.");
          return;
        }
      }

      // Redeem referral code if one was stored before login
      const refCode = localStorage.getItem("pnptv:pendingRef");
      if (refCode) {
        localStorage.removeItem("pnptv:pendingRef");
        redeemReferralCode(refCode).catch(() => {});
      }

      navigate("/", { replace: true });
    };

    run();
  }, [navigate, refreshUser]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background p-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-pnp-error/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-pnp-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-pnp-textPrimary mb-2">Authentication Error</h2>
          <p className="text-sm text-pnp-textSecondary mb-4">{error}</p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="text-pnp-accent hover:underline text-sm"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-pnp-background">
      <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
