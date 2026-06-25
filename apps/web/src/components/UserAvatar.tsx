import React from "react";
import { Link } from "react-router-dom";
import { usePresence } from "@/hooks/usePresence";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface Props {
  userId: string | number | null | undefined;
  photoUrl?: string | null;
  displayName?: string | null;
  size?: AvatarSize;
  showOnline?: boolean;
  linkToProfile?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

const DOT_PX: Record<AvatarSize, number> = {
  xs: 7,
  sm: 9,
  md: 11,
  lg: 13,
  xl: 16,
};

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/") || photo.startsWith("http"));
}

export function UserAvatar({
  userId,
  photoUrl,
  displayName,
  size = "md",
  showOnline = true,
  linkToProfile = true,
  className = "",
  onClick,
}: Props) {
  const id = userId != null ? String(userId) : "";
  const online = usePresence(showOnline ? id : null);
  const px = SIZE_PX[size];
  const dot = DOT_PX[size];
  const initial = (displayName || "?").trim().charAt(0).toUpperCase() || "?";

  const img = isValidPhotoUrl(photoUrl) ? (
    <img
      src={photoUrl}
      alt={displayName || "User"}
      loading="lazy"
      className="w-full h-full rounded-full object-cover"
      onError={(e) => {
        const el = e.currentTarget;
        el.style.display = "none";
        const sib = el.nextElementSibling as HTMLElement | null;
        if (sib) sib.style.display = "flex";
      }}
    />
  ) : null;

  const inner = (
    <span
      className={`relative inline-block flex-shrink-0 ${className}`}
      style={{ width: px, height: px }}
    >
      {img}
      <span
        className="absolute inset-0 rounded-full flex items-center justify-center font-bold text-white select-none"
        style={{
          background: "linear-gradient(135deg, #5ED1C4, #D4007A)",
          fontSize: Math.max(10, Math.floor(px * 0.42)),
          display: img ? "none" : "flex",
        }}
      >
        {initial}
      </span>
      {showOnline && online && id && (
        <span
          aria-label="Online"
          title="Online"
          className="absolute rounded-full ring-2"
          style={{
            width: dot,
            height: dot,
            right: 0,
            bottom: 0,
            background: "#30D158",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
            // @ts-expect-error CSS var
            "--tw-ring-color": "rgba(15,15,15,0.95)",
          }}
        />
      )}
    </span>
  );

  if (linkToProfile && id) {
    return (
      <Link
        to={`/profile/${id}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        className="inline-block flex-shrink-0 hover:opacity-90 active:scale-95 transition-all"
        aria-label={`Open profile of ${displayName || id}`}
      >
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="inline-block flex-shrink-0">
        {inner}
      </button>
    );
  }

  return inner;
}
