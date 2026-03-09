import React, { useState, useEffect, useCallback, useRef } from "react";
import { subscribeToPush } from "@/lib/pushNotifications";

const STORAGE_KEY = "pnptv_permissions_onboarded_v1";
const SHOW_DELAY_MS = 3000;

/** Returns true if the onboarding was already completed or dismissed permanently */
function isOnboarded(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "done";
}

function markOnboarded() {
  localStorage.setItem(STORAGE_KEY, "done");
}

type Step = "camera" | "notifications" | "done";

interface Props {
  isAuthenticated: boolean;
}

export function PermissionOnboarding({ isAuthenticated }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>("camera");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (isOnboarded()) return;

    // Check what's already granted and skip those steps
    let startStep: Step = "camera";

    const check = async () => {
      // Check camera/mic
      let camGranted = false;
      if (navigator.permissions && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
        try {
          const [cam, mic] = await Promise.all([
            navigator.permissions.query({ name: "camera" as PermissionName }).catch(() => null),
            navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null),
          ]);
          if (cam?.state === "granted" && mic?.state === "granted") camGranted = true;
        } catch { /* ignore */ }
      }

      // Check notifications
      const notifGranted = "Notification" in window && Notification.permission === "granted";

      if (camGranted && notifGranted) {
        markOnboarded();
        return; // All already granted
      }

      if (camGranted) startStep = "notifications";
      if (!("Notification" in window) && camGranted) {
        markOnboarded();
        return; // No notification API and camera already granted
      }

      setStep(startStep);
      timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    check();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAuthenticated]);

  const advanceOrFinish = useCallback(() => {
    if (step === "camera") {
      // Check if notifications API exists
      if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        setStep("notifications");
        setError(null);
      } else {
        markOnboarded();
        setVisible(false);
      }
    } else {
      markOnboarded();
      setVisible(false);
    }
  }, [step]);

  const handleCameraRequest = useCallback(async () => {
    setRequesting(true);
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        // No mediaDevices API (e.g. Telegram WebView) — skip
        advanceOrFinish();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(t => t.stop());
      advanceOrFinish();
    } catch (err: unknown) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setError(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
          ? "Permission denied. Go to Settings > your browser > enable Camera & Microphone."
          : "Permission denied. Click the camera icon in your address bar to enable.");
      } else {
        // Device error — skip, don't block the user
        advanceOrFinish();
      }
    } finally {
      setRequesting(false);
    }
  }, [advanceOrFinish]);

  const handleNotificationRequest = useCallback(async () => {
    setRequesting(true);
    setError(null);
    try {
      await subscribeToPush();
      markOnboarded();
      setVisible(false);
    } catch {
      markOnboarded();
      setVisible(false);
    } finally {
      setRequesting(false);
    }
  }, []);

  const handleSkip = useCallback(() => {
    advanceOrFinish();
  }, [advanceOrFinish]);

  const handleSkipAll = useCallback(() => {
    markOnboarded();
    setVisible(false);
  }, []);

  if (!visible) return null;

  const stepConfig = step === "camera"
    ? {
        icon: (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#permOnbGrad)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="permOnbGrad" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#D4007A" /><stop offset="100%" stopColor="#E69138" /></linearGradient></defs>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        ),
        title: "Camera & Microphone",
        description: "Allow camera and microphone access for video calls, live streaming, and private calls.",
        buttonText: "Allow Camera & Mic",
        onAction: handleCameraRequest,
      }
    : {
        icon: (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#permOnbGrad2)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="permOnbGrad2" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#D4007A" /><stop offset="100%" stopColor="#E69138" /></linearGradient></defs>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
        title: "Push Notifications",
        description: "Get notified about new messages, video calls, live streams, and community activity.",
        buttonText: "Enable Notifications",
        onAction: handleNotificationRequest,
      };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-5 animate-fade-in-up" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.1)" }}>
        {/* Step indicator */}
        <div className="flex justify-center gap-2">
          <div className={`h-1 w-8 rounded-full ${step === "camera" ? "bg-gradient-to-r from-[#D4007A] to-[#E69138]" : "bg-white/20"}`} />
          <div className={`h-1 w-8 rounded-full ${step === "notifications" ? "bg-gradient-to-r from-[#D4007A] to-[#E69138]" : "bg-white/20"}`} />
        </div>

        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))" }}>
            {stepConfig.icon}
          </div>
        </div>

        {/* Title + description */}
        <div className="text-center">
          <h2 className="text-lg font-bold text-white">{stepConfig.title}</h2>
          <p className="text-sm mt-2" style={{ color: "#8E8E93" }}>{stepConfig.description}</p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400 text-center bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Buttons */}
        <div className="space-y-2">
          <button
            onClick={stepConfig.onAction}
            disabled={requesting}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-all active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {requesting ? "Requesting..." : stepConfig.buttonText}
          </button>
          <button
            onClick={handleSkip}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "#8E8E93" }}
          >
            Skip
          </button>
          {step === "camera" && (
            <button
              onClick={handleSkipAll}
              className="w-full py-2 rounded-xl text-xs transition-colors hover:bg-white/5"
              style={{ color: "#555" }}
            >
              Skip all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
