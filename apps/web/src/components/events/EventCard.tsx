import React from "react";
import { type EventItem } from "@/lib/api";

export type { EventItem };

interface EventCardProps {
  event: EventItem;
  compact?: boolean;
  onRsvp?: (eventId: string, rsvpd: boolean) => void;
  onCancel?: (eventId: string) => void;
  canCancel?: boolean;
}

function formatEventDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000);
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return { date: "Today", time };
  if (diffDays === 1) return { date: "Tomorrow", time };
  if (diffDays < 7) {
    return { date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), time };
  }
  return { date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), time };
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Now";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 48) return `in ${Math.floor(h / 24)}d`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function isValidUrl(url: string | undefined | null): url is string {
  return !!url && (url.startsWith("/") || url.startsWith("http"));
}

const isLiveType = (e: EventItem) => e.type === "live_stream";

export function EventCard({ event, compact = false, onRsvp, onCancel, canCancel }: EventCardProps) {
  const isLive = isLiveType(event);
  const isHappeningNow = event.status === "live";
  const isFull = event.maxAttendees != null && event.rsvpCount >= event.maxAttendees;
  const { date, time } = formatEventDate(event.scheduledAt);
  const countdown = timeUntil(event.scheduledAt);

  const typeColor = isLive ? "#FF453A" : "#FFB454";
  const typeBg = isLive ? "rgba(255,69,58,0.12)" : "rgba(255,180,84,0.12)";
  const typeLabel = isLive ? "Live Stream" : "Hangout";

  if (compact) {
    return (
      <div
        className="flex items-start gap-3 rounded-xl p-3"
        style={{ background: "#2C2C2E", border: "1px solid rgba(255,255,255,0.05)" }}
      >
        {isValidUrl(event.coverImage) ? (
          <img
            src={event.coverImage}
            alt=""
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div
            className="w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center"
            style={{ background: typeBg }}
          >
            {isLive ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: typeColor }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: typeColor }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            )}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: typeColor }}>
              {isHappeningNow ? "● LIVE NOW" : typeLabel}
            </span>
          </div>
          <p className="text-white text-sm font-semibold truncate">{event.title}</p>
          <p className="text-[11px]" style={{ color: "#8E8E93" }}>
            {date} · {time} · <span style={{ color: typeColor }}>{countdown}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="glass-card-sm flex-shrink-0 overflow-hidden cursor-pointer hover:border-white/15 transition-colors"
      style={{ width: 240, border: event.isFeatured ? "1px solid rgba(255,180,84,0.35)" : undefined }}
    >
      {/* Cover / header */}
      <div className="relative" style={{ height: 110 }}>
        {isValidUrl(event.coverImage) ? (
          <img
            src={event.coverImage}
            alt={event.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: typeBg }}>
            {isLive ? (
              <svg className="w-9 h-9 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: typeColor }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            ) : (
              <svg className="w-9 h-9 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: typeColor }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            )}
          </div>
        )}

        {/* Gradient overlay when image present */}
        {isValidUrl(event.coverImage) && (
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(28,28,30,0.9) 0%, transparent 60%)" }} />
        )}

        {/* Type badge */}
        <div className="absolute top-2 left-2">
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ background: typeBg, color: typeColor, backdropFilter: "blur(8px)" }}
          >
            {isHappeningNow ? "● LIVE NOW" : typeLabel}
          </span>
        </div>

        {event.isFeatured && (
          <div className="absolute top-2 right-2">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{ background: "rgba(255,180,84,0.2)", color: "#FFB454" }}
            >
              FEATURED
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3">
        <p className="text-sm font-semibold text-white leading-tight line-clamp-2 mb-1.5">{event.title}</p>

        {/* Creator row */}
        <div className="flex items-center gap-1.5 mb-2">
          {isValidUrl(event.creatorPhoto) ? (
            <img src={event.creatorPhoto} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div
              className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-white"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {(event.creatorName || "?")[0].toUpperCase()}
            </div>
          )}
          <span className="text-[11px] truncate" style={{ color: "#8E8E93" }}>
            {event.creatorName || "Anonymous"}
          </span>
        </div>

        {/* Time */}
        <p className="text-[11px] mb-2.5" style={{ color: typeColor }}>
          {date} · {time}
          {" · "}<span style={{ color: "#8E8E93" }}>{event.durationMinutes}min</span>
        </p>

        {/* RSVP footer */}
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: "#8E8E93" }}>
            {event.rsvpCount > 0 ? `${event.rsvpCount} going` : "Be first"}
            {event.maxAttendees ? ` · max ${event.maxAttendees}` : ""}
          </span>
          <div className="flex items-center gap-2">
            {canCancel && onCancel && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(event.id);
                }}
                className="text-[10px] font-semibold transition-colors"
                style={{ color: "rgba(255,69,58,0.6)" }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#FF453A"; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "rgba(255,69,58,0.6)"; }}
              >
                Cancel
              </button>
            )}
            {onRsvp && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRsvp(event.id, !event.userRsvpd);
                }}
                disabled={!event.userRsvpd && isFull}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                style={
                  event.userRsvpd
                    ? { background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }
                    : isFull
                    ? { background: "rgba(255,255,255,0.05)", color: "#555" }
                    : { background: "rgba(255,180,84,0.15)", color: "#FFB454" }
                }
              >
                {event.userRsvpd ? "Going ✓" : isFull ? "Full" : "RSVP"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default EventCard;
