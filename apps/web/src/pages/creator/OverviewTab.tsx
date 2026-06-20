import React, { useState } from "react";
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

const GUIDE_STEPS = [
  {
    icon: "🎬",
    title: "Pick your best 3–5 videos",
    body: "Choose short, raw clips — 5 to 8 minutes is the sweet spot. Solo content, spontaneous energy, minimal editing. Think: real moment, not a production. These become your exclusive wall that justifies the subscription.",
  },
  {
    icon: "🔒",
    title: "Upload them as exclusive content",
    body: "Go to Content → New Post and mark each video as Exclusive. Your subscribers will see the thumbnail but only paying members unlock the full video. Load your wall before you charge a single dollar.",
  },
  {
    icon: "💵",
    title: "Turn on your membership fee",
    body: "Once you have at least 3 exclusive videos live, go to Settings and flip the \"Accept new memberships\" toggle on. Fans pay $5–$15/month depending on your tier and get instant access to everything behind your wall.",
  },
  {
    icon: "📸",
    title: "Post free teasers consistently",
    body: "Keep your public profile active with short previews, stills, or voice notes. Free content is your marketing — it drives people to subscribe. One free post per day beats one exclusive post per week.",
  },
  {
    icon: "🔄",
    title: "Add new exclusive content monthly",
    body: "Subscriptions renew every 30 days. Give subscribers a reason to stay: drop 2–3 new exclusive clips each month. Consistency matters more than perfection — amateur and authentic keeps people coming back.",
  },
];

export function OverviewTab({ dashboard, user, withdrawable, t, onTabChange }: OverviewTabProps) {
  const navigate = useNavigate();
  const tierInfo = TIERS.find((tier) => tier.key === dashboard.creatorType);
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold text-white">{dashboard.subscriberCount}</p>
          <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.statSubscribers}</p>
        </div>
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>${dashboard.monthlyEarnings.toFixed(2)}</p>
          <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.statThisMonth}</p>
        </div>
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold text-white">${dashboard.totalEarnings.toFixed(2)}</p>
          <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.statTotalEarnings}</p>
        </div>
        <div className="glass-card-sm p-4 text-center">
          <p className="text-2xl font-bold text-white">{dashboard.exclusivePostCount}</p>
          <p className="text-xs mt-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.statExclusivePosts}</p>
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
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
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
              <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.availableToWithdraw}</p>
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

      {/* Monetization guide */}
      <div className="glass-card-sm mb-4 overflow-hidden">
        <button
          onClick={() => setGuideOpen((v) => !v)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">💡</span>
            <div>
              <p className="text-sm font-semibold text-white">How to monetize your profile</p>
              <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                5 steps to start earning from short solo content
              </p>
            </div>
          </div>
          <svg
            className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
            style={{
              color: "var(--pnp-text-secondary, #8E8E93)",
              transform: guideOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {guideOpen && (
          <div className="px-4 pb-4 space-y-1 border-t border-white/5 pt-3">
            <p className="text-xs leading-relaxed mb-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              Your profile is built for creators who film spontaneous, unpolished solo content — the kind that
              feels real because it is. Short videos (5–8 min), one performer, no fancy setup. Here's the
              exact playbook to turn that into recurring income.
            </p>
            <div className="space-y-3">
              {GUIDE_STEPS.map((step, i) => (
                <div
                  key={i}
                  className="flex gap-3 p-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="text-lg flex-shrink-0 mt-0.5">{step.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-white mb-1">
                      <span className="mr-1.5" style={{ color: "#D4007A" }}>{i + 1}.</span>
                      {step.title}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                      {step.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div
              className="mt-4 p-3 rounded-xl text-xs leading-relaxed"
              style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.2)", color: "#D4007A" }}
            >
              <span className="font-semibold">Remember:</span> your membership fee is off by default. Upload your exclusive content wall first, then flip it on in Settings. Your first subscribers will pay for what's already there.
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => onTabChange("content")}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                Upload exclusive content →
              </button>
              <button
                onClick={() => onTabChange("settings")}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Turn on fee →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Upgrade to full-time */}
      {dashboard.creatorType && !["full_time", ""].includes(dashboard.creatorType) && (
        <div className="glass-card-sm p-4 mb-4" style={{ borderColor: "rgba(212,0,122,0.2)" }}>
          <p className="text-sm font-medium text-white mb-1">{t.wantMore}</p>
          <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
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
