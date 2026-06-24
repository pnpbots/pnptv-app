import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";
import { useTutorial, resetAllTutorials } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Badge, Skeleton } from "@pnptv/ui-kit";
import { PostComposer } from "@/components/PostComposer";
import {
  ApiError,
  getProfile,
  getPublicProfile,
  updateProfile,
  uploadAvatar,
  togglePostLike,
  deleteSocialPost,
  updateLanguage,
  followUser,
  unfollowUser,
  getFollowStatus,
  getCreatorSubscriptionStatus,
  unsubscribeFromCreator,
  createDashSubscription,
  getDashAvailable,
  prepareUsdcSubscription,
  getUsdcAvailable,
  getBtcAvailable,
  createBtcSubscription,
  getBtcSubscriptionStatus,
  initiateCreatorSubscriptionPayment,
  getUserLabel,
  getLabelColor,
  assertPaymentUrl,
  getWalletBalance,
  blockUser,
  unblockUser,
  isUserBlocked,
  createUserReport,
  type ReportCategory,
  getMyEvents,
  rsvpEvent,
  unrsvpEvent,
  cancelEvent,
  getUserHangoutActivity,
  createSupportTicket,
  type UserProfile,
  type SocialPostItem,
  type EventItem,
  type HangoutActivity,
  type MentionUser,
} from "@/lib/api";
import { EventCard } from "@/components/events/EventCard";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import { EventDetailModal } from "@/components/events/EventDetailModal";
import PostCard from "@/components/profile/PostCard";
import EditProfileModal from "@/components/profile/EditProfileModal";
import FollowListModal from "@/components/profile/FollowListModal";
import CreatorEnrollmentWizard, { TIER_CONFIG, type TierId } from "@/components/profile/CreatorEnrollmentWizard";
import MonetizeContentCard from "@/components/profile/MonetizeContentCard";
import { BookCallModal } from "@/components/creators/BookCallModal";
import type { CreatorCardCreator } from "@/components/creators/CreatorCard";
import { NearbyBadge, useNearbyToggle } from "@/components/NearbyBadge";
import { getDistanceToUser } from "@/lib/api";
import { useNowPayments } from "@/hooks/useNowPayments";
import { NowPaymentsWaitingPanel } from "@/components/payments/NowPaymentsWaitingPanel";

const STUDIO_LOGIN_URL = `/login?returnTo=${encodeURIComponent("https://studio.pnptv.app/")}`;

function resolvePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Only accept valid web paths, not Telegram file IDs
  if (url.startsWith("/") || url.startsWith("http")) return url;
  return null;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

// ── Main Profile Page ────────────────────────────────────────────────────────

export default function Profile() {
  const { isAuthenticated, user, login, logout, refreshUser } = useAuth();
  const { isMember: currentUserIsMember } = useTier();
  const { userId: paramUserId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const t = useI18n();
  const p = t.profile;
  const isOwnProfile = !paramUserId || paramUserId === String(user?.id) || paramUserId === String(user?.dbId);
  const targetUserId = paramUserId || String(user?.dbId || user?.id || "");
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("profile");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [freeViewerLimited, setFreeViewerLimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"posts" | "likes" | "exclusive">("posts");
  const [wofConsent, setWofConsent] = useState(false);
  const [wofConsentSaving, setWofConsentSaving] = useState(false);
  const [contentDisclaimer, setContentDisclaimer] = useState(false);
  const [contentDisclaimerSaving, setContentDisclaimerSaving] = useState(false);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [langSaving, setLangSaving] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);

  // Dash identity
  const [dpnsHandle, setDpnsHandle] = useState<string | null>(null);

  // Nearby distance (for other users' profiles)
  const [profileDistanceKm, setProfileDistanceKm] = useState<number | null>(null);
  const { enabled: nearbyEnabled } = useNearbyToggle();
  useEffect(() => {
    if (isOwnProfile || !nearbyEnabled || !targetUserId) return;
    getDistanceToUser(targetUserId).then((res) => {
      if (res.success) setProfileDistanceKm(res.distance_km);
    }).catch(() => {});
  }, [targetUserId, isOwnProfile, nearbyEnabled]);

  // Bug report
  const [showBugModal, setShowBugModal] = useState(false);
  const [bugText, setBugText] = useState("");
  const [bugSending, setBugSending] = useState(false);
  const [bugSent, setBugSent] = useState(false);
  const bugTextareaRef = useRef<HTMLTextAreaElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // Inline block-confirm state (replaces window.confirm)
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  useEffect(() => {
    if (showBugModal && bugTextareaRef.current) bugTextareaRef.current.focus();
  }, [showBugModal]);

  const handleSubmitBug = async () => {
    if (!bugText.trim() || bugText.trim().length < 10) return;
    setBugSending(true);
    try {
      const ctx = [
        `URL: ${window.location.pathname}${window.location.search}`,
        `UA: ${navigator.userAgent}`,
        `Screen: ${screen.width}x${screen.height} (${window.devicePixelRatio}x)`,
        `Viewport: ${window.innerWidth}x${window.innerHeight}`,
        `Lang: ${navigator.language}`,
        `Time: ${new Date().toISOString()}`,
      ].join("\n");
      await createSupportTicket("bug", `${bugText.trim()}\n\n--- Device Info ---\n${ctx}`);
      setBugSent(true);
      setTimeout(() => { setShowBugModal(false); setBugText(""); setBugSent(false); }, 2000);
    } catch { /* noop */ } finally { setBugSending(false); }
  };

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [showFollowModal, setShowFollowModal] = useState<"followers" | "following" | null>(null);

  // Block state (only relevant when viewing another user's profile)
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);

  // Report state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory | "">("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSent, setReportSent] = useState(false);
  const [reportEvidencePostId, setReportEvidencePostId] = useState<number | null>(null);

  // My Events state (own profile only)
  const [myEvents, setMyEvents] = useState<EventItem[]>([]);
  const [myEventsLoading, setMyEventsLoading] = useState(false);

  // Hangout activity state
  const [hangoutActivity, setHangoutActivity] = useState<HangoutActivity[]>([]);
  const [hangoutActivityLoading, setHangoutActivityLoading] = useState(false);
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);
  const [showCreateEvent, setShowCreateEvent] = useState(false);

  // Book a Call modal state
  const [showBookCall, setShowBookCall] = useState(false);
  const [showTagComposer, setShowTagComposer] = useState(false);

  // Creator subscription state
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<string | null>(null);
  const [showUnsubscribeConfirm, setShowUnsubscribeConfirm] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [paymentConfirmedBanner, setPaymentConfirmedBanner] = useState(false);
  // Payment-gated subscribe modal state
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [subscribeEmail, setSubscribeEmail] = useState("");
  const [subscribeEmailError, setSubscribeEmailError] = useState<string | null>(null);
  const [subscribeProvider, setSubscribeProvider] = useState<"usdc" | "epayco" | "dash" | "btc">("usdc");
  const [dashAvailable, setDashAvailable] = useState<boolean | null>(null);
  const [btcAvailable, setBtcAvailable] = useState(false);
  const [usdcAvailable, setUsdcAvailable] = useState<boolean | null>(null);
  const [subscribePaymentLoading, setSubscribePaymentLoading] = useState(false);
  const [subscribePaymentId, setSubscribePaymentId] = useState<string | null>(null);
  const [subscribeAwaitingPayment, setSubscribeAwaitingPayment] = useState(false);

  const [shareProfileCopied, setShareProfileCopied] = useState(false);

  // Overflow menu (own profile More button)
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  // Fixed-position coords for the dropdown — bypasses the overflow-y:auto scroll
  // container on mobile so menu items are never clipped below the viewport.
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  // Creator-interest opt-in: the milestone/eligibility card is only rendered after
  // the user clicks "Become a Creator" from the overflow menu (or once before).
  const [creatorInterestShown, setCreatorInterestShown] = useState<boolean>(() => {
    try { return localStorage.getItem("pnp:creator-interest") === "1"; } catch { return false; }
  });
  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const inTrigger = overflowRef.current?.contains(target);
      const inMenu = overflowMenuRef.current?.contains(target);
      if (!inTrigger && !inMenu) {
        setOverflowOpen(false);
        overflowTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handler as EventListener);
    document.addEventListener("touchstart", handler as EventListener, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler as EventListener);
      document.removeEventListener("touchstart", handler as EventListener);
    };
  }, [overflowOpen]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const subscribeButtonRef = useRef<HTMLDivElement>(null);

  const {
    order: usdcOrder,
    isSuccess: usdcPaymentSuccess,
    startPayment: startNowPayments,
    cancelOrder: cancelNowPayments,
    error: nowpaymentsError,
  } = useNowPayments({
    storageKey: "pnp_pending_creator_sub_order",
    onSuccess: async () => {
      // Webhook may not have fired yet — poll subscription status up to 5 times
      // Use paramUserId (stable from useParams) since profile state may be stale in this closure
      const creatorId = paramUserId || "";
      if (!creatorId) { setShowSubscribeModal(false); return; }
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 2000 : 3000));
        try {
          const subRes = await getCreatorSubscriptionStatus(creatorId);
          if (subRes.subscribed) {
            setIsSubscribed(true);
            setSubscriptionExpiresAt(subRes.subscription?.expires_at ?? null);
            setShowSubscribeModal(false);
            return;
          }
        } catch (_) { /* continue polling */ }
      }
      setShowSubscribeModal(false); // close regardless after retries
    },
  });

  // Scroll lock — applies whenever any local modal is open
  useEffect(() => {
    const anyModalOpen = showReportModal || showBugModal || showSubscribeModal || showBlockConfirm || showUnsubscribeConfirm;
    if (anyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [showReportModal, showBugModal, showSubscribeModal, showBlockConfirm, showUnsubscribeConfirm]);

  // Escape key handler — closes the topmost open modal/menu
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showBugModal) { setShowBugModal(false); return; }
      if (showReportModal && !reportSending) {
        setShowReportModal(false); setReportSent(false); setReportCategory(""); setReportDescription(""); setReportError(null); setReportEvidencePostId(null);
        return;
      }
      if (showBlockConfirm) { setShowBlockConfirm(false); return; }
      if (showUnsubscribeConfirm) { setShowUnsubscribeConfirm(false); return; }
      if (showSubscribeModal) {
        setShowSubscribeModal(false); setSubscribeAwaitingPayment(false); setSubscribePaymentId(null); setSubscribeError(null);
        return;
      }
      if (overflowOpen) { setOverflowOpen(false); overflowTriggerRef.current?.focus(); return; }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showBugModal, showReportModal, reportSending, showBlockConfirm, showUnsubscribeConfirm, showSubscribeModal, overflowOpen]);

  // Reset state when navigating between profiles
  useEffect(() => {
    setProfile(null);
    setPosts([]);
    setNextCursor(null);
    setIsFollowing(false);
    setFollowersCount(0);
    setFollowingCount(0);
    setIsSubscribed(false);
    setSubscriptionExpiresAt(null);
    setIsBlocked(false);
    setMyEvents([]);
    setError(null);
    setLoading(true);
  }, [targetUserId]);

  const loadProfile = useCallback(async (cursor?: string) => {
    if (!targetUserId) return;
    try {
      if (!cursor) setLoading(true);
      else setLoadingMore(true);

      if (isOwnProfile && isAuthenticated) {
        // Own profile: fetch profile data + posts separately
        const [profileRes, postsRes] = await Promise.all([
          getProfile(),
          getPublicProfile(targetUserId, cursor),
        ]);
        if (!cursor) {
          setProfile(profileRes.profile);
          setWofConsent(profileRes.profile.wofPhotoConsent ?? false);
          setContentDisclaimer(profileRes.profile.contentDisclaimer ?? false);
          setLang((profileRes.profile.language as "en" | "es") ?? user?.language ?? "en");
          setPosts(postsRes.posts);
          // Load own follow counts
          getFollowStatus(targetUserId).then((s) => {
            setFollowersCount(s.followerCount);
            setFollowingCount(s.followingCount);
          }).catch(() => {});
          // Load own DPNS handle
          getWalletBalance()
            .then((w) => { if (w.dpnsHandle) setDpnsHandle(w.dpnsHandle); })
            .catch(() => {});
          // Load own events
          setMyEventsLoading(true);
          getMyEvents()
            .then((r) => { if (r.success) setMyEvents(r.events); })
            .catch(() => {})
            .finally(() => setMyEventsLoading(false));
          // Load hangout activity
          setHangoutActivityLoading(true);
          getUserHangoutActivity(targetUserId)
            .then((r) => { if (r.success) setHangoutActivity(r.hangouts); })
            .catch(() => {})
            .finally(() => setHangoutActivityLoading(false));
        } else {
          setPosts((prev) => [...prev, ...postsRes.posts]);
        }
        setNextCursor(postsRes.nextCursor);
      } else {
        // Other user's profile: single endpoint + follow status + subscription status
        const [res, followRes] = await Promise.all([
          getPublicProfile(targetUserId, cursor),
          !cursor && isAuthenticated ? getFollowStatus(targetUserId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!cursor) {
          setProfile(res.profile);
          setPosts(res.posts);
          if (followRes) {
            setIsFollowing(followRes.isFollowing);
            setFollowersCount(followRes.followerCount);
            setFollowingCount(followRes.followingCount);
          }
          // Load creator subscription status if the user is an active creator
          if (isAuthenticated && res.profile.creatorStatus === "active") {
            getCreatorSubscriptionStatus(targetUserId)
              .then((subRes) => {
                if (subRes.success) {
                  setIsSubscribed(subRes.subscribed);
                  setSubscriptionExpiresAt(subRes.subscription?.expires_at ?? null);
                }
              })
              .catch(() => {});
          }
          // Check block status
          if (isAuthenticated) {
            isUserBlocked(targetUserId)
              .then((r) => { if (r.success) setIsBlocked(r.isBlocked); })
              .catch(() => {});
          }
          // Load hangout activity for public profiles too
          if (isAuthenticated) {
            getUserHangoutActivity(targetUserId)
              .then((r) => { if (r.success) setHangoutActivity(r.hangouts); })
              .catch(() => {});
          }
        } else {
          setPosts((prev) => [...prev, ...res.posts]);
        }
        setNextCursor(res.nextCursor);
        if ('freeUserLimited' in res) setFreeViewerLimited(!!res.freeUserLimited);
      }
    } catch (err: unknown) {
      if (!(err instanceof ApiError && err.status === 404)) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [targetUserId, isOwnProfile, isAuthenticated]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // M7: Handle return from ePayco payment — check `?payment=confirmed` URL param
  useEffect(() => {
    if (searchParams.get("payment") !== "confirmed") return;
    if (!targetUserId) return;
    // Remove the param from the URL without a full reload
    const newUrl = window.location.pathname;
    window.history.replaceState(null, "", newUrl);
    // Poll subscription status to confirm payment went through
    (async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 1500 : 3000));
        try {
          const subRes = await getCreatorSubscriptionStatus(targetUserId);
          if (subRes.subscribed) {
            setIsSubscribed(true);
            setSubscriptionExpiresAt(subRes.subscription?.expires_at ?? null);
            setPaymentConfirmedBanner(true);
            setTimeout(() => setPaymentConfirmedBanner(false), 6000);
            break;
          }
        } catch (_) { /* continue polling */ }
      }
      // Clean up sessionStorage regardless
      try { sessionStorage.removeItem("pnp_epayco_creator_return"); } catch { /* noop */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    try {
      const res = await uploadAvatar(file);
      setProfile((prev) =>
        prev ? { ...prev, photoUrl: res.photoUrl } : prev
      );
      // Refresh auth context so the avatar is updated globally
      await refreshUser();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload avatar");
      setTimeout(() => setError(null), 4000);
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleWofConsentToggle = async () => {
    const newValue = !wofConsent;
    setWofConsentSaving(true);
    try {
      await updateProfile({ wofPhotoConsent: newValue });
      setWofConsent(newValue);
    } catch {
      // Revert on failure
    } finally {
      setWofConsentSaving(false);
    }
  };

  const handleContentDisclaimerToggle = async () => {
    // Once accepted, cannot be reverted
    if (contentDisclaimer) return;
    setContentDisclaimerSaving(true);
    try {
      await updateProfile({ contentDisclaimer: true });
      setContentDisclaimer(true);
    } catch {
      // Revert on failure
    } finally {
      setContentDisclaimerSaving(false);
    }
  };

  const handleLanguageChange = async (newLang: "en" | "es") => {
    if (newLang === lang || langSaving) return;
    const prevLang = lang;
    setLangSaving(true);
    setLangError(null);
    setLang(newLang);
    try {
      await updateLanguage(newLang);
      await refreshUser();
    } catch (err) {
      setLang(prevLang);
      setLangError(err instanceof Error ? err.message : "Failed to update language");
      setTimeout(() => setLangError(null), 4000);
    } finally {
      setLangSaving(false);
    }
  };

  const handleLike = async (postId: number) => {
    if (!isAuthenticated) return;
    // Optimistic flip — keep the UI responsive; reconcile or roll back on response.
    let prevLiked: boolean | undefined;
    let prevCount: number | undefined;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        prevLiked = !!p.liked_by_me;
        prevCount = p.likes_count;
        const nowLiked = !p.liked_by_me;
        return { ...p, liked_by_me: nowLiked, likes_count: Math.max(0, p.likes_count + (nowLiked ? 1 : -1)) };
      })
    );
    try {
      const res = await togglePostLike(postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, liked_by_me: res.liked, likes_count: res.likes_count ?? p.likes_count }
            : p
        )
      );
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId && prevLiked !== undefined && prevCount !== undefined
            ? { ...p, liked_by_me: prevLiked, likes_count: prevCount }
            : p
        )
      );
    }
  };

  const handleDelete = async (postId: number) => {
    await deleteSocialPost(postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  const [followError, setFollowError] = useState<string | null>(null);

  const handleFollow = async () => {
    if (followLoading || !profile) return;
    setFollowLoading(true);
    setFollowError(null);
    try {
      const res = isFollowing
        ? await unfollowUser(profile.id || paramUserId!)
        : await followUser(profile.id || paramUserId!);
      setIsFollowing(res.isFollowing);
      setFollowersCount(res.followerCount);
      setFollowingCount(res.followingCount);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setFollowError(msg);
      setTimeout(() => setFollowError(null), 3000);
    }
    setFollowLoading(false);
  };

  const handleBlock = async () => {
    if (blockLoading || !profile) return;
    if (!isBlocked) {
      // Show inline confirm instead of window.confirm
      setShowBlockConfirm(true);
      return;
    }
    setBlockLoading(true);
    try {
      await unblockUser(profile.id || paramUserId!);
      setIsBlocked(false);
    } catch { /* silent */ }
    setBlockLoading(false);
  };

  const handleBlockConfirmed = async () => {
    if (!profile) return;
    setShowBlockConfirm(false);
    setBlockLoading(true);
    try {
      await blockUser(profile.id || paramUserId!);
      setIsBlocked(true);
    } catch { /* silent */ }
    setBlockLoading(false);
  };

  const handleSubmitReport = async () => {
    if (!profile || !reportCategory || reportSending) return;
    setReportSending(true);
    setReportError(null);
    try {
      const targetId = profile.id || paramUserId!;
      const res = await createUserReport({
        reportedUserId: targetId,
        category: reportCategory as ReportCategory,
        description: reportDescription.trim() || undefined,
        evidenceType: reportEvidencePostId ? "post" : "profile",
        evidenceId: reportEvidencePostId ? String(reportEvidencePostId) : undefined,
      });
      if (res.success) {
        setReportSent(true);
        setIsBlocked(true); // backend auto-blocks — reflect locally
      } else {
        if (res.code === "RATE_LIMITED") setReportError(p.reportErrorRateLimited);
        else if (res.code === "DUPLICATE_OPEN") setReportError(p.reportErrorDuplicate);
        else setReportError(res.error || p.reportErrorGeneric);
      }
    } catch (err) {
      setReportError(err instanceof Error ? err.message : p.reportErrorGeneric);
    }
    setReportSending(false);
  };

  const handleSubscribe = () => {
    if (!profile) return;
    if (isSubscribed) {
      setShowUnsubscribeConfirm(true);
      return;
    }
    if (!currentUserIsMember) {
      setSubscribeError(p.primeRequiredForCreator);
      setTimeout(() => setSubscribeError(null), 4000);
      return;
    }
    setSubscribeEmail("");
    setSubscribeEmailError(null);
    setSubscribeError(null);
    setSubscribeAwaitingPayment(false);
    setSubscribePaymentId(null);
    setSubscribeProvider("usdc");
    setShowSubscribeModal(true);
    // Probe all payment provider availability lazily on first open.
    if (dashAvailable === null) {
      getDashAvailable()
        .then((res) => setDashAvailable(res.available === true && res.configured === true))
        .catch(() => setDashAvailable(false));
      getBtcAvailable()
        .then((res) => setBtcAvailable(res.available === true))
        .catch(() => setBtcAvailable(false));
    }
    if (usdcAvailable === null) {
      getUsdcAvailable()
        .then((res) => setUsdcAvailable(res.available === true))
        .catch(() => setUsdcAvailable(false));
    }
  };

  const handleUnsubscribe = async () => {
    if (subscribeLoading || !profile) return;
    setShowUnsubscribeConfirm(false);
    setSubscribeLoading(true);
    setSubscribeError(null);
    try {
      await unsubscribeFromCreator(profile.id || paramUserId!);
      setIsSubscribed(false);
      setSubscriptionExpiresAt(null);
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : p.failedToUnsubscribe);
    }
    setSubscribeLoading(false);
  };

  const handleSubscribePayment = async () => {
    if (!profile || subscribePaymentLoading) return;
    setSubscribePaymentLoading(true);
    setSubscribeError(null);
    try {
      const creatorId = profile.id || paramUserId!;
      const trimmed = subscribeEmail.trim();
      if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
        setSubscribeEmailError("Please enter a valid email address");
        setSubscribePaymentLoading(false);
        return;
      }
      setSubscribeEmailError(null);

      if (subscribeProvider === "epayco") {
        const res = await initiateCreatorSubscriptionPayment(creatorId, "epayco", trimmed);
        if (res.success && res.paymentUrl) {
          // Store creatorId so we can verify subscription when the user returns
          try { sessionStorage.setItem("pnp_epayco_creator_return", creatorId); } catch { /* noop */ }
          window.location.href = assertPaymentUrl(res.paymentUrl);
          return; // page navigates away
        } else {
          setSubscribeError(res.error || p.failedToCreatePayment);
        }
      } else if (subscribeProvider === "usdc") {
        const res = await startNowPayments("creator_monthly", trimmed, creatorId);
        if (!res?.success) {
          setSubscribeError((res as any)?.error || nowpaymentsError || p.failedToCreatePayment);
        }
        // On success: usdcOrder is set and NowPaymentsWaitingPanel renders automatically
      } else if (subscribeProvider === "btc") {
        // Bitcoin via BTCPay Server
        const btcRes = await createBtcSubscription("creator_monthly", creatorId);
        if (btcRes.success && btcRes.checkoutUrl) {
          const pw = 560, ph = 780;
          const pl = Math.round(window.screenX + (window.outerWidth - pw) / 2);
          const pt = Math.round(window.screenY + (window.outerHeight - ph) / 2);
          window.open(
            assertPaymentUrl(btcRes.checkoutUrl),
            "btcpay_btc_checkout",
            `width=${pw},height=${ph},left=${pl},top=${pt},resizable=yes,scrollbars=yes`
          );
          setSubscribePaymentId(btcRes.invoiceId);
          setSubscribeAwaitingPayment(true);
        } else {
          setSubscribeError(btcRes.error || p.failedToCreatePayment);
        }
      } else {
        // Dash path
        const dashRes = await createDashSubscription("creator_monthly", trimmed, creatorId);
        if (dashRes.success && dashRes.checkoutUrl) {
          window.open(assertPaymentUrl(dashRes.checkoutUrl), "_blank", "noopener,noreferrer");
          setSubscribePaymentId(dashRes.invoiceId);
          setSubscribeAwaitingPayment(true);
        } else {
          setSubscribeError(dashRes.error || p.failedToCreatePayment);
        }
      }
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : p.paymentError);
    }
    setSubscribePaymentLoading(false);
  };

  const handleCheckSubscriptionStatus = async () => {
    if (!profile) return;
    try {
      const creatorId = profile.id || paramUserId!;
      const subRes = await getCreatorSubscriptionStatus(creatorId);
      if (subRes.success && subRes.subscribed) {
        setIsSubscribed(true);
        setSubscriptionExpiresAt(subRes.subscription?.expires_at ?? null);
        setShowSubscribeModal(false);
        setSubscribeAwaitingPayment(false);
        setSubscribePaymentId(null);
      } else {
        setSubscribeError(p.paymentNotConfirmed);
        setTimeout(() => setSubscribeError(null), 4000);
      }
    } catch {
      setSubscribeError(p.couldNotVerifyStatus);
      setTimeout(() => setSubscribeError(null), 3000);
    }
  };

  const handleAuthorTap = (authorId: string) => {
    if (authorId === String(user?.id)) {
      navigate("/profile");
    } else {
      navigate(`/profile/${authorId}`);
    }
  };

  const handleShareProfile = useCallback(async () => {
    const userId = profile?.id || paramUserId || "";
    const url = `https://pnptv.app/profile/${userId}`;
    const displayName = profile
      ? profile.firstName + (profile.lastName ? ` ${profile.lastName}` : "")
      : "Someone";
    const shareData = {
      title: `${displayName} on PNPtv!`,
      text: profile?.bio || `Check out ${displayName}'s profile on PNPtv!`,
      url,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        setShareProfileCopied(true);
        setTimeout(() => setShareProfileCopied(false), 2500);
      } catch { /* silent */ }
    }
  }, [profile, paramUserId]);

  // Scroll to the subscribe button or trigger subscribe flow from the exclusive overlay CTA
  const handleSubscribeCta = useCallback(() => {
    if (subscribeButtonRef.current) {
      subscribeButtonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // If the user is on the exclusive tab, switch to posts tab so they can see the subscribe button context
    setActiveTab("posts");
  }, []);

  // ── Not authenticated + no param → sign in prompt ──────────────────────────

  if (!isAuthenticated && !paramUserId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
        >
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">{p.signInRequired}</h1>
        <p className="text-sm mb-6" style={{ color: "var(--pnp-text-secondary)" }}>
          {p.signInPrompt}
        </p>
        <Button onClick={login}>{p.signIn}</Button>
      </div>
    );
  }

  // ── Loading State ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header skeleton */}
        <div className="glass-card-sm p-6 mb-4">
          <div className="flex items-start gap-4">
            <Skeleton className="w-20 h-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
        {/* Posts skeleton */}
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card-sm p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-full" />
                  <div className="h-3 bg-white/10 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────────────

  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--pnp-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="text-white font-medium mb-1">{p.profileNotFound}</p>
        <p className="text-sm mb-4" style={{ color: "var(--pnp-text-secondary)" }}>{error || p.userDoesntExist}</p>
        <Button onClick={() => navigate("/")}>{p.goHome}</Button>
      </div>
    );
  }

  // Blocked user state — show minimal profile with unblock option
  if (!isOwnProfile && isBlocked) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        {paramUserId && (
          <div className="sticky top-0 z-30 -mx-4 px-4 py-2 mb-2 backdrop-blur-sm" style={{ background: "var(--pnp-background)" }}>
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-sm hover:text-pnp-accent transition-colors"
              style={{ color: "var(--pnp-text-secondary)" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              {p.back}
            </button>
          </div>
        )}
        <div className="glass-card-sm p-8 text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(255,59,48,0.12)", border: "1px solid rgba(255,59,48,0.25)" }}
          >
            <svg className="w-8 h-8" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <p className="text-white font-semibold mb-1">User Blocked</p>
          <p className="text-sm mb-6" style={{ color: "var(--pnp-text-secondary)" }}>
            You have blocked {profile.firstName || profile.username || "this user"}. Their content is hidden.
          </p>
          <button
            onClick={handleBlock}
            disabled={blockLoading}
            className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
            style={{ background: "rgba(255,59,48,0.15)", color: "#FF453A", border: "1px solid rgba(255,59,48,0.3)" }}
          >
            {blockLoading ? "..." : "Unblock User"}
          </button>
        </div>
      </div>
    );
  }

  const photoUrl = resolvePhotoUrl(profile.photoUrl);
  const displayName = profile.firstName + (profile.lastName ? ` ${profile.lastName}` : "");
  const initial = displayName[0]?.toUpperCase() || "U";
  const userLabel = getUserLabel(profile);
  const isPrime = userLabel === 'PRIME';
  const isPerformer = !!profile.performerData;

  // M6: Subscription expiry helpers
  const daysUntilExpiry = subscriptionExpiresAt
    ? Math.ceil((new Date(subscriptionExpiresAt).getTime() - Date.now()) / 86400000)
    : null;
  const expiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 7;

  // Per-user profile themes & masked roles
  const profileThemes: Record<string, { gradient: string; color: string; border: string; borderColor?: string; roleBadge?: string; roleStyle?: React.CSSProperties }> = {
    "8599671840": { // SantinoFurioso — golden crystal yellow
      gradient: "linear-gradient(135deg, #FFD700, #FFA500)",
      color: "#FFD700",
      border: "rgba(255,215,0,0.4)",
      borderColor: "rgba(255,215,0,0.25)",
      roleBadge: "The Meth Daddy",
      roleStyle: { background: "rgba(255,215,0,0.15)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.3)" },
    },
    "7246621722": { // PNPLatinoBoy — light silver
      gradient: "linear-gradient(135deg, #C0C0C0, #E8E8E8)",
      color: "#D0D0D0",
      border: "rgba(192,192,192,0.4)",
      borderColor: "rgba(192,192,192,0.25)",
      roleBadge: "The Rush Papi",
      roleStyle: { background: "rgba(192,192,192,0.15)", color: "#D0D0D0", border: "1px solid rgba(192,192,192,0.3)" },
    },
    "8250283246": { // Lexboytv — light silver
      gradient: "linear-gradient(135deg, #C0C0C0, #E8E8E8)",
      color: "#D0D0D0",
      border: "rgba(192,192,192,0.4)",
      borderColor: "rgba(192,192,192,0.25)",
      roleBadge: "The PNP Latino Boy",
      roleStyle: { background: "rgba(192,192,192,0.15)", color: "#D0D0D0", border: "1px solid rgba(192,192,192,0.3)" },
    },
    "8552451957": { // pnptvadmin — light silver
      gradient: "linear-gradient(135deg, #C0C0C0, #E8E8E8)",
      color: "#D0D0D0",
      border: "rgba(192,192,192,0.4)",
      borderColor: "rgba(192,192,192,0.25)",
      roleBadge: "Official Account",
      roleStyle: { background: "rgba(192,192,192,0.15)", color: "#D0D0D0", border: "1px solid rgba(192,192,192,0.3)" },
    },
    "pnptv-official": { // PNPtv! system account — blue verified
      gradient: "linear-gradient(135deg, #D4007A, #E69138)",
      color: "#D4007A",
      border: "rgba(212,0,122,0.4)",
      borderColor: "rgba(212,0,122,0.25)",
      roleBadge: "Official Account",
      roleStyle: { background: "rgba(29,155,240,0.15)", color: "#1D9BF0", border: "1px solid rgba(29,155,240,0.3)" },
    },
  };

  const customTheme = profileThemes[profile.id];
  const isFounder = !customTheme && (profile.gamificationBadges?.some(b => b.slug === 'founder') ?? false);
  const accentGradient = customTheme?.gradient ?? (isFounder
    ? "linear-gradient(135deg, #FFB454, #FF9933)"
    : isPerformer
      ? "linear-gradient(135deg, #5ED1C4, #00D4E8)"
      : "linear-gradient(135deg, #D4007A, #E69138)");
  const accentColor = customTheme?.color ?? (isFounder ? "#FFB454" : isPerformer ? "#5ED1C4" : "#D4007A");
  const accentBorder = customTheme?.border ?? (isFounder ? "rgba(255,180,84,0.4)" : isPerformer ? "rgba(94,209,196,0.35)" : "rgba(255,255,255,0.1)");

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>{profile ? `${profile.display_name || profile.username} — PNPtv!` : "Profile — PNPtv!"}</title>
        <meta name="description" content={profile ? `${profile.display_name || profile.username}'s profile on PNPtv.` : "User profile on PNPtv."} />
      </Helmet>
      {isOwnProfile && showTutorial && <TutorialOverlay section="profile" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}
      {/* ── Back button for public profiles — sticky so it stays visible while scrolling ── */}
      {paramUserId && (
        <div className="sticky top-0 z-30 -mx-4 px-4 py-2 mb-2 backdrop-blur-sm" style={{ background: "var(--pnp-background)" }}>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm hover:text-pnp-accent transition-colors"
            style={{ color: "var(--pnp-text-secondary)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            {p.back}
          </button>
        </div>
      )}

      {/* ── Profile Header Card ── */}
      <div
        className="glass-card-sm mb-4 relative"
        style={customTheme?.borderColor ? { borderColor: customTheme.borderColor } : isPerformer ? { borderColor: "rgba(94,209,196,0.2)" } : undefined}
      >
        {/* Cover banner */}
        <div
          className="relative h-24 overflow-hidden"
          style={{
            background: accentGradient,
            backgroundBlendMode: "overlay",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: "radial-gradient(120% 100% at 0% 0%, rgba(255,255,255,0.15), transparent 60%), radial-gradient(100% 120% at 100% 100%, rgba(0,0,0,0.35), transparent 55%)",
            }}
          />
        </div>

        <div className="px-5 pb-5 relative">
        {/* Avatar overlapping banner */}
        <div className="-mt-12 mb-3 relative inline-block">
          <div className="relative">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={displayName}
                className="w-24 h-24 rounded-full object-cover border-4 shadow-xl"
                style={{ borderColor: "#121214" }}
              />
            ) : (
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold border-4 shadow-xl"
                style={{
                  background: accentGradient,
                  color: "#fff",
                  borderColor: "#121214",
                }}
              >
                {initial}
              </div>
            )}
            {isPrime && (
              <span
                aria-hidden="true"
                className="absolute -inset-0.5 rounded-full pointer-events-none"
                style={{ boxShadow: "0 0 0 2px #FFB454, 0 0 16px rgba(255,180,84,0.45)" }}
              />
            )}
            {/* Camera overlay — own profile only */}
            {isOwnProfile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute bottom-1 right-1 w-8 h-8 rounded-full flex items-center justify-center border-2 shadow-lg"
                  style={{ background: accentGradient, borderColor: "#121214" }}
                  title={p.changePhoto}
                  aria-label={p.changePhoto}
                >
                  {avatarUploading ? (
                    <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Name & info */}
        <div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-white truncate">{displayName}</h1>
              {userLabel !== 'FREE' && (
                <span
                  className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full border ${getLabelColor(userLabel)}`}
                >
                  {userLabel}
                </span>
              )}
              {customTheme?.roleBadge ? (
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={customTheme.roleStyle}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  {customTheme.roleBadge}
                </span>
              ) : (
                <>
                  {isPerformer && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.3)" }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                      {p.performer}
                    </span>
                  )}
                  {profile.creatorStatus === "active" && (() => {
                    const tierMap: Record<string, { emoji: string; label: string; color: string }> = {
                      ice:     { emoji: TIER_CONFIG.ice.emoji,     label: p.iceCreator,     color: TIER_CONFIG.ice.color },
                      crystal: { emoji: TIER_CONFIG.crystal.emoji, label: p.crystalCreator,  color: TIER_CONFIG.crystal.color },
                      diamond: { emoji: TIER_CONFIG.diamond.emoji, label: p.diamondCreator,  color: TIER_CONFIG.diamond.color },
                    };
                    const tier = tierMap[profile.creatorType ?? ""];
                    const badgeColor  = tier ? tier.color  : "#D4007A";
                    const badgeEmoji  = tier ? tier.emoji  : "⭐";
                    const badgeLabel  = tier ? tier.label  : p.creator;
                    // Convert hex to rgb for rgba() — only the three tiers + fallback pink need this
                    const hexToRgb = (hex: string) => {
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      return `${r},${g},${b}`;
                    };
                    const rgb = hexToRgb(badgeColor);
                    return (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `rgba(${rgb},0.15)`, color: badgeColor, border: `1px solid rgba(${rgb},0.3)` }}>
                        <span aria-hidden="true">{badgeEmoji}</span>
                        {badgeLabel}
                      </span>
                    );
                  })()}
                  {!isOwnProfile && profile.creatorStatus === "active" && profile.creatorPriceUsd != null && (
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                      &middot; ${profile.creatorPriceUsd}/mo
                    </span>
                  )}
                </>
              )}
              {profile.creatorVerified && (
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill={accentColor} aria-label={p.verifiedCreator}>
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              )}
              {profile.colombiaBadge && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, rgba(252,209,22,0.20) 0%, rgba(206,17,38,0.15) 100%)",
                    color: "#FFD700",
                    border: "1px solid rgba(252,209,22,0.35)",
                  }}
                >
                  <span aria-hidden="true">🇨🇴</span>
                  Socio Colombia
                </span>
              )}
              {isFounder && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,180,84,0.20) 0%, rgba(255,153,51,0.15) 100%)",
                    color: "#FFB454",
                    border: "1px solid rgba(255,180,84,0.40)",
                    boxShadow: "0 0 8px rgba(255,180,84,0.18)",
                  }}
                >
                  <span aria-hidden="true">🏅</span>
                  Miembro Fundador
                </span>
              )}
            </div>
            {profile.username && (
              <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>@{profile.username}</p>
            )}
            {isOwnProfile && dpnsHandle && (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full mt-1"
                style={{ background: "rgba(0,141,228,0.15)", color: "#008DE4", border: "1px solid rgba(0,141,228,0.3)" }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                </svg>
                @{dpnsHandle}
              </span>
            )}
            {!isOwnProfile && profileDistanceKm != null && (
              <NearbyBadge distanceKm={profileDistanceKm} variant="detailed" />
            )}
            {profile.bio && (
              <p className="text-sm text-white/80 mt-2 leading-relaxed">{profile.bio}</p>
            )}

            {/* Stats row — compact counter pills */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div
                className="flex flex-col items-center justify-center py-2 rounded-lg"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <strong className="text-base font-bold text-white tabular-nums leading-none">{profile.postCount ?? posts.length}</strong>
                <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: "var(--pnp-text-secondary)" }}>{p.posts}</span>
              </div>
              <button
                onClick={() => setShowFollowModal("followers")}
                className="flex flex-col items-center justify-center py-2 rounded-lg transition-colors hover:bg-white/5"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <strong className="text-base font-bold text-white tabular-nums leading-none">{followersCount}</strong>
                <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: "var(--pnp-text-secondary)" }}>{p.followers}</span>
              </button>
              <button
                onClick={() => setShowFollowModal("following")}
                className="flex flex-col items-center justify-center py-2 rounded-lg transition-colors hover:bg-white/5"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <strong className="text-base font-bold text-white tabular-nums leading-none">{followingCount}</strong>
                <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: "var(--pnp-text-secondary)" }}>{p.following}</span>
              </button>
            </div>

            {/* Secondary stats + meta row */}
            <div className="flex items-center gap-x-3 gap-y-1 mt-3 flex-wrap text-xs" style={{ color: "var(--pnp-text-secondary)" }}>
              {profile.creatorStatus === "active" && (profile.creatorSubscriberCount || 0) > 0 && (
                <span className="inline-flex items-center gap-1">
                  <strong className="text-white tabular-nums">{profile.creatorSubscriberCount}</strong>
                  <span>{p.subscribers}</span>
                </span>
              )}
              {profile.creatorStatus === "active" && (() => {
                const exclusiveTotal = (profile.exclusiveVideoCount ?? 0) + (profile.exclusivePhotoCount ?? 0);
                return exclusiveTotal > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" style={{ color: "#D4007A" }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <strong className="text-white tabular-nums">{exclusiveTotal}</strong>
                    <span>{p.exclusive}</span>
                  </span>
                ) : null;
              })()}
              {isPerformer && profile.performerData!.averageRating > 0 && (
                <span className="inline-flex items-center gap-1" style={{ color: "#5ED1C4" }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  <strong className="text-white tabular-nums">{profile.performerData!.averageRating.toFixed(1)}</strong>
                  <span>{p.rating}</span>
                </span>
              )}
              {isPerformer && (
                <span className="inline-flex items-center gap-1">
                  <strong className="text-white tabular-nums">{profile.performerData!.totalCalls}</strong>
                  <span>{p.calls}</span>
                </span>
              )}
              {profile.locationText && (
                <span className="inline-flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  {profile.locationText}
                </span>
              )}
              {(profile.wellnessDaysAccumulated ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1" style={{ color: "#5ED1C4" }} title="Wellness break days — a sign of strength">
                  <span aria-hidden="true">🧘</span>
                  <strong className="text-white tabular-nums">{profile.wellnessDaysAccumulated}</strong>
                  <span>{(profile.wellnessDaysAccumulated ?? 0) === 1 ? "wellness day" : "wellness days"}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                {p.joined} {formatDate(profile.memberSince)}
              </span>
            </div>
          </div>
        </div>

        {/* Cristina's profile completion nudge */}
        {isOwnProfile && (!photoUrl || !profile.dateOfBirth || !profile.city) && !localStorage.getItem("pnp:cristina-profile-nudge-dismissed") && (() => {
          const totalSteps = 3;
          const completedSteps = (photoUrl ? 1 : 0) + (profile.dateOfBirth ? 1 : 0) + (profile.city ? 1 : 0);
          const pct = Math.round((completedSteps / totalSteps) * 100);
          return (
          <div className="mt-4 rounded-xl p-3.5 relative" style={{ background: "linear-gradient(135deg, rgba(91,200,245,0.08), rgba(0,212,232,0.08))", border: "1px solid rgba(91,200,245,0.25)" }}>
            <button
              onClick={() => { localStorage.setItem("pnp:cristina-profile-nudge-dismissed", "1"); setProfile({ ...profile }); }}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="flex items-start gap-3">
              <span role="img" aria-label="Cristina AI" className="cristina-avatar-glow shrink-0 flex items-center justify-center" style={{ width: 36, height: 36, fontSize: 26 }}>🧜‍♀️</span>
              <div className="flex-1 min-w-0 pr-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold truncate" style={{ color: "#5BC8F5" }}>{p.cristinaHeadline}</p>
                  <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: "#5BC8F5" }}>{completedSteps}/{totalSteps}</span>
                </div>
                {/* Progress bar */}
                <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "rgba(91,200,245,0.15)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: "linear-gradient(90deg, #5BC8F5, #00D4E8)" }}
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {!photoUrl && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full" style={{ background: "rgba(91,200,245,0.12)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(91,200,245,0.2)" }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
                      {p.cristinaUploadPhoto}
                    </span>
                  )}
                  {!profile.dateOfBirth && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full" style={{ background: "rgba(91,200,245,0.12)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(91,200,245,0.2)" }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
                      {p.cristinaAddBirthday}
                    </span>
                  )}
                  {!profile.city && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full" style={{ background: "rgba(91,200,245,0.12)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(91,200,245,0.2)" }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                      {p.cristinaSetLocation}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { if (!photoUrl) fileInputRef.current?.click(); else setEditOpen(true); }}
                  className="mt-2.5 px-3.5 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
                  style={{ background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }}
                >
                  {!photoUrl ? p.cristinaUploadPhotoBtn : p.cristinaEditProfileBtn}
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* Monetize Content — own profile, not yet active.
            Gated on explicit opt-in via the overflow "Become a Creator" entry
            so users who haven't requested creator status don't see milestones. */}
        {isOwnProfile && profile.creatorStatus !== "active" && (
          <MonetizeContentCard
            creatorStatus={profile.creatorStatus}
            interestExpressed={creatorInterestShown}
            onActivated={() => loadProfile()}
          />
        )}


        {/* Action buttons */}
        <div className="mt-4 space-y-2" ref={subscribeButtonRef}>
          {isOwnProfile ? (
            <>
              {/* Primary action row — Edit, Share, More */}
              <div className="flex gap-2">
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex-1 min-h-[40px] py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: accentGradient }}
                >
                  {p.editProfile}
                </button>
                <button
                  onClick={handleShareProfile}
                  className="min-w-[40px] min-h-[40px] px-3 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
                  style={shareProfileCopied
                    ? { background: "rgba(52,199,89,0.1)", color: "#34C759", border: "1px solid rgba(52,199,89,0.3)" }
                    : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.12)" }
                  }
                  title="Share your profile"
                  aria-label="Share profile"
                >
                  {shareProfileCopied ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" /></svg>
                  )}
                  <span className="hidden sm:inline">Share</span>
                </button>
                <div ref={overflowRef}>
                  <button
                    ref={overflowTriggerRef}
                    onClick={() => {
                      if (!overflowOpen) {
                        const rect = overflowTriggerRef.current?.getBoundingClientRect();
                        if (rect) {
                          const spaceBelow = window.innerHeight - rect.bottom;
                          if (spaceBelow >= 380) {
                            setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                          } else {
                            setMenuPos({ bottom: window.innerHeight - rect.top + 8, right: window.innerWidth - rect.right });
                          }
                        }
                      }
                      setOverflowOpen((v) => !v);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={overflowOpen}
                    aria-label="More actions"
                    className="min-w-[44px] min-h-[44px] px-3 rounded-lg transition-colors flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                    </svg>
                  </button>
                  {overflowOpen && menuPos && createPortal(
                    <div
                      ref={overflowMenuRef}
                      role="menu"
                      className="fixed w-60 rounded-2xl shadow-2xl z-[200] py-2"
                      style={{ top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, background: "rgba(22,22,24,0.98)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(24px)", maxHeight: menuPos.top !== undefined ? `calc(100dvh - ${menuPos.top + 8}px)` : `calc(100dvh - ${(menuPos.bottom ?? 0) + 8}px)`, overflowY: "auto" }}
                    >
                      {/* ── Creator tools ── */}
                      {profile.creatorStatus === "active" && (() => {
                        const tc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
                        return (
                          <>
                            <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-widest uppercase select-none" style={{ color: "rgba(255,255,255,0.28)" }}>{p.menuCreator}</p>
                            <div className="mx-2 mb-2 rounded-xl overflow-hidden" style={{ background: `rgba(${tc.rgb},0.07)`, border: `1px solid rgba(${tc.rgb},0.14)` }}>
                              <button
                                role="menuitem"
                                onClick={() => { setOverflowOpen(false); navigate("/creator"); }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left hover:bg-white/5 transition-colors"
                                style={{ color: tc.color }}
                              >
                                <span className="text-base leading-none w-4 flex-shrink-0 text-center" aria-hidden="true">{tc.emoji}</span>
                                <span className="font-medium">{p.creatorDashboard}</span>
                              </button>
                              <div className="h-px mx-1" style={{ background: `rgba(${tc.rgb},0.1)` }} />
                              <a
                                role="menuitem"
                                href={STUDIO_LOGIN_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setOverflowOpen(false)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/70 hover:bg-white/5 transition-colors"
                              >
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
                                <span className="flex-1">{p.studio}</span>
                                <svg className="w-3 h-3 flex-shrink-0 opacity-35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                              </a>
                              <div className="h-px mx-1" style={{ background: `rgba(${tc.rgb},0.1)` }} />
                              <a
                                role="menuitem"
                                href="/live"
                                onClick={() => setOverflowOpen(false)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/70 hover:bg-white/5 transition-colors"
                              >
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <span className="flex-1">{p.bookings}</span>
                              </a>
                            </div>
                          </>
                        );
                      })()}

                      {/* ── Become creator (non-creator) ── */}
                      {profile.creatorStatus !== "active" && !creatorInterestShown && (
                        <>
                          <button
                            role="menuitem"
                            onClick={() => {
                              setOverflowOpen(false);
                              try { localStorage.setItem("pnp:creator-interest", "1"); } catch {}
                              setCreatorInterestShown(true);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left hover:bg-white/5 transition-colors mx-0"
                            style={{ color: "#D4007A" }}
                          >
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {p.becomeCreatorMenu}
                          </button>
                          <div className="h-px mx-3 my-1" style={{ background: "rgba(255,255,255,0.07)" }} />
                        </>
                      )}

                      {/* ── Account ── */}
                      <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-widest uppercase select-none" style={{ color: "rgba(255,255,255,0.28)" }}>{p.menuAccount}</p>
                      <button
                        role="menuitem"
                        onClick={() => { setOverflowOpen(false); navigate("/settings"); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/5 transition-colors"
                      >
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        {p.settings}
                      </button>

                      {/* ── Sign out ── */}
                      <div className="h-px mx-3 mt-2 mb-1" style={{ background: "rgba(255,255,255,0.07)" }} />
                      <button
                        role="menuitem"
                        onClick={() => { setOverflowOpen(false); logout(); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" /></svg>
                        {p.signOut}
                      </button>

                      {/* ── Report bug — de-emphasized utility ── */}
                      <button
                        role="menuitem"
                        onClick={() => { setOverflowOpen(false); setShowBugModal(true); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-white/5 transition-colors"
                        style={{ color: "rgba(255,255,255,0.25)" }}
                      >
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135 23.863 23.863 0 01.497-5.93c.15-.667-.107-1.358-.661-1.755a1.908 1.908 0 00-1.902-.098L12 3.75 6.99.375a1.91 1.91 0 00-1.902.098c-.554.397-.81 1.088-.66 1.755.27 1.215.426 2.47.496 5.93a23.91 23.91 0 01-1.152 6.135A24.087 24.087 0 0112 12.75z" /></svg>
                        {p.reportBug}
                      </button>
                    </div>,
                    document.body
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {isAuthenticated && (
                  <button
                    onClick={handleFollow}
                    disabled={followLoading}
                    className="flex-1 min-w-[80px] min-h-[40px] py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                    style={isFollowing
                      ? { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }
                      : { background: accentGradient, color: "#fff" }
                    }
                  >
                    {followLoading ? "..." : isFollowing ? p.following_verb : p.follow}
                  </button>
                )}
                {followError && (
                  <p className="text-xs text-center w-full" style={{ color: "#FF453A" }}>{followError}</p>
                )}
                <button
                  onClick={() => navigate(`/dm/${profile.id || paramUserId}`)}
                  className="flex-1 min-w-[80px] min-h-[40px] py-2 rounded-lg text-white text-sm font-semibold border border-white/20 hover:border-white/40 transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {p.message}
                </button>
                {profile.username && (
                  <button
                    onClick={() => window.open(`https://t.me/${profile.username}`, "_blank")}
                    title="Message on Telegram"
                    aria-label="Message on Telegram"
                    className="min-h-[40px] min-w-[40px] p-2 rounded-lg text-white border border-white/20 hover:border-white/40 transition-colors flex items-center justify-center flex-shrink-0"
                  >
                    <svg
                      className="w-4 h-4 flex-shrink-0"
                      style={{ color: "#29B6F6" }}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                    </svg>
                  </button>
                )}
                {profile.creatorStatus === "active" && isAuthenticated && !isOwnProfile && (() => {
                  const tc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
                  return (
                    <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
                      <button
                        onClick={handleSubscribe}
                        disabled={subscribeLoading}
                        className="w-full min-h-[40px] py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                        style={isSubscribed
                          ? { background: `rgba(${tc.rgb},0.12)`, color: tc.color, border: `1px solid rgba(${tc.rgb},0.35)` }
                          : { background: tc.gradient, color: "#fff" }
                        }
                      >
                        {subscribeLoading ? "..." : isSubscribed ? `${tc.emoji} ${p.subscribed}` : `${tc.emoji} ${p.subscribe} $${profile.creatorPriceUsd ?? tc.price}/mo`}
                      </button>
                      {/* H8: Show expiry date when subscribed */}
                      {isSubscribed && subscriptionExpiresAt && (
                        <p className="text-[10px] text-center" style={{ color: expiringSoon ? "#FFB454" : "var(--pnp-text-secondary)" }}>
                          {expiringSoon
                            ? p.expiringSoonWarning.replace("{days}", String(daysUntilExpiry))
                            : `${p.subscriptionActiveUntil} ${new Date(subscriptionExpiresAt).toLocaleDateString()}`}
                        </p>
                      )}
                      {/* M6: Show renew button when expiring within 7 days */}
                      {isSubscribed && expiringSoon && (
                        <button
                          onClick={() => {
                            setSubscribeEmail("");
                            setSubscribeEmailError(null);
                            setSubscribeError(null);
                            setSubscribeAwaitingPayment(false);
                            setSubscribePaymentId(null);
                            setSubscribeProvider("usdc");
                            setShowSubscribeModal(true);
                          }}
                          className="w-full min-h-[36px] py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          style={{ background: tc.gradient, color: "#fff", opacity: 0.85 }}
                        >
                          {p.renewSubscription}
                        </button>
                      )}
                    </div>
                  );
                })()}
                {/* Tag in a post — active creators viewing another active creator */}
                {!isOwnProfile && profile.creatorStatus === "active" && user?.creator_status === "active" && (
                  <button
                    onClick={() => setShowTagComposer(v => !v)}
                    className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-lg flex-shrink-0 transition-all"
                    style={showTagComposer
                      ? { background: "rgba(94,209,196,0.12)", color: "#5ED1C4", border: "1px solid rgba(94,209,196,0.35)" }
                      : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.12)" }
                    }
                    title="Tag in a post"
                    aria-label="Tag this creator in a post"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                    </svg>
                  </button>
                )}
                {/* Share profile — icon-only button */}
                <button
                  onClick={handleShareProfile}
                  className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-lg flex-shrink-0 transition-all"
                  style={shareProfileCopied
                    ? { background: "rgba(52,199,89,0.1)", color: "#34C759", border: "1px solid rgba(52,199,89,0.3)" }
                    : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.12)" }
                  }
                  title="Share profile"
                  aria-label="Share this profile"
                >
                  {shareProfileCopied ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
                    </svg>
                  )}
                </button>
              </div>
              {isPerformer && profile.performerData?.isAvailable && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowBookCall(true)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95"
                    style={{ background: "rgba(212,0,122,0.15)", border: "1px solid rgba(212,0,122,0.3)", color: "#D4007A" }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Book a Session
                  </button>
                </div>
              )}
              {/* Block / Report — authenticated, other profiles only */}
              {isAuthenticated && (
                <div className="flex justify-end gap-2 mt-1">
                  <button
                    onClick={() => setShowReportModal(true)}
                    className="text-xs px-3 min-h-[36px] rounded-full transition-colors"
                    style={{ background: "rgba(255,180,84,0.08)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.25)" }}
                    title={p.reportUser}
                  >
                    {p.reportUser}
                  </button>
                  <button
                    onClick={handleBlock}
                    disabled={blockLoading}
                    className="text-xs px-3 min-h-[36px] rounded-full disabled:opacity-50 transition-colors"
                    style={isBlocked
                      ? { background: "rgba(255,59,48,0.12)", color: "#FF453A", border: "1px solid rgba(255,59,48,0.3)" }
                      : { background: "rgba(255,255,255,0.05)", color: "var(--pnp-text-secondary)", border: "1px solid rgba(255,255,255,0.1)" }
                    }
                  >
                    {blockLoading ? "..." : isBlocked ? "Unblock" : "Block"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {subscribeError && (
          <p className="text-xs text-red-400 mt-2 text-center">{subscribeError}</p>
        )}
        {/* M7: Payment confirmed banner */}
        {paymentConfirmedBanner && (
          <div
            className="mt-2 rounded-xl px-4 py-2.5 text-sm font-medium text-center"
            style={{ background: "rgba(52,199,89,0.12)", color: "#34C759", border: "1px solid rgba(52,199,89,0.3)" }}
            role="status"
            aria-live="polite"
          >
            {p.paymentConfirmedSuccess}
          </div>
        )}
        </div>
      </div>

      {/* ── Unsubscribe Confirm Dialog (H9) ── */}
      {showUnsubscribeConfirm && profile && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => setShowUnsubscribeConfirm(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-sm mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border border-white/10 animate-in slide-in-from-bottom duration-200"
            style={{ padding: "1.5rem 1.5rem max(1.5rem, env(safe-area-inset-bottom)) 1.5rem" }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={p.unsubscribeConfirmTitle}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "rgba(255,180,84,0.12)", border: "1px solid rgba(255,180,84,0.25)" }}
            >
              <svg className="w-6 h-6" style={{ color: "#FFB454" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-white text-center mb-2">
              {p.unsubscribeConfirmTitle}
            </h2>
            <p className="text-sm text-center mb-6" style={{ color: "var(--pnp-text-secondary)" }}>
              {p.unsubscribeConfirmBody}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUnsubscribeConfirm(false)}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.12)" }}
              >
                {p.unsubscribeConfirmNo}
              </button>
              <button
                onClick={handleUnsubscribe}
                disabled={subscribeLoading}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                style={{ background: "rgba(255,180,84,0.12)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.3)" }}
              >
                {subscribeLoading ? "..." : p.unsubscribeConfirmYes}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Creator Subscription Payment Modal ── */}
      {showSubscribeModal && profile && (() => {
        const modalTc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
        const accentColor   = modalTc.color;
        const accentRgb     = modalTc.rgb;
        const gradientBg    = modalTc.gradient;
        return (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
          onClick={() => { setShowSubscribeModal(false); setSubscribeAwaitingPayment(false); setSubscribePaymentId(null); setSubscribeError(null); }}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl flex flex-col gap-4"
            style={{
              background: "var(--pnp-surface)",
              border: "1px solid rgba(255,255,255,0.08)",
              maxHeight: "90dvh",
              overflowY: "auto",
              padding: "1.5rem 1.5rem max(1.5rem, env(safe-area-inset-bottom)) 1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Subscribe to creator"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                {p.subscribeTo} {profile.firstName || profile.username || "Creator"}
              </h2>
              <button
                onClick={() => { setShowSubscribeModal(false); setSubscribeAwaitingPayment(false); setSubscribePaymentId(null); setSubscribeError(null); }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Price info */}
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: `rgba(${accentRgb},0.08)`, border: `1px solid rgba(${accentRgb},0.2)` }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: gradientBg }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">${profile.creatorPriceUsd ?? 15}{p.perMonth}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--pnp-text-secondary)" }}>{p.exclusiveCreatorAccess}</p>
              </div>
            </div>

            {usdcOrder ? (
              /* NowPayments waiting panel — auto-closes on success via onSuccess callback */
              <NowPaymentsWaitingPanel
                order={usdcOrder}
                isSuccess={usdcPaymentSuccess}
                onCancel={() => { cancelNowPayments(); setSubscribeError(null); }}
                lang={t.lang}
              />
            ) : !subscribeAwaitingPayment ? (
              <>
                {/* Payment method selector */}
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: "var(--pnp-text-secondary)" }}>{p.paymentMethod}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {usdcAvailable !== false && (
                      <button
                        type="button"
                        onClick={() => setSubscribeProvider("usdc")}
                        className="py-2.5 rounded-lg text-sm font-medium text-center border transition-colors"
                        style={subscribeProvider === "usdc"
                          ? { background: "rgba(38,161,123,0.20)", color: "#26a17b", borderColor: "rgba(38,161,123,0.5)" }
                          : { background: "rgba(38,161,123,0.06)", color: "#26a17b", borderColor: "rgba(38,161,123,0.2)" }}
                      >
                        🪙 Crypto −20%
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSubscribeProvider("epayco")}
                      className="py-2.5 rounded-lg text-sm font-medium text-center border transition-colors"
                      style={subscribeProvider === "epayco"
                        ? { background: "rgba(230,77,77,0.20)", color: "#e64d4d", borderColor: "rgba(230,77,77,0.5)" }
                        : { background: "rgba(230,77,77,0.06)", color: "#e64d4d", borderColor: "rgba(230,77,77,0.2)" }}
                    >
                      💳 ePayco
                    </button>
                    {dashAvailable !== false && (
                      <button
                        type="button"
                        onClick={() => setSubscribeProvider("dash")}
                        className="py-2.5 rounded-lg text-sm font-medium text-center border transition-colors"
                        style={subscribeProvider === "dash"
                          ? { background: "rgba(0,141,228,0.20)", color: "#008DE4", borderColor: "rgba(0,141,228,0.5)" }
                          : { background: "rgba(0,141,228,0.06)", color: "#008DE4", borderColor: "rgba(0,141,228,0.2)" }}
                      >
                        🥷 Dash
                      </button>
                    )}
                    {btcAvailable && (
                      <button
                        type="button"
                        onClick={() => setSubscribeProvider("btc")}
                        className="py-2.5 rounded-lg text-sm font-medium text-center border transition-colors"
                        style={subscribeProvider === "btc"
                          ? { background: "rgba(247,147,26,0.20)", color: "#F7931A", borderColor: "rgba(247,147,26,0.5)" }
                          : { background: "rgba(247,147,26,0.06)", color: "#F7931A", borderColor: "rgba(247,147,26,0.2)" }}
                      >
                        ₿ Bitcoin
                      </button>
                    )}
                  </div>
                </div>

                {/* Email input */}
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--pnp-text-secondary)" }}>{p.emailForReceipt}</label>
                  <input
                    type="email"
                    value={subscribeEmail}
                    onChange={(e) => { setSubscribeEmail(e.target.value); setSubscribeEmailError(null); }}
                    placeholder={p.emailPlaceholder}
                    className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-colors"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: subscribeEmailError ? "1px solid #FF453A" : "1px solid rgba(255,255,255,0.1)",
                    }}
                    autoComplete="email"
                    inputMode="email"
                  />
                  {subscribeEmailError && (
                    <p className="text-xs mt-1" style={{ color: "#FF453A" }}>{subscribeEmailError}</p>
                  )}
                </div>

                {(subscribeError || nowpaymentsError) && (
                  <p className="text-xs text-center" style={{ color: "#FF453A" }}>{subscribeError || nowpaymentsError}</p>
                )}

                <button
                  onClick={handleSubscribePayment}
                  disabled={subscribePaymentLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: gradientBg }}
                >
                  {subscribePaymentLoading ? p.openingPayment : p.payPerMonth.replace('${price}', String(profile.creatorPriceUsd ?? 15))}
                </button>
              </>
            ) : (
              <>
                {/* Awaiting payment state (Dash / BTC via BTCPay) */}
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `rgba(${accentRgb},0.12)`, border: `1px solid rgba(${accentRgb},0.25)` }}>
                    <svg className="w-6 h-6 animate-spin" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-white text-center">{p.waitingForPaymentConfirmation}</p>
                  <p className="text-xs text-center" style={{ color: "var(--pnp-text-secondary)" }}>
                    {p.completePaymentInTab}
                  </p>
                </div>

                {subscribeError && (
                  <p className="text-xs text-center" style={{ color: "#FF453A" }}>{subscribeError}</p>
                )}

                <button
                  onClick={handleCheckSubscriptionStatus}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white border transition-colors"
                  style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" }}
                >
                  {p.iCompletedPayment}
                </button>

                <button
                  onClick={() => { setSubscribeAwaitingPayment(false); setSubscribePaymentId(null); setSubscribeError(null); }}
                  className="text-xs text-center"
                  style={{ color: "var(--pnp-text-secondary)" }}
                >
                  {p.goBack}
                </button>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── Tag-in-a-post composer (active creator → active creator only) ── */}
      {showTagComposer && profile && !isOwnProfile && (
        <div className="mb-4">
          <PostComposer
            onPostCreated={() => setShowTagComposer(false)}
            placeholder={`Post with @${profile.username || "creator"}…`}
            initialTaggedPerformers={[{
              id: profile.id,
              username: profile.username || "",
              avatar_url: resolvePhotoUrl(profile.photoUrl),
              creator_status: profile.creatorStatus ?? null,
            } as MentionUser]}
          />
        </div>
      )}

      {/* ── Tabs (sticky) ── */}
      <div
        className="flex border-b border-white/10 mb-4 sticky z-20 -mx-4 px-4 backdrop-blur-md"
        style={{ top: 0, background: "rgba(18,18,20,0.82)" }}
        role="tablist"
        aria-label="Profile sections"
      >
        <button
          role="tab"
          aria-selected={activeTab === "posts"}
          onClick={() => setActiveTab("posts")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${
            activeTab === "posts" ? "text-white" : "text-white/50 hover:text-white/70"
          }`}
        >
          {p.tabPosts}
          {activeTab === "posts" && (
            <span
              className="absolute left-4 right-4 bottom-0 h-0.5 rounded-full"
              style={{ background: `linear-gradient(to right, ${accentColor}, ${isPerformer ? "#00D4E8" : "#E69138"})` }}
            />
          )}
        </button>
        {/* Exclusive tab — only shown on active creator profiles */}
        {profile.creatorStatus === "active" && (
          <button
            role="tab"
            aria-selected={activeTab === "exclusive"}
            onClick={() => setActiveTab("exclusive")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors flex items-center justify-center gap-1.5 relative ${
              activeTab === "exclusive" ? "text-white" : "text-white/50 hover:text-white/70"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            {p.tabExclusive}
            {activeTab === "exclusive" && (
              <span
                className="absolute left-4 right-4 bottom-0 h-0.5 rounded-full"
                style={{ background: "linear-gradient(to right, #D4007A, #E69138)" }}
              />
            )}
          </button>
        )}
      </div>

      {/* ── Compose (own profile, posts tab) ── */}
      {isOwnProfile && activeTab === "posts" && (
        <div className="mb-4">
          <PostComposer
            onPostCreated={() => loadProfile()}
            placeholder={p.composePlaceholder}
          />
        </div>
      )}

      {/* ── Posts Feed ── */}
      {activeTab === "posts" && (
        <>
          {posts.length === 0 ? (
            <div className="glass-card-sm p-8 text-center">
              <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--pnp-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              <p className="text-white font-medium mb-1">{p.noPostsYet}</p>
              <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>
                {isOwnProfile
                  ? p.shareFirstPost
                  : p.userHasntPosted}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  isOwn={String(user?.dbId) === post.author_id}
                  isAdmin={user?.role === "admin" || user?.role === "superadmin"}
                  isOwnProfile={isOwnProfile}
                  isSubscribed={isSubscribed}
                  creatorPriceUsd={profile.creatorPriceUsd}
                  currentUserId={String(user?.dbId || "")}
                  userLang={lang}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onAuthorTap={handleAuthorTap}
                  onSubscribeCta={handleSubscribeCta}
                  onReport={(postId) => {
                    setReportCategory("");
                    setReportDescription("");
                    setReportError(null);
                    setReportSent(false);
                    setReportEvidencePostId(postId);
                    setShowReportModal(true);
                  }}
                  contentDisclaimerAccepted={contentDisclaimer}
                  onAcceptDisclaimer={handleContentDisclaimerToggle}
                  viewerCity={user?.city}
                  viewerCountry={user?.country}
                />
              ))}

              {/* Load more */}
              {!freeViewerLimited && nextCursor && (
                <div className="text-center py-4">
                  <button
                    onClick={() => loadProfile(nextCursor)}
                    disabled={loadingMore}
                    className="text-sm font-medium hover:text-pnp-accent transition-colors"
                    style={{ color: "var(--pnp-text-secondary)" }}
                  >
                    {loadingMore ? p.loading : p.loadMorePosts}
                  </button>
                </div>
              )}
              {freeViewerLimited && (
                <div
                  className="rounded-2xl p-5 text-center mx-1 mt-2"
                  style={{ background: "linear-gradient(135deg, rgba(212,0,122,0.12), rgba(230,145,56,0.08))", border: "1px solid rgba(212,0,122,0.25)" }}
                >
                  <p className="text-sm font-bold text-white mb-1">Members see the full profile</p>
                  <p className="text-xs mb-4" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    You're seeing {posts.length} posts. Join PNPtv! to unlock this profile, the community feed, and all channels.
                  </p>
                  <button
                    onClick={() => navigate("/subscribe")}
                    className="text-sm font-semibold px-6 py-2.5 rounded-xl text-white"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                  >
                    Join the community →
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Exclusive Tab ── */}
      {activeTab === "exclusive" && profile.creatorStatus === "active" && (
        <div role="tabpanel" aria-label="Exclusive posts">
          {/* Non-subscriber gate banner */}
          {!isOwnProfile && !isSubscribed && (
            <div
              className="glass-card-sm p-6 mb-4 text-center"
              style={{ border: "1px solid rgba(212,0,122,0.25)" }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <p className="text-white font-bold mb-1">{p.exclusiveContentTitle}</p>
              {((profile.exclusiveVideoCount ?? 0) + (profile.exclusivePhotoCount ?? 0)) > 0 && (
                <div className="flex items-center justify-center gap-2 mb-3 text-sm font-medium" style={{ color: "var(--pnp-text-secondary)" }}>
                  {(profile.exclusiveVideoCount ?? 0) > 0 && (
                    <span>🎬 <strong className="text-white">{profile.exclusiveVideoCount}</strong> {p.exclusiveVideosLabel}</span>
                  )}
                  {(profile.exclusiveVideoCount ?? 0) > 0 && (profile.exclusivePhotoCount ?? 0) > 0 && (
                    <span aria-hidden="true">·</span>
                  )}
                  {(profile.exclusivePhotoCount ?? 0) > 0 && (
                    <span>📸 <strong className="text-white">{profile.exclusivePhotoCount}</strong> {p.exclusivePhotosLabel}</span>
                  )}
                </div>
              )}
              <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--pnp-text-secondary)" }}>
                {profile.creatorPriceUsd != null
                  ? p.subscribeForPriceToUnlock.replace('${price}', String(profile.creatorPriceUsd))
                  : p.subscribeToUnlockAll}
              </p>
              {isAuthenticated ? (
                <button
                  onClick={() => {
                    handleSubscribe();
                    if (subscribeButtonRef.current) {
                      subscribeButtonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                  disabled={subscribeLoading}
                  className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-150 active:scale-[0.97] disabled:opacity-50 min-h-[44px]"
                  style={{ background: profile.creatorType === "ice" ? "linear-gradient(135deg, #A8D8EA, #73B4D4)" : "linear-gradient(135deg, #D4007A, #E69138)" }}
                  aria-label={`Subscribe for $${profile.creatorPriceUsd ?? 15}/mo`}
                >
                  {subscribeLoading ? p.processing : `${p.subscribe} $${profile.creatorPriceUsd ?? 15}/mo`}
                </button>
              ) : (
                <p className="text-xs" style={{ color: "var(--pnp-text-secondary)" }}>{p.signInToSubscribe}</p>
              )}
            </div>
          )}

          {/* Exclusive posts list */}
          {(() => {
            const exclusivePosts = posts.filter(p => p.is_exclusive);
            if (exclusivePosts.length === 0) {
              return (
                <div className="glass-card-sm p-8 text-center">
                  <svg className="w-12 h-12 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "var(--pnp-text-secondary)" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <p className="text-white font-medium mb-1">{p.noExclusivePostsYet}</p>
                  <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>
                    {isOwnProfile
                      ? p.createFirstExclusivePost
                      : p.creatorNoExclusiveYet}
                  </p>
                </div>
              );
            }
            return (
              <div className="space-y-3">
                {exclusivePosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    isOwn={String(user?.dbId) === post.author_id}
                    isAdmin={user?.role === "admin" || user?.role === "superadmin"}
                    isOwnProfile={isOwnProfile}
                    isSubscribed={isSubscribed}
                    creatorPriceUsd={profile.creatorPriceUsd}
                    currentUserId={String(user?.dbId || "")}
                    userLang={user?.language || "en"}
                    onLike={handleLike}
                    onDelete={handleDelete}
                                      onAuthorTap={handleAuthorTap}
                                      onSubscribeCta={handleSubscribeCta}
                                      onReport={(postId) => {
                                        setReportCategory("");
                                        setReportDescription(`Regarding post #${postId}`);
                                        setReportError(null);
                                        setReportSent(false);
                                        setShowReportModal(true);
                                      }}
                                      viewerCity={user?.city}
                                      viewerCountry={user?.country}
                                    />
                                    ))}              </div>
            );
          })()}
        </div>
      )}

      {/* ── Hangout Activity ── */}
      {hangoutActivity.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Hangouts</h2>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {hangoutActivity.map((h) => (
              <button
                key={h.id}
                onClick={() => navigate(`/chat/${h.id}`)}
                className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:bg-white/10 active:scale-95"
                style={{ background: "rgba(123,97,255,0.08)", border: "1px solid rgba(123,97,255,0.15)" }}
              >
                {h.avatarUrl ? (
                  <img src={h.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: h.isMain
                        ? "linear-gradient(135deg, #D4007A, #E69138)"
                        : "linear-gradient(135deg, rgba(123,97,255,0.3), rgba(212,0,122,0.3))",
                      color: h.isMain ? "#fff" : "#7B61FF",
                    }}
                  >
                    {h.isMain ? "P" : (h.name?.[0] || "?").toUpperCase()}
                  </div>
                )}
                <div className="text-left min-w-0">
                  <p className="text-xs font-semibold text-white truncate max-w-[100px]">{h.name}</p>
                  <p className="text-[10px]" style={{ color: "var(--pnp-text-secondary)" }}>
                    {h.messageCount > 0 ? `${h.messageCount} msgs` : "Member"}
                    {h.memberCount > 0 && <> &middot; {h.memberCount} members</>}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {hangoutActivityLoading && (
        <div className="mt-4">
          <div className="h-4 bg-white/10 rounded w-24 mb-3" />
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-shrink-0 w-36 h-14 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {/* ── My Events (own profile only) ── */}
      {isOwnProfile && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">My Events</h2>
            {isAuthenticated && (
              <button
                onClick={() => setShowCreateEvent(true)}
                className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                style={{ background: "rgba(255,180,84,0.12)", color: "#FFB454" }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Create
              </button>
            )}
          </div>

          {myEventsLoading ? (
            <div className="glass-card-sm p-4 animate-pulse">
              <div className="h-4 bg-white/10 rounded w-40 mb-2" />
              <div className="h-3 bg-white/10 rounded w-24" />
            </div>
          ) : myEvents.length === 0 ? (
            <div className="glass-card-sm p-6 text-center">
              <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>No events yet.</p>
              {isAuthenticated && (
                <button onClick={() => setShowCreateEvent(true)} className="mt-2.5 text-xs font-semibold" style={{ color: "#FFB454" }}>
                  Create one
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {myEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onRsvp={async (eventId, shouldRsvp) => {
                    try {
                      const res = shouldRsvp ? await rsvpEvent(eventId) : await unrsvpEvent(eventId);
                      if (res.success) {
                        setMyEvents((prev) =>
                          prev.map((e) =>
                            e.id === eventId
                              ? { ...e, rsvpCount: res.rsvpCount, userRsvpd: res.userRsvpd }
                              : e
                          )
                        );
                      }
                    } catch { /* silent */ }
                  }}
                  canCancel={String(event.creatorId) === String(user?.dbId || user?.id) || (user?.role === "admin" || user?.role === "superadmin")}
                  onCancel={async (eventId) => {
                    // EventCard's own confirm UI handles confirmation before calling onCancel
                    try {
                      await cancelEvent(eventId);
                      setMyEvents((prev) => prev.filter((e) => e.id !== eventId));
                    } catch { /* silent */ }
                  }}
                  onViewDetails={(event) => setDetailEvent(event)}
                />
              ))}
            </div>
          )}

          {showCreateEvent && (
            <CreateEventModal
              canCreateLive={isAuthenticated && (user?.role === "model" || user?.role === "creator" || user?.role === "admin" || user?.role === "superadmin")}
              userGroups={[]}
              onClose={() => setShowCreateEvent(false)}
              onCreated={(ev) => {
                setShowCreateEvent(false);
                setMyEvents((prev) => [ev, ...prev]);
                setDetailEvent(ev);
              }}
            />
          )}
        </div>
      )}

      {/* ── Event Detail Modal ── */}
      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onRsvp={async (eventId, shouldRsvp) => {
            try {
              const res = shouldRsvp ? await rsvpEvent(eventId) : await unrsvpEvent(eventId);
              if (res.success) {
                setMyEvents((prev) =>
                  prev.map((e) =>
                    e.id === eventId
                      ? { ...e, rsvpCount: res.rsvpCount, userRsvpd: res.userRsvpd }
                      : e
                  )
                );
                setDetailEvent((prev) =>
                  prev ? { ...prev, rsvpCount: res.rsvpCount, userRsvpd: res.userRsvpd } : null
                );
              }
            } catch { /* silent */ }
          }}
          onUpdated={(updated) => {
            setMyEvents((prev) => prev.map((e) => e.id === updated.id ? updated : e));
            setDetailEvent(updated);
          }}
        />
      )}

      {/* ── Edit Profile Modal ── */}
      {profile && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          profile={profile}
          onSaved={() => loadProfile()}
        />
      )}

      {/* ── Follow List Modal ── */}
      {showFollowModal && (
        <FollowListModal
          open={!!showFollowModal}
          mode={showFollowModal}
          targetUserId={targetUserId}
          onClose={() => setShowFollowModal(null)}
          onNavigate={(userId) => {
            if (userId === String(user?.id)) navigate("/profile");
            else navigate(`/profile/${userId}`);
          }}
        />
      )}

      {/* ── Book a Call Modal ── */}
      {showBookCall && profile && isPerformer && (
        <BookCallModal
          creator={{
            id: profile.id,
            username: profile.username || profile.firstName || "Creator",
            photo_url: profile.photoUrl || null,
            creator_type: "full_time",
            creator_price_usd: profile.performerData?.basePrice ?? 0,
            bio: profile.bio || null,
          } as CreatorCardCreator}
          isOnline={profile.performerData?.isAvailable ?? false}
          open={showBookCall}
          onClose={() => setShowBookCall(false)}
        />
      )}

      {/* ── Block Confirm Dialog (replaces window.confirm) ── */}
      {showBlockConfirm && profile && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => setShowBlockConfirm(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-sm mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border border-white/10 animate-in slide-in-from-bottom duration-200"
            style={{ padding: "1.5rem 1.5rem max(1.5rem, env(safe-area-inset-bottom)) 1.5rem" }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label="Block user confirmation"
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "rgba(255,59,48,0.12)", border: "1px solid rgba(255,59,48,0.25)" }}
            >
              <svg className="w-6 h-6" style={{ color: "#FF453A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-white text-center mb-2">
              Block {profile.firstName || profile.username || "this user"}?
            </h2>
            <p className="text-sm text-center mb-6" style={{ color: "var(--pnp-text-secondary)" }}>
              They won't be able to see your posts or send you messages.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowBlockConfirm(false)}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.12)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleBlockConfirmed}
                disabled={blockLoading}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                style={{ background: "rgba(255,59,48,0.15)", color: "#FF453A", border: "1px solid rgba(255,59,48,0.3)" }}
              >
                {blockLoading ? "..." : "Block"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── User Report Modal ── */}
      {showReportModal && profile && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => !reportSending && (setShowReportModal(false), setReportSent(false), setReportCategory(""), setReportDescription(""), setReportError(null), setReportEvidencePostId(null))}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-md mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border border-white/10 animate-in slide-in-from-bottom duration-200"
            style={{ maxHeight: "92dvh", overflowY: "auto", padding: "1.25rem 1.25rem max(1.25rem, env(safe-area-inset-bottom)) 1.25rem" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={p.reportTitle}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-pnp-textPrimary flex items-center gap-2">
                  <svg className="w-5 h-5" style={{ color: "#FFB454" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
                  </svg>
                  {p.reportTitle}
                </h2>
                {reportEvidencePostId && (
                  <p className="text-xs mt-0.5" style={{ color: "#FFB454" }}>Reporting post #{reportEvidencePostId}</p>
                )}
              </div>
              <button
                onClick={() => !reportSending && (setShowReportModal(false), setReportSent(false), setReportCategory(""), setReportDescription(""), setReportError(null), setReportEvidencePostId(null))}
                className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
                aria-label={p.reportCancel}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {reportSent ? (
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm text-green-400 font-medium text-center">{p.reportSent}</p>
                <p className="text-xs text-white/50 text-center">{p.reportNoteBlocked}</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-white/60 mb-3">{p.reportSubtitle}</p>
                <div className="space-y-2 mb-4">
                  {([
                    "harassment",
                    "hate",
                    "spam_scam",
                    "impersonation",
                    "nudity_nonconsensual",
                    "self_harm",
                    "csam",
                    "other",
                  ] as ReportCategory[]).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setReportCategory(cat)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors"
                      style={reportCategory === cat
                        ? { background: "rgba(255,180,84,0.12)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.35)" }
                        : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      <span
                        className="w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0"
                        style={{ borderColor: reportCategory === cat ? "#FFB454" : "rgba(255,255,255,0.25)" }}
                      >
                        {reportCategory === cat && <span className="w-2 h-2 rounded-full" style={{ background: "#FFB454" }} />}
                      </span>
                      <span className="flex-1">{p[`reportCategory_${cat}` as keyof typeof p] as string}</span>
                    </button>
                  ))}
                </div>

                <label className="block text-xs font-medium mb-1.5 text-white/60">{p.reportDescriptionLabel}</label>
                <textarea
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  placeholder={p.reportDescriptionPlaceholder}
                  maxLength={1000}
                  rows={3}
                  className="w-full rounded-xl p-3 text-sm bg-pnp-dark text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 border border-white/10 focus:border-[#FFB454]/50 focus:outline-none resize-none"
                />
                <div className="text-[10px] text-white/40 text-right mt-1">{reportDescription.length}/1000</div>

                {reportError && (
                  <p className="text-xs text-red-400 text-center mt-2">{reportError}</p>
                )}

                <button
                  onClick={handleSubmitReport}
                  disabled={!reportCategory || reportSending}
                  className="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 active:scale-[0.98]"
                  style={{ background: "linear-gradient(135deg, #FFB454, #E69138)" }}
                >
                  {reportSending ? "..." : p.reportSubmit}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Bug Report Modal ── */}
      {showBugModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => !bugSending && setShowBugModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-md mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border border-white/10 animate-in slide-in-from-bottom duration-200"
            style={{ maxHeight: "92dvh", overflowY: "auto", padding: "1.25rem 1.25rem max(1.25rem, env(safe-area-inset-bottom)) 1.25rem" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t.support.reportBugTitle}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-pnp-textPrimary flex items-center gap-2">
                <span className="text-red-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135 23.863 23.863 0 01.497-5.93c.15-.667-.107-1.358-.661-1.755a1.908 1.908 0 00-1.902-.098L12 3.75 6.99.375a1.91 1.91 0 00-1.902.098c-.554.397-.81 1.088-.66 1.755.27 1.215.426 2.47.496 5.93a23.91 23.91 0 01-1.152 6.135A24.087 24.087 0 0112 12.75z" />
                  </svg>
                </span>
                {t.support.reportBugTitle}
              </h2>
              <button
                onClick={() => !bugSending && setShowBugModal(false)}
                className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-white/5 transition-colors"
                aria-label="Close bug report"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {bugSent ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm text-green-400 font-medium text-center">{t.support.reportBugSuccess}</p>
              </div>
            ) : (
              <>
                <textarea
                  ref={bugTextareaRef}
                  value={bugText}
                  onChange={(e) => setBugText(e.target.value)}
                  placeholder={t.support.reportBugPlaceholder}
                  maxLength={2000}
                  rows={5}
                  className="w-full rounded-xl p-3 text-sm bg-pnp-dark text-pnp-textPrimary placeholder:text-pnp-textSecondary/50 border border-white/10 focus:border-red-400/50 focus:outline-none resize-none"
                />
                <div className="flex items-center justify-between mt-2 mb-4">
                  <p className="text-[10px] text-pnp-textSecondary">{t.support.reportBugDeviceInfo}</p>
                  <p className="text-[10px] text-pnp-textSecondary">{bugText.length}/2000</p>
                </div>
                <button
                  onClick={handleSubmitBug}
                  disabled={bugSending || bugText.trim().length < 10}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
                >
                  {bugSending ? t.support.reportBugSending : t.support.reportBugSubmit}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
