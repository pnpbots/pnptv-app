import React, { useState, useEffect, useCallback } from "react";

type PermStatus = "prompt" | "granted" | "denied" | "checking" | "unavailable";

interface PermissionGateProps {
  /** Called once permissions are granted */
  onGranted: () => void;
  /** Called if user cancels the gate */
  onCancel?: () => void;
}

/** Detect mobile browser */
function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini/i.test(navigator.userAgent);
}

/** Detect in-app WebView (Telegram, Instagram, etc.) */
function isWebView(): boolean {
  const ua = navigator.userAgent;
  return /Telegram|Instagram|FBAN|FBAV|Line\/|Snapchat|Twitter|MicroMessenger/i.test(ua);
}

/** Check if mediaDevices API is available */
function hasMediaDevices(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Shows a modal asking the user to grant camera + microphone permissions.
 * Must be triggered by a user gesture (button tap) so the browser allows the prompt.
 * On mobile WebViews where getUserMedia isn't available, offers a "Continue anyway"
 * option since LiveKit will request permissions itself when the call starts.
 */
export function PermissionGate({ onGranted, onCancel }: PermissionGateProps) {
  const [camStatus, setCamStatus] = useState<PermStatus>("checking");
  const [micStatus, setMicStatus] = useState<PermStatus>("checking");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaUnavailable, setMediaUnavailable] = useState(false);

  // Check current permission state on mount
  useEffect(() => {
    let cancelled = false;
    async function check() {
      // If mediaDevices API isn't available (WebView, insecure context), skip permission check
      if (!hasMediaDevices()) {
        if (!cancelled) {
          setMediaUnavailable(true);
          setCamStatus("unavailable");
          setMicStatus("unavailable");
        }
        return;
      }

      try {
        // navigator.permissions.query for camera/mic is NOT supported on iOS Safari
        // and many mobile browsers — only use it on desktop
        if (navigator.permissions && !isMobile()) {
          const [cam, mic] = await Promise.all([
            navigator.permissions.query({ name: "camera" as PermissionName }).catch(() => null),
            navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null),
          ]);
          if (cancelled) return;

          const camState = cam?.state || "prompt";
          const micState = mic?.state || "prompt";
          setCamStatus(camState);
          setMicStatus(micState);

          // Already granted — verify with actual getUserMedia before skipping
          if (camState === "granted" && micState === "granted") {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
              stream.getTracks().forEach(t => t.stop());
              if (!cancelled) onGranted();
            } catch {
              // Permissions API lied — show the gate
              if (!cancelled) {
                setCamStatus("prompt");
                setMicStatus("prompt");
              }
            }
            return;
          }
        } else {
          if (!cancelled) {
            setCamStatus("prompt");
            setMicStatus("prompt");
          }
        }
      } catch {
        if (!cancelled) {
          setCamStatus("prompt");
          setMicStatus("prompt");
        }
      }
    }
    check();
    return () => { cancelled = true; };
  }, [onGranted]);

  const requestPermissions = useCallback(async () => {
    if (!hasMediaDevices()) {
      setError("Camera/microphone not available in this browser. Please open this page in Safari or Chrome.");
      setMediaUnavailable(true);
      setCamStatus("unavailable");
      setMicStatus("unavailable");
      return;
    }

    setRequesting(true);
    setError(null);
    try {
      // Try both together first
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(t => t.stop());
      setCamStatus("granted");
      setMicStatus("granted");
      onGranted();
    } catch (err: unknown) {
      const e = err as DOMException;

      // On mobile, try requesting video and audio separately as fallback
      // Some devices fail on combined request but succeed individually
      if (isMobile() && (e.name === "NotFoundError" || e.name === "OverconstrainedError" || e.name === "NotReadableError")) {
        try {
          const results = await Promise.allSettled([
            navigator.mediaDevices.getUserMedia({ video: true }).then(s => { s.getTracks().forEach(t => t.stop()); return "video"; }),
            navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); return "audio"; }),
          ]);

          const granted = results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<string>).value);

          if (granted.includes("video")) setCamStatus("granted");
          if (granted.includes("audio")) setMicStatus("granted");

          // At least one succeeded — let them proceed (LiveKit handles the rest)
          if (granted.length > 0) {
            onGranted();
            return;
          }
        } catch {
          // Fall through to error handling below
        }
      }

      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setCamStatus("denied");
        setMicStatus("denied");
        if (isMobile()) {
          setError("Permission denied. Open your device Settings > find your browser > enable Camera and Microphone, then come back and try again.");
        } else {
          setError("Permission denied. Click the camera icon in your browser's address bar to enable permissions, then try again.");
        }
      } else if (e.name === "NotFoundError") {
        setError("No camera or microphone found on this device. You need a camera and microphone to join video calls.");
        setCamStatus("denied");
        setMicStatus("denied");
      } else if (e.name === "NotReadableError") {
        setError("Camera or microphone is already in use by another app. Close other apps using the camera, then try again.");
      } else if (e.name === "OverconstrainedError") {
        // Device doesn't meet constraints — try with minimal constraints
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
          stream.getTracks().forEach(t => t.stop());
          setCamStatus("granted");
          setMicStatus("granted");
          onGranted();
          return;
        } catch {
          setError("Could not access camera with the required settings. You can continue without camera.");
          setMediaUnavailable(true);
        }
      } else {
        setError(e.message || "Could not access camera/microphone.");
      }
    } finally {
      setRequesting(false);
    }
  }, [onGranted]);

  // Still checking — show nothing
  if (camStatus === "checking" || micStatus === "checking") return null;

  const denied = camStatus === "denied" || micStatus === "denied";
  const unavailable = mediaUnavailable || camStatus === "unavailable" || micStatus === "unavailable";
  const inWebView = isWebView();

  // Status dot color helper
  const dotColor = (status: PermStatus) => {
    if (status === "granted") return "bg-green-500";
    if (status === "denied") return "bg-red-500";
    if (status === "unavailable") return "bg-gray-500";
    return "bg-yellow-500";
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
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
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#permGrad)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="permGrad" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor="#D4007A" />
                  <stop offset="100%" stopColor="#E69138" />
                </linearGradient>
              </defs>
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <div className="text-center">
          <h2 className="text-lg font-bold text-white">Camera & Microphone</h2>
          <p className="text-sm mt-2" style={{ color: "#8E8E93" }}>
            {inWebView && unavailable
              ? "This in-app browser doesn't support camera access. Open this link in your default browser (Safari/Chrome) for the best experience, or continue to join anyway."
              : unavailable && !denied
              ? "Camera/microphone access isn't available in this browser. You can still join — the video call will request permissions directly."
              : denied
              ? isMobile()
                ? "Permissions were blocked. Go to your device Settings, find your browser, and enable Camera & Microphone."
                : "Permissions were blocked. Click the camera icon in your address bar to enable them."
              : "To join video calls, we need access to your camera and microphone. Tap below to allow."
            }
          </p>
        </div>

        {/* Permission indicators */}
        <div className="flex justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${dotColor(camStatus)}`} />
            <span className="text-xs text-white/70">Camera</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${dotColor(micStatus)}`} />
            <span className="text-xs text-white/70">Microphone</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400 text-center bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Buttons */}
        <div className="space-y-2">
          {!denied && !unavailable && (
            <button
              onClick={requestPermissions}
              disabled={requesting}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition-all"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {requesting ? "Requesting..." : "Allow Camera & Microphone"}
            </button>
          )}
          {denied && (
            <button
              onClick={requestPermissions}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              Try Again
            </button>
          )}
          {/* Continue anyway — lets user proceed when permissions are denied/unavailable.
              LiveKit will request permissions itself when the call starts. */}
          {(denied || unavailable) && (
            <button
              onClick={onGranted}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all border border-white/20 hover:bg-white/5"
            >
              Continue Anyway
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
              style={{ color: "#8E8E93" }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
