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
  getAtprotoLoginUrl,
  type UserProfile,
  type SocialPostItem,
  type AuthMethods,
} from "@/lib/api";

function resolvePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url;
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
  const [handleInput, setHandleInput] = useState("");
  const [showHandleInput, setShowHandleInput] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [unlinkSuccess, setUnlinkSuccess] = useState(false);

  // Load current ATProto identity from auth-status
  useEffect(() => {
    let cancelled = false;
    checkAuthStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.authenticated && status.user) {
          setAtproto({
            linked: !!(status.user.auth_methods as AuthMethods | undefined)?.atproto,
            handle: status.user.atproto_handle ?? null,
            did: status.user.atproto_did ?? null,
            loading: false,
          });
        } else {
          setAtproto({ linked: false, handle: null, did: null, loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAtproto({ linked: false, handle: null, did: null, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unlinkSuccess]);

  const handleLink = () => {
    const raw = handleInput.trim().replace(/^@/, "");
    if (!raw || raw.length < 3) {
      setHandleError("Enter a valid Bluesky handle, e.g. yourname.bsky.social");
      return;
    }
    // Redirect to the backend OAuth initiation — the backend will resolve the handle,
    // send PAR, and redirect the user to the Bluesky authorization server.
    window.location.href = getAtprotoLoginUrl(raw);
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    setUnlinkError(null);
    try {
      await unlinkAtproto();
      setAtproto({ linked: false, handle: null, did: null, loading: false });
      setUnlinkSuccess((prev) => !prev); // Toggle to re-trigger useEffect
    } catch (err: unknown) {
      setUnlinkError(err instanceof Error ? err.message : "Failed to unlink account");
    } finally {
      setUnlinking(false);
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
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
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

        {/* ATProto / Bluesky row */}
        <div className="py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Bluesky butterfly logo */}
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #0085FF, #00BAFF)" }}
              >
                <svg className="w-5 h-5 text-white" viewBox="0 0 360 320" fill="currentColor">
                  <path d="M180 142c-16.3-31.7-60.7-90.8-102-120C38.5-2.9 27.2 1 18.8 1 8.3 1 0 7.8 0 25.4 0 39 6.6 116.7 10.3 132.9 23 187.7 74.3 207 122.7 202c-71 10.5-133.3 41-67.3 147.9 51.7 81.4 103.3 27.8 127.2 0 24-27.9 53.7-87.3 53.7-87.3s29.7 59.4 53.7 87.3c23.9 27.8 75.5 81.4 127.2 0 66-106.9 3.7-137.4-67.3-147.9 48.4 5 99.7-14.3 112.4-69.1 3.7-16.2 10.3-93.9 10.3-107.5C360 7.8 351.7 1 341.2 1c-8.4 0-19.7-3.9-59.2 21C240.7 51.2 196.3 110.3 180 142z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Bluesky</p>
                {atproto.loading ? (
                  <p className="text-xs" style={{ color: "#8E8E93" }}>Loading...</p>
                ) : atproto.linked && atproto.handle ? (
                  <p className="text-xs" style={{ color: "#8E8E93" }}>@{atproto.handle}</p>
                ) : (
                  <p className="text-xs" style={{ color: "#8E8E93" }}>Not linked</p>
                )}
              </div>
            </div>

            {atproto.loading ? null : atproto.linked ? (
              <button
                onClick={handleUnlink}
                disabled={unlinking}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
              >
                {unlinking ? "Unlinking..." : "Unlink"}
              </button>
            ) : (
              <button
                onClick={() => {
                  setShowHandleInput((v) => !v);
                  setHandleError(null);
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg btn-gradient text-white"
              >
                Link Account
              </button>
            )}
          </div>

          {/* Handle input (shown when user clicks "Link Account") */}
          {!atproto.linked && showHandleInput && (
            <div className="mt-3">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-sm select-none pointer-events-none"
                    style={{ color: "#8E8E93" }}
                  >
                    @
                  </span>
                  <input
                    type="text"
                    value={handleInput}
                    onChange={(e) => {
                      setHandleInput(e.target.value);
                      setHandleError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLink();
                    }}
                    placeholder="yourname.bsky.social"
                    autoFocus
                    className="w-full pl-7 pr-3 py-2 rounded-lg border text-sm bg-transparent text-white outline-none focus:border-pnp-accent transition-colors"
                    style={{ borderColor: handleError ? "#FF453A" : "rgba(255,255,255,0.15)" }}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
                <button
                  onClick={handleLink}
                  className="btn-gradient px-4 py-2 rounded-lg text-white text-sm font-semibold whitespace-nowrap"
                >
                  Connect
                </button>
              </div>
              {handleError && (
                <p className="text-xs text-red-400 mt-1.5">{handleError}</p>
              )}
              <p className="text-xs mt-1.5" style={{ color: "#8E8E93" }}>
                You will be redirected to Bluesky to authorize the connection.
              </p>
            </div>
          )}

          {/* Unlink error */}
          {unlinkError && (
            <p className="text-xs text-red-400 mt-2">{unlinkError}</p>
          )}
        </div>
      </div>
    </div>
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

  const fileInputRef = useRef<HTMLInputElement>(null);

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
          setPosts(postsRes.posts);
        } else {
          setPosts((prev) => [...prev, ...postsRes.posts]);
        }
        setNextCursor(postsRes.nextCursor);
      } else {
        // Other user's profile: single endpoint
        const res = await getPublicProfile(targetUserId, cursor);
        if (!cursor) {
          setProfile(res.profile);
          setPosts(res.posts);
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
      <div className="glass-card-sm p-6 mb-4">
        <div className="flex items-start gap-4">
          {/* Avatar with upload overlay */}
          <div className="relative flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={displayName}
                className="w-20 h-20 rounded-full object-cover border-2"
                style={{ borderColor: isPrime ? "#FFB454" : "rgba(255,255,255,0.1)" }}
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold border-2"
                style={{
                  background: "linear-gradient(135deg, #D4007A, #E69138)",
                  color: "#fff",
                  borderColor: isPrime ? "#FFB454" : "rgba(255,255,255,0.1)",
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
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
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
            </div>
            {profile.username && (
              <p className="text-sm" style={{ color: "#8E8E93" }}>@{profile.username}</p>
            )}
            {profile.bio && (
              <p className="text-sm text-white/80 mt-2 leading-relaxed">{profile.bio}</p>
            )}

            {/* Stats row */}
            <div className="flex items-center gap-4 mt-3">
              <span className="text-sm">
                <strong className="text-white">{profile.postCount ?? posts.length}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>Posts</span>
              </span>
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
              <Button variant="danger" className="px-4" onClick={logout}>
                Sign Out
              </Button>
            </>
          ) : (
            <button
              onClick={() => navigate(`/chat`)}
              className="flex-1 btn-gradient py-2 rounded-lg text-white text-sm font-semibold"
            >
              Message
            </button>
          )}
        </div>
      </div>

      {/* ── Identity & Connections (own profile only) ── */}
      {isOwnProfile && (
        <IdentityConnections telegramUsername={profile.username} />
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
          style={activeTab === "posts" ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
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
          style={activeTab === "likes" ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
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
    </div>
  );
}
