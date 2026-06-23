import React, { useState, useCallback, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import {
  togglePostLike,
  getReplies,
  createReply,
  editSocialPost,
  type SocialPostItem,
} from "@/lib/api";
import { translateText } from "@/lib/feedI18n";
import { SharePostModal } from "@/components/SharePostModal";
// NearbyBadge removed — PostCard shows city name inline instead
import { MentionText } from "@/components/MentionText";
import { MentionInput } from "@/components/MentionInput";

// ── Helpers (duplicated here to keep the component self-contained) ────────────

function resolvePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/") || url.startsWith("http")) return url;
  return null;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PostCardProps {
  post: SocialPostItem;
  isOwn: boolean;
  isAdmin: boolean;
  isOwnProfile: boolean;
  isSubscribed: boolean;
  creatorPriceUsd?: number | null;
  currentUserId: string;
  userLang: string;
  onLike: (id: number) => void;
  onDelete: (id: number) => void;
  onAuthorTap?: (userId: string) => void;
  onSubscribeCta?: () => void;
  onReport?: (postId: number) => void;
  contentDisclaimerAccepted?: boolean;
  onAcceptDisclaimer?: () => Promise<void>;
  viewerCity?: string | null;
  viewerCountry?: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PostCard({
  post,
  isOwn,
  isAdmin,
  isOwnProfile,
  isSubscribed,
  creatorPriceUsd,
  currentUserId,
  userLang,
  onLike,
  onDelete,
  onAuthorTap,
  onSubscribeCta,
  onReport,
  contentDisclaimerAccepted,
  onAcceptDisclaimer,
  viewerCity,
  viewerCountry,
}: PostCardProps) {
  const t = useI18n();
  const p = t.profile;
  const { feed: ft } = useI18n();
  const [deleting, setDeleting] = useState(false);
  // Edit post state (owner only) — mirrors SocialPostCard
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [localContent, setLocalContent] = useState<string | null>(null);
  const photoUrl = resolvePhotoUrl(post.author_photo);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [disclaimerAccepting, setDisclaimerAccepting] = useState(false);

  const [translatedContent, setTranslatedContent] = useState<string | null>(
    null
  );
  const [isTranslating, setIsTranslating] = useState(false);

  const [showShareModal, setShowShareModal] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<SocialPostItem[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [loadingMoreReplies, setLoadingMoreReplies] = useState(false);
  const [repliesCursor, setRepliesCursor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0); // bump to remount + autofocus
  // Local optimistic state for per-reply likes — keyed by reply post id.
  // Lets us flip the heart instantly without re-fetching the reply list.
  const [replyLikes, setReplyLikes] = useState<Record<number, { liked: boolean; count: number }>>({});
  const [localReplyCount, setLocalReplyCount] = useState(
    post.replies_count || 0
  );
  // Counter for synthesising stable client-side ids on optimistic replies before
  // the server returns the real post.id. Prefixed negative-ish range so it
  // never collides with real bigint ids.
  const optimisticIdRef = useRef(-Date.now());

  const canDelete = isOwn || isAdmin;

  const handleStartEdit = useCallback(() => {
    setEditContent(localContent ?? post.content ?? "");
    setIsEditing(true);
  }, [localContent, post.content]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditContent(localContent ?? post.content ?? "");
  }, [localContent, post.content]);

  const handleSaveEdit = useCallback(async () => {
    if (savingEdit) return;
    const trimmed = editContent.trim();
    if (!trimmed) return;
    setSavingEdit(true);
    try {
      const res = await editSocialPost(post.id, trimmed);
      if (res.success) {
        setLocalContent(res.content ?? trimmed);
        setTranslatedContent(null);
        setIsEditing(false);
      }
    } catch { /* silent */ }
    setSavingEdit(false);
  }, [post.id, editContent, savingEdit]);

  const handleShare = useCallback(() => {
    setShowShareModal(true);
  }, []);

  const handleTranslate = useCallback(async () => {
    if (isTranslating) return;
    if (translatedContent) {
      setTranslatedContent(null);
      return;
    }
    if (!post.content) return;
    setIsTranslating(true);
    const result = await translateText(post.content, userLang || "en");
    if (result) setTranslatedContent(result);
    setIsTranslating(false);
  }, [isTranslating, translatedContent, post.content, userLang]);

  const loadReplies = useCallback(async () => {
    if (loadingReplies) return;
    setLoadingReplies(true);
    setReplyError(null);
    try {
      const res = await getReplies(post.id);
      if (res.success) {
        setReplies(res.replies);
        setRepliesCursor(res.nextCursor || null);
      }
    } catch (err) {
      setReplyError(err instanceof Error && err.message ? err.message : ft.replyFailed);
    }
    setLoadingReplies(false);
  }, [post.id, loadingReplies, ft.replyFailed]);

  const loadMoreReplies = useCallback(async () => {
    if (loadingMoreReplies || !repliesCursor) return;
    setLoadingMoreReplies(true);
    try {
      const res = await getReplies(post.id, repliesCursor);
      if (res.success) {
        // Dedupe in case an optimistic reply is now also returned by the server.
        setReplies((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...res.replies.filter((r) => !seen.has(r.id))];
        });
        setRepliesCursor(res.nextCursor || null);
      }
    } catch { /* surface via inline error pill on next user action */ }
    setLoadingMoreReplies(false);
  }, [post.id, loadingMoreReplies, repliesCursor]);

  const toggleReplies = useCallback(() => {
    const next = !showReplies;
    setShowReplies(next);
    if (next && replies.length === 0) loadReplies();
    // Bump composer key so MentionInput remounts with autoFocus the moment
    // the reply section opens. Doesn't fire on close.
    if (next) setComposerKey((k) => k + 1);
  }, [showReplies, replies.length, loadReplies]);

  // Tap-to-reply on a specific reply: prepend `@theirusername ` to whatever's
  // in the composer and focus it. If the mention is already present, no-op so
  // double-tap doesn't duplicate.
  const replyToUser = useCallback((username: string | null) => {
    if (!username) return;
    const handle = `@${username}`;
    setReplyText((prev) => {
      if (prev.includes(handle)) return prev;
      const sep = prev && !prev.endsWith(" ") ? " " : "";
      return `${prev}${sep}${handle} `;
    });
    setComposerKey((k) => k + 1);
  }, []);

  const handleSendReply = useCallback(async () => {
    const text = replyText.trim();
    if (!text || sendingReply) return;
    setSendingReply(true);
    setReplyError(null);

    // Optimistic insert — show the reply immediately so the user gets
    // instant feedback. Marked pending=true so the row renders dimmed.
    const tempId = optimisticIdRef.current--;
    const optimistic: SocialPostItem = {
      ...post, // borrow author identity from current viewer if available below
      id: tempId,
      content: text,
      likes_count: 0,
      replies_count: 0,
      liked_by_me: false,
      created_at: new Date().toISOString(),
      // currentUser fields aren't in PostCardProps directly — pull from author
      // shape on the parent post and override with currentUserId. The optimistic
      // row is replaced on success so this is purely visual.
      author_id: currentUserId,
      author_username: post.author_username, // best-effort placeholder
      author_first_name: undefined,
      author_photo: undefined,
      // Pending flag — used in the row renderer to show "sending…" opacity.
      // Not part of SocialPostItem; widened to unknown then cast back.
      ...({ __pending: true } as object),
    } as unknown as SocialPostItem;

    setReplies((prev) => [...prev, optimistic]);
    setReplyText("");
    setLocalReplyCount((c) => c + 1);

    try {
      const res = await createReply(post.id, text);
      if (res.success && res.post) {
        // Replace the optimistic row with the real one.
        setReplies((prev) => prev.map((r) => (r.id === tempId ? res.post : r)));
      } else {
        throw new Error(ft.replyFailed);
      }
    } catch (err) {
      // Rollback: remove optimistic row + restore the user's draft so they can
      // tap retry without re-typing.
      setReplies((prev) => prev.filter((r) => r.id !== tempId));
      setLocalReplyCount((c) => Math.max(0, c - 1));
      setReplyText(text);
      setReplyError(err instanceof Error && err.message ? err.message : ft.replyFailed);
    }
    setSendingReply(false);
  }, [replyText, sendingReply, post, currentUserId, ft.replyFailed]);

  // Per-reply like — replies are first-class posts so we just call togglePostLike.
  // Optimistic toggle in replyLikes; rolled back on error.
  const toggleReplyLike = useCallback(async (reply: SocialPostItem) => {
    const id = reply.id;
    const current = replyLikes[id] ?? { liked: !!reply.liked_by_me, count: reply.likes_count || 0 };
    const next = { liked: !current.liked, count: current.count + (current.liked ? -1 : 1) };
    setReplyLikes((m) => ({ ...m, [id]: next }));
    try {
      const res = await togglePostLike(id);
      if (typeof res?.likes_count === "number") {
        setReplyLikes((m) => ({ ...m, [id]: { liked: res.liked, count: res.likes_count! } }));
      } else {
        setReplyLikes((m) => ({ ...m, [id]: { ...next, liked: res.liked } }));
      }
    } catch {
      // Rollback
      setReplyLikes((m) => ({ ...m, [id]: current }));
    }
  }, [replyLikes]);

  // Keyboard: Esc closes the reply section if the composer is empty.
  useEffect(() => {
    if (!showReplies) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !replyText.trim()) setShowReplies(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showReplies, replyText]);

  const isExclusiveLocked =
    post.is_exclusive === true &&
    !isOwnProfile &&
    !isSubscribed &&
    (post.exclusive_status === "locked" || post.exclusive_status === undefined);

  const isExclusiveTeaser =
    post.is_exclusive === true &&
    !isOwnProfile &&
    !isSubscribed &&
    post.exclusive_status === "teaser";

  return (
    <div className="relative glass-card-sm p-4 transition-all duration-300">
      {/* ── Exclusive lock overlay (non-owner, non-subscriber) ── */}
      {isExclusiveLocked && (
        <div
          className="absolute inset-0 z-10 rounded-xl flex flex-col items-center justify-center gap-2 px-6 text-center"
          style={{
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            background: "rgba(0,0,0,0.62)",
            borderRadius: "inherit",
          }}
          aria-label="Exclusive content locked"
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <p className="text-white font-bold text-sm leading-tight">
            {p.exclusiveContent}
          </p>
          {creatorPriceUsd != null && (
            <p
              className="text-xs leading-snug"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              {p.subscribeForPrice.replace("${price}", String(creatorPriceUsd))}
            </p>
          )}
          <button
            onClick={onSubscribeCta}
            className="mt-1 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-150 active:scale-[0.97] min-h-[44px]"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label="Subscribe to unlock exclusive content"
          >
            {p.subscribe}
          </button>
        </div>
      )}

      {/* ── Teaser overlay: blurred but slightly visible ── */}
      {isExclusiveTeaser && (
        <div
          className="absolute inset-0 z-10 rounded-xl flex flex-col items-center justify-center gap-2 px-6 text-center"
          style={{
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            background: "rgba(0,0,0,0.45)",
            borderRadius: "inherit",
          }}
          aria-label="Exclusive content preview"
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <p className="text-white font-semibold text-xs">
            {p.exclusivePreviewOnly}
          </p>
          <button
            onClick={onSubscribeCta}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all duration-150 active:scale-[0.97] min-h-[36px]"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label="Subscribe to see full exclusive content"
          >
            {p.subscribeToUnlock}
          </button>
        </div>
      )}

      <div className="flex gap-3">
        {/* Avatar */}
        <button
          onClick={() => onAuthorTap?.(post.author_id)}
          className="flex-shrink-0"
          aria-label={`View ${
            post.author_first_name || post.author_username || "user"
          }'s profile`}
        >
          {post.author_id === "cristina-ai" ? (
            <span className="w-10 h-10 rounded-full flex items-center justify-center text-2xl ring-2 ring-[#1C1C1E] bg-[#1a1a2e]">🧜‍♀️</span>
          ) : photoUrl ? (
            <img
              src={photoUrl}
              alt={`${
                post.author_first_name || post.author_username || "User"
              }'s avatar`}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{
                background: "linear-gradient(135deg, #D4007A, #E69138)",
                color: "#fff",
              }}
            >
              {(
                post.author_first_name ||
                post.author_username ||
                "?"
              )[0].toUpperCase()}
            </div>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onAuthorTap?.(post.author_id)}
              className="font-semibold text-white text-sm truncate hover:underline"
            >
              {post.author_first_name || post.author_username || p.anonymous}
            </button>
            {post.author_username && (
              <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                @{post.author_username}
              </span>
            )}
            <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              &middot; {timeAgo(post.created_at)}
            </span>
            {post.author_city && post.author_country && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pnp-border/30 text-pnp-textSecondary">
                {post.author_city}
              </span>
            )}
            {post.is_exclusive && isOwnProfile && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: "rgba(212,0,122,0.15)",
                  color: "#D4007A",
                  border: "1px solid rgba(212,0,122,0.3)",
                }}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                  />
                </svg>
                {p.exclusiveLabel}
              </span>
            )}
          </div>

          {/* Tagged performers */}
          {Array.isArray(post.tagged_performers) && post.tagged_performers.length > 0 && (
            <div className="flex items-center flex-wrap gap-x-1 gap-y-0.5 mt-0.5 mb-0.5">
              <span className="text-[11px]" style={{ color: "#8E8E93" }}>with</span>
              {post.tagged_performers.map((tp, i) => (
                <span key={tp.id} className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onAuthorTap?.(tp.id)}
                    className="text-[11px] font-medium hover:underline transition-colors"
                    style={{ color: "#5ED1C4" }}
                  >
                    @{tp.username}
                  </button>
                  {i < post.tagged_performers!.length - 1 && (
                    <span className="text-[11px]" style={{ color: "#8E8E93" }}>,</span>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Post body — inline editor when editing, otherwise @mentions/URLs clickable */}
          {isEditing ? (
            <div className="mt-1.5">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-white/5 text-white text-sm rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 resize-none"
                rows={3}
                maxLength={5000}
                disabled={savingEdit}
                autoFocus
              />
              <div className="flex gap-2 mt-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  disabled={savingEdit}
                  className="text-xs px-3 py-1.5 rounded-md text-pnp-textSecondary hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editContent.trim()}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md disabled:opacity-40 btn-gradient text-white"
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <MentionText
              text={translatedContent ?? localContent ?? post.content}
              className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed block"
              maxLength={200}
            />
          )}
          {translatedContent && !isEditing && (
            <button
              onClick={() => setTranslatedContent(null)}
              className="text-xs mt-0.5"
              style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
            >
              {ft.showOriginal}
            </button>
          )}

          {/* Link preview card — only when post has no attached media */}
          {!isEditing && !post.media_url && (() => {
            const contentStr = translatedContent ?? localContent ?? post.content ?? "";
            const urlMatch = contentStr.match(/https?:\/\/[^\s<>"]+/);
            if (!urlMatch) return null;
            const rawUrl = urlMatch[0].replace(/[.,;:!?)\]]+$/, "");
            let host = rawUrl;
            try { host = new URL(rawUrl).host.replace(/^www\./, ""); } catch { /* noop */ }
            return (
              <a
                href={rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-3 block rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/[0.08] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" style={{ color: "#5ED1C4" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-pnp-textSecondary">{host}</div>
                    <div className="text-xs text-white/80 truncate">{rawUrl}</div>
                  </div>
                </div>
              </a>
            );
          })()}

          {/* Media */}
          {post.media_url && (
            <div className="mt-3">
              {post.media_type === "video" ? (
                <video
                  src={post.media_url}
                  controls
                  controlsList="nodownload"
                  onContextMenu={(e) => e.preventDefault()}
                  playsInline
                  className="w-full max-h-[480px] rounded-lg object-contain bg-black"
                  preload="metadata"
                  poster={post.video_thumbnail_url || undefined}
                />
              ) : (
                <img
                  src={post.media_url}
                  alt="Post image"
                  className="w-full rounded-lg object-cover"
                  loading="lazy"
                />
              )}
            </div>
          )}

          {/* Actions bar */}
          <div
            className="flex items-center gap-5 mt-3"
            style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
          >
            {/* Like */}
            <button
              onClick={() => onLike(post.id)}
              className="flex items-center gap-1.5 text-xs hover:text-pink-400 transition-colors"
              style={post.liked_by_me ? { color: "#D4007A" } : undefined}
              aria-label={post.liked_by_me ? p.unlikePost : p.likePost}
            >
              <svg
                className="w-4 h-4"
                fill={post.liked_by_me ? "currentColor" : "none"}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                />
              </svg>
              {post.likes_count > 0 && <span>{post.likes_count}</span>}
            </button>

            {/* Reply button */}
            <button
              onClick={toggleReplies}
              className="flex items-center gap-1.5 text-xs hover:text-blue-400 transition-colors"
              style={showReplies ? { color: "#60A5FA" } : undefined}
              aria-label={ft.reply}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
                />
              </svg>
              {localReplyCount > 0 && <span>{localReplyCount}</span>}
            </button>

            {/* Share — always visible; disclaimer modal gates first share. */}
            <button
              onClick={() => {
                if (contentDisclaimerAccepted) {
                  handleShare();
                } else {
                  setShowDisclaimerModal(true);
                }
              }}
              className="flex items-center gap-1.5 text-xs hover:text-green-400 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
                />
              </svg>
            </button>

            {/* Translate — visible on every post that has any text content. */}
            {post.content && (
              <button
                onClick={handleTranslate}
                disabled={isTranslating}
                className="flex items-center gap-1 text-xs transition-colors hover:text-teal-400 disabled:opacity-40"
                style={
                  translatedContent
                    ? { color: "#5ED1C4" }
                    : { color: "var(--pnp-text-secondary, #8E8E93)" }
                }
                title={translatedContent ? ft.showOriginal : ft.translate}
              >
                {isTranslating ? (
                  <span className="text-[10px]">{ft.translating}</span>
                ) : (
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802"
                    />
                  </svg>
                )}
              </button>
            )}

            {/* Report post (non-owner) */}
            {!isOwn && onReport && (
              <button
                onClick={() => onReport(post.id)}
                className="ml-auto text-xs hover:text-amber-400 transition-colors"
                title={p.reportPost}
                aria-label={p.reportPost}
                style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
                </svg>
              </button>
            )}

            {/* Edit (owner only, not while editing) */}
            {isOwn && !isEditing && !post.blurred && (
              <button
                onClick={(e) => { e.stopPropagation(); handleStartEdit(); }}
                className="ml-auto text-xs hover:text-cyan-400 transition-colors"
                style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
                aria-label="Edit post"
                title="Edit post"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                </svg>
              </button>
            )}

            {/* Delete (owner or admin) */}
            {canDelete && (
              <button
                onClick={() => {
                  setDeleting(true);
                  onDelete(post.id);
                }}
                disabled={deleting}
                className={`${(isOwn && !isEditing && !post.blurred) || (!isOwn && onReport) ? "" : "ml-auto"} text-xs hover:text-red-400 transition-colors`}
                title={p.deletePost}
                aria-label={p.deletePost}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Replies section */}
          {showReplies && (
            <div className="mt-3 pt-3 border-t border-white/10">
              {/* "Reply to @author" pill — only when composer is empty and the
                  post has an author username. Tap inserts the @mention + focus.
                  Replaces the always-on "Replying to @user" banner that
                  presumed every reply was @-mentioning the author. */}
              {post.author_username && !replyText.trim() && (
                <button
                  type="button"
                  onClick={() => replyToUser(post.author_username!)}
                  className="inline-flex items-center gap-1.5 mb-2 px-2 py-0.5 rounded-full text-xs transition-colors hover:bg-white/10"
                  style={{ background: "rgba(94,209,196,0.10)", color: "#5ED1C4" }}
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                  </svg>
                  <span>{ft.replyToAuthor.replace("{name}", post.author_username)}</span>
                </button>
              )}

              {loadingReplies ? (
                /* Shimmer skeleton — three rows roughly matching real reply dimensions */
                <div className="space-y-3 mb-3" aria-label={ft.loadingReplies} role="status">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-2 animate-pulse">
                      <div className="w-7 h-7 rounded-full bg-white/10 flex-shrink-0" />
                      <div className="flex-1 space-y-1.5 pt-1">
                        <div className="h-2 rounded bg-white/10 w-1/4" />
                        <div className="h-2 rounded bg-white/10 w-3/4" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : replies.length === 0 ? (
                <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {ft.noRepliesYet}
                </p>
              ) : (
                <div className="space-y-3 mb-3">
                  {replies.map((reply) => {
                    const pending = (reply as unknown as { __pending?: boolean }).__pending === true;
                    const likeState = replyLikes[reply.id] ?? {
                      liked: !!reply.liked_by_me,
                      count: reply.likes_count || 0,
                    };
                    const isOwnReply = String(reply.author_id) === String(currentUserId);
                    return (
                      <div
                        key={reply.id}
                        className={`flex gap-2 transition-opacity ${pending ? "opacity-60" : ""}`}
                      >
                        <button
                          onClick={() => !pending && onAuthorTap?.(reply.author_id)}
                          className="flex-shrink-0"
                          disabled={pending}
                        >
                          {resolvePhotoUrl(reply.author_photo) ? (
                            <img
                              src={resolvePhotoUrl(reply.author_photo)!}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover"
                            />
                          ) : (
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{
                                background: "linear-gradient(135deg, #D4007A, #E69138)",
                                color: "#fff",
                              }}
                            >
                              {(reply.author_first_name || reply.author_username || "?")[0].toUpperCase()}
                            </div>
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-white truncate">
                              {reply.author_first_name || reply.author_username}
                            </span>
                            <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                              {pending ? ft.sending : timeAgo(reply.created_at)}
                            </span>
                          </div>
                          {/* Reply content — @mentions as clickable links */}
                          <MentionText
                            text={reply.content}
                            className="text-xs text-white/80 mt-0.5 whitespace-pre-wrap block"
                          />
                          {/* Per-reply actions — like + reply-to-this-user.
                              Hidden while the row is pending (no real id yet). */}
                          {!pending && (
                            <div className="mt-1 flex items-center gap-3 text-[11px]">
                              <button
                                type="button"
                                onClick={() => toggleReplyLike(reply)}
                                className="inline-flex items-center gap-1 transition-colors active:scale-95"
                                style={{ color: likeState.liked ? "#D4007A" : "#8E8E93" }}
                                aria-pressed={likeState.liked}
                                aria-label={likeState.liked ? p.unlikePost : p.likePost}
                              >
                                <svg className="w-3.5 h-3.5" fill={likeState.liked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                </svg>
                                {likeState.count > 0 && <span>{likeState.count}</span>}
                              </button>
                              {!isOwnReply && reply.author_username && (
                                <button
                                  type="button"
                                  onClick={() => replyToUser(reply.author_username || null)}
                                  className="inline-flex items-center gap-1 transition-colors hover:text-white/80"
                                  style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
                                  aria-label={ft.replyToAuthor.replace("{name}", reply.author_username)}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                                  </svg>
                                  <span>{ft.reply}</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Load more — visible only when the API said there's another page */}
                  {repliesCursor && (
                    <button
                      type="button"
                      onClick={loadMoreReplies}
                      disabled={loadingMoreReplies}
                      className="w-full text-xs py-2 rounded-lg transition-colors hover:bg-white/5 disabled:opacity-50"
                      style={{ color: "#5ED1C4" }}
                    >
                      {loadingMoreReplies ? ft.loading : ft.loadMoreReplies}
                    </button>
                  )}
                </div>
              )}

              {/* Reply composer */}
              {currentUserId && (
                <>
                  <div className="flex gap-2 items-end">
                    <MentionInput
                      key={composerKey}
                      value={replyText}
                      onChange={setReplyText}
                      placeholder={ft.writeReply}
                      maxLength={500}
                      rows={2}
                      disabled={sendingReply}
                      autoFocus
                      onSubmit={handleSendReply}
                      className="flex-1 bg-white/5 text-white text-xs rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 placeholder:text-white/30 resize-none"
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={!replyText.trim() || sendingReply}
                      className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-30 transition-colors flex-shrink-0"
                      style={{ color: "#D4007A" }}
                    >
                      {sendingReply ? "..." : ft.reply}
                    </button>
                  </div>
                  {/* Inline error pill — appears under composer; tap to retry. */}
                  {replyError && (
                    <div
                      role="alert"
                      className="mt-1.5 flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg text-[11px]"
                      style={{ background: "rgba(239,68,68,0.10)", color: "#FCA5A5" }}
                    >
                      <span className="truncate">{replyError}</span>
                      <button
                        type="button"
                        onClick={() => { setReplyError(null); handleSendReply(); }}
                        disabled={!replyText.trim()}
                        className="font-semibold disabled:opacity-50"
                        style={{ color: "#FCA5A5" }}
                      >
                        {ft.retry}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content Disclaimer Modal */}
      {showDisclaimerModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(6px)",
          }}
          onClick={() => setShowDisclaimerModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5 space-y-4"
            style={{
              background: "var(--pnp-surface, #1C1C1E)",
              border: "1px solid rgba(212,0,122,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #D4007A, #E69138)",
                }}
              >
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
              </div>
              <h3 className="text-base font-bold text-white">
                Content Sharing Disclaimer
              </h3>
            </div>
            <p className="text-sm text-white/80 leading-relaxed">
              By accepting this disclaimer, you acknowledge that you are
              responsible for any content you share from this platform. Shared
              content must comply with our community guidelines and applicable
              laws.
            </p>
            <p className="text-xs text-white/50 leading-relaxed">
              This action is permanent and cannot be undone. Your acceptance
              date, time, and IP address will be recorded.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowDisclaimerModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/20 text-white/70 hover:border-white/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDisclaimerAccepting(true);
                  try {
                    await onAcceptDisclaimer?.();
                    setShowDisclaimerModal(false);
                    setShowShareModal(true);
                  } catch {
                    /* silent */
                  }
                  setDisclaimerAccepting(false);
                }}
                disabled={disclaimerAccepting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {disclaimerAccepting ? "..." : "Accept & Share"}
              </button>
            </div>
          </div>
        </div>
      )}

      <SharePostModal
        postId={post.id}
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        isOwnPost={isOwn || post.author_id === 'pnptv-official'}
        contentDisclaimerAccepted={contentDisclaimerAccepted}
        onAcceptDisclaimer={onAcceptDisclaimer}
      />
    </div>
  );
}
