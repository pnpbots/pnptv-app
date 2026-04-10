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

function isValidPhotoUrl(photo: string | null | undefined): photo is string {
  return !!photo && (photo.startsWith("/uploads/") || photo.startsWith("http"));
}

export default function Social() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const currentUserId = String(user?.dbId || "");
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("social");
  const { feed: t } = useI18n();

  // Featured performers
  const [featuredPerformers, setFeaturedPerformers] = useState<FeaturedPerformer[]>([]);

  useEffect(() => {
    getFeaturedPerformers()
      .then((res) => { if (res.success) setFeaturedPerformers(res.performers); })
      .catch(() => { /* non-critical */ });
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
          <h1 className="text-2xl font-bold text-white">{t.socialFeedTitle}</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            {t.socialFeedSubtitle}
          </p>
        </div>
        <span
          className="text-xs px-2 py-1 rounded-full font-medium"
          style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454" }}
        >
          {t.community}
        </span>
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
                onClick={() => p.userId && navigate(`/profile/${p.userId}`)}
                className={`glass-card-sm p-3 flex-shrink-0 w-28 text-center${
                  p.userId
                    ? " cursor-pointer hover:opacity-80 active:scale-95 transition-all"
                    : ""
                }`}
                style={{ borderColor: "rgba(94,209,196,0.18)" }}
              >
                <div className="relative mx-auto mb-2 w-14 h-14">
                  {isValidPhotoUrl(p.photoUrl) ? (
                    <img
                      src={p.photoUrl}
                      alt={p.displayName}
                      className="w-14 h-14 rounded-full object-cover"
                      style={{ border: "2px solid #5ED1C4" }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        const fallback = (e.target as HTMLImageElement)
                          .nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold"
                    style={{
                      background: "linear-gradient(135deg, #5ED1C4, #D4007A)",
                      color: "#fff",
                      border: "2px solid #5ED1C4",
                      display: isValidPhotoUrl(p.photoUrl) ? "none" : undefined,
                    }}
                  >
                    {p.displayName[0]}
                  </div>
                  {/* Availability dot */}
                  <span
                    className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
                    style={{
                      background: p.isAvailable ? "#30D158" : "#8E8E93",
                      borderColor: "rgba(30,30,30,0.9)",
                    }}
                  />
                </div>
                <p className="text-xs font-medium text-white truncate">
                  {p.displayName}
                </p>
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
