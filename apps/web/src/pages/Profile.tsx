import React, { useState, useEffect, useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";
import { useTutorial, resetAllTutorials } from "@/hooks/useTutorial";
import { TutorialOverlay } from "@/components/tutorial/TutorialOverlay";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Badge, Skeleton } from "@pnptv/ui-kit";
import { PostComposer } from "@/components/PostComposer";
import {
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
  initiateCreatorSubscriptionPayment,
  searchUsers,
  searchAll,
  type GlobalSearchResult,
  getUserLabel,
  getLabelColor,
  assertPaymentUrl,
  getWalletBalance,
  blockUser,
  unblockUser,
  isUserBlocked,
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
} from "@/lib/api";
import { EventCard } from "@/components/events/EventCard";
import { CreateEventModal } from "@/components/events/CreateEventModal";
import { EventDetailModal } from "@/components/events/EventDetailModal";
import PostCard from "@/components/profile/PostCard";
import EditProfileModal from "@/components/profile/EditProfileModal";
import FollowListModal from "@/components/profile/FollowListModal";
import CreatorEnrollmentWizard, { TIER_CONFIG, type TierId } from "@/components/profile/CreatorEnrollmentWizard";
import MonetizeContentCard from "@/components/profile/MonetizeContentCard";
import IdentityConnections from "@/components/profile/IdentityConnections";
import { BookCallModal } from "@/components/creators/BookCallModal";
import type { CreatorCardCreator } from "@/components/creators/CreatorCard";
import { NearbyBadge, useNearbyToggle } from "@/components/NearbyBadge";
import { getDistanceToUser } from "@/lib/api";

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
  const { isPrime: currentUserIsPrime } = useTier();
  const { userId: paramUserId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const t = useI18n();
  const p = t.profile;
  const isOwnProfile = !paramUserId || paramUserId === String(user?.id) || paramUserId === String(user?.dbId);
  const targetUserId = paramUserId || String(user?.dbId || user?.id || "");
  const { showTutorial, dismissTutorial, dismissForever } = useTutorial("profile");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
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

  // Creator subscription state
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  // Payment-gated subscribe modal state
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [subscribeEmail, setSubscribeEmail] = useState("");
  const [subscribeEmailError, setSubscribeEmailError] = useState<string | null>(null);
  const [subscribeProvider, setSubscribeProvider] = useState<"epayco" | "daimo">("daimo");
  const [subscribePaymentLoading, setSubscribePaymentLoading] = useState(false);
  const [subscribePaymentId, setSubscribePaymentId] = useState<string | null>(null);
  const [subscribeAwaitingPayment, setSubscribeAwaitingPayment] = useState(false);

  const [shareProfileCopied, setShareProfileCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const subscribeButtonRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Search handler
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim().length < 2) {
      setSearchResults(null);
      setSearchOpen(false);
      return;
    }
    setSearchLoading(true);
    setSearchOpen(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchAll(value.trim(), 8);
        if (res.success) setSearchResults(res);
      } catch {
        // fallback to basic user search
        try {
          const res = await searchUsers(value.trim(), 8);
          if (res.success) setSearchResults({ success: true, users: res.users, creators: [], posts: [] });
        } catch { /* ignore */ }
      }
      setSearchLoading(false);
    }, 300);
  }, []);

  // Close search on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Cleanup search timer
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, []);

  // Reset state when navigating between profiles
  useEffect(() => {
    setProfile(null);
    setPosts([]);
    setNextCursor(null);
    setIsFollowing(false);
    setFollowersCount(0);
    setFollowingCount(0);
    setIsSubscribed(false);
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
              .then((subRes) => { if (subRes.success) setIsSubscribed(subRes.subscribed); })
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
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [targetUserId, isOwnProfile, isAuthenticated]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

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
      alert(err instanceof Error ? err.message : "Failed to upload avatar");
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
    try {
      const res = await togglePostLike(postId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked_by_me: res.liked,
                likes_count: p.likes_count + (res.liked ? 1 : -1),
              }
            : p
        )
      );
    } catch {
      // Silent fail
    }
  };

  const handleDelete = async (postId: number) => {
    try {
      await deleteSocialPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch {
      // Silent fail
    }
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
    setBlockLoading(true);
    try {
      const targetId = profile.id || paramUserId!;
      if (isBlocked) {
        await unblockUser(targetId);
        setIsBlocked(false);
      } else {
        if (!window.confirm(`Block ${profile.firstName || profile.username || "this user"}? They won't be able to see your posts or send you messages.`)) {
          setBlockLoading(false);
          return;
        }
        await blockUser(targetId);
        setIsBlocked(true);
      }
    } catch { /* silent */ }
    setBlockLoading(false);
  };

  const handleSubscribe = () => {
    if (!profile) return;
    if (isSubscribed) {
      handleUnsubscribe();
      return;
    }
    if (!currentUserIsPrime) {
      setSubscribeError(p.primeRequiredForCreator);
      setTimeout(() => setSubscribeError(null), 4000);
      return;
    }
    setSubscribeEmail("");
    setSubscribeEmailError(null);
    setSubscribeError(null);
    setSubscribeAwaitingPayment(false);
    setSubscribePaymentId(null);
    setShowSubscribeModal(true);
  };

  const handleUnsubscribe = async () => {
    if (subscribeLoading || !profile) return;
    setSubscribeLoading(true);
    setSubscribeError(null);
    try {
      await unsubscribeFromCreator(profile.id || paramUserId!);
      setIsSubscribed(false);
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : p.failedToUnsubscribe);
    }
    setSubscribeLoading(false);
  };

  const handleSubscribePayment = async () => {
    if (!profile || subscribePaymentLoading) return;
    const trimmed = subscribeEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
      setSubscribeEmailError("Please enter a valid email address");
      return;
    }
    setSubscribeEmailError(null);
    setSubscribePaymentLoading(true);
    setSubscribeError(null);
    try {
      const creatorId = profile.id || paramUserId!;
      const result = await initiateCreatorSubscriptionPayment(creatorId, subscribeProvider, trimmed);
      if (result.success && result.paymentUrl) {
        if (subscribeProvider === "daimo") {
          // Navigate in-tab to the Daimo checkout page — avoids popup blockers
          // and provides the full embedded wallet UX.
          navigate(new URL(assertPaymentUrl(result.paymentUrl)).pathname);
        } else {
          window.open(assertPaymentUrl(result.paymentUrl), "_blank", "noopener,noreferrer");
          setSubscribePaymentId(result.paymentId);
          setSubscribeAwaitingPayment(true);
        }
      } else {
        setSubscribeError(result.error || p.failedToCreatePayment);
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
        <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>
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
        <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="text-white font-medium mb-1">{p.profileNotFound}</p>
        <p className="text-sm mb-4" style={{ color: "#8E8E93" }}>{error || p.userDoesntExist}</p>
        <Button onClick={() => navigate("/")}>{p.goHome}</Button>
      </div>
    );
  }

  // Blocked user state — show minimal profile with unblock option
  if (!isOwnProfile && isBlocked) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        {paramUserId && (
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm mb-4 hover:text-white transition-colors"
            style={{ color: "#8E8E93" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </button>
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
          <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>
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
  const accentGradient = customTheme?.gradient ?? (isPerformer
    ? "linear-gradient(135deg, #5ED1C4, #00D4E8)"
    : "linear-gradient(135deg, #D4007A, #E69138)");
  const accentColor = customTheme?.color ?? (isPerformer ? "#5ED1C4" : "#D4007A");
  const accentBorder = customTheme?.border ?? (isPerformer ? "rgba(94,209,196,0.35)" : "rgba(255,255,255,0.1)");

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>{profile ? `${profile.display_name || profile.username} — PNPtv!` : "Profile — PNPtv!"}</title>
        <meta name="description" content={profile ? `${profile.display_name || profile.username}'s profile on PNPtv.` : "User profile on PNPtv."} />
      </Helmet>
      {isOwnProfile && showTutorial && <TutorialOverlay section="profile" onDismiss={dismissTutorial} onDismissForever={dismissForever} />}
      {/* ── Back button for public profiles ── */}
      {paramUserId && (
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm mb-4 hover:text-pnp-accent transition-colors"
          style={{ color: "#8E8E93" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {p.back}
        </button>
      )}

      {/* ── Profile Search Bar (own profile only) ── */}
      {isOwnProfile && (
        <div ref={searchContainerRef} className="relative mb-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => { if (searchQuery.trim().length >= 2) setSearchOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }}
              placeholder={p.searchPeople}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl text-white placeholder-[#8E8E93] focus:outline-none focus:ring-1 focus:ring-[#D4007A]/50"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", fontSize: "16px" }}
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults(null); setSearchOpen(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "#8E8E93" }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchOpen && (
            <div
              className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-lg max-h-72 overflow-y-auto"
              style={{ background: "rgba(28,28,30,0.95)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}
            >
              {searchLoading ? (
                <div className="flex items-center justify-center py-6">
                  <svg className="w-5 h-5 text-[#D4007A] animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : !searchResults || (searchResults.users.length === 0 && searchResults.creators.length === 0 && searchResults.posts.length === 0) ? (
                <p className="text-center text-sm py-6" style={{ color: "#8E8E93" }}>{p.noUsersFound}</p>
              ) : (
                <>
                  {searchResults.users.length > 0 && (
                    <>
                      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "#8E8E93" }}>People</p>
                      {searchResults.users.map((u) => {
                        const photo = resolvePhotoUrl(u.photo_file_id);
                        const initial = (u.first_name || u.username || "?")[0].toUpperCase();
                        return (
                          <button
                            key={u.id}
                            onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); navigate(`/profile/${u.id}`); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                          >
                            {photo ? (
                              <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                                {initial}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{u.first_name}{u.last_name ? ` ${u.last_name}` : ""}</p>
                              {u.username && <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{u.username}</p>}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                  {searchResults.creators.length > 0 && (
                    <>
                      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "#8E8E93" }}>Creators</p>
                      {searchResults.creators.map((c) => {
                        const photo = c.photo_url ? resolvePhotoUrl(c.photo_url) : null;
                        const initial = (c.display_name || c.username || "?")[0].toUpperCase();
                        return (
                          <button
                            key={c.id}
                            onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); navigate(`/profile/${c.user_id}`); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                          >
                            {photo ? (
                              <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #5ED1C4, #D4007A)", color: "#fff" }}>
                                {initial}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{c.display_name || c.username}</p>
                              {c.category && <p className="text-xs truncate" style={{ color: "#8E8E93" }}>{c.category}</p>}
                            </div>
                            {c.verified && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(94,209,196,0.15)", color: "#5ED1C4" }}>Verified</span>}
                          </button>
                        );
                      })}
                    </>
                  )}
                  {searchResults.posts.length > 0 && (
                    <>
                      <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "#8E8E93" }}>Posts</p>
                      {searchResults.posts.map((post) => (
                        <button
                          key={post.id}
                          onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); navigate(`/profile/${post.author_id}`); }}
                          className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white/60 mb-0.5">@{post.author_username}</p>
                            <p className="text-sm text-white truncate">{post.content}</p>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Profile Header Card ── */}
      <div
        className="glass-card-sm p-6 mb-4"
        style={customTheme?.borderColor ? { borderColor: customTheme.borderColor } : isPerformer ? { borderColor: "rgba(94,209,196,0.2)" } : undefined}
      >
        <div className="flex items-start gap-4">
          {/* Avatar with upload overlay */}
          <div className="relative flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={displayName}
                className="w-20 h-20 rounded-full object-cover border-2"
                style={{ borderColor: isPrime ? "#FFB454" : accentBorder }}
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold border-2"
                style={{
                  background: accentGradient,
                  color: "#fff",
                  borderColor: isPrime ? "#FFB454" : accentBorder,
                }}
              >
                {initial}
              </div>
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
                  className="absolute bottom-0 right-0 w-7 h-7 rounded-full flex items-center justify-center border-2 border-[#1C1C1E]"
                  style={{ background: accentGradient }}
                  title={p.changePhoto}
                >
                  {avatarUploading ? (
                    <svg className="w-3.5 h-3.5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Name & info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-white truncate">{displayName}</h1>
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
            </div>
            {profile.username && (
              <p className="text-sm" style={{ color: "#8E8E93" }}>@{profile.username}</p>
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

            {/* Stats row */}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <span className="text-sm">
                <strong className="text-white">{profile.postCount ?? posts.length}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>{p.posts}</span>
              </span>
              <button
                onClick={() => setShowFollowModal("followers")}
                className="text-sm hover:underline text-left"
              >
                <strong className="text-white">{followersCount}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>{p.followers}</span>
              </button>
              <button
                onClick={() => setShowFollowModal("following")}
                className="text-sm hover:underline text-left"
              >
                <strong className="text-white">{followingCount}</strong>
                <span className="ml-1" style={{ color: "#8E8E93" }}>{p.following}</span>
              </button>
              {profile.creatorStatus === "active" && (profile.creatorSubscriberCount || 0) > 0 && (
                <span className="text-sm">
                  <strong className="text-white">{profile.creatorSubscriberCount}</strong>
                  <span className="ml-1" style={{ color: "#8E8E93" }}>{p.subscribers}</span>
                </span>
              )}
              {profile.creatorStatus === "active" && (() => {
                const exclusiveCount = posts.filter(post => post.is_exclusive).length;
                return exclusiveCount > 0 ? (
                  <span className="text-sm flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" style={{ color: "#D4007A" }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <strong className="text-white">{exclusiveCount}</strong>
                    <span style={{ color: "#8E8E93" }}>{p.exclusive}</span>
                  </span>
                ) : null;
              })()}
              {isPerformer && profile.performerData!.averageRating > 0 && (
                <span className="text-sm flex items-center gap-1" style={{ color: "#5ED1C4" }}>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  <strong className="text-white">{profile.performerData!.averageRating.toFixed(1)}</strong>
                  <span style={{ color: "#8E8E93" }}>{p.rating}</span>
                </span>
              )}
              {isPerformer && (
                <span className="text-sm">
                  <strong className="text-white">{profile.performerData!.totalCalls}</strong>
                  <span className="ml-1" style={{ color: "#8E8E93" }}>{p.calls}</span>
                </span>
              )}
              {profile.locationText && (
                <span className="text-xs flex items-center gap-1" style={{ color: "#8E8E93" }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  {profile.locationText}
                </span>
              )}
            </div>

            {/* Member since */}
            <p className="text-xs mt-2" style={{ color: "#8E8E93" }}>
              <svg className="w-3.5 h-3.5 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              {p.joined} {formatDate(profile.memberSince)}
            </p>
          </div>
        </div>

        {/* Cristina's profile completion nudge */}
        {isOwnProfile && (!photoUrl || !profile.dateOfBirth || !profile.city) && !localStorage.getItem("pnp:cristina-profile-nudge-dismissed") && (
          <div className="mt-4 rounded-xl p-4 relative" style={{ background: "linear-gradient(135deg, rgba(91,200,245,0.08), rgba(0,212,232,0.08))", border: "1px solid rgba(91,200,245,0.25)" }}>
            <button
              onClick={() => { localStorage.setItem("pnp:cristina-profile-nudge-dismissed", "1"); setProfile({ ...profile }); }}
              className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="flex items-start gap-3">
              <span role="img" aria-label="Cristina AI" className="cristina-avatar-glow shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, fontSize: 30 }}>🧜‍♀️</span>
              <div className="flex-1 min-w-0 pr-4">
                <p className="text-sm font-semibold" style={{ color: "#5BC8F5" }}>{p.cristinaHeadline}</p>
                <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
                  {p.cristinaIntro}
                </p>
                <div className="mt-2 space-y-1.5">
                  {!photoUrl && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "rgba(91,200,245,0.2)", color: "#5BC8F5" }}>1</span>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                        <strong className="text-white/80">{p.cristinaUploadPhoto}</strong>{p.cristinaUploadPhotoDesc}
                      </p>
                    </div>
                  )}
                  {!profile.dateOfBirth && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "rgba(91,200,245,0.2)", color: "#5BC8F5" }}>{!photoUrl ? "2" : "1"}</span>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                        <strong className="text-white/80">{p.cristinaAddBirthday}</strong>{p.cristinaAddBirthdayDesc}
                      </p>
                    </div>
                  )}
                  {!profile.city && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "rgba(91,200,245,0.2)", color: "#5BC8F5" }}>{(!photoUrl ? 1 : 0) + (!profile.dateOfBirth ? 1 : 0) + 1}</span>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                        <strong className="text-white/80">{p.cristinaSetLocation}</strong>{p.cristinaSetLocationDesc}
                      </p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { if (!photoUrl) fileInputRef.current?.click(); else setEditOpen(true); }}
                  className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
                  style={{ background: "linear-gradient(135deg, #5BC8F5, #00D4E8)" }}
                >
                  {!photoUrl ? p.cristinaUploadPhotoBtn : p.cristinaEditProfileBtn}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Monetize Content — own profile, not yet active */}
        {isOwnProfile && profile.creatorStatus !== "active" && (
          <MonetizeContentCard creatorStatus={profile.creatorStatus} onActivated={() => loadProfile()} />
        )}


        {/* Action buttons */}
        <div className="mt-4 space-y-2" ref={subscribeButtonRef}>
          {isOwnProfile ? (
            <>
              {/* Primary actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex-1 min-w-[100px] min-h-[40px] py-2 rounded-lg text-sm font-semibold text-white border border-white/20 hover:border-white/40 transition-colors"
                >
                  {p.editProfile}
                </button>
                {profile.creatorStatus === "active" && (() => {
                  const tc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
                  return (
                    <>
                      <button
                        onClick={() => navigate("/creator")}
                        className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
                        style={{ background: `rgba(${tc.rgb},0.15)`, color: tc.color, border: `1px solid rgba(${tc.rgb},0.3)` }}
                      >
                        {tc.emoji} {p.creatorDashboard}
                      </button>
                      <a
                        href="https://studio.pnptv.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                        style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                        Studio
                      </a>
                      <a
                        href={import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                        style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}
                        title="Manage your booking availability on Cal.com"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Bookings
                      </a>
                    </>
                  );
                })()}
              </div>
              {/* Secondary actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => navigate("/become-a-model")}
                  className="flex-1 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/80 transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Become a Model
                </button>
                <button
                  onClick={() => navigate("/main-stage")}
                  className="flex-1 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/80 transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Main Stage
                </button>
                {/* Share Profile */}
                <button
                  onClick={handleShareProfile}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={shareProfileCopied
                    ? { background: "rgba(52,199,89,0.1)", color: "#34C759", border: "1px solid rgba(52,199,89,0.3)" }
                    : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }
                  }
                  title="Share your profile"
                  aria-label="Share profile"
                >
                  {shareProfileCopied ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate("/settings")}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/80 transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  title="Settings"
                  aria-label="Settings"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowBugModal(true)}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs text-red-400/70 hover:text-red-400 transition-colors"
                  style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)" }}
                  title={p.reportBug}
                  aria-label={p.reportBug}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135 23.863 23.863 0 01.497-5.93c.15-.667-.107-1.358-.661-1.755a1.908 1.908 0 00-1.902-.098L12 3.75 6.99.375a1.91 1.91 0 00-1.902.098c-.554.397-.81 1.088-.66 1.755.27 1.215.426 2.47.496 5.93a23.91 23.91 0 01-1.152 6.135A24.087 24.087 0 0112 12.75z" />
                  </svg>
                </button>
                <button
                  onClick={() => { resetAllTutorials(); window.location.reload(); }}
                  className="flex-1 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/80 transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {p.resetTutorials}
                </button>
                <button
                  onClick={logout}
                  className="flex-1 py-1.5 rounded-lg text-xs text-red-400/70 hover:text-red-400 transition-colors"
                  style={{ background: "rgba(255,59,48,0.06)", border: "1px solid rgba(255,59,48,0.12)" }}
                >
                  {p.signOut}
                </button>
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
                {profile.creatorStatus === "active" && isAuthenticated && (() => {
                  const tc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
                  return (
                    <button
                      onClick={handleSubscribe}
                      disabled={subscribeLoading}
                      className="flex-1 min-w-[100px] min-h-[40px] py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                      style={isSubscribed
                        ? { background: `rgba(${tc.rgb},0.12)`, color: tc.color, border: `1px solid rgba(${tc.rgb},0.35)` }
                        : { background: tc.gradient, color: "#fff" }
                      }
                    >
                      {subscribeLoading ? "..." : isSubscribed ? `${tc.emoji} ${p.subscribed}` : `${tc.emoji} ${p.subscribe} $${profile.creatorPriceUsd || tc.price}/mo`}
                    </button>
                  );
                })()}
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
              {isPerformer && (
                <div className="flex gap-2">
                  {/* Cal.com booking — opens creator's booking page on booking.pnptv.app */}
                  {profile.username ? (
                    <a
                      href={`${import.meta.env.VITE_CALCOM_URL || "https://booking.pnptv.app"}/${profile.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95"
                      style={{ background: "rgba(212,0,122,0.15)", border: "1px solid rgba(212,0,122,0.3)", color: "#D4007A" }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Book a Session
                    </a>
                  ) : (
                    <button
                      onClick={() => setShowBookCall(true)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95"
                      style={{ background: "rgba(212,0,122,0.15)", border: "1px solid rgba(212,0,122,0.3)", color: "#D4007A" }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      Book a Call
                    </button>
                  )}
                </div>
              )}
              {/* Block / Unblock — authenticated, other profiles only */}
              {isAuthenticated && (
                <div className="flex justify-end mt-1">
                  <button
                    onClick={handleBlock}
                    disabled={blockLoading}
                    className="text-xs px-3 py-1 rounded-full disabled:opacity-50 transition-colors"
                    style={isBlocked
                      ? { background: "rgba(255,59,48,0.12)", color: "#FF453A", border: "1px solid rgba(255,59,48,0.3)" }
                      : { background: "rgba(255,255,255,0.05)", color: "#8E8E93", border: "1px solid rgba(255,255,255,0.1)" }
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
      </div>

      {/* ── Creator Subscription Payment Modal ── */}
      {showSubscribeModal && profile && (() => {
        const modalTc = TIER_CONFIG[profile.creatorType as TierId] ?? TIER_CONFIG.ice;
        const accentColor   = modalTc.color;
        const accentRgb     = modalTc.rgb;
        const gradientBg    = modalTc.gradient;
        return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}>
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
                <p className="text-sm font-semibold text-white">${profile.creatorPriceUsd || 15}{p.perMonth}</p>
                <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>{p.exclusiveCreatorAccess}</p>
              </div>
            </div>

            {!subscribeAwaitingPayment ? (
              <>
                {/* Provider selector */}
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: "#8E8E93" }}>{p.paymentMethod}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["daimo", "epayco"] as const).map((prov) => (
                      <button
                        key={prov}
                        onClick={() => setSubscribeProvider(prov)}
                        className="py-2.5 rounded-lg text-sm font-medium transition-colors border"
                        style={subscribeProvider === prov
                          ? { background: `rgba(${accentRgb},0.15)`, color: accentColor, borderColor: `rgba(${accentRgb},0.4)` }
                          : { background: "rgba(255,255,255,0.04)", color: "#8E8E93", borderColor: "rgba(255,255,255,0.08)" }
                        }
                      >
                        {prov === "daimo" ? p.cryptoUsdc : p.epaycoCard}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Email input */}
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "#8E8E93" }}>{p.emailForReceipt}</label>
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

                {subscribeError && (
                  <p className="text-xs text-center" style={{ color: "#FF453A" }}>{subscribeError}</p>
                )}

                <button
                  onClick={handleSubscribePayment}
                  disabled={subscribePaymentLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: gradientBg }}
                >
                  {subscribePaymentLoading ? p.openingPayment : p.payPerMonth.replace('${price}', String(profile.creatorPriceUsd || 15))}
                </button>
              </>
            ) : (
              <>
                {/* Awaiting payment state */}
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `rgba(${accentRgb},0.12)`, border: `1px solid rgba(${accentRgb},0.25)` }}>
                    <svg className="w-6 h-6 animate-spin" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-white text-center">{p.waitingForPaymentConfirmation}</p>
                  <p className="text-xs text-center" style={{ color: "#8E8E93" }}>
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
                  style={{ color: "#8E8E93" }}
                >
                  {p.goBack}
                </button>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── Identity & Connections (own profile only) ── */}
      {isOwnProfile && (
        <IdentityConnections telegramUsername={profile.username} />
      )}


      {/* ── Tabs ── */}
      <div className="flex border-b border-white/10 mb-4" role="tablist" aria-label="Profile sections">
        <button
          role="tab"
          aria-selected={activeTab === "posts"}
          onClick={() => setActiveTab("posts")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "posts"
              ? "text-white border-b-2"
              : "text-white/50 hover:text-white/70"
          }`}
          style={activeTab === "posts" ? { borderImage: `linear-gradient(to right, ${accentColor}, ${isPerformer ? "#00D4E8" : "#E69138"}) 1` } : undefined}
        >
          {p.tabPosts}
        </button>
        {/* Exclusive tab — only shown on active creator profiles */}
        {profile.creatorStatus === "active" && (
          <button
            role="tab"
            aria-selected={activeTab === "exclusive"}
            onClick={() => setActiveTab("exclusive")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "exclusive"
                ? "text-white border-b-2"
                : "text-white/50 hover:text-white/70"
            }`}
            style={activeTab === "exclusive" ? { borderImage: "linear-gradient(to right, #D4007A, #E69138) 1" } : undefined}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            {p.tabExclusive}
          </button>
        )}
        <button
          role="tab"
          aria-selected={activeTab === "likes"}
          onClick={() => setActiveTab("likes")}
          className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
            activeTab === "likes"
              ? "text-white border-b-2"
              : "text-white/50 hover:text-white/70"
          }`}
          style={activeTab === "likes" ? { borderImage: `linear-gradient(to right, ${accentColor}, ${isPerformer ? "#00D4E8" : "#E69138"}) 1` } : undefined}
        >
          {p.tabLikes}
        </button>
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
              <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#8E8E93" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              <p className="text-white font-medium mb-1">{p.noPostsYet}</p>
              <p className="text-sm" style={{ color: "#8E8E93" }}>
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
                  isOwn={String(user?.id) === post.author_id}
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
                  contentDisclaimerAccepted={contentDisclaimer}
                  onAcceptDisclaimer={handleContentDisclaimerToggle}
                  viewerCity={user?.city}
                  viewerCountry={user?.country}
                />
              ))}

              {/* Load more */}
              {nextCursor && (
                <div className="text-center py-4">
                  <button
                    onClick={() => loadProfile(nextCursor)}
                    disabled={loadingMore}
                    className="text-sm font-medium hover:text-pnp-accent transition-colors"
                    style={{ color: "#8E8E93" }}
                  >
                    {loadingMore ? p.loading : p.loadMorePosts}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Likes Tab (placeholder) ── */}
      {activeTab === "likes" && (
        <div className="glass-card-sm p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#8E8E93" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <p className="text-white font-medium mb-1">{p.likedPosts}</p>
          <p className="text-sm" style={{ color: "#8E8E93" }}>
            {p.comingSoon}
          </p>
        </div>
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
              <p className="text-sm mb-4 leading-relaxed" style={{ color: "#8E8E93" }}>
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
                  aria-label={`Subscribe for $${profile.creatorPriceUsd || 15}/mo`}
                >
                  {subscribeLoading ? p.processing : `${p.subscribe} $${profile.creatorPriceUsd || 15}/mo`}
                </button>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{p.signInToSubscribe}</p>
              )}
            </div>
          )}

          {/* Exclusive posts list */}
          {(() => {
            const exclusivePosts = posts.filter(p => p.is_exclusive);
            if (exclusivePosts.length === 0) {
              return (
                <div className="glass-card-sm p-8 text-center">
                  <svg className="w-12 h-12 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: "#8E8E93" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <p className="text-white font-medium mb-1">{p.noExclusivePostsYet}</p>
                  <p className="text-sm" style={{ color: "#8E8E93" }}>
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
                    isOwn={String(user?.id) === post.author_id}
                    isAdmin={user?.role === "admin"}
                    isOwnProfile={isOwnProfile}
                    isSubscribed={isSubscribed}
                    creatorPriceUsd={profile.creatorPriceUsd}
                    currentUserId={String(user?.dbId || "")}
                    userLang={user?.language || "en"}
                    onLike={handleLike}
                    onDelete={handleDelete}
                                      onAuthorTap={handleAuthorTap}
                                      onSubscribeCta={handleSubscribeCta}
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
                onClick={() => navigate(`/hangouts/${h.id}`)}
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
                  <p className="text-[10px]" style={{ color: "#8E8E93" }}>
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
              <p className="text-sm" style={{ color: "#8E8E93" }}>No events yet.</p>
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
                    if (!window.confirm("Cancel this event?")) return;
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

      {/* ── Bug Report Modal ── */}
      {showBugModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={() => !bugSending && setShowBugModal(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-md mx-auto bg-pnp-surface rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl border border-white/10 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
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
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
