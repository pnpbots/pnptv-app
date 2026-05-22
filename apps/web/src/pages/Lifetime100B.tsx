import React, { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  createPayment,
  getPaymentStatus,
  createDashSubscription,
  getDashSubscriptionStatus,
  getDashAvailable,
  getDashPaymentDetails,
  assertPaymentUrl,
  ApiError,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { isTelegramContext } from "@/lib/telegram";

const PLAN_ID = "lifetime100";

const BENEFITS: Record<"en" | "es", string[]> = {
  en: [
    "♾️ Lifetime access — pay once, stay forever",
    "👑 Full VIP status in The Circle",
    "🔥 Videorama: Everything, always",
    "📍 Premium Nearby with priority visibility",
    "🎥 Unlimited Hangouts — you are the party",
    "📺 All PNP Latino Live + private streams",
    "🎬 Live sessions with Santino",
  ],
  es: [
    "♾️ Acceso de por vida — paga una vez, quédate siempre",
    "👑 Estatus VIP completo en El Círculo",
    "🔥 Videorama: Todo, siempre",
    "📍 Nearby Premium con visibilidad prioritaria",
    "🎥 Hangouts ilimitados — tú eres la fiesta",
    "📺 Todo PNP Latino Live + streams privados",
    "🎬 Sesiones en vivo con Santino",
  ],
};

type Provider = "epayco" | "dash";

type DashInvoice = {
  invoiceId: string;
  checkoutUrl: string;
  planName: string;
  destination?: string;
  amount?: string;
  invoiceAmount?: number | null;
  loadingDetails?: boolean;
  detailsError?: string;
  createdAt: number;
};

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="animate-spin" style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function Lifetime100B() {
  const { user, isLoading: authLoading, refreshUser } = useAuth();

  const [lang, setLang] = useState<"en" | "es">(() => {
    try { const s = localStorage.getItem("pnptv:lifetime100:lang"); if (s === "en" || s === "es") return s; } catch {}
    return (typeof navigator !== "undefined" && navigator.language.startsWith("en")) ? "en" : "es";
  });
  const es = lang === "es";

  const [provider, setProvider] = useState<Provider>("epayco");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [pollingPaymentId, setPollingPaymentId] = useState<string | null>(null);
  const [dashAvailable, setDashAvailable] = useState<boolean | null>(null);
  const [dashInvoice, setDashInvoice] = useState<DashInvoice | null>(null);
  const [dashPolling, setDashPolling] = useState(false);
  const [dashCopied, setDashCopied] = useState(false);
  const [dashSecondsLeft, setDashSecondsLeft] = useState(900);
  const [dashPaymentSuccess, setDashPaymentSuccess] = useState(false);
  const dashCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.title = es
      ? "Lifetime100 — Acceso de por vida | PNPtv!"
      : "Lifetime100 — Lifetime Access | PNPtv!";
  }, [es]);

  useEffect(() => {
    getDashAvailable()
      .then((r) => setDashAvailable(r.available === true && r.configured === true))
      .catch(() => setDashAvailable(false));

    // Resume ePayco polling if returning from same-tab redirect
    try {
      const pending = sessionStorage.getItem("pnp_pending_payment");
      if (pending) { sessionStorage.removeItem("pnp_pending_payment"); setPollingPaymentId(pending); }
    } catch {}
  }, []);

  // ePayco payment polling
  useEffect(() => {
    if (!pollingPaymentId) return;
    let cancelled = false;
    let attempts = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || attempts >= 120) {
        if (attempts >= 120) {
          setPollingPaymentId(null);
          setError(es ? "Tiempo de espera agotado. Contacta soporte si completaste el pago." : "Payment timed out. Contact support if you completed the payment.");
        }
        return;
      }
      attempts++;
      try {
        const data = await getPaymentStatus(pollingPaymentId);
        if (cancelled) return;
        if (data.status === "completed" || data.status === "paid" || data.status === "success") {
          setPollingPaymentId(null);
          setPaymentSuccess(true);
          await refreshUser();
          return;
        }
        if (data.status === "failed" || data.status === "refunded") {
          setPollingPaymentId(null);
          setError(data.message || (es ? "El pago no fue exitoso. Intenta de nuevo." : "Payment was not successful. Please try again."));
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, 5000);
      } catch {
        if (!cancelled) timerId = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => { cancelled = true; if (timerId) clearTimeout(timerId); };
  }, [pollingPaymentId, refreshUser, es]);

  // Dash invoice polling
  useEffect(() => {
    if (!dashInvoice || !dashPolling) return;
    let cancelled = false;
    let attempts = 0;
    const startedAt = Date.now();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const nextDelay = (n: number) => Math.min(5000 + Math.floor(n / 5) * 3000, 12000);

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= 15 * 60 * 1000) { setDashPolling(false); return; }
      attempts++;
      try {
        const data = await getDashSubscriptionStatus(dashInvoice.invoiceId);
        if (cancelled) return;
        if (data.status === "completed") {
          setDashPolling(false);
          setDashPaymentSuccess(true);
          try { sessionStorage.removeItem("pnp_pending_dash_invoice"); } catch {}
          await refreshUser();
          timerId = setTimeout(() => {
            setDashInvoice(null);
            setDashPaymentSuccess(false);
            setPaymentSuccess(true);
          }, 2000);
          return;
        }
        if (data.status === "expired" || data.status === "invalid") {
          setDashPolling(false);
          try { sessionStorage.removeItem("pnp_pending_dash_invoice"); } catch {}
          setError(es ? "Factura Dash expirada. Intenta de nuevo." : "Dash invoice expired. Please try again.");
          return;
        }
        if (!cancelled) timerId = setTimeout(poll, nextDelay(attempts));
      } catch {
        if (!cancelled) timerId = setTimeout(poll, nextDelay(attempts));
      }
    };
    poll();
    return () => { cancelled = true; if (timerId) clearTimeout(timerId); };
  }, [dashInvoice, dashPolling, refreshUser, es]);

  // Dash countdown timer
  useEffect(() => {
    if (!dashInvoice || !dashPolling) {
      if (dashCountdownRef.current) { clearInterval(dashCountdownRef.current); dashCountdownRef.current = null; }
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, 900 - Math.floor((Date.now() - dashInvoice.createdAt) / 1000));
      setDashSecondsLeft(remaining);
      if (remaining === 0) { if (dashCountdownRef.current) { clearInterval(dashCountdownRef.current); dashCountdownRef.current = null; } setDashPolling(false); }
    };
    tick();
    dashCountdownRef.current = setInterval(tick, 1000);
    return () => { if (dashCountdownRef.current) { clearInterval(dashCountdownRef.current); dashCountdownRef.current = null; } };
  }, [dashInvoice, dashPolling]);

  function cancelDash() {
    setDashInvoice(null);
    setDashPolling(false);
    setDashCopied(false);
    setDashSecondsLeft(900);
    setDashPaymentSuccess(false);
  }

  async function handlePay() {
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent("/lifetime100b")}`;
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      if (provider === "dash") {
        const result = await createDashSubscription(PLAN_ID);
        if (result.success && result.checkoutUrl) {
          const invoice: DashInvoice = {
            invoiceId: result.invoiceId,
            checkoutUrl: assertPaymentUrl(result.checkoutUrl),
            planName: result.planName || "Lifetime100",
            loadingDetails: true,
            createdAt: Date.now(),
          };
          setDashInvoice(invoice);
          setDashSecondsLeft(900);
          setDashPolling(true);
          try {
            sessionStorage.setItem("pnp_pending_dash_invoice", JSON.stringify({
              invoiceId: result.invoiceId, createdAt: invoice.createdAt, planName: invoice.planName,
            }));
          } catch {}
          getDashPaymentDetails(result.invoiceId)
            .then((d) => {
              if (d.success) {
                setDashInvoice((prev) => prev ? { ...prev, destination: d.destination, amount: d.amount, invoiceAmount: d.invoiceAmount, loadingDetails: false } : prev);
              } else {
                setDashInvoice((prev) => prev ? { ...prev, loadingDetails: false, detailsError: es ? "No se pudieron cargar los detalles." : "Could not load payment details." } : prev);
              }
            })
            .catch(() => {
              setDashInvoice((prev) => prev ? { ...prev, loadingDetails: false, detailsError: es ? "No se pudieron cargar los detalles." : "Could not load payment details." } : prev);
            });
        } else {
          setError(es ? "No se pudo crear la factura Dash. Intenta de nuevo." : "Failed to create Dash invoice. Please try again.");
        }
      } else {
        const result = await createPayment(PLAN_ID, provider);
        if (result.success && result.paymentUrl) {
          const safeUrl = assertPaymentUrl(result.paymentUrl);
          if (result.paymentId) {
            try { sessionStorage.setItem("pnp_pending_payment", result.paymentId); } catch {}
            setPollingPaymentId(result.paymentId);
          }
          if (isTelegramContext()) {
            window.Telegram!.WebApp.openLink(safeUrl);
          } else {
            const win = window.open(safeUrl, "_blank", "noopener,noreferrer");
            if (win === null) {
              setError(es ? "Popup bloqueado — abriendo en esta pestaña..." : "Popup blocked — opening checkout in this tab…");
              window.location.href = safeUrl;
            }
          }
        } else {
          setError(result.message || result.error || (es ? "Error al iniciar el pago." : "Failed to create payment."));
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === "BTCPAY_NOT_CONFIGURED") setError(es ? "Pagos Dash no configurados." : "Dash payments not configured.");
        else if (err.code === "BTCPAY_UNREACHABLE") setError(es ? "Servidor Dash no disponible." : "Dash payment server unavailable.");
        else setError(err.message || (es ? "Error de pago." : "Payment error."));
      } else {
        setError(err instanceof Error ? err.message : (es ? "Error inesperado." : "Unexpected error."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ───────────────────────────────────────────────────────────
  if (paymentSuccess) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--pnp-background)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
        <div style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(255,153,51,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#ff9933" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 900, color: "#ffffff" }}>
            {es ? "¡Bienvenido, fundador! 🎉" : "Welcome, Founder! 🎉"}
          </h2>
          <p style={{ margin: "0 0 8px", fontSize: 15, color: "var(--pnp-text-secondary)" }}>
            {es ? "Tu membresía de por vida está activa." : "Your lifetime membership is now active."}
          </p>
          <p style={{ margin: "0 0 32px", fontSize: 13, color: "var(--pnp-text-secondary)" }}>
            {es ? "Incluye 2 meses de PRIME de regalo." : "Includes 2 months of PRIME as a bonus."}
          </p>
          <button
            onClick={() => { window.location.href = "/welcome"; }}
            style={{ padding: "16px 32px", borderRadius: 14, border: "none", background: "linear-gradient(90deg, #ff3377, #ff9933)", color: "#ffffff", fontSize: 15, fontWeight: 800, cursor: "pointer", width: "100%" }}
          >
            {es ? "Entrar a PNPtv!" : "Enter PNPtv!"}
          </button>
        </div>
      </div>
    );
  }

  const benefitList = BENEFITS[lang];

  return (
    <div style={{ minHeight: "100vh", background: "var(--pnp-background)", color: "#ffffff", overflowX: "hidden", paddingBottom: 40 }}>
      {/* Ambient glow */}
      <div aria-hidden="true" style={{ position: "fixed", top: "-20%", left: "50%", transform: "translateX(-50%)", width: "100vw", height: "100vw", background: "radial-gradient(circle, rgba(255,0,204,0.10) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <header style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px" }}>
        <a href="/lifetime100" aria-label="PNPtv! home" style={{ display: "flex" }}>
          <img src="/logo-header.png" alt="PNPtv!" style={{ height: 36, width: "auto" }} />
        </a>
        {/* Language toggle */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.10)", borderRadius: 20, padding: 2 }} role="group" aria-label="Language">
          {(["en", "es"] as const).map((l) => (
            <button
              key={l}
              onClick={() => { setLang(l); try { localStorage.setItem("pnptv:lifetime100:lang", l); } catch {} }}
              style={{ background: lang === l ? "#ffffff" : "transparent", color: lang === l ? "#120d14" : "#8E8E93", border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 18, minHeight: 36, minWidth: 44 }}
              aria-pressed={lang === l}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 480, margin: "0 auto", padding: "0 16px 40px" }}>

        {/* Maintenance notice */}
        <div style={{ marginBottom: 20, padding: "14px 18px", borderRadius: 16, border: "1px solid rgba(255,153,51,0.4)", background: "rgba(255,153,51,0.07)" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#ff9933", fontWeight: 700, letterSpacing: "0.04em" }}>
            {es ? "⚠️ Meru en mantenimiento temporal" : "⚠️ Meru temporarily under maintenance"}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
            {es
              ? "Paga aquí con tarjeta (ePayco) o Dash. Mismas condiciones, acceso inmediato."
              : "Pay here with card (ePayco) or Dash. Same terms, immediate access."}
          </p>
        </div>

        {/* Plan card */}
        <div style={{ background: "rgba(44,44,46,0.70)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(255,180,84,0.30)", borderRadius: 24, padding: "28px 24px", marginBottom: 20, position: "relative", overflow: "hidden", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
          {/* Top gradient bar */}
          <div aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 4, background: "linear-gradient(90deg, #ff3377, #ff9933)" }} />

          <span style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: "#ff9933", fontWeight: 700, marginBottom: 14 }}>
            {es ? "ACCESO DE POR VIDA · OFERTA LIMITADA" : "LIFETIME ACCESS · LIMITED OFFER"}
          </span>

          {/* Price */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
            <span style={{ fontSize: 18, color: "#636366", textDecoration: "line-through", fontWeight: 600, marginBottom: 4 }}>$500</span>
            <div style={{ fontSize: "clamp(56px,15vw,72px)", fontWeight: 900, lineHeight: 1, textShadow: "0 0 30px rgba(255,180,84,0.4)", display: "flex", alignItems: "flex-start" }}>
              <span style={{ fontSize: "0.36em", marginTop: "0.55em", opacity: 0.8 }}>$</span>
              <span>99</span>
              <span style={{ fontSize: "0.36em", marginTop: "0.55em", opacity: 0.8 }}>.99</span>
            </div>
            <span style={{ fontSize: 13, color: "var(--pnp-text-secondary)", marginTop: 4 }}>USD · {es ? "pago único" : "one-time payment"}</span>
          </div>

          {/* Benefits */}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {benefitList.map((b, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", marginBottom: 12, fontSize: 14, lineHeight: 1.45, color: "rgba(255,255,255,0.9)", gap: 10 }}>
                <span style={{ flexShrink: 0 }}>{b.slice(0, 2)}</span>
                <span>{b.slice(2)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Auth gate */}
        {!authLoading && !user && (
          <div style={{ marginBottom: 20, padding: "16px 20px", borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", textAlign: "center" }}>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--pnp-text-secondary)" }}>
              {es ? "Inicia sesión para completar tu compra" : "Log in to complete your purchase"}
            </p>
            <button
              onClick={() => { window.location.href = `/login?returnTo=${encodeURIComponent("/lifetime100b")}`; }}
              style={{ padding: "13px 28px", borderRadius: 12, border: "none", background: "linear-gradient(90deg, #ff3377, #ff9933)", color: "#ffffff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              {es ? "Iniciar sesión / Registrarse" : "Log in / Sign up"}
            </button>
          </div>
        )}

        {/* Payment method selector */}
        {!authLoading && user && (
          <>
            <div style={{ marginBottom: 20 }}>
              <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--pnp-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {es ? "Método de pago" : "Payment method"}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {/* ePayco */}
                <button
                  onClick={() => setProvider("epayco")}
                  style={{ borderRadius: 16, padding: "16px 12px", border: `2px solid ${provider === "epayco" ? "#D4007A" : "rgba(255,255,255,0.10)"}`, background: provider === "epayco" ? "rgba(212,0,122,0.10)" : "rgba(255,255,255,0.04)", textAlign: "center", cursor: "pointer", transition: "all 0.15s" }}
                >
                  <div style={{ fontSize: 22, marginBottom: 6 }}>💳</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>{es ? "Tarjeta" : "Card"}</div>
                  <div style={{ fontSize: 11, color: "var(--pnp-text-secondary)", marginTop: 2 }}>Visa / Mastercard</div>
                </button>
                {/* Dash */}
                <button
                  onClick={() => dashAvailable !== false && setProvider("dash")}
                  disabled={dashAvailable === false}
                  style={{ borderRadius: 16, padding: "16px 12px", border: `2px solid ${dashAvailable === false ? "rgba(255,255,255,0.05)" : provider === "dash" ? "#008DE4" : "rgba(255,255,255,0.10)"}`, background: dashAvailable === false ? "rgba(255,255,255,0.02)" : provider === "dash" ? "rgba(0,141,228,0.10)" : "rgba(255,255,255,0.04)", textAlign: "center", cursor: dashAvailable === false ? "not-allowed" : "pointer", opacity: dashAvailable === false ? 0.45 : 1, transition: "all 0.15s", position: "relative" }}
                >
                  <div style={{ fontSize: 22, marginBottom: 6 }}>🥷</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>Dash</div>
                  <div style={{ fontSize: 11, color: "var(--pnp-text-secondary)", marginTop: 2 }}>{dashAvailable === false ? (es ? "No disponible" : "Unavailable") : (es ? "Anónimo" : "Anonymous")}</div>
                  {dashAvailable !== false && (
                    <span style={{ position: "absolute", top: -6, right: -6, fontSize: 9, fontWeight: 700, background: "#008DE4", color: "#ffffff", padding: "2px 6px", borderRadius: 99, lineHeight: 1.4 }}>
                      ANON
                    </span>
                  )}
                </button>
              </div>

              {/* Dash info */}
              {provider === "dash" && dashAvailable !== false && (
                <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(0,141,228,0.30)", background: "rgba(0,141,228,0.06)" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--pnp-text-secondary)" }}>
                    {es ? "Paga con DASH directamente desde tu wallet. Sin nombre, sin tarjeta." : "Pay with DASH directly from your wallet. No name, no card required."}
                  </p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
                    <a href="https://www.dash.org/downloads/" target="_blank" rel="noopener noreferrer" style={{ color: "#008DE4" }}>{es ? "Obtener wallet" : "Get wallet"}</a>
                    <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
                    <a href="https://www.kraken.com/learn/buy-dash-coin" target="_blank" rel="noopener noreferrer" style={{ color: "#008DE4" }}>Kraken</a>
                    <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
                    <a href="https://uphold.com/en/assets/crypto/buy-dash" target="_blank" rel="noopener noreferrer" style={{ color: "#008DE4" }}>Uphold</a>
                  </div>
                </div>
              )}
            </div>

            {/* Dash invoice widget */}
            {dashInvoice && (
              <div style={{ marginBottom: 20, padding: "20px 16px", borderRadius: 20, border: "1px solid rgba(0,141,228,0.40)", background: "rgba(0,141,228,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#008DE4", animation: "lt100b-pulse 1.5s ease-in-out infinite" }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#ffffff" }}>
                    {es ? "Esperando pago Dash…" : "Waiting for Dash payment…"}
                  </span>
                </div>

                {dashInvoice.loadingDetails ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0", gap: 10 }}>
                    <Spinner size={24} />
                    <p style={{ margin: 0, fontSize: 12, color: "var(--pnp-text-secondary)" }}>{es ? "Cargando detalles…" : "Loading details…"}</p>
                  </div>
                ) : dashPaymentSuccess ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 0" }}>
                    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(52,199,89,0.20)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#34C759" }}>{es ? "¡Pago recibido!" : "Payment received!"}</p>
                  </div>
                ) : dashSecondsLeft === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "20px 0" }}>
                    <p style={{ margin: 0, fontSize: 14, color: "#FF453A", fontWeight: 600 }}>{es ? "Factura expirada." : "Invoice expired."}</p>
                    <button onClick={cancelDash} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "#008DE4", color: "#ffffff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {es ? "Reintentar" : "Try again"}
                    </button>
                  </div>
                ) : dashInvoice.destination && dashInvoice.amount ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                    {/* QR */}
                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 16 }}>
                      <QRCodeSVG value={`dash:${dashInvoice.destination}?amount=${dashInvoice.amount}`} size={176} level="M" />
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--pnp-text-secondary)" }}>{es ? "Escanea con tu wallet Dash" : "Scan with your Dash wallet"}</p>

                    {/* Amount */}
                    <div style={{ textAlign: "center" }}>
                      <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--pnp-text-secondary)" }}>{es ? "Monto a pagar" : "Amount due"}</p>
                      <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#ffffff" }}>{dashInvoice.amount} DASH</p>
                      {dashInvoice.invoiceAmount != null && (
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--pnp-text-secondary)" }}>~${dashInvoice.invoiceAmount.toFixed(2)} USD</p>
                      )}
                    </div>

                    {/* Countdown */}
                    <p style={{ margin: 0, fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: dashSecondsLeft <= 60 ? "#FF453A" : dashSecondsLeft <= 300 ? "#FF9F0A" : "var(--pnp-text-secondary)" }}>
                      {String(Math.floor(dashSecondsLeft / 60)).padStart(2, "0")}:{String(dashSecondsLeft % 60).padStart(2, "0")} {es ? "restantes" : "remaining"}
                    </p>

                    {/* Address + copy */}
                    <div style={{ width: "100%" }}>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--pnp-text-secondary)" }}>{es ? "Enviar a" : "Send to"}</p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                        <code style={{ flex: 1, fontSize: 11, color: "rgba(255,255,255,0.80)", wordBreak: "break-all", fontFamily: "monospace" }}>
                          {dashInvoice.destination}
                        </code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(dashInvoice.destination!).catch(() => {}); setDashCopied(true); setTimeout(() => setDashCopied(false), 2000); }}
                          style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: dashCopied ? "#34C759" : "#008DE4", background: "none", border: "none", cursor: "pointer", padding: "4px 6px" }}
                        >
                          {dashCopied ? (es ? "Copiado" : "Copied") : (es ? "Copiar" : "Copy")}
                        </button>
                      </div>
                    </div>

                    <a href={dashInvoice.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#008DE4", textDecoration: "underline" }}>
                      {es ? "Abrir en BTCPay →" : "Open in BTCPay →"}
                    </a>
                  </div>
                ) : (
                  /* Details failed to load — show external link fallback */
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--pnp-text-secondary)" }}>
                      {dashInvoice.detailsError || (es ? "Abre el checkout externo para completar el pago." : "Open the external checkout to complete payment.")}
                    </p>
                    <a href={dashInvoice.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "12px 20px", borderRadius: 12, background: "#008DE4", color: "#ffffff", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                      {es ? "Abrir checkout Dash" : "Open Dash checkout"}
                    </a>
                  </div>
                )}

                <button onClick={cancelDash} style={{ display: "block", width: "100%", marginTop: 14, padding: "8px", background: "none", border: "none", color: "var(--pnp-text-secondary)", fontSize: 12, cursor: "pointer" }}>
                  {es ? "Cancelar" : "Cancel"}
                </button>
              </div>
            )}

            {/* ePayco polling indicator */}
            {pollingPaymentId && (
              <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 14, background: "rgba(212,0,122,0.10)", border: "1px solid rgba(212,0,122,0.20)", textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                  <Spinner size={14} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>
                    {es ? "Esperando confirmación de pago…" : "Waiting for payment confirmation…"}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--pnp-text-secondary)" }}>
                  {es ? "Completa el pago en la ventana que se abrió." : "Complete the payment in the window that opened."}
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.25)", textAlign: "center", fontSize: 13, color: "#FF453A" }}>
                {error}
              </div>
            )}

            {/* Pay button */}
            {!dashInvoice && (
              <button
                onClick={handlePay}
                disabled={submitting || !!pollingPaymentId}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "18px 24px", borderRadius: 16, border: "none", background: submitting || pollingPaymentId ? "rgba(255,51,119,0.40)" : "linear-gradient(90deg, #ff3377, #ff9933)", color: "#ffffff", fontSize: 15, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", cursor: submitting || pollingPaymentId ? "not-allowed" : "pointer", minHeight: 58, boxShadow: submitting || pollingPaymentId ? "none" : "0 8px 32px rgba(255,51,119,0.40)", transition: "opacity 0.15s" }}
              >
                {submitting && <Spinner size={16} />}
                {submitting
                  ? (es ? "Procesando…" : "Processing…")
                  : provider === "dash"
                  ? (es ? "Pagar con Dash" : "Pay with Dash")
                  : (es ? "Pagar con tarjeta — $99.99" : "Pay with card — $99.99")}
              </button>
            )}
          </>
        )}

        {/* Back link */}
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <a href="/lifetime100" style={{ fontSize: 13, color: "var(--pnp-text-secondary)", textDecoration: "none" }}>
            ← {es ? "Volver a la página principal" : "Back to main page"}
          </a>
        </div>

        {/* Fine print */}
        <p style={{ marginTop: 24, fontSize: 11, color: "rgba(207,207,212,0.40)", textAlign: "center", lineHeight: 1.5 }}>
          {es
            ? "🔒 Encriptado · Cobro discreto · No guardamos tu tarjeta · Precio en USD"
            : "🔒 Encrypted · Discreet billing · We never store your card · Price in USD"}
        </p>
      </div>

      {/* Inject pulse keyframe once */}
      <style>{`@keyframes lt100b-pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
