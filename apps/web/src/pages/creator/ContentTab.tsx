import React, { useState, useEffect } from "react";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
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
  getOwnChannels,
  createCreatorChannel,
  updateCreatorChannel,
  deleteCreatorChannel,
  assignPostToChannel,
  unassignPostFromChannel,
  getPublicProfile,
  uploadChannelCover,
  addChannelCollaborator,
  removeChannelCollaborator,
  type CmsPerformer,
  type CmsContent,
  type CmsShow,
  type CreatorChannel,
  type SocialPostItem,
} from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

interface ContentTabProps {
  t: CreatorStrings;
}

export function ContentTab({ t }: ContentTabProps) {
  const { user } = useAuth();
  // CMS data
  const [cmsPerformer, setCmsPerformer] = useState<CmsPerformer | null>(null);
  const [cmsContent, setCmsContent] = useState<CmsContent[]>([]);
  const [cmsShows, setCmsShows] = useState<CmsShow[]>([]);
  const [cmsLoading, setCmsLoading] = useState(true);
  const [cmsError, setCmsError] = useState<string | null>(null);
  const [cmsContentSection, setCmsContentSection] = useState<"profile" | "content" | "shows" | "channels">("profile");

  // ── Channels state ──
  const [ownChannels, setOwnChannels] = useState<CreatorChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelForm, setChannelForm] = useState<{
    name: string;
    description: string;
    tags: string;
    accessType: 'free' | 'prime' | 'subscription' | 'paid';
    priceUsd: number;
    telegramChannelId: string;
    bridgeEnabled: boolean;
  }>({ name: "", description: "", tags: "", accessType: "free", priceUsd: 0, telegramChannelId: "", bridgeEnabled: false });
  const [channelFormSaving, setChannelFormSaving] = useState(false);
  const [channelFormError, setChannelFormError] = useState<string | null>(null);
  const [editingChannelId, setEditingChannelId] = useState<number | null>(null);
  const [deleteChannelTarget, setDeleteChannelTarget] = useState<number | null>(null);
  // Post assignment state
  const [managingChannelId, setManagingChannelId] = useState<number | null>(null);
  const [assignPosts, setAssignPosts] = useState<SocialPostItem[]>([]);
  const [assignPostsLoading, setAssignPostsLoading] = useState(false);
  const [assigningPostId, setAssigningPostId] = useState<number | null>(null);

  // Cover upload state
  const [uploadingCoverId, setUploadingCoverId] = useState<number | null>(null);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);

  // Collaborator state
  const [collaboratorInput, setCollaboratorInput] = useState<Record<number, string>>({});
  const [collaboratorActionId, setCollaboratorActionId] = useState<number | null>(null);
  const [collaboratorError, setCollaboratorError] = useState<Record<number, string>>({});

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
  const [shareModal, setShareModal] = useState<{
    text: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
    postTarget: 'wall' | 'channel';
    selectedChannelId: number | null;
  } | null>(null);
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
  const openShareModal = (text: string, mediaUrl?: string | null, mediaType?: string | null) => {
    setShareError(null);
    setShareModal({ text, mediaUrl: mediaUrl ?? null, mediaType: mediaType ?? null, postTarget: 'wall', selectedChannelId: null });
  };

  const handleConfirmShare = async () => {
    if (!shareModal?.text.trim()) return;
    setSharePosting(true);
    setShareError(null);
    try {
      if (shareModal.postTarget === 'channel') {
        if (!shareModal.selectedChannelId) {
          setShareError("Please select a channel");
          setSharePosting(false);
          return;
        }
        const res = await createSocialPost(
          shareModal.text.trim(),
          undefined,
          false, // not exclusive — channel controls access
          true,
        );
        if (res?.post?.id) {
          await assignPostToChannel(res.post.id, shareModal.selectedChannelId);
        }
      } else {
        // Post to Creator Wall — exclusive content on creator's profile
        await createSocialPost(
          shareModal.text.trim(),
          undefined,
          true, // exclusive = PRIME/subscriber-only
          true,
        );
      }
      setShareModal(null);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setSharePosting(false);
    }
  };

  // ── Channel handlers ──
  const loadOwnChannels = () => {
    setChannelsLoading(true);
    setChannelsError(null);
    getOwnChannels()
      .then((res) => {
        if (res.success) setOwnChannels(res.channels);
      })
      .catch((err) => setChannelsError(err.message || "Failed to load channels"))
      .finally(() => setChannelsLoading(false));
  };

  // Load channels on mount so they're available for the share modal
  useEffect(() => {
    loadOwnChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cmsContentSection === "channels" && ownChannels.length === 0 && !channelsLoading) {
      loadOwnChannels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmsContentSection]);

  const openChannelCreate = () => {
    setEditingChannelId(null);
    setChannelForm({ name: "", description: "", tags: "", accessType: "free", priceUsd: 0, telegramChannelId: "", bridgeEnabled: false });
    setChannelFormError(null);
    setShowChannelForm(true);
  };

  const openChannelEdit = (ch: CreatorChannel) => {
    setEditingChannelId(ch.id);
    setChannelForm({
      name: ch.name,
      description: ch.description || "",
      tags: (ch.tags || []).join(", "),
      accessType: ch.accessType ?? (ch.isPremium ? "subscription" : "free"),
      priceUsd: ch.priceUsd ?? 0,
      telegramChannelId: ch.telegramChannelId || "",
      bridgeEnabled: ch.bridgeEnabled === true,
    });
    setChannelFormError(null);
    setShowChannelForm(true);
  };

  const handleChannelSave = async () => {
    if (!channelForm.name.trim()) {
      setChannelFormError("Channel name is required");
      return;
    }
    setChannelFormSaving(true);
    setChannelFormError(null);
    const tags = channelForm.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (editingChannelId !== null) {
        const res = await updateCreatorChannel(editingChannelId, {
          name: channelForm.name.trim(),
          description: channelForm.description.trim() || undefined,
          tags,
          accessType: channelForm.accessType,
          priceUsd: channelForm.accessType === "paid" ? channelForm.priceUsd : 0,
          telegramChannelId: channelForm.telegramChannelId.trim() || null,
          bridgeEnabled: channelForm.bridgeEnabled,
        });
        if (res.success) {
          setOwnChannels((prev) =>
            prev.map((c) => (c.id === editingChannelId ? res.channel : c))
          );
        }
      } else {
        const res = await createCreatorChannel({
          name: channelForm.name.trim(),
          description: channelForm.description.trim() || undefined,
          tags,
          accessType: channelForm.accessType,
          priceUsd: channelForm.accessType === "paid" ? channelForm.priceUsd : 0,
          telegramChannelId: channelForm.telegramChannelId.trim() || null,
          bridgeEnabled: channelForm.bridgeEnabled,
        });
        if (res.success) {
          setOwnChannels((prev) => [res.channel, ...prev]);
        }
      }
      setShowChannelForm(false);
      setEditingChannelId(null);
    } catch (err) {
      setChannelFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setChannelFormSaving(false);
    }
  };

  const handleChannelDelete = async (id: number) => {
    setDeleteChannelTarget(null);
    try {
      await deleteCreatorChannel(id);
      setOwnChannels((prev) => prev.filter((c) => c.id !== id));
      if (managingChannelId === id) setManagingChannelId(null);
    } catch {
      // non-critical; user can retry
    }
  };

  const openManagePosts = async (channelId: number) => {
    setManagingChannelId(channelId);
    setAssignPostsLoading(true);
    try {
      const userId = user?.id ? String(user.id) : null;
      if (!userId) { setAssignPosts([]); return; }
      const res = await getPublicProfile(userId, undefined, 50);
      if (res.success) setAssignPosts(res.posts);
    } catch {
      setAssignPosts([]);
    } finally {
      setAssignPostsLoading(false);
    }
  };

  const handleTogglePostAssignment = async (post: SocialPostItem, channelId: number) => {
    const isAssigned = (post as SocialPostItem & { channel_id?: number }).channel_id === channelId;
    setAssigningPostId(post.id);
    try {
      if (isAssigned) {
        await unassignPostFromChannel(post.id);
        setAssignPosts((prev) =>
          prev.map((p) =>
            p.id === post.id ? { ...p, channel_id: undefined } as typeof p : p
          )
        );
      } else {
        await assignPostToChannel(post.id, channelId);
        setAssignPosts((prev) =>
          prev.map((p) =>
            p.id === post.id ? { ...p, channel_id: channelId } as typeof p : p
          )
        );
      }
    } catch {
      // non-critical
    } finally {
      setAssigningPostId(null);
    }
  };

  // ── Cover upload handler ──
  const handleCoverUpload = async (channelId: number, file: File) => {
    setUploadingCoverId(channelId);
    setCoverUploadError(null);
    try {
      const res = await uploadChannelCover(channelId, file);
      if (res.success) {
        setOwnChannels((prev) =>
          prev.map((c) => c.id === channelId ? { ...c, coverImageUrl: res.coverImageUrl } : c)
        );
      }
    } catch (err) {
      setCoverUploadError(err instanceof Error ? err.message : "Cover upload failed");
    } finally {
      setUploadingCoverId(null);
    }
  };

  // ── Collaborator handlers ──
  const handleAddCollaborator = async (channelId: number) => {
    const userId = (collaboratorInput[channelId] || "").trim();
    if (!userId) return;
    setCollaboratorActionId(channelId);
    setCollaboratorError((prev) => ({ ...prev, [channelId]: "" }));
    try {
      const res = await addChannelCollaborator(channelId, userId);
      if (res.success) {
        setOwnChannels((prev) =>
          prev.map((c) => c.id === channelId ? res.channel : c)
        );
        setCollaboratorInput((prev) => ({ ...prev, [channelId]: "" }));
      }
    } catch (err) {
      setCollaboratorError((prev) => ({
        ...prev,
        [channelId]: err instanceof Error ? err.message : "Failed to add collaborator",
      }));
    } finally {
      setCollaboratorActionId(null);
    }
  };

  const handleRemoveCollaborator = async (channelId: number, userId: string) => {
    setCollaboratorActionId(channelId);
    setCollaboratorError((prev) => ({ ...prev, [channelId]: "" }));
    try {
      const res = await removeChannelCollaborator(channelId, userId);
      if (res.success) {
        setOwnChannels((prev) =>
          prev.map((c) => c.id === channelId ? res.channel : c)
        );
      }
    } catch (err) {
      setCollaboratorError((prev) => ({
        ...prev,
        [channelId]: err instanceof Error ? err.message : "Failed to remove collaborator",
      }));
    } finally {
      setCollaboratorActionId(null);
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
      <div className="flex gap-2 flex-wrap">
        {(["profile", "content", "shows", "channels"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setCmsContentSection(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={cmsContentSection === s
              ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
              : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }
            }
          >
            {s === "profile" ? t.subNavProfile : s === "content" ? t.subNavContent : s === "shows" ? t.subNavShows : "Channels"}
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
                    `${item.type === "video" ? "🎬" : item.type === "audio" ? "🎵" : "🎙"} New ${item.type}: "${item.title}"${item.description ? `\n\n${item.description}` : ""}\n\n#PNPtv #Creator`,
                    item.media_url ?? null,
                    item.type === "video" ? "video" : item.type === "audio" ? "audio" : null
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
                    `🎥 Live show: "${show.title}"${show.scheduled_at ? `\n📅 ${new Date(show.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}${show.duration_minutes ? ` · ${show.duration_minutes}min` : ""}${show.description ? `\n\n${show.description}` : ""}\n\n#PNPtv #LiveShow`,
                    null,
                    null
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
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
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
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
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

      {/* ── Share Modal (Post to Wall / Channel) ── */}
      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} onClick={() => setShareModal(null)}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold text-white">
                {shareModal.postTarget === 'channel' ? 'Post to Channel' : 'Post to Creator Wall'}
              </p>
              <button onClick={() => setShareModal(null)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
            </div>

            {/* Destination picker */}
            <div className="flex gap-2">
              <button
                onClick={() => setShareModal(m => m ? { ...m, postTarget: 'wall', selectedChannelId: null } : m)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all border"
                style={shareModal.postTarget === 'wall'
                  ? { background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff", borderColor: "transparent" }
                  : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.1)" }
                }
              >
                🔒 Creator Wall
              </button>
              <button
                onClick={() => setShareModal(m => m ? { ...m, postTarget: 'channel' } : m)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all border"
                style={shareModal.postTarget === 'channel'
                  ? { background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff", borderColor: "transparent" }
                  : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.1)" }
                }
              >
                📺 Post to Channel
              </button>
            </div>

            {/* Description */}
            <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {shareModal.postTarget === 'wall'
                ? "Posts as exclusive content on your creator wall — visible to your subscribers and PRIME members."
                : "Posts to your selected channel. Channel subscribers will see it in their feed."
              }
            </p>

            {/* Channel selector */}
            {shareModal.postTarget === 'channel' && (
              <div>
                <label className="block text-xs text-white/50 mb-1">Select Channel</label>
                {ownChannels.length === 0 ? (
                  <p className="text-xs text-white/40">No channels yet. Create one in the Channels tab.</p>
                ) : (
                  <select
                    value={shareModal.selectedChannelId ?? ""}
                    onChange={(e) => setShareModal(m => m ? { ...m, selectedChannelId: Number(e.target.value) || null } : m)}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                  >
                    <option value="">— Choose a channel —</option>
                    {ownChannels.map(ch => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <textarea
              rows={5}
              value={shareModal.text}
              onChange={(e) => setShareModal(m => m ? { ...m, text: e.target.value } : m)}
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
                {sharePosting ? t.postingToFeed : shareModal.postTarget === 'channel' ? 'Post to Channel' : 'Post to Wall'}
              </button>
              <button onClick={() => setShareModal(null)} className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5">
                {t.cancelBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Channels Section ── */}
      {cmsContentSection === "channels" && (
        <div className="space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">My Channels</p>
            {!showChannelForm && (
              <button
                onClick={openChannelCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Create Channel
              </button>
            )}
          </div>

          {/* Inline create/edit form */}
          {showChannelForm && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(212,0,122,0.25)" }}>
              <p className="text-sm font-semibold text-white">
                {editingChannelId !== null ? "Edit Channel" : "New Channel"}
              </p>

              <div>
                <label className="block text-xs text-white/50 mb-1">Channel Name *</label>
                <input
                  value={channelForm.name}
                  onChange={(e) => setChannelForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Behind the Scenes"
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                />
              </div>

              <div>
                <label className="block text-xs text-white/50 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={channelForm.description}
                  onChange={(e) => setChannelForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="What's this channel about?"
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
                />
              </div>

              <div>
                <label className="block text-xs text-white/50 mb-1">Tags (comma-separated)</label>
                <input
                  value={channelForm.tags}
                  onChange={(e) => setChannelForm((p) => ({ ...p, tags: e.target.value }))}
                  placeholder="e.g. exclusive, photos, bts"
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                />
              </div>

              {/* Access type selector */}
              <div>
                <label className="block text-xs text-white/50 mb-2">Access Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: "free", label: "Free", color: "#5ED1C4", bg: "rgba(94,209,196,0.15)" },
                    { value: "subscription", label: "Included with my subscription", color: "#D4007A", bg: "rgba(212,0,122,0.15)" },
                    { value: "prime", label: "Included with PRIME", color: "#A78BFA", bg: "rgba(167,139,250,0.15)" },
                    { value: "paid", label: "Paid (monthly)", color: "#E69138", bg: "rgba(230,145,56,0.15)" },
                  ] as const).map(({ value, label, color, bg }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setChannelForm((p) => ({ ...p, accessType: value, priceUsd: value !== "paid" ? 0 : (p.priceUsd || 5) }))}
                      className="py-2 px-3 rounded-lg text-sm font-medium transition-all border"
                      style={channelForm.accessType === value
                        ? { background: bg, color, borderColor: color }
                        : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", borderColor: "rgba(255,255,255,0.1)" }
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {channelForm.accessType === "free" && (
                  <p className="text-[11px] text-white/30 mt-1.5">Open to everyone — Free, Basic, and PRIME members.</p>
                )}
                {channelForm.accessType === "subscription" && (
                  <p className="text-[11px] text-white/30 mt-1.5">Included automatically for users subscribed to your creator profile (Ice / Crystal / Diamond) — no extra fee.</p>
                )}
                {channelForm.accessType === "prime" && (
                  <p className="text-[11px] text-white/30 mt-1.5">Anyone with an active PRIME subscription gets access — no extra fee.</p>
                )}
                {channelForm.accessType === "paid" && (
                  <p className="text-[11px] text-white/30 mt-1.5">30-day access pass. Only Basic and PRIME members can subscribe (Free users must upgrade first). Subscribers get a reminder email + push + Telegram message 3 days before expiry to renew — they can cancel reminders anytime in their subscriptions.</p>
                )}
              </div>

              {/* Price picker — only when paid */}
              {channelForm.accessType === "paid" && (
                <div>
                  <label className="block text-xs text-white/50 mb-2">Price per 30 days (USD)</label>
                  <div className="flex gap-2 flex-wrap items-center">
                    {[5, 10, 15, 20, 25].map((price) => (
                      <button
                        key={price}
                        type="button"
                        onClick={() => setChannelForm((p) => ({ ...p, priceUsd: price }))}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border"
                        style={channelForm.priceUsd === price
                          ? { background: "rgba(230,145,56,0.2)", color: "#E69138", borderColor: "rgba(230,145,56,0.5)" }
                          : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.1)" }
                        }
                      >
                        ${price}/mo
                      </button>
                    ))}
                    <input
                      type="number"
                      min="0.99"
                      max="999.99"
                      step="0.01"
                      value={channelForm.priceUsd || ""}
                      onChange={(e) => setChannelForm((p) => ({ ...p, priceUsd: Number(e.target.value) || 0 }))}
                      placeholder="Custom"
                      className="w-24 px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>
                  <p className="text-[10px] text-white/30 mt-1.5">$0.99 – $999.99 per 30-day pass</p>
                </div>
              )}

              {/* Link hangout info note */}
              <div className="px-3 py-2.5 rounded-lg" style={{ background: "rgba(123,97,255,0.08)", border: "1px solid rgba(123,97,255,0.2)" }}>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  <span className="text-white/70 font-medium">Linking a Hangout:</span> You can link a hangout group to this channel from the Hangouts page after creating it. Linked hangouts will inherit this channel's access rules.
                </p>
              </div>

              {/* Telegram Bridge */}
              <div className="pt-1 border-t border-white/10">
                <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Telegram Bridge</p>
                <div className="mb-2">
                  <label className="block text-xs text-white/50 mb-1">Telegram Channel ID or @username</label>
                  <input
                    value={channelForm.telegramChannelId}
                    onChange={(e) => setChannelForm((p) => ({ ...p, telegramChannelId: e.target.value, bridgeEnabled: p.bridgeEnabled && !!e.target.value.trim() }))}
                    placeholder="-1001234567890 or @mychannel"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent font-mono"
                  />
                  <p className="text-[10px] text-white/30 mt-1">The bot must be an admin of your Telegram channel. To find the numeric ID, forward a message to @username_to_id_bot.</p>
                </div>
                {channelForm.telegramChannelId.trim() && (
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelForm.bridgeEnabled}
                      onChange={(e) => setChannelForm((p) => ({ ...p, bridgeEnabled: e.target.checked }))}
                      className="w-4 h-4 rounded accent-[#D4007A]"
                    />
                    <span className="text-sm text-white/80">Enable auto-mirror (posts bridged to this channel)</span>
                  </label>
                )}
              </div>

              {channelFormError && (
                <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                  {channelFormError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleChannelSave}
                  disabled={channelFormSaving || !channelForm.name.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {channelFormSaving ? "Saving..." : editingChannelId !== null ? "Save Changes" : "Create Channel"}
                </button>
                <button
                  onClick={() => { setShowChannelForm(false); setEditingChannelId(null); setChannelFormError(null); }}
                  className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Loading / error */}
          {channelsLoading && (
            <div className="text-center py-8 text-white/40 text-sm">Loading channels...</div>
          )}
          {channelsError && (
            <div className="px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
              {channelsError}
              <button onClick={loadOwnChannels} className="ml-2 underline text-red-300 text-xs">Retry</button>
            </div>
          )}

          {/* Channel list */}
          {!channelsLoading && ownChannels.length === 0 && !channelsError && (
            <div className="text-center py-10 text-white/40 text-sm">
              You haven't created any channels yet. Channels let you group your posts into curated collections.
            </div>
          )}

          {ownChannels.map((ch) => (
            <div key={ch.id} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white truncate">{ch.name}</span>
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex-shrink-0"
                        style={ch.isPremium
                          ? { background: "rgba(212,0,122,0.15)", color: "#D4007A" }
                          : { background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }
                        }
                      >
                        {ch.isPremium ? "Premium" : "Free"}
                      </span>
                    </div>
                    {ch.description && (
                      <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                        {ch.description}
                      </p>
                    )}
                    {ch.tags && ch.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {ch.tags.map((tag) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] mt-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                      {ch.postCount} post{ch.postCount !== 1 ? "s" : ""}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => openChannelEdit(ch)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white/70 hover:text-white transition-colors"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteChannelTarget(ch.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:text-red-300 transition-colors"
                      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Cover image + collaborators row */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* Cover upload */}
                  <label
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: uploadingCoverId === ch.id ? "#8E8E93" : "#fff" }}
                    title="Upload channel cover image"
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingCoverId === ch.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCoverUpload(ch.id, file);
                        e.target.value = "";
                      }}
                    />
                    {uploadingCoverId === ch.id ? (
                      "Uploading..."
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                        {ch.coverImageUrl ? "Replace Cover" : "Upload Cover"}
                      </>
                    )}
                  </label>
                  {/* Cover preview thumbnail */}
                  {ch.coverImageUrl && (
                    <img
                      src={ch.coverImageUrl}
                      alt="Cover"
                      className="w-8 h-8 rounded object-cover flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                </div>
                {coverUploadError && uploadingCoverId === null && (
                  <p className="text-[11px] mt-1" style={{ color: "#FF453A" }}>{coverUploadError}</p>
                )}

                {/* Collaborators section */}
                <div className="mt-3 space-y-2">
                  {ch.collaborators && ch.collaborators.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                        Collaborators
                      </p>
                      {ch.collaborators.map((uid) => (
                        <div key={uid} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <span className="text-xs text-white/70 truncate">{uid}</span>
                          <button
                            onClick={() => handleRemoveCollaborator(ch.id, uid)}
                            disabled={collaboratorActionId === ch.id}
                            className="text-[11px] text-red-400 hover:text-red-300 disabled:opacity-50 flex-shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={collaboratorInput[ch.id] ?? ""}
                      onChange={(e) => setCollaboratorInput((prev) => ({ ...prev, [ch.id]: e.target.value }))}
                      placeholder="User ID or username"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                    />
                    <button
                      onClick={() => handleAddCollaborator(ch.id)}
                      disabled={collaboratorActionId === ch.id || !(collaboratorInput[ch.id] || "").trim()}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors flex-shrink-0"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      {collaboratorActionId === ch.id ? "..." : "Add"}
                    </button>
                  </div>
                  {collaboratorError[ch.id] && (
                    <p className="text-[11px]" style={{ color: "#FF453A" }}>{collaboratorError[ch.id]}</p>
                  )}
                </div>

                {/* Manage Posts button */}
                <button
                  onClick={() =>
                    managingChannelId === ch.id
                      ? setManagingChannelId(null)
                      : openManagePosts(ch.id)
                  }
                  className="mt-3 w-full py-2 rounded-lg text-xs font-semibold text-white/70 hover:text-white transition-colors flex items-center justify-center gap-1.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                  {managingChannelId === ch.id ? "Hide Posts" : "Manage Posts"}
                </button>
              </div>

              {/* Post assignment panel */}
              {managingChannelId === ch.id && (
                <div className="border-t border-white/8 p-4 space-y-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">Assign Posts to Channel</p>
                  {assignPostsLoading ? (
                    <div className="text-center py-6 text-white/40 text-sm">Loading your posts...</div>
                  ) : assignPosts.length === 0 ? (
                    <div className="text-center py-6 text-white/40 text-sm">No posts found. Share something to your feed first.</div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {assignPosts.map((post) => {
                        const postWithChannel = post as SocialPostItem & { channel_id?: number };
                        const isAssigned = postWithChannel.channel_id === ch.id;
                        const isLoading = assigningPostId === post.id;
                        return (
                          <div
                            key={post.id}
                            className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                            style={{ background: isAssigned ? "rgba(212,0,122,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${isAssigned ? "rgba(212,0,122,0.25)" : "rgba(255,255,255,0.06)"}` }}
                          >
                            {/* Media thumbnail */}
                            {post.media_url && (post.media_url.startsWith("/") || post.media_url.startsWith("http")) ? (
                              <img
                                src={post.media_url}
                                alt=""
                                className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
                                style={{ background: "rgba(255,255,255,0.06)" }}>
                                <svg className="w-4 h-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                </svg>
                              </div>
                            )}

                            {/* Post preview */}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-white/80 line-clamp-2 leading-relaxed">
                                {post.content || (post.media_type === "video" ? "Video post" : "Image post")}
                              </p>
                              <p className="text-[10px] mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                                {new Date(post.created_at).toLocaleDateString()}
                                {isAssigned && (
                                  <span className="ml-2 font-semibold" style={{ color: "#D4007A" }}>In this channel</span>
                                )}
                              </p>
                            </div>

                            {/* Toggle button */}
                            <button
                              onClick={() => handleTogglePostAssignment(post, ch.id)}
                              disabled={isLoading}
                              className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                              style={isAssigned
                                ? { background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }
                                : { background: "rgba(212,0,122,0.12)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.25)" }
                              }
                            >
                              {isLoading ? "..." : isAssigned ? "Remove" : "Add"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Channel delete confirm */}
          <ConfirmDialog
            open={deleteChannelTarget !== null}
            title="Delete Channel"
            message="This will delete the channel and unassign all posts from it. This cannot be undone."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            onConfirm={() => deleteChannelTarget !== null && handleChannelDelete(deleteChannelTarget)}
            onCancel={() => setDeleteChannelTarget(null)}
            variant="danger"
          />
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
