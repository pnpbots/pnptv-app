import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { connectSocket } from "@/lib/socket";
import {
  getMyChannel,
  provisionChannel,
  getStreamerSettings,
  updateStreamerSettings,
  getStreamProfile,
  saveStreamProfile,
  startStreamAutoMessages,
  stopStreamAutoMessages,
  getEarningsHistory,
  uploadThumbnail,
  uploadRecording,
  uploadSnapshot,
} from "@/lib/api";
import type { StreamerSettings, EarningsHistory } from "@/lib/api";
import type { Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NetworkQuality = "wifi" | "4g" | "3g" | "2g" | "unknown";
export type ActiveTab = "scenes" | "audio" | "filters" | "settings";
export type Orientation = "portrait" | "landscape";
export type HealthStatus = "good" | "degraded" | "critical";

export interface QualityPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  videoBitrate: number;
  audioBitrate: number;
  fps: number;
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: "720p",  label: "720p HD",       width: 1280, height: 720,  videoBitrate: 2_500_000, audioBitrate: 128000, fps: 30 },
  { id: "480p",  label: "480p SD",       width: 854,  height: 480,  videoBitrate: 1_000_000, audioBitrate: 128000, fps: 30 },
  { id: "360p",  label: "360p Low",      width: 640,  height: 360,  videoBitrate: 600_000,   audioBitrate: 96000,  fps: 24 },
  { id: "1080p", label: "1080p Full HD", width: 1920, height: 1080, videoBitrate: 4_500_000, audioBitrate: 192000, fps: 30 },
];

export interface StreamStats {
  bitrate: number;       // kbps
  fps: number;
  droppedFrames: number;
  bytesSent: number;
  latency: number;       // ms (socket ping)
}

export interface FilterSettingsState {
  filterPreset: string;
  filterBrightness: number;
  filterContrast: number;
  filterSaturation: number;
  filterWarmth: number;
  filterSharpness: number;
  beautyMode: boolean;
}

export interface DashboardState {
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

export type DashboardAction =
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

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
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

// ─── Helper functions ─────────────────────────────────────────────────────────

export function getSupportedMimeType(): string | null {
  // WebM/VP8/VP9 first (Chrome, Firefox, Android, desktop Safari 14+).
  // MP4/H.264 fallback for iOS Safari (only container it supports for MediaRecorder).
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4;codecs=h264,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/** Detect mobile/touch device — covers iPadOS 13+ which reports as desktop Safari. */
export function detectMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports MacIntel + touch support
  return navigator.maxTouchPoints > 1;
}

export function getAdaptivePresetId(conn: any): string {
  if (!conn) return "720p";
  const et: string = conn.effectiveType || "4g";
  const downlink: number = typeof conn.downlink === "number" ? conn.downlink : 10;
  if (et === "4g" && downlink >= 4) return "720p";
  if (et === "4g") return "480p";
  return "360p";
}

export function getNetworkQuality(conn: any): NetworkQuality {
  if (!conn) return "unknown";
  const et: string = conn.effectiveType || "";
  if (et === "4g") return "4g";
  if (et === "3g") return "3g";
  if (et === "2g") return "2g";
  if ((conn.type || "") === "wifi") return "wifi";
  return "unknown";
}

export function networkQualityColor(q: NetworkQuality): string {
  if (q === "wifi" || q === "4g") return "#5ED1C4";
  if (q === "3g") return "#FFD60A";
  return "#FF453A";
}

export function networkQualityLabel(q: NetworkQuality): string {
  if (q === "wifi") return "WiFi";
  if (q === "4g") return "4G";
  if (q === "3g") return "3G";
  if (q === "2g") return "2G";
  return "Net";
}

export function healthColor(status: HealthStatus): string {
  if (status === "good") return "#5ED1C4";
  if (status === "degraded") return "#FFD60A";
  return "#FF453A";
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─── Hook interface ───────────────────────────────────────────────────────────

export interface UseStreamerOptions {
  socket?: any;
  channel?: { ref: string; streamKey: string; rtmpUrl: string } | null;
}

export interface UseStreamerReturn {
  // Channel & connection state
  channel: { ref: string; streamKey: string; rtmpUrl: string } | null;
  channelLoading: boolean;
  channelError: string | null;
  setChannelError: React.Dispatch<React.SetStateAction<string | null>>;
  retryChannel: () => Promise<void>;
  retryCamera: () => Promise<void>;
  socket: Socket | null;

  // Reducer state + dispatch
  state: DashboardState;
  dispatch: React.Dispatch<DashboardAction>;

  // Session earnings
  sessionEarnings: number;

  // Gap 1: Historical earnings
  earningsHistory: EarningsHistory | null;

  // Gap 2: Persistent thumbnail
  thumbnailUrl: string | null;

  // Gap 4: Server recording upload
  serverRecordingUrl: string | null;
  serverRecordingUploading: boolean;
  uploadRecordingToServer: () => Promise<void>;

  // Filter settings (passed to VideoFilters as props)
  filterSettings: FilterSettingsState;
  setFilterSettings: React.Dispatch<React.SetStateAction<FilterSettingsState>>;

  // Local UI state
  showStopConfirm: boolean;
  setShowStopConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  streamError: string | null;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  durationSec: number;
  recordingBlob: Blob | null;
  bitrateSamples: number[];
  localRecordEnabled: boolean;
  setLocalRecordEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  showRtmpKey: boolean;
  setShowRtmpKey: React.Dispatch<React.SetStateAction<boolean>>;
  rtmpKeyCopied: boolean;
  setRtmpKeyCopied: React.Dispatch<React.SetStateAction<boolean>>;
  rtmpUrlCopied: boolean;
  setRtmpUrlCopied: React.Dispatch<React.SetStateAction<boolean>>;
  availableCameras: MediaDeviceInfo[];
  cameraIndex: number;

  // Network quality
  networkQuality: NetworkQuality;

  // Stream title
  streamTitle: string;
  setStreamTitle: React.Dispatch<React.SetStateAction<string>>;
  streamDesc: string;
  setStreamDesc: React.Dispatch<React.SetStateAction<string>>;
  category: string;
  setCategory: React.Dispatch<React.SetStateAction<string>>;
  thumbnail: string | null;
  setThumbnail: (dataUrl: string | null) => void;

  // Mobile detection
  isMobileDevice: boolean;

  // Stream profile + Grok auto-chat
  streamProfile: { boundaries: string; turnOns: string; streamGoal: string };
  setStreamProfile: React.Dispatch<React.SetStateAction<{ boundaries: string; turnOns: string; streamGoal: string }>>;
  autoMessages: string[];
  profileSaving: boolean;
  profileError: string | null;
  autoActive: boolean;
  autoError: string | null;

  // Refs exposed for UI (video preview)
  videoRef: React.RefObject<HTMLVideoElement>;
  sceneStreamRef: React.MutableRefObject<MediaStream | null>;
  /** Raw camera stream — shared so SceneManager can reuse instead of acquiring a second getUserMedia. */
  rawStreamRef: React.MutableRefObject<MediaStream | null>;

  // Derived
  health: HealthStatus;
  hColor: string;
  isDesktopLayout: boolean;

  // Action handlers
  goLive: () => Promise<void>;
  stopStream: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  brb: () => void;
  snapshot: () => void;
  flipCamera: () => Promise<void>;
  downloadRecording: () => void;
  handleGoLiveClick: () => void;

  // Media pipeline callbacks
  handleSceneStream: (stream: MediaStream) => void;
  handleFilteredOutput: (stream: MediaStream) => void;
  handleMixedAudioOutput: (destination: MediaStreamAudioDestinationNode) => void;

  // Profile actions
  saveProfile: () => Promise<void>;
  toggleAutoMessages: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStreamer({ socket: socketProp, channel: channelProp }: UseStreamerOptions = {}): UseStreamerReturn {
  // ── Self-provision socket & channel when not passed as props ─────────────
  const [ownSocket, setOwnSocket] = useState<Socket | null>(null);
  const [ownChannel, setOwnChannel] = useState<{ ref: string; streamKey: string; rtmpUrl: string } | null>(null);
  const [channelLoading, setChannelLoading] = useState(!channelProp);
  const [channelError, setChannelError] = useState<string | null>(null);

  const socket: Socket | null = (socketProp || ownSocket) as Socket | null;
  const channel = channelProp || ownChannel;

  useEffect(() => {
    if (!socketProp) {
      const s = connectSocket();
      setOwnSocket(s as unknown as Socket);
      return () => { s.disconnect(); };
    }
  }, [socketProp]);

  // Channel resolution — pulled into a named function so the error banner's
  // Retry button can re-trigger it without unmounting the studio.
  const loadChannel = useCallback(async () => {
    if (channelProp) return;
    setChannelLoading(true);
    setChannelError(null);
    try {
      const res = await getMyChannel();
      if (res.success && res.channel) {
        setOwnChannel(res.channel);
        return;
      }
      const prov = await provisionChannel();
      if (prov.success && prov.rtmpUrl && prov.streamKey && prov.channelRef) {
        setOwnChannel({
          ref: prov.channelRef,
          streamKey: prov.streamKey,
          rtmpUrl: prov.rtmpUrl,
        });
      } else {
        setChannelError(prov.error || "Could not set up your streaming channel.");
      }
    } catch {
      setChannelError("Failed to load channel info.");
    } finally {
      setChannelLoading(false);
    }
  }, [channelProp]);

  useEffect(() => {
    void loadChannel();
  }, [loadChannel]);

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

  const [sessionEarnings, setSessionEarnings] = useState(0);

  // ── Gap 1: Historical earnings ────────────────────────────────────────────
  const [earningsHistory, setEarningsHistory] = useState<EarningsHistory | null>(null);

  // ── Gap 2: Persistent thumbnail URL ──────────────────────────────────────
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // ── Gap 4: Server recording upload state ─────────────────────────────────
  const [serverRecordingUrl, setServerRecordingUrl] = useState<string | null>(null);
  const [serverRecordingUploading, setServerRecordingUploading] = useState(false);

  // ── Persistent settings (load on mount, debounced save on change) ────────
  const [filterSettings, setFilterSettings] = useState<FilterSettingsState>({
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
        const s = res.settings as StreamerSettings & { thumbnailUrl?: string | null };
        const preset = QUALITY_PRESETS.find((p) => p.id === s.qualityPreset) || QUALITY_PRESETS[0];
        dispatch({ type: "SET_PRESET", payload: preset });
        if (s.fps === 24 || s.fps === 30 || s.fps === 60) {
          dispatch({ type: "SET_FPS", payload: s.fps });
        }
        if (!s.autoReconnect !== !state.autoReconnect) dispatch({ type: "TOGGLE_AUTO_RECONNECT" });
        if (!s.lowLatency !== !state.lowLatency) dispatch({ type: "TOGGLE_LOW_LATENCY" });
        if (!s.hardwareAccel !== !state.hardwareAccel) dispatch({ type: "TOGGLE_HW_ACCEL" });
        setLocalRecordEnabled(s.localRecord);
        setFilterSettings({
          filterPreset: s.filterPreset,
          filterBrightness: s.filterBrightness,
          filterContrast: s.filterContrast,
          filterSaturation: s.filterSaturation,
          filterWarmth: s.filterWarmth,
          filterSharpness: s.filterSharpness,
          beautyMode: s.beautyMode,
        });
        // Gap 2: Hydrate thumbnail from persistent URL
        if (s.thumbnailUrl) {
          setThumbnailUrl(s.thumbnailUrl);
          setThumbnail(s.thumbnailUrl);
        }
        // Gap 5: Hydrate stream title/description from last saved values
        // Only populate if the user has not already typed something
        const sWithMeta = s as StreamerSettings & { lastStreamTitle?: string | null; lastStreamDescription?: string | null };
        if (sWithMeta.lastStreamTitle) setStreamTitle((prev) => prev || sWithMeta.lastStreamTitle!);
        if (sWithMeta.lastStreamDescription) setStreamDesc((prev) => prev || sWithMeta.lastStreamDescription!);
        settingsLoadedRef.current = true;
      })
      .catch(() => {
        settingsLoadedRef.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gap 1: Fetch earnings history once on mount (non-blocking)
  useEffect(() => {
    getEarningsHistory()
      .then((res) => {
        if (res.success) setEarningsHistory(res);
      })
      .catch(() => {
        // Non-fatal — panel shows nothing gracefully
      });
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

  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Wake lock ref ──────────────────────────────────────────────────────────
  const wakeLockRef = useRef<any>(null);

  // ── Network quality state ──────────────────────────────────────────────────
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(() =>
    getNetworkQuality((navigator as any).connection)
  );
  const [streamTitle, setStreamTitle] = useState("");
  const [streamDesc, setStreamDesc] = useState("");
  const [category, setCategory] = useState("tagChat");
  const [thumbnail, setThumbnailRaw] = useState<string | null>(null);

  // Gap 5: stream title/description auto-save. Debounce 1000ms; only fires
  // after settings are loaded to avoid stomping persisted values on mount.
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    titleSaveTimerRef.current = setTimeout(() => {
      updateStreamerSettings({ lastStreamTitle: streamTitle, lastStreamDescription: streamDesc }).catch(() => {});
    }, 1000);
    return () => { if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamTitle, streamDesc]);

  // Gap 2: setThumbnail triggers a background upload to persist the URL server-side
  const setThumbnail = useCallback((dataUrl: string | null) => {
    setThumbnailRaw(dataUrl);
    if (!dataUrl) return;
    // Fire-and-forget — non-blocking for UX
    uploadThumbnail(dataUrl)
      .then((res) => {
        if (res.success && res.url) {
          setThumbnailUrl(res.url);
        }
      })
      .catch(() => {
        // Non-fatal — preview still works locally
      });
  }, []);

  // ── Mobile detection ──────────────────────────────────────────────────────
  const isMobileDevice = window.innerWidth < 768 || "ontouchstart" in window;

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
  const [autoError, setAutoError] = useState<string | null>(null);

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
  // Gap 3: Metrics telemetry interval (emits stream:metrics every 5s while live)
  const metricsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Watchdog timer for stream:start — fires if `stream:started` never arrives,
  // so the UI doesn't spin in "Connecting…" forever after a backend drop.
  const connectAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to always reflect the latest stats without needing stable closure deps
  const latestStatsRef = useRef<StreamStats>({ bitrate: 0, fps: 0, droppedFrames: 0, bytesSent: 0, latency: 0 });

  // ── Processed stream refs (scene → filters → audio → final) ─────────────
  const sceneStreamRef = useRef<MediaStream | null>(null);
  const filteredStreamRef = useRef<MediaStream | null>(null);
  const mixedAudioNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // ── Cleanup helpers ───────────────────────────────────────────────────────
  const clearAllTimers = useCallback(() => {
    if (durationTimerRef.current)  { clearInterval(durationTimerRef.current);  durationTimerRef.current = null; }
    if (statsTimerRef.current)     { clearInterval(statsTimerRef.current);     statsTimerRef.current = null; }
    if (frameTimerRef.current)     { clearInterval(frameTimerRef.current);     frameTimerRef.current = null; }
    if (pingTimerRef.current)      { clearInterval(pingTimerRef.current);      pingTimerRef.current = null; }
    if (metricsTimerRef.current)   { clearInterval(metricsTimerRef.current);   metricsTimerRef.current = null; }
    if (connectAckTimerRef.current){ clearTimeout(connectAckTimerRef.current); connectAckTimerRef.current = null; }
  }, []);

  const stopRecorder = useCallback((ref: React.MutableRefObject<MediaRecorder | null>) => {
    if (ref.current && ref.current.state !== "inactive") {
      ref.current.stop();
    }
    ref.current = null;
  }, []);

  // Async variant — resolves after the recorder's onstop event so any buffered
  // chunks have already been flushed through ondataavailable. Used by stopStream
  // so we don't emit stream:stop before the last 250ms of video has been sent.
  const stopRecorderAsync = useCallback(
    (ref: React.MutableRefObject<MediaRecorder | null>, timeoutMs = 2000) => {
      return new Promise<void>((resolve) => {
        const rec = ref.current;
        if (!rec || rec.state === "inactive") {
          ref.current = null;
          resolve();
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          ref.current = null;
          resolve();
        };
        rec.addEventListener("stop", finish, { once: true });
        try {
          rec.stop();
        } catch {
          finish();
          return;
        }
        // Safety net in case onstop is never fired (browser quirk / no chunks)
        setTimeout(finish, timeoutMs);
      });
    },
    []
  );

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
    videoSource.getVideoTracks().forEach((t) => finalStream.addTrack(t));
    if (audioSource) {
      audioSource.getAudioTracks().forEach((t) => finalStream.addTrack(t));
    }

    return finalStream;
  }, []);

  // ── Callbacks for sub-component outputs ──────────────────────────────────
  const handleSceneStream = useCallback((stream: MediaStream) => {
    sceneStreamRef.current = stream;
  }, []);

  const handleFilteredOutput = useCallback((stream: MediaStream) => {
    filteredStreamRef.current = stream;
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

  // ── Network quality monitor ────────────────────────────────────────────────
  useEffect(() => {
    const conn = (navigator as any).connection;
    if (!conn) return;

    const handleChange = () => {
      const q = getNetworkQuality(conn);
      setNetworkQuality(q);
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

  // ── Wake lock helpers ──────────────────────────────────────────────────────
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

  // ── Camera acquisition (extracted so the Retry button can re-call it) ─────
  const acquireCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStreamError(
        "Your browser doesn't support camera access. Use a recent version of Chrome, Firefox, or Edge."
      );
      return;
    }

    // Release any previous tracks before requesting fresh ones — otherwise
    // a manual retry may collide with the still-open device.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    const preset = state.selectedPreset;
    const mobile = detectMobileDevice();

    const tryGetUserMedia = (withResolution: boolean) =>
      navigator.mediaDevices.getUserMedia({
        video: withResolution
          ? {
              width: { ideal: preset.width },
              height: { ideal: preset.height },
              frameRate: { ideal: preset.fps },
              ...(mobile ? { facingMode: { ideal: "user" } } : {}),
            }
          : { facingMode: { ideal: "user" } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

    try {
      let stream: MediaStream;
      try {
        stream = await tryGetUserMedia(true);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "OverconstrainedError") {
          stream = await tryGetUserMedia(false);
        } else {
          throw err;
        }
      }

      streamRef.current = stream;
      setStreamError(null);

      // Listen for mid-session track termination (camera revoked, device unplugged,
      // OS muted the device). Browsers don't fire 'ended' for permission revocation
      // in all cases — but when they do, we surface it so the creator isn't left
      // broadcasting a black frame.
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener("ended", () => {
          setStreamError(
            "Camera disconnected. Check your camera and try again."
          );
        });
      }
      // Race-tolerant attach: PreStreamSetup may mount its <video> element
      // after the getUserMedia promise resolves. Retry every 100ms for up to
      // 5s until videoRef.current is available, then call .play() explicitly
      // since some mobile browsers don't respect autoplay reliably.
      let attempts = 0;
      const attach = () => {
        const el = videoRef.current;
        if (el) {
          try { el.srcObject = stream; } catch { /* noop */ }
          el.play().catch(() => { /* autoplay policy — user gesture will trigger play */ });
          return;
        }
        if (attempts++ < 50) setTimeout(attach, 100);
      };
      attach();
      void enumerateCameras();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      const msg =
        name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access in your browser settings, then tap Retry."
          : name === "NotFoundError"
          ? "No camera found. Make sure your camera is connected and not in use by another app."
          : name === "NotReadableError"
          ? "Camera is in use by another app. Close other apps using the camera, then tap Retry."
          : name === "OverconstrainedError"
          ? "Camera doesn't support the requested resolution. Try a lower preset in Settings."
          : "Could not access camera. Close other apps that may be using it, then tap Retry.";
      setStreamError(msg);
    }
  }, [state.selectedPreset, enumerateCameras]);

  // ── Start preview on mount ────────────────────────────────────────────────
  useEffect(() => {
    void acquireCamera();
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
      if (connectAckTimerRef.current) {
        clearTimeout(connectAckTimerRef.current);
        connectAckTimerRef.current = null;
      }
      dispatch({ type: "SET_LIVE", payload: true });
      dispatch({ type: "SET_CONNECTING", payload: false });
      dispatch({ type: "SET_STREAM_START", payload: now });
      setDurationSec(0);
      setSessionEarnings(0);
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
        latestStatsRef.current = { ...latestStatsRef.current, fps: frameCountRef.current };
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
        // Gap 3: keep latest stats ref current
        latestStatsRef.current = { ...latestStatsRef.current, bitrate: kbps, bytesSent: bytesSentTotalRef.current };
        setBitrateSamples((prev) => {
          const next = [...prev, kbps];
          return next.length > 30 ? next.slice(next.length - 30) : next;
        });
      }, 1000);

      // Ping timer for latency
      pingTimerRef.current = setInterval(() => {
        const pingStart = Date.now();
        socket.emit("ping", () => {
          const latency = Date.now() - pingStart;
          dispatch({ type: "UPDATE_STATS", payload: { latency } });
          latestStatsRef.current = { ...latestStatsRef.current, latency };
        });
      }, 5000);

      // Gap 3: Metrics telemetry — emit latest sample every 5 seconds
      metricsTimerRef.current = setInterval(() => {
        if (!socket?.connected) return;
        const s = latestStatsRef.current;
        socket.emit("stream:metrics", {
          sessionId: null,          // server resolves from socket.data.analyticsSessionId
          kbps: s.bitrate || null,
          fps: s.fps || null,
          dropped: s.droppedFrames || null,
          rtt: s.latency || null,
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
      if (connectAckTimerRef.current) {
        clearTimeout(connectAckTimerRef.current);
        connectAckTimerRef.current = null;
      }
      setStreamError(data.message ?? "Stream error occurred.");
      dispatch({ type: "RESET_STREAM" });
      clearAllTimers();
    };

    const onViewerCount = (data: { count: number }) => {
      dispatch({ type: "SET_VIEWER_COUNT", payload: data.count });
    };

    const onEarningsUpdate = (data: { amount: number }) => {
      setSessionEarnings((prev) => prev + data.amount);
    };

    socket.on("stream:started", onStarted);
    socket.on("stream:stopped", onStopped);
    socket.on("stream:error", onStreamError);
    socket.on("live:viewer_count", onViewerCount);
    socket.on("stream:earnings_update", onEarningsUpdate);

    return () => {
      socket.off("stream:started", onStarted);
      socket.off("stream:stopped", onStopped);
      socket.off("stream:error", onStreamError);
      socket.off("live:viewer_count", onViewerCount);
      socket.off("stream:earnings_update", onEarningsUpdate);
    };
  }, [socket, clearAllTimers]);

  // ── Mic mute toggle (affects live stream track in real time) ─────────────
  useEffect(() => {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !state.isMuted;
    });
  }, [state.isMuted]);

  // ── Camera off toggle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!streamRef.current) return;
    streamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = !state.isCameraOff;
    });
  }, [state.isCameraOff]);

  // ── Wake lock: acquire when live, release when stream ends ────────────────
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
  const goLive = useCallback(async () => {
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
      setStreamError("Your browser does not support WebM or MP4 recording.");
      return;
    }

    setStreamError(null);
    dispatch({ type: "SET_CONNECTING", payload: true });

    // Watchdog: if the backend never replies with stream:started (5xx, socket
    // drop mid-handshake, FFmpeg spawn hang), drop out of "Connecting…" instead
    // of spinning forever. Cleared by onStarted / onStreamError / RESET_STREAM.
    if (connectAckTimerRef.current) clearTimeout(connectAckTimerRef.current);
    connectAckTimerRef.current = setTimeout(() => {
      setStreamError("Server did not respond. Check your connection and try again.");
      dispatch({ type: "SET_CONNECTING", payload: false });
      // Best-effort recorder teardown — don't await, the user is already seeing an error.
      try { recorderRef.current?.state !== "inactive" && recorderRef.current?.stop(); } catch { /* noop */ }
      recorderRef.current = null;
      try { localRecorderRef.current?.state !== "inactive" && localRecorderRef.current?.stop(); } catch { /* noop */ }
      localRecorderRef.current = null;
    }, 15000);

    socket?.emit("stream:start", {
      channelRef: channel.ref,
      videoBitrate: state.selectedPreset.videoBitrate,
      audioBitrate: state.selectedPreset.audioBitrate,
      fps: state.fps,
      title: streamTitle,
      description: streamDesc,
      tags: [category],
      thumbnailDataUrl: thumbnail,
      // Gap 2: also send persistent URL so backend can prefer it over the data URL
      thumbnailUrl: thumbnailUrl,
      // Tell backend which container we're sending so FFmpeg picks the right -f flag.
      // iOS Safari sends MP4; everyone else sends WebM.
      mimeType,
    });

    // C2: SET_CONNECTING above triggers the live layout to mount, which is where
    // SceneManager/VideoFilters/AudioMixer live. Their useEffects then populate
    // sceneStreamRef/filteredStreamRef/mixedAudioNodeRef via callbacks. Poll
    // briefly so getFinalStream() can pick up the composited pipeline instead
    // of always falling back to the raw camera (which made filters and scenes
    // decorative-only for every previous broadcast).
    const pipelineDeadline = Date.now() + 1500;
    while (Date.now() < pipelineDeadline) {
      const candidate = filteredStreamRef.current || sceneStreamRef.current;
      if (candidate && candidate.getVideoTracks().some((t) => t.readyState === "live")) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Resolve final stream: prefer filtered > scene > raw camera. Stale refs from
    // a previous session may hold streams with ended tracks — fall back to raw
    // if no live video tracks are found in the processed pipeline.
    let finalStream: MediaStream | null = getFinalStream();
    if (!finalStream || !finalStream.getVideoTracks().some((t) => t.readyState === "live")) {
      finalStream = streamRef.current;
    }

    // Guard against starting a recorder with no live video tracks.
    if (!finalStream || !finalStream.getVideoTracks().some((t) => t.readyState === "live")) {
      setStreamError("No video source available. Check camera permissions and try again.");
      dispatch({ type: "SET_CONNECTING", payload: false });
      if (connectAckTimerRef.current) { clearTimeout(connectAckTimerRef.current); connectAckTimerRef.current = null; }
      return;
    }

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
          // Use the same container the recorder produced — webm on Chrome/FF, mp4 on iOS Safari.
          const blobType = mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
          const blob = new Blob(localChunksRef.current, { type: blobType });
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
  // Awaits the recorder's onstop event before emitting stream:stop so any
  // buffered chunks (last ~250ms) reach the backend before FFmpeg's stdin
  // is closed. Local recorder is stopped in parallel.
  const stopStream = useCallback(async () => {
    await Promise.all([
      stopRecorderAsync(recorderRef),
      stopRecorderAsync(localRecorderRef),
    ]);
    socket?.emit("stream:stop");
    clearAllTimers();
    dispatch({ type: "RESET_STREAM" });
    setDurationSec(0);
    // Clear processed stream refs so the next goLive() doesn't reuse stale/ended
    // tracks from the previous session (causes 0-chunk recorder with no data sent).
    filteredStreamRef.current = null;
    sceneStreamRef.current = null;
    mixedAudioNodeRef.current = null;
  }, [socket, stopRecorderAsync, clearAllTimers]);

  // ── Screen Share ──────────────────────────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    if (state.isScreenSharing) {
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

      screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        dispatch({ type: "TOGGLE_SCREEN_SHARE" });
      });
    } catch {
      // User cancelled — silently ignore
    }
  }, [state.isScreenSharing, state.selectedPreset.fps]);

  // ── BRB Scene ─────────────────────────────────────────────────────────────
  const brb = useCallback(() => {
    // Compute the NEW camera-off state (true = entering BRB, false = leaving)
    const newCameraOff = !state.isCameraOff;
    if (newCameraOff) {
      // Entering BRB: ensure camera + mic are off
      if (!state.isCameraOff) dispatch({ type: "TOGGLE_CAMERA" });
      if (!state.isMuted) dispatch({ type: "TOGGLE_MUTE" });
    } else {
      // Leaving BRB: restore camera + mic
      if (state.isCameraOff) dispatch({ type: "TOGGLE_CAMERA" });
      if (state.isMuted) dispatch({ type: "TOGGLE_MUTE" });
    }
    // Broadcast BRB state to all viewers via Socket.IO
    if (socket?.connected) {
      socket.emit("stream:brb", { on: newCameraOff });
    }
  }, [state.isCameraOff, state.isMuted, socket]);

  // ── Snapshot ──────────────────────────────────────────────────────────────
  const snapshot = useCallback(() => {
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
      // Browser download (existing behaviour)
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snapshot-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);

      // Background server upload — fire-and-forget; silently ignore failures
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        if (dataUrl) {
          uploadSnapshot(dataUrl, null).catch(() => {});
        }
      };
      reader.readAsDataURL(blob);
    }, "image/png");
  }, []);

  // ── Flip Camera ───────────────────────────────────────────────────────────
  const flipCamera = useCallback(async () => {
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
  const downloadRecording = useCallback(() => {
    if (!recordingBlob) return;
    const url = URL.createObjectURL(recordingBlob);
    const a = document.createElement("a");
    a.href = url;
    const ext = recordingBlob.type.startsWith("video/mp4") ? "mp4" : "webm";
    a.download = `stream-recording-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recordingBlob]);

  // ── Gap 4: Upload local recording to server ───────────────────────────────
  const uploadRecordingToServer = useCallback(async () => {
    if (!recordingBlob || serverRecordingUploading) return;
    setServerRecordingUploading(true);
    setServerRecordingUrl(null);
    try {
      const res = await uploadRecording(recordingBlob, null, durationSec);
      if (res.success) {
        setServerRecordingUrl(res.publicUrl);
      }
    } catch {
      // Errors surface via serverRecordingUrl remaining null — caller can show error toast
    } finally {
      setServerRecordingUploading(false);
    }
  }, [recordingBlob, serverRecordingUploading, durationSec]);

  // ── Go Live button handler (with confirmation for stop) ───────────────────
  const handleGoLiveClick = useCallback(() => {
    if (state.isLive) {
      setShowStopConfirm(true);
    } else if (!state.isConnecting) {
      void goLive();
    }
  }, [state.isLive, state.isConnecting, goLive]);

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

  const saveProfile = useCallback(async () => {
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

  const toggleAutoMessages = useCallback(async () => {
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

  // ── Mute / Camera toggles exposed as named handlers ──────────────────────
  const toggleMute = useCallback(() => {
    dispatch({ type: "TOGGLE_MUTE" });
  }, []);

  const toggleCamera = useCallback(() => {
    dispatch({ type: "TOGGLE_CAMERA" });
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  const health: HealthStatus = (() => {
    const targetBitrate = state.selectedPreset.videoBitrate;
    if (targetBitrate === 0) return "good";
    const ratio = state.stats.bitrate / (targetBitrate / 1000);
    if (ratio >= 0.5) return "good";
    if (ratio >= 0.2) return "degraded";
    return "critical";
  })();

  const hColor = healthColor(health);
  const isDesktopLayout =
    state.orientation === "landscape" || window.matchMedia("(min-width: 1024px)").matches;

  return {
    // Channel & connection state
    channel,
    channelLoading,
    channelError,
    setChannelError,
    retryChannel: loadChannel,
    retryCamera: acquireCamera,
    socket,

    // Reducer state + dispatch
    state,
    dispatch,

    // Session earnings
    sessionEarnings,

    // Gap 1: Historical earnings
    earningsHistory,

    // Gap 2: Persistent thumbnail URL
    thumbnailUrl,

    // Gap 4: Server recording upload
    serverRecordingUrl,
    serverRecordingUploading,
    uploadRecordingToServer,

    // Filter settings
    filterSettings,
    setFilterSettings,

    // Local UI state
    showStopConfirm,
    setShowStopConfirm,
    streamError,
    setStreamError,
    durationSec,
    recordingBlob,
    bitrateSamples,
    localRecordEnabled,
    setLocalRecordEnabled,
    showRtmpKey,
    setShowRtmpKey,
    rtmpKeyCopied,
    setRtmpKeyCopied,
    rtmpUrlCopied,
    setRtmpUrlCopied,
    availableCameras,
    cameraIndex,

    // Network quality
    networkQuality,

    // Stream title
    streamTitle,
    setStreamTitle,
    streamDesc,
    setStreamDesc,
    category,
    setCategory,
    thumbnail,
    setThumbnail,

    // Mobile detection
    isMobileDevice,

    // Stream profile + Grok auto-chat
    streamProfile,
    setStreamProfile,
    autoMessages,
    profileSaving,
    profileError,
    autoActive,
    autoError,

    // Refs exposed for UI
    videoRef,
    sceneStreamRef,
    rawStreamRef: streamRef,

    // Derived
    health,
    hColor,
    isDesktopLayout,

    // Action handlers
    goLive,
    stopStream,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    brb,
    snapshot,
    flipCamera,
    downloadRecording,
    handleGoLiveClick,

    // Media pipeline callbacks
    handleSceneStream,
    handleFilteredOutput,
    handleMixedAudioOutput,

    // Profile actions
    saveProfile,
    toggleAutoMessages,
  };
}
