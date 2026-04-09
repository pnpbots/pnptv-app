import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Card, Skeleton } from "@pnptv/ui-kit";
import { useDirectus } from "@/hooks/useDirectus";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useTier } from "@/hooks/useTier";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { type PrimeVideo, getAssetUrl, DIRECTUS_URL } from "@/lib/directus";
import { AnimatedVideoThumbnail } from "@/components/AnimatedVideoThumbnail";
import { SocialPostCard } from "@/components/social";
import {
  type ContentReaction,
  type SocialPostItem,
  type CreatorChannel,
  type InvidiousVideo,
  getContentReactions,
  toggleContentReaction,
  getPublicProfile,
  togglePostLike,
  deleteSocialPost,
  updateProfile,
  browseCreatorChannels,
  getChannelDetail,
  getLiveStreams,
  getWebRTCStreams,
  getFeaturedPerformers,
  getUpcomingEvents,
  searchVideorama,
  getVideoramaTrending,
  type LiveStream,
  type FeaturedPerformer,
} from "@/lib/api";
import type { EventItem } from "@/components/events/EventCard";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function videoUrl(fileId: string | null): string | null {
  if (!fileId) return null;
  return `${DIRECTUS_URL}/assets/${fileId}`;
}

const CROWN = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M2.5 18.5L5 9l4.5 4L12 4l2.5 9L19 9l2.5 9.5H2.5z" />
  </svg>
);

const PlayIcon = () => (
  <svg className="w-9 h-9 text-white drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

// Santino's username — the one and only creator/founder
const PRIME_CREATOR = "santinofurioso";

// ── Section nav tabs ─────────────────────────────────────────────────────────
type PrimeSection = "vault" | "feed" | "schedule" | "discover";

export default function Media() {
  const { isPrime, isMember } = useTier();
  const { user, isAuthenticated, isAdmin, login } = useAuth();
  const navigate = useNavigate();
  const { media: t } = useI18n();

  // ── Section toggle ─────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<PrimeSection>("vault");

  // ── Live state ─────────────────────────────────────────────────────────────
  const [santinoLive, setSantinoLive] = useState(false);
  const [santinoStreamId, setSantinoStreamId] = useState<string | null>(null);
  const [santinoPerformer, setSantinoPerformer] = useState<FeaturedPerformer | null>(null);
  const [followersCount] = useState(0);

  // ── Channels state ─────────────────────────────────────────────────────────
  const [channels, setChannels] = useState<CreatorChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [channelPosts, setChannelPosts] = useState<SocialPostItem[]>([]);
  const [channelPostsLoading, setChannelPostsLoading] = useState(false);

  // ── Videos state ───────────────────────────────────────────────────────────
  const { data: videos, isLoading, error } = useDirectus<PrimeVideo>({
    collection: "prime_videos",
    params: {
      filter: {
        status: { _eq: "published" },
        type: { _eq: "video" },
      },
      fields: ["*"],
      sort: ["category", "-is_featured", "-date_created"],
      limit: 100,
    },
  });

  const [activeVideo, setActiveVideo] = useState<PrimeVideo | null>(null);
  const [activeSeries, setActiveSeries] = useState<string>("all");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [videoReactions, setVideoReactions] = useState<ContentReaction[]>([]);
  const [reactionsLoading, setReactionsLoading] = useState(false);
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("prime");

  // ── Feed state ─────────────────────────────────────────────────────────────
  const [santinoPosts, setSantinoPosts] = useState<SocialPostItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);

  // ── Schedule state ─────────────────────────────────────────────────────────
  const [liveEvents, setLiveEvents] = useState<EventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  // ── Discover (Invidious) state ────────────────────────────────────────────
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverResults, setDiscoverResults] = useState<InvidiousVideo[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverMode, setDiscoverMode] = useState<"trending" | "search">("trending");

  // ── Video filters ──────────────────────────────────────────────────────────
  const CATEGORIES = useMemo(() => {
    const cats = new Set(videos.map((v) => v.category).filter(Boolean));
    const labelMap: Record<string, string> = {
      live_show: t.categoryLiveShow,
      prime_shorts: t.categoryPrimeShorts,
      prime_videos: t.categoryPrimeVideos,
    };
    const order = ["live_show", "prime_shorts", "prime_videos"];
    return order
      .filter((key) => cats.has(key))
      .map((key) => ({ key, label: labelMap[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
  }, [videos, t]);

  const TAG_LABELS: { key: string; label: string }[] = [
    { key: "slam", label: "Slam" },
    { key: "clouds", label: "Clouds" },
    { key: "outdoors", label: "Outdoors" },
    { key: "group", label: "Group" },
    { key: "meth-daddy", label: "Meth Daddy" },
    { key: "twink", label: "Twink" },
    { key: "colombian", label: "Colombian" },
    { key: "venezuelan", label: "Venezuelan" },
    { key: "threesome", label: "Threesome" },
    { key: "golden-rain", label: "Golden Rain" },
  ];

  const AVAILABLE_TAGS = useMemo(() => {
    const allTags = new Set(videos.flatMap((v) => v.tags || []));
    return TAG_LABELS.filter((t) => allTags.has(t.key));
  }, [videos]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const filteredVideos = useMemo(() => {
    let result = videos;
    if (activeSeries !== "all") {
      result = result.filter((v) => v.category === activeSeries);
    }
    if (activeTags.length > 0) {
      result = result.filter((v) =>
        v.tags && activeTags.some((tag) => v.tags!.includes(tag))
      );
    }
    return result;
  }, [videos, activeSeries, activeTags]);

  const handleVideoClick = (video: PrimeVideo) => {
    if (!isAuthenticated) { login(); return; }
    if (!isPrime) { navigate("/subscribe"); return; }
    setActiveVideo((prev) => (prev?.id === video.id ? null : video));
  };

  // Load reactions whenever the active video changes
  useEffect(() => {
    if (!activeVideo?.id) {
      setVideoReactions([]);
      return;
    }
    setReactionsLoading(true);
    getContentReactions(activeVideo.id)
      .then((res) => { if (res.reactions) setVideoReactions(res.reactions); })
      .catch(() => {})
      .finally(() => setReactionsLoading(false));
  }, [activeVideo?.id]);

  const handleVideoReaction = useCallback(async (emoji: string) => {
    if (!activeVideo?.id || !isAuthenticated) return;
    try {
      const res = await toggleContentReaction(activeVideo.id, emoji);
      if (res.success) setVideoReactions(res.reactions);
    } catch {
      // silent
    }
  }, [activeVideo?.id, isAuthenticated]);

  // ── Load creator feed ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    setFeedError(null);

    getPublicProfile(`@${PRIME_CREATOR}`, undefined, 20)
      .then((res) => {
        if (cancelled) return;
        const posts = (res.success ? res.posts : []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setSantinoPosts(posts);
        setFeedLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setFeedError(err instanceof Error ? err.message : "Failed to load feed");
        setFeedLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // ── Load live status (check if Santino is streaming) ───────────────────────
  useEffect(() => {
    const checkLive = () => {
      Promise.all([
        getFeaturedPerformers().catch(() => ({ performers: [] })),
        getLiveStreams().catch(() => ({ streams: [] })),
        getWebRTCStreams().catch(() => ({ streams: [] })),
      ]).then(([perfData, hlsData, webrtcData]) => {
        const performers = perfData.performers || [];
        // Find Santino in performers
        const santino = performers.find((p: FeaturedPerformer) =>
          p.displayName?.toLowerCase().includes("santino") ||
          p.slug?.toLowerCase().includes("santino")
        );
        if (santino) setSantinoPerformer(santino);

        const hlsStreams = (hlsData.streams || []).filter((s: LiveStream) => s.isLive);
        const webrtcStreams = (webrtcData.streams || []).filter((s: any) => s.isLive);
        const allStreams = [...webrtcStreams, ...hlsStreams];

        // Check if Santino is live
        const santinoStream = allStreams.find((s: any) =>
          s.id?.toLowerCase().includes("santino") ||
          s.performerName?.toLowerCase().includes("santino") ||
          (santino?.hlsUrl && s.hlsUrl === santino.hlsUrl) ||
          (santino?.userId && String(s.userId || s.id) === String(santino.userId))
        );

        if (santinoStream || santino?.isLive) {
          setSantinoLive(true);
          setSantinoStreamId(santinoStream?.id || (santino?.userId ? String(santino.userId) : null));
        } else {
          setSantinoLive(false);
          setSantinoStreamId(null);
        }
      });
    };

    checkLive();
    const interval = setInterval(checkLive, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Load channels ──────────────────────────────────────────────────────────
  useEffect(() => {
    setChannelsLoading(true);
    browseCreatorChannels({ limit: 50 })
      .then((res) => {
        // Filter to Santino's channels only
        const santinoChannels = res.channels.filter((ch) =>
          ch.creatorUsername?.toLowerCase() === PRIME_CREATOR ||
          ch.creatorName?.toLowerCase().includes("santino")
        );
        // If no channels found specifically for Santino, show all (he's the only creator)
        setChannels(santinoChannels.length > 0 ? santinoChannels : res.channels);
      })
      .catch(() => {})
      .finally(() => setChannelsLoading(false));
  }, []);

  // ── Load channel posts when a channel is selected ──────────────────────────
  useEffect(() => {
    if (activeChannelId === null) return;
    setChannelPostsLoading(true);
    getChannelDetail(activeChannelId)
      .then((res) => {
        setChannelPosts(res.posts || []);
      })
      .catch(() => setChannelPosts([]))
      .finally(() => setChannelPostsLoading(false));
  }, [activeChannelId]);

  // ── Load upcoming events ───────────────────────────────────────────────────
  useEffect(() => {
    setEventsLoading(true);
    getUpcomingEvents({ type: "live_stream", limit: 8 })
      .then((res) => setLiveEvents(res.success ? res.events : []))
      .catch(() => setLiveEvents([]))
      .finally(() => setEventsLoading(false));
  }, []);

  // ── Discover: load trending on tab switch ──────────────────────────────────
  useEffect(() => {
    if (activeSection !== "discover") return;
    if (discoverResults.length > 0) return; // already loaded
    setDiscoverLoading(true);
    getVideoramaTrending()
      .then((res) => { if (res.success) setDiscoverResults(res.results.slice(0, 30)); setDiscoverMode("trending"); })
      .catch(() => {})
      .finally(() => setDiscoverLoading(false));
  }, [activeSection]);

  const handleDiscoverSearch = useCallback(async () => {
    if (!discoverQuery.trim()) return;
    setDiscoverLoading(true);
    setDiscoverMode("search");
    try {
      const res = await searchVideorama(discoverQuery.trim());
      if (res.success) setDiscoverResults(res.results);
    } catch { /* silent */ }
    setDiscoverLoading(false);
  }, [discoverQuery]);

  // ── Feed actions ───────────────────────────────────────────────────────────
  const handleLike = useCallback(async (postId: number) => {
    if (!isAuthenticated) { login(); return; }
    try {
      const res = await togglePostLike(postId);
      const updatePosts = (prev: SocialPostItem[]) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked_by_me: res.liked, likes_count: res.likes_count ?? (p.likes_count + (res.liked ? 1 : -1)) }
            : p
        );
      setSantinoPosts(updatePosts);
      setChannelPosts(updatePosts);
    } catch { /* silent */ }
  }, [isAuthenticated, login]);

  const handleDelete = useCallback(async (postId: number) => {
    try {
      await deleteSocialPost(postId);
      setSantinoPosts((prev) => prev.filter((p) => p.id !== postId));
      setChannelPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch { /* silent */ }
  }, []);

  const handleWofToggle = useCallback((postId: number, nowWof: boolean) => {
    const update = (prev: SocialPostItem[]) =>
      prev.map((p) => (p.id === postId ? { ...p, is_wof: nowWof } : p));
    setSantinoPosts(update);
    setChannelPosts(update);
  }, []);

  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
  }, []);

  // Decide which posts to show — channel-filtered or full feed
  const displayPosts = activeChannelId !== null ? channelPosts : santinoPosts;
  const postsLoading = activeChannelId !== null ? channelPostsLoading : feedLoading;

  // ── Countdown helper ───────────────────────────────────────────────────────
  function formatCountdown(dateStr: string): string {
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff <= 0) return "Starting now";
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (hours > 24) return `in ${Math.floor(hours / 24)}d`;
    if (hours > 0) return `in ${hours}h ${mins}m`;
    return `in ${mins}m`;
  }

  return (
    <div className="max-w-5xl mx-auto px-0 sm:px-4 py-0 sm:py-6">
      <Helmet>
        <title>PRIME — PNPtv!</title>
        <meta name="description" content="Santino's PRIME experience — live streams, exclusive videos, channels, and more." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="prime" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1: THE HERO — Santino's Live Stage / Banner
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden" style={{ minHeight: "280px" }}>
        {/* Background — gradient with glow */}
        <div
          className="absolute inset-0"
          style={{
            background: santinoLive
              ? "linear-gradient(180deg, rgba(212,0,122,0.3) 0%, rgba(10,10,20,1) 100%)"
              : "linear-gradient(180deg, rgba(20,10,30,1) 0%, rgba(10,10,20,1) 100%)",
          }}
        />
        {/* Radial glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] pointer-events-none"
          style={{
            background: santinoLive
              ? "radial-gradient(ellipse, rgba(212,0,122,0.25) 0%, transparent 70%)"
              : "radial-gradient(ellipse, rgba(230,145,56,0.12) 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 px-4 pt-8 pb-6 flex flex-col items-center text-center">
          {/* Avatar */}
          <div className="relative mb-4">
            <div
              className={`w-28 h-28 rounded-full overflow-hidden border-[3px] ${
                santinoLive ? "border-red-500" : "border-pnp-accent/60"
              }`}
              style={santinoLive ? { boxShadow: "0 0 20px rgba(255,0,0,0.3)" } : { boxShadow: "0 0 20px rgba(212,0,122,0.2)" }}
            >
              <img
                src={santinoPerformer?.photoUrl || user?.photoUrl || "/logo-final.png"}
                alt="Santino"
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).src = "/logo-final.png"; }}
              />
            </div>
            {/* LIVE badge */}
            {santinoLive && (
              <button
                onClick={() => santinoStreamId && navigate(`/live/${santinoStreamId}`)}
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500 text-white text-xs font-bold shadow-lg cursor-pointer hover:bg-red-600 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                LIVE NOW
              </button>
            )}
            {!santinoLive && (
              <span
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                FOUNDER
              </span>
            )}
          </div>

          {/* Name + tagline */}
          <h1
            className="text-2xl font-bold tracking-tight mb-1"
            style={{ fontFamily: "'Ethnocentric', 'Roboto Mono', monospace", color: "#fff" }}
          >
            SANTINO
          </h1>
          <p className="text-xs mb-4" style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "2px" }}>
            CREATOR & FOUNDER OF PNPtv!
          </p>

          {/* Stats strip */}
          <div className="flex items-center gap-4 mb-5">
            <div className="text-center">
              <p className="text-sm font-bold text-white">{santinoPosts.length}</p>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.4)" }}>Posts</p>
            </div>
            <div className="w-px h-6" style={{ background: "rgba(255,255,255,0.1)" }} />
            <div className="text-center">
              <p className="text-sm font-bold text-white">{videos.length}</p>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.4)" }}>Videos</p>
            </div>
            <div className="w-px h-6" style={{ background: "rgba(255,255,255,0.1)" }} />
            <div className="text-center">
              <p className="text-sm font-bold text-white">{channels.length}</p>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.4)" }}>Channels</p>
            </div>
          </div>

          {/* User tier badge */}
          {isAuthenticated && (
            <div className="mb-3">
              <span
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                style={
                  isPrime
                    ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
                    : isMember
                    ? { background: "rgba(94,209,196,0.2)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }
                    : { background: "rgba(255,255,255,0.08)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.1)" }
                }
              >
                {isPrime ? "PRIME Member" : isMember ? "Member" : "Free"}
                {isAdmin && (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 1l3.22 3.22h4.56v4.56L23 12l-3.22 3.22v4.56h-4.56L12 23l-3.22-3.22H4.22v-4.56L1 12l3.22-3.22V4.22h4.56L12 1z" />
                  </svg>
                )}
              </span>
              {user?.lastLoginMethod === "oidc" && (
                <p className="text-[9px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Signed in via Authentik SSO
                </p>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {/* Not logged in — show auth CTA */}
            {!isAuthenticated && (
              <button
                onClick={() => login()}
                className="px-5 py-2 rounded-full text-xs font-bold text-white active:scale-95 transition-all"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                Sign In to Explore
              </button>
            )}

            {santinoLive && santinoStreamId && (
              <button
                onClick={() => navigate(`/live/${santinoStreamId}`)}
                className="px-5 py-2 rounded-full text-xs font-bold text-white active:scale-95 transition-all"
                style={{ background: "linear-gradient(135deg, #ff0040, #D4007A)" }}
              >
                Watch Live
              </button>
            )}
            {isAuthenticated && (
              <button
                onClick={() => navigate(`/profile/@${PRIME_CREATOR}`)}
                className="px-4 py-2 rounded-full text-xs font-semibold border transition-all active:scale-95"
                style={{ borderColor: "rgba(255,255,255,0.2)", color: "#fff" }}
              >
                Profile
              </button>
            )}
            {isAuthenticated && !isPrime && (
              <button
                onClick={() => navigate("/subscribe")}
                className="px-4 py-2 rounded-full text-xs font-semibold active:scale-95 transition-all"
                style={{ background: "rgba(212,0,122,0.2)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.4)" }}
              >
                Get PRIME
              </button>
            )}
            {/* Admin controls — only for Santino / admins */}
            {isAdmin && (
              <button
                onClick={() => navigate("/admin/streams")}
                className="px-4 py-2 rounded-full text-xs font-semibold active:scale-95 transition-all"
                style={{ background: "rgba(255,215,0,0.15)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.3)" }}
              >
                Manage
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2: CHANNELS STRIP
         ══════════════════════════════════════════════════════════════════════ */}
      {!channelsLoading && channels.length > 0 && (
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-pnp-textPrimary uppercase tracking-wider">Channels</h2>
            <div className="flex items-center gap-2">
              {activeChannelId !== null && (
                <button
                  onClick={() => { setActiveChannelId(null); setActiveSection("vault"); }}
                  className="text-xs font-medium transition-colors"
                  style={{ color: "#D4007A" }}
                >
                  Clear filter
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => navigate("/channels")}
                  className="text-xs font-medium transition-colors"
                  style={{ color: "#FFD700" }}
                >
                  Manage
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-none">
            {channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => {
                  setActiveChannelId(activeChannelId === ch.id ? null : ch.id);
                  if (activeChannelId !== ch.id) setActiveSection("feed");
                }}
                className={`flex-shrink-0 rounded-xl overflow-hidden transition-all active:scale-95 ${
                  activeChannelId === ch.id
                    ? "ring-2 ring-pnp-accent"
                    : "ring-1 ring-pnp-border hover:ring-pnp-accent/40"
                }`}
                style={{ width: "120px" }}
              >
                <div className="relative w-full aspect-video overflow-hidden">
                  {ch.coverImageUrl ? (
                    <img src={ch.coverImageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{
                        background: `linear-gradient(135deg, hsl(${(ch.id * 47) % 360}, 60%, 20%), hsl(${(ch.id * 47 + 120) % 360}, 60%, 15%))`,
                      }}
                    />
                  )}
                  {ch.isPremium && (
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase"
                      style={{ background: "rgba(212,0,122,0.85)", color: "#fff" }}>
                      PRIME
                    </span>
                  )}
                </div>
                <div className="px-2 py-1.5 bg-pnp-surface">
                  <p className="text-[11px] font-semibold text-pnp-textPrimary truncate">{ch.name}</p>
                  <p className="text-[9px]" style={{ color: "#8E8E93" }}>{ch.postCount} posts</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION NAV — Vault / Feed / Schedule
         ══════════════════════════════════════════════════════════════════════ */}
      {activeChannelId === null && (
        <div className="px-4 mb-4">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
            {([
              { key: "vault" as const, label: "The Vault", icon: "film" },
              { key: "feed" as const, label: "The Wall", icon: "feed" },
              { key: "schedule" as const, label: "Coming Up", icon: "cal" },
              { key: "discover" as const, label: "Discover", icon: "search" },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveSection(tab.key)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
                  activeSection === tab.key
                    ? "text-white shadow-md"
                    : "text-pnp-textSecondary hover:text-white"
                }`}
                style={activeSection === tab.key ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          UPSELL BANNER (non-PRIME users)
         ══════════════════════════════════════════════════════════════════════ */}
      {!isPrime && (
        <div className="px-4 mb-4">
          <div
            className="rounded-2xl p-4 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.18) 0%, rgba(230,145,56,0.14) 100%)", border: "1px solid rgba(212,0,122,0.35)" }}
          >
            <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full opacity-20 pointer-events-none" style={{ background: "radial-gradient(circle, #D4007A, transparent)" }} />
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                PRIME
              </span>
              {CROWN}
            </div>
            <h2 className="text-lg font-bold text-white mb-1">
              {isMember ? t.upgradeTitle : t.unlockTitle}
            </h2>
            <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.7)" }}>
              {isMember ? t.upgradeSubtitle : t.unlockSubtitle(videos.length)}
            </p>
            <button
              onClick={() => navigate("/subscribe")}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {isMember ? t.upgradeCta : t.trialCta}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          CHANNEL POSTS VIEW (when a channel is selected)
         ══════════════════════════════════════════════════════════════════════ */}
      {activeChannelId !== null && (
        <div className="px-4 pb-6">
          <h3 className="text-sm font-bold text-pnp-textPrimary mb-3">
            {channels.find((c) => c.id === activeChannelId)?.name || "Channel"} Posts
          </h3>
          {channelPostsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="glass-card-sm p-4 animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-white/10 rounded w-1/3" />
                      <div className="h-3 bg-white/10 rounded w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : channelPosts.length === 0 ? (
            <div className="glass-card-sm p-8 text-center">
              <p className="text-white font-medium mb-1">No posts in this channel yet</p>
              <p className="text-sm" style={{ color: "#8E8E93" }}>Content coming soon</p>
            </div>
          ) : (
            <div className="space-y-3">
              {channelPosts.map((post) => (
                <SocialPostCard
                  key={post.id}
                  post={post}
                  currentUserId={user?.dbId ? String(user.dbId) : ""}
                  isAdmin={false}
                  userLang={user?.language || "en"}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onWofToggle={handleWofToggle}
                  onNavigate={navigate}
                  contentDisclaimerAccepted={user?.contentDisclaimer || false}
                  onAcceptDisclaimer={handleAcceptDisclaimer}
                  viewerCity={user?.city}
                  viewerCountry={user?.country}
                  distanceKm={null}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          THE VAULT — PRIME Video Grid
         ══════════════════════════════════════════════════════════════════════ */}
      {activeChannelId === null && activeSection === "vault" && (
        <div className="px-4 pb-6">
          {/* Telegram link — legacy content while migrating */}
          <a
            href="https://t.me/+GDD0AAVbvGM3MGE"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 mb-4 rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: "linear-gradient(135deg, rgba(0,136,204,0.12), rgba(0,136,204,0.06))",
              border: "1px solid rgba(0,136,204,0.25)",
            }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,136,204,0.15)" }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#0088CC">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Previous content on Telegram</p>
              <p className="text-[11px]" style={{ color: "#8E8E93" }}>
                Access our full archive while we migrate to the app
              </p>
            </div>
            <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#0088CC" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>

          {/* Active video player */}
          {activeVideo && (
            <div className="mb-5 rounded-2xl overflow-hidden bg-black border border-pnp-accent/30 shadow-lg">
              <video
                key={activeVideo.id}
                src={videoUrl(activeVideo.video_file) || ""}
                controls
                controlsList="nodownload"
                onContextMenu={(e) => e.preventDefault()}
                autoPlay
                playsInline
                className="w-full max-h-[52vh] object-contain"
              />
              <div className="p-3 bg-pnp-surface">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-pnp-textPrimary truncate">
                      {activeVideo.title}
                    </p>
                    {activeVideo.category && (
                      <p className="text-xs text-pnp-accent mt-0.5">
                        {activeVideo.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </p>
                    )}
                    {activeVideo.artist && (
                      <p className="text-sm text-pnp-textSecondary mt-0.5 truncate">
                        {activeVideo.artist}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setActiveVideo(null)}
                    className="flex-shrink-0 p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-border transition-colors"
                    aria-label={t.closePlayer}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {activeVideo.description && (
                  <p className="text-xs text-pnp-textSecondary mt-2 leading-relaxed line-clamp-2">
                    {activeVideo.description}
                  </p>
                )}

                {/* Heart like */}
                {isAuthenticated && (
                  <div className="mt-3 pt-3 border-t border-pnp-border">
                    {reactionsLoading ? (
                      <div className="h-7 w-10 rounded-full bg-pnp-surface animate-pulse" />
                    ) : (() => {
                      const heart = videoReactions.find((r) => r.emoji === "\u2764\uFE0F");
                      const liked = heart?.reactedByMe ?? false;
                      const count = heart?.count ?? 0;
                      return (
                        <button
                          onClick={() => handleVideoReaction("\u2764\uFE0F")}
                          className="flex items-center gap-1.5 text-sm transition-colors hover:text-pink-400"
                          style={{ color: liked ? "#D4007A" : "#8E8E93" }}
                        >
                          <svg className="w-5 h-5" fill={liked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={liked ? 0 : 1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                          </svg>
                          {count > 0 && <span>{count}</span>}
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Category tabs */}
          {!isLoading && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-none">
              <button
                onClick={() => setActiveSeries("all")}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeSeries === "all"
                    ? "bg-pnp-accent text-white"
                    : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
                }`}
              >
                {t.allSeries}
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setActiveSeries(cat.key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeSeries === cat.key
                      ? "bg-pnp-accent text-white"
                      : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          {/* Tag filters */}
          {!isLoading && AVAILABLE_TAGS.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
              {AVAILABLE_TAGS.map((tag) => (
                <button
                  key={tag.key}
                  onClick={() => toggleTag(tag.key)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    activeTags.includes(tag.key)
                      ? "text-white"
                      : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
                  }`}
                  style={activeTags.includes(tag.key) ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
                >
                  {tag.label}
                </button>
              ))}
              {activeTags.length > 0 && (
                <button
                  onClick={() => setActiveTags([])}
                  className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium text-pnp-textSecondary hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Video grid */}
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-video rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <Card className="text-center py-8">
              <p className="text-pnp-error mb-2">{error}</p>
              <p className="text-sm text-pnp-textSecondary">{t.loadingError}</p>
            </Card>
          ) : filteredVideos.length === 0 ? (
            <Card className="text-center py-12">
              <svg className="w-12 h-12 text-pnp-textSecondary mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p className="text-pnp-textSecondary font-medium">{t.noVideos}</p>
              <p className="text-xs text-pnp-textSecondary mt-1">{t.noVideosHint}</p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredVideos.map((video) => {
                const thumb = getAssetUrl(video.thumbnail);
                const vidSrc = videoUrl(video.video_file);
                const isActive = activeVideo?.id === video.id;

                return (
                  <button
                    key={video.id}
                    onClick={() => handleVideoClick(video)}
                    className={`text-left rounded-xl overflow-hidden bg-pnp-surface border transition-all ${
                      isActive
                        ? "border-pnp-accent ring-1 ring-pnp-accent/30"
                        : "border-pnp-border hover:border-pnp-accent/50"
                    }`}
                  >
                    <div className="relative aspect-video bg-pnp-bg group">
                      <AnimatedVideoThumbnail
                        videoUrl={isPrime ? vidSrc : null}
                        posterUrl={thumb}
                        alt={video.title}
                      />

                      {!isActive && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                          <PlayIcon />
                        </div>
                      )}

                      {!isPrime && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}>
                          <svg className="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "#D4007A" }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#FFB454" }}>PRIME</span>
                        </div>
                      )}

                      {isActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-pnp-accent/20">
                          <div className="bg-pnp-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            {t.playingBadge}
                          </div>
                        </div>
                      )}

                      {video.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                          {formatDuration(video.duration)}
                        </span>
                      )}

                      {video.is_featured && (
                        <span className="absolute top-1 left-1 bg-pnp-accent/90 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                          {CROWN} Featured
                        </span>
                      )}
                    </div>

                    <div className="p-2">
                      <p className="text-xs font-medium text-pnp-textPrimary truncate leading-snug">
                        {video.title}
                      </p>
                      {video.category && activeSeries === "all" && (
                        <p className="text-[10px] text-pnp-accent truncate mt-0.5">
                          {CATEGORIES.find(c => c.key === video.category)?.label || video.category}
                        </p>
                      )}
                      {video.artist && (
                        <p className="text-[10px] text-pnp-textSecondary truncate mt-0.5">
                          {video.artist}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          THE WALL — Santino's Feed
         ══════════════════════════════════════════════════════════════════════ */}
      {activeChannelId === null && activeSection === "feed" && (
        <div className="px-4 pb-6">
          {postsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="glass-card-sm p-4 animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-white/10 rounded w-1/3" />
                      <div className="h-3 bg-white/10 rounded w-full" />
                      <div className="h-3 bg-white/10 rounded w-2/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : feedError ? (
            <div className="glass-card-sm p-8 text-center">
              <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-white font-medium mb-1">Feed unavailable</p>
              <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{feedError}</p>
            </div>
          ) : displayPosts.length === 0 ? (
            <div className="glass-card-sm p-8 text-center">
              <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              <p className="text-white font-medium mb-1">No posts from Santino yet</p>
              <p className="text-sm" style={{ color: "#8E8E93" }}>Check back soon for new content</p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayPosts.map((post) => (
                <SocialPostCard
                  key={post.id}
                  post={post}
                  currentUserId={user?.dbId ? String(user.dbId) : ""}
                  isAdmin={false}
                  userLang={user?.language || "en"}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onWofToggle={handleWofToggle}
                  onNavigate={navigate}
                  contentDisclaimerAccepted={user?.contentDisclaimer || false}
                  onAcceptDisclaimer={handleAcceptDisclaimer}
                  viewerCity={user?.city}
                  viewerCountry={user?.country}
                  distanceKm={null}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          COMING UP — Live Schedule + Booking CTA
         ══════════════════════════════════════════════════════════════════════ */}
      {activeChannelId === null && activeSection === "schedule" && (
        <div className="px-4 pb-6 space-y-4">
          {/* Upcoming live events */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-pnp-textPrimary uppercase tracking-wider">Upcoming Streams</h3>
              {isAdmin && (
                <button
                  onClick={() => navigate("/live")}
                  className="text-xs font-medium transition-colors"
                  style={{ color: "#FFD700" }}
                >
                  + Schedule
                </button>
              )}
            </div>
            {eventsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : liveEvents.length === 0 ? (
              <div className="glass-card-sm p-6 text-center">
                <svg className="w-10 h-10 mx-auto mb-2" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-white font-medium text-sm mb-1">No upcoming streams scheduled</p>
                <p className="text-xs" style={{ color: "#8E8E93" }}>Follow Santino to get notified when he goes live</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {liveEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-pnp-border bg-pnp-surface p-3 flex items-center gap-3"
                  >
                    {/* Date badge */}
                    <div
                      className="flex-shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center"
                      style={{ background: "rgba(212,0,122,0.15)" }}
                    >
                      <span className="text-[10px] font-bold uppercase" style={{ color: "#D4007A" }}>
                        {new Date(ev.scheduledAt).toLocaleDateString("en", { month: "short" })}
                      </span>
                      <span className="text-lg font-bold text-white leading-none">
                        {new Date(ev.scheduledAt).getDate()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-pnp-textPrimary truncate">{ev.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                        {new Date(ev.scheduledAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {ev.durationMinutes}min
                        {" · "}
                        <span style={{ color: "#D4007A" }}>{formatCountdown(ev.scheduledAt)}</span>
                      </p>
                    </div>
                    {ev.status === "live" ? (
                      <button
                        onClick={() => navigate(`/live/${ev.creatorId}`)}
                        className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-500"
                      >
                        Watch
                      </button>
                    ) : (
                      <div className="flex-shrink-0 text-right">
                        <span className="text-xs font-semibold" style={{ color: ev.userRsvpd ? "#34D399" : "#8E8E93" }}>
                          {ev.userRsvpd ? "RSVP'd" : `${ev.rsvpCount} going`}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Book a Private Session */}
          <div>
            <h3 className="text-sm font-bold text-pnp-textPrimary uppercase tracking-wider mb-3">Book a Private Session</h3>
            <div
              className="rounded-2xl p-4 relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, rgba(94,209,196,0.08), rgba(212,0,122,0.08))", border: "1px solid rgba(94,209,196,0.2)" }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(94,209,196,0.15)" }}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "#5ED1C4" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white mb-1">1-on-1 with Santino</p>
                  <div className="flex gap-3 mb-3">
                    <span className="text-xs" style={{ color: "#8E8E93" }}>30min · $60</span>
                    <span className="text-xs" style={{ color: "#8E8E93" }}>60min · $100</span>
                    <span className="text-xs" style={{ color: "#8E8E93" }}>90min · $250</span>
                  </div>
                  <button
                    onClick={() => isAuthenticated ? navigate("/live") : login()}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-white active:scale-95 transition-all"
                    style={{ background: "linear-gradient(135deg, #5ED1C4, #D4007A)" }}
                  >
                    {isAuthenticated ? "Book Now" : "Sign In to Book"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Merch / Store link */}
          <div>
            <h3 className="text-sm font-bold text-pnp-textPrimary uppercase tracking-wider mb-3">Store</h3>
            <button
              onClick={() => navigate("/shop")}
              className="w-full rounded-xl border border-pnp-border bg-pnp-surface p-4 flex items-center gap-3 text-left hover:border-pnp-accent/40 transition-colors active:scale-[0.98]"
            >
              <div
                className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(230,145,56,0.15)" }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "#E69138" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-pnp-textPrimary">PNPtv! Merch</p>
                <p className="text-xs" style={{ color: "#8E8E93" }}>Exclusive gear & accessories</p>
              </div>
              <svg className="w-4 h-4 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "#8E8E93" }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DISCOVER — Invidious video search
         ══════════════════════════════════════════════════════════════════════ */}
      {activeChannelId === null && activeSection === "discover" && (
        <div className="px-4 pb-20">
          {/* Search bar */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDiscoverSearch()}
              placeholder="Search videos..."
              className="flex-1 px-4 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50"
            />
            <button
              onClick={handleDiscoverSearch}
              disabled={discoverLoading || !discoverQuery.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              Search
            </button>
          </div>

          <p className="text-xs text-white/40 mb-3">
            {discoverMode === "trending" ? "Trending" : `Results for "${discoverQuery}"`}
          </p>

          {discoverLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <Skeleton className="w-full aspect-video" />
                  <div className="p-2 space-y-1">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : discoverResults.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/40 text-sm">No videos found. Try a different search.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {discoverResults.filter(v => v.type === "video" || v.videoId).map((video) => {
                const thumb = video.videoThumbnails?.find(t => t.quality === "medium") || video.videoThumbnails?.[0];
                return (
                  <a
                    key={video.videoId}
                    href={`https://www.youtube.com/watch?v=${video.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl overflow-hidden transition-transform active:scale-[0.97]"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  >
                    <div className="relative aspect-video">
                      {thumb && (
                        <img src={thumb.url} alt={video.title} className="w-full h-full object-cover" loading="lazy" />
                      )}
                      {video.lengthSeconds > 0 && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/70 text-white">
                          {formatDuration(video.lengthSeconds)}
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium text-white line-clamp-2 leading-tight">{video.title}</p>
                      <p className="text-[10px] text-white/40 mt-1 truncate">{video.author}</p>
                      {video.viewCount > 0 && (
                        <p className="text-[10px] text-white/30">{(video.viewCount / 1000).toFixed(0)}K views</p>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Sticky bottom CTA (non-PRIME, vault view only) ── */}
      {!isPrime && !isLoading && videos.length > 0 && activeSection === "vault" && activeChannelId === null && (
        <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-2 pointer-events-none">
          <div
            className="max-w-2xl mx-auto rounded-2xl px-4 py-3 flex items-center justify-between gap-3 pointer-events-auto shadow-2xl"
            style={{ background: "linear-gradient(135deg, #1a0a12, #1a100a)", border: "1px solid rgba(212,0,122,0.4)" }}
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {t.videosLocked(videos.length)}
              </p>
              <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.5)" }}>
                {isMember ? t.upgradeToWatch : t.trialFromHint}
              </p>
            </div>
            <button
              onClick={() => navigate("/subscribe")}
              className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90 active:scale-95 whitespace-nowrap"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {isMember ? t.upgradeBannerCta : t.getPrimeCta}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
