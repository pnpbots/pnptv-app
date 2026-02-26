import React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { useTelegram } from "@/hooks/useTelegram";
import { LoginPage } from "@/pages/LoginPage";

const sidebarLinks = [
  { to: "/", label: "Home", end: true },
  { to: "/chat", label: "Hangouts" },
  { to: "/media", label: "PRIME" },
  { to: "/live", label: "Live" },
  { to: "/booking", label: "Nearby" },
];

export function Layout() {
  const { isAuthenticated, user, isLoading } = useAuth();
  const { isTelegram } = useTelegram();
  const navigate = useNavigate();

  if (!isAuthenticated && !isLoading) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-pnp-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col border-r border-pnp-border glass-nav">
        <div className="flex items-center gap-2 px-6 h-16 border-b border-pnp-border">
          <img src="/Logo2-50.png" alt="PNPTV" className="h-8 w-auto" />
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
    </div>
  );
}
