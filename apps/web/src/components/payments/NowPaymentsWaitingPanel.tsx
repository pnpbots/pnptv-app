import React, { useState, useRef, useEffect } from "react";
import { NowPaymentsOrder } from "@/hooks/useNowPayments";


interface NowPaymentsWaitingPanelProps {
  order: NowPaymentsOrder;
  isSuccess: boolean;
  isConfirming?: boolean;
  onCancel: () => void;
  lang: string;
  wrapperClassName?: string;
  payCurrency?: string | null;
}

// ── Crypto beginner guide (collapsed by default) ──────────────────────────────

const GUIDE_EN = {
  trigger: "New to crypto? Here's how to pay",
  buyTitle: "Step 1 — Buy crypto",
  buyIntro: "You need to own some crypto before you can send it. The easiest places to buy:",
  exchanges: [
    { name: "Coinbase", note: "Most beginner-friendly. Buy with a debit card in minutes. Works in most countries.", url: "https://www.coinbase.com/signup" },
    { name: "Binance", note: "Largest exchange worldwide. More coin options. Good for Latin America.", url: "https://www.binance.com/en/register" },
    { name: "Uphold", note: "Buy and send in one step — good for first-timers.", url: "https://www.uphold.com/" },
    { name: "MoonPay", note: "Buy with a credit or debit card instantly. No full account needed in some regions.", url: "https://www.moonpay.com/" },
  ],
  sendTitle: "Step 2 — Send the payment",
  sendSteps: [
    "Buy the crypto shown above (e.g. USDT, Bitcoin) in any of these apps.",
    'Tap "Send" or "Withdraw" in your crypto app.',
    "Paste the payment address shown above, or scan the QR code.",
    "Enter the exact amount shown and confirm.",
    "Done — your payment is detected automatically within a few minutes.",
  ],
  tipsTitle: "Tips",
  tips: [
    "Send the EXACT amount shown — even a few cents off can cause a mismatch.",
    "Make sure you select the correct network (e.g. USDT on TRC20 or BSC — match what the checkout says).",
    "Payments usually confirm in 1–10 minutes. Bitcoin can take longer.",
  ],
  guideLink: "Full crypto guide →",
};

const GUIDE_ES = {
  trigger: "¿Nuevo en cripto? Así se paga",
  buyTitle: "Paso 1 — Compra cripto",
  buyIntro: "Necesitas tener cripto antes de poder enviarlo. Los lugares más fáciles para comprarlo:",
  exchanges: [
    { name: "Coinbase", note: "El más fácil para principiantes. Compra con tarjeta de débito en minutos. Disponible en la mayoría de países.", url: "https://www.coinbase.com/signup" },
    { name: "Binance", note: "El exchange más grande del mundo. Más opciones de monedas. Bueno para Latinoamérica.", url: "https://www.binance.com/en/register" },
    { name: "Uphold", note: "Compra y envía en un solo paso — ideal para principiantes.", url: "https://www.uphold.com/" },
    { name: "MoonPay", note: "Compra con tarjeta de crédito o débito al instante. Sin registro completo en algunos países.", url: "https://www.moonpay.com/" },
  ],
  sendTitle: "Paso 2 — Envía el pago",
  sendSteps: [
    "Compra el cripto que aparece arriba (por ej. USDT, Bitcoin) en cualquiera de estas apps.",
    'Toca "Enviar" o "Retirar" en tu app de cripto.',
    "Pega la dirección de pago que aparece arriba, o escanea el código QR.",
    "Ingresa el monto exacto que se muestra y confirma.",
    "Listo — tu pago se detecta automáticamente en unos minutos.",
  ],
  tipsTitle: "Consejos",
  tips: [
    "Envía el monto EXACTO que se muestra — incluso unos centavos de diferencia pueden causar problemas.",
    "Asegúrate de seleccionar la red correcta (por ej. USDT en TRC20 o BSC — coincide con lo que dice el checkout).",
    "Los pagos generalmente se confirman en 1–10 minutos. Bitcoin puede tardar más.",
  ],
  guideLink: "Guía completa de cripto →",
};

function CryptoBeginnerGuide({ es }: { es: boolean }) {
  const [open, setOpen] = useState(false);
  const g = es ? GUIDE_ES : GUIDE_EN;

  return (
    <div className="mt-2 rounded-xl border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-[11px] font-semibold text-pnp-textSecondary">{g.trigger}</span>
        <svg
          className={`w-3.5 h-3.5 text-pnp-textSecondary flex-shrink-0 ml-2 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-4 border-t border-white/10 pt-3 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">

          {/* Step 1: Buy */}
          <div>
            <p className="text-[11px] font-bold text-pnp-textPrimary mb-1.5 uppercase tracking-wide">{g.buyTitle}</p>
            <p className="text-[10px] text-pnp-textSecondary/80 mb-2 leading-relaxed">{g.buyIntro}</p>
            <div className="space-y-1.5">
              {g.exchanges.map((ex) => (
                <div key={ex.name} className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-pnp-textPrimary">{ex.name}</span>
                      <p className="text-[10px] text-pnp-textSecondary/70 leading-relaxed mt-0.5">{ex.note}</p>
                    </div>
                    <a
                      href={ex.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 text-[10px] font-semibold text-pnp-accent hover:text-pnp-accentHover transition-colors whitespace-nowrap"
                    >
                      {es ? "Abrir" : "Open"} ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 2: Send */}
          <div>
            <p className="text-[11px] font-bold text-pnp-textPrimary mb-2 uppercase tracking-wide">{g.sendTitle}</p>
            <ol className="space-y-1.5">
              {g.sendSteps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[9px] font-bold text-pnp-textSecondary mt-0.5">{i + 1}</span>
                  <span className="text-[10px] text-pnp-textSecondary/80 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Tips */}
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-2.5 py-2">
            <p className="text-[10px] font-bold text-yellow-400 mb-1.5 uppercase tracking-wide">{g.tipsTitle}</p>
            <ul className="space-y-1">
              {g.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[10px] text-pnp-textSecondary/70 leading-relaxed">
                  <span className="text-yellow-400/60 flex-shrink-0 mt-px">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Link to full guide */}
          <a
            href="/crypto-guide"
            className="block text-center text-[10px] font-semibold text-pnp-textSecondary/60 hover:text-pnp-textSecondary transition-colors underline decoration-dotted"
          >
            {g.guideLink}
          </a>
        </div>
      )}
    </div>
  );
}

export const NowPaymentsWaitingPanel: React.FC<NowPaymentsWaitingPanelProps> = ({
  order,
  isSuccess,
  isConfirming = false,
  onCancel,
  lang,
  wrapperClassName = "",
  payCurrency = null,
}) => {
  const es = lang === "es";
  const isBsc = payCurrency === "usdtbsc" || payCurrency === "usdcbsc";
  const isSolana = payCurrency === "usdcsol";

  // popup ref for window.open pattern (FIX NP-C-01)
  const paymentPopupRef = useRef<Window | null>(null);

  // Close the popup when payment succeeds
  useEffect(() => {
    if (isSuccess && paymentPopupRef.current) {
      paymentPopupRef.current.close();
      paymentPopupRef.current = null;
    }
  }, [isSuccess]);

  function openPaymentPopup() {
    const invoiceUrl = order.invoiceUrl;
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.openLink(invoiceUrl);
      return;
    }
    const w = 500;
    const h = 700;
    const left = Math.round((window.screen.width - w) / 2);
    const top = Math.round((window.screen.height - h) / 2);
    paymentPopupRef.current = window.open(
      invoiceUrl,
      "np_payment",
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  }

  if (isSuccess) {
    return (
      <div className={`flex flex-col items-center gap-3 py-6 px-4 rounded-xl border border-green-500/40 bg-green-500/5 animate-in fade-in zoom-in duration-300 ${wrapperClassName}`}>
        <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
          <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-base font-semibold text-green-400">{es ? "¡Pago confirmado!" : "Payment confirmed!"}</p>
        <p className="text-xs text-pnp-textSecondary">{es ? "Tu suscripción ya está activa." : "Your subscription is now active."}</p>
      </div>
    );
  }

  const metaMaskUrl = `https://metamask.app.link/dapp/${order.invoiceUrl.replace(/^https?:\/\//, '')}`;
  const trustWalletBscUrl = `https://link.trustwallet.com/open_url?coin_id=20000714&url=${encodeURIComponent(order.invoiceUrl)}`;
  const trustWalletSolUrl = `https://link.trustwallet.com/open_url?coin_id=501&url=${encodeURIComponent(order.invoiceUrl)}`;

  return (
    <div className={`rounded-xl border border-green-500/40 bg-green-500/5 p-3 animate-in fade-in slide-in-from-top-1 duration-250 ${wrapperClassName}`}>
      {/* Status dot */}
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full animate-pulse flex-shrink-0 ${isConfirming ? "bg-yellow-500" : "bg-green-500"}`} />
        <span className="text-sm font-medium text-pnp-textPrimary">
          {isConfirming
            ? (es ? "Pago detectado" : "Payment detected")
            : (es ? "Esperando pago" : "Waiting for payment")}
        </span>
        <span className="ml-auto text-[10px] text-pnp-textSecondary/60 flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse inline-block ${isConfirming ? "bg-yellow-400" : "bg-green-400"}`} />
          {isConfirming
            ? (es ? "Esperando confirmación de red…" : "Waiting for network confirmation…")
            : (es ? "Auto-verificando…" : "Auto-checking…")}
        </span>
      </div>

      {/* Confirming notice */}
      {isConfirming && (
        <div className="mb-3 rounded-lg border border-yellow-500/30 bg-yellow-500/8 px-3 py-2 text-[11px] text-yellow-300/90 leading-relaxed">
          {es
            ? "Tu pago fue detectado y está siendo confirmado por la red. Esto puede tardar de 1 a 30 minutos dependiendo de la moneda. No cierres esta página."
            : "Your payment was detected and is being confirmed by the network. This can take 1–30 minutes depending on the coin. Don't close this page."}
        </div>
      )}

      {/* BSC wallet shortcuts — MetaMask, Trust Wallet, other */}
      {isBsc && (
        <>
          <p className="text-[10px] text-pnp-textSecondary/70 mb-2">
            {es ? "Abre directamente en tu billetera:" : "Open directly in your wallet:"}
          </p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <a
              href={metaMaskUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-orange-500/30 bg-orange-500/8 hover:bg-orange-500/15 transition-colors active:scale-[0.97]"
            >
              <span className="text-xl leading-none">🦊</span>
              <span className="text-[10px] font-bold text-orange-300">MetaMask</span>
            </a>
            <a
              href={trustWalletBscUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-sky-500/30 bg-sky-500/8 hover:bg-sky-500/15 transition-colors active:scale-[0.97]"
            >
              <span className="text-xl leading-none">🔵</span>
              <span className="text-[10px] font-bold text-sky-300">Trust Wallet</span>
            </a>
            <a
              href={order.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl border border-yellow-500/30 bg-yellow-500/8 hover:bg-yellow-500/15 transition-colors active:scale-[0.97]"
            >
              <span className="text-xl leading-none">🌐</span>
              <span className="text-[10px] font-bold text-yellow-300">{es ? "Otra billetera" : "Other wallet"}</span>
            </a>
          </div>
        </>
      )}

      {/* Solana / Trust Wallet CTA */}
      {isSolana && (
        <a
          href={trustWalletSolUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm text-white mb-3 transition-all active:scale-[0.98]"
          style={{ background: "linear-gradient(90deg, #3375BB, #0A2B6E)" }}
        >
          <span>🔵</span>
          {es ? "Pagar con Trust Wallet" : "Pay with Trust Wallet"}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {/* Primary CTA — open NowPayments checkout in popup */}
      {!isConfirming && (
        <button
          type="button"
          onClick={openPaymentPopup}
          className="w-full flex items-center justify-center gap-2 py-3 mb-3 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.98] bg-pnp-accent hover:bg-pnp-accentHover"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          {es ? "Abrir página de pago" : "Open Payment Page"}
        </button>
      )}

      {/* MoonPay delay notice */}
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 mb-2 text-[10px] text-pnp-textSecondary/70 leading-relaxed space-y-1">
        <p>
          {es
            ? "⚠️ Si pagaste con MoonPay, la entrega puede tardar hasta 24 h. Tu suscripción se activará automáticamente cuando llegue el pago."
            : "⚠️ If you paid via MoonPay, delivery can take up to 24 h. Your subscription activates automatically once the payment arrives."}
        </p>
        <p>
          {es
            ? "💡 Para evitar esperas, usa crypto que ya tengas en Binance, Coinbase, Kraken u otra billetera — el pago llega en minutos."
            : "💡 To avoid waiting, send crypto you already own from Binance, Coinbase, Kraken, or any wallet — payment arrives in minutes."}
        </p>
      </div>

      {/* Fallback direct link — shown when confirming or as secondary option */}
      <div className="flex gap-2 mb-2">
        <a
          href={order.invoiceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-2 rounded-lg text-center text-[11px] text-pnp-textSecondary border border-white/10 bg-white/5 hover:text-pnp-textPrimary transition-colors"
        >
          {es ? "Abrir enlace directamente →" : "Open link directly →"}
        </a>
      </div>

      {/* Beginner guide — collapsed by default */}
      <CryptoBeginnerGuide es={es} />

      <button
        onClick={onCancel}
        className="w-full text-[10px] text-pnp-textSecondary/50 hover:text-pnp-textSecondary transition-colors py-1 mt-2"
      >
        {es ? "Cancelar y elegir otro plan" : "Cancel — choose a different plan"}
      </button>
    </div>
  );
};
