import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import {
  getCreatorEligibility,
  getCreatorDashboard,
  getModelEarnings,
  getWithdrawableAmount,
  requestWithdrawal,
  getWithdrawalHistory,
  type CreatorEligibility,
  type CreatorDashboard as DashboardData,
  type ModelEarnings,
  type ModelWithdrawal,
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
  const [error, setError] = useState<string | null>(null);

  // Earnings & withdrawal state
  const [earnings, setEarnings] = useState<ModelEarnings | null>(null);
  const [withdrawable, setWithdrawable] = useState<number>(0);
  const [withdrawals, setWithdrawals] = useState<ModelWithdrawal[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "earnings" | "payouts">("overview");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eligRes, dashRes] = await Promise.all([
        getCreatorEligibility(),
        getCreatorDashboard(),
      ]);
      setEligibility(eligRes);
      setDashboard(dashRes);

      // If active creator, also load model earnings data
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
    // Redirect to profile where the tier selection + T&C flow lives
    navigate("/profile");
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const res = await requestWithdrawal("bank_transfer");
      setWithdrawSuccess(`Withdrawal of $${res.data.withdrawal.amountUsd.toFixed(2)} requested successfully`);
      await load(); // Refresh data
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to request withdrawal");
    } finally {
      setWithdrawing(false);
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
          {/* Tab navigation */}
          <div className="flex border-b border-white/10 mb-4">
            {(["overview", "earnings", "payouts"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
                  activeTab === tab ? "text-white border-b-2" : "text-white/50"
                }`}
                style={activeTab === tab ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
              >
                {tab === "overview" ? "Overview" : tab === "earnings" ? "Earnings" : "Payouts"}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
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

              {/* Withdrawable amount card */}
              {withdrawable > 0 && (
                <div className="glass-card-sm p-4 mb-4" style={{ borderColor: "rgba(94,209,196,0.3)" }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs" style={{ color: "#8E8E93" }}>Available to withdraw</p>
                      <p className="text-xl font-bold" style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</p>
                    </div>
                    <button
                      onClick={() => setActiveTab("payouts")}
                      className="text-xs font-semibold px-4 py-2 rounded-lg"
                      style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
                    >
                      Withdraw
                    </button>
                  </div>
                </div>
              )}

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

          {/* Earnings Tab */}
          {activeTab === "earnings" && (
            <div className="space-y-4">
              {earnings ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="glass-card-sm p-4 text-center">
                      <p className="text-xl font-bold" style={{ color: "#5ED1C4" }}>
                        ${(earnings.summary.total_creator || 0).toFixed(2)}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Your Earnings (70%)</p>
                    </div>
                    <div className="glass-card-sm p-4 text-center">
                      <p className="text-xl font-bold text-white">
                        ${(earnings.summary.total_gross || 0).toFixed(2)}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Gross Revenue</p>
                    </div>
                  </div>

                  {/* Revenue trends */}
                  {earnings.trends && earnings.trends.length > 0 && (
                    <div className="glass-card-sm p-4">
                      <p className="text-sm font-semibold text-white mb-3">Monthly Trends</p>
                      <div className="space-y-2">
                        {earnings.trends.slice(-6).map((t, i) => {
                          const maxAmount = Math.max(...earnings.trends.slice(-6).map(x => x.amount), 1);
                          const pct = (t.amount / maxAmount) * 100;
                          return (
                            <div key={i} className="flex items-center gap-3">
                              <span className="text-xs w-16 flex-shrink-0" style={{ color: "#8E8E93" }}>
                                {new Date(t.month).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                              </span>
                              <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${pct}%`, background: "linear-gradient(to right, #D4007A, #E69138)" }}
                                />
                              </div>
                              <span className="text-xs font-medium text-white w-16 text-right">${t.amount.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="glass-card-sm p-8 text-center">
                  <p className="text-white/60 text-sm">No earnings data yet. Start sharing exclusive content to earn!</p>
                </div>
              )}
            </div>
          )}

          {/* Payouts Tab */}
          {activeTab === "payouts" && (
            <div className="space-y-4">
              {/* Withdraw card */}
              <div className="glass-card-sm p-5" style={{ borderColor: "rgba(94,209,196,0.2)" }}>
                <p className="text-sm font-semibold text-white mb-1">Request Withdrawal</p>
                <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
                  Available balance: <strong style={{ color: "#5ED1C4" }}>${withdrawable.toFixed(2)}</strong>
                </p>
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
                  onClick={handleWithdraw}
                  disabled={withdrawing || withdrawable <= 0}
                  className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #5ED1C4, #00D4E8)", color: "#000" }}
                >
                  {withdrawing ? "Processing..." : withdrawable <= 0 ? "No balance to withdraw" : `Withdraw $${withdrawable.toFixed(2)}`}
                </button>
              </div>

              {/* Withdrawal history */}
              <div className="glass-card-sm p-4">
                <p className="text-sm font-semibold text-white mb-3">Withdrawal History</p>
                {withdrawals.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: "#8E8E93" }}>No withdrawals yet</p>
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
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                Choose Tier & Activate
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
