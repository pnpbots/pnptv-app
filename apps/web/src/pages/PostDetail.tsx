import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getSocialPost, togglePostLike, updateProfile, type SocialPostItem } from "@/lib/api";
import SocialPostCard from "@/components/social/SocialPostCard";

const APP_BASE = "https://pnptv.app";

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
  const { user, isAdmin } = useAuth();

  const [post, setPost] = useState<SocialPostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentDisclaimer, setContentDisclaimer] = useState(user?.contentDisclaimer || false);

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

  const handleLike = useCallback((id: number) => {
    togglePostLike(id)
      .then((res) => {
        setPost((prev) =>
          prev ? { ...prev, liked_by_me: res.liked, likes_count: res.likes_count ?? prev.likes_count } : prev
        );
      })
      .catch(() => {});
  }, []);

  const handleDelete = useCallback((_id: number) => {
    navigate(-1);
  }, [navigate]);

  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
    setContentDisclaimer(true);
  }, []);

  const shareUrl = `${APP_BASE}/social/post/${postId}`;
  const metaTitle = post
    ? (post.video_title || `${post.author_first_name || post.author_username || "PNPtv"} on PNPtv!`)
    : "Post — PNPtv!";
  const metaDescription = post
    ? (post.video_description || post.content || "View this post on PNPtv! — the queer PNP community.").slice(0, 160)
    : "View this post on PNPtv! — the queer PNP community.";
  const metaImage = post?.video_thumbnail_url || (post?.media_type !== "video" ? post?.media_url : null);

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        {metaImage && <meta property="og:image" content={metaImage.startsWith("/") ? `https://pnptv.app${metaImage}` : metaImage} />}
        <meta property="og:url" content={shareUrl} />
        <meta name="twitter:card" content="summary_large_image" />
        {metaImage && <meta name="twitter:image" content={metaImage.startsWith("/") ? `https://pnptv.app${metaImage}` : metaImage} />}
      </Helmet>

      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm mb-4 transition-colors hover:text-pnp-accent"
        style={{ color: "var(--pnp-text-secondary)" }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {loading && <PostSkeleton />}

      {!loading && error && (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--pnp-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-white font-medium mb-1">Post Not Found</p>
          <p className="text-sm mb-5" style={{ color: "var(--pnp-text-secondary)" }}>{error}</p>
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
          <SocialPostCard
            post={post}
            currentUserId={String(user?.dbId || "")}
            isAdmin={isAdmin}
            userLang={user?.language || "en"}
            onLike={handleLike}
            onDelete={handleDelete}
            onNavigate={navigate}
            contentDisclaimerAccepted={contentDisclaimer}
            onAcceptDisclaimer={handleAcceptDisclaimer}
            viewerCity={user?.city ?? null}
            viewerCountry={user?.country ?? null}
          />

          {/* CTA to view full feed */}
          <div className="glass-card-sm p-5 text-center mt-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
            >
              <img src="/Logo2-50.png" alt="PNPtv!" className="w-8 h-8 object-contain" />
            </div>
            <p className="text-white font-semibold mb-1">PNPtv!</p>
            <p className="text-xs mb-4" style={{ color: "var(--pnp-text-secondary)" }}>
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
