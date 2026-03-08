import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, Navigate, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useTelegram } from "@/hooks/useTelegram";
import { CristinaWidget } from "@/components/CristinaWidget";
import { NotificationBell } from "@/components/NotificationBell";
import { Toast } from "@/components/Toast";
import { getMessageThreads } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function Layout() {
  const { isAuthenticated, isAdmin, user, isLoading } = useAuth();
  const { isTelegram } = useTelegram();
  const navigate = useNavigate();
  const t = useI18n();
  const [dmUnread, setDmUnread] = useState(0);

  const sidebarLinks = [
    { to: "/", label: t.nav.home, end: true },
    { to: "/chat", label: t.nav.hangouts },
    { to: "/media", label: t.nav.prime },
    { to: "/live", label: t.nav.live },
    { to: "/nearby", label: t.nav.nearby },
    { to: "/dm", label: t.nav.messages },
    { to: "/become-a-model", label: t.nav.becomeModel },
  ];

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

  if (!isAuthenticated && !isLoading) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-pnp-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col border-r border-pnp-border glass-nav">
        <div className="flex items-center justify-between px-6 h-16 border-b border-pnp-border">
          <img src="/Logo2-50.png" alt="PNPTV" className="h-8 w-auto" />
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/dm")} className="relative p-1.5 rounded-lg text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {dmUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#D4007A] rounded-full text-[9px] font-bold text-white flex items-center justify-center">{dmUnread > 9 ? "9+" : dmUnread}</span>
              )}
            </button>
            <NotificationBell />
          </div>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1">
          {sidebarLinks.map((link) => (
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
        </nav>

        <div className="p-4 border-t border-pnp-border">
          {isAuthenticated && (
            <button
              onClick={() => navigate("/profile")}
              className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}>
                {(user?.displayName || t.nav.user)[0].toUpperCase()}
              </div>
              <span className="text-sm text-pnp-textSecondary truncate">
                {user?.displayName || t.nav.user}
              </span>
            </button>
          )}
        </div>
      </aside>

      {/* Topbar for mobile */}
      <header className="lg:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-4 glass-nav border-b border-pnp-border">
        <div className="flex items-center gap-2">
          <img src="/Logo2-50.png" alt="PNPTV" className="h-7 w-auto" />
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={() => navigate("/admin")} className="p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
          <button onClick={() => navigate("/dm")} className="relative p-1 text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {dmUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#D4007A] rounded-full text-[9px] font-bold text-white flex items-center justify-center">{dmUnread > 9 ? "9+" : dmUnread}</span>
            )}
          </button>
          <NotificationBell />
          <button
            onClick={() => navigate("/profile")}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff" }}
          >
            {(user?.displayName || t.nav.user)[0].toUpperCase()}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className={`lg:pl-60 pb-20 lg:pb-0 ${isTelegram ? "pb-24" : ""}`}>
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <div className="lg:hidden">
        <BottomNav />
      </div>

      {/* Cristina AI Support Widget */}
      {isAuthenticated && <CristinaWidget />}

      {/* Toast notifications */}
      {isAuthenticated && <Toast />}
    </div>
  );
}
