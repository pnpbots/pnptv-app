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
  chatWithGrokManager,
  resetGrokManagerChat,
  type XAutoCampaignStats,
  type XAutoCampaign,
  type XAutoCampaignPost,
  type XActiveAccount,
} from "@/lib/api";

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
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/(\{[\s\S]*?"action"\s*:\s*"(?:create_campaign|add_random_video)"[\s\S]*?\})/);
  if (!jsonMatch) return { cleanText: text, action: null };
  try {
    const raw = jsonMatch[1] || jsonMatch[0];
    const action = JSON.parse(raw) as GrokAction;
    if (action.action === "create_campaign" && action.name && action.topic) {
      const cleanText = text.replace(jsonMatch[0], "").trim();
      return { cleanText, action };
    }
    if (action.action === "add_random_video") {
      const cleanText = text.replace(jsonMatch[0], "").trim();
      return { cleanText, action };
    }
  } catch { /* ignore */ }
  return { cleanText: text, action: null };
}

function GrokActionCard({ action, accounts, onApply }: {
  action: GrokAction;
  accounts: XActiveAccount[];
  onApply: (action: GrokAction) => void;
}) {
  const defaultAccount = accounts.find((a) => a.handle.toLowerCase() === action.accountHandle?.toLowerCase()) || accounts[0];
  const [selectedHandle, setSelectedHandle] = React.useState(defaultAccount?.handle || "");

  return (
    <div className="mt-2 p-3 rounded-lg bg-pnp-accent/10 border border-pnp-accent/30">
      <p className="text-xs font-semibold text-pnp-accent mb-1">Campaign proposal</p>
      <p className="text-xs text-pnp-textPrimary mb-0.5"><strong>Name:</strong> {action.name}</p>
      <p className="text-xs text-pnp-textSecondary mb-0.5">{action.language} | every {action.intervalMinutes}min | UTC {action.activeHoursStart}–{action.activeHoursEnd}</p>
      <p className="text-xs text-pnp-textSecondary mb-0.5 line-clamp-2">{action.topic}</p>
      {action.attachVideos && (
        <p className="text-xs text-purple-400 mb-2">&#9654; Attach random video from CMS</p>
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
        ✓ Apply — Create Campaign
      </button>
      {accounts.length === 0 && (
        <p className="text-xs text-red-400 mt-1">Connect an X account first.</p>
      )}
    </div>
  );
}

function RandomVideoActionCard({ action, mediaFolderId, onSaved }: {
  action: GrokAction;
  mediaFolderId: string | null;
  onSaved?: () => void;
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
      <p className="text-xs font-semibold text-purple-400 mb-1">Random Video</p>
      {action.reason && (
        <p className="text-xs text-pnp-textSecondary mb-2">{action.reason}</p>
      )}
      {mediaUrl ? (
        <div className="mb-2">
          <video
            src={mediaUrl}
            controls
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
          {loading ? "Fetching..." : "Preview Random Video"}
        </button>
      )}
      {action.campaignId && mediaFolderId && !saved && (
        <button
          onClick={saveToCamera}
          disabled={saving}
          className="cursor-pointer mt-2 px-3 py-1.5 text-xs rounded-lg bg-pnp-accent text-white hover:bg-pnp-accent/80 active:scale-95 transition-all font-medium disabled:opacity-40 block"
        >
          {saving ? "Saving..." : "✓ Enable video on campaign"}
        </button>
      )}
      {saved && (
        <p className="text-xs text-green-400 mt-2">✓ Video enabled on campaign</p>
      )}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

const QUICK_ACTIONS = [
  { label: "Analyze campaigns", prompt: "Analyze my current campaigns. What's working and what should I change?" },
  { label: "Demographics insights", prompt: "Based on the demographics, what's the best content strategy to convert free users to paid?" },
  { label: "Optimize schedules", prompt: "Review my campaign schedules and suggest better time windows based on the target regions." },
  { label: "Create strategy", prompt: "Create a full 3-campaign strategy to grow subscribers in LATAM and Asia Pacific. Give me the campaign configs." },
  { label: "Fix failing posts", prompt: "Why are my posts failing? What do you recommend to fix it?" },
  { label: "Improve prompts", prompt: "Review my campaign custom prompts and rewrite them for better X algorithm performance." },
  { label: "Add random video", prompt: "I want to add a random video from our media library to boost engagement. Suggest adding one and explain why video content performs better on X." },
];

type CampaignStatus = "all" | "active" | "paused" | "completed";

const STATUS_TABS: { value: CampaignStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

const STATUS_BADGE: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
  active: "success",
  paused: "warning",
  completed: "default",
};

const GROK_MODES = [
  { value: "xPost", label: "X Post (3 options)" },
  { value: "broadcast", label: "Broadcast" },
  { value: "salesPost", label: "Sales Post" },
  { value: "sharePost", label: "Share Post" },
];

const LANGUAGES = [
  { value: "es", label: "Spanish" },
  { value: "en", label: "English" },
  { value: "bilingual", label: "Bilingual" },
];

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
  activeHoursStart: 8,
  activeHoursEnd: 23,
  maxPosts: "",
  attachVideos: false,
};

export default function XAutoCampaigns() {
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

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete" | "generate";
    id: string;
    label: string;
  } | null>(null);

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
      setError("Name, account, and topic are required");
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
        });
        setSuccess(`Campaign "${form.name}" updated`);
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
        });
        setSuccess("Campaign created (paused)");
      }
      setForm(defaultForm);
      setShowForm(false);
      setEditingCampaign(null);
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : editingCampaign ? "Failed to update campaign" : "Failed to create campaign");
    } finally {
      setFormLoading(false);
    }
  };

  const handlePauseResume = async (campaign: XAutoCampaign) => {
    try {
      if (campaign.status === "active") {
        await pauseAdminXCampaign(campaign.campaign_id);
        setSuccess(`"${campaign.name}" paused`);
      } else {
        await resumeAdminXCampaign(campaign.campaign_id);
        setSuccess(`"${campaign.name}" resumed`);
      }
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "delete") {
        await deleteAdminXCampaign(confirmAction.id);
        setSuccess("Campaign deleted");
      } else if (confirmAction.type === "generate") {
        await triggerAdminXCampaignGenerate(confirmAction.id);
        setSuccess("Post generated and queued");
      }
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
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
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        activeHoursStart: action.activeHoursStart ?? 14,
        activeHoursEnd: action.activeHoursEnd ?? 23,
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
      header: "Campaign",
      render: (row: XAutoCampaign) => (
        <div className="max-w-[180px]">
          <p className="text-sm font-medium truncate">
            {row.media_folder_id && <span title="Video attached" className="text-pnp-accent mr-1">&#9654;</span>}
            {row.name}
          </p>
          <p className="text-xs text-pnp-textSecondary">@{row.handle || "unknown"}</p>
        </div>
      ),
    },
    {
      key: "topic",
      header: "Topic",
      render: (row: XAutoCampaign) => (
        <span className="text-xs text-pnp-textSecondary truncate block max-w-[200px]" title={row.topic}>
          {row.topic.length > 60 ? row.topic.slice(0, 60) + "..." : row.topic}
        </span>
      ),
    },
    {
      key: "schedule",
      header: "Schedule",
      render: (row: XAutoCampaign) => (
        <span className="text-xs">
          Every {formatInterval(row.interval_minutes)}
          <br />
          <span className="text-pnp-textSecondary">{row.active_hours_start}:00\u2013{row.active_hours_end}:00 UTC</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: XAutoCampaign) => (
        <Badge variant={STATUS_BADGE[row.status] || "default"}>{row.status}</Badge>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      render: (row: XAutoCampaign) => (
        <span className="text-xs">
          {row.total_generated} gen / {row.total_posted} posted
          {row.max_posts ? ` / ${row.max_posts} max` : ""}
        </span>
      ),
    },
    {
      key: "next_run_at",
      header: "Next Run",
      render: (row: XAutoCampaign) =>
        row.status === "active" ? formatDate(row.next_run_at) : <span className="text-pnp-textSecondary">\u2014</span>,
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
              {row.status === "active" ? "Pause" : "Resume"}
            </button>
          )}
          <button
            onClick={() => handleEditClick(row)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() =>
              setConfirmAction({ type: "generate", id: row.campaign_id, label: `Generate a post now for "${row.name}"?` })
            }
            className="text-xs text-pnp-accent hover:text-pnp-accent/80 transition-colors"
          >
            Generate
          </button>
          <button
            onClick={() =>
              setConfirmAction({ type: "delete", id: row.campaign_id, label: `Delete campaign "${row.name}"? Post history will be preserved.` })
            }
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const historyColumns = [
    {
      key: "text",
      header: "Post Text",
      render: (row: XAutoCampaignPost) => (
        <p className="text-xs max-w-[300px] truncate" title={row.text}>{row.text}</p>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: XAutoCampaignPost) => {
        const badge: Record<string, "default" | "accent" | "success" | "warning" | "error"> = {
          scheduled: "warning", sending: "accent", sent: "success", failed: "error",
        };
        return <Badge variant={badge[row.status] || "default"}>{row.status}</Badge>;
      },
    },
    {
      key: "sent_at",
      header: "Sent",
      render: (row: XAutoCampaignPost) => formatDate(row.sent_at),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row: XAutoCampaignPost) => formatDate(row.created_at),
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-pnp-textPrimary mb-1">X Auto Campaigns</h1>
      <p className="text-sm text-pnp-textSecondary mb-6">
        Autonomous content generation with Grok AI, scheduled posting to X.
      </p>

      {/* Feedback */}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">{success}</div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active Campaigns" value={stats?.activeCampaigns ?? "\u2014"} variant={stats && stats.activeCampaigns > 0 ? "success" : "default"} />
        <StatCard label="Total Generated" value={stats?.totalGenerated ?? "\u2014"} />
        <StatCard label="Total Posted" value={stats?.totalPosted ?? "\u2014"} variant="success" />
        <StatCard
          label="Failed"
          value={stats?.totalFailed ?? "\u2014"}
          variant={stats && stats.totalFailed > 0 ? "danger" : "default"}
        />
      </div>

      {/* Create Campaign */}
      <div className="mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => { setShowForm((p) => !p); setEditingCampaign(null); setForm(defaultForm); }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 transition-colors"
          >
            {showForm ? "Cancel" : "New Campaign"}
          </button>
          <button
            onClick={async () => {
              try {
                const res = await startXOAuth();
                if (res.url) {
                  window.open(res.url, "_blank");
                  setSuccess("X authorization opened — complete it in the new tab, then refresh this page");
                }
              } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Failed to start X OAuth");
              }
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-surface border border-pnp-border text-pnp-textPrimary hover:border-pnp-accent/50 transition-colors"
          >
            + Add X Account
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="mt-3 p-4 rounded-xl bg-pnp-surface border border-pnp-border space-y-3">
            {editingCampaign && (
              <p className="text-xs font-semibold text-blue-400">Editing: {editingCampaign.name}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Campaign Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                  placeholder="Daily PNP Promo"
                  required
                />
              </div>
              {!editingCampaign && (
                <div>
                  <label className="text-xs text-pnp-textSecondary block mb-1">X Account</label>
                  <select
                    value={form.accountId}
                    onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                    required
                  >
                    <option value="">Select account...</option>
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
              <label className="text-xs text-pnp-textSecondary block mb-1">Topic / Prompt</label>
              <textarea
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none min-h-[80px]"
                placeholder="Promote PNP Latino TV lifetime membership, highlight community features..."
                required
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Grok Mode</label>
                <select
                  value={form.grokMode}
                  onChange={(e) => setForm((f) => ({ ...f, grokMode: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                >
                  {GROK_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Language</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Interval (min)</label>
                <input
                  type="number"
                  value={form.intervalMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, intervalMinutes: parseInt(e.target.value) || 240 }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                  min={15}
                />
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Max Posts</label>
                <input
                  type="number"
                  value={form.maxPosts}
                  onChange={(e) => setForm((f) => ({ ...f, maxPosts: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                  placeholder="Unlimited"
                  min={1}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Active Hours Start (UTC)</label>
                <input
                  type="number"
                  value={form.activeHoursStart}
                  onChange={(e) => setForm((f) => ({ ...f, activeHoursStart: parseInt(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                  min={0}
                  max={23}
                />
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Active Hours End (UTC)</label>
                <input
                  type="number"
                  value={form.activeHoursEnd}
                  onChange={(e) => setForm((f) => ({ ...f, activeHoursEnd: parseInt(e.target.value) || 23 }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none"
                  min={0}
                  max={23}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-pnp-textSecondary block mb-1">Custom Prompt (optional)</label>
              <textarea
                value={form.customPrompt}
                onChange={(e) => setForm((f) => ({ ...f, customPrompt: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none min-h-[60px]"
                placeholder="Additional instructions for Grok..."
              />
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
                <span className="text-sm text-pnp-textPrimary">Attach random video from CMS</span>
              </label>
              {form.attachVideos && mediaFolderCmsUrl && (
                <a
                  href={mediaFolderCmsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-pnp-accent hover:underline"
                >
                  Upload videos in CMS &rarr;
                </a>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={formLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
              >
                {formLoading ? (editingCampaign ? "Saving..." : "Creating...") : (editingCampaign ? "Save Changes" : "Create Campaign (Paused)")}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Campaigns Table */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">Campaigns</h2>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-none">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); setPage(1); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? "bg-pnp-accent text-white"
                  : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <DataTable
          columns={campaignColumns}
          data={campaigns}
          loading={loading}
          emptyMessage="No campaigns found"
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
              Post History: {selectedCampaign.name}
            </h2>
            <button
              onClick={() => setSelectedCampaign(null)}
              className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
            >
              Close
            </button>
          </div>

          <DataTable
            columns={historyColumns}
            data={historyPosts}
            loading={historyLoading}
            emptyMessage="No posts generated yet"
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
          title={confirmAction.type === "delete" ? "Delete Campaign" : "Generate Post Now"}
          message={confirmAction.label}
          confirmLabel={confirmAction.type === "delete" ? "Delete" : "Generate"}
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
            <span className="text-sm font-semibold text-pnp-textPrimary">Grok Strategy Manager</span>
            <span className="text-xs text-pnp-textSecondary">— AI social media strategist with live campaign data</span>
          </div>
          <span className="text-pnp-textSecondary text-xs">{grokOpen ? "▲ Collapse" : "▼ Open"}</span>
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
                      />
                    )}
                    {/* Action card — Grok proposed adding a random video */}
                    {msg.action && msg.action.action === "add_random_video" && (
                      <RandomVideoActionCard
                        action={msg.action}
                        mediaFolderId={mediaFolderId}
                        onSaved={() => { loadStats(); loadCampaigns(page, statusFilter); }}
                      />
                    )}
                  </div>
                </div>
              ))}
              {grokLoading && (
                <div className="flex justify-start">
                  <div className="bg-pnp-background border border-pnp-border rounded-xl rounded-bl-sm px-3 py-2">
                    <span className="text-pnp-textSecondary text-xs animate-pulse">Grok is thinking...</span>
                  </div>
                </div>
              )}
              <div ref={grokEndRef} />
            </div>

            {/* Quick actions */}
            <div className="px-4 py-2 flex gap-2 flex-wrap border-t border-pnp-border/50">
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => sendGrokMessage(qa.prompt)}
                  disabled={grokLoading}
                  className="text-xs px-2.5 py-1 rounded-full bg-pnp-background border border-pnp-border text-pnp-textSecondary hover:border-pnp-accent/50 hover:text-pnp-textPrimary transition-colors disabled:opacity-40"
                >
                  {qa.label}
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
                  placeholder="Ask Grok anything about your campaigns, strategy, demographics..."
                  className="flex-1 px-3 py-2 rounded-lg bg-pnp-background border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:border-pnp-accent focus:outline-none resize-none min-h-[38px] max-h-[120px]"
                  rows={1}
                  disabled={grokLoading}
                />
                <button
                  onClick={() => sendGrokMessage(grokInput)}
                  disabled={!grokInput.trim() || grokLoading}
                  className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-40 transition-colors flex-shrink-0"
                >
                  Send
                </button>
              </div>
              <div className="flex justify-end mt-1">
                <button
                  onClick={resetGrokChat}
                  className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                >
                  Clear conversation
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
