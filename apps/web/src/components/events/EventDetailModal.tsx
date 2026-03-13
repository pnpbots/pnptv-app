import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { type EventItem, rsvpEvent, unrsvpEvent, updateEvent, getHangoutGroups, cancelEvent, type HangoutGroup } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface EventDetailModalProps {
  event: EventItem;
  onClose: () => void;
  onRsvp?: (eventId: string, rsvpd: boolean) => void;
  onUpdated?: (event: EventItem) => void;
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Starting now";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const d = Math.floor(h / 24);
  if (d > 0) return `in ${d}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function isValidUrl(url: string | undefined | null): url is string {
  return !!url && (url.startsWith("/") || url.startsWith("http"));
}

// ── Inline Edit Form ──────────────────────────────────────────────────────────

interface EditFormProps {
  event: EventItem;
  onSaved: (updated: EventItem) => void;
  onCancel: () => void;
}

function EditForm({ event, onSaved, onCancel }: EditFormProps) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description || "");
  const [hangoutGroupId, setHangoutGroupId] = useState<string>(
    event.hangoutGroupId ? String(event.hangoutGroupId) : ""
  );
  const [coverPreview, setCoverPreview] = useState<string | null>(event.coverImage || null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [groups, setGroups] = useState<HangoutGroup[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load hangout groups for hangout events
  React.useEffect(() => {
    if (event.type === "hangout_event") {
      getHangoutGroups().then(res => { if (res.success) setGroups(res.groups); }).catch(() => {});
    }
  }, [event.type]);

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Cover image must be under 5 MB"); return; }
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setCoverPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!title.trim()) { setError("Title is required"); return; }
    setSubmitting(true);
    setError(null);
    try {
      let coverImage: string | undefined = event.coverImage || undefined;

      if (coverFile) {
        const formData = new FormData();
        formData.append("media", coverFile);
        const uploadRes = await fetch("/api/webapp/upload/event-cover", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          coverImage = uploadData.url;
        }
      }

      const res = await updateEvent(event.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        coverImage,
        hangoutGroupId: event.type === "hangout_event"
          ? (hangoutGroupId ? parseInt(hangoutGroupId, 10) : null)
          : undefined,
      });
      onSaved(res.event);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const isLive = event.type === "live_stream";
  const accentColor = isLive ? "#FF453A" : "#5ED1C4";
  const accentBg = isLive ? "rgba(255,69,58,0.12)" : "rgba(94,209,196,0.12)";

  return (
    <div className="space-y-3 mt-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#8E8E93" }}>Edit Event</p>

      {/* Cover image */}
      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">Cover Image</label>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-xl overflow-hidden flex items-center justify-center transition-colors hover:opacity-90"
          style={{ height: 90, background: coverPreview ? "transparent" : accentBg, border: `1px dashed ${accentColor}40` }}
        >
          {coverPreview ? (
            <img src={coverPreview} alt="Cover" className="w-full h-full object-cover rounded-xl" />
          ) : (
            <div className="flex flex-col items-center gap-1">
              <svg className="w-5 h-5 opacity-50" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12z" />
              </svg>
              <span className="text-[11px]" style={{ color: accentColor, opacity: 0.6 }}>Tap to add cover</span>
            </div>
          )}
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">Title</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
          style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)" }}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none resize-none"
          style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)" }}
        />
      </div>

      {/* Hangout group link — only for hangout events */}
      {event.type === "hangout_event" && (
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Link to Hangout Group</label>
          <select
            value={hangoutGroupId}
            onChange={e => setHangoutGroupId(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
            style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.1)", colorScheme: "dark" }}
          >
            <option value="">No specific group</option>
            {groups.map(g => (
              <option key={g.id} value={String(g.id)}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={submitting}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export function EventDetailModal({ event: initialEvent, onClose, onRsvp, onUpdated }: EventDetailModalProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [event, setEvent] = useState(initialEvent);
  const [rsvping, setRsvping] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const isLive = event.type === "live_stream";
  const isHangout = event.type === "hangout_event";
  const isNow = event.status === "live";
  const isFull = event.maxAttendees != null && event.rsvpCount >= event.maxAttendees;

  const typeColor = isLive ? "#FF453A" : "#FFB454";
  const typeBg = isLive ? "rgba(255,69,58,0.12)" : "rgba(255,180,84,0.12)";
  const typeLabel = isLive ? "Live Stream" : "Hangout";

  const isAdmin = user && (user.role === "admin" || user.role === "superadmin");
  const isCreator = user && (String(user.id) === String(event.creatorId) || String((user as { dbId?: string }).dbId) === String(event.creatorId));
  const canManage = isCreator || isAdmin;

  const handleRsvp = async () => {
    setRsvping(true);
    try {
      if (event.userRsvpd) {
        const res = await unrsvpEvent(event.id);
        setEvent(e => ({ ...e, userRsvpd: false, rsvpCount: res.rsvpCount }));
        onRsvp?.(event.id, false);
      } else {
        const res = await rsvpEvent(event.id);
        setEvent(e => ({ ...e, userRsvpd: true, rsvpCount: res.rsvpCount }));
        onRsvp?.(event.id, true);
      }
    } catch {
      // silently ignore
    } finally {
      setRsvping(false);
    }
  };

  const handleCta = () => {
    onClose();
    if (isLive) {
      // Navigate to the creator's profile / live channel
      if (event.creatorUsername) {
        navigate(`/profile/${event.creatorUsername}`);
      } else if (event.creatorId) {
        navigate(`/profile/${event.creatorId}`);
      } else {
        navigate("/live");
      }
    } else if (isHangout) {
      // Navigate to hangout group chat
      if (event.hangoutGroupId) {
        navigate(`/chat?group=${event.hangoutGroupId}`);
      } else {
        navigate("/chat");
      }
    }
  };

  const handleUpdated = (updated: EventItem) => {
    setEvent(updated);
    setShowEdit(false);
    onUpdated?.(updated);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }} onClick={onClose} />

      {/* Sheet */}
      <div
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "#1C1C1E", maxHeight: "90dvh" }}
      >
        {/* Cover image */}
        <div className="relative flex-shrink-0" style={{ height: 200 }}>
          {isValidUrl(event.coverImage) ? (
            <img
              src={event.coverImage}
              alt={event.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: typeBg }}>
              {isLive ? (
                <svg className="w-14 h-14 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: typeColor }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
              ) : (
                <svg className="w-14 h-14 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: typeColor }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              )}
            </div>
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #1C1C1E 0%, transparent 50%)" }} />

          {/* Type badge */}
          <div className="absolute top-3 left-3">
            <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide" style={{ background: typeBg, color: typeColor, backdropFilter: "blur(8px)" }}>
              {isNow ? "● LIVE NOW" : typeLabel}
            </span>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 pb-6 space-y-4">
          {/* Title + countdown */}
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-white leading-tight flex-1">{event.title}</h2>
            <span className="text-sm font-semibold flex-shrink-0 mt-0.5" style={{ color: typeColor }}>
              {timeUntil(event.scheduledAt)}
            </span>
          </div>

          {/* Creator row */}
          <div className="flex items-center gap-2">
            {isValidUrl(event.creatorPhoto) ? (
              <img src={event.creatorPhoto} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {(event.creatorName || "?")[0].toUpperCase()}
              </div>
            )}
            <span className="text-sm font-medium" style={{ color: "#8E8E93" }}>by {event.creatorName || "Anonymous"}</span>
            {isCreator && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ml-1" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                You
              </span>
            )}
          </div>

          {/* Date / duration */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm" style={{ color: "#8E8E93" }}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
              </svg>
              <span>{formatFullDate(event.scheduledAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm" style={{ color: "#8E8E93" }}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{event.durationMinutes} minutes</span>
            </div>
            {event.maxAttendees && (
              <div className="flex items-center gap-2 text-sm" style={{ color: "#8E8E93" }}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                <span>{event.rsvpCount} / {event.maxAttendees} attending</span>
              </div>
            )}
          </div>

          {/* Description */}
          {event.description && (
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
              {event.description}
            </p>
          )}

          {/* Tags */}
          {event.tags && event.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {event.tags.map(tag => (
                <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "#8E8E93" }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Edit form (creator/admin only) */}
          {canManage && showEdit && (
            <EditForm event={event} onSaved={handleUpdated} onCancel={() => setShowEdit(false)} />
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            {/* Primary CTA */}
            <button
              onClick={handleCta}
              className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
              style={{ background: isLive ? "linear-gradient(135deg, #FF453A, #D4007A)" : "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {isLive ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  {isNow ? "Watch Now" : "Go to Stream"}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                  {isNow ? "Join Now" : "Join Meeting"}
                </>
              )}
            </button>

            {/* RSVP */}
            {user && (
              <button
                onClick={handleRsvp}
                disabled={rsvping || (!event.userRsvpd && isFull)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-40"
                style={
                  event.userRsvpd
                    ? { background: "rgba(94,209,196,0.12)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }
                    : isFull
                    ? { background: "rgba(255,255,255,0.04)", color: "#555", border: "1px solid rgba(255,255,255,0.06)" }
                    : { background: "rgba(255,180,84,0.1)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.25)" }
                }
              >
                {rsvping ? "…" : event.userRsvpd ? "✓ Going — tap to cancel" : isFull ? "Event is full" : "RSVP — I'm going"}
              </button>
            )}

            {/* Edit (creator/admin only) */}
            {canManage && !showEdit && (
              <>
                <button
                  onClick={() => setShowEdit(true)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Edit Event
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm("Cancel this event?")) return;
                    try {
                      const res = await cancelEvent(event.id);
                      if (res.success) {
                        setEvent(ev => ({ ...ev, status: 'cancelled' }));
                        onUpdated?.({ ...event, status: 'cancelled' });
                        onClose();
                      }
                    } catch { /* silent */ }
                  }}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                  style={{ background: "rgba(255,69,58,0.08)", color: "#FF453A" }}
                >
                  Cancel Event
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
