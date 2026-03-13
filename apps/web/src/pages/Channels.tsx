import React, { useState, useEffect, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getAllPerformers, type FeaturedPerformer } from "@/lib/api";
import { NearbyWidget } from "@/components/NearbyWidget";
import { BookCallModal } from "@/components/creators/BookCallModal";
import type { CreatorCardCreator } from "@/components/creators/CreatorCard";

// ============================================================================
// Filter chip types
// ============================================================================

type FilterKey = "all" | "live" | "available" | "content_creator" | "performer";

interface FilterChip {
  key: FilterKey;
  label: string;
}

const FILTER_CHIPS: FilterChip[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live Now" },
  { key: "available", label: "Available" },
  { key: "content_creator", label: "Content Creator" },
  { key: "performer", label: "Performer" },
];

// ============================================================================
// Skeleton card
// ============================================================================

function ChannelCardSkeleton() {
  return (
    <div
      className="rounded-2xl overflow-hidden animate-pulse"
      style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="p-4 flex flex-col gap-3">
        {/* Avatar row */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 rounded-full w-3/4" style={{ background: "rgba(255,255,255,0.08)" }} />
            <div className="h-2.5 rounded-full w-1/2" style={{ background: "rgba(255,255,255,0.05)" }} />
          </div>
        </div>
        {/* Bio lines */}
        <div className="space-y-1.5">
          <div className="h-2.5 rounded-full w-full" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="h-2.5 rounded-full w-5/6" style={{ background: "rgba(255,255,255,0.05)" }} />
        </div>
        {/* Button */}
        <div className="h-9 rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
      </div>
    </div>
  );
}

// ============================================================================
// Star rating
// ============================================================================

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: full }).map((_, i) => (
        <svg key={`f${i}`} className="w-3 h-3" viewBox="0 0 24 24" fill="#E69138">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      {half && (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#E69138">
          <defs>
            <clipPath id="half-clip">
              <rect x="0" y="0" width="12" height="24" />
            </clipPath>
          </defs>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="rgba(255,255,255,0.15)" />
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" clipPath="url(#half-clip)" fill="#E69138" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`e${i}`} className="w-3 h-3" viewBox="0 0 24 24" fill="rgba(255,255,255,0.15)">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      <span className="text-[10px] font-medium ml-1" style={{ color: "#8E8E93" }}>
        {rating.toFixed(1)}
      </span>
    </div>
  );
}

// ============================================================================
// Creator card
// ============================================================================

interface CreatorCardProps {
  performer: FeaturedPerformer;
  userCity?: string | null;
  userCountry?: string | null;
  onViewChannel: (performer: FeaturedPerformer) => void;
  onBookCall: (performer: FeaturedPerformer) => void;
}

function CreatorCard({ performer, userCity, userCountry, onViewChannel, onBookCall }: CreatorCardProps) {
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col transition-all hover:scale-[1.01]"
      style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Avatar + live badge row */}
        <div className="flex items-start gap-3">
          <div className="relative flex-shrink-0">
            {performer.photoUrl ? (
              <img
                src={performer.photoUrl}
                alt={performer.displayName}
                className="w-14 h-14 rounded-full object-cover"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.style.display = "none";
                  const fallback = img.nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.removeProperty("display");
                }}
              />
            ) : null}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold"
              style={{
                background: "linear-gradient(135deg, #D4007A, #E69138)",
                color: "#fff",
                display: performer.photoUrl ? "none" : undefined,
              }}
            >
              {(performer.displayName || "?")[0].toUpperCase()}
            </div>
            {performer.isLive && (
              <span
                className="absolute -bottom-0.5 -right-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white uppercase tracking-wide"
                style={{ background: "#D4007A", boxShadow: "0 0 6px rgba(212,0,122,0.6)" }}
              >
                LIVE
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-white truncate">{performer.displayName}</p>
              {performer.isAvailable && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide flex-shrink-0"
                  style={{ background: "rgba(52,199,89,0.15)", color: "#34C759", border: "1px solid rgba(52,199,89,0.3)" }}
                >
                  Available
                </span>
              )}
            </div>

            {/* Rating */}
            {performer.averageRating > 0 && (
              <div className="mt-0.5">
                <StarRating rating={performer.averageRating} />
              </div>
            )}

            {/* Price */}
            {performer.basePrice > 0 && (
              <p className="text-xs mt-0.5 font-medium" style={{ color: "#E69138" }}>
                from ${performer.basePrice}
              </p>
            )}
          </div>
        </div>

        {/* Bio */}
        {performer.bio && (
          <p
            className="text-xs leading-relaxed overflow-hidden"
            style={{
              color: "rgba(255,255,255,0.65)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {performer.bio}
          </p>
        )}

        {/* NearbyWidget — creator context */}
        <NearbyWidget
          context="creator"
          creatorCity={null}
          creatorCountry={null}
          userCity={userCity}
          userCountry={userCountry}
          creatorName={performer.displayName}
        />

        {/* CTA */}
        <button
          onClick={() => onViewChannel(performer)}
          className="mt-auto w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          View Channel
        </button>
        {performer.basePrice > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBookCall(performer);
            }}
            className="w-full py-2 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all active:scale-95"
            style={{ background: "rgba(212,0,122,0.15)", border: "1px solid rgba(212,0,122,0.3)", color: "#D4007A" }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            {performer.isAvailable ? "Call Now" : "Book a Call"}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Empty state
// ============================================================================

function EmptyState({ query, filter }: { query: string; filter: FilterKey }) {
  const hasFilters = query.length > 0 || filter !== "all";
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
        style={{ background: "rgba(212,0,122,0.12)" }}
      >
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#D4007A" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="text-white font-semibold text-base mb-1">
        {hasFilters ? "No channels match your search" : "No channels yet"}
      </p>
      <p className="text-sm" style={{ color: "#8E8E93" }}>
        {hasFilters
          ? "Try adjusting your filters or search terms"
          : "Check back soon — creators are joining every day"}
      </p>
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

export default function Channels() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [performers, setPerformers] = useState<FeaturedPerformer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [bookCallCreator, setBookCallCreator] = useState<CreatorCardCreator | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getAllPerformers()
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setPerformers(res.performers);
        } else {
          setError("Failed to load channels");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load channels. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return performers.filter((p) => {
      // Search filter
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const matchesName = p.displayName.toLowerCase().includes(q);
        const matchesBio = p.bio?.toLowerCase().includes(q) ?? false;
        if (!matchesName && !matchesBio) return false;
      }

      // Chip filter
      if (activeFilter === "live") return !!p.isLive;
      if (activeFilter === "available") return p.isAvailable;
      // content_creator and performer: FeaturedPerformer has no type field yet,
      // so treat these filters as pass-through until the API exposes creator_type.
      // When the field is added, swap this for: return p.creatorType === activeFilter
      return true;
    });
  }, [performers, query, activeFilter]);

  function handleViewChannel(performer: FeaturedPerformer) {
    if (performer.slug) {
      navigate(`/profile/${performer.slug}`);
    } else if (performer.userId) {
      navigate(`/profile/${performer.userId}`);
    }
  }

  function handleBookCall(performer: FeaturedPerformer) {
    setBookCallCreator({
      id: performer.userId || performer.id,
      username: performer.displayName,
      photo_url: performer.photoUrl,
      creator_type: "full_time",
      creator_price_usd: performer.basePrice,
      bio: performer.bio,
    });
  }

  return (
    <>
      <Helmet>
        <title>Channels — PNPtv</title>
        <meta name="description" content="Discover your community's creators and performers on PNPtv" />
      </Helmet>

      <div
        className="flex flex-col min-h-screen"
        style={{ background: "#0A0A0F" }}
      >
        {/* Header */}
        <div className="px-4 pt-6 pb-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">Channels</h1>
          <p className="text-sm mt-0.5" style={{ color: "#8E8E93" }}>
            Discover your community's creators
          </p>
        </div>

        {/* Search bar */}
        <div className="px-4 mt-3">
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "#8E8E93" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search creators..."
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
            />
            {query.length > 0 && (
              <button
                onClick={() => setQuery("")}
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80"
                style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
                aria-label="Clear search"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto px-4 mt-3 pb-1 scrollbar-hide no-scrollbar">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setActiveFilter(chip.key)}
              className="flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={
                activeFilter === chip.key
                  ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
                  : { background: "rgba(255,255,255,0.08)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.1)" }
              }
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 px-4 py-4 pb-24">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <ChannelCardSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                style={{ background: "rgba(255,59,48,0.12)" }}
              >
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="#FF3B30" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <p className="text-white font-semibold mb-1">Something went wrong</p>
              <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  getAllPerformers()
                    .then((res) => {
                      if (res.success) setPerformers(res.performers);
                      else setError("Failed to load channels");
                    })
                    .catch(() => setError("Failed to load channels. Please try again."))
                    .finally(() => setIsLoading(false));
                }}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState query={query} filter={activeFilter} />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filtered.map((performer) => (
                <CreatorCard
                  key={performer.id}
                  performer={performer}
                  userCity={user?.city}
                  userCountry={user?.country}
                  onViewChannel={handleViewChannel}
                  onBookCall={handleBookCall}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {bookCallCreator && (
        <BookCallModal
          creator={bookCallCreator}
          isOnline={performers.find((p) => (p.userId || p.id) === bookCallCreator.id)?.isAvailable ?? false}
          open={!!bookCallCreator}
          onClose={() => setBookCallCreator(null)}
        />
      )}
    </>
  );
}
