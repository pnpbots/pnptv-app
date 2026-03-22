import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@pnptv/ui-kit";
import { useAuth } from "@/hooks/useAuth";
import {
  getChannels,
  browseCreatorChannels,
  getChannelDetail,
  type Channel,
  type CreatorChannel,
  type SocialPostItem,
} from "@/lib/api";
import { connectSocket } from "@/lib/socket";

// ── Tier badge colors ────────────────────────────────────────────────────────
const TIER_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  ice: { bg: "rgba(173,216,230,0.15)", text: "#ADD8E6", label: "Ice" },
  crystal: { bg: "rgba(138,43,226,0.15)", text: "#BA55D3", label: "Crystal" },
  diamond: { bg: "rgba(0,191,255,0.15)", text: "#00BFFF", label: "Diamond" },
  full_time: { bg: "rgba(255,215,0,0.15)", text: "#FFD700", label: "Pro" },
};

const SORT_OPTIONS = [
  { value: "popular", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "az", label: "A\u2013Z" },
] as const;

// ── Helper ───────────────────────────────────────────────────────────────────
function isValidPhotoUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return url.startsWith("/") || url.startsWith("http");
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

        {/* Premium badge */}
        {channel.isPremium && (
          <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
            style={{ background: "rgba(212,0,122,0.85)", color: "#fff" }}>
            Premium
          </span>
        )}
        {!channel.isPremium && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
            style={{ background: "rgba(94,209,196,0.85)", color: "#fff" }}>
            Free
          </span>
        )}
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
            {channel.postCount} post{channel.postCount !== 1 ? "s" : ""}
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
}: {
  channelId: number;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<CreatorChannel | null>(null);
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getChannelDetail(channelId)
      .then((res) => {
        if (res.success) {
          setChannel(res.channel);
          setPosts(res.posts);
          setLocked(res.locked);
        }
      })
      .catch((err) => setError(err.message || "Failed to load channel"))
      .finally(() => setLoading(false));
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
          {channel.isPremium && (
            <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold uppercase"
              style={{ background: "rgba(212,0,122,0.9)", color: "#fff" }}>
              Premium
            </span>
          )}
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
            <span className="text-sm text-pnp-textSecondary flex-shrink-0">
              {channel.postCount} post{channel.postCount !== 1 ? "s" : ""}
            </span>
          </div>

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
          {/* Blurred post preview grid */}
          {posts.length > 0 && (
            <div className="grid grid-cols-3 gap-0.5 blur-sm pointer-events-none select-none" aria-hidden="true">
              {posts.slice(0, 6).map((p) => (
                <div
                  key={p.id}
                  className="aspect-square bg-pnp-surfaceHover flex items-center justify-center"
                >
                  {isValidPhotoUrl(p.media_url) ? (
                    <img src={p.media_url!} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-2">
                      <p className="text-[10px] text-pnp-textSecondary line-clamp-3 text-center">{p.content}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
            <p className="text-sm text-center" style={{ color: "#8E8E93" }}>
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
      ) : posts.length === 0 ? (
        <div className="py-12 text-center text-pnp-textSecondary text-sm">
          No posts in this channel yet
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-pnp-textPrimary">Posts</h3>
          {/* Mixed media grid: images in 3-col, text posts full-width */}
          {(() => {
            const mediaPosts = posts.filter((p) => isValidPhotoUrl(p.media_url));
            const textPosts = posts.filter((p) => !isValidPhotoUrl(p.media_url));
            return (
              <>
                {mediaPosts.length > 0 && (
                  <div className="grid grid-cols-3 gap-1 rounded-xl overflow-hidden">
                    {mediaPosts.map((p) => (
                      <div key={p.id} className="aspect-square bg-pnp-surfaceHover relative overflow-hidden group">
                        <img
                          src={p.media_url!}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        {p.media_type === "video" && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <svg className="w-6 h-6 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {textPosts.map((p) => (
                  <div key={p.id} className="rounded-xl border border-pnp-border bg-pnp-surface p-4">
                    <div className="flex items-center gap-2 mb-2">
                      {isValidPhotoUrl(p.author_photo) ? (
                        <img src={p.author_photo!} alt="" className="w-7 h-7 rounded-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                          {(p.author_first_name || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs font-semibold text-pnp-textPrimary">
                        {p.author_first_name || p.author_username}
                      </span>
                      <span className="text-[11px] text-pnp-textSecondary ml-auto">
                        {new Date(p.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-pnp-textPrimary leading-relaxed line-clamp-4">{p.content}</p>
                    <div className="flex items-center gap-4 mt-2 text-[11px] text-pnp-textSecondary">
                      <span>{p.likes_count} likes</span>
                      <span>{p.replies_count} replies</span>
                    </div>
                  </div>
                ))}
              </>
            );
          })()}
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
          <span>{channel.postCount} posts</span>
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

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Channels() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // View mode: creator profiles vs creator channels
  const [viewMode, setViewMode] = useState<"creators" | "channels">("creators");

  // Selected channel for detail view
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);

  // ── Creator profile state ──
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<"popular" | "newest" | "az">("popular");
  const [filter, setFilter] = useState<"all" | "live" | "featured">("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── Creator channels state ──
  const [creatorChannels, setCreatorChannels] = useState<CreatorChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsSearch, setChannelsSearch] = useState("");
  const [debouncedChannelsSearch, setDebouncedChannelsSearch] = useState("");
  const [channelsPage, setChannelsPage] = useState(0);
  const [channelsHasMore, setChannelsHasMore] = useState(false);
  const [channelsTotal, setChannelsTotal] = useState(0);
  const [channelsLoadingMore, setChannelsLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const channelsSentinelRef = useRef<HTMLDivElement>(null);

  // ── Debounce search (creators) ──
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Debounce search (channels) ──
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedChannelsSearch(channelsSearch), 300);
    return () => clearTimeout(timer);
  }, [channelsSearch]);

  // ── Fetch creator profiles ──
  const fetchChannels = useCallback(
    async (pageNum: number, append = false) => {
      if (!append) setLoading(true);
      else setLoadingMore(true);
      try {
        const res = await getChannels({
          search: debouncedSearch || undefined,
          live: filter === "live" || undefined,
          featured: filter === "featured" || undefined,
          sort,
          page: pageNum,
          limit: 24,
        });
        if (res.success) {
          setChannels((prev) => (append ? [...prev, ...res.channels] : res.channels));
          setHasMore(res.nextPage !== null);
          setTotal(res.total);
          setPage(pageNum);
        }
      } catch {
        // non-critical
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedSearch, filter, sort]
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

  // ── Trigger fetches on mode/filter/search change ──
  useEffect(() => {
    if (viewMode === "creators") {
      fetchChannels(0);
    }
  }, [viewMode, fetchChannels]);

  useEffect(() => {
    if (viewMode === "channels") {
      fetchCreatorChannels(0);
    }
  }, [viewMode, fetchCreatorChannels]);

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

  // ── Infinite scroll (creators) ──
  useEffect(() => {
    if (viewMode !== "creators" || !sentinelRef.current || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore) {
          fetchChannels(page + 1, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [viewMode, hasMore, loadingMore, page, fetchChannels]);

  // ── Infinite scroll (creator channels) ──
  useEffect(() => {
    if (viewMode !== "channels" || !channelsSentinelRef.current || !channelsHasMore || channelsLoadingMore) return;
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
  }, [viewMode, channelsHasMore, channelsLoadingMore, channelsPage, fetchCreatorChannels]);

  const featuredChannels = channels.filter((c) => c.featured);

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

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1
            className="text-2xl sm:text-3xl font-black tracking-tight"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            PNP Channels
          </h1>
          <p className="text-sm text-pnp-textSecondary mt-1">
            Discover creators, exclusive content & live streams
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex gap-2 p-1 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            onClick={() => setViewMode("creators")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === "creators"
                ? "text-white"
                : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            style={viewMode === "creators" ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
          >
            Creators
          </button>
          <button
            onClick={() => setViewMode("channels")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === "channels"
                ? "text-white"
                : "text-pnp-textSecondary hover:text-pnp-textPrimary"
            }`}
            style={viewMode === "channels" ? { background: "linear-gradient(135deg, #D4007A, #E69138)" } : undefined}
          >
            Content Channels
          </button>
        </div>

        {/* ── CREATORS VIEW ── */}
        {viewMode === "creators" && (
          <>
            {/* Search + Filters */}
            <div className="space-y-3">
              <div className="relative">
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
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search creators..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-pnp-textPrimary placeholder:text-pnp-textSecondary focus:outline-none focus:border-pnp-accent/50 transition-colors"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {(["all", "live", "featured"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                        filter === f
                          ? "bg-pnp-accent text-white"
                          : "bg-pnp-surface border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary"
                      }`}
                    >
                      {f === "all" ? "All" : f === "live" ? "Live Now" : "Featured"}
                    </button>
                  ))}
                </div>

                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="px-3 py-1.5 rounded-lg bg-pnp-surface border border-pnp-border text-xs text-pnp-textPrimary focus:outline-none"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Featured Strip */}
            {!loading && featuredChannels.length > 0 && filter === "all" && !debouncedSearch && (
              <div>
                <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">Featured Creators</h2>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                  {featuredChannels.map((ch) => (
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

            {/* Total count */}
            {!loading && (
              <p className="text-xs text-pnp-textSecondary">
                {total} creator{total !== 1 ? "s" : ""}
                {debouncedSearch ? ` matching "${debouncedSearch}"` : ""}
              </p>
            )}

            {/* Creator Grid */}
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-pnp-border bg-pnp-surface p-4 flex flex-col items-center">
                    <div className="w-20 h-20 rounded-full bg-pnp-surfaceHover animate-pulse mb-3" />
                    <div className="w-20 h-3 rounded bg-pnp-surfaceHover animate-pulse mb-2" />
                    <div className="w-14 h-2.5 rounded bg-pnp-surfaceHover animate-pulse mb-2" />
                    <div className="w-24 h-2 rounded bg-pnp-surfaceHover animate-pulse" />
                  </div>
                ))}
              </div>
            ) : channels.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                  style={{ background: "rgba(212,0,122,0.1)" }}
                >
                  <svg className="w-8 h-8 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <p className="text-pnp-textPrimary font-semibold mb-1">No creators found</p>
                <p className="text-sm text-pnp-textSecondary mb-4">
                  {debouncedSearch ? "Try a different search term" : "No creators available yet"}
                </p>
                <Button variant="secondary" size="sm" onClick={() => { setSearch(""); setFilter("all"); }}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {channels.map((ch) => (
                    <ChannelCard
                      key={ch.id}
                      channel={ch}
                      onClick={() => navigate(`/profile/${ch.id}`)}
                    />
                  ))}
                </div>
                {loadingMore && (
                  <div className="flex justify-center py-4">
                    <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <div ref={sentinelRef} className="h-1" />
              </>
            )}
          </>
        )}

        {/* ── CHANNELS VIEW ── */}
        {viewMode === "channels" && (
          <>
            {/* Search */}
            <div className="relative">
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {creatorChannels.map((ch) => (
                    <CreatorChannelCard
                      key={ch.id}
                      channel={ch}
                      onClick={() => setSelectedChannelId(ch.id)}
                    />
                  ))}
                </div>
                {channelsLoadingMore && (
                  <div className="flex justify-center py-4">
                    <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <div ref={channelsSentinelRef} className="h-1" />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
