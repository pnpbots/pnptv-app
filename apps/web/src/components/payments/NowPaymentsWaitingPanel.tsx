import React from "react";
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

  const trustWalletUrl = `https://link.trustwallet.com/open_url?coin_id=501&url=${encodeURIComponent(order.invoiceUrl)}`;

  return (
    <div className={`rounded-xl border border-green-500/40 bg-green-500/5 p-3 animate-in fade-in slide-in-from-top-1 duration-250 ${wrapperClassName}`}>
      {/* Status dot */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
        <span className="text-sm font-medium text-pnp-textPrimary">
          {es ? "Esperando pago" : "Waiting for payment"}
        </span>
        <span className="ml-auto text-[10px] text-pnp-textSecondary/60 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          {es ? "Auto-verificando…" : "Auto-checking…"}
        </span>
      </div>

      {/* Trust Wallet CTA — shown when paying with Solana/USDC */}
      {isSolana && (
        <a
          href={trustWalletUrl}
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

      {/* Embedded NowPayments widget */}
      {order.nowpaymentsInvoiceId && (
        <div className="rounded-xl overflow-hidden mb-3 w-full">
          <iframe
            src={`https://nowpayments.io/embeds/payment-widget?iid=${order.nowpaymentsInvoiceId}`}
            width="100%"
            height="696"
            frameBorder="0"
            scrolling="no"
            style={{ overflow: "hidden", display: "block", border: "none", minHeight: 696 }}
            title="NowPayments"
          />
        </div>
      )}

      {/* Fallback + cancel */}
      <div className="flex gap-2 mb-2">
        <a
          href={order.invoiceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-2 rounded-lg text-center text-[11px] text-pnp-textSecondary border border-white/10 bg-white/5 hover:text-pnp-textPrimary transition-colors"
        >
          {es ? "Abrir en NowPayments →" : "Open in NowPayments →"}
        </a>
      </div>
      <button
        onClick={onCancel}
        className="w-full text-[10px] text-pnp-textSecondary/50 hover:text-pnp-textSecondary transition-colors py-1"
      >
        {es ? "Cancelar y elegir otro plan" : "Cancel — choose a different plan"}
      </button>
    </div>
  );
};
