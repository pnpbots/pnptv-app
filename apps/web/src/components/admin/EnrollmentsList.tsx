import React, { useState, useEffect, useCallback } from "react";
import {
  listCreatorEnrollments,
  approveCreatorEnrollment,
  rejectCreatorEnrollment,
  type EnrollmentListItem,
} from "@/lib/api";

function resolvePhotoUrl(photo: string | null | undefined): string | null {
  if (!photo || typeof photo !== "string") return null;
  if (photo.startsWith("/") || photo.startsWith("http")) return photo;
  return null;
}

const ENROLLMENT_TIER_COLORS: Record<
  string,
  { color: string; rgb: string; emoji: string }
> = {
  ice:     { color: "#A8D8EA", rgb: "168,216,234", emoji: "❄️" },
  crystal: { color: "#4ADE80", rgb: "74,222,128",  emoji: "🔮" },
  diamond: { color: "#C4B5FD", rgb: "196,181,253", emoji: "💎" },
};

const FILTER_TABS = [
  { value: "pending_review", label: "Pending" },
  { value: "approved",       label: "Approved" },
  { value: "rejected",       label: "Rejected" },
  { value: "all",            label: "All" },
];

export default function EnrollmentsList() {
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
