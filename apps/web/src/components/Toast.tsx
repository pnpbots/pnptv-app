import React, { useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/hooks/useNotifications";
import { getNotificationDeepLink } from "@/lib/notificationDeepLink";

const AUTO_DISMISS_MS = 6000;

export function Toast() {
  const { latestToast, dismissToast } = useNotifications();
  const navigate = useNavigate();

  // Auto-dismiss timer — owned here so we can pause/resume on hover
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef<number>(AUTO_DISMISS_MS);
  const startedAtRef = useRef<number>(0);

  const startTimer = useCallback(
    (duration: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      startedAtRef.current = Date.now();
      remainingRef.current = duration;
      timerRef.current = setTimeout(() => {
        dismissToast();
        timerRef.current = null;
      }, duration);
    },
    [dismissToast]
  );

  const pauseTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
  }, []);

  const resumeTimer = useCallback(() => {
    if (remainingRef.current > 0) startTimer(remainingRef.current);
  }, [startTimer]);

  // Start a fresh 6s timer every time a new toast appears
  useEffect(() => {
    if (!latestToast) return;
    remainingRef.current = AUTO_DISMISS_MS;
    startTimer(AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [latestToast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!latestToast) return null;

  const handleTap = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    dismissToast();
    const target = getNotificationDeepLink({
      type: latestToast.type,
      entityType: latestToast.entityType,
      entityId: latestToast.entityId,
      actorId: latestToast.actor?.id,
    });
    if (/^https?:\/\//i.test(target)) {
      window.open(target, "_blank", "noopener,noreferrer");
    } else {
      navigate(target);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleTap();
    }
  };

  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    dismissToast();
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm animate-slide-in-top">
      <div
        role="button"
        tabIndex={0}
        onClick={handleTap}
        onKeyDown={handleKeyDown}
        onMouseEnter={pauseTimer}
        onMouseLeave={resumeTimer}
        className="flex items-center gap-3 px-4 py-3 rounded-xl glass-nav border border-pnp-border shadow-xl cursor-pointer select-none"
      >
        {/* Actor avatar */}
        <div
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-gradient-to-br from-[#D4007A] to-[#E69138] text-white overflow-hidden"
          aria-hidden="true"
        >
          {latestToast.actor?.photoUrl ? (
            <img
              src={latestToast.actor.photoUrl}
              alt=""
              className="w-9 h-9 rounded-full object-cover"
            />
          ) : (
            (latestToast.actor?.firstName || latestToast.actor?.username || "!")[0].toUpperCase()
          )}
        </div>

        <p className="flex-1 text-[13px] text-pnp-textPrimary font-medium leading-snug line-clamp-2">
          {latestToast.message}
        </p>

        <button
          onClick={handleDismissClick}
          className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-textPrimary ml-1"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
