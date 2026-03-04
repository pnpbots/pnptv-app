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
  type XAutoCampaignStats,
  type XAutoCampaign,
  type XAutoCampaignPost,
  type XActiveAccount,
} from "@/lib/api";

type CampaignStatus = "all" | "active" | "paused" | "completed";

const STATUS_TABS: { value: CampaignStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

const STATUS_BADGE: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
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
  const [form, setForm] = useState(defaultForm);
  const [formLoading, setFormLoading] = useState(false);

  const [selectedCampaign, setSelectedCampaign] = useState<XAutoCampaign | null>(null);
  const [historyPosts, setHistoryPosts] = useState<XAutoCampaignPost[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete" | "generate";
    id: string;
    label: string;
  } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Data loading
  const loadStats = useCallback(async () => {
    try {
      const res = await getAdminXCampaignStats();
      setStats(res.stats);
      setAccounts(res.accounts);
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
      });
      setSuccess("Campaign created (paused)");
      setForm(defaultForm);
      setShowForm(false);
      loadStats();
      loadCampaigns(page, statusFilter);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
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

  // Table columns
  const campaignColumns = [
    {
      key: "name",
      header: "Campaign",
      render: (row: XAutoCampaign) => (
        <div className="max-w-[180px]">
          <p className="text-sm font-medium truncate">{row.name}</p>
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
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
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
        const badge: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
          scheduled: "warning", sending: "accent", sent: "success", failed: "danger",
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
        <button
          onClick={() => setShowForm((p) => !p)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 transition-colors"
        >
          {showForm ? "Cancel" : "New Campaign"}
        </button>

        {showForm && (
          <form onSubmit={handleCreate} className="mt-3 p-4 rounded-xl bg-pnp-surface border border-pnp-border space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Campaign Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
                  placeholder="Daily PNP Promo"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">X Account</label>
                <select
                  value={form.accountId}
                  onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
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
            </div>

            <div>
              <label className="text-xs text-pnp-textSecondary block mb-1">Topic / Prompt</label>
              <textarea
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary min-h-[80px]"
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
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
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
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
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
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
                  min={15}
                />
              </div>
              <div>
                <label className="text-xs text-pnp-textSecondary block mb-1">Max Posts</label>
                <input
                  type="number"
                  value={form.maxPosts}
                  onChange={(e) => setForm((f) => ({ ...f, maxPosts: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
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
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
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
                  className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary"
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
                className="w-full px-3 py-2 rounded-lg bg-pnp-bg border border-pnp-border text-sm text-pnp-textPrimary min-h-[60px]"
                placeholder="Additional instructions for Grok..."
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={formLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
              >
                {formLoading ? "Creating..." : "Create Campaign (Paused)"}
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
    </div>
  );
}
