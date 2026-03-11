import React, { useEffect, useState, useCallback } from "react";
import { EventCard, type EventItem } from "./EventCard";
import { getUpcomingEvents, rsvpEvent, unrsvpEvent, cancelEvent } from "@/lib/api";

interface UpcomingEventsProps {
  type?: "live_stream" | "hangout_event";
  limit?: number;
  title?: string;
  onCreateClick?: () => void;
  canCreate?: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
  className?: string;
  /** If provided, only shows events for this hangout group */
  hangoutGroupId?: number;
}

export function UpcomingEvents({
  type,
  limit = 10,
  title = "Upcoming Events",
  onCreateClick,
  canCreate = false,
  currentUserId,
  isAdmin = false,
  className = "",
  hangoutGroupId,
}: UpcomingEventsProps) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(() => {
    getUpcomingEvents({ type, limit, hangoutGroupId })
      .then((res) => {
        if (res.success) setEvents(res.events);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [type, limit, hangoutGroupId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const handleRsvp = useCallback(async (eventId: string, shouldRsvp: boolean) => {
    try {
      const res = shouldRsvp ? await rsvpEvent(eventId) : await unrsvpEvent(eventId);
      if (res.success) {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === eventId
              ? { ...e, rsvpCount: res.rsvpCount, userRsvpd: res.userRsvpd }
              : e
          )
        );
      }
    } catch {
      // Silent fail
    }
  }, []);

  const handleCancel = useCallback(async (eventId: string) => {
    if (!window.confirm("Cancel this event?")) return;
    try {
      await cancelEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch {
      // Silent fail
    }
  }, []);

  if (loading) {
    return (
      <div className={`mb-5 ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card-sm flex-shrink-0 animate-pulse" style={{ width: 240, height: 200 }} />
          ))}
        </div>
      </div>
    );
  }

  // Show section header + empty state if canCreate, so user can always create
  if (events.length === 0 && !canCreate) return null;

  return (
    <div className={`mb-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">{title}</h2>
        {canCreate && onCreateClick && (
          <button
            onClick={onCreateClick}
            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
            style={{ background: "rgba(255,180,84,0.12)", color: "#FFB454" }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div
          className="rounded-2xl p-6 text-center"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <svg className="w-7 h-7 mx-auto mb-2 opacity-20 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          <p className="text-sm text-white/40">No upcoming events</p>
          {canCreate && onCreateClick && (
            <button
              onClick={onCreateClick}
              className="mt-2.5 text-xs font-semibold hover:underline"
              style={{ color: "#FFB454" }}
            >
              Create the first one
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onRsvp={handleRsvp}
              canCancel={isAdmin || event.creatorId === currentUserId}
              onCancel={handleCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
