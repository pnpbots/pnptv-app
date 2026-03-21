import React, { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { QRCodeSVG } from "qrcode.react";
import {
  getWalletBalance,
  getTokenPackages,
  buyTokens,
  buyTokensCard,
  buyTokensWallet,
  getDashPaymentDetails,
  assertPaymentUrl,
  type TokenPackage,
} from "@/lib/api";

interface BuyTokensModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newBalance: number) => void;
  dpnsHandle?: string | null;
}

export function BuyTokensModal({ isOpen, onClose, onSuccess, dpnsHandle }: BuyTokensModalProps) {
  const t = useI18n();
  const [buyMethod, setBuyMethod] = useState<'select' | 'card' | 'wallet' | 'dash'>('select');
  const [tokenPackages, setTokenPackages] = useState<TokenPackage[]>([]);
  const [buyingPackage, setBuyingPackage] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [loadingPackages, setLoadingPackages] = useState(false);

  // Dash in-app payment state
  const [dashPayment, setDashPayment] = useState<{
    invoiceId: string;
    checkoutUrl: string;
    destination?: string;
    amount?: string;
    invoiceAmount?: number;
    loading: boolean;
    error?: string;
    createdAt: number;
  } | null>(null);
  const [dashCopied, setDashCopied] = useState(false);
  const [dashSecondsLeft, setDashSecondsLeft] = useState(900);
  const [dashPaymentSuccess, setDashPaymentSuccess] = useState(false);
  const dashPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dashCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoadingPackages(true);
      getTokenPackages()
        .then((data) => setTokenPackages(data.packages || []))
        .catch(() => setBuyError("Failed to load token packages."))
        .finally(() => setLoadingPackages(false));
    } else {
      // Reset state when closing
      setBuyMethod('select');
      setBuyError(null);
      setBuyingPackage(null);
      setDashPayment(null);
      setDashCopied(false);
      setDashSecondsLeft(900);
      setDashPaymentSuccess(false);
      if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
      if (dashCountdownRef.current) { clearInterval(dashCountdownRef.current); dashCountdownRef.current = null; }
    }
  }, [isOpen]);

  // Countdown timer for Dash invoice (15-minute expiry)
  useEffect(() => {
    if (!dashPayment) {
      if (dashCountdownRef.current) {
        clearInterval(dashCountdownRef.current);
        dashCountdownRef.current = null;
      }
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - dashPayment.createdAt) / 1000);
      const remaining = Math.max(0, 900 - elapsed);
      setDashSecondsLeft(remaining);
      if (remaining === 0) {
        if (dashCountdownRef.current) {
          clearInterval(dashCountdownRef.current);
          dashCountdownRef.current = null;
        }
        if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
      }
    };
    tick();
    dashCountdownRef.current = setInterval(tick, 1000);
    return () => {
      if (dashCountdownRef.current) {
        clearInterval(dashCountdownRef.current);
        dashCountdownRef.current = null;
      }
    };
  }, [dashPayment]);

  const handleBuyTokens = async (pkg: TokenPackage) => {
    setBuyingPackage(pkg.id);
    setBuyError(null);
    try {
      let checkoutUrl: string;
      let openedPopup: Window | null = null;
      
      if (buyMethod === 'card') {
        const result = await buyTokensCard(pkg.id);
        checkoutUrl = assertPaymentUrl(result.checkoutUrl);
        openedPopup = window.open(checkoutUrl, "_blank", "noopener,width=600,height=700");
      } else if (buyMethod === 'wallet') {
        const result = await buyTokensWallet(pkg.id);
        checkoutUrl = assertPaymentUrl(result.checkoutUrl);
        openedPopup = window.open(checkoutUrl, "_blank", "noopener,width=600,height=700");
      } else {
        // Dash — show in-app payment widget instead of popup
        const result = await buyTokens(pkg.id);
        const safeUrl = assertPaymentUrl(result.checkoutUrl);
        setDashPayment({ invoiceId: result.invoiceId, checkoutUrl: safeUrl, loading: true, createdAt: Date.now() });
        setDashSecondsLeft(900);
        setBuyingPackage(null);

        // Fetch payment details for in-app widget
        getDashPaymentDetails(result.invoiceId)
          .then((details) => {
            if (details.success) {
              setDashPayment((prev) => prev ? {
                ...prev,
                destination: details.destination,
                amount: details.amount,
                invoiceAmount: details.invoiceAmount ?? undefined,
                loading: false,
              } : prev);
            } else {
              setDashPayment((prev) => prev ? { ...prev, loading: false, error: "Could not load payment details" } : prev);
            }
          })
          .catch(() => {
            setDashPayment((prev) => prev ? { ...prev, loading: false, error: "Could not load payment details" } : prev);
          });

        // Poll for payment confirmation
        dashPollRef.current = setInterval(async () => {
          try {
            const balRes = await getWalletBalance();
            if (typeof balRes.balance === 'number' && balRes.balance > 0) {
              if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
              setDashPaymentSuccess(true);
              setTimeout(() => {
                if (onSuccess) onSuccess(balRes.balance);
                onClose();
              }, 1500);
            }
          } catch { /* ignore */ }
        }, 5000);

        return; // Skip the popup logic below
      }

      if (!openedPopup) {
        setBuyError("Your browser blocked the payment popup. Please allow popups for this site and try again.");
        return;
      }

      onClose();

      // Fallback balance refresh 15s after checkout opens (in case Socket.IO event is missed)
      setTimeout(() => {
        getWalletBalance().then((res) => {
          if (typeof res.balance === 'number' && onSuccess) {
            onSuccess(res.balance);
          }
        }).catch(() => {});
      }, 15_000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("not available") || msg.includes("not configured")) {
        setBuyError(t.live.errorDashUnavailable);
      } else if (msg.includes("temporarily unavailable")) {
        setBuyError(t.live.errorPaymentServerDown);
      } else {
        setBuyError(msg || t.live.errorFailedToOpenCheckout);
      }
    } finally {
      setBuyingPackage(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header — shared between both steps */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {buyMethod !== 'select' && (
              <button
                onClick={() => { setBuyMethod('select'); setBuyError(null); }}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-pnp-surface hover:bg-pnp-surfaceHover transition-colors"
                aria-label="Back to payment method selection"
              >
                <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-base font-bold text-pnp-textPrimary">
              {buyMethod === 'select' ? 'Buy PNP Tokens' : 'Choose a Package'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step 1: Payment method selector */}
        {buyMethod === 'select' && (
          <div className="space-y-2">
            <p className="text-xs text-pnp-textSecondary mb-3">
              Select how you want to pay for your tokens.
            </p>

            {/* Card */}
            <button
              onClick={() => setBuyMethod('card')}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-green-500/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
            >
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(76,175,80,0.15)" }}>
                <svg className="w-5 h-5" style={{ color: "#4CAF50" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2 10h20" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-pnp-textPrimary">Buy with Card</p>
                <p className="text-xs text-pnp-textSecondary truncate">Visa, Mastercard, PSE</p>
              </div>
              <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Wallet */}
            <button
              onClick={() => setBuyMethod('wallet')}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-violet-500/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
            >
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(124,58,237,0.15)" }}>
                <svg className="w-5 h-5" style={{ color: "#7C3AED" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-pnp-textPrimary">Buy with Wallet</p>
                <p className="text-xs text-pnp-textSecondary truncate">USDC on Base — fast &amp; easy</p>
              </div>
              <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Dash / Privacy */}
            <button
              onClick={() => setBuyMethod('dash')}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-sky-400/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
            >
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(0,140,231,0.15)" }}>
                <svg className="w-5 h-5" style={{ color: "#008CE7" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-pnp-textPrimary">Buy with More Privacy</p>
                <p className="text-xs text-pnp-textSecondary truncate">Dash cryptocurrency</p>
              </div>
              <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* Dash in-app payment widget */}
        {dashPayment && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-[#008DE4] animate-pulse" />
              <span className="text-sm font-medium text-pnp-textPrimary">Waiting for Dash payment...</span>
            </div>

            {dashPaymentSuccess ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
                  <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-base font-semibold text-green-400">Tokens added!</p>
                <p className="text-xs text-pnp-textSecondary">Your balance has been updated.</p>
              </div>
            ) : dashSecondsLeft === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <p className="text-sm font-medium text-red-400">Invoice expired</p>
                <p className="text-xs text-pnp-textSecondary text-center">The 15-minute payment window has closed.</p>
                <button
                  onClick={() => { setDashPayment(null); setDashCopied(false); setDashSecondsLeft(900); }}
                  className="mt-1 px-4 py-2 rounded-lg bg-[#008DE4] text-white text-xs font-semibold hover:bg-[#0070b8] transition-colors"
                >
                  Try Again
                </button>
              </div>
            ) : dashPayment.loading ? (
              <div className="flex flex-col items-center py-6 gap-3">
                <svg className="animate-spin h-6 w-6 text-[#008DE4]" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-xs text-pnp-textSecondary">Loading payment details...</p>
              </div>
            ) : dashPayment.destination && dashPayment.amount ? (
              <div className="flex flex-col items-center gap-3">
                <div className="bg-white p-3 rounded-xl">
                  <QRCodeSVG
                    value={`dash:${dashPayment.destination}?amount=${dashPayment.amount}`}
                    size={160}
                    level="M"
                  />
                </div>
                <p className="text-[10px] text-pnp-textSecondary">Scan with your Dash wallet</p>

                <div className="text-center">
                  <p className="text-lg font-bold text-white">{dashPayment.amount} DASH</p>
                  {dashPayment.invoiceAmount != null && (
                    <p className="text-xs text-pnp-textSecondary">~${dashPayment.invoiceAmount.toFixed(2)} USD</p>
                  )}
                </div>

                {/* Countdown timer */}
                <p className={`text-xs font-mono tabular-nums ${
                  dashSecondsLeft <= 60
                    ? "text-red-400"
                    : dashSecondsLeft <= 300
                    ? "text-orange-400"
                    : "text-pnp-textSecondary"
                }`}>
                  {String(Math.floor(dashSecondsLeft / 60)).padStart(2, "0")}:{String(dashSecondsLeft % 60).padStart(2, "0")} remaining
                </p>

                <div className="w-full">
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <code className="flex-1 text-[10px] text-white/80 break-all font-mono">{dashPayment.destination}</code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(dashPayment.destination!).catch(() => {});
                        setDashCopied(true);
                        setTimeout(() => setDashCopied(false), 2000);
                      }}
                      className="flex-shrink-0 text-xs font-semibold px-2 py-1 rounded transition-colors"
                      style={{ color: dashCopied ? "#34C759" : "#008DE4" }}
                    >
                      {dashCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <p className="text-xs text-pnp-textSecondary text-center">
                  Send the exact amount to the address above. This page updates automatically.
                </p>

                <a
                  href={dashPayment.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs hover:underline"
                  style={{ color: "#008DE4" }}
                >
                  Open in BTCPay
                </a>
              </div>
            ) : (
              <>
                <p className="text-xs text-pnp-textSecondary mb-3">{dashPayment.error || "Could not load payment details."}</p>
                <a
                  href={dashPayment.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 rounded-xl bg-[#008DE4] text-white text-sm font-semibold hover:bg-[#0070b8] transition-colors"
                >
                  Open Dash Checkout
                </a>
              </>
            )}

            {!dashPaymentSuccess && dashSecondsLeft > 0 && (
            <button
              onClick={() => {
                setDashPayment(null);
                setDashCopied(false);
                setDashSecondsLeft(900);
                if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
              }}
              className="w-full text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors py-1"
            >
              Cancel
            </button>
            )}
          </div>
        )}

        {/* Step 2: Package grid after method selected */}
        {buyMethod !== 'select' && !dashPayment && (
          <>
            {/* Method explanation */}
            <p className="text-xs text-pnp-textSecondary mb-4 leading-relaxed">
              {buyMethod === 'card' && "Pay instantly with your credit or debit card via ePayco. Secure checkout — your card details are never stored on our servers."}
              {buyMethod === 'wallet' && "Pay with USDC stablecoin from any crypto wallet via Daimo. Fast, low fees, and no personal info required."}
              {buyMethod === 'dash' && "Pay with Dash cryptocurrency via BTCPay Server. Maximum privacy — fully anonymous, no account needed."}
            </p>

            {buyError && <p className="text-xs text-pnp-error mb-3">{buyError}</p>}

            {loadingPackages ? (
              <p className="text-sm text-pnp-textSecondary text-center py-6">{t.live.loadingPackages}</p>
            ) : tokenPackages.length === 0 ? (
              <p className="text-sm text-pnp-textSecondary text-center py-6">No packages available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mb-4">
                {tokenPackages.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => handleBuyTokens(pkg)}
                    disabled={buyingPackage === pkg.id}
                    className="p-3 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-pnp-accent/50 active:scale-[0.98] transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
                  >
                    <p className="text-lg font-bold text-pnp-textPrimary">{pkg.tokens}</p>
                    <p className="text-xs text-pnp-textSecondary">{t.live.tokensLabel}</p>
                    <p className="text-sm font-semibold mt-1" style={{
                      color: buyMethod === 'card' ? '#4CAF50' : buyMethod === 'wallet' ? '#7C3AED' : '#008CE7'
                    }}>${pkg.usd}</p>
                    {buyingPackage === pkg.id && (
                      <p className="text-[10px] text-pnp-textSecondary mt-1">{t.live.opening}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Dash-specific DPNS info — only shown for the Dash method */}
            {buyMethod === 'dash' && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-pnp-surface border border-pnp-border/50">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#008CE7" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-[11px] text-pnp-textSecondary">
                  {t.live.buyTokensCheckoutNote}
                  {dpnsHandle && t.live.yourDashIdentity(dpnsHandle)}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
