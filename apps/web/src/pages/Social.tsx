import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useNavigate } from "react-router-dom";
import { Modal } from "@pnptv/ui-kit";
import FreeTierOverlay from "@/components/FreeTierOverlay";
import { BulkVideoUpload } from "@/components/BulkVideoUpload";
import { PostComposer } from "@/components/PostComposer";
import { SharePostModal } from "@/components/SharePostModal";
import {
  getSocialFeedPosts,
  getWofFeedPosts,
  getFollowingFeed,
  togglePostLike,
  deleteSocialPost,
  requestWofDeletion,
  adminFlagWofPost,
  adminUnflagWofPost,
  getReplies,
  createReply,
  checkAuthStatus,
  getFeaturedPerformers,
  updateProfile,
  type SocialPostItem,
  type AuthMethods,
  type FeaturedPerformer,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { translateText } from "@/lib/feedI18n";
import { NearbyBadge } from "@/components/NearbyBadge";


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

/** Check if a photo value is a valid web URL (not a Telegram file ID) */
function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}



// ── Post Card ────────────────────────────────────────────────────────────────

function PostCard({
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
}: {
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
}) {
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
        setReplyText(prev => (prev.startsWith(mention) ? prev : mention));
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

  const authorPath = String(post.author_id) === currentUserId ? "/profile" : `/profile/${post.author_id}`;

  return (
    <div
      className="glass-card-sm p-4"
      id={`post-${post.id}`}
      style={post.is_promoted ? { borderLeft: "3px solid transparent", borderImage: "linear-gradient(180deg, #D4007A, #E69138) 1" } : undefined}
    >
      <div className="flex gap-3">
        {/* Avatar — promoted posts show PNPtv logo, others show user photo */}
        <button onClick={() => post.is_promoted ? undefined : onNavigate(authorPath)} className="flex-shrink-0">
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
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty("display"); }}
            />
          ) : null}
          {!post.is_promoted && (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: isValidPhotoUrl(post.author_photo) ? "none" : undefined }}
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
              <span className="text-xs" style={{ color: "#8E8E93" }}>@{post.author_username}</span>
            )}
            <span className="text-xs" style={{ color: "#8E8E93" }}>&middot; {timeAgo(post.created_at, t.translating)}</span>

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
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", color: "#FFB454" }}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                {t.featured}
              </span>
            )}
            {/* Wall of Fame badge */}
            {post.is_wof && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454" }}>
                {t.wallOfFame}
              </span>
            )}
            {/* Exclusive badges */}
            {post.is_exclusive && post.exclusive_status === "unlocked" && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                Exclusive
              </span>
            )}
            {post.is_exclusive && post.exclusive_status === "teaser" && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>
                PRIME Preview
              </span>
            )}
            {/* Verified creator badge */}
            {post.author_creator_verified && (
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#5ED1C4" aria-label="Verified creator">
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
                <svg className="w-4 h-4" fill={isWof ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
              </button>
            )}

            {/* Delete (own posts or admin) */}
            {canDelete && (
              <button
                onClick={() => { setDeleting(true); onDelete(post.id); setTimeout(() => setDeleting(false), 5000); }}
                disabled={deleting}
                className="ml-auto text-xs hover:text-red-400 transition-colors"
                style={{ color: "#8E8E93" }}
                aria-label={isAdmin && !isOwn ? "Delete post (admin)" : "Delete post"}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
          </div>

          {/* Tier-blurred content overlay (free-tier users viewing member/prime posts) */}
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
          ) : /* Locked exclusive content overlay */
          post.is_exclusive && post.exclusive_status === "locked" ? (
            <div className="mt-2 rounded-lg p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              {post.locked_reason === "not_prime" ? (
                <>
                  <p className="text-sm text-white/60 mb-2">Upgrade to PRIME to unlock creator content</p>
                  <button
                    onClick={() => onNavigate("/subscribe")}
                    className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
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
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
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
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                  />
                </div>
              )}

              <p className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed">
                {translatedContent ?? post.content}
              </p>
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
                    if (link.startsWith('/')) {
                      onNavigate(link);
                    } else if (link.startsWith('https://')) {
                      window.open(link, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="mt-3 w-full text-sm font-semibold py-2.5 rounded-lg transition-opacity hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
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
                            <h4 className="text-sm font-semibold text-white">{post.video_title}</h4>
                          )}
                          {post.video_description && (
                            <p className="text-xs text-white/60 mt-0.5 line-clamp-2">{post.video_description}</p>
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
                        onError={(e) => { (e.target as HTMLVideoElement).parentElement!.style.display = "none"; }}
                      />
                    </>
                  ) : (
                    <img
                      src={post.media_url}
                      alt="Post image"
                      className="w-full max-h-80 rounded-lg object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                    />
                  )}
                </div>
              )}

              {/* Teaser CTA */}
              {post.is_exclusive && post.exclusive_status === "teaser" && (
                <div className="mt-2 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(94,209,196,0.08)", color: "#5ED1C4" }}>
                  Subscribe to see all exclusive content from this creator
                </div>
              )}
            </>
          )}

          {/* Actions bar */}
          <div className="flex items-center gap-3 mt-3 flex-wrap" style={{ color: "#8E8E93" }}>
            {/* Heart like */}
            <button
              onClick={() => onLike(post.id)}
              className="flex items-center gap-1.5 text-xs transition-colors hover:text-pink-400"
              style={{ color: post.liked_by_me ? "#D4007A" : "#8E8E93" }}
            >
              <svg className="w-4 h-4" fill={post.liked_by_me ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={post.liked_by_me ? 0 : 1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              {(post.likes_count || 0) > 0 && <span>{post.likes_count}</span>}
            </button>

            {/* Comment */}
            <button
              onClick={toggleReplies}
              className="flex items-center gap-1.5 text-xs hover:text-blue-400 transition-colors"
              style={showReplies ? { color: "#60A5FA" } : undefined}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
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
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
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
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
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
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                {wofDeleting ? t.removing : t.remove}
              </button>
            )}
            {post.is_wof && isOwn && wofDeleted && (
              <span className="text-xs ml-auto" style={{ color: "#34D399" }}>Removed</span>
            )}
          </div>

          {/* Replies section */}
          {showReplies && (
            <div className="mt-3 pt-3 border-t border-white/10">
              {loadingReplies ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{t.loadingComments}</p>
              ) : replies.length === 0 ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{t.noCommentsYet}</p>
              ) : (
                <div className="space-y-3 mb-3">
                  {replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2">
                      <button onClick={() => onNavigate(String(reply.author_id) === currentUserId ? "/profile" : `/profile/${reply.author_id}`)} className="flex-shrink-0">
                        {isValidPhotoUrl(reply.author_photo) ? (
                          <img src={reply.author_photo} alt={`${reply.author_first_name || reply.author_username || "User"}'s avatar`} className="w-7 h-7 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty("display"); }} />
                        ) : null}
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: isValidPhotoUrl(reply.author_photo) ? "none" : undefined }}>
                          {(reply.author_first_name || reply.author_username || "?")[0].toUpperCase()}
                        </div>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white truncate">{reply.author_first_name || reply.author_username}</span>
                          <span className="text-xs" style={{ color: "#8E8E93" }}>{timeAgo(reply.created_at, t.translating)}</span>
                        </div>
                        <p className="text-xs text-white/80 mt-0.5 whitespace-pre-wrap">{reply.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply composer */}
              {currentUserId && (
                <div className="flex gap-2 items-end">
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value.slice(0, 500))}
                    placeholder={t.writeComment}
                    className="flex-1 bg-white/5 text-white text-xs rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-white/30 placeholder:text-white/30"
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendReply()}
                    disabled={sendingReply}
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || sendingReply}
                    className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-30 transition-colors"
                    style={{ color: "#D4007A" }}
                  >
                    {sendingReply ? "..." : t.send}
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
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowDisclaimerModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5 space-y-4"
            style={{ background: "#1C1C1E", border: "1px solid rgba(212,0,122,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-white">Content Sharing Disclaimer</h3>
            </div>
            <p className="text-sm text-white/80 leading-relaxed">
              By accepting this disclaimer, you acknowledge that you are responsible for any content you share from this platform.
              Shared content must comply with our community guidelines and applicable laws.
            </p>
            <p className="text-xs text-white/50 leading-relaxed">
              This action is permanent and cannot be undone. Your acceptance date, time, and IP address will be recorded.
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
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
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

// ── Social Feed Page ─────────────────────────────────────────────────────────

export default function Social() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const currentUserId = String(user?.id || "");
  const { showTutorial, dismissTutorial } = useTutorial("social");
  const { feed: t } = useI18n();

  // Tab state
  const [activeTab, setActiveTab] = useState<"all" | "wof" | "following">("all");

  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // WoF tab state
  const [wofPosts, setWofPosts] = useState<SocialPostItem[]>([]);
  const [wofLoading, setWofLoading] = useState(false);
  const [wofError, setWofError] = useState<string | null>(null);
  const [wofNextCursor, setWofNextCursor] = useState<string | null>(null);
  const [wofLoadingMore, setWofLoadingMore] = useState(false);
  const [wofLoaded, setWofLoaded] = useState(false);

  // Following tab state
  const [followingPosts, setFollowingPosts] = useState<SocialPostItem[]>([]);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [followingError, setFollowingError] = useState<string | null>(null);
  const [followingNextCursor, setFollowingNextCursor] = useState<string | null>(null);
  const [followingLoadingMore, setFollowingLoadingMore] = useState(false);
  const [followingLoaded, setFollowingLoaded] = useState(false);

  // Featured performers
  const [featuredPerformers, setFeaturedPerformers] = useState<FeaturedPerformer[]>([]);

  // Content disclaimer state
  const [contentDisclaimer, setContentDisclaimer] = useState(user?.contentDisclaimer || false);
  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
    setContentDisclaimer(true);
  }, []);

  useEffect(() => {
    getFeaturedPerformers()
      .then((res) => { if (res.success) setFeaturedPerformers(res.performers); })
      .catch(() => { /* non-critical */ });
  }, []);

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
        // Non-critical — silently ignore
      });
  }, [isAuthenticated]);

  // Creator status (for bulk upload button visibility)
  const [isActiveCreator, setIsActiveCreator] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // Load feed
  const loadFeed = useCallback(async (cursor?: string) => {
    try {
      const res = await getSocialFeedPosts(cursor, 20);
      if (res.success) {
        if (cursor) {
          setPosts((prev) => [...prev, ...res.posts]);
        } else {
          setPosts(res.posts);
        }
        setNextCursor(res.nextCursor);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feed");
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    loadFeed(nextCursor);
  }, [nextCursor, loadingMore, loadFeed]);

  // WoF feed loading (lazy — only when tab is first selected)
  const loadWofFeed = useCallback(async (cursor?: string) => {
    try {
      const res = await getWofFeedPosts(cursor, 20);
      if (res.success) {
        if (cursor) {
          setWofPosts((prev) => [...prev, ...res.posts]);
        } else {
          setWofPosts(res.posts);
        }
        setWofNextCursor(res.nextCursor);
      }
    } catch (err) {
      setWofError(err instanceof Error ? err.message : "Failed to load Wall of Fame feed");
    } finally {
      setWofLoading(false);
      setWofLoadingMore(false);
    }
  }, []);

  const loadFollowingFeed = useCallback(async (cursor?: string) => {
    try {
      const res = await getFollowingFeed(cursor);
      if (res.success) {
        if (cursor) {
          setFollowingPosts((prev) => [...prev, ...res.posts]);
        } else {
          setFollowingPosts(res.posts);
        }
        setFollowingNextCursor(res.nextCursor);
      }
    } catch (err) {
      setFollowingError(err instanceof Error ? err.message : "Failed to load following feed");
    } finally {
      setFollowingLoading(false);
      setFollowingLoadingMore(false);
    }
  }, []);

  const handleTabChange = useCallback((tab: "all" | "wof" | "following") => {
    setActiveTab(tab);
    if (tab === "wof" && !wofLoaded) {
      setWofLoading(true);
      setWofLoaded(true);
      loadWofFeed();
    }
    if (tab === "following" && !followingLoaded) {
      setFollowingLoading(true);
      setFollowingLoaded(true);
      loadFollowingFeed();
    }
  }, [wofLoaded, followingLoaded, loadWofFeed, loadFollowingFeed]);

  const handleWofLoadMore = useCallback(() => {
    if (!wofNextCursor || wofLoadingMore) return;
    setWofLoadingMore(true);
    loadWofFeed(wofNextCursor);
  }, [wofNextCursor, wofLoadingMore, loadWofFeed]);

  const handleFollowingLoadMore = useCallback(() => {
    if (!followingNextCursor || followingLoadingMore) return;
    setFollowingLoadingMore(true);
    loadFollowingFeed(followingNextCursor);
  }, [followingNextCursor, followingLoadingMore, loadFollowingFeed]);

  // Like — update all feed arrays so switching tabs stays consistent
  const handleLike = useCallback(async (postId: number) => {
    try {
      const res = await togglePostLike(postId);
      const updater = (prev: SocialPostItem[]) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: res.liked,
                likes_count: res.likes_count ?? (p.likes_count + (res.liked ? 1 : -1)),
              }
            : p
        );
      setPosts(updater);
      setWofPosts(updater);
      setFollowingPosts(updater);
    } catch { /* silent */ }
  }, []);

  // Delete — remove from all arrays
  const handleDelete = useCallback(async (postId: number) => {
    if (!confirm("Delete this post?")) return;
    try {
      await deleteSocialPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setWofPosts((prev) => prev.filter((p) => p.id !== postId));
      setFollowingPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch { /* silent */ }
  }, []);

  const handleWofToggle = useCallback((postId: number, nowWof: boolean) => {
    // Update is_wof flag across all feed slices
    const updater = (prev: SocialPostItem[]) =>
      prev.map((p) => p.id === postId ? { ...p, is_wof: nowWof } : p);
    setPosts(updater);
    setWofPosts(nowWof
      ? (prev) => prev // already there if it was in WoF tab
      : (prev) => prev.filter((p) => p.id !== postId)); // remove if unflagged
    setFollowingPosts(updater);
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>{t.socialFeedTitle} — PNPtv!</title>
        <meta name="description" content={t.socialFeedSubtitle} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="social" onDismiss={dismissTutorial} />}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t.socialFeedTitle}</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            {t.socialFeedSubtitle}
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454" }}>
          {t.community}
        </span>
      </div>

      {/* Featured Performers */}
      {featuredPerformers.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-white">{t.featured}</h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(94,209,196,0.12)", color: "#5ED1C4" }}
            >
              {t.live}
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {featuredPerformers.map((p) => (
              <div
                key={p.id}
                onClick={() => p.userId && navigate(`/profile/${p.userId}`)}
                className={`glass-card-sm p-3 flex-shrink-0 w-28 text-center${p.userId ? " cursor-pointer hover:opacity-80 active:scale-95 transition-all" : ""}`}
                style={{ borderColor: "rgba(94,209,196,0.18)" }}
              >
                <div className="relative mx-auto mb-2 w-14 h-14">
                  {isValidPhotoUrl(p.photoUrl) ? (
                    <img
                      src={p.photoUrl}
                      alt={p.displayName}
                      className="w-14 h-14 rounded-full object-cover"
                      style={{ border: "2px solid #5ED1C4" }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold"
                    style={{
                      background: "linear-gradient(135deg, #5ED1C4, #D4007A)",
                      color: "#fff",
                      border: "2px solid #5ED1C4",
                      display: isValidPhotoUrl(p.photoUrl) ? "none" : undefined,
                    }}
                  >
                    {p.displayName[0]}
                  </div>
                  {/* Availability dot */}
                  <span
                    className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
                    style={{
                      background: p.isAvailable ? "#30D158" : "#8E8E93",
                      borderColor: "rgba(30,30,30,0.9)",
                    }}
                  />
                </div>
                <p className="text-xs font-medium text-white truncate">{p.displayName}</p>
                {p.averageRating > 0 && (
                  <p className="text-[10px] mt-0.5" style={{ color: "#5ED1C4" }}>
                    {"★".repeat(Math.round(p.averageRating))} {p.averageRating.toFixed(1)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Post Composer (hidden on WoF tab) */}
      {isAuthenticated && activeTab === "all" && (
        <div className="mb-6">
          {/* Bulk video upload panel (active creators only) */}
          {isActiveCreator && showBulkUpload ? (
            <div className="glass-card-sm p-4">
              <BulkVideoUpload
                onSuccess={(newPosts) => {
                  setPosts((prev) => [...newPosts.reverse(), ...prev]);
                  setShowBulkUpload(false);
                }}
                onCancel={() => setShowBulkUpload(false)}
              />
            </div>
          ) : (
            <>
              <PostComposer
                onPostCreated={(newPost) => {
                  setPosts((prev) => [newPost, ...prev]);
                }}
              />
              {/* Bulk Videos button — active creators only */}
              {isActiveCreator && (
                <button
                  onClick={() => setShowBulkUpload(true)}
                  className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 transition-colors w-full justify-center"
                  style={{ color: "#E69138" }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                  {t.bulkUploadVideos}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex border-b border-white/10 mb-4">
        <button
          onClick={() => handleTabChange("all")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "all" ? "text-white border-b-2" : "text-white/50"
          }`}
          style={activeTab === "all" ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
        >
          {t.allPosts}
        </button>
        <button
          onClick={() => handleTabChange("wof")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "wof" ? "text-white border-b-2" : "text-white/50"
          }`}
          style={activeTab === "wof" ? { borderImage: "linear-gradient(to right, #FFB454, #E69138) 1" } : undefined}
        >
          {t.wallOfFame}
        </button>
        {isAuthenticated && (
          <button
            onClick={() => handleTabChange("following")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
              activeTab === "following" ? "text-white border-b-2" : "text-white/50"
            }`}
            style={activeTab === "following" ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
          >
            {t.following}
          </button>
        )}
      </div>

      {/* ── All Posts Feed ── */}
      {activeTab === "all" && (isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-full" />
                  <div className="h-3 bg-white/10 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-white font-medium mb-1">{t.feedUnavailable}</p>
          <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{error}</p>
          <button onClick={() => { setError(null); setIsLoading(true); loadFeed(); }} className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold">
            {t.retry}
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <p className="text-white font-medium mb-1">{t.noPostsYet}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>{t.beTheFirst}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              userLang={user?.language || "en"}
              onLike={handleLike}
              onDelete={handleDelete}
              onWofToggle={handleWofToggle}
              onNavigate={navigate}
              contentDisclaimerAccepted={contentDisclaimer}
              onAcceptDisclaimer={handleAcceptDisclaimer}
              viewerCity={user?.city}
              viewerCountry={user?.country}
            />
          ))}

          {/* Load more */}
          {nextCursor && (
            <div className="text-center pt-2 pb-4">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-sm font-medium px-6 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: "#D4007A" }}
              >
                {loadingMore ? t.loading : t.loadMore}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* ── Wall of Fame Feed ── */}
      {activeTab === "wof" && (wofLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-full" />
                  <div className="h-3 bg-white/10 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : wofError ? (
        <div className="glass-card-sm p-8 text-center">
          <p className="text-white font-medium mb-1">{t.feedUnavailable}</p>
          <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{wofError}</p>
          <button onClick={() => { setWofError(null); setWofLoading(true); loadWofFeed(); }} className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold">
            {t.retry}
          </button>
        </div>
      ) : wofPosts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#FFB454" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.93m0 0a6.022 6.022 0 01-2.77-.93" />
          </svg>
          <p className="text-white font-medium mb-1">{t.noWofPostsYet}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {t.wofHint}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {wofPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              userLang={user?.language || "en"}
              onLike={handleLike}
              onDelete={handleDelete}
              onWofToggle={handleWofToggle}
              onNavigate={navigate}
              contentDisclaimerAccepted={contentDisclaimer}
              onAcceptDisclaimer={handleAcceptDisclaimer}
              viewerCity={user?.city}
              viewerCountry={user?.country}
            />
          ))}

          {/* Load more */}
          {wofNextCursor && (
            <div className="text-center pt-2 pb-4">
              <button
                onClick={handleWofLoadMore}
                disabled={wofLoadingMore}
                className="text-sm font-medium px-6 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: "#FFB454" }}
              >
                {wofLoadingMore ? t.loading : t.loadMore}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* ── Following Feed ── */}
      {activeTab === "following" && (followingLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-full" />
                  <div className="h-3 bg-white/10 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : followingError ? (
        <div className="glass-card-sm p-8 text-center">
          <p className="text-white font-medium mb-1">{t.feedUnavailable}</p>
          <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{followingError}</p>
          <button
            onClick={() => { setFollowingError(null); setFollowingLoading(true); loadFollowingFeed(); }}
            className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold"
          >
            {t.retry}
          </button>
        </div>
      ) : followingPosts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          <p className="text-white font-medium mb-1">{t.noFollowingPostsYet}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {t.followSomeone}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {followingPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              userLang={user?.language || "en"}
              onLike={handleLike}
              onDelete={handleDelete}
              onWofToggle={handleWofToggle}
              onNavigate={navigate}
              contentDisclaimerAccepted={contentDisclaimer}
              onAcceptDisclaimer={handleAcceptDisclaimer}
              viewerCity={user?.city}
              viewerCountry={user?.country}
            />
          ))}
          {followingNextCursor && (
            <div className="text-center pt-2 pb-4">
              <button
                onClick={handleFollowingLoadMore}
                disabled={followingLoadingMore}
                className="text-sm font-medium px-6 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: "#D4007A" }}
              >
                {followingLoadingMore ? t.loading : t.loadMore}
              </button>
            </div>
          )}
        </div>
      ))}

    </div>
  );
}
