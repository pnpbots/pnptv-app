/**
 * PostComposer — shared post creation component for Social, Profile, and Home.
 *
 * Features:
 *  - Multi-file selection: up to 4 images OR 1 video
 *  - Drag-and-drop zone (disabled in compact mode)
 *  - Media preview grid with per-file remove buttons
 *  - XHR upload with progress bar
 *  - Client-side file validation (type, size, count)
 *  - Auto-resizing textarea with character counter
 *  - Exclusive content and allow-sharing toggles (active creators only)
 *  - Compact mode: renders a minimal prompt that expands on focus
 *  - Full bilingual support via useI18n()
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { checkAuthStatus, getXStatus, sharePostToX, type SocialPostItem } from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";
const MAX_IMAGES = 4;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_CHARS = 5000;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

function isImageType(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type);
}

function isVideoType(file: File): boolean {
  return ACCEPTED_VIDEO_TYPES.includes(file.type);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SelectedFile {
  /** Stable identity key */
  id: string;
  file: File;
  /** Object URL — revoked on removal / unmount */
  previewUrl: string;
}

export interface PostComposerProps {
  /** Called with the new post after a successful submission. */
  onPostCreated?: (post: SocialPostItem) => void;
  /**
   * Compact mode renders a minimal prompt that expands into the full composer
   * when the user clicks or focuses the text area. Drag-and-drop is disabled.
   */
  compact?: boolean;
  placeholder?: string;
  className?: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface AvatarProps {
  photoUrl?: string;
  displayName: string;
}

function ComposerAvatar({ photoUrl, displayName }: AvatarProps) {
  if (isValidPhotoUrl(photoUrl)) {
    return (
      <img
        src={photoUrl}
        alt={`${displayName}'s avatar`}
        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
        onError={(e) => {
          // Swap to initial-letter fallback on broken URLs
          const img = e.currentTarget;
          img.style.display = "none";
          const sibling = img.nextElementSibling as HTMLElement | null;
          if (sibling) sibling.style.display = "flex";
        }}
      />
    );
  }
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
      aria-hidden="true"
    >
      {(displayName || "U")[0].toUpperCase()}
    </div>
  );
}

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  activeColor: string;
  label: string;
  icon: React.ReactNode;
}

function ToggleSwitch({ id, checked, onChange, disabled, activeColor, label, icon }: ToggleSwitchProps) {
  return (
    <div
      className="flex items-center justify-between rounded-lg px-3 py-2.5"
      style={{
        background: checked ? `${activeColor}0F` : "rgba(255,255,255,0.03)",
        border: `1px solid ${checked ? `${activeColor}33` : "rgba(255,255,255,0.1)"}`,
      }}
    >
      <label
        htmlFor={id}
        className="flex items-center gap-2 cursor-pointer select-none flex-1 min-w-0"
      >
        <span className="w-4 h-4 flex-shrink-0" style={{ color: checked ? activeColor : "#8E8E93" }}>
          {icon}
        </span>
        <span className="text-xs font-medium truncate" style={{ color: checked ? activeColor : "#8E8E93" }}>
          {label}
        </span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 ml-2"
        style={{ background: checked ? activeColor : "rgba(255,255,255,0.15)" }}
      >
        <span
          className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

interface MediaPreviewGridProps {
  files: SelectedFile[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

function MediaPreviewGrid({ files, onRemove, disabled }: MediaPreviewGridProps) {
  if (files.length === 0) return null;

  const gridClass =
    files.length === 1
      ? "grid grid-cols-1"
      : "grid grid-cols-2";

  return (
    <div className={`${gridClass} gap-1.5 mb-3 rounded-xl overflow-hidden`}>
      {files.map((f, index) => {
        const isVideo = isVideoType(f.file);
        // For 3-file layouts the last cell is alone in its row — give it col-span-2
        const isLastOdd = files.length === 3 && index === 2;

        return (
          <div
            key={f.id}
            className={`relative bg-black/40 overflow-hidden${isLastOdd ? " col-span-2" : ""}`}
            style={{ aspectRatio: files.length === 1 ? "16/9" : "1/1" }}
          >
            {isVideo ? (
              <video
                src={f.previewUrl}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={f.previewUrl}
                alt={`Preview ${index + 1}`}
                className="w-full h-full object-cover"
              />
            )}

            {/* Video play overlay */}
            {isVideo && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            )}

            {/* Remove button */}
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center text-white transition-opacity hover:opacity-90 active:scale-90 focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: "rgba(0,0,0,0.65)" }}
                aria-label={`Remove ${isVideo ? "video" : "image"} ${index + 1}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PostComposer({
  onPostCreated,
  compact = false,
  placeholder,
  className = "",
}: PostComposerProps) {
  const { user, isAuthenticated } = useAuth();
  const { feed: tFeed, profile: tProfile } = useI18n();

  // ── Unique IDs for ARIA ────────────────────────────────────────────────────
  const baseId = useId();
  const textareaId = `${baseId}-textarea`;
  const exclusiveId = `${baseId}-exclusive`;
  const shareableId = `${baseId}-shareable`;
  const dropzoneId = `${baseId}-dropzone`;

  // ── State ──────────────────────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [isActiveCreator, setIsActiveCreator] = useState(false);
  const [isExclusive, setIsExclusive] = useState(false);
  const [isShareable, setIsShareable] = useState(true);
  const [xHasWriteScope, setXHasWriteScope] = useState(false);
  const [crossPostX, setCrossPostX] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");

  // ── Refs ───────────────────────────────────────────────────────────────────
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0); // tracks nested drag-enter/leave pairs

  // ── Creator status + X write-scope check ──────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    checkAuthStatus()
      .then((status) => {
        if (status.authenticated && status.user) {
          setIsActiveCreator(
            status.user.creator_status === "active" ||
              status.user.role === "model" ||
              status.user.role === "admin" ||
              status.user.role === "superadmin"
          );
        }
      })
      .catch(() => {
        // Non-critical
      });
    getXStatus()
      .then((res) => {
        setXHasWriteScope(res.status.linked && res.status.hasWriteScope);
      })
      .catch(() => {
        setXHasWriteScope(false);
      });
  }, [isAuthenticated]);

  // ── Textarea auto-resize ───────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // ── Cleanup object URLs on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
    // We only want this to run on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── File validation ────────────────────────────────────────────────────────
  const validateAndAddFiles = useCallback(
    (incoming: File[]) => {
      setError(null);

      if (incoming.length === 0) return;

      const firstFile = incoming[0];
      const firstIsVideo = isVideoType(firstFile);
      const firstIsImage = isImageType(firstFile);

      if (!firstIsVideo && !firstIsImage) {
        setError("Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, WebM, or MOV.");
        return;
      }

      // If any file in the new batch is a video, treat the whole batch as video
      const hasVideo = incoming.some((f) => isVideoType(f));
      const hasImage = incoming.some((f) => isImageType(f));

      if (hasVideo && hasImage) {
        setError("You can't mix images and videos in a single post.");
        return;
      }

      if (hasVideo) {
        // Only 1 video allowed per post
        const video = incoming.find((f) => isVideoType(f))!;
        if (video.size > MAX_FILE_SIZE_BYTES) {
          setError(tProfile.fileTooLarge);
          return;
        }
        // Replace any existing selection with this single video
        files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
        setFiles([
          {
            id: `${video.name}-${Date.now()}`,
            file: video,
            previewUrl: URL.createObjectURL(video),
          },
        ]);
        return;
      }

      // Images path
      const currentImageCount = files.filter((f) => isImageType(f.file)).length;
      const currentHasVideo = files.some((f) => isVideoType(f.file));

      if (currentHasVideo) {
        // Replacing video with images — clear existing
        files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
        setFiles([]);
      }

      const availableSlots = MAX_IMAGES - (currentHasVideo ? 0 : currentImageCount);
      const toAdd = incoming.filter((f) => isImageType(f)).slice(0, availableSlots);
      const skippedCount = incoming.filter((f) => isImageType(f)).length - toAdd.length;

      const oversized = toAdd.filter((f) => f.size > MAX_FILE_SIZE_BYTES);
      if (oversized.length > 0) {
        setError(`${oversized[0].name}: ${tProfile.fileTooLarge}`);
        return;
      }

      if (skippedCount > 0) {
        setError(`Maximum ${MAX_IMAGES} images per post. ${skippedCount} file(s) were skipped.`);
      }

      const newEntries: SelectedFile[] = toAdd.map((f) => ({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
      }));

      setFiles((prev) => (currentHasVideo ? newEntries : [...prev, ...newEntries]));
    },
    [files, tProfile.fileTooLarge]
  );

  // ── Remove file ────────────────────────────────────────────────────────────
  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  // ── File input handlers ────────────────────────────────────────────────────
  const handleImageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) validateAndAddFiles(Array.from(e.target.files));
      e.target.value = "";
    },
    [validateAndAddFiles]
  );

  const handleVideoInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) validateAndAddFiles(Array.from(e.target.files));
      e.target.value = "";
    },
    [validateAndAddFiles]
  );

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files) {
        validateAndAddFiles(Array.from(e.dataTransfer.files));
      }
    },
    [validateAndAddFiles]
  );

  // ── Clear form ─────────────────────────────────────────────────────────────
  const clearForm = useCallback(() => {
    setText("");
    setFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      return [];
    });
    setError(null);
    setUploadProgress(null);
    setIsExclusive(false);
    setIsShareable(true);
    setCrossPostX(false);
    setVideoTitle("");
    setVideoDescription("");
    if (compact) setIsExpanded(false);
  }, [compact]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isPosting) return;

    setIsPosting(true);
    setError(null);
    setUploadProgress(null);

    try {
      let result: { success: boolean; post: SocialPostItem };

      if (files.length > 1) {
        // Multi-image: use XHR so we can track progress
        result = await new Promise<{ success: boolean; post: SocialPostItem }>(
          (resolve, reject) => {
            const formData = new FormData();
            formData.append("content", trimmed);
            files.forEach((f) => formData.append("media", f.file));
            if (isExclusive) formData.append("isExclusive", "true");
            if (!isShareable) formData.append("isShareable", "false");

            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${API_BASE}/api/webapp/social/posts/with-multi-media`);
            xhr.withCredentials = true;

            xhr.upload.addEventListener("progress", (e) => {
              if (e.lengthComputable) {
                setUploadProgress(Math.round((e.loaded / e.total) * 100));
              }
            });

            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText));
                } catch {
                  reject(new Error("Invalid server response"));
                }
              } else {
                try {
                  const err = JSON.parse(xhr.responseText);
                  reject(new Error(err.error || `Upload failed (${xhr.status})`));
                } catch {
                  reject(new Error(`Upload failed (${xhr.status})`));
                }
              }
            });

            xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
            xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
            xhr.send(formData);
          }
        );
      } else if (files.length === 1) {
        // Single file: use XHR for progress tracking too
        result = await new Promise<{ success: boolean; post: SocialPostItem }>(
          (resolve, reject) => {
            const formData = new FormData();
            formData.append("content", trimmed);
            formData.append("media", files[0].file);
            if (isExclusive) formData.append("isExclusive", "true");
            if (!isShareable) formData.append("isShareable", "false");
            if (videoTitle.trim()) formData.append("videoTitle", videoTitle.trim());
            if (videoDescription.trim()) formData.append("videoDescription", videoDescription.trim());

            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${API_BASE}/api/webapp/social/posts/with-media`);
            xhr.withCredentials = true;

            xhr.upload.addEventListener("progress", (e) => {
              if (e.lengthComputable) {
                setUploadProgress(Math.round((e.loaded / e.total) * 100));
              }
            });

            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText));
                } catch {
                  reject(new Error("Invalid server response"));
                }
              } else {
                try {
                  const err = JSON.parse(xhr.responseText);
                  reject(new Error(err.error || `Upload failed (${xhr.status})`));
                } catch {
                  reject(new Error(`Upload failed (${xhr.status})`));
                }
              }
            });

            xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
            xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
            xhr.send(formData);
          }
        );
      } else {
        // Text-only post
        const res = await fetch(`${API_BASE}/api/webapp/social/posts`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: trimmed,
            isExclusive: isExclusive,
            isShareable: isShareable,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `Post failed (${res.status})`);
        }
        result = await res.json();
      }

      if (result.success && result.post) {
        // Fire X cross-post in the background — non-blocking, errors are silently dropped
        if (crossPostX) {
          sharePostToX(result.post.id).catch(() => { /* non-critical */ });
        }
        onPostCreated?.(result.post);
        clearForm();
      } else {
        throw new Error("Post creation failed");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create post");
      setUploadProgress(null);
    } finally {
      setIsPosting(false);
    }
  }, [text, files, isPosting, isExclusive, isShareable, crossPostX, videoTitle, videoDescription, onPostCreated, clearForm]);

  // ── Keyboard submit (Ctrl/Cmd + Enter) ────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // ── Derived values ─────────────────────────────────────────────────────────
  const hasVideo = files.some((f) => isVideoType(f.file));
  const imageCount = files.filter((f) => isImageType(f.file)).length;
  const canAddMoreImages = !hasVideo && imageCount < MAX_IMAGES;
  const canAddVideo = files.length === 0;
  const isOverCharLimit = text.length > MAX_CHARS;
  const canPost = text.trim().length > 0 && !isPosting && !isOverCharLimit;
  const resolvedPlaceholder = placeholder ?? tFeed.whatOnYourMind;
  const displayName = user?.displayName || user?.username || "U";

  // ── Compact collapsed view ─────────────────────────────────────────────────
  if (compact && !isExpanded) {
    return (
      <div
        className={`glass-card-sm p-4 cursor-pointer hover:border-white/20 transition-colors ${className}`}
        onClick={() => {
          setIsExpanded(true);
          // Focus textarea on next tick after expand
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
        role="button"
        tabIndex={0}
        aria-label="Create a post"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(true);
            setTimeout(() => textareaRef.current?.focus(), 50);
          }
        }}
      >
        <div className="flex gap-3">
          <ComposerAvatar photoUrl={user?.photoUrl} displayName={displayName} />
          <div className="flex-1 min-w-0">
            <div className="w-full text-white/40 text-sm py-2 border-b border-white/10 mb-3">
              {resolvedPlaceholder}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3" style={{ color: "#8E8E93" }}>
                {/* Photo icon */}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                {/* Video icon */}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <span className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold">
                {tFeed.post}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Full composer ──────────────────────────────────────────────────────────
  return (
    <div
      className={`glass-card-sm p-4 transition-all ${className}`}
      // Drag-and-drop handlers (only in full mode)
      onDragEnter={compact ? undefined : handleDragEnter}
      onDragLeave={compact ? undefined : handleDragLeave}
      onDragOver={compact ? undefined : handleDragOver}
      onDrop={compact ? undefined : handleDrop}
      style={
        isDragging
          ? { borderColor: "rgba(212,0,122,0.6)", background: "rgba(212,0,122,0.04)" }
          : undefined
      }
      id={dropzoneId}
      aria-label={isDragging ? "Drop files here" : undefined}
    >
      {/* Drag overlay hint */}
      {isDragging && (
        <div
          className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none z-10"
          style={{ border: "2px dashed rgba(212,0,122,0.6)", background: "rgba(212,0,122,0.06)" }}
          aria-hidden="true"
        >
          <p className="text-sm font-semibold" style={{ color: "#D4007A" }}>
            Drop to attach
          </p>
        </div>
      )}

      <div className="flex gap-3">
        {/* Avatar */}
        <ComposerAvatar photoUrl={user?.photoUrl} displayName={displayName} />

        {/* Composer body */}
        <div className="flex-1 min-w-0">

          {/* Hidden file inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={handleImageInputChange}
            aria-hidden="true"
            tabIndex={-1}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept={ACCEPTED_VIDEO_TYPES.join(",")}
            className="hidden"
            onChange={handleVideoInputChange}
            aria-hidden="true"
            tabIndex={-1}
          />

          {/* Textarea */}
          <label htmlFor={textareaId} className="sr-only">
            {resolvedPlaceholder}
          </label>
          <textarea
            ref={textareaRef}
            id={textareaId}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS + 50))}
            onKeyDown={handleKeyDown}
            placeholder={resolvedPlaceholder}
            rows={compact ? 2 : 3}
            disabled={isPosting}
            className="w-full bg-transparent text-white text-sm py-2 border-b border-white/10 mb-2 resize-none outline-none placeholder:text-white/40 disabled:opacity-60 overflow-hidden"
            style={{ minHeight: "44px" }}
            aria-describedby={error ? `${baseId}-error` : undefined}
          />

          {/* Character counter */}
          <div className="flex justify-end mb-2">
            <span
              className="text-xs tabular-nums"
              style={{ color: isOverCharLimit ? "#FF453A" : "#8E8E93" }}
              aria-live="polite"
              aria-atomic="true"
            >
              {text.length}/{MAX_CHARS}
            </span>
          </div>

          {/* Media preview grid */}
          <MediaPreviewGrid files={files} onRemove={removeFile} disabled={isPosting} />

          {/* Video title & description — shown when a video is attached */}
          {hasVideo && (
            <div className="mb-3 space-y-2">
              <div>
                <input
                  type="text"
                  value={videoTitle}
                  onChange={(e) => setVideoTitle(e.target.value.slice(0, 150))}
                  placeholder="Video title (optional)"
                  disabled={isPosting}
                  maxLength={150}
                  className="w-full bg-white/5 text-white text-sm rounded-lg px-3 py-2 border border-white/10 outline-none placeholder:text-white/30 focus:border-pnp-pink/50 disabled:opacity-60 transition-colors"
                />
                <div className="flex justify-end mt-0.5">
                  <span
                    className="text-[11px] tabular-nums"
                    style={{ color: videoTitle.length >= 150 ? "#FF453A" : "#555" }}
                  >
                    {videoTitle.length}/150
                  </span>
                </div>
              </div>
              <div>
                <textarea
                  value={videoDescription}
                  onChange={(e) => setVideoDescription(e.target.value.slice(0, 500))}
                  placeholder="Video description (optional)"
                  disabled={isPosting}
                  rows={2}
                  maxLength={500}
                  className="w-full bg-white/5 text-white text-sm rounded-lg px-3 py-2 border border-white/10 outline-none placeholder:text-white/30 focus:border-pnp-pink/50 disabled:opacity-60 resize-none transition-colors"
                />
                <div className="flex justify-end mt-0.5">
                  <span
                    className="text-[11px] tabular-nums"
                    style={{ color: videoDescription.length >= 500 ? "#FF453A" : "#555" }}
                  >
                    {videoDescription.length}/500
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Upload progress bar */}
          {uploadProgress !== null && (
            <div className="mb-3 rounded-lg overflow-hidden" style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.15)" }}>
              <div className="flex justify-between items-center px-3 pt-2 pb-1">
                <span className="text-xs" style={{ color: "#D4007A" }}>
                  {isPosting ? "Uploading..." : "Upload complete"}
                </span>
                <span className="text-xs font-semibold tabular-nums" style={{ color: "#D4007A" }}>
                  {uploadProgress}%
                </span>
              </div>
              <div className="h-1 mx-3 mb-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%`, background: "linear-gradient(90deg, #D4007A, #E69138)" }}
                  role="progressbar"
                  aria-valuenow={uploadProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <p
              id={`${baseId}-error`}
              className="text-xs mb-2"
              style={{ color: "#FF453A" }}
              role="alert"
              aria-live="assertive"
            >
              {error}
            </p>
          )}

          {/* Action row — media buttons + post button */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {/* Photo button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isPosting || !canAddMoreImages}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  style={{ color: "#D4007A", minHeight: "36px" }}
                  aria-label={`Attach photo${imageCount > 0 ? ` (${imageCount}/${MAX_IMAGES})` : ""}`}
                  title={`Photo (${imageCount}/${MAX_IMAGES})`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                  <span className="hidden sm:inline">{tFeed.photo}</span>
                  {imageCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                      style={{ background: "#D4007A" }}
                      aria-hidden="true"
                    >
                      {imageCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Video button */}
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={isPosting || !canAddVideo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                style={{ color: "#E69138", minHeight: "36px" }}
                aria-label={`Attach video${hasVideo ? " (1 attached)" : ""}`}
                title={hasVideo ? "Video attached" : "Attach video"}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                <span className="hidden sm:inline">{tFeed.video}</span>
              </button>
            </div>

            {/* Post button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canPost}
              className="btn-gradient px-5 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              style={{ minHeight: "36px" }}
            >
              {isPosting ? tFeed.posting : tFeed.post}
            </button>
          </div>

          {/* Exclusive toggle — active creators only */}
          {isActiveCreator && (
            <div className="mt-3">
              <ToggleSwitch
                id={exclusiveId}
                checked={isExclusive}
                onChange={setIsExclusive}
                disabled={isPosting}
                activeColor="#D4007A"
                label={tFeed.exclusiveToggle}
                icon={
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                }
              />
            </div>
          )}

          {/* Allow sharing toggle */}
          <div className="mt-2">
            <ToggleSwitch
              id={shareableId}
              checked={isShareable}
              onChange={setIsShareable}
              disabled={isPosting}
              activeColor="#34D399"
              label={tFeed.allowSharing}
              icon={
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
              }
            />
          </div>

          {/* Also post to X toggle — only shown when X is linked with write scope */}
          {xHasWriteScope && (
            <div className="mt-2">
              <ToggleSwitch
                id={`${baseId}-crosspost-x`}
                checked={crossPostX}
                onChange={setCrossPostX}
                disabled={isPosting}
                activeColor="#FFFFFF"
                label="Also post to X"
                icon={
                  <svg
                    viewBox="0 0 1200 1227"
                    fill="currentColor"
                    className="w-4 h-4"
                    aria-hidden="true"
                  >
                    <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.163 519.284ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.828Z" />
                  </svg>
                }
              />
              {crossPostX && (
                <p className="text-[11px] mt-1 px-1" style={{ color: "#555" }}>
                  This post will also appear on your X timeline
                </p>
              )}
            </div>
          )}

          {/* Format hint — shown when no files attached and not uploading */}
          {files.length === 0 && !isPosting && (
            <p className="text-[11px] mt-2 text-center" style={{ color: "#555" }}>
              {/* "Up to 4 photos or 1 video · Max 50 MB" */}
              Up to {MAX_IMAGES} photos or 1 video &bull; Max 50 MB
              {!compact && " \u00b7 Drag & drop supported"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
