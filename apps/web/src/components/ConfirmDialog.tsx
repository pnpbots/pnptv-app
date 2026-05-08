import { useId } from "react";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const variantClasses: Record<NonNullable<ConfirmDialogProps["variant"]>, string> = {
  danger: "bg-red-600 hover:bg-red-700 text-white",
  warning: "bg-yellow-600 hover:bg-yellow-700 text-white",
  default: "bg-pnp-accent hover:bg-pnp-accent/80 text-white",
};

/**
 * Accessible confirmation dialog. Replacement for window.confirm() — does NOT
 * block the main thread, works inside Telegram WebView, fully keyboard
 * accessible (focus-trap + Escape).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      ariaLabelledBy={titleId}
      panelClassName="bg-pnp-background border border-pnp-border rounded-xl p-6 max-w-md w-full shadow-xl"
    >
      <h3 id={titleId} className="text-lg font-bold text-pnp-textPrimary mb-2">
        {title}
      </h3>
      {message && (
        <p className="text-sm text-pnp-textSecondary mb-6">{message}</p>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 min-h-[44px] text-sm rounded-lg border border-pnp-border text-pnp-textSecondary hover:bg-pnp-surface disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:outline-none"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`px-4 py-2 min-h-[44px] text-sm rounded-lg font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:outline-none ${variantClasses[variant]}`}
        >
          {loading ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
