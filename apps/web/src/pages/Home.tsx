import React, { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier, useLatam } from "@/hooks/useTier";
import { useTutorial, applyTargetedTutorialReset } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { updateProfile, getHangoutGroups, getSocialFeedPosts, type HangoutGroup, type SocialPostItem } from "@/lib/api";
import { SocialFeedTabs } from "@/components/social";
import { UpcomingEvents } from "@/components/events/UpcomingEvents";
import { NearbyWidget } from "@/components/NearbyWidget";
import { useI18n } from "@/lib/i18n";
import { MainStageLiveBanner } from "@/components/mainstage/MainStageLiveBanner";

const ChatEmbedded = lazy(() => import("@/pages/Chat"));

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const t = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { tier, isPrime, isMember, isAdmin } = useTier();
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("home");

  const benefitsByTier: Record<string, readonly string[]> = {
    free: t.home.benefitsFree,
    member: t.home.benefitsMember,
    prime: t.home.benefitsPrime,
  };

  // One-shot reset of the hangouts/mainstage/dm tutorials so existing users
  // re-encounter the upgraded flows when they next visit those features.
  // Gated by a localStorage flag so it only happens once per browser.
  useEffect(() => {
    applyTargetedTutorialReset("upgrade_2026_04_29", ["hangouts", "mainstage", "dm"]);
  }, []);

  const [contentDisclaimer, setContentDisclaimer] = useState(user?.contentDisclaimer || false);
  const [myHangouts, setMyHangouts] = useState<HangoutGroup[]>([]);
  const [previewPosts, setPreviewPosts] = useState<SocialPostItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const username = user?.username || user?.displayName || "user";
  const tierLabel = isPrime ? t.home.tierLabelPrime : isMember ? t.home.tierLabelMember : t.home.tierLabelFree;
  const benefits = benefitsByTier[tier] || benefitsByTier["free"];

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
        <title>{t.home.pageTitle}</title>
        <meta name="description" content={t.home.metaDescription} />
      </Helmet>
      {showTutorial && viewMode === "feed" && <TutorialOverlay section="home" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

      {/* Main Stage live banner — only when broadcasting, hidden on /main-stage itself */}
      {isAuthenticated && <MainStageLiveBanner />}

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
                <h2 className="text-2xl font-bold text-pnp-textPrimary">{t.home.hubTitle}</h2>
                <p className="text-sm mt-1 text-pnp-textSecondary">{t.home.hubSubtitle}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-pnp-textSecondary">@{username}</span>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={
                      isPrime
                        ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
                        : isMember
                          ? { background: "rgba(59,130,246,0.15)", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.3)" }
                          : { background: "rgba(255,255,255,0.06)", color: "var(--pnp-text-secondary)", border: "1px solid rgba(255,255,255,0.1)" }
                    }
                  >
                    {tierLabel}
                  </span>
                </div>
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--pnp-text-secondary)" }}>{t.home.benefitsHeading.replace("{tier}", tierLabel)}</p>
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
                  {isMember ? t.home.upgradeToPrime : t.home.upgradeToMember} &rarr;
                </button>
              )}
            </div>

            {/* Latest Posts Preview */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">{t.home.latestPosts}</h3>
                <button
                  onClick={() => handleSetView("feed")}
                  className="text-xs font-semibold transition-opacity hover:opacity-80"
                  style={{ color: "#D4007A" }}
                >
                  {t.home.viewAll}
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
                  <p className="text-xs" style={{ color: "var(--pnp-text-secondary)" }}>{t.home.noPostsYet}</p>
                </div>
              )}
            </div>
          </div>

          {/* Upcoming Events */}
          <UpcomingEvents
            limit={5}
            title={t.home.upcomingEvents}
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

        {/* Try-the-new-features cards. Each highlights a recently upgraded
            feature and dives the user straight into it. The "NEW" pill on
            each card hooks the eye; the brief subtitle calls out what's
            actually new in the upgrade. */}
        <div className="grid grid-cols-3 gap-3">
          {/* Hangouts */}
          <button
            onClick={() => navigate("/hangouts")}
            className="group rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
            style={{
              background: "linear-gradient(135deg, rgba(167,139,250,0.12), rgba(139,92,246,0.06))",
              border: "1px solid rgba(167,139,250,0.25)",
            }}
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(167,139,250,0.2)" }}
              >
                <svg className="w-5 h-5" style={{ color: "#A78BFA" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "rgba(167,139,250,0.25)", color: "#A78BFA" }}>{t.home.newBadge}</span>
            </div>
            <h3 className="text-sm font-bold text-white mb-0.5">{t.home.featureHangouts}</h3>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--pnp-text-secondary)" }}>
              {t.home.featureHangoutsDesc}
            </p>
          </button>

          {/* Main Stage */}
          <button
            onClick={() => navigate("/main-stage")}
            className="group rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
            style={{
              background: "linear-gradient(135deg, rgba(212,0,122,0.12), rgba(230,145,56,0.06))",
              border: "1px solid rgba(212,0,122,0.25)",
            }}
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(212,0,122,0.2)" }}
              >
                <svg className="w-5 h-5" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m-17.25 0V5.625m0 12.75h17.25M3.375 5.625h17.25c.621 0 1.125.504 1.125 1.125v1.5M2.25 5.625v-.001M21.75 5.624V5.625m-7.5 13.875h-4.5m4.5 0h.008m-4.508 0h.008" />
                </svg>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "rgba(212,0,122,0.25)", color: "#D4007A" }}>{t.home.newBadge}</span>
            </div>
            <h3 className="text-sm font-bold text-white mb-0.5">{t.home.featureMainStage}</h3>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--pnp-text-secondary)" }}>
              {t.home.featureMainStageDesc}
            </p>
          </button>

          {/* DM Video Calls */}
          <button
            onClick={() => navigate("/dm")}
            className="group rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
            style={{
              background: "linear-gradient(135deg, rgba(34,197,94,0.1), rgba(16,185,129,0.06))",
              border: "1px solid rgba(34,197,94,0.25)",
            }}
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(34,197,94,0.2)" }}
              >
                <svg className="w-5 h-5" style={{ color: "#22C55E" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.25)", color: "#22C55E" }}>{t.home.newBadge}</span>
            </div>
            <h3 className="text-sm font-bold text-white mb-0.5">{t.home.featureDmCalls}</h3>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--pnp-text-secondary)" }}>
              {isPrime ? t.home.featureDmCallsPrime : t.home.featureDmCallsLocked}
            </p>
          </button>
        </div>
      </div>


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
