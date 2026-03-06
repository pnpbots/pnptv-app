import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import {
  getCreatorApplications,
  approveCreatorApplication,
  rejectCreatorApplication,
  listActiveCreators,
  issueCreatorStrike,
  getCreatorStrikes,
  listCreatorEnrollments,
  approveCreatorEnrollment,
  rejectCreatorEnrollment,
  type CreatorApplication,
  type ActiveCreator,
  type CreatorStrike,
  type EnrollmentListItem,
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
};

const ENROLLMENT_TIER_COLORS: Record<
  string,
  { color: string; rgb: string; emoji: string }
> = {
  ice:     { color: "#A8D8EA", rgb: "168,216,234", emoji: "❄️" },
  crystal: { color: "#4ADE80", rgb: "74,222,128",  emoji: "🔮" },
  diamond: { color: "#C4B5FD", rgb: "196,181,253", emoji: "💎" },
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

function ActiveCreatorsTab() {
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

// ── Enrollments tab ───────────────────────────────────────────────────────────

function EnrollmentsList() {
  const [enrollments, setEnrollments] = useState<EnrollmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pending_review");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [notesMap, setNotesMap] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listCreatorEnrollments(filter === "all" ? undefined : filter)
      .then((res) => setEnrollments(res.enrollments))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load enrollments")
      )
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (id: number) => {
    setActionLoading(id);
    try {
      await approveCreatorEnrollment(id, notesMap[id]);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to approve enrollment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: number) => {
    if (!notesMap[id]?.trim()) {
      alert("Please enter rejection notes before rejecting");
      return;
    }
    setActionLoading(id);
    try {
      await rejectCreatorEnrollment(id, notesMap[id]);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reject enrollment");
    } finally {
      setActionLoading(null);
    }
  };

  const FILTER_TABS = [
    { value: "pending_review", label: "Pending" },
    { value: "approved",       label: "Approved" },
    { value: "rejected",       label: "Rejected" },
    { value: "all",            label: "All" },
  ];

  return (
    <>
      {/* Status filter tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0"
            style={
              filter === tab.value
                ? { background: "rgba(212,0,122,0.15)", color: "#D4007A" }
                : { background: "rgba(255,255,255,0.05)", color: "#8E8E93" }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm text-red-300"
          style={{ background: "rgba(239,68,68,0.1)" }}
        >
          {error}
          <button onClick={load} className="ml-2 text-red-400 underline text-xs">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : enrollments.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-white/40 text-sm">No enrollments found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {enrollments.map((enrollment) => {
            const tierInfo = ENROLLMENT_TIER_COLORS[enrollment.tier] ?? {
              color: "#8E8E93",
              rgb: "142,142,147",
              emoji: "?",
            };
            const displayName =
              enrollment.first_name || enrollment.username || "Unknown";
            const initial = displayName[0].toUpperCase();
            const photoSrc = resolvePhotoUrl(enrollment.photo_file_id);
            const isPending = enrollment.status === "pending_review";
            const isActioning = actionLoading === enrollment.id;

            return (
              <div
                key={enrollment.id}
                className="rounded-xl p-4 backdrop-blur"
                style={{
                  background: "#1C1C1E",
                  border: isPending
                    ? `1px solid rgba(${tierInfo.rgb},0.25)`
                    : "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {photoSrc ? (
                      <img
                        src={photoSrc}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{
                          background: "linear-gradient(135deg, #D4007A, #E69138)",
                          color: "#fff",
                        }}
                      >
                        {initial}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Name + tier row */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white truncate">
                        {displayName}
                      </span>
                      {enrollment.username && (
                        <span className="text-xs flex-shrink-0" style={{ color: "#8E8E93" }}>
                          @{enrollment.username}
                        </span>
                      )}
                      {/* Tier badge */}
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                        style={{
                          background: `rgba(${tierInfo.rgb},0.15)`,
                          color: tierInfo.color,
                          border: `1px solid rgba(${tierInfo.rgb},0.3)`,
                        }}
                      >
                        {tierInfo.emoji} {enrollment.tier.charAt(0).toUpperCase() + enrollment.tier.slice(1)}
                      </span>
                      {/* Status badge */}
                      <span
                        className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{
                          background:
                            enrollment.status === "pending_review"
                              ? "rgba(255,180,84,0.15)"
                              : enrollment.status === "approved"
                              ? "rgba(94,209,196,0.15)"
                              : "rgba(239,68,68,0.15)",
                          color:
                            enrollment.status === "pending_review"
                              ? "#FFB454"
                              : enrollment.status === "approved"
                              ? "#5ED1C4"
                              : "#EF4444",
                        }}
                      >
                        {enrollment.status === "pending_review"
                          ? "Pending"
                          : enrollment.status.charAt(0).toUpperCase() + enrollment.status.slice(1)}
                      </span>
                    </div>

                    {/* Payment + submitted row */}
                    <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>
                      {enrollment.payment_method
                        ? enrollment.payment_method.toUpperCase()
                        : "No payment method"}
                      {enrollment.payment_address && (
                        <>
                          {" \u00b7 "}
                          <span
                            className="font-mono"
                            style={{ color: "#8E8E93", wordBreak: "break-all" }}
                          >
                            {enrollment.payment_address.length > 24
                              ? `${enrollment.payment_address.slice(0, 12)}...${enrollment.payment_address.slice(-8)}`
                              : enrollment.payment_address}
                          </span>
                        </>
                      )}
                      {enrollment.payment_network && (
                        <> ({enrollment.payment_network})</>
                      )}
                      {" \u00b7 "}
                      Submitted:{" "}
                      {new Date(enrollment.submitted_at).toLocaleDateString()}
                    </p>

                    {/* ID document link */}
                    {enrollment.id_document_path && (
                      <div className="mb-2">
                        <a
                          href={`https://app.pnptv.app${enrollment.id_document_path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg transition-colors"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            color: "#D4007A",
                            border: "1px solid rgba(212,0,122,0.2)",
                          }}
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                          </svg>
                          View ID
                        </a>
                      </div>
                    )}

                    {/* Reviewed info (approved/rejected) */}
                    {!isPending && (
                      <div className="mb-2">
                        {enrollment.reviewed_at && (
                          <p className="text-xs" style={{ color: "#8E8E93" }}>
                            Reviewed:{" "}
                            {new Date(enrollment.reviewed_at).toLocaleDateString()}
                          </p>
                        )}
                        {enrollment.admin_notes && (
                          <p className="text-xs text-white/50 italic mt-0.5">
                            Notes: {enrollment.admin_notes}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Actions for pending enrollments */}
                    {isPending && (
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          placeholder="Notes (required for rejection, optional for approval)"
                          value={notesMap[enrollment.id] || ""}
                          onChange={(e) =>
                            setNotesMap((prev) => ({
                              ...prev,
                              [enrollment.id]: e.target.value,
                            }))
                          }
                          className="w-full bg-white/5 text-white text-xs rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 placeholder:text-white/20"
                          disabled={isActioning}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(enrollment.id)}
                            disabled={isActioning}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                            style={{
                              background: "rgba(94,209,196,0.15)",
                              color: "#5ED1C4",
                              border: "1px solid rgba(94,209,196,0.3)",
                            }}
                          >
                            {isActioning ? "..." : "Approve"}
                          </button>
                          <button
                            onClick={() => handleReject(enrollment.id)}
                            disabled={isActioning}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                            style={{
                              background: "rgba(239,68,68,0.1)",
                              color: "#EF4444",
                              border: "1px solid rgba(239,68,68,0.2)",
                            }}
                          >
                            {isActioning ? "..." : "Reject"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type MainTab = "applications" | "active" | "enrollments";

export default function CreatorApplications() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [mainTab, setMainTab] = useState<MainTab>("applications");
  const [applications, setApplications] = useState<CreatorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("pending");
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCreatorApplications(filter || undefined);
      setApplications(res.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (isAdmin && mainTab === "applications") load();
  }, [isAdmin, load, mainTab]);

  const handleApprove = async (id: string) => {
    if (processing) return;
    setProcessing(id);
    try {
      await approveCreatorApplication(id, actionNotes[id]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: string) => {
    if (processing) return;
    setProcessing(id);
    try {
      await rejectCreatorApplication(id, actionNotes[id]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setProcessing(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-white/60">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <button
        onClick={() => navigate("/admin")}
        className="flex items-center gap-2 text-sm mb-4 hover:text-pnp-accent transition-colors"
        style={{ color: "#8E8E93" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Admin Dashboard
      </button>

      <h1 className="text-2xl font-bold text-white mb-1">Creator Management</h1>
      <p className="text-sm mb-5" style={{ color: "#8E8E93" }}>
        Review applications, enrollments, and manage active creator accounts
      </p>

      {/* Main tabs */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
        {(
          [
            { value: "applications", label: "Applications" },
            { value: "active",       label: "Active Creators" },
            { value: "enrollments",  label: "Enrollments" },
          ] as { value: MainTab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setMainTab(tab.value)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={
              mainTab === tab.value
                ? {
                    background: "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(230,145,56,0.18))",
                    color: "#fff",
                    border: "1px solid rgba(212,0,122,0.3)",
                  }
                : { color: "#8E8E93" }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "active" ? (
        <ActiveCreatorsTab />
      ) : mainTab === "enrollments" ? (
        <EnrollmentsList />
      ) : (
        <>
          {error && (
            <div
              className="mb-4 px-4 py-3 rounded-lg text-sm text-red-300"
              style={{ background: "rgba(239,68,68,0.1)" }}
            >
              {error}
              <button onClick={() => setError(null)} className="ml-2 text-red-400">
                Dismiss
              </button>
            </div>
          )}

          {/* Application status filter tabs */}
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {[
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "", label: "All" },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0"
                style={
                  filter === tab.value
                    ? { background: "rgba(212,0,122,0.15)", color: "#D4007A" }
                    : { background: "rgba(255,255,255,0.05)", color: "#8E8E93" }
                }
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-white/5 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : applications.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/40 text-sm">No applications found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {applications.map((app) => (
                <div key={app.id} className="glass-card-sm p-4">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="flex-shrink-0">
                      {resolvePhotoUrl(app.photo_file_id) ? (
                        <img
                          src={resolvePhotoUrl(app.photo_file_id)!}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                        >
                          {(app.stage_name || app.first_name || app.username || "?")[0].toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <button
                          onClick={() => navigate(`/profile/${app.user_id}`)}
                          className="text-sm font-semibold text-white hover:underline"
                        >
                          {app.stage_name || app.first_name || app.username}
                        </button>
                        {app.username && (
                          <span className="text-xs" style={{ color: "#8E8E93" }}>
                            @{app.username}
                          </span>
                        )}
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background:
                              app.status === "pending"
                                ? "rgba(255,180,84,0.15)"
                                : app.status === "approved"
                                ? "rgba(94,209,196,0.15)"
                                : app.status === "rejected"
                                ? "rgba(239,68,68,0.15)"
                                : "rgba(255,255,255,0.08)",
                            color:
                              app.status === "pending"
                                ? "#FFB454"
                                : app.status === "approved"
                                ? "#5ED1C4"
                                : app.status === "rejected"
                                ? "#EF4444"
                                : "#8E8E93",
                          }}
                        >
                          {app.status}
                        </span>
                      </div>

                      <p className="text-xs mb-1" style={{ color: "#8E8E93" }}>
                        Type:{" "}
                        <strong className="text-white">
                          {TYPE_LABELS[app.application_type] || app.application_type}
                        </strong>
                        {app.requested_price_usd != null && (
                          <>
                            {" \u00b7 "}
                            Price:{" "}
                            <strong className="text-white">${app.requested_price_usd}/mo</strong>
                          </>
                        )}
                        {" \u00b7 "}
                        Submitted: {new Date(app.created_at).toLocaleDateString()}
                      </p>

                      {app.bio && (
                        <p className="text-xs text-white/70 mb-2 line-clamp-3">{app.bio}</p>
                      )}

                      {app.call_scheduled && (
                        <p className="text-xs mb-2" style={{ color: "#5ED1C4" }}>
                          Call scheduled
                          {app.call_scheduled_at
                            ? ` on ${new Date(app.call_scheduled_at).toLocaleDateString()}`
                            : ""}
                        </p>
                      )}

                      {app.admin_notes && (
                        <p className="text-xs text-white/50 italic mb-2">
                          Admin notes: {app.admin_notes}
                        </p>
                      )}

                      {/* Actions for pending applications */}
                      {app.status === "pending" && (
                        <div className="mt-2 space-y-2">
                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={actionNotes[app.id] || ""}
                            onChange={(e) =>
                              setActionNotes((prev) => ({ ...prev, [app.id]: e.target.value }))
                            }
                            className="w-full bg-white/5 text-white text-xs rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 placeholder:text-white/20"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleApprove(app.id)}
                              disabled={processing === app.id}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                              style={{
                                background: "rgba(94,209,196,0.15)",
                                color: "#5ED1C4",
                                border: "1px solid rgba(94,209,196,0.3)",
                              }}
                            >
                              {processing === app.id ? "..." : "Approve"}
                            </button>
                            <button
                              onClick={() => handleReject(app.id)}
                              disabled={processing === app.id}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                              style={{
                                background: "rgba(239,68,68,0.1)",
                                color: "#EF4444",
                                border: "1px solid rgba(239,68,68,0.2)",
                              }}
                            >
                              {processing === app.id ? "..." : "Reject"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
