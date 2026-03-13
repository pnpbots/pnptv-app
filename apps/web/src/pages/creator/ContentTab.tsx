import React, { useState, useEffect } from "react";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import {
  getCmsProfile,
  updateCmsProfile,
  listCmsContent,
  createCmsContent,
  updateCmsContent,
  deleteCmsContent,
  listCmsShows,
  createCmsShow,
  updateCmsShow,
  deleteCmsShow,
  uploadCmsMedia,
  createSocialPost,
  type CmsPerformer,
  type CmsContent,
  type CmsShow,
} from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

interface ContentTabProps {
  t: CreatorStrings;
}

export function ContentTab({ t }: ContentTabProps) {
  // CMS data
  const [cmsPerformer, setCmsPerformer] = useState<CmsPerformer | null>(null);
  const [cmsContent, setCmsContent] = useState<CmsContent[]>([]);
  const [cmsShows, setCmsShows] = useState<CmsShow[]>([]);
  const [cmsLoading, setCmsLoading] = useState(true);
  const [cmsError, setCmsError] = useState<string | null>(null);
  const [cmsContentSection, setCmsContentSection] = useState<"profile" | "content" | "shows">("profile");

  // Profile edit
  const [cmsProfileForm, setCmsProfileForm] = useState<Partial<CmsPerformer>>({});
  const [cmsProfileSaving, setCmsProfileSaving] = useState(false);
  const [cmsProfileStatus, setCmsProfileStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Content form (create/edit)
  const [contentModal, setContentModal] = useState<{ mode: "create" | "edit"; item?: CmsContent } | null>(null);
  const [contentForm, setContentForm] = useState<Partial<CmsContent>>({});
  const [contentSaving, setContentSaving] = useState(false);
  const [contentUploadFile, setContentUploadFile] = useState<File | null>(null);
  const [contentUploadProgress, setContentUploadProgress] = useState(false);
  const [contentSaveError, setContentSaveError] = useState<string | null>(null);
  const [contentDeleteTarget, setContentDeleteTarget] = useState<number | null>(null);

  // Show form (create/edit)
  const [showModal, setShowModal] = useState<{ mode: "create" | "edit"; item?: CmsShow } | null>(null);
  const [showForm, setShowForm] = useState<Partial<CmsShow>>({});
  const [showSaving, setShowSaving] = useState(false);
  const [showSaveError, setShowSaveError] = useState<string | null>(null);
  const [showDeleteTarget, setShowDeleteTarget] = useState<number | null>(null);

  // Share to Feed modal
  const [shareModal, setShareModal] = useState<{ text: string } | null>(null);
  const [sharePosting, setSharePosting] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Load CMS data
  useEffect(() => {
    setCmsLoading(true);
    setCmsError(null);
    Promise.all([getCmsProfile(), listCmsContent(), listCmsShows()])
      .then(([prof, cont, shows]) => {
        setCmsPerformer(prof.performer);
        setCmsProfileForm({
          name: prof.performer.name,
          bio: prof.performer.bio ?? "",
          bio_short: prof.performer.bio_short ?? "",
          categories: prof.performer.categories ?? [],
          is_available: prof.performer.is_available,
          availability_message: prof.performer.availability_message ?? "",
          base_price_cents: prof.performer.base_price_cents ?? null,
          currency: prof.performer.currency ?? "USD",
          timezone: prof.performer.timezone ?? "",
          social_links: prof.performer.social_links ?? {},
        });
        setCmsContent(cont.content);
        setCmsShows(shows.shows);
      })
      .catch((err) => setCmsError(err.message || t.errorFailedLoadCms))
      .finally(() => setCmsLoading(false));
  }, [t.errorFailedLoadCms]);

  // ── Profile handlers ──
  const handleCmsProfileSave = async () => {
    setCmsProfileSaving(true);
    setCmsProfileStatus(null);
    try {
      const res = await updateCmsProfile(cmsProfileForm);
      setCmsPerformer(res.performer);
      setCmsProfileStatus({ ok: true, msg: t.profileUpdated });
    } catch (err) {
      setCmsProfileStatus({ ok: false, msg: err instanceof Error ? err.message : t.profileSaveFailed });
    } finally {
      setCmsProfileSaving(false);
    }
  };

  // ── Content handlers ──
  const openContentCreate = () => {
    setContentForm({ status: "draft", type: "video", tags: [], is_premium: false });
    setContentUploadFile(null);
    setContentModal({ mode: "create" });
  };

  const openContentEdit = (item: CmsContent) => {
    setContentForm({ ...item });
    setContentUploadFile(null);
    setContentModal({ mode: "edit", item });
  };

  const handleContentSave = async () => {
    if (!contentForm.title || !contentForm.type) return;
    setContentSaving(true);
    try {
      let mediaUrl = contentForm.media_url;
      if (contentUploadFile) {
        setContentUploadProgress(true);
        const uploaded = await uploadCmsMedia(contentUploadFile);
        mediaUrl = uploaded.url;
        setContentUploadProgress(false);
      }
      setContentSaveError(null);
      const payload = { ...contentForm, media_url: mediaUrl };
      if (contentModal?.mode === "edit" && contentModal.item) {
        const res = await updateCmsContent(contentModal.item.id, payload);
        setCmsContent((prev) => prev.map((c) => c.id === res.content.id ? res.content : c));
      } else {
        const res = await createCmsContent(payload);
        setCmsContent((prev) => [res.content, ...prev]);
      }
      setContentModal(null);
    } catch (err) {
      setContentSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setContentSaving(false);
      setContentUploadProgress(false);
    }
  };

  const confirmContentDelete = async (id: number) => {
    setContentDeleteTarget(null);
    try {
      await deleteCmsContent(id);
      setCmsContent((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setContentSaveError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // ── Show handlers ──
  const openShowCreate = () => {
    const dt = new Date(); dt.setDate(dt.getDate() + 1);
    setShowForm({ status: "draft", is_premium: false, scheduled_at: dt.toISOString().slice(0, 16) });
    setShowModal({ mode: "create" });
  };

  const openShowEdit = (item: CmsShow) => {
    setShowForm({ ...item, scheduled_at: item.scheduled_at?.slice(0, 16) });
    setShowModal({ mode: "edit", item });
  };

  const handleShowSave = async () => {
    if (!showForm.title || !showForm.scheduled_at) return;
    setShowSaving(true);
    try {
      if (showModal?.mode === "edit" && showModal.item) {
        const res = await updateCmsShow(showModal.item.id, showForm);
        setCmsShows((prev) => prev.map((s) => s.id === res.show.id ? res.show : s));
      } else {
        const res = await createCmsShow(showForm);
        setCmsShows((prev) => [...prev, res.show]);
      }
      setShowModal(null);
      setShowSaveError(null);
    } catch (err) {
      setShowSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setShowSaving(false);
    }
  };

  const confirmShowDelete = async (id: number) => {
    setShowDeleteTarget(null);
    try {
      await deleteCmsShow(id);
      setCmsShows((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setShowSaveError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // ── Share to Feed ──
  const openShareModal = (text: string) => {
    setShareError(null);
    setShareModal({ text });
  };

  const handleConfirmShare = async () => {
    if (!shareModal?.text.trim()) return;
    setSharePosting(true);
    setShareError(null);
    try {
      await createSocialPost(shareModal.text.trim());
      setShareModal(null);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setSharePosting(false);
    }
  };

  // ── Render ──
  if (cmsLoading) {
    return <div className="text-center py-10 text-white/40 text-sm">{t.loadingCmsData}</div>;
  }

  if (cmsError) {
    return (
      <div className="px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
        {cmsError}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex gap-2">
        {(["profile", "content", "shows"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setCmsContentSection(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={cmsContentSection === s
              ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
              : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }
            }
          >
            {s === "profile" ? t.subNavProfile : s === "content" ? t.subNavContent : t.subNavShows}
          </button>
        ))}
      </div>

      {/* ── Performer Profile Section ── */}
      {cmsContentSection === "profile" && cmsPerformer && (
        <div className="glass-card-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{t.performerProfileTitle}</p>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{
              background: cmsPerformer.status === "published" ? "rgba(94,209,196,0.15)" : "rgba(255,255,255,0.08)",
              color: cmsPerformer.status === "published" ? "#5ED1C4" : "#8E8E93",
            }}>
              {cmsPerformer.status}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.fieldDisplayName}</label>
              <input
                value={cmsProfileForm.name ?? ""}
                onChange={(e) => setCmsProfileForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.fieldAvailabilityMessage}</label>
              <input
                value={cmsProfileForm.availability_message ?? ""}
                onChange={(e) => setCmsProfileForm((p) => ({ ...p, availability_message: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-white/50 mb-1">{t.fieldShortBio}</label>
              <input
                value={cmsProfileForm.bio_short ?? ""}
                onChange={(e) => setCmsProfileForm((p) => ({ ...p, bio_short: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-white/50 mb-1">{t.fieldFullBio}</label>
              <textarea
                rows={3}
                value={cmsProfileForm.bio ?? ""}
                onChange={(e) => setCmsProfileForm((p) => ({ ...p, bio: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.fieldBasePriceCents}</label>
              <input
                type="number"
                value={cmsProfileForm.base_price_cents ?? ""}
                onChange={(e) => setCmsProfileForm((p) => ({ ...p, base_price_cents: Number(e.target.value) || null }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">{t.fieldCurrency}</label>
              <select
                value={cmsProfileForm.currency ?? "USD"}
                onChange={(e) => setCmsProfileForm((p) => ({ ...p, currency: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="COP">COP</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={!!cmsProfileForm.is_available}
                onChange={(e) => setCmsProfileForm((p) => ({ ...p, is_available: e.target.checked }))}
                className="rounded"
              />
              {t.fieldAvailableForBookings}
            </label>
            <select
              value={cmsProfileForm.status ?? "draft"}
              onChange={(e) => setCmsProfileForm((p) => ({ ...p, status: e.target.value as CmsPerformer["status"] }))}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 focus:outline-none"
            >
              <option value="draft">{t.statusDraft}</option>
              <option value="published">{t.statusPublished}</option>
              <option value="archived">{t.statusArchived}</option>
            </select>
          </div>

          {cmsProfileStatus && (
            <p className="text-xs" style={{ color: cmsProfileStatus.ok ? "#5ED1C4" : "#FF453A" }}>
              {cmsProfileStatus.msg}
            </p>
          )}

          <button
            onClick={handleCmsProfileSave}
            disabled={cmsProfileSaving}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-colors"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            {cmsProfileSaving ? t.savingProfile : t.saveProfile}
          </button>
        </div>
      )}

      {/* ── Content Library Section ── */}
      {cmsContentSection === "content" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{t.contentLibraryTitle(cmsContent.length)}</p>
            <button
              onClick={openContentCreate}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {t.newItemBtn}
            </button>
          </div>

          {cmsContent.length === 0 && (
            <div className="glass-card-sm p-6 text-center">
              <p className="text-sm text-white/40">{t.noContentYet}</p>
            </div>
          )}

          {cmsContent.map((item) => (
            <div key={item.id} className="glass-card-sm p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-white truncate">{item.title}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
                    background: item.status === "published" ? "rgba(94,209,196,0.15)" : "rgba(255,255,255,0.06)",
                    color: item.status === "published" ? "#5ED1C4" : "#8E8E93",
                  }}>{item.status}</span>
                  {item.is_premium && <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>{t.primeBadge}</span>}
                </div>
                <p className="text-xs text-white/40">
                  {item.type === "video" ? "🎬" : item.type === "audio" ? "🎵" : "🎙"} {item.type}{item.duration_seconds ? ` · ${Math.round(item.duration_seconds / 60)}m` : ""}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => openShareModal(
                    `${item.type === "video" ? "🎬" : item.type === "audio" ? "🎵" : "🎙"} New ${item.type}: "${item.title}"${item.description ? `\n\n${item.description}` : ""}\n\n#PNPtv #Creator`
                  )}
                  className="text-xs hover:underline"
                  style={{ color: "#E69138" }}
                >
                  {t.shareBtn}
                </button>
                <button onClick={() => openContentEdit(item)} className="text-xs text-pnp-accent hover:underline">{t.editBtn}</button>
                <button onClick={() => setContentDeleteTarget(item.id)} className="text-xs text-red-400 hover:underline">{t.deleteBtn}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Shows Section ── */}
      {cmsContentSection === "shows" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">{t.scheduledShowsTitle(cmsShows.length)}</p>
            <button
              onClick={openShowCreate}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              {t.scheduleShowBtn}
            </button>
          </div>

          {cmsShows.length === 0 && (
            <div className="glass-card-sm p-6 text-center">
              <p className="text-sm text-white/40">{t.noShowsYet}</p>
            </div>
          )}

          {cmsShows.map((show) => (
            <div key={show.id} className="glass-card-sm p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-white truncate">{show.title}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
                    background: show.status === "published" ? "rgba(94,209,196,0.15)" : "rgba(255,255,255,0.06)",
                    color: show.status === "published" ? "#5ED1C4" : "#8E8E93",
                  }}>{show.status}</span>
                  {show.is_premium && <span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A" }}>{t.primeBadge}</span>}
                </div>
                <p className="text-xs text-white/40">
                  {show.scheduled_at ? new Date(show.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  {show.duration_minutes ? ` · ${show.duration_minutes}min` : ""}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => openShareModal(
                    `🎥 Live show: "${show.title}"${show.scheduled_at ? `\n📅 ${new Date(show.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}${show.duration_minutes ? ` · ${show.duration_minutes}min` : ""}${show.description ? `\n\n${show.description}` : ""}\n\n#PNPtv #LiveShow`
                  )}
                  className="text-xs hover:underline"
                  style={{ color: "#E69138" }}
                >
                  {t.shareBtn}
                </button>
                <button onClick={() => openShowEdit(show)} className="text-xs text-pnp-accent hover:underline">{t.editBtn}</button>
                <button onClick={() => setShowDeleteTarget(show.id)} className="text-xs text-red-400 hover:underline">{t.deleteBtn}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Content Modal (create/edit) ── */}
      {contentModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} onClick={() => { setContentModal(null); setContentSaveError(null); }}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold text-white">{contentModal.mode === "create" ? t.newContentTitle : t.editContentTitle}</p>
              <button onClick={() => setContentModal(null)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">{t.fieldTitle}</label>
                <input value={contentForm.title ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1">{t.fieldType}</label>
                  <select value={contentForm.type ?? "video"} onChange={(e) => setContentForm((p) => ({ ...p, type: e.target.value as CmsContent["type"] }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none">
                    <option value="video">{t.contentTypeVideo}</option>
                    <option value="audio">{t.contentTypeAudio}</option>
                    <option value="podcast">{t.contentTypePodcast}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">{t.fieldContentStatus}</label>
                  <select value={contentForm.status ?? "draft"} onChange={(e) => setContentForm((p) => ({ ...p, status: e.target.value as CmsContent["status"] }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none">
                    <option value="draft">{t.statusDraft}</option>
                    <option value="published">{t.statusPublished}</option>
                    <option value="archived">{t.statusArchived}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">{t.fieldMediaUrl}</label>
                <input value={contentForm.media_url ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, media_url: e.target.value }))}
                  placeholder={t.mediaUrlPlaceholder} className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">{t.fieldUploadFile}</label>
                <input type="file" accept="video/*,audio/*" onChange={(e) => setContentUploadFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-white/60 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-white/10 file:text-white/70 hover:file:bg-white/20" />
                {contentUploadFile && <p className="text-xs text-white/40 mt-1">{contentUploadFile.name}</p>}
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">{t.fieldDescription}</label>
                <textarea rows={2} value={contentForm.description ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1">{t.fieldDurationSec}</label>
                  <input type="number" value={contentForm.duration_seconds ?? ""} onChange={(e) => setContentForm((p) => ({ ...p, duration_seconds: Number(e.target.value) || null }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none" />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                    <input type="checkbox" checked={!!contentForm.is_premium} onChange={(e) => setContentForm((p) => ({ ...p, is_premium: e.target.checked }))} className="rounded" />
                    {t.fieldPrimeOnly}
                  </label>
                </div>
              </div>
            </div>

            {contentSaveError && (
              <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                {contentSaveError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleContentSave} disabled={contentSaving || !contentForm.title || !contentForm.type}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {contentUploadProgress ? t.uploadingMedia : contentSaving ? t.savingContent : contentModal.mode === "create" ? t.createBtn : t.saveBtn}
              </button>
              <button onClick={() => { setContentModal(null); setContentSaveError(null); }} className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5">{t.cancelBtn}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Show Modal (create/edit) ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} onClick={() => { setShowModal(null); setShowSaveError(null); }}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold text-white">{showModal.mode === "create" ? t.scheduleShowTitle : t.editShowTitle}</p>
              <button onClick={() => setShowModal(null)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">{t.fieldShowTitle}</label>
                <input value={showForm.title ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1">{t.fieldDateTime}</label>
                  <input type="datetime-local" value={showForm.scheduled_at ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, scheduled_at: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent" />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">{t.fieldDurationMin}</label>
                  <input type="number" value={showForm.duration_minutes ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, duration_minutes: Number(e.target.value) || null }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">{t.fieldDescription}</label>
                <textarea rows={2} value={showForm.description ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1">{t.fieldCategory}</label>
                  <input value={showForm.category ?? ""} onChange={(e) => setShowForm((p) => ({ ...p, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">{t.fieldContentStatus}</label>
                  <select value={showForm.status ?? "draft"} onChange={(e) => setShowForm((p) => ({ ...p, status: e.target.value as CmsShow["status"] }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none">
                    <option value="draft">{t.statusDraft}</option>
                    <option value="published">{t.statusPublished}</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                <input type="checkbox" checked={!!showForm.is_premium} onChange={(e) => setShowForm((p) => ({ ...p, is_premium: e.target.checked }))} className="rounded" />
                {t.fieldPrimeOnly}
              </label>
            </div>

            {showSaveError && (
              <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                {showSaveError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleShowSave} disabled={showSaving || !showForm.title || !showForm.scheduled_at}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {showSaving ? t.schedulingShow : showModal.mode === "create" ? t.scheduleBtn : t.saveBtn}
              </button>
              <button onClick={() => { setShowModal(null); setShowSaveError(null); }} className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5">{t.cancelBtn}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share to Feed Modal ── */}
      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} onClick={() => setShareModal(null)}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold text-white">{t.shareToFeedTitle}</p>
              <button onClick={() => setShareModal(null)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
            </div>

            <p className="text-xs" style={{ color: "#8E8E93" }}>{t.shareToFeedDesc}</p>

            <textarea
              rows={5}
              value={shareModal.text}
              onChange={(e) => setShareModal({ text: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
              placeholder={t.sharePlaceholder}
            />

            {shareError && (
              <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                {shareError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleConfirmShare}
                disabled={sharePosting || !shareModal.text.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {sharePosting ? t.postingToFeed : t.postToFeedBtn}
              </button>
              <button onClick={() => setShareModal(null)} className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5">
                {t.cancelBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Content Delete Confirm ── */}
      <ConfirmDialog
        open={contentDeleteTarget !== null}
        title={t.deleteContentConfirm}
        message={t.cannotBeUndone}
        confirmLabel={t.deleteConfirmBtn}
        cancelLabel={t.cancelBtn}
        onConfirm={() => contentDeleteTarget !== null && confirmContentDelete(contentDeleteTarget)}
        onCancel={() => setContentDeleteTarget(null)}
        variant="danger"
      />

      {/* ── Show Delete Confirm ── */}
      <ConfirmDialog
        open={showDeleteTarget !== null}
        title={t.deleteShowConfirm}
        message={t.cannotBeUndone}
        confirmLabel={t.deleteConfirmBtn}
        cancelLabel={t.cancelBtn}
        onConfirm={() => showDeleteTarget !== null && confirmShowDelete(showDeleteTarget)}
        onCancel={() => setShowDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
