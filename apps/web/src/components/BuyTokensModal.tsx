import React, { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { QRCodeSVG } from "qrcode.react";
import { NowPaymentsWaitingPanel } from "@/components/payments/NowPaymentsWaitingPanel";
import {
  getWalletBalance,
  getTokenPackages,
  buyTokens,
  buyTokensWithBtc,
  buyTokensWithNowPayments,
  getNowPaymentsOrderStatus,
  getBtcAvailable,
  getDashAvailable,
  getBtcSubscriptionStatus,
  getDashPaymentDetails,
  getDashSubscriptionStatus,
  getPresaleStatus,
  assertPaymentUrl,
  NP_COINS,
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
  const [buyMethod, setBuyMethod] = useState<'select' | 'dash' | 'btc' | 'np' | 'np_usdc'>('select');
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

  // BTC popup + poll state
  const btcPopupRef = useRef<Window | null>(null);
  const btcPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [btcPayment, setBtcPayment] = useState<{ invoiceId: string; checkoutUrl: string } | null>(null);
  const [btcSuccess, setBtcSuccess] = useState(false);
  const [btcPolling, setBtcPolling] = useState(false);
  const [btcAvailable, setBtcAvailable] = useState(false);
  const [dashAvailable, setDashAvailable] = useState(false);

  // Presale + creator bonus state
  const [presaleActive, setPresaleActive] = useState(false);
  const [presaleEndsAt, setPresaleEndsAt] = useState<string | null>(null);
  const [creatorBonusActive, setCreatorBonusActive] = useState(false);

  // NowPayments (multi-coin + USDT BSC) balance-delta poll state
  const npPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [npCoinPick, setNpCoinPick] = useState<string>("btc");
  const [npPickerOpen, setNpPickerOpen] = useState(false);
  const [npPayment, setNpPayment] = useState<{
    invoiceId: string;
    checkoutUrl: string;
    nowpaymentsInvoiceId?: string;
    payCurrency?: string;
    usdAmount?: number;
    tokens?: number;
  } | null>(null);
  const [npSuccess, setNpSuccess] = useState(false);
  const [npPolling, setNpPolling] = useState(false);

  useEffect(() => {
    getBtcAvailable().then((r) => setBtcAvailable(r.available === true)).catch(() => {});
    getDashAvailable().then((r) => setDashAvailable(r.available === true)).catch(() => {});
    getPresaleStatus().then((r) => {
      if (r.presale?.active) {
        setPresaleActive(true);
        setPresaleEndsAt(r.presale.endsAt);
      }
      if (r.creatorBonus?.active) {
        setCreatorBonusActive(true);
      }
    }).catch(() => {});
  }, []);

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
      setBtcPayment(null);
      setBtcSuccess(false);
      setBtcPolling(false);
      if (btcPollRef.current) { clearInterval(btcPollRef.current); btcPollRef.current = null; }
      btcPopupRef.current?.close();
      btcPopupRef.current = null;
      setNpPayment(null);
      setNpSuccess(false);
      setNpPolling(false);
      if (npPollRef.current) { clearInterval(npPollRef.current); npPollRef.current = null; }
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

      // Poll for payment confirmation using the invoice status, not wallet balance.
      // Wallet balance is pre-existing and would produce false positives for users who
      // already have tokens.
      const pollInvoiceId = result.invoiceId;
      dashPollRef.current = setInterval(async () => {
        try {
          const statusRes = await getDashSubscriptionStatus(pollInvoiceId);
          if (statusRes.status === 'completed') {
            if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
            setDashPaymentSuccess(true);
            // Fetch the updated balance to pass to onSuccess.
            const balRes = await getWalletBalance().catch(() => ({ balance: 0 }));
            setTimeout(() => {
              if (onSuccess) onSuccess(balRes.balance);
              onClose();
            }, 1500);
          } else if (statusRes.status === 'expired' || statusRes.status === 'invalid') {
            if (dashPollRef.current) { clearInterval(dashPollRef.current); dashPollRef.current = null; }
              setDashPayment((prev) => prev ? { ...prev, error: 'Invoice expired. Please try again.' } : prev);
            }
          } catch { /* network hiccup — keep polling */ }
        }, 5000);

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

  const handleBuyTokensBtc = async (pkg: TokenPackage) => {
    setBuyingPackage(pkg.id);
    setBuyError(null);
    try {
      const result = await buyTokensWithBtc(pkg.id);
      if (!result.success || !result.invoiceId) {
        setBuyError(result.error || "Failed to create Bitcoin invoice. Please try again.");
        setBuyingPackage(null);
        return;
      }
      const checkoutUrl = result.checkoutUrl;
      setBtcPayment({ invoiceId: result.invoiceId, checkoutUrl });
      setBtcPolling(true);
      setBtcSuccess(false);
      const pw = 560, ph = 780;
      const pl = Math.round(window.screenX + (window.outerWidth - pw) / 2);
      const pt = Math.round(window.screenY + (window.outerHeight - ph) / 2);
      btcPopupRef.current = window.open(
        checkoutUrl,
        'btcpay_btc_checkout',
        `width=${pw},height=${ph},left=${pl},top=${pt},resizable=yes,scrollbars=yes,noopener,noreferrer`
      );
      const pollInvoiceId = result.invoiceId;
      if (btcPollRef.current) clearInterval(btcPollRef.current);
      btcPollRef.current = setInterval(async () => {
        try {
          const statusRes = await getBtcSubscriptionStatus(pollInvoiceId);
          if (statusRes.completed) {
            if (btcPollRef.current) { clearInterval(btcPollRef.current); btcPollRef.current = null; }
            btcPopupRef.current?.close();
            btcPopupRef.current = null;
            setBtcPolling(false);
            setBtcSuccess(true);
            const balRes = await getWalletBalance().catch(() => ({ balance: 0 }));
            setTimeout(() => {
              if (onSuccess) onSuccess(balRes.balance);
              onClose();
            }, 1500);
          } else if (statusRes.failed) {
            if (btcPollRef.current) { clearInterval(btcPollRef.current); btcPollRef.current = null; }
            setBtcPolling(false);
            setBtcPayment(null);
            setBuyError('Invoice expired or failed. Please try again.');
          }
        } catch { /* network hiccup — keep polling */ }
      }, 10000);
    } catch (err: unknown) {
      setBuyError(err instanceof Error ? err.message : "Failed to create Bitcoin invoice.");
    } finally {
      setBuyingPackage(null);
    }
  };

  const handleBuyTokensNowPayments = async (pkg: TokenPackage, payCurrency?: string) => {
    setBuyingPackage(pkg.id);
    setBuyError(null);
    try {
      const result = await buyTokensWithNowPayments(pkg.id, payCurrency);
      if (!result.success || !result.invoiceId || !result.checkoutUrl) {
        setBuyError(result.error || "Failed to create crypto invoice. Please try again.");
        setBuyingPackage(null);
        return;
      }
      const safeUrl = assertPaymentUrl(result.checkoutUrl);
      setNpPayment({
        invoiceId: result.invoiceId,
        checkoutUrl: safeUrl,
        nowpaymentsInvoiceId: result.nowpaymentsInvoiceId || undefined,
        payCurrency: payCurrency || undefined,
        usdAmount: pkg.usd,
        tokens: pkg.tokens,
      });
      setNpPolling(true);
      setNpSuccess(false);

      // Poll the DSO status by order id every 6s. Order-based signal avoids
      // the false-positive where an unrelated credit (tip, admin grant, refund)
      // fires the success handler mid-purchase. 30-min cap.
      const pollOrderId = result.invoiceId;
      if (npPollRef.current) clearInterval(npPollRef.current);
      const startedAt = Date.now();
      const maxDurationMs = 30 * 60 * 1000;
      npPollRef.current = setInterval(async () => {
        if (Date.now() - startedAt >= maxDurationMs) {
          if (npPollRef.current) { clearInterval(npPollRef.current); npPollRef.current = null; }
          setNpPolling(false);
          return;
        }
        try {
          const st = await getNowPaymentsOrderStatus(pollOrderId);
          if (st.completed) {
            if (npPollRef.current) { clearInterval(npPollRef.current); npPollRef.current = null; }
            setNpPolling(false);
            setNpSuccess(true);
            // Refresh balance once for the success callback + parent handler.
            const bal = await getWalletBalance().catch(() => ({ balance: 0 }));
            setTimeout(() => {
              if (onSuccess) onSuccess(bal.balance);
              onClose();
            }, 1500);
          } else if (st.failed) {
            if (npPollRef.current) { clearInterval(npPollRef.current); npPollRef.current = null; }
            setNpPolling(false);
            setBuyError(t.lang === "es"
              ? "El pago no se pudo confirmar. Intenta con otro método."
              : "Payment could not be confirmed. Try another method.");
          }
        } catch { /* keep polling */ }
      }, 6000);
    } catch (err: unknown) {
      setBuyError(err instanceof Error ? err.message : "Failed to create crypto invoice.");
    } finally {
      setBuyingPackage(null);
    }
  };

  if (!isOpen) return null;

  const es = t.lang === "es";
  const headerTitle = buyMethod === 'select'
    ? (es ? 'Comprar Tokens' : 'Buy Tokens')
    : (es ? 'Elige tu paquete' : 'Choose your package');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="buy-tokens-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      tabIndex={-1}
    >
      <div
        className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header — shared between both steps */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {buyMethod !== 'select' && !btcPayment && !npPayment && (
              <button
                onClick={() => { setBuyMethod('select'); setBuyError(null); }}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-pnp-surface hover:bg-pnp-surfaceHover transition-colors"
                aria-label={es ? 'Volver a métodos de pago' : 'Back to payment method selection'}
              >
                <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 id="buy-tokens-title" className="text-base font-bold text-pnp-textPrimary">
              {headerTitle}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-full text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
            aria-label={es ? 'Cerrar' : 'Close'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step 1: Payment method selector */}
        {buyMethod === 'select' && (
          <div className="space-y-2">
            {/* Presale banner — discount only applies to NowPayments methods */}
            {presaleActive && (
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-1 text-xs font-semibold animate-pulse"
                style={{ background: "linear-gradient(90deg, rgba(212,0,122,0.18), rgba(230,145,56,0.18))", border: "1px solid rgba(212,0,122,0.35)", color: "#f9a8d4" }}
              >
                <span style={{ fontSize: 15 }}>🔥</span>
                <span>
                  {t.lang === "es"
                    ? "Presale −10% en cripto (multimoneda o USDT-BSC)"
                    : "Presale −10% on crypto (multi-coin or USDT-BSC)"}
                </span>
              </div>
            )}
            {/* Creator weekend bonus banner (visible to all — awareness) */}
            {creatorBonusActive && (
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-1 text-xs font-semibold"
                style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.35)", color: "#6ee7b7" }}
              >
                <span style={{ fontSize: 15 }}>🚀</span>
                <span>Grand Launch Weekend — Creadores ganan +10% este fin de semana</span>
              </div>
            )}
            <p className="text-xs text-pnp-textSecondary mb-3">
              Selecciona cómo quieres comprar tus tokens.
            </p>

            {/* Crypto — NowPayments multi-coin with inline coin picker */}
            <div className={`rounded-xl border transition-colors ${npPickerOpen ? "border-green-500/40 bg-green-500/5" : "border-pnp-border bg-pnp-surface"}`}>
              <button
                onClick={() => setNpPickerOpen(!npPickerOpen)}
                className="w-full flex items-center gap-4 p-4 active:scale-[0.99] transition-all text-left min-h-[64px]"
              >
                <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                  <span className="text-lg leading-none">🪙</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-pnp-textPrimary">Crypto</p>
                  <p className="text-xs text-pnp-textSecondary truncate">
                    {npPickerOpen && npCoinPick ? `Selected: ${NP_COINS.find(c => c.code === npCoinPick)?.label || npCoinPick.toUpperCase()}` : "BTC, ETH, LTC, XMR + more"}
                  </p>
                </div>
                <svg className={`w-4 h-4 flex-shrink-0 text-pnp-textSecondary transition-transform ${npPickerOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {npPickerOpen && (
                <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-200">
                  <p className="text-[10px] text-pnp-textSecondary/60 mb-2">Choose your coin:</p>
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {NP_COINS.map((coin) => (
                      <button
                        key={coin.code}
                        type="button"
                        onClick={() => setNpCoinPick(coin.code)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${npCoinPick === coin.code ? "border-green-400/60 bg-green-500/20 text-pnp-textPrimary" : "border-white/15 bg-white/5 text-pnp-textSecondary hover:bg-white/10"}`}
                      >
                        <span style={{ color: coin.color }}>{coin.icon}</span>
                        <span>{coin.label}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setNpPickerOpen(false); setBuyMethod('np'); }}
                    className="w-full py-2.5 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.98]"
                    style={{ background: "linear-gradient(90deg, #26a17b, #00c896)" }}
                  >
                    Continue with {NP_COINS.find(c => c.code === npCoinPick)?.label || npCoinPick.toUpperCase()} →
                  </button>
                </div>
              )}
            </div>

            {/* USDT BSC */}
            <button
              onClick={() => setBuyMethod('np_usdc')}
              title="Tether (USDT) on BNB Smart Chain — works with MetaMask, Trust Wallet, Binance"
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-emerald-400/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
            >
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(38,161,123,0.15)" }}>
                <span className="text-lg leading-none font-bold" style={{ color: "#26a17b" }}>₮</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-pnp-textPrimary">USDT (BNB Chain)</p>
                <p className="text-xs text-pnp-textSecondary truncate">Tether on BSC — MetaMask, Trust Wallet, Binance</p>
              </div>
              <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Dash crypto — only shown when dashd is synced and DASH-CHAIN is operational */}
            {dashAvailable && <button
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
            </button>}

            {/* Bitcoin / Lightning — only shown when BTCPay has BTC configured */}
            {btcAvailable && <button
              onClick={() => setBuyMethod('btc')}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-orange-400/40 active:scale-[0.99] transition-all text-left min-h-[64px]"
            >
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "rgba(247,147,26,0.15)" }}>
                <span className="text-lg leading-none" style={{ color: "#F7931A" }}>₿</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-pnp-textPrimary">Bitcoin</p>
                <p className="text-xs text-pnp-textSecondary truncate">BTC on-chain or Lightning Network</p>
              </div>
              <svg className="w-4 h-4 flex-shrink-0 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>}
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
                <p className="text-base font-semibold text-green-400">¡Tokens agregados!</p>
                <p className="text-xs text-pnp-textSecondary">Tus tokens ya están disponibles.</p>
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

        {/* BTC waiting panel */}
        {btcPayment && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#F7931A" }} />
              <span className="text-sm font-medium text-pnp-textPrimary">Waiting for Bitcoin payment...</span>
            </div>

            {btcSuccess ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
                  <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-base font-semibold text-green-400">¡Tokens agregados!</p>
                <p className="text-xs text-pnp-textSecondary">Tus tokens ya están disponibles.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-4">
                <p className="text-sm text-pnp-textSecondary text-center">
                  Complete your payment in the BTCPay checkout window. This page will update automatically.
                </p>
                {btcPolling && (
                  <div className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Checking payment status...</span>
                  </div>
                )}
                <div className="flex gap-2 w-full">
                  <a
                    href={btcPayment.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center py-2.5 rounded-xl text-sm font-semibold transition-colors"
                    style={{ background: "rgba(247,147,26,0.15)", color: "#F7931A", border: "1px solid rgba(247,147,26,0.3)" }}
                  >
                    Open Checkout
                  </a>
                  <button
                    onClick={() => {
                      if (btcPollRef.current) { clearInterval(btcPollRef.current); btcPollRef.current = null; }
                      btcPopupRef.current?.close();
                      btcPopupRef.current = null;
                      setBtcPayment(null);
                      setBtcPolling(false);
                    }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* NowPayments (Crypto / USDT BSC) waiting panel */}
        {npPayment && (
          <NowPaymentsWaitingPanel
            order={{
              orderId: npPayment.invoiceId,
              planName: t.lang === "es" ? "Compra de Tokens" : "Token Purchase",
              usdAmount: npPayment.usdAmount || 0,
              invoiceUrl: npPayment.checkoutUrl,
              createdAt: Date.now(),
              nowpaymentsInvoiceId: npPayment.nowpaymentsInvoiceId || "",
              payCurrency: npPayment.payCurrency || null,
            }}
            isSuccess={npSuccess}
            onCancel={() => {
              setNpPayment(null);
              setNpPolling(false);
              setNpSuccess(false);
              if (npPollRef.current) { clearInterval(npPollRef.current); npPollRef.current = null; }
            }}
            lang={t.lang}
            payCurrency={npPayment.payCurrency}
            productKind="tokens"
          />
        )}

        {/* Step 2: Package grid after method selected */}
        {buyMethod !== 'select' && !dashPayment && !btcPayment && !npPayment && (
          <>
            {/* Presale banner on package selection step */}
            {presaleActive && (buyMethod === 'np' || buyMethod === 'np_usdc') && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-xs font-semibold"
                style={{ background: "linear-gradient(90deg, rgba(212,0,122,0.18), rgba(230,145,56,0.18))", border: "1px solid rgba(212,0,122,0.35)", color: "#f9a8d4" }}
              >
                <span>🔥</span>
                <span>
                  {t.lang === "es"
                    ? "Presale activa — −10% de descuento aplicado"
                    : "Presale active — −10% discount applied"}
                </span>
              </div>
            )}
            {/* Method explanation */}
            <p className="text-xs text-pnp-textSecondary mb-4 leading-relaxed">
              {buyMethod === 'btc'
                ? 'Pay with Bitcoin (on-chain or Lightning) via BTCPay Server. A popup will open for checkout.'
                : buyMethod === 'np'
                ? 'Pay with BTC, ETH, USDC, or 100+ other coins via NowPayments. A popup will open for checkout.'
                : buyMethod === 'np_usdc'
                ? 'Pay with Tether (USDT) on BNB Chain — works with MetaMask, Trust Wallet & Binance. A popup will open for checkout.'
                : 'Pay with Dash cryptocurrency via BTCPay Server. Maximum privacy — fully anonymous, no account needed.'}
            </p>

            {buyError && <p className="text-xs text-pnp-error mb-3">{buyError}</p>}

            {loadingPackages ? (
              <p className="text-sm text-pnp-textSecondary text-center py-6">{t.live.loadingPackages}</p>
            ) : tokenPackages.length === 0 ? (
              <p className="text-sm text-pnp-textSecondary text-center py-6">No packages available.</p>
            ) : (
              <>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {tokenPackages.map((pkg) => {
                  const bonusTokens = pkg.bonus > 0 ? pkg.tokens - pkg.usd * 100 : 0;
                  const isNp = buyMethod === 'np' || buyMethod === 'np_usdc';
                  const showPresale = presaleActive && isNp;
                  const displayUsd = showPresale
                    ? Math.round(pkg.usd * 0.9 * 100) / 100
                    : pkg.usd;
                  return (
                    <button
                      key={pkg.id}
                      onClick={() => {
                        if (buyMethod === 'btc') return handleBuyTokensBtc(pkg);
                        if (buyMethod === 'np') return handleBuyTokensNowPayments(pkg, npCoinPick || 'btc');
                        if (buyMethod === 'np_usdc') return handleBuyTokensNowPayments(pkg, 'usdtbsc');
                        return handleBuyTokens(pkg);
                      }}
                      disabled={buyingPackage === pkg.id}
                      className="p-3 rounded-xl border border-pnp-border bg-pnp-surface hover:bg-pnp-surfaceHover hover:border-pnp-accent/50 active:scale-[0.98] transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
                    >
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <p className="text-lg font-bold text-pnp-textPrimary leading-tight">{pkg.tokens.toLocaleString()}</p>
                        {bonusTokens > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 leading-tight whitespace-nowrap" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                            +{bonusTokens.toLocaleString()}
                          </span>
                        )}
                      </div>
                      {bonusTokens > 0 && (
                        <p
                          className="text-[9px] leading-tight mb-1"
                          style={{ color: "#D4007A" }}
                          title={es
                            ? "Estos tokens de bono solo pueden gastarse en streams y contenido de Santino."
                            : "These bonus tokens can only be spent on Santino streams and content."}
                        >
                          +{bonusTokens.toLocaleString()} {es ? "para Santino (solo Santino)" : "Santino only"}
                        </p>
                      )}
                      <p className="text-[11px] text-pnp-textSecondary mb-1">tokens</p>
                      <div className="flex items-center gap-1.5 mb-2">
                        <p className="text-sm font-bold text-pnp-textPrimary leading-none">
                          ${displayUsd.toFixed(2)}
                        </p>
                        {showPresale && (
                          <>
                            <span className="text-[10px] text-pnp-textSecondary line-through leading-none">
                              ${pkg.usd.toFixed(2)}
                            </span>
                            <span className="text-[8px] font-bold px-1 rounded leading-tight" style={{ background: "rgba(212,0,122,0.2)", color: "#f9a8d4" }}>-10%</span>
                          </>
                        )}
                      </div>
                      {buyingPackage === pkg.id && (
                        <p className="text-[10px] text-pnp-textSecondary mt-1">{t.live.opening}</p>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-pnp-textSecondary text-center leading-relaxed mb-3">
                Facturado por <span className="font-medium" style={{ color: "var(--pnp-text-primary, #fff)" }}>EasyBots</span> · Aparece como{" "}
                <span className="font-medium" style={{ color: "var(--pnp-text-primary, #fff)" }}>EasyBots</span> o{" "}
                <span className="font-medium" style={{ color: "var(--pnp-text-primary, #fff)" }}>NowPayments</span> en tu estado de cuenta.{" "}
                Compra final, no reembolsable.
              </p>
              </>
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
