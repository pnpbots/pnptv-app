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
import { getXLoginUrl, getXStatus, sharePostToX, getHangoutGroups, sharePostToHangouts, getDmThreads, sharePostToDm, type XStatus, type HangoutGroup, type MessageThread } from "@/lib/api";

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
type HangoutsLoadState = "idle" | "loading" | "loaded" | "error";
type HangoutsShareState = "idle" | "sending" | "success" | "error";

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

  // Hangouts section state
  const [hangoutsExpanded, setHangoutsExpanded] = useState(false);
  const [hangoutsLoadState, setHangoutsLoadState] = useState<HangoutsLoadState>("idle");
  const [hangoutsLoadError, setHangoutsLoadError] = useState<string | null>(null);
  const [hangoutGroups, setHangoutGroups] = useState<HangoutGroup[]>([]);
  const [selectedHangoutIds, setSelectedHangoutIds] = useState<number[]>([]);
  const [hangoutNote, setHangoutNote] = useState("");
  const [hangoutsShareState, setHangoutsShareState] = useState<HangoutsShareState>("idle");
  const [hangoutsShareError, setHangoutsShareError] = useState<string | null>(null);
  const [hangoutsSharedCount, setHangoutsSharedCount] = useState(0);
  // Tracks whether groups were fetched at least once this modal-open lifecycle
  const hangoutsFetchedRef = useRef(false);

  // DMs section state (mirror of hangouts)
  const [dmsExpanded, setDmsExpanded] = useState(false);
  const [dmsLoadState, setDmsLoadState] = useState<HangoutsLoadState>("idle");
  const [dmsLoadError, setDmsLoadError] = useState<string | null>(null);
  const [dmThreads, setDmThreads] = useState<MessageThread[]>([]);
  const [selectedDmPartnerIds, setSelectedDmPartnerIds] = useState<string[]>([]);
  const [dmNote, setDmNote] = useState("");
  const [dmsShareState, setDmsShareState] = useState<HangoutsShareState>("idle");
  const [dmsShareError, setDmsShareError] = useState<string | null>(null);
  const [dmsSharedCount, setDmsSharedCount] = useState(0);
  const dmsFetchedRef = useRef(false);

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

    // Reset hangouts section for this modal-open lifecycle
    setHangoutsExpanded(false);
    setHangoutsLoadState("idle");
    setHangoutsLoadError(null);
    setHangoutGroups([]);
    setSelectedHangoutIds([]);
    setHangoutNote("");
    setHangoutsShareState("idle");
    setHangoutsShareError(null);
    setHangoutsSharedCount(0);
    hangoutsFetchedRef.current = false;

    // Reset DMs section
    setDmsExpanded(false);
    setDmsLoadState("idle");
    setDmsLoadError(null);
    setDmThreads([]);
    setSelectedDmPartnerIds([]);
    setDmNote("");
    setDmsShareState("idle");
    setDmsShareError(null);
    setDmsSharedCount(0);
    dmsFetchedRef.current = false;

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

  // ── Hangout helpers ───────────────────────────────────────────────────────

  const loadHangoutGroups = useCallback(async () => {
    if (hangoutsFetchedRef.current) return;
    hangoutsFetchedRef.current = true;
    setHangoutsLoadState("loading");
    setHangoutsLoadError(null);
    try {
      const res = await getHangoutGroups();
      const active = (res.groups || []).filter((g) => !g.isArchived);
      setHangoutGroups(active);
      setHangoutsLoadState("loaded");
    } catch (err: unknown) {
      setHangoutsLoadError(err instanceof Error ? err.message : "Failed to load hangouts");
      setHangoutsLoadState("error");
      hangoutsFetchedRef.current = false; // allow retry
    }
  }, []);

  const handleToggleHangoutsSection = useCallback(() => {
    setHangoutsExpanded((prev) => {
      const next = !prev;
      if (next) loadHangoutGroups();
      return next;
    });
  }, [loadHangoutGroups]);

  const handleToggleHangout = useCallback((id: number) => {
    setSelectedHangoutIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 10) return prev;
      return [...prev, id];
    });
  }, []);

  const handleShareToHangouts = useCallback(async () => {
    if (selectedHangoutIds.length === 0 || hangoutsShareState === "sending") return;
    setHangoutsShareState("sending");
    setHangoutsShareError(null);
    try {
      const res = await sharePostToHangouts(postId, selectedHangoutIds, hangoutNote || undefined);
      const sent = res.results.filter((r) => r.status === "sent").length;
      setHangoutsSharedCount(sent);
      setHangoutsShareState("success");
      setHangoutsExpanded(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to share to hangouts";
      setHangoutsShareError(msg);
      setHangoutsShareState("error");
    }
  }, [postId, selectedHangoutIds, hangoutNote, hangoutsShareState]);

  // ── DM share — lazy fetch recent threads, multi-select up to 5, per-partner POST ──
  const loadDmThreads = useCallback(async () => {
    if (dmsFetchedRef.current) return;
    dmsFetchedRef.current = true;
    setDmsLoadState("loading");
    setDmsLoadError(null);
    try {
      const res = await getDmThreads();
      setDmThreads(res.threads || []);
      setDmsLoadState("loaded");
    } catch (err: unknown) {
      setDmsLoadError(err instanceof Error ? err.message : "Failed to load DMs");
      setDmsLoadState("error");
      dmsFetchedRef.current = false;
    }
  }, []);

  const handleToggleDmsSection = useCallback(() => {
    setDmsExpanded((prev) => {
      const next = !prev;
      if (next) loadDmThreads();
      return next;
    });
  }, [loadDmThreads]);

  const handleToggleDmPartner = useCallback((partnerId: string) => {
    setSelectedDmPartnerIds((prev) => {
      if (prev.includes(partnerId)) return prev.filter((x) => x !== partnerId);
      if (prev.length >= 5) return prev;
      return [...prev, partnerId];
    });
  }, []);

  const handleShareToDms = useCallback(async () => {
    if (selectedDmPartnerIds.length === 0 || dmsShareState === "sending") return;
    setDmsShareState("sending");
    setDmsShareError(null);
    const results = await Promise.allSettled(
      selectedDmPartnerIds.map((pid) => sharePostToDm(pid, postId, dmNote || undefined))
    );
    const sent = results.filter((r) => r.status === "fulfilled" && (r as PromiseFulfilledResult<{ success: boolean }>).value.success).length;
    if (sent > 0) {
      setDmsSharedCount(sent);
      setDmsShareState("success");
      setDmsExpanded(false);
    } else {
      setDmsShareError("Failed to share — please retry");
      setDmsShareState("error");
    }
  }, [postId, selectedDmPartnerIds, dmNote, dmsShareState]);

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

  // ── Hangouts section renderer ─────────────────────────────────────────────

  const renderHangoutsSection = () => {
    const isSuccess = hangoutsShareState === "success";

    // Post-share success pill (collapsed)
    if (isSuccess) {
      return (
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(52,199,89,0.15)" }}
          >
            <svg className="w-4 h-4" style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#34C759" }}>
              Shared to {hangoutsSharedCount} hangout{hangoutsSharedCount !== 1 ? "s" : ""}!
            </p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              Your post was forwarded to the selected hangouts
            </p>
          </div>
        </div>
      );
    }

    return (
      <div>
        {/* Expand / collapse header button */}
        <button
          type="button"
          onClick={handleToggleHangoutsSection}
          className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          aria-expanded={hangoutsExpanded}
          aria-label="Share to hangouts — expand section"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(123,97,255,0.12)" }}
          >
            {/* Hangout / users icon */}
            <svg className="w-4 h-4" style={{ color: "#7B61FF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-white">Share to Hangouts</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              Forward this post to your hangout groups
            </p>
          </div>
          {/* Chevron */}
          <svg
            className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
            style={{ color: "#555", transform: hangoutsExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Expanded panel */}
        {hangoutsExpanded && (
          <div className="mt-2 space-y-2">
            {/* List area */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {hangoutsLoadState === "loading" ? (
                <div className="space-y-0" aria-label="Loading hangouts" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 p-2.5 animate-pulse"
                      style={{ borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.05)" : undefined }}
                    >
                      <div className="w-9 h-9 rounded-lg flex-shrink-0" style={{ background: "rgba(255,255,255,0.07)" }} />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 rounded" style={{ background: "rgba(255,255,255,0.07)", width: "55%" }} />
                        <div className="h-2.5 rounded" style={{ background: "rgba(255,255,255,0.04)", width: "35%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : hangoutsLoadState === "error" ? (
                <div className="flex items-center justify-between gap-2 px-3 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    <p className="text-xs truncate" style={{ color: "#FF453A" }}>
                      {hangoutsLoadError}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { hangoutsFetchedRef.current = false; loadHangoutGroups(); }}
                    className="text-xs font-medium flex-shrink-0 hover:opacity-80 transition-opacity"
                    style={{ color: "#FF453A" }}
                    aria-label="Retry loading hangouts"
                  >
                    Retry
                  </button>
                </div>
              ) : hangoutGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 px-3 text-center">
                  <svg className="w-6 h-6 mb-2" style={{ color: "#555" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                  <p className="text-sm" style={{ color: "#8E8E93" }}>
                    You're not a member of any hangouts yet
                  </p>
                </div>
              ) : (
                <div
                  className="max-h-[36vh] overflow-y-auto"
                  role="listbox"
                  aria-multiselectable="true"
                  aria-label="Select hangouts to share to"
                >
                  {hangoutGroups.map((g, idx) => {
                    const isChecked = selectedHangoutIds.includes(g.id);
                    const isDisabled = !isChecked && selectedHangoutIds.length >= 10;
                    const initial = g.name.charAt(0).toUpperCase();
                    return (
                      <button
                        key={g.id}
                        type="button"
                        role="option"
                        aria-selected={isChecked}
                        aria-disabled={isDisabled}
                        aria-label={`${isChecked ? "Deselect" : "Select"} hangout: ${g.name}`}
                        onClick={() => handleToggleHangout(g.id)}
                        disabled={isDisabled}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          borderBottom: idx < hangoutGroups.length - 1 ? "1px solid rgba(255,255,255,0.05)" : undefined,
                          background: isChecked ? "rgba(123,97,255,0.10)" : "transparent",
                        }}
                      >
                        {g.avatarUrl ? (
                          <img
                            src={g.avatarUrl}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                          />
                        ) : (
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)", color: "#fff" }}
                          >
                            {initial}
                          </div>
                        )}
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium text-white truncate">{g.name}</p>
                          {g.memberCount > 0 && (
                            <p className="text-xs" style={{ color: "#8E8E93" }}>
                              {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                          style={
                            isChecked
                              ? { background: "#7B61FF" }
                              : { background: "transparent", border: "1.5px solid rgba(255,255,255,0.25)" }
                          }
                          aria-hidden="true"
                        >
                          {isChecked && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Note textarea — only shown when there are groups to share to */}
            {hangoutsLoadState === "loaded" && hangoutGroups.length > 0 && (
              <>
                <textarea
                  value={hangoutNote}
                  onChange={(e) => setHangoutNote(e.target.value.slice(0, 500))}
                  rows={2}
                  placeholder="Add a message (optional)"
                  aria-label="Optional note to send with the post"
                  className="w-full text-sm text-white rounded-lg px-3 py-2 outline-none resize-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                />
                <div className="flex justify-between text-[10px] px-1" style={{ color: "#555" }}>
                  <span>{selectedHangoutIds.length}/10 selected</span>
                  <span>{hangoutNote.length}/500</span>
                </div>

                {/* Share error inline */}
                {hangoutsShareState === "error" && hangoutsShareError && (
                  <div className="flex items-center gap-2 px-1">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    <p className="text-xs flex-1 min-w-0" style={{ color: "#FF453A" }}>
                      {hangoutsShareError}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setHangoutsShareState("idle"); setHangoutsShareError(null); }}
                      className="text-xs font-medium flex-shrink-0 hover:opacity-80 transition-opacity"
                      style={{ color: "#FF453A" }}
                      aria-label="Dismiss error and retry"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="button"
                  onClick={handleShareToHangouts}
                  disabled={selectedHangoutIds.length === 0 || hangoutsShareState === "sending"}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  style={{ background: "linear-gradient(135deg, #7B61FF, #D4007A)" }}
                  aria-label={
                    selectedHangoutIds.length === 0
                      ? "Select at least one hangout"
                      : `Share to ${selectedHangoutIds.length} hangout${selectedHangoutIds.length !== 1 ? "s" : ""}`
                  }
                >
                  {hangoutsShareState === "sending" ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Sending…
                    </span>
                  ) : selectedHangoutIds.length === 0 ? (
                    "Select a hangout"
                  ) : (
                    `Share to ${selectedHangoutIds.length} hangout${selectedHangoutIds.length !== 1 ? "s" : ""}`
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── DMs section render — compact mirror of Hangouts ────────────────────────
  const renderDmsSection = () => {
    if (dmsShareState === "success") {
      return (
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(52,199,89,0.15)" }}>
            <svg className="w-4 h-4" style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#34C759" }}>
              Shared to {dmsSharedCount} DM{dmsSharedCount !== 1 ? "s" : ""}!
            </p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              Your post was sent to the selected conversations
            </p>
          </div>
        </div>
      );
    }

    return (
      <div>
        <button
          type="button"
          onClick={handleToggleDmsSection}
          className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          aria-expanded={dmsExpanded}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(94,209,196,0.12)" }}>
            <svg className="w-4 h-4" style={{ color: "#5ED1C4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-white">Share to DM</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              Send this post to your direct-message conversations
            </p>
          </div>
          <svg
            className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
            style={{ color: "#555", transform: dmsExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {dmsExpanded && (
          <div className="mt-2 space-y-2">
            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {dmsLoadState === "loading" ? (
                <div className="p-3 space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-9 h-9 rounded-full bg-white/10 flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-1/2 bg-white/10 rounded" />
                        <div className="h-2.5 w-2/3 bg-white/5 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : dmsLoadState === "error" ? (
                <div className="p-4 text-center">
                  <p className="text-xs text-red-400 mb-2">{dmsLoadError || "Failed to load"}</p>
                  <button
                    type="button"
                    onClick={() => { dmsFetchedRef.current = false; loadDmThreads(); }}
                    className="text-xs font-semibold text-pnp-accent hover:underline"
                  >
                    Try again
                  </button>
                </div>
              ) : dmThreads.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-xs" style={{ color: "#8E8E93" }}>
                    You don't have any direct messages yet
                  </p>
                </div>
              ) : (
                <div className="max-h-[36vh] overflow-y-auto">
                  {dmThreads.map((t) => {
                    const partnerId = String(t.partnerId);
                    const isChecked = selectedDmPartnerIds.includes(partnerId);
                    const isDisabled = !isChecked && selectedDmPartnerIds.length >= 5;
                    const name = t.partnerFirstName || t.partnerUsername || "User";
                    return (
                      <button
                        key={partnerId}
                        type="button"
                        onClick={() => !isDisabled && handleToggleDmPartner(partnerId)}
                        disabled={isDisabled}
                        role="option"
                        aria-selected={isChecked}
                        aria-disabled={isDisabled}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors ${isDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/5"}`}
                      >
                        {t.partnerPhoto ? (
                          <img src={t.partnerPhoto} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
                            style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
                          >
                            {name[0]?.toUpperCase() || "?"}
                          </div>
                        )}
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-semibold text-white truncate">{name}</p>
                          {t.partnerUsername && <p className="text-[11px] truncate" style={{ color: "#8E8E93" }}>@{t.partnerUsername}</p>}
                        </div>
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{
                            background: isChecked ? "#5ED1C4" : "transparent",
                            border: isChecked ? "none" : "1.5px solid rgba(255,255,255,0.2)",
                          }}
                        >
                          {isChecked && (
                            <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {dmThreads.length > 0 && dmsLoadState === "loaded" && (
              <>
                <div>
                  <textarea
                    value={dmNote}
                    onChange={(e) => setDmNote(e.target.value.slice(0, 500))}
                    placeholder="Add a note (optional)"
                    rows={2}
                    className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-pnp-textSecondary/50 outline-none focus:border-white/30 resize-none"
                  />
                  <div className="text-[10px] text-right mt-0.5" style={{ color: "#8E8E93" }}>
                    {dmNote.length} / 500
                  </div>
                </div>

                {dmsShareError && (
                  <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-xs text-red-400 flex-1">{dmsShareError}</p>
                    <button type="button" onClick={() => setDmsShareState("idle")} className="text-xs font-semibold text-red-400 hover:underline">Retry</button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleShareToDms}
                  disabled={selectedDmPartnerIds.length === 0 || dmsShareState === "sending"}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #5ED1C4, #2AAEA4)" }}
                >
                  {dmsShareState === "sending" ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Sending…
                    </>
                  ) : (
                    `Send to ${selectedDmPartnerIds.length || ""} DM${selectedDmPartnerIds.length === 1 ? "" : "s"}`.trim()
                  )}
                </button>
              </>
            )}
          </div>
        )}
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

        {/* Share to Hangouts */}
        {renderHangoutsSection()}

        {/* Share to DM */}
        {renderDmsSection()}

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
