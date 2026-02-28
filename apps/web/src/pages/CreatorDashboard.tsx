import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import {
  getCreatorEligibility,
  getCreatorDashboard,
  activateCreator,
  type CreatorEligibility,
  type CreatorDashboard as DashboardData,
} from "@/lib/api";

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

export default function CreatorDashboard() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [dashboard, setDashboard] = useState<(DashboardData & { success: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eligRes, dashRes] = await Promise.all([
        getCreatorEligibility(),
        getCreatorDashboard(),
      ]);
      setEligibility(eligRes);
      setDashboard(dashRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  const handleActivate = async () => {
    setActivating(true);
    try {
      await activateCreator();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate");
    } finally {
      setActivating(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-white/60">Sign in to access the Creator Dashboard</p>
      </div>
    );
  }

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
        Back
      </button>

      <h1 className="text-2xl font-bold text-white mb-1">Creator Dashboard</h1>
      <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>
        Earn money by sharing exclusive content with your subscribers
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
          {error}
        </div>
      )}

      {/* ── Active Creator Dashboard ── */}
      {isActive && dashboard && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="glass-card-sm p-4 text-center">
              <p className="text-2xl font-bold text-white">{dashboard.subscriberCount}</p>
              <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Subscribers</p>
            </div>
            <div className="glass-card-sm p-4 text-center">
              <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>${dashboard.monthlyEarnings.toFixed(2)}</p>
              <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>This Month</p>
            </div>
            <div className="glass-card-sm p-4 text-center">
              <p className="text-2xl font-bold text-white">${dashboard.totalEarnings.toFixed(2)}</p>
              <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Total Earnings</p>
            </div>
            <div className="glass-card-sm p-4 text-center">
              <p className="text-2xl font-bold text-white">{dashboard.exclusivePostCount}</p>
              <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Exclusive Posts</p>
            </div>
          </div>

          <div className="glass-card-sm p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  {dashboard.creatorType === "full_time" ? "Full-Time Creator" : "Occasional Creator"}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                  ${dashboard.priceUsd.toFixed(2)}/month &middot; 70/30 revenue split
                </p>
              </div>
              {dashboard.verified && (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5ED1C4" aria-label="Verified">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              )}
            </div>
          </div>

          {/* Upgrade to full-time if occasional */}
          {dashboard.creatorType === "occasional" && (
            <div className="glass-card-sm p-4 mb-4" style={{ borderColor: "rgba(212,0,122,0.2)" }}>
              <p className="text-sm font-medium text-white mb-1">Want more?</p>
              <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
                Apply as a full-time creator to set your own price, get verified, and appear in featured placements.
              </p>
              <button
                onClick={() => navigate("/apply")}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                Apply for Full-Time
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Eligible — Activate ── */}
      {isEligible && (
        <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
          <p className="text-lg font-bold text-white mb-2">You're eligible!</p>
          <p className="text-sm text-white/70 mb-4">
            You meet all the criteria to become a creator. Choose your path:
          </p>

          <div className="space-y-3">
            <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-sm font-semibold text-white">Occasional Creator</p>
              <p className="text-xs mt-1 mb-3" style={{ color: "#8E8E93" }}>
                Fixed $15/month subscription. Start immediately. 70/30 revenue split.
              </p>
              <button
                onClick={handleActivate}
                disabled={activating}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {activating ? "Activating..." : "Activate Now"}
              </button>
            </div>

            <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-sm font-semibold text-white">Full-Time Creator</p>
              <p className="text-xs mt-1 mb-3" style={{ color: "#8E8E93" }}>
                Set your own price. Verified badge. Featured placement. Live streams. Interview with Santino required.
              </p>
              <button
                onClick={() => navigate("/apply")}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                Apply for Full-Time
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending Review ── */}
      {isPending && dashboard?.application && (
        <div className="glass-card-sm p-5 mb-4" style={{ borderColor: "rgba(255,180,84,0.3)" }}>
          <p className="text-lg font-bold text-white mb-2">Application Under Review</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: dashboard.application.call_scheduled ? "#5ED1C4" : "#FFB454" }} />
              <span className="text-white/80">
                {dashboard.application.call_scheduled ? "Call Scheduled" : "Pending Review"}
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
                Book Interview with Santino
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Not Eligible — Progress ── */}
      {!isActive && !isEligible && !isPending && eligibility && (
        <div className="glass-card-sm p-5 mb-4">
          <p className="text-lg font-bold text-white mb-1">Become a Creator</p>
          <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>
            Meet these criteria to qualify:
          </p>
          <CriterionBar label="Media posts" {...eligibility.criteria.mediaPosts} />
          <CriterionBar label="Total likes" {...eligibility.criteria.totalLikes} />
          <CriterionBar label="Followers" {...eligibility.criteria.followers} />
          <CriterionBar label="Weekly consistency (4 weeks)" {...eligibility.criteria.weeklyConsistency} />
        </div>
      )}

    </div>
  );
}
