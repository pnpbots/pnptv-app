import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useDirectus } from "@/hooks/useDirectus";
import { useI18n } from "@/lib/i18n";
import { UpcomingEvents } from "@/components/events/UpcomingEvents";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import type { EventItem } from "@/components/events/EventCard";
import {
  getHangoutGroups,
  updateProfile,
  getUpcomingEvents,
  getMyRsvps,
  rsvpEvent,
  unrsvpEvent,
  cancelEvent,
  type HangoutGroup,
} from "@/lib/api";
import {
  HighlightCarousel,
  EventDetailModal,
  type HighlightItem,
  type AnnouncementItem
} from "@/components/events";
import { SocialFeedTabs } from "@/components/social";

interface Announcement extends AnnouncementItem {}

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { tier, isPrime, isMember, isAdmin } = useTier();
  const { showTutorial, dismissTutorial } = useTutorial("home");
  const canCreateLive = isAdmin || user?.role === "model" || user?.role === "creator";

  const [contentDisclaimer, setContentDisclaimer] = useState(user?.contentDisclaimer || false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventKey, setEventKey] = useState(0);
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);
  const [userGroups, setUserGroups] = useState<HangoutGroup[]>([]);

  const { data: announcements, isLoading: annLoading } = useDirectus<Announcement>({
    collection: "announcements",
    params: {
      filter: { status: { _eq: "published" } },
      sort: ["-is_pinned", "-published_at"],
      limit: 5,
    },
  });

  const [events, setEvents] = useState<EventItem[]>([]);
  const [evLoading, setEvLoading] = useState(true);
  const [myRsvps, setMyRsvps] = useState<EventItem[]>([]);

  const username = user?.username || user?.displayName || "user";

  const loadEvents = useCallback(() => {
    setEvLoading(true);
    getUpcomingEvents({ limit: 8 })
      .then((res) => {
        if (res.success) setEvents(res.events);
      })
      .catch(() => {})
      .finally(() => setEvLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;

    loadEvents();

    if (isAuthenticated) {
      getHangoutGroups()
        .then((res) => {
          if (res.success) setUserGroups(res.groups);
        })
        .catch(() => {});

      getMyRsvps()
        .then((res) => {
          if (res.success) setMyRsvps(res.events);
        })
        .catch(() => {});
    }
  }, [authLoading, isAuthenticated, loadEvents]);

  const handleRsvp = useCallback(async (eventId: string, shouldRsvp: boolean) => {
    try {
      const res = shouldRsvp ? await rsvpEvent(eventId) : await unrsvpEvent(eventId);
      if (res.success) {
        const applyUpdate = (prev: EventItem[]) =>
          prev.map((e) =>
            e.id === eventId
              ? { ...e, rsvpCount: res.rsvpCount, userRsvpd: res.userRsvpd }
              : e
          );
        setEvents(applyUpdate);
        if (!shouldRsvp) {
          setMyRsvps((prev) => prev.filter((e) => e.id !== eventId));
        } else {
          setMyRsvps((prev) => {
            if (prev.some((e) => e.id === eventId)) return applyUpdate(prev);
            const found = events.find((e) => e.id === eventId);
            return found
              ? [{ ...found, rsvpCount: res.rsvpCount, userRsvpd: res.userRsvpd }, ...prev]
              : prev;
          });
        }
      }
    } catch { /* silent */ }
  }, [events]);

  const handleCancel = useCallback(async (eventId: string) => {
    if (!window.confirm("Cancel this event?")) return;
    try {
      await cancelEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch { /* silent */ }
  }, []);

  // Combine and sort highlights: pinned announcements first, then by date
  const highlights: HighlightItem[] = [
    ...announcements.map((a) => ({ kind: "announcement" as const, data: a })),
    ...events.map((e) => ({ kind: "event" as const, data: e })),
  ].sort((a, b) => {
    const aPinned = a.kind === "announcement" && a.data.is_pinned;
    const bPinned = b.kind === "announcement" && b.data.is_pinned;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    const aDate = a.kind === "event" ? a.data.scheduledAt : a.data.published_at;
    const bDate = b.kind === "event" ? b.data.scheduledAt : b.data.published_at;
    return new Date(aDate).getTime() - new Date(bDate).getTime();
  });

  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
    setContentDisclaimer(true);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Helmet>
        <title>Home — PNPtv!</title>
        <meta name="description" content="Your PNPtv feed. Browse announcements, featured performers, and community posts." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="home" onDismiss={dismissTutorial} />}

      {/* Slim hero bar */}
      <div className="flex items-center justify-between px-4 py-2.5 glass-card-sm mb-3 animate-fade-in-up">
        <h1 className="text-sm font-bold text-white">
          High <span role="img" aria-label="wind">🌬️</span>{" "}
          <span className="text-gradient">@{username}</span>
        </h1>
        <span
          className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider flex-shrink-0"
          style={
            isPrime
              ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
              : { background: "rgba(255,255,255,0.06)", color: "#555" }
          }
        >
          {tier}
        </span>
      </div>

      {/* Compact room access buttons */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => navigate("/da-haus")}
          className="flex items-center gap-2.5 px-3 py-2.5 glass-card-sm hover:border-white/20 active:scale-[0.98] transition-all text-left"
          style={{ borderLeft: "3px solid rgba(162,89,255,0.5)" }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(162,89,255,0.15)" }}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              style={{ color: "#A259FF" }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white leading-none">Da Haus</p>
            <p className="text-[9px] mt-0.5" style={{ color: "#A259FF" }}>Free for all</p>
          </div>
        </button>
        <button
          onClick={() => navigate("/main-stage")}
          className="flex items-center gap-2.5 px-3 py-2.5 glass-card-sm hover:border-white/20 active:scale-[0.98] transition-all text-left"
          style={{ borderLeft: "3px solid rgba(94,209,196,0.5)" }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(94,209,196,0.15)" }}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              style={{ color: "#5ED1C4" }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white leading-none">Main Stage</p>
            <p className="text-[9px] mt-0.5" style={{ color: "#5ED1C4" }}>Member+</p>
          </div>
        </button>
      </div>

      {/* Mobile-only event pills */}
      {(highlights.length > 0 || annLoading || evLoading) && (
        <div className="lg:hidden mb-4 -mx-4 px-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 pb-1">
            {annLoading || evLoading ? (
              <>
                {[80, 110, 90].map((w, i) => (
                  <div
                    key={i}
                    className="flex-shrink-0 h-7 rounded-full bg-white/5 animate-pulse"
                    style={{ width: w }}
                  />
                ))}
              </>
            ) : (
              <>
                {/* Create Event pill (mobile) */}
                {canCreateLive && (
                  <button
                    onClick={() => setShowCreateEvent(true)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap border border-white/10 transition-all active:scale-95"
                    style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.3)" }}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Create Event
                  </button>
                )}
                {highlights.slice(0, 10).map((item, i) => {
                const label =
                  item.kind === "event"
                    ? (item.data as EventItem).title
                    : String(
                        (item.data as AnnouncementItem).title ||
                          (item.data as AnnouncementItem).body ||
                          ""
                      ).slice(0, 35);
                const isEvent = item.kind === "event";
                return (
                  <button
                    key={i}
                    onClick={() => isEvent && setDetailEvent(item.data as EventItem)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-medium text-white/70 whitespace-nowrap border border-white/10 bg-white/5 hover:border-white/20 active:scale-95 transition-all"
                  >
                    <span>{isEvent ? "📅" : "📢"}</span>
                    <span className="max-w-[140px] truncate">{label}</span>
                  </button>
                );
              })}
              </>
            )}
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="lg:flex lg:gap-6 lg:items-start">

        {/* Main feed — left on desktop, only column on mobile */}
        <main className="flex-1 min-w-0">

          {/* PRIME CTA — mobile only */}
          {!isPrime && (
            <button onClick={() => navigate("/subscribe")} className="lg:hidden w-full mb-4 group">
              <div
                className="rounded-xl px-4 py-2.5 flex items-center gap-3 transition-all"
                style={{
                  background: "rgba(229,255,0,0.06)",
                  border: "1px solid rgba(229,255,0,0.15)",
                }}
              >
                <svg
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: "#E5FF00" }}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <p
                  className="font-semibold text-xs flex-1 text-left"
                  style={{ color: "#E5FF00" }}
                >
                  {isMember ? "Upgrade to PRIME" : "Unlock PRIME"} — DMs, video calls & more
                </p>
                <svg
                  className="w-3.5 h-3.5 flex-shrink-0 group-hover:translate-x-0.5 transition-transform"
                  style={{ color: "rgba(229,255,0,0.4)" }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          )}

          {/* Full social feed — All / WoF / Following tabs with reply+mention support */}
          <SocialFeedTabs
            currentUserId={user?.dbId ? String(user.dbId) : ""}
            isAdmin={isAdmin}
            isAuthenticated={isAuthenticated}
            userLang={user?.language}
            viewerCity={user?.city}
            viewerCountry={user?.country}
            contentDisclaimerAccepted={contentDisclaimer}
            onAcceptDisclaimer={handleAcceptDisclaimer}
            onNavigate={navigate}
            showComposer={true}
          />

        </main>

        {/* Desktop-only sidebar */}
        <aside className="hidden lg:block w-80 flex-shrink-0 lg:sticky lg:top-4 space-y-4">

          {/* PRIME CTA — desktop */}
          {!isPrime && (
            <button
              onClick={() => navigate("/subscribe")}
              className="w-full group text-left"
            >
              <div
                className="rounded-2xl px-4 py-4 flex items-start gap-3 transition-all"
                style={{
                  background: "rgba(229,255,0,0.06)",
                  border: "1px solid rgba(229,255,0,0.2)",
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: "rgba(229,255,0,0.1)" }}
                >
                  <svg
                    className="w-4 h-4"
                    style={{ color: "#E5FF00" }}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm leading-tight" style={{ color: "#E5FF00" }}>
                    {isMember ? "Upgrade to PRIME" : "Unlock PRIME"}
                  </p>
                  <p
                    className="text-xs mt-1 leading-relaxed"
                    style={{ color: "rgba(229,255,0,0.55)" }}
                  >
                    DMs, video calls, private hangouts & more
                  </p>
                </div>
                <svg
                  className="w-4 h-4 flex-shrink-0 mt-2 group-hover:translate-x-0.5 transition-transform"
                  style={{ color: "rgba(229,255,0,0.4)" }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          )}

          {/* Featured events & announcements carousel */}
          {(highlights.length > 0 || annLoading || evLoading) && (
            <HighlightCarousel
              items={highlights}
              loading={annLoading || evLoading}
              onViewDetails={setDetailEvent}
              onRsvp={handleRsvp}
              onCancel={handleCancel}
              canCancel={(eventId, creatorId) =>
                isAdmin || creatorId === (user?.dbId ? String(user.dbId) : undefined)
              }
              canCreate={canCreateLive}
              onCreateClick={isAuthenticated ? () => setShowCreateEvent(true) : undefined}
            />
          )}

          {/* Your Events */}
          {isAuthenticated && (
            <UpcomingEvents
              key={eventKey}
              type="hangout_event"
              limit={3}
              title="Your Events"
              currentUserId={user?.dbId ? String(user.dbId) : undefined}
              isAdmin={isAdmin}
              canCreate={canCreateLive}
              onCreateClick={() => setShowCreateEvent(true)}
            />
          )}

        </aside>

      </div>

      {/* Modals */}
      {showCreateEvent && (
        <CreateEventModal
          canCreateLive={canCreateLive}
          userGroups={userGroups}
          onClose={() => setShowCreateEvent(false)}
          onCreated={(_event: EventItem) => {
            setShowCreateEvent(false);
            setEventKey((k) => k + 1);
          }}
        />
      )}

      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onRsvp={handleRsvp}
          onUpdated={(updated) => {
            setEvents((prev) => prev.map((e) => e.id === updated.id ? updated : e));
            setDetailEvent(updated);
          }}
        />
      )}
    </div>
  );
}
