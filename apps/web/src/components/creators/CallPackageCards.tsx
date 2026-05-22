/**
 * CallPackageCards — promotional cards for the two fixed call packages.
 *
 * Displayed below the performer grid on the Live page.  Clicking "Book Now"
 * on a card opens BookCallModal with the duration pre-selected, skipping the
 * SELECT_PACKAGE step entirely.  If a specific performer is not yet chosen
 * the modal opens to SELECT_MODEL first.
 */

import React, { useState } from "react";
import clsx from "clsx";
import { BookCallModal } from "./BookCallModal";
import type { FeaturedPerformer } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CallPackageCardsProps {
  /** Full list of available performers to let the user pick from. */
  performers: FeaturedPerformer[];
  /** Optional: pre-select a specific performer (e.g. from a performer card). */
  preselectedPerformer?: FeaturedPerformer | null;
  className?: string;
}

/** Visual-only config (no translatable strings). */
interface PackageVisuals {
  duration: 30 | 60;
  price: number;
  gradientStyle: React.CSSProperties;
  /** Tailwind text color class for price */
  priceColorClass: string;
  /** Hex color for SVG fill/stroke (CheckIcon) */
  priceColorHex: string;
}

/** Full config including translated strings — resolved at render time. */
interface PackageConfig extends PackageVisuals {
  name: string;
  tagline: string;
  bullets: string[];
  badge: string | null;
  durationLabel: string;
  bookNowLabel: string;
  bookNowAriaLabel: string;
}

// ─── Visual-only package definitions (no strings) ────────────────────────────

const PACKAGE_VISUALS: PackageVisuals[] = [
  {
    duration: 30,
    price: 60,
    gradientStyle: {
      background: "linear-gradient(145deg, rgba(212,0,122,0.22) 0%, rgba(230,145,56,0.14) 100%)",
      border: "1px solid rgba(212,0,122,0.30)",
    },
    priceColorClass: "text-pnp-accent",
    priceColorHex: "#D4007A",
  },
  {
    duration: 60,
    price: 100,
    gradientStyle: {
      background: "linear-gradient(145deg, rgba(139,92,246,0.22) 0%, rgba(59,130,246,0.14) 100%)",
      border: "1px solid rgba(139,92,246,0.30)",
    },
    priceColorClass: "text-pnp-purple",
    priceColorHex: "#A78BFA",
  },
];

// ─── CheckIcon ────────────────────────────────────────────────────────────────

function CheckIcon({ colorHex }: { colorHex: string }) {
  return (
    <svg
      className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" fill={colorHex} fillOpacity={0.18} />
      <path
        d="M5 8l2 2 4-4"
        stroke={colorHex}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Single card ──────────────────────────────────────────────────────────────

interface PackageCardProps {
  pkg: PackageConfig;
  onBookNow: () => void;
}

function PackageCard({ pkg, onBookNow }: PackageCardProps) {
  return (
    <div
      className={clsx(
        "relative flex flex-col rounded-2xl p-5 overflow-hidden",
        "transition-transform duration-150 active:scale-[0.99]"
      )}
      style={pkg.gradientStyle}
    >
      {/* Badge */}
      {pkg.badge && (
        <span className="absolute top-3.5 right-3.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase whitespace-nowrap text-white badge-gradient">
          {pkg.badge}
        </span>
      )}

      {/* Duration pill */}
      <span className="self-start px-2.5 py-0.5 rounded-full text-[11px] font-semibold mb-3 bg-white/[0.09] text-pnp-textSecondary">
        {pkg.durationLabel}
      </span>

      {/* Price */}
      <p
        className={clsx(
          "text-4xl font-extrabold leading-none mb-1",
          pkg.priceColorClass
        )}
      >
        ${pkg.price}
        <span className="text-base font-medium ml-1 text-pnp-textSecondary opacity-60">
          USD
        </span>
      </p>

      {/* Name + tagline */}
      <p className="text-sm font-bold mt-2 text-pnp-textPrimary">
        {pkg.name}
      </p>
      <p className="text-xs mt-0.5 mb-4 text-pnp-textSecondary">
        {pkg.tagline}
      </p>

      {/* Bullets */}
      <ul className="space-y-1.5 mb-5">
        {pkg.bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2">
            <CheckIcon colorHex={pkg.priceColorHex} />
            <span className="text-xs text-pnp-textSecondary">
              {bullet}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        type="button"
        onClick={onBookNow}
        aria-label={pkg.bookNowAriaLabel}
        className={clsx(
          "w-full min-h-[56px] rounded-xl text-base font-bold text-white",
          "flex items-center justify-center gap-2",
          "transition-all duration-150 active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-background",
          pkg.duration === 30
            ? "focus-visible:ring-pnp-accent"
            : "focus-visible:ring-pnp-purple",
          "hover:brightness-110"
        )}
        style={{
          background:
            pkg.duration === 30
              ? "linear-gradient(90deg, #D4007A, #E69138)"
              : "linear-gradient(90deg, #7C3AED, #3B82F6)",
          boxShadow:
            pkg.duration === 30
              ? "0 4px 18px rgba(212,0,122,0.30)"
              : "0 4px 18px rgba(124,58,237,0.30)",
        }}
      >
        <svg
          style={{ width: 18, height: 18, flexShrink: 0 }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
        </svg>
        {pkg.bookNowLabel}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CallPackageCards({
  performers,
  preselectedPerformer = null,
  className,
}: CallPackageCardsProps) {
  const t = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<30 | 60>(30);
  const [selectedPerformer, setSelectedPerformer] = useState<FeaturedPerformer | null>(null);

  // Translated package data (resolved here where the hook is available)
  const PACKAGES: PackageConfig[] = [
    {
      ...PACKAGE_VISUALS[0],
      name: t.creator.pkg30Name,
      tagline: t.creator.pkg30Tagline,
      bullets: [t.creator.pkg30Bullet1, t.creator.pkg30Bullet2, t.creator.pkg30Bullet3],
      badge: t.creator.mostPopularBadge,
      durationLabel: t.creator.durationPill(30),
      bookNowLabel: t.creator.bookNowBtn,
      bookNowAriaLabel: t.creator.bookNowAriaLabel(t.creator.pkg30Name, 30, PACKAGE_VISUALS[0].price),
    },
    {
      ...PACKAGE_VISUALS[1],
      name: t.creator.pkg60Name,
      tagline: t.creator.pkg60Tagline,
      bullets: [t.creator.pkg60Bullet1, t.creator.pkg60Bullet2, t.creator.pkg60Bullet3],
      badge: null,
      durationLabel: t.creator.durationPill(60),
      bookNowLabel: t.creator.bookNowBtn,
      bookNowAriaLabel: t.creator.bookNowAriaLabel(t.creator.pkg60Name, 60, PACKAGE_VISUALS[1].price),
    },
  ];

  const handleBookNow = (duration: 30 | 60) => {
    setSelectedDuration(duration);
    // Use the preselected performer if provided, otherwise null = SELECT_MODEL step
    setSelectedPerformer(preselectedPerformer ?? null);
    setModalOpen(true);
  };

  const handleClose = () => {
    setModalOpen(false);
    setSelectedPerformer(null);
  };

  // Convert FeaturedPerformer to CreatorCardCreator shape for the modal
  const creatorForModal = selectedPerformer
    ? {
        id: selectedPerformer.userId ?? selectedPerformer.id,
        username: selectedPerformer.displayName,
        photo_url: selectedPerformer.photoUrl,
        creator_type: "full_time" as const,
        creator_price_usd: selectedPerformer.basePrice ?? 60,
        bio: selectedPerformer.bio,
      }
    : null;

  return (
    <div className={clsx("", className)}>
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.22), rgba(230,145,56,0.14))", border: "1px solid rgba(212,0,122,0.28)" }}
        >
          <svg
            className="w-4 h-4"
            style={{ color: "#D4007A" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold" style={{ color: "#EBEBF5" }}>
            {t.creator.bookPrivateSession}
          </h2>
          <p className="text-[11px]" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Private 1-on-1 video call
          </p>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PACKAGES.map((pkg) => (
          <PackageCard
            key={pkg.duration}
            pkg={pkg}
            onBookNow={() => handleBookNow(pkg.duration)}
          />
        ))}
      </div>

      {/* Modal — only render when a performer has been selected */}
      {modalOpen && creatorForModal && (
        <BookCallModal
          creator={creatorForModal}
          isOnline={selectedPerformer?.isLive === true}
          open={modalOpen}
          onClose={handleClose}
          initialDuration={selectedDuration}
          skipPackageStep
        />
      )}

      {/* Modal — SELECT_MODEL step when no performer preselected */}
      {modalOpen && !creatorForModal && (
        <BookCallModal
          creator={{
            id: "",
            username: "",
            photo_url: null,
            creator_type: "full_time",
            creator_price_usd: selectedDuration === 30 ? 60 : 100,
          }}
          isOnline={false}
          open={modalOpen}
          onClose={handleClose}
          initialDuration={selectedDuration}
          skipPackageStep
          performers={performers}
        />
      )}
    </div>
  );
}
