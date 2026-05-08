import { useI18n } from "@/lib/i18n";

interface NowPlayingChipProps {
  title: string;
}

export function NowPlayingChip({ title }: NowPlayingChipProps) {
  const t = useI18n();
  return (
    <div
      className="pointer-events-none fixed z-30 flex items-center gap-2 px-3 py-1.5 rounded-full border border-pnp-accent/[0.28]"
      style={{
        top: "calc(64px + env(safe-area-inset-top, 0px))",
        right: "1rem",
        maxWidth: "calc(100vw - 2rem)",
        background: "rgba(10,10,15,0.72)",
        backdropFilter: "blur(12px)",
      }}
      role="status"
      aria-live="polite"
      aria-label={t.live.mainStageNowPlayingAriaLabel(title)}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-pnp-accent"
        style={{ boxShadow: "0 0 8px rgba(212,0,122,0.7)" }}
        aria-hidden
      />
      <span className="text-white/45 text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
        {t.live.mainStageNowPlayingLabel}
      </span>
      <span className="text-white text-xs font-medium truncate">{title}</span>
    </div>
  );
}
