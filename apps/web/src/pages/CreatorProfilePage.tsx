/**
 * CreatorProfilePage — public-facing creator profile at /creator/:username
 *
 * Shows free + blurred premium media, subscribe CTA, and book-a-call entry.
 * Does NOT require authentication to view (public page), but subscribe action
 * requires login.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  Lock,
  CheckCircle2,
  Play,
  X,
  AlertTriangle,
  Users,
  BadgeCheck,
  PhoneCall,
  Star,
  RefreshCw,
} from "lucide-react";
import {
  getPublicCreatorProfile,
  subscribeToCreator,
  unsubscribeFromCreator,
  ApiError,
  type CreatorPublicProfile,
  type PublicCreatorMediaItem,
  type PublicCallPackage,
} from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatar } from "@/components/UserAvatar";
import { BookCallModal } from "@/components/creators/BookCallModal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(usd);
}

type CreatorTier = "creator" | "crystal" | "ice";

const TIER_LABEL: Record<CreatorTier, string> = {
  creator: "Creator",
  crystal: "Crystal",
  ice: "ICE",
};

function TierBadge({ tier }: { tier: CreatorTier }) {
  if (tier === "crystal") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
        style={{ background: "rgba(6,182,212,0.18)", color: "#22D3EE" }}
      >
        Crystal
      </span>
    );
  }
  if (tier === "ice") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
        style={{ background: "rgba(59,130,246,0.18)", color: "#60A5FA" }}
      >
        ICE
      </span>
    );
  }
  // "creator" default — green
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
      style={{ background: "rgba(34,197,94,0.18)", color: "#4ADE80" }}
    >
      Creator
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="min-h-dvh" style={{ background: "var(--pnp-background)" }}>
      <div className="max-w-2xl mx-auto px-4 pt-10 pb-24">
        {/* Header skeleton */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-24 h-24 rounded-full animate-pulse" style={{ background: "var(--pnp-surface)" }} />
          <div className="h-5 w-32 rounded-lg animate-pulse" style={{ background: "var(--pnp-surface)" }} />
          <div className="h-3 w-20 rounded-lg animate-pulse" style={{ background: "var(--pnp-surface)" }} />
          <div className="h-10 w-48 rounded-xl animate-pulse" style={{ background: "var(--pnp-surface)" }} />
        </div>
        {/* Grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-xl animate-pulse"
              style={{ background: "var(--pnp-surface)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps {
  item: PublicCreatorMediaItem;
  onClose: () => void;
}

function Lightbox({ item, onClose }: LightboxProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      <button
        className="absolute top-4 right-4 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
        onClick={onClose}
        aria-label="Close media viewer"
      >
        <X size={18} />
      </button>

      <div
        className="max-w-[90vw] max-h-[90dvh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {item.media_type === "video" ? (
          <video
            src={item.url!}
            controls
            autoPlay
            className="max-w-full max-h-[90dvh] rounded-xl"
            style={{ background: "#000" }}
          />
        ) : (
          <img
            src={item.url!}
            alt={item.caption ?? "Creator media"}
            className="max-w-full max-h-[90dvh] rounded-xl object-contain"
          />
        )}
      </div>

      {item.caption && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center px-4">
          <p className="text-sm text-white/80 text-center max-w-md bg-black/60 px-3 py-1.5 rounded-lg">
            {item.caption}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Media item tile ──────────────────────────────────────────────────────────

interface MediaTileProps {
  item: PublicCreatorMediaItem;
  isSubscribed: boolean;
  onOpenLightbox: (item: PublicCreatorMediaItem) => void;
  onSubscribeCta: () => void;
}

function MediaTile({
  item,
  isSubscribed,
  onOpenLightbox,
  onSubscribeCta,
}: MediaTileProps) {
  const isLocked = item.is_premium && item.url === null;
  const isUnlocked = item.is_premium && item.url !== null;
  const thumbSrc = item.thumb_url ?? item.url;
  const isViewable = !isLocked;

  function handleClick() {
    if (isLocked) {
      onSubscribeCta();
      return;
    }
    onOpenLightbox(item);
  }

  return (
    <button
      className="relative aspect-square rounded-xl overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      style={{ background: "var(--pnp-surface)" }}
      onClick={handleClick}
      aria-label={
        isLocked
          ? "Locked premium content — subscribe to unlock"
          : item.caption
          ? item.caption
          : item.media_type === "video"
          ? "Play video"
          : "View photo"
      }
    >
      {/* Thumbnail */}
      {thumbSrc && (
        <img
          src={thumbSrc}
          alt={item.caption ?? ""}
          loading="lazy"
          className={[
            "w-full h-full object-cover transition-transform duration-200",
            isViewable ? "group-hover:scale-105" : "blur-sm scale-105",
          ].join(" ")}
        />
      )}

      {/* Locked overlay */}
      {isLocked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 backdrop-blur-[2px]">
          <Lock size={20} className="text-white/80" aria-hidden="true" />
          <span className="text-[10px] font-medium text-white/70 text-center px-2 leading-tight">
            Subscribe to unlock
          </span>
        </div>
      )}

      {/* Video play icon */}
      {!isLocked && item.media_type === "video" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-black/80 transition-colors">
            <Play size={16} className="text-white ml-0.5" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Exclusive badge */}
      {isUnlocked && (
        <div className="absolute top-1.5 left-1.5">
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider text-white uppercase"
            style={{ background: "var(--pnp-accent)" }}
          >
            Exclusive
          </span>
        </div>
      )}
    </button>
  );
}

// ─── Subscribe panel ──────────────────────────────────────────────────────────

interface SubscribePanelProps {
  creatorId: string;
  priceUsd: number;
  onSuccess: () => void;
}

function SubscribePanel({ creatorId, priceUsd, onSuccess }: SubscribePanelProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "payment_pending" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  async function handleSubscribe() {
    setStatus("loading");
    setError(null);
    try {
      const result = await subscribeToCreator(creatorId);
      if (result.paymentUrl) {
        setPaymentUrl(result.paymentUrl);
        window.open(result.paymentUrl, "_blank", "noopener,noreferrer");
        setStatus("payment_pending");
      } else if (result.success) {
        onSuccess();
      } else {
        setError("Could not start subscription. Please try again.");
        setStatus("error");
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.";
      setError(msg);
      setStatus("error");
    }
  }

  if (status === "payment_pending") {
    return (
      <div
        className="rounded-xl p-4 mt-3 border border-white/10 text-center space-y-3"
        style={{ background: "var(--pnp-surface)" }}
      >
        <p className="text-sm text-pnp-textPrimary font-medium">
          Payment opened in a new tab
        </p>
        <p className="text-xs text-pnp-textSecondary">
          Complete your payment, then come back and check your subscription status.
        </p>
        {paymentUrl && (
          <a
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-pnp-accent underline decoration-dotted"
          >
            Re-open payment page
          </a>
        )}
        <button
          onClick={onSuccess}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ background: "var(--pnp-accent)" }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Check subscription status
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4 mt-3 border border-white/10 space-y-3"
      style={{ background: "var(--pnp-surface)" }}
    >
      <p className="text-sm text-pnp-textSecondary text-center">
        Unlock all exclusive content for{" "}
        <span className="text-pnp-textPrimary font-semibold">
          {formatPrice(priceUsd)}/mo
        </span>
      </p>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleSubscribe}
        disabled={status === "loading"}
        className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
        style={{ background: "var(--pnp-accent)" }}
      >
        {status === "loading" ? "Processing…" : `Subscribe · ${formatPrice(priceUsd)}/mo`}
      </button>

      <p className="text-[10px] text-pnp-textSecondary text-center">
        Cancel anytime. Content unlocks immediately after payment.
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CreatorProfilePage() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const [data, setData] = useState<CreatorPublicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);

  // Local subscription state derived from API data but can be toggled optimistically
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSubscribePanel, setShowSubscribePanel] = useState(false);
  const [unsubscribeLoading, setUnsubscribeLoading] = useState(false);

  const [lightboxItem, setLightboxItem] = useState<PublicCreatorMediaItem | null>(null);
  const [showBookCall, setShowBookCall] = useState(false);

  const subscribePanelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!username) return;
    setIsLoading(true);
    setLoadError(null);
    setIsNotFound(false);
    try {
      const result = await getPublicCreatorProfile(username);
      setData(result);
      setIsSubscribed(result.isSubscribed);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setIsNotFound(true);
      } else {
        setLoadError(
          err instanceof Error
            ? err.message
            : "Could not load this creator profile."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  function handleSubscribeCta() {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    setShowSubscribePanel(true);
    // Scroll to panel after render
    setTimeout(() => {
      subscribePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function handleSubscribeSuccess() {
    setIsSubscribed(true);
    setShowSubscribePanel(false);
    // Reload to get unlocked media URLs
    load();
  }

  async function handleUnsubscribe() {
    if (!data) return;
    setUnsubscribeLoading(true);
    try {
      await unsubscribeFromCreator(data.creator.id);
      setIsSubscribed(false);
      load();
    } catch {
      // Silent — subscription status unchanged
    } finally {
      setUnsubscribeLoading(false);
    }
  }

  // ── Loading ──
  if (isLoading) return <PageSkeleton />;

  // ── Not found ──
  if (isNotFound) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6"
        style={{ background: "var(--pnp-background)" }}
      >
        <Helmet>
          <title>Creator not found · PNPtv!</title>
        </Helmet>
        <AlertTriangle size={40} className="text-pnp-textSecondary" aria-hidden="true" />
        <h1 className="text-lg font-bold text-pnp-textPrimary">Creator not found</h1>
        <p className="text-sm text-pnp-textSecondary text-center">
          This creator profile doesn&apos;t exist or may have been removed.
        </p>
        <button
          onClick={() => navigate("/")}
          className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ background: "var(--pnp-accent)" }}
        >
          Back to home
        </button>
      </div>
    );
  }

  // ── Network error ──
  if (loadError || !data) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6"
        style={{ background: "var(--pnp-background)" }}
      >
        <Helmet>
          <title>Error · PNPtv!</title>
        </Helmet>
        <AlertTriangle size={40} className="text-pnp-textSecondary" aria-hidden="true" />
        <h1 className="text-lg font-bold text-pnp-textPrimary">Something went wrong</h1>
        <p className="text-sm text-pnp-textSecondary text-center">
          {loadError ?? "Could not load this creator profile."}
        </p>
        <button
          onClick={load}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ background: "var(--pnp-accent)" }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  const { creator, media, callPackages } = data;
  const activePackages = callPackages.filter((p) => p.is_active);
  const hasCallPackages = activePackages.length > 0;

  // Map the public API's creator_type values to the internal CreatorType used by BookCallModal.
  // "creator" has no direct equivalent — map it to "full_time" (same display intent).
  const mappedCreatorType = (
    creator.creator_type === "creator" ? "full_time" : creator.creator_type
  ) as import("@/components/creators/CreatorCard").CreatorType;

  // Assemble creator shape expected by BookCallModal
  const bookCallCreator = {
    id: creator.id,
    username: creator.username,
    photo_url: creator.photo_url,
    creator_type: mappedCreatorType,
    creator_price_usd: creator.creator_price_usd,
    bio: creator.bio,
  };

  return (
    <>
      <Helmet>
        <title>
          {creator.first_name} (@{creator.username}) · PNPtv!
        </title>
        <meta
          name="description"
          content={
            creator.bio
              ? creator.bio.slice(0, 155)
              : `Check out ${creator.first_name} on PNPtv!`
          }
        />
      </Helmet>

      <div
        className="min-h-dvh"
        style={{ background: "var(--pnp-background)" }}
      >
        <div className="max-w-2xl mx-auto px-4 pt-8 pb-24">

          {/* ── Header ────────────────────────────────────────────────────── */}
          <section className="flex flex-col items-center text-center mb-6 gap-3">
            <UserAvatar
              userId={creator.id}
              photoUrl={creator.photo_url}
              displayName={creator.first_name}
              size="xl"
              linkToProfile={false}
              showOnline={false}
            />

            <div className="space-y-1 min-w-0 w-full">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-pnp-textPrimary leading-none">
                  {creator.first_name}
                </h1>
                {creator.creator_verified && (
                  <BadgeCheck
                    size={18}
                    className="text-pnp-accent shrink-0"
                    aria-label="Verified creator"
                  />
                )}
              </div>

              <p className="text-sm text-pnp-textSecondary">@{creator.username}</p>

              <div className="flex items-center justify-center gap-2 pt-0.5 flex-wrap">
                <TierBadge tier={creator.creator_type} />
                <span className="flex items-center gap-1 text-xs text-pnp-textSecondary">
                  <Users size={11} aria-hidden="true" />
                  {creator.creator_subscriber_count.toLocaleString()} subscriber
                  {creator.creator_subscriber_count !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {creator.bio && (
              <p className="text-sm text-pnp-textSecondary max-w-sm leading-relaxed">
                {creator.bio}
              </p>
            )}
          </section>

          {/* ── Action bar ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2 mb-6" ref={subscribePanelRef}>
            {creator.creator_subscription_paused ? (
              <div className="flex items-center justify-center">
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-pnp-textSecondary bg-white/8 border border-white/10">
                  Subscriptions paused
                </span>
              </div>
            ) : isSubscribed ? (
              <div className="flex items-center justify-center gap-3">
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold text-green-400 bg-green-500/15 border border-green-500/25">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  Subscribed
                </span>
                <button
                  onClick={handleUnsubscribe}
                  disabled={unsubscribeLoading}
                  className="text-xs text-pnp-textSecondary underline decoration-dotted hover:text-pnp-textPrimary transition-colors disabled:opacity-50"
                >
                  {unsubscribeLoading ? "Cancelling…" : "Manage"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleSubscribeCta}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] min-h-[44px]"
                  style={{ background: "var(--pnp-accent)" }}
                >
                  <Star size={15} aria-hidden="true" />
                  Subscribe · {formatPrice(creator.creator_price_usd)}/mo
                </button>

                {hasCallPackages && (
                  <button
                    onClick={() => setShowBookCall(true)}
                    className="sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-pnp-textPrimary border border-white/15 bg-white/5 hover:bg-white/10 active:scale-[0.98] transition-all min-h-[44px]"
                  >
                    <PhoneCall size={15} aria-hidden="true" />
                    Book a Call
                  </button>
                )}
              </div>
            )}

            {/* Subscribe inline payment panel */}
            {showSubscribePanel && !isSubscribed && (
              <SubscribePanel
                creatorId={creator.id}
                priceUsd={creator.creator_price_usd}
                onSuccess={handleSubscribeSuccess}
              />
            )}

            {/* Book a call button when already subscribed */}
            {isSubscribed && hasCallPackages && (
              <div className="flex justify-center">
                <button
                  onClick={() => setShowBookCall(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-pnp-textPrimary border border-white/15 bg-white/5 hover:bg-white/10 active:scale-[0.98] transition-all min-h-[44px]"
                >
                  <PhoneCall size={14} aria-hidden="true" />
                  Book a Call
                </button>
              </div>
            )}
          </div>

          {/* ── Media grid ────────────────────────────────────────────────── */}
          <section aria-label="Creator content">
            {media.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <p className="text-pnp-textSecondary text-sm font-medium">No content yet</p>
                <p className="text-xs text-pnp-textSecondary/60">
                  Check back later for photos and videos.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {media.map((item) => (
                  <MediaTile
                    key={item.id}
                    item={item}
                    isSubscribed={isSubscribed}
                    onOpenLightbox={setLightboxItem}
                    onSubscribeCta={handleSubscribeCta}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* ── Lightbox ────────────────────────────────────────────────────────── */}
      {lightboxItem && (
        <Lightbox
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
        />
      )}

      {/* ── Book a Call modal ────────────────────────────────────────────── */}
      {showBookCall && (
        <BookCallModal
          creator={bookCallCreator}
          isOnline={false}
          open={showBookCall}
          onClose={() => setShowBookCall(false)}
        />
      )}
    </>
  );
}
