import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useTelegram } from "@/hooks/useTelegram";
import { LoginPage } from "@/pages/LoginPage";
import { CristinaWidget } from "@/components/CristinaWidget";
import { NotificationBell } from "@/components/NotificationBell";
import { Toast } from "@/components/Toast";
import { getMessageThreads } from "@/lib/api";

const sidebarLinks = [
  { to: "/", label: "Home", end: true },
  { to: "/chat", label: "Hangouts" },
  { to: "/media", label: "PRIME" },
  { to: "/live", label: "Live" },
  { to: "/booking", label: "Nearby" },
  { to: "/dm", label: "Messages" },
];

export function Layout() {
  const { isAuthenticated, isAdmin, user, isLoading } = useAuth();
  const { isTelegram } = useTelegram();
  const navigate = useNavigate();
  const [dmUnread, setDmUnread] = useState(0);

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
    return <LoginPage />;
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
              className={({ isActive }) =>
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
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "nav-active"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                }`
              }
            >
              Admin
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
                {(user?.displayName || "U")[0].toUpperCase()}
              </div>
              <span className="text-sm text-pnp-textSecondary truncate">
                {user?.displayName || "User"}
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
            {(user?.displayName || "U")[0].toUpperCase()}
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
