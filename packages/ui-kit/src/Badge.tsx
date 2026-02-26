import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "error" | "warning" | "accent";
  className?: string;
}

const variants = {
  default: "bg-pnp-surface text-pnp-textSecondary",
  success: "badge-gradient badge-gradient-text",
  error: "bg-pnp-error/20 text-pnp-error",
  warning: "bg-pnp-warning/20 text-pnp-warning",
  accent: "badge-gradient badge-gradient-text",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
