import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Set to false if the modal should not dismiss on backdrop click. */
  dismissOnBackdrop?: boolean;
  /** Set to false to disable Escape-key close. */
  dismissOnEscape?: boolean;
  /** Tailwind classes for the inner panel. */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * Accessible modal primitive: role=dialog + aria-modal, focus trap, Escape,
 * backdrop-click dismiss, locks body scroll while open. Use for any overlay
 * that requires keyboard accessibility. For confirm-style prompts use
 * ConfirmDialog instead — it composes Modal.
 */
export function Modal({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  panelClassName = "",
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismissOnEscape, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`relative ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
