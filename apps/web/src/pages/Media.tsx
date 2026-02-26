import React, { useState } from "react";
import { Card, Skeleton, Badge } from "@pnptv/ui-kit";
import { useDirectus } from "@/hooks/useDirectus";
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
      sort: ["-date_created"],
      limit: 50,
    },
  });

  const [activeVideo, setActiveVideo] = useState<Content | null>(null);

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-pnp-textPrimary">PRIME</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Exclusive video collection
          </p>
        </div>
        <Badge variant="accent">Videos</Badge>
      </div>

      {/* Active video player */}
      {activeVideo && (
        <div className="mb-6 rounded-xl overflow-hidden bg-black">
          <video
            src={activeVideo.media_url || ""}
            controls
            autoPlay
            playsInline
            className="w-full max-h-[50vh] object-contain"
          />
          <div className="p-3 bg-pnp-surface">
            <p className="font-medium text-pnp-textPrimary truncate">
              {activeVideo.title}
            </p>
            {performerName(activeVideo.performer) && (
              <p className="text-sm text-pnp-textSecondary truncate">
                {performerName(activeVideo.performer)}
              </p>
            )}
          </div>
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
          <p className="text-sm text-pnp-textSecondary">
            Video service is temporarily unavailable. Please try again later.
          </p>
        </Card>
      ) : videos.length === 0 ? (
        <Card className="text-center py-8">
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
          <p className="text-pnp-textSecondary">No videos yet</p>
          <p className="text-xs text-pnp-textSecondary mt-1">
            New content is added regularly. Check back soon!
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {videos.map((video) => {
            const thumb = getAssetUrl(video.thumbnail);
            const isActive = activeVideo?.id === video.id;

            return (
              <button
                key={video.id}
                onClick={() => setActiveVideo(video)}
                className={`text-left rounded-xl overflow-hidden bg-pnp-surface border transition-colors ${
                  isActive
                    ? "border-pnp-accent"
                    : "border-pnp-border hover:border-pnp-accent/50"
                }`}
              >
                <div className="relative aspect-video bg-pnp-bg">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={video.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
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
                  {video.duration_seconds && (
                    <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                      {formatDuration(video.duration_seconds)}
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-pnp-textPrimary truncate">
                    {video.title}
                  </p>
                  {performerName(video.performer) && (
                    <p className="text-[10px] text-pnp-textSecondary truncate">
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
