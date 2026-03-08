import React, { useState, useEffect, useCallback } from "react";

type PermStatus = "prompt" | "granted" | "denied" | "checking";

interface PermissionGateProps {
  /** Called once permissions are granted */
  onGranted: () => void;
  /** Called if user cancels the gate */
  onCancel?: () => void;
}

/**
 * Shows a modal asking the user to grant camera + microphone permissions.
 * Must be triggered by a user gesture (button tap) so the browser allows the prompt.
 * If permissions are already granted, calls onGranted immediately.
 */
export function PermissionGate({ onGranted, onCancel }: PermissionGateProps) {
  const [camStatus, setCamStatus] = useState<PermStatus>("checking");
  const [micStatus, setMicStatus] = useState<PermStatus>("checking");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check current permission state on mount
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        if (navigator.permissions) {
          const [cam, mic] = await Promise.all([
            navigator.permissions.query({ name: "camera" as PermissionName }).catch(() => null),
            navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null),
          ]);
          if (cancelled) return;
          setCamStatus(cam?.state || "prompt");
          setMicStatus(mic?.state || "prompt");

          // Already granted — skip the gate
          if (cam?.state === "granted" && mic?.state === "granted") {
            onGranted();
            return;
          }
        } else {
          // permissions API not available — try getUserMedia directly
          setCamStatus("prompt");
          setMicStatus("prompt");
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
    setRequesting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      // Immediately stop tracks — we just needed the permission prompt
      stream.getTracks().forEach(t => t.stop());
      setCamStatus("granted");
      setMicStatus("granted");
      onGranted();
    } catch (err: unknown) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setCamStatus("denied");
        setMicStatus("denied");
        setError("Permission denied. Please enable Camera and Microphone in your browser or device settings, then try again.");
      } else if (e.name === "NotFoundError") {
        setError("No camera or microphone found on this device.");
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
            {denied
              ? "Permissions were blocked. You'll need to enable them in your browser or device settings."
              : "To join video calls, we need access to your camera and microphone. Tap below to allow."
            }
          </p>
        </div>

        {/* Permission indicators */}
        <div className="flex justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${camStatus === "granted" ? "bg-green-500" : camStatus === "denied" ? "bg-red-500" : "bg-yellow-500"}`} />
            <span className="text-xs text-white/70">Camera</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${micStatus === "granted" ? "bg-green-500" : micStatus === "denied" ? "bg-red-500" : "bg-yellow-500"}`} />
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
          {!denied && (
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
