import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import {
  getCreatorApplications,
  approveCreatorApplication,
  rejectCreatorApplication,
  type CreatorApplication,
  type CastingStatus,
} from "@/lib/api";
import ActiveCreatorsTab from "@/components/admin/ActiveCreatorsTab";
import EnrollmentsList from "@/components/admin/EnrollmentsList";
import {
  getCastingApplications,
  reviewCastingApplication,
  type CastingApplication,
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

type MainTab = "applications" | "active" | "enrollments" | "casting";

export default function CreatorApplications() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [mainTab, setMainTab] = useState<MainTab>("applications");
  const [applications, setApplications] = useState<CreatorApplication[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("pending");
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  // Casting tab state
  const [castingApps, setCastingApps] = useState<CastingApplication[]>([]);
  const [castingCounts, setCastingCounts] = useState<Record<string, number>>({});
  const [castingLoading, setCastingLoading] = useState(true);
  const [castingFilter, setCastingFilter] = useState("pending");
  const [castingNotes, setCastingNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCreatorApplications(filter || undefined);
      setApplications(res.applications);
      if (res.statusCounts) setStatusCounts(res.statusCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (isAdmin && mainTab === "applications") load();
  }, [isAdmin, load, mainTab]);

  const loadCasting = useCallback(async () => {
    setCastingLoading(true);
    try {
      const res = await getCastingApplications(castingFilter || undefined);
      setCastingApps(res.applications);
      if (res.statusCounts) setCastingCounts(res.statusCounts);
    } catch { /* silent */ }
    finally { setCastingLoading(false); }
  }, [castingFilter]);

  useEffect(() => {
    if (isAdmin && mainTab === "casting") loadCasting();
  }, [isAdmin, loadCasting, mainTab]);

  const handleCastingReview = async (appId: string, decision: "approved" | "rejected") => {
    if (processing) return;
    setProcessing(appId);
    try {
      await reviewCastingApplication(appId, decision, castingNotes[appId]);
      await loadCasting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setProcessing(null);
    }
  };

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
            { value: "casting",      label: "Casting" },
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
      ) : mainTab === "casting" ? (
        <>
          {/* Casting filter tabs */}
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {[
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "", label: "All" },
            ].map((tab) => {
              const count = tab.value ? castingCounts[tab.value] : Object.values(castingCounts).reduce((a, b) => a + b, 0);
              return (
                <button
                  key={tab.value}
                  onClick={() => setCastingFilter(tab.value)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 flex items-center gap-1.5"
                  style={
                    castingFilter === tab.value
                      ? { background: "rgba(212,0,122,0.15)", color: "#D4007A" }
                      : { background: "rgba(255,255,255,0.05)", color: "#8E8E93" }
                  }
                >
                  {tab.label}
                  {count != null && count > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(255,255,255,0.1)" }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {castingLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-white/5 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : castingApps.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/40 text-sm">No casting applications found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {castingApps.map((app) => (
                <div key={app.id} className="glass-card-sm p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      {resolvePhotoUrl(app.photo_file_id) ? (
                        <img src={resolvePhotoUrl(app.photo_file_id)!} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                          {(app.first_name || app.username || "?")[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <button onClick={() => navigate(`/profile/${app.user_id}`)} className="text-sm font-semibold text-white hover:underline">
                          {app.first_name || app.username}
                        </button>
                        {app.username && <span className="text-xs" style={{ color: "#8E8E93" }}>@{app.username}</span>}
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: app.status === "pending" ? "rgba(255,180,84,0.15)" : app.status === "approved" ? "rgba(94,209,196,0.15)" : "rgba(239,68,68,0.15)",
                            color: app.status === "pending" ? "#FFB454" : app.status === "approved" ? "#5ED1C4" : "#EF4444",
                          }}
                        >
                          {app.status}
                        </span>
                      </div>
                      <p className="text-xs mb-1" style={{ color: "#8E8E93" }}>
                        Tier: <strong className="text-white">{app.tier}</strong>
                        {" \u00b7 "}
                        Posts: <strong className="text-white">{app.post_count}</strong>
                        {" \u00b7 "}
                        Applied: {new Date(app.created_at).toLocaleDateString()}
                      </p>
                      {app.admin_notes && (
                        <p className="text-xs text-white/50 italic mb-2">Notes: {app.admin_notes}</p>
                      )}
                      {app.status === "pending" && (
                        <div className="mt-2 space-y-2">
                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={castingNotes[app.id] || ""}
                            onChange={(e) => setCastingNotes((prev) => ({ ...prev, [app.id]: e.target.value }))}
                            className="w-full bg-white/5 text-white text-xs rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 placeholder:text-white/20"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleCastingReview(app.id, "approved")}
                              disabled={processing === app.id}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                              style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
                            >
                              {processing === app.id ? "..." : "Approve"}
                            </button>
                            <button
                              onClick={() => handleCastingReview(app.id, "rejected")}
                              disabled={processing === app.id}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                              style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}
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
            ].map((tab) => {
              const count = tab.value ? statusCounts[tab.value] : Object.values(statusCounts).reduce((a, b) => a + b, 0);
              return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 flex items-center gap-1.5"
                style={
                  filter === tab.value
                    ? { background: "rgba(212,0,122,0.15)", color: "#D4007A" }
                    : { background: "rgba(255,255,255,0.05)", color: "#8E8E93" }
                }
              >
                {tab.label}
                {count != null && count > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(255,255,255,0.1)" }}>
                    {count}
                  </span>
                )}
              </button>
              );
            })}
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
