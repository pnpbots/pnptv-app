import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
// Inline SVG icon components (avoids lucide-react dependency)
const Video = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>;
const VideoOff = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const Mic = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
const Radio = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>;
const StopCircle = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>;
const AlertTriangle = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const Users = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const Clock = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const Wifi = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>;
const WifiOff = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>;
const RefreshCw = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>;
import { useI18n } from "@/lib/i18n";
import { getMyChannel } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import type { Socket } from "socket.io-client";

// ─── Types ──────────────────────────────────────────────────────────────────

type StreamStatus = "idle" | "connecting" | "live" | "stopping" | "error";
type PermissionState = "unknown" | "granted" | "denied" | "not_found";
type ConnectionQuality = "good" | "fair" | "poor";

interface MediaDeviceInfo {
  deviceId: string;
  label: string;
  kind: "videoinput" | "audioinput";
}

interface ChannelInfo {
  ref: string;
  streamKey: string;
  rtmpUrl: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getSupportedMimeType(): string | null {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface SelectProps {
  id: string;
  label: string;
  value: string;
  options: MediaDeviceInfo[];
  disabled: boolean;
  onChange: (deviceId: string) => void;
  icon: React.ReactNode;
  placeholder: string;
}

function DeviceSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
  icon,
  placeholder,
}: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-medium text-pnp-textSecondary"
      >
        {icon}
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || options.length === 0}
          className="
            w-full appearance-none rounded-xl px-3 py-2.5 pr-9 text-sm
            bg-pnp-surface border border-pnp-border
            text-pnp-textPrimary
            focus:outline-none focus:border-pnp-accent
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-150
          "
          aria-label={label}
        >
          {options.length === 0 && (
            <option value="">{placeholder}</option>
          )}
          {options.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Device ${d.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pnp-textSecondary"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: StreamStatus;
  t: {
    statusLive: string;
    statusOffline: string;
    statusConnecting: string;
    statusError: string;
  };
}

function StatusBadge({ status, t }: StatusBadgeProps) {
  if (status === "live") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-white"
        style={{ background: "rgba(239, 68, 68, 0.9)" }}
        role="status"
        aria-live="polite"
      >
        <span
          className="w-2 h-2 rounded-full bg-white animate-pulse"
          aria-hidden="true"
        />
        {t.statusLive}
      </span>
    );
  }

  if (status === "connecting" || status === "stopping") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white/70"
        style={{ background: "rgba(255,255,255,0.08)" }}
        role="status"
        aria-live="polite"
      >
        <span
          className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"
          aria-hidden="true"
        />
        {t.statusConnecting}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
        style={{ background: "rgba(239,68,68,0.15)", color: "#FF453A" }}
        role="status"
        aria-live="polite"
      >
        <span className="w-2 h-2 rounded-full bg-red-400" aria-hidden="true" />
        {t.statusError}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-pnp-textSecondary"
      style={{ background: "rgba(255,255,255,0.06)" }}
      role="status"
    >
      <span
        className="w-2 h-2 rounded-full bg-pnp-textSecondary"
        aria-hidden="true"
      />
      {t.statusOffline}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BrowserStreamer() {
  const { live: t } = useI18n();

  // Device enumeration
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [selectedMic, setSelectedMic] = useState<string>("");

  // Permission / browser support state
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [browserSupported, setBrowserSupported] = useState(true);

  // Stream state
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [quality, setQuality] = useState<ConnectionQuality>("good");

  // Channel
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Track bytes sent for quality estimation
  const bytesSentRef = useRef<number[]>([]);

  // ── Browser support check ────────────────────────────────────────────────
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setBrowserSupported(false);
    }
  }, []);

  // ── Device enumeration ───────────────────────────────────────────────────
  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices
        .filter((d): d is MediaDeviceInfo =>
          d.kind === "videoinput" && d.deviceId !== ""
        )
        .map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind as "videoinput" }));
      const mics = devices
        .filter((d): d is MediaDeviceInfo =>
          d.kind === "audioinput" && d.deviceId !== ""
        )
        .map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind as "audioinput" }));

      setCameras(cams);
      setMicrophones(mics);

      if (cams.length > 0 && !selectedCamera) {
        setSelectedCamera(cams[0].deviceId);
      }
      if (mics.length > 0 && !selectedMic) {
        setSelectedMic(mics[0].deviceId);
      }
    } catch {
      // Non-critical — silently ignore; we'll show error when getUserMedia fails
    }
  }, [selectedCamera, selectedMic]);

  // ── Request permissions and start preview ────────────────────────────────
  const startPreview = useCallback(
    async (cameraId: string, micId: string) => {
      // Stop any existing preview track
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const constraints: MediaStreamConstraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: micId ? { deviceId: { exact: micId } } : true,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setPermission("granted");

        // After getting a stream, re-enumerate so labels populate
        await enumerateDevices();
      } catch (err: unknown) {
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;

        if (err instanceof DOMException) {
          if (
            err.name === "NotAllowedError" ||
            err.name === "PermissionDeniedError"
          ) {
            setPermission("denied");
          } else if (
            err.name === "NotFoundError" ||
            err.name === "DevicesNotFoundError"
          ) {
            setPermission("not_found");
          } else {
            setPermission("denied");
          }
        } else {
          setPermission("denied");
        }
      }
    },
    [enumerateDevices]
  );

  // ── Initial mount: enumerate devices then request permission ─────────────
  useEffect(() => {
    if (!browserSupported) return;

    // Try silent enumeration first (no permission required in many browsers)
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const cams = devices.filter((d) => d.kind === "videoinput");
        const mics = devices.filter((d) => d.kind === "audioinput");

        const firstCam = cams[0]?.deviceId ?? "";
        const firstMic = mics[0]?.deviceId ?? "";

        // Always request getUserMedia to trigger permission prompt
        startPreview(firstCam, firstMic);
      })
      .catch(() => {
        startPreview("", "");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserSupported]);

  // ── Re-start preview when device selection changes ───────────────────────
  useEffect(() => {
    if (permission !== "granted" || status !== "idle") return;
    if (!selectedCamera && !selectedMic) return;
    startPreview(selectedCamera, selectedMic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamera, selectedMic]);

  // ── Handle device-selector change events ─────────────────────────────────
  const handleCameraChange = useCallback(
    (deviceId: string) => {
      setSelectedCamera(deviceId);
    },
    []
  );

  const handleMicChange = useCallback(
    (deviceId: string) => {
      setSelectedMic(deviceId);
    },
    []
  );

  // ── Load channel info (lazy — only when going live) ───────────────────────
  const loadChannel = useCallback(async (): Promise<ChannelInfo | null> => {
    if (channel) return channel;
    setChannelLoading(true);
    try {
      const res = await getMyChannel();
      if (res.success && res.channel) {
        setChannel(res.channel);
        return res.channel;
      }
      return null;
    } catch {
      return null;
    } finally {
      setChannelLoading(false);
    }
  }, [channel]);

  // ── Quality estimator based on bytes/sec ─────────────────────────────────
  const recordChunkSize = useCallback((bytes: number) => {
    bytesSentRef.current.push(bytes);
    // Keep only last 5 chunks for rolling average
    if (bytesSentRef.current.length > 5) {
      bytesSentRef.current.shift();
    }
    const avg =
      bytesSentRef.current.reduce((a, b) => a + b, 0) /
      bytesSentRef.current.length;
    // ~125KB/s = good (1 Mbps), ~50KB/s = fair, below = poor
    if (avg >= 100_000) setQuality("good");
    else if (avg >= 40_000) setQuality("fair");
    else setQuality("poor");
  }, []);

  // ── Go Live ───────────────────────────────────────────────────────────────
  const handleGoLive = useCallback(async () => {
    setStreamError(null);

    if (!streamRef.current) {
      setStreamError(t.cameraPermissionDenied);
      return;
    }

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      setStreamError(t.browserNotSupported);
      return;
    }

    setStatus("connecting");

    // 1. Fetch channel info
    const chan = await loadChannel();
    if (!chan) {
      setStreamError(t.noChannelAssigned);
      setStatus("error");
      return;
    }

    // 2. Connect socket
    const socket = connectSocket();
    socketRef.current = socket;

    // 3. Register socket event listeners
    const onStarted = () => {
      setStatus("live");
      startTimeRef.current = Date.now();
      bytesSentRef.current = [];
      setDurationSec(0);
      durationTimerRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    };

    const onStopped = () => {
      setStatus("idle");
      clearDurationTimer();
      setDurationSec(0);
    };

    const onStreamError = (data: { message?: string }) => {
      setStreamError(data.message ?? t.streamError);
      setStatus("error");
      stopMediaRecorder();
      clearDurationTimer();
    };

    const onViewerCount = (data: { count: number }) => {
      setViewerCount(data.count);
    };

    socket.on("stream:started", onStarted);
    socket.on("stream:stopped", onStopped);
    socket.on("stream:error", onStreamError);
    socket.on("live:viewer_count", onViewerCount);

    // 4. Emit stream:start
    socket.emit("stream:start", { channelRef: chan.ref });

    // 5. Create MediaRecorder
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(streamRef.current, { mimeType });
    } catch {
      setStreamError(t.browserNotSupported);
      setStatus("error");
      socket.off("stream:started", onStarted);
      socket.off("stream:stopped", onStopped);
      socket.off("stream:error", onStreamError);
      socket.off("live:viewer_count", onViewerCount);
      return;
    }

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0 && socket.connected) {
        socket.emit("stream:data", e.data);
        recordChunkSize(e.data.size);
      }
    };

    recorder.onerror = () => {
      setStreamError(t.streamError);
      setStatus("error");
      clearDurationTimer();
    };

    recorder.start(1000); // 1-second chunks
    recorderRef.current = recorder;
  }, [t, loadChannel, recordChunkSize]);

  // ── Stop Streaming ────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    setStatus("stopping");
    stopMediaRecorder();

    if (socketRef.current?.connected) {
      socketRef.current.emit("stream:stop");
    }

    // Remove stream-specific listeners but keep socket alive
    if (socketRef.current) {
      socketRef.current.off("stream:started");
      socketRef.current.off("stream:stopped");
      socketRef.current.off("stream:error");
      socketRef.current.off("live:viewer_count");
    }

    clearDurationTimer();
    setDurationSec(0);
    setViewerCount(0);
    setStatus("idle");
  }, []);

  // ── Retry after permission error ──────────────────────────────────────────
  const handleRetryPermission = useCallback(() => {
    setPermission("unknown");
    setStreamError(null);
    startPreview(selectedCamera, selectedMic);
  }, [startPreview, selectedCamera, selectedMic]);

  // ── Cleanup helpers ───────────────────────────────────────────────────────
  function stopMediaRecorder() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
  }

  function clearDurationTimer() {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }

  // ── Unmount cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMediaRecorder();
      clearDurationTimer();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.off("stream:started");
        socketRef.current.off("stream:stopped");
        socketRef.current.off("stream:error");
        socketRef.current.off("live:viewer_count");
      }
    };
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isStreaming = status === "live" || status === "stopping";
  const isConnecting = status === "connecting" || channelLoading;
  const canGoLive =
    permission === "granted" &&
    !isStreaming &&
    status !== "connecting" &&
    !channelLoading;

  const qualityLabel = useMemo(() => {
    if (quality === "good") return t.qualityGood;
    if (quality === "fair") return t.qualityFair;
    return t.qualityPoor;
  }, [quality, t]);

  const qualityColor = useMemo(() => {
    if (quality === "good") return "#5ED1C4";
    if (quality === "fair") return "#FFD60A";
    return "#FF453A";
  }, [quality]);

  // ── Unsupported browser ───────────────────────────────────────────────────
  if (!browserSupported) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(255,69,58,0.15)" }}
        >
          <WifiOff className="w-7 h-7" style={{ color: "#FF453A" }} aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-pnp-textSecondary max-w-xs">
          {t.browserNotSupported}
        </p>
      </div>
    );
  }

  // ── Permission denied / not found ─────────────────────────────────────────
  if (permission === "denied" || permission === "not_found") {
    const message =
      permission === "not_found" ? t.cameraNotFound : t.cameraPermissionDenied;

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(255,69,58,0.15)" }}
        >
          <VideoOff className="w-7 h-7" style={{ color: "#FF453A" }} aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">{t.cameraUnavailable}</p>
          <p className="text-xs text-pnp-textSecondary max-w-xs">{message}</p>
          {permission === "denied" && (
            <p className="text-xs text-pnp-textSecondary max-w-xs mt-2 leading-relaxed">
              {t.cameraPermissionHowTo}
            </p>
          )}
        </div>
        {permission === "denied" && (
          <button
            onClick={handleRetryPermission}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {t.retryPermissions}
          </button>
        )}
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">{t.browserStreamerTitle}</h2>
          <p className="text-xs text-pnp-textSecondary mt-0.5">{t.browserStreamerSubtitle}</p>
        </div>
        <StatusBadge status={status} t={t} />
      </div>

      {/* Camera preview */}
      <div
        className="relative w-full overflow-hidden rounded-2xl bg-pnp-surface border border-pnp-border"
        style={{ aspectRatio: "16/9" }}
      >
        {/* Video element — always mounted so srcObject assignment works */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          aria-label="Camera preview"
        />

        {/* Preview loading overlay */}
        {permission === "unknown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-pnp-surface">
            <div className="w-10 h-10 rounded-full border-2 border-pnp-border border-t-pnp-accent animate-spin" />
            <p className="text-xs text-pnp-textSecondary">{t.previewLoading}</p>
          </div>
        )}

        {/* Live overlay badge */}
        {status === "live" && (
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: "rgba(239,68,68,0.9)", backdropFilter: "blur(4px)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
              {t.statusLive}
            </span>
          </div>
        )}

        {/* Stats overlay — visible when live */}
        {status === "live" && (
          <div
            className="absolute bottom-3 left-3 right-3 flex items-center justify-between"
          >
            {/* Viewers */}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              {t.viewers(viewerCount)}
            </span>

            {/* Duration */}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white tabular-nums"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {formatDuration(durationSec)}
            </span>

            {/* Quality */}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
              style={{
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(4px)",
                color: qualityColor,
              }}
            >
              <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
              {qualityLabel}
            </span>
          </div>
        )}
      </div>

      {/* Device selectors — hidden while streaming to avoid disruption */}
      {!isStreaming && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DeviceSelect
            id="camera-select"
            label={t.cameraLabel}
            value={selectedCamera}
            options={cameras}
            disabled={isConnecting}
            onChange={handleCameraChange}
            icon={<Video className="w-3.5 h-3.5" aria-hidden="true" />}
            placeholder={t.selectCamera}
          />
          <DeviceSelect
            id="microphone-select"
            label={t.microphoneLabel}
            value={selectedMic}
            options={microphones}
            disabled={isConnecting}
            onChange={handleMicChange}
            icon={<Mic className="w-3.5 h-3.5" aria-hidden="true" />}
            placeholder={t.selectMicrophone}
          />
        </div>
      )}

      {/* Error banner */}
      {streamError && (
        <div
          className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm"
          style={{ background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)" }}
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle
            className="w-4 h-4 flex-shrink-0 mt-0.5"
            style={{ color: "#FF453A" }}
            aria-hidden="true"
          />
          <span className="text-white/80 min-w-0 break-words">{streamError}</span>
        </div>
      )}

      {/* No-channel error with try-again action */}
      {status === "error" && streamError === t.noChannelAssigned && (
        <button
          onClick={() => {
            setStatus("idle");
            setStreamError(null);
          }}
          className="
            w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
            text-sm font-semibold text-pnp-textSecondary
            border border-pnp-border
            hover:bg-pnp-surfaceHover
            active:scale-[0.98]
            transition-all duration-150
          "
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          {t.tryAgain}
        </button>
      )}

      {/* Primary action button */}
      {status !== "error" && (
        <div className="pt-1">
          {isStreaming ? (
            <button
              onClick={handleStop}
              disabled={status === "stopping"}
              className="
                w-full flex items-center justify-center gap-2.5
                min-h-[52px] px-6 rounded-2xl
                text-sm font-bold text-white
                transition-all duration-150
                disabled:opacity-50 disabled:cursor-not-allowed
                hover:opacity-90 active:scale-[0.98]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2
              "
              style={{ background: "linear-gradient(135deg, #b91c1c, #dc2626)" }}
              aria-label={t.stopStreaming}
            >
              <StopCircle className="w-5 h-5" aria-hidden="true" />
              {status === "stopping" ? t.connecting : t.stopStreaming}
            </button>
          ) : (
            <button
              onClick={handleGoLive}
              disabled={!canGoLive || isConnecting}
              className="
                w-full flex items-center justify-center gap-2.5
                min-h-[52px] px-6 rounded-2xl
                text-sm font-bold text-white
                btn-gradient
                transition-all duration-150
                disabled:opacity-50 disabled:cursor-not-allowed
                hover:opacity-90 active:scale-[0.98]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2
              "
              aria-label={t.startStreaming}
            >
              {isConnecting ? (
                <>
                  <span
                    className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"
                    aria-hidden="true"
                  />
                  {t.connecting}
                </>
              ) : (
                <>
                  <Radio className="w-5 h-5" aria-hidden="true" />
                  {t.startStreaming}
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Stats row — shown when live (below the button for accessibility focus order) */}
      {status === "live" && (
        <dl
          className="grid grid-cols-3 gap-2"
          aria-label="Stream statistics"
        >
          <div className="glass-card-sm p-3 text-center">
            <dt className="text-xs text-pnp-textSecondary mb-0.5">{t.duration}</dt>
            <dd className="text-sm font-bold text-white tabular-nums">
              {formatDuration(durationSec)}
            </dd>
          </div>
          <div className="glass-card-sm p-3 text-center">
            <dt className="text-xs text-pnp-textSecondary mb-0.5">
              <Users className="w-3 h-3 inline mr-0.5" aria-hidden="true" />
              {t.viewers(viewerCount).replace(/\d+\s/, "")}
            </dt>
            <dd className="text-sm font-bold text-white">{viewerCount}</dd>
          </div>
          <div className="glass-card-sm p-3 text-center">
            <dt className="text-xs text-pnp-textSecondary mb-0.5">{t.connectionQuality}</dt>
            <dd
              className="text-sm font-bold"
              style={{ color: qualityColor }}
            >
              {qualityLabel}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
