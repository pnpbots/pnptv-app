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

  // Derived
  health: HealthStatus;
  hColor: string;
  isDesktopLayout: boolean;

  // Action handlers
  goLive: () => void;
  stopStream: () => void;
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

  useEffect(() => {
    if (channelProp) return;
    let cancelled = false;
    setChannelLoading(true);
    (async () => {
      try {
        const res = await getMyChannel();
        if (!cancelled && res.success && res.channel) {
          setOwnChannel(res.channel);
          return;
        }
        // No channel yet — self-provision (same path as Creator Studio).
        const prov = await provisionChannel();
        if (cancelled) return;
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
        if (!cancelled) setChannelError("Failed to load channel info.");
      } finally {
        if (!cancelled) setChannelLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
  }, []);

  const stopRecorder = useCallback((ref: React.MutableRefObject<MediaRecorder | null>) => {
    if (ref.current && ref.current.state !== "inactive") {
      ref.current.stop();
    }
    ref.current = null;
  }, []);

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

  // ── Start preview on mount ────────────────────────────────────────────────
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
  const goLive = useCallback(() => {
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
      title: streamTitle,
      description: streamDesc,
      tags: [category],
      thumbnailDataUrl: thumbnail,
      // Gap 2: also send persistent URL so backend can prefer it over the data URL
      thumbnailUrl: thumbnailUrl,
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
  const stopStream = useCallback(() => {
    stopRecorder(recorderRef);
    stopRecorder(localRecorderRef);
    socket?.emit("stream:stop");
    clearAllTimers();
    dispatch({ type: "RESET_STREAM" });
    setDurationSec(0);
  }, [socket, stopRecorder, clearAllTimers]);

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
    if (!state.isCameraOff) dispatch({ type: "TOGGLE_CAMERA" });
    if (!state.isMuted) dispatch({ type: "TOGGLE_MUTE" });
  }, [state.isCameraOff, state.isMuted]);

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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snapshot-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
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
    a.download = `stream-recording-${Date.now()}.webm`;
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
      goLive();
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
