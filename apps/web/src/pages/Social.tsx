import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { useTutorial } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useNavigate } from "react-router-dom";
import {
  getFeaturedPerformers,
  updateProfile,
  type FeaturedPerformer,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SocialFeedTabs } from "@/components/social";
import { UserAvatar } from "@/components/UserAvatar";

export default function Social() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const currentUserId = String(user?.dbId || "");
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("social");
  const { feed: t } = useI18n();

  // Featured performers — only those actually live-streaming right now.
  // The backend populates isLive by matching each performer's live_channel
  // against Restreamer's running ingest processes (20s Redis cache).
  const [featuredPerformers, setFeaturedPerformers] = useState<FeaturedPerformer[]>([]);

  useEffect(() => {
    const load = () => getFeaturedPerformers()
      .then((res) => {
        if (res.success) {
          setFeaturedPerformers(res.performers.filter((p) => p.isLive === true));
        }
      })
      .catch(() => { /* non-critical */ });
    load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Content disclaimer state (owned here, passed down)
  const [contentDisclaimer, setContentDisclaimer] = useState(
    user?.contentDisclaimer || false
  );
  const handleAcceptDisclaimer = useCallback(async () => {
    await updateProfile({ contentDisclaimer: true });
    setContentDisclaimer(true);
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>{t.socialFeedTitle} — PNPtv!</title>
        <meta name="description" content={t.socialFeedSubtitle} />
      </Helmet>
      {showTutorial && <TutorialOverlay section="social" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.socialFeedTitle}</h1>
          <p className="text-sm mt-1 text-pnp-textSecondary">{t.socialFeedSubtitle}</p>
        </div>
      </div>

      {/* Featured Performers */}
      {featuredPerformers.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-white">{t.featured}</h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(94,209,196,0.12)", color: "#5ED1C4" }}
            >
              {t.live}
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {featuredPerformers.map((p) => (
              <div
                key={p.id}
                className="glass-card-sm p-3 flex-shrink-0 w-28 text-center"
                style={{ borderColor: "rgba(94,209,196,0.18)" }}
              >
                <div className="mx-auto mb-2 flex justify-center">
                  <UserAvatar
                    userId={p.userId || undefined}
                    photoUrl={p.photoUrl}
                    displayName={p.displayName}
                    size="lg"
                    className="border-2 border-[#5ED1C4] rounded-full"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => p.userId && navigate(`/profile/${p.userId}`)}
                  className={`block w-full text-xs font-medium text-white truncate ${p.userId ? "hover:underline" : "cursor-default"}`}
                >
                  {p.displayName}
                </button>
                {p.averageRating > 0 && (
                  <p className="text-[10px] mt-0.5" style={{ color: "#5ED1C4" }}>
                    {"★".repeat(Math.round(p.averageRating))}{" "}
                    {p.averageRating.toFixed(1)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full social feed with tabs */}
      <SocialFeedTabs
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        isAuthenticated={isAuthenticated}
        userLang={user?.language || "en"}
        viewerCity={user?.city}
        viewerCountry={user?.country}
        contentDisclaimerAccepted={contentDisclaimer}
        onAcceptDisclaimer={handleAcceptDisclaimer}
        onNavigate={navigate}
        showComposer={true}
      />
    </div>
  );
}
