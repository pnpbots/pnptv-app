import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getSocialPost, updateProfile, type SocialPostItem } from "@/lib/api";
import { SharePostModal } from "@/components/SharePostModal";

const APP_BASE = "https://pnptv.app";

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function isValidPhotoUrl(url: string | null | undefined): url is string {
  return !!url && (url.startsWith("/") || url.startsWith("http"));
}

function PostSkeleton() {
  return (
    <div className="glass-card-sm p-5 animate-pulse">
      <div className="flex gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-white/10 flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 bg-white/10 rounded w-36" />
          <div className="h-3 bg-white/10 rounded w-20" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-white/10 rounded w-full" />
        <div className="h-3 bg-white/10 rounded w-5/6" />
        <div className="h-3 bg-white/10 rounded w-4/6" />
      </div>
    </div>
  );
}

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [post, setPost] = useState<SocialPostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [contentDisclaimer, setContentDisclaimer] = useState(user?.contentDisclaimer || false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [disclaimerAccepting, setDisclaimerAccepting] = useState(false);

  useEffect(() => {
    if (!postId) {
      setError("Invalid post link.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSocialPost(postId)
      .then((res) => {
        if (!cancelled) {
          setPost(res.post);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Post not found.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [postId]);

  const handleShare = useCallback(() => {
    if (contentDisclaimer) {
      setShowShareModal(true);
    } else {
      setShowDisclaimerModal(true);
    }
  }, [contentDisclaimer]);

  const handleAcceptDisclaimer = useCallback(async () => {
    setDisclaimerAccepting(true);
    try {
      await updateProfile({ contentDisclaimer: true });
      setContentDisclaimer(true);
      setShowDisclaimerModal(false);
      setShowShareModal(true);
    } catch { /* silent */ }
    setDisclaimerAccepting(false);
  }, []);

  const shareUrl = `${APP_BASE}/social/post/${postId}`;

  const metaTitle = post
    ? `${post.author_first_name || post.author_username || "PNPtv"} on PNPtv!`
    : "Post — PNPtv!";
  const metaDescription = post?.content
    ? post.content.slice(0, 160)
    : "View this post on PNPtv! — the queer PNP community.";

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        {post?.media_url && post.media_type !== "video" && (
          <meta property="og:image" content={post.media_url} />
        )}
        <meta property="og:url" content={shareUrl} />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm mb-4 transition-colors hover:text-pnp-accent"
        style={{ color: "#8E8E93" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {loading && <PostSkeleton />}

      {!loading && error && (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-white font-medium mb-1">Post Not Found</p>
          <p className="text-sm mb-5" style={{ color: "#8E8E93" }}>
            {error}
          </p>
          <Link
            to="/social"
            className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-opacity hover:opacity-80"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            View Feed
          </Link>
        </div>
      )}

      {!loading && post && (
        <>
          <div className="glass-card-sm p-5 mb-4">
            {/* Author row */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => navigate(`/profile/${post.author_id}`)}
                className="flex-shrink-0"
                aria-label={`View ${post.author_first_name || post.author_username || "user"}'s profile`}
              >
                {isValidPhotoUrl(post.author_photo) ? (
                  <img
                    src={post.author_photo}
                    alt={`${post.author_first_name || post.author_username || "User"}'s avatar`}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                  >
                    {(post.author_first_name || post.author_username || "?")[0].toUpperCase()}
                  </div>
                )}
              </button>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => navigate(`/profile/${post.author_id}`)}
                  className="font-semibold text-white text-sm hover:underline truncate block"
                >
                  {post.author_first_name || post.author_username || "Anonymous"}
                </button>
                <div className="flex items-center gap-2 mt-0.5">
                  {post.author_username && (
                    <span className="text-xs" style={{ color: "#8E8E93" }}>
                      @{post.author_username}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: "#8E8E93" }}>
                    &middot; {timeAgo(post.created_at)}
                  </span>
                  {post.author_creator_verified && (
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#5ED1C4" aria-label="Verified creator">
                      <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Post content */}
            {post.blurred ? (
              /* Tier-gated content: viewer's subscription tier is too low */
              <div className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <p className="text-sm font-semibold text-white mb-1">
                  {post.content_tier === "prime" || post.content_tier === "PRIME"
                    ? "PRIME Content"
                    : "Member Content"}
                </p>
                <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
                  {post.content_tier === "prime" || post.content_tier === "PRIME"
                    ? "PRIME content — Subscribe to view"
                    : "This post is for members only. Upgrade to view."}
                </p>
                <button
                  onClick={() => navigate("/subscribe")}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {post.content_tier === "prime" || post.content_tier === "PRIME"
                    ? "Upgrade to PRIME"
                    : "Become a Member"}
                </button>
              </div>
            ) : post.is_exclusive && post.exclusive_status === "locked" ? (
              /* Creator exclusive content: viewer is not subscribed to this creator */
              <div className="rounded-xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <p className="text-sm font-semibold text-white mb-1">Exclusive Content</p>
                <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
                  Subscribe to {post.author_first_name || post.author_username} to unlock this post.
                </p>
                <button
                  onClick={() => navigate(`/profile/${post.author_id}`)}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  View Creator Profile
                </button>
              </div>
            ) : (
              <>
                {post.content && (
                  <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap mb-3">
                    {post.content}
                  </p>
                )}

                {/* Multi-image grid */}
                {post.media_urls && post.media_urls.length > 0 ? (
                  <div className={`grid gap-2 mt-3 ${post.media_urls.length === 1 ? "grid-cols-1" : post.media_urls.length === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
                    {post.media_urls.map((m, i) => (
                      <div key={i} className={post.media_urls!.length === 3 && i === 0 ? "col-span-2" : ""}>
                        {m.type === "video" ? (
                          <video
                            src={m.url}
                            controls
                            controlsList="nodownload"
                            onContextMenu={(e) => e.preventDefault()}
                            playsInline
                            muted
                            className="w-full max-h-80 rounded-lg object-cover"
                            preload="metadata"
                            poster={m.thumbnail_url}
                          />
                        ) : (
                          <img
                            src={m.url}
                            alt={`Post image ${i + 1}`}
                            className="w-full max-h-80 rounded-lg object-cover"
                            loading="lazy"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ) : post.media_url ? (
                  <div className="mt-3">
                    {post.media_type === "video" ? (
                      <>
                        {(post.video_title || post.video_description) && (
                          <div className="mb-2">
                            {post.video_title && (
                              <h3 className="text-base font-semibold text-white">{post.video_title}</h3>
                            )}
                            {post.video_description && (
                              <p className="text-sm text-white/60 mt-1">{post.video_description}</p>
                            )}
                          </div>
                        )}
                        <video
                          src={post.media_url}
                          controls
                          controlsList="nodownload"
                          onContextMenu={(e) => e.preventDefault()}
                          playsInline
                          muted
                          className="w-full max-h-96 rounded-xl object-cover"
                          preload="metadata"
                          poster={post.video_thumbnail_url ?? undefined}
                        />
                      </>
                    ) : (
                      <img
                        src={post.media_url}
                        alt="Post image"
                        className="w-full max-h-96 rounded-xl object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                ) : null}
              </>
            )}

            {/* Stats + share row */}
            <div className="flex items-center gap-5 mt-4 pt-4 border-t border-white/5" style={{ color: "#8E8E93" }}>
              {/* Likes */}
              <span className="flex items-center gap-1.5 text-xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
                {post.likes_count > 0 && <span>{post.likes_count}</span>}
              </span>

              {/* Replies */}
              <span className="flex items-center gap-1.5 text-xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                </svg>
                {post.replies_count > 0 && <span>{post.replies_count}</span>}
              </span>

              {/* Share button */}
              {post.is_shareable !== false && (
                <button
                  onClick={handleShare}
                  className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all border border-white/10 hover:border-white/20 hover:text-white"
                  style={{ color: "#8E8E93" }}
                  aria-label="Share this post"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
                  </svg>
                  Share
                </button>
              )}
            </div>
          </div>

          {/* Content Disclaimer Modal */}
          {showDisclaimerModal && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
              onClick={() => setShowDisclaimerModal(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl p-5 space-y-4"
                style={{ background: "#1C1C1E", border: "1px solid rgba(212,0,122,0.25)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold text-white">Content Sharing Disclaimer</h3>
                </div>
                <p className="text-sm text-white/80 leading-relaxed">
                  By accepting this disclaimer, you acknowledge that you are responsible for any content you share from this platform.
                  Shared content must comply with our community guidelines and applicable laws.
                </p>
                <p className="text-xs text-white/50 leading-relaxed">
                  This action is permanent and cannot be undone. Your acceptance date, time, and IP address will be recorded.
                </p>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setShowDisclaimerModal(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/20 text-white/70 hover:border-white/40 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAcceptDisclaimer}
                    disabled={disclaimerAccepting}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  >
                    {disclaimerAccepting ? "..." : "Accept & Share"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Share Post Modal */}
          <SharePostModal
            postId={post.id}
            postContent={post.content}
            authorName={post.author_first_name || post.author_username}
            isOwnPost={post.author_id === 'pnptv-official'}
            isOpen={showShareModal}
            onClose={() => setShowShareModal(false)}
          />

          {/* CTA to view full feed */}
          <div className="glass-card-sm p-5 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              <img src="/Logo2-50.png" alt="PNPtv!" className="w-8 h-8 object-contain" />
            </div>
            <p className="text-white font-semibold mb-1">PNPtv!</p>
            <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
              The queer PNP community. Connect, stream, and vibe.
            </p>
            <Link
              to="/social"
              className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-opacity hover:opacity-80"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              View more on PNPtv!
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
