import React from "react";

interface MediaPreviewProps {
  file: File;
  previewUrl: string;
  uploadProgress: number | null;
  uploadError: string | null;
  onCancel: () => void;
}

export function MediaPreview({
  file,
  previewUrl,
  uploadProgress,
  uploadError,
  onCancel,
}: MediaPreviewProps) {
  const isVideo = file.type.startsWith("video/");
  const fileSizeMb = (file.size / 1_048_576).toFixed(1);

  return (
    <div className="mx-4 mb-2 rounded-xl border border-pnp-border bg-white/5 overflow-hidden animate-fade-in-up">
      <div className="flex items-start gap-3 p-3">
        {/* Thumbnail */}
        <div className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-black/30 flex items-center justify-center">
          {isVideo ? (
            <video
              src={previewUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={previewUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className="text-xs font-medium text-pnp-textPrimary truncate" title={file.name}>
            {file.name}
          </p>
          <p className="text-[10px] text-pnp-textSecondary">
            {isVideo ? "Video" : "Image"} &middot; {fileSizeMb} MB
          </p>

          {/* Progress bar */}
          {uploadProgress !== null && (
            <div className="mt-1">
              <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-pnp-accent transition-all duration-300"
                  style={{ width: `${Math.min(uploadProgress, 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-pnp-textSecondary mt-0.5">
                Uploading&hellip; {Math.round(uploadProgress)}%
              </p>
            </div>
          )}

          {/* Error state */}
          {uploadError && (
            <p className="text-[10px] text-pnp-error mt-0.5">{uploadError}</p>
          )}
        </div>

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
          aria-label="Remove attachment"
          disabled={uploadProgress !== null && uploadProgress > 0 && uploadProgress < 100}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
