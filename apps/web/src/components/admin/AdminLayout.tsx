import React, { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Toast } from "@/components/Toast";
import { useI18n } from "@/lib/i18n";

// Routes that creator-admins cannot access. Navigating to these directly
// will show an access-denied screen instead of the page content.
const CREATOR_RESTRICTED_PATHS = new Set([
  "/admin/users",
  "/admin/plans",
  "/admin/access-matrix",
  "/admin/places",
  "/admin/services",
  "/admin/canva",
  "/admin/x-campaigns",
  "/admin/demographics",
  "/admin/mono",
  "/admin/gamification",
  "/admin/streams",
  "/admin/media-packs",
  "/admin/duplicate-accounts",
  "/admin/payment-health",
  "/admin/hangout-telegram-health",
  "/admin/compliance-2257",
  "/admin/invite-links",
  "/admin/referrals",
]);

// Nav item definitions — internal items use { to, labelKey }; external items use { externalUrl, label }
type InternalNavItem = { to: string; labelKey?: string; label?: string; end?: boolean; icon: string; creatorAllowed: boolean };
type ExternalNavItem = { externalUrl: string; label: string; icon: string; creatorAllowed: boolean };
type NavItem = InternalNavItem | ExternalNavItem;

const allNavItems: NavItem[] = [
  { to: "/admin", labelKey: "overview", end: true, icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4", creatorAllowed: true },
  { externalUrl: "https://cms.pnptv.app", label: "CMS Studio", icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4", creatorAllowed: false },
  { to: "/admin/users", labelKey: "users", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z", creatorAllowed: false },
  { to: "/admin/plans", labelKey: "plans", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z", creatorAllowed: false },
  { to: "/admin/access-matrix", labelKey: "accessMatrix", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01", creatorAllowed: false },
  { to: "/admin/posts", labelKey: "posts", icon: "M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2", creatorAllowed: true },
  { to: "/admin/hangouts", labelKey: "hangouts", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z", creatorAllowed: true },
  { to: "/admin/reports", labelKey: "reports", icon: "M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5", creatorAllowed: false },
  { to: "/admin/creators", labelKey: "creators", icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z", creatorAllowed: true },
  { to: "/admin/compliance-2257", label: "2257 Records", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", creatorAllowed: false },
  { to: "/admin/notifications", labelKey: "notifications", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9", creatorAllowed: true },
  { to: "/admin/places", labelKey: "places", icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z", creatorAllowed: false },
  { to: "/admin/services", labelKey: "services", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z", creatorAllowed: false },
  { to: "/admin/canva", labelKey: "canva", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", creatorAllowed: false },
  { to: "/admin/x-campaigns", labelKey: "xCampaignsNav", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", creatorAllowed: false },
  { to: "/admin/demographics", labelKey: "demographics", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", creatorAllowed: false },
  { to: "/admin/mono", labelKey: "mono", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z", creatorAllowed: false },
  { to: "/admin/gamification", labelKey: "gamification", icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z", creatorAllowed: false },
  { to: "/admin/streams", labelKey: "streams", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z", creatorAllowed: false },
  { to: "/admin/media-packs", labelKey: "mediaPacks", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10", creatorAllowed: false },
  { to: "/admin/support", labelKey: "support", icon: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z", creatorAllowed: true },
  { to: "/admin/creator-subscriptions", labelKey: "creatorSubs", icon: "M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z", creatorAllowed: true },
  { to: "/admin/meru-links", labelKey: "meruLinks", icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1", creatorAllowed: false },
  { to: "/admin/duplicate-accounts", labelKey: "duplicateAccounts", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z", creatorAllowed: false },
  { to: "/admin/payment-health", label: "Payment Health", icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z", creatorAllowed: false },
  { to: "/admin/hangout-telegram-health", label: "Hangout Telegram", icon: "M8 10h.01M12 10h.01M8 14h8m5-2c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", creatorAllowed: false },
  { to: "/admin/prime", label: "Prime Channel", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z", creatorAllowed: false },
  { to: "/admin/invite-links", label: "Socio Colombia", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z", creatorAllowed: false },
  { to: "/admin/referrals", label: "Referrals", icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1", creatorAllowed: false },
];

export function AdminLayout() {
  const { isAuthenticated, isAdmin, isCreatorAdmin, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const t = useI18n().admin.nav;

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-pnp-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Not logged in — redirect to Authentik OIDC login, then back to /admin
    const handleAdminLogin = async () => {
      localStorage.setItem("pnptv:adminRedirect", "1");
      const { login: oidcLogin } = await import("@/lib/auth");
      await oidcLogin();
    };
    return (
      <div className="min-h-dvh bg-pnp-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-pnp-textPrimary mb-2">{t.adminPanel}</h1>
          <p className="text-sm text-pnp-textSecondary mb-4">{t.signInPrompt}</p>
          <button onClick={handleAdminLogin} className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm">
            {t.signIn}
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin && !isCreatorAdmin) {
    return (
      <div className="min-h-dvh bg-pnp-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-pnp-textPrimary mb-2">{t.accessDenied}</h1>
          <p className="text-sm text-pnp-textSecondary mb-4">{t.noPrivileges}</p>
          <button onClick={() => navigate("/")} className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm">
            {t.goHome}
          </button>
        </div>
      </div>
    );
  }

  // Creator-admins hitting a restricted path get a section-level access denied
  const isRestrictedForCreator = isCreatorAdmin && CREATOR_RESTRICTED_PATHS.has(location.pathname);

  const navItems = isCreatorAdmin
    ? allNavItems.filter((item) => item.creatorAllowed)
    : allNavItems;

  const sidebar = (
    <nav className="flex flex-col h-dvh">
      <div className="flex items-center gap-3 px-4 h-16 border-b border-pnp-border">
        <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
        <span className="text-sm font-bold text-pnp-accent">Admin</span>
        {isCreatorAdmin && (
          <span className="ml-auto text-xs font-medium px-1.5 py-0.5 rounded bg-pnp-accent/20 text-pnp-accent">
            Creator
          </span>
        )}
      </div>
      <div className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          if ("externalUrl" in item) {
            return (
              <a
                key={item.externalUrl}
                href={item.externalUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                <span className="flex-1">{item.label}</span>
                <svg className="w-3.5 h-3.5 opacity-60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }: { isActive: boolean }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-pnp-accent/20 text-pnp-accent"
                    : "text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface"
                }`
              }
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.labelKey ? ((t as any)[item.labelKey] || item.labelKey) : (item as any).label}
            </NavLink>
          );
        })}
      </div>
      <div className="p-3 border-t border-pnp-border">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surface transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          {t.backToOverview}
        </button>
        <div className="mt-2 px-3 text-xs text-pnp-textSecondary truncate">
          {user?.displayName || "Admin"}
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-pnp-background">
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
          <span className="text-xs font-bold text-pnp-accent">Admin</span>
        </div>
        <div className="w-8" />
      </header>

      {/* Main content */}
      <main className="lg:pl-56">
        <div className="max-w-7xl mx-auto px-4 py-6">
          {isRestrictedForCreator ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <svg className="w-12 h-12 text-pnp-textSecondary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <h2 className="text-lg font-semibold text-pnp-textPrimary mb-1">{t.accessDenied}</h2>
              <p className="text-sm text-pnp-textSecondary mb-4">{t.restrictedSection}</p>
              <button onClick={() => navigate("/admin")} className="px-4 py-2 rounded-lg bg-pnp-accent text-white text-sm">
                {t.backToOverview}
              </button>
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>

      <Toast />
    </div>
  );
}
