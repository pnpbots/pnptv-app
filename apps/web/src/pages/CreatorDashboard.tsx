import React, { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { CreatorAvailabilitySettings } from "@/components/creators";
import {
  getCreatorEligibility,
  getCreatorDashboard,
  activateCreator,
  getModelEarnings,
  getWithdrawableAmount,
  getWithdrawalHistory,
  getWebRTCStreamerConfig,
  type CreatorEligibility,
  type CreatorDashboard as DashboardData,
  type ModelEarnings,
  type ModelWithdrawal,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

import { OverviewTab } from "./creator/OverviewTab";
import { EarningsTab } from "./creator/EarningsTab";
import { PayoutsTab } from "./creator/PayoutsTab";
import { ContentTab } from "./creator/ContentTab";
import { SettingsTab } from "./creator/SettingsTab";
import { CallPackageManager } from "./creator/CallPackageManager";

import { JitsiMeetComponent } from "@/components/hangouts";

const TIERS: { key: "ice" | "crystal" | "diamond"; label: string; emoji: string }[] = [
  { key: "ice", label: "Ice", emoji: "❄" },
  { key: "crystal", label: "Crystal", emoji: "🔮" },
  { key: "diamond", label: "Diamond", emoji: "💎" },
];

type TabKey = "overview" | "earnings" | "payouts" | "settings" | "content" | "golive" | "availability";

// ─── Progress Bar ────────────────────────────────────────────────────────────

function CriterionBar({ label, current, required, met }: { label: string; current: number; required: number; met: boolean }) {
  const pct = Math.min((current / required) * 100, 100);
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-white/80">{label}</span>
        <span style={{ color: met ? "#5ED1C4" : "#8E8E93" }}>
          {current}/{required} {met ? "\u2713" : ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: met ? "#5ED1C4" : "linear-gradient(to right, #D4007A, #E69138)",
          }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CreatorDashboard() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { creator: t } = useI18n();

  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [dashboard, setDashboard] = useState<(DashboardData & { success: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Secondary data for active creators
  const [earnings, setEarnings] = useState<ModelEarnings | null>(null);
  const [withdrawable, setWithdrawable] = useState<number>(0);
  const [withdrawals, setWithdrawals] = useState<ModelWithdrawal[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // Activation modal state
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activateTerms, setActivateTerms] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // Go Live streamer state
  const [streamerMeetingUrl, setStreamerMeetingUrl] = useState<string | null>(null);
  const [streamerConnecting, setStreamerConnecting] = useState(false);
  const [streamerError, setStreamerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eligRes, dashRes] = await Promise.all([
        getCreatorEligibility(),
        getCreatorDashboard(),
      ]);
      setEligibility(eligRes);
      setDashboard(dashRes);

      if (dashRes.creatorStatus === "active") {
        const [earningsRes, withdrawableRes, historyRes] = await Promise.allSettled([
          getModelEarnings(),
          getWithdrawableAmount(),
          getWithdrawalHistory(),
        ]);
        if (earningsRes.status === "fulfilled" && earningsRes.value.success) {
          setEarnings(earningsRes.value.data);
        }
        if (withdrawableRes.status === "fulfilled" && withdrawableRes.value.success) {
          setWithdrawable(withdrawableRes.value.data.withdrawable.amount);
        }
        if (historyRes.status === "fulfilled" && historyRes.value.success) {
          setWithdrawals(historyRes.value.data.withdrawals);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  const handleActivate = () => {
    setActivateError(null);
    setActivateTerms(false);
    setShowActivateModal(true);
  };

  const handleConfirmActivate = async () => {
    if (!activateTerms) {
      setActivateError(t.errorMustAcceptTerms);
      return;
    }
    setActivating(true);
    setActivateError(null);
    try {
      await activateCreator("ice", true);
      setShowActivateModal(false);
      await load();
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : t.errorActivationFailed);
    } finally {
      setActivating(false);
    }
  };

  // ── Auth guard ──
  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-white/60">{t.signInRequired}</p>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-white/5 rounded w-48" />
          <div className="h-32 bg-white/5 rounded-lg" />
          <div className="h-32 bg-white/5 rounded-lg" />
        </div>
      </div>
    );
  }

  const isActive = dashboard?.creatorStatus === "active";
  const isEligible = dashboard?.creatorStatus === "eligible";
  const isPending = dashboard?.creatorStatus === "pending_review";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm mb-4 hover:text-pnp-accent transition-colors"
        style={{ color: "#8E8E93" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        {t.back}
      </button>

      <h1 className="text-2xl font-bold text-white mb-1">{t.dashboardTitle}</h1>
      <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{t.dashboardSubtitle}</p>

      {/* Creator identity hero */}
      {isActive && dashboard && (() => {
        const tierInfo = TIERS.find((tier) => tier.key === dashboard.creatorType);
        const initials = (user?.displayName || user?.username || "C").charAt(0).toUpperCase();
        return (
          <div className="flex items-center gap-4 mb-6 px-4 py-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white truncate">{user?.displayName || user?.username || "Creator"}</span>
                {dashboard.verified && (
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#5ED1C4">
                    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                )}
                {tierInfo && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                    {tierInfo.emoji} {tierInfo.label}
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                {dashboard.subscriberCount} subscriber{dashboard.subscriberCount !== 1 ? "s" : ""} &middot; ${dashboard.priceUsd.toFixed(2)}/mo
              </p>
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
          {error}
        </div>
      )}

      {/* ── Active Creator Dashboard ── */}
      {isActive && dashboard && (
        <>
          {/* Tab navigation */}
          <div className="flex overflow-x-auto border-b border-white/10 mb-4 scrollbar-hide">
            {(["overview", "earnings", "payouts", "content", "golive", "availability", "settings"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-shrink-0 flex-1 min-w-[60px] py-3 text-xs font-semibold text-center transition-colors ${
                  activeTab === tab ? "text-white border-b-2" : "text-white/50"
                }`}
                style={activeTab === tab ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
              >
                {tab === "overview" ? t.tabOverview
                  : tab === "earnings" ? t.tabEarnings
                  : tab === "payouts" ? t.tabPayouts
                  : tab === "content" ? t.tabContent
                  : tab === "golive" ? t.tabGoLive
                  : tab === "availability" ? "Availability"
                  : t.tabSettings
                }
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <OverviewTab
              dashboard={dashboard}
              user={user}
              withdrawable={withdrawable}
              t={t}
              onTabChange={(tab) => setActiveTab(tab as TabKey)}
            />
          )}

          {activeTab === "earnings" && <EarningsTab earnings={earnings} t={t} />}

          {activeTab === "payouts" && (
            <PayoutsTab
              withdrawable={withdrawable}
              withdrawals={withdrawals}
              t={t}
              onReload={load}
            />
          )}

          {activeTab === "content" && <ContentTab t={t} />}

          {activeTab === "golive" && (
            <div className="glass-card-sm p-4 space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">Go Live</h2>
                <p className="text-xs text-pnp-textSecondary mt-0.5">Start a JaaS video stream that your audience can join</p>
              </div>

              {!streamerMeetingUrl && !streamerError && (
                streamerConnecting ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      setStreamerConnecting(true);
                      setStreamerError(null);
                      try {
                        const config = await getWebRTCStreamerConfig();
                        if (config.meetingUrl) {
                          setStreamerMeetingUrl(config.meetingUrl);
                        } else {
                          setStreamerError(config.error ?? "No channel assigned. Contact support.");
                        }
                      } catch (err: any) {
                        setStreamerError(err?.message || "Failed to start stream.");
                      } finally {
                        setStreamerConnecting(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2.5 min-h-[52px] px-6 rounded-2xl text-sm font-bold text-white btn-gradient transition-all hover:opacity-90 active:scale-[0.98]"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="2" />
                      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
                    </svg>
                    Start Streaming
                  </button>
                )
              )}

              {streamerError && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm bg-pnp-error/10 border border-pnp-error/25" role="alert">
                    <span className="text-white/80 min-w-0 break-words">{streamerError}</span>
                  </div>
                  <button
                    onClick={() => setStreamerError(null)}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white btn-gradient"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {streamerMeetingUrl && (
                <>
                  <div style={{ height: "calc(100vh - 280px)", minHeight: "400px" }}>
                    <JitsiMeetComponent
                      meetingUrl={streamerMeetingUrl}
                      onCallEnd={() => setStreamerMeetingUrl(null)}
                      isModerator
                      fullScreen={false}
                      className="w-full h-full"
                    />
                  </div>
                  <button
                    onClick={() => setStreamerMeetingUrl(null)}
                    className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{ background: "linear-gradient(135deg, #b91c1c, #dc2626)" }}
                  >
                    Stop Streaming
                  </button>
                </>
              )}
            </div>
          )}

          {activeTab === "availability" && (
            <div className="space-y-4">
              <CreatorAvailabilitySettings />
              <CallPackageManager />
            </div>
          )}

          {activeTab === "settings" && <SettingsTab dashboard={dashboard} t={t} />}
        </>
      )}

      {/* ── Eligible — Activate ── */}
      {isEligible && (
        <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
          <p className="text-lg font-bold text-white mb-2">{t.eligibleTitle}</p>
          <p className="text-sm text-white/70 mb-4">{t.eligibleSubtitle}</p>

          <div className="space-y-3">
            <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-white">❄ {t.iceCreatorLabel}</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>{t.iceStartingTier}</span>
              </div>
              <p className="text-xs mt-1 mb-3" style={{ color: "#8E8E93" }}>{t.iceDesc}</p>
              <button
                onClick={handleActivate}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {t.activateAsCreatorBtn}
              </button>
            </div>

            <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-sm font-semibold text-white">{t.fullTimeCreatorLabel}</p>
              <p className="text-xs mt-1 mb-3" style={{ color: "#8E8E93" }}>{t.fullTimeDesc}</p>
              <button
                onClick={() => navigate("/apply")}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                {t.applyFullTimeBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending Review ── */}
      {isPending && dashboard?.application && (
        <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(255,180,84,0.3)" }}>
          <p className="text-lg font-bold text-white mb-2">{t.pendingTitle}</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: dashboard.application.call_scheduled ? "#5ED1C4" : "#FFB454" }} />
              <span className="text-white/80">
                {dashboard.application.call_scheduled ? t.callScheduled : t.pendingReview}
              </span>
            </div>
            {!dashboard.application.call_scheduled && (
              <a
                href="https://booking.pnptv.app/santino/model-interview"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold px-4 py-2 rounded-lg mt-2"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {t.bookInterviewBtn}
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Activation Modal ── */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70" onClick={() => setShowActivateModal(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white">{t.activateTitle}</h2>

            <div className="rounded-xl px-4 py-3" style={{ background: "rgba(94,209,196,0.07)", border: "1px solid rgba(94,209,196,0.2)" }}>
              <p className="text-sm font-semibold text-white mb-1">❄ {t.activateIceTierLabel}</p>
              <p className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>{t.activateIceTierDesc}</p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={activateTerms}
                onChange={(e) => { setActivateTerms(e.target.checked); setActivateError(null); }}
                className="mt-0.5 w-4 h-4 accent-[#D4007A]"
              />
              <span className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
                {t.activateTermsLabel}{" "}
                <a href="/creator-terms" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#D4007A" }}>
                  {t.activateTermsLink}
                </a>
                {" "}{t.activateTermsAnd}
              </span>
            </label>

            {activateError && <p className="text-xs text-red-400">{activateError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowActivateModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93" }}
                disabled={activating}
              >
                {t.cancelBtn}
              </button>
              <button
                onClick={handleConfirmActivate}
                disabled={activating || !activateTerms}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {activating ? t.activatingBtn : t.activateBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Not Eligible — Progress ── */}
      {!isActive && !isEligible && !isPending && eligibility && (() => {
        const criteria = [
          { label: t.criteriaMediaPosts, ...eligibility.criteria.mediaPosts },
          { label: t.criteriaTotalLikes, ...eligibility.criteria.totalLikes },
          { label: t.criteriaFollowers, ...eligibility.criteria.followers },
          { label: t.criteriaWeekly, ...eligibility.criteria.weeklyConsistency },
        ];
        const metCount = criteria.filter((c) => c.met).length;
        const totalPct = Math.round(criteria.reduce((acc, c) => acc + Math.min(c.current / c.required, 1), 0) / criteria.length * 100);
        const closest = [...criteria].filter((c) => !c.met).sort((a, b) => (b.current / b.required) - (a.current / a.required))[0];
        return (
          <div className="glass-card-sm p-5 mb-4">
            <div className="flex items-start justify-between mb-1">
              <p className="text-lg font-bold text-white">{t.becomeCreatorTitle}</p>
              <span className="text-sm font-bold" style={{ color: totalPct >= 75 ? "#5ED1C4" : "#E69138" }}>{totalPct}%</span>
            </div>
            <p className="text-sm mb-1" style={{ color: "#8E8E93" }}>
              {metCount === 0 ? t.noCriteriaMet : metCount < criteria.length ? t.someCriteriaMet(metCount, criteria.length) : ""}
            </p>
            {closest && !closest.met && (
              <p className="text-xs mb-4 font-medium" style={{ color: "#E69138" }}>
                {t.closestHint(closest.label, closest.required - closest.current)}
              </p>
            )}
            <CriterionBar label={t.criteriaMediaPosts} {...eligibility.criteria.mediaPosts} />
            <CriterionBar label={t.criteriaTotalLikes} {...eligibility.criteria.totalLikes} />
            <CriterionBar label={t.criteriaFollowers} {...eligibility.criteria.followers} />
            <CriterionBar label={t.criteriaWeekly} {...eligibility.criteria.weeklyConsistency} />
            <p className="text-xs mt-4 text-center" style={{ color: "#8E8E93" }}>{t.progressFootnote}</p>
          </div>
        );
      })()}
    </div>
  );
}
