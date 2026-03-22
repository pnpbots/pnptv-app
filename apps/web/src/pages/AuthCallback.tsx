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
    handleCallback()
      .then(async (oidcUser) => {
        const token = oidcUser?.access_token;
        if (token) {
          try {
            const res = await fetch(
              `${API_BASE}/api/webapp/auth/oidc/token-exchange`,
              {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ access_token: token }),
              }
            );
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.authenticated) {
              localStorage.setItem("pnptv_last_auth", "pnptv_id");
              if (data.user?.username) {
                localStorage.setItem("pnptv_last_username", data.user.username);
              }
              await refreshUser();
            } else {
              console.warn("[AuthCallback] Token exchange rejected:", res.status, data);
            }
          } catch (err) {
            console.warn("[AuthCallback] Token exchange failed:", err);
          }
        }

        const refCode = localStorage.getItem("pnptv:pendingRef");
        if (refCode) {
          localStorage.removeItem("pnptv:pendingRef");
          redeemReferralCode(refCode).catch(() => {});
        }

        navigate("/", { replace: true });
      })
      .catch((err) => {
        console.error("[AuthCallback] OIDC callback error:", err);
        setError(err?.message || "Authentication failed. Please try again.");
      });
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
