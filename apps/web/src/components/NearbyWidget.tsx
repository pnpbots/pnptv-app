import React, { useState } from "react";

// ============================================================================
// Post context
// ============================================================================

interface NearbyWidgetPostProps {
  context: "post";
  authorCity?: string | null;
  authorCountry?: string | null;
  userCity?: string | null;
  userCountry?: string | null;
  isCreator?: boolean;
  authorName?: string;
}

function PostBadge({
  authorCity,
  authorCountry,
  userCity,
  userCountry,
  isCreator,
  authorName: _authorName,
}: Omit<NearbyWidgetPostProps, "context">) {
  // No location data on author — render nothing
  if (!authorCity && !authorCountry) return null;

  const sameCity =
    userCity &&
    authorCity &&
    userCity.trim().toLowerCase() === authorCity.trim().toLowerCase();

  const sameCountry =
    userCountry &&
    authorCountry &&
    userCountry.trim().toLowerCase() === authorCountry.trim().toLowerCase();

  if (sameCity) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0"
        style={{ background: "rgba(94,209,196,0.18)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.35)" }}
      >
        📍 Same city
      </span>
    );
  }

  if (sameCountry) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0"
        style={{ background: "rgba(94,209,196,0.10)", color: "#5ED1C4CC", border: "1px solid rgba(94,209,196,0.22)" }}
      >
        🌎 Same country
      </span>
    );
  }

  // Not nearby — for creators, show warm city badge; for regular users, nothing
  if (isCreator && authorCity) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0"
        style={{ background: "rgba(212,0,122,0.12)", color: "#E69138", border: "1px solid rgba(230,145,56,0.28)" }}
      >
        ✨ {authorCity}
      </span>
    );
  }

  return null;
}

// ============================================================================
// Hangout context
// ============================================================================

interface HangoutMember {
  userId: string;
  name: string;
  city?: string | null;
  country?: string | null;
}

interface NearbyWidgetHangoutProps {
  context: "hangout";
  members: HangoutMember[];
  userCity?: string | null;
  userCountry?: string | null;
  onExpandMap?: () => void;
}

function HangoutPanel({
  members,
  userCity,
  userCountry,
  onExpandMap,
}: Omit<NearbyWidgetHangoutProps, "context">) {
  const [expanded, setExpanded] = useState(false);

  const sameCityMembers = members.filter(
    (m) =>
      m.city &&
      userCity &&
      m.city.trim().toLowerCase() === userCity.trim().toLowerCase()
  );

  const sameCountryMembers = members.filter(
    (m) =>
      !sameCityMembers.find((sc) => sc.userId === m.userId) &&
      m.country &&
      userCountry &&
      m.country.trim().toLowerCase() === userCountry.trim().toLowerCase()
  );

  const nearbyCount = sameCityMembers.length + sameCountryMembers.length;

  if (nearbyCount === 0) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-white/5"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: "#5ED1C4" }}>📍</span>
          <span className="text-xs font-semibold" style={{ color: "#5ED1C4" }}>
            {nearbyCount === 1
              ? "1 member nearby"
              : `${nearbyCount} members nearby`}
          </span>
        </div>
        <svg
          className="w-4 h-4 transition-transform"
          style={{ color: "#8E8E93", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {sameCityMembers.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider mt-1" style={{ color: "#8E8E93" }}>
                Your city
              </p>
              {sameCityMembers.map((m) => (
                <div key={m.userId} className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "#5ED1C4" }}
                  />
                  <span className="text-xs text-white truncate">{m.name}</span>
                  <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "#5ED1C4" }}>
                    {m.city}
                  </span>
                </div>
              ))}
            </>
          )}
          {sameCountryMembers.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider mt-2" style={{ color: "#8E8E93" }}>
                Your country
              </p>
              {sameCountryMembers.map((m) => (
                <div key={m.userId} className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "rgba(94,209,196,0.5)" }}
                  />
                  <span className="text-xs text-white truncate">{m.name}</span>
                  <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "#8E8E93" }}>
                    {m.city || m.country}
                  </span>
                </div>
              ))}
            </>
          )}
          {onExpandMap && (
            <button
              onClick={onExpandMap}
              className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all active:scale-95"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              View on Map
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Creator context
// ============================================================================

interface NearbyWidgetCreatorProps {
  context: "creator";
  creatorCity?: string | null;
  creatorCountry?: string | null;
  userCity?: string | null;
  userCountry?: string | null;
  creatorName?: string;
  onExpandMap?: () => void;
}

function CreatorLocationBadge({
  creatorCity,
  creatorCountry,
  userCity,
  userCountry,
  onExpandMap,
}: Omit<NearbyWidgetCreatorProps, "context">) {
  const sameCity =
    userCity &&
    creatorCity &&
    userCity.trim().toLowerCase() === creatorCity.trim().toLowerCase();

  const sameCountry =
    userCountry &&
    creatorCountry &&
    userCountry.trim().toLowerCase() === creatorCountry.trim().toLowerCase();

  let label: string;
  let glowColor: string;

  if (sameCity && creatorCity) {
    label = `📍 Right here in ${creatorCity}!`;
    glowColor = "#5ED1C4";
  } else if (sameCountry && creatorCountry) {
    label = `🏳️‍🌈 Representing ${creatorCountry}`;
    glowColor = "#D4007A";
  } else if (creatorCity) {
    label = `🌟 Broadcasting from ${creatorCity}`;
    glowColor = "#E69138";
  } else if (creatorCountry) {
    label = `✨ Connecting from ${creatorCountry}`;
    glowColor = "#E69138";
  } else {
    // No location data at all
    return null;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
        style={{
          background: `${glowColor}18`,
          color: glowColor,
          border: `1px solid ${glowColor}40`,
          boxShadow: sameCity ? `0 0 8px ${glowColor}30` : undefined,
        }}
      >
        {label}
      </span>
      {onExpandMap && (
        <button
          onClick={onExpandMap}
          className="inline-flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-80"
          style={{ color: "#8E8E93" }}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Map
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Unified export
// ============================================================================

type NearbyWidgetProps =
  | NearbyWidgetPostProps
  | NearbyWidgetHangoutProps
  | NearbyWidgetCreatorProps;

export function NearbyWidget(props: NearbyWidgetProps) {
  if (props.context === "post") {
    return <PostBadge {...props} />;
  }
  if (props.context === "hangout") {
    return <HangoutPanel {...props} />;
  }
  if (props.context === "creator") {
    return <CreatorLocationBadge {...props} />;
  }
  return null;
}
