import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { NowPaymentsOrder } from "@/hooks/useNowPayments";

interface NowPaymentsWaitingPanelProps {
  order: NowPaymentsOrder;
  isSuccess: boolean;
  onCancel: () => void;
  lang: string;
  wrapperClassName?: string;
  isSolana?: boolean;
}

function useCountdown(validUntil?: string | null) {
  const [timeLeft, setTimeLeft] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!validUntil) return;
    const tick = () => {
      const ms = new Date(validUntil).getTime() - Date.now();
      if (ms <= 0) { setExpired(true); setTimeLeft("0:00"); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setTimeLeft(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [validUntil]);

  return { timeLeft, expired };
}

function deriveCoinLabel(order: NowPaymentsOrder): string {
  const raw = order.payCurrency || order.network || "CRYPTO";
  return raw.toUpperCase()
    .replace("USDCSOL", "USDC (SOL)")
    .replace("USDCBSC", "USDC (BSC)")
    .replace("USDTBSC", "USDT (BSC)")
    .replace("USDTTRC20", "USDT (TRC-20)")
    .replace("BTCLN", "BTC (Lightning)");
}

export const NowPaymentsWaitingPanel: React.FC<NowPaymentsWaitingPanelProps> = ({
  order,
  isSuccess,
  onCancel,
  lang,
  wrapperClassName = "",
  isSolana = false,
}) => {
  const es = lang === "es";
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const { timeLeft, expired } = useCountdown(order.validUntil);

  const handleCopyAddr = () => {
    navigator.clipboard.writeText(order.payAddress!).catch(() => {});
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(order.invoiceUrl).catch(() => {});
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (isSuccess) {
    return (
      <div className={`flex flex-col items-center gap-3 py-6 px-4 rounded-xl border border-green-500/40 bg-green-500/5 animate-in fade-in zoom-in duration-300 ${wrapperClassName}`}>
        <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
          <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-base font-semibold text-green-400">
          {es ? "¡Pago confirmado!" : "Payment confirmed!"}
        </p>
        <p className="text-xs text-pnp-textSecondary">
          {es ? "Tu suscripción ya está activa." : "Your subscription is now active."}
        </p>
      </div>
    );
  }

  const statusLabel = order.confirming
    ? (es ? "Confirmando en la red…" : "Confirming on-chain…")
    : order.partiallyPaid
    ? (es ? "Pago parcial recibido" : "Partial payment received")
    : (es ? "Esperando pago" : "Waiting for payment");

  const coinLabel = deriveCoinLabel(order);

  // ── Inline embedded view when we have the wallet address ─────────────────
  if (order.payAddress) {
    return (
      <div className={`rounded-xl border border-green-500/40 bg-green-500/5 p-4 animate-in fade-in slide-in-from-top-1 duration-250 ${wrapperClassName}`}>

        {/* Status + countdown */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${order.partiallyPaid ? "bg-yellow-400" : "bg-green-500"}`} />
          <span className="text-sm font-medium text-pnp-textPrimary">{statusLabel}</span>
          {timeLeft && !expired && (
            <span className="ml-auto text-[10px] text-pnp-textSecondary/60 whitespace-nowrap tabular-nums">
              {es ? "Expira en" : "Expires in"}{" "}
              <span className="font-bold text-yellow-400">{timeLeft}</span>
            </span>
          )}
          {expired && (
            <span className="ml-auto text-[10px] text-red-400 font-semibold whitespace-nowrap">
              {es ? "Expirado" : "Expired"}
            </span>
          )}
        </div>

        {order.partiallyPaid && (
          <div className="mb-3 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <p className="text-xs text-yellow-400 font-medium">
              {es
                ? "Pago parcial detectado — envía el monto restante a la misma dirección."
                : "Partial payment detected — send the remaining amount to the same address."}
            </p>
          </div>
        )}

        {/* Coin badge */}
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2.5 py-1 rounded-full bg-green-500/15 border border-green-500/30 text-xs font-bold text-green-300">
            {coinLabel}
          </span>
          {order.network && order.network.toUpperCase() !== (order.payCurrency || "").toUpperCase() && (
            <span className="text-[10px] text-pnp-textSecondary/60">
              {es ? "Red:" : "Network:"} {order.network}
            </span>
          )}
        </div>

        {/* Amount */}
        {order.payAmount != null && (
          <div className="mb-3 p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-[10px] text-pnp-textSecondary mb-1">
              {es ? "Envía exactamente:" : "Send exactly:"}
            </p>
            <p className="text-xl font-black text-pnp-textPrimary tabular-nums">
              {Number(order.payAmount).toLocaleString("en-US", { maximumFractionDigits: 8 })}{" "}
              <span className="text-sm font-semibold text-pnp-textSecondary">{coinLabel}</span>
            </p>
            <p className="text-xs text-pnp-textSecondary/70 mt-0.5">${order.usdAmount} USD</p>
          </div>
        )}

        {/* Wallet address */}
        <div className="mb-3">
          <p className="text-[10px] text-pnp-textSecondary mb-1">
            {es ? "A esta dirección:" : "To this address:"}
          </p>
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10">
            <span className="flex-1 font-mono text-[10px] text-pnp-textPrimary break-all leading-relaxed select-all">
              {order.payAddress}
            </span>
            <button
              onClick={handleCopyAddr}
              className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
                copiedAddr
                  ? "bg-green-500/20 text-green-400"
                  : "bg-white/10 text-pnp-textSecondary hover:text-pnp-textPrimary"
              }`}
            >
              {copiedAddr ? (es ? "✓" : "✓") : (es ? "Copiar" : "Copy")}
            </button>
          </div>
        </div>

        {/* QR — desktop only */}
        <div className="hidden sm:flex flex-col items-center gap-2 mb-4">
          <div className="bg-white p-2 rounded-xl">
            <QRCodeSVG value={order.payAddress} size={110} level="M" />
          </div>
          <p className="text-[10px] text-pnp-textSecondary">
            {es ? "O escanea desde otro dispositivo" : "Or scan from another device"}
          </p>
        </div>

        {/* Trust Wallet CTA (Solana) */}
        {isSolana && (
          <a
            href={`https://link.trustwallet.com/open_url?coin_id=501&url=${encodeURIComponent(order.invoiceUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm text-white mb-2 transition-all active:scale-[0.98]"
            style={{ background: "linear-gradient(90deg, #3375BB, #0A2B6E)" }}
          >
            <span>🔵</span>
            {es ? "Pagar con Trust Wallet" : "Pay with Trust Wallet"}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}

        {/* Secondary: open in NowPayments + copy link */}
        <div className="flex gap-2 mb-3">
          <a
            href={order.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 rounded-lg text-center text-[11px] text-pnp-textSecondary border border-white/10 bg-white/5 hover:text-pnp-textPrimary transition-colors"
          >
            {es ? "Abrir en NowPayments →" : "Open in NowPayments →"}
          </a>
          <button
            onClick={handleCopyUrl}
            title={es ? "Copiar link de pago" : "Copy payment link"}
            className={`px-3 py-2 rounded-lg text-[11px] border transition-colors ${
              copiedUrl
                ? "border-green-500/30 text-green-400 bg-green-500/5"
                : "border-white/10 text-pnp-textSecondary bg-white/5 hover:text-pnp-textPrimary"
            }`}
          >
            {copiedUrl ? "✓" : "⎘"}
          </button>
        </div>

        <button
          onClick={onCancel}
          className="w-full text-[10px] text-pnp-textSecondary/50 hover:text-pnp-textSecondary transition-colors py-1"
        >
          {es ? "Cancelar y elegir otro plan" : "Cancel — choose a different plan"}
        </button>
      </div>
    );
  }

  // ── Fallback: no payAddress — "Open Checkout" button ─────────────────────
  return (
    <div className={`rounded-xl border border-green-500/40 bg-green-500/5 p-4 animate-in fade-in slide-in-from-top-1 duration-250 ${wrapperClassName}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${order.partiallyPaid ? "bg-yellow-400" : "bg-green-500"}`} />
        <span className="text-sm font-medium text-pnp-textPrimary">{statusLabel}</span>
        <span className="ml-auto text-[10px] text-pnp-textSecondary/60 flex items-center gap-1 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          {es ? "Verificando auto…" : "Auto-checking…"}
        </span>
      </div>

      {order.partiallyPaid && (
        <div className="mb-3 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <p className="text-xs text-yellow-400 font-medium">
            {es
              ? "Pago parcial detectado — envía el monto restante a la misma dirección."
              : "Partial payment detected — send the remaining amount to the same address."}
          </p>
        </div>
      )}

      {order.invoiceUrl && (
        <>
          <a
            href={order.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-xl font-bold text-base text-white mb-3 transition-all active:scale-[0.98] shadow-lg shadow-green-500/25 hover:brightness-110"
            style={{ background: "linear-gradient(90deg, #26a17b, #00c896)" }}
          >
            <span>🪙</span>
            {es ? "Abrir Checkout" : "Open Checkout"}
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          {isSolana && (
            <a
              href={`https://link.trustwallet.com/open_url?coin_id=501&url=${encodeURIComponent(order.invoiceUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm text-white mb-2 transition-all active:scale-[0.98]"
              style={{ background: "linear-gradient(90deg, #3375BB, #0A2B6E)" }}
            >
              <span>🔵</span>
              {es ? "Pagar con Trust Wallet" : "Pay with Trust Wallet"}
            </a>
          )}
        </>
      )}

      <button
        onClick={onCancel}
        className="w-full text-[10px] text-pnp-textSecondary/50 hover:text-pnp-textSecondary transition-colors py-1"
      >
        {es ? "Cancelar y elegir otro plan" : "Cancel — choose a different plan"}
      </button>
    </div>
  );
};
