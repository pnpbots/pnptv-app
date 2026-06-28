import React, { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import {
  getMyCallPackages,
  createMyCallPackage,
  updateMyCallPackage,
  deactivateMyCallPackage,
  type CallPackage,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function CallPackageManager() {
  const { creator: t } = useI18n();
  const [packages, setPackages] = useState<CallPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [duration, setDuration] = useState<30 | 60>(30);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Deactivate confirm
  const [deactivateTarget, setDeactivateTarget] = useState<CallPackage | null>(null);

  // Stable ref for t so loadPackages doesn't re-run on every i18n change
  const tRef = React.useRef(t);
  tRef.current = t;

  const loadPackages = useCallback(() => {
    setLoading(true);
    setError(null);
    getMyCallPackages()
      .then((res) => setPackages(res.packages))
      .catch((err) => setError(err.message || tRef.current.pkgLoadError))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0 || priceNum > 1000) {
      setCreateError(t.pkgPriceError);
      return;
    }
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      await createMyCallPackage({
        durationMinutes: duration,
        quantity,
        priceUsd: priceNum,
        title: title.trim() || undefined,
      });
      setPrice("");
      setTitle("");
      setQuantity(1);
      setDuration(30);
      setCreateSuccess(t.pkgCreateSuccess);
      setTimeout(() => setCreateSuccess(null), 4000);
      loadPackages();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.pkgCreateError;
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (pkg: CallPackage) => {
    setEditingId(pkg.id);
    setEditPrice(String(parseFloat(pkg.price_usd)));
    setEditTitle(pkg.title ?? "");
    setSaveError(null);
  };

  const handleSave = async (pkg: CallPackage) => {
    const priceNum = parseFloat(editPrice);
    if (isNaN(priceNum) || priceNum <= 0 || priceNum > 1000) {
      setSaveError(t.pkgPriceError);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      await updateMyCallPackage(pkg.id, {
        priceUsd: priceNum,
        title: editTitle.trim() || undefined,
      });
      setEditingId(null);
      setSaveSuccess(t.pkgSaveSuccess);
      setTimeout(() => setSaveSuccess(null), 4000);
      loadPackages();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.pkgSaveError;
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await deactivateMyCallPackage(deactivateTarget.id);
      setDeactivateTarget(null);
      loadPackages();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.pkgDeactivateError;
      setError(msg);
      setDeactivateTarget(null);
    }
  };

  return (
    <div className="space-y-4 mt-6">
      <p className="text-sm font-semibold text-white">{t.callPackagesTitle}</p>

      {/* Create form */}
      <div className="glass-card-sm p-4">
        <p className="text-xs font-semibold text-white/70 mb-3 uppercase tracking-wide">{t.newPackageTitle}</p>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.pkgDuration}</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as 30 | 60)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              >
                <option value={30}>{t.pkgMinutes30}</option>
                <option value={60}>{t.pkgMinutes60}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.pkgQuantity}</label>
              <input
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.pkgPriceUsd}</label>
              <input
                type="number"
                min={0.01}
                max={1000}
                step={0.01}
                placeholder={t.pkgPricePlaceholder}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.pkgTitleOptional}</label>
              <input
                type="text"
                maxLength={80}
                placeholder={t.pkgTitlePlaceholder}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          {createSuccess && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
              {createSuccess}
            </p>
          )}
          <button
            type="submit"
            disabled={creating}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {creating ? t.pkgCreating : t.pkgCreateBtn}
          </button>
        </form>
      </div>

      {/* Package list */}
      {saveSuccess && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(94,209,196,0.1)", color: "#5ED1C4" }}>
          {saveSuccess}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-white/40 text-center py-4">{t.pkgLoadingPackages}</p>
      ) : error ? (
        <p className="text-xs text-red-400 text-center py-4">{error}</p>
      ) : packages.length === 0 ? (
        <p className="text-xs text-white/40 text-center py-4">{t.pkgNoPackages}</p>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => (
            <div key={pkg.id} className="glass-card-sm p-4">
              {editingId === pkg.id ? (
                <div className="space-y-3">
                  <p className="text-xs text-white/50">
                    {pkg.duration_minutes} min · x{pkg.quantity}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.pkgPriceUsd}</label>
                      <input
                        type="number"
                        min={0.01}
                        max={1000}
                        step={0.01}
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/50 mb-1">{t.pkgTitleOptional}</label>
                      <input
                        type="text"
                        maxLength={80}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                      />
                    </div>
                  </div>
                  {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSave(pkg)}
                      disabled={saving}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      {saving ? t.pkgSaving : t.pkgSaveBtn}
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setSaveError(null); }}
                      className="flex-1 py-2 rounded-xl text-xs text-white/60 border border-white/10 hover:bg-white/5"
                    >
                      {t.cancelBtn}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {pkg.title && (
                      <p className="text-sm font-semibold text-white truncate">{pkg.title}</p>
                    )}
                    <p className="text-xs text-white/50 mt-0.5">
                      {pkg.duration_minutes} min · {t.pkgSessions(pkg.quantity)}
                    </p>
                    <p className="text-base font-bold mt-1" style={{ color: "#5ED1C4" }}>
                      ${parseFloat(pkg.price_usd).toFixed(2)}
                    </p>
                    <p className="text-xs text-white/30 mt-0.5 font-mono">{pkg.sku}</p>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(pkg)}
                      className="px-3 py-1.5 rounded-lg text-xs text-white/70 border border-white/10 hover:bg-white/5 transition-colors"
                    >
                      {t.pkgEditBtn}
                    </button>
                    <button
                      onClick={() => setDeactivateTarget(pkg)}
                      className="px-3 py-1.5 rounded-lg text-xs text-red-400 border border-red-400/20 hover:bg-red-400/10 transition-colors"
                    >
                      {t.pkgDeactivateBtn}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Deactivate confirm dialog */}
      <ConfirmDialog
        open={deactivateTarget !== null}
        title={t.pkgDeactivateConfirmTitle}
        message={deactivateTarget ? t.pkgDeactivateConfirmMsg(deactivateTarget.title || `${deactivateTarget.duration_minutes}min x${deactivateTarget.quantity}`) : ""}
        confirmLabel={t.pkgDeactivateBtn}
        cancelLabel={t.cancelBtn}
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateTarget(null)}
        variant="danger"
      />
    </div>
  );
}
