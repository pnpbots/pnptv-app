import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getAdminPosts,
  deleteAdminPost,
  getAdminBans,
  unbanUser,
  getAdminAuditLog,
  getAdminUsernameHistory,
  flagUsernameChange,
  getAdminWarnings,
  type AdminPost,
  type PlatformBan,
  type AuditLogEntry,
  type UsernameChange,
  type UserWarning,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return "—";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = "posts" | "bans" | "audit" | "usernames";

const TABS: { id: Tab; label: string }[] = [
  { id: "posts", label: "Posts" },
  { id: "bans", label: "Bans" },
  { id: "audit", label: "Audit Log" },
  { id: "usernames", label: "Username History" },
];

// ── Error banner ──────────────────────────────────────────────────────────────

function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center justify-between">
      <span>{error}</span>
      <button onClick={onDismiss} className="ml-2 text-red-400 hover:text-red-300">Dismiss</button>
    </div>
  );
}

// ── Posts Tab ─────────────────────────────────────────────────────────────────

function PostsTab() {
  const t = useI18n().admin;
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<AdminPost | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getAdminPosts(p);
      setPosts(res.posts);
      setTotalPages(res.pagination.totalPages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.contentMod.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteAdminPost(deleteTarget.id);
      setDeleteTarget(null);
      await load(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.shared.failedToLoad);
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const columns = [
    {
      key: "author",
      header: t.contentMod.author,
      render: (row: AdminPost) => (
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {(row.authorFirstName || row.authorUsername || "?")[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-pnp-textPrimary truncate">
              {row.authorFirstName || row.authorUsername}
            </div>
            {row.authorUsername && (
              <div className="text-xs text-pnp-textSecondary">@{row.authorUsername}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "content",
      header: t.contentMod.content,
      render: (row: AdminPost) => (
        <span className="text-sm text-pnp-textPrimary">{truncate(row.content ?? "", 80)}</span>
      ),
    },
    {
      key: "media",
      header: t.contentMod.media,
      render: (row: AdminPost) =>
        row.mediaUrl ? (
          <Badge variant="accent">{row.mediaType ?? "media"}</Badge>
        ) : (
          <span className="text-pnp-textSecondary text-xs">—</span>
        ),
    },
    {
      key: "likesCount",
      header: t.contentMod.likes,
      render: (row: AdminPost) => (
        <span className="text-pnp-textSecondary text-sm">{row.likesCount}</span>
      ),
    },
    {
      key: "repliesCount",
      header: t.contentMod.replies,
      render: (row: AdminPost) => (
        <span className="text-pnp-textSecondary text-sm">{row.repliesCount}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Date",
      render: (row: AdminPost) => (
        <span className="text-xs text-pnp-textSecondary">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: AdminPost) => (
        <button
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
          className="text-xs text-red-400 hover:underline"
        >
          {t.shared.delete}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      <DataTable
        columns={columns}
        data={posts}
        loading={loading}
        emptyMessage={t.contentMod.noPosts}
        getRowId={(row) => String(row.id)}
      />
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      <ConfirmModal
        open={!!deleteTarget}
        title={t.contentMod.deletePost}
        message={t.contentMod.deleteConfirm.replace("{0}", deleteTarget?.authorUsername ?? "unknown")}
        confirmLabel={t.contentMod.deletePost}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}

// ── Bans Tab ──────────────────────────────────────────────────────────────────

function BansTab() {
  const [bans, setBans] = useState<PlatformBan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  // Unban inline state: banId → reason input value
  const [unbanState, setUnbanState] = useState<Record<string, string>>({});
  const [unbanLoading, setUnbanLoading] = useState<string | null>(null);

  const fetched = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { status, limit: String(LIMIT), offset: String(offset) };
      if (search) params.search = search;
      const res = await getAdminBans(params);
      setBans(res.bans);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bans");
    } finally {
      setLoading(false);
    }
  }, [status, search, offset]);

  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      load();
    }
  }, []);

  // Reload when filters change (but not on first mount since we handle that above)
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    setOffset(0);
    load();
  }, [status, search]);

  useEffect(() => { load(); }, [offset]);

  const handleUnbanClick = (id: string) => {
    setUnbanState((prev) => ({ ...prev, [id]: prev[id] !== undefined ? prev[id] : "" }));
  };

  const handleUnbanCancel = (id: string) => {
    setUnbanState((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleUnbanSubmit = async (ban: PlatformBan) => {
    const reason = (unbanState[ban.id] || "").trim();
    if (!reason) return;
    setUnbanLoading(ban.id);
    try {
      await unbanUser(ban.id, reason);
      setUnbanState((prev) => { const next = { ...prev }; delete next[ban.id]; return next; });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unban user");
    } finally {
      setUnbanLoading(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const page = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-pnp-textPrimary focus:outline-none focus:border-pnp-pink"
        >
          <option value="all">All Bans</option>
          <option value="active">Active</option>
          <option value="inactive">Lifted</option>
        </select>
        <input
          type="text"
          placeholder="Search username or reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-pink"
        />
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg text-sm bg-pnp-pink text-white font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div style={{ background: "rgba(255,255,255,0.04)" }} className="border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-pnp-pink border-t-transparent rounded-full animate-spin" />
          </div>
        ) : bans.length === 0 ? (
          <div className="py-12 text-center text-pnp-textSecondary text-sm">No bans found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Banned By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {bans.map((ban) => (
                  <tr key={ban.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-pnp-textPrimary">
                        {ban.username || ban.email || "—"}
                      </div>
                      {ban.email && ban.username && (
                        <div className="text-xs text-pnp-textSecondary">{ban.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-pnp-textSecondary max-w-xs">
                      {truncate(ban.reason, 60)}
                    </td>
                    <td className="px-4 py-3 text-pnp-textSecondary">{ban.banned_by || "—"}</td>
                    <td className="px-4 py-3 text-pnp-textSecondary text-xs">{formatDate(ban.banned_at)}</td>
                    <td className="px-4 py-3">
                      {ban.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/5 text-pnp-textSecondary border border-white/10">
                          Lifted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {ban.is_active && (
                        <div className="space-y-1">
                          {unbanState[ban.id] !== undefined ? (
                            <div className="flex gap-2 items-center">
                              <input
                                type="text"
                                placeholder="Reason…"
                                value={unbanState[ban.id]}
                                onChange={(e) => setUnbanState((prev) => ({ ...prev, [ban.id]: e.target.value }))}
                                className="px-2 py-1 rounded text-xs bg-white/5 border border-white/10 text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-pink w-32"
                                autoFocus
                              />
                              <button
                                onClick={() => handleUnbanSubmit(ban)}
                                disabled={unbanLoading === ban.id || !(unbanState[ban.id] || "").trim()}
                                className="px-2 py-1 rounded text-xs bg-pnp-pink text-white disabled:opacity-50"
                              >
                                {unbanLoading === ban.id ? "…" : "Lift"}
                              </button>
                              <button
                                onClick={() => handleUnbanCancel(ban.id)}
                                className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleUnbanClick(ban.id)}
                              className="text-xs text-pnp-pink hover:underline"
                            >
                              Unban
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={(p) => setOffset((p - 1) * LIMIT)} />
    </div>
  );
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────

function AuditLogTab() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const LIMIT = 50;

  const fetched = useRef(false);

  const load = useCallback(async (off = offset) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(LIMIT), offset: String(off) };
      if (actionFilter) params.action = actionFilter;
      if (resourceTypeFilter) params.resource_type = resourceTypeFilter;
      const res = await getAdminAuditLog(params);
      if (off === 0) {
        setLogs(res.logs);
      } else {
        setLogs((prev) => [...prev, ...res.logs]);
      }
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, resourceTypeFilter, offset]);

  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      load(0);
    }
  }, []);

  const handleSearch = () => {
    setOffset(0);
    setLogs([]);
    load(0);
  };

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    load(newOffset);
  };

  const hasMore = logs.length < total;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Filter by action…"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="flex-1 min-w-40 px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-pink"
        />
        <select
          value={resourceTypeFilter}
          onChange={(e) => setResourceTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-pnp-textPrimary focus:outline-none focus:border-pnp-pink"
        >
          <option value="">All resource types</option>
          <option value="user">user</option>
          <option value="payment">payment</option>
          <option value="entitlement">entitlement</option>
          <option value="post">post</option>
          <option value="hangout">hangout</option>
          <option value="creator">creator</option>
          <option value="ban">ban</option>
        </select>
        <button
          onClick={handleSearch}
          className="px-4 py-2 rounded-lg text-sm bg-pnp-pink text-white font-medium"
        >
          Search
        </button>
      </div>

      {/* Table */}
      <div style={{ background: "rgba(255,255,255,0.04)" }} className="border border-white/10 rounded-xl overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="py-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-pnp-pink border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-pnp-textSecondary text-sm">No audit log entries found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Actor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Resource</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Resource ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td className="px-4 py-3 text-xs text-pnp-textSecondary whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-pnp-textPrimary">
                        {log.actor_username || "system"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-pnp-pink">{log.action}</span>
                      </td>
                      <td className="px-4 py-3 text-pnp-textSecondary text-xs">{log.resource_type}</td>
                      <td className="px-4 py-3 text-pnp-textSecondary text-xs font-mono">
                        {truncate(log.resource_id, 20)}
                      </td>
                    </tr>
                    {expandedId === log.id && (
                      <tr>
                        <td colSpan={5} className="px-4 py-3 bg-white/[0.02]">
                          <div className="space-y-3">
                            {log.ip_address && (
                              <div className="text-xs text-pnp-textSecondary">
                                <span className="font-semibold text-pnp-textPrimary">IP:</span> {log.ip_address}
                              </div>
                            )}
                            {log.old_value !== null && log.old_value !== undefined && (
                              <div>
                                <div className="text-xs font-semibold text-pnp-textSecondary mb-1">Old value:</div>
                                <pre className="text-xs text-pnp-textSecondary bg-black/30 rounded p-2 overflow-x-auto max-h-40">
                                  {JSON.stringify(log.old_value, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.new_value !== null && log.new_value !== undefined && (
                              <div>
                                <div className="text-xs font-semibold text-pnp-textSecondary mb-1">New value:</div>
                                <pre className="text-xs text-pnp-textSecondary bg-black/30 rounded p-2 overflow-x-auto max-h-40">
                                  {JSON.stringify(log.new_value, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.metadata !== null && log.metadata !== undefined && (
                              <div>
                                <div className="text-xs font-semibold text-pnp-textSecondary mb-1">Metadata:</div>
                                <pre className="text-xs text-pnp-textSecondary bg-black/30 rounded p-2 overflow-x-auto max-h-40">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-6 py-2 rounded-lg text-sm border border-white/10 text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-white/20 disabled:opacity-50 transition-colors"
          >
            {loading ? "Loading…" : `Load more (${total - logs.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Username History Tab ──────────────────────────────────────────────────────

function UsernameHistoryTab() {
  const [changes, setChanges] = useState<UsernameChange[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [flaggingId, setFlaggingId] = useState<number | null>(null);
  const LIMIT = 100;

  const fetched = useRef(false);

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(LIMIT), offset: String(off) };
      if (search) params.search = search;
      if (flaggedOnly) params.flagged = "true";
      const res = await getAdminUsernameHistory(params);
      setChanges(res.changes);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load username history");
    } finally {
      setLoading(false);
    }
  }, [search, flaggedOnly]);

  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      load(0);
    }
  }, []);

  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    setOffset(0);
    load(0);
  }, [search, flaggedOnly]);

  const handleFlag = async (change: UsernameChange) => {
    setFlaggingId(change.id);
    try {
      await flagUsernameChange(change.id, !change.flagged);
      setChanges((prev) =>
        prev.map((c) => c.id === change.id ? { ...c, flagged: !change.flagged } : c)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update flag");
    } finally {
      setFlaggingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const page = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search user ID, old or new username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-pink"
        />
        <label className="flex items-center gap-2 text-sm text-pnp-textSecondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
            className="accent-pnp-pink"
          />
          Flagged only
        </label>
        <button
          onClick={() => { setOffset(0); load(0); }}
          className="px-4 py-2 rounded-lg text-sm bg-pnp-pink text-white font-medium"
        >
          Search
        </button>
      </div>

      {/* Table */}
      <div style={{ background: "rgba(255,255,255,0.04)" }} className="border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-pnp-pink border-t-transparent rounded-full animate-spin" />
          </div>
        ) : changes.length === 0 ? (
          <div className="py-12 text-center text-pnp-textSecondary text-sm">No username changes found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Change</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">Flag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {changes.map((change) => (
                  <tr
                    key={change.id}
                    className={`hover:bg-white/[0.02] transition-colors ${change.flagged ? "border-l-2 border-red-500/60 bg-red-500/[0.03]" : ""}`}
                  >
                    <td className="px-4 py-3 text-xs text-pnp-textSecondary whitespace-nowrap">
                      {formatDateTime(change.changed_at)}
                    </td>
                    <td className="px-4 py-3">
                      {change.user_id ? (
                        <Link
                          to={`/admin/users/${change.user_id}`}
                          className="text-pnp-pink hover:underline text-xs font-mono"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {truncate(change.user_id, 12)}
                        </Link>
                      ) : (
                        <span className="text-pnp-textSecondary text-xs">—</span>
                      )}
                      {change.current_username && (
                        <div className="text-xs text-pnp-textSecondary">@{change.current_username}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-pnp-textSecondary">{change.old_username || "—"}</span>
                      <span className="text-pnp-textSecondary mx-2">→</span>
                      <span className="text-pnp-textPrimary font-medium">{change.new_username || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleFlag(change)}
                        disabled={flaggingId === change.id}
                        title={change.flagged ? "Unflag" : "Flag"}
                        className={`text-lg leading-none disabled:opacity-40 transition-colors ${change.flagged ? "text-red-400 hover:text-red-300" : "text-pnp-textSecondary hover:text-red-400"}`}
                      >
                        {flaggingId === change.id ? "…" : "⚑"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={(p) => { setOffset((p - 1) * LIMIT); load((p - 1) * LIMIT); }} />
    </div>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────────

export default function ContentModeration() {
  const t = useI18n().admin;
  const [activeTab, setActiveTab] = useState<Tab>("posts");

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.contentMod.title}</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">{t.contentMod.subtitle}</p>
      </div>

      {/* Tab pills */}
      <div className="flex gap-1 p-1 rounded-xl border border-white/10" style={{ background: "rgba(255,255,255,0.03)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-pnp-pink text-white"
                : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "posts" && <PostsTab />}
      {activeTab === "bans" && <BansTab />}
      {activeTab === "audit" && <AuditLogTab />}
      {activeTab === "usernames" && <UsernameHistoryTab />}
    </div>
  );
}
