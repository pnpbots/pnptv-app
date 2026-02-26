import React, { useState, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDirectus } from "@/hooks/useDirectus";
import { createPost, deletePost } from "@/lib/api";
import { DIRECTUS_URL, type SocialPost } from "@/lib/directus";
import { useNavigate } from "react-router-dom";

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function isVideo(type: string | undefined): boolean {
  return !!type && type.startsWith("video/");
}

export default function Social() {
  const { user, isAuthenticated } = useAuth();
  const [text, setText] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data: posts,
    isLoading,
    error,
    refetch,
  } = useDirectus<SocialPost>({
    collection: "social_posts",
    params: {
      sort: ["-date_created"],
      limit: 50,
      fields: ["*", "media.id", "media.type", "media.width", "media.height", "media.filename_download"],
      filter: { status: { _eq: "published" } },
    },
  });

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
      await createPost(text.trim(), mediaFile || undefined);
      setText("");
      clearMedia();
      refetch();
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : "Failed to create post");
    } finally {
      setIsPosting(false);
    }
  }, [text, mediaFile, isPosting, clearMedia, refetch]);

  const handleDelete = useCallback(async (id: number) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await deletePost(id);
      refetch();
    } catch {
      // Silent fail for delete
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, refetch]);

  const currentUserId = String(user?.id || "");
  const navigate = useNavigate();

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
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
            >
              {(user?.displayName || "U")[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 500))}
                placeholder="What's on your mind?"
                className="w-full bg-transparent text-white text-sm py-2 border-b border-white/10 mb-3 resize-none outline-none placeholder:text-white/40"
                rows={3}
                disabled={isPosting}
              />

              {/* Character count */}
              <div className="flex justify-end mb-2">
                <span className={`text-xs ${text.length > 450 ? "text-red-400" : ""}`} style={{ color: text.length > 450 ? undefined : "#8E8E93" }}>
                  {text.length}/500
                </span>
              </div>

              {/* Media preview */}
              {mediaPreview && (
                <div className="relative mb-3 inline-block">
                  {mediaFile && mediaFile.type.startsWith("video/") ? (
                    <video
                      src={mediaPreview}
                      className="max-h-48 rounded-lg object-cover"
                      muted
                    />
                  ) : (
                    <img
                      src={mediaPreview}
                      alt="Preview"
                      className="max-h-48 rounded-lg object-cover"
                    />
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

              {/* Post error */}
              {postError && (
                <p className="text-xs text-red-400 mb-2">{postError}</p>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3" style={{ color: "#8E8E93" }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPosting}
                    className="hover:text-pnp-accent transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPosting}
                    className="hover:text-pnp-accent transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
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
          <button
            onClick={refetch}
            className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <p className="text-white font-medium mb-1">No Posts Yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Be the first to share something with the community!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="glass-card-sm p-4">
              <div className="flex gap-3">
                {/* Author avatar */}
                <button
                  onClick={() => post.author_id && navigate(post.author_id === currentUserId ? "/profile" : `/profile/${post.author_id}`)}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                >
                  {(post.author_name || "?")[0].toUpperCase()}
                </button>

                {/* Post content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => post.author_id && navigate(post.author_id === currentUserId ? "/profile" : `/profile/${post.author_id}`)}
                      className="font-semibold text-white text-sm truncate hover:underline"
                    >
                      {post.author_name || "Anonymous"}
                    </button>
                    <span className="text-xs" style={{ color: "#8E8E93" }}>
                      &middot; {timeAgo(post.date_created)}
                    </span>
                    {/* Delete button for own posts */}
                    {currentUserId && post.author_id === currentUserId && (
                      <button
                        onClick={() => handleDelete(post.id)}
                        disabled={deletingId === post.id}
                        className="ml-auto text-xs hover:text-red-400 transition-colors"
                        style={{ color: "#8E8E93" }}
                        title="Delete post"
                      >
                        {deletingId === post.id ? (
                          <span className="text-xs">...</span>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>

                  <p className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed">
                    {post.text}
                  </p>

                  {/* Media attachment */}
                  {post.media && (
                    <div className="mt-3">
                      {isVideo(post.media.type) ? (
                        <video
                          src={`${DIRECTUS_URL}/assets/${post.media.id}`}
                          controls
                          className="w-full max-h-80 rounded-lg object-cover"
                          preload="metadata"
                        />
                      ) : (
                        <img
                          src={`${DIRECTUS_URL}/assets/${post.media.id}?width=600&quality=80`}
                          alt=""
                          className="w-full max-h-80 rounded-lg object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
