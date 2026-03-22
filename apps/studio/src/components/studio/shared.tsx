import React, { useRef, useEffect, Suspense } from "react";

// ─── SVG Icon Components ───────────────────────────────────────────────────────

export const ArrowLeft = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);

export const Radio = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);

export const StopCircle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" />
  </svg>
);

export const MicIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

export const MicOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

export const VideoIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

export const VideoOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /><line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export const MonitorIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export const PauseIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
  </svg>
);

export const CameraIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
  </svg>
);

export const RefreshCwIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const UsersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const DownloadIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const LayersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
  </svg>
);

export const SlidersIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

export const SettingsIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const AlertTriangleIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const CheckIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const RotateCwIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

export const ChatIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NetworkQuality = "wifi" | "4g" | "3g" | "2g" | "unknown";

// ─── Network quality helpers ───────────────────────────────────────────────────

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

// ─── formatDuration ────────────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─── QuickActionButton ─────────────────────────────────────────────────────────

export interface QuickActionButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  activeColor?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

export function QuickActionButton({
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

// ─── Toggle ────────────────────────────────────────────────────────────────────

export interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
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

// ─── BitrateSparkline ──────────────────────────────────────────────────────────

export function BitrateSparkline({ samples }: { samples: number[] }) {
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

// ─── StatRow ───────────────────────────────────────────────────────────────────

export function StatRow({
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

// ─── MiniStat ──────────────────────────────────────────────────────────────────

export function MiniStat({
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

// ─── NetworkQualityPill ────────────────────────────────────────────────────────

export function NetworkQualityPill({ quality }: { quality: NetworkQuality }) {
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

// ─── ConfirmStopDialog ─────────────────────────────────────────────────────────

export interface ConfirmStopDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmStopDialog({ onConfirm, onCancel }: ConfirmStopDialogProps) {
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

// ─── PlaceholderPanel ──────────────────────────────────────────────────────────

export function PlaceholderPanel({ label, description }: { label: string; description: string }) {
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

// ─── SubComponentErrorBoundary ─────────────────────────────────────────────────

export class SubComponentErrorBoundary extends React.Component<
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

// ─── TabPanel ──────────────────────────────────────────────────────────────────

export interface TabPanelProps {
  label: string;
  children: React.ReactNode;
}

export function TabPanel({ label, children }: TabPanelProps) {
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
