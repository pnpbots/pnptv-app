import React, { useState, memo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MediaMessageProps {
  /** Full URL to the media file */
  mediaUrl: string;
  /** Type of media: "image" or "video" */
  mediaType: "image" | "video";
  /** Thumbnail URL (used for image display in bubble, full opens in lightbox) */
  thumbUrl?: string | null;
  /** Intrinsic width of the media (for aspect ratio) */
  width?: number | null;
  /** Intrinsic height of the media (for aspect ratio) */
  height?: number | null;
  /** Called when user clicks an image to expand it in lightbox */
  onExpandImage: (src: string) => void;
  /** Whether this message is from the current user */
  isMe?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const MediaMessage = memo(function MediaMessage({
  mediaUrl,
  mediaType,
  thumbUrl,
  width,
  height,
  onExpandImage,
  isMe = false,
}: MediaMessageProps) {
  const [imgError, setImgError] = useState(false);
  const [vidError, setVidError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Compute aspect ratio for placeholder sizing
  const aspectRatio =
    width && height && width > 0 && height > 0
      ? Math.min(width / height, 2.5) // Cap at 2.5:1 for very wide images
      : undefined;

  // Show thumbnail in bubble, open full image in lightbox
  const displayUrl = mediaType === "image" && thumbUrl ? thumbUrl : mediaUrl;

  // ─── Image rendering ───────────────────────────────────────────────────

  if (mediaType === "image") {
    if (imgError) {
      return (
        <div className="mt-2 flex items-center gap-2 text-xs text-pnp-error">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>Image failed to load</span>
        </div>
      );
    }

    return (
      <button
        onClick={() => onExpandImage(mediaUrl)}
        className="mt-2 block max-w-[240px] sm:max-w-[300px] rounded-xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background group"
        aria-label="View full image"
      >
        <div className="relative">
          {/* Skeleton placeholder while loading */}
          {!imgLoaded && (
            <div
              className="animate-pulse bg-pnp-surface rounded-xl"
              style={{
                aspectRatio: aspectRatio ? `${aspectRatio}` : undefined,
                minHeight: aspectRatio ? undefined : "8rem",
                width: "100%",
              }}
            />
          )}
          <img
            src={displayUrl}
            alt="Shared image"
            loading="lazy"
            className={`max-h-60 rounded-xl object-cover w-full group-hover:opacity-90 group-active:opacity-75 transition-opacity ${
              imgLoaded ? "" : "absolute inset-0"
            }`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            style={{ display: imgLoaded ? undefined : "none" }}
          />

          {/* Expand indicator */}
          <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </div>
        </div>
      </button>
    );
  }

  // ─── Video rendering ──────────────────────────────────────────────────

  if (vidError) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-pnp-error">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span>Video failed to load</span>
      </div>
    );
  }

  return (
    <div className="mt-2 max-w-[240px] sm:max-w-[300px] rounded-xl overflow-hidden bg-pnp-surface">
      <video
        src={mediaUrl}
        controls
        preload="metadata"
        playsInline
        className="w-full max-h-60 object-cover"
        onError={() => setVidError(true)}
        aria-label="Shared video"
      />
    </div>
  );
});
