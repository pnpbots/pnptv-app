import React from "react";

// ─── Shared badge variant maps ──────────────────────────────────────────────

export const TIER_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  PRIME: "accent",
  prime: "accent",
  member: "success",
  creator: "warning",
  free: "default",
  banned: "error",
};

export const STATUS_BADGE_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  active: "success",
  completed: "success",
  expired: "warning",
  pending: "warning",
  cancelled: "error",
  churned: "error",
  failed: "error",
  free: "default",
  refunded: "default",
};

// ─── Date formatting helpers ────────────────────────────────────────────────

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Avatar with initials fallback ──────────────────────────────────────────

export function AvatarInitial({
  name,
  size = "sm",
  src,
}: {
  name: string;
  size?: "sm" | "md";
  src?: string | null;
}) {
  const char = (name || "?")[0].toUpperCase();
  const sizeClass = size === "md"
    ? "w-10 h-10 text-sm"
    : "w-7 h-7 text-xs";

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`}
      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
    >
      {char}
    </div>
  );
}
