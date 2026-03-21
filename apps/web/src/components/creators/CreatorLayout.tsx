import React, { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Toast } from "@/components/Toast";

const TIER_BADGE: Record<string, { label: string; emoji: string }> = {
  ice: { label: "Ice", emoji: "❄" },
  crystal: { label: "Crystal", emoji: "🔮" },
  diamond: { label: "Diamond", emoji: "💎" },
};

const navItems = [
  {
    to: "/creators",
    label: "Dashboard",
    end: true,
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4",
  },
  {
    to: "/creators/content",
    label: "Content",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    to: "/creators/earnings",
    label: "Earnings",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    to: "/creators/payouts",
    label: "Payouts",
    icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  },
  {
    to: "/creators/live",
    label: "Go Live",
    icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
  },
  {
    to: "/creators/availability",
    label: "Availability",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    to: "/creators/analytics",
    label: "Analytics",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    to: "/creators/settings",
    label: "Settings",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.11 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

export default function CreatorLayout() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-pnp-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#D4007A", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // Allow /creators/apply without creator_status check
  const isApplyPath = location.pathname === "/creators/apply";

  if (!isAuthenticated || (!isApplyPath && user?.creator_status !== "active")) {
    if (isAuthenticated && !isApplyPath) {
      navigate("/creators/apply", { replace: true });
      return null;
    }
    if (!isAuthenticated) {
      return (
        <div className="min-h-screen bg-pnp-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-xl font-bold text-pnp-textPrimary mb-2">Sign in required</h1>
            <p className="text-sm text-pnp-textSecondary mb-4">Please sign in to access Creator Studio.</p>
            <button onClick={() => navigate("/")} className="px-4 py-2 rounded-lg text-white text-sm" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
              Go Home
            </button>
          </div>
        </div>
      );
    }
  }

  const tierInfo = user?.creator_type ? TIER_BADGE[user.creator_type] : null;
  const subscriberCount = (user as (typeof user & { creator_subscriber_count?: number }) | null)?.creator_subscriber_count ?? 0;

  const sidebar = (
    <nav className="flex flex-col h-screen">
      <div className="flex items-center gap-3 px-4 h-16 border-b border-pnp-border">
        <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
        <span
          className="text-sm font-bold"
          style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          Creator Studio
        </span>
      </div>

      {/* Back to PNPtv link */}
      <div className="px-2 pt-3">
        <button
          onClick={() => { navigate("/"); setSidebarOpen(false); }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Back to PNPtv
        </button>
      </div>

      <div className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }: { isActive: boolean }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "text-white"
                  : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
              }`
            }
            style={({ isActive }: { isActive: boolean }) =>
              isActive
                ? { background: "linear-gradient(135deg, rgba(212,0,122,0.2), rgba(230,145,56,0.2))", borderLeft: "2px solid #D4007A" }
                : {}
            }
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Sidebar footer: creator tier + subscriber count */}
      <div className="p-3 border-t border-pnp-border space-y-2">
        {tierInfo && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.15)" }}>
            <span className="text-sm">{tierInfo.emoji}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold" style={{ color: "#D4007A" }}>{tierInfo.label} Creator</p>
              <p className="text-xs text-pnp-textSecondary truncate">
                {subscriberCount} subscriber{subscriberCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        )}
        <div className="px-3 text-xs text-pnp-textSecondary truncate">
          {user?.displayName || "Creator"}
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-pnp-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-56 lg:flex-col border-r border-pnp-border glass-nav">
        {sidebar}
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 bg-pnp-background border-r border-pnp-border z-50">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Mobile topbar */}
      <header className="lg:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-4 glass-nav border-b border-pnp-border">
        <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-pnp-textSecondary">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
          <span
            className="text-xs font-bold"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            Creator Studio
          </span>
        </div>
        <div className="w-8" />
      </header>

      {/* Main content */}
      <main className="lg:pl-56">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>

      <Toast />
    </div>
  );
}
