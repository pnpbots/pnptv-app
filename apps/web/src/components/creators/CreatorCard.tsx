/**
 * CreatorCard — compact dark glass card for a creator profile.
 *
 * Shows avatar, username, creator type badge, online indicator, and a
 * "Book a Call" gradient button.  Clicking the card or button opens
 * <BookCallModal>.
 */

import React, { useState } from "react";
import clsx from "clsx";
import { BookCallModal } from "./BookCallModal";
import { isCreatorPayLocked } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatorType =
  | "ice"
  | "crystal"
  | "diamond"
  | "occasional"
  | "full_time";

export interface CreatorCardCreator {
  id: string;
  username: string;
  photo_url: string | null;
  creator_type: CreatorType;
  creator_price_usd: number;
  bio?: string | null;
}

export interface CreatorCardProps {
  creator: CreatorCardCreator;
  isOnline?: boolean;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CREATOR_TYPE_LABELS: Record<CreatorType, string> = {
  ice: "Ice",
  crystal: "Crystal",
  diamond: "Diamond",
  occasional: "Occasional",
  full_time: "Full Time",
};

function CreatorTypeBadge({ type }: { type: CreatorType }) {
  if (type === "full_time") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
        style={{
          background: "linear-gradient(90deg, #D4007A, #E69138)",
          color: "#fff",
        }}
      >
        Full Time
      </span>
    );
  }

  const colorMap: Record<Exclude<CreatorType, "full_time">, React.CSSProperties> = {
    ice: { background: "rgba(59,130,246,0.18)", color: "#60A5FA" },
    crystal: { background: "rgba(6,182,212,0.18)", color: "#22D3EE" },
    diamond: { background: "rgba(139,92,246,0.18)", color: "#A78BFA" },
    occasional: { background: "rgba(156,163,175,0.18)", color: "#9CA3AF" },
  };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
      style={colorMap[type as Exclude<CreatorType, "full_time">]}
    >
      {CREATOR_TYPE_LABELS[type]}
    </span>
  );
}

function AvatarFallback({ username }: { username: string }) {
  const initials = username.slice(0, 2).toUpperCase();
  return (
    <div
      className="w-full h-full flex items-center justify-center text-xl font-bold text-white btn-gradient"
    >
      {initials}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreatorCard({
  creator,
  isOnline = false,
  className,
}: CreatorCardProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      {/* Card */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`View ${creator.username}'s booking options`}
        onClick={() => setModalOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setModalOpen(true);
          }
        }}
        className={clsx(
          "relative flex flex-col rounded-2xl overflow-hidden",
          "cursor-pointer select-none",
          "transition-transform duration-150 active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          className
        )}
        style={{
          background: "rgba(28,28,30,0.80)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {/* Avatar section */}
        <div className="relative w-full aspect-square overflow-hidden">
          {creator.photo_url ? (
            <img
              src={creator.photo_url}
              alt={`${creator.username} avatar`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <AvatarFallback username={creator.username} />
          )}

          {/* Online indicator — top-right corner */}
          <div className="absolute top-2.5 right-2.5">
            {isOnline ? (
              <span className="relative flex h-3 w-3">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ background: "#34C759" }}
                />
                <span
                  className="relative inline-flex rounded-full h-3 w-3"
                  style={{ background: "#34C759" }}
                />
              </span>
            ) : (
              <span
                className="inline-flex h-3 w-3 rounded-full"
                style={{ background: "#636366" }}
              />
            )}
          </div>
        </div>

        {/* Info section */}
        <div className="flex flex-col gap-2 p-3">
          {/* Name + badge row */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-sm font-semibold truncate"
              style={{ color: "#EBEBF5" }}
            >
              @{creator.username}
            </span>
          </div>

          <CreatorTypeBadge type={creator.creator_type} />

          {/* Bio */}
          {creator.bio && (
            <p
              className="text-xs leading-relaxed line-clamp-2"
              style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
            >
              {creator.bio}
            </p>
          )}

          {/* Price */}
          <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            From{" "}
            <span className="font-semibold" style={{ color: "#EBEBF5" }}>
              ${creator.creator_price_usd}/30 min
            </span>
          </p>

          {/* Book a Call button */}
          {isCreatorPayLocked(creator.username) ? (
            <button
              type="button"
              disabled
              className="mt-1 w-full min-h-[52px] rounded-xl text-base font-bold flex items-center justify-center opacity-50 cursor-not-allowed bg-white/5 border border-white/10 text-pnp-textSecondary"
            >
              🔒 Launches June 1st
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Book a call with ${creator.username}`}
              onClick={(e) => {
                e.stopPropagation();
                setModalOpen(true);
              }}
              className={clsx(
                "mt-1 w-full min-h-[52px] rounded-xl text-base font-bold text-white",
                "flex items-center justify-center gap-2",
                "transition-all duration-150 active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                isOnline ? "opacity-100 animate-pulse-subtle" : "opacity-90 hover:opacity-100 hover:brightness-110"
              )}
              style={{
                background: isOnline
                  ? "linear-gradient(90deg, #34C759, #00C49A)"
                  : "linear-gradient(90deg, #D4007A, #E69138)",
                boxShadow: isOnline
                  ? "0 0 16px rgba(52,199,89,0.35)"
                  : "0 0 12px rgba(212,0,122,0.25)",
              }}
            >
              <svg
                className="w-4.5 h-4.5 flex-shrink-0"
                style={{ width: 18, height: 18 }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                {isOnline ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                )}
              </svg>
              {isOnline ? "Call Now" : "Book a Call"}
            </button>
          )}
        </div>
      </div>

      {/* Booking modal */}
      <BookCallModal
        creator={creator}
        isOnline={isOnline}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
