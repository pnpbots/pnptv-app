import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import { getChannels, type Channel } from "@/lib/api";
import { connectSocket } from "@/lib/socket";

// ── Tier badge colors ────────────────────────────────────────────────────────
const TIER_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  ice: { bg: "rgba(173,216,230,0.15)", text: "#ADD8E6", label: "Ice" },
  crystal: { bg: "rgba(138,43,226,0.15)", text: "#BA55D3", label: "Crystal" },
  diamond: { bg: "rgba(0,191,255,0.15)", text: "#00BFFF", label: "Diamond" },
  full_time: { bg: "rgba(255,215,0,0.15)", text: "#FFD700", label: "Pro" },
};

const SORT_OPTIONS = [
  { value: "popular", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "az", label: "A\u2013Z" },
] as const;

// ── Helper ───────────────────────────────────────────────────────────────────
function isValidPhotoUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return url.startsWith("/") || url.startsWith("http");
}

// ── Channel Card ─────────────────────────────────────────────────────────────
function ChannelCard({ channel, onClick }: { channel: Channel; onClick: () => void }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const tier = TIER_COLORS[channel.creatorType] || TIER_COLORS.ice;
  const hasPreview = isValidPhotoUrl(channel.latestMediaUrl);

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-pnp-surface overflow-hidden flex flex-col text-center transition-all hover:scale-[1.02] hover:border-pnp-accent/40 cursor-pointer w-full ${
        channel.isLive ? "border-red-500/50 ring-1 ring-red-500/20" : "border-pnp-border"
      }`}
    >
      {/* Preview thumbnail */}
      {hasPreview && (
        <div className="relative w-full aspect-video bg-pnp-surfaceHover">
          {!previewLoaded && (
            <div className="absolute inset-0 bg-pnp-surfaceHover animate-pulse" />
          )}
          <img
            src={channel.latestMediaUrl!}
            alt=""
            className={`w-full h-full object-cover ${previewLoaded ? "block" : "hidden"}`}
            onLoad={() => setPreviewLoaded(true)}
            onError={() => setPreviewLoaded(true)}
          />
          {channel.isLive && (
            <span className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
        </div>
      )}

      <div className="p-4 flex flex-col items-center">
        {/* Avatar */}
        <div className="relative mb-3">
          {!imgLoaded && (
            <div className={`${hasPreview ? "w-14 h-14" : "w-20 h-20"} rounded-full bg-pnp-surfaceHover animate-pulse`} />
          )}
          <img
            src={isValidPhotoUrl(channel.photoUrl) ? channel.photoUrl : "/default-performer.svg"}
            alt={channel.displayName}
            className={`${hasPreview ? "w-14 h-14" : "w-20 h-20"} rounded-full object-cover border-2 ${
              channel.isLive ? "border-red-500" : "border-pnp-border"
            } ${imgLoaded ? "block" : "hidden"}`}
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              (e.target as HTMLImageElement).src = "/default-performer.svg";
              setImgLoaded(true);
            }}
          />
          {channel.isLive && !hasPreview && (
            <span className="absolute -top-1 -right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
        </div>

        {/* Name + verified */}
        <div className="flex items-center gap-1 mb-1">
          <span className="text-sm font-semibold text-pnp-textPrimary truncate max-w-[120px]">
            {channel.displayName}
          </span>
          {channel.verified && (
            <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          )}
        </div>

        {/* Tier badge */}
        <span
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full mb-2"
          style={{ background: tier.bg, color: tier.text }}
        >
          {tier.label}
        </span>

        {/* Stats */}
        <div className="flex items-center gap-3 text-[11px] text-pnp-textSecondary">
          <span>{channel.subscriberCount} subs</span>
          <span className="w-0.5 h-0.5 rounded-full bg-pnp-textSecondary" />
          <span>{channel.postCount} posts</span>
        </div>

        {/* Featured badge */}
        {channel.featured && (
          <span className="text-[10px] mt-1.5 font-semibold" style={{ color: "#5ED1C4" }}>
            Featured
          </span>
        )}
      </div>
    </button>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Channels() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<"popular" | "newest" | "az">("popular");
  const [filter, setFilter] = useState<"all" | "live" | "featured">("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch channels
  const fetchChannels = useCallback(
    async (pageNum: number, append = false) => {
      if (!append) setLoading(true);
      else setLoadingMore(true);
      try {
        const res = await getChannels({
          search: debouncedSearch || undefined,
          live: filter === "live" || undefined,
          featured: filter === "featured" || undefined,
          sort,
          page: pageNum,
          limit: 24,
        });
        if (res.success) {
          setChannels((prev) => (append ? [...prev, ...res.channels] : res.channels));
          setHasMore(res.nextPage !== null);
          setTotal(res.total);
          setPage(pageNum);
        }
      } catch {
        // non-critical
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedSearch, filter, sort]
  );

  // Initial fetch + refetch on filter/sort/search change
  useEffect(() => {
    fetchChannels(0);
  }, [fetchChannels]);

  // Real-time live status via Socket.IO
  useEffect(() => {
    const socket = connectSocket();
    const handleLive = ({ userId }: { userId: string }) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === userId ? { ...ch, isLive: true } : ch))
      );
    };
    const handleOffline = ({ userId }: { userId: string }) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === userId ? { ...ch, isLive: false, hlsUrl: null } : ch))
      );
    };
    socket.on("channel:live", handleLive);
    socket.on("channel:offline", handleOffline);
    return () => {
      socket.off("channel:live", handleLive);
      socket.off("channel:offline", handleOffline);
    };
  }, []);

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore) {
          fetchChannels(page + 1, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, page, fetchChannels]);

  const featuredChannels = channels.filter((c) => c.featured);

  return (
    <>
      <Helmet>
        <title>Channels — PNPtv!</title>
        <meta name="description" content="Browse PNPtv creator channels" />
      </Helmet>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1
            className="text-2xl sm:text-3xl font-black tracking-tight"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            PNP Channels
          </h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Discover creators, exclusive content & live streams
          </p>
        </div>

        {/* Search + Filters */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pnp-textSecondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channels..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent/50 transition-colors"
            />
          </div>

          {/* Filter pills + Sort */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {(["all", "live", "featured"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                    filter === f
                      ? "bg-pnp-accent text-white"
                      : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary"
                  }`}
                >
                  {f === "all" ? "All" : f === "live" ? "Live Now" : "Featured"}
                </button>
              ))}
            </div>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="px-3 py-1.5 rounded-lg bg-pnp-surface border border-pnp-border text-xs text-pnp-textPrimary focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Featured Strip */}
        {!loading && featuredChannels.length > 0 && filter === "all" && !debouncedSearch && (
          <div>
            <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">Featured Creators</h2>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
              {featuredChannels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => navigate(`/profile/${ch.id}`)}
                  className="flex-shrink-0 flex flex-col items-center w-20 group"
                >
                  <div className="relative">
                    <img
                      src={isValidPhotoUrl(ch.photoUrl) ? ch.photoUrl : "/default-performer.svg"}
                      alt={ch.displayName}
                      className={`w-16 h-16 rounded-full object-cover border-2 ${
                        ch.isLive ? "border-red-500" : "border-pnp-accent"
                      } group-hover:scale-105 transition-transform`}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/default-performer.svg";
                      }}
                    />
                    {ch.isLive && (
                      <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold uppercase">
                        Live
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-pnp-textPrimary mt-1.5 truncate max-w-full">
                    {ch.displayName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Total count */}
        {!loading && (
          <p className="text-xs text-pnp-textSecondary">
            {total} channel{total !== 1 ? "s" : ""}
            {debouncedSearch ? ` matching "${debouncedSearch}"` : ""}
          </p>
        )}

        {/* Channel Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-pnp-border bg-pnp-surface p-4 flex flex-col items-center">
                <div className="w-20 h-20 rounded-full bg-pnp-surfaceHover animate-pulse mb-3" />
                <div className="w-20 h-3 rounded bg-pnp-surfaceHover animate-pulse mb-2" />
                <div className="w-14 h-2.5 rounded bg-pnp-surfaceHover animate-pulse mb-2" />
                <div className="w-24 h-2 rounded bg-pnp-surfaceHover animate-pulse" />
              </div>
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
              style={{ background: "rgba(212,0,122,0.1)" }}
            >
              <svg className="w-8 h-8 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <p className="text-pnp-textPrimary font-semibold mb-1">No channels found</p>
            <p className="text-sm text-pnp-textSecondary mb-4">
              {debouncedSearch ? "Try a different search term" : "No creators available yet"}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setSearch(""); setFilter("all"); }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {channels.map((ch) => (
                <ChannelCard
                  key={ch.id}
                  channel={ch}
                  onClick={() => navigate(`/profile/${ch.id}`)}
                />
              ))}
            </div>

            {/* Loading more indicator */}
            {loadingMore && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" />
          </>
        )}
      </div>
    </>
  );
}
