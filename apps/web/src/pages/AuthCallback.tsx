import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleCallback, consumeReturnTo } from "@/lib/auth";
import { redeemReferralCode } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";

const API_BASE = window.location.origin;
const AUTH_STRINGS = {
  en: { error: "Authentication failed. Please try again.", title: "Authentication Error", returnHome: "Return Home" },
  es: { error: "Error de autenticación. Por favor intenta de nuevo.", title: "Error de autenticación", returnHome: "Volver al inicio" },
};

export default function AuthCallback() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const i18n = useI18n();
  const s = AUTH_STRINGS[i18n.lang === "es" ? "es" : "en"];
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
          redeemReferralCode(refCode).then(
            (result) => console.info("[referral] redeemed on auth callback", { code: refCode, result }),
            (err) => console.error("[referral] redemption failed on auth callback", { code: refCode, error: err?.message || err })
          );
        }

        // Prefer an explicit returnTo (e.g. user came from studio.pnptv.app)
        const returnTo = consumeReturnTo();
        if (returnTo) {
          window.location.replace(returnTo);
          return;
        }

        // If the user came from the admin panel, redirect back there
        const adminRedirect = localStorage.getItem("pnptv:adminRedirect");
        if (adminRedirect) {
          localStorage.removeItem("pnptv:adminRedirect");
          navigate("/admin", { replace: true });
        } else {
          navigate("/media", { replace: true });
        }
      })
      .catch((err) => {
        console.error("[AuthCallback] OIDC callback error:", err);
        setError(err?.message || s.error);
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
          <h2 className="text-lg font-semibold text-pnp-textPrimary mb-2">{s.title}</h2>
          <p className="text-sm text-pnp-textSecondary mb-4">{error}</p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="text-pnp-accent hover:underline text-sm"
          >
            {s.returnHome}
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
