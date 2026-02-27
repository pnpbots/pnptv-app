import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDirectus } from "@/hooks/useDirectus";
import {
  getSocialFeedPosts,
  togglePostLike,
  type SocialPostItem,
} from "@/lib/api";

interface Announcement {
  id: number;
  title: string;
  body: string;
  type: string;
  is_pinned: boolean;
  published_at: string;
}

interface Performer {
  id: number;
  name: string;
  bio: string;
  categories: string[];
  is_featured: boolean;
  image: string | null;
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
  return `${Math.floor(days / 30)}mo`;
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const { data: announcements } = useDirectus<Announcement>({
    collection: "announcements",
    params: {
      filter: { status: { _eq: "published" } },
      sort: ["-is_pinned", "-published_at"],
      limit: 5,
    },
  });

  const { data: performers } = useDirectus<Performer>({
    collection: "performers",
    params: {
      filter: { status: { _eq: "published" }, is_featured: { _eq: true } },
      limit: 6,
    },
  });

  useEffect(() => {
    getSocialFeedPosts(5)
      .then((res) => {
        if (res.success) setPosts(res.posts);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const handleLike = async (postId: number) => {
    try {
      const res = await togglePostLike(postId);
      if (res.success) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? { ...p, liked_by_me: res.liked, likes_count: res.likesCount }
              : p
          )
        );
      }
    } catch { /* silent */ }
  };

  const username = user?.username || user?.displayName || "user";
  const tier = user?.tier || "free";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* User greeting */}
      <div className="glass-card p-6 mb-6 animate-fade-in-up">
        <h1 className="text-xl font-bold text-white">
          High <span role="img" aria-label="wind">🌬️</span>{" "}
          <span className="text-gradient">@{username}</span>
        </h1>
        <p className="text-sm mt-2" style={{ color: "#8E8E93" }}>
          PNP Content. Live Video Rooms. Raw Podcasts.
        </p>
        <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
          You are a{" "}
          <span className="font-semibold text-white capitalize">{tier}</span>{" "}
          member.
        </p>
      </div>

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="mb-6 space-y-3">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              className="glass-card-sm p-4 border-l-gradient"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {ann.is_pinned && (
                      <span className="text-xs px-1.5 py-0.5 rounded badge-gradient badge-gradient-text font-medium">
                        PINNED
                      </span>
                    )}
                    <span
                      className="text-xs uppercase font-medium"
                      style={{ color: "#8E8E93" }}
                    >
                      {ann.type}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-white">{ann.title}</h3>
                  <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
                    {ann.body}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Featured Performers */}
      {performers.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">Featured</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {performers.map((p) => (
              <div
                key={p.id}
                className="glass-card-sm p-3 flex-shrink-0 w-28 text-center"
              >
                <div
                  className="w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center text-lg font-bold"
                  style={{
                    background: "linear-gradient(135deg, #D4007A, #E69138)",
                    color: "#fff",
                  }}
                >
                  {p.name[0]}
                </div>
                <p className="text-xs font-medium text-white truncate">{p.name}</p>
                {p.categories?.[0] && (
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: "#8E8E93" }}>
                    {p.categories[0]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscribe CTA */}
      {tier?.toLowerCase() !== "prime" && (
        <button
          onClick={() => navigate("/subscribe")}
          className="btn-gradient w-full py-3 px-6 rounded-xl text-white font-semibold text-sm mb-6 font-display tracking-wider whitespace-nowrap"
        >
          Subscribe to PNPTv! PRIME
        </button>
      )}

      {/* Create post — navigates to Social page */}
      <div
        className="glass-card-sm p-4 mb-6 cursor-pointer hover:border-white/20 transition-colors"
        onClick={() => navigate("/social")}
      >
        <div className="flex gap-3">
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
            >
              {(user?.displayName || "U")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <div className="w-full bg-transparent text-white/40 text-sm py-2 border-b border-white/10 mb-3 cursor-text">
              What's on your mind?
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3" style={{ color: "#8E8E93" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold">
                Post
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Social Feed */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Social Feed</h2>
        <Link to="/social" className="text-xs font-medium text-gradient">
          View all
        </Link>
      </div>

      {isLoading ? (
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
      ) : posts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto mb-3"
            style={{ color: "#8E8E93" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
            />
          </svg>
          <p className="text-white font-medium mb-1">No posts yet</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            Be the first to post something!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const authorPath = post.author_id === user?.dbId ? "/profile" : `/profile/${post.author_id}`;
            return (
              <div key={post.id} className="glass-card-sm p-4">
                <div className="flex gap-3">
                  {/* Avatar */}
                  <button onClick={() => navigate(authorPath)} className="flex-shrink-0">
                    {post.author_photo ? (
                      <img src={post.author_photo} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                      >
                        {(post.author_first_name || post.author_username || "?")[0].toUpperCase()}
                      </div>
                    )}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => navigate(authorPath)}
                        className="font-semibold text-white text-sm truncate hover:underline"
                      >
                        {post.author_first_name || post.author_username || "Anonymous"}
                      </button>
                      <span className="text-xs" style={{ color: "#8E8E93" }}>
                        &middot; {timeAgo(post.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed">
                      {post.content}
                    </p>
                    {/* Media */}
                    {post.media_url && (
                      <div className="mt-2">
                        <img
                          src={post.media_url}
                          alt=""
                          className="w-full max-h-48 rounded-lg object-cover"
                          loading="lazy"
                        />
                      </div>
                    )}
                    {/* Actions */}
                    <div className="flex items-center gap-5 mt-3 -ml-1">
                      {/* Like */}
                      <button
                        onClick={() => handleLike(post.id)}
                        className="flex items-center gap-1.5 text-xs transition-colors"
                        style={{ color: post.liked_by_me ? "#D4007A" : "#8E8E93" }}
                      >
                        <svg className="w-4 h-4" fill={post.liked_by_me ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={post.liked_by_me ? 0 : 1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                        </svg>
                        {(post.likes_count || 0) > 0 && <span>{post.likes_count}</span>}
                      </button>
                      {/* Comment — link to Social */}
                      <button
                        onClick={() => navigate("/social")}
                        className="flex items-center gap-1.5 text-xs"
                        style={{ color: "#8E8E93" }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                        </svg>
                        {(post.replies_count || 0) > 0 && <span>{post.replies_count}</span>}
                      </button>
                      {/* Share */}
                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/social#post-${post.id}`;
                          if (navigator.share) {
                            try { await navigator.share({ title: "PNPtv Post", url }); } catch { /* cancelled */ }
                          } else {
                            await navigator.clipboard.writeText(url);
                          }
                        }}
                        className="flex items-center gap-1.5 text-xs"
                        style={{ color: "#8E8E93" }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {/* View all link */}
          <button
            onClick={() => navigate("/social")}
            className="w-full py-3 text-center text-sm font-medium text-gradient"
          >
            View all posts
          </button>
        </div>
      )}
    </div>
  );
}
