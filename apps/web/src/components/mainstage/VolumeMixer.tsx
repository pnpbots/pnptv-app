import React, { useId } from "react";

interface VolumeMixerProps {
  camsVolume: number;
  mediaVolume: number;
  onCamsChange: (v: number) => void;
  onMediaChange: (v: number) => void;
  className?: string;
}

function VolumeSlider({
  id,
  label,
  value,
  onChange,
  icon,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-white/60 font-medium select-none">
        <span className="flex-shrink-0 text-white/50">{icon}</span>
        <span className="truncate">{label}</span>
        <span className="ml-auto tabular-nums text-white/80 font-semibold">{Math.round(value)}%</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #D4007A ${value}%, rgba(255,255,255,0.12) ${value}%)`,
          outline: "none",
        }}
        aria-label={`${label} volume ${Math.round(value)}%`}
      />
    </div>
  );
}

const CamIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
  </svg>
);

const MediaIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
  </svg>
);

export function VolumeMixer({ camsVolume, mediaVolume, onCamsChange, onMediaChange, className }: VolumeMixerProps) {
  const camsId = useId();
  const mediaId = useId();

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      <VolumeSlider
        id={camsId}
        label="Cammers"
        value={camsVolume}
        onChange={onCamsChange}
        icon={<CamIcon />}
      />
      <VolumeSlider
        id={mediaId}
        label="Media"
        value={mediaVolume}
        onChange={onMediaChange}
        icon={<MediaIcon />}
      />
    </div>
  );
}
