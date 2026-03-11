import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DaimoSDKProvider, DaimoModal } from "@daimo/sdk/web";
import "@daimo/sdk/web/styles.css";
import "@daimo/sdk/web/theme.css";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { updatePaymentEmail, getPaymentStatus } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

interface PaymentInfo {
  paymentId: string;
  paymentRef: string;
  provider: string;
  amountUSD: number;
  daimoSessionId?: string;
  daimoClientSecret?: string;
  plan: {
    name: string;
    icon: string;
    duration: number;
  };
}

type CheckoutState = "loading" | "ready" | "confirming" | "success" | "error";

export default function DaimoCheckout() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const { checkout: t } = useI18n();
  const { refreshUser } = useAuth();
  const [state, setState] = useState<CheckoutState>("loading");
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  // Keep clientSecret out of React's state tree to avoid unnecessary re-renders
  // and to prevent it appearing in React DevTools state panels.
  const clientSecretRef = useRef<string>("");
  const confirmPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!paymentId) {
      setError(t.errorNoPaymentId);
      setState("error");
      return;
    }

    fetch(`${API_BASE}/api/payment/${encodeURIComponent(paymentId)}`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          setError(data.error || t.errorPaymentNotFound);
          setState("error");
          return;
        }
        const p = data.payment;
        if (p.provider !== "daimo") {
          setError(t.errorNotCrypto);
          setState("error");
          return;
        }
        if (!p.daimoSessionId || !p.daimoClientSecret) {
          setError(t.errorSessionNotReady);
          setState("error");
          return;
        }
        // Store clientSecret in a ref — not state — so it is never
        // exposed in React DevTools or snapshot serialisation.
        clientSecretRef.current = p.daimoClientSecret ?? "";
        // Strip the secret from the state object before storing it.
        setPayment({ ...p, daimoClientSecret: undefined });
        setState("ready");
      })
      .catch(() => {
        setError(t.errorCouldNotLoad);
        setState("error");
      });
  }, [paymentId, t.errorNoPaymentId, t.errorPaymentNotFound, t.errorNotCrypto, t.errorSessionNotReady, t.errorCouldNotLoad]);

  const handlePaymentCompleted = useCallback(() => {
    // The Daimo SDK callback fires when the user confirms in their wallet, but
    // the on-chain transaction still needs to be indexed by the backend before
    // we can grant access.  Show a "confirming" spinner and poll the backend
    // for up to 3 minutes before setting an error state.
    setState("confirming");

    // Send email to backend if provided (non-blocking, best-effort).
    if (email.trim() && paymentId) {
      updatePaymentEmail(paymentId, email.trim()).catch(() => {});
    }

    let attempts = 0;
    confirmPollRef.current = setInterval(async () => {
      attempts++;
      try {
        const status = await getPaymentStatus(paymentId!);
        if (status?.status === "completed" || status?.status === "paid") {
          clearInterval(confirmPollRef.current!);
          confirmPollRef.current = null;
          await refreshUser();
          setState("success");
          return;
        }
      } catch {
        // non-fatal — keep polling
      }
      // Timeout after 60 attempts × 3 s = 3 minutes; set error so the user
      // is not left stuck on the confirming screen indefinitely.
      if (attempts >= 60) {
        clearInterval(confirmPollRef.current!);
        confirmPollRef.current = null;
        setError(t.confirmationTimeout || "Your transaction was submitted but is taking longer than expected. You will receive a Telegram notification once confirmed.");
        setState("error");
      }
    }, 3000);
  }, [email, paymentId, refreshUser, t.confirmationTimeout]);

  // Clean up the confirmation poll if the component unmounts mid-flight.
  useEffect(() => {
    return () => {
      if (confirmPollRef.current) {
        clearInterval(confirmPollRef.current);
        confirmPollRef.current = null;
      }
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#121212",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "'Roboto Mono', monospace",
        color: "#fff",
      }}
    >
      {/* Single keyframes declaration — hoisted out of conditional branches */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Background orbs */}
      <div
        style={{
          position: "fixed",
          width: 500,
          height: 500,
          borderRadius: "50%",
          opacity: 0.2,
          filter: "blur(80px)",
          top: "-20%",
          left: "-10%",
          background: "radial-gradient(circle, #D4007A, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "fixed",
          width: 500,
          height: 500,
          borderRadius: "50%",
          opacity: 0.2,
          filter: "blur(80px)",
          bottom: "-20%",
          right: "-10%",
          background: "radial-gradient(circle, #E69138, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
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
        }}
      >
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
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            PNPtv!
          </div>
        </div>

        {state === "loading" && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div
              style={{
                width: 40,
                height: 40,
                border: "3px solid rgba(212,0,122,0.3)",
                borderTopColor: "#D4007A",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <p style={{ color: "#8E8E93", fontSize: 14 }}>
              {t.loadingPaymentDetails}
            </p>
          </div>
        )}

        {state === "ready" && payment && (
          <>
            {/* Plan summary */}
            <div
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: 16,
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>
                {payment.plan.icon}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                {payment.plan.name}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #D4007A, #E69138)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                ${Number(payment.amountUSD).toFixed(2)} USDC
              </div>
              <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6 }}>
                {t.paymentRef} {payment.paymentRef}
              </div>
            </div>

            {/* Email field */}
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="checkout-email"
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "#8E8E93",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  marginBottom: 4,
                }}
              >
                {t.emailLabel}
              </label>
              <p style={{ fontSize: 12, color: "#8E8E93", marginBottom: 8 }}>
                {t.emailDesc}
              </p>
              <input
                id="checkout-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError("");
                }}
                placeholder={t.emailPlaceholder}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: emailError
                    ? "1px solid #FF453A"
                    : "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  fontFamily: "'Roboto Mono', monospace",
                  fontSize: 14,
                  color: "#fff",
                  outline: "none",
                }}
              />
              {emailError && (
                <p style={{ color: "#FF453A", fontSize: 12, marginTop: 4 }}>
                  {emailError}
                </p>
              )}
            </div>

            <p
              style={{
                textAlign: "center",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                marginBottom: 12,
              }}
            >
              {t.payWithWallet}
            </p>

            {/* Step-by-step guide */}
            <div
              style={{
                background: "rgba(212,0,122,0.08)",
                border: "1px solid rgba(212,0,122,0.2)",
                borderRadius: 12,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "#D4007A", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t.howItWorks}
              </div>
              {[t.step1, t.step2, t.step3].map((step, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: i < 2 ? 6 : 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#D4007A", minWidth: 18 }}>{i + 1}.</span>
                  <span style={{ fontSize: 12, color: "#aaa" }}>{step}</span>
                </div>
              ))}
            </div>

            {/* Daimo Modal — embedded mode renders inline.
                clientSecret is read from a ref (never stored in React state)
                to keep it out of DevTools and snapshot serialisation. */}
            <DaimoSDKProvider>
              <DaimoModal
                sessionId={payment.daimoSessionId!}
                clientSecret={clientSecretRef.current}
                defaultOpen
                embedded
                onPaymentCompleted={handlePaymentCompleted}
              />
            </DaimoSDKProvider>
          </>
        )}

        {state === "confirming" && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div
              style={{
                width: 40,
                height: 40,
                border: "3px solid rgba(212,0,122,0.3)",
                borderTopColor: "#D4007A",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {t.confirmingTitle}
            </p>
            <p style={{ fontSize: 13, color: "#8E8E93" }}>
              {t.confirmingBody}
            </p>
          </div>
        )}

        {state === "success" && (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #30D158, #34C759)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
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
            <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              {t.paymentConfirmedTitle}
            </p>
            <p
              style={{ fontSize: 13, color: "#8E8E93", marginBottom: 24 }}
            >
              {t.paymentConfirmedBody}
            </p>
            <button
              onClick={() => navigate("/welcome")}
              style={{
                width: "100%",
                padding: "14px 24px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, #D4007A, #E69138)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              {t.goToPnptv}
            </button>
          </div>
        )}

        {state === "error" && (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "rgba(255,69,58,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                color: "#FF453A",
              }}
            >
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
              {t.unableToProcess}
            </p>
            <p
              style={{ fontSize: 13, color: "#8E8E93", marginBottom: 24 }}
            >
              {error}
            </p>
            <button
              onClick={() => navigate("/subscribe")}
              style={{
                width: "100%",
                padding: "14px 24px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, #D4007A, #E69138)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                marginBottom: 8,
              }}
            >
              {t.tryAgainBtn}
            </button>
            <button
              onClick={() => { try { window.close(); } catch {} navigate("/subscribe"); }}
              style={{
                width: "100%",
                padding: "10px 24px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#8E8E93",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {t.closeBtn}
            </button>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 11,
            color: "#555",
          }}
        >
          <span style={{ color: "#30D158" }}>{t.secureCheckout}</span>
          <span> {t.poweredBy}</span>
          <p style={{ marginTop: 4 }}>{t.copyright}</p>
        </div>
      </div>
    </div>
  );
}
