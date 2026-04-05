/**
 * SharePostModal — bottom-sheet modal for sharing a single social post.
 *
 * Options:
 *  1. Copy Link — copies the post URL to clipboard
 *  2. Share to X — cross-posts to X (Twitter) if the user has a linked account
 *     with write scope.  Falls back gracefully for unlinked / read-only accounts.
 *  3. Share via… — native Web Share API (where available)
 *
 * The modal calls GET /api/social/x-status on mount to determine the current
 * X connection state, then calls POST /api/social/posts/:id/share-x to post.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getXLoginUrl, getXStatus, sharePostToX, type XStatus } from "@/lib/api";

const APP_BASE = "https://pnptv.app";

// ── X Logo SVG ────────────────────────────────────────────────────────────────

function XLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 1200 1227"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.163 519.284ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.828Z" />
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SharePostModalProps {
  postId: number;
  postContent?: string | null;
  authorName?: string | null;
  mediaType?: string | null;
  videoThumbnailUrl?: string | null;
  mediaUrl?: string | null;
  isOwnPost?: boolean;
  isOpen: boolean;
  onClose: () => void;
  contentDisclaimerAccepted?: boolean;
  onAcceptDisclaimer?: () => Promise<void>;
}

type CopyState = "idle" | "copied" | "error";
type XShareState = "idle" | "loading" | "success" | "error";

// ── Component ─────────────────────────────────────────────────────────────────

export function SharePostModal({
  postId,
  postContent,
  authorName,
  mediaType,
  videoThumbnailUrl,
  mediaUrl,
  isOwnPost = false,
  isOpen,
  onClose,
}: SharePostModalProps) {
  const shareUrl = `${APP_BASE}/social/post/${postId}`;

  // X connection status
  const [xStatus, setXStatus] = useState<XStatus | null>(null);
  const [xStatusLoading, setXStatusLoading] = useState(true);

  // Per-action states
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [xShareState, setXShareState] = useState<XShareState>("idle");
  const [xShareError, setXShareError] = useState<string | null>(null);
  const [tweetUrl, setTweetUrl] = useState<string | null>(null);

  // Focus management
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch X status on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setXStatusLoading(true);
    setXStatus(null);
    setXShareState("idle");
    setXShareError(null);
    setTweetUrl(null);
    setCopyState("idle");

    getXStatus()
      .then((res) => {
        if (!cancelled) {
          setXStatus(res.status);
          setXStatusLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Treat fetch failure as "not linked" — degrade gracefully
          setXStatus({ linked: false, hasWriteScope: false, handle: null });
          setXStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, postId]);

  // ── Auto-focus first button on open ───────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => firstButtonRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // ── Cleanup timeouts on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // ── Trap Escape key ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      setCopyState("error");
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [shareUrl]);

  const handleShareToX = useCallback(async () => {
    if (xShareState === "loading" || xShareState === "success") return;
    setXShareState("loading");
    setXShareError(null);
    try {
      const res = await sharePostToX(postId);
      if (res.tweetUrl) setTweetUrl(res.tweetUrl);
      setXShareState("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to post to X";
      setXShareError(msg);
      setXShareState("error");
    }
  }, [postId, xShareState]);

  const handleNativeShare = useCallback(async () => {
    const displayName = authorName || "Someone";
    const text = postContent
      ? `${displayName}: ${postContent.slice(0, 100)}`
      : `Check out ${displayName}'s post on PNPtv!`;
    try {
      await navigator.share({
        title: `${displayName} on PNPtv!`,
        text,
        url: shareUrl,
      });
    } catch {
      // User cancelled or browser rejected — silent
    }
  }, [authorName, postContent, shareUrl]);

  if (!isOpen) return null;

  // ── Determine X row content ───────────────────────────────────────────────

  const renderXRow = () => {
    if (xStatusLoading) {
      return (
        <div
          className="flex items-center gap-3 p-3 rounded-xl animate-pulse"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <div className="w-9 h-9 rounded-xl flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 rounded" style={{ background: "rgba(255,255,255,0.08)", width: "40%" }} />
            <div className="h-3 rounded" style={{ background: "rgba(255,255,255,0.05)", width: "65%" }} />
          </div>
        </div>
      );
    }

    // Not linked at all
    if (!xStatus?.linked) {
      return (
        <a
          href={getXLoginUrl()}
          className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:opacity-80 active:scale-[0.98]"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          aria-label="Connect X account to enable sharing"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <XLogo className="w-4 h-4" style={{ color: "#888" } as React.CSSProperties} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/50">Share to X</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              Connect X to share posts to your timeline
            </p>
          </div>
          <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#555" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </a>
      );
    }

    // Linked but missing write scope
    if (!xStatus.hasWriteScope) {
      return (
        <a
          href={getXLoginUrl()}
          className="flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,165,0,0.2)" }}
          aria-label="Reconnect X to enable sharing"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,165,0,0.1)" }}
          >
            <XLogo className="w-4 h-4" style={{ color: "#FFA500" } as React.CSSProperties} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: "#FFA500" }}>Reconnect X</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              Your X account needs write permission to share posts
            </p>
          </div>
          <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#FFA500" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </a>
      );
    }

    // Linked with write scope, but not the author — can't post to X
    if (!isOwnPost) {
      return (
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
            <XLogo className="w-4 h-4" style={{ color: "#555" } as React.CSSProperties} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/40">Share to X</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>Only the post author can share to X</p>
          </div>
        </div>
      );
    }

    // Linked with write scope — show the share button
    const isLoading = xShareState === "loading";
    const isSuccess = xShareState === "success";
    const isError = xShareState === "error";

    // Determine whether we have a media preview to show
    const previewImageUrl =
      (mediaType === "video" && videoThumbnailUrl)
        ? videoThumbnailUrl
        : (mediaType === "image" && (videoThumbnailUrl || mediaUrl))
        ? (videoThumbnailUrl || mediaUrl)
        : null;

    return (
      <div>
        {/* Card preview — shown only when media is available and not yet in success state */}
        {previewImageUrl && !isSuccess && (
          <div
            className="rounded-xl overflow-hidden mb-2"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="relative aspect-video w-full overflow-hidden">
              <img
                src={previewImageUrl}
                alt="Post media preview"
                className="w-full h-full object-cover"
              />
              {mediaType === "video" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(0,0,0,0.6)" }}
                  >
                    <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
            <div className="px-3 py-2">
              <p className="text-[11px]" style={{ color: "#8E8E93" }}>
                pnptv.app · {mediaType === "video" ? "Will post as card with video preview" : "Will post as card with image"}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleShareToX}
          disabled={isLoading || isSuccess}
          className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98] disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={
            isSuccess
              ? { background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
          }
          aria-label="Share this post to X"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
            style={
              isSuccess
                ? { background: "rgba(52,199,89,0.15)" }
                : isLoading
                ? { background: "rgba(255,255,255,0.06)" }
                : { background: "rgba(255,255,255,0.08)" }
            }
          >
            {isLoading ? (
              <svg
                className="w-4 h-4 animate-spin"
                style={{ color: "#8E8E93" }}
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : isSuccess ? (
              <svg className="w-4 h-4" style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <XLogo className="w-4 h-4 text-white" />
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            {isSuccess ? (
              <>
                <p className="text-sm font-semibold" style={{ color: "#34C759" }}>Posted to X!</p>
                {tweetUrl ? (
                  <a href={tweetUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline" style={{ color: "#29A8E2" }}>
                    View on X →
                  </a>
                ) : (
                  <p className="text-xs" style={{ color: "#8E8E93" }}>Your post is now on your X timeline</p>
                )}
              </>
            ) : isLoading ? (
              <>
                <p className="text-sm font-medium text-white/60">Posting to X...</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-white">
                  Share to X
                  {xStatus.handle && (
                    <span className="text-white/40 font-normal ml-1.5 text-xs">@{xStatus.handle}</span>
                  )}
                </p>
                <p className="text-xs" style={{ color: "#8E8E93" }}>
                  Post this to your X timeline
                </p>
              </>
            )}
          </div>
        </button>

        {/* Error feedback */}
        {isError && xShareError && (
          <div className="flex items-center gap-2 mt-2 px-1">
            <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs" style={{ color: "#FF453A" }}>
              {xShareError}
            </p>
            <button
              type="button"
              onClick={() => { setXShareState("idle"); setXShareError(null); }}
              className="text-xs ml-auto font-medium hover:opacity-80 transition-opacity"
              style={{ color: "#FF453A" }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Privacy note */}
        <p className="text-[11px] mt-2 px-1 leading-relaxed" style={{ color: "#555" }}>
          Only this post will be shared to X. All other content stays private on PNPtv!
        </p>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share post"
    >
      <div
        className="w-full max-w-lg rounded-t-2xl p-5 pb-8 space-y-2"
        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center mb-3" aria-hidden="true">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-base font-bold text-white">Share Post</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            style={{ background: "rgba(255,255,255,0.08)" }}
            aria-label="Close share menu"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Copy Link */}
        <button
          ref={firstButtonRef}
          type="button"
          onClick={handleCopyLink}
          className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={
            copyState === "copied"
              ? { background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }
              : copyState === "error"
              ? { background: "rgba(255,69,58,0.06)", border: "1px solid rgba(255,69,58,0.2)" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
          }
          aria-label={copyState === "copied" ? "Link copied to clipboard" : "Copy post link to clipboard"}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
            style={
              copyState === "copied"
                ? { background: "rgba(52,199,89,0.15)" }
                : copyState === "error"
                ? { background: "rgba(255,69,58,0.12)" }
                : { background: "rgba(255,255,255,0.08)" }
            }
          >
            {copyState === "copied" ? (
              <svg className="w-4 h-4" style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : copyState === "error" ? (
              <svg className="w-4 h-4" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            {copyState === "copied" ? (
              <p className="text-sm font-semibold" style={{ color: "#34C759" }}>Link Copied!</p>
            ) : copyState === "error" ? (
              <p className="text-sm font-medium" style={{ color: "#FF453A" }}>Could not copy</p>
            ) : (
              <p className="text-sm font-semibold text-white">Copy Link</p>
            )}
            <p className="text-xs truncate" style={{ color: "#8E8E93" }}>
              {shareUrl}
            </p>
          </div>
        </button>

        {/* Share to X */}
        {renderXRow()}

        {/* Native Share API — only shown when available */}
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            type="button"
            onClick={handleNativeShare}
            className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            aria-label="Share via system share sheet"
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-white">Share via...</p>
              <p className="text-xs" style={{ color: "#8E8E93" }}>
                Open system share sheet
              </p>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
