import React, { useRef, useCallback } from "react";

// ─── Constants ──────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ─── Types ──────────────────────────────────────────────────────────────────

interface MediaUploadButtonProps {
  /** Called when a valid file is selected */
  onFileSelect: (file: File, previewUrl: string) => void;
  /** Called when file selection fails validation */
  onError: (message: string) => void;
  /** Disables the button (e.g., during upload) */
  disabled?: boolean;
  /** Optional class overrides */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MediaUploadButton({
  onFileSelect,
  onError,
  disabled = false,
  className,
}: MediaUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        onError("File too large. Maximum size is 50 MB.");
        return;
      }

      // Validate type
      const validTypes = ACCEPTED_TYPES.split(",");
      if (!validTypes.includes(file.type)) {
        onError("Unsupported file type. Use JPG, PNG, WebP, GIF, MP4, or WebM.");
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      onFileSelect(file, previewUrl);
    },
    [onFileSelect, onError]
  );

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={
          className ||
          "flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/5 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background"
        }
        aria-label="Attach photo or video"
      >
        {/* Paperclip / image icon */}
        <svg
          className="w-5 h-5 text-pnp-accent"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
          />
        </svg>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
}
