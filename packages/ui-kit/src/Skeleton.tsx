import React from "react";

export interface SkeletonProps {
  className?: string;
  lines?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ className = "", lines = 1, style }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-4 rounded bg-pnp-surface animate-pulse"
            style={{ width: i === lines - 1 ? "60%" : "100%" }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className={`h-4 rounded bg-pnp-surface animate-pulse ${className}`} style={style} />
  );
}
