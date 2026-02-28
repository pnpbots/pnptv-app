import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Badge, Modal, Input, Skeleton } from "@pnptv/ui-kit";
import {
  getProfile,
  getPublicProfile,
  updateProfile,
  uploadAvatar,
  togglePostLike,
  deleteSocialPost,
  createSocialPost,
  checkAuthStatus,
  unlinkAtproto,
  unlinkX,
  getAtprotoLoginUrl,
  getXLoginUrl,
  getAtprotoProfile,
  followUser,
  unfollowUser,
  getFollowStatus,
  getFollowersList,
  getFollowingList,
  getCreatorSubscriptionStatus,
  subscribeToCreator,
  unsubscribeFromCreator,
  getCreatorEligibility,
  activateCreator,
  type CreatorEligibility,
  type UserProfile,
  type SocialPostItem,
  type AuthMethods,
  type AtprotoProfile,
  type FollowListUser,
} from "@/lib/api";

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
  onLike,
  onDelete,
  onAuthorTap,
}: {
  post: SocialPostItem;
  isOwn: boolean;
  onLike: (id: number) => void;
  onDelete: (id: number) => void;
  onAuthorTap?: (userId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const photoUrl = resolvePhotoUrl(post.author_photo);

  return (
    <div className="glass-card-sm p-4">
      <div className="flex gap-3">
        {/* Avatar */}
        <button
          onClick={() => onAuthorTap?.(post.author_id)}
          className="flex-shrink-0"
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
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
              {post.author_first_name || post.author_username || "Anonymous"}
            </button>
            {post.author_username && (
              <span className="text-xs" style={{ color: "#8E8E93" }}>
                @{post.author_username}
              </span>
            )}
            <span className="text-xs" style={{ color: "#8E8E93" }}>
              &middot; {timeAgo(post.created_at)}
            </span>
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
                  alt=""
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
            >
              <svg className="w-4 h-4" fill={post.liked_by_me ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              {post.likes_count > 0 && <span>{post.likes_count}</span>}
            </button>

            {/* Replies */}
            <span className="flex items-center gap-1.5 text-xs">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
                title="Delete post"
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(profile.firstName || "");
    setLastName(profile.lastName || "");
    setBio(profile.bio || "");
    setLocationText(profile.locationText || "");
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ firstName, lastName, bio, locationText });
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Profile">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">First Name</label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
            />
          </div>
          <div>
            <label className="block text-xs text-pnp-textSecondary mb-1">Last Name</label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 160))}
            placeholder="Tell the world about yourself..."
            className="w-full rounded-lg border border-pnp-border bg-pnp-bg text-pnp-textPrimary text-sm p-3 resize-none outline-none focus:border-pnp-accent"
            rows={3}
          />
          <span className="text-xs text-pnp-textSecondary float-right">{bio.length}/160</span>
        </div>
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1">Location</label>
          <Input
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
            placeholder="City, Country"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-2">
          <Button variant="danger" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <button
            onClick={handleSave}
            disabled={saving || !firstName.trim()}
            className="flex-1 btn-gradient px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
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
          <img src={photoUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
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
            placeholder="What's happening?"
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
              <img src={mediaPreview} alt="Preview" className="max-h-40 rounded-lg object-cover" />
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
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setMediaFile(file);
                    setMediaPreview(URL.createObjectURL(file));
                  }
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={posting}
                className="hover:text-pnp-accent transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" />
                </svg>
              </button>
            </div>
            <button
              onClick={handlePost}
              disabled={!text.trim() || posting}
              className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
            >
              {posting ? "Posting..." : "Post"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bluesky SVG Icon ─────────────────────────────────────────────────────────

function BlueskySvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 320" fill="currentColor" aria-hidden="true">
      <path d="M180 142c-16.3-31.7-60.7-90.8-102-120C38.5-2.9 27.2 1 18.8 1 8.3 1 0 7.8 0 25.4 0 39 6.6 116.7 10.3 132.9 23 187.7 74.3 207 122.7 202c-71 10.5-133.3 41-67.3 147.9 51.7 81.4 103.3 27.8 127.2 0 24-27.9 53.7-87.3 53.7-87.3s29.7 59.4 53.7 87.3c23.9 27.8 75.5 81.4 127.2 0 66-106.9 3.7-137.4-67.3-147.9 48.4 5 99.7-14.3 112.4-69.1 3.7-16.2 10.3-93.9 10.3-107.5C360 7.8 351.7 1 341.2 1c-8.4 0-19.7-3.9-59.2 21C240.7 51.2 196.3 110.3 180 142z" />
    </svg>
  );
}

// ── Bluesky Profile Panel ─────────────────────────────────────────────────────

function BlueskyProfilePanel({
  handle,
  onUnlink,
  unlinking,
  unlinkError,
}: {
  handle: string;
  onUnlink: () => void;
  unlinking: boolean;
  unlinkError: string | null;
}) {
  const [profile, setProfile] = useState<AtprotoProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await getAtprotoProfile();
      if (res.success && res.profile) {
        setProfile(res.profile);
      } else {
        // Backend may not have /api/atproto/profile yet — degrade gracefully
        setProfile(null);
      }
    } catch {
      setProfileError(null); // Silently degrade — profile counts are non-critical
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ background: "rgba(0,133,255,0.06)", border: "1px solid rgba(0,133,255,0.2)" }}>
      {/* Profile header */}
      <div className="flex items-center gap-3 p-4">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {profileLoading ? (
            <div className="w-12 h-12 rounded-full bg-white/10 animate-pulse" />
          ) : profile?.avatar ? (
            <img
              src={profile.avatar}
              alt={profile.displayName || handle}
              className="w-12 h-12 rounded-full object-cover border-2"
              style={{ borderColor: "rgba(0,133,255,0.4)" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0085FF, #00BAFF)" }}
            >
              <BlueskySvg className="w-6 h-6 text-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {profileLoading ? (
            <div className="space-y-1.5">
              <div className="h-4 bg-white/10 rounded animate-pulse w-32" />
              <div className="h-3 bg-white/10 rounded animate-pulse w-24" />
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-white truncate">
                {profile?.displayName || handle}
              </p>
              <a
                href={profile?.profileUrl || `https://bsky.app/profile/${handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs flex items-center gap-1 hover:underline"
                style={{ color: "#0085FF" }}
                aria-label={`View @${handle} on Bluesky`}
              >
                @{handle}
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </>
          )}
        </div>

        {/* Connected badge */}
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}
        >
          Connected
        </span>
      </div>

      {/* Stats row */}
      {!profileLoading && profile && (
        <div className="flex items-center border-t px-4 py-3 gap-6" style={{ borderColor: "rgba(0,133,255,0.15)" }}>
          <div className="text-center">
            <p className="text-sm font-bold text-white">{profile.postsCount?.toLocaleString() ?? "—"}</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>Posts</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-white">{profile.followersCount?.toLocaleString() ?? "—"}</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>Followers</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-white">{profile.followsCount?.toLocaleString() ?? "—"}</p>
            <p className="text-xs" style={{ color: "#8E8E93" }}>Following</p>
          </div>
          <div className="ml-auto">
            <a
              href={profile.profileUrl || `https://bsky.app/profile/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white btn-bluesky inline-flex items-center gap-1.5"
              aria-label="Open Bluesky profile in new tab"
            >
              <BlueskySvg className="w-3.5 h-3.5" />
              Open
            </a>
          </div>
        </div>
      )}

      {/* Description / bio */}
      {!profileLoading && profile?.description && (
        <div className="px-4 pb-3">
          <p className="text-xs text-white/70 leading-relaxed line-clamp-2">{profile.description}</p>
        </div>
      )}

      {/* Error state for profile loading */}
      {profileError && (
        <div className="px-4 pb-3">
          <p className="text-xs" style={{ color: "#8E8E93" }}>Could not load Bluesky profile details.</p>
        </div>
      )}

      {/* Unlink row */}
      <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: "rgba(0,133,255,0.15)" }}>
        <p className="text-xs" style={{ color: "#8E8E93" }}>
          Posts can be cross-posted to Bluesky when composing.
        </p>
        <button
          onClick={onUnlink}
          disabled={unlinking}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 flex-shrink-0 ml-3"
          aria-label="Unlink Bluesky account"
        >
          {unlinking ? "Unlinking..." : "Unlink"}
        </button>
      </div>

      {/* Unlink error */}
      {unlinkError && (
        <div className="px-4 pb-3">
          <p className="text-xs text-red-400">{unlinkError}</p>
        </div>
      )}
    </div>
  );
}

// ── Bluesky Connect Form ──────────────────────────────────────────────────────

function BlueskyConnectForm() {
  const [handleInput, setHandleInput] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleConnect = async () => {
    const raw = handleInput.trim().replace(/^@/, "");
    if (!raw || raw.length < 3) {
      setHandleError("Enter a valid Bluesky handle, e.g. yourname.bsky.social");
      inputRef.current?.focus();
      return;
    }

    // Basic handle format validation before redirect
    if (!raw.includes(".") || raw.length < 5) {
      setHandleError("Handle must include a domain, e.g. yourname.bsky.social");
      inputRef.current?.focus();
      return;
    }

    setResolving(true);
    setHandleError(null);

    // Redirect to the backend OAuth initiation URL.
    // The backend resolves the handle, generates PKCE + state, sends PAR,
    // and redirects to the Bluesky authorization server.
    window.location.href = getAtprotoLoginUrl(raw);
  };

  return (
    <div className="mt-3 space-y-3">
      {/* Explainer */}
      <div className="rounded-xl p-4" style={{ background: "rgba(0,133,255,0.06)", border: "1px solid rgba(0,133,255,0.2)" }}>
        <div className="flex gap-3 items-start">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: "linear-gradient(135deg, #0085FF, #00BAFF)" }}
          >
            <BlueskySvg className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white mb-1">Connect your Bluesky account</p>
            <p className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>
              Link your AT Protocol identity to cross-post to Bluesky and bring your social graph to PNPtv.
            </p>
          </div>
        </div>
      </div>

      {/* Handle input + Connect button */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sm select-none pointer-events-none font-medium"
            style={{ color: "#8E8E93" }}
            aria-hidden="true"
          >
            @
          </span>
          <input
            ref={inputRef}
            id="bsky-handle-input"
            type="text"
            inputMode="url"
            value={handleInput}
            onChange={(e) => {
              setHandleInput(e.target.value);
              setHandleError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
            placeholder="yourname.bsky.social"
            className="w-full pl-7 pr-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors"
            style={{
              borderColor: handleError ? "#FF453A" : "rgba(255,255,255,0.15)",
            }}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            disabled={resolving}
            aria-label="Bluesky handle"
            aria-describedby={handleError ? "bsky-handle-error" : "bsky-handle-hint"}
            aria-invalid={!!handleError}
          />
        </div>
        <button
          onClick={handleConnect}
          disabled={resolving || !handleInput.trim()}
          className="btn-bluesky px-4 py-2.5 rounded-lg text-white text-sm font-semibold whitespace-nowrap flex items-center gap-2 min-w-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Connect Bluesky account"
        >
          {resolving ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <>
              <BlueskySvg className="w-4 h-4" />
              Connect
            </>
          )}
        </button>
      </div>

      {handleError ? (
        <p id="bsky-handle-error" className="text-xs text-red-400" role="alert">{handleError}</p>
      ) : (
        <p id="bsky-handle-hint" className="text-xs" style={{ color: "#8E8E93" }}>
          You will be redirected to Bluesky to authorize the connection securely.
        </p>
      )}
    </div>
  );
}

// ── Identity & Connections Section ───────────────────────────────────────────

interface AtprotoState {
  linked: boolean;
  handle: string | null;
  did: string | null;
  loading: boolean;
}

function IdentityConnections({ telegramUsername }: { telegramUsername?: string }) {
  const [atproto, setAtproto] = useState<AtprotoState>({
    linked: false,
    handle: null,
    did: null,
    loading: true,
  });
  const [xLinked, setXLinked] = useState(false);
  const [xHandle, setXHandle] = useState<string | null>(null);
  const [xLoading, setXLoading] = useState(true);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [xUnlinking, setXUnlinking] = useState(false);
  const [xUnlinkError, setXUnlinkError] = useState<string | null>(null);
  const [unlinkVersion, setUnlinkVersion] = useState(0);

  // Load current ATProto + X identity from auth-status
  useEffect(() => {
    let cancelled = false;
    checkAuthStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.authenticated && status.user) {
          const methods = status.user.auth_methods as AuthMethods | undefined;
          setAtproto({
            linked: !!methods?.atproto,
            handle: status.user.atproto_handle ?? null,
            did: status.user.atproto_did ?? null,
            loading: false,
          });
          setXLinked(!!methods?.x);
          setXHandle(status.user.x_handle ?? null);
        } else {
          setAtproto({ linked: false, handle: null, did: null, loading: false });
          setXLinked(false);
          setXHandle(null);
        }
        setXLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setAtproto({ linked: false, handle: null, did: null, loading: false });
          setXLinked(false);
          setXHandle(null);
          setXLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unlinkVersion]);

  const handleUnlink = async () => {
    setUnlinking(true);
    setUnlinkError(null);
    try {
      await unlinkAtproto();
      setAtproto({ linked: false, handle: null, did: null, loading: false });
      setUnlinkVersion((v) => v + 1);
    } catch (err: unknown) {
      setUnlinkError(err instanceof Error ? err.message : "Failed to unlink account");
    } finally {
      setUnlinking(false);
    }
  };

  const handleUnlinkX = async () => {
    setXUnlinking(true);
    setXUnlinkError(null);
    try {
      await unlinkX();
      setXLinked(false);
      setXHandle(null);
      setUnlinkVersion((v) => v + 1);
    } catch (err: unknown) {
      setXUnlinkError(err instanceof Error ? err.message : "Failed to unlink X account");
    } finally {
      setXUnlinking(false);
    }
  };

  return (
    <div className="glass-card-sm p-5 mt-4">
      <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">
        Identity &amp; Connections
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
              <p className="text-sm font-medium text-white">Telegram</p>
              {telegramUsername ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>@{telegramUsername}</p>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>Connected</p>
              )}
            </div>
          </div>
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}
          >
            Connected
          </span>
        </div>

        {/* Bluesky / ATProto section */}
        <div className="py-2">
          <div className="flex items-center gap-3">
            {/* Bluesky icon */}
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #0085FF, #00BAFF)" }}
              aria-hidden="true"
            >
              <BlueskySvg className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Bluesky</p>
              {atproto.loading ? (
                <div className="h-3 w-24 bg-white/10 rounded animate-pulse mt-0.5" />
              ) : atproto.linked && atproto.handle ? (
                <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{atproto.handle}</p>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>Not connected</p>
              )}
            </div>
            {/* Connection status badge */}
            {!atproto.loading && (
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                style={
                  atproto.linked
                    ? { background: "rgba(0,133,255,0.15)", color: "#0085FF" }
                    : { background: "rgba(142,142,147,0.15)", color: "#8E8E93" }
                }
              >
                {atproto.linked ? "Linked" : "Unlinked"}
              </span>
            )}
          </div>

          {/* Connected: show full Bluesky profile panel */}
          {!atproto.loading && atproto.linked && atproto.handle && (
            <BlueskyProfilePanel
              handle={atproto.handle}
              onUnlink={handleUnlink}
              unlinking={unlinking}
              unlinkError={unlinkError}
            />
          )}

          {/* Not connected: show connect form */}
          {!atproto.loading && !atproto.linked && (
            <BlueskyConnectForm />
          )}

          {/* Loading skeleton for Bluesky section body */}
          {atproto.loading && (
            <div className="mt-3 rounded-xl p-4 animate-pulse" style={{ background: "rgba(0,133,255,0.06)", border: "1px solid rgba(0,133,255,0.15)" }}>
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full bg-white/10" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-white/10 rounded w-28" />
                  <div className="h-3 bg-white/10 rounded w-20" />
                </div>
              </div>
            </div>
          )}
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
              <p className="text-sm font-medium text-white">X (Twitter)</p>
              {xLoading ? (
                <div className="h-3 w-24 bg-white/10 rounded animate-pulse mt-0.5" />
              ) : xLinked && xHandle ? (
                <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{xHandle}</p>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>Not connected</p>
              )}
            </div>
            {!xLoading && (
              xLinked ? (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}
                >
                  Connected
                </span>
              ) : (
                <button
                  onClick={() => { window.location.href = getXLoginUrl(); }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 transition-colors hover:opacity-80"
                  style={{ background: "rgba(255, 255, 255, 0.1)", color: "#FFFFFF" }}
                >
                  Connect
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
                {xUnlinking ? "Unlinking..." : "Unlink X account"}
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
    <Modal open={open} onClose={onClose} title={mode === "followers" ? "Followers" : "Following"}>
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
          <p className="text-white font-medium mb-1">No {mode === "followers" ? "Followers" : "Following"}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {mode === "followers" ? "No one is following yet." : "Not following anyone yet."}
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
                <img src={u.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
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
                {loadingMore ? "Loading..." : "Load More"}
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
  { id: "ice" as const, label: "Ice", price: 5, color: "#A8D8EA", gradient: "linear-gradient(135deg, #A8D8EA, #73B4D4)", emoji: "\u2744\uFE0F" },
  { id: "crystal" as const, label: "Crystal", price: 10, color: "#C490E4", gradient: "linear-gradient(135deg, #C490E4, #9B59B6)", emoji: "\uD83D\uDD2E" },
  { id: "diamond" as const, label: "Diamond", price: 15, color: "#5ED1C4", gradient: "linear-gradient(135deg, #5ED1C4, #00D4E8)", emoji: "\uD83D\uDC8E" },
] as const;

type TierId = typeof CREATOR_TIERS[number]["id"];

function CreatorTermsModal({
  open,
  tier,
  onAccept,
  onClose,
  accepting,
}: {
  open: boolean;
  tier: TierId;
  onAccept: () => void;
  onClose: () => void;
  accepting: boolean;
}) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tierInfo = CREATOR_TIERS.find((t) => t.id === tier)!;

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      setScrolledToBottom(true);
    }
  };

  useEffect(() => {
    setScrolledToBottom(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">Creator Terms & Conditions</h2>
            <p className="text-xs mt-0.5" style={{ color: tierInfo.color }}>
              {tierInfo.emoji} {tierInfo.label} Profile &middot; ${tierInfo.price}/mo
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/60">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable terms content */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-4 text-sm text-white/80 leading-relaxed space-y-4"
          style={{ maxHeight: "60vh" }}
        >
          <p className="font-semibold text-white text-base">PNPtv! Creator Monetization Agreement</p>
          <p className="text-xs" style={{ color: "#8E8E93" }}>Effective Date: February 28, 2026 &middot; Last Updated: February 28, 2026</p>

          <div>
            <p className="font-semibold text-white mb-1">1. Profile Tiers & Pricing</p>
            <p>Creators may choose one of three monetization tiers. Subscribers pay monthly to access your exclusive content:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
              <li><span style={{ color: "#A8D8EA" }}>Ice Profile</span> &mdash; $5.00 USD/month</li>
              <li><span style={{ color: "#C490E4" }}>Crystal Profile</span> &mdash; $10.00 USD/month</li>
              <li><span style={{ color: "#5ED1C4" }}>Diamond Profile</span> &mdash; $15.00 USD/month</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">2. Revenue Split</p>
            <p>All subscription revenue is split <strong className="text-white">70/30</strong>: you receive 70% of each subscription payment, and PNPtv! retains 30% as a platform fee. Payments are processed exclusively through <strong className="text-white">Daimo Pay</strong> (USDC on Optimism network).</p>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">3. Monthly Payouts</p>
            <p>Creator earnings are paid out automatically on the <strong className="text-white">1st day of each month</strong> via Daimo Pay to your registered wallet address. Minimum payout threshold: $1.00 USD. Earnings below the threshold carry over to the next month.</p>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">4. Content Activity Requirements</p>
            <p>To maintain your creator profile, you must continue meeting the activity criteria that qualified you for monetization. This includes maintaining regular media posts, engagement, and follower activity. Activity is evaluated on a rolling monthly basis.</p>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">5. Strike System</p>
            <p>If you fail to maintain the required activity levels during a calendar month, you will receive a <strong className="text-white">strike</strong>. The strike policy is as follows:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
              <li><strong className="text-white">Strike 1:</strong> Warning notification. You have 14 days to restore activity.</li>
              <li><strong className="text-white">Strike 2:</strong> Final warning. Your profile will be flagged. You have 7 days to restore activity.</li>
              <li><strong className="text-white">Strike 3:</strong> Your creator profile is <strong className="text-red-400">deactivated</strong>. You revert to a regular user profile.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">6. Deactivation & Subscriber Reimbursement</p>
            <p>Upon deactivation due to 3 strikes:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
              <li>Your exclusive content becomes inaccessible to subscribers.</li>
              <li>All active subscribers receive a <strong className="text-white">50% refund</strong> of their most recent subscription payment, issued via Daimo Pay.</li>
              <li>Your accumulated unpaid earnings are forfeited for the current period.</li>
              <li>You may re-apply for creator status after 90 days by meeting eligibility criteria again.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">7. Voluntary Deactivation</p>
            <p>You may voluntarily deactivate your creator profile at any time. Active subscribers will retain access until their current billing period expires. No refunds are issued for voluntary deactivation.</p>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">8. Content Guidelines</p>
            <p>All content must comply with PNPtv! Community Guidelines. Exclusive content that violates platform rules may result in immediate deactivation without the standard strike process. PNPtv! reserves the right to remove any content at its discretion.</p>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">9. Tier Changes</p>
            <p>You may upgrade or downgrade your tier at any time. Changes take effect at the start of the next billing cycle for existing subscribers. New subscribers are charged the updated tier price immediately.</p>
          </div>

          <div>
            <p className="font-semibold text-white mb-1">10. Amendments</p>
            <p>PNPtv! reserves the right to modify these terms with 30 days written notice. Continued use of the creator monetization features after the notice period constitutes acceptance of the updated terms.</p>
          </div>

          <div className="pt-2 border-t border-white/10">
            <p className="text-xs" style={{ color: "#8E8E93" }}>
              By tapping "Accept & Activate" below, you acknowledge that you have read, understood, and agree to be bound by these Creator Terms & Conditions.
            </p>
          </div>
        </div>

        {/* Footer with accept button */}
        <div className="px-5 py-4 border-t border-white/10">
          {!scrolledToBottom && (
            <p className="text-xs text-center mb-2" style={{ color: "#FFB454" }}>
              Scroll down to read the full terms before accepting
            </p>
          )}
          <button
            onClick={onAccept}
            disabled={!scrolledToBottom || accepting}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: scrolledToBottom ? tierInfo.gradient : "rgba(255,255,255,0.05)" }}
          >
            {accepting ? "Activating..." : `Accept & Activate ${tierInfo.emoji} ${tierInfo.label} Profile`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Monetize Content Button ──────────────────────────────────────────────────

function MonetizeContentCard({ creatorStatus, onActivated }: { creatorStatus?: string; onActivated?: () => void }) {
  const navigate = useNavigate();
  const [eligibility, setEligibility] = useState<CreatorEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<TierId>("ice");
  const [showTerms, setShowTerms] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  useEffect(() => {
    getCreatorEligibility()
      .then((res) => { if (res.success) setEligibility(res); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleMonetizeTap = () => {
    setShowTerms(true);
  };

  const handleAcceptAndActivate = async () => {
    setActivating(true);
    setActivateError(null);
    try {
      await activateCreator(selectedTier, true);
      setShowTerms(false);
      onActivated?.();
      navigate("/creator");
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : "Failed to activate");
    } finally {
      setActivating(false);
    }
  };

  // Don't show for active creators or pending review
  if (creatorStatus === "active" || creatorStatus === "pending_review") return null;

  if (loading) {
    return (
      <div className="glass-card-sm p-4 mt-4 animate-pulse">
        <div className="h-5 bg-white/5 rounded w-40 mb-2" />
        <div className="h-3 bg-white/5 rounded w-full" />
      </div>
    );
  }

  if (!eligibility) return null;

  const isEligible = eligibility.eligible;
  const criteria = eligibility.criteria;
  const totalRequired = Object.values(criteria).length;
  const totalMet = Object.values(criteria).filter((c) => c.met).length;
  const overallPct = Math.round((totalMet / totalRequired) * 100);

  return (
    <>
      <div
        className="glass-card-sm p-4 mt-4"
        style={{ borderColor: isEligible ? "rgba(94,209,196,0.3)" : "rgba(212,0,122,0.15)" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: isEligible ? "#5ED1C4" : "#D4007A" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-semibold text-white">Monetize Content</p>
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
              Choose your creator tier. Subscribers pay monthly for your exclusive content (70/30 revenue split, payouts via Daimo on the 1st).
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
                      background: isSelected ? `${tier.gradient}` : "rgba(255,255,255,0.03)",
                      border: isSelected ? `2px solid ${tier.color}` : "2px solid rgba(255,255,255,0.08)",
                      opacity: isSelected ? 1 : 0.7,
                    }}
                  >
                    <p className="text-lg mb-0.5">{tier.emoji}</p>
                    <p className={`text-xs font-bold ${isSelected ? "text-white" : "text-white/70"}`}>{tier.label}</p>
                    <p className={`text-sm font-bold mt-0.5 ${isSelected ? "text-white" : ""}`} style={!isSelected ? { color: tier.color } : undefined}>
                      ${tier.price}<span className="text-xs font-normal">/mo</span>
                    </p>
                  </button>
                );
              })}
            </div>

            {activateError && (
              <p className="text-xs text-red-400 mb-2">{activateError}</p>
            )}

            <button
              onClick={handleMonetizeTap}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ background: CREATOR_TIERS.find((t) => t.id === selectedTier)!.gradient }}
            >
              {CREATOR_TIERS.find((t) => t.id === selectedTier)!.emoji} Activate {CREATOR_TIERS.find((t) => t.id === selectedTier)!.label} Profile
            </button>
          </>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "#8E8E93" }}>
              Meet these requirements to unlock creator monetization:
            </p>

            {/* Overall progress bar */}
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

            {/* Criteria rows */}
            <div className="space-y-2">
              {([
                { key: "mediaPosts", label: "Media Posts", icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25c0 .828.672 1.5 1.5 1.5z" },
                { key: "totalLikes", label: "Total Likes", icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" },
                { key: "followers", label: "Followers", icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" },
                { key: "weeklyConsistency", label: "Weekly Posts (4 wks)", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
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
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="#8E8E93" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-white/80 truncate">{label}</span>
                        <span className="text-xs font-medium ml-2 flex-shrink-0" style={{ color: c.met ? "#5ED1C4" : "#8E8E93" }}>
                          {c.met ? "Done" : `${remaining} more`}
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

            {/* Disabled button */}
            <button
              disabled
              className="w-full mt-3 py-2.5 rounded-lg text-sm font-semibold text-white/40 cursor-not-allowed"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Complete requirements to monetize
            </button>
          </>
        )}
      </div>

      {/* T&C Modal */}
      <CreatorTermsModal
        open={showTerms}
        tier={selectedTier}
        onAccept={handleAcceptAndActivate}
        onClose={() => setShowTerms(false)}
        accepting={activating}
      />
    </>
  );
}

// ── Main Profile Page ────────────────────────────────────────────────────────

export default function Profile() {
  const { isAuthenticated, user, login, logout, refreshUser } = useAuth();
  const { userId: paramUserId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const isOwnProfile = !paramUserId || paramUserId === String(user?.id);
  const targetUserId = paramUserId || String(user?.id || "");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"posts" | "likes">("posts");
  const [wofConsent, setWofConsent] = useState(false);
  const [wofConsentSaving, setWofConsentSaving] = useState(false);

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

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubscribe = async () => {
    if (subscribeLoading || !profile) return;
    setSubscribeLoading(true);
    setSubscribeError(null);
    try {
      if (isSubscribed) {
        await unsubscribeFromCreator(profile.id || paramUserId!);
        setIsSubscribed(false);
      } else {
        await subscribeToCreator(profile.id || paramUserId!);
        setIsSubscribed(true);
      }
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : "Failed");
    }
    setSubscribeLoading(false);
  };

  const handleAuthorTap = (authorId: string) => {
    if (authorId === String(user?.id)) {
      navigate("/profile");
    } else {
      navigate(`/profile/${authorId}`);
    }
  };

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
        <h1 className="text-xl font-bold text-white mb-2">Sign In Required</h1>
        <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>
          Sign in to view your profile and share with the community.
        </p>
        <Button onClick={login}>Sign In</Button>
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
        <p className="text-white font-medium mb-1">Profile Not Found</p>
        <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{error || "This user doesn't exist."}</p>
        <Button onClick={() => navigate("/")}>Go Home</Button>
      </div>
    );
  }

  const photoUrl = resolvePhotoUrl(profile.photoUrl);
  const displayName = profile.firstName + (profile.lastName ? ` ${profile.lastName}` : "");
  const initial = displayName[0]?.toUpperCase() || "U";
  const isPrime = profile.tier?.toLowerCase() === "prime";
  const isPerformer = !!profile.performerData;
  // Performer theme colors (teal/gold) vs default user theme (pink/orange)
  const accentGradient = isPerformer
    ? "linear-gradient(135deg, #5ED1C4, #00D4E8)"
    : "linear-gradient(135deg, #D4007A, #E69138)";
  const accentColor = isPerformer ? "#5ED1C4" : "#D4007A";
  const accentBorder = isPerformer ? "rgba(94,209,196,0.35)" : "rgba(255,255,255,0.1)";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
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
          Back
        </button>
      )}

      {/* ── Profile Header Card ── */}
      <div
        className="glass-card-sm p-6 mb-4"
        style={isPerformer ? { borderColor: "rgba(94,209,196,0.2)" } : undefined}
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
                  title="Change photo"
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
              {isPerformer && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Performer
                </span>
              )}
              {profile.creatorVerified && (
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="#5ED1C4" aria-label="Verified creator">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              )}
              {profile.creatorStatus === "active" && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                  Creator
                </span>
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
                <span className="ml-1" style={{ color: "#8E8E93" }}>Posts</span>
              </span>
              <button
                onClick={() => setShowFollowModal("followers")}
                className="text-sm hover:underline text-left"
              >
                <strong className="text-white">{followersCount}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>Followers</span>
              </button>
              <button
                onClick={() => setShowFollowModal("following")}
                className="text-sm hover:underline text-left"
              >
                <strong className="text-white">{followingCount}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>Following</span>
              </button>
              {profile.creatorStatus === "active" && (profile.creatorSubscriberCount || 0) > 0 && (
                <span className="text-sm">
                  <strong className="text-white">{profile.creatorSubscriberCount}</strong>
                  <span className="ml-1" style={{ color: "#8E8E93" }}>Subscribers</span>
                </span>
              )}
              {isPerformer && profile.performerData!.averageRating > 0 && (
                <span className="text-sm flex items-center gap-1" style={{ color: "#5ED1C4" }}>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  <strong className="text-white">{profile.performerData!.averageRating.toFixed(1)}</strong>
                  <span style={{ color: "#8E8E93" }}>Rating</span>
                </span>
              )}
              {isPerformer && (
                <span className="text-sm">
                  <strong className="text-white">{profile.performerData!.totalCalls}</strong>
                  <span className="ml-1" style={{ color: "#8E8E93" }}>Calls</span>
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
              Joined {formatDate(profile.memberSince)}
            </p>
          </div>
        </div>

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
                  ? (profile.performerData!.availabilityMessage || "Available for calls")
                  : "Currently unavailable"}
              </span>
            </div>
            <span className="text-sm font-bold" style={{ color: "#5ED1C4" }}>
              ${profile.performerData!.basePrice}/call
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mt-4">
          {isOwnProfile ? (
            <>
              <button
                onClick={() => setEditOpen(true)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white border border-white/20 hover:border-white/40 transition-colors"
              >
                Edit Profile
              </button>
              {profile.creatorStatus === "active" && (
                <button
                  onClick={() => navigate("/creator")}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}
                >
                  Creator Dashboard
                </button>
              )}
              <Button variant="danger" className="px-4" onClick={logout}>
                Sign Out
              </Button>
            </>
          ) : (
            <>
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
                  {followLoading ? "..." : isFollowing ? "Following" : "Follow"}
                </button>
              )}
              {followError && (
                <p className="text-xs text-center w-full" style={{ color: "#FF453A" }}>{followError}</p>
              )}
              <button
                onClick={() => navigate(`/dm/${profile.id || paramUserId}`)}
                className="flex-1 py-2 rounded-lg text-white text-sm font-semibold border border-white/20 hover:border-white/40 transition-colors"
              >
                Message
              </button>
              {profile.creatorStatus === "active" && isAuthenticated && (
                <button
                  onClick={handleSubscribe}
                  disabled={subscribeLoading}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                  style={isSubscribed
                    ? { background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }
                    : { background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }
                  }
                >
                  {subscribeLoading ? "..." : isSubscribed ? "Subscribed" : `Subscribe $${profile.creatorPriceUsd || 15}/mo`}
                </button>
              )}
            </>
          )}
        </div>
        {subscribeError && (
          <p className="text-xs text-red-400 mt-2 text-center">{subscribeError}</p>
        )}
      </div>

      {/* ── Identity & Connections (own profile only) ── */}
      {isOwnProfile && (
        <IdentityConnections telegramUsername={profile.username} />
      )}

      {/* ── Privacy Preferences (own profile only) ── */}
      {isOwnProfile && (
        <div className="glass-card-sm p-5 mt-4">
          <h2 className="text-sm font-semibold text-white mb-4 tracking-wide uppercase opacity-60">
            Privacy Preferences
          </h2>
          <div className="flex items-center justify-between rounded-lg px-3 py-3" style={{ background: "rgba(255,180,84,0.06)", border: "1px solid rgba(255,180,84,0.15)" }}>
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm font-medium text-white">Wall of Fame Photo Consent</p>
              <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                Allow your Wall of Fame photos to appear in the Social Feed on the web app
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
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex border-b border-white/10 mb-4">
        <button
          onClick={() => setActiveTab("posts")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "posts"
              ? "text-white border-b-2"
              : "text-white/50"
          }`}
          style={activeTab === "posts" ? { borderImage: `linear-gradient(to right, ${accentColor}, ${isPerformer ? "#00D4E8" : "#E69138"}) 1` } : undefined}
        >
          Posts
        </button>
        <button
          onClick={() => setActiveTab("likes")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "likes"
              ? "text-white border-b-2"
              : "text-white/50"
          }`}
          style={activeTab === "likes" ? { borderImage: `linear-gradient(to right, ${accentColor}, ${isPerformer ? "#00D4E8" : "#E69138"}) 1` } : undefined}
        >
          Likes
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
              <p className="text-white font-medium mb-1">No Posts Yet</p>
              <p className="text-sm" style={{ color: "#8E8E93" }}>
                {isOwnProfile
                  ? "Share your first post with the community!"
                  : "This user hasn't posted anything yet."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  isOwn={String(user?.id) === post.author_id}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onAuthorTap={handleAuthorTap}
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
                    {loadingMore ? "Loading..." : "Load more posts"}
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
          <p className="text-white font-medium mb-1">Liked Posts</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Coming soon
          </p>
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
