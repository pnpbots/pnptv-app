import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  useInstallPrompt,
  isStandalonePWA,
  isIOSSafariNotInstalled,
  hasCapturedInstallEvent,
  wasInstalledThisSession,
} from "@/hooks/useInstallPrompt";
import { useExternalPathname, isExcludedFromFloatingUI } from "@/hooks/useExternalPathname";

const DISMISS_KEY = "pnptv:install-pill-dismissed";
const DISMISS_DAYS = 7;

function isDismissed(): boolean {
  try {
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

/**
 * Public predicate so other floating pills can defer to the install pill.
 * Returns true when the install pill SHOULD render (mounted + visible).
 */
export function shouldShowInstallPill(): boolean {
  if (typeof window === "undefined") return false;
  if (wasInstalledThisSession()) return false;
  if (isStandalonePWA()) return false;
  if (isDismissed()) return false;
  return isIOSSafariNotInstalled() || hasCapturedInstallEvent();
}

const DownloadIcon = ({ className }: { className?: string }) => (
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
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

const ShareIosIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
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

export function InstallPill() {
  const t = useI18n();
  const { installEvent, isInstalled, isIOS, clear } = useInstallPrompt();
  const pathname = useExternalPathname();
  const [open, setOpen] = useState(false);
  const [dismissedTick, setDismissedTick] = useState(0);
  const [installing, setInstalling] = useState(false);

  // ESC closes sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const canRender = (() => {
    if (isExcludedFromFloatingUI(pathname)) return false;
    if (isInstalled) return false;
    if (isStandalonePWA()) return false;
    if (isDismissed()) return false;
    if (isIOS) return true;
    if (installEvent) return true;
    return false;
  })();

  // Re-render when dismissedTick changes (so the close button hides the pill
  // immediately without a full unmount cycle).
  void dismissedTick;

  const handlePillClick = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handlePillDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDismissed(DISMISS_DAYS);
      setDismissedTick((n) => n + 1);
    },
    []
  );

  const handleInstall = useCallback(async () => {
    if (!installEvent) return;
    setInstalling(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") {
        clear();
        setOpen(false);
      } else {
        setDismissed(DISMISS_DAYS);
        setDismissedTick((n) => n + 1);
        setOpen(false);
      }
    } catch {
      setDismissed(DISMISS_DAYS);
      setDismissedTick((n) => n + 1);
      setOpen(false);
    } finally {
      setInstalling(false);
    }
  }, [installEvent, clear]);

  const handleSheetDismiss = useCallback(() => {
    setDismissed(DISMISS_DAYS);
    setDismissedTick((n) => n + 1);
    setOpen(false);
  }, []);

  if (!canRender) return null;

  return (
    <>
      {/* Floating pill — bottom-right, z-180 (below z-200 mini player) */}
      <div
        className="fixed right-4 bottom-24 sm:bottom-6 z-[180] flex items-center gap-1.5 animate-fade-in-up"
        data-testid="install-pill"
      >
        <button
          type="button"
          onClick={handlePillClick}
          aria-label={t.notifications.installPillAria}
          className="flex items-center gap-2 h-11 pl-3.5 pr-4 rounded-full shadow-2xl text-white font-semibold text-sm transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-bg"
          style={{
            background: "linear-gradient(135deg, #D4007A, #E69138)",
          }}
        >
          <DownloadIcon className="w-4 h-4" />
          <span>{t.notifications.installPillLabel}</span>
        </button>
        <button
          type="button"
          onClick={handlePillDismiss}
          aria-label={t.notifications.installPillClose}
          className="h-7 w-7 -ml-1 -mt-7 rounded-full bg-black/70 border border-white/15 text-white/80 hover:text-white hover:bg-black/90 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom sheet / popover */}
      {open && (
        <div
          className="fixed inset-0 z-[9990] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0 animate-fade-in-up"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-sheet-title"
          onClick={handleClose}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-5 bg-pnp-surface border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br from-[#D4007A]/20 to-[#E69138]/20 text-white">
                {isIOS ? <ShareIosIcon className="w-7 h-7" /> : <DownloadIcon className="w-7 h-7" />}
              </div>
            </div>

            <div className="text-center">
              <h2 id="install-sheet-title" className="text-lg font-bold text-pnp-textPrimary">
                {isIOS ? t.notifications.installSheetIOSTitle : t.notifications.installSheetTitle}
              </h2>
              <p className="text-sm mt-2 text-pnp-textSecondary">
                {isIOS
                  ? t.notifications.installSheetIOSDescription
                  : t.notifications.installSheetDescription}
              </p>
            </div>

            <div className="space-y-2">
              {isIOS ? (
                <button
                  type="button"
                  onClick={handleSheetDismiss}
                  className="w-full py-3 rounded-xl btn-gradient text-white font-semibold text-sm transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
                >
                  {t.notifications.installSheetIOSOk}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleInstall}
                    disabled={installing || !installEvent}
                    className="w-full py-3 rounded-xl btn-gradient text-white font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface flex items-center justify-center gap-2"
                  >
                    <DownloadIcon className="w-4 h-4" />
                    {installing ? t.notifications.installing : t.notifications.installSheetButton}
                  </button>
                  <button
                    type="button"
                    onClick={handleSheetDismiss}
                    className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5 active:bg-white/10 text-pnp-textSecondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
                  >
                    {t.notifications.installSheetCancel}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default InstallPill;
