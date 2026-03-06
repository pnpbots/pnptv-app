import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DaimoSDKProvider, DaimoModal } from "@daimo/sdk/web";
import "@daimo/sdk/web/styles.css";
import "@daimo/sdk/web/theme.css";
import { useI18n } from "@/lib/i18n";

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

type CheckoutState = "loading" | "ready" | "success" | "error";

export default function DaimoCheckout() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const { checkout: t } = useI18n();
  const [state, setState] = useState<CheckoutState>("loading");
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [error, setError] = useState("");

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
        setPayment(p);
        setState("ready");
      })
      .catch(() => {
        setError(t.errorCouldNotLoad);
        setState("error");
      });
  }, [paymentId, t.errorNoPaymentId, t.errorPaymentNotFound, t.errorNotCrypto, t.errorSessionNotReady, t.errorCouldNotLoad]);

  const handlePaymentCompleted = useCallback(() => {
    setState("success");
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
          width: "100%",
          maxWidth: 520,
          padding: 32,
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {t.brandName}
          </span>
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
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
                ${payment.amountUSD.toFixed(2)} USDC
              </div>
              <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6 }}>
                {t.paymentRef} {payment.paymentRef}
              </div>
            </div>

            <p
              style={{
                textAlign: "center",
                fontSize: 13,
                color: "#8E8E93",
                marginBottom: 16,
              }}
            >
              {t.payWithWallet}
            </p>

            {/* Daimo Modal — embedded mode renders inline */}
            <DaimoSDKProvider>
              <DaimoModal
                sessionId={payment.daimoSessionId!}
                clientSecret={payment.daimoClientSecret!}
                defaultOpen
                embedded
                onPaymentCompleted={handlePaymentCompleted}
              />
            </DaimoSDKProvider>
          </>
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
              onClick={() => navigate("/subscribe")}
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
              onClick={() => window.close()}
              style={{
                width: "100%",
                padding: "14px 24px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
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
