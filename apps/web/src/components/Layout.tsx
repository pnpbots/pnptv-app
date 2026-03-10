import React, { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useTelegram } from "@/hooks/useTelegram";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { CristinaWidget } from "@/components/CristinaWidget";
import { NotificationBell } from "@/components/NotificationBell";
import { Toast } from "@/components/Toast";
import { getMessageThreads } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { LandingPage } from "@/pages/LandingPage";
import { SidebarPlayer, MobilePlayer } from "@/components/SidebarPlayer";
import { useMusicPlayer } from "@/hooks/useMusicPlayer";

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

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout() {
  const { isAuthenticated, isAdmin, user, isLoading } = useAuth();
  const { isTelegram } = useTelegram();
  const { tracks: musicTracks } = useMusicPlayer();
  useViewportHeight();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useI18n();
  const [dmUnread, setDmUnread] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const primaryLinks = [
    { to: "/", label: t.nav.home, end: true },
    { to: "/chat", label: t.nav.hangouts },
    { to: "/media", label: t.nav.prime },
    { to: "/live", label: t.nav.live },
    { to: "/nearby", label: t.nav.nearby },
    { to: "/dm", label: t.nav.messages },
    { to: "/main-stage", label: t.nav.mainStage },
    { to: "/become-a-model", label: t.nav.becomeModel },
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

  useEffect(() => {
    if (!isAuthenticated) return;
    getMessageThreads()
      .then((res) => {
        if (res.success) {
          setDmUnread(res.threads.filter((t: any) => t.unread_count > 0).length);
        }
      })
      .catch(() => {});
    const interval = setInterval(() => {
      getMessageThreads()
        .then((res) => {
          if (res.success) {
            setDmUnread(res.threads.filter((t: any) => t.unread_count > 0).length);
          }
        })
        .catch(() => {});
    }, 30000);
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
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col border-r border-pnp-border glass-nav">
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-pnp-border">
          <img src="/Logo2-50.png" alt="PNPTV" className="h-8 w-auto" />
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

        {/* Music player */}
        <SidebarPlayer />

        {/* User profile card + language */}
        <div className="p-4 border-t border-pnp-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/profile")}
              className="flex items-center gap-3 flex-1 min-w-0 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
              >
                {(user?.displayName || t.nav.user)[0].toUpperCase()}
              </div>
              <span className="text-sm text-pnp-textSecondary truncate">
                {user?.displayName || t.nav.user}
              </span>
            </button>
            <LanguageSelector position="sidebar" />
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
          <img src="/Logo2-50.png" alt="PNPTV" className="h-7 w-auto" />
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
          <NotificationBell />
          <LanguageSelector position="topbar" />
          <button
            onClick={() => navigate("/profile")}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
            aria-label="Profile"
          >
            {(user?.displayName || t.nav.user)[0].toUpperCase()}
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
            <div className="flex items-center justify-between px-4 h-14 border-b border-pnp-border">
              <img src="/Logo2-50.png" alt="PNPTV" className="h-7 w-auto" />
              <button
                className="p-1.5 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Scrollable nav body */}
            <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5" aria-label="Mobile navigation">
              {/* Primary links */}
              {primaryLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }: { isActive: boolean }) =>
                    `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
                    `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "nav-active"
                        : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                    }`
                  }
                >
                  {t.nav.admin}
                </NavLink>
              )}

              {/* Divider */}
              <div className="py-2 px-1">
                <div className="h-px bg-pnp-border" />
              </div>

              {/* Secondary links */}
              {mobileSecondaryLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }: { isActive: boolean }) =>
                    `block px-3 py-2 rounded-lg text-sm transition-colors ${
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

            {/* Divider + User profile card at the bottom */}
            <div className="border-t border-pnp-border p-4">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate("/profile");
                }}
                className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
                >
                  {(user?.displayName || t.nav.user)[0].toUpperCase()}
                </div>
                <div className="text-left min-w-0">
                  <div className="text-sm font-medium text-pnp-textPrimary truncate">
                    {user?.displayName || t.nav.user}
                  </div>
                  <div className="text-xs text-pnp-textSecondary/60">View profile</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className={`flex-1 overflow-y-auto overscroll-contain lg:pl-60 lg:overflow-visible lg:pb-0 ${musicTracks.length > 0 ? "pb-28" : "pb-16"}`}>
        <Outlet />
      </main>

      {/* Mobile music player + bottom nav */}
      <div className="flex-shrink-0 lg:hidden">
        <MobilePlayer />
        <BottomNav />
      </div>

      {/* Cristina AI Support Widget */}
      {isAuthenticated && <CristinaWidget />}

      {/* Toast notifications */}
      {isAuthenticated && <Toast />}
    </div>
  );
}
