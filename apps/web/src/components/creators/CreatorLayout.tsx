import React, { useState, useEffect } from "react";
import { Outlet, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import CreatorEnrollmentWizard, {
  TIER_UPGRADE_THRESHOLDS,
  TIER_CONFIG,
  type TierId,
} from "@/components/profile/CreatorEnrollmentWizard";
import { useAuth } from "@/hooks/useAuth";
import { useCreatorData } from "@/hooks/useCreatorData";
import { Toast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/creators/ConfirmDialog";
import {
  getCreatorSetupStatus,
  getCreatorMySubscribers,
  getCreatorChannelSubscribers,
  getCreatorConsents,
  acceptCreatorPrivacyPolicy,
  acceptCreatorTerms,
  acceptTerms,
  updateProfile,
  getCreatorXAccount,
  getCreatorXCampaigns,
  createCreatorXCampaign,
  updateCreatorXCampaign,
  pauseCreatorXCampaign,
  resumeCreatorXCampaign,
  deleteCreatorXCampaign,
  getCreatorXCampaignHistory,
  startCreatorXOAuth,
  getOwnChannels,
  listCreatorInviteLinks,
  createCreatorInviteLink,
  deleteCreatorInviteLink,
  type XAutoCampaign,
  type XAutoCampaignPost,
  type CreatorChannel,
  type CreatorInviteLink,
} from "@/lib/api";
import { Helmet } from "react-helmet-async";

const TIER_BADGE: Record<string, { label: string; emoji: string }> = {
  ice: { label: "Ice", emoji: "❄" },
  crystal: { label: "Crystal", emoji: "🔮" },
  diamond: { label: "Diamond", emoji: "💎" },
};

type CreatorRoleClient = "creator" | "performer" | "both";

// roles: which creator_role values may see this nav item. Omit = always show.
const navItems: Array<{
  to: string;
  label: string;
  end?: boolean;
  icon: string;
  roles?: CreatorRoleClient[];
}> = [
  {
    to: "/creators",
    label: "Dashboard",
    end: true,
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4",
  },
  {
    to: "/creators/apply",
    label: "Setup",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  },
  {
    // Exclusive paid content posts — only roles that include Creator can publish.
    to: "/creators/content",
    label: "Content",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    roles: ["creator", "both"],
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
    // PNP Live streaming — only roles that include Performer can broadcast.
    to: "/creators/live",
    label: "Go Live",
    icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
    roles: ["performer", "both"],
  },
  {
    // Availability = streamer's broadcast schedule. Performer-only feature.
    to: "/creators/availability",
    label: "Availability",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    roles: ["performer", "both"],
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
  {
    to: "/creators/subscribers",
    label: "Subscribers",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    to: "/creators/consents",
    label: "Consents",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    to: "/creators/x-campaigns",
    label: "X Campaigns",
    icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
  },
  {
    to: "/creators/guidelines",
    label: "Guidelines",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
];

export default function CreatorLayout() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { dashboard } = useCreatorData();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingRequiredCount, setPendingRequiredCount] = useState(0);

  useEffect(() => {
    if (user?.creator_status !== "active") return;
    getCreatorSetupStatus().then((res) => {
      if (res?.items) {
        setPendingRequiredCount(res.items.filter(i => i.required && !i.done).length);
      }
    }).catch(() => {});
  }, [user?.creator_status, location.pathname]);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-pnp-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#D4007A", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // Allow /creators/apply without creator_status check
  const isApplyPath = location.pathname === "/creators/apply";

  // Admins and superadmins always pass — they manage the panel without being creators themselves.
  const isAdminRole = user?.role === "admin" || user?.role === "superadmin";
  const isApprovedHold = user?.creator_status === "approved_hold";
  const hasCreatorAccess = isAdminRole || user?.creator_status === "active";

  if (!isAuthenticated) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // Self-service approved users sit in 'approved_hold' until Santino + PNPLatinoBoy
  // click Activate in the admin panel. Show a friendly waiting screen instead of
  // bouncing them back to /creators/apply.
  if (!isApplyPath && !hasCreatorAccess && isApprovedHold) {
    return (
      <div className="min-h-dvh bg-pnp-background flex items-center justify-center p-6">
        <div className="max-w-md w-full glass-card-sm p-8 text-center space-y-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-white">You're approved — waiting on activation</h1>
          <p className="text-sm text-pnp-textSecondary">
            Your creator application is approved. Santino is doing a final review before unlocking the studio.
            You'll get a notification the moment it's live.
          </p>
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-opacity hover:opacity-80"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            Back to PNPtv
          </button>
        </div>
      </div>
    );
  }

  if (!isApplyPath && !hasCreatorAccess) {
    return <Navigate to="/creators/apply" replace />;
  }

  // Filter navItems by the user's creator_role. Admins see everything.
  const userRole = (user?.creator_role as CreatorRoleClient | null | undefined) ?? null;

  const isPerformerOnlyPath = ["/creators/live", "/creators/availability"].some(p => location.pathname.startsWith(p));
  if (isPerformerOnlyPath && !isAdminRole && userRole === "creator") {
    return <Navigate to="/creators" replace />;
  }
  const visibleNavItems = navItems.filter((item) => {
    if (!item.roles) return true;
    if (isAdminRole) return true;
    return userRole ? item.roles.includes(userRole) : false;
  });

  const creatorType = dashboard?.creatorType ?? user?.creator_type ?? null;
  const tierInfo = creatorType ? TIER_BADGE[creatorType] : null;
  const subscriberCount = dashboard?.subscriberCount ?? (user as (typeof user & { creator_subscriber_count?: number }) | null)?.creator_subscriber_count ?? 0;

  const sidebar = (
    <nav className="flex flex-col h-dvh">
      <div className="flex items-center gap-3 px-4 h-16 border-b border-pnp-border">
        <img src="/logo-header.png" alt="PNPtv!" className="h-9 w-auto" />
        <span
          className="text-sm font-bold text-gradient"
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
        {visibleNavItems.map((item) => (
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
            <span className="flex-1">{item.label}</span>
            {item.to === "/creators/apply" && pendingRequiredCount > 0 && (
              <span
                className="min-w-[18px] h-[18px] rounded-full px-1 text-[10px] font-bold text-white flex items-center justify-center shrink-0"
                style={{ background: "#D4007A" }}
              >
                {pendingRequiredCount}
              </span>
            )}
          </NavLink>
        ))}
      </div>

      {/* Sidebar footer: creator tier + subscriber count + next-tier progress */}
      <div className="p-3 border-t border-pnp-border space-y-2">
        {tierInfo && (() => {
          const tierId = (creatorType as TierId | null | undefined) ?? null;
          const upgradeInfo = tierId ? TIER_UPGRADE_THRESHOLDS[tierId] : null;
          const tierCfg = tierId ? TIER_CONFIG[tierId] : null;
          const nextTierLabel = upgradeInfo?.nextTier ? TIER_CONFIG[upgradeInfo.nextTier].name : null;
          const threshold = upgradeInfo?.subscribersNeeded ?? null;
          const pct = threshold ? Math.min((subscriberCount / threshold) * 100, 100) : null;

          return (
            <div className="rounded-lg px-3 py-2.5 space-y-2" style={{ background: tierCfg ? `rgba(${tierCfg.rgb},0.08)` : "rgba(255,255,255,0.05)", border: tierCfg ? `1px solid rgba(${tierCfg.rgb},0.2)` : "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <span className="text-sm">{tierInfo.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold" style={{ color: tierCfg?.color ?? "#D4007A" }}>{tierInfo.label} Creator</p>
                  <p className="text-xs text-pnp-textSecondary">
                    {subscriberCount} subscriber{subscriberCount !== 1 ? "s" : ""}
                    {threshold && subscriberCount < threshold && (
                      <span> &middot; {threshold - subscriberCount} to {nextTierLabel}</span>
                    )}
                    {threshold && subscriberCount >= threshold && nextTierLabel && (
                      <span className="text-xs font-semibold" style={{ color: "#5ED1C4" }}> &middot; Upgrade ready!</span>
                    )}
                  </p>
                </div>
              </div>
              {/* Progress bar toward next tier */}
              {threshold && pct !== null && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-pnp-textSecondary">to {nextTierLabel}</span>
                    <span className="text-[10px] font-semibold text-white">{subscriberCount}/{threshold}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 100 ? "#5ED1C4" : (tierCfg?.gradient ?? "linear-gradient(to right, #D4007A, #E69138)"),
                      }}
                    />
                  </div>
                </div>
              )}
              {!threshold && tierId === "diamond" && (
                <p className="text-[10px] text-pnp-textSecondary">Top tier reached</p>
              )}
            </div>
          );
        })()}
        <div className="px-3 text-xs text-pnp-textSecondary truncate">
          {user?.displayName || "Creator"}
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
          <span
            className="text-xs font-bold text-gradient"
          >
            Creator Studio
          </span>
        </div>
        <div className="w-8" />
      </header>

      {/* Main content */}
      <main className="lg:pl-56">
        <div className="max-w-7xl mx-auto px-4 py-6">
          {user?.creator_locked && <CreatorOnboardingLockBanner lang={user?.language === "es" ? "es" : "en"} />}
          <Outlet />
        </div>
      </main>

      <Toast />
    </div>
  );
}

function CreatorOnboardingLockBanner({ lang }: { lang: "es" | "en" }) {
  const copy = lang === "es"
    ? {
        title: "Tus herramientas de creador están en pausa",
        body: "Serás parte del primer grupo que incorporaremos, justo después de nuestro piloto esta semana. Tu onboarding oficial comienza en ~2 semanas (te compartiremos la fecha exacta muy pronto). Mientras tanto, puedes ver tu panel, pero las herramientas y los cobros a usuarios están temporalmente pausados. Hacemos esto porque queremos invertir de verdad en tu bienestar y éxito como creador.",
      }
    : {
        title: "Your creator tools are temporarily paused",
        body: "You'll be in our first onboarding group — right after this week's pilot. Your official onboarding begins in ~2 weeks (exact date shared very soon). Until then, you can browse your dashboard, but tools and member payments are temporarily paused. We do this because we genuinely want to invest in your wellness and success as a creator.",
      };
  return (
    <div
      role="alert"
      className="mb-6 rounded-xl border p-4 flex gap-3 items-start"
      style={{ background: "rgba(245, 158, 11, 0.08)", borderColor: "rgba(245, 158, 11, 0.35)" }}
    >
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#F59E0B" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M12 21a9 9 0 110-18 9 9 0 010 18z" />
      </svg>
      <div>
        <p className="text-sm font-semibold" style={{ color: "#F59E0B" }}>{copy.title}</p>
        <p className="text-xs text-pnp-textSecondary mt-1 leading-relaxed">{copy.body}</p>
      </div>
    </div>
  );
}

// ── Creator Subscribers Page ──────────────────────────────────────────────────

function resolvePhoto(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("/") || url.startsWith("http")) return url;
  return null;
}

function SubscriberRow({ username, firstName, avatar, since, badge, badgeColor, detail }: {
  username: string; firstName: string; avatar: string | null;
  since: string; badge: string; badgeColor: string; detail: string;
}) {
  const photo = resolvePhoto(avatar);
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
      {photo ? (
        <img src={photo} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-pnp-surface flex items-center justify-center shrink-0">
          <span className="text-sm text-pnp-textSecondary">{(firstName || username || "?")[0].toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{firstName || username}</p>
        <p className="text-xs text-pnp-textSecondary">@{username} · since {new Date(since).toLocaleDateString()}</p>
      </div>
      <div className="text-right shrink-0">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${badgeColor}`}>{badge}</span>
        <p className="text-xs text-pnp-textSecondary mt-1">{detail}</p>
      </div>
    </div>
  );
}

// ── Invite Links sub-panel ────────────────────────────────────────────────────

function InviteLinksPanel() {
  const { user } = useAuth();
  const [links, setLinks] = React.useState<CreatorInviteLink[]>([]);
  const [channels, setChannels] = React.useState<CreatorChannel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState<{
    resourceType: "channel" | "creator";
    resourceId: string;
    durationHours: string;
    maxUses: string;
    note: string;
  }>({ resourceType: "creator", resourceId: "", durationHours: "72", maxUses: "", note: "" });
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [linksRes, chRes] = await Promise.all([listCreatorInviteLinks(), getOwnChannels()]);
      if (linksRes.success) setLinks(linksRes.links);
      if (chRes.success) setChannels(chRes.channels);
    } catch (_) {}
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.resourceId) {
      setFormError("Select a resource.");
      return;
    }
    setSaving(true);
    try {
      const res = await createCreatorInviteLink({
        resourceType: form.resourceType,
        resourceId: form.resourceId,
        durationHours: parseInt(form.durationHours || "72", 10),
        maxUses: form.maxUses ? parseInt(form.maxUses, 10) : null,
        note: form.note || undefined,
      });
      if (res.success) {
        setShowForm(false);
        setForm({ resourceType: "creator", resourceId: "", durationHours: "72", maxUses: "", note: "" });
        await load();
      } else {
        setFormError("Failed to create link.");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create link.");
    }
    setSaving(false);
  };

  const handleDelete = async (code: string) => {
    try {
      await deleteCreatorInviteLink(code);
      setLinks(prev => prev.filter(l => l.code !== code));
    } catch (_) {}
    setDeleteConfirm(null);
  };

  const copyUrl = (code: string) => {
    navigator.clipboard.writeText(`https://pnptv.app/invite/${code}`).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const isExpired = (l: CreatorInviteLink) =>
    (l.expires_at && new Date(l.expires_at) < new Date()) ||
    (l.max_uses !== null && l.use_count >= l.max_uses);

  const resourceLabel = (l: CreatorInviteLink) => {
    if (l.resource_type === "channel") {
      const ch = channels.find(c => String(c.id) === String(l.resource_id));
      return ch ? `📺 ${ch.name}` : `Channel #${l.resource_id}`;
    }
    return "👤 My Profile";
  };

  if (loading) return (
    <div className="animate-pulse space-y-3">
      {[1,2,3].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-pnp-textSecondary">Share links that give fans free trial access to your content.</p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setFormError(null); }}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-pnp-primary text-white hover:opacity-90 transition-opacity shrink-0"
        >
          {showForm ? "Cancel" : "+ New Link"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {/* Resource type */}
          <div>
            <label className="text-xs text-pnp-textSecondary mb-1 block">Access to</label>
            <div className="flex gap-2">
              {(["creator", "channel"] as const).map(rt => (
                <button
                  key={rt}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, resourceType: rt, resourceId: rt === "creator" ? (user?.dbId ?? "") : "" }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${form.resourceType === rt ? "bg-pnp-primary text-white" : "bg-white/5 text-pnp-textSecondary hover:text-white"}`}
                >
                  {rt === "creator" ? "👤 My Profile" : "📺 A Channel"}
                </button>
              ))}
            </div>
          </div>

          {form.resourceType === "channel" && (
            <div>
              <label className="text-xs text-pnp-textSecondary mb-1 block">Channel</label>
              <select
                value={form.resourceId}
                onChange={e => setForm(f => ({ ...f, resourceId: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">Select a channel…</option>
                {channels.map(ch => (
                  <option key={ch.id} value={String(ch.id)}>{ch.name}</option>
                ))}
              </select>
            </div>
          )}

          {form.resourceType === "creator" && (
            <input type="hidden" value={form.resourceId} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-pnp-textSecondary mb-1 block">Duration (hours)</label>
              <input
                type="number" min={1} max={720}
                value={form.durationHours}
                onChange={e => setForm(f => ({ ...f, durationHours: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-pnp-textSecondary mb-1 block">Max uses (blank = unlimited)</label>
              <input
                type="number" min={1}
                placeholder="∞"
                value={form.maxUses}
                onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-pnp-textSecondary mb-1 block">Label (optional)</label>
            <input
              type="text" maxLength={200} placeholder="e.g. Instagram story promo"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}

          <button
            type="submit" disabled={saving}
            className="w-full py-2 rounded-lg text-sm font-semibold bg-pnp-primary text-white disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create Link"}
          </button>
        </form>
      )}

      {links.length === 0 ? (
        <div className="text-center py-10 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
          <p className="text-pnp-textSecondary text-sm">No invite links yet</p>
          <p className="text-pnp-textSecondary/60 text-xs mt-1">Create one to give fans free trial access</p>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map(l => {
            const expired = isExpired(l);
            return (
              <div key={l.code} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", opacity: expired ? 0.5 : 1 }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-white">{l.code}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${expired ? "bg-white/10 text-pnp-textSecondary" : "bg-green-500/20 text-green-400"}`}>
                        {expired ? "Exhausted" : "Active"}
                      </span>
                    </div>
                    <p className="text-xs text-pnp-textSecondary mt-0.5">{resourceLabel(l)}</p>
                    <p className="text-xs text-pnp-textSecondary/70 mt-0.5">
                      {l.duration_hours}h access · {l.use_count}{l.max_uses !== null ? `/${l.max_uses}` : ""} uses
                      {l.note ? ` · ${l.note}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => copyUrl(l.code)}
                      className="p-1.5 rounded-lg text-xs hover:bg-white/10 text-pnp-textSecondary hover:text-white transition-colors"
                      title="Copy link"
                    >
                      {copied === l.code ? "✓" : "⎘"}
                    </button>
                    {!expired && (
                      deleteConfirm === l.code ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleDelete(l.code)} className="px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30">Yes, deactivate</button>
                          <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 rounded text-[10px] bg-white/5 text-pnp-textSecondary">Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(l.code)}
                          className="p-1.5 rounded-lg text-xs hover:bg-white/10 text-pnp-textSecondary hover:text-red-400 transition-colors"
                          title="Deactivate"
                        >
                          ✕
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Creator Subscribers Page ──────────────────────────────────────────────────

export function CreatorSubscribers() {
  const [tab, setTab] = React.useState<"profile" | "channels" | "invite-links">("profile");
  const [profileData, setProfileData] = React.useState<any>(null);
  const [channelData, setChannelData] = React.useState<any>(null);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadProfile = React.useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCreatorMySubscribers(p);
      if (res.success) setProfileData(res);
      else setError("Failed to load subscribers.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscribers.");
    }
    setLoading(false);
  }, []);

  const loadChannels = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCreatorChannelSubscribers();
      if (res.success) setChannelData(res);
      else setError("Failed to load channel subscribers.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channel subscribers.");
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (tab === "profile") loadProfile(page);
    else if (tab === "channels") loadChannels();
  }, [tab, page, loadProfile, loadChannels]);

  const handleTabChange = (t: "profile" | "channels" | "invite-links") => {
    setTab(t);
    setPage(1);
    setError(null);
  };

  const isLoadingInitial = loading && !profileData && !channelData;

  return (
    <>
      <Helmet><title>My Subscribers — Creator Studio — PNPtv!</title></Helmet>
      <div className="p-4 lg:p-6">
        <h1 className="text-xl font-bold text-pnp-textPrimary mb-4">My Subscribers</h1>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.05)" }}>
          {(["profile", "channels", "invite-links"] as const).map(t => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${tab === t ? "bg-pnp-primary text-white shadow-sm" : "text-pnp-textSecondary hover:text-white"}`}
            >
              {t === "profile" ? "Profile" : t === "channels" ? "Channels" : "Invite Links"}
            </button>
          ))}
        </div>

        {tab === "invite-links" ? (
          <InviteLinksPanel />
        ) : isLoadingInitial ? (
          <div className="animate-pulse space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl" />)}
            </div>
            <div className="h-48 bg-white/5 rounded-xl" />
          </div>
        ) : error ? (
          <div className="text-center py-12 rounded-xl" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => tab === "profile" ? loadProfile(page) : loadChannels()} className="mt-3 text-xs text-pnp-textSecondary underline">Retry</button>
          </div>
        ) : tab === "profile" && profileData ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="rounded-xl p-4" style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.2)" }}>
                <p className="text-2xl font-bold text-white">{profileData.stats.active_count}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Active</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(91,200,245,0.08)", border: "1px solid rgba(91,200,245,0.2)" }}>
                <p className="text-2xl font-bold text-white">{profileData.stats.total_count}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Total</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }}>
                <p className="text-2xl font-bold text-white">{profileData.stats.new_this_month}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">New this month</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(230,145,56,0.08)", border: "1px solid rgba(230,145,56,0.2)" }}>
                <p className="text-2xl font-bold text-white">{profileData.stats.churn_rate}%</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Churn rate</p>
              </div>
            </div>

            {profileData.subscribers.length === 0 ? (
              <div className="text-center py-12 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                <p className="text-pnp-textSecondary text-sm">No profile subscribers yet</p>
                <p className="text-pnp-textSecondary/60 text-xs mt-1">Share your profile to attract subscribers</p>
              </div>
            ) : (
              <div className="space-y-2">
                {profileData.subscribers.map((sub: any) => (
                  <SubscriberRow
                    key={sub.id}
                    username={sub.subscriber_username}
                    firstName={sub.subscriber_first_name}
                    avatar={sub.subscriber_avatar}
                    since={sub.started_at}
                    badge={sub.status}
                    badgeColor={sub.status === "active" ? "bg-green-500/20 text-green-400" : "bg-white/10 text-pnp-textSecondary"}
                    detail={`$${Number(sub.revenue || 0).toFixed(2)}`}
                  />
                ))}
              </div>
            )}

            {profileData.pagination.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-xs text-white bg-white/10 disabled:opacity-30">← Prev</button>
                <span className="px-3 py-1.5 text-xs text-pnp-textSecondary">{page} / {profileData.pagination.totalPages}</span>
                <button disabled={page >= profileData.pagination.totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-xs text-white bg-white/10 disabled:opacity-30">Next →</button>
              </div>
            )}
          </>
        ) : tab === "channels" && channelData ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-xl p-4" style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.2)" }}>
                <p className="text-2xl font-bold text-white">{channelData.summary.total_channel_subscribers}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Total channel subs</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(91,200,245,0.08)", border: "1px solid rgba(91,200,245,0.2)" }}>
                <p className="text-2xl font-bold text-white">{channelData.summary.total_channels}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Active channels</p>
              </div>
            </div>

            {channelData.channels.length === 0 ? (
              <div className="text-center py-12 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                <p className="text-pnp-textSecondary text-sm">No active channels yet</p>
                <p className="text-pnp-textSecondary/60 text-xs mt-1">Create channels from your Studio to grow your audience</p>
              </div>
            ) : (
              <div className="space-y-5">
                {channelData.channels.map((ch: any) => (
                  <div key={ch.id} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-3 px-4 py-3" style={{ background: "rgba(255,255,255,0.05)" }}>
                      {ch.cover_image_url ? (
                        <img src={ch.cover_image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-pnp-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-base">📺</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{ch.name}</p>
                        <p className="text-xs text-pnp-textSecondary">
                          {ch.access_type === "subscription" ? `$${ch.price_usd}/mo` : ch.access_type === "prime" ? "PRIME" : "Free"}
                          {" · "}{ch.new_this_month} new this month
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-white">{ch.subscriber_count}</p>
                        <p className="text-[10px] text-pnp-textSecondary">subscribers</p>
                      </div>
                    </div>
                    {ch.subscribers.length > 0 && (
                      <div className="divide-y divide-white/5">
                        {ch.subscribers.map((s: any) => (
                          <SubscriberRow
                            key={s.user_id}
                            username={s.username}
                            firstName={s.first_name}
                            avatar={s.avatar}
                            since={s.created_at}
                            badge="subscribed"
                            badgeColor="bg-pnp-primary/20 text-pnp-primary"
                            detail=""
                          />
                        ))}
                        {ch.subscriber_count > 20 && (
                          <p className="text-center text-xs text-pnp-textSecondary py-2">
                            +{ch.subscriber_count - 20} more subscribers
                          </p>
                        )}
                      </div>
                    )}
                    {ch.subscribers.length === 0 && (
                      <div className="text-center py-6">
                        <p className="text-xs text-pnp-textSecondary">No subscribers yet</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}

// ── Creator Consents Page ─────────────────────────────────────────────────────

type ConsentRowStatus = "accepted" | "pending" | "submitted" | "missing" | "info";
type ConsentRow = {
  label: string;
  status: ConsentRowStatus;
  detail?: string | null;
  date?: string | null;
  href?: string;
  expandContent?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
};

function statusPillClass(s: ConsentRowStatus): string {
  switch (s) {
    case "accepted":
    case "submitted":
      return "bg-green-500/20 text-green-400";
    case "missing":
      return "bg-red-500/20 text-red-400";
    case "info":
      return "bg-white/10 text-white/70";
    case "pending":
    default:
      return "bg-amber-500/20 text-amber-400";
  }
}

function statusLabel(s: ConsentRowStatus): string {
  switch (s) {
    case "accepted":   return "Accepted";
    case "submitted":  return "Submitted";
    case "missing":    return "Missing";
    case "info":       return "On file";
    case "pending":
    default:           return "Pending";
  }
}

function ConsentRowList({ rows }: { rows: ConsentRow[] }) {
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);
  return (
    <div className="space-y-2">
      {rows.map((item, i) => {
        const isExpanded = expandedIdx === i;
        const isExpandable = !!item.expandContent;
        const isLink = !!item.href;
        const hasAction = !!item.onAction;

        const header = (
          <div className="flex items-center justify-between gap-3 px-4 py-3 w-full">
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-medium text-white">{item.label}</p>
              {item.detail && (
                <p className="text-xs text-pnp-textSecondary mt-0.5 truncate">{item.detail}</p>
              )}
              {item.date && (
                <p className="text-[10px] text-pnp-textSecondary/70 mt-0.5">
                  {new Date(item.date).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${statusPillClass(item.status)}`}>
                {statusLabel(item.status)}
              </span>
              {isLink && (
                <svg className="w-4 h-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              )}
              {isExpandable && (
                <svg className={`w-4 h-4 opacity-50 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </div>
          </div>
        );

        return (
          <div key={i} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
            {isLink ? (
              <a href={item.href} target="_blank" rel="noopener noreferrer" className="block hover:bg-white/5 transition-colors" style={{ textDecoration: "none" }}>
                {header}
              </a>
            ) : isExpandable ? (
              <button className="block w-full hover:bg-white/5 transition-colors text-left" onClick={() => setExpandedIdx(isExpanded ? null : i)}>
                {header}
              </button>
            ) : (
              <div>{header}</div>
            )}

            {isExpanded && item.expandContent && (
              <div className="px-4 pb-4 text-xs leading-relaxed space-y-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                {item.expandContent}
              </div>
            )}

            {hasAction && (
              <div className="px-4 pb-3">
                <button
                  onClick={item.onAction}
                  className="w-full py-2 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 btn-gradient"
                >
                  {item.actionLabel ?? "Complete"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CreatorConsents() {
  const navigate = useNavigate();
  const [consents, setConsents] = React.useState<any>(null);
  const [userId, setUserId] = React.useState<string | number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [showWizard, setShowWizard] = React.useState(false);
  const [wizardTier] = React.useState<TierId>("ice");
  const [privacyModalOpen, setPrivacyModalOpen] = React.useState(false);
  const [privacyAccepting, setPrivacyAccepting] = React.useState(false);
  const [privacyError, setPrivacyError] = React.useState<string | null>(null);

  // Generic acceptance state for Terms / Content Disclaimer / WoF Photo Consent.
  // Each row used to show "pending" with no way to resolve it from this page.
  // Acceptance is reused across rows; row identified by `kind`.
  const [acceptKind, setAcceptKind] = React.useState<"terms" | "disclaimer" | "creator_terms" | null>(null);
  const [acceptBusy, setAcceptBusy] = React.useState(false);
  const [acceptError, setAcceptError] = React.useState<string | null>(null);
  const [wofBusy, setWofBusy] = React.useState(false);

  React.useEffect(() => {
    getCreatorConsents().then(res => {
      if (res.success) {
        setConsents(res.consents);
        if (res.userId !== undefined && res.userId !== null) setUserId(res.userId);
      } else {
        setLoadError("Failed to load your consent records.");
      }
      setLoading(false);
    }).catch((err) => {
      setLoadError(err instanceof Error ? err.message : "Failed to load your consent records.");
      setLoading(false);
    });
  }, []);

  const acceptWofPhotoConsent = async () => {
    setWofBusy(true);
    try {
      await updateProfile({ wofPhotoConsent: true });
      setConsents((c: any) => c ? { ...c, wof_photo_consent: true } : c);
    } catch { /* swallow — row stays pending, user can retry */ }
    finally { setWofBusy(false); }
  };

  const genericRows: ConsentRow[] = consents ? [
    {
      label: "Terms of Service",
      status: consents.terms_accepted ? "accepted" : "pending",
      date: (consents as any).terms_accepted_at || consents.created_at,
      href: "/terms",
      ...(!consents.terms_accepted
        ? { actionLabel: "Review & Accept", onAction: () => { setAcceptError(null); setAcceptKind("terms"); } }
        : {}),
    },
    {
      label: "Privacy Policy",
      status: consents.privacy_accepted ? "accepted" : "pending",
      date: consents.privacy_accepted_at || null,
      href: "/privacy",
      ...(!consents.privacy_accepted ? { actionLabel: "Review & Accept", onAction: () => setPrivacyModalOpen(true) } : {}),
    },
    {
      label: "Age Verification",
      status: consents.age_verified ? "accepted" : "pending",
      date: consents.age_verified_at,
      // Age verification happens in the onboarding wizard. If a user landed
      // here without it, send them back through onboarding.
      ...(!consents.age_verified
        ? { actionLabel: "Verify Age", onAction: () => navigate("/onboarding") }
        : {}),
    },
    {
      label: "Wall of Fame Photo Consent",
      status: consents.wof_photo_consent ? "accepted" : "pending",
      expandContent: (
        <p className="pt-2">Allow your Wall of Fame photos to appear in the Social Feed on the web app. You can toggle this in Settings → App Preferences at any time.</p>
      ),
      // Inline accept — simple toggle, no modal needed. updateProfile keeps
      // a single source of truth with the Settings → App Preferences toggle.
      ...(!consents.wof_photo_consent
        ? { actionLabel: wofBusy ? "Saving…" : "Accept", onAction: acceptWofPhotoConsent }
        : {}),
    },
    {
      label: "Content Disclaimer",
      status: consents.content_disclaimer ? "accepted" : "pending",
      date: consents.content_disclaimer_accepted_at,
      expandContent: (
        <p className="pt-2">I confirm that all objects, substances, or materials appearing in my videos are props, simulated, or used solely for entertainment purposes. All content must comply with PNPtv! community standards. No illegal content. Explicit content requires age verification to be active on your account.</p>
      ),
      ...(!consents.content_disclaimer
        ? { actionLabel: "Review & Accept", onAction: () => { setAcceptError(null); setAcceptKind("disclaimer"); } }
        : {}),
    },
  ] : [];

  const hasApplication = !!consents?.application_id;
  const applicationTypeLabel = (() => {
    switch (consents?.application_type) {
      case "live":            return "Live Performer";
      case "content_creator": return "Content Creator";
      case "both":            return "Live Performer + Content Creator";
      default:                return null;
    }
  })();

  const creatorRows: ConsentRow[] = consents ? [
    {
      label: "Model / Creator Application",
      status: hasApplication
        ? (consents.application_status === "approved" ? "accepted"
          : consents.application_status === "rejected" ? "missing"
          : "pending")
        : "missing",
      detail: hasApplication
        ? `${applicationTypeLabel ?? "Application"} — ${consents.application_status ?? "pending"}`
        : "Not submitted",
      date: consents.application_created_at,
      ...(!hasApplication ? { actionLabel: "Start Application", onAction: () => navigate("/creators/apply") } : {}),
    },
    {
      label: "Stage Name",
      status: consents.stage_name ? "submitted" : "missing",
      detail: consents.stage_name || "Not submitted",
      ...(!consents.stage_name
        ? { actionLabel: "Set Stage Name", onAction: () => navigate("/creators/settings") }
        : {}),
    },
    {
      label: "Legal Identity (2257)",
      status: (consents.legal_full_name && consents.date_of_birth) ? "submitted" : "missing",
      detail: consents.legal_full_name
        ? `${consents.legal_full_name}${consents.date_of_birth ? ` — DOB ${new Date(consents.date_of_birth).toLocaleDateString()}` : ""}`
        : "Legal name + DOB required for 2257 compliance",
      // /2257 collects legal name, DOB, and uploads gov ID — single page for the
      // whole 2257 packet. Routes here so the user doesn't have to hunt.
      ...(!(consents.legal_full_name && consents.date_of_birth)
        ? { actionLabel: "Complete 2257 Form", onAction: () => navigate("/2257") }
        : {}),
    },
    {
      label: "Location Declaration",
      status: consents.country ? "submitted" : "missing",
      detail: consents.country ?? "Country required",
      ...(!consents.country
        ? { actionLabel: "Update Location", onAction: () => navigate("/creators/settings") }
        : {}),
    },
    {
      label: "Government ID — Front",
      status: consents.id_front_submitted ? "submitted" : "missing",
      detail: consents.id_front_submitted ? "Image on file (admin-only)" : "Upload required",
      ...(!consents.id_front_submitted
        ? { actionLabel: "Upload ID", onAction: () => navigate("/2257") }
        : {}),
    },
    {
      label: "Government ID — Back",
      status: consents.id_back_submitted ? "submitted" : "missing",
      detail: consents.id_back_submitted ? "Image on file (admin-only)" : "Upload required",
      ...(!consents.id_back_submitted
        ? { actionLabel: "Upload ID", onAction: () => navigate("/2257") }
        : {}),
    },
    {
      label: "Creator Terms Agreement",
      status: consents.creator_terms_agreed ? "accepted" : "pending",
      detail: consents.creator_terms_version ? `Version ${consents.creator_terms_version}` : null,
      date: consents.creator_terms_agreed_at,
      ...(consents.creator_terms_agreed
        ? {
            expandContent: (
              <>
                <p className="pt-2">By enrolling as a creator, you agree to PNPtv!'s Creator Program Terms. Subscription revenue is split 70% to you / 30% to PNPtv!. Payouts are processed every Tuesday before 2:00 PM UTC via your selected payment method.</p>
                <p>You retain ownership of all content you upload. PNPtv! reserves the right to deactivate creator profiles for violations of community standards or the strike policy (3 strikes = suspension).</p>
                <p>You may voluntarily deactivate at any time. Active subscribers retain access until their billing period ends. PNPtv! may amend these terms with 30 days written notice.</p>
              </>
            ),
          }
        : { actionLabel: "Review & Accept", onAction: () => { setAcceptError(null); setAcceptKind("creator_terms"); } }),
    },
    {
      label: "Fiat Payout Method",
      status: consents.fiat_payout_method ? "info" : "missing",
      detail: consents.fiat_payout_method
        ? `Configured (${String(consents.fiat_payout_method).toUpperCase()})`
        : "Not configured",
      ...(!consents.fiat_payout_method ? { actionLabel: "Configure Payouts", onAction: () => navigate("/creators/settings") } : {}),
    },
    {
      label: "Crypto Payout Wallet",
      status: consents.wallet_address_set
        ? (consents.creator_wallet_verified ? "accepted" : "info")
        : "missing",
      detail: consents.wallet_address_set
        ? (consents.creator_wallet_verified ? "Connected & verified" : "Connected — pending verification")
        : "Not connected",
      ...(!consents.wallet_address_set ? { actionLabel: "Configure Payouts", onAction: () => navigate("/creators/settings") } : {}),
    },
  ] : [];

  return (
    <>
      <Helmet><title>Consents — Creator Studio — PNPtv!</title></Helmet>
      <div className="p-4 lg:p-6">
        <h1 className="text-xl font-bold text-pnp-textPrimary mb-2">Consents &amp; Agreements</h1>
        <p className="text-sm text-pnp-textSecondary mb-6">A record of every consent, form, and document you've submitted as a creator/performer on PNPtv. Tap any row to read the document or take action.</p>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl" />)}
          </div>
        ) : loadError ? (
          <div className="text-center py-8 rounded-xl" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p className="text-sm text-red-400">{loadError}</p>
            <button onClick={() => window.location.reload()} className="mt-3 text-xs text-pnp-textSecondary underline">Retry</button>
          </div>
        ) : !consents ? (
          <p className="text-sm text-pnp-textSecondary">Could not load your consents.</p>
        ) : (
          <div className="space-y-8">
            {/* Identifiers */}
            <section>
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider mb-3">Identifiers</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="px-4 py-3 rounded-xl bg-white/5">
                  <p className="text-[10px] text-pnp-textSecondary uppercase tracking-wider mb-1">User ID</p>
                  <p className="text-sm font-mono text-white break-all">{userId ?? "—"}</p>
                </div>
                <div className="px-4 py-3 rounded-xl bg-white/5">
                  <p className="text-[10px] text-pnp-textSecondary uppercase tracking-wider mb-1">Application ID</p>
                  <p className="text-sm font-mono text-white break-all">{consents.application_id ?? "—"}</p>
                </div>
              </div>
            </section>

            {/* Generic platform consents */}
            <section>
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider mb-3">Platform consents</h2>
              <ConsentRowList rows={genericRows} />
            </section>

            {/* Creator/performer-specific forms */}
            <section>
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider mb-3">Creator / Performer forms</h2>
              <ConsentRowList rows={creatorRows} />
              <p className="text-[10px] text-pnp-textSecondary/60 mt-3 px-1">
                Government ID images and full payout account handles are stored encrypted and only visible to platform admins for compliance review.
              </p>
            </section>

            {consents.content_disclaimer && consents.content_disclaimer_accepted_at && (
              <p className="text-[10px] text-pnp-textSecondary/50 px-1">
                Content disclaimer accepted on {new Date(consents.content_disclaimer_accepted_at).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
      </div>

      {showWizard && (
        <CreatorEnrollmentWizard
          tier={wizardTier}
          onClose={() => setShowWizard(false)}
          onSubmitted={() => {
            setShowWizard(false);
            setConsents((c: any) => c ? { ...c, creator_terms_agreed: true } : c);
          }}
        />
      )}

      {privacyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl flex flex-col max-h-[85vh]"
            style={{ background: "linear-gradient(160deg,#1a1a2e 0%,#0f0f1a 100%)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-white">Privacy Policy</p>
                <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>pnptv.app/privacy</p>
              </div>
              <button onClick={() => setPrivacyModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Policy summary */}
            <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-3 text-xs" style={{ color: "#8E8E93" }}>
              <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-semibold text-white">What we collect</p>
                <p>PNPtv! collects information you provide directly (profile details, uploaded content, payment information) and data generated by your activity on the platform (interactions, usage patterns, location if granted).</p>
              </div>
              <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-semibold text-white">How we use it</p>
                <p>Your data is used to operate and improve the platform, process payments, provide creator analytics, comply with legal obligations (including 18 U.S.C. § 2257), and communicate with you about your account.</p>
              </div>
              <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-semibold text-white">Sharing & disclosure</p>
                <p>We do not sell your personal data. We share it only with service providers necessary to operate the platform, or when required by law. Creator identity documents are stored encrypted and accessed only for compliance review.</p>
              </div>
              <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-semibold text-white">Your rights</p>
                <p>You may request access, correction, or deletion of your personal data at any time by contacting support@pnptv.app. Note that some data must be retained for legal compliance purposes.</p>
              </div>
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="block text-center underline py-1" style={{ color: "#5ED1C4" }}>
                Read the full Privacy Policy ↗
              </a>
              {privacyError && (
                <p className="text-center text-red-400 text-xs pt-1">{privacyError}</p>
              )}
            </div>

            {/* Actions */}
            <div className="px-5 pb-5 pt-3 flex-shrink-0 space-y-2">
              <button
                onClick={async () => {
                  setPrivacyAccepting(true);
                  setPrivacyError(null);
                  try {
                    await acceptCreatorPrivacyPolicy();
                    setConsents((c: any) => c ? { ...c, privacy_accepted: true, privacy_accepted_at: new Date().toISOString() } : c);
                    setPrivacyModalOpen(false);
                  } catch {
                    setPrivacyError("Could not save your acceptance. Please try again.");
                  } finally {
                    setPrivacyAccepting(false);
                  }
                }}
                disabled={privacyAccepting}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#5ED1C4,#00D4E8)" }}
              >
                {privacyAccepting ? "Saving…" : "I Accept the Privacy Policy"}
              </button>
              <button
                onClick={() => setPrivacyModalOpen(false)}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white/70 transition-colors"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                I Do Not Accept
              </button>
              <p className="text-[10px] text-center" style={{ color: "#8E8E93" }}>
                Declining means your creator profile cannot be activated. Contact <a href="mailto:support@pnptv.app" className="underline">support@pnptv.app</a> with questions.
              </p>
            </div>
          </div>
        </div>
      )}

      {acceptKind && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl flex flex-col max-h-[85vh]"
            style={{ background: "linear-gradient(160deg,#1a1a2e 0%,#0f0f1a 100%)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-white">
                  {acceptKind === "terms" ? "Terms of Service" : "Content Disclaimer"}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                  {acceptKind === "terms" ? "pnptv.app/terms" : "Required for creators"}
                </p>
              </div>
              <button
                onClick={() => setAcceptKind(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.08)" }}
                aria-label="Close"
              >
                <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-3 text-xs" style={{ color: "#8E8E93" }}>
              {acceptKind === "terms" ? (
                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p>PNPtv! Terms of Service govern your use of the platform: community guidelines, content rules, the strike system, and how disputes are handled.</p>
                  <p>By accepting you confirm you have read the full terms at <a href="/terms" target="_blank" rel="noreferrer" className="underline text-white/70">pnptv.app/terms</a> and agree to be bound by them.</p>
                </div>
              ) : acceptKind === "creator_terms" ? (
                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-semibold text-white">Creator Program Terms</p>
                  <p>Subscription revenue is split <strong className="text-white">70% to you / 30% to PNPtv!</strong>. Payouts processed every Tuesday via your selected payment method.</p>
                  <p>You retain ownership of all content you upload. PNPtv! may deactivate profiles for community standard violations (3 strikes = suspension).</p>
                  <p>You may deactivate at any time. Active subscribers retain access until their billing period ends. PNPtv! may amend these terms with 30 days written notice.</p>
                  <a href="/2257" target="_blank" rel="noreferrer" className="block underline text-white/60 text-[10px]">18 U.S.C. § 2257 compliance info ↗</a>
                </div>
              ) : (
                <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p>I confirm that all objects, substances, or materials appearing in my videos are <strong className="text-white/80">props, simulated, or used solely for entertainment purposes</strong>.</p>
                  <p>All content complies with PNPtv! community standards. No illegal content. Explicit content requires age verification to be active on my account.</p>
                </div>
              )}
              {acceptError && (
                <p className="text-center text-red-400 text-xs pt-1">{acceptError}</p>
              )}
            </div>

            <div className="px-5 pb-5 pt-3 flex-shrink-0 space-y-2">
              <button
                onClick={async () => {
                  setAcceptBusy(true);
                  setAcceptError(null);
                  try {
                    if (acceptKind === "terms") {
                      await acceptTerms();
                      setConsents((c: any) => c ? { ...c, terms_accepted: true } : c);
                    } else if (acceptKind === "creator_terms") {
                      await acceptCreatorTerms();
                      setConsents((c: any) => c ? { ...c, creator_terms_agreed: true, creator_terms_agreed_at: new Date().toISOString() } : c);
                    } else {
                      await updateProfile({ contentDisclaimer: true });
                      setConsents((c: any) => c ? { ...c, content_disclaimer: true, content_disclaimer_accepted_at: new Date().toISOString() } : c);
                    }
                    setAcceptKind(null);
                  } catch {
                    setAcceptError("Could not save your acceptance. Please try again.");
                  } finally {
                    setAcceptBusy(false);
                  }
                }}
                disabled={acceptBusy}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#5ED1C4,#00D4E8)" }}
              >
                {acceptBusy ? "Saving…" : acceptKind === "terms" ? "I Accept the Terms" : acceptKind === "creator_terms" ? "I Accept the Creator Terms" : "I Accept"}
              </button>
              <button
                onClick={() => setAcceptKind(null)}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white/70 transition-colors"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Creator X Campaigns Page ──────────────────────────────────────────────────

export function CreatorXCampaigns() {
  const [account, setAccount] = React.useState<{ account_id: string; handle: string; display_name: string } | null>(null);
  const [campaigns, setCampaigns] = React.useState<XAutoCampaign[]>([]);
  const [campaignLimit, setCampaignLimit] = React.useState(2);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [editingCampaignId, setEditingCampaignId] = React.useState<string | null>(null);
  const [confirmDeleteCampaignId, setConfirmDeleteCampaignId] = React.useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = React.useState<string | null>(null);
  const [historyData, setHistoryData] = React.useState<Record<string, { posts: XAutoCampaignPost[]; page: number; totalPages: number; error?: boolean }>>({});

  // Create form state
  const [formName, setFormName] = React.useState("");
  const [formTopic, setFormTopic] = React.useState("");
  const [formMode, setFormMode] = React.useState("xPost");
  const [formLang, setFormLang] = React.useState("en");
  const [formInterval, setFormInterval] = React.useState(60);
  const [formStart, setFormStart] = React.useState(9);
  const [formEnd, setFormEnd] = React.useState(22);
  const [creating, setCreating] = React.useState(false);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [acctRes, campRes] = await Promise.all([getCreatorXAccount(), getCreatorXCampaigns()]);
      if (acctRes.success) setAccount(acctRes.account);
      else setLoadError("Failed to load X account.");
      if (campRes.success) {
        setCampaigns(campRes.campaigns);
        setCampaignLimit(campRes.campaignLimit);
      } else if (!acctRes.success) {
        setLoadError("Failed to load campaign data.");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load X campaigns.");
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { loadAll(); }, [loadAll]);

  const handleConnectX = async () => {
    setActionError(null);
    try {
      const res = await startCreatorXOAuth();
      if (res.success && res.url) {
        window.location.href = res.url;
      } else {
        setActionError("Could not start X authorization. Please try again.");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to connect X account.");
    }
  };

  const handleEditCampaign = (campaign: XAutoCampaign) => {
    setFormName(campaign.name);
    setFormTopic(campaign.topic);
    setFormMode(campaign.grok_mode || "xPost");
    setFormLang(campaign.language || "en");
    setFormInterval(campaign.interval_minutes || 60);
    setFormStart(campaign.active_hours_start ?? 9);
    setFormEnd(campaign.active_hours_end ?? 22);
    setEditingCampaignId(campaign.campaign_id);
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formTopic.trim() || !account) return;
    setCreating(true);
    setActionError(null);
    try {
      if (editingCampaignId) {
        const res = await updateCreatorXCampaign(editingCampaignId, {
          name: formName.trim(),
          topic: formTopic.trim(),
          grokMode: formMode,
          language: formLang,
          intervalMinutes: formInterval,
          activeHoursStart: formStart,
          activeHoursEnd: formEnd,
        });
        if (res.success) {
          setShowCreate(false);
          setEditingCampaignId(null);
          setFormName(""); setFormTopic("");
          await loadAll();
        } else {
          setActionError("Failed to update campaign. Please try again.");
        }
      } else {
        const res = await createCreatorXCampaign({
          name: formName.trim(),
          accountId: account.account_id,
          topic: formTopic.trim(),
          grokMode: formMode,
          language: formLang,
          intervalMinutes: formInterval,
          activeHoursStart: formStart,
          activeHoursEnd: formEnd,
        });
        if (res.success) {
          setShowCreate(false);
          setFormName(""); setFormTopic("");
          await loadAll();
        } else {
          setActionError("Failed to create campaign. Please try again.");
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : editingCampaignId ? "Failed to update campaign." : "Failed to create campaign.");
    }
    setCreating(false);
  };

  const handlePause = async (id: string) => {
    setActionError(null);
    try {
      await pauseCreatorXCampaign(id);
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to pause campaign.");
    }
  };
  const handleResume = async (id: string) => {
    setActionError(null);
    try {
      await resumeCreatorXCampaign(id);
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to resume campaign.");
    }
  };
  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteCreatorXCampaign(id);
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete campaign.");
    }
  };

  const toggleHistory = async (campaignId: string) => {
    if (expandedHistory === campaignId) {
      setExpandedHistory(null);
      return;
    }
    setExpandedHistory(campaignId);
    if (!historyData[campaignId]) {
      try {
        const res = await getCreatorXCampaignHistory(campaignId, 1);
        if (res.success) {
          setHistoryData(prev => ({ ...prev, [campaignId]: { posts: res.posts, page: 1, totalPages: res.pagination.totalPages } }));
        }
      } catch {
        setHistoryData(prev => ({ ...prev, [campaignId]: { posts: [], page: 1, totalPages: 0, error: true } }));
      }
    }
  };

  const statusColor = (status: string) => {
    if (status === "active") return "bg-green-500/20 text-green-400";
    if (status === "paused") return "bg-amber-500/20 text-amber-400";
    return "bg-white/10 text-pnp-textSecondary";
  };

  return (
    <>
      <Helmet><title>X Campaigns — Creator Studio — PNPtv!</title></Helmet>
      <div className="p-4 lg:p-6">
        <h1 className="text-xl font-bold text-pnp-textPrimary mb-4">X Campaigns</h1>

        {actionError && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm text-red-400" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            {actionError}
          </div>
        )}

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-20 bg-white/5 rounded-xl" />
            <div className="h-40 bg-white/5 rounded-xl" />
          </div>
        ) : loadError ? (
          <div className="text-center py-8 rounded-xl" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p className="text-sm text-red-400">{loadError}</p>
            <button onClick={loadAll} className="mt-3 text-xs text-pnp-textSecondary underline">Retry</button>
          </div>
        ) : !account ? (
          /* No X account connected */
          <div className="text-center py-12 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
            <svg className="w-12 h-12 mx-auto mb-3 text-pnp-textSecondary/40" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <h3 className="text-base font-semibold text-white mb-2">Connect your X account</h3>
            <p className="text-sm text-pnp-textSecondary mb-4 max-w-xs mx-auto">
              Link your X (Twitter) account to create automated campaigns that promote your content.
            </p>
            <button
              onClick={handleConnectX}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] btn-gradient"
            >
              Connect X Account
            </button>
          </div>
        ) : (
          <>
            {/* Connected account + campaign limit */}
            <div className="flex items-center justify-between mb-4 px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-white">@{account.handle}</p>
                  <p className="text-xs text-pnp-textSecondary">{account.display_name}</p>
                </div>
              </div>
              <span className="text-xs text-pnp-textSecondary">
                {campaigns.length} / {campaignLimit} campaigns
              </span>
            </div>

            {/* Create button */}
            {campaigns.length < campaignLimit && (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full mb-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] btn-gradient"
              >
                + Create Campaign
              </button>
            )}

            {/* Campaign cards */}
            {campaigns.length === 0 ? (
              <div className="text-center py-8 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                <p className="text-sm text-pnp-textSecondary">No campaigns yet. Create one to start promoting your content on X!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {campaigns.map(c => (
                  <div key={c.campaign_id} className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-white truncate">{c.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor(c.status)}`}>{c.status}</span>
                      </div>
                      <p className="text-xs text-pnp-textSecondary mb-2 line-clamp-2">{c.topic}</p>
                      <div className="flex items-center gap-4 text-xs text-pnp-textSecondary">
                        <span>Posted: {c.total_posted}</span>
                        <span>Failed: {c.total_failed}</span>
                        <span>Every {c.interval_minutes}min</span>
                        <span>{c.active_hours_start}:00–{c.active_hours_end}:00</span>
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        {c.status === "active" ? (
                          <button onClick={() => handlePause(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors">Pause</button>
                        ) : c.status === "paused" ? (
                          <button onClick={() => handleResume(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">Resume</button>
                        ) : null}
                        <button
                          onClick={() => handleEditCampaign(c)}
                          className="text-xs px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-pnp-textSecondary transition-colors"
                        >
                          Edit
                        </button>
                        <button onClick={() => setConfirmDeleteCampaignId(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">Delete</button>
                        <button onClick={() => toggleHistory(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-white/10 text-pnp-textSecondary hover:bg-white/15 transition-colors">
                          {expandedHistory === c.campaign_id ? "Hide History" : "View History"}
                        </button>
                      </div>
                    </div>
                    {/* Expanded history */}
                    {expandedHistory === c.campaign_id && historyData[c.campaign_id] && (
                      <div className="border-t border-white/5 px-4 py-3">
                        {historyData[c.campaign_id]?.error && (
                          <p className="text-red-400 text-xs px-3 py-2">Failed to load history. Please try again.</p>
                        )}
                        {historyData[c.campaign_id].posts.length === 0 && !historyData[c.campaign_id]?.error ? (
                          <p className="text-xs text-pnp-textSecondary">No posts yet</p>
                        ) : (
                          <div className="space-y-2">
                            {historyData[c.campaign_id].posts.map((p: any) => (
                              <div key={p.post_id} className="text-xs">
                                <p className="text-pnp-textPrimary">{(p.text || "").substring(0, 120)}{(p.text || "").length > 120 ? "..." : ""}</p>
                                <p className="text-pnp-textSecondary/60 mt-0.5">
                                  {p.status} · {new Date(p.created_at).toLocaleString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Delete confirmation dialog */}
            <ConfirmDialog
              open={confirmDeleteCampaignId !== null}
              title="Delete campaign"
              message="Delete this campaign? This cannot be undone."
              confirmLabel="Delete"
              cancelLabel="Cancel"
              variant="danger"
              onConfirm={async () => {
                const id = confirmDeleteCampaignId;
                setConfirmDeleteCampaignId(null);
                if (id) await handleDelete(id);
              }}
              onCancel={() => setConfirmDeleteCampaignId(null)}
            />

            {/* Create / Edit Campaign Modal */}
            {showCreate && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setShowCreate(false); setEditingCampaignId(null); }}>
                <div className="bg-pnp-background border border-pnp-border rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
                  <h2 className="text-base font-bold text-white mb-4">{editingCampaignId ? "Edit Campaign" : "Create Campaign"}</h2>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-pnp-textSecondary mb-1 block">Campaign Name</label>
                      <input value={formName} onChange={e => setFormName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white" placeholder="e.g. My Content Promo" />
                    </div>
                    <div>
                      <label className="text-xs text-pnp-textSecondary mb-1 block">Topic / Prompt</label>
                      <textarea value={formTopic} onChange={e => setFormTopic(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white h-20 resize-none" placeholder="What should the AI post about?" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-pnp-textSecondary mb-1 block">Mode</label>
                        <select value={formMode} onChange={e => setFormMode(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white">
                          <option value="xPost">X Post</option>
                          <option value="broadcast">Broadcast</option>
                          <option value="salesPost">Sales Post</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-pnp-textSecondary mb-1 block">Language</label>
                        <select value={formLang} onChange={e => setFormLang(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white">
                          <option value="en">English</option>
                          <option value="es">Spanish</option>
                          <option value="bilingual">Bilingual</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-pnp-textSecondary mb-1 block">Interval (min)</label>
                        <input type="number" min={30} value={formInterval} onChange={e => setFormInterval(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white" />
                      </div>
                      <div>
                        <label className="text-xs text-pnp-textSecondary mb-1 block">Start Hour</label>
                        <input type="number" min={0} max={23} value={formStart} onChange={e => setFormStart(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white" />
                      </div>
                      <div>
                        <label className="text-xs text-pnp-textSecondary mb-1 block">End Hour</label>
                        <input type="number" min={0} max={23} value={formEnd} onChange={e => setFormEnd(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg bg-pnp-surface border border-pnp-border text-sm text-white" />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button onClick={() => { setShowCreate(false); setEditingCampaignId(null); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-pnp-textSecondary bg-white/10 hover:bg-white/15 transition-colors">Cancel</button>
                    <button
                      onClick={handleCreate}
                      disabled={creating || !formName.trim() || !formTopic.trim()}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all hover:opacity-90 btn-gradient"
                    >
                      {creating ? (editingCampaignId ? "Saving..." : "Creating...") : (editingCampaignId ? "Save Changes" : "Create")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
