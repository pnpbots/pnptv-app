import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PostComposer } from "@/components/PostComposer";
import SocialPostCard from "@/components/social/SocialPostCard";
import {
  getSocialFeedPosts,
  getPostsByHashtag,
  getHangoutFeed,
  getFollowingFeed,
  togglePostLike,
  deleteSocialPost,
  updateProfile,
  type SocialPostItem,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useNearbyDistances } from "@/components/NearbyBadge";
import { getSocket, connectSocket } from "@/lib/socket";

export interface SocialFeedTabsProps {
  currentUserId: string;
  isAdmin: boolean;
  isAuthenticated: boolean;
  userLang?: string;
  viewerCity?: string | null;
  viewerCountry?: string | null;
  contentDisclaimerAccepted: boolean;
  onAcceptDisclaimer: () => Promise<void>;
  onNavigate: (path: string) => void;
  showComposer?: boolean;
  /** When set, the feed only shows posts containing this hashtag (without #) */
  hashtagFilter?: string;
  /** When set, the feed only shows posts from this hangout group */
  hangoutGroupId?: number;
}

function FeedSkeleton() {
  return (
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
  );
}

export default function SocialFeedTabs({
  currentUserId,
  isAdmin,
  isAuthenticated,
  userLang = "en",
  viewerCity,
  viewerCountry,
  contentDisclaimerAccepted,
  onAcceptDisclaimer,
  onNavigate,
  showComposer = true,
  hashtagFilter,
  hangoutGroupId,
}: SocialFeedTabsProps) {
  const navigate = useNavigate();
  const { feed: t } = useI18n();

  // All-posts feed state
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Feed mode tab — "all" (default) or "following" (only when no filter is active)
  const [feedMode, setFeedMode] = useState<"all" | "following">("all");
  const canShowTabs = !hashtagFilter && !hangoutGroupId && isAuthenticated;

  // Content disclaimer local mirror
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(contentDisclaimerAccepted);

  // Nearby distance lookup
  const allAuthorIds = useMemo(() => {
    const ids = new Set<string>();
    posts.forEach((p) => ids.add(String(p.author_id)));
    return Array.from(ids);
  }, [posts]);
  const nearbyDistances = useNearbyDistances(allAuthorIds);

  // Sync prop changes
  useEffect(() => {
    setDisclaimerAccepted(contentDisclaimerAccepted);
  }, [contentDisclaimerAccepted]);

  // ── Load feed ───────────────────────────────────────────────────────────────

  const loadFeed = useCallback(async (cursor?: string) => {
    try {
      const res = hangoutGroupId
        ? await getHangoutFeed(hangoutGroupId, cursor, 20)
        : hashtagFilter
          ? await getPostsByHashtag(hashtagFilter, cursor, 20)
          : feedMode === "following" && isAuthenticated
            ? await getFollowingFeed(cursor)
            : await getSocialFeedPosts(cursor, 20);
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
  }, [hashtagFilter, hangoutGroupId, feedMode, isAuthenticated]);

  // Reset and reload whenever the hashtag filter changes
  useEffect(() => {
    setPosts([]);
    setNextCursor(null);
    setError(null);
    setIsLoading(true);
    loadFeed();
  }, [loadFeed]);

  // ── Real-time socket events ─────────────────────────────────────────────────
  const [hasNewPosts, setHasNewPosts] = useState(false);

  useEffect(() => {
    // Skip real-time updates for hashtag/hangout filtered feeds (too specific)
    if (hashtagFilter || hangoutGroupId) return;
    const socket = connectSocket();

    const onNewPost = () => setHasNewPosts(true);
    const onReaction = (data: { postId: number; reactions: any[] }) => {
      setPosts((prev) => prev.map((p) => p.id === data.postId ? { ...p, reactions: data.reactions } : p));
    };

    socket.on("feed:new_post", onNewPost);
    socket.on("reaction:post", onReaction);
    return () => {
      socket.off("feed:new_post", onNewPost);
      socket.off("reaction:post", onReaction);
    };
  }, [hashtagFilter, hangoutGroupId]);

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    loadFeed(nextCursor);
  }, [nextCursor, loadingMore, loadFeed]);

  // ── Post actions ────────────────────────────────────────────────────────────

  const handleLike = useCallback(async (postId: number) => {
    // Optimistic flip — keep the UI responsive; reconcile or roll back on response.
    let prevLiked: boolean | undefined;
    let prevCount: number | undefined;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        prevLiked = !!p.liked_by_me;
        prevCount = p.likes_count;
        const nowLiked = !p.liked_by_me;
        return { ...p, liked_by_me: nowLiked, likes_count: Math.max(0, p.likes_count + (nowLiked ? 1 : -1)) };
      })
    );
    try {
      const res = await togglePostLike(postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked_by_me: res.liked, likes_count: res.likes_count ?? p.likes_count }
            : p
        )
      );
    } catch {
      // Roll back the optimistic update so the user can retry.
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId && prevLiked !== undefined && prevCount !== undefined
            ? { ...p, liked_by_me: prevLiked, likes_count: prevCount }
            : p
        )
      );
    }
  }, []);

  const handleDelete = useCallback(async (postId: number) => {
    await deleteSocialPost(postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const handleWofToggle = useCallback((postId: number, nowWof: boolean) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, is_wof: nowWof } : p))
    );
  }, []);

  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
    setDisclaimerAccepted(true);
    await onAcceptDisclaimer();
  }, [onAcceptDisclaimer]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">PNP Feed</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">Share posts, reactions & updates with the community</p>
        </div>
      </div>

      {/* All / Following tabs */}
      {canShowTabs && (
        <div className="flex border-b border-pnp-border mb-4">
          <button
            onClick={() => { if (feedMode !== "all") { setFeedMode("all"); setPosts([]); setNextCursor(null); setIsLoading(true); } }}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${feedMode === "all" ? "text-white border-b-2 border-pnp-accent" : "text-pnp-textSecondary"}`}
          >
            All
          </button>
          <button
            onClick={() => { if (feedMode !== "following") { setFeedMode("following"); setPosts([]); setNextCursor(null); setIsLoading(true); } }}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${feedMode === "following" ? "text-white border-b-2 border-pnp-accent" : "text-pnp-textSecondary"}`}
          >
            Following
          </button>
        </div>
      )}

      {/* Hashtag filter banner */}
      {hashtagFilter && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl" style={{ background: "rgba(212,0,122,0.1)", border: "1px solid rgba(212,0,122,0.25)" }}>
          <span className="text-sm font-semibold" style={{ color: "#D4007A" }}>
            #{hashtagFilter}
          </span>
          <span className="text-xs flex-1" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Showing posts tagged with this hashtag
          </span>
          <button
            onClick={() => navigate("/")}
            className="text-xs font-medium hover:underline"
            style={{ color: "#D4007A" }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Post Composer */}
      {showComposer && isAuthenticated && (
        <div className="mb-6">
          <PostComposer
            compact
            onPostCreated={(newPost) => {
              setPosts((prev) => [newPost, ...prev]);
            }}
          />
        </div>
      )}

      {/* New posts pill */}
      {hasNewPosts && !isLoading && (
        <button
          onClick={() => { setHasNewPosts(false); setPosts([]); setNextCursor(null); setIsLoading(true); loadFeed(); }}
          className="w-full mb-3 py-2 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
        >
          <svg className="w-4 h-4 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          New posts — tap to refresh
        </button>
      )}

      {/* Feed */}
      {isLoading ? (
        <FeedSkeleton />
      ) : error ? (
        <div className="glass-card-sm p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto mb-3"
            style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-white font-medium mb-1">{t.feedUnavailable}</p>
          <p className="text-sm mb-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {error}
          </p>
          <button
            onClick={() => {
              setError(null);
              setIsLoading(true);
              loadFeed();
            }}
            className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold"
          >
            {t.retry}
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card-sm p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto mb-3"
            style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
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
          <p className="text-white font-medium mb-1">{t.noPostsYet}</p>
          <p className="text-sm" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {t.beTheFirst}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <SocialPostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              userLang={userLang}
              onLike={handleLike}
              onDelete={handleDelete}
              onWofToggle={handleWofToggle}
              onNavigate={onNavigate}
              contentDisclaimerAccepted={disclaimerAccepted}
              onAcceptDisclaimer={handleAcceptDisclaimer}
              viewerCity={viewerCity}
              viewerCountry={viewerCountry}
              distanceKm={nearbyDistances.get(String(post.author_id)) ?? null}
            />
          ))}
          {nextCursor && (
            <div className="text-center pt-2 pb-4">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-sm font-medium px-6 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: "#D4007A" }}
              >
                {loadingMore ? t.loading : t.loadMore}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
