import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getTokenCheckoutData } from "@/lib/api";

type CheckoutState = "loading" | "pending" | "success" | "error";

const BG_STYLES: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--pnp-background, #121212)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  fontFamily: "'Roboto Mono', monospace",
  color: "#fff",
};

const ORB_BASE: React.CSSProperties = {
  position: "fixed",
  width: 500,
  height: 500,
  borderRadius: "50%",
  opacity: 0.2,
  filter: "blur(80px)",
  pointerEvents: "none",
};

const CARD_STYLES: React.CSSProperties = {
  background: "rgba(30,30,30,0.7)",
  border: "1px solid rgba(212,0,122,0.3)",
  borderRadius: 24,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  width: "100%",
  maxWidth: 520,
  padding: 32,
  position: "relative",
  zIndex: 10,
};

const SPINNER_STYLE: React.CSSProperties = {
  width: 40,
  height: 40,
  border: "3px solid rgba(212,0,122,0.3)",
  borderTopColor: "#D4007A",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
  margin: "0 auto 16px",
};

const GRADIENT_TEXT: React.CSSProperties = {
  background: "linear-gradient(135deg, #D4007A, #E69138)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

const SUCCESS_CIRCLE: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: "50%",
  background: "linear-gradient(135deg, #30D158, #34C759)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto 16px",
};

const ERROR_CIRCLE: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: "50%",
  background: "rgba(255,69,58,0.15)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto 16px",
  color: "#FF453A",
};

const PAY_BTN: React.CSSProperties = {
  width: "100%",
  padding: "16px 24px",
  borderRadius: 12,
  border: "none",
  background: "linear-gradient(135deg, #D4007A, #E69138)",
  color: "#fff",
  fontWeight: 700,
  fontSize: 16,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  fontFamily: "'Roboto Mono', monospace",
};

const SECONDARY_BTN: React.CSSProperties = {
  width: "100%",
  padding: "14px 24px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "'Roboto Mono', monospace",
};

// ── Main page ─────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

export default function TokenCheckout() {
  const { purchaseId } = useParams<{ purchaseId: string }>();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<CheckoutState>("loading");
  const [error, setError] = useState("");
  const [pollElapsed, setPollElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      const elapsed = Date.now() - started;
      setPollElapsed(elapsed);
      if (elapsed >= POLL_TIMEOUT_MS) {
        stopPolling();
        return; // stay in "pending" — user can close
      }
      try {
        const res = await getTokenCheckoutData(id);
        if (res.status === "paid" || res.status === "completed") {
          stopPolling();
          setState("success");
        } else if (res.status === "expired" || res.status === "cancelled" || res.status === "invalid") {
          stopPolling();
          setError(
            res.status === "expired"
              ? "This payment link has expired. Please start a new purchase from the app."
              : "This payment was not completed. Please try again with a new payment link."
          );
          setState("error");
        }
      } catch {
        // non-fatal — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    if (!purchaseId) {
      setError("No purchase ID found. Please generate a new payment link from the app.");
      setState("error");
      return;
    }

    // Stripe redirect — user paid and Stripe sent them back with ?stripe=success
    if (searchParams.get("stripe") === "success") {
      setState("pending");
      startPolling(purchaseId);
      return;
    }

    getTokenCheckoutData(purchaseId)
      .then((res) => {
        if (!res.success) {
          setError((res as { error?: string }).error || "Purchase not found or already completed.");
          setState("error");
          return;
        }
        if (res.status === "completed" || res.status === "paid") {
          setState("success");
          return;
        }
        if (res.status === "expired" || res.status === "cancelled" || res.status === "invalid") {
          setError(
            res.status === "expired"
              ? "This payment link has expired. Please start a new purchase from the app."
              : "This payment was not completed. Please start a new purchase from the app."
          );
          setState("error");
          return;
        }
        if ((res.provider as string) !== "stripe") {
          setError("This payment method is no longer available. Please start a new purchase from your wallet.");
          setState("error");
          return;
        }
        // Stripe purchase still pending — poll until the webhook fires
        setState("pending");
        startPolling(purchaseId);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Could not load checkout details.";
        setError(msg);
        setState("error");
      });
  }, [purchaseId, searchParams, startPolling]);


  return (
    <div style={BG_STYLES}>
      {/* Decorative background orbs */}
      <div
        style={{
          ...ORB_BASE,
          top: "-20%",
          left: "-10%",
          background: "radial-gradient(circle, #D4007A, transparent 70%)",
        }}
      />
      <div
        style={{
          ...ORB_BASE,
          bottom: "-20%",
          right: "-10%",
          background: "radial-gradient(circle, #E69138, transparent 70%)",
        }}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={CARD_STYLES}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src="/Logo2-50.png"
            alt="PNPtv!"
            style={{ height: 48, width: "auto" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              marginTop: 4,
              ...GRADIENT_TEXT,
            }}
          >
            PNPtv!
          </div>
        </div>

        {/* Loading */}
        {state === "loading" && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={SPINNER_STYLE} />
            <p style={{ color: "var(--pnp-text-secondary, #8E8E93)", fontSize: 14 }}>
              Loading payment details…
            </p>
          </div>
        )}

        {/* Pending — waiting for webhook confirmation */}
        {state === "pending" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={SPINNER_STYLE} />
            <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {pollElapsed >= POLL_TIMEOUT_MS ? "Payment Submitted" : "Verifying Payment…"}
            </p>
            {pollElapsed < POLL_TIMEOUT_MS ? (
              <p style={{ fontSize: 13, color: "var(--pnp-text-secondary, #8E8E93)", marginBottom: 20 }}>
                Your payment was submitted. We&rsquo;re waiting for confirmation from the payment processor.
                This usually takes a few seconds.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: "var(--pnp-text-secondary, #8E8E93)", marginBottom: 20 }}>
                Payment confirmation is taking longer than expected. Your tokens will be
                credited automatically once the payment clears.{" "}
                <a href="/wallet" style={{ color: "var(--pnp-accent, #D4007A)" }}>
                  Check your wallet
                </a>{" "}
                in a minute or close this window.
              </p>
            )}
            <button
              onClick={() => {
                if (window.opener) {
                  window.close();
                } else {
                  window.location.href = "/live";
                }
              }}
              style={SECONDARY_BTN}
            >
              Return to App
            </button>
          </div>
        )}

        {/* Success */}
        {state === "success" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={SUCCESS_CIRCLE}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              Payment Confirmed!
            </p>
            <p style={{ fontSize: 13, color: "var(--pnp-text-secondary, #8E8E93)", marginBottom: 24 }}>
              Your tokens have been credited to your account. You can close this
              window and return to PNPtv!.
            </p>
            <button
              onClick={() => {
                if (window.opener) {
                  // Opened as a popup — close it; parent window stays on /live
                  window.close();
                } else {
                  // Opened directly (e.g. user followed the link) — navigate home
                  window.location.href = "/live";
                }
              }}
              style={PAY_BTN}
            >
              Return to App
            </button>
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={ERROR_CIRCLE}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Unable to Process
            </p>
            <p style={{ fontSize: 13, color: "var(--pnp-text-secondary, #8E8E93)", marginBottom: 24 }}>
              {error}
            </p>
            <button
              onClick={() => window.close()}
              style={SECONDARY_BTN}
            >
              Close Window
            </button>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            fontSize: 11,
            color: "#555",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#30D158"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <span style={{ color: "#30D158" }}>Secure checkout</span>
          </div>
          <p>PNPtv! &copy; 2026</p>
        </div>
      </div>
    </div>
  );
}
