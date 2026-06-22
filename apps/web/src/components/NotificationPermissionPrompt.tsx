import React, { useState, useEffect, useCallback, useRef } from "react";
import { subscribeToPush } from "@/lib/pushNotifications";
import { useI18n } from "@/lib/i18n";
import { useInstallPrompt, isStandalonePWA } from "@/hooks/useInstallPrompt";

const DISMISS_KEY = "push_notif_prompt_dismissed_v2";
const IOS_DISMISS_KEY = "ios_install_prompt_dismissed_v1";
const DISMISS_DAYS = 3;
const IOS_DISMISS_DAYS = 7;
const SHOW_DELAY_MS = 4000;

function isDismissed(key: string): boolean {
  const until = localStorage.getItem(key);
  if (!until) return false;
  return Date.now() < Number(until);
}

function dismiss(key: string, days: number) {
  localStorage.setItem(key, String(Date.now() + days * 24 * 60 * 60 * 1000));
}

// iOS push requires the site be installed to Home Screen (iOS 16.4+).
function detectIOSNotInstalled(): boolean {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac; detect via touch
    (/Mac/.test(ua) && "ontouchend" in document);
  if (!isIOS) return false;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return !isStandalone;
}

interface Props {
  isAuthenticated: boolean;
}

export function NotificationPermissionPrompt({ isAuthenticated }: Props) {
  const t = useI18n();
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<"browser" | "ios">("browser");
  const [requesting, setRequesting] = useState(false);
  const [granted, setGranted] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Shared install-prompt hook — coordinates with InstallPill so we don't
  // double-capture beforeinstallprompt (browser only fires it once).
  const { installEvent, clear: clearInstallEvent } = useInstallPrompt();

  // Store the setTimeout handle so it can be cleared on unmount
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    // iOS Safari (non-installed) path — show Add-to-Home-Screen instructions
    // regardless of Notification.permission (which is reported "denied" for
    // non-installed iOS PWAs).
    if (detectIOSNotInstalled()) {
      if (isDismissed(IOS_DISMISS_KEY)) return;
      setMode("ios");
      showTimerRef.current = setTimeout(() => setShow(true), SHOW_DELAY_MS);
      return () => {
        if (showTimerRef.current) clearTimeout(showTimerRef.current);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      };
    }

    // Standard browser path. Show if either:
    //   (a) we can still ask for push permission (default state), OR
    //   (b) we have a captured install prompt and the app isn't installed
    //       (Android/Chromium not yet added to home screen).
    const canAskPush =
      "Notification" in window && Notification.permission === "default";
    const canOfferInstall = !!installEvent && !isStandalonePWA();
    if (!canAskPush && !canOfferInstall) return;
    if (isDismissed(DISMISS_KEY)) return;

    setMode("browser");
    showTimerRef.current = setTimeout(() => setShow(true), SHOW_DELAY_MS);

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [isAuthenticated, installEvent]);

  const handleInstall = useCallback(async () => {
    if (!installEvent) return;
    setInstalling(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") {
        clearInstallEvent();
        // Stay on the modal so we can chain into the push opt-in next.
      }
    } catch {
      // User cancelled or browser threw — silently fall through to push opt-in.
    } finally {
      setInstalling(false);
    }
  }, [installEvent]);

  const handleAllow = useCallback(async () => {
    setRequesting(true);
    try {
      const success = await subscribeToPush();
      if (success) {
        setGranted(true);
        dismiss(DISMISS_KEY, 365);
        closeTimerRef.current = setTimeout(() => setShow(false), 1500);
      } else {
        dismiss(DISMISS_KEY, 7);
        setShow(false);
      }
    } catch {
      dismiss(DISMISS_KEY, 1);
      setShow(false);
    } finally {
      setRequesting(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    dismiss(mode === "ios" ? IOS_DISMISS_KEY : DISMISS_KEY, mode === "ios" ? IOS_DISMISS_DAYS : DISMISS_DAYS);
    setShow(false);
  }, [mode]);

  const featureItems = [
    t.notifications.featureMessages,
    t.notifications.featureVideoCalls,
    t.notifications.featureLive,
    t.notifications.featureCommunity,
  ];

  if (!show) return null;

  // iOS install mode — notifications on iOS require Add-to-Home-Screen.
  if (mode === "ios") {
    return (
      <div
        className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-prompt-title"
      >
        <div className="w-full max-w-sm rounded-2xl p-6 space-y-5 animate-fade-in-up bg-pnp-surface border border-white/10">
          {/* Icon — phone with + */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-[#D4007A]/20 to-[#E69138]/20">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="url(#iosGrad)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="iosGrad" x1="0" y1="0" x2="24" y2="24">
                    <stop offset="0%" stopColor="#D4007A" />
                    <stop offset="100%" stopColor="#E69138" />
                  </linearGradient>
                </defs>
                <rect x="5" y="2" width="14" height="20" rx="3" />
                <path d="M9 18h6" />
                <path d="M12 8v4M10 10h4" />
              </svg>
            </div>
          </div>

          {/* Title + description */}
          <div className="text-center">
            <h2 id="notif-prompt-title" className="text-lg font-bold text-pnp-textPrimary">
              {t.notifications.iosTitle}
            </h2>
            <p className="text-sm mt-2 text-pnp-textSecondary">
              {t.notifications.iosDescription}
            </p>
          </div>

          {/* Steps */}
          <ol className="space-y-3 text-sm text-white/90">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/80 text-xs font-bold flex items-center justify-center">1</span>
              <span className="flex items-center gap-1.5 pt-0.5">
                {t.notifications.iosStep1Text}
                <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
                  <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/80 text-xs font-bold flex items-center justify-center">2</span>
              <span className="pt-0.5">{t.notifications.iosStep2Pre} <strong className="text-white">{t.notifications.iosStep2Bold}</strong></span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/80 text-xs font-bold flex items-center justify-center">3</span>
              <span className="pt-0.5">{t.notifications.iosStep3Text}</span>
            </li>
          </ol>

          <p className="text-[11px] text-pnp-textSecondary/70 text-center">
            {t.notifications.iosVersion}
          </p>

          {/* Dismiss only — there's no Allow button here, the user has to install */}
          <button
            onClick={handleDismiss}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5 active:bg-white/10 text-pnp-textSecondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
          >
            {t.notifications.iosGotIt}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notif-prompt-title"
    >
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-5 animate-fade-in-up bg-pnp-surface border border-white/10">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-[#D4007A]/20 to-[#E69138]/20">
            {granted ? (
              <svg
                className="w-8 h-8 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="url(#notifGrad)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="notifGrad" x1="0" y1="0" x2="24" y2="24">
                    <stop offset="0%" stopColor="#D4007A" />
                    <stop offset="100%" stopColor="#E69138" />
                  </linearGradient>
                </defs>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            )}
          </div>
        </div>

        {/* Title + description */}
        <div className="text-center">
          {granted ? (
            <>
              <h2
                id="notif-prompt-title"
                className="text-lg font-bold text-pnp-textPrimary"
              >
                {t.notifications.grantedTitle}
              </h2>
              <p className="text-sm mt-2 text-pnp-textSecondary">
                {t.notifications.grantedDescription}
              </p>
            </>
          ) : (
            <>
              <h2
                id="notif-prompt-title"
                className="text-lg font-bold text-pnp-textPrimary"
              >
                {t.notifications.stayInLoopTitle}
              </h2>
              <p className="text-sm mt-2 text-pnp-textSecondary">
                {t.notifications.stayInLoopDescription}
              </p>
            </>
          )}
        </div>

        {/* Feature list */}
        {!granted && (
          <div className="space-y-2 px-2">
            {featureItems.map((feature) => (
              <div key={feature} className="flex items-center gap-2.5 text-sm text-white/80">
                <span className="text-green-400 font-bold text-base flex-shrink-0" aria-hidden="true">
                  +
                </span>
                <span>{feature}</span>
              </div>
            ))}
          </div>
        )}

        {/* Buttons */}
        {!granted && (
          <div className="space-y-2">
            {installEvent && !isStandalonePWA() && (
              <button
                onClick={handleInstall}
                disabled={installing}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface btn-gradient flex items-center justify-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="2" width="14" height="20" rx="3" />
                  <path d="M9 18h6" />
                </svg>
                {installing ? t.notifications.installing : t.notifications.installApp}
              </button>
            )}
            <button
              onClick={handleAllow}
              disabled={requesting}
              className={`w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface ${
                installEvent && !isStandalonePWA()
                  ? "bg-white/8 border border-white/15 text-white hover:bg-white/12"
                  : "btn-gradient text-white"
              }`}
            >
              {requesting ? t.notifications.enabling : t.notifications.enableButton}
            </button>
            <button
              onClick={handleDismiss}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5 active:bg-white/10 text-pnp-textSecondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface"
            >
              {t.notifications.notNow}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
