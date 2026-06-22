import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { subscribeToPush } from "@/lib/pushNotifications";
import { shouldShowInstallPill } from "./InstallPill";
import { useExternalPathname, isExcludedFromFloatingUI } from "@/hooks/useExternalPathname";

const DISMISS_KEY = "pnptv:push-pill-dismissed";
const DISMISS_FOREVER_KEY = "pnptv:push-pill-dismissed-forever";
const DISMISS_DAYS = 7;
const MOUNT_DELAY_MS = 60_000;

function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

function isDismissed(): boolean {
  try {
    if (localStorage.getItem(DISMISS_FOREVER_KEY)) return true;
    const until = localStorage.getItem(DISMISS_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  } catch {
    return false;
  }
}

function setDismissed(days: number) {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
  } catch {
    /* ignore */
  }
}

function setDismissedForever() {
  try {
    localStorage.setItem(DISMISS_FOREVER_KEY, "1");
  } catch {
    /* ignore */
  }
}

const BellIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const XIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 13l4 4L19 7" />
  </svg>
);

type State = "idle" | "asking" | "granted" | "blocked";

export function PushNotificationPill() {
  const t = useI18n();
  const pathname = useExternalPathname();
  const [eligibleAt, setEligibleAt] = useState<number | null>(null);
  const [installPillActive, setInstallPillActive] = useState<boolean>(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [tick, setTick] = useState(0); // forces re-eval when storage changes
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount timer: only become eligible after MOUNT_DELAY_MS on the app.
  useEffect(() => {
    if (!isPushSupported()) return;
    if (typeof Notification !== "undefined" && Notification.permission !== "default") return;
    const id = setTimeout(() => setEligibleAt(Date.now()), MOUNT_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  // Re-evaluate InstallPill precedence periodically (its state may flip when
  // beforeinstallprompt fires after this component mounts).
  useEffect(() => {
    const evalNow = () => setInstallPillActive(shouldShowInstallPill());
    evalNow();
    const id = setInterval(evalNow, 2_000);
    return () => clearInterval(id);
  }, [tick]);

  // Re-evaluate when window regains focus (user may have changed perms).
  useEffect(() => {
    const onVis = () => setTick((n) => n + 1);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const canRender = (() => {
    if (isExcludedFromFloatingUI(pathname)) return false;
    if (!isPushSupported()) return false;
    if (typeof Notification === "undefined") return false;
    if (Notification.permission !== "default") return false;
    if (isDismissed()) return false;
    if (eligibleAt === null) return false;
    if (installPillActive) return false;
    return true;
  })();

  const handlePillClick = useCallback(() => {
    setState("idle");
    setOpen(true);
  }, []);

  const handlePillDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDismissed(DISMISS_DAYS);
      setTick((n) => n + 1);
    },
    []
  );

  const handleEnable = useCallback(async () => {
    setState("asking");
    try {
      const ok = await subscribeToPush();
      if (ok) {
        setState("granted");
        setDismissedForever();
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
          setOpen(false);
          setTick((n) => n + 1);
        }, 1500);
      } else {
        // Denied — Notification.permission flipped to "denied" or user closed prompt
        if (typeof Notification !== "undefined" && Notification.permission === "denied") {
          setState("blocked");
        } else {
          setDismissed(DISMISS_DAYS);
          setOpen(false);
          setTick((n) => n + 1);
        }
      }
    } catch {
      setDismissed(DISMISS_DAYS);
      setOpen(false);
      setTick((n) => n + 1);
    }
  }, []);

  const handleSheetMaybeLater = useCallback(() => {
    setDismissed(DISMISS_DAYS);
    setOpen(false);
    setTick((n) => n + 1);
  }, []);

  const handleBlockedOk = useCallback(() => {
    setDismissed(DISMISS_DAYS);
    setOpen(false);
    setTick((n) => n + 1);
  }, []);

  if (!canRender) return null;

  return (
    <>
      {/* Floating pill — left of InstallPill on wide screens, stacks above on narrow.
          InstallPill sits at right-4 with width ~140px; we offset push pill by
          ~160px on >=sm and stack vertically (bottom +56px) on smaller screens. */}
      <div
        className="fixed right-4 bottom-[152px] sm:right-[180px] sm:bottom-6 z-[180] flex items-center gap-1.5 animate-fade-in-up"
        data-testid="push-pill"
      >
        <button
          type="button"
          onClick={handlePillClick}
          aria-label={t.notifications.pushPillAria}
          className="flex items-center gap-2 h-11 pl-3.5 pr-4 rounded-full shadow-2xl text-white font-semibold text-sm transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-bg border border-white/15"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.95), rgba(123,97,255,0.95))",
          }}
        >
          <BellIcon className="w-4 h-4" />
          <span>{t.notifications.pushPillLabel}</span>
        </button>
        <button
          type="button"
          onClick={handlePillDismiss}
          aria-label={t.notifications.pushPillClose}
          className="h-7 w-7 -ml-1 -mt-7 rounded-full bg-black/70 border border-white/15 text-white/80 hover:text-white hover:bg-black/90 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[9990] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0 animate-fade-in-up"
          role="dialog"
          aria-modal="true"
          aria-labelledby="push-sheet-title"
          onClick={() => {
            if (state !== "asking") setOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-5 bg-pnp-surface border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center">
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center text-white ${
                  state === "granted"
                    ? "bg-green-500/20"
                    : state === "blocked"
                      ? "bg-red-500/20"
                      : "bg-gradient-to-br from-[#D4007A]/20 to-[#7B61FF]/20"
                }`}
              >
                {state === "granted" ? (
                  <CheckIcon className="w-7 h-7 text-green-400" />
                ) : (
                  <BellIcon className="w-7 h-7" />
                )}
              </div>
            </div>

            <div className="text-center">
              <h2 id="push-sheet-title" className="text-lg font-bold text-pnp-textPrimary">
                {state === "granted"
                  ? t.notifications.pushSheetGrantedTitle
                  : state === "blocked"
                    ? t.notifications.pushSheetBlockedTitle
                    : t.notifications.pushSheetTitle}
              </h2>
              <p className="text-sm mt-2 text-pnp-textSecondary">
                {state === "granted"
                  ? t.notifications.pushSheetGrantedBody
                  : state === "blocked"
                    ? t.notifications.pushSheetBlockedBody
                    : t.notifications.pushSheetDescription}
              </p>
            </div>

            {state === "idle" || state === "asking" ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleEnable}
                  disabled={state === "asking"}
                  className="w-full py-3 rounded-xl btn-gradient text-white font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
                >
                  {state === "asking" ? t.notifications.pushSheetEnabling : t.notifications.pushSheetEnable}
                </button>
                <button
                  type="button"
                  onClick={handleSheetMaybeLater}
                  disabled={state === "asking"}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5 active:bg-white/10 text-pnp-textSecondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
                >
                  {t.notifications.pushSheetMaybeLater}
                </button>
              </div>
            ) : state === "blocked" ? (
              <button
                type="button"
                onClick={handleBlockedOk}
                className="w-full py-3 rounded-xl btn-gradient text-white font-semibold text-sm transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
              >
                {t.notifications.pushSheetBlockedOk}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

export default PushNotificationPill;
