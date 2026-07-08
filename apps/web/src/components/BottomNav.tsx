import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

// ─────────────────────────────────────────────────────────────────────────────
// Classic nav — unchanged, shown to all users except the preview account
// ─────────────────────────────────────────────────────────────────────────────

const classicNavItems = [
  {
    id: "feed",
    to: "/?view=feed",
    label: "Feed",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  {
    id: "hangouts",
    to: "/?view=hangouts",
    label: "Hangouts",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    id: "explore",
    to: "/nearby",
    label: "Connect",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    ),
  },
  {
    id: "channels",
    to: "/channels",
    label: "Channels",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: "live",
    to: "/live",
    label: "Live",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
];

function ClassicNav() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const viewParam = searchParams.get("view");

  const getIsActive = (item: (typeof classicNavItems)[number]) => {
    if (item.id === "feed") {
      return location.pathname === "/" && viewParam !== "hangouts" && viewParam !== "home";
    }
    if (item.id === "hangouts") {
      return (location.pathname === "/" && viewParam === "hangouts") || location.pathname.startsWith("/chat");
    }
    if (item.id === "explore") return location.pathname.startsWith("/nearby");
    if (item.id === "channels") return location.pathname.startsWith("/channels");
    return location.pathname === item.to || location.pathname.startsWith(item.to + "/");
  };

  return (
    <nav className="glass-nav border-t border-pnp-border safe-area-bottom" translate="no" lang="en">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {classicNavItems.map((item) => {
          const active = getIsActive(item);
          return (
            <NavLink
              key={item.id}
              to={item.to}
              end
              className={() =>
                `flex flex-col items-center justify-center gap-0.5 px-3 min-h-[44px] transition-colors ${
                  active ? "nav-active" : "text-pnp-textSecondary hover:text-pnp-textPrimary"
                }`
              }
            >
              {item.icon}
              <span className="text-[10px] font-medium">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating Island Nav — beta, santinofurioso only
// ─────────────────────────────────────────────────────────────────────────────

type NavMode = "island" | "classic";
type ActiveSheet = "pigs" | "content" | "you" | null;

// ── Shared sheet backdrop wrapper ────────────────────────────────────────────
function SheetBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    // Keyboard dismiss
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    // Body scroll lock — prevents background page scrolling through on iOS/Android
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      style={{
        // Solid fallback for browsers without backdrop-filter (old Firefox, some Android)
        background: "rgba(0,0,0,.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <div className="flex-1" onClick={onClose} />
      {children}
    </div>,
    document.body
  );
}

// ── Island nav button ────────────────────────────────────────────────────────
function IslandBtn({
  icon,
  label,
  active,
  hasNotif,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  hasNotif?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-[3px] px-4 py-2 rounded-[22px] min-w-[52px] min-h-[44px] justify-center transition-all duration-200 ${
        active
          ? "bg-gradient-to-br from-[rgba(212,0,122,.28)] to-[rgba(123,97,255,.2)] ring-1 ring-[rgba(212,0,122,.35)]"
          : "hover:bg-white/5"
      }`}
    >
      {hasNotif && (
        <span className="absolute top-1 right-2 w-[7px] h-[7px] rounded-full bg-[#D4007A] border-[1.5px] border-[rgba(28,28,38,.92)]" />
      )}
      <span className={`transition-colors ${active ? "text-[#D4007A]" : "text-[#8A8A9A]"}`}>{icon}</span>
      <span className={`text-[9px] font-bold tracking-[.2px] transition-colors ${active ? "text-[#D4007A]" : "text-[#8A8A9A]"}`}>
        {label}
      </span>
    </button>
  );
}

const IslandDivider = () => <div className="w-px h-7 bg-white/10 mx-1" />;

// ── Meet Pigs Sheet ──────────────────────────────────────────────────────────
function MeetPigsSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const go = useCallback((to: string) => { onClose(); navigate(to); }, [onClose, navigate]);

  return (
    <SheetBackdrop onClose={onClose}>
      <div className="bg-[#0A0A0F] rounded-t-[28px] border-t border-white/10 px-5 pt-4 pb-10 safe-area-bottom overflow-y-auto overscroll-contain"
        style={{ maxHeight: "85dvh" }}>
        <div className="w-9 h-1 rounded-full bg-white/20 mx-auto mb-5" />
        <h2 className="text-[21px] font-black text-center text-pnp-textPrimary mb-1">Meet the Pigs 🐷</h2>
        <p className="text-[13px] text-center text-pnp-textSecondary mb-6 leading-relaxed">
          Hang out with the community or<br />connect with someone nearby
        </p>

        <div className="flex flex-col gap-3">
          {/* Hangouts */}
          <button
            onClick={() => go("/?view=hangouts")}
            className="w-full text-left rounded-[20px] border border-[rgba(212,0,122,.25)] p-5 transition-all active:scale-[.98]"
            style={{ background: "linear-gradient(135deg,rgba(212,0,122,.1),rgba(123,97,255,.07))" }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-[26px]"
                style={{ background: "rgba(212,0,122,.15)" }}>
                🏠
              </div>
              <span className="flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-full"
                style={{ background: "rgba(212,0,122,.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,.3)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4007A] inline-block" />
                LIVE
              </span>
            </div>
            <p className="text-[17px] font-black mb-1" style={{ background: "linear-gradient(90deg,#D4007A,#7B61FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              PNP Hangouts
            </p>
            <p className="text-[12px] text-pnp-textSecondary leading-relaxed mb-3">
              Join group chat rooms, hang out with the community, share music, and vibe together in real time.
            </p>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-full"
              style={{ background: "rgba(212,0,122,.15)", color: "#D4007A" }}>
              Enter Hangouts
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>

          {/* Connect */}
          <button
            onClick={() => go("/nearby")}
            className="w-full text-left rounded-[20px] border border-[rgba(34,197,94,.2)] p-5 transition-all active:scale-[.98]"
            style={{ background: "linear-gradient(135deg,rgba(34,197,94,.08),rgba(0,198,255,.05))" }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-[26px]"
                style={{ background: "rgba(34,197,94,.12)" }}>
                🌍
              </div>
              <span className="flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-full"
                style={{ background: "rgba(34,197,94,.12)", color: "#22C55E", border: "1px solid rgba(34,197,94,.25)" }}>
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="3" /><path strokeLinecap="round" strokeLinejoin="round" d="M4.929 4.929a10 10 0 0114.142 0M7.757 7.757a6 6 0 018.486 0" />
                </svg>
                NEARBY
              </span>
            </div>
            <p className="text-[17px] font-black text-[#22C55E] mb-1">PNP Connect</p>
            <p className="text-[12px] text-pnp-textSecondary leading-relaxed mb-3">
              Find PNP members and models near you. Browse profiles, go 1-on-1, or book a private call.
            </p>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-full"
              style={{ background: "rgba(34,197,94,.12)", color: "#22C55E" }}>
              Explore Nearby
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </SheetBackdrop>
  );
}

// ── Content Sheet ────────────────────────────────────────────────────────────
function ContentSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const go = useCallback((to: string) => { onClose(); navigate(to); }, [onClose, navigate]);

  const cards = [
    {
      icon: "📺",
      title: "Live Shows",
      desc: "Watch active PNP streams happening right now",
      cta: "Watch now",
      to: "/live",
      accentColor: "#D4007A",
      bg: "rgba(212,0,122,.1)",
      border: "rgba(212,0,122,.3)",
      iconBg: "rgba(212,0,122,.15)",
      badge: <span className="flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(212,0,122,.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,.3)" }}><span className="w-1.5 h-1.5 rounded-full bg-[#D4007A] inline-block" />LIVE</span>,
    },
    {
      icon: "📞",
      title: "Private Calls",
      desc: "Pick a model and book a 1-on-1 session directly",
      cta: "Book now",
      to: "/nearby?mode=calls",
      accentColor: "#7B61FF",
      bg: "rgba(123,97,255,.1)",
      border: "rgba(123,97,255,.3)",
      iconBg: "rgba(123,97,255,.15)",
      badge: null,
    },
    {
      icon: "📡",
      title: "PNP Channels",
      desc: "Videos, series and exclusive content drops",
      cta: "Browse",
      to: "/channels",
      accentColor: "#FFB454",
      bg: "rgba(255,180,84,.08)",
      border: "rgba(255,180,84,.25)",
      iconBg: "rgba(255,180,84,.12)",
      badge: <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,.12)", color: "#22C55E", border: "1px solid rgba(34,197,94,.25)" }}>FREE+</span>,
    },
    {
      icon: "⭐",
      title: "Creators",
      desc: "Find your favourite PNP Model and follow them",
      cta: "Explore",
      to: "/channels",
      accentColor: "#22C55E",
      bg: "rgba(34,197,94,.08)",
      border: "rgba(34,197,94,.2)",
      iconBg: "rgba(34,197,94,.12)",
      badge: null,
    },
  ];

  return (
    <SheetBackdrop onClose={onClose}>
      <div className="bg-[#0A0A0F] rounded-t-[28px] border-t border-white/10 px-5 pt-4 pb-10 safe-area-bottom overflow-y-auto overscroll-contain"
        style={{ maxHeight: "85dvh" }}>
        <div className="w-9 h-1 rounded-full bg-white/20 mx-auto mb-5" />
        <h2 className="text-[21px] font-black text-center text-pnp-textPrimary mb-1">What are you into? 🎬</h2>
        <p className="text-[13px] text-center text-pnp-textSecondary mb-5 leading-relaxed">
          Tune in live or explore content at your own pace
        </p>

        {/* Live section */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-black uppercase tracking-[.8px] text-pnp-textSecondary">🔴 Live</span>
          <div className="flex-1 h-px bg-white/8" />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4 min-[340px]:grid-cols-2 grid-cols-1">
          {cards.slice(0, 2).map((c) => (
            <button key={c.title} onClick={() => go(c.to)}
              className="text-left rounded-[18px] border p-4 transition-all active:scale-[.97] flex flex-col gap-3"
              style={{ background: `linear-gradient(135deg,${c.bg},transparent)`, borderColor: c.border }}>
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-[13px] flex items-center justify-center text-[22px]" style={{ background: c.iconBg }}>{c.icon}</div>
                {c.badge}
              </div>
              <div>
                <p className="text-[14px] font-black mb-0.5" style={{ color: c.accentColor }}>{c.title}</p>
                <p className="text-[11px] text-pnp-textSecondary leading-relaxed">{c.desc}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full self-start"
                style={{ background: `${c.iconBg}`, color: c.accentColor }}>
                {c.cta}
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </span>
            </button>
          ))}
        </div>

        {/* Content section */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-black uppercase tracking-[.8px] text-pnp-textSecondary">🎞 Content</span>
          <div className="flex-1 h-px bg-white/8" />
        </div>
        <div className="grid grid-cols-2 gap-3 min-[340px]:grid-cols-2 grid-cols-1">
          {cards.slice(2).map((c) => (
            <button key={c.title} onClick={() => go(c.to)}
              className="text-left rounded-[18px] border p-4 transition-all active:scale-[.97] flex flex-col gap-3"
              style={{ background: `linear-gradient(135deg,${c.bg},transparent)`, borderColor: c.border }}>
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-[13px] flex items-center justify-center text-[22px]" style={{ background: c.iconBg }}>{c.icon}</div>
                {c.badge}
              </div>
              <div>
                <p className="text-[14px] font-black mb-0.5" style={{ color: c.accentColor }}>{c.title}</p>
                <p className="text-[11px] text-pnp-textSecondary leading-relaxed">{c.desc}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full self-start"
                style={{ background: `${c.iconBg}`, color: c.accentColor }}>
                {c.cta}
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </span>
            </button>
          ))}
        </div>
      </div>
    </SheetBackdrop>
  );
}

// ── You Sheet ────────────────────────────────────────────────────────────────
function YouSheet({ onClose, onSwitchMode }: { onClose: () => void; onSwitchMode?: (mode: NavMode) => void }) {
  const navigate = useNavigate();
  const { user, isAdmin, isCreatorAdmin } = useAuth();
  const go = useCallback((to: string) => { onClose(); navigate(to); }, [onClose, navigate]);

  const initials = user?.displayName?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || "?";
  const tierLabel = user?.tier === "prime" ? "PRIME" : user?.tier === "member" ? "MEMBER" : "FREE";
  const tierColor = user?.tier === "prime" ? "#FFB454" : user?.tier === "member" ? "#60A5FA" : "#8A8A9A";
  const tierBg = user?.tier === "prime" ? "rgba(255,180,84,.12)" : user?.tier === "member" ? "rgba(96,165,250,.1)" : "rgba(255,255,255,.05)";
  const tierBorder = user?.tier === "prime" ? "rgba(255,180,84,.3)" : user?.tier === "member" ? "rgba(96,165,250,.2)" : "rgba(255,255,255,.1)";

  const menuItems = [
    { icon: "👤", label: "Your Profile", sub: "View & edit your page", to: "/profile", color: "#D4007A", bg: "rgba(212,0,122,.12)" },
    { icon: "🌟", label: "My Access", sub: "Active plans & entitlements", to: "/my-access", color: "#FFB454", bg: "rgba(255,180,84,.1)" },
    { icon: "⚙️", label: "Settings", sub: "Account, privacy & notifications", to: "/settings", color: "#8A8A9A", bg: "rgba(255,255,255,.06)" },
    { icon: "💚", label: "Wellness Center", sub: "Self-care & harm reduction tools", to: "/self-care", color: "#22C55E", bg: "rgba(34,197,94,.1)" },
  ];

  return (
    <SheetBackdrop onClose={onClose}>
      <div className="bg-[#0A0A0F] rounded-t-[28px] border-t border-white/10 pb-10 safe-area-bottom overflow-y-auto overscroll-contain"
        style={{ maxHeight: "85dvh" }}>
        <div className="w-9 h-1 rounded-full bg-white/20 mx-auto mt-4 mb-0" />

        {/* Profile header */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-white/8">
          <div className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-[20px] font-black flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)", boxShadow: "0 0 0 2.5px #0A0A0F, 0 0 0 4px #22C55E" }}>
            {user?.photoUrl
              ? <img src={user.photoUrl} className="w-full h-full rounded-full object-cover" />
              : initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-[16px] text-pnp-textPrimary truncate">{user?.displayName || user?.username}</p>
            <p className="text-[12px] text-pnp-textSecondary truncate">@{user?.username}</p>
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full mt-1"
              style={{ background: tierBg, color: tierColor, border: `1px solid ${tierBorder}` }}>
              {user?.tier === "prime" && "★ "}{tierLabel}
            </span>
          </div>
        </div>

        {/* Menu items */}
        <div className="px-3 pt-2">
          {menuItems.map((item) => (
            <button key={item.to} onClick={() => go(item.to)}
              className="w-full flex items-center gap-4 px-3 py-3 rounded-[14px] transition-all active:bg-white/5 text-left">
              <div className="w-10 h-10 rounded-[11px] flex items-center justify-center text-[18px] flex-shrink-0" style={{ background: item.bg }}>{item.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-pnp-textPrimary">{item.label}</p>
                <p className="text-[11px] text-pnp-textSecondary">{item.sub}</p>
              </div>
              <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}

          {onSwitchMode && (
            <div className="mt-1 pt-1 border-t border-white/8">
              <div className="flex items-center justify-between px-3 py-3 rounded-[14px]">
                <div>
                  <p className="text-[14px] font-semibold text-pnp-textPrimary">Navigation</p>
                  <p className="text-[11px] text-pnp-textSecondary">Switch styles</p>
                </div>
                <div className="flex items-center gap-0.5 p-1 rounded-full"
                  style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)" }}>
                  <button
                    onClick={() => { onSwitchMode("classic"); onClose(); }}
                    className="px-3 py-1 rounded-full text-[11px] font-bold transition-all"
                    style={{ background: "transparent", color: "#8A8A9A" }}
                  >
                    Classic
                  </button>
                  <button
                    className="px-3 py-1 rounded-full text-[11px] font-bold"
                    style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)", color: "#fff" }}
                  >
                    🚢 Cruise
                  </button>
                </div>
              </div>
            </div>
          )}

          {(isCreatorAdmin || isAdmin) && (
            <div className="mt-1 pt-1 border-t border-white/8">
              {isCreatorAdmin && (
                <button onClick={() => go("/creators")}
                  className="w-full flex items-center gap-4 px-3 py-3 rounded-[14px] transition-all active:bg-white/5 text-left">
                  <div className="w-10 h-10 rounded-[11px] flex items-center justify-center text-[18px]" style={{ background: "rgba(255,180,84,.1)" }}>🎬</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "#FFB454" }}>Creator Studio</p>
                    <p className="text-[11px] text-pnp-textSecondary">Content, earnings & live</p>
                  </div>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(255,180,84,.15)", color: "#FFB454", border: "1px solid rgba(255,180,84,.3)" }}>CREATOR</span>
                  <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              )}
              {isAdmin && (
                <button onClick={() => go("/admin")}
                  className="w-full flex items-center gap-4 px-3 py-3 rounded-[14px] transition-all active:bg-white/5 text-left">
                  <div className="w-10 h-10 rounded-[11px] flex items-center justify-center text-[18px]" style={{ background: "rgba(123,97,255,.1)" }}>🛡️</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "#7B61FF" }}>Admin Panel</p>
                    <p className="text-[11px] text-pnp-textSecondary">Manage platform</p>
                  </div>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(123,97,255,.15)", color: "#7B61FF", border: "1px solid rgba(123,97,255,.3)" }}>ADMIN</span>
                  <svg className="w-4 h-4 text-pnp-textSecondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </SheetBackdrop>
  );
}

// ── Cruise switch FAB — shown in Classic mode for santinofurioso ─────────────
function CruiseSwitchFAB({ onSwitch }: { onSwitch: () => void }) {
  return (
    <button
      onClick={onSwitch}
      className="fixed right-4 bottom-24 lg:bottom-6 z-[99] flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold"
      style={{
        background: "rgba(22,22,30,.96)",
        border: "1px solid rgba(212,0,122,.35)",
        color: "#D4007A",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 16px rgba(0,0,0,.5)",
      }}
    >
      🚢 Cruise Mode
    </button>
  );
}

// ── Floating Island Nav ──────────────────────────────────────────────────────
function FloatingIslandNav({ onSwitchMode }: { onSwitchMode: (mode: NavMode) => void }) {
  const [sheet, setSheet] = useState<ActiveSheet>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Close any open sheet on route change
  useEffect(() => { setSheet(null); }, [location.pathname, location.search]);

  // Signal to Layout that we're in cruise mode so it can reposition the announcement strip
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pnp-cruise-mode", { detail: true }));
    return () => { window.dispatchEvent(new CustomEvent("pnp-cruise-mode", { detail: false })); };
  }, []);

  const toggle = (s: ActiveSheet) => setSheet((prev) => (prev === s ? null : s));

  const isHome =
    location.pathname === "/" &&
    !location.search.includes("hangouts") &&
    !location.search.includes("home");

  return (
    <>
      {sheet === "pigs" && <MeetPigsSheet onClose={() => setSheet(null)} />}
      {sheet === "content" && <ContentSheet onClose={() => setSheet(null)} />}
      {sheet === "you" && <YouSheet onClose={() => setSheet(null)} onSwitchMode={onSwitchMode} />}

      {/* Floating pill */}
      <div
        className="fixed left-1/2 z-[100] flex items-center px-2 py-2 rounded-full"
        style={{
          // translate3d forces GPU layer on iOS Safari — avoids the fixed+transform repaint bug
          transform: "translate3d(-50%, 0, 0)",
          // Safe-area-aware bottom so it clears the iPhone home indicator
          bottom: "calc(1.75rem + env(safe-area-inset-bottom, 0px))",
          // Solid fallback for @supports(backdrop-filter) failures (old Firefox, WebView)
          background: "rgba(22,22,30,.96)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,.12)",
          boxShadow: "0 8px 32px rgba(0,0,0,.65), inset 0 0 0 1px rgba(255,255,255,.04)",
          // Prevent line-break of pill on narrow screens
          whiteSpace: "nowrap",
        }}
        translate="no"
      >
        {/* Home */}
        <IslandBtn
          label="Home"
          active={isHome && sheet === null}
          onClick={() => { setSheet(null); navigate("/"); }}
          icon={
            <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          }
        />

        <IslandDivider />

        {/* Meet Pigs */}
        <IslandBtn
          label="Pigs"
          active={sheet === "pigs"}
          onClick={() => toggle("pigs")}
          icon={
            <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="9" />
              <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 8.5C9.5 7.5 10.6 7 12 7s2.5.5 3.5 1.5" />
            </svg>
          }
        />

        {/* Content */}
        <IslandBtn
          label="Content"
          active={sheet === "content"}
          onClick={() => toggle("content")}
          icon={
            <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        <IslandDivider />

        {/* You */}
        <IslandBtn
          label="You"
          active={sheet === "you"}
          hasNotif
          onClick={() => toggle("you")}
          icon={
            <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          }
        />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — routes to the right nav based on username + stored preference
// ─────────────────────────────────────────────────────────────────────────────
export function BottomNav() {
  const { user } = useAuth();
  const [navMode, setNavMode] = useState<NavMode>(() =>
    (localStorage.getItem("pnp_nav_mode") as NavMode) || "island"
  );

  const switchMode = useCallback((mode: NavMode) => {
    localStorage.setItem("pnp_nav_mode", mode);
    setNavMode(mode);
  }, []);

  if (navMode === "island") return <FloatingIslandNav onSwitchMode={switchMode} />;
  return (
    <>
      <ClassicNav />
      <CruiseSwitchFAB onSwitch={() => switchMode("island")} />
    </>
  );
}
