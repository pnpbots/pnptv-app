import React, { useState, useRef } from "react";
import { createEvent } from "@/lib/api";
import type { EventItem } from "./EventCard";
import type { HangoutGroup } from "@/lib/api";

interface CreateEventModalProps {
  onClose: () => void;
  onCreated: (event: EventItem) => void;
  defaultType?: "live_stream" | "hangout_event";
  canCreateLive?: boolean;
  userGroups?: HangoutGroup[];
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480, 720, 1440, 2160, 2880];

function pad(n: number) { return String(n).padStart(2, "0"); }

function toLocalDatetimeValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateEventModal({ onClose, onCreated, defaultType, canCreateLive = false, userGroups = [] }: CreateEventModalProps) {
  const minDate = toLocalDatetimeValue(new Date(Date.now() + 15 * 60 * 1000));

  const [type, setType] = useState<"live_stream" | "hangout_event">(
    defaultType || (canCreateLive ? "live_stream" : "hangout_event")
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [maxAttendees, setMaxAttendees] = useState("");
  const [hangoutGroupId, setHangoutGroupId] = useState<string>("");
  const [tags, setTags] = useState("");
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Cover image must be under 5 MB"); return; }
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setCoverPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Title is required");
    if (!scheduledAt) return setError("Please set a date and time");
    if (new Date(scheduledAt) < new Date()) return setError("Event must be in the future");

    setSubmitting(true);
    try {
      let coverImage: string | undefined;

      // Upload cover if provided
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
        // If upload fails, proceed without cover
      }

      const parsedTags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await createEvent({
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        coverImage,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: duration,
        maxAttendees: maxAttendees ? parseInt(maxAttendees, 10) : undefined,
        hangoutGroupId: type === "hangout_event" && hangoutGroupId ? parseInt(hangoutGroupId, 10) : undefined,
        tags: parsedTags,
      });

      if (res.success) {
        onCreated(res.event);
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setSubmitting(false);
    }
  };

  const isLive = type === "live_stream";
  const accentColor = isLive ? "#FF453A" : "#5ED1C4";
  const accentBg = isLive ? "rgba(255,69,58,0.12)" : "rgba(94,209,196,0.12)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)", maxHeight: "90dvh", overflowY: "auto" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 className="text-base font-bold text-white">Create Event</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
            <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-6 pt-4 space-y-4">
          {/* Type toggle */}
          <div className="flex gap-2">
            {(["hangout_event", ...(canCreateLive ? ["live_stream"] : [])] as Array<"live_stream" | "hangout_event">).map((t) => {
              const active = type === t;
              const label = t === "live_stream" ? "Live Event" : "Hangout";
              const color = t === "live_stream" ? "#FF453A" : "#5ED1C4";
              const bg = t === "live_stream" ? "rgba(255,69,58,0.12)" : "rgba(94,209,196,0.12)";
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={active ? { background: bg, color, border: `1px solid ${color}40` } : { background: "rgba(255,255,255,0.05)", color: "#8E8E93", border: "1px solid transparent" }}
                >
                  {t === "live_stream" ? "📡 " : "🎉 "}{label}
                </button>
              );
            })}
          </div>

          {/* Hangout Group selector — shown when type is hangout_event */}
          {type === "hangout_event" && userGroups.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">
                Hangout Group <span className="normal-case text-white/30">(optional)</span>
              </label>
              <select
                value={hangoutGroupId}
                onChange={(e) => setHangoutGroupId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white outline-none focus:border-white/20 transition-colors"
                style={{ colorScheme: "dark", fontSize: "16px" }}
              >
                <option value="">Any group / no specific group</option>
                {userGroups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Cover image */}
          <div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl overflow-hidden flex items-center justify-center transition-colors hover:opacity-90"
              style={{ height: 120, background: coverPreview ? "transparent" : accentBg, border: `1px dashed ${accentColor}40` }}
            >
              {coverPreview ? (
                <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <svg className="w-6 h-6 opacity-50" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm-3 9.75h9.75a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25h-13.5A2.25 2.25 0 002.25 6.75v13.5A2.25 2.25 0 004.5 21.75h.75" />
                  </svg>
                  <span className="text-xs" style={{ color: accentColor, opacity: 0.6 }}>Add cover image</span>
                </div>
              )}
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isLive ? "e.g. Friday Night Show" : "e.g. PNP Movie Night"}
              maxLength={80}
              style={{ fontSize: "16px" }}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white placeholder-white/25 outline-none focus:border-white/20 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this event about?"
              rows={3}
              maxLength={500}
              style={{ fontSize: "16px" }}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white placeholder-white/25 outline-none focus:border-white/20 transition-colors resize-none"
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Date & Time *</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                min={minDate}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white outline-none focus:border-white/20 transition-colors"
                style={{ colorScheme: "dark", fontSize: "16px" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white outline-none focus:border-white/20 transition-colors"
                style={{ colorScheme: "dark", fontSize: "16px" }}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d}min` : d < 1440 ? `${Math.floor(d / 60)}h${d % 60 > 0 ? ` ${d % 60}m` : ""}` : `${Math.floor(d / 1440)}d ${Math.floor((d % 1440) / 60)}h`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Max attendees (hangout only) */}
          {type === "hangout_event" && (
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Max Attendees <span className="normal-case text-white/30">(optional)</span></label>
              <input
                type="number"
                value={maxAttendees}
                onChange={(e) => setMaxAttendees(e.target.value)}
                placeholder="Leave blank for unlimited"
                min={2}
                max={500}
                style={{ fontSize: "16px" }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white placeholder-white/25 outline-none focus:border-white/20 transition-colors"
              />
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Tags <span className="normal-case text-white/30">(comma separated)</span></label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. party, music, chill"
              style={{ fontSize: "16px" }}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-white placeholder-white/25 outline-none focus:border-white/20 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs py-2.5 px-3.5 rounded-xl" style={{ background: "rgba(255,69,58,0.1)", color: "#FF453A" }}>
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
            style={{ background: accentBg, color: accentColor, border: `1px solid ${accentColor}40` }}
          >
            {submitting ? "Creating…" : `Create ${isLive ? "Live Event" : "Hangout Event"}`}
          </button>
        </form>
      </div>
    </div>
  );
}
