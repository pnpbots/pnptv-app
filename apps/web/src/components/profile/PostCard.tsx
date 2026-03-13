import React, { useState, useCallback, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import {
  togglePostLike as _unused_togglePostLike,
  getReplies,
  createReply,
  type SocialPostItem,
} from "@/lib/api";
import { translateText } from "@/lib/feedI18n";
import { SharePostModal } from "@/components/SharePostModal";
import { NearbyBadge } from "@/components/NearbyBadge";
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
  contentDisclaimerAccepted,
  onAcceptDisclaimer,
  viewerCity,
  viewerCountry,
}: PostCardProps) {
  const t = useI18n();
  const p = t.profile;
  const { feed: ft } = useI18n();
  const [deleting, setDeleting] = useState(false);
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
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [localReplyCount, setLocalReplyCount] = useState(
    post.replies_count || 0
  );

  const canDelete = isOwn || isAdmin;

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
    try {
      const res = await getReplies(post.id);
      if (res.success) setReplies(res.replies);
    } catch {
      /* silent */
    }
    setLoadingReplies(false);
  }, [post.id, loadingReplies]);

  const toggleReplies = useCallback(() => {
    const next = !showReplies;
    setShowReplies(next);
    if (next) {
      if (replies.length === 0) loadReplies();
      // Pre-fill @mention of post author if reply box is empty
      if (!replyText && post.author_username) {
        setReplyText(`@${post.author_username} `);
      }
    }
  }, [
    showReplies,
    replies.length,
    loadReplies,
    replyText,
    post.author_username,
  ]);

  const handleSendReply = useCallback(async () => {
    if (!replyText.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      const res = await createReply(post.id, replyText.trim());
      if (res.success) {
        setReplies((prev) => [...prev, res.post]);
        setReplyText("");
        setLocalReplyCount((c) => c + 1);
      }
    } catch {
      /* silent */
    }
    setSendingReply(false);
  }, [replyText, sendingReply, post]);

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
          {photoUrl ? (
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
              <span className="text-xs" style={{ color: "#8E8E93" }}>
                @{post.author_username}
              </span>
            )}
            <span className="text-xs" style={{ color: "#8E8E93" }}>
              &middot; {timeAgo(post.created_at)}
            </span>
            {post.author_city && post.author_country && (
              <NearbyBadge
                userCity={post.author_city}
                userCountry={post.author_country}
                viewerCity={viewerCity}
                viewerCountry={viewerCountry}
                username={
                  post.author_first_name || post.author_username || "User"
                }
              />
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

          {/* Post body — @mentions rendered as clickable links */}
          <MentionText
            text={translatedContent ?? post.content}
            className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed block"
            maxLength={200}
          />
          {translatedContent && (
            <button
              onClick={() => setTranslatedContent(null)}
              className="text-xs mt-0.5"
              style={{ color: "#8E8E93" }}
            >
              {ft.showOriginal}
            </button>
          )}

          {/* Media */}
          {post.media_url && (
            <div className="mt-3">
              {post.media_type === "video" ? (
                <video
                  src={post.media_url}
                  controls
                  className="w-full max-h-80 rounded-lg object-cover"
                  preload="metadata"
                />
              ) : (
                <img
                  src={post.media_url}
                  alt="Post image"
                  className="w-full max-h-80 rounded-lg object-cover"
                  loading="lazy"
                />
              )}
            </div>
          )}

          {/* Actions bar */}
          <div
            className="flex items-center gap-5 mt-3"
            style={{ color: "#8E8E93" }}
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

            {/* Share — requires content disclaimer */}
            {post.is_shareable !== false && (
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
            )}

            {/* Translate */}
            {post.content && !isExclusiveLocked && (
              <button
                onClick={handleTranslate}
                disabled={isTranslating}
                className="flex items-center gap-1 text-xs transition-colors hover:text-teal-400 disabled:opacity-40"
                style={
                  translatedContent
                    ? { color: "#5ED1C4" }
                    : { color: "#8E8E93" }
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

            {/* Delete (owner or admin) */}
            {canDelete && (
              <button
                onClick={() => {
                  setDeleting(true);
                  onDelete(post.id);
                }}
                disabled={deleting}
                className="ml-auto text-xs hover:text-red-400 transition-colors"
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
              {/* "Replying to @username" context banner */}
              {post.author_username && (
                <div className="flex items-center gap-1.5 mb-2 text-xs">
                  <svg
                    className="w-3 h-3 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    style={{ color: "#8E8E93" }}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                    />
                  </svg>
                  <span style={{ color: "#8E8E93" }}>
                    {ft.replyingTo}{" "}
                    <span
                      className="font-medium"
                      style={{ color: "#5ED1C4" }}
                    >
                      @{post.author_username}
                    </span>
                  </span>
                </div>
              )}

              {loadingReplies ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>
                  {ft.loadingReplies}
                </p>
              ) : replies.length === 0 ? (
                <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
                  {ft.noRepliesYet}
                </p>
              ) : (
                <div className="space-y-3 mb-3">
                  {replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2">
                      <button
                        onClick={() => onAuthorTap?.(reply.author_id)}
                        className="flex-shrink-0"
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
                              background:
                                "linear-gradient(135deg, #D4007A, #E69138)",
                              color: "#fff",
                            }}
                          >
                            {(
                              reply.author_first_name ||
                              reply.author_username ||
                              "?"
                            )[0].toUpperCase()}
                          </div>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white truncate">
                            {reply.author_first_name || reply.author_username}
                          </span>
                          <span
                            className="text-xs"
                            style={{ color: "#8E8E93" }}
                          >
                            {timeAgo(reply.created_at)}
                          </span>
                        </div>
                        {/* Reply content — @mentions as clickable links */}
                        <MentionText
                          text={reply.content}
                          className="text-xs text-white/80 mt-0.5 whitespace-pre-wrap block"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply composer */}
              {currentUserId && (
                <div className="flex gap-2 items-end">
                  <MentionInput
                    value={replyText}
                    onChange={setReplyText}
                    placeholder={ft.writeReply}
                    maxLength={500}
                    rows={2}
                    disabled={sendingReply}
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
              background: "#1C1C1E",
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
        contentDisclaimerAccepted={contentDisclaimerAccepted}
        onAcceptDisclaimer={onAcceptDisclaimer}
      />
    </div>
  );
}
