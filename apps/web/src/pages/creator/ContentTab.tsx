import React, { useState, useEffect, useRef, useCallback } from "react";
import * as tus from "tus-js-client";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { UploadVideoButton } from "@/components/channels/UploadVideoButton";
import {
  getCmsProfile,
  updateCmsProfile,
  listCmsShows,
  createCmsShow,
  updateCmsShow,
  deleteCmsShow,
  createSocialPost,
  createXEmbedPost,
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
  listChannelVideos,
  deleteChannelVideo,
  listOwnCreatorMedia,
  updateOwnCreatorMedia,
  deleteOwnCreatorMedia,
  sharePostToHangouts,
  getHangoutGroups,
  type CmsPerformer,
  type CmsShow,
  type CreatorChannel,
  type SocialPostItem,
  type ChannelVideo,
  type CreatorMediaItem,
  type HangoutGroup,
} from "@/lib/api";
import type { CreatorStrings } from "@/lib/i18n/creator";

interface ContentTabProps {
  t: CreatorStrings;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Upload state type ─────────────────────────────────────────────────────────

interface ProfileMediaUploadState {
  file: File;
  caption: string;
  isPremium: boolean;
  progress: number;   // 0–100 while uploading; -1 = idle (file chosen, not started)
  uploading: boolean;
  tusUpload: tus.Upload | null;
  successFlash: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ContentTab({ t }: ContentTabProps) {
  const { user } = useAuth();

  // ── Profile Media state ──
  const [profileMedia, setProfileMedia] = useState<CreatorMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<ProfileMediaUploadState | null>(null);
  const [mediaDeleteTarget, setMediaDeleteTarget] = useState<string | null>(null);
  const [togglingMediaId, setTogglingMediaId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CMS data
  const [cmsPerformer, setCmsPerformer] = useState<CmsPerformer | null>(null);
  const [cmsShows, setCmsShows] = useState<CmsShow[]>([]);
  const [cmsLoading, setCmsLoading] = useState(true);
  const [cmsError, setCmsError] = useState<string | null>(null);
  const [cmsContentSection, setCmsContentSection] = useState<"profile" | "shows" | "channels">("profile");

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

  // Per-channel video list state
  const [expandedVideosChannelId, setExpandedVideosChannelId] = useState<number | null>(null);
  const [channelVideos, setChannelVideos] = useState<Record<number, ChannelVideo[]>>({});
  const [channelVideosLoading, setChannelVideosLoading] = useState<number | null>(null);
  const [channelVideosError, setChannelVideosError] = useState<Record<number, string>>({});
  const [deletingVideoId, setDeletingVideoId] = useState<number | null>(null);

  // Profile edit
  const [cmsProfileForm, setCmsProfileForm] = useState<Partial<CmsPerformer>>({});
  const [cmsProfileSaving, setCmsProfileSaving] = useState(false);
  const [cmsProfileStatus, setCmsProfileStatus] = useState<{ ok: boolean; msg: string } | null>(null);

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

  // X embed modal
  const [xEmbedOpen, setXEmbedOpen] = useState(false);
  const [xEmbedUrl, setXEmbedUrl] = useState("");
  const [xEmbedPosting, setXEmbedPosting] = useState(false);
  const [xEmbedError, setXEmbedError] = useState<string | null>(null);
  const [xEmbedSuccess, setXEmbedSuccess] = useState(false);
  const [xEmbedTarget, setXEmbedTarget] = useState<'feed' | 'channel' | 'hangout'>('feed');
  const [xEmbedChannelId, setXEmbedChannelId] = useState<number | null>(null);
  const [xEmbedHangoutId, setXEmbedHangoutId] = useState<number | null>(null);
  const [ownHangouts, setOwnHangouts] = useState<HangoutGroup[]>([]);
  const [hangoutsLoaded, setHangoutsLoaded] = useState(false);

  // Load CMS data (initial: profile + shows + first content page)
  useEffect(() => {
    setCmsLoading(true);
    setCmsError(null);
    Promise.all([getCmsProfile(), listCmsShows()])
      .then(([prof, shows]) => {
        setCmsPerformer(prof.performer);
        setCmsProfileForm({
          name: prof.performer.name,
          bio: prof.performer.bio ?? "",
          bio_short: prof.performer.bio_short ?? "",
          categories: prof.performer.categories ?? [],
          is_available: prof.performer.is_available,
          availability_message: prof.performer.availability_message ?? "",
          social_links: prof.performer.social_links ?? {},
          status: prof.performer.status ?? "draft",
        });
        setCmsShows(shows.shows);
      })
      .catch((err) => setCmsError(err.message || t.errorFailedLoadCms))
      .finally(() => setCmsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.errorFailedLoadCms]);

  // ── Profile Media: load on mount ──
  const loadProfileMedia = useCallback(() => {
    setMediaLoading(true);
    setMediaError(null);
    listOwnCreatorMedia()
      .then((res) => {
        if (res.success) setProfileMedia(res.items);
      })
      .catch((err) => setMediaError(err instanceof Error ? err.message : "Error al cargar el contenido"))
      .finally(() => setMediaLoading(false));
  }, []);

  useEffect(() => {
    loadProfileMedia();
  }, [loadProfileMedia]);

  // ── Profile Media: tus upload helper ──
  function startTusUpload(state: ProfileMediaUploadState): tus.Upload {
    const upload = new tus.Upload(state.file, {
      endpoint: "/api/webapp/creator/media/tus",
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: 10 * 1024 * 1024,
      // Session cookies sent automatically for same-origin requests (no withCredentials needed)
      metadata: {
        filename: state.file.name,
        filetype: state.file.type,
        caption: state.caption,
        is_premium: state.isPremium ? "true" : "false",
      },
      onError(err) {
        setUploadState((prev) =>
          prev ? { ...prev, uploading: false, progress: -1, tusUpload: null } : null
        );
        setMediaError(err instanceof Error ? err.message : "Error al subir. Intenta de nuevo.");
      },
      onProgress(bytesSent, bytesTotal) {
        const pct = bytesTotal > 0 ? Math.round((bytesSent / bytesTotal) * 100) : 0;
        setUploadState((prev) => (prev ? { ...prev, progress: pct } : null));
      },
      onSuccess(_payload) {
        setUploadState((prev) =>
          prev ? { ...prev, uploading: false, progress: 100, tusUpload: null, successFlash: true } : null
        );
        loadProfileMedia();
        // Clear the panel after brief success flash
        setTimeout(() => {
          setUploadState(null);
        }, 1800);
      },
    });
    upload.start();
    return upload;
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // Reset input value so re-selecting the same file triggers onChange again
    e.target.value = "";
    if (!file) return;
    setUploadState({
      file,
      caption: "",
      isPremium: false,
      progress: -1,
      uploading: false,
      tusUpload: null,
      successFlash: false,
    });
    setMediaError(null);
  };

  const handleStartUpload = () => {
    if (!uploadState || uploadState.uploading) return;
    const tusUpload = startTusUpload({ ...uploadState, uploading: true, progress: 0 });
    setUploadState((prev) =>
      prev ? { ...prev, uploading: true, progress: 0, tusUpload } : null
    );
  };

  const handleCancelUpload = () => {
    if (uploadState?.tusUpload) {
      uploadState.tusUpload.abort();
    }
    setUploadState(null);
  };

  const handleTogglePremium = async (item: CreatorMediaItem) => {
    const newValue = !item.isPremium;
    // Optimistic update
    setProfileMedia((prev) =>
      prev.map((m) => (m.id === item.id ? { ...m, isPremium: newValue } : m))
    );
    setTogglingMediaId(item.id);
    try {
      await updateOwnCreatorMedia(item.id, { is_premium: newValue });
    } catch {
      // Rollback
      setProfileMedia((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, isPremium: item.isPremium } : m))
      );
    } finally {
      setTogglingMediaId(null);
    }
  };

  const handleDeleteMedia = async (id: string) => {
    setMediaDeleteTarget(null);
    try {
      await deleteOwnCreatorMedia(id);
      setProfileMedia((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : "No se pudo eliminar. Intenta de nuevo.");
    }
  };

  // ── Profile handlers ──
  const handleCmsProfileSave = async () => {
    setCmsProfileSaving(true);
    setCmsProfileStatus(null);
    try {
      const res = await updateCmsProfile(cmsProfileForm);
      setCmsPerformer(res.performer);
      setCmsProfileForm((f) => ({ ...f, status: res.performer.status ?? "draft" }));
      setCmsProfileStatus({ ok: true, msg: t.profileUpdated });
    } catch (err) {
      setCmsProfileStatus({ ok: false, msg: err instanceof Error ? err.message : t.profileSaveFailed });
    } finally {
      setCmsProfileSaving(false);
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

  // ── X embed handler ──
  const openXEmbedModal = () => {
    setXEmbedOpen(true);
    setXEmbedUrl("");
    setXEmbedError(null);
    setXEmbedSuccess(false);
    setXEmbedTarget('feed');
    setXEmbedChannelId(null);
    setXEmbedHangoutId(null);
    if (!hangoutsLoaded) {
      getHangoutGroups()
        .then((res) => { setOwnHangouts(res.groups ?? []); setHangoutsLoaded(true); })
        .catch(() => { setHangoutsLoaded(true); });
    }
  };

  const handleXEmbedPublish = async () => {
    if (!xEmbedUrl.trim()) return;
    if (xEmbedTarget === 'channel' && !xEmbedChannelId) {
      setXEmbedError("Please select a channel");
      return;
    }
    if (xEmbedTarget === 'hangout' && !xEmbedHangoutId) {
      setXEmbedError("Please select a hangout group");
      return;
    }
    setXEmbedPosting(true);
    setXEmbedError(null);
    setXEmbedSuccess(false);
    try {
      const { post } = await createXEmbedPost(xEmbedUrl.trim());
      if (xEmbedTarget === 'channel' && xEmbedChannelId) {
        await assignPostToChannel(post.id, xEmbedChannelId);
      } else if (xEmbedTarget === 'hangout' && xEmbedHangoutId) {
        await sharePostToHangouts(post.id, [xEmbedHangoutId]);
      }
      setXEmbedSuccess(true);
      setXEmbedUrl("");
      setTimeout(() => {
        setXEmbedOpen(false);
        setXEmbedSuccess(false);
      }, 1800);
    } catch (err) {
      setXEmbedError(err instanceof Error ? err.message : "Failed to embed tweet");
    } finally {
      setXEmbedPosting(false);
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
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : 'Delete failed. Please try again.');
    }
  };

  const openManagePosts = async (channelId: number) => {
    setManagingChannelId(channelId);
    // Clear stale posts immediately so the previous channel's posts don't flash
    setAssignPosts([]);
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
      // Rollback the optimistic update
      setAssignPosts(prev =>
        prev.map(p =>
          p.id === post.id
            ? { ...p, channel_id: isAssigned ? channelId : undefined } as typeof p
            : p
        )
      );
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

  // ── Channel video list handlers ──
  const loadChannelVideos = async (channelId: number) => {
    setChannelVideosLoading(channelId);
    setChannelVideosError((prev) => ({ ...prev, [channelId]: "" }));
    try {
      const res = await listChannelVideos(channelId);
      setChannelVideos((prev) => ({ ...prev, [channelId]: res.videos }));
    } catch (err) {
      setChannelVideosError((prev) => ({
        ...prev,
        [channelId]: err instanceof Error ? err.message : "Failed to load videos",
      }));
    } finally {
      setChannelVideosLoading(null);
    }
  };

  const toggleChannelVideos = (channelId: number) => {
    if (expandedVideosChannelId === channelId) {
      setExpandedVideosChannelId(null);
    } else {
      setExpandedVideosChannelId(channelId);
      if (!channelVideos[channelId]) {
        void loadChannelVideos(channelId);
      }
    }
  };

  const handleVideoPublished = (channelId: number, video: ChannelVideo) => {
    setChannelVideos((prev) => ({
      ...prev,
      [channelId]: [video, ...(prev[channelId] || [])],
    }));
  };

  const handleDeleteChannelVideoConfirmed = async (channelId: number, videoId: number) => {
    setDeletingVideoId(videoId);
    try {
      await deleteChannelVideo(channelId, videoId);
      setChannelVideos((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] || []).filter((v) => v.id !== videoId),
      }));
    } catch {
      // non-critical; video remains visible; user can retry
    } finally {
      setDeletingVideoId(null);
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
      {/* ── Mi Perfil Media ─────────────────────────────────────────────────── */}
      <div className="glass-card-sm p-4 space-y-4">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Fotos y Videos de Perfil</p>
            <p className="text-xs text-white/40 mt-0.5">Estas aparecen en tu perfil público</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openXEmbedModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 transition-colors hover:text-white"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              aria-label="Embed X post"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Embed X
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadState?.uploading === true}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              aria-label="Agregar foto o video al perfil"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Agregar
            </button>
          </div>
          {/* Hidden file input — no size limit; backend validates */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            className="sr-only"
            onChange={handleFileSelected}
          />
        </div>

        {/* Upload panel — shown when a file is chosen */}
        {uploadState && (
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* File info */}
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {uploadState.file.type.startsWith("video/") ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                )}
              </svg>
              <span className="text-xs text-white/80 truncate min-w-0 flex-1">{uploadState.file.name}</span>
              <span className="text-xs text-white/40 flex-shrink-0">{formatBytes(uploadState.file.size)}</span>
            </div>

            {/* Caption */}
            <div>
              <label className="block text-xs text-white/50 mb-1">Descripción (opcional)</label>
              <input
                type="text"
                value={uploadState.caption}
                onChange={(e) =>
                  setUploadState((prev) => prev ? { ...prev, caption: e.target.value } : null)
                }
                disabled={uploadState.uploading}
                placeholder="Agrega una descripción..."
                maxLength={280}
                className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent disabled:opacity-50"
              />
            </div>

            {/* Visibility radio */}
            <div>
              <p className="text-xs text-white/50 mb-2">Visibilidad</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                  <input
                    type="radio"
                    name="pm-visibility"
                    checked={!uploadState.isPremium}
                    onChange={() =>
                      setUploadState((prev) => prev ? { ...prev, isPremium: false } : null)
                    }
                    disabled={uploadState.uploading}
                    className="accent-pnp-accent"
                  />
                  Gratis
                </label>
                <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                  <input
                    type="radio"
                    name="pm-visibility"
                    checked={uploadState.isPremium}
                    onChange={() =>
                      setUploadState((prev) => prev ? { ...prev, isPremium: true } : null)
                    }
                    disabled={uploadState.uploading}
                    className="accent-pnp-accent"
                  />
                  <span>
                    Exclusivo <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "rgba(212,0,122,0.18)", color: "#D4007A" }}>EXCL</span>
                    <span className="text-xs text-white/40 ml-1">(solo suscriptores)</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Progress bar while uploading */}
            {uploadState.uploading && (
              <div className="space-y-1.5">
                <div className="w-full rounded-full overflow-hidden" style={{ height: "6px", background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(uploadState.progress, 0)}%`, background: "linear-gradient(90deg, #D4007A, #9333ea)" }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-white/50">Subiendo... {uploadState.progress}%</p>
                  <p className="text-[10px] text-white/30">Calidad original preservada — sin compresión</p>
                </div>
              </div>
            )}

            {/* Success flash */}
            {uploadState.successFlash && (
              <p className="text-xs font-semibold" style={{ color: "#5ED1C4" }}>
                Subido correctamente
              </p>
            )}

            {/* Action buttons */}
            {!uploadState.uploading && !uploadState.successFlash && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleStartUpload}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white transition-opacity"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  Subir
                </button>
                <button
                  onClick={handleCancelUpload}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white/60 hover:text-white transition-colors"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  Cancelar
                </button>
                <p className="text-[10px] text-white/30 ml-auto">Calidad original — sin compresión</p>
              </div>
            )}

            {/* Cancel while uploading */}
            {uploadState.uploading && (
              <button
                onClick={handleCancelUpload}
                className="text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                Cancelar subida
              </button>
            )}
          </div>
        )}

        {/* Media error */}
        {mediaError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            {mediaError}
            <button
              onClick={() => { setMediaError(null); loadProfileMedia(); }}
              className="ml-auto text-white/50 hover:text-white underline"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {mediaLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-xl animate-pulse"
                style={{ background: "rgba(255,255,255,0.06)" }}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!mediaLoading && !mediaError && profileMedia.length === 0 && !uploadState && (
          <div className="py-8 text-center">
            <svg className="w-8 h-8 mx-auto mb-3 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <p className="text-sm text-white/40">Sube fotos y videos.</p>
            <p className="text-xs text-white/25 mt-1">Los exclusivos solo los ven tus suscriptores.</p>
          </div>
        )}

        {/* Media grid */}
        {!mediaLoading && profileMedia.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {profileMedia.map((item) => {
              const isToggling = togglingMediaId === item.id;
              const thumb = item.thumbUrl || item.url;
              return (
                <div
                  key={item.id}
                  className="relative rounded-xl overflow-hidden aspect-square"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  {/* Thumbnail */}
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={item.caption || ""}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                      </svg>
                    </div>
                  )}

                  {/* Video play overlay */}
                  {item.type === "video" && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5.14v14l11-7-11-7z" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Premium badge */}
                  <div className="absolute top-1.5 left-1.5">
                    {item.isPremium ? (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: "rgba(147,51,234,0.85)", color: "#fff", backdropFilter: "blur(4px)" }}
                      >
                        EXCL
                      </span>
                    ) : (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
                        style={{ background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.5)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.15)" }}
                      >
                        GRATIS
                      </span>
                    )}
                  </div>

                  {/* Bottom action bar */}
                  <div
                    className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-2 py-1.5"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)" }}
                  >
                    {/* Toggle free/exclusive */}
                    <button
                      onClick={() => handleTogglePremium(item)}
                      disabled={isToggling}
                      className="flex-1 min-w-0 text-[10px] font-semibold rounded-md px-1.5 py-1 text-center transition-opacity disabled:opacity-50 truncate"
                      style={item.isPremium
                        ? { background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }
                        : { background: "rgba(147,51,234,0.3)", color: "#c084fc" }
                      }
                      aria-label={item.isPremium ? "Cambiar a gratis" : "Hacer exclusivo"}
                    >
                      {isToggling ? "..." : item.isPremium ? "Hacer gratis" : "Hacer excl."}
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => setMediaDeleteTarget(item.id)}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-red-500/20"
                      style={{ color: "rgba(255,255,255,0.45)" }}
                      aria-label="Eliminar este elemento"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Media delete confirm */}
        <ConfirmDialog
          open={mediaDeleteTarget !== null}
          title="Eliminar elemento"
          message="Este elemento se eliminará de tu perfil. No se puede deshacer."
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          onConfirm={() => mediaDeleteTarget !== null && handleDeleteMedia(mediaDeleteTarget)}
          onCancel={() => setMediaDeleteTarget(null)}
          variant="danger"
        />
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }} />

      {/* Sub-nav */}
      <div className="flex gap-2 flex-wrap">
        {(["profile", "shows", "channels"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setCmsContentSection(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={cmsContentSection === s
              ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }
              : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }
            }
          >
            {s === "profile" ? t.subNavProfile : s === "shows" ? t.subNavShows : "Channels"}
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
                  <span className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 block">
                    Draft — published by admin review
                  </span>
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

      {/* ── X Embed Modal ── */}
      {xEmbedOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
          onClick={() => setXEmbedOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 space-y-4"
            style={{ background: "var(--pnp-surface, #1C1C1E)", border: "1px solid rgba(255,255,255,0.08)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-white/70" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <p className="text-base font-semibold text-white">Embed X Post</p>
              </div>
              <button onClick={() => setXEmbedOpen(false)} className="text-white/40 hover:text-white text-xl leading-none">&times;</button>
            </div>

            {/* Destination picker */}
            <div className="flex gap-2">
              {(["feed", "channel", "hangout"] as const).map((target) => (
                <button
                  key={target}
                  onClick={() => { setXEmbedTarget(target); setXEmbedChannelId(null); setXEmbedHangoutId(null); setXEmbedError(null); }}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all border"
                  style={xEmbedTarget === target
                    ? { background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff", borderColor: "transparent" }
                    : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.1)" }
                  }
                >
                  {target === 'feed' ? '🌐 Feed' : target === 'channel' ? '📺 Channel' : '🍻 Hangout'}
                </button>
              ))}
            </div>

            {xEmbedTarget === 'channel' && (
              <div>
                <label className="block text-xs text-white/50 mb-1">Select Channel</label>
                {ownChannels.length === 0 ? (
                  <p className="text-xs text-white/40">No channels yet.</p>
                ) : (
                  <select
                    value={xEmbedChannelId ?? ""}
                    onChange={(e) => setXEmbedChannelId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                  >
                    <option value="">— Choose a channel —</option>
                    {ownChannels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                  </select>
                )}
              </div>
            )}

            {xEmbedTarget === 'hangout' && (
              <div>
                <label className="block text-xs text-white/50 mb-1">Select Hangout Group</label>
                {ownHangouts.length === 0 ? (
                  <p className="text-xs text-white/40">No hangout groups found.</p>
                ) : (
                  <select
                    value={xEmbedHangoutId ?? ""}
                    onChange={(e) => setXEmbedHangoutId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                  >
                    <option value="">— Choose a group —</option>
                    {ownHangouts.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs text-white/50 mb-1">Tweet URL</label>
              <input
                type="url"
                value={xEmbedUrl}
                onChange={(e) => { setXEmbedUrl(e.target.value); setXEmbedError(null); }}
                placeholder="https://x.com/username/status/..."
                disabled={xEmbedPosting || xEmbedSuccess}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent disabled:opacity-50"
              />
            </div>

            {xEmbedError && (
              <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                {xEmbedError}
              </div>
            )}

            {xEmbedSuccess && (
              <div className="px-3 py-2 rounded-lg text-xs text-emerald-300" style={{ background: "rgba(52,211,153,0.1)" }}>
                {xEmbedTarget === 'channel' ? 'Tweet embedded and posted to your channel.' : xEmbedTarget === 'hangout' ? 'Tweet embedded and shared to hangout.' : 'Tweet embedded and posted to the feed.'}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleXEmbedPublish}
                disabled={xEmbedPosting || xEmbedSuccess || !xEmbedUrl.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {xEmbedPosting ? "Publishing..." : "Publish"}
              </button>
              <button
                onClick={() => setXEmbedOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5"
              >
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

          {channelsError && <p className="text-red-400 text-xs mt-1">{channelsError}</p>}

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
                      {(() => {
                        const at = ch.accessType ?? (ch.isPremium ? "subscription" : "free");
                        const badges: Record<string, { bg: string; color: string; label: string }> = {
                          free: { bg: "rgba(94,209,196,0.15)", color: "#5ED1C4", label: "Free" },
                          subscription: { bg: "rgba(212,0,122,0.15)", color: "#D4007A", label: "Subscribers" },
                          prime: { bg: "rgba(167,139,250,0.15)", color: "#A78BFA", label: "PRIME" },
                          paid: { bg: "rgba(230,145,56,0.15)", color: "#E69138", label: `$${ch.priceUsd}/mo` },
                        };
                        const b = badges[at] || badges.free;
                        return (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex-shrink-0"
                            style={{ background: b.bg, color: b.color }}
                          >
                            {b.label}
                          </span>
                        );
                      })()}
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

                {/* Action row: Upload Video + Manage Videos + Manage Posts */}
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex gap-2">
                    {/* Upload Video — opens the 5-step wizard */}
                    <div className="flex-1">
                      <UploadVideoButton
                        channelId={ch.id}
                        channelName={ch.name}
                        channelSlug={ch.slug}
                        accessType={ch.accessType ?? "free"}
                        pricePerMonth={ch.priceUsd ?? null}
                        creatorUsername={ch.creatorUsername ?? null}
                        variant="pill"
                        onPublished={(video) => handleVideoPublished(ch.id, video)}
                      />
                    </div>
                    {/* Toggle video list */}
                    <button
                      onClick={() => toggleChannelVideos(ch.id)}
                      className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-white/70 hover:text-white transition-colors flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                      </svg>
                      {expandedVideosChannelId === ch.id ? "Hide Videos" : `Videos${ch.videoCount != null ? ` (${ch.videoCount})` : ""}`}
                    </button>
                  </div>
                  <button
                    onClick={() =>
                      managingChannelId === ch.id
                        ? setManagingChannelId(null)
                        : openManagePosts(ch.id)
                    }
                    className="w-full py-2 rounded-lg text-xs font-semibold text-white/70 hover:text-white transition-colors flex items-center justify-center gap-1.5"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                    {managingChannelId === ch.id ? "Hide Posts" : "Manage Posts"}
                  </button>
                </div>
              </div>

              {/* Video list panel */}
              {expandedVideosChannelId === ch.id && (
                <div className="border-t p-4 space-y-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">Channel Videos</p>
                  {channelVideosLoading === ch.id ? (
                    <div className="text-center py-6 text-white/40 text-sm">Loading videos...</div>
                  ) : channelVideosError[ch.id] ? (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-red-400">{channelVideosError[ch.id]}</p>
                      <button onClick={() => loadChannelVideos(ch.id)} className="text-xs underline text-red-400">Retry</button>
                    </div>
                  ) : !channelVideos[ch.id] || channelVideos[ch.id].length === 0 ? (
                    <div className="text-center py-6 text-white/40 text-sm">No videos yet. Upload your first one above.</div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {channelVideos[ch.id].map((vid) => (
                        <div
                          key={vid.id}
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <div className="w-14 h-10 rounded-lg flex-shrink-0 relative overflow-hidden flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)" }}>
                            <svg className="w-4 h-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                            </svg>
                            {(vid.gif_url || vid.thumbnail_url) && (
                              <img
                                src={vid.gif_url || vid.thumbnail_url!}
                                alt={vid.title}
                                className="absolute inset-0 w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white/90 truncate">{vid.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={vid.status === "published"
                                  ? { background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }
                                  : vid.status === "processing"
                                    ? { background: "rgba(230,145,56,0.15)", color: "#E69138" }
                                    : { background: "rgba(255,255,255,0.06)", color: "#8E8E93" }
                                }
                              >
                                {vid.status}
                              </span>
                              {vid.view_count > 0 && (
                                <span className="text-[10px] text-white/35">{vid.view_count} views</span>
                              )}
                              {vid.duration_sec != null && (
                                <span className="text-[10px] text-white/35">
                                  {Math.floor(vid.duration_sec / 60)}:{String(vid.duration_sec % 60).padStart(2, "0")}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteChannelVideoConfirmed(ch.id, vid.id)}
                            disabled={deletingVideoId === vid.id}
                            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}
                          >
                            {deletingVideoId === vid.id ? "..." : "Delete"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
