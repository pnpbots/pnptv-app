import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useId,
} from "react";
import { getScenePresets, saveScenePreset } from "@/lib/api";
import type { StreamPreset } from "@/lib/api";

// ─── Inline SVG Icons ─────────────────────────────────────────────────────────

const IconPlus = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconTrash = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
  </svg>
);
const IconEye = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconEyeOff = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const IconChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const IconChevronUp = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
const IconEdit = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const IconCamera = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);
const IconMonitor = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const IconImage = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
);
const IconType = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
  </svg>
);
const IconSquare = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </svg>
);
const IconLayers = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
  </svg>
);
const IconArrowUp = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
  </svg>
);
const IconArrowDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
  </svg>
);
const IconX = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconCheck = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconUpload = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Source {
  id: string;
  type: "camera" | "screen" | "image" | "text" | "color";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
  opacity: number;
  deviceId?: string;
  imageUrl?: string;
  text?: string;
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
}

interface Scene {
  id: string;
  name: string;
  sources: Source[];
}

type TransitionType = "cut" | "fade" | "slide-left" | "slide-right";

export interface SceneManagerProps {
  videoDevices: MediaDeviceInfo[];
  onCanvasStream?: (stream: MediaStream) => void;
  micStream: MediaStream | null;
  isLive: boolean;
  compact?: boolean;
  /**
   * Shared camera stream from useStreamer. When provided, the default camera
   * source reuses this stream instead of calling getUserMedia again — avoids
   * iOS device contention that produced black frames.
   */
  sharedCameraStream?: MediaStream | null;
}

// Canvas resolution
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const CANVAS_FPS = 30;

// ─── ID generator ─────────────────────────────────────────────────────────────

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Default scene factory ────────────────────────────────────────────────────

function makeDefaultScenes(firstDeviceId: string): Scene[] {
  return [
    {
      id: genId(),
      name: "Main Camera",
      sources: [
        {
          id: genId(),
          type: "camera",
          label: "Camera",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 0,
          visible: true,
          opacity: 1,
          deviceId: firstDeviceId,
        },
      ],
    },
    {
      id: genId(),
      name: "Screen Share",
      sources: [
        {
          id: genId(),
          type: "screen",
          label: "Screen Capture",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 0,
          visible: true,
          opacity: 1,
        },
        {
          id: genId(),
          type: "camera",
          label: "Camera (PiP)",
          x: 72,
          y: 68,
          width: 25,
          height: 28,
          zIndex: 1,
          visible: true,
          opacity: 1,
          deviceId: firstDeviceId,
        },
      ],
    },
    {
      id: genId(),
      name: "BRB",
      sources: [
        {
          id: genId(),
          type: "color",
          label: "Dark Background",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 0,
          visible: true,
          opacity: 1,
          bgColor: "#1a1a1a",
        },
        {
          id: genId(),
          type: "text",
          label: "BRB Title",
          x: 50,
          y: 44,
          width: 80,
          height: 12,
          zIndex: 1,
          visible: true,
          opacity: 1,
          text: "Be Right Back",
          fontSize: 36,
          fontColor: "#FFFFFF",
        },
        {
          id: genId(),
          type: "text",
          label: "BRB Subtitle",
          x: 50,
          y: 58,
          width: 70,
          height: 8,
          zIndex: 2,
          visible: true,
          opacity: 1,
          text: "Stream will resume shortly",
          fontSize: 16,
          fontColor: "#A1A1A3",
        },
      ],
    },
  ];
}

// ─── Source icon map ──────────────────────────────────────────────────────────

const SOURCE_ICON_MAP: Record<Source["type"], React.FC<React.SVGProps<SVGSVGElement>>> = {
  camera: IconCamera,
  screen: IconMonitor,
  image: IconImage,
  text: IconType,
  color: IconSquare,
};

const SOURCE_TYPE_LABELS: Record<Source["type"], string> = {
  camera: "Camera",
  screen: "Screen Capture",
  image: "Image",
  text: "Text",
  color: "Solid Color",
};

// ─── Canvas compositor hook ───────────────────────────────────────────────────

interface CompositorState {
  videoStreams: Map<string, HTMLVideoElement>;
  loadedImages: Map<string, HTMLImageElement>;
  /** Keys whose video element wraps tracks owned by an external (shared) stream.
   *  Do NOT call track.stop() on these — useStreamer owns the lifecycle. */
  sharedKeys: Set<string>;
}

function useCompositor(
  activeScene: Scene,
  onCanvasStream: ((stream: MediaStream) => void) | undefined,
  sharedCameraStream: MediaStream | null | undefined,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenARef = useRef<HTMLCanvasElement | null>(null);
  const offscreenBRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef<CompositorState>({
    videoStreams: new Map(),
    loadedImages: new Map(),
    sharedKeys: new Set(),
  });
  const streamRef = useRef<MediaStream | null>(null);
  const activeSceneRef = useRef<Scene>(activeScene);
  const sharedStreamRef = useRef<MediaStream | null | undefined>(sharedCameraStream);
  useEffect(() => {
    sharedStreamRef.current = sharedCameraStream;
  }, [sharedCameraStream]);

  // Sync activeScene into ref so RAF closure always reads latest
  useEffect(() => {
    activeSceneRef.current = activeScene;
  }, [activeScene]);

  // Helper: attach a <video> element off-screen so iOS Safari decodes frames
  // for canvas drawImage (detached elements don't trigger GPU decode on Safari).
  function attachVideoOffscreen(video: HTMLVideoElement) {
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(video);
  }

  // Acquire / release media streams for sources
  const acquireSourceMedia = useCallback(async (source: Source) => {
    const state = stateRef.current;

    if (source.type === "camera") {
      const deviceId = source.deviceId;
      const key = `camera-${source.id}`;
      if (!state.videoStreams.has(key)) {
        try {
          // Reuse the shared raw stream from useStreamer when no specific deviceId
          // is requested. Avoids a second getUserMedia call which on iOS can freeze
          // the first stream. Only call getUserMedia if a specific camera is asked for.
          let stream: MediaStream;
          let isShared = false;
          if (!deviceId && sharedStreamRef.current && sharedStreamRef.current.getVideoTracks().length > 0) {
            // Build a video-only MediaStream from the shared stream's video track —
            // don't share the audio track here (audio is handled by the AudioMixer).
            stream = new MediaStream(sharedStreamRef.current.getVideoTracks());
            isShared = true;
          } else {
            const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
            const constraints: MediaStreamConstraints = {
              video: deviceId
                ? { deviceId: { exact: deviceId } }
                : isMobile
                ? { facingMode: { ideal: "user" } }
                : true,
              audio: false,
            };
            stream = await navigator.mediaDevices.getUserMedia(constraints);
          }
          const video = document.createElement("video");
          video.srcObject = stream;
          attachVideoOffscreen(video);
          await video.play().catch(() => { /* ignore — autoplay policy on iOS standalone */ });
          state.videoStreams.set(key, video);
          if (isShared) state.sharedKeys.add(key);
        } catch {
          // Camera access denied — source will render as empty
        }
      }
    }

    if (source.type === "screen") {
      const key = `screen-${source.id}`;
      if (!state.videoStreams.has(key)) {
        try {
          const stream = await (navigator.mediaDevices as unknown as {
            getDisplayMedia: (opts: DisplayMediaStreamOptions) => Promise<MediaStream>;
          }).getDisplayMedia({ video: true, audio: false });
          const video = document.createElement("video");
          video.srcObject = stream;
          attachVideoOffscreen(video);
          await video.play().catch(() => { /* ignore */ });
          // Auto-cleanup when user stops sharing via browser UI
          stream.getVideoTracks()[0].addEventListener("ended", () => {
            const el = state.videoStreams.get(key);
            if (el) {
              (el.srcObject as MediaStream)?.getTracks().forEach((t) => t.stop());
              el.srcObject = null;
              if (el.parentNode) el.parentNode.removeChild(el);
            }
            state.videoStreams.delete(key);
          });
          state.videoStreams.set(key, video);
        } catch {
          // User cancelled screen share — silently ignore
        }
      }
    }

    if (source.type === "image" && source.imageUrl) {
      const key = `image-${source.id}-${source.imageUrl.slice(0, 40)}`;
      if (!state.loadedImages.has(key)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => state.loadedImages.set(key, img);
        img.onerror = () => { /* image load failed — source renders empty */ };
        img.src = source.imageUrl;
      }
    }
  }, []);

  const releaseSourceMedia = useCallback((sourceId: string) => {
    const state = stateRef.current;
    const cameraKey = `camera-${sourceId}`;
    const screenKey = `screen-${sourceId}`;
    for (const key of [cameraKey, screenKey]) {
      const el = state.videoStreams.get(key);
      if (el) {
        // Only stop tracks we own. Shared tracks are owned by useStreamer.
        if (!state.sharedKeys.has(key)) {
          (el.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
        }
        el.srcObject = null;
        if (el.parentNode) el.parentNode.removeChild(el);
        state.videoStreams.delete(key);
        state.sharedKeys.delete(key);
      }
    }
  }, []);

  // Acquire media for all sources in a scene
  const acquireSceneMedia = useCallback(
    async (scene: Scene) => {
      for (const source of scene.sources) {
        await acquireSourceMedia(source);
      }
    },
    [acquireSourceMedia]
  );

  // Draw one source onto a canvas context
  const drawSource = useCallback(
    (ctx: CanvasRenderingContext2D, source: Source) => {
      if (!source.visible) return;

      const x = (source.x / 100) * CANVAS_WIDTH;
      const y = (source.y / 100) * CANVAS_HEIGHT;
      const w = (source.width / 100) * CANVAS_WIDTH;
      const h = (source.height / 100) * CANVAS_HEIGHT;

      ctx.save();
      ctx.globalAlpha = source.opacity;

      if (source.type === "color") {
        ctx.fillStyle = source.bgColor ?? "#000000";
        ctx.fillRect(x, y, w, h);
      } else if (source.type === "text") {
        const fontSize = source.fontSize ?? 24;
        const text = source.text ?? "";
        ctx.font = `bold ${fontSize}px "Roboto Mono", monospace`;
        ctx.fillStyle = source.fontColor ?? "#FFFFFF";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x + w / 2, y + h / 2, w);
      } else if (source.type === "image") {
        const key = `image-${source.id}-${(source.imageUrl ?? "").slice(0, 40)}`;
        const img = stateRef.current.loadedImages.get(key);
        if (img) {
          ctx.drawImage(img, x, y, w, h);
        }
      } else if (source.type === "camera") {
        const key = `camera-${source.id}`;
        const video = stateRef.current.videoStreams.get(key);
        if (video && video.readyState >= 2) {
          ctx.drawImage(video, x, y, w, h);
        }
      } else if (source.type === "screen") {
        const key = `screen-${source.id}`;
        const video = stateRef.current.videoStreams.get(key);
        if (video && video.readyState >= 2) {
          ctx.drawImage(video, x, y, w, h);
        }
      }

      ctx.restore();
    },
    []
  );

  // Render one frame to a canvas context
  const renderSceneToCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, scene: Scene) => {
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      // Sort by zIndex ascending so higher zIndex renders on top
      const sorted = [...scene.sources].sort((a, b) => a.zIndex - b.zIndex);
      for (const source of sorted) {
        drawSource(ctx, source);
      }
    },
    [drawSource]
  );

  // Start rAF render loop
  const startRenderLoop = useCallback(() => {
    if (rafRef.current !== null) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = () => {
      renderSceneToCanvas(ctx, activeSceneRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [renderSceneToCanvas]);

  const stopRenderLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Initialize canvas and start streaming on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    // Create offscreen canvases for transitions
    const offA = document.createElement("canvas");
    offA.width = CANVAS_WIDTH;
    offA.height = CANVAS_HEIGHT;
    offscreenARef.current = offA;

    const offB = document.createElement("canvas");
    offB.width = CANVAS_WIDTH;
    offB.height = CANVAS_HEIGHT;
    offscreenBRef.current = offB;

    // Emit the stream
    const stream = canvas.captureStream(CANVAS_FPS);
    streamRef.current = stream;
    onCanvasStream?.(stream);

    // Acquire initial scene media and start loop
    acquireSceneMedia(activeSceneRef.current).then(() => {
      startRenderLoop();
    });

    return () => {
      stopRenderLoop();
      // Release all media. Skip stopping tracks for shared streams (owned by useStreamer).
      const state = stateRef.current;
      for (const [key, el] of state.videoStreams) {
        if (!state.sharedKeys.has(key)) {
          (el.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
        }
        el.srcObject = null;
        if (el.parentNode) el.parentNode.removeChild(el);
      }
      state.videoStreams.clear();
      state.sharedKeys.clear();
      state.loadedImages.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    canvasRef,
    offscreenARef,
    offscreenBRef,
    stateRef,
    acquireSourceMedia,
    acquireSceneMedia,
    releaseSourceMedia,
    renderSceneToCanvas,
    stopRenderLoop,
    startRenderLoop,
  };
}

// ─── Transition engine ────────────────────────────────────────────────────────

interface TransitionOptions {
  type: TransitionType;
  duration: number; // seconds
}

function runTransition(
  canvas: HTMLCanvasElement,
  offscreenA: HTMLCanvasElement, // "from" scene snapshot
  offscreenB: HTMLCanvasElement, // "to" scene snapshot
  options: TransitionOptions,
  onComplete: () => void
): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx || options.type === "cut") {
    onComplete();
    return () => { /* no-op */ };
  }

  const startTime = performance.now();
  const durationMs = options.duration * 1000;
  let rafId: number;

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / durationMs, 1);

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (options.type === "fade") {
      ctx.globalAlpha = 1;
      ctx.drawImage(offscreenA, 0, 0);
      ctx.globalAlpha = t;
      ctx.drawImage(offscreenB, 0, 0);
      ctx.globalAlpha = 1;
    } else if (options.type === "slide-left") {
      const offset = t * CANVAS_WIDTH;
      ctx.drawImage(offscreenA, -offset, 0);
      ctx.drawImage(offscreenB, CANVAS_WIDTH - offset, 0);
    } else if (options.type === "slide-right") {
      const offset = t * CANVAS_WIDTH;
      ctx.drawImage(offscreenA, offset, 0);
      ctx.drawImage(offscreenB, -CANVAS_WIDTH + offset, 0);
    }

    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      onComplete();
    }
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

// ─── Inline number input ──────────────────────────────────────────────────────

interface NumInputProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}

function NumInput({ label, value, min, max, step = 1, onChange, suffix }: NumInputProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-pnp-textSecondary">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="w-full rounded-lg px-2 py-1.5 text-xs bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors"
          style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        />
        {suffix && <span className="text-xs text-pnp-textSecondary shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Source Properties Panel ──────────────────────────────────────────────────

interface SourcePropsPanel {
  source: Source;
  videoDevices: MediaDeviceInfo[];
  onChange: (updated: Partial<Source>) => void;
}

function SourcePropertiesPanel({ source, videoDevices, onChange }: SourcePropsPanel) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl === "string") {
        onChange({ imageUrl: dataUrl });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3 px-3 py-3 bg-pnp-background rounded-xl border border-pnp-border">
      <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">
        Source Properties
      </p>

      {/* Label */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-pnp-textSecondary">Label</label>
        <input
          type="text"
          value={source.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-full rounded-lg px-2 py-1.5 text-xs bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors"
          style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        />
      </div>

      {/* Position & Size */}
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="X (%)" value={source.x} min={-100} max={200} onChange={(v) => onChange({ x: v })} suffix="%" />
        <NumInput label="Y (%)" value={source.y} min={-100} max={200} onChange={(v) => onChange({ y: v })} suffix="%" />
        <NumInput label="Width (%)" value={source.width} min={1} max={200} onChange={(v) => onChange({ width: v })} suffix="%" />
        <NumInput label="Height (%)" value={source.height} min={1} max={200} onChange={(v) => onChange({ height: v })} suffix="%" />
      </div>

      {/* Opacity */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-pnp-textSecondary">
          Opacity — {Math.round(source.opacity * 100)}%
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={source.opacity}
          onChange={(e) => onChange({ opacity: parseFloat(e.target.value) })}
          className="w-full accent-pnp-accent"
        />
      </div>

      {/* Camera: device selector */}
      {source.type === "camera" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-pnp-textSecondary">Camera Device</label>
          <div className="relative">
            <select
              value={source.deviceId ?? ""}
              onChange={(e) => onChange({ deviceId: e.target.value })}
              className="w-full appearance-none rounded-lg px-2 py-1.5 pr-7 text-xs bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors"
            >
              {videoDevices.length === 0 && (
                <option value="">No cameras found</option>
              )}
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
            <IconChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-pnp-textSecondary" />
          </div>
        </div>
      )}

      {/* Image: URL + file upload */}
      {source.type === "image" && (
        <div className="space-y-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-pnp-textSecondary">Image URL</label>
            <input
              type="url"
              value={source.imageUrl ?? ""}
              placeholder="https://..."
              onChange={(e) => onChange({ imageUrl: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-xs bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors"
              style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
            />
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:bg-pnp-surfaceHover hover:text-pnp-textPrimary transition-colors"
          >
            <IconUpload className="w-3 h-3" />
            Upload from device
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>
      )}

      {/* Text: content, size, color */}
      {source.type === "text" && (
        <div className="space-y-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-pnp-textSecondary">Text Content</label>
            <textarea
              value={source.text ?? ""}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={2}
              className="w-full rounded-lg px-2 py-1.5 text-xs bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors resize-none"
              style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
            />
          </div>
          <NumInput
            label="Font Size (px)"
            value={source.fontSize ?? 24}
            min={12}
            max={72}
            onChange={(v) => onChange({ fontSize: Math.round(v) })}
            suffix="px"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-pnp-textSecondary">Text Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={source.fontColor ?? "#FFFFFF"}
                onChange={(e) => onChange({ fontColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-pnp-border bg-transparent"
                style={{ padding: "1px" }}
              />
              <span className="text-xs text-pnp-textSecondary font-mono">
                {source.fontColor ?? "#FFFFFF"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Color: color picker */}
      {source.type === "color" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-pnp-textSecondary">Background Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={source.bgColor ?? "#000000"}
              onChange={(e) => onChange({ bgColor: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer border border-pnp-border bg-transparent"
              style={{ padding: "1px" }}
            />
            <span className="text-xs text-pnp-textSecondary font-mono">
              {source.bgColor ?? "#000000"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Source Dropdown ──────────────────────────────────────────────────────

const ADD_SOURCE_OPTIONS: Array<{ type: Source["type"]; label: string; Icon: React.FC<React.SVGProps<SVGSVGElement>> }> = [
  { type: "camera", label: "Camera", Icon: IconCamera },
  { type: "screen", label: "Screen Capture", Icon: IconMonitor },
  { type: "image", label: "Image", Icon: IconImage },
  { type: "text", label: "Text", Icon: IconType },
  { type: "color", label: "Solid Color", Icon: IconSquare },
];

interface AddSourceDropdownProps {
  onAdd: (type: Source["type"]) => void;
}

function AddSourceDropdown({ onAdd }: AddSourceDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white btn-gradient transition-all"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <IconPlus className="w-3.5 h-3.5" />
        Add Source
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-1 z-50 w-48 rounded-xl overflow-hidden border border-pnp-border"
          style={{ background: "#1E1E1E" }}
          role="listbox"
        >
          {ADD_SOURCE_OPTIONS.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              role="option"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-pnp-textPrimary hover:bg-pnp-surfaceHover transition-colors text-left"
              onClick={() => {
                onAdd(type);
                setOpen(false);
              }}
            >
              <Icon className="w-3.5 h-3.5 text-pnp-textSecondary shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Scene Name Edit Modal ────────────────────────────────────────────────────

interface SceneRenameInputProps {
  initialName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function SceneRenameInput({ initialName, onConfirm, onCancel }: SceneRenameInputProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (name.trim()) onConfirm(name.trim());
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={40}
        className="rounded px-1.5 py-0.5 text-xs bg-pnp-background border border-pnp-accent text-pnp-textPrimary focus:outline-none w-28"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        aria-label="Scene name"
      />
      <button
        type="button"
        onClick={() => name.trim() && onConfirm(name.trim())}
        className="text-pnp-accent hover:opacity-80 transition-opacity"
        aria-label="Confirm rename"
      >
        <IconCheck className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-pnp-textSecondary hover:opacity-80 transition-opacity"
        aria-label="Cancel rename"
      >
        <IconX className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Preview Overlay ──────────────────────────────────────────────────────────

interface PreviewOverlayProps {
  scene: Scene;
  selectedSourceId: string | null;
  onSelectSource: (id: string | null) => void;
  onMoveSource: (id: string, x: number, y: number) => void;
  isLive: boolean;
}

function PreviewOverlay({
  scene,
  selectedSourceId,
  onSelectSource,
  onMoveSource,
  isLive,
}: PreviewOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    sourceId: string;
    startMouseX: number;
    startMouseY: number;
    startSourceX: number;
    startSourceY: number;
  } | null>(null);

  const getRelativePos = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  };

  const handleMouseDown = (e: React.MouseEvent, source: Source) => {
    if (isLive) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectSource(source.id);
    dragState.current = {
      sourceId: source.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startSourceX: source.x,
      startSourceY: source.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = ((e.clientX - dragState.current.startMouseX) / rect.width) * 100;
      const dy = ((e.clientY - dragState.current.startMouseY) / rect.height) * 100;
      onMoveSource(
        dragState.current.sourceId,
        dragState.current.startSourceX + dx,
        dragState.current.startSourceY + dy
      );
    };

    const handleMouseUp = () => {
      dragState.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onMoveSource]);

  const handleContainerClick = (e: React.MouseEvent) => {
    if (isLive) return;
    const pos = getRelativePos(e.clientX, e.clientY);
    // Check if click lands inside any source (top-most / highest zIndex first)
    const sorted = [...scene.sources]
      .filter((s) => s.visible)
      .sort((a, b) => b.zIndex - a.zIndex);
    const hit = sorted.find((s) => {
      return (
        pos.x >= s.x &&
        pos.x <= s.x + s.width &&
        pos.y >= s.y &&
        pos.y <= s.y + s.height
      );
    });
    onSelectSource(hit?.id ?? null);
  };

  if (isLive) return null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ pointerEvents: "auto" }}
      onClick={handleContainerClick}
    >
      {scene.sources
        .filter((s) => s.visible)
        .map((source) => {
          const isSelected = source.id === selectedSourceId;
          return (
            <div
              key={source.id}
              className="absolute"
              style={{
                left: `${source.x}%`,
                top: `${source.y}%`,
                width: `${source.width}%`,
                height: `${source.height}%`,
                outline: isSelected
                  ? "2px solid #D4007A"
                  : "1px dashed rgba(255,255,255,0.25)",
                cursor: "move",
                pointerEvents: "auto",
                boxSizing: "border-box",
              }}
              onMouseDown={(e) => handleMouseDown(e, source)}
              title={source.label}
            >
              {isSelected && (
                <div
                  className="absolute -top-5 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-white font-mono"
                  style={{
                    fontSize: "10px",
                    background: "rgba(212,0,122,0.9)",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {source.label}
                </div>
              )}
              {/* Corner handle for visual cue */}
              {isSelected && (
                <div
                  className="absolute bottom-0 right-0 w-3 h-3"
                  style={{
                    background: "#D4007A",
                    cursor: "se-resize",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SceneManager({
  videoDevices,
  onCanvasStream,
  micStream: _micStream,
  isLive,
  compact = false,
  sharedCameraStream = null,
}: SceneManagerProps) {
  const initialDeviceId = videoDevices[0]?.deviceId ?? "";

  // Scenes state
  const [scenes, setScenes] = useState<Scene[]>(() =>
    makeDefaultScenes(initialDeviceId)
  );
  const [activeSceneId, setActiveSceneId] = useState<string>(
    () => scenes[0].id
  );
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // Transition state
  const [transition, setTransition] = useState<TransitionType>("fade");
  const [transitionDuration, setTransitionDuration] = useState(0.5);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const cancelTransitionRef = useRef<(() => void) | null>(null);

  // UI state
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [renamingSceneId, setRenamingSceneId] = useState<string | null>(null);

  // Gap 5: Scene preset bar state
  const [scenePresets, setScenePresets] = useState<StreamPreset[]>([]);
  const [presetSaveName, setPresetSaveName] = useState("");
  const [presetSaveMode, setPresetSaveMode] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);

  // Track whether initial hydration is complete (prevents auto-save on first render)
  const sceneHydratedRef = useRef(false);

  // Load presets on mount; restore __auto__ preset if one exists
  useEffect(() => {
    getScenePresets()
      .then((res) => {
        if (res.success) {
          setScenePresets(res.presets);
          const auto = res.presets.find((p) => p.name === "__auto__");
          if (auto) {
            const cfg = auto.config;
            const loadedScenes = (cfg as { scenes?: Scene[] }).scenes;
            const loadedActiveId = (cfg as { activeSceneId?: string }).activeSceneId;
            if (Array.isArray(loadedScenes) && loadedScenes.length > 0) {
              setScenes(loadedScenes);
              setActiveSceneId(loadedActiveId || loadedScenes[0].id);
              setSelectedSourceId(null);
            }
          }
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => {
        sceneHydratedRef.current = true;
      });
  }, []);

  // Auto-save scenes to __auto__ preset (debounced 500ms) whenever scenes change
  const sceneAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!sceneHydratedRef.current) return;
    if (sceneAutoSaveTimerRef.current) clearTimeout(sceneAutoSaveTimerRef.current);
    sceneAutoSaveTimerRef.current = setTimeout(() => {
      saveScenePreset({ name: "__auto__", config: { scenes, activeSceneId }, isDefault: false }).catch(() => {});
    }, 500);
    return () => { if (sceneAutoSaveTimerRef.current) clearTimeout(sceneAutoSaveTimerRef.current); };
  }, [scenes, activeSceneId]);

  // Load a preset config into scene state
  const loadScenePreset = useCallback((preset: StreamPreset) => {
    const cfg = preset.config;
    if (!cfg || typeof cfg !== "object") return;
    // Config shape: { scenes: Scene[], activeSceneId: string }
    const loadedScenes = cfg.scenes as Scene[] | undefined;
    const loadedActiveId = cfg.activeSceneId as string | undefined;
    if (!Array.isArray(loadedScenes) || loadedScenes.length === 0) return;
    setScenes(loadedScenes);
    setActiveSceneId(loadedActiveId || loadedScenes[0].id);
    setSelectedSourceId(null);
  }, []);

  // Save current state as a named preset
  const handleSaveScenePreset = useCallback(async () => {
    const name = presetSaveName.trim();
    if (!name) return;
    setPresetSaving(true);
    try {
      const config = { scenes, activeSceneId };
      const res = await saveScenePreset({ name, config });
      if (res.success) {
        setScenePresets((prev) => {
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
  }, [presetSaveName, scenes, activeSceneId]);

  // Derived
  const activeScene = useMemo(
    () => scenes.find((s) => s.id === activeSceneId) ?? scenes[0],
    [scenes, activeSceneId]
  );
  const selectedSource = useMemo(
    () => activeScene.sources.find((s) => s.id === selectedSourceId) ?? null,
    [activeScene.sources, selectedSourceId]
  );

  // Compositor
  const {
    canvasRef,
    offscreenARef,
    offscreenBRef,
    acquireSceneMedia,
    releaseSourceMedia,
    renderSceneToCanvas,
    stopRenderLoop,
    startRenderLoop,
    acquireSourceMedia,
  } = useCompositor(activeScene, onCanvasStream, sharedCameraStream);

  // ── Scene switching with transition ─────────────────────────────────────
  const switchToScene = useCallback(
    async (targetSceneId: string) => {
      if (targetSceneId === activeSceneId || isTransitioning) return;

      const targetScene = scenes.find((s) => s.id === targetSceneId);
      if (!targetScene) return;

      if (transition === "cut") {
        setActiveSceneId(targetSceneId);
        setSelectedSourceId(null);
        await acquireSceneMedia(targetScene);
        return;
      }

      // Snapshot "from" scene onto offscreenA
      const offA = offscreenARef.current;
      const offB = offscreenBRef.current;
      const canvas = canvasRef.current;
      if (!offA || !offB || !canvas) {
        setActiveSceneId(targetSceneId);
        setSelectedSourceId(null);
        return;
      }

      const ctxA = offA.getContext("2d");
      const ctxB = offB.getContext("2d");
      if (!ctxA || !ctxB) {
        setActiveSceneId(targetSceneId);
        setSelectedSourceId(null);
        return;
      }

      // Render current (from) into offA
      renderSceneToCanvas(ctxA, activeScene);

      // Acquire target media, then render into offB
      await acquireSceneMedia(targetScene);
      renderSceneToCanvas(ctxB, targetScene);

      // Pause the rAF loop during transition so we own the canvas
      stopRenderLoop();
      setIsTransitioning(true);

      const cancel = runTransition(canvas, offA, offB, { type: transition, duration: transitionDuration }, () => {
        setIsTransitioning(false);
        setActiveSceneId(targetSceneId);
        setSelectedSourceId(null);
        startRenderLoop();
      });

      cancelTransitionRef.current = cancel;
    },
    [
      activeSceneId,
      activeScene,
      isTransitioning,
      scenes,
      transition,
      transitionDuration,
      offscreenARef,
      offscreenBRef,
      canvasRef,
      acquireSceneMedia,
      renderSceneToCanvas,
      stopRenderLoop,
      startRenderLoop,
    ]
  );

  // Cancel any in-flight transition on unmount
  useEffect(() => {
    return () => {
      cancelTransitionRef.current?.();
    };
  }, []);

  // ── Scene mutations ──────────────────────────────────────────────────────
  const addScene = useCallback(() => {
    const newScene: Scene = {
      id: genId(),
      name: `Scene ${scenes.length + 1}`,
      sources: [],
    };
    setScenes((prev) => [...prev, newScene]);
    setRenamingSceneId(newScene.id);
  }, [scenes.length]);

  const deleteScene = useCallback(
    (sceneId: string) => {
      if (scenes.length <= 1) return;
      setScenes((prev) => {
        const filtered = prev.filter((s) => s.id !== sceneId);
        if (activeSceneId === sceneId) {
          setActiveSceneId(filtered[0].id);
          setSelectedSourceId(null);
        }
        return filtered;
      });
    },
    [scenes.length, activeSceneId]
  );

  const renameScene = useCallback((sceneId: string, name: string) => {
    setScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, name } : s))
    );
    setRenamingSceneId(null);
  }, []);

  // ── Source mutations ─────────────────────────────────────────────────────
  const updateActiveScene = useCallback(
    (updater: (scene: Scene) => Scene) => {
      setScenes((prev) =>
        prev.map((s) => (s.id === activeSceneId ? updater(s) : s))
      );
    },
    [activeSceneId]
  );

  const addSource = useCallback(
    async (type: Source["type"]) => {
      const maxZ = activeScene.sources.reduce(
        (max, s) => Math.max(max, s.zIndex),
        -1
      );

      let defaults: Partial<Source> = {};
      if (type === "camera") {
        defaults = { deviceId: initialDeviceId, width: 50, height: 50, x: 25, y: 25 };
      } else if (type === "screen") {
        defaults = { width: 100, height: 100, x: 0, y: 0 };
      } else if (type === "image") {
        defaults = { imageUrl: "", width: 50, height: 50, x: 25, y: 25 };
      } else if (type === "text") {
        defaults = {
          text: "Text",
          fontSize: 24,
          fontColor: "#FFFFFF",
          width: 60,
          height: 15,
          x: 20,
          y: 42,
        };
      } else if (type === "color") {
        defaults = { bgColor: "#000000", width: 100, height: 100, x: 0, y: 0 };
      }

      const newSource: Source = {
        id: genId(),
        type,
        label: SOURCE_TYPE_LABELS[type],
        x: defaults.x ?? 0,
        y: defaults.y ?? 0,
        width: defaults.width ?? 100,
        height: defaults.height ?? 100,
        zIndex: maxZ + 1,
        visible: true,
        opacity: 1,
        ...defaults,
      };

      updateActiveScene((scene) => ({
        ...scene,
        sources: [...scene.sources, newSource],
      }));

      setSelectedSourceId(newSource.id);

      // Acquire media immediately for live source types
      if (type === "camera" || type === "screen") {
        await acquireSourceMedia(newSource);
      }
    },
    [activeScene.sources, initialDeviceId, updateActiveScene, acquireSourceMedia]
  );

  const deleteSource = useCallback(
    (sourceId: string) => {
      releaseSourceMedia(sourceId);
      updateActiveScene((scene) => ({
        ...scene,
        sources: scene.sources.filter((s) => s.id !== sourceId),
      }));
      if (selectedSourceId === sourceId) {
        setSelectedSourceId(null);
      }
    },
    [releaseSourceMedia, updateActiveScene, selectedSourceId]
  );

  const toggleSourceVisibility = useCallback(
    (sourceId: string) => {
      updateActiveScene((scene) => ({
        ...scene,
        sources: scene.sources.map((s) =>
          s.id === sourceId ? { ...s, visible: !s.visible } : s
        ),
      }));
    },
    [updateActiveScene]
  );

  const updateSourceProps = useCallback(
    (sourceId: string, props: Partial<Source>) => {
      updateActiveScene((scene) => ({
        ...scene,
        sources: scene.sources.map((s) =>
          s.id === sourceId ? { ...s, ...props } : s
        ),
      }));
    },
    [updateActiveScene]
  );

  const moveSourceZIndex = useCallback(
    (sourceId: string, direction: "up" | "down") => {
      updateActiveScene((scene) => {
        const sorted = [...scene.sources].sort((a, b) => a.zIndex - b.zIndex);
        const idx = sorted.findIndex((s) => s.id === sourceId);
        if (idx === -1) return scene;

        const swapIdx = direction === "up" ? idx + 1 : idx - 1;
        if (swapIdx < 0 || swapIdx >= sorted.length) return scene;

        // Swap zIndex values
        const newSources = sorted.map((s) => ({ ...s }));
        const tmp = newSources[idx].zIndex;
        newSources[idx].zIndex = newSources[swapIdx].zIndex;
        newSources[swapIdx].zIndex = tmp;
        return { ...scene, sources: newSources };
      });
    },
    [updateActiveScene]
  );

  const handleMoveSourceOnPreview = useCallback(
    (sourceId: string, x: number, y: number) => {
      updateActiveScene((scene) => ({
        ...scene,
        sources: scene.sources.map((s) =>
          s.id === sourceId
            ? { ...s, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
            : s
        ),
      }));
    },
    [updateActiveScene]
  );

  // Sorted sources for layer list (highest zIndex = top of stack = first in list)
  const sortedSources = useMemo(
    () => [...activeScene.sources].sort((a, b) => b.zIndex - a.zIndex),
    [activeScene.sources]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col gap-3 ${compact ? "text-xs" : ""}`}>
      {/* ── Canvas Preview ─────────────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden rounded-2xl bg-pnp-surface border border-pnp-border"
        style={{ aspectRatio: "16/9" }}
      >
        {/* Canvas is the compositor output — pointer-events disabled via globals.css,
            so we use a sibling overlay div for interaction */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-contain"
          aria-label="Scene preview"
        />

        {/* Interaction overlay (source bounding boxes + drag) */}
        <PreviewOverlay
          scene={activeScene}
          selectedSourceId={selectedSourceId}
          onSelectSource={setSelectedSourceId}
          onMoveSource={handleMoveSourceOnPreview}
          isLive={isLive}
        />

        {/* Edit mode indicator */}
        {!isLive && (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-lg text-white"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)",
            }}
          >
            <IconEdit className="w-2.5 h-2.5" />
            EDIT
          </div>
        )}

        {/* Transition veil */}
        {isTransitioning && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true" />
        )}
      </div>

      {/* ── Scene Switcher ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {/* Transition controls row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-pnp-textSecondary shrink-0">Transition:</span>

          <div className="relative shrink-0">
            <select
              value={transition}
              onChange={(e) => setTransition(e.target.value as TransitionType)}
              disabled={isLive}
              className="appearance-none rounded-lg px-2.5 py-1 pr-7 text-xs bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors disabled:opacity-50"
              aria-label="Transition type"
            >
              <option value="cut">Cut (instant)</option>
              <option value="fade">Fade</option>
              <option value="slide-left">Slide Left</option>
              <option value="slide-right">Slide Right</option>
            </select>
            <IconChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-pnp-textSecondary" />
          </div>

          {transition !== "cut" && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-pnp-textSecondary">Duration:</span>
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.1}
                value={transitionDuration}
                disabled={isLive}
                onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
                className="w-20 accent-pnp-accent disabled:opacity-50"
                aria-label="Transition duration"
              />
              <span className="text-xs text-pnp-textSecondary w-8 tabular-nums">
                {transitionDuration.toFixed(1)}s
              </span>
            </div>
          )}
        </div>

        {/* Scene pills */}
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Scenes"
          style={{ scrollbarWidth: "none" }}
        >
          {scenes.map((scene) => {
            const isActive = scene.id === activeSceneId;
            return (
              <div key={scene.id} className="flex items-center gap-0.5 shrink-0">
                {renamingSceneId === scene.id ? (
                  <SceneRenameInput
                    initialName={scene.name}
                    onConfirm={(name) => renameScene(scene.id, name)}
                    onCancel={() => setRenamingSceneId(null)}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      if (!isActive && !isTransitioning) {
                        switchToScene(scene.id);
                      }
                    }}
                    disabled={isTransitioning}
                    className={`
                      relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                      transition-all duration-150 focus:outline-none
                      ${isActive
                        ? "text-white"
                        : "text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:text-pnp-textPrimary hover:bg-pnp-surfaceHover"
                      }
                      disabled:opacity-60 disabled:cursor-not-allowed
                    `}
                    style={
                      isActive
                        ? {
                            background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))",
                            border: "1px solid transparent",
                            backgroundClip: "padding-box",
                            boxShadow: "0 0 0 1px rgba(212,0,122,0.6)",
                          }
                        : undefined
                    }
                  >
                    {isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                        aria-hidden="true"
                      />
                    )}
                    {scene.name}
                  </button>
                )}

                {/* Per-scene actions */}
                {!isLive && (
                  <>
                    <button
                      type="button"
                      onClick={() => setRenamingSceneId(scene.id)}
                      className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors rounded"
                      title="Rename scene"
                      aria-label={`Rename ${scene.name}`}
                    >
                      <IconEdit className="w-3 h-3" />
                    </button>
                    {scenes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => deleteScene(scene.id)}
                        className="p-1 text-pnp-textSecondary hover:text-pnp-error transition-colors rounded"
                        title="Delete scene"
                        aria-label={`Delete ${scene.name}`}
                      >
                        <IconTrash className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Add scene */}
          {!isLive && (
            <button
              type="button"
              onClick={addScene}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:text-pnp-textPrimary hover:bg-pnp-surfaceHover transition-all shrink-0"
              aria-label="Add new scene"
            >
              <IconPlus className="w-3 h-3" />
              New Scene
            </button>
          )}
        </div>
      </div>

      {/* ── Gap 5: Scene Preset Bar ────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Preset dropdown */}
        {scenePresets.length > 0 && (
          <div className="relative flex-1 min-w-0">
            <select
              className="w-full appearance-none rounded-lg px-2.5 py-1.5 pr-7 text-xs bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent transition-colors"
              defaultValue=""
              onChange={(e) => {
                const preset = scenePresets.find((p) => p.id === e.target.value);
                if (preset) loadScenePreset(preset);
                e.target.value = "";
              }}
              aria-label="Load scene preset"
            >
              <option value="" disabled>Load preset…</option>
              {scenePresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <IconChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-pnp-textSecondary" />
          </div>
        )}

        {/* Save preset */}
        {!isLive && (
          presetSaveMode ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={presetSaveName}
                onChange={(e) => setPresetSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveScenePreset();
                  if (e.key === "Escape") { setPresetSaveMode(false); setPresetSaveName(""); }
                }}
                placeholder="Preset name…"
                maxLength={60}
                autoFocus
                className="rounded-lg px-2 py-1.5 text-xs bg-pnp-background border border-pnp-accent text-pnp-textPrimary focus:outline-none w-28"
                style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={handleSaveScenePreset}
                disabled={presetSaving || !presetSaveName.trim()}
                className="p-1 text-pnp-accent disabled:opacity-40 transition-opacity"
                aria-label="Confirm save"
              >
                <IconCheck className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { setPresetSaveMode(false); setPresetSaveName(""); }}
                className="p-1 text-pnp-textSecondary hover:opacity-80 transition-opacity"
                aria-label="Cancel"
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPresetSaveMode(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-pnp-textSecondary bg-pnp-surface border border-pnp-border hover:text-pnp-textPrimary hover:bg-pnp-surfaceHover transition-all shrink-0"
              title="Save current scene layout as preset"
            >
              <IconCheck className="w-3 h-3" />
              Save as…
            </button>
          )
        )}
      </div>

      {/* ── Source Layer Panel ─────────────────────────────────────── */}
      <div className="rounded-2xl bg-pnp-surface border border-pnp-border overflow-hidden">
        {/* Panel header */}
        <button
          type="button"
          onClick={() => setSourcePanelOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-pnp-surfaceHover transition-colors"
          aria-expanded={sourcePanelOpen}
        >
          <div className="flex items-center gap-2">
            <IconLayers className="w-3.5 h-3.5 text-pnp-textSecondary" />
            <span className="text-xs font-semibold text-pnp-textPrimary">
              Sources
            </span>
            <span className="px-1.5 py-0.5 rounded-md text-xs font-mono text-pnp-textSecondary"
              style={{ background: "rgba(255,255,255,0.06)" }}>
              {activeScene.sources.length}
            </span>
          </div>
          {sourcePanelOpen ? (
            <IconChevronUp className="w-4 h-4 text-pnp-textSecondary" />
          ) : (
            <IconChevronDown className="w-4 h-4 text-pnp-textSecondary" />
          )}
        </button>

        {sourcePanelOpen && (
          <div className="border-t border-pnp-border">
            {/* Source list */}
            {sortedSources.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <IconLayers className="w-6 h-6 text-pnp-textSecondary mx-auto mb-2 opacity-40" />
                <p className="text-xs text-pnp-textSecondary">No sources yet. Add one below.</p>
              </div>
            ) : (
              <ul role="list" className="divide-y divide-pnp-border">
                {sortedSources.map((source, idx) => {
                  const SourceIcon = SOURCE_ICON_MAP[source.type];
                  const isSelected = source.id === selectedSourceId;
                  return (
                    <li key={source.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSourceId((prev) =>
                            prev === source.id ? null : source.id
                          )
                        }
                        className={`
                          flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors
                          ${isSelected
                            ? "bg-pnp-surfaceHover"
                            : "hover:bg-pnp-surfaceHover"
                          }
                          ${!source.visible ? "opacity-40" : ""}
                        `}
                        aria-selected={isSelected}
                      >
                        {/* Source type icon */}
                        <SourceIcon className="w-3.5 h-3.5 text-pnp-textSecondary shrink-0" />

                        {/* Label */}
                        <span className="text-xs text-pnp-textPrimary flex-1 truncate min-w-0">
                          {source.label}
                        </span>

                        {/* Action buttons — shown on hover / selection via parent hover */}
                        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {/* Move up (higher zIndex) */}
                          {idx > 0 && !isLive && (
                            <button
                              type="button"
                              onClick={() => moveSourceZIndex(source.id, "up")}
                              className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors rounded"
                              title="Move up (higher layer)"
                              aria-label="Move source up"
                            >
                              <IconArrowUp className="w-3 h-3" />
                            </button>
                          )}
                          {/* Move down (lower zIndex) */}
                          {idx < sortedSources.length - 1 && !isLive && (
                            <button
                              type="button"
                              onClick={() => moveSourceZIndex(source.id, "down")}
                              className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors rounded"
                              title="Move down (lower layer)"
                              aria-label="Move source down"
                            >
                              <IconArrowDown className="w-3 h-3" />
                            </button>
                          )}

                          {/* Toggle visibility */}
                          <button
                            type="button"
                            onClick={() => toggleSourceVisibility(source.id)}
                            className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors rounded"
                            title={source.visible ? "Hide source" : "Show source"}
                            aria-label={source.visible ? "Hide source" : "Show source"}
                            disabled={isLive}
                          >
                            {source.visible ? (
                              <IconEye className="w-3.5 h-3.5" />
                            ) : (
                              <IconEyeOff className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Delete */}
                          {!isLive && (
                            <button
                              type="button"
                              onClick={() => deleteSource(source.id)}
                              className="p-1 text-pnp-textSecondary hover:text-pnp-error transition-colors rounded"
                              title="Remove source"
                              aria-label="Remove source"
                            >
                              <IconTrash className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Selection indicator */}
                        {isSelected && (
                          <div
                            className="absolute left-0 inset-y-0 w-0.5"
                            style={{ background: "linear-gradient(to bottom, #D4007A, #E69138)" }}
                            aria-hidden="true"
                          />
                        )}
                      </button>

                      {/* Inline properties when selected */}
                      {isSelected && !isLive && (
                        <div className="px-3 pb-3">
                          <SourcePropertiesPanel
                            source={source}
                            videoDevices={videoDevices}
                            onChange={(props) => updateSourceProps(source.id, props)}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Add source footer */}
            {!isLive && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-pnp-border">
                <span className="text-xs text-pnp-textSecondary">
                  {activeScene.sources.length === 0
                    ? "Add your first source"
                    : "Add another source"}
                </span>
                <AddSourceDropdown onAdd={addSource} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
