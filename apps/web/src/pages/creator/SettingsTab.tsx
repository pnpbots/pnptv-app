import React, { useState, useEffect, useCallback } from "react";
import {
  getCreatorWallet,
  saveCreatorWallet,
  type CreatorDashboard as DashboardData,
} from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

const ETHEREUM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const TIERS: { key: "ice" | "crystal" | "diamond"; label: string; price: number; emoji: string }[] = [
  { key: "ice", label: "Ice", price: 5, emoji: "❄" },
  { key: "crystal", label: "Crystal", price: 10, emoji: "🔮" },
  { key: "diamond", label: "Diamond", price: 15, emoji: "💎" },
];

interface SettingsTabProps {
  dashboard: DashboardData & { success: boolean };
  t: CreatorStrings;
}

export function SettingsTab({ dashboard, t }: SettingsTabProps) {
  // Payout method state
  const [payoutMethod, setPayoutMethod] = useState<"crypto" | "meru">("crypto");
  const [walletAddress, setWalletAddress] = useState<string>(dashboard.walletAddress || "");
  const [meruAccount, setMeruAccount] = useState<string>("");
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletSaving, setWalletSaving] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSuccess, setWalletSuccess] = useState<string | null>(null);

  // Load wallet data
  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res = await getCreatorWallet();
      if (res.success) {
        setPayoutMethod(res.payoutMethod || "crypto");
        setWalletAddress(res.address || "");
        setMeruAccount(res.meruAccount || "");
      }
    } catch {
      // Non-critical
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const handleSaveWallet = async () => {
    setWalletError(null);
    setWalletSuccess(null);

    if (payoutMethod === "crypto") {
      const trimmed = walletAddress.trim();
      if (!ETHEREUM_ADDRESS_RE.test(trimmed)) {
        setWalletError(t.errorInvalidAddress);
        return;
      }
      setWalletSaving(true);
      try {
        const res = await saveCreatorWallet({ payoutMethod: "crypto", address: trimmed });
        if (res.success) {
          setWalletSuccess(t.walletSavedCrypto);
          setWalletAddress(trimmed.toLowerCase());
        } else {
          setWalletError((res as { error?: string }).error || t.errorSaveWallet);
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : t.errorSaveWallet);
      } finally {
        setWalletSaving(false);
      }
    } else {
      const meru = meruAccount.trim();
      if (!meru) {
        setWalletError(t.errorMeruEmpty);
        return;
      }
      setWalletSaving(true);
      try {
        const res = await saveCreatorWallet({ payoutMethod: "meru", meruAccount: meru });
        if (res.success) {
          setWalletSuccess(t.walletSavedMeru);
          setMeruAccount(meru);
        } else {
          setWalletError((res as { error?: string }).error || t.errorSaveMeru);
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : t.errorSaveMeru);
      } finally {
        setWalletSaving(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Payout Method Card */}
      <div className="glass-card-sm p-5">
        <p className="text-sm font-semibold text-white mb-1">{t.payoutMethodTitle}</p>
        <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>{t.payoutMethodDesc}</p>

        {/* Method selector */}
        <div className="flex gap-2 mb-4">
          {([
            { key: "meru", label: t.payoutMeruLabel, icon: "📱" },
            { key: "crypto", label: t.payoutCryptoLabel, icon: "🔑" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                setPayoutMethod(opt.key);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              disabled={walletLoading}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{
                background: payoutMethod === opt.key
                  ? "linear-gradient(135deg, #D4007A, #E69138)"
                  : "rgba(255,255,255,0.05)",
                color: payoutMethod === opt.key ? "#fff" : "#8E8E93",
                border: payoutMethod === opt.key
                  ? "1px solid transparent"
                  : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span className="block text-base mb-0.5">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>

        {walletLoading ? (
          <div className="h-10 bg-white/5 rounded-lg animate-pulse mb-3" />
        ) : payoutMethod === "meru" ? (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>{t.meruInputHint}</p>
            <input
              type="text"
              value={meruAccount}
              onChange={(e) => {
                setMeruAccount(e.target.value);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              placeholder={t.meruPlaceholder}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        ) : (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>{t.cryptoInputHint}</p>
            <input
              type="text"
              value={walletAddress}
              onChange={(e) => {
                setWalletAddress(e.target.value);
                setWalletError(null);
                setWalletSuccess(null);
              }}
              placeholder={t.cryptoPlaceholder}
              spellCheck={false}
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white placeholder-white/30 bg-white/5 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        )}

        {walletSuccess && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
            {walletSuccess}
          </div>
        )}
        {walletError && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
            {walletError}
          </div>
        )}

        <button
          onClick={handleSaveWallet}
          disabled={walletSaving || walletLoading || (payoutMethod === "crypto" ? !walletAddress.trim() : !meruAccount.trim())}
          className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
        >
          {walletSaving ? t.savingWallet : t.savePayoutInfo}
        </button>

        <p className="mt-4 text-xs leading-relaxed" style={{ color: "#8E8E93" }}>{t.payoutScheduleNote}</p>
      </div>

      {/* Tier milestone info — read-only */}
      {dashboard.creatorType !== "full_time" && (
        <div className="glass-card-sm p-5">
          <p className="text-sm font-semibold text-white mb-1">{t.creatorTierTitle}</p>
          <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>{t.creatorTierDesc}</p>
          <div className="flex gap-2">
            {TIERS.map((tier) => {
              const isCurrent = dashboard.creatorType === tier.key;
              const tierOrder = { ice: 0, crystal: 1, diamond: 2 };
              const currentOrder = tierOrder[dashboard.creatorType as keyof typeof tierOrder] ?? -1;
              const isUnlocked = tierOrder[tier.key] <= currentOrder;
              return (
                <div
                  key={tier.key}
                  className="flex-1 py-2.5 rounded-lg text-xs font-semibold text-center"
                  style={{
                    background: isCurrent
                      ? "linear-gradient(135deg, #D4007A, #E69138)"
                      : isUnlocked
                      ? "rgba(212,0,122,0.15)"
                      : "rgba(255,255,255,0.04)",
                    color: isCurrent ? "#fff" : isUnlocked ? "#D4007A" : "#8E8E93",
                    border: isCurrent
                      ? "1px solid transparent"
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {tier.emoji} {tier.label}
                  {isCurrent && <span className="block text-xs font-normal mt-0.5 opacity-80">{t.tierCurrent}</span>}
                  {!isCurrent && !isUnlocked && <span className="block text-xs font-normal mt-0.5 opacity-60">{t.tierLocked}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
