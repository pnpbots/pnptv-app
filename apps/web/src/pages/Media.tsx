import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { Card, Skeleton, Badge } from "@pnptv/ui-kit";
import { useDirectus } from "@/hooks/useDirectus";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useTier } from "@/hooks/useTier";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { type Content, type Performer, getAssetUrl } from "@/lib/directus";
import { AnimatedVideoThumbnail } from "@/components/AnimatedVideoThumbnail";
import EmojiReactionBar from "@/components/EmojiReactionBar";
import { type ContentReaction, getContentReactions, toggleContentReaction } from "@/lib/api";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function performerName(performer: Content["performer"]): string {
  if (!performer || typeof performer === "number") return "";
  return (performer as Performer).name || "";
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

export default function Media() {
  const { isPrime, isMember } = useTier();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { media: t } = useI18n();

  const { data: videos, isLoading, error } = useDirectus<Content>({
    collection: "content",
    params: {
      filter: {
        status: { _eq: "published" },
        type: { _eq: "video" },
        is_premium: { _eq: true },
      },
      fields: ["*", "performer.name", "performer.photo"],
      sort: ["series", "episode_number", "-date_created"],
      limit: 100,
    },
  });

  const [activeVideo, setActiveVideo] = useState<Content | null>(null);
  const [activeSeries, setActiveSeries] = useState<string>("all");
  const [videoReactions, setVideoReactions] = useState<ContentReaction[]>([]);
  const [reactionsLoading, setReactionsLoading] = useState(false);
  const { showTutorial, dismissTutorial } = useTutorial("prime");

  // Fixed categories
  const CATEGORIES = [
    { key: "Clouding", label: t.categoryClouding },
    { key: "Slamming", label: t.categorySlamming },
    { key: "Live Show", label: t.categoryLiveShow },
  ];

  // Filter videos by selected category (matches series field)
  const filteredVideos = useMemo(() => {
    if (activeSeries === "all") return videos;
    return videos.filter((v) => v.series === activeSeries);
  }, [videos, activeSeries]);

  const handleVideoClick = (video: Content) => {
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
      // silent — optimistic updates are not needed here; stale reactions are harmless
    }
  }, [activeVideo?.id, isAuthenticated]);

  return (
    <div className="page-container">
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="prime" onDismiss={dismissTutorial} />}

      {/* ── Upsell Hero (non-PRIME users) ── */}
      {!isPrime && (
        <div
          className="rounded-2xl p-5 mb-6 relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.18) 0%, rgba(230,145,56,0.14) 100%)", border: "1px solid rgba(212,0,122,0.35)" }}
        >
          {/* Decorative glow */}
          <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full opacity-20 pointer-events-none" style={{ background: "radial-gradient(circle, #D4007A, transparent)" }} />

          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
              PRIME
            </span>
            {CROWN}
            {isMember && (
              <span className="text-xs font-semibold" style={{ color: "#FFB454" }}>{t.memberBadge}</span>
            )}
          </div>

          <h2 className="text-xl font-bold text-white mb-1">
            {isMember ? t.upgradeTitle : t.unlockTitle}
          </h2>
          <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.7)" }}>
            {isMember
              ? t.upgradeSubtitle
              : t.unlockSubtitle(videos.length)}
          </p>

          <ul className="space-y-1.5 mb-5">
            {[
              t.benefitLibrary,
              t.benefitHd,
              t.benefitLive,
              t.benefitCommunity,
              isMember ? t.benefitMemberBonus : t.benefitCancel,
            ].map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" style={{ color: "#34D399" }}>
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {benefit}
              </li>
            ))}
          </ul>

          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <button
              onClick={() => navigate("/subscribe")}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {isMember ? t.upgradeCta : t.trialCta}
            </button>
            {!isMember && (
              <p className="text-xs self-center" style={{ color: "rgba(255,255,255,0.5)" }}>
                {t.pricingHint}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-pnp-textPrimary">{t.headerTitle}</h1>
            <span className="text-pnp-accent">{CROWN}</span>
          </div>
          <p className="text-sm text-pnp-textSecondary mt-0.5">
            {t.headerSubtitle}
          </p>
        </div>
        {!isLoading && videos.length > 0 && (
          <Badge variant="accent">{t.videosCount(videos.length)}</Badge>
        )}
      </div>

      {/* Telegram PRIME channel banner */}
      {isPrime && (
        <a
          href="https://t.me/+GDD0AAVbvGM3MGEx"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl p-3.5 mb-5 transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, rgba(0,136,204,0.15), rgba(212,0,122,0.10))", border: "1px solid rgba(0,136,204,0.3)" }}
        >
          <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="#0088CC">
            <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm5.09 7.307l-1.972 9.297c-.146.658-.537.818-1.084.508l-3-2.211-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.334-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.835.926z" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Watch PRIME videos on Telegram</p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>
              Use this link while we finish migrating all content to the webapp
            </p>
          </div>
          <svg className="w-4 h-4 flex-shrink-0 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>
      )}

      {/* Active video player */}
      {activeVideo && (
        <div className="mb-5 rounded-2xl overflow-hidden bg-black border border-pnp-accent/30 shadow-lg">
          <video
            key={activeVideo.id}
            src={activeVideo.media_url || ""}
            controls
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
                {activeVideo.series && (
                  <p className="text-xs text-pnp-accent mt-0.5">
                    {activeVideo.series}
                    {activeVideo.episode_number ? ` · ${t.episodePrefix} ${activeVideo.episode_number}` : ""}
                  </p>
                )}
                {performerName(activeVideo.performer) && (
                  <p className="text-sm text-pnp-textSecondary mt-0.5 truncate">
                    {performerName(activeVideo.performer)}
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

            {/* Reactions */}
            <div className="mt-3 pt-3 border-t border-pnp-border">
              {reactionsLoading ? (
                <div className="h-7 w-32 rounded-full bg-pnp-surface animate-pulse" />
              ) : (
                <EmojiReactionBar
                  reactions={videoReactions}
                  onToggle={handleVideoReaction}
                  currentUserId={user?.dbId}
                  size="sm"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category tabs */}
      {!isLoading && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
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

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="text-center py-8">
          <p className="text-pnp-error mb-2">{error}</p>
          <p className="text-sm text-pnp-textSecondary">
            {t.loadingError}
          </p>
        </Card>
      ) : filteredVideos.length === 0 ? (
        <Card className="text-center py-12">
          <svg
            className="w-12 h-12 text-pnp-textSecondary mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <p className="text-pnp-textSecondary font-medium">{t.noVideos}</p>
          <p className="text-xs text-pnp-textSecondary mt-1">
            {t.noVideosHint}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filteredVideos.map((video) => {
            const thumb = getAssetUrl(video.thumbnail);
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
                {/* Thumbnail — cycles through random video frames */}
                <div className="relative aspect-video bg-pnp-bg group">
                  <AnimatedVideoThumbnail
                    videoUrl={isPrime ? (video.media_url || null) : null}
                    posterUrl={thumb}
                    alt={video.title}
                  />

                  {/* Play overlay */}
                  {!isActive && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                      <PlayIcon />
                    </div>
                  )}

                  {/* Lock overlay for non-PRIME */}
                  {!isPrime && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}>
                      <svg className="w-6 h-6 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "#D4007A" }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                      <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#FFB454" }}>PRIME</span>
                    </div>
                  )}

                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-pnp-accent/20">
                      <div className="bg-pnp-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {t.playingBadge}
                      </div>
                    </div>
                  )}

                  {/* Duration badge */}
                  {video.duration_seconds && (
                    <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                      {formatDuration(video.duration_seconds)}
                    </span>
                  )}

                  {/* Episode number */}
                  {video.episode_number && (
                    <span className="absolute top-1 left-1 bg-pnp-accent/90 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">
                      {t.episodePrefix} {video.episode_number}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-2">
                  <p className="text-xs font-medium text-pnp-textPrimary truncate leading-snug">
                    {video.title}
                  </p>
                  {video.series && activeSeries === "all" && (
                    <p className="text-[10px] text-pnp-accent truncate mt-0.5">
                      {CATEGORIES.find(c => c.key === video.series)?.label || video.series}
                    </p>
                  )}
                  {performerName(video.performer) && (
                    <p className="text-[10px] text-pnp-textSecondary truncate mt-0.5">
                      {performerName(video.performer)}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Sticky bottom CTA (non-PRIME) ── */}
      {!isPrime && !isLoading && videos.length > 0 && (
        <div
          className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-2 pointer-events-none"
        >
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
