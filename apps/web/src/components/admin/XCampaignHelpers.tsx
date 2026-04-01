import React from "react";
import {
  getRandomCampaignVideo,
  updateAdminXCampaign,
  type XActiveAccount,
} from "@/lib/api";

// ── Countdown Timer ─────────────────────────────────────────────────────────
export function CountdownTimer({ targetDate }: { targetDate: string | null | undefined }) {
  const [label, setLabel] = React.useState("");

  React.useEffect(() => {
    if (!targetDate) { setLabel("—"); return; }
    const update = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setLabel("now"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setLabel(`in ${h}h ${m}m`);
      else if (m > 0) setLabel(`in ${m}m ${s}s`);
      else setLabel(`in ${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return <span className="text-xs tabular-nums font-medium">{label}</span>;
}

// ── Expandable Post Text ─────────────────────────────────────────────────────
export function ExpandablePostText({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  if (!text) return <span className="text-pnp-textSecondary text-xs">—</span>;
  return (
    <div className="max-w-[300px]">
      {expanded ? (
        <div>
          <p className="text-xs text-pnp-textPrimary whitespace-pre-wrap break-words">{text}</p>
          <button onClick={() => setExpanded(false)} className="text-xs text-pnp-accent hover:underline mt-1">
            Show less
          </button>
        </div>
      ) : (
        <div>
          <p className="text-xs text-pnp-textSecondary truncate">{text}</p>
          {text.length > 60 && (
            <button onClick={() => setExpanded(true)} className="text-xs text-pnp-accent hover:underline">
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Grok Manager Types ───────────────────────────────────────────────────────
export interface GrokAction {
  action: "create_campaign" | "add_random_video";
  name?: string;
  accountHandle?: string;
  topic?: string;
  language?: string;
  activeHoursStart?: number;
  activeHoursEnd?: number;
  intervalMinutes?: number;
  customPrompt?: string;
  attachVideos?: boolean;
  campaignId?: string;
  reason?: string;
}

// ── parseGrokAction ──────────────────────────────────────────────────────────
export function parseGrokAction(text: string): { cleanText: string; action: GrokAction | null } {
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]*?)```/i) ||
    text.match(/(\{[\s\S]*?"action"\s*:\s*"(?:create_campaign|add_random_video)"[\s\S]*?\})/);
  if (!jsonMatch) return { cleanText: text, action: null };
  try {
    const raw = jsonMatch[1] || jsonMatch[0];
    const action = JSON.parse(raw.trim()) as GrokAction;
    if (action.action === "create_campaign" || action.action === "add_random_video") {
      const cleanText = text.replace(jsonMatch[0], "").trim();
      return { cleanText, action };
    }
  } catch (e) {
    console.warn("Failed to parse Grok action JSON", e);
  }
  return { cleanText: text, action: null };
}

// ── GrokActionCard ───────────────────────────────────────────────────────────
export function GrokActionCard({
  action,
  accounts,
  onApply,
  t,
}: {
  action: GrokAction;
  accounts: XActiveAccount[];
  onApply: (action: GrokAction) => void;
  t: any;
}) {
  const defaultAccount =
    accounts.find((a) => a.handle.toLowerCase() === action.accountHandle?.toLowerCase()) ||
    accounts[0];
  const [selectedHandle, setSelectedHandle] = React.useState(defaultAccount?.handle || "");

  return (
    <div className="mt-2 p-3 rounded-lg bg-pnp-accent/10 border border-pnp-accent/30">
      <p className="text-xs font-semibold text-pnp-accent mb-1">{t.admin.xCampaigns.grok.proposal}</p>
      <p className="text-xs text-pnp-textPrimary mb-0.5">
        <strong>{t.admin.xCampaigns.table.campaign}:</strong> {action.name}
      </p>
      <p className="text-xs text-pnp-textSecondary mb-0.5">
        {action.language} | every {action.intervalMinutes}min | UTC {action.activeHoursStart}–{action.activeHoursEnd}
      </p>
      <p className="text-xs text-pnp-textSecondary mb-0.5 line-clamp-2">{action.topic}</p>
      {action.attachVideos && (
        <p className="text-xs text-purple-400 mb-2">&#9654; {t.admin.xCampaigns.form.attachVideos}</p>
      )}
      {accounts.length > 1 ? (
        <select
          value={selectedHandle}
          onChange={(e) => setSelectedHandle(e.target.value)}
          className="w-full mb-2 px-2 py-1 text-xs rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
        >
          {accounts.map((a) => (
            <option key={a.account_id} value={a.handle}>
              @{a.handle}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-pnp-textSecondary mb-2">
          Account: @{selectedHandle || action.accountHandle}
        </p>
      )}
      <button
        onClick={() =>
          onApply({ ...action, accountHandle: selectedHandle || accounts[0]?.handle || action.accountHandle })
        }
        disabled={accounts.length === 0}
        className="cursor-pointer px-3 py-1.5 text-xs rounded-lg bg-pnp-accent text-white hover:bg-pnp-accent/80 active:scale-95 transition-all font-medium disabled:opacity-40"
      >
        {t.admin.xCampaigns.grok.apply}
      </button>
      {accounts.length === 0 && (
        <p className="text-xs text-red-400 mt-1">Connect an X account first.</p>
      )}
    </div>
  );
}

// ── RandomVideoActionCard ────────────────────────────────────────────────────
export function RandomVideoActionCard({
  action,
  mediaFolderId,
  onSaved,
  t,
}: {
  action: GrokAction;
  mediaFolderId: string | null;
  onSaved?: () => void;
  t: any;
}) {
  const [mediaUrl, setMediaUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchVideo = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRandomCampaignVideo(action.campaignId);
      setMediaUrl(res.mediaUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch video");
    } finally {
      setLoading(false);
    }
  };

  const saveToCamera = async () => {
    if (!action.campaignId || !mediaFolderId) return;
    setSaving(true);
    setError(null);
    try {
      await updateAdminXCampaign(action.campaignId, { mediaFolderId });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable video on campaign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
      <p className="text-xs font-semibold text-purple-400 mb-1">{t.admin.xCampaigns.grok.randomVideo}</p>
      {action.reason && (
        <p className="text-xs text-pnp-textSecondary mb-2">{action.reason}</p>
      )}
      {mediaUrl ? (
        <div className="mb-2">
          <video
            src={mediaUrl}
            controls
            controlsList="nodownload"
            onContextMenu={(e) => e.preventDefault()}
            className="w-full rounded-lg max-h-48 bg-black"
            preload="metadata"
          />
          <p className="text-xs text-pnp-textSecondary mt-1 break-all">{mediaUrl}</p>
        </div>
      ) : (
        <button
          onClick={fetchVideo}
          disabled={loading}
          className="cursor-pointer px-3 py-1.5 text-xs rounded-lg bg-purple-500 text-white hover:bg-purple-500/80 active:scale-95 transition-all font-medium disabled:opacity-40"
        >
          {loading ? t.admin.xCampaigns.grok.fetchingVideo : t.admin.xCampaigns.grok.previewVideo}
        </button>
      )}
      {action.campaignId && mediaFolderId && !saved && (
        <button
          onClick={saveToCamera}
          disabled={saving}
          className="cursor-pointer mt-2 px-3 py-1.5 text-xs rounded-lg bg-pnp-accent text-white hover:bg-pnp-accent/80 active:scale-95 transition-all font-medium disabled:opacity-40 block"
        >
          {saving ? t.admin.xCampaigns.grok.saving : t.admin.xCampaigns.grok.enableVideo}
        </button>
      )}
      {saved && (
        <p className="text-xs text-green-400 mt-2">{t.admin.xCampaigns.grok.videoEnabled}</p>
      )}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// ── QUICK_ACTIONS constant ───────────────────────────────────────────────────
export const QUICK_ACTIONS = [
  { label: "Analyze campaigns", prompt: "Analyze my current campaigns. What's working and what should I change?" },
  { label: "Demographics insights", prompt: "Based on the demographics, what's the best content strategy to convert free users to paid?" },
  { label: "Optimize schedules", prompt: "Review my campaign schedules and suggest better time windows based on the target regions." },
  { label: "Create strategy", prompt: "Create a full 3-campaign strategy to grow subscribers in LATAM and Asia Pacific. Give me the campaign configs." },
  { label: "Fix failing posts", prompt: "Why are my posts failing? What do you recommend to fix it?" },
  { label: "Improve prompts", prompt: "Review my campaign custom prompts and rewrite them for better X algorithm performance." },
  { label: "Add random video", prompt: "I want to add a random video from our media library to boost engagement. Suggest adding one and explain why video content performs better on X." },
  { label: "🔥 Lifetime100 campaign", prompt: "Create a Lifetime100 campaign that posts in this exact format: [EMOJI] [HOOK IN ALL CAPS] [EMOJI] / [body mentioning Lex, Santino, clouds, slams, live shows] / 👉 pnptv.app/lifetime100. Use the example: '🔥 $100 LIFETIME ACCESS to PNPtv IS HERE! 🔥 Raw Latino slams, clouds that never stop, and Lex + Santino taking you deep into the spun fire. One payment = forever pig paradise.' Give me the full campaign config." },
];
