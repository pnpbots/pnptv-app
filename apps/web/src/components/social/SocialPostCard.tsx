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
  editSocialPost,
  type SocialPostItem,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { translateText } from "@/lib/feedI18n";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";

/**
 * Channel-promo CTA resolver. Reads the post's `metadata` and the viewer's
 * tier and produces the right call-to-action label + click target.
 *
 * Today we only know "is the viewer PRIME" with zero extra DB roundtrips.
 * For subscription / paid channels we always upsell (worst-case the user gets
 * the paywall on the channel page, which already handles "you already have
 * access" correctly). Future: subscribe to a per-creator entitlement context
 * so we can show "Watch now" pre-emptively to existing subscribers.
 */
function resolveChannelPromoCta(
  metadata: Record<string, unknown> | undefined | null,
  isPrime: boolean,
  lang: string,
): { label: string; href: string } | null {
  if (!metadata || (metadata as { kind?: string }).kind !== "channel_promo") return null;
  const m = metadata as {
    channel_slug?: string;
    channel_name?: string;
    creator_username?: string | null;
    access_type?: "free" | "prime" | "subscription" | "paid";
    price_usd?: number | null;
  };
  const slug = m.channel_slug || "";
  const isEs = lang === "es";
  const watchNow = isEs ? "Ver ahora →" : "Watch now →";
  switch (m.access_type) {
    case "free":
      return { label: watchNow, href: `/channels/${slug}` };
    case "prime":
      return isPrime
        ? { label: watchNow, href: `/channels/${slug}` }
        : {
            label: isEs ? "Suscríbete a PRIME →" : "Subscribe to PRIME →",
            href: `/subscribe?plan=prime&return=${encodeURIComponent(`/channels/${slug}`)}`,
          };
    case "subscription": {
      const creator = m.creator_username || m.channel_name || "creator";
      return {
        label: isEs
          ? `Suscríbete a @${creator} →`
          : `Subscribe to @${creator} →`,
        href: `/profile/${creator}?action=subscribe`,
      };
    }
    case "paid":
      return {
        label: isEs
          ? `Pase mensual — $${m.price_usd ?? "?"}/mes →`
          : `Get pass — $${m.price_usd ?? "?"}/mo →`,
        href: `/channels/${slug}?action=purchase`,
      };
    default:
      return { label: watchNow, href: `/channels/${slug}` };
  }
}

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
  distanceKm?: number | null;
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
  return !!photo && (photo.startsWith("/uploads/") || photo.startsWith("http"));
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
  distanceKm,
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
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [localContent, setLocalContent] = useState<string | null>(null);

  const isOwn = String(post.author_id) === currentUserId;
  const canDelete = isOwn || isAdmin;
  const { user } = useAuth();
  const { isPrime } = useTier();
  const channelPromoCta = resolveChannelPromoCta(
    post.metadata as Record<string, unknown> | undefined,
    !!isPrime,
    t.lang,
  );
  // For own posts/replies, always use the live auth-context photo so avatar
  // updates cascade instantly without a full feed refetch.
  const effectiveAuthorPhoto = isOwn && user?.photoUrl ? user.photoUrl : post.author_photo;

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

  const authorPath =
    String(post.author_id) === currentUserId
      ? "/profile"
      : `/profile/${post.author_id}`;

  // Promoted posts fall back to the PNPtv logo ONLY when the author has no
  // real avatar (platform-only announcements). When a real author is attached
  // (e.g. a founder blog crosspost), show their photo and allow profile nav.
  const showPlatformLogo =
    post.is_promoted &&
    !post.is_carousel &&
    !isValidPhotoUrl(effectiveAuthorPhoto) &&
    post.author_id !== "cristina-ai";

  return (
    <div
      className={`glass-card-sm pt-4 pb-4 pr-4 pl-14 relative${post.is_carousel ? "" : " cursor-pointer"}`}
      onClick={post.is_carousel ? undefined : toggleReplies}
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
      {/* Avatar — pinned to upper-left corner */}
      <button
        onClick={(e) => { e.stopPropagation(); if (!showPlatformLogo && !post.is_carousel) onNavigate(authorPath); }}
        className="absolute -top-2 -left-2 z-10 flex-shrink-0"
      >
        {post.is_carousel ? (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center ring-2 ring-[#1C1C1E]"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            aria-label="PNPtv PRIME"
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.5 18.5L5 9l4.5 4L12 4l2.5 9L19 9l2.5 9.5H2.5z" />
            </svg>
          </div>
        ) : showPlatformLogo ? (
          <img
            src="/Logo2-50.png"
            alt="PNPtv!"
            className="w-10 h-10 rounded-full object-cover ring-2 ring-[#1C1C1E]"
            style={{ background: "#1a1a2e" }}
          />
        ) : post.author_id === "cristina-ai" ? (
          <span className="w-10 h-10 rounded-full flex items-center justify-center text-2xl ring-2 ring-[#1C1C1E] bg-[#1a1a2e]">🧜‍♀️</span>
        ) : isValidPhotoUrl(effectiveAuthorPhoto) ? (
          <img
            src={effectiveAuthorPhoto}
            alt={`${post.author_first_name || post.author_username || "User"}'s avatar`}
            className="w-10 h-10 rounded-full object-cover ring-2 ring-[#1C1C1E]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              const sib = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
              if (sib) sib.style.removeProperty("display");
            }}
          />
        ) : null}
        {!post.is_carousel && !showPlatformLogo && post.author_id !== "cristina-ai" && (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ring-2 ring-[#1C1C1E]"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              color: "#fff",
              display: isValidPhotoUrl(effectiveAuthorPhoto) ? "none" : undefined,
            }}
          >
            {(post.author_first_name || post.author_username || "?")[0].toUpperCase()}
          </div>
        )}
      </button>

      {/* Content */}
      <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {post.is_carousel ? (
              <span className="font-semibold text-white text-sm truncate">
                {post.author_first_name || post.author_username || "Anonymous"}
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate(authorPath); }}
                className="font-semibold text-white text-sm truncate hover:underline"
              >
                {post.author_first_name || post.author_username || "Anonymous"}
              </button>
            )}
            {post.author_username && !post.is_carousel && (
              <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                @{post.author_username}
              </span>
            )}
            <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              &middot; {timeAgo(post.created_at, t.translating)}
            </span>

            {/* Nearby badge */}
            {distanceKm != null && (
              <NearbyBadge distanceKm={distanceKm} variant="compact" />
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
            {/* Hangout context badge — shows which hangout the post was made in */}
            {post.hangout_group_name && (
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate(`/?hangout=${post.hangout_group_id}`); }}
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full hover:opacity-80 transition-opacity"
                style={{ background: "rgba(123,97,255,0.15)", color: "#7B61FF" }}
              >
                #{post.hangout_group_name.replace(/\s+/g, "")}
              </button>
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
                onClick={(e) => { e.stopPropagation(); handleWofToggle(); }}
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

            {/* Edit (own posts only) */}
            {isOwn && !isEditing && !post.blurred && (
              <button
                onClick={(e) => { e.stopPropagation(); handleStartEdit(); }}
                className="ml-auto text-xs hover:text-cyan-400 transition-colors"
                style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
                aria-label="Edit post"
                title="Edit post"
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
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                  />
                </svg>
              </button>
            )}

            {/* Delete (own posts or admin) */}
            {canDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                disabled={deleting}
                className={`${isOwn && !isEditing && !post.blurred ? "" : "ml-auto"} text-xs hover:text-red-400 transition-colors`}
                style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
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
              onClick={(e) => e.stopPropagation()}
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

              {isEditing ? (
                <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg p-2 text-sm text-white bg-white/5 border border-white/15 focus:outline-none focus:border-pink-500 resize-none"
                    placeholder="Edit your post..."
                    disabled={savingEdit}
                  />
                  <div className="flex items-center gap-2 mt-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
                      disabled={savingEdit || !editContent.trim()}
                      className="px-3 py-1 rounded-full text-xs font-semibold transition-all disabled:opacity-40"
                      style={{ background: "#D4007A", color: "#fff" }}
                    >
                      {savingEdit ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                      disabled={savingEdit}
                      className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--pnp-text-secondary, #8E8E93)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      Cancel
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
                  onClick={(e) => { e.stopPropagation(); setTranslatedContent(null); }}
                  className="text-xs mt-0.5"
                  style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
                >
                  {t.showOriginal}
                </button>
              )}

              {/* Promoted PRIME video carousel (auto-injected synthetic post) */}
              {post.is_promoted && post.is_carousel && Array.isArray(post.carousel_items) && post.carousel_items.length > 0 && (
                <div className="mt-3 -mx-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-2 overflow-x-auto pb-2 px-2 snap-x snap-mandatory" style={{ scrollbarWidth: "thin" }}>
                    {post.carousel_items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => onNavigate(item.link)}
                        className="flex-shrink-0 w-36 snap-start text-left group"
                        title={item.title}
                      >
                        <div
                          className="relative w-36 h-24 rounded-lg overflow-hidden bg-black/40"
                          style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                        >
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/20">
                              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M2 6a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                              </svg>
                            </div>
                          )}
                          <span
                            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: "rgba(0,0,0,0.4)" }}
                          >
                            <svg className="w-8 h-8" fill="#fff" viewBox="0 0 20 20">
                              <path d="M6.3 4.7l8 5.3-8 5.3z" />
                            </svg>
                          </span>
                          {item.duration && item.duration > 0 && (
                            <span
                              className="absolute bottom-1 right-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}
                            >
                              {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, "0")}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-white/90 line-clamp-2 leading-tight">
                          {item.title}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Channel-promo CTA — produced by the per-channel video upload flow.
                   Computed client-side per viewer (PRIME-aware), so a single
                   social_posts row serves all viewer states. */}
              {channelPromoCta && !post.promoted_link && (
                <div className="mt-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(channelPromoCta.href);
                    }}
                    className="w-full text-sm font-semibold py-2.5 rounded-lg transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                  >
                    {channelPromoCta.label}
                  </button>
                </div>
              )}

              {/* Promoted CTA buttons (single or dual) */}
              {post.is_promoted && post.promoted_link && (
                <div
                  className={`mt-3 ${post.promoted_link2 ? "flex gap-2" : ""}`}
                >
                  <button
                    onClick={(e) => { e.stopPropagation();
                      const link = post.promoted_link!;
                      if (link.startsWith("/")) {
                        onNavigate(link);
                      } else if (link.startsWith("https://")) {
                        window.open(link, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className={`${post.promoted_link2 ? "flex-1" : "w-full"} text-sm font-semibold py-2.5 rounded-lg transition-opacity hover:opacity-90`}
                    style={{
                      background: "linear-gradient(135deg, #D4007A, #E69138)",
                      color: "#fff",
                    }}
                  >
                    {post.promoted_link_label || "Watch Now"}
                  </button>
                  {post.promoted_link2 && (
                    <button
                      onClick={(e) => { e.stopPropagation();
                        const link = post.promoted_link2!;
                        if (link.startsWith("/")) {
                          onNavigate(link);
                        } else if (link.startsWith("https://")) {
                          window.open(link, "_blank", "noopener,noreferrer");
                        }
                      }}
                      className="flex-1 text-sm font-semibold py-2.5 rounded-lg transition-colors hover:bg-white/10"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,0.15)",
                      }}
                    >
                      {post.promoted_link2_label || "Open"}
                    </button>
                  )}
                </div>
              )}

              {/* Link preview — only when the post has no media */}
              {!post.is_promoted && !post.media_url && (() => {
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
                      <svg
                        className="w-4 h-4 flex-shrink-0"
                        style={{ color: "#5ED1C4" }}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] uppercase tracking-wide font-semibold text-pnp-textSecondary">
                          {host}
                        </div>
                        <div className="text-xs text-white/80 truncate">
                          {rawUrl}
                        </div>
                      </div>
                    </div>
                  </a>
                );
              })()}

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
                        controlsList="nodownload"
                        onContextMenu={(e) => e.preventDefault()}
                        playsInline
                        className="w-full max-h-[480px] rounded-lg object-contain bg-black"
                        preload="metadata"
                        poster={post.video_thumbnail_url || undefined}
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

          {/* Actions bar — hidden on synthetic carousel posts (no real post to like) */}
          {!post.is_carousel && (
          <div
            className="flex items-center gap-3 mt-3 flex-wrap"
            style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
            onClick={(e) => e.stopPropagation()}
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
                style={translatedContent ? { color: "#5ED1C4" } : { color: "var(--pnp-text-secondary, #8E8E93)" }}
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
                style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
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
          )}

          {/* Replies section */}
          {showReplies && (
            <div className="mt-3 pt-3 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
              {loadingReplies ? (
                <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {t.loadingComments}
                </p>
              ) : replies.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  {t.noCommentsYet}
                </p>
              ) : (
                <div className="space-y-3 mb-3">
                  {replies.map((reply) => {
                    const replyIsOwn = String(reply.author_id) === currentUserId;
                    const replyPhoto = replyIsOwn && user?.photoUrl ? user.photoUrl : reply.author_photo;
                    return (
                    <div key={reply.id} className="flex gap-2">
                      <button
                        onClick={() =>
                          onNavigate(
                            replyIsOwn
                              ? "/profile"
                              : `/profile/${reply.author_id}`
                          )
                        }
                        className="flex-shrink-0"
                      >
                        {isValidPhotoUrl(replyPhoto) ? (
                          <img
                            src={replyPhoto}
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
                            display: isValidPhotoUrl(replyPhoto)
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
                          <span className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                            {timeAgo(reply.created_at, t.translating)}
                          </span>
                        </div>
                        <MentionText
                          text={reply.content}
                          className="text-xs text-white/80 mt-0.5 whitespace-pre-wrap block"
                        />
                        {/* Reply-to-reply: prefills composer with the reply author's @handle */}
                        {currentUserId && String(reply.author_id) !== currentUserId && (reply.author_username || reply.author_first_name) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const handle = reply.author_username || reply.author_first_name || "";
                              const mention = `@${handle} `;
                              setReplyText((prev) => {
                                if (prev.startsWith(mention)) return prev;
                                const cleaned = prev.replace(/^@\S+\s+/, "");
                                return mention + cleaned;
                              });
                            }}
                            className="mt-1 text-[11px] font-medium hover:underline"
                            style={{ color: "#5ED1C4" }}
                          >
                            {t.reply || "Reply"}
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
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
                        style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                        />
                      </svg>
                      <span style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
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

      {/* Content Disclaimer Modal */}
      {showDisclaimerModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { e.stopPropagation(); setShowDisclaimerModal(false); }}
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
        mediaType={post.media_type}
        videoThumbnailUrl={post.video_thumbnail_url}
        mediaUrl={post.media_url}
        isOwnPost={isOwn || post.author_id === 'pnptv-official'}
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
      />
    </div>
  );
}
