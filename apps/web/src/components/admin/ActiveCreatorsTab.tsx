import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  listActiveCreators,
  issueCreatorStrike,
  getCreatorStrikes,
  type ActiveCreator,
  type CreatorStrike,
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
      style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93" }}
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
        className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none resize-none mb-2"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
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
          style={{ background: "rgba(255,255,255,0.05)", color: "#8E8E93" }}
        >
          Cancel
        </button>
      </div>
    </form>
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

  return (
    <div className="space-y-3">
      {creators.map((creator) => {
        const suspended = creator.creator_status === "suspended";
        const displayName =
          [creator.first_name, creator.last_name].filter(Boolean).join(" ") ||
          creator.username ||
          "Unknown";
        const isStrikeOpen = strikeFormOpen === creator.id;
        const isHistoryOpen = historyOpen === creator.id;

        return (
          <div
            key={creator.id}
            className="rounded-xl p-4 backdrop-blur"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: suspended
                ? "1px solid rgba(239,68,68,0.25)"
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
                    <span className="text-xs flex-shrink-0" style={{ color: "#8E8E93" }}>
                      @{creator.username}
                    </span>
                  )}
                  <StrikeBadge
                    count={creator.creator_strikes}
                    suspended={suspended}
                  />
                </div>

                {/* Status badge for non-active creators */}
                {creator.creator_status !== "active" && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold mb-1 inline-block"
                    style={
                      creator.creator_status === "pending_review"
                        ? { background: "rgba(234,179,8,0.15)", color: "#EAB308", border: "1px solid rgba(234,179,8,0.3)" }
                        : creator.creator_status === "eligible"
                          ? { background: "rgba(59,130,246,0.15)", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.3)" }
                          : { background: "rgba(255,255,255,0.06)", color: "#8E8E93" }
                    }
                  >
                    {creator.creator_status === "pending_review" ? "Pending Review"
                      : creator.creator_status === "eligible" ? "Eligible"
                      : creator.creator_status || "none"}
                  </span>
                )}

                {/* Meta row */}
                <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>
                  {creator.creator_type
                    ? (TYPE_LABELS[creator.creator_type] || creator.creator_type)
                    : "No tier"}
                  {creator.creator_price_usd != null && (
                    <>
                      {" \u00b7 "}
                      <span className="text-white/60">
                        ${parseFloat(creator.creator_price_usd).toFixed(2)}/mo
                      </span>
                    </>
                  )}
                  {" \u00b7 "}
                  <span className="text-white/60">
                    {creator.creator_subscriber_count ?? 0} subscriber
                    {(creator.creator_subscriber_count ?? 0) !== 1 ? "s" : ""}
                  </span>
                </p>

                {/* Action buttons */}
                {!isStrikeOpen && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {!suspended && (
                      <button
                        onClick={() => {
                          setStrikeFormOpen(creator.id);
                          setHistoryOpen(null);
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
                    <button
                      onClick={() => {
                        setHistoryOpen(isHistoryOpen ? null : creator.id);
                        setStrikeFormOpen(null);
                      }}
                      className="text-xs px-3 py-1 rounded-lg transition-colors"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        color: "#8E8E93",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      {isHistoryOpen ? "Hide History" : "Strike History"}
                    </button>
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

            {/* Strike history panel */}
            {isHistoryOpen && !isStrikeOpen && (
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
