import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useDirectus } from "@/hooks/useDirectus";
import { useI18n } from "@/lib/i18n";
import { PostComposer } from "@/components/PostComposer";
import { SharePostModal } from "@/components/SharePostModal";
import { UpcomingEvents } from "@/components/events/UpcomingEvents";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import type { EventItem } from "@/components/events/EventCard";
import {
  getHomeFeedPosts,
  getSocialFeedPosts,
  getHangoutGroups,
  togglePostLike,
  deleteSocialPost,
  editSocialPost,
  updateProfile,
  getUpcomingEvents,
  getMyRsvps,
  rsvpEvent,
  unrsvpEvent,
  cancelEvent,
  type SocialPostItem,
  type HangoutGroup,
} from "@/lib/api";
import { translateText } from "@/lib/feedI18n";
import {
  HighlightCarousel,
  EventDetailModal,
  type HighlightItem,
  type AnnouncementItem
} from "@/components/events";

interface Announcement extends AnnouncementItem {}


function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

// ── Per-post card with reactions, translate, edit, delete ─────────────────────
function PostCard({
  post,
  currentUserId,
  isAdmin,
  userLang,
  contentDisclaimerAccepted,
  onDelete,
  onUpdated,
  onShare,
  onNavigate,
}: {
  post: SocialPostItem;
  currentUserId?: string;
  isAdmin: boolean;
  userLang?: string;
  contentDisclaimerAccepted: boolean;
  onDelete: (id: number) => void;
  onUpdated: (id: number, content: string) => void;
  onShare: (id: number) => void;
  onNavigate: (path: string) => void;
}) {
  const { feed: t } = useI18n();
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(post.content || "");
  const [saving, setSaving] = useState(false);
  const [currentContent, setCurrentContent] = useState(post.content || "");
  const [likedByMe, setLikedByMe] = useState(post.liked_by_me);
  const [likesCount, setLikesCount] = useState(post.likes_count || 0);
  const [showMenu, setShowMenu] = useState(false);

  const isOwn = !!currentUserId && String(post.author_id) === currentUserId;
  const authorPath = isOwn ? "/profile" : `/profile/${post.author_id}`;

  const handleLike = async () => {
    try {
      const res = await togglePostLike(post.id);
      setLikedByMe(res.liked);
      setLikesCount(res.likes_count ?? (likesCount + (res.liked ? 1 : -1)));
    } catch { /* silent */ }
  };

  const handleTranslate = async () => {
    if (isTranslating) return;
    if (translatedContent) { setTranslatedContent(null); return; }
    if (!currentContent) return;
    setIsTranslating(true);
    const result = await translateText(currentContent, userLang || "en");
    if (result) setTranslatedContent(result);
    setIsTranslating(false);
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this post?")) return;
    try {
      await deleteSocialPost(post.id);
      onDelete(post.id);
    } catch { /* silent */ }
  };

  const handleSaveEdit = async () => {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try {
      const res = await editSocialPost(post.id, editText.trim());
      if (res.success) {
        setCurrentContent(res.content);
        setTranslatedContent(null);
        onUpdated(post.id, res.content);
        setIsEditing(false);
      }
    } catch { /* silent */ }
    setSaving(false);
  };

  return (
    <div className="glass-card-sm p-4">
      <div className="flex gap-3">
        {/* Avatar */}
        <button onClick={() => onNavigate(authorPath)} className="flex-shrink-0">
          {isValidPhotoUrl(post.author_photo) ? (
            <img
              src={post.author_photo}
              alt={`${post.author_first_name || post.author_username || "User"}'s avatar`}
              className="w-10 h-10 rounded-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
            >
              {(post.author_first_name || post.author_username || "?")[0].toUpperCase()}
            </div>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <button
                onClick={() => onNavigate(authorPath)}
                className="font-semibold text-white text-sm truncate hover:underline"
              >
                {post.author_first_name || post.author_username || "Anonymous"}
              </button>
              {post.author_username && (
                <span className="text-xs hidden sm:inline" style={{ color: "#8E8E93" }}>
                  @{post.author_username}
                </span>
              )}
              <span className="text-xs" style={{ color: "#8E8E93" }}>
                &middot; {timeAgo(post.created_at)}
              </span>
            </div>

            {/* Owner/admin menu */}
            {(isOwn || isAdmin) && (
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setShowMenu((v) => !v)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  style={{ color: "#8E8E93" }}
                  aria-label="Post options"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                  </svg>
                </button>
                {showMenu && (
                  <div
                    className="absolute right-0 top-7 z-50 rounded-xl shadow-xl py-1 min-w-[120px]"
                    style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    {isOwn && (
                      <button
                        onClick={() => { setIsEditing(true); setEditText(currentContent); setShowMenu(false); }}
                        className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => { setShowMenu(false); handleDelete(); }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors"
                      style={{ color: "#F87171" }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          {isEditing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full rounded-lg px-3 py-2 text-sm text-white bg-white/5 border border-white/15 focus:border-white/30 outline-none resize-none"
                maxLength={2000}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !editText.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-all"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed">
                {translatedContent ?? currentContent}
              </p>
              {translatedContent && (
                <button
                  onClick={() => setTranslatedContent(null)}
                  className="text-xs mt-0.5"
                  style={{ color: "#8E8E93" }}
                >
                  {t.showOriginal}
                </button>
              )}
            </>
          )}

          {/* Media */}
          {post.media_url && !isEditing && (
            <div className="mt-2">
              {post.media_type === "video" ? (
                <video
                  src={post.media_url}
                  controls
                  playsInline
                  muted
                  className="w-full max-h-72 rounded-lg object-cover"
                  preload="metadata"
                  onError={(e) => { (e.target as HTMLVideoElement).parentElement!.style.display = "none"; }}
                />
              ) : (
                <img
                  src={post.media_url}
                  alt="Post image"
                  className="w-full max-h-72 rounded-lg object-cover"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                />
              )}
            </div>
          )}

          {/* Actions */}
          {!isEditing && (
            <div className="mt-3">
              <div className="flex items-center gap-4" style={{ color: "#8E8E93" }}>
                {/* Like */}
                <button
                  onClick={handleLike}
                  className="flex items-center gap-1.5 text-xs transition-colors hover:text-pink-400"
                  style={{ color: likedByMe ? "#D4007A" : "#8E8E93" }}
                >
                  <svg className="w-4 h-4" fill={likedByMe ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={likedByMe ? 0 : 1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                  </svg>
                  {likesCount > 0 && <span>{likesCount}</span>}
                </button>

                {/* Share */}
                <button
                  onClick={() => {
                    if (contentDisclaimerAccepted) onShare(post.id);
                    else onShare(post.id); // disclaimer handled upstream
                  }}
                  className="flex items-center gap-1.5 text-xs hover:text-green-400 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                  </svg>
                </button>

                {/* Translate */}
                {currentContent && (
                  <button
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className="flex items-center gap-1 text-xs transition-colors hover:text-teal-400 disabled:opacity-40"
                    style={translatedContent ? { color: "#5ED1C4" } : { color: "#8E8E93" }}
                    title={translatedContent ? t.showOriginal : t.translate}
                  >
                    {isTranslating ? (
                      <span className="text-[10px]">{t.translating}</span>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { feed: t } = useI18n();
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [contentDisclaimer, setContentDisclaimer] = useState(user?.contentDisclaimer || false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [disclaimerAccepting, setDisclaimerAccepting] = useState(false);
  const [pendingSharePostId, setPendingSharePostId] = useState<number | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalPostId, setShareModalPostId] = useState<number | null>(null);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventKey, setEventKey] = useState(0);
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);

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

  const [userGroups, setUserGroups] = useState<HangoutGroup[]>([]);

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
    const loader = isAuthenticated ? getSocialFeedPosts(undefined, 20) : getHomeFeedPosts(20);
    loader
      .then((res) => {
        if (res.success) {
          setPosts(res.posts);
          setNextCursor((res as any).nextCursor ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));


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
        // If un-RSVPing, remove from myRsvps; if RSVPing, refresh list next load
        if (!shouldRsvp) {
          setMyRsvps((prev) => prev.filter((e) => e.id !== eventId));
        } else {
          // Add to myRsvps if not already there (optimistic)
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

  // Combine and sort highlights: pinned announcements first, then by date (events & announcements)
  const highlights: HighlightItem[] = [
    ...announcements.map((a) => ({ kind: "announcement" as const, data: a })),
    ...events.map((e) => ({ kind: "event" as const, data: e })),
  ].sort((a, b) => {
    // Pinned announcements always first
    const aPinned = a.kind === "announcement" && a.data.is_pinned;
    const bPinned = b.kind === "announcement" && b.data.is_pinned;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    // Then sort by date: scheduledAt for events, published_at for announcements
    const aDate = a.kind === "event" ? a.data.scheduledAt : a.data.published_at;
    const bDate = b.kind === "event" ? b.data.scheduledAt : b.data.published_at;
    return new Date(aDate).getTime() - new Date(bDate).getTime();
  });

  const handleShare = useCallback((postId: number) => {
    if (contentDisclaimer) {
      setShareModalPostId(postId);
      setShowShareModal(true);
    } else {
      setPendingSharePostId(postId);
      setShowDisclaimerModal(true);
    }
  }, [contentDisclaimer]);

  const handleAcceptDisclaimer = useCallback(async () => {
    setDisclaimerAccepting(true);
    try {
      await updateProfile({ contentDisclaimer: true });
      setContentDisclaimer(true);
      setShowDisclaimerModal(false);
      if (pendingSharePostId !== null) {
        setShareModalPostId(pendingSharePostId);
        setShowShareModal(true);
        setPendingSharePostId(null);
      }
    } catch { /* silent */ }
    setDisclaimerAccepting(false);
  }, [pendingSharePostId]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || !isAuthenticated) return;
    setLoadingMore(true);
    try {
      const res = await getSocialFeedPosts(nextCursor, 20);
      if (res.success) {
        setPosts((prev) => [...prev, ...res.posts]);
        setNextCursor(res.nextCursor ?? null);
      }
    } catch { /* silent */ }
    setLoadingMore(false);
  }, [nextCursor, loadingMore, isAuthenticated]);

  const handlePostDeleted = useCallback((postId: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const handlePostUpdated = useCallback((postId: number, content: string) => {
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, content } : p));
  }, []);

  const username = user?.username || user?.displayName || "user";
  const { tier, isPrime, isMember, isAdmin } = useTier();
  const { showTutorial, dismissTutorial } = useTutorial("home");
  const canCreateLive = isAdmin || user?.role === "model" || user?.role === "creator";


  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Helmet>
        <title>Home — PNPtv!</title>
        <meta name="description" content="Your PNPtv feed. Browse announcements, featured performers, and community posts." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="home" onDismiss={dismissTutorial} />}

      {/* ── ZONE 1: Full-width top strip — always visible, minimal height ── */}

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
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(162,89,255,0.15)" }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "#A259FF" }}>
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
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(94,209,196,0.15)" }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "#5ED1C4" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white leading-none">Main Stage</p>
            <p className="text-[9px] mt-0.5" style={{ color: "#5ED1C4" }}>Member+</p>
          </div>
        </button>
      </div>

      {/* ── ZONE 2: Mobile-only event pills — replaces full carousel on small screens ── */}
      {(highlights.length > 0 || annLoading || evLoading) && (
        <div className="lg:hidden mb-4 -mx-4 px-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 pb-1">
            {annLoading || evLoading ? (
              <>
                {[80, 110, 90].map((w, i) => (
                  <div key={i} className="flex-shrink-0 h-7 rounded-full bg-white/5 animate-pulse" style={{ width: w }} />
                ))}
              </>
            ) : (
              highlights.slice(0, 10).map((item, i) => {
                const label = item.kind === "event"
                  ? (item.data as EventItem).title
                  : String((item.data as AnnouncementItem).title || (item.data as AnnouncementItem).body || "").slice(0, 35);
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
              })
            )}
          </div>
        </div>
      )}

      {/* ── ZONE 3: Two-column layout ── */}
      <div className="lg:flex lg:gap-6 lg:items-start">

      {/* ── Main feed — left on desktop, only column on mobile ── */}
      <main className="flex-1 min-w-0">

      {/* PRIME CTA — mobile only, compact single line */}
      {!isPrime && (
        <button
          onClick={() => navigate("/subscribe")}
          className="lg:hidden w-full mb-4 group"
        >
          <div
            className="rounded-xl px-4 py-2.5 flex items-center gap-3 transition-all"
            style={{
              background: "rgba(229,255,0,0.06)",
              border: "1px solid rgba(229,255,0,0.15)",
            }}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#E5FF00" }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <p className="font-semibold text-xs flex-1 text-left" style={{ color: "#E5FF00" }}>
              {isMember ? "Upgrade to PRIME" : "Unlock PRIME"} — DMs, video calls & more
            </p>
            <svg className="w-3.5 h-3.5 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" style={{ color: "rgba(229,255,0,0.4)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      )}

      {/* Create post — compact composer, expands on focus */}
      {isAuthenticated && (
        <PostComposer
          compact
          onPostCreated={(newPost) => setPosts((prev) => [newPost, ...prev])}
          className="mb-6"
        />
      )}

      {/* Social Feed */}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-full" />
                  <div className="h-3 bg-white/10 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto mb-3"
            style={{ color: "#8E8E93" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
            />
          </svg>
          <p className="text-white font-medium mb-1">{t.noPostsHome}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {t.beFirstHome}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user?.dbId ? String(user.dbId) : undefined}
              isAdmin={isAdmin}
              userLang={user?.language}
              contentDisclaimerAccepted={contentDisclaimer}
              onDelete={handlePostDeleted}
              onUpdated={handlePostUpdated}
              onShare={handleShare}
              onNavigate={navigate}
            />
          ))}
          {/* Load more */}
          {nextCursor && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full py-3 text-center text-sm font-medium text-white/50 hover:text-white/80 transition-colors disabled:opacity-40"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}

      </main>{/* end main feed */}

      {/* ── Desktop-only sidebar ── */}
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
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(229,255,0,0.1)" }}>
                <svg className="w-4 h-4" style={{ color: "#E5FF00" }} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-tight" style={{ color: "#E5FF00" }}>
                  {isMember ? "Upgrade to PRIME" : "Unlock PRIME"}
                </p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(229,255,0,0.55)" }}>
                  DMs, video calls, private hangouts & more
                </p>
              </div>
              <svg className="w-4 h-4 flex-shrink-0 mt-2 group-hover:translate-x-0.5 transition-transform" style={{ color: "rgba(229,255,0,0.4)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            canCancel={(eventId, creatorId) => isAdmin || creatorId === (user?.dbId ? String(user.dbId) : undefined)}
            canCreate={canCreateLive}
            onCreateClick={isAuthenticated ? () => setShowCreateEvent(true) : undefined}
          />
        )}

        {/* Your Events (upcoming hangout events) */}
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

      </aside>{/* end desktop sidebar */}

      </div>{/* end two-column layout */}

      {/* Content Disclaimer Modal */}
      {showDisclaimerModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowDisclaimerModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5 space-y-4"
            style={{ background: "#1C1C1E", border: "1px solid rgba(212,0,122,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-white">Content Sharing Disclaimer</h3>
            </div>
            <p className="text-sm text-white/80 leading-relaxed">
              By accepting this disclaimer, you acknowledge that you are responsible for any content you share from this platform.
              Shared content must comply with our community guidelines and applicable laws.
            </p>
            <p className="text-xs text-white/50 leading-relaxed">
              This action is permanent and cannot be undone. Your acceptance date, time, and IP address will be recorded.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowDisclaimerModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/20 text-white/70 hover:border-white/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAcceptDisclaimer}
                disabled={disclaimerAccepting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {disclaimerAccepting ? "..." : "Accept & Share"}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModalPostId !== null && (
        <SharePostModal
          postId={shareModalPostId}
          isOpen={showShareModal}
          onClose={() => { setShowShareModal(false); setShareModalPostId(null); }}
          contentDisclaimerAccepted={contentDisclaimer}
        />
      )}

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
