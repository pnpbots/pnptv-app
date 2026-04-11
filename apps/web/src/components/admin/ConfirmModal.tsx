import React, { useEffect } from "react";
import { useI18n } from "@/lib/i18n";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const variantStyles: Record<string, string> = {
  danger: "bg-red-600 hover:bg-red-700 text-white",
  warning: "bg-yellow-600 hover:bg-yellow-700 text-white",
  default: "bg-pnp-accent hover:bg-pnp-accent/80 text-white",
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  onCancel,
  loading,
}: ConfirmModalProps) {
  const t = useI18n().admin;
  const resolvedConfirmLabel = confirmLabel ?? t.shared.confirm;
  const resolvedCancelLabel = cancelLabel ?? t.shared.cancel;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(4px)" }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fixed inset-0 bg-black/60" />
      <div
        className="relative bg-pnp-background border border-pnp-border rounded-xl p-6 max-w-md w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-pnp-textPrimary mb-2">{title}</h3>
        <p className="text-sm text-pnp-textSecondary mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface disabled:opacity-50"
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-50 ${variantStyles[variant]}`}
          >
            {loading ? t.shared.processing : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
