/**
 * PerformerDrawer — right-side panel (desktop) / bottom sheet (mobile) that
 * opens when a performer card on Live.tsx is tapped.
 *
 * Three zones:
 *   1. Hero       — live player if isLive, else poster + video teaser
 *   2. Album grid — 2-col mobile / 3-col desktop; premium tiles blurred w/ lock
 *   3. Sticky footer CTAs — Watch Live / Book Call / Subscribe
 *
 * One new file is justified: the drawer + album grid together are ~300 lines of
 * JSX + state that would make Live.tsx unmaintainable if inlined.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { BookCallModal } from "@/components/creators/BookCallModal";
import { LivePlayer } from "@/components/LivePlayer";
import {
  listCreatorMedia,
  listCreatorRecordings,
  getCreatorSubscriptionStatus,
  isCreatorPayLocked,
  type CreatorMediaItem,
  type StreamRecording,
  type FeaturedPerformer,
} from "@/lib/api";
import type { CreatorCardCreator } from "@/components/creators/CreatorCard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveStream {
  id: string;
  channel?: string | null;
}

export interface PerformerDrawerProps {
  performer: FeaturedPerformer | null;
  liveStreamId?: string | null;
  onClose: () => void;
}

// ─── Internal: Album Grid ─────────────────────────────────────────────────────

function LockIcon() {
  return (
    <svg className="w-6 h-6 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function AlbumTile({
  item,
  onGatedTap,
}: {
  item: CreatorMediaItem;
  onGatedTap: () => void;
}) {
  const src = item.thumbUrl || item.url;

  if (!item.canView || !src) {
    return (
      <div
        className="relative aspect-square rounded-xl overflow-hidden bg-pnp-surface border border-pnp-border cursor-pointer group"
        onClick={onGatedTap}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onGatedTap()}
        aria-label="Premium content — subscribe to view"
      >
        {/* blurred placeholder */}
        <div className="absolute inset-0 bg-gradient-to-br from-pnp-border/60 to-pnp-surface/80" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <LockIcon />
          <span className="text-[10px] text-white/60 font-medium">Premium</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-square rounded-xl overflow-hidden bg-pnp-surface border border-pnp-border group">
      {item.type === "video" ? (
        <video
          src={src}
          className="w-full h-full object-cover"
          muted
          loop
          playsInline
          preload="none"
          onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
          onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); }}
        />
      ) : (
        <img
          src={src}
          alt={item.caption || "Album photo"}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
      {item.type === "video" && (
        <span className="absolute top-1.5 left-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[9px] font-bold">
          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
          VIDEO
        </span>
      )}
      {item.isPremium && (
        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-pnp-accent/80 text-white text-[9px] font-bold">
          PREM
        </span>
      )}
      {item.caption && (
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/50 text-white text-[10px] leading-tight line-clamp-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {item.caption}
        </div>
      )}
    </div>
  );
}

// ─── Placeholder tile ─────────────────────────────────────────────────────────

function PlaceholderTile() {
  return (
    <div className="aspect-square rounded-xl bg-pnp-surface border border-pnp-border/30 flex items-center justify-center">
      <svg className="w-8 h-8 text-pnp-border/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75h.008v.008H3V9.75zm0 4.5h.008v.008H3v-.008zm13.5-9.75h.008v.008H16.5V4.5z" />
      </svg>
    </div>
  );
}

// ─── Replay helpers ───────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (!seconds) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatReplayDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export function PerformerDrawer({ performer, liveStreamId, onClose }: PerformerDrawerProps) {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  const [media, setMedia] = useState<CreatorMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subPrice, setSubPrice] = useState<number>(0);
  const [subLoading, setSubLoading] = useState(false);
  const [showBookModal, setShowBookModal] = useState(false);
  const [showSubscribePrompt, setShowSubscribePrompt] = useState(false);
  const [recordings, setRecordings] = useState<StreamRecording[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const isLive = !!liveStreamId;
  const creatorId = performer?.userId || performer?.id || null;

  // Load media + subscription status when drawer opens
  useEffect(() => {
    if (!performer || !creatorId) return;
    let cancelled = false;

    async function load() {
      setMediaLoading(true);
      try {
        const res = await listCreatorMedia(creatorId as string);
        if (!cancelled) setMedia(res.items || []);
      } catch {
        // non-fatal — empty grid
      } finally {
        if (!cancelled) setMediaLoading(false);
      }
    }

    async function loadSub() {
      if (!isAuthenticated || !creatorId) return;
      try {
        const res = await getCreatorSubscriptionStatus(creatorId as string);
        if (!cancelled) {
          setSubscribed(res.subscribed);
          setSubPrice(res.creator?.priceUsd || 0);
        }
      } catch {
        // non-fatal
      }
    }

    async function loadRecordings() {
      if (!creatorId) return;
      setRecordingsLoading(true);
      try {
        const res = await listCreatorRecordings(creatorId as string);
        if (!cancelled) setRecordings(res.recordings || []);
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setRecordingsLoading(false);
      }
    }

    load();
    loadSub();
    loadRecordings();
    return () => { cancelled = true; };
  }, [performer, creatorId, isAuthenticated]);

  // ESC key closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Swipe-down to close on mobile
  const touchStartY = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 80) onClose();
  }, [onClose]);

  const handleSubscribe = () => {
    if (!isAuthenticated) { navigate("/login"); return; }
    if (!creatorId) return;
    // Navigate to the creator's profile page where the proper payment-gated
    // subscribe flow lives. Direct API subscription without payment is not allowed.
    navigate(`/profile/${creatorId}`);
    onClose();
  };

  if (!performer) return null;

  const avatar = performer.photoUrl;
  const displayName = performer.displayName;

  // Build creator object for BookCallModal
  const creatorForModal: CreatorCardCreator = {
    id: creatorId || "",
    username: performer.slug || performer.displayName,
    photo_url: performer.photoUrl || null,
    creator_type: "full_time",
    creator_price_usd: performer.basePrice || 0,
    bio: performer.bio || null,
  };

  // First video in album for background teaser
  const posterMedia = media.find((m) => m.type === "photo" && m.canView && m.url);
  const videoTeaser = media.find((m) => m.type === "video" && m.canView && m.url);
  const posterSrc = posterMedia?.url || avatar;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${displayName} profile`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="fixed z-50 flex flex-col
          inset-x-0 bottom-0 h-[90dvh] rounded-t-2xl
          sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:h-full sm:rounded-none sm:rounded-l-2xl
          bg-pnp-bg border-t sm:border-t-0 sm:border-l border-pnp-border
          overflow-hidden shadow-2xl"
        style={{ willChange: "transform" }}
      >
        {/* Swipe handle (mobile only) */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-pnp-border" />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* ── Zone 1: Hero ── */}
          <div className="relative w-full aspect-video bg-black flex-shrink-0">
            {isLive && performer.hlsUrl ? (
              <LivePlayer
                src={performer.hlsUrl}
                title={displayName}
                poster={posterSrc || undefined}
                className="w-full h-full"
              />
            ) : videoTeaser ? (
              <video
                src={videoTeaser.url as string}
                className="w-full h-full object-cover"
                autoPlay
                muted
                loop
                playsInline
              />
            ) : posterSrc ? (
              <img
                src={posterSrc}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-pnp-surface flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-pnp-border flex items-center justify-center">
                  <svg className="w-10 h-10 text-pnp-textSecondary" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                  </svg>
                </div>
              </div>
            )}
            {isLive && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500 text-white text-xs font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                LIVE
              </div>
            )}
          </div>

          {/* Name + bio */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <img
                src={avatar || "/default-performer.svg"}
                alt={displayName}
                className="w-12 h-12 rounded-full object-cover border-2 border-pnp-border flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).src = "/default-performer.svg"; }}
              />
              <div className="min-w-0">
                <p className="text-base font-bold text-pnp-textPrimary truncate">{displayName}</p>
                {performer.bio && (
                  <p className="text-xs text-pnp-textSecondary line-clamp-2 mt-0.5">{performer.bio}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Zone 2: Album grid ── */}
          <div className="px-4 pb-4">
            <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">Album</p>
            {mediaLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="aspect-square rounded-xl bg-pnp-surface animate-pulse" />
                ))}
              </div>
            ) : media.length === 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <PlaceholderTile />
                <PlaceholderTile />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {media.map((item) => (
                  <AlbumTile
                    key={item.id}
                    item={item}
                    onGatedTap={() => setShowSubscribePrompt(true)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Zone 3: Replays ── */}
          <div className="px-4 pb-6">
            <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-2">Replays</p>

            {/* Inline replay player lightbox */}
            {replayUrl && (
              <div className="mb-3">
                <LivePlayer src={replayUrl} className="rounded-xl" />
                <button
                  onClick={() => setReplayUrl(null)}
                  className="mt-1.5 text-[10px] text-pnp-textSecondary hover:text-white transition-colors"
                >
                  Close replay
                </button>
              </div>
            )}

            {recordingsLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <div key={i} className="h-14 bg-pnp-surface rounded-xl animate-pulse" />)}
              </div>
            ) : recordings.length === 0 ? (
              <p className="text-xs text-pnp-textSecondary py-3">No replays yet.</p>
            ) : (
              <div className="space-y-2">
                {recordings.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => {
                      if (rec.requiresSubscription) {
                        setShowSubscribePrompt(true);
                      } else if (rec.manifestUrl) {
                        setReplayUrl(rec.manifestUrl);
                      }
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {/* Thumbnail or play/lock icon */}
                    <div
                      className="w-14 h-9 flex-shrink-0 rounded-lg overflow-hidden relative flex items-center justify-center"
                      style={{ background: rec.requiresSubscription ? "rgba(212,0,122,0.12)" : "rgba(94,209,196,0.07)" }}
                    >
                      {rec.thumbUrl && !rec.requiresSubscription ? (
                        <img src={rec.thumbUrl} alt="" className="w-full h-full object-cover" />
                      ) : null}
                      {/* overlay icon */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        {rec.requiresSubscription ? (
                          <svg className="w-4 h-4 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0110 0v4" />
                          </svg>
                        ) : !rec.thumbUrl ? (
                          <svg className="w-4 h-4 text-pnp-accent" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.84z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white/60 drop-shadow" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.84z" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-pnp-textPrimary truncate">
                        {rec.title || `${formatReplayDate(rec.startedAt)} \u2014 ${formatDuration(rec.durationSeconds)}`}
                      </p>
                      {rec.description ? (
                        <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                          {rec.description.length > 60 ? rec.description.slice(0, 60) + "\u2026" : rec.description}
                        </p>
                      ) : (
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                          {rec.requiresSubscription ? "Subscribe to watch" : "Tap to watch replay"}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Zone 3: Sticky footer CTAs ── */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-pnp-border bg-pnp-bg/95 backdrop-blur-sm flex flex-col gap-2">
          {/* Subscribe prompt (inline, above CTAs) */}
          {showSubscribePrompt && !subscribed && (
            <div className="rounded-xl p-3 mb-1" style={{ background: "rgba(212,0,122,0.1)", border: "1px solid rgba(212,0,122,0.25)" }}>
              <p className="text-xs text-pnp-textPrimary font-semibold mb-1">
                Unlock premium content for ${subPrice.toFixed(2)}/mo
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleSubscribe}
                  disabled={subLoading}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
                >
                  {subLoading ? "Processing..." : "Subscribe now"}
                </button>
                <button
                  onClick={() => setShowSubscribePrompt(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-pnp-textSecondary bg-pnp-surface border border-pnp-border"
                >
                  Later
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {/* Watch Live */}
            {isLive ? (
              <button
                onClick={() => navigate(`/live/${liveStreamId}`)}
                className="col-span-1 py-2.5 rounded-xl text-xs font-bold text-white bg-red-500 hover:bg-red-600 active:scale-95 transition-all"
              >
                Watch Live
              </button>
            ) : (
              <button
                disabled
                className="col-span-1 py-2.5 rounded-xl text-xs font-bold text-pnp-textSecondary bg-pnp-surface border border-pnp-border opacity-40 cursor-not-allowed"
              >
                Offline
              </button>
            )}

            {/* Book Call */}
            {isCreatorPayLocked(performer.slug) ? (
              <button
                disabled
                className="col-span-1 py-2.5 rounded-xl text-xs font-bold opacity-50 cursor-not-allowed bg-white/5 border border-white/10 text-pnp-textSecondary"
              >
                🔒 June 1st
              </button>
            ) : (
              <button
                onClick={() => setShowBookModal(true)}
                className="col-span-1 py-2.5 rounded-xl text-xs font-bold text-pnp-textPrimary bg-pnp-surface border border-pnp-border hover:border-pnp-accent/40 active:scale-95 transition-all"
              >
                Book Call
              </button>
            )}

            {/* Subscribe */}
            {isCreatorPayLocked(performer.slug) ? (
              <button
                disabled
                className="col-span-1 py-2.5 rounded-xl text-xs font-bold opacity-50 cursor-not-allowed bg-white/5 border border-white/10 text-pnp-textSecondary"
              >
                🔒 June 1st
              </button>
            ) : (
              <button
                onClick={() => {
                  if (subscribed) return;
                  setShowSubscribePrompt((v) => !v);
                }}
                className="col-span-1 py-2.5 rounded-xl text-xs font-bold text-white active:scale-95 transition-all"
                style={
                  subscribed
                    ? { background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }
                    : { background: "linear-gradient(135deg,#D4007A,#E69138)" }
                }
              >
                {subscribed ? "Subscribed" : `$${subPrice > 0 ? subPrice.toFixed(0) : "?"}/mo`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Book Call Modal */}
      {showBookModal && (
        <BookCallModal
          creator={creatorForModal}
          isOnline={isLive}
          open={showBookModal}
          onClose={() => setShowBookModal(false)}
        />
      )}
    </>
  );
}
