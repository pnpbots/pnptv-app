import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import {
  getSocialFeedPosts,
  createSocialPost,
  togglePostLike,
  deleteSocialPost,
  getReplies,
  createReply,
  type SocialPostItem,
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
        post.replies_count = (post.replies_count || 0) + 1;
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

  const authorPath = String(post.author_id) === currentUserId ? "/profile" : `/profile/${post.author_id}`;

  return (
    <div className="glass-card-sm p-4" id={`post-${post.id}`}>
      <div className="flex gap-3">
        {/* Avatar — show real photo or gradient fallback */}
        <button onClick={() => onNavigate(authorPath)} className="flex-shrink-0">
          {isValidPhotoUrl(post.author_photo) ? (
            <img
              src={post.author_photo}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty("display"); }}
            />
          ) : null}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: isValidPhotoUrl(post.author_photo) ? "none" : undefined }}
          >
            {(post.author_first_name || post.author_username || "?")[0].toUpperCase()}
          </div>
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

            {/* Delete (own posts or admin) */}
            {canDelete && (
              <button
                onClick={() => { setDeleting(true); onDelete(post.id); }}
                disabled={deleting}
                className="ml-auto text-xs hover:text-red-400 transition-colors"
                style={{ color: "#8E8E93" }}
                title={isAdmin && !isOwn ? "Delete post (admin)" : "Delete post"}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
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
                  onError={(e) => { (e.target as HTMLVideoElement).parentElement!.style.display = "none"; }}
                />
              ) : (
                <img
                  src={post.media_url}
                  alt=""
                  className="w-full max-h-80 rounded-lg object-cover"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
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

            {/* Comment */}
            <button
              onClick={toggleReplies}
              className="flex items-center gap-1.5 text-xs hover:text-blue-400 transition-colors"
              style={showReplies ? { color: "#60A5FA" } : undefined}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
              </svg>
              {post.replies_count > 0 && <span>{post.replies_count}</span>}
            </button>

            {/* Share */}
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-xs hover:text-green-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0-12.814a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0 12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
              </svg>
            </button>
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
                          <img src={reply.author_photo} alt="" className="w-7 h-7 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty("display"); }} />
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

  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Composer state
  const [text, setText] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
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

  // Like
  const handleLike = useCallback(async (postId: number) => {
    try {
      const res = await togglePostLike(postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked_by_me: res.liked, likes_count: p.likes_count + (res.liked ? 1 : -1) }
            : p
        )
      );
    } catch { /* silent */ }
  }, []);

  // Delete
  const handleDelete = useCallback(async (postId: number) => {
    try {
      await deleteSocialPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
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

  const handlePost = useCallback(async () => {
    if (!text.trim() || isPosting) return;
    setIsPosting(true);
    setPostError(null);
    try {
      const res = await createSocialPost(text.trim(), mediaFile || undefined);
      if (res.success && res.post) {
        setPosts((prev) => [res.post, ...prev]);
      }
      setText("");
      clearMedia();
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : "Failed to create post");
    } finally {
      setIsPosting(false);
    }
  }, [text, mediaFile, isPosting, clearMedia]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
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

      {/* Post Composer */}
      {isAuthenticated && (
        <div className="glass-card-sm p-4 mb-6">
          <div className="flex gap-3">
            {/* Composer avatar — show user photo */}
            {isValidPhotoUrl(user?.photoUrl) ? (
              <img src={user.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
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
                onChange={(e) => setText(e.target.value.slice(0, 500))}
                placeholder="What's on your mind?"
                className="w-full bg-transparent text-white text-sm py-2 border-b border-white/10 mb-3 resize-none outline-none placeholder:text-white/40"
                rows={3}
                disabled={isPosting}
              />

              <div className="flex justify-end mb-2">
                <span className={`text-xs ${text.length > 450 ? "text-red-400" : ""}`} style={{ color: text.length > 450 ? undefined : "#8E8E93" }}>
                  {text.length}/500
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 transition-colors"
                    style={{ color: "#D4007A" }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:bg-white/5 hover:border-white/20 transition-colors"
                    style={{ color: "#E69138" }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                    Video
                  </button>
                </div>
                <button
                  onClick={handlePost}
                  disabled={!text.trim() || isPosting}
                  className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
                >
                  {isPosting ? "Posting..." : "Post"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feed */}
      {isLoading ? (
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
      )}
    </div>
  );
}
