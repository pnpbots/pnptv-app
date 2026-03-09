import React, { useState, useEffect, useCallback, useRef } from "react";
import { subscribeToPush } from "@/lib/pushNotifications";
import { useI18n } from "@/lib/i18n";

const DISMISS_KEY = "push_notif_prompt_dismissed_v2";
const ONBOARDING_KEY = "pnptv_permissions_onboarded_v1";
const DISMISS_DAYS = 3;
const SHOW_DELAY_MS = 8000;

function isDismissed(): boolean {
  const until = localStorage.getItem(DISMISS_KEY);
  if (!until) return false;
  return Date.now() < Number(until);
}

function dismiss(days: number = DISMISS_DAYS) {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
}

interface Props {
  isAuthenticated: boolean;
}

export function NotificationPermissionPrompt({ isAuthenticated }: Props) {
  const t = useI18n();
  const [show, setShow] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [granted, setGranted] = useState(false);

  // Store the setTimeout handle so it can be cleared on unmount
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return;
    if (Notification.permission === "denied") return;
    if (isDismissed()) return;
    // Don't show if the permission onboarding already handled notifications
    if (localStorage.getItem(ONBOARDING_KEY) === "done") return;

    showTimerRef.current = setTimeout(() => setShow(true), SHOW_DELAY_MS);

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [isAuthenticated]);

  const handleAllow = useCallback(async () => {
    setRequesting(true);
    try {
      const success = await subscribeToPush();
      if (success) {
        setGranted(true);
        dismiss(365);
        closeTimerRef.current = setTimeout(() => setShow(false), 1500);
      } else {
        dismiss(7);
        setShow(false);
      }
    } catch {
      dismiss(1);
      setShow(false);
    } finally {
      setRequesting(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    dismiss();
    setShow(false);
  }, []);

  const featureItems = [
    t.notifications.featureMessages,
    t.notifications.featureVideoCalls,
    t.notifications.featureLive,
    t.notifications.featureCommunity,
  ];

  if (!show) return null;

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
            <button
              onClick={handleAllow}
              disabled={requesting}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface btn-gradient"
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
