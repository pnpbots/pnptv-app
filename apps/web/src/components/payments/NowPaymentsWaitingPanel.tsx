import React from "react";
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

export const NowPaymentsWaitingPanel: React.FC<NowPaymentsWaitingPanelProps> = ({
  order,
  isSuccess,
  onCancel,
  lang,
  wrapperClassName = "",
  isSolana = false,
}) => {
  const es = lang === "es";
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(order.invoiceUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  return (
    <div className={`rounded-xl border border-green-500/40 bg-green-500/5 p-4 animate-in fade-in slide-in-from-top-1 duration-250 ${wrapperClassName}`}>

      {/* Status header */}
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
          {/* PRIMARY CTA — largest, first thing the eye lands on */}
          <a
            href={order.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-xl font-bold text-base text-white mb-1.5 transition-all active:scale-[0.98] shadow-lg shadow-green-500/25 hover:shadow-green-500/40 hover:brightness-110"
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
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm text-white mb-1.5 transition-all active:scale-[0.98]"
              style={{ background: "linear-gradient(90deg, #3375BB, #0A2B6E)" }}
            >
              <span>🔵</span>
              {es ? "Abrir en Trust Wallet" : "Open in Trust Wallet"}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          <p className="text-center text-[10px] text-pnp-textSecondary/70 mb-4 leading-relaxed">
            {es
              ? "Se abre en una nueva pestaña · Vuelve aquí cuando termines"
              : "Opens in a new tab · Come back here when done"}
          </p>

          {/* Wallet compat note */}
          <p className="text-[10px] text-pnp-textSecondary/60 mb-2">
            {es ? "✓ Compatible con Trust Wallet y otros wallets WalletConnect" : "✓ Compatible with Trust Wallet and other WalletConnect wallets"}
          </p>

          {/* Accepted coins */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {["BTC", "ETH", "USDC", "USDT", "SOL", "LTC", "+100"].map((coin) => (
              <span key={coin} className="px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-[10px] font-semibold text-green-400">
                {coin}
              </span>
            ))}
          </div>

          {/* Steps */}
          <ol className="space-y-2 mb-4">
            {(es
              ? [
                  "Abre el checkout y elige tu moneda favorita.",
                  "Envía el monto exacto a la dirección mostrada.",
                  "Tu cuenta se activa automáticamente al confirmar.",
                ]
              : [
                  "Open checkout and pick your preferred coin.",
                  "Send the exact amount to the address shown.",
                  "Your account activates automatically on confirmation.",
                ]
            ).map((step, i) => (
              <li key={i} className="flex gap-2.5 text-[11px] text-pnp-textSecondary leading-relaxed">
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-[9px] font-black mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          {/* QR — only useful on desktop; pointless on the same phone you'd pay from */}
          <div className="hidden sm:flex flex-col items-center gap-2 mb-4">
            <div className="bg-white p-2 rounded-xl">
              <QRCodeSVG value={order.invoiceUrl} size={110} level="M" />
            </div>
            <p className="text-[10px] text-pnp-textSecondary">
              {es ? "O escanea desde otro dispositivo" : "Or scan from another device"}
            </p>
          </div>

          {/* Copy link */}
          <button
            onClick={handleCopy}
            className={`w-full py-2 rounded-lg text-[11px] font-medium transition-colors border mb-3 ${
              copied
                ? "text-green-400 border-green-500/30 bg-green-500/5"
                : "text-pnp-textSecondary border-white/10 bg-white/5 hover:text-pnp-textPrimary"
            }`}
          >
            {copied
              ? (es ? "¡Link copiado!" : "Copied!")
              : (es ? "Copiar link de pago" : "Copy payment link")}
          </button>
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
