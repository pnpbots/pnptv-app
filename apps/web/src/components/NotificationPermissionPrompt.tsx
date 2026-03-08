import React, { useState, useEffect, useCallback } from "react";
import { subscribeToPush, isPushSubscribed } from "@/lib/pushNotifications";

const DISMISS_KEY = "push_notif_prompt_dismissed_v2";
const DISMISS_DAYS = 3; // Re-show after 3 days if dismissed
const SHOW_DELAY_MS = 6000; // Show 6s after mount (let PWA banner go first)

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
  const [show, setShow] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return; // Already granted
    if (Notification.permission === "denied") return; // Can't ask again
    if (isDismissed()) return;

    const timer = setTimeout(() => setShow(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isAuthenticated]);

  const handleAllow = useCallback(async () => {
    setRequesting(true);
    try {
      const success = await subscribeToPush();
      if (success) {
        setGranted(true);
        dismiss(365); // Don't re-show for a year
        setTimeout(() => setShow(false), 1500);
      } else {
        // User denied in the browser prompt
        dismiss(7); // Try again in 7 days
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

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-5 animate-fade-in-up"
        style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {/* Icon */}
        <div className="flex justify-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}
          >
            {granted ? (
              <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#notifGrad)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
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

        {/* Title */}
        <div className="text-center">
          {granted ? (
            <>
              <h2 className="text-lg font-bold text-white">Notifications Enabled!</h2>
              <p className="text-sm mt-2" style={{ color: "#8E8E93" }}>
                You'll now receive alerts for messages, calls, and community updates.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-white">Stay in the Loop</h2>
              <p className="text-sm mt-2" style={{ color: "#8E8E93" }}>
                Enable notifications so you never miss messages, video calls, or what's happening in the community.
              </p>
            </>
          )}
        </div>

        {/* Feature list */}
        {!granted && (
          <div className="space-y-2 px-2">
            {[
              "New messages & DMs",
              "Video call invites from hangouts",
              "Live stream alerts",
              "Community updates & events",
            ].map((f) => (
              <div key={f} className="flex items-center gap-2.5 text-sm text-white/80">
                <span className="text-green-400 font-bold text-base flex-shrink-0">+</span>
                <span>{f}</span>
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
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-all"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {requesting ? "Enabling..." : "Enable Notifications"}
            </button>
            <button
              onClick={handleDismiss}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
              style={{ color: "#8E8E93" }}
            >
              Not Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
