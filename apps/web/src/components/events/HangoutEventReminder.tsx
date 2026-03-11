import React, { useState, useEffect, useRef } from "react";
import { getUpcomingEvents, type EventItem } from "@/lib/api";
import { EventCard } from "./EventCard";

interface HangoutEventReminderProps {
  groupId: number;
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

export function HangoutEventReminder({ groupId }: HangoutEventReminderProps) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;

    const fetchEvents = async () => {
      try {
        const res = await getUpcomingEvents({ hangoutGroupId: groupId, limit: 3 });
        if (active && res.success) {
          setEvents(res.events);
        }
      } catch {
        // Silent fail
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchEvents();
    // Refresh every 5 minutes
    intervalRef.current = setInterval(fetchEvents, 5 * 60 * 1000);

    return () => {
      active = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [groupId]);

  if (loading || events.length === 0 || dismissed) return null;

  const next = events[0];
  const isHappeningNow = next.status === "live";
  const accentColor = isHappeningNow ? "#FF453A" : "#FFB454";
  const accentBg = isHappeningNow ? "rgba(255,69,58,0.08)" : "rgba(255,180,84,0.08)";
  const accentBorder = isHappeningNow ? "rgba(255,69,58,0.3)" : "rgba(255,180,84,0.25)";

  return (
    <div
      className="mx-3 mb-2 rounded-2xl overflow-hidden"
      style={{ background: accentBg, border: `1px solid ${accentBorder}` }}
    >
      {/* Collapsed header — always visible */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((prev) => !prev); } }}
      >
        {/* Calendar icon */}
        <svg
          className="w-4 h-4 flex-shrink-0"
          style={{ color: accentColor }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
        </svg>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accentColor }}>
            {isHappeningNow
              ? "● LIVE NOW"
              : `Upcoming · ${events.length} event${events.length > 1 ? "s" : ""}`}
          </p>
          <p className="text-white/80 text-xs font-medium truncate">
            {next.title}
            {!isHappeningNow && (
              <span className="ml-1.5 font-normal" style={{ color: "rgba(255,255,255,0.35)" }}>
                · {timeUntil(next.scheduledAt)}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Chevron */}
          <svg
            className="w-3.5 h-3.5 transition-transform"
            style={{ color: "rgba(255,255,255,0.3)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>

          {/* Dismiss button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}
            aria-label="Dismiss event reminder"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded event list */}
      {expanded && (
        <div
          className="px-3 pb-3 pt-1 space-y-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {events.map((ev) => (
            <EventCard key={ev.id} event={ev} compact />
          ))}
        </div>
      )}
    </div>
  );
}

export default HangoutEventReminder;
