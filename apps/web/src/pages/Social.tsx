import React, { useState, useEffect, useRef, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useNavigate } from "react-router-dom";
import { Modal } from "@pnptv/ui-kit";
import FreeTierOverlay from "@/components/FreeTierOverlay";
import { BulkVideoUpload } from "@/components/BulkVideoUpload";
import {
  getSocialFeedPosts,
  getWofFeedPosts,
  getFollowingFeed,
  createSocialPost,
  togglePostLike,
  deleteSocialPost,
  requestWofDeletion,
  getReplies,
  createReply,
  checkAuthStatus,
  getFeaturedPerformers,
  type SocialPostItem,
  type AuthMethods,
  type FeaturedPerformer,
} from "@/lib/api";

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
  return `${Math.floor(days / 30)}mo`;
}

/** Check if a photo value is a valid web URL (not a Telegram file ID) */
function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

// ── Bluesky SVG Icon ─────────────────────────────────────────────────────────

function BlueskySvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 320" fill="currentColor" aria-hidden="true">
      <path d="M180 142c-16.3-31.7-60.7-90.8-102-120C38.5-2.9 27.2 1 18.8 1 8.3 1 0 7.8 0 25.4 0 39 6.6 116.7 10.3 132.9 23 187.7 74.3 207 122.7 202c-71 10.5-133.3 41-67.3 147.9 51.7 81.4 103.3 27.8 127.2 0 24-27.9 53.7-87.3 53.7-87.3s29.7 59.4 53.7 87.3c23.9 27.8 75.5 81.4 127.2 0 66-106.9 3.7-137.4-67.3-147.9 48.4 5 99.7-14.3 112.4-69.1 3.7-16.2 10.3-93.9 10.3-107.5C360 7.8 351.7 1 341.2 1c-8.4 0-19.7-3.9-59.2 21C240.7 51.2 196.3 110.3 180 142z" />
    </svg>
  );
}

/** Small inline Bluesky badge shown on cross-posted/sourced posts */
function BlueskyBadge({
  uri,
  label = "Bluesky",
}: {
  uri?: string | null;
  label?: string;
}) {
  const href = uri
    ? `https://bsky.app/profile/${uri.split("/")[2]}/post/${uri.split("/").pop()}`
    : undefined;

  const inner = (
    <span className="badge-bluesky inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full">
      <BlueskySvg className="w-2.5 h-2.5 flex-shrink-0" />
      {label}
    </span>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View on Bluesky"
        className="hover:opacity-80 transition-opacity"
      >
        {inner}
      </a>
    );
  }

  return inner;
}

// ── Post Card ────────────────────────────────────────────────────────────────

function PostCard({
  post,
  currentUserId,
  isAdmin,
  onLike,
  onDelete,
  onNavigate,
}: {
  post: SocialPostItem;
  currentUserId: string;
  isAdmin: boolean;
  onLike: (id: number) => void;
  onDelete: (id: number) => void;
  onNavigate: (path: string) => void;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<SocialPostItem[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localReplyCount, setLocalReplyCount] = useState(post.replies_count || 0);
  const [wofDeleting, setWofDeleting] = useState(false);
  const [wofDeleted, setWofDeleted] = useState(false);
  const isOwn = String(post.author_id) === currentUserId;
  const canDelete = isOwn || isAdmin;

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
    if (next && replies.length === 0) loadReplies();
  }, [showReplies, replies.length, loadReplies]);

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

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/social#post-${post.id}`;
    const text = `${post.author_first_name || post.author_username || "Someone"}: ${post.content.slice(0, 100)}`;
    if (navigator.share) {
      try { await navigator.share({ title: "PNPtv Post", text, url }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      // Brief visual feedback handled by button state
    }
  }, [post]);

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
            <span className="text-xs" style={{ color: "#8E8E93" }}>&middot; {timeAgo(post.created_at)}</span>

            {/* Bluesky cross-posted badge */}
            {post.bluesky_uri && (
              <BlueskyBadge uri={post.bluesky_uri} label="Bluesky" />
            )}
            {/* Bluesky-sourced post badge (imported from BSky) */}
            {post.source === "bluesky" && !post.bluesky_uri && (
              <BlueskyBadge label="From Bluesky" />
            )}
            {/* Featured / Promoted badge */}
            {post.is_promoted && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", color: "#FFB454" }}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                Featured
              </span>
            )}
            {/* Wall of Fame badge */}
            {post.is_wof && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454" }}>
                Wall of Fame
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
                {post.content}
              </p>

              {/* Promoted CTA button */}
              {post.is_promoted && post.promoted_link && (
                <button
                  onClick={() => onNavigate(post.promoted_link!)}
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
                    <video
                      src={post.media_url}
                      controls
                      className="w-full max-h-80 rounded-lg object-cover"
                      preload="metadata"
                      onError={(e) => { (e.target as HTMLVideoElement).parentElement!.style.display = "none"; }}
                    />
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
          <div className="flex items-center gap-5 mt-3" style={{ color: "#8E8E93" }}>
            {/* Like */}
            <button
              onClick={() => onLike(post.id)}
              className="flex items-center gap-1.5 text-xs hover:text-pink-400 transition-colors"
              style={post.liked_by_me ? { color: "#D4007A" } : undefined}
            >
              <svg className="w-4 h-4" fill={post.liked_by_me ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              {post.likes_count > 0 && <span>{post.likes_count}</span>}
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

            {/* Share — only shown when poster allows sharing */}
            {post.is_shareable !== false && (
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 text-xs hover:text-green-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
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
                {wofDeleting ? "Removing..." : "Remove"}
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
                <p className="text-xs" style={{ color: "#8E8E93" }}>Loading comments...</p>
              ) : replies.length === 0 ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>No comments yet</p>
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
                          <span className="text-xs" style={{ color: "#8E8E93" }}>{timeAgo(reply.created_at)}</span>
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
                    placeholder="Write a comment..."
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
                    {sendingReply ? "..." : "Send"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Social Feed Page ─────────────────────────────────────────────────────────

export default function Social() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const currentUserId = String(user?.id || "");
  const { showTutorial, dismissTutorial } = useTutorial("social");

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

  useEffect(() => {
    getFeaturedPerformers()
      .then((res) => { if (res.success) setFeaturedPerformers(res.performers); })
      .catch(() => { /* non-critical */ });
  }, []);

  // Bluesky linked state — checked once when component mounts
  const [blueskyLinked, setBlueskyLinked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    checkAuthStatus()
      .then((status) => {
        if (status.authenticated && status.user) {
          const methods = status.user.auth_methods as AuthMethods | undefined;
          setBlueskyLinked(!!methods?.atproto);
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

  // Composer state
  const [text, setText] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [crossPostBluesky, setCrossPostBluesky] = useState(false);
  const [showBlueskyWarning, setShowBlueskyWarning] = useState(false);
  const [isExclusive, setIsExclusive] = useState(false);
  const [isShareable, setIsShareable] = useState(true);
  const [isActiveCreator, setIsActiveCreator] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Post composer
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  }, []);

  const clearMedia = useCallback(() => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [mediaPreview]);

  const submitPost = useCallback(async () => {
    if (!text.trim() || isPosting) return;
    setIsPosting(true);
    setPostError(null);
    try {
      const res = await createSocialPost(
        text.trim(),
        mediaFile || undefined,
        crossPostBluesky,
        isExclusive,
        isShareable
      );
      if (res.success && res.post) {
        setPosts((prev) => [res.post, ...prev]);
      }
      setText("");
      clearMedia();
      setCrossPostBluesky(false);
      setIsExclusive(false);
      setIsShareable(true);
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : "Failed to create post");
    } finally {
      setIsPosting(false);
    }
  }, [text, mediaFile, isPosting, clearMedia, crossPostBluesky, isExclusive, isShareable]);

  const handlePost = useCallback(() => {
    if (!text.trim() || isPosting) return;
    if (crossPostBluesky) {
      setShowBlueskyWarning(true);
      return;
    }
    submitPost();
  }, [text, isPosting, crossPostBluesky, submitPost]);

  const confirmCrossPost = useCallback(() => {
    setShowBlueskyWarning(false);
    submitPost();
  }, [submitPost]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>Social Feed — PNPtv!</title>
        <meta name="description" content="Browse and share posts with the PNPtv community. Like, comment, and connect with members." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="social" onDismiss={dismissTutorial} />}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Social Feed</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            Share updates with the PNPTV community
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454" }}>
          Community
        </span>
      </div>

      {/* Featured Performers */}
      {featuredPerformers.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-white">Featured</h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(94,209,196,0.12)", color: "#5ED1C4" }}
            >
              Live
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
        <div className="glass-card-sm p-4 mb-6">
          {/* Bulk video upload panel (active creators only) */}
          {isActiveCreator && showBulkUpload && (
            <BulkVideoUpload
              onSuccess={(newPosts) => {
                setPosts((prev) => [...newPosts.reverse(), ...prev]);
                setShowBulkUpload(false);
              }}
              onCancel={() => setShowBulkUpload(false)}
            />
          )}
          {isActiveCreator && showBulkUpload ? null : (
          <div className="flex gap-3">
            {/* Composer avatar — show user photo */}
            {isValidPhotoUrl(user?.photoUrl) ? (
              <img src={user.photoUrl} alt={`${user?.displayName || "User"}'s avatar`} className="w-10 h-10 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {(user?.displayName || "U")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 2000))}
                placeholder="What's on your mind?"
                className="w-full bg-transparent text-white text-sm py-2 border-b border-white/10 mb-3 resize-none outline-none placeholder:text-white/40"
                rows={3}
                disabled={isPosting}
              />

              <div className="flex justify-end mb-2">
                <span className={`text-xs ${text.length > 1800 ? "text-red-400" : ""}`} style={{ color: text.length > 1800 ? undefined : "#8E8E93" }}>
                  {text.length}/2000
                </span>
              </div>

              {/* Media preview */}
              {mediaPreview && (
                <div className="relative mb-3 inline-block">
                  {mediaFile && mediaFile.type.startsWith("video/") ? (
                    <video src={mediaPreview} className="max-h-48 rounded-lg object-cover" muted />
                  ) : (
                    <img src={mediaPreview} alt="Preview" className="max-h-48 rounded-lg object-cover" />
                  )}
                  <button
                    onClick={clearMedia}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                    style={{ background: "rgba(0,0,0,0.7)" }}
                  >
                    &times;
                  </button>
                </div>
              )}

              {postError && <p className="text-xs text-red-400 mb-2">{postError}</p>}

              {/* Actions */}
              <div className="flex flex-col gap-3">
                {/* Media buttons row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <button
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = "image/jpeg,image/png,image/webp,image/gif";
                          fileInputRef.current.click();
                          fileInputRef.current.accept = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";
                        }
                      }}
                      disabled={isPosting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 transition-colors disabled:opacity-40"
                      style={{ color: "#D4007A" }}
                      aria-label="Attach photo"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                      </svg>
                      Photo
                    </button>
                    <button
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = "video/mp4,video/webm";
                          fileInputRef.current.click();
                          fileInputRef.current.accept = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";
                        }
                      }}
                      disabled={isPosting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 transition-colors disabled:opacity-40"
                      style={{ color: "#E69138" }}
                      aria-label="Attach video"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                      Video
                    </button>
                  </div>
                  <button
                    onClick={handlePost}
                    disabled={!text.trim() || isPosting}
                    className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40 min-h-[36px]"
                  >
                    {isPosting ? "Posting..." : "Post"}
                  </button>
                </div>

                {/* Exclusive content toggle — only shown for active creators */}
                {isActiveCreator && (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.2)" }}>
                    <label
                      htmlFor="exclusive-toggle"
                      className="flex items-center gap-2 cursor-pointer select-none flex-1"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#D4007A" }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                      <span className="text-xs font-medium" style={{ color: isExclusive ? "#D4007A" : "#8E8E93" }}>
                        Exclusive content (subscribers only)
                      </span>
                    </label>
                    <button
                      id="exclusive-toggle"
                      role="switch"
                      aria-checked={isExclusive}
                      aria-label="Mark as exclusive"
                      onClick={() => setIsExclusive((v) => !v)}
                      disabled={isPosting}
                      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                      style={{
                        background: isExclusive ? "#D4007A" : "rgba(255,255,255,0.15)",
                        outlineOffset: "2px",
                      }}
                    >
                      <span
                        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
                        style={{ transform: isExclusive ? "translateX(18px)" : "translateX(2px)" }}
                      />
                    </button>
                  </div>
                )}

                {/* Bluesky cross-post toggle — only shown when Bluesky is linked */}
                {blueskyLinked && (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "rgba(0,133,255,0.06)", border: "1px solid rgba(0,133,255,0.2)" }}>
                    <label
                      htmlFor="crosspost-bluesky-toggle"
                      className="flex items-center gap-2 cursor-pointer select-none flex-1"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 360 320" fill="currentColor" aria-hidden="true" style={{ color: "#0085FF" }}>
                        <path d="M180 142c-16.3-31.7-60.7-90.8-102-120C38.5-2.9 27.2 1 18.8 1 8.3 1 0 7.8 0 25.4 0 39 6.6 116.7 10.3 132.9 23 187.7 74.3 207 122.7 202c-71 10.5-133.3 41-67.3 147.9 51.7 81.4 103.3 27.8 127.2 0 24-27.9 53.7-87.3 53.7-87.3s29.7 59.4 53.7 87.3c23.9 27.8 75.5 81.4 127.2 0 66-106.9 3.7-137.4-67.3-147.9 48.4 5 99.7-14.3 112.4-69.1 3.7-16.2 10.3-93.9 10.3-107.5C360 7.8 351.7 1 341.2 1c-8.4 0-19.7-3.9-59.2 21C240.7 51.2 196.3 110.3 180 142z" />
                      </svg>
                      <span className="text-xs font-medium" style={{ color: crossPostBluesky ? "#0085FF" : "#8E8E93" }}>
                        Also post to Bluesky
                      </span>
                    </label>
                    {/* Toggle switch */}
                    <button
                      id="crosspost-bluesky-toggle"
                      role="switch"
                      aria-checked={crossPostBluesky}
                      aria-label="Cross-post to Bluesky"
                      onClick={() => setCrossPostBluesky((v) => !v)}
                      disabled={isPosting}
                      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                      style={{
                        background: crossPostBluesky ? "#0085FF" : "rgba(255,255,255,0.15)",
                        outlineOffset: "2px",
                      }}
                    >
                      <span
                        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
                        style={{ transform: crossPostBluesky ? "translateX(18px)" : "translateX(2px)" }}
                      />
                    </button>
                  </div>
                )}

                {/* Allow sharing toggle */}
                <div className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <label
                    htmlFor="shareable-toggle"
                    className="flex items-center gap-2 cursor-pointer select-none flex-1"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: isShareable ? "#34D399" : "#8E8E93" }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                    </svg>
                    <span className="text-xs font-medium" style={{ color: isShareable ? "#34D399" : "#8E8E93" }}>
                      Allow sharing
                    </span>
                  </label>
                  <button
                    id="shareable-toggle"
                    role="switch"
                    aria-checked={isShareable}
                    aria-label="Allow sharing this post"
                    onClick={() => setIsShareable((v) => !v)}
                    disabled={isPosting}
                    className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    style={{
                      background: isShareable ? "#34D399" : "rgba(255,255,255,0.15)",
                      outlineOffset: "2px",
                    }}
                  >
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
                      style={{ transform: isShareable ? "translateX(18px)" : "translateX(2px)" }}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Bulk Videos button — active creators only, shown below composer */}
          {isActiveCreator && !showBulkUpload && (
            <button
              onClick={() => setShowBulkUpload(true)}
              className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 transition-colors w-full justify-center"
              style={{ color: "#E69138" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Bulk Upload Videos
            </button>
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
          All Posts
        </button>
        <button
          onClick={() => handleTabChange("wof")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "wof" ? "text-white border-b-2" : "text-white/50"
          }`}
          style={activeTab === "wof" ? { borderImage: "linear-gradient(to right, #FFB454, #E69138) 1" } : undefined}
        >
          Wall of Fame
        </button>
        {isAuthenticated && (
          <button
            onClick={() => handleTabChange("following")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
              activeTab === "following" ? "text-white border-b-2" : "text-white/50"
            }`}
            style={activeTab === "following" ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
          >
            Following
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
          <p className="text-white font-medium mb-1">Feed Unavailable</p>
          <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{error}</p>
          <button onClick={() => { setError(null); setIsLoading(true); loadFeed(); }} className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold">
            Retry
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <p className="text-white font-medium mb-1">No Posts Yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>Be the first to share something with the community!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onLike={handleLike}
              onDelete={handleDelete}
              onNavigate={navigate}
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
                {loadingMore ? "Loading..." : "Load More"}
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
          <p className="text-white font-medium mb-1">Feed Unavailable</p>
          <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{wofError}</p>
          <button onClick={() => { setWofError(null); setWofLoading(true); loadWofFeed(); }} className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold">
            Retry
          </button>
        </div>
      ) : wofPosts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#FFB454" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.93m0 0a6.022 6.022 0 01-2.77-.93" />
          </svg>
          <p className="text-white font-medium mb-1">No Wall of Fame Posts Yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Post photos in the Telegram group to appear here!
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
              onLike={handleLike}
              onDelete={handleDelete}
              onNavigate={navigate}
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
                {wofLoadingMore ? "Loading..." : "Load More"}
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
          <p className="text-white font-medium mb-1">Feed Unavailable</p>
          <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{followingError}</p>
          <button
            onClick={() => { setFollowingError(null); setFollowingLoading(true); loadFollowingFeed(); }}
            className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      ) : followingPosts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          <p className="text-white font-medium mb-1">No Posts Yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Follow some users to see their posts here.
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
              onLike={handleLike}
              onDelete={handleDelete}
              onNavigate={navigate}
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
                {followingLoadingMore ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Bluesky cross-post confirmation modal */}
      <Modal
        open={showBlueskyWarning}
        onClose={() => setShowBlueskyWarning(false)}
      >
        <div className="flex flex-col items-center text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
            style={{ background: "rgba(0,133,255,0.12)", color: "#0085FF" }}
          >
            <BlueskySvg className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Post to Bluesky?
          </h3>
          <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>
            This post will be publicly visible on the Bluesky network, not just
            on PNPtv. Anyone on Bluesky will be able to see it.
          </p>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setShowBlueskyWarning(false)}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold border border-white/10 hover:bg-white/5 transition-colors"
              style={{ color: "#8E8E93" }}
            >
              Cancel
            </button>
            <button
              onClick={confirmCrossPost}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ background: "#0085FF" }}
            >
              Post to Both
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
