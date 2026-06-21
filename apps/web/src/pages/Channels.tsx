import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import {
  getChannels,
  browseCreatorChannels,
  getChannelDetail,
  createCreatorChannel,
  updateCreatorChannel,
  deleteCreatorChannel,
  uploadChannelCover,
  uploadChannelVideo,
  updateChannelVideo,
  deleteChannelVideo,
  aiTitleChannelVideo,
  aiDescriptionChannelVideo,
  aiTagsChannelVideo,
  type Channel,
  type ChannelVideo,
  type CreatorChannel,
} from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { UploadVideoButton } from "@/components/channels/UploadVideoButton";

// ── Tier badge colors ────────────────────────────────────────────────────────
const TIER_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  ice: { bg: "rgba(173,216,230,0.15)", text: "#ADD8E6", label: "Ice" },
  crystal: { bg: "rgba(138,43,226,0.15)", text: "#BA55D3", label: "Crystal" },
  diamond: { bg: "rgba(0,191,255,0.15)", text: "#00BFFF", label: "Diamond" },
  full_time: { bg: "rgba(255,215,0,0.15)", text: "#FFD700", label: "Pro" },
};

// ── Helper ───────────────────────────────────────────────────────────────────
function isValidPhotoUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return url.startsWith("/uploads/") || url.startsWith("http");
}

// ── Creator Channel Card ─────────────────────────────────────────────────────
function CreatorChannelCard({
  channel,
  onClick,
}: {
  channel: CreatorChannel;
  onClick: () => void;
}) {
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const hasCover = isValidPhotoUrl(channel.coverImageUrl);

  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden flex flex-col text-left transition-all hover:scale-[1.02] hover:border-pnp-accent/40 cursor-pointer w-full"
    >
      {/* Cover image / gradient placeholder */}
      <div className="relative w-full aspect-video overflow-hidden">
        {hasCover ? (
          <>
            {!coverLoaded && (
              <div className="absolute inset-0 bg-pnp-surfaceHover animate-pulse" />
            )}
            <img
              src={channel.coverImageUrl!}
              alt=""
              className={`w-full h-full object-cover ${coverLoaded ? "block" : "hidden"}`}
              onLoad={() => setCoverLoaded(true)}
              onError={() => setCoverLoaded(true)}
            />
          </>
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: `linear-gradient(135deg, hsl(${(channel.id * 47) % 360}, 60%, 20%), hsl(${(channel.id * 47 + 120) % 360}, 60%, 15%))`,
            }}
          />
        )}

        {/* Access type badge */}
        {(() => {
          const at = channel.accessType ?? (channel.isPremium ? "subscription" : "free");
          let bg = "rgba(94,209,196,0.85)";
          let label = "Free";
          if (at === "prime") { bg = "rgba(167,139,250,0.85)"; label = "Prime"; }
          else if (at === "subscription") { bg = "rgba(212,0,122,0.85)"; label = "Premium"; }
          else if (at === "paid") { bg = "rgba(230,145,56,0.85)"; label = `$${channel.priceUsd ?? 0}`; }
          return (
            <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
              style={{ background: bg, color: "#fff" }}>
              {label}
              {channel.hangoutGroupId && (
                <svg className="w-2.5 h-2.5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </span>
          );
        })()}
        {channel.collaborators && channel.collaborators.length > 0 && (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
            style={{ background: "rgba(230,145,56,0.85)", color: "#fff" }}>
            Joint
          </span>
        )}
      </div>

      <div className="p-3 flex-1 flex flex-col gap-2">
        {/* Channel name */}
        <p className="text-sm font-semibold text-pnp-textPrimary leading-tight line-clamp-1">
          {channel.name}
        </p>

        {/* Tags */}
        {channel.tags && channel.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {channel.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] text-pnp-textSecondary"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Creator info + post count */}
        <div className="flex items-center justify-between mt-auto pt-1 border-t border-pnp-border/50">
          <div className="flex items-center gap-1.5 min-w-0">
            {isValidPhotoUrl(channel.creatorPhotoUrl) ? (
              <img
                src={channel.creatorPhotoUrl!}
                alt=""
                className={`w-5 h-5 rounded-full object-cover flex-shrink-0 ${avatarLoaded ? "block" : "hidden"}`}
                onLoad={() => setAvatarLoaded(true)}
                onError={() => setAvatarLoaded(true)}
              />
            ) : (
              <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {(channel.creatorName || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-[11px] text-pnp-textSecondary truncate">
              {channel.creatorName || channel.creatorUsername || "Creator"}
            </span>
            {channel.creatorVerified && (
              <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <span className="text-[11px] text-pnp-textSecondary flex-shrink-0">
            {channel.videoCount != null && channel.videoCount > 0
              ? `${channel.videoCount} video${channel.videoCount !== 1 ? "s" : ""}`
              : `${channel.postCount} post${channel.postCount !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Channel Detail View ──────────────────────────────────────────────────────
function ChannelDetailView({
  channelId,
  onBack,
  onUpdated,
  onDeleted,
}: {
  channelId: number;
  onBack: () => void;
  onUpdated?: (channel: CreatorChannel) => void;
  onDeleted?: (channelId: number) => void;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<CreatorChannel | null>(null);
  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [playingVideo, setPlayingVideo] = useState<{ url: string; title?: string } | null>(null);

  // ── Per-video management (owner) ──
  const [editingVideoId, setEditingVideoId] = useState<number | null>(null);
  const [videoEditForm, setVideoEditForm] = useState<{ title: string; description: string; tags: string }>({ title: "", description: "", tags: "" });
  const [videoEditSaving, setVideoEditSaving] = useState(false);
  const [videoEditError, setVideoEditError] = useState<string | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<number | null>(null);
  const [videoDeleteLoading, setVideoDeleteLoading] = useState(false);

  const [videoAiBusy, setVideoAiBusy] = useState<"title" | "description" | "tags" | null>(null);

  const openVideoEdit = (v: ChannelVideo) => {
    setEditingVideoId(v.id);
    setVideoEditForm({ title: v.title || "", description: v.description || "", tags: (v.tags || []).join(", ") });
    setVideoEditError(null);
    setVideoAiBusy(null);
  };

  // Save current form state then call AI — same pattern as the upload wizard
  const saveAndRunAi = async (field: "title" | "description" | "tags") => {
    if (!channel || editingVideoId === null) return;
    setVideoAiBusy(field); setVideoEditError(null);
    try {
      // Persist current text so the AI reads what the user typed
      const tags = videoEditForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      await updateChannelVideo(channel.id, editingVideoId, {
        title: videoEditForm.title.trim(),
        description: videoEditForm.description.trim() || null,
        tags,
      });
      if (field === "title") {
        const r = await aiTitleChannelVideo(channel.id, editingVideoId);
        setVideoEditForm((p) => ({ ...p, title: r.title }));
      } else if (field === "description") {
        const r = await aiDescriptionChannelVideo(channel.id, editingVideoId);
        setVideoEditForm((p) => ({ ...p, description: r.description }));
      } else {
        const r = await aiTagsChannelVideo(channel.id, editingVideoId);
        setVideoEditForm((p) => ({ ...p, tags: (r.tags || []).join(", ") }));
      }
    } catch (err) {
      setVideoEditError(err instanceof Error ? err.message : "AI unavailable");
    } finally { setVideoAiBusy(null); }
  };

  const saveVideoEdit = async () => {
    if (!channel || editingVideoId === null) return;
    setVideoEditSaving(true); setVideoEditError(null);
    try {
      const tags = videoEditForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const r = await updateChannelVideo(channel.id, editingVideoId, { title: videoEditForm.title.trim(), description: videoEditForm.description.trim() || null, tags });
      setVideos((prev) => prev.map((v) => v.id === editingVideoId ? { ...v, ...r.video } : v));
      setEditingVideoId(null);
    } catch (err) {
      setVideoEditError(err instanceof Error ? err.message : "Save failed");
    } finally { setVideoEditSaving(false); }
  };

  const confirmVideoDelete = async () => {
    if (!channel || deletingVideoId === null) return;
    setVideoDeleteLoading(true);
    try {
      await deleteChannelVideo(channel.id, deletingVideoId);
      setVideos((prev) => prev.filter((v) => v.id !== deletingVideoId));
      setDeletingVideoId(null);
    } catch (err) {
      setVideoEditError(err instanceof Error ? err.message : "Delete failed");
    } finally { setVideoDeleteLoading(false); }
  };

  // ── Edit channel ─────────────────────────────────────────────────────────
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; description: string; tags: string; accessType: 'free' | 'prime' | 'subscription' | 'paid'; priceUsd: number; telegramChannelId: string; bridgeEnabled: boolean }>({ name: "", description: "", tags: "", accessType: "free", priceUsd: 0, telegramChannelId: "", bridgeEnabled: false });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // ── Direct CMS video upload (owner-only) ──
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const handleVideoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !channel) return;
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setVideoError("Video must be under 2 GB");
      return;
    }
    setVideoError(null);
    setVideoUploading(true);
    try {
      const res = await uploadChannelVideo(channel.id, file);
      if (res?.success) {
        setChannel((prev) =>
          prev ? { ...prev, postCount: (prev.postCount || 0) + 1 } : prev,
        );
      }
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setVideoUploading(false);
    }
  };

  const openEdit = () => {
    if (!channel) return;
    setEditForm({
      name: channel.name,
      description: channel.description || "",
      tags: (channel.tags || []).join(", "),
      accessType: channel.accessType ?? (channel.isPremium ? "subscription" : "free"),
      priceUsd: channel.priceUsd ?? 0,
      telegramChannelId: channel.telegramChannelId || "",
      bridgeEnabled: channel.bridgeEnabled === true,
    });
    setEditError(null);
    setCoverPreview(null);
    setCoverFile(null);
    setShowEditForm(true);
  };

  const saveEdit = async () => {
    if (!channel || !editForm.name.trim()) { setEditError("Channel name is required"); return; }
    setEditSaving(true);
    setEditError(null);
    try {
      const tags = editForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await updateCreatorChannel(channel.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || undefined,
        tags,
        accessType: editForm.accessType,
        priceUsd: editForm.accessType === "paid" ? editForm.priceUsd : 0,
        telegramChannelId: editForm.telegramChannelId.trim() || null,
        bridgeEnabled: editForm.bridgeEnabled,
      });
      if (res.success) {
        let updated = res.channel;
        if (coverFile) {
          const coverRes = await uploadChannelCover(channel.id, coverFile);
          if (coverRes.success) {
            updated = { ...updated, coverImageUrl: coverRes.coverImageUrl };
          }
        }
        setChannel((prev) => prev ? { ...prev, ...updated } : updated);
        setShowEditForm(false);
        setCoverPreview(null);
        setCoverFile(null);
        onUpdated?.(updated);
      }
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  };

  // ── Delete ──
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDelete = async () => {
    if (!channel) return;
    setDeleteLoading(true);
    try {
      await deleteCreatorChannel(channel.id);
      onDeleted?.(channel.id);
      onBack();
    } catch {
      setDeleteLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  useEffect(() => {
    const refetch = () => {
      setLoading(true);
      setError(null);
      getChannelDetail(channelId)
        .then((res) => {
          if (res.success) {
            setChannel(res.channel);
            setVideos(res.videos ?? []);
            setLocked(res.locked);
          }
        })
        .catch((err) => setError(err.message || "Failed to load channel"))
        .finally(() => setLoading(false));
    };

    refetch();

    // Re-check access when the user returns to this tab (e.g., after subscribing
    // to the creator in another tab and coming back to the channel).
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [channelId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Channels
        </button>
        <div className="w-full aspect-video rounded-xl bg-pnp-surfaceHover animate-pulse" />
        <div className="h-6 w-48 bg-pnp-surfaceHover animate-pulse rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl bg-pnp-surfaceHover animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !channel) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <div className="py-10 text-center text-pnp-textSecondary text-sm">
          {error || "Channel not found"}
        </div>
      </div>
    );
  }

  const hasCover = isValidPhotoUrl(channel.coverImageUrl);

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Channels
      </button>

      {/* Channel header */}
      <div className="rounded-2xl overflow-hidden border border-pnp-border bg-pnp-surface">
        {/* Cover */}
        <div className="relative w-full" style={{ aspectRatio: "3/1", minHeight: 120 }}>
          {hasCover ? (
            <img
              src={channel.coverImageUrl!}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div
              className="w-full h-full"
              style={{
                background: `linear-gradient(135deg, hsl(${(channel.id * 47) % 360}, 60%, 20%), hsl(${(channel.id * 47 + 120) % 360}, 60%, 15%))`,
              }}
            />
          )}
          {(() => {
            const at = channel.accessType ?? (channel.isPremium ? "subscription" : "free");
            if (at === "free") return null;
            let bg = "rgba(212,0,122,0.9)";
            let label = "Premium";
            if (at === "prime") { bg = "rgba(167,139,250,0.9)"; label = "Prime"; }
            else if (at === "paid") { bg = "rgba(230,145,56,0.9)"; label = `$${channel.priceUsd ?? 0}`; }
            return (
              <span className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase"
                style={{ background: bg, color: "#fff" }}>
                {label}
                {channel.hangoutGroupId && (
                  <svg className="w-3 h-3 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </span>
            );
          })()}
        </div>

        {/* Meta */}
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-pnp-textPrimary leading-tight">{channel.name}</h2>
              {channel.description && (
                <p className="text-sm text-pnp-textSecondary mt-1 leading-relaxed">{channel.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-sm text-pnp-textSecondary">
                {(channel.videoCount ?? videos.length)} video{(channel.videoCount ?? videos.length) !== 1 ? "s" : ""}
              </span>
              {channel.isOwner && (
                <>
                  {/* New universal upload flow with AI assist + smart promo
                       — recommended for all channels going forward. */}
                  <UploadVideoButton
                    variant="compact"
                    channelId={channel.id}
                    channelName={channel.name}
                    channelSlug={channel.slug}
                    accessType={(channel.accessType as "free" | "subscription" | "prime" | "paid") || "free"}
                    pricePerMonth={channel.priceUsd ?? null}
                    creatorUsername={channel.creatorUsername ?? null}
                  />
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    className="hidden"
                    onChange={handleVideoFileSelected}
                  />
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    disabled={videoUploading}
                    className="p-1.5 rounded-lg text-pnp-accent hover:text-white hover:bg-pnp-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={videoUploading ? "Uploading video…" : "Legacy upload (no AI assist)"}
                  >
                    {videoUploading ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={openEdit}
                    className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/8 transition-colors"
                    title="Edit channel"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete channel"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Video upload feedback (owner-only) */}
          {channel.isOwner && videoUploading && (
            <div className="rounded-lg border border-pnp-accent/30 bg-pnp-accent/10 px-3 py-2 text-xs text-pnp-accent">
              Uploading video to your CMS folder…
            </div>
          )}
          {channel.isOwner && videoError && !videoUploading && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center justify-between">
              <span>{videoError}</span>
              <button
                onClick={() => setVideoError(null)}
                className="ml-3 text-red-300/70 hover:text-red-200"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {/* Edit form */}
          {showEditForm && channel.isOwner && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <p className="text-sm font-semibold text-pnp-textPrimary">Edit Channel</p>
              {/* Cover image */}
              <div>
                <label className="block text-xs text-white/50 mb-1">Channel Picture</label>
                <div
                  className="relative w-full rounded-lg overflow-hidden cursor-pointer group border border-white/10 hover:border-pnp-accent/50 transition-colors"
                  style={{ aspectRatio: "3/1", minHeight: 80 }}
                  onClick={() => coverInputRef.current?.click()}
                >
                  {coverPreview || isValidPhotoUrl(channel.coverImageUrl) ? (
                    <img
                      src={coverPreview || channel.coverImageUrl!}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{
                        background: `linear-gradient(135deg, hsl(${(channel.id * 47) % 360}, 60%, 20%), hsl(${(channel.id * 47 + 120) % 360}, 60%, 15%))`,
                      }}
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-1.5 text-white text-xs font-medium">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      Change Picture
                    </div>
                  </div>
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) { setEditError("Image must be under 5MB"); return; }
                    setCoverFile(file);
                    setCoverPreview(URL.createObjectURL(file));
                    setEditError(null);
                  }}
                />
                <p className="text-[10px] text-white/30 mt-1">JPEG, PNG, WebP, GIF — max 5MB</p>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Channel Name *</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Tags (comma-separated)</label>
                <input
                  value={editForm.tags}
                  onChange={(e) => setEditForm((p) => ({ ...p, tags: e.target.value }))}
                  placeholder="e.g. exclusive, photos, bts"
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                />
              </div>
              {/* Access type selector */}
              <div>
                <label className="block text-xs text-white/50 mb-2">Access Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: "free" as const, label: "Free", color: "#5ED1C4", bg: "rgba(94,209,196,0.15)" },
                    { value: "subscription" as const, label: "Incl. with my subscription", color: "#D4007A", bg: "rgba(212,0,122,0.15)" },
                    { value: "prime" as const, label: "Included with PRIME", color: "#A78BFA", bg: "rgba(167,139,250,0.15)" },
                    { value: "paid" as const, label: "Paid (monthly)", color: "#E69138", bg: "rgba(230,145,56,0.15)" },
                  ]).map(({ value, label, color, bg }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEditForm((p) => ({ ...p, accessType: value, priceUsd: value !== "paid" ? 0 : (p.priceUsd || 5) }))}
                      className="py-2 px-3 rounded-lg text-xs font-medium transition-all border"
                      style={editForm.accessType === value
                        ? { background: bg, color, borderColor: color }
                        : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", borderColor: "rgba(255,255,255,0.1)" }
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {editForm.accessType === "paid" && (
                <div>
                  <label className="block text-xs text-white/50 mb-2">Price per 30 days (USD)</label>
                  <div className="flex gap-2 flex-wrap items-center">
                    {[5, 10, 15, 20, 25].map((price) => (
                      <button
                        key={price}
                        type="button"
                        onClick={() => setEditForm((p) => ({ ...p, priceUsd: price }))}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border"
                        style={editForm.priceUsd === price
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
                      value={editForm.priceUsd || ""}
                      onChange={(e) => setEditForm((p) => ({ ...p, priceUsd: Number(e.target.value) || 0 }))}
                      placeholder="Custom"
                      className="w-24 px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>
                  <p className="text-[10px] text-white/30 mt-1.5">$0.99 – $999.99 per 30-day pass</p>
                </div>
              )}
              {/* Telegram Bridge */}
              <div className="pt-1 border-t border-white/10">
                <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Telegram Bridge</p>
                <div className="mb-2">
                  <label className="block text-xs text-white/50 mb-1">Telegram Channel ID or @username</label>
                  <input
                    value={editForm.telegramChannelId}
                    onChange={(e) => setEditForm((p) => ({ ...p, telegramChannelId: e.target.value, bridgeEnabled: p.bridgeEnabled && !!e.target.value.trim() }))}
                    placeholder="-1001234567890 or @mychannel"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent font-mono"
                  />
                </div>
                {editForm.telegramChannelId.trim() && (
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.bridgeEnabled}
                      onChange={(e) => setEditForm((p) => ({ ...p, bridgeEnabled: e.target.checked }))}
                      className="w-4 h-4 rounded accent-[#D4007A]"
                    />
                    <span className="text-sm text-white/80">Enable auto-mirror</span>
                  </label>
                )}
              </div>
              {editError && (
                <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                  {editError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={saveEdit}
                  disabled={editSaving || !editForm.name.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {editSaving ? "Saving..." : "Save Changes"}
                </button>
                <button
                  onClick={() => setShowEditForm(false)}
                  className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Delete confirmation */}
          {showDeleteConfirm && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-3">
              <p className="text-sm font-semibold text-red-300">Delete this channel?</p>
              <p className="text-xs text-white/50">This will permanently delete <span className="text-white/80 font-medium">{channel.name}</span> and remove all its posts. This cannot be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={handleDelete}
                  disabled={deleteLoading}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {deleteLoading ? "Deleting..." : "Yes, Delete"}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Tags */}
          {channel.tags && channel.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {channel.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded text-xs text-pnp-textSecondary"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Creator attribution */}
          <div className="flex items-center gap-2 pt-1 border-t border-pnp-border/50">
            {isValidPhotoUrl(channel.creatorPhotoUrl) ? (
              <img
                src={channel.creatorPhotoUrl!}
                alt=""
                className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                {(channel.creatorName || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-sm text-pnp-textSecondary">
              {channel.creatorName || channel.creatorUsername || "Creator"}
            </span>
            {channel.creatorVerified && (
              <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
            {channel.collaborators && channel.collaborators.length > 0 && (
              <span
                className="ml-auto flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                style={{ background: "rgba(230,145,56,0.15)", color: "#E69138", border: "1px solid rgba(230,145,56,0.3)" }}
              >
                Joint Channel
              </span>
            )}
          </div>

          {/* Collaborators list */}
          {channel.collaborators && channel.collaborators.length > 0 && (
            <div className="pt-2 border-t border-pnp-border/50">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-pnp-textSecondary mb-1.5">
                Collaborators
              </p>
              <div className="flex flex-wrap gap-1.5">
                {channel.collaborators.map((uid) => (
                  <span
                    key={uid}
                    className="px-2 py-0.5 rounded-full text-xs text-pnp-textSecondary"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    {uid}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Locked overlay */}
      {locked ? (
        <div className="relative rounded-2xl border border-pnp-border bg-pnp-surface overflow-hidden">
          {/* Lock overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "rgba(212,0,122,0.15)", border: "1px solid rgba(212,0,122,0.3)" }}>
              <svg className="w-6 h-6" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="text-white font-semibold text-base">Premium Channel</p>
            <p className="text-sm text-center" style={{ color: "var(--pnp-text-secondary)" }}>
              Subscribe to {channel.creatorName || "this creator"} to access this channel
            </p>
            <button
              className="mt-1 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              onClick={() => {
                if (channel.creatorId) window.location.href = `/profile/${channel.creatorId}`;
              }}
            >
              Subscribe to Access
            </button>
          </div>
        </div>
      ) : videos.length === 0 ? (
        <div className="py-12 text-center text-pnp-textSecondary text-sm">
          No videos in this channel yet
        </div>
      ) : (
        <div className="space-y-2">
          {videos.map((v) => {
            const previewSrc = v.gif_url || v.thumbnail_url;
            const isEditing = editingVideoId === v.id;
            const isDeleting = deletingVideoId === v.id;
            return (
              <div key={`cv-${v.id}`} className="rounded-xl overflow-hidden border border-pnp-border bg-pnp-surface">
                {/* Thumbnail row */}
                <div
                  className="relative w-full aspect-video bg-pnp-surfaceHover group cursor-pointer"
                  onClick={() => setPlayingVideo({ url: v.video_url, title: v.title })}
                >
                  {previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-full h-full bg-pnp-surfaceHover" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors pointer-events-none">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)" }}>
                      <svg className="w-5 h-5 text-white drop-shadow ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Info row */}
                <div className="px-3 py-2 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-pnp-textPrimary line-clamp-1">{v.title || "Untitled"}</p>
                    {v.description && <p className="text-xs text-pnp-textSecondary mt-0.5 line-clamp-2">{v.description}</p>}
                    {v.tags && v.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {v.tags.slice(0, 4).map((t) => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {channel.isOwner && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openVideoEdit(v)}
                        className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/8 transition-colors"
                        title="Edit video"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeletingVideoId(v.id)}
                        className="p-1.5 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete video"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline edit form */}
                {isEditing && (
                  <div className="px-3 pb-3 space-y-2 border-t border-white/8 pt-2">
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-[10px] text-white/40">Title</label>
                        <button type="button" onClick={() => saveAndRunAi("title")} disabled={videoAiBusy !== null}
                          className="text-[10px] text-white/50 hover:text-white disabled:opacity-40 transition-colors">
                          {videoAiBusy === "title" ? "…" : "✨ AI title"}
                        </button>
                      </div>
                      <input
                        value={videoEditForm.title}
                        onChange={(e) => setVideoEditForm((p) => ({ ...p, title: e.target.value }))}
                        maxLength={255}
                        className="w-full px-2.5 py-1.5 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-[10px] text-white/40">Description</label>
                        <button type="button" onClick={() => saveAndRunAi("description")} disabled={videoAiBusy !== null}
                          className="text-[10px] text-white/50 hover:text-white disabled:opacity-40 transition-colors">
                          {videoAiBusy === "description" ? "…" : "✨ AI description"}
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={videoEditForm.description}
                        onChange={(e) => setVideoEditForm((p) => ({ ...p, description: e.target.value }))}
                        className="w-full px-2.5 py-1.5 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-[10px] text-white/40">Tags (comma-separated)</label>
                        <button type="button" onClick={() => saveAndRunAi("tags")} disabled={videoAiBusy !== null}
                          className="text-[10px] text-white/50 hover:text-white disabled:opacity-40 transition-colors">
                          {videoAiBusy === "tags" ? "…" : "✨ AI tags"}
                        </button>
                      </div>
                      <input
                        value={videoEditForm.tags}
                        onChange={(e) => setVideoEditForm((p) => ({ ...p, tags: e.target.value }))}
                        className="w-full px-2.5 py-1.5 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                      />
                    </div>
                    {videoEditError && <p className="text-xs text-red-400">{videoEditError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={saveVideoEdit}
                        disabled={videoEditSaving}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
                      >
                        {videoEditSaving ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingVideoId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs text-white/50 border border-white/10 hover:bg-white/5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Delete confirm */}
                {isDeleting && (
                  <div className="px-3 pb-3 pt-2 border-t border-red-500/20 space-y-2">
                    <p className="text-xs text-red-300">Delete this video? This cannot be undone.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={confirmVideoDelete}
                        disabled={videoDeleteLoading}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
                      >
                        {videoDeleteLoading ? "Deleting…" : "Yes, Delete"}
                      </button>
                      <button
                        onClick={() => setDeletingVideoId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs text-white/50 border border-white/10 hover:bg-white/5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Video Player Modal */}
      {playingVideo && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setPlayingVideo(null)}
        >
          <div
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{ background: "#0A0A14" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-sm font-semibold text-white truncate flex-1 mr-2">
                {playingVideo.title || "Video"}
              </p>
              <button
                onClick={() => setPlayingVideo(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Video */}
            <video
              src={playingVideo.url}
              controls
              autoPlay
              playsInline
              controlsList="nodownload"
              onContextMenu={(e) => e.preventDefault()}
              className="w-full max-h-[70vh] object-contain bg-black"
              preload="auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Creator Card (existing) ───────────────────────────────────────────────────
function ChannelCard({ channel, onClick }: { channel: Channel; onClick: () => void }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const tier = TIER_COLORS[channel.creatorType] || TIER_COLORS.ice;
  const hasPreview = isValidPhotoUrl(channel.latestMediaUrl);

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-pnp-surface overflow-hidden flex flex-col text-center transition-all hover:scale-[1.02] hover:border-pnp-accent/40 cursor-pointer w-full ${
        channel.isLive ? "border-red-500/50 ring-1 ring-red-500/20" : "border-pnp-border"
      }`}
    >
      {/* Preview thumbnail */}
      {hasPreview && (
        <div className="relative w-full aspect-video bg-pnp-surfaceHover">
          {!previewLoaded && (
            <div className="absolute inset-0 bg-pnp-surfaceHover animate-pulse" />
          )}
          <img
            src={channel.latestMediaUrl!}
            alt=""
            className={`w-full h-full object-cover ${previewLoaded ? "block" : "hidden"}`}
            onLoad={() => setPreviewLoaded(true)}
            onError={() => setPreviewLoaded(true)}
          />
          {channel.isLive && (
            <span className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
        </div>
      )}

      <div className="p-4 flex flex-col items-center">
        {/* Avatar */}
        <div className="relative mb-3">
          {!imgLoaded && (
            <div className={`${hasPreview ? "w-14 h-14" : "w-20 h-20"} rounded-full bg-pnp-surfaceHover animate-pulse`} />
          )}
          <img
            src={isValidPhotoUrl(channel.photoUrl) ? channel.photoUrl : "/default-performer.svg"}
            alt={channel.displayName}
            className={`${hasPreview ? "w-14 h-14" : "w-20 h-20"} rounded-full object-cover border-2 ${
              channel.isLive ? "border-red-500" : "border-pnp-border"
            } ${imgLoaded ? "block" : "hidden"}`}
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              (e.target as HTMLImageElement).src = "/default-performer.svg";
              setImgLoaded(true);
            }}
          />
          {channel.isLive && !hasPreview && (
            <span className="absolute -top-1 -right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
          )}
        </div>

        {/* Name + verified */}
        <div className="flex items-center gap-1 mb-1">
          <span className="text-sm font-semibold text-pnp-textPrimary truncate max-w-[120px]">
            {channel.displayName}
          </span>
          {channel.verified && (
            <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          )}
        </div>

        {/* Tier badge */}
        <span
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full mb-2"
          style={{ background: tier.bg, color: tier.text }}
        >
          {tier.label}
        </span>

        {/* Stats */}
        <div className="flex items-center gap-3 text-[11px] text-pnp-textSecondary">
          <span>{channel.subscriberCount} subs</span>
          <span className="w-0.5 h-0.5 rounded-full bg-pnp-textSecondary" />
          <span>{channel.videoCount != null && channel.videoCount > 0 ? `${channel.videoCount} videos` : `${channel.postCount} posts`}</span>
        </div>

        {/* Featured badge */}
        {channel.featured && (
          <span className="text-[10px] mt-1.5 font-semibold" style={{ color: "#5ED1C4" }}>
            Featured
          </span>
        )}
      </div>
    </button>
  );
}

// ── Free-user upgrade wall ────────────────────────────────────────────────────
function MembersOnlyWall({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 px-6 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.3)" }}>
        <svg className="w-8 h-8" style={{ color: "#D4007A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-bold text-pnp-textPrimary mb-2">Members Only</h2>
        <p className="text-sm text-pnp-textSecondary max-w-xs">{message}</p>
      </div>
      <button
        onClick={() => navigate('/plans')}
        className="px-6 py-3 rounded-xl text-sm font-bold text-white"
        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
      >
        See plans →
      </button>
      <button onClick={() => navigate(-1)} className="text-xs text-pnp-textSecondary hover:text-pnp-textPrimary">
        ← Go back
      </button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Channels() {
  const { user } = useAuth();

  if (!user || user.tier === 'free') {
    return <MembersOnlyWall message="Channels and exclusive content require a PNPtv! membership." />;
  }

  return <ChannelsInner />;
}

function ChannelsInner() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Selected channel for detail view
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);

  // ── Creator profile state (feeds the pill strip at the bottom of the page) ──
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Creator channels state (the main grid) ──
  const [creatorChannels, setCreatorChannels] = useState<CreatorChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsSearch, setChannelsSearch] = useState("");
  const [debouncedChannelsSearch, setDebouncedChannelsSearch] = useState("");
  const [channelsPage, setChannelsPage] = useState(0);
  const [channelsHasMore, setChannelsHasMore] = useState(false);
  const [channelsTotal, setChannelsTotal] = useState(0);
  const [channelsLoadingMore, setChannelsLoadingMore] = useState(false);

  const channelsSentinelRef = useRef<HTMLDivElement>(null);

  // ── Create channel form (Channels page shortcut) ──
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "", tags: "", isPremium: false, telegramChannelId: "", bridgeEnabled: false });
  const [createFormSaving, setCreateFormSaving] = useState(false);
  const [createFormError, setCreateFormError] = useState<string | null>(null);

  const handleQuickCreate = async () => {
    if (!createForm.name.trim()) { setCreateFormError("Channel name is required"); return; }
    setCreateFormSaving(true);
    setCreateFormError(null);
    try {
      const tags = createForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await createCreatorChannel({
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        tags,
        isPremium: createForm.isPremium,
        telegramChannelId: createForm.telegramChannelId.trim() || null,
        bridgeEnabled: createForm.bridgeEnabled,
      });
      if (res.success) {
        setCreatorChannels((prev) => [res.channel, ...prev]);
        setShowCreateForm(false);
        setCreateForm({ name: "", description: "", tags: "", isPremium: false, telegramChannelId: "", bridgeEnabled: false });
        setSelectedChannelId(res.channel.id);
      }
    } catch (err: unknown) {
      setCreateFormError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setCreateFormSaving(false);
    }
  };

  // ── Debounce search (channels) ──
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedChannelsSearch(channelsSearch), 300);
    return () => clearTimeout(timer);
  }, [channelsSearch]);

  // ── Fetch creator profiles (feeds the pill strip — popular first, top 24 is
  // plenty for a horizontal scroll) ──
  const fetchChannels = useCallback(
    async () => {
      setLoading(true);
      try {
        const res = await getChannels({ sort: "popular", page: 0, limit: 24 });
        if (res.success) {
          setChannels(res.channels);
        }
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ── Fetch creator channels ──
  const fetchCreatorChannels = useCallback(
    async (pageNum: number, append = false) => {
      if (!append) setChannelsLoading(true);
      else setChannelsLoadingMore(true);
      try {
        const res = await browseCreatorChannels({
          search: debouncedChannelsSearch || undefined,
          page: pageNum,
          limit: 24,
        });
        if (res.success) {
          setCreatorChannels((prev) => (append ? [...prev, ...res.channels] : res.channels));
          setChannelsHasMore(res.nextPage !== null);
          setChannelsTotal(res.total);
          setChannelsPage(pageNum);
        }
      } catch {
        // non-critical
      } finally {
        setChannelsLoading(false);
        setChannelsLoadingMore(false);
      }
    },
    [debouncedChannelsSearch]
  );

  // ── Trigger fetches ──
  // Channels drive the main grid; creators feed the pill strip below it.
  useEffect(() => { fetchChannels(); }, [fetchChannels]);
  useEffect(() => { fetchCreatorChannels(0); }, [fetchCreatorChannels]);

  // ── Real-time live status via Socket.IO ──
  useEffect(() => {
    const socket = connectSocket();
    const handleLive = ({ userId }: { userId: string }) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === userId ? { ...ch, isLive: true } : ch))
      );
    };
    const handleOffline = ({ userId }: { userId: string }) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === userId ? { ...ch, isLive: false, hlsUrl: null } : ch))
      );
    };
    socket.on("channel:live", handleLive);
    socket.on("channel:offline", handleOffline);
    return () => {
      socket.off("channel:live", handleLive);
      socket.off("channel:offline", handleOffline);
    };
  }, []);

  // ── Infinite scroll (creator channels — the main grid) ──
  useEffect(() => {
    if (!channelsSentinelRef.current || !channelsHasMore || channelsLoadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && channelsHasMore && !channelsLoadingMore) {
          fetchCreatorChannels(channelsPage + 1, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(channelsSentinelRef.current);
    return () => observer.disconnect();
  }, [channelsHasMore, channelsLoadingMore, channelsPage, fetchCreatorChannels]);

  // ── If channel detail is open, render that view ──
  if (selectedChannelId !== null) {
    return (
      <>
        <Helmet>
          <title>Channel — PNPtv!</title>
        </Helmet>
        <div className="max-w-6xl mx-auto px-4 py-6">
          <ChannelDetailView
            channelId={selectedChannelId}
            onBack={() => setSelectedChannelId(null)}
            onUpdated={(updated) =>
              setCreatorChannels((prev) =>
                prev.map((ch) => (ch.id === updated.id ? { ...ch, ...updated } : ch))
              )
            }
            onDeleted={(id) =>
              setCreatorChannels((prev) => prev.filter((ch) => ch.id !== id))
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>Channels — PNPtv!</title>
        <meta name="description" content="Browse PNPtv creator channels" />
      </Helmet>

      <div className="max-w-6xl xl:max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-pnp-textPrimary">PNP Channels</h1>
            <p className="text-sm mt-1 text-pnp-textSecondary">Exclusive content from your favorite creators</p>
          </div>
        </div>

        {/* ── CHANNELS VIEW (primary) ── */}
        <>
            {/* Search + Create button row */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pnp-textSecondary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={channelsSearch}
                  onChange={(e) => setChannelsSearch(e.target.value)}
                  placeholder="Search channels..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent/50 transition-colors"
                />
              </div>
              {user?.creator_status === "active" && (
                <button
                  onClick={() => { setShowCreateForm((v) => !v); setCreateFormError(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white flex-shrink-0 transition-all"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Channel
                </button>
              )}
            </div>

            {/* Inline create channel form */}
            {showCreateForm && user?.creator_status === "active" && (
              <div className="rounded-xl border border-pnp-border bg-pnp-surface p-4 space-y-3">
                <p className="text-sm font-semibold text-pnp-textPrimary">Create New Channel</p>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Channel Name *</label>
                  <input
                    value={createForm.name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Behind the Scenes"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Description</label>
                  <textarea
                    rows={2}
                    value={createForm.description}
                    onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="What's this channel about?"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Tags (comma-separated)</label>
                  <input
                    value={createForm.tags}
                    onChange={(e) => setCreateForm((p) => ({ ...p, tags: e.target.value }))}
                    placeholder="e.g. exclusive, photos, bts"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent"
                  />
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.isPremium}
                    onChange={(e) => setCreateForm((p) => ({ ...p, isPremium: e.target.checked }))}
                    className="w-4 h-4 rounded accent-[#D4007A]"
                  />
                  <span className="text-sm text-white/80">Premium channel</span>
                </label>
                {/* Telegram Bridge */}
                <div className="pt-1 border-t border-white/10">
                  <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Telegram Bridge</p>
                  <div className="mb-2">
                    <label className="block text-xs text-white/50 mb-1">Telegram Channel ID or @username</label>
                    <input
                      value={createForm.telegramChannelId}
                      onChange={(e) => setCreateForm((p) => ({ ...p, telegramChannelId: e.target.value, bridgeEnabled: p.bridgeEnabled && !!e.target.value.trim() }))}
                      placeholder="-1001234567890 or @mychannel"
                      className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-pnp-accent font-mono"
                    />
                    <p className="text-[10px] text-white/30 mt-1">The bot must be an admin of your Telegram channel.</p>
                  </div>
                  {createForm.telegramChannelId.trim() && (
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createForm.bridgeEnabled}
                        onChange={(e) => setCreateForm((p) => ({ ...p, bridgeEnabled: e.target.checked }))}
                        className="w-4 h-4 rounded accent-[#D4007A]"
                      />
                      <span className="text-sm text-white/80">Enable auto-mirror</span>
                    </label>
                  )}
                </div>
                {createFormError && (
                  <div className="px-3 py-2 rounded-lg text-xs text-red-300" style={{ background: "rgba(239,68,68,0.1)" }}>
                    {createFormError}
                  </div>
                )}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleQuickCreate}
                    disabled={createFormSaving || !createForm.name.trim()}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  >
                    {createFormSaving ? "Creating..." : "Create Channel"}
                  </button>
                  <button
                    onClick={() => { setShowCreateForm(false); setCreateFormError(null); }}
                    className="px-4 py-2.5 rounded-xl text-sm text-white/60 border border-white/10 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Total count */}
            {!channelsLoading && (
              <p className="text-xs text-pnp-textSecondary">
                {channelsTotal} channel{channelsTotal !== 1 ? "s" : ""}
                {debouncedChannelsSearch ? ` matching "${debouncedChannelsSearch}"` : ""}
              </p>
            )}

            {/* Channels grid */}
            {channelsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden">
                    <div className="w-full aspect-video bg-pnp-surfaceHover animate-pulse" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 w-3/4 bg-pnp-surfaceHover animate-pulse rounded" />
                      <div className="h-2.5 w-1/2 bg-pnp-surfaceHover animate-pulse rounded" />
                      <div className="h-2 w-full bg-pnp-surfaceHover animate-pulse rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : creatorChannels.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                  style={{ background: "rgba(212,0,122,0.1)" }}
                >
                  <svg className="w-8 h-8 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                  </svg>
                </div>
                <p className="text-pnp-textPrimary font-semibold mb-1">No channels found</p>
                <p className="text-sm text-pnp-textSecondary mb-4">
                  {debouncedChannelsSearch ? "Try a different search term" : "Creators haven't published channels yet"}
                </p>
                {debouncedChannelsSearch && (
                  <Button variant="secondary" size="sm" onClick={() => setChannelsSearch("")}>
                    Clear search
                  </Button>
                )}
              </div>
            ) : (
              <>
                {(() => {
                  const featuredChannel = creatorChannels.find((c) => c.featured);
                  const gridChannels = creatorChannels.filter((c) => !c.featured);
                  return (
                    <>
                      {featuredChannel && (
                        <button
                          onClick={() => setSelectedChannelId(featuredChannel.id)}
                          className="w-full mb-4 group relative rounded-2xl overflow-hidden border border-pnp-accent/40 bg-pnp-surface text-left transition-transform hover:-translate-y-0.5"
                          style={{
                            background: featuredChannel.coverImageUrl
                              ? `linear-gradient(135deg, rgba(167,139,250,0.85) 0%, rgba(212,0,122,0.65) 50%, rgba(0,0,0,0.6) 100%), url(${featuredChannel.coverImageUrl}) center/cover`
                              : "linear-gradient(135deg, rgba(167,139,250,0.9) 0%, rgba(212,0,122,0.85) 100%)",
                          }}
                        >
                          <div className="px-5 py-6 sm:px-7 sm:py-8 flex flex-col sm:flex-row sm:items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/20 text-white backdrop-blur">
                                  Featured · PRIME
                                </span>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/85">
                                  Available to all PRIME members
                                </span>
                              </div>
                              <h2 className="text-2xl sm:text-3xl font-bold text-white drop-shadow-sm">
                                {featuredChannel.name}
                              </h2>
                              {featuredChannel.description && (
                                <p className="mt-1.5 text-sm text-white/90 line-clamp-2 max-w-2xl">
                                  {featuredChannel.description}
                                </p>
                              )}
                              <div className="mt-3 flex items-center gap-3 text-xs text-white/80">
                                <span>{featuredChannel.videoCount != null && featuredChannel.videoCount > 0 ? `${featuredChannel.videoCount} videos` : `${featuredChannel.postCount} posts`}</span>
                                {(featuredChannel.subscriberCount ?? 0) > 0 && (
                                  <>
                                    <span className="w-0.5 h-0.5 rounded-full bg-white/60" />
                                    <span>{featuredChannel.subscriberCount} subs</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex-shrink-0">
                              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-pnp-accent font-semibold text-sm shadow-lg group-hover:scale-105 transition-transform">
                                Enter PRIME
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                              </span>
                            </div>
                          </div>
                        </button>
                      )}
                      {gridChannels.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {gridChannels.map((ch) => (
                            <CreatorChannelCard
                              key={ch.id}
                              channel={ch}
                              onClick={() => setSelectedChannelId(ch.id)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
                {channelsLoadingMore && (
                  <div className="flex justify-center py-4">
                    <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <div ref={channelsSentinelRef} className="h-1" />
              </>
            )}

            {/* ── Creators pill strip (horizontal circle avatars) ── */}
            {!loading && channels.length > 0 && (
              <div className="pt-4 border-t border-pnp-border">
                <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">Creators</h2>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                  {channels.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => navigate(`/profile/${ch.id}`)}
                      className="flex-shrink-0 flex flex-col items-center w-20 group"
                    >
                      <div className="relative">
                        <img
                          src={isValidPhotoUrl(ch.photoUrl) ? ch.photoUrl : "/default-performer.svg"}
                          alt={ch.displayName}
                          className={`w-16 h-16 rounded-full object-cover border-2 ${
                            ch.isLive ? "border-red-500" : "border-pnp-accent"
                          } group-hover:scale-105 transition-transform`}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "/default-performer.svg";
                          }}
                        />
                        {ch.isLive && (
                          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold uppercase">
                            Live
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-pnp-textPrimary mt-1.5 truncate max-w-full">
                        {ch.displayName}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
        </>
      </div>
    </>
  );
}
