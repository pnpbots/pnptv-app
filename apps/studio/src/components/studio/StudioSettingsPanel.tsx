import React, { useState } from "react";
import type { QualityPreset } from "@/hooks/useStreamer";
import { QUALITY_PRESETS } from "@/hooks/useStreamer";
import { Toggle, DownloadIcon, CheckIcon } from "./shared";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface StudioSettingsPanelProps {
  selectedPreset: QualityPreset;
  onPresetChange: (p: QualityPreset) => void;
  fps: number;
  onFpsChange: (f: number) => void;
  isLive: boolean;
  autoReconnect: boolean;
  onToggleAutoReconnect: () => void;
  lowLatency: boolean;
  onToggleLowLatency: () => void;
  hardwareAccel: boolean;
  onToggleHardwareAccel: () => void;
  localRecordEnabled: boolean;
  onToggleLocalRecord: () => void;
  recordingBlob: Blob | null;
  onDownloadRecording: () => void;
  channel: { ref: string; streamKey: string; rtmpUrl: string } | null;
  streamProfile: { boundaries: string; turnOns: string; streamGoal: string };
  onStreamProfileChange: (fn: (prev: any) => any) => void;
  autoMessages: string[];
  autoActive: boolean;
  onSaveProfile: () => void;
  onToggleAutoMessages: () => void;
  profileSaving: boolean;
  profileError: string | null;
}

// ─── Inline CopyIcon (avoids an extra import) ──────────────────────────────────

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function EyeIcon({ hidden, className }: { hidden: boolean; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      {hidden ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21"
        />
      ) : (
        <>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </>
      )}
    </svg>
  );
}

// ─── Shared preset button style helper ────────────────────────────────────────

function presetButtonStyle(isActive: boolean): React.CSSProperties {
  return {
    background: isActive
      ? "linear-gradient(135deg, rgba(212,0,122,0.25), rgba(230,145,56,0.15))"
      : "rgba(30,30,30,0.7)",
    borderColor: isActive ? "rgba(212,0,122,0.5)" : "rgba(255,255,255,0.1)",
    color: isActive ? "#fff" : "#A1A1A3",
  };
}

const PRESET_BUTTON_CLASS = `
  px-3 py-1.5 rounded-xl text-xs font-semibold
  border transition-all duration-150
  disabled:opacity-40 disabled:cursor-not-allowed
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
  min-h-[36px]
`;

// ─── StudioSettingsPanel ───────────────────────────────────────────────────────

export function StudioSettingsPanel({
  selectedPreset,
  onPresetChange,
  fps,
  onFpsChange,
  isLive,
  autoReconnect,
  onToggleAutoReconnect,
  lowLatency,
  onToggleLowLatency,
  hardwareAccel,
  onToggleHardwareAccel,
  localRecordEnabled,
  onToggleLocalRecord,
  recordingBlob,
  onDownloadRecording,
  channel,
  streamProfile,
  onStreamProfileChange,
  autoMessages,
  autoActive,
  onSaveProfile,
  onToggleAutoMessages,
  profileSaving,
  profileError,
}: StudioSettingsPanelProps) {
  const [showRtmpKey, setShowRtmpKey] = useState(false);
  const [rtmpUrlCopied, setRtmpUrlCopied] = useState(false);
  const [rtmpKeyCopied, setRtmpKeyCopied] = useState(false);

  function handleCopyRtmpUrl() {
    if (!channel) return;
    navigator.clipboard?.writeText(channel.rtmpUrl);
    setRtmpUrlCopied(true);
    setTimeout(() => setRtmpUrlCopied(false), 2000);
  }

  function handleCopyStreamKey() {
    if (!channel) return;
    navigator.clipboard?.writeText(channel.streamKey);
    setRtmpKeyCopied(true);
    setTimeout(() => setRtmpKeyCopied(false), 2000);
  }

  const saveDisabled =
    profileSaving ||
    !streamProfile.boundaries.trim() ||
    !streamProfile.turnOns.trim() ||
    !streamProfile.streamGoal.trim();

  return (
    <div className="space-y-4 p-4">

      {/* ── 1. Quality presets ────────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-pnp-border bg-pnp-surface p-4"
        aria-labelledby="section-quality"
      >
        <p
          id="section-quality"
          className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3"
        >
          Quality Preset
        </p>
        <div className="flex flex-wrap gap-2">
          {QUALITY_PRESETS.map((preset) => {
            const isActive = selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                disabled={isLive}
                onClick={() => onPresetChange(preset)}
                className={PRESET_BUTTON_CLASS}
                style={presetButtonStyle(isActive)}
                aria-pressed={isActive}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── 2. FPS selector ──────────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-pnp-border bg-pnp-surface p-4"
        aria-labelledby="section-fps"
      >
        <p
          id="section-fps"
          className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3"
        >
          Frame Rate
        </p>
        <div className="flex gap-2">
          {([24, 30, 60] as const).map((f) => {
            const isActive = fps === f;
            return (
              <button
                key={f}
                disabled={isLive}
                onClick={() => onFpsChange(f)}
                className={PRESET_BUTTON_CLASS}
                style={presetButtonStyle(isActive)}
                aria-pressed={isActive}
              >
                {f} fps
              </button>
            );
          })}
        </div>
      </section>

      {/* ── 3. Toggles ───────────────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-pnp-border bg-pnp-surface p-4 space-y-4"
        aria-labelledby="section-toggles"
      >
        <p
          id="section-toggles"
          className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider"
        >
          Options
        </p>
        <Toggle
          checked={autoReconnect}
          onChange={onToggleAutoReconnect}
          label="Auto-reconnect"
        />
        <Toggle
          checked={lowLatency}
          onChange={onToggleLowLatency}
          label="Low-latency mode"
        />
        <Toggle
          checked={hardwareAccel}
          onChange={onToggleHardwareAccel}
          label="Hardware acceleration"
        />
        <Toggle
          checked={localRecordEnabled}
          onChange={onToggleLocalRecord}
          label="Record locally (saves .webm)"
          disabled={isLive}
        />
      </section>

      {/* ── 4. Download recording (conditional) ──────────────────────────── */}
      {recordingBlob && (
        <button
          onClick={onDownloadRecording}
          className="
            w-full flex items-center justify-center gap-2
            py-2.5 rounded-xl text-sm font-semibold text-white
            border border-pnp-accent/40
            transition-all duration-150 hover:opacity-90 active:scale-[0.98]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
            min-h-[44px]
          "
          style={{ background: "rgba(212,0,122,0.15)" }}
        >
          <DownloadIcon className="w-4 h-4" aria-hidden="true" />
          Download Recording
        </button>
      )}

      {/* ── 5. RTMP Credentials ──────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-pnp-border bg-pnp-surface p-4"
        aria-labelledby="section-rtmp"
      >
        <p
          id="section-rtmp"
          className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-3"
        >
          OBS / External Software
        </p>

        {!channel ? (
          <p className="text-xs text-pnp-textSecondary">
            Loading stream credentials…
          </p>
        ) : (
          <div className="space-y-3">
            {/* RTMP Server URL */}
            <div>
              <label
                htmlFor="rtmp-url-display"
                className="text-[11px] text-pnp-textSecondary font-medium mb-1 block uppercase tracking-wider"
              >
                RTMP Server
              </label>
              <div className="flex items-center gap-2 bg-pnp-background border border-pnp-border rounded-xl px-3 py-2">
                <code
                  id="rtmp-url-display"
                  className="text-xs text-pnp-textPrimary flex-1 break-all select-all"
                >
                  {channel.rtmpUrl}
                </code>
                <button
                  onClick={handleCopyRtmpUrl}
                  className="
                    flex-shrink-0 text-pnp-textSecondary hover:text-pnp-accent
                    transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded
                  "
                  aria-label="Copy RTMP server URL"
                >
                  {rtmpUrlCopied ? (
                    <CheckIcon className="w-4 h-4" style={{ color: "#5ED1C4" }} />
                  ) : (
                    <CopyIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Stream Key */}
            <div>
              <label
                htmlFor="stream-key-display"
                className="text-[11px] text-pnp-textSecondary font-medium mb-1 block uppercase tracking-wider"
              >
                Stream Key
              </label>
              <div className="flex items-center gap-2 bg-pnp-background border border-pnp-border rounded-xl px-3 py-2">
                <code
                  id="stream-key-display"
                  className="text-xs text-pnp-textPrimary flex-1 font-mono break-all select-all"
                >
                  {showRtmpKey
                    ? channel.streamKey
                    : "•".repeat(Math.min(channel.streamKey.length, 24))}
                </code>
                <button
                  onClick={() => setShowRtmpKey((v) => !v)}
                  className="
                    flex-shrink-0 text-pnp-textSecondary hover:text-pnp-accent
                    transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded
                  "
                  aria-label={showRtmpKey ? "Hide stream key" : "Show stream key"}
                >
                  <EyeIcon hidden={showRtmpKey} className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCopyStreamKey}
                  className="
                    flex-shrink-0 text-pnp-textSecondary hover:text-pnp-accent
                    transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent rounded
                  "
                  aria-label="Copy stream key"
                >
                  {rtmpKeyCopied ? (
                    <CheckIcon className="w-4 h-4" style={{ color: "#5ED1C4" }} />
                  ) : (
                    <CopyIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-[10px] mt-1 text-pnp-error">
                Never share your stream key — anyone with it can broadcast to your channel.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── 6. Stream Profile form ───────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-pnp-border bg-pnp-surface p-4"
        aria-labelledby="section-profile"
      >
        <p
          id="section-profile"
          className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wider mb-1"
        >
          Stream Profile
        </p>
        <p className="text-[10px] text-pnp-textSecondary mb-3">
          Fill in your preferences and we'll generate fun chat messages that auto-post during your stream
        </p>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="profile-boundaries"
              className="text-[11px] text-pnp-textSecondary font-medium mb-1 block"
            >
              I'm not comfortable with…
            </label>
            <textarea
              id="profile-boundaries"
              value={streamProfile.boundaries}
              onChange={(e) =>
                onStreamProfileChange((p) => ({ ...p, boundaries: e.target.value }))
              }
              maxLength={500}
              rows={2}
              className="w-full rounded-xl bg-pnp-background border border-pnp-border px-3 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-pnp-accent resize-none"
              placeholder="e.g., Rough talk, certain requests…"
            />
          </div>

          <div>
            <label
              htmlFor="profile-turn-ons"
              className="text-[11px] text-pnp-textSecondary font-medium mb-1 block"
            >
              What turns me on…
            </label>
            <textarea
              id="profile-turn-ons"
              value={streamProfile.turnOns}
              onChange={(e) =>
                onStreamProfileChange((p) => ({ ...p, turnOns: e.target.value }))
              }
              maxLength={500}
              rows={2}
              className="w-full rounded-xl bg-pnp-background border border-pnp-border px-3 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-pnp-accent resize-none"
              placeholder="e.g., Compliments, confidence, eye contact…"
            />
          </div>

          <div>
            <label
              htmlFor="profile-stream-goal"
              className="text-[11px] text-pnp-textSecondary font-medium mb-1 block"
            >
              Goal for this stream
            </label>
            <textarea
              id="profile-stream-goal"
              value={streamProfile.streamGoal}
              onChange={(e) =>
                onStreamProfileChange((p) => ({ ...p, streamGoal: e.target.value }))
              }
              maxLength={500}
              rows={2}
              className="w-full rounded-xl bg-pnp-background border border-pnp-border px-3 py-2 text-xs text-pnp-textPrimary placeholder-pnp-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-pnp-accent resize-none"
              placeholder="e.g., 500 tokens, meet new people, have fun…"
            />
          </div>

          <button
            onClick={onSaveProfile}
            disabled={saveDisabled}
            className="
              w-full py-2.5 rounded-xl btn-gradient text-white text-xs font-semibold
              disabled:opacity-50 transition-all active:scale-[0.98]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
              min-h-[44px]
            "
          >
            {profileSaving ? "Generating…" : "Generate Chat Messages"}
          </button>

          {profileError && (
            <p className="text-[10px] text-pnp-error" role="alert">
              {profileError}
            </p>
          )}

          {/* ── 7. Auto-messages list + toggle ──────────────────────── */}
          {autoMessages.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-pnp-textSecondary font-medium">
                  {autoMessages.length} messages ready
                </p>
                <button
                  onClick={onToggleAutoMessages}
                  className={`
                    px-3 py-1 rounded-lg text-[10px] font-semibold transition-all
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pnp-accent
                    min-h-[30px]
                    ${
                      autoActive
                        ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                        : "bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30"
                    }
                  `}
                >
                  {autoActive ? "Stop Auto-Chat" : "Start Auto-Chat"}
                </button>
              </div>

              <div
                className="max-h-40 overflow-y-auto space-y-1 pr-1"
                style={{ scrollbarWidth: "thin" }}
                role="list"
                aria-label="Generated auto-chat messages"
              >
                {autoMessages.map((msg, i) => (
                  <div
                    key={i}
                    role="listitem"
                    className="text-[10px] text-pnp-textSecondary bg-pnp-background rounded-lg px-2.5 py-1.5 border border-pnp-border/50"
                  >
                    <span className="text-pnp-accent font-medium mr-1">{i + 1}.</span>
                    {msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
