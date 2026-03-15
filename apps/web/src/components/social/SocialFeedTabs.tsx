import React, { useState, useCallback, useEffect } from "react";
import { PostComposer } from "@/components/PostComposer";
import { BulkVideoUpload } from "@/components/BulkVideoUpload";
import SocialPostCard from "@/components/social/SocialPostCard";
import {
  getSocialFeedPosts,
  getWofFeedPosts,
  getFollowingFeed,
  togglePostLike,
  deleteSocialPost,
  checkAuthStatus,
  updateProfile,
  type SocialPostItem,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

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
  isActiveCreator?: boolean;
  showComposer?: boolean;
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
  isActiveCreator: isActiveCreatorProp,
  showComposer = true,
}: SocialFeedTabsProps) {
  const { feed: t } = useI18n();

  // Tab state
  const [activeTab, setActiveTab] = useState<"all" | "wof" | "following">("all");

  // All-posts tab state
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // WoF tab state
  const [wofPosts, setWofPosts] = useState<SocialPostItem[]>([]);
  const [wofLoading, setWofLoading] = useState(false);
  const [wofError, setWofError] = useState<string | null>(null);
  const [wofNextCursor, setWofNextCursor] = useState<string | null>(null);
  const [wofLoadingMore, setWofLoadingMore] = useState(false);
  const [wofLoaded, setWofLoaded] = useState(false);

  // Following tab state
  const [followingPosts, setFollowingPosts] = useState<SocialPostItem[]>([]);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [followingError, setFollowingError] = useState<string | null>(null);
  const [followingNextCursor, setFollowingNextCursor] = useState<string | null>(null);
  const [followingLoadingMore, setFollowingLoadingMore] = useState(false);
  const [followingLoaded, setFollowingLoaded] = useState(false);

  // Creator state
  const [isActiveCreator, setIsActiveCreator] = useState(isActiveCreatorProp ?? false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // Content disclaimer local mirror (so we can flip it on accept without prop-drilling)
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(contentDisclaimerAccepted);

  // Sync prop changes
  useEffect(() => {
    setDisclaimerAccepted(contentDisclaimerAccepted);
  }, [contentDisclaimerAccepted]);

  // Resolve active-creator status if not passed as prop
  useEffect(() => {
    if (isActiveCreatorProp !== undefined) return;
    if (!isAuthenticated) return;
    checkAuthStatus()
      .then((status) => {
        if (status.authenticated && status.user) {
          setIsActiveCreator(
            status.user.creator_status === "active" ||
            status.user.role === "model" ||
            status.user.role === "admin" ||
            status.user.role === "superadmin"
          );
        }
      })
      .catch(() => { /* non-critical */ });
  }, [isAuthenticated, isActiveCreatorProp]);

  // ── Load feeds ─────────────────────────────────────────────────────────────

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

  const loadWofFeed = useCallback(async (cursor?: string) => {
    try {
      const res = await getWofFeedPosts(cursor, 20);
      if (res.success) {
        if (cursor) {
          setWofPosts((prev) => [...prev, ...res.posts]);
        } else {
          setWofPosts(res.posts);
        }
        setWofNextCursor(res.nextCursor);
      }
    } catch (err) {
      setWofError(err instanceof Error ? err.message : "Failed to load Wall of Fame feed");
    } finally {
      setWofLoading(false);
      setWofLoadingMore(false);
    }
  }, []);

  const loadFollowingFeed = useCallback(async (cursor?: string) => {
    try {
      const res = await getFollowingFeed(cursor);
      if (res.success) {
        if (cursor) {
          setFollowingPosts((prev) => [...prev, ...res.posts]);
        } else {
          setFollowingPosts(res.posts);
        }
        setFollowingNextCursor(res.nextCursor);
      }
    } catch (err) {
      setFollowingError(err instanceof Error ? err.message : "Failed to load following feed");
    } finally {
      setFollowingLoading(false);
      setFollowingLoadingMore(false);
    }
  }, []);

  const handleTabChange = useCallback(
    (tab: "all" | "wof" | "following") => {
      setActiveTab(tab);
      if (tab === "wof" && !wofLoaded) {
        setWofLoading(true);
        setWofLoaded(true);
        loadWofFeed();
      }
      if (tab === "following" && !followingLoaded) {
        setFollowingLoading(true);
        setFollowingLoaded(true);
        loadFollowingFeed();
      }
    },
    [wofLoaded, followingLoaded, loadWofFeed, loadFollowingFeed]
  );

  const handleWofLoadMore = useCallback(() => {
    if (!wofNextCursor || wofLoadingMore) return;
    setWofLoadingMore(true);
    loadWofFeed(wofNextCursor);
  }, [wofNextCursor, wofLoadingMore, loadWofFeed]);

  const handleFollowingLoadMore = useCallback(() => {
    if (!followingNextCursor || followingLoadingMore) return;
    setFollowingLoadingMore(true);
    loadFollowingFeed(followingNextCursor);
  }, [followingNextCursor, followingLoadingMore, loadFollowingFeed]);

  // ── Shared post actions (sync across all feed slices) ──────────────────────

  const handleLike = useCallback(async (postId: number) => {
    try {
      const res = await togglePostLike(postId);
      const updater = (prev: SocialPostItem[]) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: res.liked,
                likes_count: res.likes_count ?? (p.likes_count + (res.liked ? 1 : -1)),
              }
            : p
        );
      setPosts(updater);
      setWofPosts(updater);
      setFollowingPosts(updater);
    } catch { /* silent */ }
  }, []);

  const handleDelete = useCallback(async (postId: number) => {
    try {
      await deleteSocialPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setWofPosts((prev) => prev.filter((p) => p.id !== postId));
      setFollowingPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch { /* silent */ }
  }, []);

  const handleWofToggle = useCallback((postId: number, nowWof: boolean) => {
    const updater = (prev: SocialPostItem[]) =>
      prev.map((p) => (p.id === postId ? { ...p, is_wof: nowWof } : p));
    setPosts(updater);
    setWofPosts(nowWof
      ? (prev) => prev
      : (prev) => prev.filter((p) => p.id !== postId));
    setFollowingPosts(updater);
  }, []);

  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
    setDisclaimerAccepted(true);
    // Also propagate to parent
    await onAcceptDisclaimer();
  }, [onAcceptDisclaimer]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderCards(list: SocialPostItem[]) {
    return list.map((post) => (
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
      />
    ));
  }

  return (
    <div>
      {/* Post Composer (hidden on WoF/Following tabs when showComposer=true) */}
      {showComposer && isAuthenticated && activeTab === "all" && (
        <div className="mb-6">
          <PostComposer
            compact
            onPostCreated={(newPost) => {
              setPosts((prev) => [newPost, ...prev]);
            }}
          />
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex border-b border-white/10 mb-4">
        <button
          onClick={() => handleTabChange("all")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "all" ? "text-white border-b-2" : "text-white/50"
          }`}
          style={
            activeTab === "all"
              ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" }
              : undefined
          }
        >
          {t.allPosts}
        </button>
        <button
          onClick={() => handleTabChange("wof")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "wof" ? "text-white border-b-2" : "text-white/50"
          }`}
          style={
            activeTab === "wof"
              ? { borderImage: "linear-gradient(to right, #FFB454, #E69138) 1" }
              : undefined
          }
        >
          {t.wallOfFame}
        </button>
        {isAuthenticated && (
          <button
            onClick={() => handleTabChange("following")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
              activeTab === "following" ? "text-white border-b-2" : "text-white/50"
            }`}
            style={
              activeTab === "following"
                ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" }
                : undefined
            }
          >
            {t.following}
          </button>
        )}
      </div>

      {/* ── All Posts Feed ── */}
      {activeTab === "all" &&
        (isLoading ? (
          <FeedSkeleton />
        ) : error ? (
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
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="text-white font-medium mb-1">{t.feedUnavailable}</p>
            <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>
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
            <p className="text-white font-medium mb-1">{t.noPostsYet}</p>
            <p className="text-sm" style={{ color: "#8E8E93" }}>
              {t.beTheFirst}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {renderCards(posts)}
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
        ))}

      {/* ── Wall of Fame Feed ── */}
      {activeTab === "wof" &&
        (wofLoading ? (
          <FeedSkeleton />
        ) : wofError ? (
          <div className="glass-card-sm p-8 text-center">
            <p className="text-white font-medium mb-1">{t.feedUnavailable}</p>
            <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>
              {wofError}
            </p>
            <button
              onClick={() => {
                setWofError(null);
                setWofLoading(true);
                loadWofFeed();
              }}
              className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold"
            >
              {t.retry}
            </button>
          </div>
        ) : wofPosts.length === 0 ? (
          <div className="glass-card-sm p-8 text-center">
            <svg
              className="w-12 h-12 mx-auto mb-3"
              style={{ color: "#FFB454" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.93m0 0a6.022 6.022 0 01-2.77-.93"
              />
            </svg>
            <p className="text-white font-medium mb-1">{t.noWofPostsYet}</p>
            <p className="text-sm" style={{ color: "#8E8E93" }}>
              {t.wofHint}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {renderCards(wofPosts)}
            {wofNextCursor && (
              <div className="text-center pt-2 pb-4">
                <button
                  onClick={handleWofLoadMore}
                  disabled={wofLoadingMore}
                  className="text-sm font-medium px-6 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                  style={{ color: "#FFB454" }}
                >
                  {wofLoadingMore ? t.loading : t.loadMore}
                </button>
              </div>
            )}
          </div>
        ))}

      {/* ── Following Feed ── */}
      {activeTab === "following" &&
        (followingLoading ? (
          <FeedSkeleton />
        ) : followingError ? (
          <div className="glass-card-sm p-8 text-center">
            <p className="text-white font-medium mb-1">{t.feedUnavailable}</p>
            <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>
              {followingError}
            </p>
            <button
              onClick={() => {
                setFollowingError(null);
                setFollowingLoading(true);
                loadFollowingFeed();
              }}
              className="btn-gradient px-4 py-1.5 rounded-lg text-white text-sm font-semibold"
            >
              {t.retry}
            </button>
          </div>
        ) : followingPosts.length === 0 ? (
          <div className="glass-card-sm p-8 text-center">
            <svg
              className="w-12 h-12 mx-auto mb-3"
              style={{ color: "#8E8E93" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
              />
            </svg>
            <p className="text-white font-medium mb-1">{t.noFollowingPostsYet}</p>
            <p className="text-sm" style={{ color: "#8E8E93" }}>
              {t.followSomeone}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {renderCards(followingPosts)}
            {followingNextCursor && (
              <div className="text-center pt-2 pb-4">
                <button
                  onClick={handleFollowingLoadMore}
                  disabled={followingLoadingMore}
                  className="text-sm font-medium px-6 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                  style={{ color: "#D4007A" }}
                >
                  {followingLoadingMore ? t.loading : t.loadMore}
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
