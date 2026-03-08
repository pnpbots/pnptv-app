import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";
import { useTutorial, resetAllTutorials } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Badge, Modal, Input, Skeleton } from "@pnptv/ui-kit";
import {
  getProfile,
  getPublicProfile,
  updateProfile,
  updatePrivacy,
  uploadAvatar,
  togglePostLike,
  deleteSocialPost,
  createSocialPost,
  checkAuthStatus,
  unlinkX,
  updateLanguage,
  getXLoginUrl,
  followUser,
  unfollowUser,
  getFollowStatus,
  getFollowersList,
  getFollowingList,
  getCreatorSubscriptionStatus,
  subscribeToCreator,
  unsubscribeFromCreator,
  initiateCreatorSubscriptionPayment,
  getCreatorEligibility,
  searchUsers,
  getCreatorEnrollment,
  submitCreatorEnrollment,
  getMyReferral,
  getRtmpKey,
  type CreatorEligibility,
  type CreatorEnrollment,
  type UserProfile,
  type SocialPostItem,
  type AuthMethods,
  type FollowListUser,
  type ReferralStats,
} from "@/lib/api";
import { SignaturePad } from "@/components/SignaturePad";

function resolvePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Only accept valid web paths, not Telegram file IDs
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

// ── Post Card Component ──────────────────────────────────────────────────────

function PostCard({
  post,
  isOwn,
  isOwnProfile,
  isSubscribed,
  creatorPriceUsd,
  onLike,
  onDelete,
  onAuthorTap,
  onSubscribeCta,
}: {
  post: SocialPostItem;
  isOwn: boolean;
  isOwnProfile: boolean;
  isSubscribed: boolean;
  creatorPriceUsd?: number | null;
  onLike: (id: number) => void;
  onDelete: (id: number) => void;
  onAuthorTap?: (userId: string) => void;
  onSubscribeCta?: () => void;
}) {
  const t = useI18n();
  const p = t.profile;
  const [deleting, setDeleting] = useState(false);
  const photoUrl = resolvePhotoUrl(post.author_photo);

  // Determine if this post should be locked behind the exclusive gate.
  // The backend strips content/media_url for locked posts and sets exclusive_status.
  // We lock the UI overlay when: post is exclusive, not the profile owner, not subscribed,
  // and the backend confirmed locked status (or is_exclusive is true but status is absent).
  const isExclusiveLocked =
    post.is_exclusive === true &&
    !isOwnProfile &&
    !isSubscribed &&
    (post.exclusive_status === "locked" || post.exclusive_status === undefined);

  // Teaser: exclusive but backend allowed a preview (every 5th post for prime members)
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
          {/* Lock icon with gradient */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <p className="text-white font-bold text-sm leading-tight">{p.exclusiveContent}</p>
          {creatorPriceUsd != null && (
            <p className="text-xs leading-snug" style={{ color: "rgba(255,255,255,0.6)" }}>
              {p.subscribeForPrice.replace('${price}', String(creatorPriceUsd))}
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
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <p className="text-white font-semibold text-xs">{p.exclusivePreviewOnly}</p>
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
          aria-label={`View ${post.author_first_name || post.author_username || "user"}'s profile`}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={`${post.author_first_name || post.author_username || "User"}'s avatar`}
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
              {(post.author_first_name || post.author_username || "?")[0].toUpperCase()}
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
            {/* Exclusive badge — visible to the creator on their own profile */}
            {post.is_exclusive && isOwnProfile && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                {p.exclusiveLabel}
              </span>
            )}
          </div>

          <p className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed">
            {post.content}
          </p>

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
          <div className="flex items-center gap-5 mt-3" style={{ color: "#8E8E93" }}>
            {/* Like */}
            <button
              onClick={() => onLike(post.id)}
              className="flex items-center gap-1.5 text-xs hover:text-pink-400 transition-colors"
              style={post.liked_by_me ? { color: "#D4007A" } : undefined}
              aria-label={post.liked_by_me ? p.unlikePost : p.likePost}
            >
              <svg className="w-4 h-4" fill={post.liked_by_me ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              {post.likes_count > 0 && <span>{post.likes_count}</span>}
            </button>

            {/* Replies */}
            <span className="flex items-center gap-1.5 text-xs" aria-label={`${post.replies_count} replies`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
              </svg>
              {post.replies_count > 0 && <span>{post.replies_count}</span>}
            </span>

            {/* Delete (own posts only) */}
            {isOwn && (
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
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit Profile Modal ───────────────────────────────────────────────────────

function EditProfileModal({
  open,
  onClose,
  profile,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName || "");
  const [lastName, setLastName] = useState(profile.lastName || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [locationText, setLocationText] = useState(profile.locationText || "");
  const [dob, setDob] = useState<string>(profile.dateOfBirth || "");
  const [city, setCity] = useState<string>(profile.city || "");
  const [country, setCountry] = useState<string>(profile.country || "");
  const [privacy, setPrivacy] = useState<Record<string, boolean>>({
    showDob: true,
    showLocation: true,
    showBio: true,
    showInterests: true,
    allowMessages: true,
    showOnline: true,
    ...(profile.privacy || {}),
  });
  const t = useI18n();
  const p = t.profile;
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(profile.firstName || "");
    setLastName(profile.lastName || "");
    setBio(profile.bio || "");
    setLocationText(profile.locationText || "");
    setDob(profile.dateOfBirth || "");
    setCity(profile.city || "");
    setCountry(profile.country || "");
    setPrivacy({
      showDob: true,
      showLocation: true,
      showBio: true,
      showInterests: true,
      allowMessages: true,
      showOnline: true,
      ...(profile.privacy || {}),
    });
  }, [profile]);

  const handlePrivacyToggle = async (key: string) => {
    const newVal = !privacy[key];
    const optimistic = { ...privacy, [key]: newVal };
    setPrivacy(optimistic);
    setSavingPrivacy(true);
    try {
      await updatePrivacy({ [key]: newVal });
    } catch {
      // Revert on failure
      setPrivacy(privacy);
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Parameters<typeof updateProfile>[0] = { firstName, lastName, bio, locationText };
      if (dob) payload.dateOfBirth = dob;
      if (city.trim()) payload.city = city.trim();
      if (country.trim()) payload.country = country.trim();
      await updateProfile(payload);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : p.failedToSave);
    } finally {
      setSaving(false);
    }
  };

  // 18-years-ago max date for DOB
  const dobMax = new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().split("T")[0];

  return (
    <Modal open={open} onClose={onClose} title={p.editProfileTitle}>
      <div className="space-y-4">
        {/* Profile Incomplete nudge */}
        {(!profile.dateOfBirth || !profile.city) && (
          <div className="rounded-xl p-3 bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-2">
            <span className="text-yellow-400 text-lg leading-none mt-0.5" aria-hidden="true">!</span>
            <div>
              <p className="text-sm font-medium text-yellow-300">{p.completeYourProfile}</p>
              <p className="text-xs text-yellow-400/80">{p.completeProfileDesc}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">{p.firstName}</label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={p.firstNamePlaceholder}
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">{p.lastName}</label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={p.lastNamePlaceholder}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">{p.bio}</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 160))}
            placeholder={p.bioPlaceholder}
            className="w-full rounded-lg border border-pnp-border bg-pnp-bg text-pnp-textPrimary text-sm p-3 resize-none outline-none focus:border-pnp-accent"
            rows={3}
          />
          <span className="text-xs text-pnp-textSecondary float-right">{bio.length}/160</span>
        </div>
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">{p.locationDisplay}</label>
          <Input
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
            placeholder={p.locationPlaceholder}
          />
        </div>

        {/* Date of Birth */}
        <div>
          <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
            {p.dateOfBirth} <span className="text-pnp-textSecondary/50">{p.dobRequired}</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={dobMax}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
            />
            <button
              type="button"
              onClick={() => handlePrivacyToggle("showDob")}
              disabled={savingPrivacy}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${
                privacy.showDob
                  ? "border-green-500/40 bg-green-500/10 text-green-400"
                  : "border-white/10 bg-white/5 text-pnp-textSecondary"
              }`}
              title={privacy.showDob ? "Visible to others" : "Private"}
              aria-label={privacy.showDob ? p.dobIsPublic : p.dobIsPrivate}
            >
              {privacy.showDob ? p.public : p.private}
            </button>
          </div>
          <p className="text-[10px] text-pnp-textSecondary/60 mt-1">{p.dobPrivacyNote}</p>
        </div>

        {/* City / Country */}
        <div>
          <label className="block text-xs font-medium text-pnp-textSecondary mb-1.5">
            {p.locationCityCountry}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder={p.cityPlaceholder}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={100}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary/40 focus:outline-none focus:border-pnp-accent"
            />
            <input
              type="text"
              placeholder={p.countryPlaceholder}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              maxLength={100}
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-pnp-textPrimary placeholder-pnp-textSecondary/40 focus:outline-none focus:border-pnp-accent"
            />
            <button
              type="button"
              onClick={() => handlePrivacyToggle("showLocation")}
              disabled={savingPrivacy}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${
                privacy.showLocation
                  ? "border-green-500/40 bg-green-500/10 text-green-400"
                  : "border-white/10 bg-white/5 text-pnp-textSecondary"
              }`}
              title={privacy.showLocation ? "Visible to others" : "Private"}
              aria-label={privacy.showLocation ? p.locationIsPublic : p.locationIsPrivate}
            >
              {privacy.showLocation ? p.public : p.private}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-2">
          <Button variant="danger" className="flex-1" onClick={onClose}>
            {p.cancel}
          </Button>
          <button
            onClick={handleSave}
            disabled={saving || !firstName.trim()}
            className="flex-1 btn-gradient px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
          >
            {saving ? p.saving : p.save}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Compose Post Inline ──────────────────────────────────────────────────────

function ComposePost({
  onPosted,
  photoUrl,
  displayName,
}: {
  onPosted: () => void;
  photoUrl: string | null;
  displayName: string;
}) {
  const t = useI18n();
  const p = t.profile;
  const [text, setText] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const clearMedia = useCallback(() => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [mediaPreview]);

  const handlePost = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      await createSocialPost(text.trim(), mediaFile || undefined);
      setText("");
      clearMedia();
      onPosted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="glass-card-sm p-4">
      <div className="flex gap-3">
        {photoUrl ? (
          <img src={photoUrl} alt={`${displayName}'s avatar`} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
          >
            {displayName[0]?.toUpperCase() || "U"}
          </div>
        )}
        <div className="flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            placeholder={p.composePlaceholder}
            className="w-full bg-transparent text-white text-sm py-2 border-b border-white/10 mb-2 resize-none outline-none placeholder:text-white/40"
            rows={2}
            disabled={posting}
          />
          <div className="flex justify-end mb-1">
            <span className={`text-xs ${text.length > 450 ? "text-red-400" : ""}`} style={{ color: text.length > 450 ? undefined : "#8E8E93" }}>
              {text.length}/500
            </span>
          </div>

          {mediaPreview && (
            <div className="relative mb-2 inline-block">
              {mediaFile?.type.startsWith("video/") ? (
                <video src={mediaPreview} className="max-h-40 rounded-lg" muted playsInline />
              ) : (
                <img src={mediaPreview} alt="Preview" className="max-h-40 rounded-lg object-cover" />
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

          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3" style={{ color: "#8E8E93" }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 50 * 1024 * 1024) {
                      setError(p.fileTooLarge);
                      return;
                    }
                    setMediaFile(file);
                    setMediaPreview(URL.createObjectURL(file));
                  }
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={posting}
                className="hover:text-pnp-accent transition-colors"
                title={p.photoOrVideo}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" />
                </svg>
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={posting}
                className="hover:text-pnp-accent transition-colors"
                title={p.uploadVideo}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </button>
            </div>
            <button
              onClick={handlePost}
              disabled={!text.trim() || posting}
              className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
            >
              {posting ? p.posting : p.post}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Referral Card ─────────────────────────────────────────────────────────────

function ReferralCard() {
  const t = useI18n();
  const p = t.profile;
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getMyReferral().then(setStats).catch(() => {});
  }, []);

  const copy = () => {
    if (!stats?.link) return;
    navigator.clipboard.writeText(stats.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="glass-card-sm p-5 mt-4">
      <h2 className="text-sm font-semibold text-white mb-1 tracking-wide uppercase opacity-60">{p.referralProgram}</h2>
      <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
        {p.referralInviteDesc} <strong style={{ color: "#FFB454" }}>{p.referralFreePrime}</strong> {p.referralWhenTheyJoin}
      </p>
      {stats ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex-1 px-3 py-2 rounded-lg text-xs font-mono truncate"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
            >
              {stats.link}
            </div>
            <button
              onClick={copy}
              className="px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0 transition-colors"
              style={{
                background: copied ? "rgba(94,209,196,0.15)" : "rgba(255,180,84,0.15)",
                border: copied ? "1px solid rgba(94,209,196,0.4)" : "1px solid rgba(255,180,84,0.4)",
                color: copied ? "#5ED1C4" : "#FFB454",
              }}
            >
              {copied ? p.copied : p.copy}
            </button>
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <div className="text-xl font-bold text-white">{stats.total}</div>
              <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.invited}</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold" style={{ color: "#FFB454" }}>{stats.completed}</div>
              <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.joined_noun}</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold" style={{ color: "#5ED1C4" }}>{stats.completed * 3}</div>
              <div className="text-[10px]" style={{ color: "#8E8E93" }}>{p.daysEarned}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="h-16 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
      )}
    </div>
  );
}

// ── Identity & Connections Section ───────────────────────────────────────────

function IdentityConnections({ telegramUsername }: { telegramUsername?: string }) {
  const t = useI18n();
  const p = t.profile;
  const [xLinked, setXLinked] = useState(false);
  const [xHandle, setXHandle] = useState<string | null>(null);
  const [xLoading, setXLoading] = useState(true);
  const [xUnlinking, setXUnlinking] = useState(false);
  const [xUnlinkError, setXUnlinkError] = useState<string | null>(null);
  const [unlinkVersion, setUnlinkVersion] = useState(0);

  // Load current X identity from auth-status
  useEffect(() => {
    let cancelled = false;
    checkAuthStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.authenticated && status.user) {
          const methods = status.user.auth_methods as AuthMethods | undefined;
          setXLinked(!!methods?.x);
          setXHandle(status.user.x_handle ?? null);
        } else {
          setXLinked(false);
          setXHandle(null);
        }
        setXLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setXLinked(false);
          setXHandle(null);
          setXLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unlinkVersion]);

  const handleUnlinkX = async () => {
    setXUnlinking(true);
    setXUnlinkError(null);
    try {
      await unlinkX();
      setXLinked(false);
      setXHandle(null);
      setUnlinkVersion((v) => v + 1);
    } catch (err: unknown) {
      setXUnlinkError(err instanceof Error ? err.message : p.failedToUnlinkX);
    } finally {
      setXUnlinking(false);
    }
  };

  return (
    <div className="glass-card-sm p-5 mt-4">
      <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">
        {p.identityConnections}
      </h2>

      <div className="space-y-3">
        {/* Telegram row — always connected */}
        <div className="flex items-center justify-between py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            {/* Telegram logo SVG */}
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #2AABEE, #229ED9)" }}
            >
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">{p.telegram}</p>
              {telegramUsername ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>@{telegramUsername}</p>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{p.connected}</p>
              )}
            </div>
          </div>
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}
          >
            {p.connected}
          </span>
        </div>

        {/* X / Twitter section */}
        <div className="py-2 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255, 255, 255, 0.1)" }}
              aria-hidden="true"
            >
              <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{p.xTwitter}</p>
              {xLoading ? (
                <div className="h-3 w-24 bg-white/10 rounded animate-pulse mt-0.5" />
              ) : xLinked && xHandle ? (
                <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{xHandle}</p>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{p.notConnected}</p>
              )}
            </div>
            {!xLoading && (
              xLinked ? (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}
                >
                  {p.connected}
                </span>
              ) : (
                <button
                  onClick={() => { window.location.href = getXLoginUrl(); }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 transition-colors hover:opacity-80"
                  style={{ background: "rgba(255, 255, 255, 0.1)", color: "#FFFFFF" }}
                >
                  {p.connect}
                </button>
              )
            )}
          </div>

          {/* Unlink option when connected */}
          {!xLoading && xLinked && (
            <div className="mt-2 flex items-center gap-2 pl-12">
              <button
                onClick={handleUnlinkX}
                disabled={xUnlinking}
                className="text-xs font-medium hover:underline disabled:opacity-50"
                style={{ color: "#FF453A" }}
              >
                {xUnlinking ? p.unlinking : p.unlinkXAccount}
              </button>
              {xUnlinkError && (
                <span className="text-xs text-red-400">{xUnlinkError}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Follow List Modal ─────────────────────────────────────────────────────────

function FollowListModal({
  open,
  mode,
  targetUserId,
  onClose,
  onNavigate,
}: {
  open: boolean;
  mode: "followers" | "following";
  targetUserId: string;
  onClose: () => void;
  onNavigate: (userId: string) => void;
}) {
  const t = useI18n();
  const p = t.profile;
  const [users, setUsers] = useState<FollowListUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    try {
      const res = mode === "followers"
        ? await getFollowersList(targetUserId, cursor)
        : await getFollowingList(targetUserId, cursor);
      if (res.success) {
        setUsers((prev) => cursor ? [...prev, ...res.users] : res.users);
        setNextCursor(res.nextCursor);
      }
    } catch { /* silent */ }
    setLoading(false);
    setLoadingMore(false);
  }, [mode, targetUserId]);

  useEffect(() => {
    if (!open) return;
    setUsers([]);
    setNextCursor(null);
    setLoading(true);
    load();
  }, [open, load]);

  const handleLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    load(nextCursor);
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "followers" ? p.followersTitle : p.followingTitle}>
      {loading ? (
        <div className="space-y-3 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-white/10 rounded w-32" />
                <div className="h-2.5 bg-white/10 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-white font-medium mb-1">{mode === "followers" ? p.noFollowers : p.noFollowing}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {mode === "followers" ? p.noFollowersDesc : p.noFollowingDesc}
          </p>
        </div>
      ) : (
        <div className="space-y-1 py-2">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => { onClose(); onNavigate(u.id); }}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors text-left"
            >
              {u.photoUrl && (u.photoUrl.startsWith("/") || u.photoUrl.startsWith("http")) ? (
                <img src={u.photoUrl} alt={`${u.displayName || u.username || "User"}'s avatar`} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                >
                  {(u.firstName || u.username || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {u.firstName}{u.lastName ? ` ${u.lastName}` : ""}
                </p>
                {u.username && (
                  <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{u.username}</p>
                )}
              </div>
            </button>
          ))}
          {nextCursor && (
            <div className="pt-2 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-sm font-medium px-4 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: "#D4007A" }}
              >
                {loadingMore ? p.loading : p.loadMore}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Creator Terms & Conditions Modal ────────────────────────────────────────

const CREATOR_TIERS = [
  { id: "ice" as const, label: "Ice", price: 5, color: "#5ED1C4", gradient: "linear-gradient(135deg, #5ED1C4, #00D4E8)", emoji: "❄️" },
  { id: "crystal" as const, label: "Crystal", price: 10, color: "#D4007A", gradient: "linear-gradient(135deg, #D4007A, #E69138)", emoji: "🔮" },
  { id: "diamond" as const, label: "Diamond", price: 15, color: "#FFB454", gradient: "linear-gradient(135deg, #FFB454, #FF8C00)", emoji: "💎" },
] as const;

type TierId = typeof CREATOR_TIERS[number]["id"];

// ── Creator Tier Helpers ─────────────────────────────────────────────────────

const TIER_CONFIG = {
  ice:     { color: "#5ED1C4", gradient: "linear-gradient(135deg, #5ED1C4, #00D4E8)",  rgb: "94,209,196",  name: "Ice Profile",     emoji: "❄️", price: 5 },
  crystal: { color: "#D4007A", gradient: "linear-gradient(135deg, #D4007A, #E69138)",  rgb: "212,0,122",   name: "Crystal Profile", emoji: "🔮", price: 10 },
  diamond: { color: "#FFB454", gradient: "linear-gradient(135deg, #FFB454, #FF8C00)",  rgb: "255,180,84",  name: "Diamond Profile", emoji: "💎", price: 15 },
} as const;

// ── Enrollment Wizard ─────────────────────────────────────────────────────────

function CreatorEnrollmentWizard({
  tier,
  onClose,
  onSubmitted,
}: {
  tier: TierId;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const i18n = useI18n();
  const pr = i18n.profile;
  const t = TIER_CONFIG[tier];
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;

  // Step 1 state
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [commitmentAccepted, setCommitmentAccepted] = useState(false);

  // Step 2 state (payment)
  const [paymentMethod, setPaymentMethod] = useState<"meru" | "usdc" | "usdt">("usdc");
  const [paymentAddress, setPaymentAddress] = useState("");
  const [paymentNetwork, setPaymentNetwork] = useState("base");

  // Step 3 state (ID + signature)
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [signatureData, setSignatureData] = useState("");

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setIdPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!idFile) { setSubmitError(pr.idDocumentRequired); return; }
    if (!signatureData) { setSubmitError(pr.signatureRequired); return; }
    if (!paymentAddress.trim()) { setSubmitError(pr.paymentAddressRequired); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitCreatorEnrollment({
        tier,
        paymentMethod,
        paymentAddress,
        paymentNetwork,
        signatureData,
        idDocument: idFile,
      });
      onSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : pr.submissionFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const canProceedStep1 = termsAccepted && commitmentAccepted;
  const canProceedStep2 = paymentAddress.trim().length >= 3;
  const canProceedStep3 = !!idFile && !!signatureData;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl flex flex-col"
        style={{ background: "#1C1C1E", border: `1px solid rgba(${t.rgb},0.25)`, maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{t.emoji}</span>
            <div>
              <p className="text-sm font-semibold text-white">{t.name} {pr.enrollment}</p>
              <p className="text-xs" style={{ color: t.color }}>{pr.stepOf} {step} {pr.of} {TOTAL_STEPS}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: t.gradient }}
            />
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-4">

          {/* Step 1: Terms & Commitment */}
          {step === 1 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.termsAndConditions}</p>

              <div className="space-y-3 text-xs" style={{ color: "#8E8E93" }}>
                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white">{pr.programTerms}</p>
                  <p>{pr.programTermsBody}</p>
                  <p>{pr.programTermsBody2}</p>
                  <p>{pr.programTermsBody3}</p>
                </div>

                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white">{pr.contentRequirements}</p>
                  <p>{pr.contentReqBody}</p>
                  <ul className="list-disc list-inside space-y-0.5 mt-1">
                    <li>{pr.contentReqItem1}</li>
                    <li>{pr.contentReqItem2}</li>
                    <li>{pr.contentReqItem3}</li>
                    <li>{pr.contentReqItem4}</li>
                  </ul>
                  <p className="mt-1">{pr.contentReqDisclaimer}</p>
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: termsAccepted ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setTermsAccepted((v) => !v)}
                >
                  {termsAccepted && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: termsAccepted ? "#fff" : "#8E8E93" }}>
                  {pr.agreeToTerms} <strong>{pr.creatorProgramTerms}</strong> {pr.and} <strong>{pr.payoutTerms}</strong>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <div
                  className="mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: commitmentAccepted ? t.gradient : "rgba(255,255,255,0.08)", border: `1px solid rgba(${t.rgb},0.4)` }}
                  onClick={() => setCommitmentAccepted((v) => !v)}
                >
                  {commitmentAccepted && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs" style={{ color: commitmentAccepted ? "#fff" : "#8E8E93" }}>
                  {pr.understandCommitment} <strong>{pr.contentRequirementsLabel}</strong>
                </span>
              </label>
            </>
          )}

          {/* Step 2: Payment Setup */}
          {step === 2 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.paymentSetup}</p>

              <div className="rounded-xl p-3 text-xs space-y-1.5" style={{ background: `rgba(${t.rgb},0.08)`, border: `1px solid rgba(${t.rgb},0.2)` }}>
                <p className="font-semibold text-white">{pr.payoutTermsTitle}</p>
                <p style={{ color: "#8E8E93" }}>{pr.youReceive70}</p>
                <p style={{ color: "#8E8E93" }}>{pr.payoutsEveryTuesday}</p>
                <p style={{ color: "#8E8E93" }}>{pr.minimumPayout}</p>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "#8E8E93" }}>{pr.selectPaymentMethod}</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: "meru" as const, label: pr.meruApp, icon: "💳" },
                    { id: "usdc" as const, label: "USDC", icon: "🔵" },
                    { id: "usdt" as const, label: "USDT", icon: "🟢" },
                  ]).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setPaymentMethod(m.id);
                        setPaymentAddress("");
                        setPaymentNetwork(m.id === "usdt" ? "tron" : "base");
                      }}
                      className="py-3 rounded-xl text-center transition-all"
                      style={paymentMethod === m.id
                        ? { background: `rgba(${t.rgb},0.15)`, border: `2px solid rgba(${t.rgb},0.5)` }
                        : { background: "rgba(255,255,255,0.04)", border: "2px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      <p className="text-lg mb-0.5">{m.icon}</p>
                      <p className="text-xs font-semibold" style={{ color: paymentMethod === m.id ? t.color : "#8E8E93" }}>{m.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {(paymentMethod === "usdc" || paymentMethod === "usdt") && (
                <div>
                  <p className="text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>{pr.network}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(paymentMethod === "usdc"
                      ? [{ id: "base", label: "Base" }, { id: "ethereum", label: "Ethereum" }]
                      : [{ id: "tron", label: "Tron (TRC-20)" }, { id: "ethereum", label: "Ethereum (ERC-20)" }]
                    ).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setPaymentNetwork(n.id)}
                        className="py-2 rounded-lg text-xs font-medium transition-colors border"
                        style={paymentNetwork === n.id
                          ? { background: `rgba(${t.rgb},0.12)`, color: t.color, borderColor: `rgba(${t.rgb},0.3)` }
                          : { background: "rgba(255,255,255,0.04)", color: "#8E8E93", borderColor: "rgba(255,255,255,0.08)" }
                        }
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "#8E8E93" }}>
                  {paymentMethod === "meru" ? pr.meruAccountOrPhone : pr.walletAddress}
                </label>
                <input
                  type="text"
                  value={paymentAddress}
                  onChange={(e) => setPaymentAddress(e.target.value)}
                  placeholder={paymentMethod === "meru" ? pr.meruPlaceholder : pr.walletPlaceholder}
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  autoComplete="off"
                />
              </div>
            </>
          )}

          {/* Step 3: Identity Verification */}
          {step === 3 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.identityVerification}</p>

              <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-semibold text-white mb-1">{pr.whyWeNeedThis}</p>
                <p style={{ color: "#8E8E93" }}>
                  {pr.idVerificationExplanation}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>
                  {pr.governmentIdFront} <span className="text-red-400">*</span>
                </p>
                {idPreview ? (
                  <div className="relative">
                    <img
                      src={idPreview}
                      alt="ID preview"
                      className="w-full rounded-xl object-cover"
                      style={{ maxHeight: 140, border: `1px solid rgba(${t.rgb},0.3)` }}
                    />
                    <button
                      onClick={() => { setIdFile(null); setIdPreview(null); }}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                      style={{ background: "rgba(0,0,0,0.6)" }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center gap-2 rounded-xl py-6 cursor-pointer transition-colors"
                    style={{ border: `1px dashed rgba(${t.rgb},0.35)`, background: `rgba(${t.rgb},0.04)` }}
                  >
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: t.color }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" />
                    </svg>
                    <p className="text-xs" style={{ color: "#8E8E93" }}>{pr.tapToUploadId}</p>
                    <input type="file" accept="image/*" className="hidden" onChange={handleIdUpload} />
                  </label>
                )}
              </div>

              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: "#8E8E93" }}>
                  {pr.digitalSignature} <span className="text-red-400">*</span>
                </p>
                <SignaturePad
                  onSave={setSignatureData}
                  width={300}
                  height={100}
                />
              </div>
            </>
          )}

          {/* Step 4: Review & Submit */}
          {step === 4 && (
            <>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">{pr.reviewAndSubmit}</p>

              <div className="space-y-2 text-xs">
                <div className="rounded-xl p-3" style={{ background: `rgba(${t.rgb},0.08)`, border: `1px solid rgba(${t.rgb},0.2)` }}>
                  <p className="font-semibold text-white mb-2">{t.emoji} {t.name}</p>
                  <div className="space-y-1.5" style={{ color: "#8E8E93" }}>
                    <div className="flex justify-between">
                      <span>{pr.subscriptionPrice}</span>
                      <span className="text-white font-medium">${t.price}/mo</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{pr.yourEarnings}</span>
                      <span className="text-white font-medium">70% · ~${(t.price * 0.7).toFixed(2)}/subscriber</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{pr.payoutDay}</span>
                      <span className="text-white font-medium">{pr.payoutDayValue}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white mb-2">{pr.paymentDetails}</p>
                  <div className="space-y-1.5" style={{ color: "#8E8E93" }}>
                    <div className="flex justify-between">
                      <span>{pr.method}</span>
                      <span className="text-white font-medium capitalize">{paymentMethod}</span>
                    </div>
                    {paymentNetwork && paymentMethod !== "meru" && (
                      <div className="flex justify-between">
                        <span>{pr.network}</span>
                        <span className="text-white font-medium capitalize">{paymentNetwork}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>{pr.address}</span>
                      <span className="text-white font-medium truncate ml-4" style={{ maxWidth: 160 }}>{paymentAddress}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{pr.idVerificationProvided}</p>
                    <span className="text-xs" style={{ color: "#4ADE80" }}>{pr.idProvided}</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
                    {pr.idCapturedNote}
                  </p>
                </div>
              </div>

              <p className="text-xs text-center" style={{ color: "#8E8E93" }}>
                {pr.reviewNote}
              </p>

              {submitError && (
                <p className="text-xs text-center" style={{ color: "#FF453A" }}>{submitError}</p>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 pb-5 pt-3 flex-shrink-0 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {step < TOTAL_STEPS ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && !canProceedStep1) ||
                (step === 2 && !canProceedStep2) ||
                (step === 3 && !canProceedStep3)
              }
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: t.gradient }}
            >
              {pr.continue}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ background: t.gradient }}
            >
              {submitting ? pr.submitting : pr.submitEnrollment}
            </button>
          )}
          {step > 1 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="w-full py-2 text-xs text-center"
              style={{ color: "#8E8E93" }}
            >
              {pr.backStep}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Monetize Content Card ─────────────────────────────────────────────────────

function MonetizeContentCard({ creatorStatus, onActivated }: { creatorStatus?: string; onActivated?: () => void }) {
  const t = useI18n();
  const p = t.profile;
  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [enrollment, setEnrollment] = useState<CreatorEnrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<TierId>("ice");
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    Promise.all([
      getCreatorEligibility().then((res) => { if (res.success) setEligibility(res); }).catch(() => {}),
      getCreatorEnrollment().then((res) => { if (res.success) setEnrollment(res.enrollment); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // Hide for active or if already enrolled and pending
  if (creatorStatus === "active") return null;

  if (loading) {
    return (
      <div className="glass-card-sm p-4 mt-4 animate-pulse">
        <div className="h-5 bg-white/5 rounded w-40 mb-2" />
        <div className="h-3 bg-white/5 rounded w-full" />
      </div>
    );
  }

  // Pending review state
  if (creatorStatus === "pending_review" || enrollment?.status === "pending_review") {
    const t = enrollment ? TIER_CONFIG[enrollment.tier as TierId] : TIER_CONFIG.ice;
    return (
      <div
        className="glass-card-sm p-4 mt-4"
        style={{ borderColor: `rgba(${t.rgb},0.3)` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `rgba(${t.rgb},0.15)` }}
          >
            <svg className="w-4 h-4 animate-spin" style={{ color: t.color }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{p.enrollmentUnderReview}</p>
            <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
              {enrollment?.tier || ""} {t.emoji} {p.enrollmentUnderReviewDesc}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Rejected — allow re-enrollment
  if (enrollment?.status === "rejected") {
    const t = TIER_CONFIG[enrollment.tier as TierId] || TIER_CONFIG.ice;
    return (
      <div className="glass-card-sm p-4 mt-4" style={{ borderColor: "rgba(239,68,68,0.25)" }}>
        <p className="text-sm font-semibold text-white mb-1">{p.enrollmentNotApproved}</p>
        <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
          {enrollment.admin_notes || p.enrollmentRejectedDefault}
        </p>
        <button
          onClick={() => setShowWizard(true)}
          className="w-full py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: t.gradient }}
        >
          {p.reApplyFor} {t.emoji} {t.name}
        </button>
        {showWizard && (
          <CreatorEnrollmentWizard
            tier={enrollment.tier as TierId}
            onClose={() => setShowWizard(false)}
            onSubmitted={() => { setShowWizard(false); onActivated?.(); }}
          />
        )}
      </div>
    );
  }

  if (!eligibility) return null;

  const isEligible = eligibility.eligible;
  const criteria = eligibility.criteria;
  const totalRequired = Object.values(criteria).length;
  const totalMet = Object.values(criteria).filter((c) => c.met).length;
  const overallPct = Math.round((totalMet / totalRequired) * 100);
  const selectedTierConfig = TIER_CONFIG[selectedTier];

  return (
    <>
      <div
        className="glass-card-sm p-4 mt-4"
        style={{ borderColor: isEligible ? `rgba(${selectedTierConfig.rgb},0.3)` : "rgba(212,0,122,0.15)" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: isEligible ? selectedTierConfig.color : "#D4007A" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-semibold text-white">{p.monetizeYourProfile}</p>
          </div>
          {!isEligible && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(212,0,122,0.12)", color: "#D4007A" }}>
              {totalMet}/{totalRequired} met
            </span>
          )}
        </div>

        {isEligible ? (
          <>
            <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
              {p.creatorMonetizeDesc}
            </p>

            {/* Tier selector */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {CREATOR_TIERS.map((tier) => {
                const isSelected = selectedTier === tier.id;
                return (
                  <button
                    key={tier.id}
                    onClick={() => setSelectedTier(tier.id)}
                    className="relative rounded-xl p-3 text-center transition-all"
                    style={{
                      background: isSelected ? `rgba(${TIER_CONFIG[tier.id].rgb},0.15)` : "rgba(255,255,255,0.03)",
                      border: isSelected ? `2px solid rgba(${TIER_CONFIG[tier.id].rgb},0.6)` : "2px solid rgba(255,255,255,0.08)",
                      opacity: isSelected ? 1 : 0.7,
                    }}
                  >
                    <p className="text-lg mb-0.5">{tier.emoji}</p>
                    <p className={`text-xs font-bold ${isSelected ? "text-white" : "text-white/70"}`}>{tier.label}</p>
                    <p className="text-sm font-bold mt-0.5" style={{ color: isSelected ? tier.color : TIER_CONFIG[tier.id].color }}>
                      ${tier.price}<span className="text-xs font-normal">/mo</span>
                    </p>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowWizard(true)}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ background: selectedTierConfig.gradient }}
            >
              {selectedTierConfig.emoji} {p.startEnrollment}
            </button>
          </>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
              {p.meetRequirementsToUnlock}
            </p>

            <div className="mb-3">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${overallPct}%`,
                    background: overallPct >= 75 ? "linear-gradient(to right, #5ED1C4, #00D4E8)" : "linear-gradient(to right, #D4007A, #E69138)",
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              {([
                { key: "mediaPosts", label: p.mediaPosts, icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" },
                { key: "totalLikes", label: p.totalLikes, icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" },
                { key: "followers", label: p.followers, icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" },
                { key: "weeklyConsistency", label: p.weeklyPosts4Weeks, icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
              ] as const).map(({ key, label, icon }) => {
                const c = criteria[key];
                const pct = Math.min((c.current / c.required) * 100, 100);
                const remaining = Math.max(0, c.required - c.current);
                return (
                  <div key={key} className="flex items-center gap-2.5">
                    <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      {c.met ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5ED1C4">
                          <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-white/80 truncate">{label}</span>
                        <span className="text-xs font-medium ml-2 flex-shrink-0" style={{ color: c.met ? "#5ED1C4" : "#8E8E93" }}>
                          {c.met ? p.done : `${remaining} ${p.moreRequired}`}
                        </span>
                      </div>
                      {!c.met && (
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: "linear-gradient(to right, #D4007A, #E69138)" }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              disabled
              className="w-full mt-3 py-2.5 rounded-lg text-sm font-semibold text-white/40 cursor-not-allowed"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {p.completeRequirementsToEnroll}
            </button>
          </>
        )}
      </div>

      {showWizard && (
        <CreatorEnrollmentWizard
          tier={selectedTier}
          onClose={() => setShowWizard(false)}
          onSubmitted={() => { setShowWizard(false); onActivated?.(); }}
        />
      )}
    </>
  );
}

// ── Main Profile Page ────────────────────────────────────────────────────────

export default function Profile() {
  const { isAuthenticated, user, login, logout, refreshUser } = useAuth();
  const { isPrime: currentUserIsPrime } = useTier();
  const { userId: paramUserId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const t = useI18n();
  const p = t.profile;
  const isOwnProfile = !paramUserId || paramUserId === String(user?.id);
  const targetUserId = paramUserId || String(user?.id || "");
  const { showTutorial, dismissTutorial } = useTutorial("profile");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"posts" | "likes" | "exclusive">("posts");
  const [wofConsent, setWofConsent] = useState(false);
  const [wofConsentSaving, setWofConsentSaving] = useState(false);
  const [contentDisclaimer, setContentDisclaimer] = useState(false);
  const [contentDisclaimerSaving, setContentDisclaimerSaving] = useState(false);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [langSaving, setLangSaving] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);

  // Go Live state
  const [showGoLive, setShowGoLive] = useState(false);
  const [rtmpInfo, setRtmpInfo] = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const [showStreamKey, setShowStreamKey] = useState(false);

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [showFollowModal, setShowFollowModal] = useState<"followers" | "following" | null>(null);

  // Creator subscription state
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  // Payment-gated subscribe modal state
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [subscribeEmail, setSubscribeEmail] = useState("");
  const [subscribeEmailError, setSubscribeEmailError] = useState<string | null>(null);
  const [subscribeProvider, setSubscribeProvider] = useState<"epayco" | "daimo">("daimo");
  const [subscribePaymentLoading, setSubscribePaymentLoading] = useState(false);
  const [subscribePaymentId, setSubscribePaymentId] = useState<string | null>(null);
  const [subscribeAwaitingPayment, setSubscribeAwaitingPayment] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const subscribeButtonRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; username: string; first_name: string; last_name: string | null; photo_file_id: string | null; pnptv_id: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Search handler
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    setSearchLoading(true);
    setSearchOpen(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchUsers(value.trim(), 10);
        if (res.success) setSearchResults(res.users);
      } catch { /* ignore */ }
      setSearchLoading(false);
    }, 300);
  }, []);

  // Close search on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Cleanup search timer
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, []);

  // Reset state when navigating between profiles
  useEffect(() => {
    setProfile(null);
    setPosts([]);
    setNextCursor(null);
    setIsFollowing(false);
    setFollowersCount(0);
    setFollowingCount(0);
    setIsSubscribed(false);
    setError(null);
    setLoading(true);
  }, [targetUserId]);

  const loadProfile = useCallback(async (cursor?: string) => {
    if (!targetUserId) return;
    try {
      if (!cursor) setLoading(true);
      else setLoadingMore(true);

      if (isOwnProfile && isAuthenticated) {
        // Own profile: fetch profile data + posts separately
        const [profileRes, postsRes] = await Promise.all([
          getProfile(),
          getPublicProfile(targetUserId, cursor),
        ]);
        if (!cursor) {
          setProfile(profileRes.profile);
          setWofConsent(profileRes.profile.wofPhotoConsent ?? false);
          setContentDisclaimer(profileRes.profile.contentDisclaimer ?? false);
          setLang((profileRes.profile.language as "en" | "es") ?? user?.language ?? "en");
          setPosts(postsRes.posts);
          // Load own follow counts
          getFollowStatus(targetUserId).then((s) => {
            setFollowersCount(s.followerCount);
            setFollowingCount(s.followingCount);
          }).catch(() => {});
        } else {
          setPosts((prev) => [...prev, ...postsRes.posts]);
        }
        setNextCursor(postsRes.nextCursor);
      } else {
        // Other user's profile: single endpoint + follow status + subscription status
        const [res, followRes] = await Promise.all([
          getPublicProfile(targetUserId, cursor),
          !cursor && isAuthenticated ? getFollowStatus(targetUserId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!cursor) {
          setProfile(res.profile);
          setPosts(res.posts);
          if (followRes) {
            setIsFollowing(followRes.isFollowing);
            setFollowersCount(followRes.followerCount);
            setFollowingCount(followRes.followingCount);
          }
          // Load creator subscription status if the user is an active creator
          if (isAuthenticated && res.profile.creatorStatus === "active") {
            getCreatorSubscriptionStatus(targetUserId)
              .then((subRes) => { if (subRes.success) setIsSubscribed(subRes.subscribed); })
              .catch(() => {});
          }
        } else {
          setPosts((prev) => [...prev, ...res.posts]);
        }
        setNextCursor(res.nextCursor);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [targetUserId, isOwnProfile, isAuthenticated]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    try {
      const res = await uploadAvatar(file);
      setProfile((prev) =>
        prev ? { ...prev, photoUrl: res.photoUrl } : prev
      );
      // Refresh auth context so the avatar is updated globally
      await refreshUser();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to upload avatar");
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleWofConsentToggle = async () => {
    const newValue = !wofConsent;
    setWofConsentSaving(true);
    try {
      await updateProfile({ wofPhotoConsent: newValue });
      setWofConsent(newValue);
    } catch {
      // Revert on failure
    } finally {
      setWofConsentSaving(false);
    }
  };

  const handleContentDisclaimerToggle = async () => {
    const newValue = !contentDisclaimer;
    setContentDisclaimerSaving(true);
    try {
      await updateProfile({ contentDisclaimer: newValue });
      setContentDisclaimer(newValue);
    } catch {
      // Revert on failure
    } finally {
      setContentDisclaimerSaving(false);
    }
  };

  const handleLanguageChange = async (newLang: "en" | "es") => {
    if (newLang === lang || langSaving) return;
    const prevLang = lang;
    setLangSaving(true);
    setLangError(null);
    setLang(newLang);
    try {
      await updateLanguage(newLang);
      await refreshUser();
    } catch (err) {
      setLang(prevLang);
      setLangError(err instanceof Error ? err.message : "Failed to update language");
      setTimeout(() => setLangError(null), 4000);
    } finally {
      setLangSaving(false);
    }
  };

  const handleLike = async (postId: number) => {
    if (!isAuthenticated) return;
    try {
      const res = await togglePostLike(postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: res.liked,
                likes_count: p.likes_count + (res.liked ? 1 : -1),
              }
            : p
        )
      );
    } catch {
      // Silent fail
    }
  };

  const handleDelete = async (postId: number) => {
    try {
      await deleteSocialPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch {
      // Silent fail
    }
  };

  const [followError, setFollowError] = useState<string | null>(null);

  const handleGoLive = async () => {
    setGoLiveLoading(true);
    setGoLiveError(null);
    try {
      const result = await getRtmpKey();
      if (result.success && result.rtmpUrl && result.streamKey) {
        setRtmpInfo({ rtmpUrl: result.rtmpUrl, streamKey: result.streamKey });
        setShowGoLive(true);
      } else {
        setGoLiveError(result.error || "Streaming unavailable");
      }
    } catch (err: unknown) {
      setGoLiveError(err instanceof Error ? err.message : "Failed to load credentials");
    } finally {
      setGoLiveLoading(false);
    }
  };

  const handleFollow = async () => {
    if (followLoading || !profile) return;
    setFollowLoading(true);
    setFollowError(null);
    try {
      const res = isFollowing
        ? await unfollowUser(profile.id || paramUserId!)
        : await followUser(profile.id || paramUserId!);
      setIsFollowing(res.isFollowing);
      setFollowersCount(res.followerCount);
      setFollowingCount(res.followingCount);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setFollowError(msg);
      setTimeout(() => setFollowError(null), 3000);
    }
    setFollowLoading(false);
  };

  const handleSubscribe = () => {
    if (!profile) return;
    if (isSubscribed) {
      handleUnsubscribe();
      return;
    }
    if (!currentUserIsPrime) {
      setSubscribeError(p.primeRequiredForCreator);
      setTimeout(() => setSubscribeError(null), 4000);
      return;
    }
    setSubscribeEmail("");
    setSubscribeEmailError(null);
    setSubscribeError(null);
    setSubscribeAwaitingPayment(false);
    setSubscribePaymentId(null);
    setShowSubscribeModal(true);
  };

  const handleUnsubscribe = async () => {
    if (subscribeLoading || !profile) return;
    setSubscribeLoading(true);
    setSubscribeError(null);
    try {
      await unsubscribeFromCreator(profile.id || paramUserId!);
      setIsSubscribed(false);
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : p.failedToUnsubscribe);
    }
    setSubscribeLoading(false);
  };

  const handleSubscribePayment = async () => {
    if (!profile || subscribePaymentLoading) return;
    const trimmed = subscribeEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
      setSubscribeEmailError("Please enter a valid email address");
      return;
    }
    setSubscribeEmailError(null);
    setSubscribePaymentLoading(true);
    setSubscribeError(null);
    try {
      const creatorId = profile.id || paramUserId!;
      const result = await initiateCreatorSubscriptionPayment(creatorId, subscribeProvider, trimmed);
      if (result.success && result.paymentUrl) {
        window.open(result.paymentUrl, "_blank", "noopener,noreferrer");
        setSubscribePaymentId(result.paymentId);
        setSubscribeAwaitingPayment(true);
      } else {
        setSubscribeError(result.error || p.failedToCreatePayment);
      }
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : p.paymentError);
    }
    setSubscribePaymentLoading(false);
  };

  const handleCheckSubscriptionStatus = async () => {
    if (!profile) return;
    try {
      const creatorId = profile.id || paramUserId!;
      const subRes = await getCreatorSubscriptionStatus(creatorId);
      if (subRes.success && subRes.subscribed) {
        setIsSubscribed(true);
        setShowSubscribeModal(false);
        setSubscribeAwaitingPayment(false);
        setSubscribePaymentId(null);
      } else {
        setSubscribeError(p.paymentNotConfirmed);
        setTimeout(() => setSubscribeError(null), 4000);
      }
    } catch {
      setSubscribeError(p.couldNotVerifyStatus);
      setTimeout(() => setSubscribeError(null), 3000);
    }
  };

  const handleAuthorTap = (authorId: string) => {
    if (authorId === String(user?.id)) {
      navigate("/profile");
    } else {
      navigate(`/profile/${authorId}`);
    }
  };

  // Scroll to the subscribe button or trigger subscribe flow from the exclusive overlay CTA
  const handleSubscribeCta = useCallback(() => {
    if (subscribeButtonRef.current) {
      subscribeButtonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // If the user is on the exclusive tab, switch to posts tab so they can see the subscribe button context
    setActiveTab("posts");
  }, []);

  // ── Not authenticated + no param → sign in prompt ──────────────────────────

  if (!isAuthenticated && !paramUserId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">{p.signInRequired}</h1>
        <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>
          {p.signInPrompt}
        </p>
        <Button onClick={login}>{p.signIn}</Button>
      </div>
    );
  }

  // ── Loading State ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header skeleton */}
        <div className="glass-card-sm p-6 mb-4">
          <div className="flex items-start gap-4">
            <Skeleton className="w-20 h-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
        {/* Posts skeleton */}
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
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
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────────────

  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="text-white font-medium mb-1">{p.profileNotFound}</p>
        <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{error || p.userDoesntExist}</p>
        <Button onClick={() => navigate("/")}>{p.goHome}</Button>
      </div>
    );
  }

  const photoUrl = resolvePhotoUrl(profile.photoUrl);
  const displayName = profile.firstName + (profile.lastName ? ` ${profile.lastName}` : "");
  const initial = displayName[0]?.toUpperCase() || "U";
  const isPrime = profile.tier?.toLowerCase() === "prime";
  const isPerformer = !!profile.performerData;

  // Per-user profile themes & masked roles
  const profileThemes: Record<string, { gradient: string; color: string; border: string; borderColor?: string; roleBadge?: string; roleStyle?: React.CSSProperties }> = {
    "8599671840": { // SantinoFurioso — golden crystal yellow
      gradient: "linear-gradient(135deg, #FFD700, #FFA500)",
      color: "#FFD700",
      border: "rgba(255,215,0,0.4)",
      borderColor: "rgba(255,215,0,0.25)",
      roleBadge: "The Meth Daddy",
      roleStyle: { background: "rgba(255,215,0,0.15)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.3)" },
    },
    "8250283246": { // Lexboytv — light silver
      gradient: "linear-gradient(135deg, #C0C0C0, #E8E8E8)",
      color: "#D0D0D0",
      border: "rgba(192,192,192,0.4)",
      borderColor: "rgba(192,192,192,0.25)",
      roleBadge: "The PNP Latino Boy",
      roleStyle: { background: "rgba(192,192,192,0.15)", color: "#D0D0D0", border: "1px solid rgba(192,192,192,0.3)" },
    },
    "8552451957": { // pnptvadmin — light silver
      gradient: "linear-gradient(135deg, #C0C0C0, #E8E8E8)",
      color: "#D0D0D0",
      border: "rgba(192,192,192,0.4)",
      borderColor: "rgba(192,192,192,0.25)",
      roleBadge: "Official Account",
      roleStyle: { background: "rgba(192,192,192,0.15)", color: "#D0D0D0", border: "1px solid rgba(192,192,192,0.3)" },
    },
  };

  const customTheme = profileThemes[profile.id];
  const accentGradient = customTheme?.gradient ?? (isPerformer
    ? "linear-gradient(135deg, #5ED1C4, #00D4E8)"
    : "linear-gradient(135deg, #D4007A, #E69138)");
  const accentColor = customTheme?.color ?? (isPerformer ? "#5ED1C4" : "#D4007A");
  const accentBorder = customTheme?.border ?? (isPerformer ? "rgba(94,209,196,0.35)" : "rgba(255,255,255,0.1)");

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>{profile ? `${profile.display_name || profile.username} — PNPtv!` : "Profile — PNPtv!"}</title>
        <meta name="description" content={profile ? `${profile.display_name || profile.username}'s profile on PNPtv.` : "User profile on PNPtv."} />
      </Helmet>
      {isOwnProfile && showTutorial && <TutorialOverlay section="profile" onDismiss={dismissTutorial} />}
      {/* ── Back button for public profiles ── */}
      {paramUserId && (
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm mb-4 hover:text-pnp-accent transition-colors"
          style={{ color: "#8E8E93" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {p.back}
        </button>
      )}

      {/* ── Profile Search Bar (own profile only) ── */}
      {isOwnProfile && (
        <div ref={searchContainerRef} className="relative mb-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => { if (searchQuery.trim().length >= 2) setSearchOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }}
              placeholder={p.searchPeople}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-white placeholder-[#8E8E93] focus:outline-none focus:ring-1 focus:ring-[#D4007A]/50"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "#8E8E93" }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchOpen && (
            <div
              className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-lg max-h-72 overflow-y-auto"
              style={{ background: "rgba(28,28,30,0.95)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}
            >
              {searchLoading ? (
                <div className="flex items-center justify-center py-6">
                  <svg className="w-5 h-5 text-[#D4007A] animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : searchResults.length === 0 ? (
                <p className="text-center text-sm py-6" style={{ color: "#8E8E93" }}>{p.noUsersFound}</p>
              ) : (
                searchResults.map((u) => {
                  const photo = resolvePhotoUrl(u.photo_file_id);
                  const initial = (u.first_name || u.username || "?")[0].toUpperCase();
                  return (
                    <button
                      key={u.id}
                      onClick={() => { setSearchOpen(false); setSearchQuery(""); navigate(`/profile/${u.id}`); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                    >
                      {photo ? (
                        <img src={photo} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                        >
                          {initial}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {u.first_name}{u.last_name ? ` ${u.last_name}` : ""}
                        </p>
                        {u.username && (
                          <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{u.username}</p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Profile Header Card ── */}
      <div
        className="glass-card-sm p-6 mb-4"
        style={customTheme?.borderColor ? { borderColor: customTheme.borderColor } : isPerformer ? { borderColor: "rgba(94,209,196,0.2)" } : undefined}
      >
        <div className="flex items-start gap-4">
          {/* Avatar with upload overlay */}
          <div className="relative flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={displayName}
                className="w-20 h-20 rounded-full object-cover border-2"
                style={{ borderColor: isPrime ? "#FFB454" : accentBorder }}
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold border-2"
                style={{
                  background: accentGradient,
                  color: "#fff",
                  borderColor: isPrime ? "#FFB454" : accentBorder,
                }}
              >
                {initial}
              </div>
            )}
            {/* Camera overlay — own profile only */}
            {isOwnProfile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute bottom-0 right-0 w-7 h-7 rounded-full flex items-center justify-center border-2 border-[#1C1C1E]"
                  style={{ background: accentGradient }}
                  title={p.changePhoto}
                >
                  {avatarUploading ? (
                    <svg className="w-3.5 h-3.5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Name & info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-white truncate">{displayName}</h1>
              {isPrime && (
                <Badge variant="accent">PRIME</Badge>
              )}
              {customTheme?.roleBadge ? (
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={customTheme.roleStyle}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  {customTheme.roleBadge}
                </span>
              ) : (
                <>
                  {isPerformer && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                      {p.performer}
                    </span>
                  )}
                  {profile.creatorStatus === "active" && (() => {
                    const tierMap: Record<string, { emoji: string; label: string; color: string }> = {
                      ice:     { emoji: TIER_CONFIG.ice.emoji,     label: p.iceCreator,     color: TIER_CONFIG.ice.color },
                      crystal: { emoji: TIER_CONFIG.crystal.emoji, label: p.crystalCreator,  color: TIER_CONFIG.crystal.color },
                      diamond: { emoji: TIER_CONFIG.diamond.emoji, label: p.diamondCreator,  color: TIER_CONFIG.diamond.color },
                    };
                    const tier = tierMap[profile.creatorType ?? ""];
                    const badgeColor  = tier ? tier.color  : "#D4007A";
                    const badgeEmoji  = tier ? tier.emoji  : "⭐";
                    const badgeLabel  = tier ? tier.label  : p.creator;
                    // Convert hex to rgb for rgba() — only the three tiers + fallback pink need this
                    const hexToRgb = (hex: string) => {
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      return `${r},${g},${b}`;
                    };
                    const rgb = hexToRgb(badgeColor);
                    return (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `rgba(${rgb},0.15)`, color: badgeColor, border: `1px solid rgba(${rgb},0.3)` }}>
                        <span aria-hidden="true">{badgeEmoji}</span>
                        {badgeLabel}
                      </span>
                    );
                  })()}
                  {!isOwnProfile && profile.creatorStatus === "active" && profile.creatorPriceUsd != null && (
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                      &middot; ${profile.creatorPriceUsd}/mo
                    </span>
                  )}
                </>
              )}
              {profile.creatorVerified && (
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill={accentColor} aria-label={p.verifiedCreator}>
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              )}
            </div>
            {profile.username && (
              <p className="text-sm" style={{ color: "#8E8E93" }}>@{profile.username}</p>
            )}
            {profile.bio && (
              <p className="text-sm text-white/80 mt-2 leading-relaxed">{profile.bio}</p>
            )}

            {/* Stats row */}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <span className="text-sm">
                <strong className="text-white">{profile.postCount ?? posts.length}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>{p.posts}</span>
              </span>
              <button
                onClick={() => setShowFollowModal("followers")}
                className="text-sm hover:underline text-left"
              >
                <strong className="text-white">{followersCount}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>{p.followers}</span>
              </button>
              <button
                onClick={() => setShowFollowModal("following")}
                className="text-sm hover:underline text-left"
              >
                <strong className="text-white">{followingCount}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>{p.following}</span>
              </button>
              {profile.creatorStatus === "active" && (profile.creatorSubscriberCount || 0) > 0 && (
                <span className="text-sm">
                  <strong className="text-white">{profile.creatorSubscriberCount}</strong>
                  <span className="ml-1" style={{ color: "#8E8E93" }}>{p.subscribers}</span>
                </span>
              )}
              {profile.creatorStatus === "active" && (() => {
                const exclusiveCount = posts.filter(post => post.is_exclusive).length;
                return exclusiveCount > 0 ? (
                  <span className="text-sm flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" style={{ color: "#D4007A" }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <strong className="text-white">{exclusiveCount}</strong>
                    <span style={{ color: "#8E8E93" }}>{p.exclusive}</span>
                  </span>
                ) : null;
              })()}
              {isPerformer && profile.performerData!.averageRating > 0 && (
                <span className="text-sm flex items-center gap-1" style={{ color: "#5ED1C4" }}>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  <strong className="text-white">{profile.performerData!.averageRating.toFixed(1)}</strong>
                  <span style={{ color: "#8E8E93" }}>{p.rating}</span>
                </span>
              )}
              {isPerformer && (
                <span className="text-sm">
                  <strong className="text-white">{profile.performerData!.totalCalls}</strong>
                  <span className="ml-1" style={{ color: "#8E8E93" }}>{p.calls}</span>
                </span>
              )}
              {profile.locationText && (
                <span className="text-xs flex items-center gap-1" style={{ color: "#8E8E93" }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  {profile.locationText}
                </span>
              )}
            </div>

            {/* Member since */}
            <p className="text-xs mt-2" style={{ color: "#8E8E93" }}>
              <svg className="w-3.5 h-3.5 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              {p.joined} {formatDate(profile.memberSince)}
            </p>
          </div>
        </div>

        {/* Cristina's profile completion nudge */}
        {isOwnProfile && (!photoUrl || !profile.dateOfBirth || !profile.city) && !localStorage.getItem("pnp:cristina-profile-nudge-dismissed") && (
          <div className="mt-4 rounded-xl p-4 relative" style={{ background: "linear-gradient(135deg, rgba(91,200,245,0.08), rgba(0,212,232,0.08))", border: "1px solid rgba(91,200,245,0.25)" }}>
            <button
              onClick={() => { localStorage.setItem("pnp:cristina-profile-nudge-dismissed", "1"); setProfile({ ...profile }); }}
              className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="flex items-start gap-3">
              <div className="cristina-avatar-glow rounded-full flex items-center justify-center shrink-0" style={{ width: 40, height: 40, background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }}>
                <span style={{ fontSize: 20 }} role="img" aria-label="Cristina">&#x1F9DC;&#x200D;&#x2640;&#xFE0F;</span>
              </div>
              <div className="flex-1 min-w-0 pr-4">
                <p className="text-sm font-semibold" style={{ color: "#5BC8F5" }}>{p.cristinaHeadline}</p>
                <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
                  {p.cristinaIntro}
                </p>
                <div className="mt-2 space-y-1.5">
                  {!photoUrl && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "rgba(91,200,245,0.2)", color: "#5BC8F5" }}>1</span>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                        <strong className="text-white/80">{p.cristinaUploadPhoto}</strong>{p.cristinaUploadPhotoDesc}
                      </p>
                    </div>
                  )}
                  {!profile.dateOfBirth && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "rgba(91,200,245,0.2)", color: "#5BC8F5" }}>{!photoUrl ? "2" : "1"}</span>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                        <strong className="text-white/80">{p.cristinaAddBirthday}</strong>{p.cristinaAddBirthdayDesc}
                      </p>
                    </div>
                  )}
                  {!profile.city && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "rgba(91,200,245,0.2)", color: "#5BC8F5" }}>{(!photoUrl ? 1 : 0) + (!profile.dateOfBirth ? 1 : 0) + 1}</span>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                        <strong className="text-white/80">{p.cristinaSetLocation}</strong>{p.cristinaSetLocationDesc}
                      </p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { if (!photoUrl) fileInputRef.current?.click(); else setEditOpen(true); }}
                  className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
                  style={{ background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }}
                >
                  {!photoUrl ? p.cristinaUploadPhotoBtn : p.cristinaEditProfileBtn}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Monetize Content — own profile, not yet active */}
        {isOwnProfile && profile.creatorStatus !== "active" && (
          <MonetizeContentCard creatorStatus={profile.creatorStatus} onActivated={() => loadProfile()} />
        )}

        {/* Performer availability strip */}
        {isPerformer && (
          <div
            className="flex items-center justify-between mt-4 rounded-lg px-4 py-2.5"
            style={{ background: "rgba(94,209,196,0.07)", border: "1px solid rgba(94,209,196,0.2)" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: profile.performerData!.isAvailable ? "#30D158" : "#8E8E93" }}
              />
              <span className="text-xs font-medium" style={{ color: profile.performerData!.isAvailable ? "#30D158" : "#8E8E93" }}>
                {profile.performerData!.isAvailable
                  ? (profile.performerData!.availabilityMessage || p.availableForCalls)
                  : p.currentlyUnavailable}
              </span>
            </div>
            <span className="text-sm font-bold" style={{ color: "#5ED1C4" }}>
              ${profile.performerData!.basePrice}{p.perCall}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-4 space-y-2" ref={subscribeButtonRef}>
          {isOwnProfile ? (
            <>
              {/* Primary actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white border border-white/20 hover:border-white/40 transition-colors"
                >
                  {p.editProfile}
                </button>
                {profile.creatorStatus === "active" && (() => {
                  const tc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
                  return (
                    <button
                      onClick={() => navigate("/creator")}
                      className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
                      style={{ background: `rgba(${tc.rgb},0.15)`, color: tc.color, border: `1px solid rgba(${tc.rgb},0.3)` }}
                    >
                      {tc.emoji} {p.creatorDashboard}
                    </button>
                  );
                })()}
                <button
                  onClick={handleGoLive}
                  disabled={goLiveLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold text-white btn-gradient disabled:opacity-50 transition-all"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  {goLiveLoading ? "..." : "Go Live"}
                </button>
              </div>
              {/* Secondary actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => { resetAllTutorials(); window.location.reload(); }}
                  className="flex-1 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/80 transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {p.resetTutorials}
                </button>
                <button
                  onClick={logout}
                  className="flex-1 py-1.5 rounded-lg text-xs text-red-400/70 hover:text-red-400 transition-colors"
                  style={{ background: "rgba(255,59,48,0.06)", border: "1px solid rgba(255,59,48,0.12)" }}
                >
                  {p.signOut}
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              {isAuthenticated && (
                <button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                  style={isFollowing
                    ? { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }
                    : { background: accentGradient, color: "#fff" }
                  }
                >
                  {followLoading ? "..." : isFollowing ? p.following_verb : p.follow}
                </button>
              )}
              {followError && (
                <p className="text-xs text-center w-full" style={{ color: "#FF453A" }}>{followError}</p>
              )}
              <button
                onClick={() => navigate(`/dm/${profile.id || paramUserId}`)}
                className="flex-1 py-2 rounded-lg text-white text-sm font-semibold border border-white/20 hover:border-white/40 transition-colors"
              >
                {p.message}
              </button>
              {profile.creatorStatus === "active" && isAuthenticated && (() => {
                const tc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
                return (
                  <button
                    onClick={handleSubscribe}
                    disabled={subscribeLoading}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                    style={isSubscribed
                      ? { background: `rgba(${tc.rgb},0.12)`, color: tc.color, border: `1px solid rgba(${tc.rgb},0.35)` }
                      : { background: tc.gradient, color: "#fff" }
                    }
                  >
                    {subscribeLoading ? "..." : isSubscribed ? `${tc.emoji} ${p.subscribed}` : `${tc.emoji} ${p.subscribe} $${profile.creatorPriceUsd || tc.price}/mo`}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
        {subscribeError && (
          <p className="text-xs text-red-400 mt-2 text-center">{subscribeError}</p>
        )}
      </div>

      {/* Go Live error */}
      {goLiveError && (
        <p className="text-xs text-center mt-2 text-pnp-error">{goLiveError}</p>
      )}

      {/* Go Live Modal */}
      {showGoLive && rtmpInfo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowGoLive(false)}>
          <div className="w-full max-w-lg bg-pnp-background border border-pnp-border rounded-t-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-pnp-textPrimary">Go Live</h2>
              <button onClick={() => setShowGoLive(false)} className="text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-pnp-textSecondary mb-4">
              Use these credentials in OBS, Streamlabs, or any RTMP-compatible streaming app.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">RTMP Server</label>
                <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                  <code className="text-sm text-pnp-textPrimary flex-1 break-all">{rtmpInfo.rtmpUrl}</code>
                  <button onClick={() => navigator.clipboard?.writeText(rtmpInfo.rtmpUrl)} className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors" aria-label="Copy RTMP URL">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary uppercase tracking-wider block mb-1">Stream Key</label>
                <div className="flex items-center gap-2 bg-pnp-surface border border-pnp-border rounded-lg px-3 py-2">
                  <code className="text-sm text-pnp-textPrimary flex-1">
                    {showStreamKey ? rtmpInfo.streamKey : "•".repeat(Math.min(rtmpInfo.streamKey.length, 20))}
                  </code>
                  <button onClick={() => setShowStreamKey(!showStreamKey)} className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors" aria-label={showStreamKey ? "Hide stream key" : "Show stream key"}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {showStreamKey ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      )}
                    </svg>
                  </button>
                  <button onClick={() => navigator.clipboard?.writeText(rtmpInfo.streamKey)} className="text-pnp-textSecondary hover:text-pnp-accent flex-shrink-0 transition-colors" aria-label="Copy stream key">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
                <p className="text-xs text-pnp-error mt-1">Never share your stream key with anyone.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Creator Subscription Payment Modal ── */}
      {showSubscribeModal && profile && (() => {
        const modalTc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
        const accentColor   = modalTc.color;
        const accentRgb     = modalTc.rgb;
        const gradientBg    = modalTc.gradient;
        return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                {p.subscribeTo} {profile.firstName || profile.username || "Creator"}
              </h2>
              <button
                onClick={() => { setShowSubscribeModal(false); setSubscribeAwaitingPayment(false); setSubscribePaymentId(null); setSubscribeError(null); }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Price info */}
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: `rgba(${accentRgb},0.08)`, border: `1px solid rgba(${accentRgb},0.2)` }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: gradientBg }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">${profile.creatorPriceUsd || 15}{p.perMonth}</p>
                <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>{p.exclusiveCreatorAccess}</p>
              </div>
            </div>

            {!subscribeAwaitingPayment ? (
              <>
                {/* Provider selector */}
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: "#8E8E93" }}>{p.paymentMethod}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["daimo", "epayco"] as const).map((prov) => (
                      <button
                        key={prov}
                        onClick={() => setSubscribeProvider(prov)}
                        className="py-2.5 rounded-lg text-sm font-medium transition-colors border"
                        style={subscribeProvider === prov
                          ? { background: `rgba(${accentRgb},0.15)`, color: accentColor, borderColor: `rgba(${accentRgb},0.4)` }
                          : { background: "rgba(255,255,255,0.04)", color: "#8E8E93", borderColor: "rgba(255,255,255,0.08)" }
                        }
                      >
                        {prov === "daimo" ? p.cryptoUsdc : p.epaycoCard}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Email input */}
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "#8E8E93" }}>{p.emailForReceipt}</label>
                  <input
                    type="email"
                    value={subscribeEmail}
                    onChange={(e) => { setSubscribeEmail(e.target.value); setSubscribeEmailError(null); }}
                    placeholder={p.emailPlaceholder}
                    className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-colors"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: subscribeEmailError ? "1px solid #FF453A" : "1px solid rgba(255,255,255,0.1)",
                    }}
                    autoComplete="email"
                    inputMode="email"
                  />
                  {subscribeEmailError && (
                    <p className="text-xs mt-1" style={{ color: "#FF453A" }}>{subscribeEmailError}</p>
                  )}
                </div>

                {subscribeError && (
                  <p className="text-xs text-center" style={{ color: "#FF453A" }}>{subscribeError}</p>
                )}

                <button
                  onClick={handleSubscribePayment}
                  disabled={subscribePaymentLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: gradientBg }}
                >
                  {subscribePaymentLoading ? p.openingPayment : p.payPerMonth.replace('${price}', String(profile.creatorPriceUsd || 15))}
                </button>
              </>
            ) : (
              <>
                {/* Awaiting payment state */}
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `rgba(${accentRgb},0.12)`, border: `1px solid rgba(${accentRgb},0.25)` }}>
                    <svg className="w-6 h-6 animate-spin" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-white text-center">{p.waitingForPaymentConfirmation}</p>
                  <p className="text-xs text-center" style={{ color: "#8E8E93" }}>
                    {p.completePaymentInTab}
                  </p>
                </div>

                {subscribeError && (
                  <p className="text-xs text-center" style={{ color: "#FF453A" }}>{subscribeError}</p>
                )}

                <button
                  onClick={handleCheckSubscriptionStatus}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white border transition-colors"
                  style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" }}
                >
                  {p.iCompletedPayment}
                </button>

                <button
                  onClick={() => { setSubscribeAwaitingPayment(false); setSubscribePaymentId(null); setSubscribeError(null); }}
                  className="text-xs text-center"
                  style={{ color: "#8E8E93" }}
                >
                  {p.goBack}
                </button>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── Identity & Connections (own profile only) ── */}
      {isOwnProfile && (
        <IdentityConnections telegramUsername={profile.username} />
      )}

      {/* ── Referral Card (own profile only) ── */}
      {isOwnProfile && <ReferralCard />}

      {/* ── App Preferences (own profile only) ── */}
      {isOwnProfile && (
        <div className="glass-card-sm p-5 mt-4">
          <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">
            {p.appPreferences}
          </h2>

          {/* Language toggle */}
          <div className="flex items-center justify-between rounded-lg px-3 py-3 mb-3" style={{ background: "rgba(94,209,196,0.06)", border: "1px solid rgba(94,209,196,0.2)" }}>
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm font-medium text-white">{p.languageIdioma}</p>
              <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                {p.choosePreferredLanguage}
              </p>
            </div>
            <div className="flex items-center rounded-full p-0.5 flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <button
                onClick={() => handleLanguageChange("en")}
                disabled={langSaving}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 disabled:opacity-50"
                style={{
                  background: lang === "en" ? "linear-gradient(135deg, #5ED1C4, #D4007A)" : "transparent",
                  color: lang === "en" ? "#fff" : "#8E8E93",
                }}
                aria-pressed={lang === "en"}
              >
                EN
              </button>
              <button
                onClick={() => handleLanguageChange("es")}
                disabled={langSaving}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 disabled:opacity-50"
                style={{
                  background: lang === "es" ? "linear-gradient(135deg, #5ED1C4, #D4007A)" : "transparent",
                  color: lang === "es" ? "#fff" : "#8E8E93",
                }}
                aria-pressed={lang === "es"}
              >
                ES
              </button>
            </div>
          </div>
          {langError && (
            <p className="text-xs mt-1" style={{ color: "#FF6B6B" }}>{langError}</p>
          )}

          <div className="flex items-center justify-between rounded-lg px-3 py-3" style={{ background: "rgba(255,180,84,0.06)", border: "1px solid rgba(255,180,84,0.15)" }}>
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm font-medium text-white">{p.wallOfFameConsent}</p>
              <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                {p.wallOfFameConsentDesc}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={wofConsent}
              aria-label="Wall of Fame photo consent"
              onClick={handleWofConsentToggle}
              disabled={wofConsentSaving}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              style={{
                background: wofConsent ? "#FFB454" : "rgba(255,255,255,0.15)",
              }}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: wofConsent ? "translateX(22px)" : "translateX(3px)" }}
              />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg px-3 py-3 mt-3" style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.15)" }}>
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm font-medium text-white">{p.contentDisclaimer}</p>
              <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                {p.contentDisclaimerDesc}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={contentDisclaimer}
              aria-label="Content disclaimer acknowledgment"
              onClick={handleContentDisclaimerToggle}
              disabled={contentDisclaimerSaving}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              style={{
                background: contentDisclaimer ? "#D4007A" : "rgba(255,255,255,0.15)",
              }}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: contentDisclaimer ? "translateX(22px)" : "translateX(3px)" }}
              />
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex border-b border-white/10 mb-4" role="tablist" aria-label="Profile sections">
        <button
          role="tab"
          aria-selected={activeTab === "posts"}
          onClick={() => setActiveTab("posts")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "posts"
              ? "text-white border-b-2"
              : "text-white/50 hover:text-white/70"
          }`}
          style={activeTab === "posts" ? { borderImage: `linear-gradient(to right, ${accentColor}, ${isPerformer ? "#00D4E8" : "#E69138"}) 1` } : undefined}
        >
          {p.tabPosts}
        </button>
        {/* Exclusive tab — only shown on active creator profiles */}
        {profile.creatorStatus === "active" && (
          <button
            role="tab"
            aria-selected={activeTab === "exclusive"}
            onClick={() => setActiveTab("exclusive")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "exclusive"
                ? "text-white border-b-2"
                : "text-white/50 hover:text-white/70"
            }`}
            style={activeTab === "exclusive" ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            {p.tabExclusive}
          </button>
        )}
        <button
          role="tab"
          aria-selected={activeTab === "likes"}
          onClick={() => setActiveTab("likes")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "likes"
              ? "text-white border-b-2"
              : "text-white/50 hover:text-white/70"
          }`}
          style={activeTab === "likes" ? { borderImage: `linear-gradient(to right, ${accentColor}, ${isPerformer ? "#00D4E8" : "#E69138"}) 1` } : undefined}
        >
          {p.tabLikes}
        </button>
      </div>

      {/* ── Compose (own profile, posts tab) ── */}
      {isOwnProfile && activeTab === "posts" && (
        <div className="mb-4">
          <ComposePost
            onPosted={() => loadProfile()}
            photoUrl={photoUrl}
            displayName={displayName}
          />
        </div>
      )}

      {/* ── Posts Feed ── */}
      {activeTab === "posts" && (
        <>
          {posts.length === 0 ? (
            <div className="glass-card-sm p-8 text-center">
              <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              <p className="text-white font-medium mb-1">{p.noPostsYet}</p>
              <p className="text-sm" style={{ color: "#8E8E93" }}>
                {isOwnProfile
                  ? p.shareFirstPost
                  : p.userHasntPosted}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  isOwn={String(user?.id) === post.author_id}
                  isOwnProfile={isOwnProfile}
                  isSubscribed={isSubscribed}
                  creatorPriceUsd={profile.creatorPriceUsd}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onAuthorTap={handleAuthorTap}
                  onSubscribeCta={handleSubscribeCta}
                />
              ))}

              {/* Load more */}
              {nextCursor && (
                <div className="text-center py-4">
                  <button
                    onClick={() => loadProfile(nextCursor)}
                    disabled={loadingMore}
                    className="text-sm font-medium hover:text-pnp-accent transition-colors"
                    style={{ color: "#8E8E93" }}
                  >
                    {loadingMore ? p.loading : p.loadMorePosts}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Likes Tab (placeholder) ── */}
      {activeTab === "likes" && (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#8E8E93" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <p className="text-white font-medium mb-1">{p.likedPosts}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {p.comingSoon}
          </p>
        </div>
      )}

      {/* ── Exclusive Tab ── */}
      {activeTab === "exclusive" && profile.creatorStatus === "active" && (
        <div role="tabpanel" aria-label="Exclusive posts">
          {/* Non-subscriber gate banner */}
          {!isOwnProfile && !isSubscribed && (
            <div
              className="glass-card-sm p-6 mb-4 text-center"
              style={{ border: "1px solid rgba(212,0,122,0.25)" }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <p className="text-white font-bold mb-1">{p.exclusiveContentTitle}</p>
              <p className="text-sm mb-4 leading-relaxed" style={{ color: "#8E8E93" }}>
                {profile.creatorPriceUsd != null
                  ? p.subscribeForPriceToUnlock.replace('${price}', String(profile.creatorPriceUsd))
                  : p.subscribeToUnlockAll}
              </p>
              {isAuthenticated ? (
                <button
                  onClick={() => {
                    handleSubscribe();
                    if (subscribeButtonRef.current) {
                      subscribeButtonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                  disabled={subscribeLoading}
                  className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-150 active:scale-[0.97] disabled:opacity-50 min-h-[44px]"
                  style={{ background: profile.creatorType === "ice" ? "linear-gradient(135deg, #A8D8EA, #73B4D4)" : "linear-gradient(135deg, #D4007A, #E69138)" }}
                  aria-label={`Subscribe for $${profile.creatorPriceUsd || 15}/mo`}
                >
                  {subscribeLoading ? p.processing : `${p.subscribe} $${profile.creatorPriceUsd || 15}/mo`}
                </button>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{p.signInToSubscribe}</p>
              )}
            </div>
          )}

          {/* Exclusive posts list */}
          {(() => {
            const exclusivePosts = posts.filter(p => p.is_exclusive);
            if (exclusivePosts.length === 0) {
              return (
                <div className="glass-card-sm p-8 text-center">
                  <svg className="w-12 h-12 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#8E8E93" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <p className="text-white font-medium mb-1">{p.noExclusivePostsYet}</p>
                  <p className="text-sm" style={{ color: "#8E8E93" }}>
                    {isOwnProfile
                      ? p.createFirstExclusivePost
                      : p.creatorNoExclusiveYet}
                  </p>
                </div>
              );
            }
            return (
              <div className="space-y-3">
                {exclusivePosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    isOwn={String(user?.id) === post.author_id}
                    isOwnProfile={isOwnProfile}
                    isSubscribed={isSubscribed}
                    creatorPriceUsd={profile.creatorPriceUsd}
                    onLike={handleLike}
                    onDelete={handleDelete}
                    onAuthorTap={handleAuthorTap}
                    onSubscribeCta={handleSubscribeCta}
                  />
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Edit Profile Modal ── */}
      {profile && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          profile={profile}
          onSaved={() => loadProfile()}
        />
      )}

      {/* ── Follow List Modal ── */}
      {showFollowModal && (
        <FollowListModal
          open={!!showFollowModal}
          mode={showFollowModal}
          targetUserId={targetUserId}
          onClose={() => setShowFollowModal(null)}
          onNavigate={(userId) => {
            if (userId === String(user?.id)) navigate("/profile");
            else navigate(`/profile/${userId}`);
          }}
        />
      )}
    </div>
  );
}
