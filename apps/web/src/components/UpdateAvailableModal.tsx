import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

const REALTIME_SESSION_KEY = "pnptv:active-realtime-session";

function hasActiveRealtimeSession(): boolean {
  try {
    return !!sessionStorage.getItem(REALTIME_SESSION_KEY);
  } catch {
    return false;
  }
}

const SparklesIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2zM19 14l.8 2.7L22 17l-2.2.7L19 20l-.8-2.7L16 17l2.2-.7L19 14zM5 14l.6 2L7 16.5l-1.6.5L5 19l-.6-2L3 16.5l1.6-.5L5 14z" />
  </svg>
);

/**
 * Listens for the `pnptv:update-available` event dispatched from main.tsx
 * when a new service worker reaches the "installed" state.
 *
 * When realtime session is active → shows a small bottom toast (non-blocking).
 * Otherwise → shows a full-screen non-dismissible modal with a single
 * "Update now" button that triggers SKIP_WAITING → controllerchange → reload.
 */
export function UpdateAvailableModal() {
  const t = useI18n();
  const [pending, setPending] = useState(false);
  const [realtimeActive, setRealtimeActive] = useState<boolean>(hasActiveRealtimeSession());
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const onUpdateAvailable = () => setPending(true);
    const onRealtimeChange = () => setRealtimeActive(hasActiveRealtimeSession());

    window.addEventListener("pnptv:update-available", onUpdateAvailable);
    window.addEventListener("pnptv:realtime-session-change", onRealtimeChange);
    return () => {
      window.removeEventListener("pnptv:update-available", onUpdateAvailable);
      window.removeEventListener("pnptv:realtime-session-change", onRealtimeChange);
    };
  }, []);

  const handleUpdate = useCallback(() => {
    setUpdating(true);
    if (!("serviceWorker" in navigator)) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        } else {
          // No waiting worker — fall back to a hard reload.
          window.location.reload();
        }
      })
      .catch(() => {
        window.location.reload();
      });
    // Safety net: if controllerchange doesn't fire within 8s, force reload.
    setTimeout(() => window.location.reload(), 8_000);
  }, []);

  if (!pending) return null;

  // Realtime session active → small bottom toast, non-blocking. It promotes
  // to the full modal automatically when realtimeActive flips to false
  // (the effect above already re-renders).
  if (realtimeActive) {
    return (
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9994] w-[calc(100%-2rem)] max-w-sm animate-fade-in-up"
        role="status"
        aria-live="polite"
      >
        <div className="bg-[#1C1C1E] border border-white/15 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
          <span
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <SparklesIcon className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {t.notifications.updateToastTitle}
            </p>
            <p className="text-xs text-pnp-textSecondary truncate">
              {t.notifications.updateToastBody}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Full-screen non-dismissible modal. No close button, no backdrop dismiss.
  return (
    <div
      className="fixed inset-0 z-[9995] flex items-center justify-center bg-black/80 backdrop-blur-md px-4 animate-fade-in-up"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
      aria-describedby="update-modal-desc"
    >
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-5 bg-pnp-surface border border-white/10 shadow-2xl text-center">
        <div className="flex justify-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <SparklesIcon className="w-8 h-8" />
          </div>
        </div>

        <div>
          <h2 id="update-modal-title" className="text-lg font-bold text-pnp-textPrimary">
            {t.notifications.updateModalTitle}
          </h2>
          <p id="update-modal-desc" className="text-sm mt-2 text-pnp-textSecondary">
            {t.notifications.updateModalDescription}
          </p>
        </div>

        <button
          type="button"
          onClick={handleUpdate}
          disabled={updating}
          autoFocus
          className="w-full py-3 rounded-xl btn-gradient text-white font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
        >
          {updating ? t.notifications.updateModalUpdating : t.notifications.updateModalButton}
        </button>
      </div>
    </div>
  );
}

export default UpdateAvailableModal;
