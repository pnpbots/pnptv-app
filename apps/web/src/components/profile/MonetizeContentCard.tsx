import React, { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { getCreatorEligibility, getCreatorEnrollment, type CreatorEligibility, type CreatorEnrollment } from "@/lib/api";
import CreatorEnrollmentWizard, { CREATOR_TIERS, TIER_CONFIG, type TierId } from "@/components/profile/CreatorEnrollmentWizard";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MonetizeContentCardProps {
  creatorStatus?: string;
  interestExpressed?: boolean;
  onActivated?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MonetizeContentCard({ creatorStatus, interestExpressed = false, onActivated }: MonetizeContentCardProps) {
  const t = useI18n();
  const p = t.profile;
  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [enrollment, setEnrollment] = useState<CreatorEnrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<TierId>("ice");
  const [showWizard, setShowWizard] = useState(false);

  // Only fetch eligibility/enrollment when the user has actively opted in
  // (via the "Become a Creator" menu entry) or is already in a pipeline state.
  const hasSignal = interestExpressed || creatorStatus === "pending_review" || creatorStatus === "eligible";

  useEffect(() => {
    if (!hasSignal) {
      setLoading(false);
      return;
    }
    Promise.all([
      getCreatorEligibility().then((res) => { if (res.success) setEligibility(res); }).catch(() => {}),
      getCreatorEnrollment().then((res) => { if (res.success) setEnrollment(res.enrollment); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [hasSignal]);

  if (creatorStatus === "active") return null;
  if (!hasSignal) return null;

  if (loading) {
    return (
      <div className="glass-card-sm p-4 mt-4 animate-pulse">
        <div className="h-5 bg-white/5 rounded w-40 mb-2" />
        <div className="h-3 bg-white/5 rounded w-full" />
      </div>
    );
  }

  // Pending review state
  if (creatorStatus === "pending_review" || enrollment?.status === "pending_review") {
    const tc = enrollment ? TIER_CONFIG[enrollment.tier as TierId] : TIER_CONFIG.ice;
    return (
      <div
        className="glass-card-sm p-4 mt-4"
        style={{ borderColor: `rgba(${tc.rgb},0.3)` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `rgba(${tc.rgb},0.15)` }}
          >
            <svg className="w-4 h-4 animate-spin" style={{ color: tc.color }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{p.enrollmentUnderReview}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {enrollment?.tier || ""} {tc.emoji} {p.enrollmentUnderReviewDesc}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Rejected — allow re-enrollment
  if (enrollment?.status === "rejected") {
    const tc = TIER_CONFIG[enrollment.tier as TierId] || TIER_CONFIG.ice;
    return (
      <div className="glass-card-sm p-4 mt-4" style={{ borderColor: "rgba(239,68,68,0.25)" }}>
        <p className="text-sm font-semibold text-white mb-1">{p.enrollmentNotApproved}</p>
        <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
          {enrollment.admin_notes || p.enrollmentRejectedDefault}
        </p>
        <button
          onClick={() => setShowWizard(true)}
          className="w-full py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: tc.gradient }}
        >
          {p.reApplyFor} {tc.emoji} {tc.name}
        </button>
        {showWizard && (
          <CreatorEnrollmentWizard
            tier={enrollment.tier as TierId}
            onClose={() => setShowWizard(false)}
            onSubmitted={() => { setShowWizard(false); onActivated?.(); }}
          />
        )}
      </div>
    );
  }

  if (!eligibility) return null;

  const isEligible = eligibility.eligible;
  const criteria = eligibility.criteria;
  const totalRequired = Object.values(criteria).length;
  const totalMet = Object.values(criteria).filter((c) => c.met).length;
  const overallPct = Math.round((totalMet / totalRequired) * 100);
  const selectedTierConfig = TIER_CONFIG[selectedTier];

  return (
    <>
      <div
        className="glass-card-sm p-4 mt-4"
        style={{ borderColor: isEligible ? `rgba(${selectedTierConfig.rgb},0.3)` : "rgba(212,0,122,0.15)" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: isEligible ? selectedTierConfig.color : "#D4007A" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-semibold text-white">{p.monetizeYourProfile}</p>
          </div>
          {!isEligible && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(212,0,122,0.12)", color: "#D4007A" }}>
              {totalMet}/{totalRequired} met
            </span>
          )}
        </div>

        {isEligible ? (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {p.creatorMonetizeDesc}
            </p>

            {/* Tier selector */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {CREATOR_TIERS.map((tier) => {
                const isSelected = selectedTier === tier.id;
                return (
                  <button
                    key={tier.id}
                    onClick={() => setSelectedTier(tier.id)}
                    className="relative rounded-xl p-3 text-center transition-all"
                    style={{
                      background: isSelected ? `rgba(${TIER_CONFIG[tier.id].rgb},0.15)` : "rgba(255,255,255,0.03)",
                      border: isSelected ? `2px solid rgba(${TIER_CONFIG[tier.id].rgb},0.6)` : "2px solid rgba(255,255,255,0.08)",
                      opacity: isSelected ? 1 : 0.7,
                    }}
                  >
                    <p className="text-lg mb-0.5">{tier.emoji}</p>
                    <p className={`text-xs font-bold ${isSelected ? "text-white" : "text-white/70"}`}>{tier.label}</p>
                    <p className="text-sm font-bold mt-0.5" style={{ color: isSelected ? tier.color : TIER_CONFIG[tier.id].color }}>
                      ${tier.price}<span className="text-xs font-normal">/mo</span>
                    </p>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowWizard(true)}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ background: selectedTierConfig.gradient }}
            >
              {selectedTierConfig.emoji} {p.startEnrollment}
            </button>
          </>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {p.meetRequirementsToUnlock}
            </p>

            <div className="mb-3">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${overallPct}%`,
                    background: overallPct >= 75 ? "linear-gradient(to right, #5ED1C4, #00D4E8)" : "linear-gradient(to right, #D4007A, #E69138)",
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              {([
                { key: "mediaPosts", label: p.mediaPosts, icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" },
                { key: "totalLikes", label: p.totalLikes, icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" },
                { key: "followers", label: p.followers, icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" },
                { key: "weeklyConsistency", label: p.weeklyPosts4Weeks, icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
              ] as const).map(({ key, label, icon }) => {
                const c = criteria[key];
                const pct = Math.min((c.current / c.required) * 100, 100);
                const remaining = Math.max(0, c.required - c.current);
                return (
                  <div key={key} className="flex items-center gap-2.5">
                    <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      {c.met ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5ED1C4">
                          <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-white/80 truncate">{label}</span>
                        <span className="text-xs font-medium ml-2 flex-shrink-0" style={{ color: c.met ? "#5ED1C4" : "#8E8E93" }}>
                          {c.met ? p.done : `${remaining} ${p.moreRequired}`}
                        </span>
                      </div>
                      {!c.met && (
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: "linear-gradient(to right, #D4007A, #E69138)" }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              disabled
              className="w-full mt-3 py-2.5 rounded-lg text-sm font-semibold text-white/40 cursor-not-allowed"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {p.completeRequirementsToEnroll}
            </button>
          </>
        )}
      </div>

      {showWizard && (
        <CreatorEnrollmentWizard
          tier={selectedTier}
          onClose={() => setShowWizard(false)}
          onSubmitted={() => { setShowWizard(false); onActivated?.(); }}
        />
      )}
    </>
  );
}
