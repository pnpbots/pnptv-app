import React, { useState } from "react";

interface MediaMessageProps {
  mediaUrl: string;
  mediaType: "image" | "video";
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  onExpandImage: (url: string) => void;
  isMe: boolean;
}

export function MediaMessage({
  mediaUrl,
  mediaType,
  thumbUrl,
  width,
  height,
  onExpandImage,
  isMe,
}: MediaMessageProps) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  // Compute a max-width/aspect-ratio hint so images don't reflow.
  // Capped at 240 px wide to fit in the bubble max-w-[75%] constraint.
  const aspectStyle: React.CSSProperties =
    width && height
      ? { aspectRatio: `${width} / ${height}`, maxWidth: Math.min(width, 240) }
      : { maxWidth: 240 };

  if (mediaType === "image") {
    const src = thumbUrl || mediaUrl;

    if (imgError) {
      return (
        <div
          className="flex items-center justify-center rounded-xl bg-white/5 text-xs text-pnp-textSecondary px-3 py-2"
          style={{ maxWidth: 240 }}
        >
          <svg
            className="w-4 h-4 mr-1.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M3.75 3h16.5A.75.75 0 0121 3.75v16.5a.75.75 0 01-.75.75H3.75A.75.75 0 013 20.25V3.75A.75.75 0 013.75 3z"
            />
          </svg>
          Image unavailable
        </div>
      );
    }

    return (
      <button
        onClick={() => onExpandImage(mediaUrl)}
        className={`block rounded-xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent ${
          isMe ? "self-end" : "self-start"
        }`}
        style={aspectStyle}
        aria-label="View full image"
      >
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover rounded-xl"
          style={aspectStyle}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </button>
    );
  }

  // Video
  if (videoError) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-white/5 text-xs text-pnp-textSecondary px-3 py-2"
        style={{ maxWidth: 240 }}
      >
        <svg
          className="w-4 h-4 mr-1.5 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-1.409c.407-.407.659-.97.659-1.591v-9a2.25 2.25 0 00-2.25-2.25h-9c-.621 0-1.184.252-1.591.659"
          />
        </svg>
        Video unavailable
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl overflow-hidden bg-black ${isMe ? "self-end" : "self-start"}`}
      style={aspectStyle}
    >
      <video
        src={mediaUrl}
        poster={thumbUrl || undefined}
        controls
        playsInline
        preload="metadata"
        className="w-full h-full object-contain rounded-xl"
        style={aspectStyle}
        onError={() => setVideoError(true)}
      />
    </div>
  );
}
