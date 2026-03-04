import React, { useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton, Badge } from "@pnptv/ui-kit";
import { useDirectus } from "@/hooks/useDirectus";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { type Content, type Performer, getAssetUrl } from "@/lib/directus";

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
  const { showTutorial, dismissTutorial } = useTutorial("prime");

  // Derive unique series from data
  const seriesList = useMemo(() => {
    const names = new Set<string>();
    videos.forEach((v) => { if (v.series) names.add(v.series); });
    return Array.from(names).sort();
  }, [videos]);

  // Filter videos by selected series
  const filteredVideos = useMemo(() => {
    if (activeSeries === "all") return videos;
    return videos.filter((v) => v.series === activeSeries);
  }, [videos, activeSeries]);

  const handleVideoClick = (video: Content) => {
    setActiveVideo((prev) => (prev?.id === video.id ? null : video));
  };

  return (
    <div className="page-container">
      <Helmet>
        <title>PRIME Videorama — PNPtv!</title>
        <meta name="description" content="Exclusive PRIME video collection. Watch premium content from top PNPtv creators." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="prime" onDismiss={dismissTutorial} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-pnp-textPrimary">PRIME</h1>
            <span className="text-pnp-accent">{CROWN}</span>
          </div>
          <p className="text-sm text-pnp-textSecondary mt-0.5">
            Exclusive video collection
          </p>
        </div>
        {!isLoading && videos.length > 0 && (
          <Badge variant="accent">{videos.length} videos</Badge>
        )}
      </div>

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
                    {activeVideo.episode_number ? ` · Ep ${activeVideo.episode_number}` : ""}
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
                aria-label="Close player"
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
          </div>
        </div>
      )}

      {/* Series tabs */}
      {!isLoading && seriesList.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none">
          <button
            onClick={() => setActiveSeries("all")}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeSeries === "all"
                ? "bg-pnp-accent text-white"
                : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
            }`}
          >
            All
          </button>
          {seriesList.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSeries(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                activeSeries === s
                  ? "bg-pnp-accent text-white"
                  : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
              }`}
            >
              {s}
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
            Video service is temporarily unavailable. Please try again later.
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
          <p className="text-pnp-textSecondary font-medium">No videos yet</p>
          <p className="text-xs text-pnp-textSecondary mt-1">
            New content is added regularly. Check back soon!
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
                {/* Thumbnail */}
                <div className="relative aspect-video bg-pnp-bg group">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={video.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pnp-surface to-pnp-bg">
                      <svg
                        className="w-8 h-8 text-pnp-textSecondary"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                  )}

                  {/* Play overlay */}
                  {!isActive && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                      <PlayIcon />
                    </div>
                  )}

                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-pnp-accent/20">
                      <div className="bg-pnp-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        PLAYING
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
                      Ep {video.episode_number}
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
                      {video.series}
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
    </div>
  );
}
