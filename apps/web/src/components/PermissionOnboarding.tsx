import React, { useState, useEffect, useCallback, useRef } from "react";

// Camera/mic onboarding only. Notifications are handled independently by
// NotificationPermissionPrompt so one prompt can't block the other.
const STORAGE_KEY = "pnptv_permissions_onboarded_v1";
const SHOW_DELAY_MS = 3000;

function isOnboarded(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "done";
}

function markOnboarded() {
  localStorage.setItem(STORAGE_KEY, "done");
}

interface Props {
  isAuthenticated: boolean;
}

export function PermissionOnboarding({ isAuthenticated }: Props) {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (isOnboarded()) return;

    const check = async () => {
      // Check camera/mic — skip if already granted (desktop only — mobile
      // browsers don't reliably support the permissions API for these).
      if (navigator.permissions && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
        try {
          const [cam, mic] = await Promise.all([
            navigator.permissions.query({ name: "camera" as PermissionName }).catch(() => null),
            navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null),
          ]);
          if (cam?.state === "granted" && mic?.state === "granted") {
            markOnboarded();
            return;
          }
        } catch { /* ignore */ }
      }

      timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    check();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAuthenticated]);

  const finish = useCallback(() => {
    markOnboarded();
    setVisible(false);
  }, []);

  const handleCameraRequest = useCallback(async () => {
    setRequesting(true);
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        finish();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(t => t.stop());
      finish();
    } catch (err: unknown) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setError(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
          ? "Permission denied. Go to Settings > your browser > enable Camera & Microphone."
          : "Permission denied. Click the camera icon in your address bar to enable.");
      } else {
        finish();
      }
    } finally {
      setRequesting(false);
    }
  }, [finish]);

  const handleSkip = useCallback(() => {
    finish();
  }, [finish]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-5 animate-fade-in-up" style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.1)" }}>
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#permOnbGrad)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <defs><linearGradient id="permOnbGrad" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#D4007A" /><stop offset="100%" stopColor="#E69138" /></linearGradient></defs>
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
        </div>

        {/* Title + description */}
        <div className="text-center">
          <h2 className="text-lg font-bold text-white">Camera &amp; Microphone</h2>
          <p className="text-sm mt-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            Allow camera and microphone access for video calls, live streaming, and private calls.
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400 text-center bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Buttons */}
        <div className="space-y-2">
          <button
            onClick={handleCameraRequest}
            disabled={requesting}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {requesting ? "Requesting..." : "Allow Camera & Mic"}
          </button>
          <button
            onClick={handleSkip}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
