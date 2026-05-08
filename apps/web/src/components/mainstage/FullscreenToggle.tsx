import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

interface FullscreenToggleProps {
  targetRef: React.RefObject<HTMLElement>;
}

export function FullscreenToggle({ targetRef }: FullscreenToggleProps) {
  const t = useI18n();
  const [isFs, setIsFs] = useState(
    typeof document !== "undefined" &&
      !!(document.fullscreenElement ||
        // iOS Safari webkit variant
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement)
  );

  useEffect(() => {
    const onChange = () =>
      setIsFs(
        !!document.fullscreenElement ||
          !!(document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
      );
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const handleClick = useCallback(async () => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitFullscreenElement?: Element;
    };
    try {
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else {
        // Target the Main Stage container specifically so the rest of the
        // document (and any route listeners) aren't involved.
        const el = (targetRef.current || document.documentElement) as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        };
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      }
    } catch {
      // Some browsers (iOS Safari on non-video elements) reject — silent
    }
  }, [targetRef]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isFs ? t.live.mainStageAriaExitFullscreen : t.live.mainStageAriaFullscreen}
      title={isFs ? t.live.mainStageAriaExitFullscreen : t.live.mainStageTitleFullscreen}
      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black bg-white/[0.06] border border-white/10"
    >
      {isFs ? (
        <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
      )}
    </button>
  );
}
