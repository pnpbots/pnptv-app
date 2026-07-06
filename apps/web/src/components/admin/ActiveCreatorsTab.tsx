import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  listActiveCreators,
  issueCreatorStrike,
  getCreatorStrikes,
  setCreatorLock,
  promoteCreator,
  setCreatorEligible,
  getCreatorEngagement,
  type ActiveCreator,
  type CreatorStrike,
  type CreatorEngagementScore,
} from "@/lib/api";

function resolvePhotoUrl(photo: string | null | undefined): string | null {
  if (!photo || typeof photo !== "string") return null;
  if (photo.startsWith("/") || photo.startsWith("http")) return photo;
  return null;
}

const TYPE_LABELS: Record<string, string> = {
  live: "Live Performer",
  content_creator: "Content Creator",
  both: "Live + Content",
  ice: "Ice",
  crystal: "Crystal",
  diamond: "Diamond",
  occasional: "Occasional",
  full_time: "Full Time",
};

// ── Strike badge ──────────────────────────────────────────────────────────────

function StrikeBadge({ count, suspended }: { count: number; suspended: boolean }) {
  if (suspended || count >= 3) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-bold tracking-wide"
        style={{ background: "rgba(239,68,68,0.18)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.35)" }}
      >
        SUSPENDED
      </span>
    );
  }
  if (count === 2) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-semibold"
        style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.25)" }}
      >
        2/3 strikes
      </span>
    );
  }
  if (count === 1) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-semibold"
        style={{ background: "rgba(230,145,56,0.15)", color: "#E69138", border: "1px solid rgba(230,145,56,0.3)" }}
      >
        1/3 strikes
      </span>
    );
  }
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{ background: "rgba(255,255,255,0.06)", color: "var(--pnp-text-secondary, #8E8E93)" }}
    >
      0 strikes
    </span>
  );
}

// ── Creator avatar helper ─────────────────────────────────────────────────────

function CreatorAvatar({ creator }: { creator: ActiveCreator }) {
  const displayName =
    creator.first_name || creator.username || "?";
  const initial = displayName[0].toUpperCase();
  const photoSrc = resolvePhotoUrl(creator.photo_file_id);

  if (photoSrc) {
    return (
      <img
        src={photoSrc}
        alt=""
        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
    >
      {initial}
    </div>
  );
}

// ── Strike history panel ──────────────────────────────────────────────────────

function StrikeHistoryPanel({
  creatorId,
  onClose,
}: {
  creatorId: string;
  onClose: () => void;
}) {
  const [strikes, setStrikes] = useState<CreatorStrike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getCreatorStrikes(creatorId)
      .then((res) => setStrikes(res.strikes))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load strikes")
      )
      .finally(() => setLoading(false));
  }, [creatorId]);

  return (
    <div
      className="mt-3 rounded-lg p-3 backdrop-blur"
      style={{ background: "rgba(18,18,18,0.85)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-white/80">Strike History</span>
        <button
          onClick={onClose}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Close
        </button>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : strikes.length === 0 ? (
        <p className="text-xs text-white/40">No strikes on record.</p>
      ) : (
        <div className="space-y-2">
          {strikes.map((s) => (
            <div
              key={s.id}
              className="rounded p-2"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-xs font-bold"
                  style={{ color: s.strike_number >= 3 ? "#EF4444" : s.strike_number === 2 ? "#EF4444" : "#E69138" }}
                >
                  Strike {s.strike_number}/3
                </span>
                <span className="text-xs text-white/40">
                  {new Date(s.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-white/70">{s.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Issue Strike form ─────────────────────────────────────────────────────────

interface StrikeFormState {
  reason: string;
  submitting: boolean;
  result: { strikeCount: number; suspended: boolean } | null;
  error: string | null;
}

function IssueStrikeForm({
  creator,
  onStrikeIssued,
  onCancel,
}: {
  creator: ActiveCreator;
  onStrikeIssued: (updatedCreator: ActiveCreator) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<StrikeFormState>({
    reason: "",
    submitting: false,
    result: null,
    error: null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = form.reason.trim();
    if (!trimmed) {
      setForm((prev) => ({ ...prev, error: "A reason is required." }));
      return;
    }
    setForm((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      const res = await issueCreatorStrike(creator.id, trimmed);
      setForm((prev) => ({ ...prev, submitting: false, result: res }));
      onStrikeIssued({
        ...creator,
        creator_strikes: res.strikeCount,
        creator_status: res.suspended ? "suspended" : creator.creator_status,
      });
    } catch (err) {
      setForm((prev) => ({
        ...prev,
        submitting: false,
        error: err instanceof Error ? err.message : "Failed to issue strike",
      }));
    }
  };

  if (form.result) {
    return (
      <div
        className="mt-3 rounded-lg p-3"
        style={{ background: "rgba(18,18,18,0.85)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <p
          className="text-xs font-semibold mb-1"
          style={{ color: form.result.suspended ? "#EF4444" : "#E69138" }}
        >
          {form.result.suspended
            ? "Creator has been suspended after 3 strikes."
            : `Strike issued. Creator now has ${form.result.strikeCount}/3 strikes.`}
        </p>
        <button
          onClick={onCancel}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-lg p-3 backdrop-blur"
      style={{ background: "rgba(18,18,18,0.85)", border: "1px solid rgba(212,0,122,0.2)" }}
    >
      <p className="text-xs font-semibold text-white/80 mb-2">
        Issue strike to{" "}
        <span style={{ color: "#D4007A" }}>
          {creator.first_name || creator.username}
        </span>
        {" "}(currently {creator.creator_strikes}/3)
      </p>
      <textarea
        value={form.reason}
        onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value, error: null }))}
        placeholder="Reason for strike (required)..."
        rows={3}
        className="w-full rounded-lg px-3 py-2 text-white placeholder:text-white/25 outline-none resize-none mb-2"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
        disabled={form.submitting}
      />
      {form.error && (
        <p className="text-xs text-red-400 mb-2">{form.error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={form.submitting || !form.reason.trim()}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
          style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          {form.submitting ? "Issuing..." : "Issue Strike"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={form.submitting}
          className="px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.05)", color: "var(--pnp-text-secondary, #8E8E93)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Promote Creator form ──────────────────────────────────────────────────────

const TIER_INFO: Record<"ice" | "crystal" | "diamond", { label: string; price: number; description: string }> = {
  ice:     { label: "Ice",     price: 5.00,  description: "Entry tier — $5/mo subscriptions" },
  crystal: { label: "Crystal", price: 10.00, description: "Mid tier — $10/mo subscriptions" },
  diamond: { label: "Diamond", price: 15.00, description: "Top tier — $15/mo subscriptions" },
};

function ScoreBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 66 ? "#A78BFA" : pct >= 31 ? "#60A5FA" : "#5ED1C4";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] tabular-nums" style={{ color, minWidth: 24, textAlign: "right" }}>{pct}</span>
    </div>
  );
}

function PromoteCreatorForm({
  creator,
  onPromoted,
  onCancel,
  loading,
  error,
}: {
  creator: ActiveCreator;
  onPromoted: (tier: "ice" | "crystal" | "diamond") => void;
  onCancel: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [selectedTier, setSelectedTier] = useState<"ice" | "crystal" | "diamond">("ice");
  const [engagement, setEngagement] = useState<CreatorEngagementScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);

  useEffect(() => {
    setScoreLoading(true);
    getCreatorEngagement(creator.id)
      .then((res) => {
        setEngagement(res);
        setSelectedTier(res.suggestedTier);
      })
      .catch(() => {})
      .finally(() => setScoreLoading(false));
  }, [creator.id]);

  const tierColor = (tier: string) =>
    tier === "diamond" ? "#A78BFA" : tier === "crystal" ? "#60A5FA" : "#5ED1C4";

  return (
    <div
      className="mt-3 rounded-lg p-3 backdrop-blur"
      style={{ background: "rgba(18,18,18,0.85)", border: "1px solid rgba(94,209,196,0.2)" }}
    >
      <p className="text-xs font-semibold text-white/80 mb-3">
        Activate{" "}
        <span style={{ color: "#5ED1C4" }}>
          {creator.first_name || creator.username}
        </span>{" "}
        as creator — choose tier:
      </p>

      {/* Engagement score panel */}
      {scoreLoading ? (
        <div className="h-16 rounded-lg bg-white/5 animate-pulse mb-3" />
      ) : engagement ? (
        <div
          className="rounded-lg px-3 py-2 mb-3"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-white/50">Engagement score</span>
            <span
              className="text-xs font-bold"
              style={{ color: tierColor(engagement.suggestedTier) }}
            >
              {engagement.score} / 100 — {TIER_INFO[engagement.suggestedTier].label} recommended
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <span className="text-[10px] text-white/35">Content</span>
              <ScoreBar value={engagement.breakdown.content.score} />
            </div>
            <div>
              <span className="text-[10px] text-white/35">Reach</span>
              <ScoreBar value={engagement.breakdown.reach.score} />
            </div>
            <div>
              <span className="text-[10px] text-white/35">Live</span>
              <ScoreBar value={engagement.breakdown.live.score} />
            </div>
            <div>
              <span className="text-[10px] text-white/35">Monetization</span>
              <ScoreBar value={engagement.breakdown.monetization.score} />
            </div>
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Posts: {engagement.breakdown.content.posts}
            {" · "}Likes: {engagement.breakdown.content.likes}
            {" · "}Followers: {engagement.breakdown.reach.totalFollowers}
            {" · "}Streams: {engagement.breakdown.live.sessions90d}
          </p>
        </div>
      ) : null}

      {/* Tier picker */}
      <div className="flex flex-col gap-2 mb-3">
        {(Object.keys(TIER_INFO) as Array<"ice" | "crystal" | "diamond">).map((tier) => {
          const info = TIER_INFO[tier];
          const isSelected = selectedTier === tier;
          const isRecommended = engagement?.suggestedTier === tier;
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setSelectedTier(tier)}
              disabled={loading}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-40"
              style={
                isSelected
                  ? { background: "rgba(94,209,196,0.15)", border: `1px solid ${tierColor(tier)}50` }
                  : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
              }
            >
              <span className="flex items-center gap-2">
                <span
                  className="text-xs font-semibold"
                  style={{ color: isSelected ? tierColor(tier) : "rgba(255,255,255,0.7)" }}
                >
                  {info.label}
                </span>
                {isRecommended && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: `${tierColor(tier)}20`, color: tierColor(tier) }}
                  >
                    Recommended
                  </span>
                )}
                <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {info.description}
                </span>
              </span>
              <span
                className="text-xs font-bold flex-shrink-0 ml-3"
                style={{ color: isSelected ? tierColor(tier) : "rgba(255,255,255,0.4)" }}
              >
                ${info.price.toFixed(2)}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPromoted(selectedTier)}
          disabled={loading}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
          style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
        >
          {loading ? "Activating..." : `Activate as ${TIER_INFO[selectedTier].label}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.05)", color: "var(--pnp-text-secondary, #8E8E93)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Active Creators tab ───────────────────────────────────────────────────────

export default function ActiveCreatorsTab() {
  const navigate = useNavigate();
  const [creators, setCreators] = useState<ActiveCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [strikeFormOpen, setStrikeFormOpen] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [lockLoading, setLockLoading] = useState<string | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const [promoteFormOpen, setPromoteFormOpen] = useState<string | null>(null);
  const [promoteLoading, setPromoteLoading] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listActiveCreators();
      setCreators(res.creators);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load creators");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleStrikeIssued = (updated: ActiveCreator) => {
    setCreators((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
    setStrikeFormOpen(null);
  };

  const handleToggleLock = async (creator: ActiveCreator) => {
    if (lockLoading) return;
    const next = !creator.creator_locked;
    setLockLoading(creator.id);
    setLockError(null);
    try {
      const res = await setCreatorLock(creator.id, next);
      if (res.success) {
        setCreators((prev) =>
          prev.map((c) =>
            c.id === creator.id ? { ...c, creator_locked: res.user.creator_locked } : c
          )
        );
      }
    } catch (err) {
      setLockError(err instanceof Error ? err.message : "Failed to update creator lock");
    } finally {
      setLockLoading(null);
    }
  };

  const handlePromote = async (
    creator: ActiveCreator,
    tier: "ice" | "crystal" | "diamond"
  ) => {
    setPromoteLoading(creator.id);
    setPromoteError(null);
    try {
      await promoteCreator(creator.id, tier);
      setCreators((prev) =>
        prev.map((c) =>
          c.id === creator.id
            ? { ...c, creator_status: "active" as const, creator_type: tier }
            : c
        )
      );
      setPromoteFormOpen(null);
    } catch (err) {
      setPromoteError(
        err instanceof Error ? err.message : "Failed to promote creator"
      );
    } finally {
      setPromoteLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-white/5 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
        {error}
        <button onClick={load} className="ml-2 text-red-400 underline text-xs">
          Retry
        </button>
      </div>
    );
  }

  if (creators.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/40 text-sm">No active creators found</p>
      </div>
    );
  }

  const statusCounts = creators.reduce((acc, c) => {
    acc[c.creator_status] = (acc[c.creator_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-3">
      {/* Status summary */}
      <p className="text-xs px-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
        {[
          statusCounts["active"]         != null && `Active: ${statusCounts["active"]}`,
          statusCounts["pending_review"] != null && `Pending: ${statusCounts["pending_review"]}`,
          statusCounts["eligible"]       != null && `Eligible: ${statusCounts["eligible"]}`,
          statusCounts["suspended"]      != null && `Suspended: ${statusCounts["suspended"]}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {lockError && (
        <div
          className="px-4 py-3 rounded-lg text-sm text-red-300 flex items-center justify-between"
          style={{ background: "rgba(239,68,68,0.1)" }}
        >
          <span>{lockError}</span>
          <button onClick={() => setLockError(null)} className="ml-3 text-red-400 text-xs underline">
            Dismiss
          </button>
        </div>
      )}
      {promoteError && (
        <div
          className="px-4 py-3 rounded-lg text-sm text-red-300 flex items-center justify-between"
          style={{ background: "rgba(239,68,68,0.1)" }}
        >
          <span>{promoteError}</span>
          <button onClick={() => setPromoteError(null)} className="ml-3 text-red-400 text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {creators.map((creator) => {
        const suspended = creator.creator_status === "suspended";
        const eligible = creator.creator_status === "eligible";
        const pendingReview = creator.creator_status === "pending_review";
        const active = creator.creator_status === "active";
        const displayName =
          [creator.first_name, creator.last_name].filter(Boolean).join(" ") ||
          creator.username ||
          "Unknown";
        const isStrikeOpen = strikeFormOpen === creator.id;
        const isHistoryOpen = historyOpen === creator.id;
        const isPromoteOpen = promoteFormOpen === creator.id;

        return (
          <div
            key={creator.id}
            className="rounded-xl p-4 backdrop-blur"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: suspended
                ? "1px solid rgba(239,68,68,0.25)"
                : eligible
                ? "1px solid rgba(59,130,246,0.2)"
                : "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-start gap-3">
              <CreatorAvatar creator={creator} />

              <div className="flex-1 min-w-0">
                {/* Name row */}
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <button
                    onClick={() => navigate(`/profile/${creator.id}`)}
                    className="text-sm font-semibold text-white hover:underline truncate"
                  >
                    {displayName}
                  </button>
                  {creator.username && (
                    <span className="text-xs flex-shrink-0" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                      @{creator.username}
                    </span>
                  )}
                  <StrikeBadge
                    count={creator.creator_strikes}
                    suspended={suspended}
                  />
                </div>

                {/* Status badge for non-active creators */}
                {!active && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold mb-1 inline-block"
                    style={
                      pendingReview
                        ? { background: "rgba(234,179,8,0.15)", color: "#EAB308", border: "1px solid rgba(234,179,8,0.3)" }
                        : eligible
                          ? { background: "rgba(59,130,246,0.15)", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.3)" }
                          : { background: "rgba(255,255,255,0.06)", color: "var(--pnp-text-secondary, #8E8E93)" }
                    }
                  >
                    {pendingReview ? "Pending Review"
                      : eligible ? "Eligible"
                      : creator.creator_status || "none"}
                  </span>
                )}
                {/* Onboarding lock badge — active creators only */}
                {active && creator.creator_locked && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold mb-1 inline-block"
                    style={{ background: "rgba(230,145,56,0.15)", color: "#E69138", border: "1px solid rgba(230,145,56,0.3)" }}
                  >
                    Tools locked
                  </span>
                )}

                {/* Meta row */}
                <p className="text-xs mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {creator.creator_type
                    ? (TYPE_LABELS[creator.creator_type] || creator.creator_type)
                    : "No tier"}
                  {creator.creator_price_usd != null && (
                    <>
                      {" · "}
                      <span className="text-white/60">
                        ${parseFloat(creator.creator_price_usd).toFixed(2)}/mo
                      </span>
                    </>
                  )}
                  {" · "}
                  <span className="text-white/60">
                    {creator.creator_subscriber_count ?? 0} subscriber
                    {(creator.creator_subscriber_count ?? 0) !== 1 ? "s" : ""}
                  </span>
                </p>

                {/* Action buttons — varies by creator_status */}
                {!isStrikeOpen && !isPromoteOpen && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Issue Strike: active creators only */}
                    {active && (
                      <button
                        onClick={() => {
                          setStrikeFormOpen(creator.id);
                          setHistoryOpen(null);
                          setPromoteFormOpen(null);
                        }}
                        className="text-xs px-3 py-1 rounded-lg font-semibold transition-colors"
                        style={{
                          background: "rgba(239,68,68,0.1)",
                          color: "#EF4444",
                          border: "1px solid rgba(239,68,68,0.2)",
                        }}
                      >
                        Issue Strike
                      </button>
                    )}
                    {/* Strike History: active and suspended creators */}
                    {(active || suspended) && (
                      <button
                        onClick={() => {
                          setHistoryOpen(isHistoryOpen ? null : creator.id);
                          setStrikeFormOpen(null);
                          setPromoteFormOpen(null);
                        }}
                        className="text-xs px-3 py-1 rounded-lg transition-colors"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          color: "var(--pnp-text-secondary, #8E8E93)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        {isHistoryOpen ? "Hide History" : "Strike History"}
                      </button>
                    )}
                    {/* Lock/unlock: active creators only */}
                    {active && (
                      <button
                        onClick={() => handleToggleLock(creator)}
                        disabled={lockLoading === creator.id}
                        className="text-xs px-3 py-1 rounded-lg font-semibold transition-colors disabled:opacity-50"
                        style={
                          creator.creator_locked
                            ? {
                                background: "rgba(94,209,196,0.1)",
                                color: "#5ED1C4",
                                border: "1px solid rgba(94,209,196,0.25)",
                              }
                            : {
                                background: "rgba(230,145,56,0.1)",
                                color: "#E69138",
                                border: "1px solid rgba(230,145,56,0.25)",
                              }
                        }
                      >
                        {lockLoading === creator.id
                          ? "..."
                          : creator.creator_locked
                          ? "Unlock tools"
                          : "Lock tools"}
                      </button>
                    )}
                    {/* Activate: eligible creators only */}
                    {eligible && (
                      <button
                        onClick={() => {
                          setPromoteFormOpen(creator.id);
                          setStrikeFormOpen(null);
                          setHistoryOpen(null);
                          setPromoteError(null);
                        }}
                        disabled={promoteLoading === creator.id}
                        className="text-xs px-3 py-1 rounded-lg font-semibold transition-colors disabled:opacity-50"
                        style={{
                          background: "rgba(94,209,196,0.1)",
                          color: "#5ED1C4",
                          border: "1px solid rgba(94,209,196,0.25)",
                        }}
                      >
                        Activate as Creator
                      </button>
                    )}
                    {/* Pending review: informational note only */}
                    {pendingReview && (
                      <span
                        className="text-xs italic"
                        style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
                      >
                        Review pending — see Applications tab
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Strike form */}
            {isStrikeOpen && (
              <IssueStrikeForm
                creator={creator}
                onStrikeIssued={handleStrikeIssued}
                onCancel={() => setStrikeFormOpen(null)}
              />
            )}

            {/* Promote form */}
            {isPromoteOpen && (
              <PromoteCreatorForm
                creator={creator}
                onPromoted={(tier) => handlePromote(creator, tier)}
                onCancel={() => {
                  setPromoteFormOpen(null);
                  setPromoteError(null);
                }}
                loading={promoteLoading === creator.id}
                error={promoteFormOpen === creator.id ? promoteError : null}
              />
            )}

            {/* Strike history panel */}
            {isHistoryOpen && !isStrikeOpen && !isPromoteOpen && (
              <StrikeHistoryPanel
                creatorId={creator.id}
                onClose={() => setHistoryOpen(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
