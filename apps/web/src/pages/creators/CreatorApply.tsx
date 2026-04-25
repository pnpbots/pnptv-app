import React, { useState, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { useCreatorData } from "@/hooks/useCreatorData";
import { activateCreator } from "@/lib/api";

function CriterionBar({
  label,
  current,
  required,
  met,
}: {
  label: string;
  current: number;
  required: number;
  met: boolean;
}) {
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

export default function CreatorApply() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { creator: t } = useI18n();
  const { eligibility, dashboard, loading, reload } = useCreatorData();

  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activateTerms, setActivateTerms] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const handleConfirmActivate = useCallback(async () => {
    if (!activateTerms) {
      setActivateError(t.errorMustAcceptTerms);
      return;
    }
    setActivating(true);
    setActivateError(null);
    try {
      await activateCreator("ice", true);
      setShowActivateModal(false);
      await reload();
      navigate("/creators", { replace: true });
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : t.errorActivationFailed);
    } finally {
      setActivating(false);
    }
  }, [activateTerms, t, reload, navigate]);

  const isActive = dashboard?.creatorStatus === "active";
  const isEligible = dashboard?.creatorStatus === "eligible";
  const isPending = dashboard?.creatorStatus === "pending_review";

  return (
    <>
      <Helmet>
        <title>Become a Creator — Creator Studio — PNPtv!</title>
      </Helmet>

      <div className="p-4 lg:p-6 max-w-2xl mx-auto">

        {/* ── Already active ── */}
        {isActive && (
          <div className="glass-card-sm p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
              ✓
            </div>
            <div>
              <h1 className="text-xl font-bold text-white mb-1">You're an active creator!</h1>
              <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                Your creator account is live. Head to your dashboard to manage content, earnings, and more.
              </p>
            </div>
            <button
              onClick={() => navigate("/creators")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              Go to Creator Studio
            </button>
          </div>
        )}

        {!isActive && (
          <>
            {/* Hero */}
            <div className="text-center mb-8">
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", border: "1px solid rgba(212,0,122,0.3)" }}>
                🎬
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Join the Creator Program</h1>
              <p className="text-sm leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                Share exclusive content, build your subscriber base, and earn directly from your fans on PNPtv!
              </p>
            </div>

            {/* Perks */}
            <div className="glass-card-sm p-5 mb-4">
              <p className="text-sm font-semibold text-white mb-3">Why become a creator?</p>
              <ul className="space-y-2.5">
                {[
                  "Earn 70% of subscription revenue",
                  "Post exclusive content for subscribers",
                  "Go live and earn tips in real-time",
                  "Book private 1-on-1 video calls",
                  "Access detailed analytics and insights",
                  "Three creator tiers: Ice, Crystal, Diamond",
                ].map((perk) => (
                  <li key={perk} className="flex items-start gap-2.5 text-sm">
                    <span
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{perk}</span>
                  </li>
                ))}
              </ul>
            </div>

            {loading && (
              <div className="animate-pulse space-y-3">
                <div className="h-32 bg-white/5 rounded-lg" />
                <div className="h-24 bg-white/5 rounded-lg" />
              </div>
            )}

            {/* ── Eligible — Activate ── */}
            {!loading && isEligible && (
              <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
                <p className="text-lg font-bold text-white mb-2">{t.eligibleTitle}</p>
                <p className="text-sm text-white/70 mb-4">{t.eligibleSubtitle}</p>

                <div className="space-y-3">
                  <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-white">❄ {t.iceCreatorLabel}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>{t.iceStartingTier}</span>
                    </div>
                    <p className="text-xs mt-1 mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.iceDesc}</p>
                    <button
                      onClick={() => { setActivateError(null); setActivateTerms(false); setShowActivateModal(true); }}
                      className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                    >
                      {t.activateAsCreatorBtn}
                    </button>
                  </div>

                  <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-sm font-semibold text-white">{t.fullTimeCreatorLabel}</p>
                    <p className="text-xs mt-1 mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.fullTimeDesc}</p>
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
            {!loading && isPending && dashboard?.application && (
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

            {/* ── Not Yet Eligible — Must Share Content First ── */}
            {!loading && !isEligible && !isPending && isAuthenticated && eligibility && (() => {
              const criteria = [
                { label: t.criteriaMediaPosts, ...eligibility.criteria.mediaPosts },
                { label: t.criteriaTotalLikes, ...eligibility.criteria.totalLikes },
                { label: t.criteriaFollowers, ...eligibility.criteria.followers },
                { label: t.criteriaWeekly, ...eligibility.criteria.weeklyConsistency },
              ];
              const metCount = criteria.filter((c) => c.met).length;
              const totalPct = Math.round(
                criteria.reduce((acc, c) => acc + Math.min(c.current / c.required, 1), 0) / criteria.length * 100
              );
              const closest = [...criteria]
                .filter((c) => !c.met)
                .sort((a, b) => b.current / b.required - a.current / a.required)[0];
              return (
                <>
                  {/* Gate notice */}
                  <div
                    className="rounded-xl p-4 mb-4 flex items-start gap-3"
                    style={{ background: "rgba(230,145,56,0.08)", border: "1px solid rgba(230,145,56,0.25)" }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#E69138" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-white mb-1">Share content to unlock the Creator Program</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                        Before you can apply, you need to be an active community member. Post photos and videos,
                        engage with others, and build your following. Meet all 4 criteria below to unlock your application.
                      </p>
                    </div>
                  </div>

                  {/* Progress card */}
                  <div className="glass-card-sm p-5 mb-4">
                    <div className="flex items-start justify-between mb-1">
                      <p className="text-lg font-bold text-white">{t.becomeCreatorTitle}</p>
                      <span className="text-sm font-bold" style={{ color: totalPct >= 75 ? "#5ED1C4" : "#E69138" }}>{totalPct}%</span>
                    </div>
                    <p className="text-sm mb-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
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
                    <p className="text-xs mt-4 text-center" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.progressFootnote}</p>
                  </div>

                  {/* CTA to start sharing */}
                  <div className="text-center">
                    <button
                      onClick={() => navigate("/social")}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Start Sharing Content
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Not authenticated CTA */}
            {!isAuthenticated && (
              <div className="glass-card-sm p-6 text-center space-y-3">
                <p className="text-sm font-semibold text-white">Sign in to check your eligibility</p>
                <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  Connect your account to see your progress toward becoming a creator.
                </p>
                <button
                  onClick={() => navigate("/")}
                  className="px-6 py-3 rounded-xl text-sm font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  Sign In
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Activation Modal ── */}
        {showActivateModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70"
            onClick={() => setShowActivateModal(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl p-6 space-y-4"
              style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.1)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white">{t.activateTitle}</h2>

              <div className="rounded-xl px-4 py-3" style={{ background: "rgba(94,209,196,0.07)", border: "1px solid rgba(94,209,196,0.2)" }}>
                <p className="text-sm font-semibold text-white mb-1">❄ {t.activateIceTierLabel}</p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{t.activateIceTierDesc}</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activateTerms}
                  onChange={(e) => { setActivateTerms(e.target.checked); setActivateError(null); }}
                  className="mt-0.5 w-4 h-4 accent-[#D4007A]"
                />
                <span className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {t.activateTermsLabel}{" "}
                  <a
                    href="/creator-terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: "#D4007A" }}
                  >
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
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--pnp-text-secondary, #8E8E93)" }}
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
      </div>
    </>
  );
}
