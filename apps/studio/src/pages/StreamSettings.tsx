import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import {
  getStreamProfile,
  saveStreamProfile,
  getStreamerSettings,
  updateStreamerSettings,
  getStreamHistory,
  type StreamerSettings,
  type StreamHistoryItem,
  type StreamHistorySummary,
} from "@/lib/api";

const QUALITY_PRESETS = [
  { label: "360p", value: "360p" },
  { label: "480p", value: "480p" },
  { label: "720p", value: "720p" },
  { label: "1080p", value: "1080p" },
];

const FPS_OPTIONS = [24, 30, 60];

export default function StreamSettings() {
  const t = useI18n();
  const navigate = useNavigate();

  // Stream profile
  const [boundaries, setBoundaries] = useState("");
  const [turnOns, setTurnOns] = useState("");
  const [streamGoal, setStreamGoal] = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Streamer settings
  const [settings, setSettings] = useState<StreamerSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // Stream history
  const [historyStreams, setHistoryStreams] = useState<StreamHistoryItem[]>([]);
  const [historySummary, setHistorySummary] = useState<StreamHistorySummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    getStreamProfile()
      .then((res) => {
        if (res.profile) {
          setBoundaries(res.profile.boundaries || "");
          setTurnOns(res.profile.turnOns || "");
          setStreamGoal(res.profile.streamGoal || "");
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false));

    getStreamerSettings()
      .then((res) => {
        if (res.settings) setSettings(res.settings);
      })
      .catch(() => {})
      .finally(() => setSettingsLoading(false));

    getStreamHistory()
      .then((res) => {
        if (res.success) {
          setHistoryStreams(res.streams);
          setHistorySummary(res.summary);
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      await saveStreamProfile({ boundaries, turnOns, streamGoal });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch {
      // Silent fail
    } finally {
      setProfileSaving(false);
    }
  };

  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const statusBadgeClass = (status: string): string => {
    if (status === "live" || status === "active") return "bg-red-500/20 text-red-400 border border-red-500/30";
    if (status === "ended" || status === "completed") return "bg-pnp-surface text-pnp-textSecondary border border-pnp-border";
    if (status === "scheduled") return "bg-pnp-accent/10 text-pnp-accent border border-pnp-accent/20";
    return "bg-pnp-surface text-pnp-textSecondary border border-pnp-border";
  };

  const handleUpdateSetting = async (key: keyof StreamerSettings, value: unknown) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value } as StreamerSettings;
    setSettings(updated);
    try {
      await updateStreamerSettings({ [key]: value });
    } catch {
      // Revert on failure
      setSettings(settings);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="text-pnp-textSecondary hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-white">{t.settings}</h1>
      </div>

      {/* Stream Profile */}
      <div className="glass-card-sm p-5 space-y-4">
        <h2 className="text-sm font-bold text-white">{t.streamProfile}</h2>

        {profileLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs text-pnp-textSecondary block mb-1">{t.boundaries}</label>
              <textarea
                value={boundaries}
                onChange={(e) => setBoundaries(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white resize-none"
                rows={3}
                placeholder="What are your boundaries?"
              />
            </div>
            <div>
              <label className="text-xs text-pnp-textSecondary block mb-1">{t.turnOns}</label>
              <textarea
                value={turnOns}
                onChange={(e) => setTurnOns(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white resize-none"
                rows={3}
                placeholder="What turns you on?"
              />
            </div>
            <div>
              <label className="text-xs text-pnp-textSecondary block mb-1">{t.streamGoal}</label>
              <textarea
                value={streamGoal}
                onChange={(e) => setStreamGoal(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white resize-none"
                rows={2}
                placeholder="What's your goal for the stream?"
              />
            </div>
            <button
              onClick={handleSaveProfile}
              disabled={profileSaving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white btn-gradient disabled:opacity-50"
            >
              {profileSaving ? t.saving : profileSaved ? t.profileSaved : t.saveProfile}
            </button>
          </>
        )}
      </div>

      {/* Quality Settings */}
      <div className="glass-card-sm p-5 space-y-4">
        <h2 className="text-sm font-bold text-white">Quality Settings</h2>

        {settingsLoading || !settings ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Quality Preset */}
            <div>
              <label className="text-xs text-pnp-textSecondary block mb-2">Quality Preset</label>
              <div className="flex gap-2">
                {QUALITY_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handleUpdateSetting("qualityPreset", p.value)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      settings.qualityPreset === p.value
                        ? "bg-pnp-accent/20 text-pnp-accent border border-pnp-accent/40"
                        : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:text-white"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* FPS */}
            <div>
              <label className="text-xs text-pnp-textSecondary block mb-2">Frame Rate</label>
              <div className="flex gap-2">
                {FPS_OPTIONS.map((fps) => (
                  <button
                    key={fps}
                    onClick={() => handleUpdateSetting("fps", fps)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      settings.fps === fps
                        ? "bg-pnp-accent/20 text-pnp-accent border border-pnp-accent/40"
                        : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:text-white"
                    }`}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Toggle settings */}
            {([
              ["localRecord", "Local Recording"],
              ["lowLatency", "Low Latency Mode"],
              ["beautyMode", "Beauty Mode"],
            ] as const).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-pnp-textPrimary">{label}</span>
                <button
                  onClick={() => handleUpdateSetting(key, !settings[key])}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    settings[key] ? "bg-pnp-accent" : "bg-pnp-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      settings[key] ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Stream History */}
      <div className="glass-card-sm p-5 space-y-4">
        <h2 className="text-sm font-bold text-white">Stream History</h2>

        {historyLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary stat cards */}
            {historySummary && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-pnp-surface rounded-xl p-3 border border-pnp-border text-center">
                  <p className="text-xl font-bold text-white">{historySummary.totalStreams}</p>
                  <p className="text-xs text-pnp-textSecondary mt-0.5">Total Streams</p>
                </div>
                <div className="bg-pnp-surface rounded-xl p-3 border border-pnp-border text-center">
                  <p className="text-xl font-bold text-white">
                    {formatDuration(Math.round(historySummary.totalDuration / 60))}
                  </p>
                  <p className="text-xs text-pnp-textSecondary mt-0.5">Total Hours</p>
                </div>
                <div className="bg-pnp-surface rounded-xl p-3 border border-pnp-border text-center">
                  <p className="text-xl font-bold text-white">{historySummary.avgViewers}</p>
                  <p className="text-xs text-pnp-textSecondary mt-0.5">Avg Viewers</p>
                </div>
                <div className="bg-pnp-surface rounded-xl p-3 border border-pnp-border text-center">
                  <p className="text-xl font-bold text-white">{historySummary.totalLikes}</p>
                  <p className="text-xs text-pnp-textSecondary mt-0.5">Total Likes</p>
                </div>
              </div>
            )}

            {/* Stream list */}
            {historyStreams.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-pnp-textSecondary text-sm">No streams yet. Start your first broadcast!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {historyStreams.map((stream) => (
                  <div
                    key={stream.id}
                    className="flex items-center justify-between bg-pnp-surface rounded-xl px-3 py-2.5 border border-pnp-border"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs text-white font-medium">{formatDate(stream.startedAt)}</span>
                      <div className="flex items-center gap-2 text-xs text-pnp-textSecondary">
                        <span>{formatDuration(stream.duration)}</span>
                        <span className="text-pnp-border">·</span>
                        <span>{stream.peakViewers} peak</span>
                        <span className="text-pnp-border">·</span>
                        <span>{stream.likes} likes</span>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${statusBadgeClass(stream.status)}`}
                    >
                      {stream.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
