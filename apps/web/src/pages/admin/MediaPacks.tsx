import React, { useState, useEffect } from "react";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { useI18n } from "@/lib/i18n";
import {
  getMediaPacks,
  getMediaPackItems,
  createMediaPack,
  toggleMediaPack,
  deleteMediaPack,
  deleteMediaPackItem,
  type MediaPack,
  type MediaPackItem,
} from "@/lib/api";

const PACK_TYPE_LABELS: Record<string, string> = { sticker: "Sticker", gif: "GIF", emoji: "Custom Emoji" };

export default function MediaPacks() {
  const t = useI18n().admin;
  const [packs, setPacks] = useState<MediaPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<MediaPack | null>(null);
  const [items, setItems] = useState<MediaPackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewPackForm, setShowNewPackForm] = useState(false);
  const [newPack, setNewPack] = useState({ slug: "", name: "", description: "", pack_type: "sticker", is_premium: false });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletePackTarget, setDeletePackTarget] = useState<MediaPack | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<MediaPackItem | null>(null);

  const loadPacks = async () => {
    setLoading(true);
    try {
      const d = await getMediaPacks();
      setPacks(d.packs || []);
    } catch { setPacks([]); }
    finally { setLoading(false); }
  };

  const loadItems = async (pack: MediaPack) => {
    try {
      const d = await getMediaPackItems(pack.slug);
      setItems(d.items || []);
    } catch { setItems([]); }
  };

  useEffect(() => { loadPacks(); }, []);

  const handleSelectPack = (pack: MediaPack) => { setSelectedPack(pack); loadItems(pack); };

  const handleToggle = async (packId: number, currentlyActive: boolean) => {
    try {
      await toggleMediaPack(packId, !currentlyActive);
      await loadPacks();
      if (selectedPack?.id === packId) setSelectedPack(p => p ? { ...p, is_active: !currentlyActive } : p);
    } catch (err) { console.error(err); }
  };

  const handleDeletePack = async () => {
    if (!deletePackTarget) return;
    try {
      await deleteMediaPack(deletePackTarget.id);
      setSelectedPack(null); setItems([]);
      await loadPacks();
    } catch (err) { console.error(err); }
    finally { setDeletePackTarget(null); }
  };

  const handleCreatePack = async () => {
    if (!newPack.slug.trim() || !newPack.name.trim()) { setCreateError("Slug and name are required"); return; }
    setCreating(true);
    setCreateError(null);
    try {
      await createMediaPack(newPack);
      setShowNewPackForm(false);
      setNewPack({ slug: "", name: "", description: "", pack_type: "sticker", is_premium: false });
      await loadPacks();
    } catch (err) { setCreateError(err instanceof Error ? err.message : "Error creating pack"); }
    finally { setCreating(false); }
  };

  const handleDeleteItem = async () => {
    if (!deleteItemTarget) return;
    try {
      await deleteMediaPackItem(deleteItemTarget.id);
      if (selectedPack) await loadItems(selectedPack);
    } catch { console.error("Item delete failed"); }
    finally { setDeleteItemTarget(null); }
  };

  return (
    <div className="page-container space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.mediaPacks.title}</h1>
          <p className="text-pnp-textSecondary text-sm mt-1">{t.mediaPacks.subtitle}</p>
        </div>
        <button
          onClick={() => setShowNewPackForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-pnp-accent hover:bg-pnp-accent/80 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {t.mediaPacks.newPack}
        </button>
      </div>

      {showNewPackForm && (
        <div className="bg-pnp-surface border border-pnp-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-pnp-textSecondary mb-3">{t.mediaPacks.createNewPack}</h3>
          {createError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {createError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              placeholder="slug (e.g. pnptv-launch)"
              value={newPack.slug}
              onChange={e => setNewPack(p => ({ ...p, slug: e.target.value.replace(/\s+/g, "-").toLowerCase() }))}
              className="bg-pnp-background border border-pnp-border rounded-lg px-3 py-2 text-sm text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
            />
            <input
              placeholder="Display name"
              value={newPack.name}
              onChange={e => setNewPack(p => ({ ...p, name: e.target.value }))}
              className="bg-pnp-background border border-pnp-border rounded-lg px-3 py-2 text-sm text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
            />
            <select
              value={newPack.pack_type}
              onChange={e => setNewPack(p => ({ ...p, pack_type: e.target.value }))}
              className="bg-pnp-background border border-pnp-border rounded-lg px-3 py-2 text-sm text-pnp-textPrimary focus:outline-none focus:border-pnp-accent"
            >
              <option value="sticker">{t.mediaPacks.stickerPack}</option>
              <option value="gif">{t.mediaPacks.gifPack}</option>
              <option value="emoji">{t.mediaPacks.emojiPack}</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-pnp-textSecondary cursor-pointer">
              <input
                type="checkbox"
                checked={newPack.is_premium}
                onChange={e => setNewPack(p => ({ ...p, is_premium: e.target.checked }))}
                className="w-4 h-4 accent-pnp-accent"
              />
              {t.mediaPacks.premiumOnly}
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleCreatePack}
              disabled={creating}
              className="px-4 py-2 bg-pnp-accent hover:bg-pnp-accent/80 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {creating ? t.mediaPacks.creating : t.mediaPacks.createPack}
            </button>
            <button
              onClick={() => setShowNewPackForm(false)}
              className="px-4 py-2 bg-pnp-surface hover:bg-pnp-surface/80 border border-pnp-border text-pnp-textSecondary rounded-lg text-sm transition-colors"
            >
              {t.shared.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pack list */}
        <div className="lg:col-span-1 space-y-2">
          {loading && <div className="text-pnp-textSecondary text-sm py-4 text-center">{t.shared.loading}</div>}
          {!loading && packs.length === 0 && (
            <div className="text-pnp-textSecondary text-sm text-center py-10 border border-pnp-border rounded-xl">
              {t.mediaPacks.noPacks}
            </div>
          )}
          {packs.map(pack => (
            <div
              key={pack.id}
              onClick={() => handleSelectPack(pack)}
              className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                selectedPack?.id === pack.id
                  ? "bg-pnp-accent/10 border-pnp-accent/50"
                  : "bg-pnp-surface border-pnp-border hover:border-pnp-textSecondary"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-pnp-textPrimary truncate">{pack.name}</div>
                  <div className="text-xs text-pnp-textSecondary mt-0.5">{PACK_TYPE_LABELS[pack.pack_type]} · {pack.item_count} items</div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {pack.is_premium && <span className="text-xs bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded">{t.mediaPacks.pro}</span>}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${pack.is_active ? "bg-green-900/40 text-green-400" : "bg-pnp-surface text-pnp-textSecondary"}`}>
                    {pack.is_active ? t.shared.active : t.mediaPacks.off}
                  </span>
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={e => { e.stopPropagation(); handleToggle(pack.id, pack.is_active); }}
                  className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                >
                  {pack.is_active ? t.mediaPacks.disable : t.mediaPacks.enable}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setDeletePackTarget(pack); }}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  {t.shared.delete}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Items */}
        <div className="lg:col-span-2">
          {!selectedPack ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-pnp-textSecondary border border-pnp-border rounded-xl">
              <span className="text-sm">{t.mediaPacks.selectPack}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-pnp-textPrimary">{selectedPack.name}</h2>
                <span className="text-sm text-pnp-textSecondary">{items.length} items</span>
              </div>
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-pnp-textSecondary text-sm border border-pnp-border rounded-xl gap-1">
                  <span>{t.mediaPacks.noItems}</span>
                  <code className="text-xs text-pnp-textSecondary mt-1 bg-pnp-surface px-2 py-0.5 rounded">
                    POST /api/webapp/admin/media-packs/{selectedPack.id}/items
                  </code>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {items.map(item => (
                    <div key={item.id} className="relative group">
                      <div className="aspect-square rounded-lg overflow-hidden bg-pnp-surface border border-pnp-border">
                        <img
                          src={item.thumbnail_url || item.file_url}
                          alt={item.alt_text || item.name}
                          className="w-full h-full object-contain p-1"
                        />
                      </div>
                      <div className="text-xs text-pnp-textSecondary truncate mt-0.5 text-center">{item.name}</div>
                      <div className="text-xs text-pnp-textSecondary/60 text-center">{item.use_count} uses</div>
                      <button
                        onClick={() => setDeleteItemTarget(item)}
                        className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-red-500 hover:bg-red-400 text-white text-xs"
                        aria-label={t.mediaPacks.deleteItem}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={!!deletePackTarget}
        title={t.mediaPacks.deletePack}
        message={`Delete "${deletePackTarget?.name}" and all its items? This cannot be undone.`}
        confirmLabel={t.mediaPacks.deletePack}
        variant="danger"
        onConfirm={handleDeletePack}
        onCancel={() => setDeletePackTarget(null)}
      />

      <ConfirmModal
        open={!!deleteItemTarget}
        title={t.mediaPacks.deleteItemTitle}
        message={`Delete "${deleteItemTarget?.name}"? This cannot be undone.`}
        confirmLabel={t.shared.delete}
        variant="danger"
        onConfirm={handleDeleteItem}
        onCancel={() => setDeleteItemTarget(null)}
      />
    </div>
  );
}
