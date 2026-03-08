import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { getXLoginUrl, telegramWidgetAuth, type TelegramWidgetUser } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

function getBotUsername(): string {
  const raw = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "PNPLatinoTV_Bot";
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Telegram Widget ───────────────────────────────────────────────────────────

function TelegramLoginWidget({ onAuth, onLoadError }: { onAuth: (u: TelegramWidgetUser) => void; onLoadError: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onAuthRef = useRef(onAuth);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => { onAuthRef.current = onAuth; }, [onAuth]);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>)["onTelegramAuth"] = (user: TelegramWidgetUser) => { onAuthRef.current(user); };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", getBotUsername());
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    const timer = setTimeout(() => onLoadErrorRef.current(), 8000);
    script.onload = () => clearTimeout(timer);
    script.onerror = () => { clearTimeout(timer); onLoadErrorRef.current(); };
    containerRef.current?.appendChild(script);
    return () => {
      clearTimeout(timer);
      delete (window as unknown as Record<string, unknown>)["onTelegramAuth"];
    };
  }, []);

  return <div ref={containerRef} className="flex justify-center" />;
}

// ── Bottom Sheet ──────────────────────────────────────────────────────────────

const sheetContent: Record<string, { title: string; emoji: string; body: React.ReactNode }> = {
  about: {
    title: "What is PNPtv?",
    emoji: "👋",
    body: (
      <div className="space-y-4">
        <p className="text-white/70 text-sm leading-relaxed">
          PNPtv is a private social network built specifically for the queer PNP community.
          Post, chat, stream, meet people nearby — without the judgment, the algorithms, or the bans.
          <strong className="text-white"> Your identity is yours. Your data stays with us.</strong>
        </p>
        <div className="grid grid-cols-1 gap-3">
          {[
            { e: "🔒", t: "Private by default", b: "Nothing you post ends up on Google. No data brokers. No ads." },
            { e: "🌈", t: "Built for you", b: "Every feature is designed with the queer PNP community in mind." },
            { e: "📱", t: "Works in your browser", b: "No app store needed. Open pnptv.app on any phone and you're in. Install it for push notifications." },
          ].map(c => (
            <div key={c.t} className="flex gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
              <span className="text-xl flex-shrink-0">{c.e}</span>
              <div><p className="text-white text-sm font-semibold">{c.t}</p><p className="text-white/50 text-xs mt-0.5">{c.b}</p></div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  feed: {
    title: "Feed",
    emoji: "📣",
    body: (
      <div className="space-y-4">
        <p className="text-white/50 text-xs font-bold uppercase tracking-widest" style={{ color: "#D4007A" }}>Like X — but ours</p>
        <p className="text-white/70 text-sm leading-relaxed">
          Post text, photos, or videos. Like, reply, repost. Follow people you vibe with and get a feed
          that's actually relevant — <strong className="text-white">no shadow banning, no random ads, no content cops.</strong>
        </p>
        <p className="text-white/70 text-sm leading-relaxed">
          Creators can lock exclusive posts for subscribers only. Cross-post to X in one tap if you want to.
          Everything else stays right here.
        </p>
      </div>
    ),
  },
  hangouts: {
    title: "Hangouts",
    emoji: "🎙️",
    body: (
      <div className="space-y-4">
        <p className="text-white/50 text-xs font-bold uppercase tracking-widest" style={{ color: "#E69138" }}>Like Discord — but simpler</p>
        <p className="text-white/70 text-sm leading-relaxed">
          Create a Hangout, invite your people, and jump into group video or voice.
          Public rooms anyone can join, or private ones with a password.
        </p>
        <p className="text-white/70 text-sm leading-relaxed">
          <strong className="text-white">No bots. No server setup. No 47 channels you'll never use.</strong> Just a room and a vibe.
        </p>
      </div>
    ),
  },
  live: {
    title: "Live",
    emoji: "🔴",
    body: (
      <div className="space-y-4">
        <p className="text-white/50 text-xs font-bold uppercase tracking-widest" style={{ color: "#D4007A" }}>Like Chaturbate — but cloudy ☁️</p>
        <p className="text-white/70 text-sm leading-relaxed">
          Stream directly from your browser or use OBS / your phone with a streaming key.
          Your followers get notified instantly, chat in real-time, and tip you directly.
        </p>
        <p className="text-white/70 text-sm leading-relaxed">
          <strong className="text-white">No strikes. No suspensions. No content police.</strong> You own your stream.
        </p>
      </div>
    ),
  },
  nearby: {
    title: "Nearby",
    emoji: "📍",
    body: (
      <div className="space-y-4">
        <p className="text-white/50 text-xs font-bold uppercase tracking-widest" style={{ color: "#5ED1C4" }}>Like Grindr — but for real PNP stans</p>
        <p className="text-white/70 text-sm leading-relaxed">
          See community members and PNP-friendly venues near you on a map.
          <strong className="text-white"> No bots, no escorts, no judgment.</strong> Just real people in the community.
        </p>
        <p className="text-white/70 text-sm leading-relaxed">
          Way more private than Grindr: you control exactly how much location you share, and
          <strong className="text-white"> nothing is ever sold to data brokers.</strong>
        </p>
      </div>
    ),
  },
  creators: {
    title: "Creators",
    emoji: "💰",
    body: (
      <div className="space-y-4">
        <p className="text-white/70 text-sm leading-relaxed">
          Turn your audience into income. Subscriptions, exclusive content, tips, live streaming —
          <strong className="text-white"> you keep 80% of everything.</strong>
        </p>
        <div className="flex gap-3">
          {[{ v: "80%", l: "Revenue yours" }, { v: "0", l: "Middlemen" }, { v: "Fast", l: "Payouts" }].map(s => (
            <div key={s.l} className="flex-1 text-center p-3 rounded-xl" style={{ background: "rgba(230,145,56,0.08)", border: "1px solid rgba(230,145,56,0.2)" }}>
              <div className="text-lg font-bold" style={{ background: "linear-gradient(135deg,#D4007A,#E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{s.v}</div>
              <div className="text-white/50 text-xs mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>
        <Link to="/become-a-model" className="block w-full text-center py-3 rounded-xl text-sm font-bold border border-white/20 text-white hover:bg-white/5 transition-colors">
          Apply as a Creator →
        </Link>
      </div>
    ),
  },
  payments: {
    title: "Payments",
    emoji: "💳",
    body: (
      <div className="space-y-3">
        <p className="text-white/70 text-sm">Multiple ways to pay — pick what works for you.</p>
        {[
          { e: "💳", t: "Credit & Debit Card", b: "Visa, Mastercard via ePayco. Fast and familiar.", c: "#5ED1C4" },
          { e: "⚡", t: "Crypto (USDC)", b: "Pay with USDC on Base via Daimo. Near-instant, low fees.", c: "#E69138" },
          { e: "🪙", t: "PNP Tokens", b: "Buy tokens inside the app for tips, subscriptions & exclusive content.", c: "#D4007A" },
        ].map(c => (
          <div key={c.t} className="flex gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${c.c}22` }}>
            <span className="text-xl flex-shrink-0">{c.e}</span>
            <div><p className="text-white text-sm font-semibold">{c.t}</p><p className="text-white/50 text-xs mt-0.5">{c.b}</p></div>
          </div>
        ))}
        <p className="text-white/40 text-xs text-center pt-1">🔒 Encrypted · Discreet billing · We never store your card</p>
      </div>
    ),
  },
  safety: {
    title: "Safety First",
    emoji: "🛡️",
    body: (
      <div className="space-y-3">
        <p className="text-white/70 text-sm leading-relaxed">We take safety seriously. This is your space and we protect it.</p>
        {[
          "Age & identity verification for all members",
          "Human moderation — real people reviewing reports",
          "End-to-end encrypted direct messages",
          "Block, mute, and report tools on every post",
          "Harm reduction resources and community guidelines",
        ].map(item => (
          <div key={item} className="flex gap-2.5 items-start">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: "#D4007A" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <p className="text-white/70 text-sm">{item}</p>
          </div>
        ))}
        <a href="/safety" className="block text-center text-sm font-semibold mt-2" style={{ color: "#D4007A" }}>Learn more about safety →</a>
      </div>
    ),
  },
};

const navItems = [
  { id: "about",    emoji: "👋", label: "About" },
  { id: "feed",     emoji: "📣", label: "Feed" },
  { id: "hangouts", emoji: "🎙️", label: "Hangouts" },
  { id: "live",     emoji: "🔴", label: "Live" },
  { id: "nearby",   emoji: "📍", label: "Nearby" },
  { id: "creators", emoji: "💰", label: "Creators" },
  { id: "payments", emoji: "💳", label: "Payments" },
  { id: "safety",   emoji: "🛡️", label: "Safety" },
] as const;

// ── LandingPage ───────────────────────────────────────────────────────────────

export function LandingPage() {
  const { refreshUser } = useAuth();

  // Login accordion
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginView, setLoginView] = useState<"options" | "telegram" | "email">("options");

  // Telegram widget state
  const [widgetStatus, setWidgetStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // X state
  const [xRedirecting, setXRedirecting] = useState(false);

  // Email state
  const [emailVal, setEmailVal] = useState("");
  const [passVal, setPassVal] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Bottom sheet
  const [activeSheet, setActiveSheet] = useState<string | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Lock body scroll when sheet is open
  useEffect(() => {
    document.body.style.overflow = activeSheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [activeSheet]);

  const handleWidgetAuth = useCallback(async (userData: TelegramWidgetUser) => {
    setWidgetStatus("verifying");
    try {
      const result = await telegramWidgetAuth(userData);
      if (result.success) {
        localStorage.setItem("pnptv_last_auth", "telegram");
        if (result.user?.username) localStorage.setItem("pnptv_last_username", result.user.username);
        await refreshUser();
        window.location.href = "/";
      } else {
        setWidgetStatus("error");
        setWidgetError(result.error || "Authentication failed");
      }
    } catch {
      setWidgetStatus("error");
      setWidgetError("Something went wrong. Try again.");
    }
  }, [refreshUser]);

  const handleWidgetLoadError = useCallback(() => setWidgetBlocked(true), []);

  const handleDeepLink = async () => {
    try {
      const win = window.open("about:blank", "_blank");
      const res = await fetch(`${API_BASE}/api/webapp/auth/telegram/token`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (!data.success || !data.token || !data.deepLink) { win?.close(); return; }
      if (win) win.location.href = data.deepLink; else window.location.href = data.deepLink;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        if (++attempts > 60) { clearInterval(pollRef.current!); return; }
        try {
          const check = await fetch(`${API_BASE}/api/webapp/auth/telegram/check?token=${data.token}`, { credentials: "include" });
          const result = await check.json();
          if (result.authenticated) { clearInterval(pollRef.current!); localStorage.setItem("pnptv_last_auth", "telegram"); window.location.href = "/"; }
        } catch { /* keep polling */ }
      }, 5000);
    } catch { /* silent */ }
  };

  const handleX = () => {
    setXRedirecting(true);
    localStorage.setItem("pnptv_last_auth", "x");
    window.location.href = getXLoginUrl();
  };

  const handleEmail = async () => {
    if (!emailVal.trim() || !passVal) { setEmailError("Email and password are required"); return; }
    setEmailLoading(true);
    setEmailError(null);
    try {
      const res = await fetch(`${API_BASE}/api/webapp/auth/email/login`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal.trim().toLowerCase(), password: passVal }),
      });
      const data = await res.json();
      if (res.ok && data.authenticated) {
        localStorage.setItem("pnptv_last_auth", "email");
        window.location.href = "/";
      } else {
        setEmailError(data.error || data.message || "Login failed");
      }
    } catch { setEmailError("Connection error. Try again."); }
    finally { setEmailLoading(false); }
  };

  const openLogin = () => {
    setLoginOpen(true);
    setLoginView("options");
  };

  const sheet = activeSheet ? sheetContent[activeSheet] : null;

  return (
    <div className="h-dvh flex flex-col relative overflow-hidden" style={{ background: "#0A0A0B" }}>

      {/* Background orbs */}
      <div className="fixed top-[-15%] left-[-5%] w-[500px] h-[500px] rounded-full opacity-10 blur-3xl pointer-events-none" style={{ background: "radial-gradient(circle, #D4007A, transparent 70%)" }} aria-hidden="true" />
      <div className="fixed bottom-[-20%] right-[-8%] w-[500px] h-[500px] rounded-full opacity-10 blur-3xl pointer-events-none" style={{ background: "radial-gradient(circle, #E69138, transparent 70%)" }} aria-hidden="true" />

      {/* ── MINIMAL TOP BAR ─────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 h-14" style={{ background: "rgba(10,10,11,0.7)", backdropFilter: "blur(12px)" }}>
        <div className="w-16" />
        <div className="w-16" />
        <button
          onClick={openLogin}
          className="text-sm font-semibold text-white/60 hover:text-white transition-colors"
        >
          Log in
        </button>
      </header>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-5 pt-14 pb-28 overflow-y-auto">

        {/* Logo — centered, prominent */}
        <img src="/Logo2-50.png" alt="PNPtv!" className="h-16 sm:h-20 w-auto mb-5 animate-fade-in-up" style={{ filter: "drop-shadow(0 0 24px rgba(212,0,122,0.4))" }} />

        {/* Tagline */}
        <h1
          className="text-base sm:text-lg font-bold tracking-widest uppercase mb-2 animate-fade-in-up"
          style={{ animationDelay: "0.05s", background: "linear-gradient(135deg,#D4007A,#E69138)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          The Clouds &amp; Rush Network
        </h1>

        <p className="text-white/40 text-sm mb-10 animate-fade-in-up" style={{ animationDelay: "0.08s" }}>
          The #1 queer PNP community
        </p>

        {/* CTAs */}
        <div className="w-full max-w-xs flex flex-col gap-3 animate-fade-in-up" style={{ animationDelay: "0.12s" }}>

          {/* Create account */}
          <Link
            to="/join"
            className="w-full py-4 rounded-2xl text-base font-bold text-white text-center shadow-lg transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
          >
            Create new account
          </Link>

          {/* Join existing account — accordion trigger */}
          <button
            onClick={() => setLoginOpen((v) => !v)}
            className="w-full py-4 rounded-2xl text-base font-semibold text-white flex items-center justify-center gap-2 border transition-colors duration-150"
            style={{ borderColor: "rgba(255,255,255,0.2)", background: loginOpen ? "rgba(255,255,255,0.06)" : "transparent" }}
          >
            Join your account
            <svg className={`w-4 h-4 transition-transform duration-200 ${loginOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Login accordion */}
          <div
            className="overflow-hidden transition-all duration-300 rounded-2xl"
            style={{
              maxHeight: loginOpen ? "500px" : "0px",
              opacity: loginOpen ? 1 : 0,
              border: loginOpen ? "1px solid rgba(255,255,255,0.08)" : "none",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div className="p-4 space-y-2">

              {/* View: options */}
              {loginView === "options" && (
                <>
                  {/* Telegram */}
                  <button
                    onClick={() => setLoginView("telegram")}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold text-white transition-colors hover:bg-white/5"
                    style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#29B6F6" }}>
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.062 13.85l-2.946-.924c-.64-.203-.654-.64.136-.953l11.5-4.431c.534-.194 1.001.13.81.706z" />
                    </svg>
                    Continue with Telegram
                  </button>

                  {/* X */}
                  <button
                    onClick={handleX}
                    disabled={xRedirecting}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold text-white transition-colors hover:bg-white/5 disabled:opacity-50"
                    style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    {xRedirecting ? <Spinner /> : (
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    )}
                    {xRedirecting ? "Redirecting…" : "Continue with X"}
                  </button>

                  {/* Email */}
                  <button
                    onClick={() => setLoginView("email")}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold text-white transition-colors hover:bg-white/5"
                    style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                    Continue with Email
                  </button>
                </>
              )}

              {/* View: Telegram */}
              {loginView === "telegram" && (
                <div className="space-y-3">
                  <button onClick={() => setLoginView("options")} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                    Back
                  </button>
                  {widgetStatus === "verifying" ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-white/60 text-sm"><Spinner /> Verifying…</div>
                  ) : widgetStatus === "error" ? (
                    <div className="text-center space-y-2">
                      <p className="text-red-400 text-sm">{widgetError}</p>
                      <button onClick={() => setWidgetStatus("idle")} className="text-xs text-white/50 underline">Try again</button>
                    </div>
                  ) : widgetBlocked ? (
                    <div className="space-y-2">
                      <p className="text-white/60 text-xs text-center">Widget blocked (ad blocker?)</p>
                      <button onClick={handleDeepLink} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg,#29B6F6,#0277BD)" }}>
                        Open Telegram App instead
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <TelegramLoginWidget onAuth={handleWidgetAuth} onLoadError={handleWidgetLoadError} />
                      <button onClick={handleDeepLink} className="w-full text-xs text-white/40 hover:text-white/70 transition-colors py-1">
                        Use Telegram app instead →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* View: Email */}
              {loginView === "email" && (
                <div className="space-y-3">
                  <button onClick={() => setLoginView("options")} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                    Back
                  </button>
                  <input
                    type="email"
                    placeholder="Email"
                    value={emailVal}
                    onChange={e => setEmailVal(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl text-sm text-white bg-white/5 border border-white/10 focus:border-[#D4007A] focus:outline-none placeholder-white/30 transition-colors"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={passVal}
                    onChange={e => setPassVal(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleEmail()}
                    className="w-full px-4 py-3 rounded-xl text-sm text-white bg-white/5 border border-white/10 focus:border-[#D4007A] focus:outline-none placeholder-white/30 transition-colors"
                  />
                  {emailError && <p className="text-red-400 text-xs">{emailError}</p>}
                  <button
                    onClick={handleEmail}
                    disabled={emailLoading}
                    className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
                  >
                    {emailLoading && <Spinner />}
                    {emailLoading ? "Logging in…" : "Log in"}
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      </main>

      {/* ── BOTTOM BAR ──────────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 flex flex-col"
        style={{ background: "rgba(10,10,11,0.95)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Carousel nav pills */}
        <nav className="overflow-x-auto no-scrollbar" aria-label="Explore PNPtv">
          <div className="flex items-center gap-2 px-4 h-12 w-max">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSheet(activeSheet === item.id ? null : item.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150 flex-shrink-0"
                style={
                  activeSheet === item.id
                    ? { background: "linear-gradient(135deg,#D4007A,#E69138)", color: "#fff" }
                    : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)" }
                }
              >
                <span>{item.emoji}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Legal links */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-safe py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {[
            { label: "Terms", href: "/terms" },
            { label: "Privacy", href: "/privacy" },
            { label: "Cookies", href: "/cookies" },
            { label: "Content Policy", href: "/content-policy" },
            { label: "DMCA", href: "/dmca" },
            { label: "Refunds", href: "/refunds" },
            { label: "Contact", href: "/contact" },
          ].map(l => (
            <a key={l.href} href={l.href} className="text-[10px] whitespace-nowrap transition-colors" style={{ color: "rgba(255,255,255,0.25)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>

      {/* ── BOTTOM SHEET ────────────────────────────────────────────────────── */}
      {sheet && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setActiveSheet(null)}
            aria-hidden="true"
          />
          {/* Sheet */}
          <div
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-y-auto animate-fade-in-up"
            style={{
              background: "#1C1C1E",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              maxHeight: "72dvh",
              paddingBottom: "env(safe-area-inset-bottom, 16px)",
              animationDuration: "0.25s",
            }}
            role="dialog"
            aria-label={sheet.title}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 sticky top-0" style={{ background: "#1C1C1E", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{sheet.emoji}</span>
                <h2 className="text-base font-bold text-white">{sheet.title}</h2>
              </div>
              <button
                onClick={() => setActiveSheet(null)}
                className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-4">
              {sheet.body}
            </div>

            {/* Join CTA at bottom of every sheet */}
            <div className="px-5 pb-4">
              <Link
                to="/join"
                onClick={() => setActiveSheet(null)}
                className="block w-full text-center py-3.5 rounded-2xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#D4007A,#E69138)" }}
              >
                Join free →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default LandingPage;
