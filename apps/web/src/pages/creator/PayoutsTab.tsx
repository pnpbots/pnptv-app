import React, { useState, useEffect, useRef, useCallback } from "react";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import {
  requestWithdrawal,
  getCashoutBalance,
  requestCashout,
  getCashoutHistory,
  type ModelWithdrawal,
  type CashoutBalance,
  type CashoutHistoryItem,
} from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";
import { Info, AlertCircle, RefreshCw, Wallet, ChevronRight, X, Check, Loader } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_CASHOUT_ONCHAIN = 5;
const MIN_CASHOUT_BANK = 20;
const POLL_INTERVAL_MS = 60_000;

const TRON_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_REGEX = /^0x[0-9a-fA-F]{40}$/;

const TRANSAK_COUNTRIES: { code: string; label: string; currency: string }[] = [
  { code: "CO", label: "Colombia", currency: "COP" },
  { code: "MX", label: "México", currency: "MXN" },
  { code: "BR", label: "Brasil", currency: "BRL" },
  { code: "AR", label: "Argentina", currency: "ARS" },
  { code: "CL", label: "Chile", currency: "CLP" },
  { code: "PE", label: "Perú", currency: "PEN" },
];

type CashoutLane = "onchain_usdt" | "bitrefill" | "transak";
type Chain = "tron" | "ethereum" | "base";
type PayoutMethod = "bank_transfer" | "dash";

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

function laneLabelKey(lane: CashoutLane, t: CreatorStrings): string {
  if (lane === "onchain_usdt") return t.cashoutLaneOnchain;
  if (lane === "bitrefill") return t.cashoutLaneGiftCards;
  return t.cashoutLaneBank;
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
          style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)" }}
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
        <Wallet size={28} className="mx-auto mb-3" style={{ color: "#8E8E93" }} aria-hidden="true" />
        <p className="text-sm" style={{ color: "#8E8E93" }}>{t.cashoutNoEarnings}</p>
      </div>
    );
  }

  const timeUntil = formatTimeUntilAvailable(balance.earliest_available_at);
  const canCashout = balance.available_usd >= MIN_CASHOUT_ONCHAIN;

  return (
    <div className="glass-card-sm p-5" style={{ borderColor: "rgba(212,0,122,0.2)" }}>
      <div className="grid grid-cols-2 gap-4">
        {/* Holding column */}
        <div>
          <div className="flex items-center mb-1">
            <span className="text-xs font-medium" style={{ color: "#8E8E93" }}>
              {t.cashoutHoldingLabel}
            </span>
            <InfoTooltip text={t.cashoutHoldingTooltip} />
          </div>
          <p className="text-lg font-bold text-white">
            ${balance.holding_usd.toFixed(2)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
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
          <p className="text-xs font-medium mb-1" style={{ color: "#8E8E93" }}>
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
            <p className="text-[10px] mt-1 text-center" style={{ color: "#8E8E93" }}>
              {t.cashoutMinimum}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── On-chain USDT tab ─────────────────────────────────────────────────────────

interface OnchainTabProps {
  availableUsd: number;
  submitting: boolean;
  onSubmit: (amount: number, chain: Chain, address: string) => void;
  t: CreatorStrings;
}

function OnchainTab({ availableUsd, submitting, onSubmit, t }: OnchainTabProps) {
  const [amount, setAmount] = useState("");
  const [chain, setChain] = useState<Chain>("tron");
  const [address, setAddress] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);

  const validateAndSubmit = () => {
    setAmountError(null);
    setAddressError(null);

    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed)) {
      setAmountError(t.cashoutAmountMin);
      return;
    }
    if (parsed < MIN_CASHOUT_ONCHAIN) {
      setAmountError(t.cashoutAmountMin);
      return;
    }
    if (parsed > availableUsd) {
      setAmountError(t.cashoutAmountMax(availableUsd.toFixed(2)));
      return;
    }

    const trimmed = address.trim();
    if (!trimmed) {
      setAddressError(t.cashoutAddressRequired);
      return;
    }
    if (chain === "tron" && !TRON_REGEX.test(trimmed)) {
      setAddressError(t.cashoutAddressErrorTron);
      return;
    }
    if ((chain === "ethereum" || chain === "base") && !EVM_REGEX.test(trimmed)) {
      setAddressError(t.cashoutAddressErrorEvm);
      return;
    }

    onSubmit(parsed, chain, trimmed);
  };

  const chains: { value: Chain; label: string; badge?: string }[] = [
    { value: "tron", label: t.cashoutChainTron, badge: t.cashoutChainTronBadge },
    { value: "base", label: t.cashoutChainBase },
    { value: "ethereum", label: t.cashoutChainEthereum },
  ];

  return (
    <div className="space-y-4 pt-2">
      <p className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
        {t.cashoutOnchainDesc}
      </p>

      {/* Amount */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}
          htmlFor="cashout-amount-onchain">
          {t.cashoutAmountLabel}
        </label>
        <input
          id="cashout-amount-onchain"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setAmountError(null); }}
          placeholder={t.cashoutAmountPlaceholder}
          className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none transition-colors"
          style={{
            background: "rgba(255,255,255,0.05)",
            borderColor: amountError ? "#FF453A" : "rgba(255,255,255,0.12)",
            color: "#fff",
          }}
          aria-describedby={amountError ? "cashout-amount-error-onchain" : undefined}
        />
        {amountError && (
          <p id="cashout-amount-error-onchain" className="mt-1 text-xs" style={{ color: "#FF453A" }} role="alert">
            {amountError}
          </p>
        )}
      </div>

      {/* Chain selector */}
      <div>
        <p className="text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>{t.cashoutChainLabel}</p>
        <div className="space-y-2">
          {chains.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setChain(c.value)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs font-medium transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4007A]"
              style={{
                background: chain === c.value ? "rgba(212,0,122,0.1)" : "rgba(255,255,255,0.04)",
                borderColor: chain === c.value ? "#D4007A" : "rgba(255,255,255,0.1)",
                color: chain === c.value ? "#D4007A" : "#8E8E93",
                minHeight: 44,
              }}
              aria-pressed={chain === c.value}
            >
              <span>{c.label}</span>
              {c.badge && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}
                >
                  {c.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Address */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}
          htmlFor="cashout-address">
          {t.cashoutAddressLabel}
        </label>
        <input
          id="cashout-address"
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={address}
          onChange={(e) => { setAddress(e.target.value); setAddressError(null); }}
          placeholder={chain === "tron" ? "T..." : "0x..."}
          className="w-full text-xs px-3 py-2.5 rounded-lg border outline-none font-mono transition-colors"
          style={{
            background: "rgba(255,255,255,0.05)",
            borderColor: addressError ? "#FF453A" : "rgba(255,255,255,0.12)",
            color: "#fff",
          }}
          aria-describedby={addressError ? "cashout-address-error" : undefined}
        />
        {addressError && (
          <p id="cashout-address-error" className="mt-1 text-xs" style={{ color: "#FF453A" }} role="alert">
            {addressError}
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={validateAndSubmit}
        disabled={submitting}
        className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4007A]"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", minHeight: 44 }}
        aria-label={submitting ? t.cashoutProcessing : t.cashoutConfirmBtn}
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader size={14} className="animate-spin" aria-hidden="true" />
            {t.cashoutProcessing}
          </span>
        ) : (
          t.cashoutConfirmBtn
        )}
      </button>
    </div>
  );
}

// ── Gift cards tab ────────────────────────────────────────────────────────────

interface GiftCardsTabProps {
  t: CreatorStrings;
}

function GiftCardsTab({ t }: GiftCardsTabProps) {
  const bitrefillEnabled = import.meta.env.VITE_BITREFILL_ENABLED === "true";

  return (
    <div className="space-y-4 pt-2">
      <p className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
        {t.cashoutGiftDesc}
      </p>
      {!bitrefillEnabled ? (
        <div
          className="flex items-start gap-3 px-4 py-4 rounded-xl text-xs leading-relaxed"
          style={{ background: "rgba(255,180,84,0.08)", border: "1px solid rgba(255,180,84,0.2)", color: "#FFB454" }}
          role="status"
        >
          <Info size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{t.cashoutGiftComingSoon}</span>
        </div>
      ) : (
        <iframe
          src="https://embed.bitrefill.com/?ref=pnptv&theme=dark"
          title="Bitrefill gift cards"
          className="w-full rounded-xl"
          style={{ height: 480, border: "none" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
    </div>
  );
}

// ── Bank transfer (Transak) tab ───────────────────────────────────────────────

interface BankTabProps {
  availableUsd: number;
  submitting: boolean;
  onInitiateTransak: (amount: number, country: typeof TRANSAK_COUNTRIES[number]) => void;
  transakIframeUrl: string | null;
  transakStatus: "idle" | "loading" | "iframe" | "success" | "failed";
  t: CreatorStrings;
}

function BankTab({ availableUsd, submitting, onInitiateTransak, transakIframeUrl, transakStatus, t }: BankTabProps) {
  const [amount, setAmount] = useState("");
  const [country, setCountry] = useState(TRANSAK_COUNTRIES[0]);
  const [amountError, setAmountError] = useState<string | null>(null);

  const transakKey = import.meta.env.VITE_TRANSAK_PUBLIC_KEY;

  if (!transakKey) {
    return (
      <div className="space-y-3 pt-2">
        <div
          className="flex items-start gap-3 px-4 py-4 rounded-xl text-xs leading-relaxed"
          style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.2)", color: "#FF453A" }}
          role="alert"
        >
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{t.cashoutBankNotConfigured}</span>
        </div>
      </div>
    );
  }

  if (transakStatus === "iframe" && transakIframeUrl) {
    return (
      <div className="pt-2">
        <iframe
          src={transakIframeUrl}
          title="Transak bank transfer"
          className="w-full rounded-xl"
          style={{ height: 520, border: "none" }}
          allow="camera; microphone; payment"
        />
      </div>
    );
  }

  if (transakStatus === "success") {
    return (
      <div
        className="flex items-center gap-3 px-4 py-4 rounded-xl text-xs"
        style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}
        role="status"
      >
        <Check size={16} aria-hidden="true" />
        {t.cashoutTransakSuccess}
      </div>
    );
  }

  if (transakStatus === "failed") {
    return (
      <div
        className="flex items-center gap-3 px-4 py-4 rounded-xl text-xs"
        style={{ background: "rgba(255,69,58,0.1)", color: "#FF453A" }}
        role="alert"
      >
        <AlertCircle size={16} aria-hidden="true" />
        {t.cashoutTransakOrderFailed}
      </div>
    );
  }

  const handleContinue = () => {
    setAmountError(null);
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed)) {
      setAmountError(t.cashoutAmountMinBank);
      return;
    }
    if (parsed < MIN_CASHOUT_BANK) {
      setAmountError(t.cashoutAmountMinBank);
      return;
    }
    if (parsed > availableUsd) {
      setAmountError(t.cashoutAmountMax(availableUsd.toFixed(2)));
      return;
    }
    onInitiateTransak(parsed, country);
  };

  return (
    <div className="space-y-4 pt-2">
      <p className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
        {t.cashoutBankDesc}
      </p>

      {/* Amount */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}
          htmlFor="cashout-amount-bank">
          {t.cashoutAmountLabel}
        </label>
        <input
          id="cashout-amount-bank"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setAmountError(null); }}
          placeholder={t.cashoutAmountPlaceholder}
          className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none transition-colors"
          style={{
            background: "rgba(255,255,255,0.05)",
            borderColor: amountError ? "#FF453A" : "rgba(255,255,255,0.12)",
            color: "#fff",
          }}
          aria-describedby={amountError ? "cashout-amount-error-bank" : undefined}
        />
        {amountError && (
          <p id="cashout-amount-error-bank" className="mt-1 text-xs" style={{ color: "#FF453A" }} role="alert">
            {amountError}
          </p>
        )}
      </div>

      {/* Country */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}
          htmlFor="cashout-country">
          {t.cashoutBankCountryLabel}
        </label>
        <select
          id="cashout-country"
          value={country.code}
          onChange={(e) => {
            const found = TRANSAK_COUNTRIES.find((c) => c.code === e.target.value);
            if (found) setCountry(found);
          }}
          className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none transition-colors appearance-none"
          style={{
            background: "rgba(255,255,255,0.05)",
            borderColor: "rgba(255,255,255,0.12)",
            color: "#fff",
            minHeight: 44,
          }}
        >
          {TRANSAK_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} style={{ background: "#1C1C1E" }}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Continue */}
      <button
        type="button"
        onClick={handleContinue}
        disabled={submitting || transakStatus === "loading"}
        className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4007A]"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", minHeight: 44 }}
        aria-label={t.cashoutBankContinueBtn}
      >
        {(submitting || transakStatus === "loading") ? (
          <span className="flex items-center justify-center gap-2">
            <Loader size={14} className="animate-spin" aria-hidden="true" />
            {t.cashoutProcessing}
          </span>
        ) : (
          t.cashoutBankContinueBtn
        )}
      </button>
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
      <p className="text-xs text-center py-4" style={{ color: "#8E8E93" }}>
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
            <p className="text-xs" style={{ color: "#8E8E93" }}>
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
  const [lane, setLane] = useState<CashoutLane>("onchain_usdt");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [transakIframeUrl, setTransakIframeUrl] = useState<string | null>(null);
  const [transakStatus, setTransakStatus] = useState<"idle" | "loading" | "iframe" | "success" | "failed">("idle");
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

  // Transak postMessage listener
  useEffect(() => {
    if (!open) return;
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== "object" || !event.data) return;
      const { event: evtName } = event.data;
      if (evtName === "TRANSAK_ORDER_SUCCESSFUL") {
        setTransakStatus("success");
        onSuccess();
      } else if (evtName === "TRANSAK_ORDER_FAILED") {
        setTransakStatus("failed");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open, onSuccess]);

  // Reset lane state on open
  useEffect(() => {
    if (open) {
      setSubmitError(null);
      setTransakIframeUrl(null);
      setTransakStatus("idle");
    }
  }, [open]);

  if (!open) return null;

  const handleOnchainSubmit = async (amount: number, chain: Chain, address: string) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await requestCashout({
        amount_usd: amount,
        lane: "onchain_usdt",
        destination: { address, chain },
      });
      onSuccess();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t.cashoutErrorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransakInitiate = async (amount: number, country: typeof TRANSAK_COUNTRIES[number]) => {
    setTransakStatus("loading");
    setSubmitError(null);
    try {
      const res = await requestCashout({
        amount_usd: amount,
        lane: "transak",
        destination: {},
      });
      const transakKey = import.meta.env.VITE_TRANSAK_PUBLIC_KEY;
      const transakEnv = import.meta.env.VITE_TRANSAK_ENV || "STAGING";
      const baseUrl = transakEnv === "PRODUCTION"
        ? "https://global.transak.com"
        : "https://staging-global.transak.com";

      const walletAddress = res.provider_meta?.wallet_address as string | undefined;
      const quoteId = res.provider_meta?.quote_id as string | undefined;

      const params = new URLSearchParams({
        apiKey: transakKey,
        environment: transakEnv,
        productsAvailed: "SELL",
        cryptoCurrencyCode: "USDT",
        fiatAmount: String(amount),
        fiatCurrency: country.currency,
        defaultNetwork: "tron",
        partnerOrderId: res.order_id,
        ...(walletAddress ? { walletAddress } : {}),
        ...(quoteId ? { quoteId } : {}),
      });

      setTransakIframeUrl(`${baseUrl}?${params.toString()}`);
      setTransakStatus("iframe");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t.cashoutErrorGeneric);
      setTransakStatus("idle");
    }
  };

  const tabs: { id: CashoutLane; label: string }[] = [
    { id: "onchain_usdt", label: t.cashoutTabOnchain },
    { id: "bitrefill", label: t.cashoutTabGiftCards },
    { id: "transak", label: t.cashoutTabBank },
  ];

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
        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}
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
            <X size={16} style={{ color: "#8E8E93" }} aria-hidden="true" />
          </button>
        </div>

        {/* Available balance summary */}
        <div className="px-5 pb-3 flex-shrink-0">
          <p className="text-xs" style={{ color: "#8E8E93" }}>
            {t.cashoutAvailableLabel}:{" "}
            <strong style={{ color: "#D4007A" }}>${balance.available_usd.toFixed(2)}</strong>
          </p>
        </div>

        {/* Tab bar */}
        <div
          className="flex gap-0 px-5 pb-0 flex-shrink-0 border-b"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
          role="tablist"
          aria-label={t.cashoutModalTitle}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={lane === tab.id}
              onClick={() => {
                setLane(tab.id);
                setSubmitError(null);
                setTransakStatus("idle");
                setTransakIframeUrl(null);
              }}
              className="flex-1 text-xs font-medium pb-2.5 pt-1 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4007A]"
              style={{
                borderColor: lane === tab.id ? "#D4007A" : "transparent",
                color: lane === tab.id ? "#D4007A" : "#8E8E93",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-5 pb-6 overflow-y-auto flex-1" role="tabpanel">
          {submitError && (
            <div
              className="mt-4 flex items-start gap-2 px-3 py-3 rounded-lg text-xs"
              style={{ background: "rgba(255,69,58,0.1)", color: "#FF453A" }}
              role="alert"
            >
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
              {submitError}
            </div>
          )}

          {lane === "onchain_usdt" && (
            <OnchainTab
              availableUsd={balance.available_usd}
              submitting={submitting}
              onSubmit={handleOnchainSubmit}
              t={t}
            />
          )}

          {lane === "bitrefill" && <GiftCardsTab t={t} />}

          {lane === "transak" && (
            <BankTab
              availableUsd={balance.available_usd}
              submitting={submitting}
              onInitiateTransak={handleTransakInitiate}
              transakIframeUrl={transakIframeUrl}
              transakStatus={transakStatus}
              t={t}
            />
          )}
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
        <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
          {t.availableBalance} <strong style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</strong>
        </p>

        {/* Payout method selector */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>
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
            style={{ background: "rgba(255,255,255,0.04)", color: "#8E8E93", lineHeight: "1.6" }}
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
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>
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
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
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
          <p className="text-xs text-center py-4" style={{ color: "#8E8E93" }}>{t.noWithdrawalsYet}</p>
        ) : (
          <div className="space-y-2">
            {withdrawals.map((w) => (
              <div key={w.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm font-medium text-white">${w.amountUsd.toFixed(2)}</p>
                  <p className="text-xs" style={{ color: "#8E8E93" }}>
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
