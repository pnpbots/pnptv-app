import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
}

export function Card({ children, className = "", onClick, hover = false }: CardProps) {
  const interactive = onClick || hover;
  return (
    <div
      className={`rounded-xl bg-pnp-surface border border-pnp-border p-4 ${interactive ? "cursor-pointer hover:bg-pnp-surfaceHover hover:border-pnp-accent/30 transition-all duration-200" : ""} ${className}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      {children}
    </div>
  );
}
