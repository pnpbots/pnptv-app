import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";

// ─── Inline SVG icons (no external dependency) ───────────────────────────────

const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...p}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronUp = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...p}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const RotateCcw = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...p}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 .49-5.1L1 10" />
  </svg>
);

const Sparkles = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...p}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

const AlertTriangle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...p}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoFiltersProps {
  inputStream: MediaStream | null;
  onFilteredOutput?: (stream: MediaStream) => void;
  isLive: boolean;
  width: number;
  height: number;
  fps: number;
  compact?: boolean;
}

interface AdjustmentValues {
  brightness: number;  // -100 to 100
  contrast: number;    // -100 to 100
  saturation: number;  // -100 to 100
  warmth: number;      // -50 to 50
  sharpness: number;   // 0 to 100
}

type PresetName =
  | "None"
  | "Vivid"
  | "Warm"
  | "Cool"
  | "B&W"
  | "Cinematic"
  | "Night"
  | "Glow";

interface Preset {
  name: PresetName;
  values: AdjustmentValues;
  /** HSL representation for the swatch circle */
  swatchHsl: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ADJUSTMENTS: AdjustmentValues = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  sharpness: 0,
};

const PRESETS: Preset[] = [
  {
    name: "None",
    values: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0 },
    swatchHsl: "hsl(0,0%,50%)",
  },
  {
    name: "Vivid",
    values: { brightness: 0, contrast: 10, saturation: 20, warmth: 0, sharpness: 0 },
    swatchHsl: "hsl(280,80%,55%)",
  },
  {
    name: "Warm",
    values: { brightness: 0, contrast: 0, saturation: 5, warmth: 30, sharpness: 0 },
    swatchHsl: "hsl(35,90%,55%)",
  },
  {
    name: "Cool",
    values: { brightness: 0, contrast: 10, saturation: 0, warmth: -20, sharpness: 0 },
    swatchHsl: "hsl(210,70%,60%)",
  },
  {
    name: "B&W",
    values: { brightness: 0, contrast: 0, saturation: -100, warmth: 0, sharpness: 0 },
    swatchHsl: "hsl(0,0%,70%)",
  },
  {
    name: "Cinematic",
    values: { brightness: -10, contrast: 25, saturation: -20, warmth: 10, sharpness: 0 },
    swatchHsl: "hsl(25,60%,30%)",
  },
  {
    name: "Night",
    values: { brightness: 30, contrast: 0, saturation: -20, warmth: -10, sharpness: 0 },
    swatchHsl: "hsl(230,40%,30%)",
  },
  {
    name: "Glow",
    values: { brightness: 15, contrast: -10, saturation: 0, warmth: 10, sharpness: 0 },
    swatchHsl: "hsl(40,100%,75%)",
  },
];

// ─── GLSL Shaders ─────────────────────────────────────────────────────────────

const VERTEX_SHADER_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0, 1);
  v_texCoord = a_texCoord;
}
`.trim();

const FRAGMENT_SHADER_SRC = `
precision mediump float;
uniform sampler2D u_image;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_warmth;
uniform float u_sharpness;
uniform vec2 u_resolution;
varying vec2 v_texCoord;

void main() {
  vec4 color = texture2D(u_image, v_texCoord);

  // Brightness
  color.rgb += u_brightness;

  // Contrast
  color.rgb = (color.rgb - 0.5) * (1.0 + u_contrast) + 0.5;

  // Saturation
  float gray = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  color.rgb = mix(vec3(gray), color.rgb, 1.0 + u_saturation);

  // Warmth
  color.r += u_warmth * 0.1;
  color.b -= u_warmth * 0.1;

  // Sharpness (unsharp mask)
  if (u_sharpness > 0.0) {
    vec2 px = 1.0 / u_resolution;
    vec4 blur = (
      texture2D(u_image, v_texCoord + vec2(-px.x, 0.0)) +
      texture2D(u_image, v_texCoord + vec2( px.x, 0.0)) +
      texture2D(u_image, v_texCoord + vec2(0.0, -px.y)) +
      texture2D(u_image, v_texCoord + vec2(0.0,  px.y))
    ) / 4.0;
    color.rgb += (color.rgb - blur.rgb) * u_sharpness;
  }

  color.rgb = clamp(color.rgb, 0.0, 1.0);
  gl_FragColor = color;
}
`.trim();

// ─── WebGL helpers ────────────────────────────────────────────────────────────

interface GlResources {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  positionBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
  uniforms: {
    image: WebGLUniformLocation;
    brightness: WebGLUniformLocation;
    contrast: WebGLUniformLocation;
    saturation: WebGLUniformLocation;
    warmth: WebGLUniformLocation;
    sharpness: WebGLUniformLocation;
    resolution: WebGLUniformLocation;
  };
  attributes: {
    position: number;
    texCoord: number;
  };
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create WebGL shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create WebGL program");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

function requireUniform(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name);
  if (!loc) throw new Error(`Uniform not found: ${name}`);
  return loc;
}

function initWebGL(canvas: HTMLCanvasElement): GlResources {
  const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
  if (!gl) throw new Error("WebGL not available");
  const glCtx = gl as WebGLRenderingContext;

  const program = createProgram(glCtx, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);
  glCtx.useProgram(program);

  // Full-screen quad: two triangles covering clip space
  const positions = new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]);
  const texCoords = new Float32Array([
    0, 1,  1, 1,  0, 0,
    0, 0,  1, 1,  1, 0,
  ]);

  const positionBuffer = glCtx.createBuffer();
  if (!positionBuffer) throw new Error("Failed to create position buffer");
  glCtx.bindBuffer(glCtx.ARRAY_BUFFER, positionBuffer);
  glCtx.bufferData(glCtx.ARRAY_BUFFER, positions, glCtx.STATIC_DRAW);

  const texCoordBuffer = glCtx.createBuffer();
  if (!texCoordBuffer) throw new Error("Failed to create texCoord buffer");
  glCtx.bindBuffer(glCtx.ARRAY_BUFFER, texCoordBuffer);
  glCtx.bufferData(glCtx.ARRAY_BUFFER, texCoords, glCtx.STATIC_DRAW);

  const texture = glCtx.createTexture();
  if (!texture) throw new Error("Failed to create WebGL texture");
  glCtx.bindTexture(glCtx.TEXTURE_2D, texture);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.LINEAR);

  return {
    gl: glCtx,
    program,
    texture,
    positionBuffer,
    texCoordBuffer,
    uniforms: {
      image: requireUniform(glCtx, program, "u_image"),
      brightness: requireUniform(glCtx, program, "u_brightness"),
      contrast: requireUniform(glCtx, program, "u_contrast"),
      saturation: requireUniform(glCtx, program, "u_saturation"),
      warmth: requireUniform(glCtx, program, "u_warmth"),
      sharpness: requireUniform(glCtx, program, "u_sharpness"),
      resolution: requireUniform(glCtx, program, "u_resolution"),
    },
    attributes: {
      position: glCtx.getAttribLocation(program, "a_position"),
      texCoord: glCtx.getAttribLocation(program, "a_texCoord"),
    },
  };
}

function renderFrame(
  res: GlResources,
  videoEl: HTMLVideoElement,
  adj: AdjustmentValues,
  width: number,
  height: number
): void {
  const { gl, program, texture, positionBuffer, texCoordBuffer, uniforms, attributes } = res;

  gl.viewport(0, 0, width, height);
  gl.useProgram(program);

  // Upload video frame as texture
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);

  // Bind geometry
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(attributes.position);
  gl.vertexAttribPointer(attributes.position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.enableVertexAttribArray(attributes.texCoord);
  gl.vertexAttribPointer(attributes.texCoord, 2, gl.FLOAT, false, 0, 0);

  // Set uniforms — values normalised to [-1, 1] or [0, 1] range
  gl.uniform1i(uniforms.image, 0);
  gl.uniform1f(uniforms.brightness, adj.brightness / 100);
  gl.uniform1f(uniforms.contrast, adj.contrast / 100);
  gl.uniform1f(uniforms.saturation, adj.saturation / 100);
  gl.uniform1f(uniforms.warmth, adj.warmth / 50);    // -50..50 -> -1..1
  gl.uniform1f(uniforms.sharpness, adj.sharpness / 100);
  gl.uniform2f(uniforms.resolution, width, height);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function destroyGlResources(res: GlResources): void {
  const { gl, program, texture, positionBuffer, texCoordBuffer } = res;
  gl.deleteTexture(texture);
  gl.deleteBuffer(positionBuffer);
  gl.deleteBuffer(texCoordBuffer);
  gl.deleteProgram(program);
  const ext = gl.getExtension("WEBGL_lose_context");
  if (ext) ext.loseContext();
}

function adjustmentsAreDefault(adj: AdjustmentValues): boolean {
  return (
    adj.brightness === 0 &&
    adj.contrast === 0 &&
    adj.saturation === 0 &&
    adj.warmth === 0 &&
    adj.sharpness === 0
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  isDefault: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  isDefault,
  onChange,
  onReset,
}: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-pnp-textSecondary">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-pnp-textPrimary w-8 text-right tabular-nums">
            {value > 0 ? `+${value}` : value}
          </span>
          <button
            onClick={onReset}
            disabled={isDefault}
            className="
              p-0.5 rounded text-pnp-textSecondary
              hover:text-pnp-textPrimary
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors duration-100
            "
            aria-label={`Reset ${label}`}
            title={`Reset ${label}`}
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-pnp-border" />
        <div
          className="absolute left-0 h-1 rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #D4007A, #E69138)",
          }}
          aria-hidden="true"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
        />
        {/* Thumb */}
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-pnp-accent bg-pnp-surface shadow pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

interface ToggleSwitchProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleSwitch({ id, label, checked, onChange }: ToggleSwitchProps) {
  return (
    <label
      htmlFor={id}
      className="flex items-center justify-between cursor-pointer"
    >
      <span className="text-sm font-medium text-pnp-textPrimary">{label}</span>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent
          transition-colors duration-200 ease-in-out
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pnp-surface
          ${checked ? "bg-pnp-accent" : "bg-pnp-border"}
        `}
      >
        <span
          aria-hidden="true"
          className={`
            inline-block h-5 w-5 transform rounded-full bg-white shadow
            transition-transform duration-200 ease-in-out
            ${checked ? "translate-x-5" : "translate-x-0"}
          `}
        />
      </button>
    </label>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VideoFilters({
  inputStream,
  onFilteredOutput,
  isLive,
  width,
  height,
  fps,
  compact = false,
}: VideoFiltersProps) {
  // UI state
  const [isOpen, setIsOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<PresetName>("None");
  const [adj, setAdj] = useState<AdjustmentValues>({ ...DEFAULT_ADJUSTMENTS });
  const [beautyMode, setBeautyMode] = useState(false);
  const [webGlAvailable, setWebGlAvailable] = useState(true);
  const [webGlError, setWebGlError] = useState<string | null>(null);

  // Refs
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glResourcesRef = useRef<GlResources | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const rafHandleRef = useRef<number>(0);
  const outputStreamRef = useRef<MediaStream | null>(null);
  const onFilteredOutputRef = useRef(onFilteredOutput);

  // Keep callback ref current without re-triggering effects
  useEffect(() => {
    onFilteredOutputRef.current = onFilteredOutput;
  }, [onFilteredOutput]);

  // Effective adjustments — apply beauty mode boost on top
  const effectiveAdj = useMemo<AdjustmentValues>(() => {
    if (!beautyMode) return adj;
    return { ...adj, brightness: Math.min(100, adj.brightness + 10) };
  }, [adj, beautyMode]);

  // ── Detect WebGL support once ───────────────────────────────────────────
  useEffect(() => {
    try {
      const testCanvas = document.createElement("canvas");
      const ctx =
        testCanvas.getContext("webgl") ??
        testCanvas.getContext("experimental-webgl");
      if (!ctx) {
        setWebGlAvailable(false);
      }
    } catch {
      setWebGlAvailable(false);
    }
  }, []);

  // Ref to effectiveAdj for the rAF loop closure — avoids stale values without
  // rebuilding the loop every frame. Declared before the setup effect so it is
  // always in scope for the onVideoReady closure.
  const effectiveAdjRef = useRef(effectiveAdj);
  useEffect(() => {
    effectiveAdjRef.current = effectiveAdj;
  }, [effectiveAdj]);

  // ── Setup / teardown WebGL pipeline when stream or dimensions change ────
  useEffect(() => {
    if (!webGlAvailable || !inputStream) {
      // No WebGL or no stream — pass through raw stream
      if (inputStream && onFilteredOutputRef.current) {
        onFilteredOutputRef.current(inputStream);
      }
      return;
    }

    // Create offscreen canvas
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    offscreenCanvasRef.current = canvas;

    // Create hidden video element to draw frames from
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = inputStream;
    hiddenVideoRef.current = video;

    let resources: GlResources | null = null;
    let cancelled = false;

    const onVideoReady = () => {
      if (cancelled) return;

      try {
        resources = initWebGL(canvas);
        glResourcesRef.current = resources;
        setWebGlError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "WebGL init failed";
        setWebGlError(msg);
        setWebGlAvailable(false);
        // Fall back to raw stream
        if (onFilteredOutputRef.current) {
          onFilteredOutputRef.current(inputStream);
        }
        return;
      }

      // Capture the output stream from the canvas
      const capturedStream = canvas.captureStream(fps);

      // Preserve audio tracks from the original stream
      inputStream.getAudioTracks().forEach((track) => {
        capturedStream.addTrack(track);
      });

      outputStreamRef.current = capturedStream;
      if (onFilteredOutputRef.current) {
        onFilteredOutputRef.current(capturedStream);
      }

      // Start render loop
      const targetInterval = 1000 / fps;
      let lastFrame = 0;

      const loop = (ts: number) => {
        if (cancelled) return;
        rafHandleRef.current = requestAnimationFrame(loop);

        if (ts - lastFrame < targetInterval - 1) return;
        lastFrame = ts;

        if (video.readyState < 2) return;

        if (!glResourcesRef.current) return;

        renderFrame(glResourcesRef.current, video, effectiveAdjRef.current, width, height);
      };

      rafHandleRef.current = requestAnimationFrame(loop);
    };

    video.addEventListener("canplay", onVideoReady, { once: true });
    video.play().catch(() => {
      // Autoplay might be blocked; canplay will still fire
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafHandleRef.current);

      video.removeEventListener("canplay", onVideoReady);
      video.pause();
      video.srcObject = null;
      hiddenVideoRef.current = null;

      if (resources) {
        destroyGlResources(resources);
        glResourcesRef.current = null;
      }

      offscreenCanvasRef.current = null;
      outputStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputStream, webGlAvailable, width, height, fps]);

  // ── Preset application ─────────────────────────────────────────────────
  const applyPreset = useCallback((preset: Preset) => {
    setActivePreset(preset.name);
    setAdj({ ...preset.values });
  }, []);

  // ── Adjustment helpers ─────────────────────────────────────────────────
  const setField = useCallback(
    (field: keyof AdjustmentValues) => (value: number) => {
      setAdj((prev) => ({ ...prev, [field]: value }));
      setActivePreset("None"); // deselect preset when manually adjusting
    },
    []
  );

  const resetField = useCallback(
    (field: keyof AdjustmentValues) => () => {
      setAdj((prev) => ({ ...prev, [field]: DEFAULT_ADJUSTMENTS[field] }));
      setActivePreset("None");
    },
    []
  );

  const resetAll = useCallback(() => {
    setAdj({ ...DEFAULT_ADJUSTMENTS });
    setActivePreset("None");
    setBeautyMode(false);
  }, []);

  const hasAnyChange =
    !adjustmentsAreDefault(adj) || beautyMode;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      className={`
        rounded-2xl border border-pnp-border bg-pnp-surface
        overflow-hidden
        ${compact ? "text-xs" : ""}
      `}
    >
      {/* Header / toggle */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="
          w-full flex items-center justify-between
          px-4 py-3
          text-left
          hover:bg-pnp-surfaceHover
          transition-colors duration-150
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-inset
        "
        aria-expanded={isOpen}
        aria-controls="video-filters-panel"
      >
        <div className="flex items-center gap-2">
          <Sparkles
            className="w-4 h-4 text-pnp-accent"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-pnp-textPrimary">
            Filters &amp; Effects
          </span>
          {hasAnyChange && (
            <span
              className="inline-flex w-2 h-2 rounded-full bg-pnp-accent"
              aria-label="Filters active"
            />
          )}
        </div>
        {isOpen ? (
          <ChevronUp
            className="w-4 h-4 text-pnp-textSecondary"
            aria-hidden="true"
          />
        ) : (
          <ChevronDown
            className="w-4 h-4 text-pnp-textSecondary"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Collapsible panel */}
      {isOpen && (
        <div
          id="video-filters-panel"
          className="border-t border-pnp-border"
          role="region"
          aria-label="Filter controls"
        >
          {/* WebGL unavailable warning */}
          {(!webGlAvailable || webGlError) && (
            <div
              className="flex items-start gap-2.5 mx-4 mt-4 px-3 py-2.5 rounded-xl text-xs"
              style={{
                background: "rgba(255,69,58,0.08)",
                border: "1px solid rgba(255,69,58,0.2)",
              }}
              role="alert"
            >
              <AlertTriangle
                className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                style={{ color: "#FF453A" }}
                aria-hidden="true"
              />
              <span className="text-pnp-textSecondary leading-relaxed">
                {webGlError
                  ? `WebGL error: ${webGlError}. Raw stream in use.`
                  : "WebGL is not available in this browser. Filters are disabled; raw stream is used."}
              </span>
            </div>
          )}

          {/* ── Preset strip ─────────────────────────────────────────── */}
          <div className="px-4 pt-4 pb-0">
            <p className="text-xs font-medium text-pnp-textSecondary mb-2.5">
              Presets
            </p>
            <div
              className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide"
              role="listbox"
              aria-label="Filter presets"
            >
              {PRESETS.map((preset) => {
                const isActive = activePreset === preset.name;
                return (
                  <button
                    key={preset.name}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => applyPreset(preset)}
                    className={`
                      flex flex-col items-center gap-1.5 shrink-0
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded-xl
                    `}
                    title={preset.name}
                  >
                    {/* Swatch */}
                    <div
                      className={`
                        w-10 h-10 rounded-full border-2 transition-all duration-150
                        ${isActive
                          ? "border-pnp-accent scale-110 shadow-lg"
                          : "border-transparent hover:border-pnp-border"}
                      `}
                      style={{ background: preset.swatchHsl }}
                      aria-hidden="true"
                    />
                    <span
                      className={`text-[10px] font-medium leading-none transition-colors duration-150 ${
                        isActive
                          ? "text-pnp-accent"
                          : "text-pnp-textSecondary"
                      }`}
                    >
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Adjustments ──────────────────────────────────────────── */}
          <div className="px-4 pt-4 space-y-4">
            <p className="text-xs font-medium text-pnp-textSecondary -mb-1">
              Adjustments
            </p>

            <SliderRow
              label="Brightness"
              value={adj.brightness}
              min={-100}
              max={100}
              isDefault={adj.brightness === DEFAULT_ADJUSTMENTS.brightness}
              onChange={setField("brightness")}
              onReset={resetField("brightness")}
            />
            <SliderRow
              label="Contrast"
              value={adj.contrast}
              min={-100}
              max={100}
              isDefault={adj.contrast === DEFAULT_ADJUSTMENTS.contrast}
              onChange={setField("contrast")}
              onReset={resetField("contrast")}
            />
            <SliderRow
              label="Saturation"
              value={adj.saturation}
              min={-100}
              max={100}
              isDefault={adj.saturation === DEFAULT_ADJUSTMENTS.saturation}
              onChange={setField("saturation")}
              onReset={resetField("saturation")}
            />
            <SliderRow
              label="Warmth"
              value={adj.warmth}
              min={-50}
              max={50}
              isDefault={adj.warmth === DEFAULT_ADJUSTMENTS.warmth}
              onChange={setField("warmth")}
              onReset={resetField("warmth")}
            />
            <SliderRow
              label="Sharpness"
              value={adj.sharpness}
              min={0}
              max={100}
              isDefault={adj.sharpness === DEFAULT_ADJUSTMENTS.sharpness}
              onChange={setField("sharpness")}
              onReset={resetField("sharpness")}
            />
          </div>

          {/* ── Beauty Mode ──────────────────────────────────────────── */}
          <div className="mx-4 mt-4 px-3 py-3 rounded-xl bg-pnp-surfaceHover border border-pnp-border">
            <p className="text-xs font-semibold text-pnp-textPrimary mb-3">
              Beauty Mode
            </p>
            <div className="space-y-3">
              <ToggleSwitch
                id="beauty-mode-toggle"
                label="Smooth skin &amp; brightness boost"
                checked={beautyMode}
                onChange={setBeautyMode}
              />
              {beautyMode && (
                <p className="text-[11px] text-pnp-textSecondary leading-relaxed">
                  Applies a subtle brightness boost (+10) for a softer look.
                </p>
              )}
            </div>
          </div>

          {/* ── Reset All ────────────────────────────────────────────── */}
          <div className="px-4 pt-4 pb-4">
            <button
              onClick={resetAll}
              disabled={!hasAnyChange}
              className="
                w-full flex items-center justify-center gap-2
                py-2.5 px-4 rounded-xl
                text-xs font-semibold text-pnp-textSecondary
                border border-pnp-border
                hover:bg-pnp-surfaceHover hover:text-pnp-textPrimary
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-all duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
              "
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
