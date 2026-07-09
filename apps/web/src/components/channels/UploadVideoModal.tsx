/**
 * UploadVideoModal — 5-step wizard for uploading a video to a creator channel.
 *
 *   1. Pick file        (drag-drop / tap)
 *   2. Uploading        (XHR with progress bar)
 *   3. AI assist        (Grok title / description / tags — all editable, all skippable)
 *   4. Preview          (final social_post promo card preview)
 *   5. Publish + done   (calls /publish; success toast; "view" or "upload another")
 *
 * Mobile-first bottom sheet. Desktop centers as a modal.
 *
 * The CTA button on the promo post is rendered later by SocialPostCard, not
 * here — this preview shows the four CTA variants so the creator knows what
 * viewers will see depending on access_type and their entitlements.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  uploadChannelVideoChunked,
  getChannelVideoResume,
  aiTitleChannelVideo,
  aiDescriptionChannelVideo,
  aiTagsChannelVideo,
  updateChannelVideo,
  publishChannelVideo,
  getChannelTagTaxonomy,
  updateVideoTaggedCreators,
  searchCreators,
  type ChannelVideo,
  type MentionUser,
  type ChunkUploadProgress,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";

type AccessType = "free" | "subscription" | "prime" | "paid";

interface Props {
  channelId: number;
  channelName: string;
  channelSlug: string;
  accessType: AccessType;
  pricePerMonth: number | null;
  creatorUsername: string | null;
  onClose: () => void;
  onPublished?: (video: ChannelVideo) => void;
}

type Step = "pick" | "uploading" | "edit" | "preview" | "publishing" | "done";

// Step strings — inline EN/ES per the project pattern (channels are creator-
// facing tools; full i18n bundle integration would be a follow-up cleanup).
const STR = {
  en: {
    title: "Upload to channel",
    pickHint: "Drop a video file here or tap to choose",
    pickButton: "Choose video",
    pickFormats: "MP4, MOV, WebM up to 20 GB",
    uploadCancel: "Cancel upload",
    uploading: "Uploading…",
    uploadProgress: "{pct}% — {ofTotal}",
    titleLabel: "Title",
    titleAi: "✨ Generate with AI",
    titlePlaceholder: "What's this video about?",
    descLabel: "Description",
    descAi: "✨ Generate bilingual (EN/ES)",
    descPlaceholder: "Tease what viewers will see…",
    tagsLabel: "Tags",
    tagsAi: "✨ Suggest tags",
    tagsHint: "Tap to add. Up to 8.",
    backBtn: "← Back",
    nextBtn: "Next →",
    publishBtn: "Publish",
    publishing: "Publishing…",
    publishedTitle: "Published!",
    publishedBody: "Your video is live in {channel}. A teaser GIF was posted to the feed.",
    closeBtn: "Close",
    uploadAnother: "Upload another",
    aiUnavailable: "AI assist unavailable — write your own.",
    requiredTitle: "Add a title to publish",
    previewHeading: "How this will look in the feed",
    previewByline: "Posted by @{creator}",
    previewCtaFree: "Watch now →",
    previewCtaPrime: "Subscribe to PRIME →",
    previewCtaSub: "Subscribe to {creator} →",
    previewCtaPaid: "Get pass — ${price}/mo →",
    previewNote: "Each viewer sees the CTA that matches their entitlements — PRIME members and existing subscribers see “Watch now” instead.",
    announceLabel: "📢 Announce on social feed",
    announceHint: "Posts a teaser to the public feed and notifies your followers (Telegram, push, email).",
    publishedBodySilent: "Your video is live in {channel}. No announcement was posted.",
  },
  es: {
    title: "Subir al canal",
    pickHint: "Arrastra un video aquí o toca para elegir",
    pickButton: "Elegir video",
    pickFormats: "MP4, MOV, WebM hasta 20 GB",
    uploadCancel: "Cancelar carga",
    uploading: "Subiendo…",
    uploadProgress: "{pct}% — {ofTotal}",
    titleLabel: "Título",
    titleAi: "✨ Generar con IA",
    titlePlaceholder: "¿De qué trata el video?",
    descLabel: "Descripción",
    descAi: "✨ Generar bilingüe (EN/ES)",
    descPlaceholder: "Un teaser de lo que verán…",
    tagsLabel: "Tags",
    tagsAi: "✨ Sugerir tags",
    tagsHint: "Toca para agregar. Máx 8.",
    backBtn: "← Atrás",
    nextBtn: "Siguiente →",
    publishBtn: "Publicar",
    publishing: "Publicando…",
    publishedTitle: "¡Publicado!",
    publishedBody: "Tu video está en {channel}. Se posteó un GIF teaser al feed.",
    closeBtn: "Cerrar",
    uploadAnother: "Subir otro",
    aiUnavailable: "IA no disponible — escribe tú mismo.",
    requiredTitle: "Pon un título para publicar",
    previewHeading: "Cómo se verá en el feed",
    previewByline: "Publicado por @{creator}",
    previewCtaFree: "Ver ahora →",
    previewCtaPrime: "Suscríbete a PRIME →",
    previewCtaSub: "Suscríbete a {creator} →",
    previewCtaPaid: "Obtén el pase — ${price}/mes →",
    previewNote: "Cada usuario verá el CTA que corresponde a sus permisos — miembros PRIME o suscritos ven “Ver ahora”.",
    announceLabel: "📢 Anunciar en el feed social",
    announceHint: "Publica un teaser en el feed público y notifica a tus seguidores (Telegram, push, email).",
    publishedBodySilent: "Tu video está en {channel}. No se publicó ningún anuncio.",
  },
};

function fmtBytes(b: number | null | undefined): string {
  if (!b || b <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = b;
  while (v > 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

export function UploadVideoModal({
  channelId, channelName, channelSlug, accessType, pricePerMonth, creatorUsername,
  onClose, onPublished,
}: Props) {
  const i18n = useI18n();
  const s = STR[i18n.lang === "es" ? "es" : "en"];

  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [chunkProgress, setChunkProgress] = useState<ChunkUploadProgress | null>(null);
  const [videoResume, setVideoResume] = useState<{ uploadId: string; chunksUploaded: number } | null>(null);
  const [video, setVideo] = useState<ChannelVideo | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [taxonomy, setTaxonomy] = useState<string[]>([]);

  const [aiBusy, setAiBusy] = useState<"title" | "description" | "tags" | null>(null);
  const [postToFeed, setPostToFeed] = useState(true);

  const [taggedCreators, setTaggedCreators] = useState<MentionUser[]>([]);
  const [creatorTagSearch, setCreatorTagSearch] = useState("");
  const [creatorTagResults, setCreatorTagResults] = useState<MentionUser[]>([]);
  const [creatorTagSearching, setCreatorTagSearching] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("channelUpload");

  // Load taxonomy lazily once we open
  useEffect(() => {
    let cancelled = false;
    getChannelTagTaxonomy(channelId)
      .then((r) => { if (!cancelled) setTaxonomy(r.tags || []); })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [channelId]);

  // ── Step transitions ────────────────────────────────────────────────────

  const handlePickFile = (f: File) => {
    if (!f.type.startsWith("video/")) {
      setError("Only video files are allowed.");
      return;
    }
    if (f.size > 20 * 1024 * 1024 * 1024) {
      setError("File too large (max 20 GB).");
      return;
    }
    setError(null);
    setFile(f);
    const resume = getChannelVideoResume(channelId, f);
    setVideoResume(resume);
    void doUpload(f);
  };

  const doUpload = useCallback(async (f: File) => {
    setStep("uploading");
    setProgressPct(0);
    setChunkProgress(null);
    try {
      const resume = getChannelVideoResume(channelId, f);
      const r = await uploadChannelVideoChunked(channelId, f, {
        title: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 255),
        resumeUploadId: resume?.uploadId,
        resumeChunksDone: resume?.chunksUploaded,
        onProgress: (p) => { setChunkProgress(p); setProgressPct(p.pct); },
      });
      setChunkProgress(null);
      setVideoResume(null);
      setVideo(r.video);
      setTitle(r.video.title);
      setDescription(r.video.description || "");
      setTags(r.video.tags || []);
      setStep("edit");
    } catch (err) {
      setChunkProgress(null);
      setError(err instanceof Error ? err.message : "Upload failed");
      setStep("pick");
    }
  }, [channelId]);

  const persistEdits = useCallback(async () => {
    if (!video) return null;
    const r = await updateChannelVideo(channelId, video.id, {
      title: title.trim(),
      description: description.trim() || null,
      tags,
    });
    setVideo(r.video);
    return r.video;
  }, [channelId, video, title, description, tags]);

  const onClickAiTitle = async () => {
    if (!video) return;
    setAiBusy("title"); setAiError(null);
    try {
      await persistEdits();
      const r = await aiTitleChannelVideo(channelId, video.id);
      setTitle(r.title);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : s.aiUnavailable);
    } finally { setAiBusy(null); }
  };
  const onClickAiDesc = async () => {
    if (!video) return;
    setAiBusy("description"); setAiError(null);
    try {
      await persistEdits();
      const r = await aiDescriptionChannelVideo(channelId, video.id);
      setDescription(r.description);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : s.aiUnavailable);
    } finally { setAiBusy(null); }
  };
  const onClickAiTags = async () => {
    if (!video) return;
    setAiBusy("tags"); setAiError(null);
    try {
      await persistEdits();
      const r = await aiTagsChannelVideo(channelId, video.id);
      setTags(r.tags);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : s.aiUnavailable);
    } finally { setAiBusy(null); }
  };

  const onClickPublish = async () => {
    if (!video) return;
    if (!title.trim()) { setError(s.requiredTitle); return; }
    setError(null);
    setStep("publishing");
    try {
      // Merge all edits (title/desc/tags/post_to_feed) into a single PATCH call
      const updated = await updateChannelVideo(channelId, video.id, {
        title: title.trim(),
        description: description.trim() || null,
        tags,
        post_to_feed: postToFeed,
      });
      setVideo(updated.video);
      if (taggedCreators.length > 0) {
        await updateVideoTaggedCreators(channelId, video.id, taggedCreators.map((c) => c.id)).catch(() => {});
      }
      const r = await publishChannelVideo(channelId, video.id);
      setVideo(r.video);
      setStep("done");
      onPublished?.(r.video);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
      setStep("preview");
    }
  };

  // ── CTA preview for the creator ─────────────────────────────────────────

  const ctaLabel = (() => {
    switch (accessType) {
      case "free": return s.previewCtaFree;
      case "prime": return s.previewCtaPrime;
      case "subscription": return s.previewCtaSub.replace("{creator}", creatorUsername || channelName);
      case "paid": return s.previewCtaPaid.replace("{price}", String(pricePerMonth ?? "?"));
    }
  })();

  // ── Render helpers ──────────────────────────────────────────────────────

  function renderPick() {
    return (
      <div className="px-5 py-6">
        <div
          className="border-2 border-dashed rounded-2xl p-10 text-center"
          style={{ borderColor: "rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.02)" }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handlePickFile(f);
          }}
        >
          <div className="text-5xl mb-3" aria-hidden>🎬</div>
          <p className="text-sm text-white/70 mb-3">{s.pickHint}</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: "linear-gradient(90deg,#ff3377,#ff9933)" }}
          >
            {s.pickButton}
          </button>
          <p className="text-[11px] text-white/40 mt-3">{s.pickFormats}</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handlePickFile(f);
          }}
        />
        {error && <p className="mt-3 text-xs text-red-400 text-center">{error}</p>}
        {file && videoResume && step === "pick" && (
          <p className="text-xs mt-2 text-center" style={{ color: "#D4007A" }}>
            Previous upload can be resumed — tap upload to continue from chunk {videoResume.chunksUploaded}.
          </p>
        )}
      </div>
    );
  }

  function renderUploading() {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-white/70 mb-3">{s.uploading}</p>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div
            className="h-full transition-[width] duration-150"
            style={{
              width: `${progressPct}%`,
              background: "linear-gradient(90deg,#ff3377,#ff9933)",
            }}
          />
        </div>
        <p className="mt-2 text-[11px] text-white/50">
          {chunkProgress
            ? `${chunkProgress.pct}% — ${chunkProgress.doneChunks} / ${chunkProgress.totalChunks} chunks`
            : s.uploadProgress.replace("{pct}", String(progressPct)).replace("{ofTotal}", fmtBytes(file?.size))}
        </p>
      </div>
    );
  }

  function renderEdit() {
    return (
      <div className="px-5 py-5 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase tracking-wider text-white/55 font-semibold">{s.titleLabel}</label>
            <button
              type="button"
              onClick={onClickAiTitle}
              disabled={aiBusy === "title"}
              className="text-[11px] text-white/70 hover:text-white disabled:opacity-50"
            >
              {aiBusy === "title" ? "…" : s.titleAi}
            </button>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={s.titlePlaceholder}
            maxLength={255}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-white border focus:outline-none"
            style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)" }}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase tracking-wider text-white/55 font-semibold">{s.descLabel}</label>
            <button
              type="button"
              onClick={onClickAiDesc}
              disabled={aiBusy === "description"}
              className="text-[11px] text-white/70 hover:text-white disabled:opacity-50"
            >
              {aiBusy === "description" ? "…" : s.descAi}
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={s.descPlaceholder}
            rows={4}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-white border focus:outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)" }}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase tracking-wider text-white/55 font-semibold">{s.tagsLabel}</label>
            <button
              type="button"
              onClick={onClickAiTags}
              disabled={aiBusy === "tags"}
              className="text-[11px] text-white/70 hover:text-white disabled:opacity-50"
            >
              {aiBusy === "tags" ? "…" : s.tagsAi}
            </button>
          </div>
          <p className="text-[11px] text-white/40 mb-2">{s.tagsHint}</p>
          <div className="flex flex-wrap gap-1.5">
            {taxonomy.map((t) => {
              const selected = tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTags((cur) =>
                      cur.includes(t) ? cur.filter((x) => x !== t) : (cur.length >= 8 ? cur : [...cur, t])
                    );
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                  style={{
                    background: selected ? "rgba(255,51,119,0.15)" : "rgba(255,255,255,0.04)",
                    borderColor: selected ? "rgba(255,51,119,0.45)" : "rgba(255,255,255,0.10)",
                    color: selected ? "#ff8aa8" : "rgba(255,255,255,0.65)",
                  }}
                >
                  {selected ? "✓ " : ""}{t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tag Creators */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-white/55 font-semibold mb-1">
            Tag Creators <span className="normal-case font-normal text-white/40">(max 5)</span>
          </label>
          {taggedCreators.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {taggedCreators.map((c) => (
                <span key={c.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-xs text-white/80">
                  @{c.username}
                  <button
                    type="button"
                    onClick={() => setTaggedCreators((prev) => prev.filter((x) => x.id !== c.id))}
                    className="text-white/40 hover:text-white ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {taggedCreators.length < 5 && (
            <div className="relative">
              <input
                type="text"
                value={creatorTagSearch}
                onChange={async (e) => {
                  setCreatorTagSearch(e.target.value);
                  if (e.target.value.trim().length < 2) { setCreatorTagResults([]); return; }
                  setCreatorTagSearching(true);
                  try {
                    const res = await searchCreators(e.target.value.trim());
                    setCreatorTagResults((res.users || []).filter((c) => !taggedCreators.some((t) => t.id === c.id)));
                  } catch { /* ignore */ } finally { setCreatorTagSearching(false); }
                }}
                placeholder={creatorTagSearching ? "Searching…" : "Search creators to tag…"}
                className="w-full px-3 py-2 rounded-xl text-xs text-white border focus:outline-none"
                style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)" }}
              />
              {creatorTagResults.length > 0 && (
                <div
                  className="absolute top-full left-0 right-0 z-10 mt-1 rounded-xl overflow-hidden"
                  style={{ background: "rgba(18,13,20,0.98)", border: "1px solid rgba(255,255,255,0.10)" }}
                >
                  {creatorTagResults.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setTaggedCreators((prev) => [...prev, c]);
                        setCreatorTagSearch("");
                        setCreatorTagResults([]);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
                    >
                      <span className="text-xs text-white/80">@{c.username}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {aiError && <p className="text-xs text-amber-300">{aiError}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setStep("preview")}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: "linear-gradient(90deg,#ff3377,#ff9933)" }}
          >
            {s.nextBtn}
          </button>
        </div>
      </div>
    );
  }

  function renderPreview() {
    return (
      <div className="px-5 py-5">
        <p className="text-[11px] uppercase tracking-wider text-white/55 font-semibold mb-3">{s.previewHeading}</p>
        <div className="rounded-2xl overflow-hidden mb-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
          {video?.thumbnail_url && (
            <img src={video.thumbnail_url} alt={title} className="w-full aspect-video object-cover" />
          )}
          <div className="p-3">
            <p className="text-[11px] text-white/55 mb-1">{s.previewByline.replace("{creator}", creatorUsername || channelName)}</p>
            <p className="text-sm font-bold text-white mb-1">🎬 {title}</p>
            {description && <p className="text-xs text-white/65 mb-2 line-clamp-3 whitespace-pre-line">{description}</p>}
            <div className="mt-2">
              <span
                className="inline-block px-3 py-2 rounded-xl text-xs font-bold text-white"
                style={{ background: "linear-gradient(90deg,#ff3377,#ff9933)" }}
              >
                {ctaLabel}
              </span>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-white/45 leading-relaxed mb-4">{s.previewNote}</p>
        <label
          className="flex items-start gap-2.5 p-3 mb-4 rounded-xl cursor-pointer transition-colors"
          style={{
            background: postToFeed ? "rgba(255,51,119,0.10)" : "rgba(255,255,255,0.04)",
            border: postToFeed ? "1px solid rgba(255,51,119,0.35)" : "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <input
            type="checkbox"
            checked={postToFeed}
            onChange={(e) => setPostToFeed(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-pink-500 cursor-pointer flex-shrink-0"
          />
          <div className="flex-1">
            <p className="text-xs font-semibold text-white">{s.announceLabel}</p>
            <p className="text-[10px] text-white/55 leading-relaxed mt-0.5">{s.announceHint}</p>
          </div>
        </label>
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => setStep("edit")}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-white/70"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            {s.backBtn}
          </button>
          <button
            type="button"
            onClick={onClickPublish}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: "linear-gradient(90deg,#ff3377,#ff9933)" }}
          >
            {s.publishBtn}
          </button>
        </div>
      </div>
    );
  }

  function renderPublishing() {
    return (
      <div className="px-5 py-10 text-center">
        <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-t-transparent animate-spin"
             style={{ borderColor: "#ff3377", borderTopColor: "transparent" }} />
        <p className="text-sm text-white/70">{s.publishing}</p>
      </div>
    );
  }

  function renderDone() {
    return (
      <div className="px-5 py-8 text-center">
        <div className="text-5xl mb-3" aria-hidden>✅</div>
        <h3 className="text-base font-bold text-white mb-1">{s.publishedTitle}</h3>
        <p className="text-xs text-white/65 mb-5">{(postToFeed ? s.publishedBody : s.publishedBodySilent).replace("{channel}", channelName)}</p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setVideo(null); setFile(null); setProgressPct(0);
              setTitle(""); setDescription(""); setTags([]);
              setPostToFeed(true);
              setTaggedCreators([]); setCreatorTagSearch(""); setCreatorTagResults([]);
              setStep("pick");
            }}
            className="px-4 py-2 rounded-xl text-xs font-medium text-white/70"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            {s.uploadAnother}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white"
            style={{ background: "linear-gradient(90deg,#ff3377,#ff9933)" }}
          >
            {s.closeBtn}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    {showTutorial && (
      <TutorialOverlay
        section="channelUpload"
        onDismiss={dismissTutorial}
        onDismissForever={dismissForever}
      />
    )}
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={s.title}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-md max-h-[90dvh] overflow-hidden flex flex-col rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "rgba(18,13,20,0.96)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-bold text-white">{s.title} · {channelName}</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/55 hover:text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {step === "pick" && renderPick()}
          {step === "uploading" && renderUploading()}
          {step === "edit" && renderEdit()}
          {step === "preview" && renderPreview()}
          {step === "publishing" && renderPublishing()}
          {step === "done" && renderDone()}
        </div>
      </div>
    </div>
    </>
  );
}
