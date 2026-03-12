import React, { useState, useCallback } from "react";
import { MentionText } from "@/components/MentionText";
import { MentionInput } from "@/components/MentionInput";
import { SharePostModal } from "@/components/SharePostModal";
import { NearbyBadge } from "@/components/NearbyBadge";
import FreeTierOverlay from "@/components/FreeTierOverlay";
import {
  getReplies,
  createReply,
  togglePostLike,
  adminFlagWofPost,
  adminUnflagWofPost,
  requestWofDeletion,
  type SocialPostItem,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { translateText } from "@/lib/feedI18n";

export interface SocialPostCardProps {
  post: SocialPostItem;
  currentUserId: string;
  isAdmin: boolean;
  userLang: string;
  onLike: (id: number) => void;
  onDelete: (id: number) => void;
  onWofToggle?: (id: number, nowWof: boolean) => void;
  onNavigate: (path: string) => void;
  contentDisclaimerAccepted?: boolean;
  onAcceptDisclaimer?: () => Promise<void>;
  viewerCity?: string | null;
  viewerCountry?: string | null;
}

function timeAgo(dateStr: string, nowLabel: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return nowLabel;
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

export default function SocialPostCard({
  post,
  currentUserId,
  isAdmin,
  userLang,
  onLike,
  onDelete,
  onWofToggle,
  onNavigate,
  contentDisclaimerAccepted,
  onAcceptDisclaimer,
  viewerCity,
  viewerCountry,
}: SocialPostCardProps) {
  const { feed: t } = useI18n();
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [disclaimerAccepting, setDisclaimerAccepting] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<SocialPostItem[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localReplyCount, setLocalReplyCount] = useState(post.replies_count || 0);
  const [wofDeleting, setWofDeleting] = useState(false);
  const [wofDeleted, setWofDeleted] = useState(false);
  const [isWof, setIsWof] = useState(post.is_wof ?? false);
  const [wofToggling, setWofToggling] = useState(false);
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const isOwn = String(post.author_id) === currentUserId;
  const canDelete = isOwn || isAdmin;

  const handleWofToggle = useCallback(async () => {
    if (wofToggling) return;
    setWofToggling(true);
    try {
      if (isWof) {
        await adminUnflagWofPost(post.id);
        setIsWof(false);
        onWofToggle?.(post.id, false);
      } else {
        await adminFlagWofPost(post.id);
        setIsWof(true);
        onWofToggle?.(post.id, true);
      }
    } catch { /* silent */ }
    setWofToggling(false);
  }, [post.id, isWof, wofToggling, onWofToggle]);

  const loadReplies = useCallback(async () => {
    if (loadingReplies) return;
    setLoadingReplies(true);
    try {
      const res = await getReplies(post.id);
      if (res.success) setReplies(res.replies);
    } catch { /* silent */ }
    setLoadingReplies(false);
  }, [post.id, loadingReplies]);

  const toggleReplies = useCallback(() => {
    const next = !showReplies;
    setShowReplies(next);
    if (next) {
      if (replies.length === 0) loadReplies();
      // Pre-fill reply with @authorUsername mention if not own post
      if (!isOwn && (post.author_username || post.author_first_name)) {
        const mention = `@${post.author_username || post.author_first_name} `;
        setReplyText((prev) => (prev.startsWith(mention) ? prev : mention));
      }
    }
  }, [showReplies, replies.length, loadReplies, isOwn, post.author_username, post.author_first_name]);

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
    } catch { /* silent */ }
    setSendingReply(false);
  }, [replyText, sendingReply, post]);

  const handleShare = useCallback(() => {
    setShowShareModal(true);
  }, []);

  const handleTranslate = useCallback(async () => {
    if (isTranslating) return;
    if (translatedContent) { setTranslatedContent(null); return; }
    if (!post.content) return;
    setIsTranslating(true);
    const result = await translateText(post.content, userLang || "en");
    if (result) setTranslatedContent(result);
    setIsTranslating(false);
  }, [isTranslating, translatedContent, post.content, userLang]);

  const handleRequestWofDeletion = useCallback(async () => {
    if (wofDeleting || wofDeleted) return;
    if (!confirm("Remove this Wall of Fame post from the feed?")) return;
    setWofDeleting(true);
    try {
      const res = await requestWofDeletion(post.id);
      if (res.success) {
        setWofDeleted(true);
        onDelete(post.id);
      }
    } catch { /* silent */ }
    setWofDeleting(false);
  }, [post.id, wofDeleting, wofDeleted, onDelete]);

  // handleLike delegates upward so parent can sync all feed slices
  const handleLike = useCallback(() => {
    onLike(post.id);
  }, [post.id, onLike]);

  const handleDelete = useCallback(() => {
    if (!confirm("Delete this post?")) return;
    setDeleting(true);
    onDelete(post.id);
    setTimeout(() => setDeleting(false), 5000);
  }, [post.id, onDelete]);

  const authorPath =
    String(post.author_id) === currentUserId
      ? "/profile"
      : `/profile/${post.author_id}`;

  return (
    <div
      className="glass-card-sm p-4"
      id={`post-${post.id}`}
      style={
        post.is_promoted
          ? {
              borderLeft: "3px solid transparent",
              borderImage: "linear-gradient(180deg, #D4007A, #E69138) 1",
            }
          : undefined
      }
    >
      <div className="flex gap-3">
        {/* Avatar — promoted posts show PNPtv logo, others show user photo */}
        <button
          onClick={() => (post.is_promoted ? undefined : onNavigate(authorPath))}
          className="flex-shrink-0"
        >
          {post.is_promoted ? (
            <img
              src="/Logo2-50.png"
              alt="PNPtv!"
              className="w-10 h-10 rounded-full object-cover"
              style={{ background: "#1a1a2e" }}
            />
          ) : isValidPhotoUrl(post.author_photo) ? (
            <img
              src={post.author_photo}
              alt={`${post.author_first_name || post.author_username || "User"}'s avatar`}
              className="w-10 h-10 rounded-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                const sib = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
                if (sib) sib.style.removeProperty("display");
              }}
            />
          ) : null}
          {!post.is_promoted && (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{
                background: "linear-gradient(135deg, #D4007A, #E69138)",
                color: "#fff",
                display: isValidPhotoUrl(post.author_photo) ? "none" : undefined,
              }}
            >
              {(post.author_first_name || post.author_username || "?")[0].toUpperCase()}
            </div>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onNavigate(authorPath)}
              className="font-semibold text-white text-sm truncate hover:underline"
            >
              {post.author_first_name || post.author_username || "Anonymous"}
            </button>
            {post.author_username && (
              <span className="text-xs" style={{ color: "#8E8E93" }}>
                @{post.author_username}
              </span>
            )}
            <span className="text-xs" style={{ color: "#8E8E93" }}>
              &middot; {timeAgo(post.created_at, t.translating)}
            </span>

            {/* Nearby badge */}
            {post.author_city && post.author_country && (
              <NearbyBadge
                userCity={post.author_city}
                userCountry={post.author_country}
                viewerCity={viewerCity}
                viewerCountry={viewerCountry}
                username={post.author_first_name || post.author_username || "User"}
              />
            )}

            {/* Featured / Promoted badge */}
            {post.is_promoted && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))",
                  color: "#FFB454",
                }}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                {t.featured}
              </span>
            )}
            {/* Wall of Fame badge */}
            {post.is_wof && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454" }}
              >
                {t.wallOfFame}
              </span>
            )}
            {/* Exclusive badges */}
            {post.is_exclusive && post.exclusive_status === "unlocked" && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}
              >
                Exclusive
              </span>
            )}
            {post.is_exclusive && post.exclusive_status === "teaser" && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}
              >
                PRIME Preview
              </span>
            )}
            {/* Verified creator badge */}
            {post.author_creator_verified && (
              <svg
                className="w-4 h-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="#5ED1C4"
                aria-label="Verified creator"
              >
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            )}

            {/* Admin: WoF flag toggle */}
            {isAdmin && (
              <button
                onClick={handleWofToggle}
                disabled={wofToggling}
                className="text-xs transition-colors disabled:opacity-40"
                style={{ color: isWof ? "#FFB454" : "#8E8E93" }}
                title={isWof ? "Remove from Wall of Fame" : "Add to Wall of Fame"}
                aria-label={isWof ? "Remove from Wall of Fame" : "Add to Wall of Fame"}
              >
                <svg
                  className="w-4 h-4"
                  fill={isWof ? "currentColor" : "none"}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                  />
                </svg>
              </button>
            )}

            {/* Delete (own posts or admin) */}
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="ml-auto text-xs hover:text-red-400 transition-colors"
                style={{ color: "#8E8E93" }}
                aria-label={
                  isAdmin && !isOwn ? "Delete post (admin)" : "Delete post"
                }
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

          {/* Tier-blurred content overlay */}
          {post.blurred ? (
            <FreeTierOverlay
              label={
                post.content_tier === "prime" || post.content_tier === "PRIME"
                  ? "PRIME post"
                  : "Member post"
              }
              requiredTier={
                post.content_tier === "prime" || post.content_tier === "PRIME"
                  ? "prime"
                  : "member"
              }
            >
              <div className="p-4 mt-1.5">
                <p className="text-sm text-white/60">
                  This content is available to{" "}
                  {post.content_tier === "prime" || post.content_tier === "PRIME"
                    ? "PRIME"
                    : "Member"}{" "}
                  members
                </p>
              </div>
            </FreeTierOverlay>
          ) : post.is_exclusive && post.exclusive_status === "locked" ? (
            <div
              className="mt-2 rounded-lg p-6 text-center"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <svg
                className="w-8 h-8 mx-auto mb-2 opacity-40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
              {post.locked_reason === "not_prime" ? (
                <>
                  <p className="text-sm text-white/60 mb-2">
                    Upgrade to PRIME to unlock creator content
                  </p>
                  <button
                    onClick={() => onNavigate("/subscribe")}
                    className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                    style={{
                      background: "linear-gradient(135deg, #D4007A, #E69138)",
                      color: "#fff",
                    }}
                  >
                    Upgrade to PRIME
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-white/60 mb-2">
                    Subscribe ${post.author_creator_price || 15}/mo to unlock
                  </p>
                  <button
                    onClick={() => onNavigate(`/profile/${post.author_id}`)}
                    className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                    style={{
                      background: "linear-gradient(135deg, #D4007A, #E69138)",
                      color: "#fff",
                    }}
                  >
                    Subscribe to {post.author_first_name || post.author_username}
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Promoted thumbnail banner */}
              {post.is_promoted && post.promoted_thumbnail && (
                <div className="mt-2 -mx-4">
                  <img
                    src={post.promoted_thumbnail}
                    alt="Featured content"
                    className="w-full max-h-56 object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).parentElement!.style.display =
                        "none";
                    }}
                  />
                </div>
              )}

              <MentionText
                text={translatedContent ?? post.content}
                className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed block"
              />
              {translatedContent && (
                <button
                  onClick={() => setTranslatedContent(null)}
                  className="text-xs mt-0.5"
                  style={{ color: "#8E8E93" }}
                >
                  {t.showOriginal}
                </button>
              )}

              {/* Promoted CTA button */}
              {post.is_promoted && post.promoted_link && (
                <button
                  onClick={() => {
                    const link = post.promoted_link!;
                    if (link.startsWith("/")) {
                      onNavigate(link);
                    } else if (link.startsWith("https://")) {
                      window.open(link, "_blank", "noopener,noreferrer");
                    }
                  }}
                  className="mt-3 w-full text-sm font-semibold py-2.5 rounded-lg transition-opacity hover:opacity-90"
                  style={{
                    background: "linear-gradient(135deg, #D4007A, #E69138)",
                    color: "#fff",
                  }}
                >
                  {post.promoted_link_label || "Watch Now"}
                </button>
              )}

              {/* Media */}
              {!post.is_promoted && post.media_url && (
                <div className="mt-3">
                  {post.media_type === "video" ? (
                    <>
                      {(post.video_title || post.video_description) && (
                        <div className="mb-2 px-1">
                          {post.video_title && (
                            <h4 className="text-sm font-semibold text-white">
                              {post.video_title}
                            </h4>
                          )}
                          {post.video_description && (
                            <p className="text-xs text-white/60 mt-0.5 line-clamp-2">
                              {post.video_description}
                            </p>
                          )}
                        </div>
                      )}
                      <video
                        src={post.media_url}
                        controls
                        playsInline
                        muted
                        className="w-full max-h-80 rounded-lg object-cover"
                        preload="metadata"
                        onError={(e) => {
                          (e.target as HTMLVideoElement).parentElement!.style.display =
                            "none";
                        }}
                      />
                    </>
                  ) : (
                    <img
                      src={post.media_url}
                      alt="Post image"
                      className="w-full max-h-80 rounded-lg object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).parentElement!.style.display =
                          "none";
                      }}
                    />
                  )}
                </div>
              )}

              {/* Teaser CTA */}
              {post.is_exclusive && post.exclusive_status === "teaser" && (
                <div
                  className="mt-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(94,209,196,0.08)", color: "#5ED1C4" }}
                >
                  Subscribe to see all exclusive content from this creator
                </div>
              )}
            </>
          )}

          {/* Actions bar */}
          <div
            className="flex items-center gap-3 mt-3 flex-wrap"
            style={{ color: "#8E8E93" }}
          >
            {/* Heart like */}
            <button
              onClick={handleLike}
              className="flex items-center gap-1.5 text-xs transition-colors hover:text-pink-400"
              style={{ color: post.liked_by_me ? "#D4007A" : "#8E8E93" }}
            >
              <svg
                className="w-4 h-4"
                fill={post.liked_by_me ? "currentColor" : "none"}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={post.liked_by_me ? 0 : 1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                />
              </svg>
              {(post.likes_count || 0) > 0 && <span>{post.likes_count}</span>}
            </button>

            {/* Comment / Reply toggle */}
            <button
              onClick={toggleReplies}
              className="flex items-center gap-1.5 text-xs hover:text-blue-400 transition-colors"
              style={showReplies ? { color: "#60A5FA" } : undefined}
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
            {post.content && !post.blurred && (
              <button
                onClick={handleTranslate}
                disabled={isTranslating}
                className="flex items-center gap-1 text-xs transition-colors hover:text-teal-400 disabled:opacity-40"
                style={translatedContent ? { color: "#5ED1C4" } : { color: "#8E8E93" }}
                title={translatedContent ? t.showOriginal : t.translate}
              >
                {isTranslating ? (
                  <span className="text-[10px]">{t.translating}</span>
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

            {/* Request Deletion — shown on WoF posts for the post author */}
            {post.is_wof && isOwn && !wofDeleted && (
              <button
                onClick={handleRequestWofDeletion}
                disabled={wofDeleting}
                className="flex items-center gap-1.5 text-xs ml-auto hover:text-red-400 transition-colors"
                style={{ color: "#8E8E93" }}
                title="Request removal from feed"
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
                {wofDeleting ? t.removing : t.remove}
              </button>
            )}
            {post.is_wof && isOwn && wofDeleted && (
              <span className="text-xs ml-auto" style={{ color: "#34D399" }}>
                Removed
              </span>
            )}
          </div>

          {/* Replies section */}
          {showReplies && (
            <div className="mt-3 pt-3 border-t border-white/10">
              {loadingReplies ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>
                  {t.loadingComments}
                </p>
              ) : replies.length === 0 ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>
                  {t.noCommentsYet}
                </p>
              ) : (
                <div className="space-y-3 mb-3">
                  {replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2">
                      <button
                        onClick={() =>
                          onNavigate(
                            String(reply.author_id) === currentUserId
                              ? "/profile"
                              : `/profile/${reply.author_id}`
                          )
                        }
                        className="flex-shrink-0"
                      >
                        {isValidPhotoUrl(reply.author_photo) ? (
                          <img
                            src={reply.author_photo}
                            alt={`${reply.author_first_name || reply.author_username || "User"}'s avatar`}
                            className="w-7 h-7 rounded-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                              const sib = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
                              if (sib) sib.style.removeProperty("display");
                            }}
                          />
                        ) : null}
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{
                            background:
                              "linear-gradient(135deg, #D4007A, #E69138)",
                            color: "#fff",
                            display: isValidPhotoUrl(reply.author_photo)
                              ? "none"
                              : undefined,
                          }}
                        >
                          {(
                            reply.author_first_name ||
                            reply.author_username ||
                            "?"
                          )[0].toUpperCase()}
                        </div>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white truncate">
                            {reply.author_first_name || reply.author_username}
                          </span>
                          <span className="text-xs" style={{ color: "#8E8E93" }}>
                            {timeAgo(reply.created_at, t.translating)}
                          </span>
                        </div>
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
                <>
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
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                        />
                      </svg>
                      <span style={{ color: "#8E8E93" }}>
                        {t.replyingTo}{" "}
                        <span
                          className="font-medium"
                          style={{ color: "#5ED1C4" }}
                        >
                          @{post.author_username}
                        </span>
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2 items-end">
                    <MentionInput
                      value={replyText}
                      onChange={setReplyText}
                      placeholder={t.writeReply}
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
                      {sendingReply ? "..." : t.reply}
                    </button>
                  </div>
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
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
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
                    handleShare();
                  } catch { /* silent */ }
                  setDisclaimerAccepting(false);
                }}
                disabled={disclaimerAccepting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                style={{
                  background: "linear-gradient(135deg, #D4007A, #E69138)",
                }}
              >
                {disclaimerAccepting ? "..." : "Accept & Share"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Post Modal */}
      <SharePostModal
        postId={post.id}
        postContent={post.content}
        authorName={post.author_first_name || post.author_username}
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
      />
    </div>
  );
}
