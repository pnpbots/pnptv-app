import React, { useEffect, useState, useCallback } from "react";
import {
  checkCourtesyInvite,
  redeemCourtesyInvite,
  type CourtesyInviteCheckResult,
} from "@/lib/api";

const SESSION_KEY = "pnptv_courtesy_code";

interface Props {
  isLoggedIn: boolean;
  onRedeemed?: () => void;
}

type BannerState = "idle" | "loading" | "ready" | "redeeming" | "success" | "error" | "invalid";

export function CourtesyInviteBanner({ isLoggedIn, onRedeemed }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [meta, setMeta] = useState<CourtesyInviteCheckResult | null>(null);
  const [state, setState] = useState<BannerState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");
  const [dismissed, setDismissed] = useState(false);

  // On mount: read ?courtesy= from URL, persist to sessionStorage, clean URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get("courtesy");

    if (urlCode && /^[0-9a-f]{24}$/.test(urlCode)) {
      sessionStorage.setItem(SESSION_KEY, urlCode);
      // Clean the URL without triggering a navigation
      params.delete("courtesy");
      const newSearch = params.toString();
      const newUrl =
        window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
      setCode(urlCode);
    } else {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored && /^[0-9a-f]{24}$/.test(stored)) {
        setCode(stored);
      }
    }
  }, []);

  // Fetch invite metadata when code is known
  useEffect(() => {
    if (!code) return;
    setState("loading");

    checkCourtesyInvite(code)
      .then((result) => {
        if (result.valid) {
          setMeta(result);
          setState("ready");
        } else {
          setErrorMsg(result.error || "This invite link is not valid.");
          setState("invalid");
          sessionStorage.removeItem(SESSION_KEY);
        }
      })
      .catch(() => {
        setErrorMsg("Could not verify invite link. Please try again.");
        setState("error");
      });
  }, [code]);

  const handleRedeem = useCallback(async () => {
    if (!code || !isLoggedIn) return;
    setState("redeeming");

    try {
      const result = await redeemCourtesyInvite(code);
      if (result.success) {
        sessionStorage.removeItem(SESSION_KEY);
        setSuccessMsg(
          result.message || `You now have ${meta?.grant_days ?? 30} days of PRIME access!`
        );
        setState("success");
        onRedeemed?.();
      } else {
        setErrorMsg(result.error || "Redemption failed. Please try again.");
        setState("error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Redemption failed. Please try again.";
      setErrorMsg(msg);
      setState("error");
    }
  }, [code, isLoggedIn, meta, onRedeemed]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  // Nothing to show
  if (!code || dismissed || state === "idle") return null;
  if (state === "loading") return null; // Silent until we know if invite is valid
  if (state === "invalid") return null; // Invalid invite — no banner spam

  const grantDays = meta?.grant_days ?? 30;
  const creatorName = meta?.creator_name ?? "PNPtv";

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-start justify-center px-4 pt-3 pointer-events-none"
      role="region"
      aria-label="Courtesy invite"
    >
      <div
        className="w-full max-w-md pointer-events-auto rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: "linear-gradient(135deg, #1C1C1E 0%, #2C2C2E 100%)",
          border: "1px solid rgba(255, 180, 84, 0.35)",
        }}
      >
        {/* Amber accent top bar */}
        <div className="h-0.5 w-full" style={{ background: "linear-gradient(90deg, #FFB454, #FF9500)" }} />

        <div className="px-4 py-3 flex items-start gap-3">
          {/* Gift icon */}
          <div
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ background: "rgba(255, 180, 84, 0.15)" }}
            aria-hidden="true"
          >
            🎁
          </div>

          <div className="flex-1 min-w-0">
            {state === "success" ? (
              <>
                <p className="text-white font-semibold text-sm leading-snug">PRIME Activated!</p>
                <p className="text-sm mt-0.5" style={{ color: "#FFB454" }}>
                  {successMsg}
                </p>
              </>
            ) : state === "error" ? (
              <>
                <p className="text-white font-semibold text-sm leading-snug">Invite Error</p>
                <p className="text-sm mt-0.5" style={{ color: "#FF453A" }}>
                  {errorMsg}
                </p>
              </>
            ) : (
              <>
                <p className="text-white font-semibold text-sm leading-snug">
                  {meta?.label ? meta.label : `${creatorName} invited you!`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {isLoggedIn
                    ? `Tap below to activate ${grantDays} days of PRIME`
                    : `Log in to activate ${grantDays} days of PRIME access`}
                </p>

                {isLoggedIn ? (
                  <button
                    onClick={handleRedeem}
                    disabled={state === "redeeming"}
                    className="mt-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-60"
                    style={{
                      background: "linear-gradient(135deg, #FFB454, #FF9500)",
                      color: "#1C1C1E",
                    }}
                  >
                    {state === "redeeming" ? "Activating..." : `Activate ${grantDays} Days of PRIME`}
                  </button>
                ) : (
                  <p className="mt-1.5 text-xs font-medium" style={{ color: "#FFB454" }}>
                    Log in to redeem — the link is saved for after you sign in.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
            aria-label="Dismiss invite banner"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default CourtesyInviteBanner;
