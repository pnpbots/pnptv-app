import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  getWalletBalance,
  getWalletHistory,
  getPaymentHistory,
  linkDPNS,
  type TokenPurchase,
  type PaymentRecord,
} from "@/lib/api";
import { BuyTokensModal } from "@/components/BuyTokensModal";

// ── PaymentsSettings ──────────────────────────────────────────────────────────

export default function PaymentsSettings() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const t = useI18n();
  const p = t.profile;

  const [dpnsHandle, setDpnsHandle] = useState<string | null>(null);
  const [dpnsInput, setDpnsInput] = useState("");
  const [dpnsSaving, setDpnsSaving] = useState(false);
  const [dpnsError, setDpnsError] = useState<string | null>(null);
  const [showDpnsInput, setShowDpnsInput] = useState(false);
  const [dpnsSuccess, setDpnsSuccess] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [txHistory, setTxHistory] = useState<TokenPurchase[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [payHistory, setPayHistory] = useState<PaymentRecord[]>([]);
  const [payHistoryLoading, setPayHistoryLoading] = useState(false);
  const [showPayHistory, setShowPayHistory] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    getWalletBalance()
      .then((walletRes) => {
        if (cancelled) return;
        setDpnsHandle(walletRes.dpnsHandle ?? null);
        setTokenBalance(walletRes.balance ?? 0);
      })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const handleSaveDpns = useCallback(async () => {
    const handle = dpnsInput.trim();
    if (!handle || dpnsSaving) return;
    if (!/^[a-z0-9_-]{3,63}(\.dash)?$/i.test(handle)) {
      setDpnsError(p.dpnsInvalidFormat);
      return;
    }
    setDpnsSaving(true);
    setDpnsError(null);
    try {
      const result = await linkDPNS(handle);
      setDpnsHandle(result.dpnsHandle);
      setShowDpnsInput(false);
      setDpnsInput("");
      setDpnsSuccess(true);
      setTimeout(() => setDpnsSuccess(false), 3000);
    } catch (err) {
      setDpnsError(err instanceof Error ? err.message : "Failed to link DPNS");
    } finally {
      setDpnsSaving(false);
    }
  }, [dpnsInput, dpnsSaving, p]);

  const handleShowHistory = useCallback(async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    setTxLoading(true);
    try {
      const res = await getWalletHistory();
      setTxHistory(res.history || []);
    } catch {
      setTxHistory([]);
    }
    setTxLoading(false);
  }, [showHistory]);

  const handleShowPayHistory = useCallback(async () => {
    if (showPayHistory) { setShowPayHistory(false); return; }
    setShowPayHistory(true);
    setPayHistoryLoading(true);
    try {
      const res = await getPaymentHistory();
      setPayHistory(res.payments || []);
    } catch {
      setPayHistory([]);
    }
    setPayHistoryLoading(false);
  }, [showPayHistory]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="glass-card-sm p-5">
          <div className="h-4 rounded bg-white/10 animate-pulse w-32 mb-4" />
          <div className="h-12 rounded bg-white/5 animate-pulse mb-3" />
          <div className="h-12 rounded bg-white/5 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          {p.walletDashSection}
        </h2>
        <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary)" }}>
          {p.walletDashDesc}
        </p>

        {/* Token balance */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-3 mb-3"
          style={{ background: "rgba(0,141,228,0.06)", border: "1px solid rgba(0,141,228,0.2)" }}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#008DE4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
            <span className="text-sm font-medium text-white">{p.dpnsTokenBalance}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: "#008DE4" }}>{tokenBalance}</span>
            <button
              onClick={() => setShowBuyModal(true)}
              className="text-xs font-semibold px-2.5 py-1 rounded-full transition-colors"
              style={{ background: "rgba(0,141,228,0.25)", color: "#fff" }}
            >
              + {t.lang === "es" ? "Comprar" : "Buy"}
            </button>
          </div>
        </div>

        {/* DPNS handle */}
        <div
          className="rounded-lg px-3 py-3"
          style={{ background: "rgba(0,141,228,0.06)", border: "1px solid rgba(0,141,228,0.2)" }}
        >
          {dpnsHandle ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{p.dpnsLinked}</span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(0,141,228,0.2)", color: "#008DE4" }}
                >
                  @{dpnsHandle}
                </span>
              </div>
              <button
                onClick={() => { setShowDpnsInput(!showDpnsInput); setDpnsInput(dpnsHandle); setDpnsError(null); }}
                className="text-xs hover:underline transition-colors"
                style={{ color: "#008DE4" }}
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">{p.dpnsLinked}</span>
              <button
                onClick={() => { setShowDpnsInput(true); setDpnsError(null); }}
                className="text-xs font-semibold px-3 py-1 rounded-lg transition-colors"
                style={{ background: "rgba(0,141,228,0.2)", color: "#008DE4" }}
              >
                {p.linkDpnsIdentity}
              </button>
            </div>
          )}

          {showDpnsInput && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={dpnsInput}
                onChange={(e) => { setDpnsInput(e.target.value); setDpnsError(null); }}
                placeholder={p.dpnsPlaceholder}
                disabled={dpnsSaving}
                className="flex-1 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#008DE4]/40 disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontSize: "16px",
                }}
              />
              <button
                onClick={handleSaveDpns}
                disabled={!dpnsInput.trim() || dpnsSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "#008DE4" }}
              >
                {dpnsSaving ? p.dpnsSaving : p.dpnsSave}
              </button>
            </div>
          )}

          {dpnsError && <p className="mt-2 text-xs" style={{ color: "#FF6B6B" }}>{dpnsError}</p>}
          {dpnsSuccess && <p className="mt-2 text-xs" style={{ color: "#34C759" }}>{p.dpnsSaved}</p>}
        </div>

        {/* Transaction History */}
        <div className="mt-3">
          <button
            onClick={handleShowHistory}
            className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            style={{ background: "rgba(0,141,228,0.08)", border: "1px solid rgba(0,141,228,0.18)", color: "#008DE4" }}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {showHistory ? p.txHistoryHide : p.txHistoryToggle}
            </span>
            <svg
              className="w-4 h-4 flex-shrink-0 transition-transform"
              style={{ transform: showHistory ? "rotate(180deg)" : "rotate(0deg)" }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showHistory && (
            <div className="mt-2 space-y-1.5">
              {txLoading ? (
                <>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                  ))}
                </>
              ) : txHistory.length === 0 ? (
                <div
                  className="rounded-lg px-3 py-4 text-center text-sm"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--pnp-text-secondary)" }}
                >
                  {p.txHistoryEmpty}
                </div>
              ) : (
                txHistory.map((tx) => {
                  const dateStr = new Date(tx.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                  const method = (tx.payment_method ?? "").toLowerCase();
                  const methodLabel =
                    method === "dash" || method === "btcpay" ? p.txMethodDash :
                    method === "card" || method === "epayco" || method === "tokenized_card" ? p.txMethodCard :
                    method === "usdc" ? p.txMethodUsdc :
                    method === "usdt" ? p.txMethodUsdt :
                    method === "wallet" ? p.txMethodWallet :
                    p.txMethodDash;
                  const methodColor =
                    method === "dash" || method === "btcpay" ? { bg: "rgba(0,141,228,0.15)", fg: "#008DE4" } :
                    method === "card" || method === "epayco" || method === "tokenized_card" ? { bg: "rgba(52,199,89,0.15)", fg: "#34C759" } :
                    method === "usdc" ? { bg: "rgba(130,80,255,0.15)", fg: "#8250FF" } :
                    method === "usdt" ? { bg: "rgba(38,161,123,0.15)", fg: "#26A17B" } :
                    { bg: "rgba(0,141,228,0.15)", fg: "#008DE4" };
                  const statusLower = (tx.status ?? "").toLowerCase();
                  const statusLabel =
                    statusLower === "settled" || statusLower === "completed" || statusLower === "paid" ? p.txStatusCompleted :
                    statusLower === "expired" || statusLower === "invalid" ? p.txStatusExpired :
                    p.txStatusPending;
                  const statusColor =
                    statusLower === "settled" || statusLower === "completed" || statusLower === "paid"
                      ? { bg: "rgba(52,199,89,0.13)", fg: "#34C759" }
                      : statusLower === "expired" || statusLower === "invalid"
                      ? { bg: "rgba(255,59,48,0.13)", fg: "#FF3B30" }
                      : { bg: "rgba(255,204,0,0.13)", fg: "#FFCC00" };

                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 gap-2"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs" style={{ color: "var(--pnp-text-secondary)" }}>{dateStr}</span>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-xs font-semibold" style={{ color: "#008DE4" }}>+{tx.tokens_credited} tokens</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: methodColor.bg, color: methodColor.fg }}>
                          {methodLabel}
                        </span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: statusColor.bg, color: statusColor.fg }}>
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Payment Transaction History ── */}
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
          {p.payHistorySection}
        </h2>
        <button
          onClick={handleShowPayHistory}
          className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "var(--pnp-text-primary, #fff)" }}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
            {showPayHistory ? p.payHistoryHide : p.payHistoryToggle}
          </span>
          <svg
            className="w-4 h-4 flex-shrink-0 transition-transform"
            style={{ transform: showPayHistory ? "rotate(180deg)" : "rotate(0deg)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showPayHistory && (
          <div className="mt-2 space-y-1.5">
            {payHistoryLoading ? (
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                ))}
              </>
            ) : payHistory.length === 0 ? (
              <div
                className="rounded-lg px-3 py-4 text-center text-sm"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--pnp-text-secondary)" }}
              >
                {p.payHistoryEmpty}
              </div>
            ) : (
              payHistory.map((pay) => {
                const dateStr = new Date(pay.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

                const providerRaw = (pay.provider ?? pay.payment_method ?? "").toLowerCase();
                const providerLabel =
                  providerRaw === "dash" || providerRaw === "btcpay" ? p.txMethodDash :
                  providerRaw === "nowpayments" ? p.txMethodNowpayments :
                  providerRaw === "epayco" || providerRaw === "card" || providerRaw === "tokenized_card" ? p.txMethodCard :
                  providerRaw === "usdc" ? p.txMethodUsdc :
                  providerRaw === "usdt" ? p.txMethodUsdt :
                  providerRaw === "btc" ? p.txMethodBtc :
                  providerRaw === "manual" ? p.txMethodManual :
                  providerRaw === "stripe" ? "Stripe" :
                  providerRaw || null;

                const providerColor =
                  providerRaw === "dash" || providerRaw === "btcpay" ? { bg: "rgba(0,141,228,0.15)", fg: "#008DE4" } :
                  providerRaw === "nowpayments" || providerRaw === "btc" ? { bg: "rgba(247,147,26,0.15)", fg: "#F7931A" } :
                  providerRaw === "epayco" || providerRaw === "card" ? { bg: "rgba(52,199,89,0.15)", fg: "#34C759" } :
                  providerRaw === "usdc" ? { bg: "rgba(39,117,202,0.15)", fg: "#2775CA" } :
                  providerRaw === "usdt" ? { bg: "rgba(38,161,123,0.15)", fg: "#26A17B" } :
                  providerRaw === "stripe" ? { bg: "rgba(99,91,255,0.15)", fg: "#635BFF" } :
                  { bg: "rgba(255,255,255,0.08)", fg: "var(--pnp-text-secondary)" };

                const statusLower = (pay.status ?? "").toLowerCase();
                const statusLabel =
                  statusLower === "completed" || statusLower === "paid" ? p.txStatusCompleted :
                  statusLower === "failed" ? p.txStatusFailed :
                  statusLower === "cancelled" ? p.txStatusCancelled :
                  statusLower === "refunded" ? p.txStatusRefunded :
                  statusLower === "expired" ? p.txStatusExpired :
                  p.txStatusPending;

                const statusColor =
                  statusLower === "completed" || statusLower === "paid"
                    ? { bg: "rgba(52,199,89,0.13)", fg: "#34C759" }
                    : statusLower === "failed" || statusLower === "cancelled"
                    ? { bg: "rgba(255,59,48,0.13)", fg: "#FF3B30" }
                    : statusLower === "refunded"
                    ? { bg: "rgba(130,80,255,0.13)", fg: "#8250FF" }
                    : statusLower === "expired"
                    ? { bg: "rgba(255,59,48,0.10)", fg: "#FF6B6B" }
                    : { bg: "rgba(255,204,0,0.13)", fg: "#FFCC00" };

                // Derive type label for call packages vs plan vs donation
                const meta = pay.metadata as Record<string, unknown>;
                let typeLabel = pay.plan_name;
                if (meta?.type === "call_package") typeLabel = p.payHistoryCall + (meta.packageSku ? ` (${meta.packageSku})` : "");
                else if (meta?.type === "token_package") typeLabel = p.payHistoryTokens;
                else if (pay.plan_id?.startsWith("donation")) typeLabel = p.payHistoryDonation;

                return (
                  <div
                    key={pay.id}
                    className="rounded-lg px-3 py-3 gap-2"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-medium text-white truncate leading-snug">{typeLabel}</span>
                        <span className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>{dateStr}</span>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm font-bold text-white">
                          ${Number(pay.amount).toFixed(2)}
                          {pay.currency !== "USD" && <span className="text-xs font-normal ml-1" style={{ color: "var(--pnp-text-secondary)" }}>{pay.currency}</span>}
                        </span>
                        <div className="flex items-center gap-1">
                          {providerLabel && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: providerColor.bg, color: providerColor.fg }}>
                              {providerLabel}
                            </span>
                          )}
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: statusColor.bg, color: statusColor.fg }}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── Back to settings ── */}
      <button
        onClick={() => navigate("/settings")}
        className="w-full py-3 rounded-xl text-sm font-medium transition-colors hover:text-white"
        style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {p.back}
      </button>

      <BuyTokensModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        dpnsHandle={dpnsHandle}
        onSuccess={(newBalance) => setTokenBalance(newBalance)}
      />
    </div>
  );
}
