import React, { useState, useEffect, useRef, useCallback } from "react";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import {
  requestWithdrawal,
  getCashoutBalance,
  requestCashout,
  getCashoutHistory,
  getCreatorWallet,
  type ModelWithdrawal,
  type CashoutBalance,
  type CashoutHistoryItem,
  type PayoutLane,
  type PayoutDestinations,
} from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";
import { Info, AlertCircle, RefreshCw, Wallet, ChevronRight, X, Check, Loader } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_CASHOUT_USD = 5;
const POLL_INTERVAL_MS = 60_000;

type CashoutLane = PayoutLane; // re-export for local readability
type PayoutMethod = "bank_transfer" | "dash";

// Display metadata for each cashout lane. Order here drives the lane picker.
const LANE_META: { id: PayoutLane; label: string; icon: string; destField: "address" | "handle" }[] = [
  { id: "meru",      label: "Meru",            icon: "📱", destField: "handle"  },
  { id: "btc",       label: "Bitcoin",         icon: "₿",  destField: "address" },
  { id: "dash",      label: "Dash",            icon: "🥷", destField: "address" },
  { id: "usdt_tron", label: "USDT — TRON",     icon: "💵", destField: "address" },
  { id: "usdt_base", label: "USDT — Base",     icon: "💵", destField: "address" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeUntilAvailable(iso: string | null): { h: number; m: number } | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return null;
  const totalMinutes = Math.ceil(diff / 60_000);
  return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
}

function laneStatusColor(status: string): string {
  if (status === "settled" || status === "completed") return "#5ED1C4";
  if (status === "processing") return "#FFB454";
  if (status === "failed") return "#FF453A";
  return "#8E8E93";
}

function laneLabelKey(lane: CashoutLane, _t: CreatorStrings): string {
  const meta = LANE_META.find((l) => l.id === lane);
  return meta?.label ?? lane;
}

// Pull the destination payload (e.g. {address: "..."} or {handle: "..."}) for a
// lane from the saved destinations blob. Returns null when the creator has not
// saved this lane yet — the modal disables that lane in the picker.
function destForLane(lane: PayoutLane, destinations: PayoutDestinations): Record<string, string> | null {
  const meta = LANE_META.find((l) => l.id === lane);
  if (!meta) return null;
  const entry = (destinations as Record<string, { handle?: string; address?: string } | undefined>)[lane];
  if (!entry) return null;
  if (meta.destField === "handle") {
    return entry.handle ? { handle: entry.handle } : null;
  }
  return entry.address ? { address: entry.address } : null;
}

function statusLabelKey(status: string, t: CreatorStrings): string {
  if (status === "pending") return t.cashoutStatusPending;
  if (status === "processing") return t.cashoutStatusProcessing;
  if (status === "settled" || status === "completed") return t.cashoutStatusSettled;
  if (status === "failed") return t.cashoutStatusFailed;
  return status;
}

// ── Balance card skeleton ─────────────────────────────────────────────────────

function BalanceSkeleton() {
  return (
    <div className="glass-card-sm p-5 animate-pulse" aria-busy="true" aria-label="Loading balance">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="h-3 w-16 rounded bg-white/10" />
          <div className="h-6 w-24 rounded bg-white/10" />
          <div className="h-3 w-20 rounded bg-white/10" />
        </div>
        <div className="space-y-2 flex flex-col items-end">
          <div className="h-3 w-20 rounded bg-white/10" />
          <div className="h-6 w-24 rounded bg-white/10" />
          <div className="h-9 w-28 rounded-xl bg-white/10" />
        </div>
      </div>
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={text}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="ml-1 text-white/30 hover:text-white/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
      >
        <Info size={12} aria-hidden="true" />
      </button>
      {visible && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-52 text-[11px] leading-relaxed rounded-lg px-3 py-2 text-white/80 pointer-events-none"
          style={{ background: "var(--pnp-surface-hover, #2C2C2E)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ── Balance card ──────────────────────────────────────────────────────────────

interface BalanceCardProps {
  balance: CashoutBalance | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCashout: () => void;
  t: CreatorStrings;
}

function BalanceCard({ balance, loading, error, onRetry, onCashout, t }: BalanceCardProps) {
  if (loading) return <BalanceSkeleton />;

  if (error) {
    return (
      <div
        className="glass-card-sm p-5 flex items-center justify-between gap-3"
        role="alert"
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: "#FF453A" }}>
          <AlertCircle size={16} aria-hidden="true" />
          <span>{t.cashoutBalanceError}</span>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}
          aria-label={t.cashoutRetry}
        >
          <RefreshCw size={12} aria-hidden="true" />
          {t.cashoutRetry}
        </button>
      </div>
    );
  }

  const bothZero = balance && balance.holding_usd === 0 && balance.available_usd === 0;
  if (!balance || bothZero) {
    return (
      <div className="glass-card-sm p-5 text-center py-8">
        <Wallet size={28} className="mx-auto mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }} aria-hidden="true" />
        <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.cashoutNoEarnings}</p>
      </div>
    );
  }

  const timeUntil = formatTimeUntilAvailable(balance.earliest_available_at);
  const canCashout = balance.available_usd >= MIN_CASHOUT_USD;

  return (
    <div className="glass-card-sm p-5" style={{ borderColor: "rgba(212,0,122,0.2)" }}>
      <div className="grid grid-cols-2 gap-4">
        {/* Holding column */}
        <div>
          <div className="flex items-center mb-1">
            <span className="text-xs font-medium" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {t.cashoutHoldingLabel}
            </span>
            <InfoTooltip text={t.cashoutHoldingTooltip} />
          </div>
          <p className="text-lg font-bold text-white">
            ${balance.holding_usd.toFixed(2)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {t.cashoutHoldingCount(balance.holding_count)}
          </p>
          {timeUntil !== null && (
            <p className="text-xs mt-1" style={{ color: "#FFB454" }}>
              {t.cashoutAvailableIn(timeUntil.h, timeUntil.m)}
            </p>
          )}
        </div>

        {/* Available column */}
        <div className="flex flex-col items-end">
          <p className="text-xs font-medium mb-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {t.cashoutAvailableLabel}
          </p>
          <p className="text-lg font-bold" style={{ color: "#D4007A" }}>
            ${balance.available_usd.toFixed(2)}
          </p>
          <button
            type="button"
            onClick={onCashout}
            disabled={!canCashout}
            aria-label={t.cashoutCashOutBtn}
            className="mt-2 flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4007A] focus-visible:ring-offset-2"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", minHeight: 44 }}
          >
            <ChevronRight size={14} aria-hidden="true" />
            {t.cashoutCashOutBtn}
          </button>
          {!canCashout && (
            <p className="text-[10px] mt-1 text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {t.cashoutMinimum}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Cash-out history ──────────────────────────────────────────────────────────

interface CashoutHistoryProps {
  items: CashoutHistoryItem[];
  loading: boolean;
  error: string | null;
  t: CreatorStrings;
}

function CashoutHistory({ items, loading, error, t }: CashoutHistoryProps) {
  if (loading) {
    return (
      <div className="space-y-2 animate-pulse" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-center py-4" style={{ color: "#FF453A" }}>
        {t.cashoutHistoryLoadError}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-center py-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
        {t.cashoutHistoryEmpty}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
        >
          <div>
            <p className="text-sm font-medium text-white">${item.amount_usd.toFixed(2)}</p>
            <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {new Date(item.requested_at).toLocaleDateString()} &middot; {laneLabelKey(item.lane, t)}
            </p>
          </div>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: `${laneStatusColor(item.status)}22`,
              color: laneStatusColor(item.status),
            }}
          >
            {statusLabelKey(item.status, t)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Cash-out modal ────────────────────────────────────────────────────────────

interface CashoutModalProps {
  open: boolean;
  balance: CashoutBalance;
  onClose: () => void;
  onSuccess: () => void;
  t: CreatorStrings;
}

function CashoutModal({ open, balance, onClose, onSuccess, t }: CashoutModalProps) {
  const [lane, setLane] = useState<CashoutLane>("meru");
  const [amountStr, setAmountStr] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<PayoutDestinations>({});
  const [destLoading, setDestLoading] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  // Focus trap + Esc
  useEffect(() => {
    if (!open) return;
    firstFocusableRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Load saved destinations from creator profile + reset modal state on open
  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setAmountStr("");
    setDestLoading(true);
    getCreatorWallet()
      .then((res) => {
        if (res.success) {
          setDestinations(res.destinations || {});
          // Pre-select the first lane that has a saved destination
          const firstAvailable = LANE_META.find((m) => destForLane(m.id, res.destinations || {}));
          if (firstAvailable) setLane(firstAvailable.id);
        }
      })
      .catch(() => {})
      .finally(() => setDestLoading(false));
  }, [open]);

  if (!open) return null;

  const selectedDest = destForLane(lane, destinations);
  const selectedMeta = LANE_META.find((m) => m.id === lane);
  const amountNum = parseFloat(amountStr) || 0;
  const amountValid =
    amountNum >= MIN_CASHOUT_USD &&
    amountNum <= balance.available_usd &&
    !!selectedDest;

  const handleSubmit = async () => {
    if (!selectedDest) {
      setSubmitError(`Add a ${selectedMeta?.label || lane} destination on the Settings tab first.`);
      return;
    }
    if (!amountValid) {
      setSubmitError(
        amountNum < MIN_CASHOUT_USD
          ? `Minimum cashout is $${MIN_CASHOUT_USD}.`
          : amountNum > balance.available_usd
            ? `Amount exceeds available balance ($${balance.available_usd.toFixed(2)}).`
            : "Invalid amount."
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await requestCashout({
        amount_usd: amountNum,
        lane,
        destination: selectedDest,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t.cashoutErrorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t.cashoutModalTitle}
    >
      <div
        ref={modalRef}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90vh]"
        style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">{t.cashoutModalTitle}</h2>
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onClose}
            aria-label={t.cancelBtn}
            className="flex items-center justify-center w-8 h-8 rounded-full transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X size={16} style={{ color: "var(--pnp-text-secondary, #8E8E93)" }} aria-hidden="true" />
          </button>
        </div>

        {/* Available balance summary */}
        <div className="px-5 pb-3 flex-shrink-0">
          <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {t.cashoutAvailableLabel}:{" "}
            <strong style={{ color: "#D4007A" }}>${balance.available_usd.toFixed(2)}</strong>
          </p>
        </div>

        <div className="px-5 pb-6 overflow-y-auto flex-1">
          {/* Lane picker */}
          <p className="text-xs font-semibold text-white mb-2">Payout method</p>
          <div className="space-y-2 mb-4">
            {LANE_META.map((meta) => {
              const dest = destForLane(meta.id, destinations);
              const enabled = !!dest;
              const isSelected = lane === meta.id;
              const destPreview = dest ? (dest.handle || dest.address) : null;
              return (
                <button
                  key={meta.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={!enabled || destLoading}
                  onClick={() => { setLane(meta.id); setSubmitError(null); }}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors disabled:opacity-40"
                  style={{
                    background: isSelected ? "rgba(212,0,122,0.15)" : "rgba(255,255,255,0.04)",
                    border: isSelected ? "1px solid #D4007A" : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">{meta.icon}</span>
                    <span className="text-sm font-semibold text-white">{meta.label}</span>
                  </span>
                  <span className="text-xs font-mono truncate max-w-[180px]"
                    style={{ color: enabled ? "#8E8E93" : "rgba(142,142,147,0.5)" }}>
                    {destPreview
                      ? (destPreview.length > 18 ? destPreview.slice(0, 8) + "…" + destPreview.slice(-6) : destPreview)
                      : "Add in Settings"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Amount input */}
          <p className="text-xs font-semibold text-white mb-1">Amount (USD)</p>
          <div className="relative mb-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
            <input
              type="number"
              min={MIN_CASHOUT_USD}
              max={balance.available_usd}
              step="0.01"
              value={amountStr}
              onChange={(e) => { setAmountStr(e.target.value); setSubmitError(null); }}
              placeholder={`${MIN_CASHOUT_USD}.00 – ${balance.available_usd.toFixed(2)}`}
              className="w-full pl-7 pr-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30"
            />
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Min ${MIN_CASHOUT_USD}. Manual settlement — funds arrive within 24–72h.
          </p>

          {submitError && (
            <div
              className="mb-3 flex items-start gap-2 px-3 py-3 rounded-lg text-xs"
              style={{ background: "rgba(255,69,58,0.1)", color: "#FF453A" }}
              role="alert"
            >
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
              {submitError}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || destLoading || !amountValid}
            className="w-full py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
          >
            {submitting
              ? <span className="inline-flex items-center gap-2"><Loader size={14} className="animate-spin" /> Submitting…</span>
              : selectedMeta
                ? `Request $${amountNum > 0 ? amountNum.toFixed(2) : "0.00"} via ${selectedMeta.label}`
                : "Request cashout"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Legacy payout method selector ────────────────────────────────────────────

const DASH_ADDRESS_REGEX = /^[X7][1-9A-HJ-NP-Za-km-z]{33}$/;

type LegacyPayoutMethod = "bank_transfer" | "dash";

interface LegacyWithdrawCardProps {
  withdrawable: number;
  withdrawals: ModelWithdrawal[];
  t: CreatorStrings;
  onReload: () => Promise<void>;
}

function LegacyWithdrawCard({ withdrawable, withdrawals, t, onReload }: LegacyWithdrawCardProps) {
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState<LegacyPayoutMethod>("bank_transfer");
  const [dashAddress, setDashAddress] = useState("");
  const [dashAddressError, setDashAddressError] = useState<string | null>(null);

  const validateAndConfirm = () => {
    setDashAddressError(null);
    if (payoutMethod === "dash") {
      const trimmed = dashAddress.trim();
      if (!trimmed) {
        setDashAddressError("Please enter your Dash wallet address.");
        return;
      }
      if (!DASH_ADDRESS_REGEX.test(trimmed)) {
        setDashAddressError("Invalid Dash address. Mainnet addresses start with X (or 7) and are 34 characters long.");
        return;
      }
    }
    setShowConfirm(true);
  };

  const handleWithdraw = async () => {
    setShowConfirm(false);
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const paymentDetails: Record<string, string> = {};
      if (payoutMethod === "dash" && dashAddress.trim()) {
        paymentDetails.dash_address = dashAddress.trim();
      }
      const res = await requestWithdrawal(payoutMethod, paymentDetails);
      setWithdrawSuccess(
        t.withdrawAmount(res.data.withdrawal.amountUsd.toFixed(2)) +
          " requested successfully. You will receive a Dash claim link by email shortly."
      );
      await onReload();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to request withdrawal");
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <>
      {/* Withdraw card */}
      <div className="glass-card-sm p-5" style={{ borderColor: "rgba(94,209,196,0.2)" }}>
        <p className="text-sm font-semibold text-white mb-1">{t.requestWithdrawalTitle}</p>
        <p className="text-xs mb-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          {t.availableBalance} <strong style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</strong>
        </p>

        {/* Payout method selector */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Payout Method
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setPayoutMethod("bank_transfer"); setDashAddressError(null); }}
              className="flex-1 text-xs font-semibold py-2 px-3 rounded-lg border transition-colors"
              style={{
                background: payoutMethod === "bank_transfer" ? "rgba(94,209,196,0.12)" : "rgba(255,255,255,0.04)",
                borderColor: payoutMethod === "bank_transfer" ? "#5ED1C4" : "rgba(255,255,255,0.1)",
                color: payoutMethod === "bank_transfer" ? "#5ED1C4" : "#8E8E93",
              }}
            >
              Bank Transfer
            </button>
            <button
              type="button"
              onClick={() => { setPayoutMethod("dash"); setDashAddressError(null); }}
              className="flex-1 text-xs font-semibold py-2 px-3 rounded-lg border transition-colors"
              style={{
                background: payoutMethod === "dash" ? "rgba(0,141,228,0.12)" : "rgba(255,255,255,0.04)",
                borderColor: payoutMethod === "dash" ? "#008DE4" : "rgba(255,255,255,0.1)",
                color: payoutMethod === "dash" ? "#008DE4" : "#8E8E93",
              }}
            >
              Dash
            </button>
          </div>
        </div>

        {payoutMethod === "bank_transfer" && (
          <div
            className="mb-4 px-3 py-3 rounded-lg text-xs"
            style={{ background: "rgba(255,255,255,0.04)", color: "var(--pnp-text-secondary, #8E8E93)", lineHeight: "1.6" }}
          >
            <strong style={{ color: "#fff", display: "block", marginBottom: 4 }}>Bank Transfer</strong>
            To receive payouts via bank transfer, contact{" "}
            <a href="mailto:support@pnptv.app" style={{ color: "#5ED1C4" }}>
              support@pnptv.app
            </a>{" "}
            to provide your banking details securely. Our team will process the transfer within 1–3 business days after approval.
          </div>
        )}

        {payoutMethod === "dash" && (
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              Dash Wallet Address
            </label>
            <input
              type="text"
              value={dashAddress}
              onChange={(e) => { setDashAddress(e.target.value); setDashAddressError(null); }}
              placeholder="e.g. Xa1bc2d3e... (34 chars, starts with X or 7)"
              className="w-full text-xs px-3 py-2 rounded-lg border outline-none font-mono"
              style={{
                background: "rgba(255,255,255,0.05)",
                borderColor: dashAddressError ? "#ef4444" : "rgba(255,255,255,0.12)",
                color: "#fff",
              }}
            />
            {dashAddressError && (
              <p className="mt-1 text-xs" style={{ color: "#ef4444" }}>{dashAddressError}</p>
            )}
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              You'll receive an email with a claim link. Open it, paste this Dash address, and BTCPay sends the funds on-chain. Your USD balance is converted to Dash at the live exchange rate at claim time.
            </p>
          </div>
        )}

        {withdrawSuccess && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
            {withdrawSuccess}
          </div>
        )}
        {withdrawError && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
            {withdrawError}
          </div>
        )}

        <button
          onClick={validateAndConfirm}
          disabled={withdrawing || withdrawable <= 0}
          className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)", color: "#000" }}
        >
          {withdrawing ? t.processing : withdrawable <= 0 ? t.noBalance : t.withdrawAmount(withdrawable.toFixed(2))}
        </button>
      </div>

      {/* Withdrawal history */}
      <div className="glass-card-sm p-4">
        <p className="text-sm font-semibold text-white mb-3">{t.withdrawalHistoryTitle}</p>
        {withdrawals.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.noWithdrawalsYet}</p>
        ) : (
          <div className="space-y-2">
            {withdrawals.map((w) => (
              <div key={w.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm font-medium text-white">${w.amountUsd.toFixed(2)}</p>
                  <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {new Date(w.requestedAt).toLocaleDateString()} &middot; {w.method.replace("_", " ")}
                  </p>
                </div>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    background: w.status === "completed" ? "rgba(94,209,196,0.15)" :
                                w.status === "pending" ? "rgba(255,180,84,0.15)" : "rgba(142,142,147,0.15)",
                    color: w.status === "completed" ? "#5ED1C4" :
                           w.status === "pending" ? "#FFB454" : "#8E8E93",
                  }}
                >
                  {w.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdrawal confirmation dialog */}
      <ConfirmDialog
        open={showConfirm}
        title={t.withdrawConfirmTitle}
        message={
          payoutMethod === "dash"
            ? `Request payout of $${withdrawable.toFixed(2)} in Dash to ${dashAddress.trim()}?`
            : t.withdrawConfirmMsg(withdrawable.toFixed(2))
        }
        confirmLabel={t.withdrawBtn}
        cancelLabel={t.cancelBtn}
        onConfirm={handleWithdraw}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}

// ── Main PayoutsTab ───────────────────────────────────────────────────────────

interface PayoutsTabProps {
  withdrawable: number;
  withdrawals: ModelWithdrawal[];
  t: CreatorStrings;
  onReload: () => Promise<void>;
}

export function PayoutsTab({ withdrawable, withdrawals, t, onReload }: PayoutsTabProps) {
  const [balance, setBalance] = useState<CashoutBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [historyItems, setHistoryItems] = useState<CashoutHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Inline toast state for cashout success
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    setBalanceError(null);
    try {
      const data = await getCashoutBalance();
      setBalance(data);
    } catch (err) {
      setBalanceError(err instanceof Error ? err.message : t.cashoutBalanceError);
    } finally {
      setBalanceLoading(false);
    }
  }, [t]);

  const fetchHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const data = await getCashoutHistory();
      setHistoryItems(data);
    } catch {
      setHistoryError(t.cashoutHistoryLoadError);
    } finally {
      setHistoryLoading(false);
    }
  }, [t]);

  // Initial fetch
  useEffect(() => {
    fetchBalance();
    fetchHistory();
  }, [fetchBalance, fetchHistory]);

  // Poll every 60s, pause when tab is hidden
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      timer = setInterval(() => {
        if (!document.hidden) {
          fetchBalance();
        }
      }, POLL_INTERVAL_MS);
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        fetchBalance();
      }
    };

    start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchBalance]);

  const handleCashoutSuccess = useCallback(() => {
    setSuccessBanner(t.cashoutSuccessToast);
    fetchBalance();
    fetchHistory();
    setTimeout(() => setSuccessBanner(null), 8000);
  }, [t, fetchBalance, fetchHistory]);

  return (
    <div className="space-y-4">
      {/* Success banner */}
      {successBanner && (
        <div
          className="flex items-start gap-2 px-4 py-3 rounded-xl text-xs leading-relaxed"
          style={{ background: "rgba(94,209,196,0.12)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.25)" }}
          role="status"
          aria-live="polite"
        >
          <Check size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          {successBanner}
        </div>
      )}

      {/* USDT Balance card */}
      <BalanceCard
        balance={balance}
        loading={balanceLoading}
        error={balanceError}
        onRetry={() => { setBalanceLoading(true); fetchBalance(); }}
        onCashout={() => setModalOpen(true)}
        t={t}
      />

      {/* USDT Cash-out history */}
      {(!balanceLoading && !balanceError) && (
        <div className="glass-card-sm p-4">
          <p className="text-sm font-semibold text-white mb-3">{t.cashoutHistoryTitle}</p>
          <CashoutHistory
            items={historyItems}
            loading={historyLoading}
            error={historyError}
            t={t}
          />
        </div>
      )}

      {/* Legacy withdraw card */}
      <LegacyWithdrawCard
        withdrawable={withdrawable}
        withdrawals={withdrawals}
        t={t}
        onReload={onReload}
      />

      {/* Cash-out modal */}
      {modalOpen && balance && (
        <CashoutModal
          open={modalOpen}
          balance={balance}
          onClose={() => setModalOpen(false)}
          onSuccess={handleCashoutSuccess}
          t={t}
        />
      )}
    </div>
  );
}
