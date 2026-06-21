import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNowPayments } from "@/hooks/useNowPayments";
import { NowPaymentsWaitingPanel } from "@/components/payments/NowPaymentsWaitingPanel";
import { createPayment, createDashSubscription } from "@/lib/api";

const AMOUNTS = [
  { planId: "donation-5",  usd: 5  },
  { planId: "donation-10", usd: 10 },
  { planId: "donation-25", usd: 25 },
  { planId: "donation-50", usd: 50 },
];

type Method = "crypto" | "dash" | "epayco";

export default function Donate() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const lang = (user?.language || "es") === "en" ? "en" : "es";
  const es = lang === "es";

  const [selectedIdx, setSelectedIdx] = useState(1); // $10 default
  const [method, setMethod] = useState<Method | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dashUrl, setDashUrl] = useState<string | null>(null);
  const [epaycoUrl, setEpaycoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { order, isSuccess, startPayment, cancelOrder } = useNowPayments({
    storageKey: "pnp_donate_order",
    onSuccess: () => setDone(true),
  });

  // Dash: redirect to checkout URL as soon as it's available
  useEffect(() => {
    if (dashUrl) {
      window.location.href = dashUrl;
    }
  }, [dashUrl]);

  // ePayco: redirect as soon as URL is available
  useEffect(() => {
    if (epaycoUrl) {
      window.location.href = epaycoUrl;
    }
  }, [epaycoUrl]);

  const selected = AMOUNTS[selectedIdx];

  async function handlePay() {
    if (!isAuthenticated) {
      navigate(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!method) return;
    setError(null);
    setSubmitting(true);
    try {
      if (method === "crypto") {
        await startPayment(selected.planId, user?.email);
      } else if (method === "dash") {
        const res = await createDashSubscription(selected.planId);
        if (res.success && res.checkoutUrl) {
          setDashUrl(res.checkoutUrl);
        } else {
          setError(res.error || (es ? "Error al crear el pago Dash." : "Failed to create Dash payment."));
        }
      } else if (method === "epayco") {
        const res = await createPayment(selected.planId, "epayco");
        if (res.paymentUrl) {
          setEpaycoUrl(res.paymentUrl);
        } else {
          setError(es ? "Error al crear el pago con tarjeta." : "Failed to create card payment.");
        }
      }
    } catch (e: any) {
      setError(e.message || (es ? "Algo salió mal." : "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return null;

  if (done || isSuccess) {
    return (
      <div className="min-h-dvh bg-pnp-background flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4 py-12">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-pnp-textPrimary">
            {es ? "¡Gracias de corazón!" : "Thank you so much!"}
          </h2>
          <p className="text-sm text-pnp-textSecondary">
            {es
              ? "Tu donación nos ayuda a seguir construyendo PNPtv! para esta comunidad."
              : "Your donation helps us keep building PNPtv! for this community."}
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-4 px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {es ? "Volver al inicio" : "Back to home"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{es ? "Donar — PNPtv!" : "Donate — PNPtv!"}</title>
      </Helmet>

      <div className="min-h-dvh bg-pnp-background px-4 py-10 flex flex-col items-center">
        <div className="w-full max-w-md">

          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", border: "1px solid rgba(212,0,122,0.3)" }}>
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#D4007A" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-pnp-textPrimary mb-2">
              {es ? "Apoya a PNPtv!" : "Support PNPtv!"}
            </h1>
            <p className="text-sm text-pnp-textSecondary leading-relaxed max-w-xs mx-auto">
              {es
                ? "Stripe bloqueó nuestra cuenta y retuvo nuestros fondos. Tu donación nos ayuda a recuperarnos y seguir construyendo."
                : "Stripe blocked our account and froze our funds. Your donation helps us recover and keep building."}
            </p>
          </div>

          {/* Context card */}
          <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-xs font-semibold text-amber-400 mb-1">
              {es ? "¿Por qué necesitamos tu ayuda?" : "Why do we need your help?"}
            </p>
            <p className="text-xs text-pnp-textSecondary leading-relaxed">
              {es
                ? "Stripe nos bloqueó, no reembolsó los $500 que pagamos por la cuenta Atlas y canceló un pago de $1,149.22 que nos correspondía. Total retenido: $1,649.22. Esto retrasó funciones y el onboarding de nuevos creadores."
                : "Stripe blocked us, kept the $500 we paid for the Atlas account, and cancelled a $1,149.22 payout. Total frozen: $1,649.22. This delayed features and new creator onboarding."}
            </p>
          </div>

          {/* Amount picker */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">
              {es ? "Elige un monto" : "Choose an amount"}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {AMOUNTS.map((a, i) => (
                <button
                  key={a.planId}
                  onClick={() => setSelectedIdx(i)}
                  className="py-3 rounded-xl text-sm font-bold border transition-all"
                  style={selectedIdx === i ? {
                    background: "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(230,145,56,0.25))",
                    borderColor: "#D4007A",
                    color: "#fff",
                  } : {
                    background: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  ${a.usd}
                </button>
              ))}
            </div>
          </div>

          {/* Method picker */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">
              {es ? "Método de pago" : "Payment method"}
            </p>
            <div className="space-y-2">
              {([
                { id: "crypto" as Method, label: es ? "Cripto (BTC, ETH, USDC, SOL…)" : "Crypto (BTC, ETH, USDC, SOL…)", sub: es ? "Más de 100 monedas · Sin cuenta requerida" : "100+ coins · No account required", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
                { id: "dash" as Method, label: "Dash (BTCPay)", sub: es ? "Dash via BTCPay · Sin custodio" : "Dash via BTCPay · Non-custodial", icon: "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" },
                { id: "epayco" as Method, label: es ? "Tarjeta (América Latina)" : "Card (Latin America)", sub: es ? "Visa, Mastercard vía ePayco" : "Visa, Mastercard via ePayco", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
              ] as { id: Method; label: string; sub: string; icon: string }[]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all"
                  style={method === m.id ? {
                    background: "linear-gradient(135deg, rgba(212,0,122,0.1), rgba(230,145,56,0.1))",
                    borderColor: "#D4007A",
                  } : {
                    background: "rgba(255,255,255,0.02)",
                    borderColor: "rgba(255,255,255,0.07)",
                  }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: method === m.id ? "rgba(212,0,122,0.2)" : "rgba(255,255,255,0.06)" }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                      style={{ color: method === m.id ? "#D4007A" : "rgba(255,255,255,0.5)" }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={m.icon} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-pnp-textPrimary">{m.label}</p>
                    <p className="text-xs text-pnp-textSecondary">{m.sub}</p>
                  </div>
                  {method === m.id && (
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" style={{ color: "#D4007A" }}>
                      <circle cx="12" cy="12" r="6" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* NowPayments waiting panel */}
          {order && method === "crypto" && (
            <NowPaymentsWaitingPanel
              order={order}
              isSuccess={isSuccess}
              onCancel={() => { cancelOrder(); setMethod(null); }}
              lang={lang}
              wrapperClassName="mb-4"
            />
          )}

          {/* Dash redirecting */}
          {submitting && method === "dash" && (
            <div className="mb-4 p-4 rounded-xl border border-orange-500/30 bg-orange-500/5 text-center">
              <p className="text-sm text-pnp-textSecondary">
                {es ? "Abriendo checkout de Dash…" : "Opening Dash checkout…"}
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* CTA */}
          {!order && (
            <button
              onClick={handlePay}
              disabled={!method || submitting}
              className="w-full py-4 rounded-xl font-bold text-base text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
              style={{ background: "linear-gradient(90deg, #D4007A, #E69138)", boxShadow: method ? "0 4px 24px rgba(212,0,122,0.3)" : "none" }}
            >
              {submitting
                ? (es ? "Procesando…" : "Processing…")
                : method
                  ? (es ? `Donar $${selected.usd}` : `Donate $${selected.usd}`)
                  : (es ? "Elige un método de pago" : "Choose a payment method")}
            </button>
          )}

          <p className="text-center text-[10px] text-pnp-textSecondary/50 mt-4">
            {es
              ? "Las donaciones no otorgan membresía ni beneficios. Solo apoyo puro a la comunidad."
              : "Donations don't grant membership or benefits. Just pure community support."}
          </p>

          <div className="mt-6 text-center">
            <button onClick={() => navigate(-1)} className="text-xs text-pnp-textSecondary/40 hover:text-pnp-textSecondary transition-colors">
              {es ? "← Volver" : "← Go back"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
