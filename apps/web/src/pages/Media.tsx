import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Card, Skeleton, Badge } from "@pnptv/ui-kit";
import { useDirectus } from "@/hooks/useDirectus";
import { useTutorial } from "@/hooks/useTutorial";
import { useAuth } from "@/hooks/useAuth";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { type Content, type Performer, getAssetUrl } from "@/lib/directus";
import {
  getCanvaLoginUrl,
  getCanvaStatus,
  unlinkCanva,
  listCanvaDesigns,
  startCanvaExport,
  listCanvaExports,
  type CanvaDesign,
  type CanvaExportJob,
} from "@/lib/api";

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

// ---------------------------------------------------------------------------
// Status badge colors
// ---------------------------------------------------------------------------
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  exporting: "bg-blue-500/20 text-blue-400",
  downloading: "bg-blue-500/20 text-blue-400",
  uploading: "bg-purple-500/20 text-purple-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
};

// ---------------------------------------------------------------------------
// Canva Creator Toolbar (only visible to performers/admins)
// ---------------------------------------------------------------------------
function CanvaToolbar() {
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [canvaDisplayName, setCanvaDisplayName] = useState<string>();
  const [designs, setDesigns] = useState<CanvaDesign[]>([]);
  const [exports, setExports] = useState<CanvaExportJob[]>([]);
  const [showDesigns, setShowDesigns] = useState(false);
  const [showExports, setShowExports] = useState(false);
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Check Canva connection on mount + handle ?canva_connected query param
  useEffect(() => {
    getCanvaStatus()
      .then((s) => {
        setCanvaConnected(s.connected);
        setCanvaDisplayName(s.displayName);
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  // Poll exports while any are active
  const refreshExports = useCallback(async () => {
    try {
      const res = await listCanvaExports();
      setExports(res.jobs);
      return res.jobs;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!canvaConnected) return;
    refreshExports();
  }, [canvaConnected, refreshExports]);

  // Auto-poll every 5s while jobs are active
  useEffect(() => {
    const hasActive = exports.some(
      (j) => !["completed", "failed"].includes(j.status)
    );
    if (hasActive) {
      pollRef.current = setInterval(refreshExports, 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [exports, refreshExports]);

  const handleLoadDesigns = async () => {
    setShowDesigns(true);
    setLoadingDesigns(true);
    try {
      const res = await listCanvaDesigns();
      setDesigns(res.designs);
    } catch {
      setDesigns([]);
    } finally {
      setLoadingDesigns(false);
    }
  };

  const handleExport = async (design: CanvaDesign) => {
    setExportingId(design.id);
    try {
      await startCanvaExport(design.id, design.title || "Untitled");
      await refreshExports();
      setShowDesigns(false);
      setShowExports(true);
    } catch {
      // silently fail
    } finally {
      setExportingId(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      await unlinkCanva();
      setCanvaConnected(false);
      setCanvaDisplayName(undefined);
      setDesigns([]);
      setExports([]);
    } catch {
      // silently fail
    }
  };

  if (statusLoading) return null;

  return (
    <div className="mb-5 p-3 rounded-xl bg-pnp-surface border border-pnp-border">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">
          Creator Tools
        </p>
        {canvaConnected && canvaDisplayName && (
          <span className="text-[10px] text-pnp-textSecondary">
            Canva: {canvaDisplayName}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!canvaConnected ? (
          <a
            href={getCanvaLoginUrl()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#7B2FBE] text-white hover:bg-[#6B21A8] transition-colors"
          >
            Connect Canva
          </a>
        ) : (
          <>
            <a
              href="https://www.canva.com/design/create/video"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#7B2FBE] text-white hover:bg-[#6B21A8] transition-colors"
            >
              Create in Canva
            </a>
            <button
              onClick={handleLoadDesigns}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 transition-colors"
            >
              Import from Canva
            </button>
            {exports.length > 0 && (
              <button
                onClick={() => setShowExports((p) => !p)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-pnp-bg border border-pnp-border text-pnp-textPrimary hover:border-pnp-accent/50 transition-colors"
              >
                Exports ({exports.filter((j) => !["completed", "failed"].includes(j.status)).length} active)
              </button>
            )}
            <button
              onClick={handleDisconnect}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-pnp-textSecondary hover:text-red-400 transition-colors"
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {/* Designs drawer */}
      {showDesigns && canvaConnected && (
        <div className="mt-3 border-t border-pnp-border pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-pnp-textPrimary">
              Your Canva Designs
            </p>
            <button
              onClick={() => setShowDesigns(false)}
              className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
            >
              Close
            </button>
          </div>
          {loadingDesigns ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="aspect-video rounded-lg" />
              ))}
            </div>
          ) : designs.length === 0 ? (
            <p className="text-xs text-pnp-textSecondary py-4 text-center">
              No designs found. Create a video in Canva first!
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {designs.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg bg-pnp-bg border border-pnp-border overflow-hidden"
                >
                  {d.thumbnail?.url ? (
                    <img
                      src={d.thumbnail.url}
                      alt={d.title}
                      className="w-full aspect-video object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-video bg-pnp-border flex items-center justify-center">
                      <svg className="w-6 h-6 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="p-1.5">
                    <p className="text-[10px] font-medium text-pnp-textPrimary truncate">
                      {d.title || "Untitled"}
                    </p>
                    <button
                      onClick={() => handleExport(d)}
                      disabled={exportingId === d.id}
                      className="mt-1 w-full px-2 py-1 rounded text-[10px] font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
                    >
                      {exportingId === d.id ? "Starting..." : "Import as PRIME Video"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Export status */}
      {showExports && exports.length > 0 && (
        <div className="mt-3 border-t border-pnp-border pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-pnp-textPrimary">
              Export Jobs
            </p>
            <button
              onClick={() => setShowExports(false)}
              className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
            >
              Close
            </button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {exports.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-2 p-2 rounded-lg bg-pnp-bg border border-pnp-border"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-pnp-textPrimary truncate">
                    {job.design_title || "Untitled"}
                  </p>
                  {job.status === "failed" && job.error_message && (
                    <p className="text-[10px] text-red-400 truncate mt-0.5">
                      {job.error_message}
                    </p>
                  )}
                </div>
                <span
                  className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    STATUS_STYLES[job.status] || "bg-gray-500/20 text-gray-400"
                  }`}
                >
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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

  const { user } = useAuth();
  const isCreator =
    !!user &&
    (user.role === "admin" ||
      user.role === "superadmin" ||
      user.role === "performer" ||
      user.role === "model");

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

      {/* Creator toolbar — Canva integration (performers/admins only) */}
      {isCreator && <CanvaToolbar />}

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
