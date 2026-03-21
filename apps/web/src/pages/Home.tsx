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
import { SpotlightStrip, type SpotlightItem } from "@/components/SpotlightStrip";
import { NearbyWidget } from "@/components/NearbyWidget";

interface Announcement extends AnnouncementItem {}

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { tier, isPrime, isMember, isAdmin } = useTier();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("home");
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
      {showTutorial && <TutorialOverlay section="home" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

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

      {/* Quick access row — SpotlightStrip */}
      <SpotlightStrip
        items={[
          {
            kind: "action",
            id: "main-stage",
            label: "Main Stage",
            sublabel: "24/7 open",
            icon: (
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#5ED1C4" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ),
            gradient: "linear-gradient(135deg, rgba(94,209,196,0.3), rgba(212,0,122,0.2))",
            onClick: () => navigate("/main-stage"),
            pinned: true,
          },
          ...events.map((ev) => ({ kind: "event" as const, data: ev })),
        ]}
        onItemClick={(item) => {
          if (item.kind === "event") setDetailEvent(item.data);
        }}
        showAction
        onAction={() => setShowCreateEvent(true)}
        actionLabel="Create event"
        emptyAction={!evLoading ? () => setShowCreateEvent(true) : undefined}
      />

      {/* Desktop: Nearby widget + quick cards */}
      <div className="hidden lg:block mb-6 space-y-4">
        <NearbyWidget />

        {/* Quick access cards */}
        <div className="grid grid-cols-3 gap-3">
          {/* PNP Bank */}
          <button
            onClick={() => navigate("/bank")}
            className="group rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
            style={{
              background: "linear-gradient(135deg, rgba(0,141,228,0.1), rgba(0,84,166,0.08))",
              border: "1px solid rgba(0,141,228,0.2)",
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
              style={{ background: "rgba(0,141,228,0.15)" }}
            >
              <svg className="w-5 h-5" style={{ color: "#008DE4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white mb-0.5">PNP Bank</h3>
            <p className="text-[11px] leading-relaxed" style={{ color: "#8E8E93" }}>
              Pay with Dash — 20% OFF this week
            </p>
          </button>

          {/* Subscribe */}
          <button
            onClick={() => navigate("/subscribe")}
            className="group rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
            style={{
              background: "linear-gradient(135deg, rgba(212,0,122,0.1), rgba(230,145,56,0.08))",
              border: "1px solid rgba(212,0,122,0.2)",
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
              style={{ background: "rgba(212,0,122,0.15)" }}
            >
              <svg className="w-5 h-5" style={{ color: "#D4007A" }} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white mb-0.5">Subscribe</h3>
            <p className="text-[11px] leading-relaxed" style={{ color: "#8E8E93" }}>
              Unlock PRIME — DMs, calls & more
            </p>
          </button>

          {/* Settings */}
          <button
            onClick={() => navigate("/settings")}
            className="group rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <svg className="w-5 h-5" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white mb-0.5">Settings</h3>
            <p className="text-[11px] leading-relaxed" style={{ color: "#8E8E93" }}>
              Profile, privacy & preferences
            </p>
          </button>
        </div>
      </div>

      {/* Mobile: PRIME CTA */}
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

      {/* Social feed — full width */}
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
