import React, { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier, useLatam } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { updateProfile, getHangoutGroups, getSocialFeedPosts, type HangoutGroup, type SocialPostItem } from "@/lib/api";
import { SocialFeedTabs } from "@/components/social";
import { UpcomingEvents } from "@/components/events/UpcomingEvents";
import { NearbyWidget } from "@/components/NearbyWidget";

const ChatEmbedded = lazy(() => import("@/pages/Chat"));

const TIER_BENEFITS: Record<string, string[]> = {
  free: ["Browse the community", "View public posts"],
  member: [
    "Social feed & reactions",
    "DMs & messaging",
    "Hangouts video rooms",
    "PNP Live & Radio",
    "Nearby discovery",
  ],
  prime: [
    "Everything in Member +",
    "PRIME exclusive live shows",
    "PRIME-only VOD & posts",
    "Early access & priority",
    "Private video calls",
  ],
};

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { tier, isPrime, isMember, isAdmin } = useTier();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("home");

  const [contentDisclaimer, setContentDisclaimer] = useState(user?.contentDisclaimer || false);
  const [myHangouts, setMyHangouts] = useState<HangoutGroup[]>([]);
  const [previewPosts, setPreviewPosts] = useState<SocialPostItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const username = user?.username || user?.displayName || "user";
  const tierLabel = isPrime ? "PRIME" : isMember ? "Member" : "Free";
  const benefits = TIER_BENEFITS[tier] || TIER_BENEFITS["free"];

  // Fetch user's hangout groups for the channel strip
  useEffect(() => {
    if (!isAuthenticated) return;
    getHangoutGroups()
      .then((r) => { if (r.success) setMyHangouts(r.groups); })
      .catch(() => {});
  }, [isAuthenticated]);

  // Fetch preview posts for dashboard
  useEffect(() => {
    if (!isAuthenticated) return;
    setPreviewLoading(true);
    getSocialFeedPosts(undefined, 3)
      .then((r) => { if (r.success) setPreviewPosts(r.posts || []); })
      .catch(() => {})
      .finally(() => setPreviewLoading(false));
  }, [isAuthenticated]);

  const searchParams = new URLSearchParams(location.search);
  const rawView = searchParams.get("view");
  const viewMode = rawView === "hangouts" ? "hangouts" : rawView === "home" ? "home" : "feed";

  // Read optional hashtag filter from ?tag= query param (only applies in feed mode)
  const hashtagFilter = viewMode === "feed" ? (searchParams.get("tag") || undefined) : undefined;
  // Read optional hangout filter from ?hangout= query param
  const hangoutFilter = viewMode === "feed" ? (searchParams.get("hangout") || undefined) : undefined;

  const handleSetView = (mode: "home" | "feed" | "hangouts") => {
    const params = new URLSearchParams();
    params.set("view", mode);
    navigate(`/?${params.toString()}`, { replace: true });
  };

  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
    setContentDisclaimer(true);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Helmet>
        <title>Home — PNPtv!</title>
        <meta name="description" content="Your PNPtv home. Browse your feed, upcoming events, and community posts." />
      </Helmet>
      {showTutorial && viewMode === "feed" && <TutorialOverlay section="home" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

      {/* Dashboard: Welcome + Latest Posts + Events — only in home view */}
      {isAuthenticated && viewMode === "home" && (
        <div className="mb-6">
          {/* Welcome + Posts — side-by-side on desktop */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-4 mb-4">
            {/* Welcome Card */}
            <div
              className="rounded-2xl p-5 mb-4 lg:mb-0"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="mb-3">
                <h2 className="text-2xl font-bold text-pnp-textPrimary">PNP Hub</h2>
                <p className="text-sm mt-1 text-pnp-textSecondary">Your dashboard — everything at a glance</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-pnp-textSecondary">@{username}</span>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={
                      isPrime
                        ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
                        : isMember
                          ? { background: "rgba(59,130,246,0.15)", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.3)" }
                          : { background: "rgba(255,255,255,0.06)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.1)" }
                    }
                  >
                    {tierLabel}
                  </span>
                </div>
              </div>
              <p className="text-xs mb-2" style={{ color: "#8E8E93" }}>Your {tierLabel} benefits:</p>
              <ul className="space-y-1.5">
                {benefits.map((b) => (
                  <li key={b} className="text-xs text-white/70 flex items-center gap-1.5">
                    <span style={{ color: "#D4007A" }}>&#10003;</span> {b}
                  </li>
                ))}
              </ul>
              {!isPrime && (
                <button
                  onClick={() => navigate("/subscribe")}
                  className="mt-3 text-xs font-semibold transition-opacity hover:opacity-80"
                  style={{ color: "#D4007A" }}
                >
                  Upgrade to {isMember ? "PRIME" : "Member"} &rarr;
                </button>
              )}
            </div>

            {/* Latest Posts Preview */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Latest Posts</h3>
                <button
                  onClick={() => handleSetView("feed")}
                  className="text-xs font-semibold transition-opacity hover:opacity-80"
                  style={{ color: "#D4007A" }}
                >
                  View all
                </button>
              </div>
              {previewLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="rounded-xl p-4 animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />
                        <div className="h-3 w-24 rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
                      </div>
                      <div className="h-3 w-full rounded mb-1" style={{ background: "rgba(255,255,255,0.04)" }} />
                      <div className="h-3 w-2/3 rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
                    </div>
                  ))}
                </div>
              ) : previewPosts.length > 0 ? (
                <div className="space-y-3">
                  {previewPosts.map((post) => (
                    <button
                      key={post.id}
                      onClick={() => navigate(`/social/post/${post.id}`)}
                      className="w-full rounded-xl p-3 text-left transition-all hover:brightness-110"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
                          {post.author_id === "cristina-ai" ? (
                            <span className="w-7 h-7 flex items-center justify-center text-base bg-[#1a1a2e]">🧜‍♀️</span>
                          ) : post.author_photo ? (
                            <img src={post.author_photo} alt="" className="w-full h-full object-cover" />
                          ) : null}
                        </div>
                        <span className="text-xs font-semibold text-white truncate">
                          {post.author_first_name || post.author_username}
                        </span>
                      </div>
                      <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">{post.content}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <p className="text-xs" style={{ color: "#8E8E93" }}>No posts yet. Be the first to share!</p>
                </div>
              )}
            </div>
          </div>

          {/* Upcoming Events */}
          <UpcomingEvents
            limit={5}
            title="Upcoming Events"
            currentUserId={user?.dbId ? String(user.dbId) : ""}
            isAdmin={isAdmin}
          />
        </div>
      )}

      {/* Below sections only show in feed/hangouts mode (not home dashboard) */}
      {viewMode !== "home" && <>
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

      {/* Mobile: PRIME CTA — only in feed mode */}
      {viewMode === "feed" && (
        <div className="lg:hidden space-y-2 mb-4">
          {!isPrime && (
            <button onClick={() => navigate("/subscribe")} className="w-full group">
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
        </div>
      )}

      {/* Feed / Hangouts toggle removed — each section has its own page now */}

      {/* Hashtag pills removed — feed tabs (All / Following) are in SocialFeedTabs */}

      {/* View content */}
      {viewMode === "feed" ? (
        hangoutFilter ? (
          /* Hangout-scoped feed */
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
            showComposer={false}
            hangoutGroupId={parseInt(hangoutFilter, 10)}
          />
        ) : (
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
            showComposer={!hashtagFilter}
            hashtagFilter={hashtagFilter}
          />
        )
      ) : (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#D4007A", borderTopColor: "transparent" }} />
            </div>
          }
        >
          <ChatEmbedded embeddedMode />
        </Suspense>
      )}
      </>}
    </div>
  );
}
