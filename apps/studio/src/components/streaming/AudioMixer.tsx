import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { getMixerPresets, saveMixerPreset } from "@/lib/api";
import type { StreamPreset } from "@/lib/api";

// ─── Inline SVG icons (matches BrowserStreamer.tsx pattern) ──────────────────

const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronUp = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const MicIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const MicOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const MusicIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const MusicOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 18V5l12-2v13" />
    <path d="M6 21a3 3 0 0 0 2.83-4" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const PlayIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PauseIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const FolderIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ShieldIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const SlidersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioMixerProps {
  /** The MediaStream containing the mic audio track */
  micStream: MediaStream | null;
  /** Optional background music URL to pre-load */
  bgMusicUrl?: string;
  /** Called when the mixed audio output changes (for connecting to MediaRecorder) */
  onMixedOutput?: (destination: MediaStreamAudioDestinationNode) => void;
  /** Whether the stream is currently live */
  isLive: boolean;
  /** Compact mode for mobile */
  compact?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVEL_UPDATE_FPS = 30;
const PEAK_DECAY_PER_FRAME = 0.008; // how fast the peak hold falls per frame
const ANALYSER_FFT_SIZE = 256;

// ─── VU Meter sub-component ───────────────────────────────────────────────────

interface VuMeterProps {
  /** 0-1 current level */
  level: number;
  /** 0-1 peak hold */
  peak: number;
  /** vertical (desktop) or horizontal (compact) */
  orientation: "vertical" | "horizontal";
  /** muted state dims the meter */
  muted: boolean;
  label: string;
}

function VuMeter({ level, peak, orientation, muted, label }: VuMeterProps) {
  // Colour segments: green 0-70%, yellow 70-90%, red 90-100%
  function levelColor(normalizedLevel: number): string {
    if (normalizedLevel >= 0.9) return "#FF453A";
    if (normalizedLevel >= 0.7) return "#FFD60A";
    return "#34C759";
  }

  const clampedLevel = Math.max(0, Math.min(1, level));
  const clampedPeak = Math.max(0, Math.min(1, peak));
  const fillPct = clampedLevel * 100;
  const peakPct = clampedPeak * 100;
  const barColor = levelColor(clampedLevel);
  const opacity = muted ? 0.3 : 1;

  if (orientation === "vertical") {
    return (
      <div
        className="relative flex-shrink-0 rounded-full overflow-visible"
        style={{ width: 4, height: 80, opacity }}
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(clampedLevel * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Track */}
        <div className="absolute inset-0 rounded-full bg-pnp-border" />
        {/* Fill — grows from bottom */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-none"
          style={{
            height: `${fillPct}%`,
            background: barColor,
          }}
        />
        {/* Peak hold indicator */}
        {clampedPeak > 0.01 && (
          <div
            className="absolute left-0 right-0 rounded-full"
            style={{
              bottom: `${peakPct}%`,
              height: 2,
              background: levelColor(clampedPeak),
              transform: "translateY(50%)",
            }}
          />
        )}
      </div>
    );
  }

  // Horizontal orientation for compact/mobile
  return (
    <div
      className="relative flex-1 rounded-full overflow-visible"
      style={{ height: 4, opacity }}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(clampedLevel * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Track */}
      <div className="absolute inset-0 rounded-full bg-pnp-border" />
      {/* Fill — grows from left */}
      <div
        className="absolute top-0 bottom-0 left-0 rounded-full transition-none"
        style={{
          width: `${fillPct}%`,
          background: barColor,
        }}
      />
      {/* Peak hold indicator */}
      {clampedPeak > 0.01 && (
        <div
          className="absolute top-0 bottom-0 rounded-full"
          style={{
            left: `${peakPct}%`,
            width: 2,
            background: levelColor(clampedPeak),
            transform: "translateX(-50%)",
          }}
        />
      )}
    </div>
  );
}

// ─── Range slider sub-component ───────────────────────────────────────────────

interface MixerSliderProps {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  muted?: boolean;
  orientation: "vertical" | "horizontal";
  onChange: (value: number) => void;
  "aria-label": string;
}

function MixerSlider({
  id,
  value,
  min,
  max,
  step,
  disabled = false,
  muted = false,
  orientation,
  onChange,
  "aria-label": ariaLabel,
}: MixerSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;

  const commonStyle: React.CSSProperties = {
    // accent-color for the thumb/track fill using the brand gradient midpoint
    accentColor: "#D4007A",
    opacity: muted ? 0.4 : 1,
  };

  if (orientation === "vertical") {
    return (
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="disabled:cursor-not-allowed touch-none"
        style={{
          ...commonStyle,
          writingMode: "vertical-lr" as React.CSSProperties["writingMode"],
          direction: "rtl" as React.CSSProperties["direction"],
          height: 80,
          width: 28,
          cursor: disabled ? "not-allowed" : "pointer",
          // Custom track styling via CSS variables (webkit)
          WebkitAppearance: "slider-vertical",
          appearance: "slider-vertical" as React.CSSProperties["appearance"],
        }}
        // Fallback data attribute for CSS targeting
        data-pct={Math.round(pct)}
      />
    );
  }

  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full disabled:cursor-not-allowed touch-none"
      style={{
        ...commonStyle,
        height: 28,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      data-pct={Math.round(pct)}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AudioMixer({
  micStream,
  bgMusicUrl,
  onMixedOutput,
  isLive,
  compact = false,
}: AudioMixerProps) {
  // ── Panel state ─────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(true);

  // ── Gain values (as percentages/100 for display) ─────────────────────────
  const [micGainPct, setMicGainPct] = useState(100); // 0-150
  const [bgGainPct, setBgGainPct] = useState(30);    // 0-100
  const [masterGainPct, setMasterGainPct] = useState(100); // 0-100

  // ── Mute state ───────────────────────────────────────────────────────────
  const [micMuted, setMicMuted] = useState(false);
  const [bgMuted, setBgMuted] = useState(false);

  // ── Noise suppression ────────────────────────────────────────────────────
  const [noiseSuppression, setNoiseSuppression] = useState(true);

  // Gap 5: Mixer presets (declared after gain state so getMixerConfig can capture them)
  const [mixerPresets, setMixerPresets] = useState<StreamPreset[]>([]);
  const [presetSaveMode, setPresetSaveMode] = useState(false);
  const [presetSaveName, setPresetSaveName] = useState("");
  const [presetSaving, setPresetSaving] = useState(false);

  // Track whether initial hydration is complete (prevents auto-save on first render)
  const mixerHydratedRef = useRef(false);

  // Load presets on mount; restore __auto__ preset if one exists
  useEffect(() => {
    getMixerPresets()
      .then((res) => {
        if (res.success) {
          setMixerPresets(res.presets);
          const auto = res.presets.find((p) => p.name === "__auto__");
          if (auto) {
            const cfg = auto.config as Partial<{
              micGainPct: number;
              bgGainPct: number;
              masterGainPct: number;
              micMuted: boolean;
              bgMuted: boolean;
              noiseSuppression: boolean;
            }>;
            if (typeof cfg.micGainPct === "number") setMicGainPct(cfg.micGainPct);
            if (typeof cfg.bgGainPct === "number") setBgGainPct(cfg.bgGainPct);
            if (typeof cfg.masterGainPct === "number") setMasterGainPct(cfg.masterGainPct);
            if (typeof cfg.micMuted === "boolean") setMicMuted(cfg.micMuted);
            if (typeof cfg.bgMuted === "boolean") setBgMuted(cfg.bgMuted);
            if (typeof cfg.noiseSuppression === "boolean") setNoiseSuppression(cfg.noiseSuppression);
          }
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => {
        mixerHydratedRef.current = true;
      });
  }, []);

  // Capture current mixer state as serializable config
  const getMixerConfig = useCallback(() => ({
    micGainPct,
    bgGainPct,
    masterGainPct,
    micMuted,
    bgMuted,
    noiseSuppression,
  }), [micGainPct, bgGainPct, masterGainPct, micMuted, bgMuted, noiseSuppression]);

  // Apply a loaded preset config
  const loadMixerPreset = useCallback((preset: StreamPreset) => {
    const cfg = preset.config as Partial<{
      micGainPct: number;
      bgGainPct: number;
      masterGainPct: number;
      micMuted: boolean;
      bgMuted: boolean;
      noiseSuppression: boolean;
    }>;
    if (typeof cfg.micGainPct === "number") setMicGainPct(cfg.micGainPct);
    if (typeof cfg.bgGainPct === "number") setBgGainPct(cfg.bgGainPct);
    if (typeof cfg.masterGainPct === "number") setMasterGainPct(cfg.masterGainPct);
    if (typeof cfg.micMuted === "boolean") setMicMuted(cfg.micMuted);
    if (typeof cfg.bgMuted === "boolean") setBgMuted(cfg.bgMuted);
    if (typeof cfg.noiseSuppression === "boolean") setNoiseSuppression(cfg.noiseSuppression);
  }, []);

  const handleSaveMixerPreset = useCallback(async () => {
    const name = presetSaveName.trim();
    if (!name) return;
    setPresetSaving(true);
    try {
      const config = getMixerConfig();
      const res = await saveMixerPreset({ name, config });
      if (res.success) {
        setMixerPresets((prev) => {
          const exists = prev.findIndex((p) => p.id === res.preset.id);
          if (exists >= 0) {
            const next = [...prev];
            next[exists] = res.preset;
            return next;
          }
          return [res.preset, ...prev];
        });
        setPresetSaveName("");
        setPresetSaveMode(false);
      }
    } catch { /* non-fatal */ } finally {
      setPresetSaving(false);
    }
  }, [presetSaveName, getMixerConfig]);

  // Auto-save mixer state to __auto__ preset (debounced 500ms)
  const mixerAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!mixerHydratedRef.current) return;
    if (mixerAutoSaveTimerRef.current) clearTimeout(mixerAutoSaveTimerRef.current);
    mixerAutoSaveTimerRef.current = setTimeout(() => {
      saveMixerPreset({ name: "__auto__", config: getMixerConfig(), isDefault: false }).catch(() => {});
    }, 500);
    return () => { if (mixerAutoSaveTimerRef.current) clearTimeout(mixerAutoSaveTimerRef.current); };
  }, [micGainPct, bgGainPct, masterGainPct, micMuted, bgMuted, noiseSuppression, getMixerConfig]);

  // ── BG music state ───────────────────────────────────────────────────────
  const [bgFileName, setBgFileName] = useState<string | null>(
    bgMusicUrl ? bgMusicUrl.split("/").pop() ?? bgMusicUrl : null
  );
  const [bgPlaying, setBgPlaying] = useState(false);
  const [bgReady, setBgReady] = useState(false);

  // ── Level meters ─────────────────────────────────────────────────────────
  const [micLevel, setMicLevel] = useState(0);
  const [micPeak, setMicPeak] = useState(0);
  const [bgLevel, setBgLevel] = useState(0);
  const [bgPeak, setBgPeak] = useState(0);
  const [masterLevel, setMasterLevel] = useState(0);
  const [masterPeak, setMasterPeak] = useState(0);

  // ── AudioContext and node refs ───────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const bgAudioElRef = useRef<HTMLAudioElement | null>(null);
  const bgSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const bgGainRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const bgAnalyserRef = useRef<AnalyserNode | null>(null);
  const masterAnalyserRef = useRef<AnalyserNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stable peak refs (avoids stale closure in RAF)
  const micPeakRef = useRef(0);
  const bgPeakRef = useRef(0);
  const masterPeakRef = useRef(0);

  // ── Build / rebuild Audio Graph ───────────────────────────────────────────
  // We do this in a useLayoutEffect so the graph is ready before paint.
  // Teardown is handled in the cleanup return.
  const buildGraph = useCallback(() => {
    // Create or resume AudioContext
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;

    // --- Mic chain ---
    // Disconnect and recreate mic source if stream changed
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect(); } catch { /* already disconnected */ }
      micSourceRef.current = null;
    }

    if (!micGainRef.current) {
      micGainRef.current = ctx.createGain();
    }
    if (!micAnalyserRef.current) {
      micAnalyserRef.current = ctx.createAnalyser();
      micAnalyserRef.current.fftSize = ANALYSER_FFT_SIZE;
      micAnalyserRef.current.smoothingTimeConstant = 0.75;
    }

    if (micStream) {
      micSourceRef.current = ctx.createMediaStreamSource(micStream);
      micSourceRef.current.connect(micGainRef.current);
    }
    micGainRef.current.connect(micAnalyserRef.current);

    // --- BG music chain ---
    if (!bgAudioElRef.current) {
      const el = new Audio();
      el.loop = true;
      el.crossOrigin = "anonymous";
      bgAudioElRef.current = el;
    }

    if (!bgSourceRef.current) {
      bgSourceRef.current = ctx.createMediaElementSource(bgAudioElRef.current);
    }
    if (!bgGainRef.current) {
      bgGainRef.current = ctx.createGain();
    }
    if (!bgAnalyserRef.current) {
      bgAnalyserRef.current = ctx.createAnalyser();
      bgAnalyserRef.current.fftSize = ANALYSER_FFT_SIZE;
      bgAnalyserRef.current.smoothingTimeConstant = 0.75;
    }
    bgSourceRef.current.connect(bgGainRef.current);
    bgGainRef.current.connect(bgAnalyserRef.current);

    // --- Master chain ---
    if (!masterGainRef.current) {
      masterGainRef.current = ctx.createGain();
    }
    if (!masterAnalyserRef.current) {
      masterAnalyserRef.current = ctx.createAnalyser();
      masterAnalyserRef.current.fftSize = ANALYSER_FFT_SIZE;
      masterAnalyserRef.current.smoothingTimeConstant = 0.75;
    }
    if (!destinationRef.current) {
      destinationRef.current = ctx.createMediaStreamDestination();
    }

    micAnalyserRef.current.connect(masterGainRef.current);
    bgAnalyserRef.current.connect(masterGainRef.current);
    masterGainRef.current.connect(masterAnalyserRef.current);
    masterAnalyserRef.current.connect(destinationRef.current);

    // Apply current gain values immediately
    applyGains();

    return ctx;
  }, [micStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply current gain values to nodes ───────────────────────────────────
  const applyGains = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;

    if (micGainRef.current) {
      const g = micMuted ? 0 : (micGainPct / 100);
      micGainRef.current.gain.setTargetAtTime(g, now, 0.02);
    }
    if (bgGainRef.current) {
      const g = bgMuted ? 0 : (bgGainPct / 100);
      bgGainRef.current.gain.setTargetAtTime(g, now, 0.02);
    }
    if (masterGainRef.current) {
      const g = masterGainPct / 100;
      masterGainRef.current.gain.setTargetAtTime(g, now, 0.02);
    }
  }, [micGainPct, bgGainPct, masterGainPct, micMuted, bgMuted]);

  // ── Init graph on mount / when micStream changes ──────────────────────────
  useLayoutEffect(() => {
    buildGraph();
    // Notify caller of the destination node
    if (destinationRef.current && onMixedOutput) {
      onMixedOutput(destinationRef.current);
    }
    return () => {
      // Full teardown on unmount
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try { micSourceRef.current?.disconnect(); } catch { /* ok */ }
      try { micGainRef.current?.disconnect(); } catch { /* ok */ }
      try { micAnalyserRef.current?.disconnect(); } catch { /* ok */ }
      try { bgSourceRef.current?.disconnect(); } catch { /* ok */ }
      try { bgGainRef.current?.disconnect(); } catch { /* ok */ }
      try { bgAnalyserRef.current?.disconnect(); } catch { /* ok */ }
      try { masterGainRef.current?.disconnect(); } catch { /* ok */ }
      try { masterAnalyserRef.current?.disconnect(); } catch { /* ok */ }

      micSourceRef.current = null;
      micGainRef.current = null;
      micAnalyserRef.current = null;
      bgSourceRef.current = null;
      bgGainRef.current = null;
      bgAnalyserRef.current = null;
      masterGainRef.current = null;
      masterAnalyserRef.current = null;
      destinationRef.current = null;

      if (bgAudioElRef.current) {
        bgAudioElRef.current.pause();
        bgAudioElRef.current.src = "";
        bgAudioElRef.current = null;
      }

      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => { /* ok */ });
        audioCtxRef.current = null;
      }
    };
  }, [micStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep gains in sync with state ────────────────────────────────────────
  useEffect(() => {
    applyGains();
  }, [applyGains]);

  // ── Pre-load bgMusicUrl prop ──────────────────────────────────────────────
  useEffect(() => {
    if (!bgMusicUrl || !bgAudioElRef.current) return;
    bgAudioElRef.current.src = bgMusicUrl;
    setBgFileName(bgMusicUrl.split("/").pop() ?? bgMusicUrl);
    setBgReady(false);
    const el = bgAudioElRef.current;
    const onCanPlay = () => setBgReady(true);
    el.addEventListener("canplaythrough", onCanPlay, { once: true });
    return () => el.removeEventListener("canplaythrough", onCanPlay);
  }, [bgMusicUrl]);

  // ── RAF level meter loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!expanded) return; // pause updates when collapsed

    const buf = new Float32Array(ANALYSER_FFT_SIZE / 2);
    const interval = 1000 / LEVEL_UPDATE_FPS;
    let lastTime = 0;

    function getRms(analyser: AnalyserNode): number {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
      }
      return Math.sqrt(sum / buf.length);
    }

    function tick(now: number) {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastTime < interval) return;
      lastTime = now;

      // Mic
      if (micAnalyserRef.current) {
        const rms = getRms(micAnalyserRef.current);
        // Normalise: typical speech RMS ~0.05-0.3, cap at 0.6
        const norm = Math.min(1, rms / 0.3);
        setMicLevel(norm);
        if (norm > micPeakRef.current) {
          micPeakRef.current = norm;
        } else {
          micPeakRef.current = Math.max(0, micPeakRef.current - PEAK_DECAY_PER_FRAME);
        }
        setMicPeak(micPeakRef.current);
      }

      // BG
      if (bgAnalyserRef.current) {
        const rms = getRms(bgAnalyserRef.current);
        const norm = Math.min(1, rms / 0.3);
        setBgLevel(norm);
        if (norm > bgPeakRef.current) {
          bgPeakRef.current = norm;
        } else {
          bgPeakRef.current = Math.max(0, bgPeakRef.current - PEAK_DECAY_PER_FRAME);
        }
        setBgPeak(bgPeakRef.current);
      }

      // Master
      if (masterAnalyserRef.current) {
        const rms = getRms(masterAnalyserRef.current);
        const norm = Math.min(1, rms / 0.3);
        setMasterLevel(norm);
        if (norm > masterPeakRef.current) {
          masterPeakRef.current = norm;
        } else {
          masterPeakRef.current = Math.max(0, masterPeakRef.current - PEAK_DECAY_PER_FRAME);
        }
        setMasterPeak(masterPeakRef.current);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [expanded]);

  // ── Resume AudioContext on first user interaction ─────────────────────────
  const resumeCtx = useCallback(() => {
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume().catch(() => { /* ok */ });
    }
  }, []);

  // ── Noise suppression toggle ──────────────────────────────────────────────
  const handleNoiseSuppressionToggle = useCallback(() => {
    const next = !noiseSuppression;
    setNoiseSuppression(next);
    if (!micStream) return;
    micStream.getAudioTracks().forEach((track) => {
      track
        .applyConstraints({ noiseSuppression: next })
        .catch(() => { /* browser may not support */ });
    });
  }, [noiseSuppression, micStream]);

  // ── BG music file picker ──────────────────────────────────────────────────
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !bgAudioElRef.current) return;
      const url = URL.createObjectURL(file);
      bgAudioElRef.current.src = url;
      setBgFileName(file.name);
      setBgReady(false);
      setBgPlaying(false);
      const el = bgAudioElRef.current;
      const onCanPlay = () => setBgReady(true);
      el.addEventListener("canplaythrough", onCanPlay, { once: true });
    },
    []
  );

  // ── BG play/pause ─────────────────────────────────────────────────────────
  const handleBgPlayPause = useCallback(() => {
    resumeCtx();
    const el = bgAudioElRef.current;
    if (!el || !bgReady) return;
    if (bgPlaying) {
      el.pause();
      setBgPlaying(false);
    } else {
      el.play().catch(() => { /* autoplay blocked — user gesture already happened */ });
      setBgPlaying(true);
    }
  }, [bgPlaying, bgReady, resumeCtx]);

  // ── Mic mute — also mutes track itself ───────────────────────────────────
  const handleMicMute = useCallback(() => {
    resumeCtx();
    const next = !micMuted;
    setMicMuted(next);
    if (micStream) {
      micStream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    }
  }, [micMuted, micStream, resumeCtx]);

  // ── BG mute ───────────────────────────────────────────────────────────────
  const handleBgMute = useCallback(() => {
    resumeCtx();
    setBgMuted((prev) => !prev);
  }, [resumeCtx]);

  // ── Orientation derived from compact prop ─────────────────────────────────
  const orientation = compact ? "horizontal" : "vertical";

  // ── Icon button shared classes ────────────────────────────────────────────
  const iconBtnBase =
    "flex-shrink-0 flex items-center justify-center rounded-xl border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent";
  const iconBtnSize = "min-w-[44px] min-h-[44px] w-11 h-11";

  // ─────────────────────────────────────────────────────────────────────────
  // ── Render ────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="rounded-2xl border border-pnp-border bg-pnp-surface overflow-hidden"
      onClick={resumeCtx}
    >
      {/* ── Panel header ─────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="
          w-full flex items-center justify-between
          px-4 py-3
          text-left
          hover:bg-pnp-surfaceHover
          transition-colors duration-150
          focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pnp-accent
        "
        aria-expanded={expanded}
        aria-controls="audio-mixer-body"
      >
        <div className="flex items-center gap-2">
          <SlidersIcon className="w-4 h-4 text-pnp-textSecondary" aria-hidden="true" />
          <span className="text-sm font-semibold text-pnp-textPrimary">
            Audio Mixer
          </span>
          {isLive && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white"
              style={{ background: "rgba(239,68,68,0.85)" }}
            >
              <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" aria-hidden="true" />
        )}
      </button>

      {/* ── Panel body ───────────────────────────────────────────────────── */}
      {expanded && (
        <div id="audio-mixer-body" className="px-4 pb-4 space-y-4">
          {/* Separator */}
          <div className="border-t border-pnp-border" />

          {compact ? (
            // ────────────────────────────────────────────────────────────────
            // COMPACT LAYOUT (mobile) — single-column stacked rows
            // ────────────────────────────────────────────────────────────────
            <div className="space-y-3">
              {/* Mic row */}
              <div className="flex items-center gap-3">
                {/* Mute toggle */}
                <button
                  type="button"
                  onClick={handleMicMute}
                  className={`${iconBtnBase} ${iconBtnSize} ${
                    micMuted
                      ? "bg-red-500/15 border-red-500/40 text-red-400"
                      : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary"
                  }`}
                  aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
                  aria-pressed={micMuted}
                >
                  {micMuted ? (
                    <MicOffIcon className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <MicIcon className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>

                {/* Slider + meter column */}
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-pnp-textSecondary">Mic</span>
                    <span className="text-xs font-medium text-pnp-textPrimary tabular-nums">
                      {micGainPct}%
                    </span>
                  </div>
                  <MixerSlider
                    id="mic-gain-compact"
                    value={micGainPct}
                    min={0}
                    max={150}
                    step={1}
                    muted={micMuted}
                    orientation="horizontal"
                    onChange={(v) => { resumeCtx(); setMicGainPct(v); }}
                    aria-label="Microphone volume"
                  />
                  <VuMeter
                    level={micLevel}
                    peak={micPeak}
                    orientation="horizontal"
                    muted={micMuted}
                    label="Microphone level"
                  />
                </div>
              </div>

              {/* BG Music row */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBgMute}
                  className={`${iconBtnBase} ${iconBtnSize} ${
                    bgMuted
                      ? "bg-red-500/15 border-red-500/40 text-red-400"
                      : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary"
                  }`}
                  aria-label={bgMuted ? "Unmute background music" : "Mute background music"}
                  aria-pressed={bgMuted}
                >
                  {bgMuted ? (
                    <MusicOffIcon className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <MusicIcon className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>

                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-pnp-textSecondary">Music</span>
                    <span className="text-xs font-medium text-pnp-textPrimary tabular-nums">
                      {bgGainPct}%
                    </span>
                  </div>
                  <MixerSlider
                    id="bg-gain-compact"
                    value={bgGainPct}
                    min={0}
                    max={100}
                    step={1}
                    muted={bgMuted}
                    orientation="horizontal"
                    onChange={(v) => { resumeCtx(); setBgGainPct(v); }}
                    aria-label="Background music volume"
                  />
                  <VuMeter
                    level={bgLevel}
                    peak={bgPeak}
                    orientation="horizontal"
                    muted={bgMuted}
                    label="Background music level"
                  />
                </div>
              </div>

              {/* Master row */}
              <div className="flex items-center gap-3">
                <div className={`${iconBtnSize} flex-shrink-0 flex items-center justify-center`}>
                  <span className="text-[10px] font-bold text-pnp-textSecondary uppercase tracking-wider">
                    MST
                  </span>
                </div>
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-pnp-textSecondary">Master</span>
                    <span className="text-xs font-medium text-pnp-textPrimary tabular-nums">
                      {masterGainPct}%
                    </span>
                  </div>
                  <MixerSlider
                    id="master-gain-compact"
                    value={masterGainPct}
                    min={0}
                    max={100}
                    step={1}
                    orientation="horizontal"
                    onChange={(v) => { resumeCtx(); setMasterGainPct(v); }}
                    aria-label="Master volume"
                  />
                  <VuMeter
                    level={masterLevel}
                    peak={masterPeak}
                    orientation="horizontal"
                    muted={false}
                    label="Master output level"
                  />
                </div>
              </div>

              {/* Controls row: BG file + play/pause + noise suppression */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* File picker */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`${iconBtnBase} ${iconBtnSize} bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary`}
                  aria-label="Load background music file"
                >
                  <FolderIcon className="w-4 h-4" aria-hidden="true" />
                </button>

                {/* Play/pause BG */}
                <button
                  type="button"
                  onClick={handleBgPlayPause}
                  disabled={!bgReady}
                  className={`${iconBtnBase} ${iconBtnSize} ${
                    bgPlaying
                      ? "border-pnp-accent text-pnp-accent"
                      : "bg-pnp-surface border-pnp-border text-pnp-textSecondary"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                  aria-label={bgPlaying ? "Pause background music" : "Play background music"}
                >
                  {bgPlaying ? (
                    <PauseIcon className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <PlayIcon className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>

                {/* Noise suppression */}
                <button
                  type="button"
                  onClick={handleNoiseSuppressionToggle}
                  className={`${iconBtnBase} ${iconBtnSize} ${
                    noiseSuppression
                      ? "border-pnp-accent text-pnp-accent"
                      : "bg-pnp-surface border-pnp-border text-pnp-textSecondary"
                  }`}
                  aria-label={noiseSuppression ? "Disable noise suppression" : "Enable noise suppression"}
                  aria-pressed={noiseSuppression}
                >
                  <ShieldIcon className="w-4 h-4" aria-hidden="true" />
                </button>

                {/* Filename */}
                {bgFileName && (
                  <span
                    className="text-xs text-pnp-textSecondary truncate max-w-[120px]"
                    title={bgFileName}
                  >
                    {bgFileName}
                  </span>
                )}
              </div>
            </div>
          ) : (
            // ────────────────────────────────────────────────────────────────
            // DESKTOP LAYOUT — vertical sliders with VU meters
            // ────────────────────────────────────────────────────────────────
            <div className="space-y-4">
              {/* Three-channel mixer row */}
              <div className="flex items-end gap-6 justify-center">
                {/* ── MIC CHANNEL ───────────────────────────────────────── */}
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider">
                    Mic
                  </span>

                  {/* Slider + VU meter side by side */}
                  <div className="flex items-end gap-2" style={{ height: 80 }}>
                    <MixerSlider
                      id="mic-gain"
                      value={micGainPct}
                      min={0}
                      max={150}
                      step={1}
                      muted={micMuted}
                      orientation="vertical"
                      onChange={(v) => { resumeCtx(); setMicGainPct(v); }}
                      aria-label="Microphone volume"
                    />
                    <VuMeter
                      level={micLevel}
                      peak={micPeak}
                      orientation="vertical"
                      muted={micMuted}
                      label="Microphone level"
                    />
                  </div>

                  {/* Percentage label */}
                  <span className="text-xs font-medium text-pnp-textPrimary tabular-nums">
                    {micGainPct}%
                  </span>

                  {/* Mute button */}
                  <button
                    type="button"
                    onClick={handleMicMute}
                    className={`${iconBtnBase} ${iconBtnSize} ${
                      micMuted
                        ? "bg-red-500/15 border-red-500/40 text-red-400"
                        : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary"
                    }`}
                    aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
                    aria-pressed={micMuted}
                  >
                    {micMuted ? (
                      <MicOffIcon className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <MicIcon className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Divider */}
                <div className="w-px self-stretch bg-pnp-border opacity-40" />

                {/* ── BG MUSIC CHANNEL ──────────────────────────────────── */}
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider">
                    Music
                  </span>

                  <div className="flex items-end gap-2" style={{ height: 80 }}>
                    <MixerSlider
                      id="bg-gain"
                      value={bgGainPct}
                      min={0}
                      max={100}
                      step={1}
                      muted={bgMuted}
                      orientation="vertical"
                      onChange={(v) => { resumeCtx(); setBgGainPct(v); }}
                      aria-label="Background music volume"
                    />
                    <VuMeter
                      level={bgLevel}
                      peak={bgPeak}
                      orientation="vertical"
                      muted={bgMuted}
                      label="Background music level"
                    />
                  </div>

                  <span className="text-xs font-medium text-pnp-textPrimary tabular-nums">
                    {bgGainPct}%
                  </span>

                  <button
                    type="button"
                    onClick={handleBgMute}
                    className={`${iconBtnBase} ${iconBtnSize} ${
                      bgMuted
                        ? "bg-red-500/15 border-red-500/40 text-red-400"
                        : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary"
                    }`}
                    aria-label={bgMuted ? "Unmute background music" : "Mute background music"}
                    aria-pressed={bgMuted}
                  >
                    {bgMuted ? (
                      <MusicOffIcon className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <MusicIcon className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Divider */}
                <div className="w-px self-stretch bg-pnp-border opacity-40" />

                {/* ── MASTER CHANNEL ────────────────────────────────────── */}
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-semibold text-pnp-textSecondary uppercase tracking-wider">
                    Master
                  </span>

                  <div className="flex items-end gap-2" style={{ height: 80 }}>
                    <MixerSlider
                      id="master-gain"
                      value={masterGainPct}
                      min={0}
                      max={100}
                      step={1}
                      orientation="vertical"
                      onChange={(v) => { resumeCtx(); setMasterGainPct(v); }}
                      aria-label="Master volume"
                    />
                    <VuMeter
                      level={masterLevel}
                      peak={masterPeak}
                      orientation="vertical"
                      muted={false}
                      label="Master output level"
                    />
                  </div>

                  <span className="text-xs font-medium text-pnp-textPrimary tabular-nums">
                    {masterGainPct}%
                  </span>

                  {/* Spacer to align with mute buttons above */}
                  <div className={iconBtnSize} />
                </div>
              </div>

              {/* ── Secondary controls row ──────────────────────────────── */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {/* BG Music file picker */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`${iconBtnBase} ${iconBtnSize} bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary`}
                  aria-label="Load background music file"
                  title="Load background music"
                >
                  <FolderIcon className="w-4 h-4" aria-hidden="true" />
                </button>

                {/* Play / Pause BG */}
                <button
                  type="button"
                  onClick={handleBgPlayPause}
                  disabled={!bgReady}
                  className={`${iconBtnBase} ${iconBtnSize} ${
                    bgPlaying
                      ? "border-pnp-accent text-pnp-accent bg-pnp-accent/10"
                      : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                  aria-label={bgPlaying ? "Pause background music" : "Play background music"}
                  title={bgPlaying ? "Pause" : "Play"}
                >
                  {bgPlaying ? (
                    <PauseIcon className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <PlayIcon className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>

                {/* Filename display */}
                {bgFileName ? (
                  <span
                    className="text-xs text-pnp-textSecondary truncate max-w-[160px]"
                    title={bgFileName}
                  >
                    {bgFileName}
                  </span>
                ) : (
                  <span className="text-xs text-pnp-textSecondary italic">
                    No music loaded
                  </span>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Noise suppression toggle */}
                <button
                  type="button"
                  onClick={handleNoiseSuppressionToggle}
                  className={`
                    inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium
                    transition-colors duration-150
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                    min-h-[44px]
                    ${noiseSuppression
                      ? "border-pnp-accent text-pnp-accent bg-pnp-accent/10"
                      : "bg-pnp-surface border-pnp-border text-pnp-textSecondary hover:border-pnp-accent hover:text-pnp-textPrimary"
                    }
                  `}
                  aria-pressed={noiseSuppression}
                  aria-label={noiseSuppression ? "Disable noise suppression" : "Enable noise suppression"}
                >
                  <ShieldIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                  Noise suppress
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Gap 5: Mixer preset bar — shown when panel is expanded */}
      {expanded && (
        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap border-t border-pnp-border pt-2">
          {mixerPresets.length > 0 && (
            <div className="relative flex-1 min-w-0">
              <select
                className="w-full appearance-none rounded-lg px-2.5 py-1.5 pr-7 text-xs bg-pnp-background border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors"
                defaultValue=""
                onChange={(e) => {
                  const preset = mixerPresets.find((p) => p.id === e.target.value);
                  if (preset) loadMixerPreset(preset);
                  e.target.value = "";
                }}
                aria-label="Load mixer preset"
              >
                <option value="" disabled>Load mixer preset…</option>
                {mixerPresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-pnp-textSecondary" />
            </div>
          )}

          {presetSaveMode ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={presetSaveName}
                onChange={(e) => setPresetSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveMixerPreset();
                  if (e.key === "Escape") { setPresetSaveMode(false); setPresetSaveName(""); }
                }}
                placeholder="Preset name…"
                maxLength={60}
                autoFocus
                className="rounded-lg px-2 py-1.5 text-xs bg-pnp-background border border-pnp-accent text-pnp-textPrimary focus:outline-none w-28"
                style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
                aria-label="Mixer preset name"
              />
              <button
                type="button"
                onClick={handleSaveMixerPreset}
                disabled={presetSaving || !presetSaveName.trim()}
                className="p-1 text-pnp-accent disabled:opacity-40 transition-opacity"
                aria-label="Confirm save preset"
              >
                {/* inline check icon */}
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => { setPresetSaveMode(false); setPresetSaveName(""); }}
                className="p-1 text-pnp-textSecondary hover:opacity-80 transition-opacity"
                aria-label="Cancel"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPresetSaveMode(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-pnp-textSecondary bg-pnp-background border border-pnp-border hover:text-pnp-textPrimary hover:bg-pnp-surface transition-all shrink-0"
              title="Save current mixer settings as preset"
            >
              {/* inline save icon */}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Save as…
            </button>
          )}
        </div>
      )}

      {/* Hidden file input for bg music */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
        // Reset value so the same file can be re-selected
        onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
      />
    </div>
  );
}
