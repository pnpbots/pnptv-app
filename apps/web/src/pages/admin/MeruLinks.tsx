import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { Badge } from "@pnptv/ui-kit";
import {
  getMeruLinkStats,
  listMeruLinks,
  addMeruLinks,
  deleteMeruLink,
  type MeruLink,
  type MeruLinkStat,
} from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "available" | "used";

interface FilterState {
  product: string;
  status: StatusFilter;
}

const EMPTY_FILTERS: FilterState = { product: "all", status: "all" };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncateUrl(url: string, max = 40): string {
  if (url.length <= max) return url;
  return url.slice(0, max) + "…";
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MeruLinks() {
  const t = useI18n().admin;
  const [stats, setStats] = useState<MeruLinkStat[]>([]);
  const [links, setLinks] = useState<MeruLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [addProduct, setAddProduct] = useState("");
  const [addRawUrls, setAddRawUrls] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<MeruLink | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  // ── Derived product list for filter dropdown ──────────────────────────────

  const knownProducts = useMemo(() => {
    const set = new Set(links.map((l) => l.product));
    return Array.from(set).sort();
  }, [links]);

  // ── Filtered links ────────────────────────────────────────────────────────

  const filteredLinks = useMemo(() => {
    let result = [...links];
    if (filters.product !== "all") {
      result = result.filter((l) => l.product === filters.product);
    }
    if (filters.status === "available") {
      result = result.filter((l) => !l.is_used);
    } else if (filters.status === "used") {
      result = result.filter((l) => l.is_used);
    }
    return result;
  }, [links, filters]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, linksRes] = await Promise.all([
        getMeruLinkStats(),
        listMeruLinks(),
      ]);
      setStats(statsRes.stats ?? []);
      setLinks(linksRes.links ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Meru links");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Copy URL ──────────────────────────────────────────────────────────────

  const handleCopy = useCallback((link: MeruLink) => {
    navigator.clipboard.writeText(link.url).then(() => {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => {
      // Fallback: select a temporary input
      const el = document.createElement("textarea");
      el.value = link.url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }, []);

  // ── Add links ─────────────────────────────────────────────────────────────

  const handleAdd = useCallback(async () => {
    setAddError(null);
    setAddSuccess(null);

    if (!addProduct.trim()) {
      setAddError("Select a product before adding links.");
      return;
    }

    const rawLines = addRawUrls
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      setAddError("Paste at least one URL.");
      return;
    }
    if (rawLines.length > 100) {
      setAddError("Maximum 100 links per batch. Split into multiple submissions.");
      return;
    }

    setAddLoading(true);
    try {
      const res = await addMeruLinks(addProduct.trim(), rawLines);
      setAddSuccess(`${res.added} link${res.added !== 1 ? "s" : ""} added successfully.`);
      setAddRawUrls("");
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add links");
    } finally {
      setAddLoading(false);
    }
  }, [addProduct, addRawUrls, load]);

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteMeruLink(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete link");
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, load]);

  // ── Table columns ─────────────────────────────────────────────────────────

  const columns = [
    {
      key: "product",
      header: "Product",
      render: (row: MeruLink) => (
        <span className="font-mono text-xs text-pnp-textPrimary">{row.product}</span>
      ),
    },
    {
      key: "url",
      header: "URL",
      render: (row: MeruLink) => (
        <button
          onClick={() => handleCopy(row)}
          title={row.url}
          className="group flex items-center gap-1.5 text-left"
        >
          <span className="font-mono text-xs text-pnp-accent group-hover:underline">
            {truncateUrl(row.url)}
          </span>
          {copiedId === row.id ? (
            <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-pnp-textSecondary opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: MeruLink) =>
        row.is_used ? (
          <Badge variant="error">Used</Badge>
        ) : (
          <Badge variant="success">Available</Badge>
        ),
    },
    {
      key: "used_by",
      header: "Used By",
      render: (row: MeruLink) => {
        if (!row.is_used) return <span className="text-pnp-textSecondary text-xs">—</span>;
        return (
          <div>
            {row.used_by_username && (
              <span className="text-xs text-pnp-textPrimary font-medium">@{row.used_by_username}</span>
            )}
            {row.used_by && (
              <span className="block font-mono text-[10px] text-pnp-textSecondary mt-0.5">{row.used_by}</span>
            )}
            {!row.used_by_username && !row.used_by && (
              <span className="text-pnp-textSecondary text-xs">—</span>
            )}
          </div>
        );
      },
    },
    {
      key: "used_at",
      header: "Used At",
      render: (row: MeruLink) => (
        <span className="text-xs text-pnp-textSecondary">{formatDate(row.used_at)}</span>
      ),
    },
    {
      key: "created_at",
      header: "Added",
      render: (row: MeruLink) => (
        <span className="text-xs text-pnp-textSecondary">{formatDate(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row: MeruLink) =>
        row.is_used ? null : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(row);
            }}
            className="text-xs text-red-400 hover:underline"
          >
            Delete
          </button>
        ),
    },
  ];

  // ── Stats totals ──────────────────────────────────────────────────────────

  const totals = useMemo(
    () =>
      stats.reduce(
        (acc, s) => ({
          total: acc.total + s.total,
          used: acc.used + s.used,
          available: acc.available + s.available,
        }),
        { total: 0, used: 0, available: 0 }
      ),
    [stats]
  );

  const hasActiveFilters = filters.product !== "all" || filters.status !== "all";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-container space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.meruLinks.title}</h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            {t.meruLinks.subtitle}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-2 rounded-lg border border-pnp-border text-xs text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/50 disabled:opacity-50 transition-colors"
        >
          {loading ? t.shared.loading : t.shared.refresh}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">{t.shared.dismiss}</button>
        </div>
      )}

      {/* ─── Stats row ────────────────────────────────────────────────────── */}
      {!loading && stats.length > 0 && (
        <div className="space-y-3">
          {/* All-products totals */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-3 text-center">
              <p className="text-2xl font-bold text-pnp-textPrimary">{totals.total}</p>
              <p className="text-xs text-pnp-textSecondary mt-0.5">{t.meruLinks.totalLinks}</p>
            </div>
            <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-3 text-center">
              <p className="text-2xl font-bold text-green-400">{totals.available}</p>
              <p className="text-xs text-pnp-textSecondary mt-0.5">{t.meruLinks.available}</p>
            </div>
            <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-3 text-center">
              <p className="text-2xl font-bold text-pnp-textSecondary">{totals.used}</p>
              <p className="text-xs text-pnp-textSecondary mt-0.5">{t.meruLinks.used}</p>
            </div>
          </div>

          {/* Per-product breakdown */}
          <div className="rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-pnp-border">
              <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">{t.meruLinks.byProduct}</p>
            </div>
            <div className="divide-y divide-pnp-border">
              {stats.map((s) => (
                <div key={s.product} className="flex items-center gap-4 px-4 py-3">
                  <span className="font-mono text-sm text-pnp-textPrimary flex-1">{s.product}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-pnp-textSecondary">
                      Total: <span className="font-semibold text-pnp-textPrimary">{s.total}</span>
                    </span>
                    <span className="text-green-400">
                      Available: <span className="font-semibold">{s.available}</span>
                    </span>
                    <span className="text-pnp-textSecondary">
                      Used: <span className="font-semibold">{s.used}</span>
                    </span>
                    <div className="w-20 h-1.5 rounded-full bg-pnp-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-pnp-accent"
                        style={{ width: s.total > 0 ? `${Math.round((s.used / s.total) * 100)}%` : "0%" }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Add links form ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface p-4 space-y-3">
        <p className="text-sm font-semibold text-pnp-textPrimary">{t.meruLinks.addNewLinks}</p>

        {addError && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {addError}
          </div>
        )}
        {addSuccess && (
          <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400">
            {addSuccess}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {/* Product selector */}
          <div className="flex flex-col gap-1 min-w-[200px]">
            <label className="text-xs text-pnp-textSecondary">{t.meruLinks.product}</label>
            <input
              type="text"
              list="meru-products-list"
              value={addProduct}
              onChange={(e) => setAddProduct(e.target.value)}
              placeholder={t.meruLinks.productPlaceholder}
              className="px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent transition-colors"
              style={{ fontSize: "16px" }}
            />
            <datalist id="meru-products-list">
              {knownProducts.map((p) => (
                <option key={p} value={p} />
              ))}
              <option value="lifetime100" />
            </datalist>
          </div>
        </div>

        {/* URL textarea */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-pnp-textSecondary">
            {t.meruLinks.urlsLabel}
          </label>
          <textarea
            value={addRawUrls}
            onChange={(e) => setAddRawUrls(e.target.value)}
            placeholder={"https://pay.getmeru.com/AbCdEf\nhttps://pay.getmeru.com/GhIjKl"}
            rows={5}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm font-mono placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent transition-colors resize-y"
            style={{ fontSize: "14px" }}
          />
          <p className="text-[11px] text-pnp-textSecondary">
            {addRawUrls.split("\n").filter((l) => l.trim()).length} URL
            {addRawUrls.split("\n").filter((l) => l.trim()).length !== 1 ? "s" : ""} entered
          </p>
        </div>

        <button
          onClick={handleAdd}
          disabled={addLoading}
          className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accent/80 disabled:opacity-50 transition-colors"
        >
          {addLoading ? t.meruLinks.adding : t.meruLinks.addLinks}
        </button>
      </div>

      {/* ─── Filter bar ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Product filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-pnp-textSecondary whitespace-nowrap">{t.meruLinks.product}</label>
            <select
              value={filters.product}
              onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-xs focus:outline-none focus:border-pnp-accent transition-colors"
            >
              <option value="all">{t.shared.all}</option>
              {knownProducts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-pnp-textSecondary whitespace-nowrap">{t.shared.status}</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
              className="px-2 py-1.5 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-xs focus:outline-none focus:border-pnp-accent transition-colors"
            >
              <option value="all">{t.shared.all}</option>
              <option value="available">{t.meruLinks.available}</option>
              <option value="used">{t.meruLinks.used}</option>
            </select>
          </div>

          {/* Clear */}
          {hasActiveFilters && (
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-pnp-border text-xs text-pnp-textSecondary hover:text-pnp-textPrimary hover:border-pnp-accent/50 transition-colors whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              {t.shared.clearFilters}
            </button>
          )}

          {/* Count */}
          <span className="ml-auto text-xs text-pnp-textSecondary whitespace-nowrap">
            {loading ? (
              "Loading…"
            ) : hasActiveFilters ? (
              <>
                Showing{" "}
                <span className="font-semibold text-pnp-textPrimary">{filteredLinks.length}</span>
                {" "}of{" "}
                <span className="font-semibold text-pnp-textPrimary">{links.length}</span>
                {" "}links
              </>
            ) : (
              <>
                <span className="font-semibold text-pnp-textPrimary">{links.length}</span>
                {" "}link{links.length !== 1 ? "s" : ""}
              </>
            )}
          </span>
        </div>
      </div>

      {/* ─── Table ────────────────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={filteredLinks}
        loading={loading}
        emptyMessage={
          hasActiveFilters
            ? t.meruLinks.noLinksFilter
            : t.meruLinks.noLinksYet
        }
        getRowId={(row) => row.id}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        title={t.meruLinks.deleteMeruLink}
        message={`Delete the link for product "${deleteTarget?.product ?? ""}"?\n\n${deleteTarget?.url ?? ""}\n\nThis cannot be undone.`}
        confirmLabel={t.shared.delete}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}
