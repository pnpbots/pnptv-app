import React, { useState, useEffect, useCallback, useRef } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { StatCard } from "@/components/admin/StatCard";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminXCampaignStats,
  getAdminXCampaigns,
  createAdminXCampaign,
  pauseAdminXCampaign,
  resumeAdminXCampaign,
  deleteAdminXCampaign,
  triggerAdminXCampaignGenerate,
  getAdminXCampaignHistory,
  getAdminXCampaignMediaFolder,
  getRandomCampaignVideo,
  updateAdminXCampaign,
  startXOAuth,
  startXOAuth1,
  chatWithGrokManager,
  resetGrokManagerChat,
  previewAdminXCampaign,
  duplicateAdminXCampaign,
  deleteXAccountPosts,
  getXDeleteJobStatus,
  type XAutoCampaignStats,
  type XAutoCampaign,
  type XAutoCampaignPost,
  type XActiveAccount,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// ── Countdown Timer ────────────────────────────────────────────────────────────
function CountdownTimer({ targetDate }: { targetDate: string | null | undefined }) {
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

// ── Expandable Post Text ───────────────────────────────────────────────────────
function ExpandablePostText({ text }: { text: string }) {
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

// ── Grok Manager Types ─────────────────────────────────────────────────────────
interface GrokChatMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
  action?: GrokAction | null;
}

interface GrokAction {
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

function parseGrokAction(text: string): { cleanText: string; action: GrokAction | null } {
  // Try finding JSON in code blocks or as a bare object
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i) || text.match(/(\{[\s\S]*?"action"\s*:\s*"(?:create_campaign|add_random_video)"[\s\S]*?\})/);
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

function GrokActionCard({ action, accounts, onApply, t }: {
  action: GrokAction;
  accounts: XActiveAccount[];
  onApply: (action: GrokAction) => void;
  t: any;
}) {
  const defaultAccount = accounts.find((a) => a.handle.toLowerCase() === action.accountHandle?.toLowerCase()) || accounts[0];
  const [selectedHandle, setSelectedHandle] = React.useState(defaultAccount?.handle || "");

  return (
    <div className="mt-2 p-3 rounded-lg bg-pnp-accent/10 border border-pnp-accent/30">
      <p className="text-xs font-semibold text-pnp-accent mb-1">{t.admin.xCampaigns.grok.proposal}</p>
      <p className="text-xs text-pnp-textPrimary mb-0.5"><strong>{t.admin.xCampaigns.table.campaign}:</strong> {action.name}</p>
      <p className="text-xs text-pnp-textSecondary mb-0.5">{action.language} | every {action.intervalMinutes}min | UTC {String(Math.floor((action.activeHoursStart ?? 0) / 60)).padStart(2, "0")}:{String((action.activeHoursStart ?? 0) % 60).padStart(2, "0")}–{String(Math.floor((action.activeHoursEnd ?? 0) / 60)).padStart(2, "0")}:{String((action.activeHoursEnd ?? 0) % 60).padStart(2, "0")}</p>
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
            <option key={a.account_id} value={a.handle}>@{a.handle}</option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-pnp-textSecondary mb-2">Account: @{selectedHandle || action.accountHandle}</p>
      )}
      <button
        onClick={() => onApply({ ...action, accountHandle: selectedHandle || accounts[0]?.handle || action.accountHandle })}
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

function RandomVideoActionCard({ action, mediaFolderId, onSaved, t }: {
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
      setError(e instanceof Error ? e.message : t.admin.xCampaigns.feedback.failedVideoEnable);
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

// Quick action labels are resolved at render time via t.admin.xCampaigns.quickActions
const QUICK_ACTION_KEYS = [
  { key: "analyze", prompt: "Analyze my current campaigns. What's working and what should I change?" },
  { key: "demographics", prompt: "Based on the demographics, what's the best content strategy to convert free users to paid?" },
  { key: "optimize", prompt: "Review my campaign schedules and suggest better time windows based on the target regions." },
  { key: "strategy", prompt: "Create a full 3-campaign strategy to grow subscribers in LATAM and Asia Pacific. Give me the campaign configs." },
  { key: "fixFailing", prompt: "Why are my posts failing? What do you recommend to fix it?" },
  { key: "improvePrompts", prompt: "Review my campaign custom prompts and rewrite them for better X algorithm performance." },
  { key: "addVideo", prompt: "I want to add a random video from our media library to boost engagement. Suggest adding one and explain why video content performs better on X." },
  { key: "lifetime100", prompt: "Create a Lifetime100 campaign that posts in this exact format: [EMOJI] [HOOK IN ALL CAPS] [EMOJI] / [body mentioning Lex, Santino, clouds, slams, live shows] / 👉 pnptv.app/lifetime100. Use the example: '🔥 $100 LIFETIME ACCESS to PNPtv IS HERE! 🔥 Raw Latino slams, clouds that never stop, and Lex + Santino taking you deep into the spun fire. One payment = forever pig paradise.' Give me the full campaign config." },
];

const LIFETIME100_TEMPLATE = {
  name: "Lifetime100 Promo",
  topic: "Promote the $100 lifetime access deal at pnptv.app/lifetime100. Highlight Lex & Santino, clouds, slams, live shows, zoom calls, and forever access for one payment.",
  customPrompt: `MANDATORY FORMAT — follow this exact structure for every post:
[EMOJI] [HOOK IN ALL CAPS] [EMOJI]
[1-2 sentences: specific benefits — Lex, Santino, clouds, slams, live shows, zoom calls]
👉 pnptv.app/lifetime100 [optional emojis]

Example A: 🔥 $100 LIFETIME ACCESS to PNPtv IS HERE! 🔥 Raw Latino slams, clouds that never stop, and Lex + Santino taking you deep into the spun fire. One payment = forever pig paradise. Don't sleep on this! 👉 pnptv.app/lifetime100 💨🐷

Example B: 💎 PNPtv LIFETIME100 DROPPED! 💎 $100 unlocks forever access to Lex & Santino's world: live performances, slam sessions, pounding playlists and chemsex zoom calls. Best investment you'll ever make, pig. 👉 pnptv.app/lifetime100

Always include $100 and lifetime/forever. Hook must be ALL CAPS. CTA must use 👉 pnptv.app/lifetime100.`,
  grokMode: "xPost",
  language: "en",
  intervalMinutes: 240,
  activeHoursStart: 840,
  activeHoursEnd: 1380,
};

type CampaignStatus = "all" | "active" | "paused" | "completed";

const STATUS_TAB_KEYS: CampaignStatus[] = ["all", "active", "paused", "completed"];

const STATUS_BADGE: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  active: "success",
  paused: "warning",
  completed: "default",
};

const GROK_MODE_KEYS = ["xPost", "broadcast", "salesPost", "sharePost"] as const;

const PERSONA_KEYS = ["generic", "santino", "lex"] as const;

const PERSONA_EMOJI: Record<string, string> = {
  santino: "🔥",
  lex: "🐷",
  generic: "",
};

const LANGUAGE_KEYS = ["es", "en", "bilingual"] as const;

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return "\u2014";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const defaultForm = {
  name: "",
  accountId: "",
  topic: "",
  grokMode: "xPost",
  language: "es",
  customPrompt: "",
  intervalMinutes: 240,
  activeHoursStart: 480,
  activeHoursEnd: 1380,
  maxPosts: "",
  attachVideos: false,
  personaType: "generic" as "santino" | "lex" | "generic",
};

export default function XAutoCampaigns() {
  const t = useI18n();
  const [stats, setStats] = useState<XAutoCampaignStats | null>(null);
  const [accounts, setAccounts] = useState<XActiveAccount[]>([]);

  const [campaigns, setCampaigns] = useState<XAutoCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus>("all");

  const [showForm, setShowForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<XAutoCampaign | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [formLoading, setFormLoading] = useState(false);

  const [selectedCampaign, setSelectedCampaign] = useState<XAutoCampaign | null>(null);
  const [historyPosts, setHistoryPosts] = useState<XAutoCampaignPost[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [mediaFolderId, setMediaFolderId] = useState<string | null>(null);
  const [mediaFolderCmsUrl, setMediaFolderCmsUrl] = useState<string | null>(null);

  // Preview modal state
  const [previewTarget, setPreviewTarget] = useState<XAutoCampaign | null>(null);
  const [previewOptions, setPreviewOptions] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete" | "generate";
    id: string;
    label: string;
  } | null>(null);

  // OAuth app selector
  const [oauthApp, setOauthApp] = useState<"generic" | "santino" | "lex">("generic");

  // Delete posts modal state
  const [deletePostsModal, setDeletePostsModal] = useState<{ accountId: string; handle: string } | null>(null);
  const [deleteTimeRange, setDeleteTimeRange] = useState<"24h" | "7d" | "all">("all");
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [deleteJobProgress, setDeleteJobProgress] = useState<{ status: string; total: number; deleted: number; failed: number; errors: string[]; rateLimited?: boolean; retryAfter?: number } | null>(null);
  const [deletePostsLoading, setDeletePostsLoading] = useState(false);

  // Grok Manager chat state
  const [grokOpen, setGrokOpen] = useState(false);
  const [grokMessages, setGrokMessages] = useState<GrokChatMessage[]>([]);
  const [grokInput, setGrokInput] = useState("");
  const [grokLoading, setGrokLoading] = useState(false);
  const grokEndRef = useRef<HTMLDivElement>(null);
  const grokInputRef = useRef<HTMLTextAreaElement>(null);

  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Data loading
  const loadStats = useCallback(async () => {
    try {
      const res = await getAdminXCampaignStats();
      setStats(res.stats);
      setAccounts(res.accounts);
      if (res.mediaFolderId) setMediaFolderId(res.mediaFolderId);
    } catch { /* ignore */ }
  }, []);

  const loadCampaigns = useCallback(async (p = 1, status?: CampaignStatus) => {
    setLoading(true);
    try {
      const statusParam = status && status !== "all" ? status : undefined;
      const res = await getAdminXCampaigns(p, statusParam);
      setCampaigns(res.campaigns);
      setTotalPages(res.pagination.totalPages);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (campaignId: string, p = 1) => {
    setHistoryLoading(true);
    try {
      const res = await getAdminXCampaignHistory(campaignId, p);
      setHistoryPosts(res.posts);
      setHistoryTotalPages(res.pagination.totalPages);
    } catch {
      setHistoryPosts([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadStats();
    loadCampaigns(1);
  }, [loadStats, loadCampaigns]);

  // Handle OAuth1 callback URL params (oauth1=success|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth1Status = params.get("oauth1");
    if (oauth1Status === "success") {
      setSuccess("X account connected via OAuth 1.0a (permanent tokens)!");
      loadStats();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauth1Status === "error") {
      const msg = params.get("msg");
      setError(`OAuth 1.0a connection failed: ${msg || "unknown error"}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poll every 15s while active campaigns exist
  useEffect(() => {
    const hasActive = stats?.activeCampaigns && stats.activeCampaigns > 0;
    if (hasActive) {
      pollRef.current = setInterval(() => {
        loadStats();
        loadCampaigns(page, statusFilter);
      }, 15000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [stats?.activeCampaigns, loadStats, loadCampaigns, page, statusFilter]);

  // Reload on filter/page change
  useEffect(() => { loadCampaigns(page, statusFilter); }, [page, statusFilter, loadCampaigns]);

  // Clear feedback
  useEffect(() => {
    if (success || error) {
      const t = setTimeout(() => { setSuccess(null); setError(null); }, 4000);
      return () => clearTimeout(t);
    }
  }, [success, error]);

  // Handlers
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.accountId || !form.topic) {
      setError(t.admin.xCampaigns.feedback.nameAccountTopicRequired);
      return;
    }
    setFormLoading(true);
    try {
      if (editingCampaign) {
        await updateAdminXCampaign(editingCampaign.campaign_id, {
          name: form.name,
          topic: form.topic,
          grokMode: form.grokMode,
          language: form.language,
          customPrompt: form.customPrompt || null,
          intervalMinutes: form.intervalMinutes,
          activeHoursStart: form.activeHoursStart,
          activeHoursEnd: form.activeHoursEnd,
          maxPosts: form.maxPosts ? parseInt(form.maxPosts) : null,
          mediaFolderId: form.attachVideos && mediaFolderId ? mediaFolderId : null,
          personaType: form.personaType,
        });
        setSuccess(t.admin.xCampaigns.feedback.campaignUpdated.replace("{name}", form.name));
      } else {
        await createAdminXCampaign({
          name: form.name,
          accountId: form.accountId,
          topic: form.topic,
          grokMode: form.grokMode,
          language: form.language,
          customPrompt: form.customPrompt || undefined,
          intervalMinutes: form.intervalMinutes,
          activeHoursStart: form.activeHoursStart,
          activeHoursEnd: form.activeHoursEnd,
          maxPosts: form.maxPosts ? parseInt(form.maxPosts) : undefined,
          mediaFolderId: form.attachVideos && mediaFolderId ? mediaFolderId : undefined,
          personaType: form.personaType,
        });
        setSuccess(t.admin.xCampaigns.feedback.campaignCreated);
      }
      setForm(defaultForm);
      setShowForm(false);
      setEditingCampaign(null);
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : editingCampaign ? t.admin.xCampaigns.feedback.failedUpdate : t.admin.xCampaigns.feedback.failedCreate);
    } finally {
      setFormLoading(false);
    }
  };

  const handlePauseResume = async (campaign: XAutoCampaign) => {
    try {
      if (campaign.status === "active") {
        await pauseAdminXCampaign(campaign.campaign_id);
        setSuccess(t.admin.xCampaigns.feedback.paused.replace("{name}", campaign.name));
      } else {
        await resumeAdminXCampaign(campaign.campaign_id);
        setSuccess(t.admin.xCampaigns.feedback.resumed.replace("{name}", campaign.name));
      }
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.admin.xCampaigns.feedback.actionFailed);
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "delete") {
        await deleteAdminXCampaign(confirmAction.id);
        setSuccess(t.admin.xCampaigns.feedback.deleted);
      } else if (confirmAction.type === "generate") {
        await triggerAdminXCampaignGenerate(confirmAction.id);
        setSuccess(t.admin.xCampaigns.feedback.generated);
      }
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.admin.xCampaigns.feedback.actionFailed);
    } finally {
      setConfirmAction(null);
    }
  };

  const handleRowClick = (campaign: XAutoCampaign) => {
    setSelectedCampaign(campaign);
    setHistoryPage(1);
    loadHistory(campaign.campaign_id, 1);
  };

  const handleEditClick = (campaign: XAutoCampaign) => {
    setEditingCampaign(campaign);
    setForm({
      name: campaign.name,
      accountId: campaign.account_id,
      topic: campaign.topic,
      grokMode: campaign.grok_mode || "xPost",
      language: campaign.language || "es",
      customPrompt: campaign.custom_prompt || "",
      intervalMinutes: campaign.interval_minutes,
      activeHoursStart: campaign.active_hours_start,
      activeHoursEnd: campaign.active_hours_end,
      maxPosts: campaign.max_posts ? String(campaign.max_posts) : "",
      attachVideos: !!campaign.media_folder_id,
      personaType: (campaign.persona_type || "generic") as "santino" | "lex" | "generic",
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleClone = async (campaign: XAutoCampaign) => {
    try {
      await duplicateAdminXCampaign(campaign.campaign_id);
      setSuccess(t.admin.xCampaigns.feedback.cloned.replace("{name}", campaign.name));
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.admin.xCampaigns.feedback.failedClone);
    }
  };

  const handlePreview = async (campaign: XAutoCampaign) => {
    setPreviewTarget(campaign);
    setPreviewOptions([]);
    setPreviewLoading(true);
    try {
      const res = await previewAdminXCampaign(campaign.campaign_id);
      setPreviewOptions(res.options);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.admin.xCampaigns.feedback.failedPreview);
      setPreviewTarget(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Grok Manager handlers
  useEffect(() => {
    if (grokOpen && grokMessages.length === 0) {
      // Auto-welcome on first open
      setGrokMessages([{
        id: "welcome",
        role: "assistant",
        content: "Hey! I'm Grok, your X social media strategist. I have access to your campaigns, post performance, and user demographics in real time.\n\nWhat do you want to work on?",
      }]);
    }
  }, [grokOpen, grokMessages.length]);

  useEffect(() => {
    if (grokOpen) grokEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [grokMessages, grokOpen]);

  const sendGrokMessage = useCallback(async (msg: string) => {
    if (!msg.trim() || grokLoading) return;
    const userMsg: GrokChatMessage = { id: `u-${Date.now()}`, role: "user", content: msg };
    setGrokMessages((prev) => [...prev, userMsg]);
    setGrokInput("");
    setGrokLoading(true);
    try {
      const res = await chatWithGrokManager(msg);
      const { cleanText, action } = parseGrokAction(res.message);
      setGrokMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content: cleanText, action },
      ]);
    } catch (err) {
      setGrokMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: "Sorry, I couldn't connect to Grok right now. Try again in a moment." },
      ]);
    } finally {
      setGrokLoading(false);
    }
  }, [grokLoading]);

  const applyGrokCampaign = useCallback(async (action: GrokAction) => {
    // Find account by handle
    const account = accounts.find((a) => a.handle.toLowerCase() === action.accountHandle?.toLowerCase());
    if (!account) {
      setError(`Account @${action.accountHandle} not found. Connect it first.`);
      return;
    }
    try {
      await createAdminXCampaign({
        name: action.name || "Untitled Campaign",
        accountId: account.account_id,
        topic: action.topic || "general",
        grokMode: "xPost",
        language: action.language || "en",
        customPrompt: action.customPrompt,
        intervalMinutes: action.intervalMinutes || 480,
        activeHoursStart: action.activeHoursStart ?? 840,
        activeHoursEnd: action.activeHoursEnd ?? 1380,
        mediaFolderId: action.attachVideos && mediaFolderId ? mediaFolderId : undefined,
      });
      setSuccess(`Campaign "${action.name}" created (paused)`);
      loadStats();
      loadCampaigns(page, statusFilter);
      setGrokMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, role: "assistant", content: `✓ Campaign "${action.name}" created and added to your campaigns list (paused). Activate it when ready.` },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    }
  }, [accounts, loadStats, loadCampaigns, page, statusFilter]);

  const resetGrokChat = useCallback(async () => {
    await resetGrokManagerChat().catch(() => {});
    setGrokMessages([]);
  }, []);

  // Table columns
  const campaignColumns = [
    {
      key: "name",
      header: t.admin.xCampaigns.table.campaign,
      render: (row: XAutoCampaign) => (
        <div className="max-w-[180px]">
          <p className="text-sm font-medium truncate">
            {row.media_folder_id && <span title="Video" className="text-pnp-accent mr-1">&#9654;</span>}
            {PERSONA_EMOJI[row.persona_type || "generic"] && (
              <span title={`Persona: ${row.persona_type}`} className="mr-1">
                {PERSONA_EMOJI[row.persona_type || "generic"]}
              </span>
            )}
            {row.name}
          </p>
          <p className="text-xs text-pnp-textSecondary">@{row.handle || "unknown"}</p>
        </div>
      ),
    },
    {
      key: "topic",
      header: t.admin.xCampaigns.table.topic,
      render: (row: XAutoCampaign) => (
        <span className="text-xs text-pnp-textSecondary truncate block max-w-[200px]" title={row.topic}>
          {row.topic.length > 60 ? row.topic.slice(0, 60) + "..." : row.topic}
        </span>
      ),
    },
    {
      key: "schedule",
      header: t.admin.xCampaigns.table.schedule,
      render: (row: XAutoCampaign) => (
        <span className="text-xs">
          {t.admin.xCampaigns.misc.every} {formatInterval(row.interval_minutes)}
          <br />
          <span className="text-pnp-textSecondary">{String(Math.floor(row.active_hours_start / 60)).padStart(2, "0")}:{String(row.active_hours_start % 60).padStart(2, "0")}{"\u2013"}{String(Math.floor(row.active_hours_end / 60)).padStart(2, "0")}:{String(row.active_hours_end % 60).padStart(2, "0")} UTC</span>
        </span>
      ),
    },
    {
      key: "status",
      header: t.admin.xCampaigns.table.status,
      render: (row: XAutoCampaign) => (
        <div>
          <Badge variant={STATUS_BADGE[row.status] || "default"}>{row.status}</Badge>
          {row.status === "paused" && row.paused_reason && (
            <p className="text-xs text-yellow-400 mt-0.5" title={row.paused_reason}>
              {row.paused_reason.length > 30 ? row.paused_reason.slice(0, 28) + "…" : row.paused_reason}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "progress",
      header: t.admin.xCampaigns.table.progress,
      render: (row: XAutoCampaign) => (
        <span className="text-xs">
          {row.total_generated} {t.admin.xCampaigns.table.gen} / {row.total_posted} {t.admin.xCampaigns.table.posted}
          {row.total_failed > 0 ? ` / ${row.total_failed} ${t.admin.xCampaigns.misc.failed}` : ""}
          {row.max_posts ? ` / ${row.max_posts} ${t.admin.xCampaigns.table.max}` : ""}
        </span>
      ),
    },
    {
      key: "next_run_at",
      header: t.admin.xCampaigns.table.nextRun,
      render: (row: XAutoCampaign) =>
        row.status === "active" ? (
          <div>
            <CountdownTimer targetDate={row.next_run_at} />
            <p className="text-xs text-pnp-textSecondary mt-0.5">{formatDate(row.next_run_at)}</p>
          </div>
        ) : <span className="text-pnp-textSecondary">\u2014</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row: XAutoCampaign) => (
        <div className="flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {row.status !== "completed" && (
            <button
              onClick={() => handlePauseResume(row)}
              className={`text-xs transition-colors ${
                row.status === "active"
                  ? "text-yellow-400 hover:text-yellow-300"
                  : "text-green-400 hover:text-green-300"
              }`}
            >
              {row.status === "active" ? t.admin.xCampaigns.tableActions.pause : t.admin.xCampaigns.tableActions.resume}
            </button>
          )}
          <button
            onClick={() => handleEditClick(row)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {t.admin.xCampaigns.tableActions.edit}
          </button>
          <button
            onClick={() => handleClone(row)}
            className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            {t.admin.xCampaigns.tableActions.clone}
          </button>
          <button
            onClick={() => handlePreview(row)}
            className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {t.admin.xCampaigns.tableActions.preview}
          </button>
          <button
            onClick={() =>
              setConfirmAction({ type: "generate", id: row.campaign_id, label: t.admin.xCampaigns.confirm.generateMessage.replace("{name}", row.name) })
            }
            className="text-xs text-pnp-accent hover:text-pnp-accent/80 transition-colors"
          >
            {t.admin.xCampaigns.tableActions.generate}
          </button>
          <button
            onClick={() =>
              setConfirmAction({ type: "delete", id: row.campaign_id, label: t.admin.xCampaigns.confirm.deleteMessage.replace("{name}", row.name) })
            }
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            {t.admin.xCampaigns.tableActions.delete}
          </button>
        </div>
      ),
    },
  ];

  const historyColumns = [
    {
      key: "text",
      header: t.admin.xCampaigns.history.postText,
      render: (row: XAutoCampaignPost) => <ExpandablePostText text={row.text} />,
    },
    {
      key: "status",
      header: t.admin.xCampaigns.history.status,
      render: (row: XAutoCampaignPost) => {
        const badge: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
          scheduled: "warning", sending: "accent", sent: "success", failed: "error",
        };
        return <Badge variant={badge[row.status] || "default"}>{row.status}</Badge>;
      },
    },
    {
      key: "sent_at",
      header: t.admin.xCampaigns.history.sent,
      render: (row: XAutoCampaignPost) => formatDate(row.sent_at),
    },
    {
      key: "created_at",
      header: t.admin.xCampaigns.history.created,
      render: (row: XAutoCampaignPost) => formatDate(row.created_at),
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-pnp-textPrimary mb-1">{t.admin.xCampaigns.title}</h1>
      <p className="text-sm text-pnp-textSecondary mb-6">
        {t.admin.xCampaigns.subtitle}
      </p>

      {/* Feedback */}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">{success}</div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5 gap-3 mb-6">
        <StatCard label={t.admin.xCampaigns.stats.active} value={stats?.activeCampaigns ?? "\u2014"} variant={stats && stats.activeCampaigns > 0 ? "success" : "default"} />
        <StatCard label={t.admin.xCampaigns.stats.totalGenerated} value={stats?.totalGenerated ?? "\u2014"} />
        <StatCard label={t.admin.xCampaigns.stats.totalPosted} value={stats?.totalPosted ?? "\u2014"} variant="success" />
        <StatCard
          label={t.admin.xCampaigns.stats.failed}
          value={stats?.totalFailed ?? "\u2014"}
          variant={stats && stats.totalFailed > 0 ? "danger" : "default"}
        />
        <StatCard
          label={t.admin.xCampaigns.misc.successRate}
          value={stats && stats.totalGenerated > 0
            ? `${Math.round((stats.totalPosted / stats.totalGenerated) * 100)}%`
            : "\u2014"}
          variant={
            stats && stats.totalGenerated > 0
              ? stats.totalPosted / stats.totalGenerated >= 0.8 ? "success"
                : stats.totalPosted / stats.totalGenerated >= 0.5 ? "warning"
                : "danger"
              : "default"
          }
        />
      </div>

      {/* Create Campaign */}
      <div className="mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => { setShowForm((p) => !p); setEditingCampaign(null); setForm(defaultForm); }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 transition-colors"
          >
            {showForm ? t.admin.xCampaigns.actions.cancel : t.admin.xCampaigns.actions.new}
          </button>
          <button
            onClick={() => {
              setEditingCampaign(null);
              setForm((f) => ({ ...defaultForm, ...LIFETIME100_TEMPLATE }));
              setShowForm(true);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 transition-colors"
          >
            🔥 {t.admin.xCampaigns.actions.lifetime100}
          </button>
          <div className="flex items-center gap-1.5">
            <select
              value={oauthApp}
              onChange={(e) => setOauthApp(e.target.value as "generic" | "santino" | "lex")}
              className="px-2 py-2 rounded-lg text-sm bg-pnp-surface border border-pnp-border text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
            >
              <option value="generic">PNP Tv</option>
              <option value="santino">SXNTINX</option>
              <option value="lex">Lex</option>
            </select>
            <button
              onClick={async () => {
                try {
                  const res = await startXOAuth1(oauthApp);
                  if (res.url) {
                    window.location.href = res.url;
                  }
                } catch (err: unknown) {
                  setError(err instanceof Error ? err.message : t.admin.xCampaigns.feedback.failedOAuth);
                }
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-surface border border-pnp-border text-pnp-textPrimary hover:border-pnp-accent/50 transition-colors"
            >
              + {t.admin.xCampaigns.actions.addAccount}
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="mt-3 p-4 rounded-xl bg-pnp-surface border border-pnp-border space-y-3">
            {editingCampaign && (
              <p className="text-xs font-semibold text-blue-400">{t.admin.xCampaigns.actions.edit}: {editingCampaign.name}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.name}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                  placeholder="Daily PNP Promo"
                  required
                />
              </div>
              {!editingCampaign && (
                <div>
                  <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.account}</label>
                  <select
                    value={form.accountId}
                    onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                    required
                  >
                    <option value="">{t.admin.xCampaigns.misc.selectAccount}</option>
                    {accounts.map((a) => (
                      <option key={a.account_id} value={a.account_id}>
                        @{a.handle}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.topic}</label>
              <textarea
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none min-h-[80px]" style={{ fontSize: "16px" }}
                placeholder={t.admin.xCampaigns.form.topicPlaceholder}
                required
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.grokMode}</label>
                <select
                  value={form.grokMode}
                  onChange={(e) => setForm((f) => ({ ...f, grokMode: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                >
                  {GROK_MODE_KEYS.map((key) => (
                    <option key={key} value={key}>{(t.admin.xCampaigns.grokModes as Record<string, string>)[key]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.language}</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                >
                  {LANGUAGE_KEYS.map((key) => (
                    <option key={key} value={key}>{(t.admin.xCampaigns.languages as Record<string, string>)[key]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.personas.label}</label>
                <select
                  value={form.personaType}
                  onChange={(e) => setForm((f) => ({ ...f, personaType: e.target.value as "santino" | "lex" | "generic" }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                >
                  {PERSONA_KEYS.map((key) => (
                    <option key={key} value={key}>{PERSONA_EMOJI[key] ? `${PERSONA_EMOJI[key]} ` : ""}{(t.admin.xCampaigns.personas as Record<string, string>)[key]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.interval}</label>
                <input
                  type="number"
                  value={form.intervalMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, intervalMinutes: parseInt(e.target.value) || 240 }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                  min={15}
                />
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.maxPosts}</label>
                <input
                  type="number"
                  value={form.maxPosts}
                  onChange={(e) => setForm((f) => ({ ...f, maxPosts: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                  placeholder={t.admin.xCampaigns.form.maxPostsPlaceholder}
                  min={1}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.hoursStart}</label>
                <input
                  type="time"
                  value={`${String(Math.floor(form.activeHoursStart / 60)).padStart(2, "0")}:${String(form.activeHoursStart % 60).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    setForm((f) => ({ ...f, activeHoursStart: h * 60 + (m || 0) }));
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                />
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.hoursEnd}</label>
                <input
                  type="time"
                  value={`${String(Math.floor(form.activeHoursEnd / 60)).padStart(2, "0")}:${String(form.activeHoursEnd % 60).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    setForm((f) => ({ ...f, activeHoursEnd: h * 60 + (m || 0) }));
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary focus:border-pnp-accent focus:outline-none" style={{ fontSize: "16px" }}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-pnp-textSecondary block mb-1">{t.admin.xCampaigns.form.customPrompt}</label>
              <textarea
                value={form.customPrompt}
                onChange={(e) => setForm((f) => ({ ...f, customPrompt: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none min-h-[60px]" style={{ fontSize: "16px" }}
                placeholder={t.admin.xCampaigns.form.customPromptPlaceholder}
              />
              <div className="mt-2 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-300/90">
                <p className="font-semibold mb-1">🔥 {t.admin.xCampaigns.misc.lifetime100Format}</p>
                <p className="font-mono whitespace-pre-wrap leading-relaxed text-orange-200/70">{`[EMOJI] [HOOK IN ALL CAPS] [EMOJI]
[Benefits: Lex, Santino, clouds, slams, live shows]
👉 pnptv.app/lifetime100 [emojis]`}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.attachVideos}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setForm((f) => ({ ...f, attachVideos: checked }));
                    if (checked && !mediaFolderCmsUrl) {
                      try {
                        const res = await getAdminXCampaignMediaFolder();
                        setMediaFolderId(res.folderId);
                        setMediaFolderCmsUrl(res.cmsUrl);
                      } catch { /* ignore */ }
                    }
                  }}
                  className="w-4 h-4 rounded border-pnp-border bg-pnp-background text-pnp-accent focus:ring-pnp-accent"
                />
                <span className="text-sm text-pnp-textPrimary">{t.admin.xCampaigns.form.attachVideos}</span>
              </label>
              {form.attachVideos && mediaFolderCmsUrl && (
                <a
                  href={mediaFolderCmsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-pnp-accent hover:underline"
                >
                  {t.admin.xCampaigns.form.uploadInCms} &rarr;
                </a>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={formLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
              >
                {formLoading ? (editingCampaign ? t.common.saving : t.common.loading) : (editingCampaign ? t.admin.xCampaigns.actions.saveChanges : t.admin.xCampaigns.actions.createPaused)}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Campaigns Table */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">{t.admin.xCampaigns.table.campaigns}</h2>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-none">
          {STATUS_TAB_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setPage(1); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === key
                  ? "bg-pnp-accent text-white"
                  : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
              }`}
            >
              {t.admin.xCampaigns.statusTabs[key]}
            </button>
          ))}
        </div>

        <DataTable
          columns={campaignColumns}
          data={campaigns}
          loading={loading}
          emptyMessage={t.common.noResults}
          getRowId={(row) => row.campaign_id}
          onRowClick={handleRowClick}
        />

        {totalPages > 1 && (
          <div className="mt-3">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* History Drawer */}
      {selectedCampaign && (
        <div className="mb-6 p-4 rounded-xl bg-pnp-surface border border-pnp-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-pnp-textPrimary">
              {t.admin.xCampaigns.history.title}: {selectedCampaign.name}
            </h2>
            <button
              onClick={() => setSelectedCampaign(null)}
              className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
            >
              {t.common.close}
            </button>
          </div>

          <DataTable
            columns={historyColumns}
            data={historyPosts}
            loading={historyLoading}
            emptyMessage={t.admin.xCampaigns.history.empty}
            getRowId={(row) => row.post_id}
          />

          {historyTotalPages > 1 && (
            <div className="mt-3">
              <Pagination
                page={historyPage}
                totalPages={historyTotalPages}
                onPageChange={(p) => {
                  setHistoryPage(p);
                  loadHistory(selectedCampaign.campaign_id, p);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Confirm Modal */}
      {confirmAction && (
        <ConfirmModal
          open={true}
          title={confirmAction.type === "delete" ? t.admin.xCampaigns.confirm.deleteTitle : t.admin.xCampaigns.confirm.generateTitle}
          message={confirmAction.label}
          confirmLabel={confirmAction.type === "delete" ? t.admin.xCampaigns.tableActions.delete : t.admin.xCampaigns.tableActions.generate}
          variant={confirmAction.type === "delete" ? "danger" : "default"}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Grok Strategy Manager */}
      <div className="mt-6 rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden">
        {/* Header / toggle */}
        <button
          onClick={() => setGrokOpen((p) => !p)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">⚡</span>
            <span className="text-sm font-semibold text-pnp-textPrimary">{t.admin.xCampaigns.grok.title}</span>
            <span className="text-xs text-pnp-textSecondary">— {t.admin.xCampaigns.grok.subtitle}</span>
          </div>
          <span className="text-pnp-textSecondary text-xs">{grokOpen ? `▲ ${t.admin.xCampaigns.misc.collapse}` : `▼ ${t.admin.xCampaigns.misc.open}`}</span>
        </button>

        {grokOpen && (
          <div className="border-t border-pnp-border">
            {/* Messages */}
            <div className="h-[400px] overflow-y-auto p-4 space-y-3 flex flex-col">
              {grokMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] ${msg.role === "user" ? "order-1" : "order-0"}`}>
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs font-medium text-pnp-accent">Grok</span>
                      </div>
                    )}
                    <div className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                      msg.role === "user"
                        ? "bg-pnp-accent text-white rounded-br-sm"
                        : "bg-pnp-background border border-pnp-border text-pnp-textPrimary rounded-bl-sm"
                    }`}>
                      {msg.content}
                    </div>
                    {/* Action card — Grok proposed a campaign */}
                    {msg.action && msg.action.action === "create_campaign" && (
                      <GrokActionCard
                        action={msg.action}
                        accounts={accounts}
                        onApply={applyGrokCampaign}
                        t={t}
                      />
                    )}
                    {/* Action card — Grok proposed adding a random video */}
                    {msg.action && msg.action.action === "add_random_video" && (
                      <RandomVideoActionCard
                        action={msg.action}
                        mediaFolderId={mediaFolderId}
                        onSaved={() => { loadStats(); loadCampaigns(page, statusFilter); }}
                        t={t}
                      />
                    )}
                  </div>
                </div>
              ))}
              {grokLoading && (
                <div className="flex justify-start">
                  <div className="bg-pnp-background border border-pnp-border rounded-xl rounded-bl-sm px-3 py-2">
                    <span className="text-pnp-textSecondary text-xs animate-pulse">{t.admin.xCampaigns.grok.thinking}</span>
                  </div>
                </div>
              )}
              <div ref={grokEndRef} />
            </div>

            {/* Quick actions */}
            <div className="px-4 py-2 flex gap-2 flex-wrap border-t border-pnp-border/50">
              {QUICK_ACTION_KEYS.map((qa) => (
                <button
                  key={qa.key}
                  onClick={() => sendGrokMessage(qa.prompt)}
                  disabled={grokLoading}
                  className="text-xs px-2.5 py-1 rounded-full bg-pnp-background border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50 hover:text-pnp-textPrimary transition-colors disabled:opacity-40"
                >
                  {qa.key === "lifetime100" ? "🔥 " : ""}{(t.admin.xCampaigns.quickActions as Record<string, string>)[qa.key] || qa.key}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="px-4 pb-4 pt-2 border-t border-pnp-border/50">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={grokInputRef}
                  value={grokInput}
                  onChange={(e) => setGrokInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendGrokMessage(grokInput);
                    }
                  }}
                  placeholder={t.admin.xCampaigns.grok.placeholder}
                  className="flex-1 px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none resize-none min-h-[38px] max-h-[120px]" style={{ fontSize: "16px" }}
                  rows={1}
                  disabled={grokLoading}
                />
                <button
                  onClick={() => sendGrokMessage(grokInput)}
                  disabled={!grokInput.trim() || grokLoading}
                  className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-40 transition-colors flex-shrink-0"
                >
                  {t.admin.xCampaigns.grok.send}
                </button>
              </div>
              <div className="flex justify-end mt-1">
                <button
                  onClick={resetGrokChat}
                  className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                >
                  {t.admin.xCampaigns.grok.clear}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-pnp-surface border border-pnp-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-pnp-border">
              <div>
                <h3 className="text-sm font-semibold text-pnp-textPrimary">{t.admin.xCampaigns.preview.title}</h3>
                <p className="text-xs text-pnp-textSecondary">{previewTarget.name}</p>
              </div>
              <button
                onClick={() => setPreviewTarget(null)}
                className="text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-pnp-textSecondary text-sm">
                  <div className="w-4 h-4 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                  {t.admin.xCampaigns.preview.generating}
                </div>
              ) : previewOptions.length > 0 ? (
                <div className="space-y-3">
                  {previewOptions.map((option, i) => (
                    <div key={i} className="p-3 rounded-lg bg-pnp-background border border-pnp-border">
                      <p className="text-xs font-semibold text-pnp-accent mb-1">
                        {previewOptions.length > 1 ? `${t.admin.xCampaigns.preview.option} ${String.fromCharCode(65 + i)}` : t.admin.xCampaigns.preview.generatedPost}
                      </p>
                      <p className="text-sm text-pnp-textPrimary whitespace-pre-wrap">{option}</p>
                      <p className="text-xs text-pnp-textSecondary mt-1">{option.length} {t.admin.xCampaigns.preview.chars}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pnp-textSecondary">{t.admin.xCampaigns.preview.noOptions}</p>
              )}
            </div>
            <div className="p-4 border-t border-pnp-border flex justify-end">
              <button
                onClick={() => setPreviewTarget(null)}
                className="px-4 py-2 rounded-lg text-sm bg-pnp-background border border-pnp-border text-pnp-textPrimary hover:border-pnp-accent/50 transition-colors"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
