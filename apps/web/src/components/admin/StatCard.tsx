import React from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  subtitle?: string;
}

const variantColors: Record<string, string> = {
  default: "border-pnp-border",
  success: "border-green-500/40",
  warning: "border-yellow-500/40",
  danger: "border-red-500/40",
};

export function StatCard({ label, value, icon, variant = "default", subtitle }: StatCardProps) {
  return (
    <div className={`rounded-xl bg-pnp-surface border ${variantColors[variant]} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-pnp-textSecondary uppercase tracking-wider">{label}</span>
        {icon && <span className="text-pnp-textSecondary">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-pnp-textPrimary">{value}</div>
      {subtitle && <div className="text-xs text-pnp-textSecondary mt-1">{subtitle}</div>}
    </div>
  );
}
