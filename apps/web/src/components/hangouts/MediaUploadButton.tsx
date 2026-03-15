import React, { useRef } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime", "video/3gpp"];
const MAX_IMAGE_BYTES = 10 * 1_048_576;  // 10 MB
const MAX_VIDEO_BYTES = 50 * 1_048_576;  // 50 MB

interface MediaUploadButtonProps {
  onFileSelect: (file: File, previewUrl: string) => void;
  onError: (error: string) => void;
  disabled: boolean;
}

export function MediaUploadButton({
  onFileSelect,
  onError,
  disabled,
}: MediaUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-selected after a cancel
    e.target.value = "";

    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!ACCEPTED_TYPES.includes(file.type)) {
      onError("Unsupported file type. Please select a JPEG, PNG, GIF, WebP, MP4, WebM, MOV, or 3GP file.");
      return;
    }

    if (isImage && file.size > MAX_IMAGE_BYTES) {
      onError("Images must be under 10 MB.");
      return;
    }

    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      onError("Videos must be under 50 MB.");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    onFileSelect(file, previewUrl);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/3gpp"
        className="hidden"
        onChange={handleChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-90 transition-all disabled:opacity-40 disabled:pointer-events-none text-pnp-textSecondary hover:text-pnp-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent"
        aria-label="Attach image or video"
        title="Attach image or video"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
          />
        </svg>
      </button>
    </>
  );
}
