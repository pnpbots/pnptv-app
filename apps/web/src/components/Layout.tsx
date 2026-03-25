import React, { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useTelegram } from "@/hooks/useTelegram";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useOrientation } from "@/hooks/useOrientation";
import { CristinaWidget } from "@/components/CristinaWidget";

import { NotificationBell } from "@/components/NotificationBell";
import { Toast } from "@/components/Toast";
import { useNearbyToggle } from "@/components/NearbyBadge";
import { getMessageThreads, getHangoutGroups, type MessageThread, type HangoutGroup } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LandingPage } from "@/pages/LandingPage";
import { RadioWidget } from "@/components/RadioWidget";
import { NearbyWidget } from "@/components/NearbyWidget";

// ── HamburgerIcon / CloseIcon ─────────────────────────────────────────────────

function HamburgerIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ── Conversation Hub helpers ──────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

interface ConversationItem {
  type: "dm" | "hangout";
  id: string;
  name: string;
  photoUrl: string | null;
  lastMessage: string | null;
  lastActivity: string;
  unreadCount: number;
  memberCount?: number;
  hasActiveCall?: boolean;
  path: string;
}

interface MobileConversationListProps {
  filter: "all" | "dms" | "hangouts";
  threads: MessageThread[];
  hangoutGroups: HangoutGroup[];
  hangoutGroupsLoading: boolean;
  onNavigate: (path: string) => void;
  noConversationsLabel: string;
}

function MobileConversationList({
  filter,
  threads,
  hangoutGroups,
  hangoutGroupsLoading,
  onNavigate,
  noConversationsLabel,
}: MobileConversationListProps) {
  const dmItems: ConversationItem[] = threads.map((th) => ({
    type: "dm",
    id: th.userId,
    name: th.firstName || th.username,
    photoUrl: th.photoUrl,
    lastMessage: th.lastMessage,
    lastActivity: th.lastMessageAt,
    unreadCount: th.unreadCount,
    path: `/dm/${th.userId}`,
  }));

  const hangoutItems: ConversationItem[] = hangoutGroups.map((g) => ({
    type: "hangout",
    id: String(g.id),
    name: g.name,
    photoUrl: g.avatarUrl,
    lastMessage: g.lastMessage,
    lastActivity: g.createdAt,
    unreadCount: g.unreadCount ?? 0,
    memberCount: g.memberCount,
    hasActiveCall: g.hasActiveCall,
    path: `/chat/${g.id}`,
  }));

  let items: ConversationItem[] = [];
  if (filter === "dms") {
    items = dmItems;
  } else if (filter === "hangouts") {
    items = hangoutItems;
  } else {
    // Merge and sort by most recent activity
    items = [...dmItems, ...hangoutItems].sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }

  const isLoading = filter !== "dms" && hangoutGroupsLoading && hangoutItems.length === 0;

  if (isLoading) {
    return (
      <div className="space-y-2 pb-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-1 py-2 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-white/10 rounded w-28" />
              <div className="h-2.5 bg-white/10 rounded w-40" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-pnp-textSecondary/50 text-center py-4 px-2">
        {noConversationsLabel}
      </p>
    );
  }

  return (
    <div className="space-y-0.5 flex-1 overflow-y-auto pb-1">
      {items.map((item) => (
        <button
          key={`${item.type}-${item.id}`}
          onClick={() => onNavigate(item.path)}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-pnp-surface transition-colors text-left"
        >
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {item.photoUrl &&
            (item.photoUrl.startsWith("/") || item.photoUrl.startsWith("http")) ? (
              <img
                src={item.photoUrl}
                alt=""
                className="w-10 h-10 rounded-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display");
                }}
              />
            ) : null}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{
                background: item.type === "hangout" ? "rgba(212,0,122,0.15)" : "rgba(212,0,122,0.2)",
                color: "#D4007A",
                display:
                  item.photoUrl &&
                  (item.photoUrl.startsWith("/") || item.photoUrl.startsWith("http"))
                    ? "none"
                    : undefined,
              }}
            >
              {item.type === "hangout" ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              ) : (
                (item.name || "?")[0].toUpperCase()
              )}
            </div>
            {/* Active call indicator */}
            {item.hasActiveCall && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-pnp-background bg-green-500" />
            )}
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span
                className={`text-sm truncate ${
                  item.unreadCount > 0 ? "font-semibold text-pnp-textPrimary" : "font-medium text-pnp-textSecondary"
                }`}
              >
                {item.name}
              </span>
              <span className="text-[10px] text-pnp-textSecondary/50 flex-shrink-0">
                {timeAgo(item.lastActivity)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1 mt-0.5">
              <span className="text-xs text-pnp-textSecondary/60 truncate">
                {item.lastMessage
                  ? item.lastMessage
                  : item.memberCount !== undefined
                    ? `${item.memberCount} members`
                    : ""}
              </span>
              {item.unreadCount > 0 && (
                <span className="flex-shrink-0 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1" style={{ background: "#D4007A" }}>
                  {item.unreadCount > 9 ? "9+" : item.unreadCount}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout() {
  const { isAuthenticated, isAdmin, user, isLoading } = useAuth();
  const { isTelegram } = useTelegram();
  useViewportHeight();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useI18n();
  const [dmUnread, setDmUnread] = useState(0);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [hangoutGroups, setHangoutGroups] = useState<HangoutGroup[]>([]);
  const [conversationFilter, setConversationFilter] = useState<"all" | "dms" | "hangouts">("all");
  const [hangoutGroupsLoading, setHangoutGroupsLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { enabled: nearbyEnabled, toggle: toggleNearby } = useNearbyToggle();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const isLandscape = useOrientation();
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 1024 : false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const primaryLinks = [
    { to: "/", label: t.nav.home, end: true },
    { to: "/chat", label: t.nav.hangouts },
    { to: "/media", label: t.nav.prime },
    { to: "/live", label: t.nav.live },
    { to: "/channels", label: "Channels" },
    { to: "/dm", label: t.nav.messages },
    { to: "/main-stage", label: t.nav.mainStage },
    { to: "/creators/apply", label: t.nav.becomeModel },
  ];

  const secondaryLinks = [
    { to: "/blog", label: "Blog" },
    { to: "/support", label: "Help" },
    { to: "/community-resources", label: "Community" },
  ];

  const mobileSecondaryLinks = [
    { to: "/blog", label: "Blog" },
    { to: "/support", label: "Help" },
    { to: "/community-resources", label: "Community Resources" },
    { to: "/about", label: "About" },
    { to: "/careers", label: "Careers" },
    { to: "/creators/apply", label: t.nav.becomeModel },
  ];

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileMenuOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  // Fetch hangout groups when mobile menu opens (cache in state between opens)
  useEffect(() => {
    if (!mobileMenuOpen || !isAuthenticated) return;
    if (hangoutGroups.length > 0) return; // already loaded
    setHangoutGroupsLoading(true);
    getHangoutGroups()
      .then((res) => {
        if (res.success) {
          setHangoutGroups(res.groups);
        }
      })
      .catch(() => {})
      .finally(() => setHangoutGroupsLoading(false));
  }, [mobileMenuOpen, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchThreads = () => {
      getMessageThreads()
        .then((res) => {
          if (res.success) {
            setThreads(res.threads);
            setDmUnread(res.threads.filter((th) => th.unreadCount > 0).length);
          }
        })
        .catch(() => {});
    };
    fetchThreads();
    const interval = setInterval(fetchThreads, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Show loading state briefly to avoid flash
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background">
        <div className="w-8 h-8 rounded-full border-2 border-[#D4007A] border-t-transparent animate-spin" />
      </div>
    );
  }

  // Unauthenticated: render the marketing landing page without any app chrome
  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return (
    <div className="app-shell bg-pnp-background">
      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col border-r border-pnp-border glass-nav">
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-pnp-border">
          <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => navigate("/admin")}
                className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
                aria-label="Admin panel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => navigate("/dm")}
              className="relative p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
              aria-label="Direct messages"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {dmUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#D4007A] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {dmUnread > 9 ? "9+" : dmUnread}
                </span>
              )}
            </button>
            <button
              onClick={toggleNearby}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: nearbyEnabled ? "#FBFF00" : "#8E8E93" }}
              aria-label={nearbyEnabled ? "Disable nearby" : "Enable nearby"}
              title={nearbyEnabled ? "Nearby: ON" : "Nearby: OFF"}
            >
              <svg className="w-5 h-5" fill={nearbyEnabled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </button>
            <NotificationBell />
          </div>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto" aria-label="Primary navigation">
          {primaryLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }: { isActive: boolean }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "nav-active"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }: { isActive: boolean }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "nav-active"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                }`
              }
            >
              {t.nav.admin}
            </NavLink>
          )}

          {/* Divider before secondary links */}
          <div className="pt-3 pb-1">
            <div className="h-px bg-pnp-border" />
          </div>

          {/* Secondary links */}
          {secondaryLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }: { isActive: boolean }) =>
                `block px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  isActive
                    ? "text-pnp-textPrimary"
                    : "text-pnp-textSecondary/70 hover:text-pnp-textSecondary hover:bg-pnp-surface"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* User profile card + language */}
        <div className="p-4 border-t border-pnp-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/profile")}
              className="flex items-center gap-3 flex-1 min-w-0 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
                <img
                  src={user.photoUrl}
                  alt={user.displayName || "Profile"}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }}
                />
              ) : null}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: (user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http"))) ? "none" : undefined }}
              >
                {(user?.displayName || t.nav.user)[0].toUpperCase()}
              </div>
              <span className="text-sm text-pnp-textSecondary truncate">
                {user?.displayName || t.nav.user}
              </span>
            </button>

          </div>
        </div>
      </aside>

      {/* ── Mobile topbar ────────────────────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-4 glass-nav border-b border-pnp-border">
        <div className="flex items-center gap-2">
          {/* Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 -ml-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
          >
            <HamburgerIcon />
          </button>
          <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => navigate("/admin")}
              className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
              aria-label="Admin panel"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => navigate("/dm")}
            className="relative p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
            aria-label="Direct messages"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {dmUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#D4007A] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                {dmUnread > 9 ? "9+" : dmUnread}
              </span>
            )}
          </button>
          <button
            onClick={toggleNearby}
            className="p-1 rounded-lg transition-colors"
            style={{ color: nearbyEnabled ? "#FBFF00" : "#8E8E93" }}
            aria-label={nearbyEnabled ? "Disable nearby" : "Enable nearby"}
          >
            <svg className="w-5 h-5" fill={nearbyEnabled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </button>
          <NotificationBell />

          <button
            onClick={() => navigate("/profile")}
            className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={!(user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http"))) ? { background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" } : undefined}
            aria-label="Profile"
          >
            {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
              <img src={user.photoUrl} alt={user.displayName || "Profile"} className="w-full h-full object-cover" onError={(e) => { const btn = e.currentTarget.parentElement!; btn.style.background = "linear-gradient(135deg, #D4007A, #E69138)"; btn.style.color = "#fff"; e.currentTarget.replaceWith(document.createTextNode((user?.displayName || "U")[0].toUpperCase())); }} />
            ) : (
              (user?.displayName || t.nav.user)[0].toUpperCase()
            )}
          </button>
        </div>
      </header>

      {/* ── Mobile slide-out menu ─────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Panel — slides in from left */}
          <div
            ref={mobileMenuRef}
            className="relative w-72 h-full flex flex-col glass-nav border-r border-pnp-border animate-fade-in-up"
            style={{ animationDuration: "0.18s" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 h-11 border-b border-pnp-border flex-shrink-0">
              <img src="/logo-header.png" alt="PNPtv!" className="h-7 w-auto" />
              <button
                className="p-1.5 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Scrollable nav body */}
            <nav className="flex-1 overflow-y-auto flex flex-col min-h-0" aria-label="Mobile navigation">
              {/* ── Conversation Hub ─────────────────────────────────────── */}
              <div className="px-3 pt-2 pb-1 flex flex-col flex-1 min-h-0">
                {/* Filter tabs */}
                <div className="flex gap-1 mb-2 flex-shrink-0">
                  {(["all", "dms", "hangouts"] as const).map((filter) => {
                    const label =
                      filter === "all"
                        ? t.nav.filterAll
                        : filter === "dms"
                          ? t.nav.filterDMs
                          : t.nav.filterHangouts;
                    const isActive = conversationFilter === filter;
                    return (
                      <button
                        key={filter}
                        onClick={() => setConversationFilter(filter)}
                        className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                          isActive
                            ? "text-white"
                            : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                        }`}
                        style={isActive ? { background: "#D4007A" } : {}}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Conversation list */}
                <MobileConversationList
                  filter={conversationFilter}
                  threads={threads}
                  hangoutGroups={hangoutGroups}
                  hangoutGroupsLoading={hangoutGroupsLoading}
                  onNavigate={(path) => {
                    setMobileMenuOpen(false);
                    navigate(path);
                  }}
                  noConversationsLabel={t.nav.noConversations}
                />
              </div>

            </nav>

            {/* Bottom section: secondary links + admin + profile */}
            <div className="flex-shrink-0 border-t border-pnp-border">
              {/* Compact secondary links row */}
              <div className="px-3 pt-2 pb-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {mobileSecondaryLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }: { isActive: boolean }) =>
                      `text-[11px] transition-colors ${
                        isActive
                          ? "text-pnp-textPrimary"
                          : "text-pnp-textSecondary/50 hover:text-pnp-textSecondary"
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                ))}
                {isAdmin && (
                  <NavLink
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }: { isActive: boolean }) =>
                      `text-[11px] font-semibold transition-colors ${
                        isActive
                          ? "nav-active"
                          : "text-pnp-textSecondary/50 hover:text-pnp-textSecondary"
                      }`
                    }
                  >
                    {t.nav.admin}
                  </NavLink>
                )}
              </div>

              {/* User profile card */}
              <div className="px-3 pb-3 pt-1">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate("/profile");
                  }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                >
                  {user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http")) ? (
                    <img
                      src={user.photoUrl}
                      alt={user.displayName || "Profile"}
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.removeProperty("display"); }}
                    />
                  ) : null}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", display: (user?.photoUrl && (user.photoUrl.startsWith("/") || user.photoUrl.startsWith("http"))) ? "none" : undefined }}
                  >
                    {(user?.displayName || t.nav.user)[0].toUpperCase()}
                  </div>
                  <div className="text-left min-w-0">
                    <div className="text-sm font-medium text-pnp-textPrimary truncate">
                      {user?.displayName || t.nav.user}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto overscroll-contain lg:pl-72 lg:overflow-visible lg:pb-0 pb-16">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <div className="flex-shrink-0 lg:hidden">
        <BottomNav />
      </div>

      {/* Widgets: compact strip in landscape video calls on mobile, normal FABs otherwise */}
      {isAuthenticated && (() => {
        const inVideoCall = location.pathname.startsWith("/chat/") || location.pathname === "/main-stage";
        const showWidgetStrip = isLandscape && isMobile && inVideoCall;

        if (showWidgetStrip) {
          return (
            <div className="fixed bottom-3 right-3 z-[38] flex items-center gap-2 rounded-full px-2 py-1.5" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}>
              <RadioWidget compact />
              <NearbyWidget compact />
              <CristinaWidget compact />
            </div>
          );
        }

        return (
          <>
            <RadioWidget />
            <NearbyWidget />
            <CristinaWidget />
          </>
        );
      })()}

      {/* Toast notifications */}
      {isAuthenticated && <Toast />}
    </div>
  );
}
