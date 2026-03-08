import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useDirectus } from "@/hooks/useDirectus";
import { useI18n } from "@/lib/i18n";
import { PostComposer } from "@/components/PostComposer";
import {
  getHomeFeedPosts,
  getSocialFeedPosts,
  getFeaturedPerformers,
  togglePostLike,
  type SocialPostItem,
  type FeaturedPerformer,
} from "@/lib/api";
import { translateText } from "@/lib/feedI18n";

interface Announcement {
  id: number;
  title: string;
  body: string;
  type: string;
  is_pinned: boolean;
  published_at: string;
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

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

export default function Home() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { feed: t } = useI18n();
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [translatedPosts, setTranslatedPosts] = useState<Record<number, string>>({});
  const [translatingId, setTranslatingId] = useState<number | null>(null);

  const { data: announcements } = useDirectus<Announcement>({
    collection: "announcements",
    params: {
      filter: { status: { _eq: "published" } },
      sort: ["-is_pinned", "-published_at"],
      limit: 5,
    },
  });

  const [performers, setPerformers] = useState<FeaturedPerformer[]>([]);

  useEffect(() => {
    if (authLoading) return;
    const loader = isAuthenticated ? getSocialFeedPosts(undefined, 10) : getHomeFeedPosts(10);
    loader
      .then((res) => {
        if (res.success) setPosts(res.posts);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));

    getFeaturedPerformers()
      .then((res) => {
        if (res.success) setPerformers(res.performers);
      })
      .catch(() => {});
  }, [authLoading, isAuthenticated]);

  const handleLike = useCallback(async (postId: number) => {
    try {
      const res = await togglePostLike(postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: res.liked,
                likes_count: res.likes_count ?? (p.likes_count + (res.liked ? 1 : -1)),
              }
            : p
        )
      );
    } catch { /* silent */ }
  }, []);

  const handleTranslate = useCallback(async (postId: number, content: string) => {
    if (translatingId === postId) return;
    if (translatedPosts[postId]) { setTranslatedPosts((prev) => { const next = { ...prev }; delete next[postId]; return next; }); return; }
    setTranslatingId(postId);
    const result = await translateText(content, user?.language || "en");
    if (result) setTranslatedPosts((prev) => ({ ...prev, [postId]: result }));
    setTranslatingId(null);
  }, [translatingId, translatedPosts, user?.language]);

  const username = user?.username || user?.displayName || "user";
  const { tier, isPrime, isMember } = useTier();
  const { showTutorial, dismissTutorial } = useTutorial("home");

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>Home — PNPtv!</title>
        <meta name="description" content="Your PNPtv feed. Browse announcements, featured performers, and community posts." />
      </Helmet>
      {showTutorial && <TutorialOverlay section="home" onDismiss={dismissTutorial} />}

      {/* Hero — greeting + tier badge */}
      <div className="glass-card-sm p-5 mb-4 animate-fade-in-up">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white">
              High <span role="img" aria-label="wind">🌬️</span>{" "}
              <span className="text-gradient">@{username}</span>
            </h1>
            <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>
              PNP Content. Live Video Rooms. Raw Podcasts.
            </p>
          </div>
          <span
            className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider"
            style={
              isPrime
                ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
                : { background: "rgba(255,255,255,0.06)", color: "#555" }
            }
          >
            {tier}
          </span>
        </div>
      </div>

      {/* PRIME upgrade CTA — neon yellow, standalone */}
      {!isPrime && (
        <button
          onClick={() => navigate("/subscribe")}
          className="w-full mb-4 group"
        >
          <div
            className="rounded-2xl p-4 flex items-center gap-3 transition-all"
            style={{
              background: "rgba(229,255,0,0.06)",
              border: "1px solid rgba(229,255,0,0.15)",
              boxShadow: "0 0 20px rgba(229,255,0,0.04)",
            }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(229,255,0,0.12)" }}
            >
              <svg className="w-4 h-4" style={{ color: "#E5FF00" }} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-sm" style={{ color: "#E5FF00" }}>
                {isMember ? "Upgrade to PRIME" : "Unlock PRIME"}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(229,255,0,0.4)" }}>
                DMs, video calls, exclusive content & more
              </p>
            </div>
            <svg className="w-4 h-4 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" style={{ color: "rgba(229,255,0,0.3)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="mb-4 space-y-2">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              className="glass-card-sm p-3.5"
              style={{ borderLeft: "3px solid rgba(212,0,122,0.4)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                {ann.is_pinned && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>
                    PINNED
                  </span>
                )}
                <span className="text-[10px] uppercase font-medium" style={{ color: "#555" }}>
                  {ann.type}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-white">{ann.title}</h3>
              <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                {ann.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Featured Performers */}
      {performers.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">{t.featured}</h2>
          <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {performers.map((p) => {
              const profilePath = p.userId ? `/profile/${p.userId}` : "#";
              return (
                <div
                  key={p.id}
                  className="glass-card-sm p-3 flex-shrink-0 w-24 text-center cursor-pointer hover:border-white/15 transition-colors"
                  onClick={() => p.userId && navigate(profilePath)}
                >
                  <img
                    src={isValidPhotoUrl(p.photoUrl) ? p.photoUrl : "/default-performer.svg"}
                    alt={p.displayName}
                    className="w-12 h-12 rounded-full mx-auto mb-1.5 object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/default-performer.svg";
                    }}
                  />
                  <p className="text-[11px] font-medium text-white truncate">{p.displayName}</p>
                  {p.isAvailable && (
                    <p className="text-[10px] truncate" style={{ color: "#5ED1C4" }}>
                      Available
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Stage — 24/7 community video room */}
      <div
        className="glass-card-sm p-4 mb-5 cursor-pointer hover:border-white/15 transition-colors"
        onClick={() => navigate("/haus")}
        style={{ borderLeft: "3px solid rgba(94, 209, 196, 0.5)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ background: "rgba(94, 209, 196, 0.15)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "#5ED1C4" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">Main Stage</h3>
            <p className="text-xs text-white/50">24/7 community video room — drop in anytime</p>
          </div>
          <svg className="w-4 h-4 text-white/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Create post — compact composer, expands on focus */}
      {isAuthenticated && (
        <PostComposer
          compact
          onPostCreated={(newPost) => setPosts((prev) => [newPost, ...prev])}
          className="mb-6"
        />
      )}

      {/* Social Feed */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">{t.socialFeed}</h2>
        <Link to="/social" className="text-xs font-medium text-gradient">
          {t.viewAll}
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
          <p className="text-white font-medium mb-1">{t.noPostsHome}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {t.beFirstHome}
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
                    {isValidPhotoUrl(post.author_photo) ? (
                      <img src={post.author_photo} alt={`${post.author_first_name || post.author_username || "User"}'s avatar`} className="w-10 h-10 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty("display"); }} />
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
                      {translatedPosts[post.id] ?? post.content}
                    </p>
                    {translatedPosts[post.id] && (
                      <button
                        onClick={() => setTranslatedPosts((prev) => { const next = { ...prev }; delete next[post.id]; return next; })}
                        className="text-xs mt-0.5"
                        style={{ color: "#8E8E93" }}
                      >
                        {t.showOriginal}
                      </button>
                    )}
                    {/* Media */}
                    {post.media_url && (
                      <div className="mt-2">
                        {post.media_type === "video" ? (
                          <video
                            src={post.media_url}
                            controls
                            playsInline
                            muted
                            className="w-full max-h-48 rounded-lg object-cover"
                            preload="metadata"
                            onError={(e) => { (e.target as HTMLVideoElement).parentElement!.style.display = "none"; }}
                          />
                        ) : (
                          <img
                            src={post.media_url}
                            alt="Post image"
                            className="w-full max-h-48 rounded-lg object-cover"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                          />
                        )}
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
                      {/* Translate */}
                      {post.content && (
                        <button
                          onClick={() => handleTranslate(post.id, post.content)}
                          disabled={translatingId === post.id}
                          className="flex items-center gap-1 text-xs transition-colors hover:text-teal-400 disabled:opacity-40"
                          style={translatedPosts[post.id] ? { color: "#5ED1C4" } : { color: "#8E8E93" }}
                          title={translatedPosts[post.id] ? t.showOriginal : t.translate}
                        >
                          {translatingId === post.id ? (
                            <span className="text-[10px]">{t.translating}</span>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
                            </svg>
                          )}
                        </button>
                      )}
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
            {t.viewAllPosts}
          </button>
        </div>
      )}
    </div>
  );
}
