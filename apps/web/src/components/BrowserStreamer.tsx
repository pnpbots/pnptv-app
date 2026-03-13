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
const Monitor = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
const MonitorOff = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 17H4a2 2 0 0 1-2-2V5c0-.53.19-1.04.54-1.43"/><path d="M22 15a2 2 0 0 0 .59-1.43V5a2 2 0 0 0-2-2H9"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const Eye = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const EyeOff = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const LayoutGrid = (p: React.SVGProps<SVGSVGElement>) => <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>;
import { useI18n } from "@/lib/i18n";
import { getMyChannel } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import type { Socket } from "socket.io-client";

// ─── Quality Presets ─────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  { id: "720p",  label: "720p HD",      width: 1280, height: 720,  videoBitrate: 2_500_000, audioBitrate: 128000, fps: 30 },
  { id: "480p",  label: "480p SD",      width: 854,  height: 480,  videoBitrate: 1_000_000, audioBitrate: 128000, fps: 30 },
  { id: "360p",  label: "360p Low",     width: 640,  height: 360,  videoBitrate:   600_000, audioBitrate:  96000, fps: 24 },
  { id: "1080p", label: "1080p Full HD",width: 1920, height: 1080, videoBitrate: 4_500_000, audioBitrate: 192000, fps: 30 },
] as const;

type PresetId = typeof QUALITY_PRESETS[number]["id"];
type QualityPreset = typeof QUALITY_PRESETS[number];

// ─── PiP position cycling ─────────────────────────────────────────────────────

type PipPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
const PIP_POSITIONS: PipPosition[] = ["bottom-right", "bottom-left", "top-right", "top-left"];

// ─── Types ───────────────────────────────────────────────────────────────────

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

  // Quality preset
  const [selectedPresetId, setSelectedPresetId] = useState<PresetId>("720p");
  const selectedPreset = useMemo(
    (): QualityPreset =>
      QUALITY_PRESETS.find((p) => p.id === selectedPresetId) ?? QUALITY_PRESETS[0],
    [selectedPresetId]
  );

  // Screen sharing + PiP state
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [pipPosition, setPipPosition] = useState<PipPosition>("bottom-right");
  const [showPip, setShowPip] = useState(true);

  // Refs — camera/mic stream
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Refs — screen share
  const screenStreamRef = useRef<MediaStream | null>(null);
  // Refs — hidden camera video element for PiP compositing
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  // Refs — screen video element for compositing
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  // Refs — canvas for composited output
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Refs — the captureStream() from the canvas
  const canvasStreamRef = useRef<MediaStream | null>(null);
  // Refs — rAF handle for the draw loop
  const rafRef = useRef<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Track bytes sent for quality estimation
  const bytesSentRef = useRef<number[]>([]);
  // FE-H2: chunk queue for backpressure — drop oldest when buffer is full
  const MAX_QUEUED_CHUNKS = 5;
  const chunkQueueRef = useRef<Blob[]>([]);
  // FE-C4: store socket handler references so cleanup can pass them to .off()
  const socketHandlersRef = useRef<{
    onStarted: (() => void) | null;
    onStopped: (() => void) | null;
    onStreamError: ((data: { message?: string }) => void) | null;
    onViewerCount: ((data: { count: number }) => void) | null;
    onDisconnect: (() => void) | null;
  }>({
    onStarted: null,
    onStopped: null,
    onStreamError: null,
    onViewerCount: null,
    onDisconnect: null,
  });

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
        .filter((d) =>
          d.kind === "videoinput" && d.deviceId !== ""
        )
        .map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind as "videoinput" }));
      const mics = devices
        .filter((d) =>
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
    async (cameraId: string, micId: string, preset?: QualityPreset) => {
      const p = preset ?? selectedPreset;

      // Stop any existing preview track
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: p.width },
        height: { ideal: p.height },
        frameRate: { ideal: p.fps },
        ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
      };

      const audioConstraints: MediaTrackConstraints = {
        ...(micId ? { deviceId: { exact: micId } } : {}),
      };

      const constraints: MediaStreamConstraints = {
        video: videoConstraints,
        audio: audioConstraints,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enumerateDevices, selectedPreset]
  );

  // ── Initial mount: enumerate devices then request permission ─────────────
  useEffect(() => {
    if (!browserSupported) return;

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const cams = devices.filter((d) => d.kind === "videoinput");
        const mics = devices.filter((d) => d.kind === "audioinput");

        const firstCam = cams[0]?.deviceId ?? "";
        const firstMic = mics[0]?.deviceId ?? "";

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
    if (!isScreenSharing) {
      startPreview(selectedCamera, selectedMic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamera, selectedMic]);

  // ── Handle device-selector change events ─────────────────────────────────
  const handleCameraChange = useCallback((deviceId: string) => {
    setSelectedCamera(deviceId);
  }, []);

  const handleMicChange = useCallback((deviceId: string) => {
    setSelectedMic(deviceId);
  }, []);

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
    if (bytesSentRef.current.length > 5) {
      bytesSentRef.current.shift();
    }
    const avg =
      bytesSentRef.current.reduce((a, b) => a + b, 0) /
      bytesSentRef.current.length;
    if (avg >= 100_000) setQuality("good");
    else if (avg >= 40_000) setQuality("fair");
    else setQuality("poor");
  }, []);

  // ── Canvas compositing loop (screen + camera PiP) ─────────────────────────
  const stopCanvasComposite = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startCanvasComposite = useCallback(
    (preset: QualityPreset, pip: PipPosition, pipVisible: boolean) => {
      const canvas = canvasRef.current;
      const screenVideo = screenVideoRef.current;
      const cameraVideo = cameraVideoRef.current;
      if (!canvas || !screenVideo) return;

      canvas.width = preset.width;
      canvas.height = preset.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const frameInterval = 1000 / preset.fps;
      let lastDraw = 0;

      const draw = (now: number) => {
        rafRef.current = requestAnimationFrame(draw);

        if (now - lastDraw < frameInterval) return;
        lastDraw = now;

        // Draw screen capture
        if (screenVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Draw camera PiP
        if (
          pipVisible &&
          cameraVideo &&
          cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          const pipW = Math.round(canvas.width * 0.25);
          const pipH = Math.round(pipW * (9 / 16));
          const margin = 12;

          let pipX: number;
          let pipY: number;

          if (pip === "bottom-right") {
            pipX = canvas.width - pipW - margin;
            pipY = canvas.height - pipH - margin;
          } else if (pip === "bottom-left") {
            pipX = margin;
            pipY = canvas.height - pipH - margin;
          } else if (pip === "top-right") {
            pipX = canvas.width - pipW - margin;
            pipY = margin;
          } else {
            pipX = margin;
            pipY = margin;
          }

          // Rounded clip for PiP
          const radius = 8;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pipX + radius, pipY);
          ctx.lineTo(pipX + pipW - radius, pipY);
          ctx.quadraticCurveTo(pipX + pipW, pipY, pipX + pipW, pipY + radius);
          ctx.lineTo(pipX + pipW, pipY + pipH - radius);
          ctx.quadraticCurveTo(pipX + pipW, pipY + pipH, pipX + pipW - radius, pipY + pipH);
          ctx.lineTo(pipX + radius, pipY + pipH);
          ctx.quadraticCurveTo(pipX, pipY + pipH, pipX, pipY + pipH - radius);
          ctx.lineTo(pipX, pipY + radius);
          ctx.quadraticCurveTo(pipX, pipY, pipX + radius, pipY);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(cameraVideo, pipX, pipY, pipW, pipH);
          ctx.restore();

          // Border around PiP
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pipX + radius, pipY);
          ctx.lineTo(pipX + pipW - radius, pipY);
          ctx.quadraticCurveTo(pipX + pipW, pipY, pipX + pipW, pipY + radius);
          ctx.lineTo(pipX + pipW, pipY + pipH - radius);
          ctx.quadraticCurveTo(pipX + pipW, pipY + pipH, pipX + pipW - radius, pipY + pipH);
          ctx.lineTo(pipX + radius, pipY + pipH);
          ctx.quadraticCurveTo(pipX, pipY + pipH, pipX, pipY + pipH - radius);
          ctx.lineTo(pipX, pipY + radius);
          ctx.quadraticCurveTo(pipX, pipY, pipX + radius, pipY);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
      };

      rafRef.current = requestAnimationFrame(draw);
    },
    []
  );

  // Re-run compositing when PiP settings change while screen sharing is active
  useEffect(() => {
    if (!isScreenSharing) return;
    stopCanvasComposite();
    startCanvasComposite(selectedPreset, pipPosition, showPip);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipPosition, showPip, isScreenSharing]);

  // ── Start screen sharing ──────────────────────────────────────────────────
  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      screenStreamRef.current = screenStream;

      // Build hidden screen video element for canvas input
      const screenVideo = document.createElement("video");
      screenVideo.autoplay = true;
      screenVideo.playsInline = true;
      screenVideo.muted = true;
      screenVideo.srcObject = screenStream;
      screenVideoRef.current = screenVideo;
      await screenVideo.play().catch(() => { /* autoplay may be handled by browser */ });

      // Build hidden camera video element for PiP input
      if (streamRef.current) {
        const camVideo = document.createElement("video");
        camVideo.autoplay = true;
        camVideo.playsInline = true;
        camVideo.muted = true;
        camVideo.srcObject = streamRef.current;
        cameraVideoRef.current = camVideo;
        await camVideo.play().catch(() => { /* autoplay may be handled by browser */ });
      }

      // Show canvas composited output in the preview <video>
      const canvas = canvasRef.current;
      if (canvas) {
        // captureStream fps=0 means we drive it manually via rAF
        const canvasStream = canvas.captureStream(0);
        canvasStreamRef.current = canvasStream;

        // Merge audio tracks from camera stream into canvas stream
        if (streamRef.current) {
          streamRef.current.getAudioTracks().forEach((track) => {
            canvasStream.addTrack(track);
          });
        }

        if (videoRef.current) {
          videoRef.current.srcObject = canvasStream;
        }

        startCanvasComposite(selectedPreset, pipPosition, showPip);
      }

      setIsScreenSharing(true);

      // Auto-revert when user stops sharing via browser UI
      const screenVideoTrack = screenStream.getVideoTracks()[0];
      if (screenVideoTrack) {
        screenVideoTrack.addEventListener("ended", () => {
          stopScreenShare();
        });
      }
    } catch (err: unknown) {
      // User cancelled getDisplayMedia — not an error worth surfacing
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      setStreamError("Screen sharing failed. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset, pipPosition, showPip, startCanvasComposite]);

  // ── Stop screen sharing ───────────────────────────────────────────────────
  const stopScreenShare = useCallback(() => {
    stopCanvasComposite();

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }

    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
      screenVideoRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
      cameraVideoRef.current = null;
    }

    canvasStreamRef.current = null;

    // Restore camera stream in the preview element
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }

    setIsScreenSharing(false);
  }, [stopCanvasComposite]);

  // ── Toggle screen sharing ─────────────────────────────────────────────────
  const handleToggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  // ── Cycle PiP position ────────────────────────────────────────────────────
  const handleCyclePipPosition = useCallback(() => {
    setPipPosition((prev) => {
      const idx = PIP_POSITIONS.indexOf(prev);
      return PIP_POSITIONS[(idx + 1) % PIP_POSITIONS.length];
    });
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

    // 3. Register socket event listeners — store in ref so handleStop and
    //    unmount cleanup can call .off() with the specific handler reference (FE-C4)
    // Flag to track if MediaRecorder has been started by the onStarted handler
    let recorderStartedByAck = false;

    const onStarted = () => {
      setStatus("live");
      startTimeRef.current = Date.now();
      bytesSentRef.current = [];
      setDurationSec(0);
      durationTimerRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Start MediaRecorder only AFTER FFmpeg is ready on the backend.
      // Previously, the recorder started immediately after socket.emit("stream:start"),
      // creating a race condition where chunks arrived before FFmpeg was spawned.
      if (recorderRef.current && recorderRef.current.state === "inactive" && !recorderStartedByAck) {
        recorderStartedByAck = true;
        recorderRef.current.start(1000); // 1-second chunks
      }
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

    // SOCK-H2: show error state and stop recording when the socket disconnects
    // mid-stream so the user is not left staring at a frozen UI.
    const onDisconnect = () => {
      setStreamError(t.streamError ?? "Connection lost. Please try going live again.");
      setStatus("error");
      clearDurationTimer();
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    };

    socketHandlersRef.current = { onStarted, onStopped, onStreamError, onViewerCount, onDisconnect };

    socket.on("stream:started", onStarted);
    socket.on("stream:stopped", onStopped);
    socket.on("stream:error", onStreamError);
    socket.on("live:viewer_count", onViewerCount);
    socket.on("disconnect", onDisconnect);

    // 4. Emit stream:start with quality params
    socket.emit("stream:start", {
      channelRef: chan.ref,
      videoBitrate: selectedPreset.videoBitrate,
      audioBitrate: selectedPreset.audioBitrate,
      fps: selectedPreset.fps,
    });

    // 5. Determine which stream to record:
    //    - Screen sharing active → use the canvas composite stream
    //    - Camera only → use the raw camera stream
    const recordStream = isScreenSharing && canvasStreamRef.current
      ? canvasStreamRef.current
      : streamRef.current;

    if (!recordStream) {
      setStreamError(t.cameraPermissionDenied);
      setStatus("error");
      // FE-C4: pass specific handler references to .off()
      socket.off("stream:started", onStarted);
      socket.off("stream:stopped", onStopped);
      socket.off("stream:error", onStreamError);
      socket.off("live:viewer_count", onViewerCount);
      socket.off("disconnect", onDisconnect);
      socketHandlersRef.current = { onStarted: null, onStopped: null, onStreamError: null, onViewerCount: null, onDisconnect: null };
      return;
    }

    // 6. Create MediaRecorder
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(recordStream, {
        mimeType,
        videoBitsPerSecond: selectedPreset.videoBitrate,
        audioBitsPerSecond: selectedPreset.audioBitrate,
      });
    } catch {
      setStreamError(t.browserNotSupported);
      setStatus("error");
      // FE-C4: pass specific handler references to .off()
      socket.off("stream:started", onStarted);
      socket.off("stream:stopped", onStopped);
      socket.off("stream:error", onStreamError);
      socket.off("live:viewer_count", onViewerCount);
      socket.off("disconnect", onDisconnect);
      socketHandlersRef.current = { onStarted: null, onStopped: null, onStreamError: null, onViewerCount: null, onDisconnect: null };
      return;
    }

    // FE-H2: backpressure guard — drop oldest chunk if the queue is full
    // so a slow network never causes unbounded memory growth.
    chunkQueueRef.current = [];
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0 && socket.connected) {
        if (chunkQueueRef.current.length >= MAX_QUEUED_CHUNKS) {
          // Drop the oldest chunk to make room
          chunkQueueRef.current.shift();
        }
        chunkQueueRef.current.push(e.data);
        const chunk = chunkQueueRef.current.shift()!;
        chunk.arrayBuffer().then((ab) => socket.emit("stream:data", ab));
        recordChunkSize(e.data.size);
      }
    };

    recorder.onerror = () => {
      setStreamError(t.streamError);
      setStatus("error");
      clearDurationTimer();
    };

    // Don't start the recorder here — it will be started by onStarted() after
    // the backend confirms FFmpeg is ready (stream:started acknowledgment).
    // Safety timeout: if stream:started never arrives within 10s, start anyway.
    const safetyTimer = setTimeout(() => {
      if (recorderRef.current?.state === "inactive" && !recorderStartedByAck) {
        recorderStartedByAck = true;
        recorderRef.current.start(1000);
      }
    }, 10000);
    recorderRef.current = recorder;

    // Store the safety timer so stopMediaRecorder can clear it
    (recorder as any)._safetyTimer = safetyTimer;
  }, [t, loadChannel, recordChunkSize, selectedPreset, isScreenSharing]);

  // ── Stop Streaming ────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    setStatus("stopping");
    stopMediaRecorder();
    chunkQueueRef.current = [];

    if (socketRef.current?.connected) {
      socketRef.current.emit("stream:stop");
    }

    // FE-C4: remove only the specific handlers registered during this stream
    // session — avoids accidentally removing global Socket.IO listeners.
    if (socketRef.current) {
      const h = socketHandlersRef.current;
      if (h.onStarted) socketRef.current.off("stream:started", h.onStarted);
      if (h.onStopped) socketRef.current.off("stream:stopped", h.onStopped);
      if (h.onStreamError) socketRef.current.off("stream:error", h.onStreamError);
      if (h.onViewerCount) socketRef.current.off("live:viewer_count", h.onViewerCount);
      if (h.onDisconnect) socketRef.current.off("disconnect", h.onDisconnect);
      socketHandlersRef.current = { onStarted: null, onStopped: null, onStreamError: null, onViewerCount: null, onDisconnect: null };
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
    if (recorderRef.current) {
      // Clear safety timer if it hasn't fired yet
      clearTimeout((recorderRef.current as any)._safetyTimer);
      if (recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
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
      stopCanvasComposite();
      chunkQueueRef.current = [];
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }
      // FE-C4: remove only the specific handlers stored in the ref
      if (socketRef.current) {
        const h = socketHandlersRef.current;
        if (h.onStarted) socketRef.current.off("stream:started", h.onStarted);
        if (h.onStopped) socketRef.current.off("stream:stopped", h.onStopped);
        if (h.onStreamError) socketRef.current.off("stream:error", h.onStreamError);
        if (h.onViewerCount) socketRef.current.off("live:viewer_count", h.onViewerCount);
        if (h.onDisconnect) socketRef.current.off("disconnect", h.onDisconnect);
        socketHandlersRef.current = { onStarted: null, onStopped: null, onStreamError: null, onViewerCount: null, onDisconnect: null };
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* Camera / screen preview */}
      <div
        className="relative w-full overflow-hidden rounded-2xl bg-pnp-surface border border-pnp-border"
        style={{ aspectRatio: "16/9" }}
      >
        {/* Hidden canvas for compositing — always mounted so ref is available */}
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

        {/* Video element — always mounted so srcObject assignment works */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          aria-label={isScreenSharing ? "Screen share preview" : "Camera preview"}
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

        {/* Screen badge — shown when screen sharing but not yet live */}
        {isScreenSharing && status !== "live" && (
          <div className="absolute top-3 left-3">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: "rgba(94,209,196,0.85)", backdropFilter: "blur(4px)" }}
            >
              <Monitor className="w-3 h-3" aria-hidden="true" />
              Screen
            </span>
          </div>
        )}

        {/* Screen badge alongside LIVE badge */}
        {isScreenSharing && status === "live" && (
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: "rgba(239,68,68,0.9)", backdropFilter: "blur(4px)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
              {t.statusLive}
            </span>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: "rgba(94,209,196,0.75)", backdropFilter: "blur(4px)" }}
            >
              <Monitor className="w-3 h-3" aria-hidden="true" />
              Screen
            </span>
          </div>
        )}

        {/* PiP controls — shown when screen sharing is active */}
        {isScreenSharing && (
          <div
            className="absolute bottom-3 right-3 flex items-center gap-1.5"
            aria-label="Picture-in-picture controls"
          >
            {/* Toggle PiP visibility */}
            <button
              onClick={() => setShowPip((v) => !v)}
              className="
                flex items-center justify-center w-9 h-9 rounded-xl
                text-white transition-all duration-150
                hover:opacity-90 active:scale-95
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
              "
              style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
              aria-label={showPip ? "Hide camera" : "Show camera"}
              title={showPip ? "Hide camera" : "Show camera"}
            >
              {showPip ? (
                <Eye className="w-4 h-4" aria-hidden="true" />
              ) : (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            {/* Cycle PiP position */}
            <button
              onClick={handleCyclePipPosition}
              className="
                flex items-center justify-center w-9 h-9 rounded-xl
                text-white transition-all duration-150
                hover:opacity-90 active:scale-95
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
              "
              style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
              aria-label="Move camera position"
              title="Move camera position"
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Stats overlay — visible when live */}
        {status === "live" && !isScreenSharing && (
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              {t.viewers(viewerCount)}
            </span>

            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white tabular-nums"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {formatDuration(durationSec)}
            </span>

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

        {/* Stats overlay when live + screen sharing (left side only to avoid overlap with PiP controls) */}
        {status === "live" && isScreenSharing && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              {t.viewers(viewerCount)}
            </span>
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white tabular-nums"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {formatDuration(durationSec)}
            </span>
          </div>
        )}
      </div>

      {/* Quality preset selector — shown when not streaming */}
      {!isStreaming && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-pnp-textSecondary">Quality</span>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Stream quality preset"
          >
            {QUALITY_PRESETS.map((preset) => {
              const active = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    setSelectedPresetId(preset.id);
                    if (permission === "granted" && status === "idle" && !isScreenSharing) {
                      startPreview(selectedCamera, selectedMic, preset);
                    }
                  }}
                  disabled={isConnecting}
                  className={[
                    "inline-flex items-center justify-center px-4 rounded-full text-xs font-semibold transition-all duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "active:scale-95",
                    // min touch target height
                    "min-h-[44px] sm:min-h-[36px]",
                    active
                      ? "btn-gradient text-white shadow-sm"
                      : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary",
                  ].join(" ")}
                  aria-pressed={active}
                  aria-label={`Select ${preset.label} quality`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {/* Primary action row — Go Live / Stop  +  Screen Share toggle */}
      {status !== "error" && (
        <div className="pt-1 flex items-center gap-2">
          {/* Screen share toggle — shown only when not streaming, or when live */}
          {(canGoLive || status === "live") && (
            <button
              onClick={handleToggleScreenShare}
              disabled={isConnecting}
              className={[
                "flex items-center justify-center min-h-[52px] min-w-[52px] px-3 rounded-2xl",
                "text-sm font-semibold transition-all duration-150",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "hover:opacity-90 active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2",
                "border",
                isScreenSharing
                  ? "bg-pnp-accent/20 border-pnp-accent text-pnp-accent"
                  : "bg-pnp-surface border-pnp-border text-pnp-textSecondary",
              ].join(" ")}
              aria-label={isScreenSharing ? "Stop screen sharing" : "Share screen"}
              title={isScreenSharing ? "Stop screen sharing" : "Share screen"}
            >
              {isScreenSharing ? (
                <MonitorOff className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Monitor className="w-5 h-5" aria-hidden="true" />
              )}
            </button>
          )}

          {/* Go Live / Stop button */}
          <div className="flex-1">
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
        </div>
      )}

      {/* Stats row — shown when live */}
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
