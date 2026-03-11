import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DaimoSDKProvider, DaimoModal } from "@daimo/sdk/web";
import "@daimo/sdk/web/styles.css";
import "@daimo/sdk/web/theme.css";
import { getTokenCheckoutData } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

// Augment Window with the ePayco checkout object injected by checkout.js
declare global {
  interface Window {
    ePayco?: {
      checkout: {
        configure: (config: Record<string, unknown>) => { open: () => void };
      };
    };
  }
}

type CheckoutState = "loading" | "ready" | "pending" | "success" | "error";

const BG_STYLES: React.CSSProperties = {
  minHeight: "100vh",
  background: "#121212",
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

const SUMMARY_BOX: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 16,
  padding: 16,
  marginBottom: 20,
  textAlign: "center",
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

// Loads an external script once and resolves when it is ready.
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

// ── ePayco Checkout widget component ─────────────────────────────────────────
const EPAYCO_ORIGINS = new Set([
  "https://checkout.epayco.co",
  "https://secure.epayco.co",
  "https://epayco.co",
]);
interface EPaycoConfig {
  publicKey: string;
  amount: number;
  currency: string;
  description: string;
  invoice: string;
  signature: string | null;
  extra1: string;
  extra2: string;
  extra3: string;
  test: boolean;
  response: string;
  confirmation: string;
}

interface EPaycoWidgetProps {
  config: EPaycoConfig;
  tokens: number;
  usd: number;
  purchaseId: string;
  onStartPolling: (id: string) => void;
}

function EPaycoWidget({ config, tokens, usd, purchaseId, onStartPolling }: EPaycoWidgetProps) {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState("");
  const [opening, setOpening] = useState(false);
  const handlerRef = useRef<{ open: () => void } | null>(null);

  useEffect(() => {
    loadScript("https://checkout.epayco.co/checkout.js")
      .then(() => {
        if (!window.ePayco?.checkout?.configure) {
          setSdkError("ePayco checkout SDK failed to initialise.");
          return;
        }
        const logoUrl = `${window.location.origin}/Logo2-50.png`;
        const ogImageUrl = `${window.location.origin}/og-image.png`;
        handlerRef.current = window.ePayco.checkout.configure({
          key: config.publicKey,
          test: config.test,
          external: "false",
          invoice: config.invoice,
          ...(config.signature ? { p_hash_key: config.signature } : {}),
          amount: String(config.amount),
          name: "PNPtv!",
          description: config.description,
          currency: config.currency,
          country: "CO",
          lang: "en",
          extra1: config.extra1,
          extra2: config.extra2,
          extra3: config.extra3,
          response: config.response,
          confirmation: config.confirmation,
          // Brand identity — shown inside the ePayco popup
          logo: logoUrl,
          img_logo: logoUrl,
          img: ogImageUrl,
        });
        setSdkReady(true);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Unknown error loading ePayco";
        setSdkError(msg);
      });

    // Listen for the ePayco postMessage response so we can detect that the
    // user completed the payment form. We do NOT trust this event as final
    // confirmation — instead we hand off to the server-side polling loop.
    function onMessage(evt: MessageEvent) {
      if (!EPAYCO_ORIGINS.has(evt.origin)) return;
      try {
        const data = typeof evt.data === "string" ? JSON.parse(evt.data) : evt.data;
        if (data?.status === "Aceptada" || data?.x_transaction_state === "Aceptada") {
          // Start polling backend for authoritative confirmation; do NOT call
          // onSuccess directly — the popup signal cannot be trusted alone.
          onStartPolling(purchaseId);
        }
      } catch {
        // Not a JSON message — ignore
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [config, purchaseId, onStartPolling]);

  const handleOpen = useCallback(() => {
    if (!handlerRef.current) return;
    setOpening(true);
    handlerRef.current.open();
    // Reset the opening spinner after a brief delay — the popup takes over from here
    setTimeout(() => setOpening(false), 2000);
  }, []);

  if (sdkError) {
    return (
      <p style={{ color: "#FF453A", fontSize: 13, textAlign: "center" }}>
        {sdkError}
      </p>
    );
  }

  return (
    <div>
      <div style={SUMMARY_BOX}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🪙</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          {tokens.toLocaleString()} PNP Tokens
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, ...GRADIENT_TEXT }}>
          ${usd.toFixed(2)} USD
        </div>
        <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6 }}>
          Paid via credit / debit card — powered by ePayco
        </div>
      </div>

      <p style={{ textAlign: "center", fontSize: 13, color: "#8E8E93", marginBottom: 16 }}>
        Tap the button below to open the secure ePayco checkout. Your card
        details are processed entirely by ePayco and never stored on our
        servers.
      </p>

      <button
        onClick={handleOpen}
        disabled={!sdkReady || opening}
        style={{
          ...PAY_BTN,
          opacity: !sdkReady || opening ? 0.6 : 1,
          cursor: !sdkReady || opening ? "not-allowed" : "pointer",
        }}
      >
        {!sdkReady ? (
          <>
            <div
              style={{
                width: 18,
                height: 18,
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            Loading checkout…
          </>
        ) : opening ? (
          <>
            <div
              style={{
                width: 18,
                height: 18,
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            Opening checkout…
          </>
        ) : (
          <>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            Pay ${usd.toFixed(2)} with Card
          </>
        )}
      </button>
    </div>
  );
}

// ── Daimo widget component ────────────────────────────────────────────────────
interface DaimoWidgetProps {
  sessionId: string;
  // clientSecret is passed via ref to keep it out of React's state tree.
  clientSecretRef: React.RefObject<string>;
  tokens: number;
  usd: number;
  onSuccess: () => void;
}

function DaimoWidget({ sessionId, clientSecretRef, tokens, usd, onSuccess }: DaimoWidgetProps) {
  return (
    <div>
      <div style={SUMMARY_BOX}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🪙</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          {tokens.toLocaleString()} PNP Tokens
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, ...GRADIENT_TEXT }}>
          ${usd.toFixed(2)} USDC
        </div>
        <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6 }}>
          Paid via crypto wallet — powered by Daimo
        </div>
      </div>

      <p style={{ textAlign: "center", fontSize: 13, color: "#8E8E93", marginBottom: 16 }}>
        Pay with USDC from any compatible crypto wallet. Fast, low fees, and
        no personal information required.
      </p>

      <DaimoSDKProvider>
        <DaimoModal
          sessionId={sessionId}
          clientSecret={clientSecretRef.current ?? ""}
          defaultOpen
          embedded
          onPaymentCompleted={onSuccess}
        />
      </DaimoSDKProvider>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

export default function TokenCheckout() {
  const { purchaseId } = useParams<{ purchaseId: string }>();
  const [searchParams] = useSearchParams();
  const { refreshUser } = useAuth();
  const [state, setState] = useState<CheckoutState>("loading");
  const [data, setData] = useState<Awaited<ReturnType<typeof getTokenCheckoutData>> | null>(null);
  const [error, setError] = useState("");
  const [pollElapsed, setPollElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep Daimo clientSecret out of React's state tree — store in a ref.
  const daimoClientSecretRef = useRef<string>("");

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

    // ePayco redirect — ?status=response means the user completed the payment form.
    // The webhook hasn't necessarily fired yet, so poll until confirmed.
    if (searchParams.get("status") === "response") {
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
        if (res.status === "expired" || res.status === "cancelled") {
          setError("This payment link has expired. Please start a new purchase from the app.");
          setState("error");
          return;
        }
        if (res.provider === "daimo" && res.daimo?.clientSecret) {
          daimoClientSecretRef.current = res.daimo.clientSecret;
        }
        setData(res);
        setState("ready");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Could not load checkout details.";
        setError(msg);
        setState("error");
      });
  }, [purchaseId, searchParams, startPolling]);

  const handleSuccess = useCallback(async () => {
    stopPolling();
    await refreshUser();
    setState("success");
  }, [stopPolling, refreshUser]);

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
            <p style={{ color: "#8E8E93", fontSize: 14 }}>
              Loading payment details…
            </p>
          </div>
        )}

        {/* Pending — ePayco redirect, waiting for webhook confirmation */}
        {state === "pending" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={SPINNER_STYLE} />
            <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {pollElapsed >= POLL_TIMEOUT_MS ? "Payment Submitted" : "Verifying Payment…"}
            </p>
            {pollElapsed < POLL_TIMEOUT_MS ? (
              <p style={{ fontSize: 13, color: "#8E8E93", marginBottom: 20 }}>
                Your payment was submitted. We&rsquo;re waiting for confirmation from ePayco.
                This usually takes a few seconds.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: "#8E8E93", marginBottom: 20 }}>
                Payment confirmation is taking longer than expected. Your tokens will be
                credited automatically once the payment clears. You can close this window —
                check your wallet in a minute.
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

        {/* Ready — render provider-specific widget */}
        {state === "ready" && data && (
          <>
            {data.provider === "epayco" && data.epayco && purchaseId && (
              <EPaycoWidget
                config={data.epayco}
                tokens={data.tokens}
                usd={data.usd}
                purchaseId={purchaseId}
                onStartPolling={(id) => {
                  setState("pending");
                  startPolling(id);
                }}
              />
            )}
            {data.provider === "daimo" && data.daimo && (
              <DaimoWidget
                sessionId={data.daimo.sessionId}
                clientSecretRef={daimoClientSecretRef}
                tokens={data.tokens}
                usd={data.usd}
                onSuccess={handleSuccess}
              />
            )}
            {/* Fallback: unknown provider */}
            {data.provider !== "epayco" && data.provider !== "daimo" && (
              <p style={{ textAlign: "center", color: "#FF453A", fontSize: 14 }}>
                Unsupported payment provider. Please contact support.
              </p>
            )}
          </>
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
            <p style={{ fontSize: 13, color: "#8E8E93", marginBottom: 24 }}>
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
            <p style={{ fontSize: 13, color: "#8E8E93", marginBottom: 24 }}>
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
