import React, { useEffect, useMemo, useState } from "react";
import {
  ChannelVideo,
  listAdminPrimeVideos,
  updateChannelVideo,
  generatePrimeVideoDescription,
  generatePrimeVideoTitle,
  suggestPrimeVideoTags,
  getChannelTagTaxonomy,
} from "@/lib/api";
import { UploadVideoButton } from "@/components/channels/UploadVideoButton";

function fmtDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  processing: "Processing",
  failed: "Failed",
  removed: "Removed",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  published: "bg-green-500/15 text-green-300 border-green-500/30",
  processing: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
  removed: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

interface DraftEdits {
  title: string;
  description: string;
  tags: string[];
  is_featured: boolean;
  status: string;
}

function buildDraft(item: ChannelVideo): DraftEdits {
  return {
    title:       item.title || "",
    description: item.description || "",
    tags:        Array.isArray(item.tags) ? [...item.tags] : [],
    is_featured: item.is_featured ?? false,
    status:      item.status || "draft",
  };
}

function arraysEqualSets(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

function diffPatch(orig: ChannelVideo, draft: DraftEdits) {
  const patch: Partial<DraftEdits> = {};
  if (draft.title !== (orig.title || "")) patch.title = draft.title;
  if (draft.description !== (orig.description || "")) patch.description = draft.description;
  const origTags = Array.isArray(orig.tags) ? orig.tags : [];
  if (!arraysEqualSets(draft.tags, origTags)) patch.tags = draft.tags;
  if (draft.is_featured !== (orig.is_featured ?? false)) patch.is_featured = draft.is_featured;
  if (draft.status !== orig.status) patch.status = draft.status;
  return patch;
}

export default function PrimeChannel() {
  const [items, setItems] = useState<ChannelVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, DraftEdits>>({});
  const [taxonomy, setTaxonomy] = useState<string[]>([]);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [genId, setGenId] = useState<number | null>(null);
  const [genTitleId, setGenTitleId] = useState<number | null>(null);
  const [genTagsId, setGenTagsId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [gridCols, setGridColsState] = useState<1 | 2>(() => {
    try {
      const saved = localStorage.getItem("pnptv:admin:primeGridCols");
      return saved === "1" ? 1 : 2;
    } catch {
      return 2;
    }
  });
  const setGridCols = (n: 1 | 2) => {
    setGridColsState(n);
    try { localStorage.setItem("pnptv:admin:primeGridCols", String(n)); } catch { /* ignore */ }
  };
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [videosRes, taxRes] = await Promise.all([
        listAdminPrimeVideos(1, 200),
        getChannelTagTaxonomy(5),
      ]);
      setItems(videosRes.items);
      const newDrafts: Record<number, DraftEdits> = {};
      for (const it of videosRes.items) newDrafts[it.id] = buildDraft(it);
      setDrafts(newDrafts);
      if (taxRes.tags) setTaxonomy(taxRes.tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load videos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function setField<K extends keyof DraftEdits>(id: number, key: K, value: DraftEdits[K]) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  async function save(item: ChannelVideo) {
    const draft = drafts[item.id];
    if (!draft) return;
    const patch = diffPatch(item, draft);
    if (!Object.keys(patch).length) {
      setToast({ kind: "ok", msg: "Nothing to save." });
      return;
    }
    setSavingId(item.id);
    try {
      const res = await updateChannelVideo(5, item.id, patch);
      const updated = res.video;
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, ...updated } : p)));
      setDrafts((prev) => ({ ...prev, [item.id]: buildDraft({ ...item, ...updated }) }));
      setToast({ kind: "ok", msg: `Saved "${updated.title}"` });
    } catch (err) {
      setToast({ kind: "err", msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSavingId(null);
    }
  }

  async function generateDescription(item: ChannelVideo) {
    setGenId(item.id);
    try {
      const hint = (hints[item.id] || "").trim().slice(0, 500);
      const res = await generatePrimeVideoDescription(item.id, hint ? { hint } : {});
      setField(item.id, "description", res.description);
      setToast({ kind: "ok", msg: "Description generated by Grok. Review then Save." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Grok failed";
      setToast({ kind: "err", msg });
    } finally {
      setGenId(null);
    }
  }

  async function generateTitle(item: ChannelVideo) {
    setGenTitleId(item.id);
    try {
      const hint = (hints[item.id] || "").trim().slice(0, 500);
      const res = await generatePrimeVideoTitle(item.id, hint ? { hint } : {});
      setField(item.id, "title", res.title);
      setToast({ kind: "ok", msg: `New title: "${res.title}". Review then Save.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Grok failed";
      setToast({ kind: "err", msg });
    } finally {
      setGenTitleId(null);
    }
  }

  async function suggestTags(item: ChannelVideo) {
    setGenTagsId(item.id);
    try {
      const hint = (hints[item.id] || "").trim().slice(0, 500);
      const res = await suggestPrimeVideoTags(item.id, hint ? { hint } : {});
      const merged = Array.from(new Set([...(drafts[item.id]?.tags || []), ...res.tags]));
      setField(item.id, "tags", merged);
      const note = res.fallback
        ? "Grok declined; used keyword fallback. Review then Save."
        : `Suggested ${res.tags.length} tag(s). Review then Save.`;
      setToast({ kind: "ok", msg: note });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Tag suggest failed";
      setToast({ kind: "err", msg });
    } finally {
      setGenTagsId(null);
    }
  }

  function toggleTag(item: ChannelVideo, tag: string) {
    const current = drafts[item.id]?.tags || [];
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    setField(item.id, "tags", next);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (filterStatus !== "all" && it.status !== filterStatus) return false;
      if (q && !((it.title || "").toLowerCase().includes(q) || (it.description || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, filterStatus, search]);

  const counts = useMemo(() => {
    const acc: Record<string, number> = { all: items.length, draft: 0, published: 0 };
    for (const it of items) {
      if (acc[it.status] !== undefined) acc[it.status]++;
      else acc[it.status] = (acc[it.status] || 0) + 1;
    }
    return acc;
  }, [items]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Prime Channel</h1>
          <p className="text-sm text-pnp-textSecondary">
            Edit titles, descriptions, tags, toggle featured, and generate copy with Grok.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UploadVideoButton
            channelId={5}
            channelName="PNPtv! PRIME"
            channelSlug="pnptv-prime"
            accessType="prime"
            pricePerMonth={null}
            creatorUsername="santino"
            onPublished={(video) => {
              setItems((prev) => [video, ...prev]);
              setDrafts((prev) => ({ ...prev, [video.id]: buildDraft(video) }));
              setToast({ kind: "ok", msg: `"${video.title}" published to PRIME channel.` });
            }}
          />
          <button
            onClick={load}
            className="px-3 py-2 text-sm rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary hover:bg-pnp-surfaceHover"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-pnp-surface border border-pnp-border p-1">
          {(["all", "published", "draft"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs rounded-md transition ${
                filterStatus === s
                  ? "bg-pnp-accent text-white"
                  : "text-pnp-textSecondary hover:text-pnp-textPrimary"
              }`}
            >
              {s === "all" ? "All" : STATUS_LABEL[s]} ({counts[s] ?? 0})
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search title or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-lg bg-pnp-surface border border-pnp-border text-pnp-textPrimary placeholder-pnp-textSecondary"
        />

        <div className="flex gap-1 rounded-lg bg-pnp-surface border border-pnp-border p-1" role="group" aria-label="Grid size">
          <button
            type="button"
            onClick={() => setGridCols(1)}
            title="1 video per row"
            aria-label="Show 1 video per row"
            aria-pressed={gridCols === 1}
            className={`px-2.5 py-1.5 rounded-md transition ${
              gridCols === 1 ? "bg-pnp-accent text-white" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="2" y="3" width="12" height="10" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setGridCols(2)}
            title="2 videos per row"
            aria-label="Show 2 videos per row"
            aria-pressed={gridCols === 2}
            className={`px-2.5 py-1.5 rounded-md transition ${
              gridCols === 2 ? "bg-pnp-accent text-white" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="2" y="3" width="5" height="10" rx="1" />
              <rect x="9" y="3" width="5" height="10" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl border text-sm ${
            toast.kind === "ok"
              ? "bg-green-500/15 border-green-500/40 text-green-200"
              : "bg-red-500/15 border-red-500/40 text-red-200"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Body */}
      {loading && (
        <div className="text-center py-12 text-pnp-textSecondary">Loading prime videos...</div>
      )}
      {error && (
        <div className="rounded-lg bg-red-500/15 border border-red-500/40 text-red-200 p-4">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-pnp-textSecondary">No videos match this filter.</div>
      )}

      <div className={`grid gap-4 ${gridCols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {filtered.map((item) => {
          const draft = drafts[item.id] || buildDraft(item);
          const dirty = Object.keys(diffPatch(item, draft)).length > 0;
          const isSaving = savingId === item.id;
          const isGenerating = genId === item.id;
          const isHovered = hoverId === item.id;
          const canEditStatus = ["published", "draft", "processing"].includes(item.status);
          return (
            <div
              key={item.id}
              className="bg-pnp-surface border border-pnp-border rounded-xl overflow-hidden flex flex-col"
            >
              <div
                className="relative bg-black aspect-video"
                onMouseEnter={() => setHoverId(item.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {isHovered && item.gif_url ? (
                  <img
                    src={item.gif_url}
                    alt={item.title}
                    className="w-full h-full object-contain"
                  />
                ) : item.thumbnail_url ? (
                  <img
                    src={item.thumbnail_url}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-pnp-textSecondary text-sm">
                    no thumbnail
                  </div>
                )}
                <span className={`absolute top-2 left-2 px-2 py-0.5 text-[10px] rounded-md border ${STATUS_COLORS[item.status] || "bg-gray-500/15 text-gray-300 border-gray-500/30"}`}>
                  {STATUS_LABEL[item.status] || item.status}
                </span>
                {item.duration_sec != null && (
                  <span className="absolute bottom-2 right-2 bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded">
                    {fmtDuration(item.duration_sec)}
                  </span>
                )}
                {item.is_featured && (
                  <span className="absolute top-2 right-2 bg-pnp-accent text-white text-[10px] px-2 py-0.5 rounded-md">
                    Featured
                  </span>
                )}
              </div>

              <div className="p-3 flex-1 flex flex-col gap-3">
                <label className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-pnp-textSecondary">Title</span>
                    <button
                      onClick={() => generateTitle(item)}
                      disabled={genTitleId === item.id}
                      className="px-2 py-0.5 text-[11px] rounded-md bg-purple-500/20 border border-purple-500/40 text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
                      title="Rewrite title with Grok using description, duration, tags + your context"
                    >
                      {genTitleId === item.id ? "Rewriting..." : "Grok"}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={draft.title}
                    maxLength={255}
                    onChange={(e) => setField(item.id, "title", e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 text-sm rounded-md bg-pnp-background border border-pnp-border text-pnp-textPrimary"
                  />
                </label>

                <label className="block">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-purple-300">Context for Grok (optional)</span>
                    <span className="text-[10px] text-pnp-textSecondary">
                      {(hints[item.id] || "").length}/500
                    </span>
                  </div>
                  <textarea
                    value={hints[item.id] || ""}
                    rows={2}
                    maxLength={500}
                    onChange={(e) =>
                      setHints((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    placeholder="Tell Grok about cast, location, kinks, mood, hashtags to include, anything that should shape the description..."
                    className="mt-1 w-full px-2 py-1.5 text-xs rounded-md bg-pnp-background border border-purple-500/30 text-pnp-textPrimary placeholder-pnp-textSecondary"
                  />
                </label>

                <label className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-pnp-textSecondary">Description</span>
                    <button
                      onClick={() => generateDescription(item)}
                      disabled={isGenerating}
                      className="px-2 py-0.5 text-[11px] rounded-md bg-purple-500/20 border border-purple-500/40 text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
                      title="Generate bilingual description with Grok using title, duration, tags + your context"
                    >
                      {isGenerating ? "Generating..." : "Grok"}
                    </button>
                  </div>
                  <textarea
                    value={draft.description}
                    rows={6}
                    onChange={(e) => setField(item.id, "description", e.target.value)}
                    placeholder="Enter description, or click Grok to generate one"
                    className="mt-1 w-full px-2 py-1.5 text-sm rounded-md bg-pnp-background border border-pnp-border text-pnp-textPrimary font-mono"
                  />
                </label>

                <div className="block">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-pnp-textSecondary">
                      Tags <span className="text-pnp-textSecondary/70">({draft.tags.length})</span>
                    </span>
                    <button
                      onClick={() => suggestTags(item)}
                      disabled={genTagsId === item.id}
                      className="px-2 py-0.5 text-[11px] rounded-md bg-purple-500/20 border border-purple-500/40 text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
                      title="Suggest tags from the catalog taxonomy with Grok"
                    >
                      {genTagsId === item.id ? "Picking..." : "Grok"}
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {taxonomy.map((tag) => {
                      const active = draft.tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleTag(item, tag)}
                          className={`px-2 py-0.5 text-[11px] rounded-full border transition ${
                            active
                              ? "bg-pnp-accent/20 border-pnp-accent text-pnp-accent"
                              : "bg-pnp-background border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <select
                    value={["published", "draft"].includes(draft.status) ? draft.status : draft.status}
                    onChange={(e) => setField(item.id, "status", e.target.value)}
                    disabled={!canEditStatus}
                    className="px-2 py-1.5 text-xs rounded-md bg-pnp-background border border-pnp-border text-pnp-textPrimary disabled:opacity-50"
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                    {item.status === "processing" && <option value="processing" disabled>Processing...</option>}
                    {item.status === "failed" && <option value="failed" disabled>Failed</option>}
                    {item.status === "removed" && <option value="removed" disabled>Removed</option>}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-pnp-textSecondary">
                    <input
                      type="checkbox"
                      checked={draft.is_featured}
                      onChange={(e) => setField(item.id, "is_featured", e.target.checked)}
                      className="rounded"
                    />
                    Featured
                  </label>
                  <div className="flex-1" />
                  <button
                    onClick={() => save(item)}
                    disabled={!dirty || isSaving}
                    className={`px-3 py-1.5 text-xs rounded-md font-medium ${
                      dirty
                        ? "bg-pnp-accent text-white hover:opacity-90"
                        : "bg-pnp-background text-pnp-textSecondary cursor-not-allowed"
                    } disabled:opacity-50`}
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] text-pnp-textSecondary border-t border-pnp-border pt-2">
                  {item.duration_sec != null && (
                    <span>{Math.floor(item.duration_sec / 60)}:{String(item.duration_sec % 60).padStart(2, "0")}</span>
                  )}
                  <span>· {new Date(item.created_at).toLocaleDateString()}</span>
                  {Array.isArray(item.tags) && item.tags.length > 0 && (
                    <span>· {item.tags.slice(0, 3).join(", ")}{item.tags.length > 3 ? "..." : ""}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
