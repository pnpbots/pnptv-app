import React, { useCallback, useEffect, useState } from "react";

/**
 * Shown to every user when a new app version is available.
 * Non-dismissible — user must tap "Update now" to continue.
 */
export function UpdateAvailableModal() {
  const [pending, setPending] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const onUpdateAvailable = () => setPending(true);
    window.addEventListener("pnptv:update-available", onUpdateAvailable);
    return () => window.removeEventListener("pnptv:update-available", onUpdateAvailable);
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
          window.location.reload();
        }
      })
      .catch(() => window.location.reload());
    // Safety net: force reload if controllerchange doesn't fire within 8s.
    setTimeout(() => window.location.reload(), 8_000);
  }, []);

  if (!pending) return null;

  return (
    <>
      {/* Backdrop — blocks interaction with stale UI */}
      <div className="fixed inset-0 z-[9993] bg-black/60 backdrop-blur-sm" />

      {/* Prompt card */}
      <div
        className="fixed inset-x-0 bottom-0 z-[9994] flex flex-col items-center"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-title"
        aria-describedby="update-desc"
      >
        <div
          className="w-full max-w-sm mx-4 mb-6 rounded-2xl shadow-2xl overflow-hidden"
          style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          {/* Gradient bar at top */}
          <div
            className="h-1 w-full"
            style={{ background: "linear-gradient(90deg, #D4007A, #7B61FF, #5BB8F5)" }}
          />

          <div className="px-5 py-5">
            <div className="flex items-start gap-3 mb-4">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #D4007A, #7B61FF)" }}
              >
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2zM19 14l.8 2.7L22 17l-2.2.7L19 20l-.8-2.7L16 17l2.2-.7L19 14zM5 14l.6 2L7 16.5l-1.6.5L5 19l-.6-2L3 16.5l1.6-.5L5 14z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p id="update-title" className="text-base font-bold text-white leading-tight">
                  New version available
                </p>
                <p id="update-desc" className="text-sm text-white/60 mt-0.5 leading-snug">
                  PNPtv! has been updated with new features and fixes. Tap below to reload — it only takes a second.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleUpdate}
              disabled={updating}
              className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
              style={{
                background: updating
                  ? "rgba(212,0,122,0.4)"
                  : "linear-gradient(135deg, #D4007A, #7B61FF)",
              }}
            >
              {updating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Updating…
                </span>
              ) : (
                "Update now"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default UpdateAvailableModal;
