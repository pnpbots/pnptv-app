import React, { useState, useEffect, useRef } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MediaPreviewProps {
  /** The selected file */
  file: File;
  /** Object URL for previewing the file */
  previewUrl: string;
  /** Upload progress: null = not uploading, 0-100 = in progress */
  uploadProgress: number | null;
  /** Error message from upload attempt */
  uploadError: string | null;
  /** Called when user cancels the selected media */
  onCancel: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MediaPreview({
  file,
  previewUrl,
  uploadProgress,
  uploadError,
  onCancel,
}: MediaPreviewProps) {
  const isVid = isVideoFile(file);
  const [videoDuration, setVideoDuration] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Extract video duration on mount
  useEffect(() => {
    if (isVid && videoRef.current) {
      const el = videoRef.current;
      const handleLoaded = () => {
        if (el.duration && isFinite(el.duration)) {
          const mins = Math.floor(el.duration / 60);
          const secs = Math.floor(el.duration % 60);
          setVideoDuration(`${mins}:${secs.toString().padStart(2, "0")}`);
        }
      };
      el.addEventListener("loadedmetadata", handleLoaded);
      return () => el.removeEventListener("loadedmetadata", handleLoaded);
    }
  }, [isVid]);

  const isUploading = uploadProgress !== null;

  return (
    <div
      className="mx-4 mb-2 glass-card-sm p-2.5 flex items-start gap-3 animate-fade-in-up"
      role="status"
      aria-label={isUploading ? "Uploading media" : "Media selected for sending"}
    >
      {/* Thumbnail */}
      <div className="relative flex-shrink-0">
        {isVid ? (
          <video
            ref={videoRef}
            src={previewUrl}
            className="w-16 h-16 rounded-lg object-cover bg-pnp-surface"
            muted
            playsInline
            preload="metadata"
            aria-label="Video preview thumbnail"
          />
        ) : (
          <img
            src={previewUrl}
            alt="Upload preview"
            className="w-16 h-16 rounded-lg object-cover bg-pnp-surface"
          />
        )}

        {/* Type badge */}
        <div className="absolute bottom-1 left-1 flex items-center gap-0.5">
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/70"
            style={{ color: isVid ? "#E69138" : "#D4007A" }}
          >
            {isVid ? "VID" : "IMG"}
          </span>
          {videoDuration && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-black/70 text-white/80">
              {videoDuration}
            </span>
          )}
        </div>

        {/* Upload overlay */}
        {isUploading && (
          <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center">
            <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-pnp-textPrimary truncate">{file.name}</p>
        <p className="text-[10px] text-pnp-textSecondary mt-0.5">
          {formatFileSize(file.size)}
        </p>

        {uploadError ? (
          <p className="text-[10px] text-pnp-error mt-1.5 flex items-center gap-1">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {uploadError}
          </p>
        ) : isUploading ? (
          <div className="mt-2">
            {/* Progress bar */}
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${Math.max(uploadProgress, 5)}%`,
                  background: "linear-gradient(90deg, #D4007A, #E69138)",
                }}
              />
            </div>
            <p className="text-[10px] text-pnp-textSecondary mt-1">
              Uploading...
            </p>
          </div>
        ) : (
          <p className="text-[10px] text-pnp-textSecondary mt-1">
            Press send to share
          </p>
        )}
      </div>

      {/* Cancel button (only when not uploading) */}
      {!isUploading && (
        <button
          onClick={onCancel}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Remove selected media"
        >
          <svg className="w-4 h-4 text-pnp-textSecondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
