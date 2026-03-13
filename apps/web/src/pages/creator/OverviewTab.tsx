import React from "react";
import { useNavigate } from "react-router-dom";
import type { CreatorDashboard as DashboardData } from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

const TIERS: { key: "ice" | "crystal" | "diamond"; label: string; price: number; emoji: string }[] = [
  { key: "ice", label: "Ice", price: 5, emoji: "❄" },
  { key: "crystal", label: "Crystal", price: 10, emoji: "🔮" },
  { key: "diamond", label: "Diamond", price: 15, emoji: "💎" },
];

interface OverviewTabProps {
  dashboard: DashboardData & { success: boolean };
  user: { displayName?: string; username?: string } | null;
  withdrawable: number;
  t: CreatorStrings;
  onTabChange: (tab: string) => void;
}

export function OverviewTab({ dashboard, user, withdrawable, t, onTabChange }: OverviewTabProps) {
  const navigate = useNavigate();
  const tierInfo = TIERS.find((tier) => tier.key === dashboard.creatorType);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold text-white">{dashboard.subscriberCount}</p>
          <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statSubscribers}</p>
        </div>
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>${dashboard.monthlyEarnings.toFixed(2)}</p>
          <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statThisMonth}</p>
        </div>
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold text-white">${dashboard.totalEarnings.toFixed(2)}</p>
          <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statTotalEarnings}</p>
        </div>
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold text-white">{dashboard.exclusivePostCount}</p>
          <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>{t.statExclusivePosts}</p>
        </div>
      </div>

      <div className="glass-card-sm p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">
              {dashboard.creatorType === "full_time" ? t.creatorTypeFullTime
                : dashboard.creatorType === "diamond" ? `💎 ${t.creatorTypeDiamond}`
                : dashboard.creatorType === "crystal" ? `🔮 ${t.creatorTypeCrystal}`
                : dashboard.creatorType === "ice" ? `❄ ${t.creatorTypeIce}`
                : t.creatorTypeDefault}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              ${dashboard.priceUsd.toFixed(2)}/month &middot; {t.revenueSplit}
            </p>
          </div>
          {dashboard.verified && (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5ED1C4" aria-label="Verified">
              <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          )}
        </div>
      </div>

      {/* Withdrawable amount card */}
      {withdrawable > 0 && (
        <div className="glass-card-sm p-4 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs" style={{ color: "#8E8E93" }}>{t.availableToWithdraw}</p>
              <p className="text-xl font-bold" style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</p>
            </div>
            <button
              onClick={() => onTabChange("payouts")}
              className="text-xs font-semibold px-4 py-2 rounded-lg"
              style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
            >
              {t.withdrawBtn}
            </button>
          </div>
        </div>
      )}

      {/* Upgrade to full-time */}
      {dashboard.creatorType && !["full_time", ""].includes(dashboard.creatorType) && (
        <div className="glass-card-sm p-4 mb-4" style={{ borderColor: "rgba(212,0,122,0.2)" }}>
          <p className="text-sm font-medium text-white mb-1">{t.wantMore}</p>
          <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
            {t.wantMoreDesc}
          </p>
          <button
            onClick={() => navigate("/apply")}
            className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
          >
            {t.applyFullTime}
          </button>
        </div>
      )}
    </>
  );
}
