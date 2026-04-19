import React, { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Toast } from "@/components/Toast";
import {
  getCreatorMySubscribers,
  getCreatorConsents,
  getCreatorXAccount,
  getCreatorXCampaigns,
  createCreatorXCampaign,
  updateCreatorXCampaign,
  pauseCreatorXCampaign,
  resumeCreatorXCampaign,
  deleteCreatorXCampaign,
  getCreatorXCampaignHistory,
  startCreatorXOAuth,
  type XAutoCampaign,
  type XAutoCampaignPost,
} from "@/lib/api";
import { Helmet } from "react-helmet-async";

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

// ── Creator Subscribers Page ──────────────────────────────────────────────────

export function CreatorSubscribers() {
  const [data, setData] = React.useState<any>(null);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCreatorMySubscribers(page);
      if (res.success) setData(res);
    } catch {}
    setLoading(false);
  }, [page]);

  React.useEffect(() => { load(); }, [load]);

  function resolvePhoto(url: string | null | undefined): string | null {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("/") || url.startsWith("http")) return url;
    return null;
  }

  return (
    <>
      <Helmet><title>My Subscribers — Creator Studio — PNPtv!</title></Helmet>
      <div className="p-4 lg:p-6">
        <h1 className="text-xl font-bold text-pnp-textPrimary mb-4">My Subscribers</h1>

        {loading && !data ? (
          <div className="animate-pulse space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl" />)}
            </div>
            <div className="h-48 bg-white/5 rounded-xl" />
          </div>
        ) : data ? (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="rounded-xl p-4" style={{ background: "rgba(212,0,122,0.08)", border: "1px solid rgba(212,0,122,0.2)" }}>
                <p className="text-2xl font-bold text-white">{data.stats.active_count}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Active</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(91,200,245,0.08)", border: "1px solid rgba(91,200,245,0.2)" }}>
                <p className="text-2xl font-bold text-white">{data.stats.total_count}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Total</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }}>
                <p className="text-2xl font-bold text-white">{data.stats.new_this_month}</p>
                <p className="text-xs text-pnp-textSecondary mt-1">New this month</p>
              </div>
              <div className="rounded-xl p-4" style={{ background: "rgba(230,145,56,0.08)", border: "1px solid rgba(230,145,56,0.2)" }}>
                <p className="text-2xl font-bold text-white">{data.stats.churn_rate}%</p>
                <p className="text-xs text-pnp-textSecondary mt-1">Churn rate</p>
              </div>
            </div>

            {/* Subscriber list */}
            {data.subscribers.length === 0 ? (
              <div className="text-center py-12 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                <p className="text-pnp-textSecondary text-sm">No subscribers yet</p>
                <p className="text-pnp-textSecondary/60 text-xs mt-1">Share your profile to attract subscribers</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.subscribers.map((sub: any) => {
                  const photo = resolvePhoto(sub.subscriber_avatar);
                  return (
                    <div key={sub.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
                      {photo ? (
                        <img src={photo} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-pnp-surface flex items-center justify-center shrink-0">
                          <span className="text-sm text-pnp-textSecondary">{(sub.subscriber_first_name || sub.subscriber_username || "?")[0].toUpperCase()}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{sub.subscriber_first_name || sub.subscriber_username}</p>
                        <p className="text-xs text-pnp-textSecondary">@{sub.subscriber_username} · since {new Date(sub.started_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${sub.status === "active" ? "bg-green-500/20 text-green-400" : "bg-white/10 text-pnp-textSecondary"}`}>
                          {sub.status}
                        </span>
                        <p className="text-xs text-pnp-textSecondary mt-1">${Number(sub.revenue || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {data.pagination.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-xs text-white bg-white/10 disabled:opacity-30">← Prev</button>
                <span className="px-3 py-1.5 text-xs text-pnp-textSecondary">{page} / {data.pagination.totalPages}</span>
                <button disabled={page >= data.pagination.totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-xs text-white bg-white/10 disabled:opacity-30">Next →</button>
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
  return (
    <div className="space-y-3">
      {rows.map((item, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="min-w-0">
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
          <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold ${statusPillClass(item.status)}`}>
            {statusLabel(item.status)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CreatorConsents() {
  const [consents, setConsents] = React.useState<any>(null);
  const [userId, setUserId] = React.useState<string | number | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getCreatorConsents().then(res => {
      if (res.success) {
        setConsents(res.consents);
        if (res.userId !== undefined && res.userId !== null) setUserId(res.userId);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const genericRows: ConsentRow[] = consents ? [
    { label: "Terms of Service", status: consents.terms_accepted ? "accepted" : "pending", date: consents.created_at },
    { label: "Privacy Policy", status: consents.privacy_accepted ? "accepted" : "pending", date: consents.created_at },
    { label: "Age Verification", status: consents.age_verified ? "accepted" : "pending", date: consents.age_verified_at },
    { label: "Wall of Fame Photo Consent", status: consents.wof_photo_consent ? "accepted" : "pending" },
    { label: "Content Disclaimer", status: consents.content_disclaimer ? "accepted" : "pending", date: consents.content_disclaimer_accepted_at },
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
    },
    {
      label: "Stage Name",
      status: consents.stage_name ? "submitted" : "missing",
      detail: consents.stage_name || "Not submitted",
    },
    {
      label: "Legal Identity (2257)",
      status: (consents.legal_full_name && consents.date_of_birth) ? "submitted" : "missing",
      detail: consents.legal_full_name
        ? `${consents.legal_full_name}${consents.date_of_birth ? ` — DOB ${new Date(consents.date_of_birth).toLocaleDateString()}` : ""}`
        : "Legal name + DOB required for 2257 compliance",
    },
    {
      label: "Location Declaration",
      status: (consents.country && consents.city_state) ? "submitted" : "missing",
      detail: (consents.country || consents.city_state)
        ? [consents.city_state, consents.country].filter(Boolean).join(", ")
        : "Country + city/state required",
    },
    {
      label: "Government ID — Front",
      status: consents.id_front_submitted ? "submitted" : "missing",
      detail: consents.id_front_submitted ? "Image on file (admin-only)" : "Upload required",
    },
    {
      label: "Government ID — Back",
      status: consents.id_back_submitted ? "submitted" : "missing",
      detail: consents.id_back_submitted ? "Image on file (admin-only)" : "Upload required",
    },
    {
      label: "Creator Terms Agreement",
      status: consents.creator_terms_agreed ? "accepted" : "pending",
      detail: consents.creator_terms_version ? `Version ${consents.creator_terms_version}` : null,
      date: consents.creator_terms_agreed_at,
    },
    {
      label: "Onboarding Call",
      status: consents.call_scheduled ? "accepted" : "pending",
      detail: consents.call_scheduled ? "Scheduled" : "Not scheduled",
      date: consents.call_scheduled_at,
    },
    {
      label: "Fiat Payout Method",
      status: consents.fiat_payout_method ? "info" : "missing",
      detail: consents.fiat_payout_method
        ? `Configured (${String(consents.fiat_payout_method).toUpperCase()})`
        : "Not configured",
    },
    {
      label: "Crypto Payout Wallet",
      status: consents.wallet_address_set
        ? (consents.creator_wallet_verified ? "accepted" : "info")
        : "missing",
      detail: consents.wallet_address_set
        ? (consents.creator_wallet_verified ? "Connected & verified" : "Connected — pending verification")
        : "Not connected",
    },
  ] : [];

  return (
    <>
      <Helmet><title>Consents — Creator Studio — PNPtv!</title></Helmet>
      <div className="p-4 lg:p-6">
        <h1 className="text-xl font-bold text-pnp-textPrimary mb-2">Consents &amp; Agreements</h1>
        <p className="text-sm text-pnp-textSecondary mb-6">A record of every consent, form, and document you've submitted as a creator/performer on PNPtv.</p>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl" />)}
          </div>
        ) : !consents ? (
          <p className="text-sm text-pnp-textSecondary">Could not load your consents.</p>
        ) : (
          <div className="space-y-8">
            {/* Identifiers — always at top so admin support can reference them */}
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

            {/* Content disclaimer timestamp note */}
            {consents.content_disclaimer && consents.content_disclaimer_accepted_at && (
              <p className="text-[10px] text-pnp-textSecondary/50 px-1">
                Content disclaimer accepted on {new Date(consents.content_disclaimer_accepted_at).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Creator X Campaigns Page ──────────────────────────────────────────────────

export function CreatorXCampaigns() {
  const [account, setAccount] = React.useState<{ account_id: string; handle: string; display_name: string } | null>(null);
  const [campaigns, setCampaigns] = React.useState<XAutoCampaign[]>([]);
  const [campaignLimit, setCampaignLimit] = React.useState(2);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [expandedHistory, setExpandedHistory] = React.useState<string | null>(null);
  const [historyData, setHistoryData] = React.useState<Record<string, { posts: XAutoCampaignPost[]; page: number; totalPages: number }>>({});

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
    try {
      const [acctRes, campRes] = await Promise.all([getCreatorXAccount(), getCreatorXCampaigns()]);
      if (acctRes.success) setAccount(acctRes.account);
      if (campRes.success) {
        setCampaigns(campRes.campaigns);
        setCampaignLimit(campRes.campaignLimit);
      }
    } catch {}
    setLoading(false);
  }, []);

  React.useEffect(() => { loadAll(); }, [loadAll]);

  const handleConnectX = async () => {
    try {
      const res = await startCreatorXOAuth();
      if (res.success && res.url) window.location.href = res.url;
    } catch {}
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formTopic.trim() || !account) return;
    setCreating(true);
    try {
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
      }
    } catch {}
    setCreating(false);
  };

  const handlePause = async (id: string) => {
    await pauseCreatorXCampaign(id);
    loadAll();
  };
  const handleResume = async (id: string) => {
    await resumeCreatorXCampaign(id);
    loadAll();
  };
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    await deleteCreatorXCampaign(id);
    loadAll();
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
      } catch {}
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

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-20 bg-white/5 rounded-xl" />
            <div className="h-40 bg-white/5 rounded-xl" />
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
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
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
                className="w-full mb-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
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
                      <div className="flex items-center gap-2 mt-3">
                        {c.status === "active" ? (
                          <button onClick={() => handlePause(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors">Pause</button>
                        ) : c.status === "paused" ? (
                          <button onClick={() => handleResume(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">Resume</button>
                        ) : null}
                        <button onClick={() => handleDelete(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">Delete</button>
                        <button onClick={() => toggleHistory(c.campaign_id)} className="px-3 py-1 rounded-lg text-xs font-medium bg-white/10 text-pnp-textSecondary hover:bg-white/15 transition-colors">
                          {expandedHistory === c.campaign_id ? "Hide History" : "View History"}
                        </button>
                      </div>
                    </div>
                    {/* Expanded history */}
                    {expandedHistory === c.campaign_id && historyData[c.campaign_id] && (
                      <div className="border-t border-white/5 px-4 py-3">
                        {historyData[c.campaign_id].posts.length === 0 ? (
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

            {/* Create Campaign Modal */}
            {showCreate && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowCreate(false)}>
                <div className="bg-pnp-background border border-pnp-border rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
                  <h2 className="text-base font-bold text-white mb-4">Create Campaign</h2>
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
                    <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-pnp-textSecondary bg-white/10 hover:bg-white/15 transition-colors">Cancel</button>
                    <button
                      onClick={handleCreate}
                      disabled={creating || !formName.trim() || !formTopic.trim()}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all hover:opacity-90"
                      style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      {creating ? "Creating..." : "Create"}
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
