import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  lazy,
  Suspense,
} from "react";
import { connectSocket } from "@/lib/socket";
import {
  getMyChannel,
  getStreamerSettings,
  updateStreamerSettings,
  getStreamProfile,
  saveStreamProfile,
  startStreamAutoMessages,
  stopStreamAutoMessages,
} from "@/lib/api";
import type { StreamerSettings } from "@/lib/api";
import type { Socket } from "socket.io-client";

// ─── Inline SVG icons (avoids lucide-react dependency) ────────────────────────

const ArrowLeft = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);
const Radio = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);
const StopCircle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" />
  </svg>
);
const MicIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const MicOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const VideoIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);
const VideoOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /><line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const MonitorIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const PauseIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
  </svg>
);
const CameraIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
  </svg>
);
const RefreshCwIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const UsersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const DownloadIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const LayersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
  </svg>
);
const SlidersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);
const SettingsIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const AlertTriangleIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const CheckIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const RotateCwIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────

type NetworkQuality = "wifi" | "4g" | "3g" | "2g" | "unknown";

/** Map navigator.connection.effectiveType + downlink → quality preset id */
function getAdaptivePresetId(conn: any): string {
  if (!conn) return "720p";
  const et: string = conn.effectiveType || "4g";
  const downlink: number = typeof conn.downlink === "number" ? conn.downlink : 10;
  if (et === "4g" && downlink >= 4) return "720p";
  if (et === "4g") return "480p";
  return "360p";
}

function getNetworkQuality(conn: any): NetworkQuality {
  if (!conn) return "unknown";
  const et: string = conn.effectiveType || "";
  if (et === "4g") return "4g";
  if (et === "3g") return "3g";
  if (et === "2g") return "2g";
  // type may be "wifi" on some browsers
  if ((conn.type || "") === "wifi") return "wifi";
  return "unknown";
}

function networkQualityColor(q: NetworkQuality): string {
  if (q === "wifi" || q === "4g") return "#5ED1C4";
  if (q === "3g") return "#FFD60A";
  return "#FF453A";
}

function networkQualityLabel(q: NetworkQuality): string {
  if (q === "wifi") return "WiFi";
  if (q === "4g") return "4G";
  if (q === "3g") return "3G";
  if (q === "2g") return "2G";
  return "Net";
}

type ActiveTab = "scenes" | "audio" | "filters" | "settings";
type Orientation = "portrait" | "landscape";
type HealthStatus = "good" | "degraded" | "critical";

interface QualityPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  videoBitrate: number;
  audioBitrate: number;
  fps: number;
}

const QUALITY_PRESETS: QualityPreset[] = [
  { id: "720p",  label: "720p HD",       width: 1280, height: 720,  videoBitrate: 2_500_000, audioBitrate: 128000, fps: 30 },
  { id: "480p",  label: "480p SD",       width: 854,  height: 480,  videoBitrate: 1_000_000, audioBitrate: 128000, fps: 30 },
  { id: "360p",  label: "360p Low",      width: 640,  height: 360,  videoBitrate: 600_000,   audioBitrate: 96000,  fps: 24 },
  { id: "1080p", label: "1080p Full HD", width: 1920, height: 1080, videoBitrate: 4_500_000, audioBitrate: 192000, fps: 30 },
];

interface StreamStats {
  bitrate: number;       // kbps
  fps: number;
  droppedFrames: number;
  bytesSent: number;
  latency: number;       // ms (socket ping)
}

interface DashboardState {
  isLive: boolean;
  isConnecting: boolean;
  selectedPreset: QualityPreset;
  activeTab: ActiveTab;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  streamStartTime: number | null;
  viewerCount: number;
  stats: StreamStats;
  isRecording: boolean;
  orientation: Orientation;
  autoReconnect: boolean;
  lowLatency: boolean;
  hardwareAccel: boolean;
  fps: 24 | 30 | 60;
}

type DashboardAction =
  | { type: "SET_LIVE"; payload: boolean }
  | { type: "SET_CONNECTING"; payload: boolean }
  | { type: "SET_TAB"; payload: ActiveTab }
  | { type: "SET_PRESET"; payload: QualityPreset }
  | { type: "SET_FPS"; payload: 24 | 30 | 60 }
  | { type: "TOGGLE_MUTE" }
  | { type: "TOGGLE_CAMERA" }
  | { type: "TOGGLE_SCREEN_SHARE" }
  | { type: "SET_STREAM_START"; payload: number | null }
  | { type: "SET_VIEWER_COUNT"; payload: number }
  | { type: "UPDATE_STATS"; payload: Partial<StreamStats> }
  | { type: "SET_RECORDING"; payload: boolean }
  | { type: "SET_ORIENTATION"; payload: Orientation }
  | { type: "TOGGLE_AUTO_RECONNECT" }
  | { type: "TOGGLE_LOW_LATENCY" }
  | { type: "TOGGLE_HW_ACCEL" }
  | { type: "RESET_STREAM" };

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "SET_LIVE":
      return { ...state, isLive: action.payload };
    case "SET_CONNECTING":
      return { ...state, isConnecting: action.payload };
    case "SET_TAB":
      return { ...state, activeTab: action.payload };
    case "SET_PRESET":
      return { ...state, selectedPreset: action.payload };
    case "SET_FPS":
      return { ...state, fps: action.payload };
    case "TOGGLE_MUTE":
      return { ...state, isMuted: !state.isMuted };
    case "TOGGLE_CAMERA":
      return { ...state, isCameraOff: !state.isCameraOff };
    case "TOGGLE_SCREEN_SHARE":
      return { ...state, isScreenSharing: !state.isScreenSharing };
    case "SET_STREAM_START":
      return { ...state, streamStartTime: action.payload };
    case "SET_VIEWER_COUNT":
      return { ...state, viewerCount: action.payload };
    case "UPDATE_STATS":
      return { ...state, stats: { ...state.stats, ...action.payload } };
    case "SET_RECORDING":
      return { ...state, isRecording: action.payload };
    case "SET_ORIENTATION":
      return { ...state, orientation: action.payload };
    case "TOGGLE_AUTO_RECONNECT":
      return { ...state, autoReconnect: !state.autoReconnect };
    case "TOGGLE_LOW_LATENCY":
      return { ...state, lowLatency: !state.lowLatency };
    case "TOGGLE_HW_ACCEL":
      return { ...state, hardwareAccel: !state.hardwareAccel };
    case "RESET_STREAM":
      return {
        ...state,
        isLive: false,
        isConnecting: false,
        streamStartTime: null,
        viewerCount: 0,
        stats: { bitrate: 0, fps: 0, droppedFrames: 0, bytesSent: 0, latency: 0 },
      };
    default:
      return state;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StreamerDashboardProps {
  socket?: any;
  onClose?: () => void;
  channel?: { ref: string; streamKey: string; rtmpUrl: string } | null;
}

// ─── Lazy sub-components ──────────────────────────────────────────────────────

// We use lazy + Suspense for each sub-component. If the module doesn't exist,
// the ErrorBoundary around each Suspense will catch the error and show a
// "Coming soon" placeholder instead of crashing the dashboard.

const SceneManager = lazy(() =>
  import("./SceneManager").catch(() => ({
    default: () => (
      <PlaceholderPanel label="Scene Manager" description="Scene management coming soon." />
    ),
  }))
);

const AudioMixer = lazy(() =>
  import("./AudioMixer").catch(() => ({
    default: () => (
      <PlaceholderPanel label="Audio Mixer" description="Audio mixing coming soon." />
    ),
  }))
);

const VideoFilters = lazy(() =>
  import("./VideoFilters").catch(() => ({
    default: () => (
      <PlaceholderPanel label="Video Filters" description="Video filters coming soon." />
    ),
  }))
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getSupportedMimeType(): string | null {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

function healthStatus(stats: StreamStats, targetBitrate: number): HealthStatus {
  if (targetBitrate === 0) return "good";
  const ratio = stats.bitrate / (targetBitrate / 1000);
  if (ratio >= 0.5) return "good";
  if (ratio >= 0.2) return "degraded";
  return "critical";
}

function healthColor(status: HealthStatus): string {
  if (status === "good") return "#5ED1C4";
  if (status === "degraded") return "#FFD60A";
  return "#FF453A";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlaceholderPanel({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center mx-4 my-4 rounded-2xl border border-pnp-border bg-pnp-surface">
      <div className="w-12 h-12 rounded-2xl bg-pnp-surface border border-pnp-border flex items-center justify-center">
        <LayersIcon className="w-6 h-6 text-pnp-textSecondary" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-pnp-textPrimary">{label}</p>
        <p className="text-xs text-pnp-textSecondary mt-0.5">{description}</p>
      </div>
    </div>
  );
}

class SubComponentErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; label: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <PlaceholderPanel
          label={this.props.label}
          description="This component is not available yet."
        />
      );
    }
    return this.props.children;
  }
}

interface TabPanelProps {
  label: string;
  children: React.ReactNode;
}

function TabPanel({ label, children }: TabPanelProps) {
  return (
    <SubComponentErrorBoundary label={label}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-pnp-border border-t-pnp-accent animate-spin" />
          </div>
        }
      >
        {children}
      </Suspense>
    </SubComponentErrorBoundary>
  );
}

// Sparkline: renders last N bitrate samples as a simple canvas line chart
function BitrateSparkline({ samples }: { samples: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const max = Math.max(...samples, 1);
    const step = width / (samples.length - 1);

    ctx.beginPath();
    ctx.strokeStyle = "#D4007A";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";

    samples.forEach((v, i) => {
      const x = i * step;
      const y = height - (v / max) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill gradient under line
    ctx.lineTo((samples.length - 1) * step, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(212,0,122,0.25)");
    grad.addColorStop(1, "rgba(212,0,122,0)");
    ctx.fillStyle = grad;
    ctx.fill();
  }, [samples]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={48}
      className="w-full h-12 rounded"
      aria-hidden="true"
    />
  );
}

interface QuickActionButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  activeColor?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

function QuickActionButton({
  icon,
  label,
  active,
  activeColor = "#D4007A",
  onClick,
  disabled,
  title,
}: QuickActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="
        flex flex-col items-center justify-center gap-1
        w-[52px] h-[52px] rounded-xl
        border border-pnp-border
        transition-all duration-150
        disabled:opacity-40 disabled:cursor-not-allowed
        hover:border-pnp-accent/40 active:scale-95
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
      "
      style={{
        background: active
          ? `linear-gradient(135deg, ${activeColor}33, ${activeColor}22)`
          : "rgba(30,30,30,0.7)",
        borderColor: active ? `${activeColor}66` : undefined,
        color: active ? activeColor : "#A1A1A3",
      }}
      aria-pressed={active}
    >
      <span className="w-5 h-5">{icon}</span>
      <span className="text-[9px] font-medium leading-none">{label}</span>
    </button>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}

function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
      <span className="text-sm text-pnp-textPrimary">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        disabled={disabled}
        className="
          relative inline-flex items-center w-10 h-6 rounded-full
          transition-colors duration-200
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
          disabled:opacity-40 disabled:cursor-not-allowed
        "
        style={{ background: checked ? "#D4007A" : "rgba(255,255,255,0.12)" }}
      >
        <span
          className="inline-block w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
        />
      </button>
    </label>
  );
}

// Stop-stream confirmation dialog
interface ConfirmStopDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmStopDialog({ onConfirm, onCancel }: ConfirmStopDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-stop-title"
    >
      <div className="glass-card w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,69,58,0.15)" }}
          >
            <StopCircle className="w-5 h-5" style={{ color: "#FF453A" }} aria-hidden="true" />
          </div>
          <div>
            <h2 id="confirm-stop-title" className="text-base font-bold text-pnp-textPrimary">
              End Stream?
            </h2>
            <p className="text-sm text-pnp-textSecondary mt-1">
              Are you sure you want to end the stream? Your viewers will be disconnected.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="
              flex-1 py-2.5 rounded-xl text-sm font-semibold
              border border-pnp-border text-pnp-textSecondary
              hover:bg-pnp-surfaceHover transition-colors duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
            "
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="
              flex-1 py-2.5 rounded-xl text-sm font-bold text-white
              transition-all duration-150 hover:opacity-90 active:scale-[0.98]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500
            "
            style={{ background: "linear-gradient(135deg, #b91c1c, #dc2626)" }}
          >
            End Stream
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StreamerDashboard({
  socket: socketProp,
  onClose,
  channel: channelProp,
}: StreamerDashboardProps) {
  // ── Self-provision socket & channel when not passed as props ────────────
  const [ownSocket, setOwnSocket] = useState<Socket | null>(null);
  const [ownChannel, setOwnChannel] = useState<{ ref: string; streamKey: string; rtmpUrl: string } | null>(null);
  const [channelLoading, setChannelLoading] = useState(!channelProp);
  const [channelError, setChannelError] = useState<string | null>(null);

  const socket = socketProp || ownSocket;
  const channel = channelProp || ownChannel;

  useEffect(() => {
    if (!socketProp) {
      const s = connectSocket();
      setOwnSocket(s);
      return () => { s.disconnect(); };
    }
  }, [socketProp]);

  useEffect(() => {
    if (!channelProp) {
      setChannelLoading(true);
      getMyChannel()
        .then((res) => {
          if (res.success && res.channel) {
            setOwnChannel(res.channel);
          } else {
            setChannelError("No streaming channel assigned. Contact an admin.");
          }
        })
        .catch(() => setChannelError("Failed to load channel info."))
        .finally(() => setChannelLoading(false));
    }
  }, [channelProp]);

  // ── Reducer ──────────────────────────────────────────────────────────────
  const [state, dispatch] = useReducer(dashboardReducer, {
    isLive: false,
    isConnecting: false,
    selectedPreset: QUALITY_PRESETS[0],
    activeTab: "scenes",
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    streamStartTime: null,
    viewerCount: 0,
    stats: { bitrate: 0, fps: 0, droppedFrames: 0, bytesSent: 0, latency: 0 },
    isRecording: false,
    orientation: window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait",
    autoReconnect: true,
    lowLatency: true,
    hardwareAccel: false,
    fps: 30,
  });

  // ── Persistent settings (load on mount, debounced save on change) ──────
  const [filterSettings, setFilterSettings] = useState<{
    filterPreset: string;
    filterBrightness: number;
    filterContrast: number;
    filterSaturation: number;
    filterWarmth: number;
    filterSharpness: number;
    beautyMode: boolean;
  }>({
    filterPreset: "None",
    filterBrightness: 0,
    filterContrast: 0,
    filterSaturation: 0,
    filterWarmth: 0,
    filterSharpness: 0,
    beautyMode: false,
  });
  const settingsLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved settings on mount
  useEffect(() => {
    getStreamerSettings()
      .then((res) => {
        if (!res.success || !res.settings) return;
        const s = res.settings;
        // Apply dashboard settings
        const preset = QUALITY_PRESETS.find((p) => p.id === s.qualityPreset) || QUALITY_PRESETS[0];
        dispatch({ type: "SET_PRESET", payload: preset });
        if (s.fps === 24 || s.fps === 30 || s.fps === 60) {
          dispatch({ type: "SET_FPS", payload: s.fps });
        }
        if (!s.autoReconnect !== !state.autoReconnect) dispatch({ type: "TOGGLE_AUTO_RECONNECT" });
        if (!s.lowLatency !== !state.lowLatency) dispatch({ type: "TOGGLE_LOW_LATENCY" });
        if (!s.hardwareAccel !== !state.hardwareAccel) dispatch({ type: "TOGGLE_HW_ACCEL" });
        setLocalRecordEnabled(s.localRecord);
        // Apply filter settings (passed to VideoFilters as props)
        setFilterSettings({
          filterPreset: s.filterPreset,
          filterBrightness: s.filterBrightness,
          filterContrast: s.filterContrast,
          filterSaturation: s.filterSaturation,
          filterWarmth: s.filterWarmth,
          filterSharpness: s.filterSharpness,
          beautyMode: s.beautyMode,
        });
        settingsLoadedRef.current = true;
      })
      .catch(() => {
        // Non-fatal — use defaults
        settingsLoadedRef.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-save when persistable settings change
  const saveSettings = useCallback((partial: Partial<StreamerSettings>) => {
    if (!settingsLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateStreamerSettings(partial).catch(() => {});
    }, 800);
  }, []);

  // Cleanup save timer
  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // Auto-save dashboard settings when they change
  useEffect(() => {
    saveSettings({
      qualityPreset: state.selectedPreset.id,
      fps: state.fps,
      autoReconnect: state.autoReconnect,
      lowLatency: state.lowLatency,
      hardwareAccel: state.hardwareAccel,
    });
  }, [state.selectedPreset.id, state.fps, state.autoReconnect, state.lowLatency, state.hardwareAccel, saveSettings]);

  useEffect(() => {
    saveSettings(filterSettings);
  }, [filterSettings, saveSettings]);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [bitrateSamples, setBitrateSamples] = useState<number[]>([]);
  const [localRecordEnabled, setLocalRecordEnabled] = useState(false);
  const [showRtmpKey, setShowRtmpKey] = useState(false);
  const [rtmpKeyCopied, setRtmpKeyCopied] = useState(false);
  const [rtmpUrlCopied, setRtmpUrlCopied] = useState(false);

  // Auto-save local record settings when they change
  useEffect(() => {
    saveSettings({ localRecord: localRecordEnabled });
  }, [localRecordEnabled, saveSettings]);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);

  // ── Wake lock ref (improvement #3) ────────────────────────────────────────
  const wakeLockRef = useRef<any>(null);

  // ── Network quality state (improvement #2) ────────────────────────────────
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(() =>
    getNetworkQuality((navigator as any).connection)
  );
  const [streamTitle, setStreamTitle] = useState("");

  // ── Mobile detection ──────────────────────────────────────────────────────
  const isMobileDevice =
    window.innerWidth < 768 || "ontouchstart" in window;

  // ── Stream Profile + Grok Auto-Chat state ─────────────────────────────────
  const [streamProfile, setStreamProfile] = useState({
    boundaries: "",
    turnOns: "",
    streamGoal: "",
  });
  const [autoMessages, setAutoMessages] = useState<string[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [autoActive, setAutoActive] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const localRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bytesWindowRef = useRef<{ bytes: number; ts: number }[]>([]);
  const bytesSentTotalRef = useRef(0);
  const frameCountRef = useRef(0);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Processed stream refs (scene → filters → audio → final) ─────────────
  const sceneStreamRef = useRef<MediaStream | null>(null);
  const filteredStreamRef = useRef<MediaStream | null>(null);
  const mixedAudioNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  /**
   * Build the final MediaStream to send to the recorder.
   * Priority chain: filtered video > scene video > raw camera video
   * Audio: mixed audio > raw mic audio
   */
  const getFinalStream = useCallback((): MediaStream | null => {
    const videoSource = filteredStreamRef.current || sceneStreamRef.current || streamRef.current;
    const audioSource = mixedAudioNodeRef.current?.stream || streamRef.current;

    if (!videoSource) return streamRef.current;

    const finalStream = new MediaStream();

    // Add video tracks from the best available source
    videoSource.getVideoTracks().forEach((t) => finalStream.addTrack(t));

    // Add audio tracks — prefer mixed audio, fall back to raw mic
    if (audioSource) {
      audioSource.getAudioTracks().forEach((t) => finalStream.addTrack(t));
    }

    return finalStream;
  }, []);

  // ── Callbacks for sub-component outputs ─────────────────────────────────
  const handleSceneStream = useCallback((stream: MediaStream) => {
    sceneStreamRef.current = stream;
  }, []);

  const handleFilteredOutput = useCallback((stream: MediaStream) => {
    filteredStreamRef.current = stream;
    // Update preview with filtered output
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, []);

  const handleMixedAudioOutput = useCallback((destination: MediaStreamAudioDestinationNode) => {
    mixedAudioNodeRef.current = destination;
  }, []);

  // ── Orientation detection ─────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const handler = (e: MediaQueryListEvent) => {
      dispatch({
        type: "SET_ORIENTATION",
        payload: e.matches ? "landscape" : "portrait",
      });
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Network quality monitor (improvement #2) ──────────────────────────────
  useEffect(() => {
    const conn = (navigator as any).connection;
    if (!conn) return;

    const handleChange = () => {
      const q = getNetworkQuality(conn);
      setNetworkQuality(q);
      // Apply adaptive preset only when not yet live
      if (!state.isLive && !state.isConnecting) {
        const presetId = getAdaptivePresetId(conn);
        const preset = QUALITY_PRESETS.find((p) => p.id === presetId) || QUALITY_PRESETS[0];
        dispatch({ type: "SET_PRESET", payload: preset });
      }
    };

    conn.addEventListener("change", handleChange);
    return () => conn.removeEventListener("change", handleChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLive, state.isConnecting]);

  // ── Wake lock helpers (improvement #3) ────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
    } catch {
      // Silent fail — not all browsers/devices support it
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch { /* ignore */ }
      wakeLockRef.current = null;
    }
  }, []);

  // Re-acquire on tab visibility change (spec requirement after tab switch)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && state.isLive) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [state.isLive, acquireWakeLock]);

  // ── Device enumeration ────────────────────────────────────────────────────
  const enumerateCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      setAvailableCameras(cams as MediaDeviceInfo[]);
    } catch {
      // Non-fatal — silently ignore
    }
  }, []);

  // ── Start preview on mount ──
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;

    const preset = state.selectedPreset;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.fps },
        },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        enumerateCameras();
      })
      .catch(() => {
        // Non-fatal — camera access is optional for preview
        setStreamError(null);
      });

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Socket event listeners ────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onStarted = () => {
      const now = Date.now();
      dispatch({ type: "SET_LIVE", payload: true });
      dispatch({ type: "SET_CONNECTING", payload: false });
      dispatch({ type: "SET_STREAM_START", payload: now });
      setDurationSec(0);
      bytesWindowRef.current = [];
      bytesSentTotalRef.current = 0;
      frameCountRef.current = 0;

      // Duration timer
      const startTime = now;
      durationTimerRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      // FPS counter (count frames per second by sampling recorderRef chunks)
      frameTimerRef.current = setInterval(() => {
        dispatch({ type: "UPDATE_STATS", payload: { fps: frameCountRef.current } });
        frameCountRef.current = 0;
      }, 1000);

      // Stats update every second (bitrate from bytes window)
      statsTimerRef.current = setInterval(() => {
        const now2 = Date.now();
        const window3s = bytesWindowRef.current.filter((e) => now2 - e.ts <= 3000);
        bytesWindowRef.current = window3s;
        const totalBytes = window3s.reduce((acc, e) => acc + e.bytes, 0);
        const kbps = window3s.length > 0 ? Math.round((totalBytes * 8) / 3 / 1000) : 0;
        dispatch({
          type: "UPDATE_STATS",
          payload: { bitrate: kbps, bytesSent: bytesSentTotalRef.current },
        });
        setBitrateSamples((prev) => {
          const next = [...prev, kbps];
          return next.length > 30 ? next.slice(next.length - 30) : next;
        });
      }, 1000);

      // Ping timer for latency
      pingTimerRef.current = setInterval(() => {
        const pingStart = Date.now();
        socket.emit("ping", () => {
          dispatch({ type: "UPDATE_STATS", payload: { latency: Date.now() - pingStart } });
        });
      }, 5000);
    };

    const onStopped = () => {
      dispatch({ type: "RESET_STREAM" });
      clearAllTimers();
      setDurationSec(0);
      setBitrateSamples([]);
    };

    const onStreamError = (data: { message?: string }) => {
      setStreamError(data.message ?? "Stream error occurred.");
      dispatch({ type: "RESET_STREAM" });
      clearAllTimers();
    };

    const onViewerCount = (data: { count: number }) => {
      dispatch({ type: "SET_VIEWER_COUNT", payload: data.count });
    };

    socket.on("stream:started", onStarted);
    socket.on("stream:stopped", onStopped);
    socket.on("stream:error", onStreamError);
    socket.on("live:viewer_count", onViewerCount);

    return () => {
      socket.off("stream:started", onStarted);
      socket.off("stream:stopped", onStopped);
      socket.off("stream:error", onStreamError);
      socket.off("live:viewer_count", onViewerCount);
    };
  }, [socket]);

  // ── Mic mute toggle (affects live stream track in real time) ─────────────
  useEffect(() => {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !state.isMuted;
    });
  }, [state.isMuted]);

  // ── Camera off toggle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!streamRef.current) return;
    streamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = !state.isCameraOff;
    });
  }, [state.isCameraOff]);

  // ── Cleanup helpers ───────────────────────────────────────────────────────
  function clearAllTimers() {
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
    if (statsTimerRef.current)    { clearInterval(statsTimerRef.current);    statsTimerRef.current = null; }
    if (frameTimerRef.current)    { clearInterval(frameTimerRef.current);    frameTimerRef.current = null; }
    if (pingTimerRef.current)     { clearInterval(pingTimerRef.current);     pingTimerRef.current = null; }
  }

  function stopRecorder(ref: React.MutableRefObject<MediaRecorder | null>) {
    if (ref.current && ref.current.state !== "inactive") {
      ref.current.stop();
    }
    ref.current = null;
  }

  // ── Wake lock: acquire when live, release when stream ends (improvement #3) ─
  useEffect(() => {
    if (state.isLive) {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [state.isLive, acquireWakeLock, releaseWakeLock]);

  // ── Unmount cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearAllTimers();
      stopRecorder(recorderRef);
      stopRecorder(localRecorderRef);
      releaseWakeLock();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      sceneStreamRef.current = null;
      filteredStreamRef.current = null;
      mixedAudioNodeRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Go Live ───────────────────────────────────────────────────────────────
  const handleGoLive = useCallback(() => {
    if (!channel) {
      setStreamError("No streaming channel assigned. Contact an admin.");
      return;
    }
    if (!streamRef.current) {
      setStreamError("Camera stream not available. Check permissions.");
      return;
    }

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      setStreamError("Your browser does not support WebM recording.");
      return;
    }

    setStreamError(null);
    dispatch({ type: "SET_CONNECTING", payload: true });

    socket?.emit("stream:start", {
      channelRef: channel.ref,
      videoBitrate: state.selectedPreset.videoBitrate,
      audioBitrate: state.selectedPreset.audioBitrate,
      fps: state.fps,
    });

    // Use processed stream (scene→filters→audio) when available, else raw camera
    const finalStream = getFinalStream() || streamRef.current;

    // Main stream recorder (sends data over socket)
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(finalStream, {
        mimeType,
        videoBitsPerSecond: state.selectedPreset.videoBitrate,
        audioBitsPerSecond: state.selectedPreset.audioBitrate,
      });
    } catch {
      setStreamError("Failed to start recorder. Browser may not support selected codec.");
      dispatch({ type: "SET_CONNECTING", payload: false });
      return;
    }

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        if (socket?.connected) {
          e.data.arrayBuffer().then((ab) => socket.emit("stream:data", ab));
          bytesWindowRef.current.push({ bytes: e.data.size, ts: Date.now() });
          bytesSentTotalRef.current += e.data.size;
          frameCountRef.current += 1;
        }
      }
    };

    recorder.onerror = () => {
      dispatch({ type: "UPDATE_STATS", payload: { droppedFrames: state.stats.droppedFrames + 1 } });
    };

    recorder.start(250); // 250ms chunks for low latency
    recorderRef.current = recorder;

    // Local recording (optional) — also uses processed stream
    const recordStream = finalStream;
    if (localRecordEnabled && recordStream) {
      dispatch({ type: "SET_RECORDING", payload: true });
      localChunksRef.current = [];
      setRecordingBlob(null);

      try {
        const localRecorder = new MediaRecorder(recordStream, { mimeType });
        localRecorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) {
            localChunksRef.current.push(e.data);
          }
        };
        localRecorder.onstop = () => {
          const blob = new Blob(localChunksRef.current, { type: "video/webm" });
          setRecordingBlob(blob);
          dispatch({ type: "SET_RECORDING", payload: false });
        };
        localRecorder.start(1000);
        localRecorderRef.current = localRecorder;
      } catch {
        dispatch({ type: "SET_RECORDING", payload: false });
      }
    }
  }, [channel, socket, state.selectedPreset, state.stats.droppedFrames, localRecordEnabled, getFinalStream]);

  // ── Stop Stream ───────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    stopRecorder(recorderRef);
    stopRecorder(localRecorderRef);
    socket?.emit("stream:stop");
    clearAllTimers();
    dispatch({ type: "RESET_STREAM" });
    setDurationSec(0);
  }, [socket]);

  // ── Screen Share ──────────────────────────────────────────────────────────
  const handleScreenShare = useCallback(async () => {
    if (state.isScreenSharing) {
      // Switch back to camera
      dispatch({ type: "TOGGLE_SCREEN_SHARE" });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = camStream;
        if (videoRef.current) videoRef.current.srcObject = camStream;
      } catch {
        setStreamError("Could not switch back to camera.");
      }
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: state.selectedPreset.fps } },
        audio: true,
      });
      streamRef.current = screenStream;
      if (videoRef.current) videoRef.current.srcObject = screenStream;
      dispatch({ type: "TOGGLE_SCREEN_SHARE" });

      // Auto-restore when user stops sharing via browser UI
      screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        dispatch({ type: "TOGGLE_SCREEN_SHARE" });
      });
    } catch {
      // User cancelled — silently ignore
    }
  }, [state.isScreenSharing, state.selectedPreset.fps]);

  // ── BRB Scene ─────────────────────────────────────────────────────────────
  const handleBRB = useCallback(() => {
    if (!state.isCameraOff) dispatch({ type: "TOGGLE_CAMERA" });
    if (!state.isMuted) dispatch({ type: "TOGGLE_MUTE" });
  }, [state.isCameraOff, state.isMuted]);

  // ── Snapshot ──────────────────────────────────────────────────────────────
  const handleSnapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snapshot-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, []);

  // ── Flip Camera ───────────────────────────────────────────────────────────
  const handleFlipCamera = useCallback(async () => {
    if (availableCameras.length < 2) return;
    const nextIndex = (cameraIndex + 1) % availableCameras.length;
    setCameraIndex(nextIndex);

    const nextDevice = availableCameras[nextIndex];
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: nextDevice.deviceId } },
        audio: true,
      });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = newStream;
      if (videoRef.current) videoRef.current.srcObject = newStream;
    } catch {
      setStreamError("Could not switch camera.");
    }
  }, [availableCameras, cameraIndex]);

  // ── Download local recording ──────────────────────────────────────────────
  const handleDownloadRecording = useCallback(() => {
    if (!recordingBlob) return;
    const url = URL.createObjectURL(recordingBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stream-recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recordingBlob]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const health = healthStatus(state.stats, state.selectedPreset.videoBitrate);
  const hColor = healthColor(health);
  const isDesktopLayout =
    state.orientation === "landscape" || window.matchMedia("(min-width: 1024px)").matches;

  // ── Go Live button handler (with confirmation for stop) ───────────────────
  const handleGoLiveClick = useCallback(() => {
    if (state.isLive) {
      setShowStopConfirm(true);
    } else if (!state.isConnecting) {
      handleGoLive();
    }
  }, [state.isLive, state.isConnecting, handleGoLive]);

  // ── Stream Profile: load on mount ─────────────────────────────────────────
  useEffect(() => {
    getStreamProfile()
      .then((res) => {
        if (res.success && res.profile) {
          setStreamProfile({
            boundaries: res.profile.boundaries,
            turnOns: res.profile.turnOns,
            streamGoal: res.profile.streamGoal,
          });
          setAutoMessages(res.profile.messages || []);
          setAutoActive(res.profile.isActive ?? false);
        }
      })
      .catch(() => {
        // Non-fatal — profile simply stays empty
      });
  }, []);

  const handleSaveProfile = useCallback(async () => {
    setProfileSaving(true);
    setProfileError(null);
    try {
      const res = await saveStreamProfile(streamProfile);
      if (res.success) {
        setAutoMessages(res.messages);
      } else {
        setProfileError("Failed to generate messages");
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to generate messages");
    } finally {
      setProfileSaving(false);
    }
  }, [streamProfile]);

  const [autoError, setAutoError] = useState<string | null>(null);
  const handleToggleAuto = useCallback(async () => {
    setAutoError(null);
    try {
      if (autoActive) {
        await stopStreamAutoMessages();
        setAutoActive(false);
      } else {
        await startStreamAutoMessages();
        setAutoActive(true);
      }
    } catch (err) {
      setAutoError(err instanceof Error ? err.message : "Failed to toggle auto-chat");
    }
  }, [autoActive]);

  // ── Settings tab content ──────────────────────────────────────────────────
  const SettingsTab = () => (
    <div className="space-y-4 p-4">
      {/* Quality presets */}
      <div className="rounded-2xl border border-pnp-border bg-pnp-surface p-4">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          Quality Preset
        </p>
        <div className="flex flex-wrap gap-2">
          {QUALITY_PRESETS.map((preset) => {
            const isActive = state.selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                disabled={state.isLive || state.isConnecting}
                onClick={() => dispatch({ type: "SET_PRESET", payload: preset })}
                className="
                  px-3 py-1.5 rounded-xl text-xs font-semibold
                  border transition-all duration-150
                  disabled:opacity-40 disabled:cursor-not-allowed
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                "
                style={{
                  background: isActive
                    ? "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(230,145,56,0.15))"
                    : "rgba(30,30,30,0.7)",
                  borderColor: isActive ? "rgba(212,0,122,0.5)" : "rgba(255,255,255,0.1)",
                  color: isActive ? "#fff" : "#A1A1A3",
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* FPS */}
      <div className="rounded-2xl border border-pnp-border bg-pnp-surface p-4">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          Frame Rate
        </p>
        <div className="flex gap-2">
          {([24, 30, 60] as const).map((fps) => {
            const isActive = state.fps === fps;
            return (
              <button
                key={fps}
                disabled={state.isLive || state.isConnecting}
                onClick={() => dispatch({ type: "SET_FPS", payload: fps })}
                className="
                  px-3 py-1.5 rounded-xl text-xs font-semibold
                  border transition-all duration-150
                  disabled:opacity-40 disabled:cursor-not-allowed
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                "
                style={{
                  background: isActive
                    ? "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(230,145,56,0.15))"
                    : "rgba(30,30,30,0.7)",
                  borderColor: isActive ? "rgba(212,0,122,0.5)" : "rgba(255,255,255,0.1)",
                  color: isActive ? "#fff" : "#A1A1A3",
                }}
              >
                {fps} fps
              </button>
            );
          })}
        </div>
      </div>

      {/* Toggles */}
      <div className="rounded-2xl border border-pnp-border bg-pnp-surface p-4 space-y-4">
        <Toggle
          checked={state.autoReconnect}
          onChange={() => dispatch({ type: "TOGGLE_AUTO_RECONNECT" })}
          label="Auto-reconnect"
        />
        <Toggle
          checked={state.lowLatency}
          onChange={() => dispatch({ type: "TOGGLE_LOW_LATENCY" })}
          label="Low-latency mode"
        />
        <Toggle
          checked={state.hardwareAccel}
          onChange={() => dispatch({ type: "TOGGLE_HW_ACCEL" })}
          label="Hardware acceleration"
        />
        <Toggle
          checked={localRecordEnabled}
          onChange={() => setLocalRecordEnabled((v) => !v)}
          label="Record locally (saves .webm)"
          disabled={state.isLive}
        />
      </div>

      {/* Download recording */}
      {recordingBlob && (
        <button
          onClick={handleDownloadRecording}
          className="
            w-full flex items-center justify-center gap-2
            py-2.5 rounded-xl text-sm font-semibold text-white
            border border-pnp-accent/40
            transition-all duration-150 hover:opacity-90 active:scale-[0.98]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
          "
          style={{ background: "rgba(212,0,122,0.15)" }}
        >
          <DownloadIcon className="w-4 h-4" aria-hidden="true" />
          Download Recording
        </button>
      )}

      {/* Stream Profile — Grok auto-chat messages */}
      <div className="rounded-2xl border border-pnp-border bg-pnp-surface p-4">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          Stream Profile
        </p>
        <p className="text-[10px] text-pnp-textSecondary mb-3">
          Fill in your preferences and we'll generate fun chat messages that auto-post during your stream
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-pnp-textSecondary font-medium mb-1 block">
              I'm not comfortable with...
            </label>
            <textarea
              value={streamProfile.boundaries}
              onChange={(e) =>
                setStreamProfile((p) => ({ ...p, boundaries: e.target.value }))
              }
              maxLength={500}
              rows={2}
              className="w-full rounded-xl bg-pnp-background border border-pnp-border px-3 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-pnp-accent resize-none"
              placeholder="e.g., Rough talk, certain requests..."
            />
          </div>

          <div>
            <label className="text-[11px] text-pnp-textSecondary font-medium mb-1 block">
              What turns me on...
            </label>
            <textarea
              value={streamProfile.turnOns}
              onChange={(e) =>
                setStreamProfile((p) => ({ ...p, turnOns: e.target.value }))
              }
              maxLength={500}
              rows={2}
              className="w-full rounded-xl bg-pnp-background border border-pnp-border px-3 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-pnp-accent resize-none"
              placeholder="e.g., Compliments, confidence, eye contact..."
            />
          </div>

          <div>
            <label className="text-[11px] text-pnp-textSecondary font-medium mb-1 block">
              Goal for this stream
            </label>
            <textarea
              value={streamProfile.streamGoal}
              onChange={(e) =>
                setStreamProfile((p) => ({ ...p, streamGoal: e.target.value }))
              }
              maxLength={500}
              rows={2}
              className="w-full rounded-xl bg-pnp-background border border-pnp-border px-3 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-pnp-accent resize-none"
              placeholder="e.g., 500 tokens, meet new people, have fun..."
            />
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={
              profileSaving ||
              !streamProfile.boundaries.trim() ||
              !streamProfile.turnOns.trim() ||
              !streamProfile.streamGoal.trim()
            }
            className="w-full py-2.5 rounded-xl btn-gradient text-white text-xs font-semibold disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {profileSaving ? "Generating..." : "Generate Chat Messages"}
          </button>

          {profileError && (
            <p className="text-[10px] text-red-400">{profileError}</p>
          )}

          {/* Generated messages preview + toggle */}
          {autoMessages.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-pnp-textSecondary font-medium">
                  {autoMessages.length} messages ready
                </p>
                <button
                  onClick={handleToggleAuto}
                  className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                    autoActive
                      ? "bg-red-500/20 text-red-400 border border-red-500/30"
                      : "bg-green-500/20 text-green-400 border border-green-500/30"
                  }`}
                >
                  {autoActive ? "Stop Auto-Chat" : "Start Auto-Chat"}
                </button>
              </div>
              {autoError && (
                <p className="text-[10px] text-red-400">{autoError}</p>
              )}
              <div
                className="max-h-40 overflow-y-auto space-y-1 pr-1"
                style={{ scrollbarWidth: "thin" }}
              >
                {autoMessages.map((msg, i) => (
                  <div
                    key={i}
                    className="text-[10px] text-pnp-textSecondary bg-pnp-background rounded-lg px-2.5 py-1.5 border border-pnp-border/50"
                  >
                    <span className="text-pnp-accent font-medium mr-1">{i + 1}.</span>
                    {msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* OBS / External Software — RTMP credentials */}
      <div className="rounded-2xl border border-pnp-border bg-pnp-surface p-4">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3">
          OBS / External Software
        </p>
        {!channel ? (
          <p className="text-xs text-pnp-textSecondary">Loading stream credentials…</p>
        ) : (
          <div className="space-y-3">
            {/* RTMP URL */}
            <div>
              <label className="text-[11px] text-pnp-textSecondary font-medium mb-1 block uppercase tracking-wider">RTMP Server</label>
              <div className="flex items-center gap-2 bg-pnp-background border border-pnp-border rounded-xl px-3 py-2">
                <code className="text-xs text-pnp-textPrimary flex-1 break-all">{channel.rtmpUrl}</code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(channel.rtmpUrl);
                    setRtmpUrlCopied(true);
                    setTimeout(() => setRtmpUrlCopied(false), 2000);
                  }}
                  className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-accent transition-colors"
                  aria-label="Copy RTMP URL"
                >
                  {rtmpUrlCopied
                    ? <CheckIcon className="w-4 h-4" style={{ color: "#5ED1C4" }} />
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  }
                </button>
              </div>
            </div>
            {/* Stream Key */}
            <div>
              <label className="text-[11px] text-pnp-textSecondary font-medium mb-1 block uppercase tracking-wider">Stream Key</label>
              <div className="flex items-center gap-2 bg-pnp-background border border-pnp-border rounded-xl px-3 py-2">
                <code className="text-xs text-pnp-textPrimary flex-1 font-mono">
                  {showRtmpKey ? channel.streamKey : "•".repeat(Math.min(channel.streamKey.length, 24))}
                </code>
                <button
                  onClick={() => setShowRtmpKey((v) => !v)}
                  className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-accent transition-colors"
                  aria-label={showRtmpKey ? "Hide stream key" : "Show stream key"}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {showRtmpKey
                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    }
                  </svg>
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(channel.streamKey);
                    setRtmpKeyCopied(true);
                    setTimeout(() => setRtmpKeyCopied(false), 2000);
                  }}
                  className="flex-shrink-0 text-pnp-textSecondary hover:text-pnp-accent transition-colors"
                  aria-label="Copy stream key"
                >
                  {rtmpKeyCopied
                    ? <CheckIcon className="w-4 h-4" style={{ color: "#5ED1C4" }} />
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  }
                </button>
              </div>
              <p className="text-[10px] mt-1" style={{ color: "#FF453A" }}>
                Never share your stream key — anyone with it can broadcast to your channel.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Health panel ──────────────────────────────────────────────────────────
  const HealthPanel = () => (
    <div className="glass-card-sm p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider">
          Stream Health
        </p>
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: hColor, boxShadow: `0 0 6px ${hColor}` }}
          aria-hidden="true"
        />
      </div>

      {/* Sparkline */}
      {state.isLive && bitrateSamples.length > 1 && (
        <div className="rounded-lg overflow-hidden">
          <BitrateSparkline samples={bitrateSamples} />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <StatRow label="Bitrate" value={state.isLive ? `${state.stats.bitrate.toLocaleString()} kbps` : "—"} color={hColor} />
        <StatRow label="FPS" value={state.isLive ? String(state.stats.fps) : "—"} />
        <StatRow
          label="Resolution"
          value={`${state.selectedPreset.width}×${state.selectedPreset.height}`}
        />
        <StatRow label="Duration" value={state.isLive ? formatDuration(durationSec) : "—"} monospace />
        <StatRow
          label="Viewers"
          value={state.isLive ? String(state.viewerCount) : "—"}
        />
        <StatRow
          label="Dropped"
          value={state.isLive ? `${state.stats.droppedFrames} fr` : "—"}
          color={state.stats.droppedFrames > 0 ? "#FFD60A" : undefined}
        />
        <StatRow
          label="Latency"
          value={state.isLive ? `${state.stats.latency} ms` : "—"}
        />
        <StatRow
          label="Sent"
          value={state.isLive ? `${(state.stats.bytesSent / 1_000_000).toFixed(1)} MB` : "—"}
        />
      </dl>
    </div>
  );

  // ── Early returns for self-provisioned channel loading/error ───────────
  if (channelLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-pnp-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-pnp-textSecondary">Loading channel...</p>
        </div>
      </div>
    );
  }

  if (channelError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-pnp-background">
        <div className="flex flex-col items-center gap-4 max-w-xs text-center">
          <p className="text-sm text-pnp-error">{channelError}</p>
          {onClose && (
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm btn-gradient text-white">
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-pnp-background"
      role="main"
      aria-label="Streamer Dashboard"
    >
      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-pnp-border flex-shrink-0"
        style={{ background: "rgba(18,18,18,0.95)", backdropFilter: "blur(20px)" }}
      >
        {/* Back button */}
        <button
          onClick={onClose}
          className="
            flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium
            text-pnp-textSecondary border border-pnp-border
            hover:bg-pnp-surface transition-colors duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
          "
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Back</span>
        </button>

        {/* Title */}
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-pnp-textPrimary tracking-wide">
            Stream Dashboard
          </h1>
          {state.isLive && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
              style={{ background: "rgba(239,68,68,0.9)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
              LIVE
            </span>
          )}
        </div>

        {/* Health dot + Go Live button */}
        <div className="flex items-center gap-2">
          {/* Health indicator (desktop only — mobile shows in stats bar) */}
          <span
            className="hidden lg:block w-2.5 h-2.5 rounded-full"
            style={{ background: hColor, boxShadow: `0 0 6px ${hColor}` }}
            aria-label={`Stream health: ${health}`}
          />

          {/* Go Live */}
          <button
            onClick={handleGoLiveClick}
            disabled={state.isConnecting}
            className="
              flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white
              transition-all duration-150
              disabled:opacity-50 disabled:cursor-not-allowed
              hover:opacity-90 active:scale-[0.98]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
            "
            style={{
              background: state.isLive
                ? "linear-gradient(135deg, #b91c1c, #dc2626)"
                : "linear-gradient(135deg, #D4007A, #E69138)",
            }}
            aria-label={state.isLive ? "Stop Stream" : "Go Live"}
          >
            {state.isConnecting ? (
              <>
                <span
                  className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Connecting…</span>
              </>
            ) : state.isLive ? (
              <>
                <StopCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Stop Stream</span>
              </>
            ) : (
              <>
                <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Go Live</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Main body (desktop: side-by-side; mobile: stacked) ──────────────── */}
      <div className={`flex flex-1 min-h-0 ${isDesktopLayout ? "flex-row" : "flex-col"}`}>

        {/* ── Left / Top: Preview monitor ──────────────────────────────────── */}
        <div className={`relative flex-shrink-0 ${isDesktopLayout ? "w-[60%] flex flex-col" : "w-full"}`}>
          {/* Preview container — 16:9 */}
          <div
            className="relative w-full bg-black overflow-hidden"
            style={{ aspectRatio: isDesktopLayout ? "auto" : "16/9", flex: isDesktopLayout ? "1" : undefined }}
          >
            {/* ── Camera preview ── */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: state.isCameraOff ? "none" : undefined }}
              aria-label="Camera preview"
            />

            {/* Camera off overlay */}
            {state.isCameraOff && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
                <VideoOffIcon className="w-10 h-10 text-pnp-textSecondary" aria-hidden="true" />
                <p className="text-xs text-pnp-textSecondary font-medium">Camera Off</p>
              </div>
            )}

            {/* ── Go Live CTA (shown when not live) ── */}
            {!state.isLive && !state.isConnecting && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6"
                style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
              >
                {/* Pulsing broadcast icon */}
                <div className="relative flex items-center justify-center">
                  <span
                    className="absolute w-16 h-16 rounded-full animate-ping opacity-30"
                    style={{ background: "#D4007A" }}
                    aria-hidden="true"
                  />
                  <span className="relative text-3xl" aria-hidden="true">📡</span>
                </div>

                <p className="text-base font-bold text-white text-center">
                  Ready to Go Live?
                </p>

                {/* Stream title input */}
                <input
                  type="text"
                  value={streamTitle}
                  onChange={(e) => setStreamTitle(e.target.value)}
                  placeholder="Stream title (optional)"
                  maxLength={80}
                  className="w-full max-w-xs rounded-xl bg-white/10 border border-white/20 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-pnp-accent text-center"
                />

                {/* Network quality pill */}
                <NetworkQualityPill quality={networkQuality} />

                {/* Big Go Live button */}
                <button
                  onClick={handleGoLive}
                  className="
                    flex items-center gap-2 px-8 py-4 rounded-2xl text-base font-bold text-white w-full max-w-xs justify-center
                    transition-all duration-150 active:scale-[0.97]
                    disabled:opacity-50 disabled:cursor-not-allowed
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                  "
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  aria-label="Go Live Now"
                >
                  <span aria-hidden="true">🔴</span>
                  Go Live Now
                </button>
              </div>
            )}

            {/* Status badge — top-left */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              {state.isLive ? (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white"
                  style={{ background: "rgba(239,68,68,0.9)", backdropFilter: "blur(4px)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
                  LIVE
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white/70"
                  style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
                >
                  PREVIEW
                </span>
              )}

              {state.isRecording && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white"
                  style={{ background: "rgba(255,69,58,0.8)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
                  REC
                </span>
              )}
            </div>

                {/* Viewer count — top-right */}
                {state.isLive && (
                  <div className="absolute top-3 right-3">
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white"
                      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
                    >
                      <UsersIcon className="w-3.5 h-3.5" aria-hidden="true" />
                      {state.viewerCount}
                    </span>
                  </div>
                )}

                {/* Duration — bottom-left when live */}
                {state.isLive && (
                  <div className="absolute bottom-3 left-3">
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white tabular-nums"
                      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
                    >
                      {formatDuration(durationSec)}
                    </span>
                  </div>
                )}

                {/* Portrait hint for mobile */}
                {!isDesktopLayout && state.orientation === "portrait" && (
                  <div
                    className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg"
                    style={{ background: "rgba(0,0,0,0.5)" }}
                  >
                    <RotateCwIcon className="w-3 h-3 text-pnp-textSecondary" aria-hidden="true" />
                    <span className="text-[9px] text-pnp-textSecondary">Landscape for more</span>
                  </div>
                )}
          </div>

          {/* ── Mobile stats bar ──────────────────────────────────────────── */}
          {!isDesktopLayout && (
            <div
              className="flex items-center justify-between gap-2 px-3 py-2 border-b border-pnp-border flex-shrink-0"
              style={{ background: "rgba(18,18,18,0.9)" }}
            >
              <MiniStat label="Bitrate" value={state.isLive ? `${state.stats.bitrate}k` : "—"} />
              <MiniStat label="FPS" value={state.isLive ? String(state.stats.fps) : "—"} />
              <MiniStat label="Viewers" value={state.isLive ? String(state.viewerCount) : "—"} />
              <MiniStat label="Time" value={state.isLive ? formatDuration(durationSec) : "—"} monospace />
              {/* Network quality pill (improvement #2) */}
              <NetworkQualityPill quality={networkQuality} />
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: hColor }}
                aria-label={`Health: ${health}`}
              />
            </div>
          )}

          {/* ── Quick Actions ──────────────────────────────────────────────── */}
          <div className="flex-shrink-0 px-3 py-2.5 border-b border-pnp-border" style={{ background: "rgba(18,18,18,0.85)" }}>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <QuickActionButton
                icon={state.isMuted ? <MicOffIcon className="w-full h-full" /> : <MicIcon className="w-full h-full" />}
                label={state.isMuted ? "Unmute" : "Mute"}
                active={state.isMuted}
                activeColor="#FF453A"
                onClick={() => dispatch({ type: "TOGGLE_MUTE" })}
                title={state.isMuted ? "Unmute microphone" : "Mute microphone"}
              />
              <QuickActionButton
                icon={state.isCameraOff ? <VideoOffIcon className="w-full h-full" /> : <VideoIcon className="w-full h-full" />}
                label={state.isCameraOff ? "Cam On" : "Cam Off"}
                active={state.isCameraOff}
                activeColor="#FF453A"
                onClick={() => dispatch({ type: "TOGGLE_CAMERA" })}
                title={state.isCameraOff ? "Turn camera on" : "Turn camera off"}
              />
              <QuickActionButton
                icon={<MonitorIcon className="w-full h-full" />}
                label="Share"
                active={state.isScreenSharing}
                onClick={handleScreenShare}
                title={state.isScreenSharing ? "Stop screen share" : "Share screen"}
              />
              <QuickActionButton
                icon={<PauseIcon className="w-full h-full" />}
                label="BRB"
                onClick={handleBRB}
                title="Be Right Back — mutes mic and camera"
              />
              <QuickActionButton
                icon={<CameraIcon className="w-full h-full" />}
                label="Snapshot"
                onClick={handleSnapshot}
                title="Capture screenshot"
              />
              <QuickActionButton
                icon={<RefreshCwIcon className="w-full h-full" />}
                label="Flip"
                onClick={handleFlipCamera}
                disabled={availableCameras.length < 2}
                title="Switch camera"
              />
            </div>
          </div>
        </div>

        {/* ── Right / Hidden-on-mobile: Health Panel ───────────────────────── */}
        {isDesktopLayout && (
          <div className="w-[40%] flex flex-col gap-4 p-4 overflow-y-auto border-l border-pnp-border" style={{ background: "rgba(18,18,18,0.6)" }}>
            <HealthPanel />
          </div>
        )}
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {streamError && (
        <div
          className="flex items-start gap-2.5 mx-3 my-2 px-4 py-3 rounded-xl text-sm flex-shrink-0"
          style={{ background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)" }}
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#FF453A" }} aria-hidden="true" />
          <span className="text-white/80 min-w-0 break-words flex-1">{streamError}</span>
          <button
            onClick={() => setStreamError(null)}
            className="text-pnp-textSecondary hover:text-white transition-colors flex-shrink-0"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Bottom tab bar + panel ────────────────────────────────────────────── */}
      <div className="flex flex-col flex-shrink-0" style={{ minHeight: isDesktopLayout ? "260px" : "220px", maxHeight: isDesktopLayout ? "35vh" : "45vh" }}>
        {/* Tab bar */}
        <div
          className="flex items-center border-t border-b border-pnp-border flex-shrink-0"
          style={{ background: "rgba(18,18,18,0.85)", backdropFilter: "blur(20px)" }}
          role="tablist"
        >
          {(
            [
              { id: "scenes",   label: "Scenes",   Icon: LayersIcon },
              { id: "audio",    label: "Audio",    Icon: SlidersIcon },
              { id: "filters",  label: "Filters",  Icon: VideoIcon },
              { id: "settings", label: "Settings", Icon: SettingsIcon },
            ] as const
          ).map(({ id, label, Icon }) => {
            const isActive = state.activeTab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${id}`}
                onClick={() => dispatch({ type: "SET_TAB", payload: id })}
                className="
                  relative flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5
                  py-2.5 px-2 text-[10px] sm:text-xs font-semibold
                  transition-colors duration-150
                  focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-pnp-accent
                "
                style={{ color: isActive ? "#D4007A" : "#A1A1A3" }}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {label}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto" style={{ background: "rgba(18,18,18,0.6)" }}>
          <div
            id="tabpanel-scenes"
            role="tabpanel"
            aria-labelledby="tab-scenes"
            hidden={state.activeTab !== "scenes"}
          >
            {state.activeTab === "scenes" && (
              <TabPanel label="Scene Manager">
                <SceneManager
                  videoDevices={availableCameras}
                  onCanvasStream={handleSceneStream}
                  micStream={streamRef.current}
                  isLive={state.isLive}
                  compact
                />
              </TabPanel>
            )}
          </div>

          <div
            id="tabpanel-audio"
            role="tabpanel"
            aria-labelledby="tab-audio"
            hidden={state.activeTab !== "audio"}
          >
            {state.activeTab === "audio" && (
              <TabPanel label="Audio Mixer">
                <AudioMixer
                  micStream={streamRef.current}
                  onMixedOutput={handleMixedAudioOutput}
                  isLive={state.isLive}
                />
              </TabPanel>
            )}
          </div>

          <div
            id="tabpanel-filters"
            role="tabpanel"
            aria-labelledby="tab-filters"
            hidden={state.activeTab !== "filters"}
          >
            {state.activeTab === "filters" && (
              <TabPanel label="Video Filters">
                <VideoFilters
                  inputStream={sceneStreamRef.current || streamRef.current}
                  onFilteredOutput={handleFilteredOutput}
                  isLive={state.isLive}
                  width={state.selectedPreset.width}
                  height={state.selectedPreset.height}
                  fps={state.fps}
                  compact
                  initialSettings={filterSettings}
                  onSettingsChange={setFilterSettings}
                />
              </TabPanel>
            )}
          </div>

          <div
            id="tabpanel-settings"
            role="tabpanel"
            aria-labelledby="tab-settings"
            hidden={state.activeTab !== "settings"}
          >
            {state.activeTab === "settings" && <SettingsTab />}
          </div>
        </div>
      </div>

      {/* ── Stop stream confirmation dialog ──────────────────────────────────── */}
      {showStopConfirm && (
        <ConfirmStopDialog
          onConfirm={() => {
            setShowStopConfirm(false);
            handleStop();
          }}
          onCancel={() => setShowStopConfirm(false)}
        />
      )}
    </div>
  );
}

// ─── Small stat display helpers ───────────────────────────────────────────────

function StatRow({
  label,
  value,
  color,
  monospace,
}: {
  label: string;
  value: string;
  color?: string;
  monospace?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] text-pnp-textSecondary">{label}</dt>
      <dd
        className={`text-xs font-semibold mt-0.5 ${monospace ? "tabular-nums" : ""}`}
        style={{ color: color ?? "#fff" }}
      >
        {value}
      </dd>
    </div>
  );
}

function MiniStat({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="flex flex-col items-center min-w-0">
      <span className="text-[9px] text-pnp-textSecondary leading-none">{label}</span>
      <span
        className={`text-[11px] font-semibold text-pnp-textPrimary leading-tight mt-0.5 ${monospace ? "tabular-nums" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function NetworkQualityPill({ quality }: { quality: NetworkQuality }) {
  const color = networkQualityColor(quality);
  const label = networkQualityLabel(quality);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
