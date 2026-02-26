import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDirectus } from "@/hooks/useDirectus";
import { DIRECTUS_URL, type SocialPost } from "@/lib/directus";

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
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();

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

  const { data: posts, isLoading } = useDirectus<SocialPost>({
    collection: "social_posts",
    params: {
      sort: ["-date_created"],
      limit: 10,
      fields: ["*", "media.id", "media.type", "media.width", "media.height"],
      filter: { status: { _eq: "published" } },
    },
  });

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
      {tier !== "prime" && (
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
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
          >
            {(user?.displayName || "U")[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div
              className="w-full bg-transparent text-white/40 text-sm py-2 border-b border-white/10 mb-3 cursor-text"
            >
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

      {/* Latest posts */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Latest posts</h2>
        <Link to="/social" className="text-xs font-medium text-gradient">
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
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
            Content will appear here once members start posting.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="glass-card-sm p-4">
              <div className="flex gap-3">
                {/* Avatar */}
                <button
                  onClick={() => post.author_id && navigate(post.author_id === user?.dbId ? "/profile" : `/profile/${post.author_id}`)}
                  className="flex-shrink-0"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                  >
                    {(post.author_name || "?")[0].toUpperCase()}
                  </div>
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => post.author_id && navigate(post.author_id === user?.dbId ? "/profile" : `/profile/${post.author_id}`)}
                      className="font-semibold text-white text-sm truncate hover:underline"
                    >
                      {post.author_name || "Anonymous"}
                    </button>
                    <span className="text-xs" style={{ color: "#8E8E93" }}>
                      &middot; {timeAgo(post.date_created)}
                    </span>
                  </div>
                  <p className="text-sm text-white/90 mt-1.5 whitespace-pre-wrap leading-relaxed">
                    {post.text}
                  </p>
                  {/* Media thumbnail */}
                  {post.media && (
                    <div className="mt-2">
                      {post.media.type?.startsWith("video/") ? (
                        <video
                          src={`${DIRECTUS_URL}/assets/${post.media.id}`}
                          className="w-full max-h-48 rounded-lg object-cover"
                          muted
                          preload="metadata"
                        />
                      ) : (
                        <img
                          src={`${DIRECTUS_URL}/assets/${post.media.id}?width=400&quality=75`}
                          alt=""
                          className="w-full max-h-48 rounded-lg object-cover"
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
