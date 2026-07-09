import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Radio } from "@/components/studio/shared";
import { useI18n } from "@/lib/i18n";

// ─── Local SVG icons (studio has no lucide-react) ─────────────────────────────

const CameraIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const CheckCircleIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const ChevronRightIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const WifiIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

const WifiOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
    <path d="M5 12.55a11 11 0 0 1 5.17-2.39" />
    <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectionRating = "excellent" | "good" | "fair" | "poor" | null;

type CategoryKey =
  | "tagChat"
  | "tagMusic"
  | "tagGaming"
  | "tagCooking"
  | "tagFitness"
  | "tagArt"
  | "tagOther"
  | "tagAdult"
  | "tagFetish"
  | "tagBear"
  | "tagLeather"
  | "tagPNP";

const CATEGORIES: CategoryKey[] = [
  "tagAdult",
  "tagPNP",
  "tagFetish",
  "tagBear",
  "tagLeather",
  "tagChat",
  "tagMusic",
  "tagGaming",
  "tagCooking",
  "tagFitness",
  "tagArt",
  "tagOther",
];

export interface PreStreamSetupProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  streamTitle: string;
  setStreamTitle: (v: string) => void;
  streamDesc: string;
  setStreamDesc: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  thumbnail: string | null;
  setThumbnail: (v: string | null) => void;
  onStartStream: () => void;
  isConnecting: boolean;
  channel: { ref: string } | null;
  /** Camera or recorder error to display above the preview — visible above the fold on mobile. */
  streamError?: string | null;
  /** Re-run getUserMedia in place — preferred over a full page reload. */
  onRetryCamera?: () => void | Promise<void>;
}

// ─── Countdown overlay ────────────────────────────────────────────────────────

interface CountdownOverlayProps {
  label: string;
  onComplete: () => void;
}

function CountdownOverlay({ label, onComplete }: CountdownOverlayProps) {
  const [count, setCount] = useState<number | "LIVE!">(3);

  useEffect(() => {
    const sequence = [3, 2, 1, "LIVE!" as const];
    let idx = 0;

    function tick() {
      idx += 1;
      if (idx < sequence.length) {
        setCount(sequence[idx]);
        timer = setTimeout(tick, 1000);
      } else {
        // All done — fire onComplete
        onComplete();
      }
    }

    let timer = setTimeout(tick, 1000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  const isLiveText = count === "LIVE!";

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      aria-live="assertive"
      role="status"
    >
      {!isLiveText && (
        <p
          className="text-sm font-medium mb-3"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          {label}
        </p>
      )}
      <span
        className="font-black tabular-nums select-none"
        style={{
          fontSize: isLiveText ? "4rem" : "7rem",
          lineHeight: 1,
          background: isLiveText
            ? "linear-gradient(135deg, #D4007A, #E69138)"
            : "linear-gradient(135deg, #ffffff, rgba(255,255,255,0.7))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          transition: "font-size 0.2s ease",
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ─── Connection rating helpers ─────────────────────────────────────────────────

function ratingColor(rating: ConnectionRating): string {
  if (rating === "excellent") return "#5ED1C4";
  if (rating === "good") return "#5ED1C4";
  if (rating === "fair") return "#FFD60A";
  if (rating === "poor") return "#FF453A";
  return "rgba(255,255,255,0.4)";
}

function ratingFromKbps(kbps: number): ConnectionRating {
  if (kbps >= 4000) return "excellent";
  if (kbps >= 2000) return "good";
  if (kbps >= 800) return "fair";
  return "poor";
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "rgba(255,255,255,0.45)" }}
    >
      {children}
    </p>
  );
}

// ─── PreStreamSetup ───────────────────────────────────────────────────────────

export function PreStreamSetup({
  videoRef,
  streamTitle,
  setStreamTitle,
  streamDesc,
  setStreamDesc,
  category,
  setCategory,
  thumbnail,
  setThumbnail,
  onStartStream,
  isConnecting,
  channel,
  streamError = null,
  onRetryCamera,
}: PreStreamSetupProps) {
  const t = useI18n();

  // ── Local setup state ──────────────────────────────────────────────────────
  const [titleError, setTitleError] = useState(false);
  const [connectionRating, setConnectionRating] = useState<ConnectionRating>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // ── Thumbnail capture ──────────────────────────────────────────────────────
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 180;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setThumbnail(canvas.toDataURL("image/jpeg", 0.85));
  }, [videoRef]);

  // ── Connection test ────────────────────────────────────────────────────────
  const testConnection = useCallback(async () => {
    setIsTesting(true);
    setConnectionRating(null);

    try {
      // Send a ~200 KB octet-stream payload and time the round trip locally.
      // The server echoes `receivedBytes` so we can verify it actually received
      // the payload (rather than getting a parser short-circuit).
      const PAYLOAD_BYTES = 200 * 1024;
      const blob = new Blob([new Uint8Array(PAYLOAD_BYTES)], {
        type: "application/octet-stream",
      });

      const API_BASE =
        (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
        "https://studio.pnptv.app";

      const t0 = performance.now();
      const res = await fetch(`${API_BASE}/api/webapp/live/connection-test`, {
        method: "POST",
        credentials: "include",
        body: blob,
        signal: AbortSignal.timeout(8000),
      });
      const elapsed = (performance.now() - t0) / 1000; // seconds

      if (!res.ok) {
        setConnectionRating("poor");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { receivedBytes?: number };
      const verifiedBytes = typeof data.receivedBytes === "number" && data.receivedBytes > 0
        ? data.receivedBytes
        : PAYLOAD_BYTES;
      const kbps = (verifiedBytes * 8) / 1024 / Math.max(elapsed, 0.01);
      setConnectionRating(ratingFromKbps(kbps));
    } catch {
      setConnectionRating("poor");
    } finally {
      setIsTesting(false);
    }
  }, []);

  // ── Go Live — validate then show countdown ─────────────────────────────────
  const handleGoLive = useCallback(() => {
    if (!streamTitle.trim()) {
      setTitleError(true);
      titleInputRef.current?.focus();
      return;
    }
    setTitleError(false);
    setShowCountdown(true);
  }, [streamTitle]);

  const handleCountdownComplete = useCallback(() => {
    setShowCountdown(false);
    onStartStream();
  }, [onStartStream]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Countdown overlay — rendered over everything */}
      {showCountdown && (
        <CountdownOverlay
          label={t.countdownLabel}
          onComplete={handleCountdownComplete}
        />
      )}

      {/* Scrollable card body */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: "thin" }}
      >
        <div className="max-w-lg mx-auto px-4 pt-6 pb-8 space-y-6">

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div>
            <h1 className="text-xl font-bold text-pnp-textPrimary">
              {t.setupTitle}
            </h1>
            <p
              className="text-sm mt-0.5"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              {t.setupSubtitle}
            </p>
          </div>

          {/* ── Camera preview + thumbnail capture ────────────────────── */}
          <div>
            <SectionLabel>{t.thumbnailLabel}</SectionLabel>

            {/* Inline camera error banner — visible above the fold on mobile.
                Surfaces NotAllowed / NotFound / NotReadable so creators know
                to grant permission instead of staring at a black preview. */}
            {streamError && (
              <div
                className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
                style={{
                  background: "rgba(255,69,58,0.10)",
                  border: "1px solid rgba(255,69,58,0.30)",
                  color: "#FF6B6B",
                }}
                role="alert"
                aria-live="assertive"
              >
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold mb-0.5">Camera unavailable</p>
                  <p className="opacity-80 leading-snug break-words">{streamError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (onRetryCamera) void onRetryCamera();
                      else window.location.reload();
                    }}
                    className="mt-1.5 text-[11px] font-semibold underline hover:no-underline"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            <div
              className="relative rounded-xl overflow-hidden"
              style={{
                aspectRatio: "16/9",
                background: "#0E0E0E",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {/* Live camera preview */}
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay
                muted
                playsInline
                aria-label="Camera preview"
              />

              {/* Captured thumbnail overlay */}
              {thumbnail && (
                <img
                  src={thumbnail}
                  alt={t.thumbnailCaptured}
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ opacity: 0.9 }}
                />
              )}

              {/* Capture / recapture button */}
              <div className="absolute bottom-2 right-2">
                <button
                  type="button"
                  onClick={captureFrame}
                  className="
                    flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                    text-xs font-semibold text-white
                    transition-all duration-150 active:scale-[0.97]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                  "
                  style={{
                    background: thumbnail
                      ? "rgba(255,255,255,0.15)"
                      : "rgba(212,0,122,0.85)",
                    backdropFilter: "blur(6px)",
                  }}
                  aria-label={thumbnail ? t.recapture : t.captureThumbnail}
                >
                  <CameraIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  {thumbnail ? t.recapture : t.captureThumbnail}
                </button>
              </div>

              {/* Captured checkmark badge */}
              {thumbnail && (
                <div
                  className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
                  style={{
                    background: "rgba(94,209,196,0.2)",
                    border: "1px solid rgba(94,209,196,0.4)",
                    color: "#5ED1C4",
                  }}
                >
                  <CheckCircleIcon className="w-3 h-3" aria-hidden="true" />
                  {t.thumbnailCaptured}
                </div>
              )}
            </div>
          </div>

          {/* ── Stream Title ─────────────────────────────────────────────── */}
          <div>
            <label
              htmlFor="pss-title"
              className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              {t.streamTitleLabel}
              <span className="ml-1" style={{ color: "#D4007A" }} aria-hidden="true">
                *
              </span>
            </label>
            <input
              ref={titleInputRef}
              id="pss-title"
              type="text"
              value={streamTitle}
              onChange={(e) => {
                setStreamTitle(e.target.value);
                if (e.target.value.trim()) setTitleError(false);
              }}
              placeholder={t.streamTitlePlaceholder}
              maxLength={120}
              aria-required="true"
              aria-invalid={titleError}
              aria-describedby={titleError ? "pss-title-error" : undefined}
              className="
                w-full px-3 py-2.5 rounded-xl
                text-sm text-pnp-textPrimary
                transition-colors duration-150
                focus:outline-none focus-visible:ring-2
                placeholder:text-pnp-textSecondary
              "
              style={{
                background: "rgba(255,255,255,0.06)",
                border: titleError
                  ? "1px solid rgba(255,69,58,0.8)"
                  : "1px solid rgba(255,255,255,0.10)",
                // ring color handled by focus-visible class referencing token
              }}
            />
            {titleError && (
              <p
                id="pss-title-error"
                role="alert"
                className="mt-1.5 text-xs"
                style={{ color: "#FF453A" }}
              >
                {t.streamTitleRequired}
              </p>
            )}
          </div>

          {/* ── Description ─────────────────────────────────────────────── */}
          <div>
            <label
              htmlFor="pss-desc"
              className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              {t.streamDescLabel}
            </label>
            <textarea
              id="pss-desc"
              rows={2}
              value={streamDesc}
              onChange={(e) => setStreamDesc(e.target.value)}
              placeholder={t.streamDescPlaceholder}
              maxLength={500}
              className="
                w-full px-3 py-2.5 rounded-xl resize-none
                text-sm text-pnp-textPrimary
                transition-colors duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                placeholder:text-pnp-textSecondary
              "
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            />
          </div>

          {/* ── Category ─────────────────────────────────────────────────── */}
          <div>
            <SectionLabel>{t.categoryLabel}</SectionLabel>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t.categoryLabel}
            >
              {CATEGORIES.map((key) => {
                const isSelected = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCategory(key)}
                    aria-pressed={isSelected}
                    className="
                      px-3 py-1.5 rounded-full text-xs font-semibold
                      transition-all duration-150 active:scale-[0.97]
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                    "
                    style={
                      isSelected
                        ? {
                            background: "linear-gradient(135deg, #D4007A, #E69138)",
                            color: "#fff",
                            border: "1px solid transparent",
                          }
                        : {
                            background: "rgba(255,255,255,0.06)",
                            color: "rgba(255,255,255,0.6)",
                            border: "1px solid rgba(255,255,255,0.10)",
                          }
                    }
                  >
                    {t[key]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Connection test ──────────────────────────────────────────── */}
          <div>
            <SectionLabel>{t.connectionTestLabel}</SectionLabel>

            <div
              className="rounded-xl px-4 py-3 space-y-3"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={isTesting}
                  className="
                    flex items-center gap-2 px-3 py-2 rounded-xl
                    text-xs font-semibold text-white min-h-[36px]
                    transition-all duration-150 active:scale-[0.97]
                    disabled:opacity-50 disabled:cursor-not-allowed
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                  "
                  style={{ background: "rgba(255,255,255,0.10)" }}
                  aria-label={isTesting ? t.testingConnection : t.testConnection}
                >
                  {isTesting ? (
                    <span
                      className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <WifiIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {isTesting ? t.testingConnection : t.testConnection}
                </button>

                {/* Rating badge */}
                {connectionRating && !isTesting && (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
                    style={{
                      background: `${ratingColor(connectionRating)}20`,
                      border: `1px solid ${ratingColor(connectionRating)}50`,
                      color: ratingColor(connectionRating),
                    }}
                    aria-live="polite"
                  >
                    {connectionRating === "poor" ? (
                      <WifiOffIcon className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      <CheckCircleIcon className="w-3 h-3" aria-hidden="true" />
                    )}
                    {t[`connection${connectionRating.charAt(0).toUpperCase() + connectionRating.slice(1)}` as keyof typeof t] as string}
                  </div>
                )}
              </div>

              <p
                className="text-xs"
                style={{ color: "rgba(255,255,255,0.35)" }}
              >
                {t.connectionTestHint}
              </p>
            </div>
          </div>

          {/* ── No channel warning ──────────────────────────────────────── */}
          {!channel && (
            <div
              className="flex items-start gap-2 rounded-xl px-4 py-3 text-xs"
              style={{
                background: "rgba(255,69,58,0.10)",
                border: "1px solid rgba(255,69,58,0.25)",
                color: "#FF453A",
              }}
              role="alert"
            >
              <WifiOffIcon className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{t.noChannelAssigned}</span>
            </div>
          )}

          {/* ── Go Live button ───────────────────────────────────────────── */}
          <button
            type="button"
            onClick={handleGoLive}
            disabled={isConnecting || !channel || !!streamError}
            className="
              w-full flex items-center justify-center gap-2
              py-3.5 rounded-2xl
              text-sm font-bold text-white
              transition-all duration-150 active:scale-[0.98]
              disabled:opacity-40 disabled:cursor-not-allowed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2
              focus-visible:ring-offset-[#0E0E0E]
            "
            style={
              isConnecting || !channel || streamError
                ? { background: "rgba(255,255,255,0.08)" }
                : { background: "linear-gradient(135deg, #D4007A, #E69138)" }
            }
            aria-label={t.startStreaming}
          >
            {isConnecting ? (
              <>
                <span
                  className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"
                  aria-hidden="true"
                />
                {t.connecting}
              </>
            ) : (
              <>
                <Radio className="w-4 h-4" aria-hidden="true" />
                {t.startStreaming}
                <ChevronRightIcon className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
