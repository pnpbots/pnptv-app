import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { telegramWidgetAuth, recoverAccount, TelegramWidgetUser } from "@/lib/api";
import { login as oidcLogin } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import { LanguageSelector } from "@/components/LanguageSelector";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";
const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";

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

// ── Sheet content ─────────────────────────────────────────────────────────────

const sheets: Record<string, { title: string; emoji: string; body: React.ReactNode }> = {
  about: {
    title: "What is PNPtv?",
    emoji: "👋",
    body: (
      <div className="space-y-3">
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          A private social network built for the queer PNP community. Post, chat, stream, meet people nearby —
          without judgment, algorithms, or bans. <span className="text-white font-medium">Your data stays with us.</span>
        </p>
        <div className="space-y-2">
          {[
            { e: "🔒", t: "Private by default", b: "Nothing you post leaves our walls unless you share it yourself." },
            { e: "🌈", t: "Built for you", b: "Every feature designed with the queer PNP community in mind." },
            { e: "📱", t: "Works in your browser", b: "No app store. Open pnptv.app on any phone. Install it for push notifications." },
          ].map(c => (
            <div key={c.t} className="flex gap-3 p-3 rounded-xl bg-pnp-surface border border-pnp-border">
              <span className="text-lg flex-shrink-0">{c.e}</span>
              <div>
                <p className="text-white text-xs font-semibold">{c.t}</p>
                <p className="text-pnp-textSecondary text-xs mt-0.5">{c.b}</p>
              </div>
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
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gradient">Like X — but ours</p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          Post text, photos, or videos. Like, reply, repost. Follow people you vibe with and get a feed
          that's actually relevant — <span className="text-white font-medium">no shadow banning, no ads, no content cops.</span>
        </p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          Creators can lock exclusive posts for subscribers only. Cross-post to X in one tap if you want.
        </p>
      </div>
    ),
  },
  hangouts: {
    title: "Hangouts",
    emoji: "🎙️",
    body: (
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gradient">Like Discord — but simpler</p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          Create a Hangout, invite your people, jump into group video or voice.
          Public rooms or private ones with a password.
        </p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          <span className="text-white font-medium">No bots. No server setup. No 47 channels you'll never use.</span>
        </p>
      </div>
    ),
  },
  live: {
    title: "Live",
    emoji: "🔴",
    body: (
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gradient">Like Chaturbate — but cloudy ☁️</p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          Stream directly from your browser or use OBS with a streaming key.
          Followers get notified instantly, chat in real-time, and tip you directly.
        </p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          <span className="text-white font-medium">No strikes. No suspensions. No content police.</span>
        </p>
      </div>
    ),
  },
  nearby: {
    title: "Nearby",
    emoji: "📍",
    body: (
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gradient">Like Grindr — but for real PNP stans</p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          See community members and PNP-friendly venues near you on a map.
          <span className="text-white font-medium"> No bots, no escorts, no judgment.</span>
        </p>
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          Way more private than Grindr. You control your location. <span className="text-white font-medium">Nothing is ever sold to data brokers.</span>
        </p>
      </div>
    ),
  },
  creators: {
    title: "Creators",
    emoji: "💰",
    body: (
      <div className="space-y-3">
        <p className="text-pnp-textSecondary text-sm leading-relaxed">
          Subscriptions, exclusive content, tips, live streaming —
          <span className="text-white font-medium"> you keep 80% of everything.</span>
        </p>
        <div className="flex gap-2">
          {[{ v: "80%", l: "Revenue yours" }, { v: "0", l: "Middlemen" }, { v: "Fast", l: "Payouts" }].map(s => (
            <div key={s.l} className="flex-1 text-center p-3 rounded-xl bg-pnp-surface border border-pnp-border">
              <div className="text-base font-bold text-gradient">{s.v}</div>
              <div className="text-pnp-textSecondary text-[10px] mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>
        <Link to="/become-a-model" className="block w-full text-center py-3 rounded-xl text-sm font-semibold border border-pnp-border text-pnp-textSecondary hover:text-white hover:border-white/30 transition-colors">
          Apply as a Creator →
        </Link>
      </div>
    ),
  },
  payments: {
    title: "Payments",
    emoji: "💳",
    body: (
      <div className="space-y-2">
        <p className="text-pnp-textSecondary text-sm mb-3">Multiple ways to pay — pick what works for you.</p>
        {[
          { e: "💳", t: "Credit & Debit Card", b: "Visa, Mastercard via ePayco. Fast and familiar." },
          { e: "⚡", t: "Crypto (USDC)", b: "Pay with USDC on Base via Daimo. Near-instant, low fees." },
          { e: "🪙", t: "PNP Tokens", b: "Buy tokens inside the app for tips, subscriptions & exclusive content." },
        ].map(c => (
          <div key={c.t} className="flex gap-3 p-3 rounded-xl bg-pnp-surface border border-pnp-border">
            <span className="text-lg flex-shrink-0">{c.e}</span>
            <div>
              <p className="text-white text-xs font-semibold">{c.t}</p>
              <p className="text-pnp-textSecondary text-xs mt-0.5">{c.b}</p>
            </div>
          </div>
        ))}
        <p className="text-pnp-textSecondary/50 text-[10px] text-center pt-1">🔒 Encrypted · Discreet billing · We never store your card</p>
      </div>
    ),
  },
  safety: {
    title: "Safety First",
    emoji: "🛡️",
    body: (
      <div className="space-y-3">
        <p className="text-pnp-textSecondary text-sm leading-relaxed">We take safety seriously. This is your space and we protect it.</p>
        <div className="space-y-2">
          {[
            "Age & identity verification for all members",
            "Human moderation — real people reviewing reports",
            "Encrypted direct messages",
            "Block, mute, and report tools on every post",
            "Harm reduction resources & community guidelines",
          ].map(item => (
            <div key={item} className="flex gap-2.5 items-start">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <p className="text-pnp-textSecondary text-sm">{item}</p>
            </div>
          ))}
        </div>
        <a href="/safety" className="block text-center text-sm font-semibold text-gradient mt-2">Learn more →</a>
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

const legalLinks = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Cookies", href: "/cookies" },
  { label: "Content Policy", href: "/content-policy" },
  { label: "DMCA", href: "/dmca" },
  { label: "Refunds", href: "/refunds" },
  { label: "Contact", href: "/contact" },
];

// ── LandingPage ───────────────────────────────────────────────────────────────

export function LandingPage() {
  const { refreshUser } = useAuth();

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginView, setLoginView] = useState<"options" | "telegram" | "email" | "recover">("options");
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcError, setOidcError] = useState<string | null>(null);

  const [widgetStatus, setWidgetStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [emailVal, setEmailVal] = useState("");
  const [passVal, setPassVal] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

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
      const isValidDeepLink = (url: string) => url.startsWith('/') || url.startsWith('https://');
      if (!isValidDeepLink(data.deepLink)) { win?.close(); return; }
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

  const handleRecover = async () => {
    if (!recoverEmail.trim() || !recoverEmail.includes("@")) return;
    setRecoverLoading(true);
    setRecoverError(null);
    try {
      const res = await recoverAccount(recoverEmail.trim().toLowerCase());
      if (res.success) {
        setRecoverSent(true);
      } else {
        setRecoverError(res.message || "Recovery failed");
      }
    } catch { setRecoverError("Connection error. Try again."); }
    finally { setRecoverLoading(false); }
  };

  const sheet = activeSheet ? sheets[activeSheet] : null;

  return (
    <div className="app-shell bg-pnp-background">

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="glass-nav border-b border-pnp-border flex items-center justify-end px-4 h-14 flex-shrink-0">
        <LanguageSelector />
      </header>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 overflow-y-auto">
        <div className="w-full max-w-xs flex flex-col items-center gap-4">

          {/* Logo — hero centerpiece */}
          <img src="/logo-login.png" alt="PNPtv!" className="w-56 h-auto" />

          {/* Tagline */}
          <div>
            <p className="text-gradient text-xs font-bold uppercase tracking-widest mb-1">The Clouds &amp; Rush Network</p>
            <p className="text-pnp-textSecondary text-xs">The #1 queer PNP community</p>
          </div>

          {/* Join existing — accordion */}
          <div className="w-full">
            <button
              onClick={() => { setLoginOpen(v => !v); setLoginView("options"); }}
              className="w-full py-3.5 rounded-xl text-sm font-semibold text-pnp-textSecondary border border-pnp-border hover:border-white/30 hover:text-white flex items-center justify-center gap-2 transition-colors"
            >
              Members Access
              <svg className={`w-4 h-4 transition-transform duration-200 ${loginOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Accordion body */}
            <div
              className="overflow-hidden transition-all duration-300"
              style={{ maxHeight: loginOpen ? "420px" : "0px", opacity: loginOpen ? 1 : 0 }}
            >
              <div className="glass-card-sm mt-2 p-3 space-y-2">

                {loginView === "options" && (
                  <>
                    <button
                      onClick={async () => {
                        setOidcLoading(true);
                        setOidcError(null);
                        try {
                          localStorage.setItem("pnptv_last_auth", "pnptv_id");
                          await oidcLogin();
                        } catch (e: any) {
                          console.error('[PNPtv ID] SSO login failed:', e);
                          setOidcLoading(false);
                          setOidcError(e?.message || "Could not connect to login server. Try again.");
                        }
                      }}
                      disabled={oidcLoading}
                      className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
                      style={{ background: oidcLoading ? "linear-gradient(135deg, #a0005e, #b87020)" : "linear-gradient(135deg, #D4007A, #E69138)" }}
                    >
                      {oidcLoading ? (
                        <Spinner />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                          <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                        </svg>
                      )}
                      {oidcLoading ? "Connecting..." : "Sign in with PNPtv ID"}
                    </button>
                    {oidcError && <p className="text-red-400 text-xs text-center">{oidcError}</p>}

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="text-[10px] text-pnp-textSecondary uppercase tracking-widest">or</span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>

                    <button onClick={() => setLoginView("telegram")} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white border border-pnp-border hover:border-white/30 hover:bg-pnp-surface transition-colors">
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#29B6F6" }}>
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.062 13.85l-2.946-.924c-.64-.203-.654-.64.136-.953l11.5-4.431c.534-.194 1.001.13.81.706z" />
                      </svg>
                      Continue with Telegram
                    </button>

                    <button onClick={() => setLoginView("email")} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-pnp-textSecondary border border-pnp-border hover:border-white/30 hover:text-white hover:bg-pnp-surface transition-colors">
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                      Continue with Email
                    </button>

                    <button
                      onClick={() => { window.location.href = "/api/webapp/auth/oidc/login"; }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white border border-pnp-accent/50 hover:border-pnp-accent hover:bg-pnp-accent/10 transition-colors"
                    >
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      Sign in with PNPtv SSO
                    </button>

                    <p className="text-center text-xs text-pnp-textSecondary pt-1">
                      New here?{" "}
                      <a href={`${AUTHENTIK_URL}/if/flow/default-enrollment-flow/`} className="font-semibold underline text-pnp-accent hover:brightness-125 transition-all">
                        Create a PNPtv ID
                      </a>
                    </p>

                    <button onClick={() => { setLoginView("recover"); setRecoverSent(false); setRecoverError(null); setRecoverEmail(""); }} className="w-full text-center text-xs text-pnp-textSecondary/70 hover:text-white transition-colors pt-1">
                      Had an X (Twitter) account? Recover it here
                    </button>
                  </>
                )}

                {loginView === "recover" && (
                  <div className="space-y-3">
                    <button onClick={() => setLoginView("options")} className="flex items-center gap-1 text-xs text-pnp-textSecondary hover:text-white transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                      Back
                    </button>
                    <div className="text-center space-y-1 pb-2">
                      <p className="text-sm font-semibold text-white">Account Recovery</p>
                      <p className="text-xs text-pnp-textSecondary">Enter the email linked to your old X or PNPtv account. We'll send a recovery link to set a new password.</p>
                    </div>
                    {recoverSent ? (
                      <div className="text-center py-4 space-y-2">
                        <svg className="w-10 h-10 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm text-green-400 font-medium">Recovery link sent!</p>
                        <p className="text-xs text-pnp-textSecondary">Check your email inbox (and spam folder) for a link to set your password. Then come back and log in with Email.</p>
                      </div>
                    ) : (
                      <>
                        <input type="email" placeholder="Your email address" value={recoverEmail} onChange={e => setRecoverEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleRecover()}
                          className="w-full px-3 py-2.5 rounded-xl text-sm text-white bg-pnp-surface border border-pnp-border focus:border-pnp-accent focus:outline-none placeholder-pnp-textSecondary/50 transition-colors" />
                        {recoverError && <p className="text-pnp-error text-xs">{recoverError}</p>}
                        <button onClick={handleRecover} disabled={recoverLoading || !recoverEmail.includes("@")}
                          className="btn-gradient w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
                          {recoverLoading && <Spinner />}
                          {recoverLoading ? "Sending…" : "Send Recovery Link"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {loginView === "telegram" && (
                  <div className="space-y-3">
                    <button onClick={() => setLoginView("options")} className="flex items-center gap-1 text-xs text-pnp-textSecondary hover:text-white transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                      Back
                    </button>
                    {widgetStatus === "verifying" && (
                      <div className="flex items-center justify-center gap-2 py-3 text-pnp-textSecondary text-sm"><Spinner /> Verifying…</div>
                    )}
                    {widgetStatus === "error" && (
                      <div className="text-center space-y-2">
                        <p className="text-pnp-error text-sm">{widgetError}</p>
                        <button onClick={() => setWidgetStatus("idle")} className="text-xs text-pnp-textSecondary underline">Try again</button>
                      </div>
                    )}
                    {widgetStatus === "idle" && (
                      widgetBlocked ? (
                        <div className="space-y-2">
                          <p className="text-pnp-textSecondary text-xs text-center">Widget blocked — ad blocker?</p>
                          <button onClick={handleDeepLink} className="btn-gradient w-full py-3 rounded-xl text-sm font-bold text-white">
                            Open Telegram App
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <TelegramLoginWidget onAuth={handleWidgetAuth} onLoadError={handleWidgetLoadError} />
                          <button onClick={handleDeepLink} className="w-full text-xs text-pnp-textSecondary hover:text-white transition-colors py-1">
                            Use Telegram app instead →
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}

                {loginView === "email" && (
                  <div className="space-y-2">
                    <button onClick={() => setLoginView("options")} className="flex items-center gap-1 text-xs text-pnp-textSecondary hover:text-white transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                      Back
                    </button>
                    <input type="email" placeholder="Email" value={emailVal} onChange={e => setEmailVal(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white bg-pnp-surface border border-pnp-border focus:border-pnp-accent focus:outline-none placeholder-pnp-textSecondary/50 transition-colors" />
                    <input type="password" placeholder="Password" value={passVal} onChange={e => setPassVal(e.target.value)} onKeyDown={e => e.key === "Enter" && handleEmail()}
                      className="w-full px-3 py-2.5 rounded-xl text-sm text-white bg-pnp-surface border border-pnp-border focus:border-pnp-accent focus:outline-none placeholder-pnp-textSecondary/50 transition-colors" />
                    {emailError && <p className="text-pnp-error text-xs">{emailError}</p>}
                    <button onClick={handleEmail} disabled={emailLoading}
                      className="btn-gradient w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
                      {emailLoading && <Spinner />}
                      {emailLoading ? "Logging in…" : "Log in"}
                    </button>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── BOTTOM BAR ──────────────────────────────────────────────────────── */}
      <div className="glass-nav border-t border-pnp-border flex-shrink-0">
        {/* Carousel nav */}
        <nav className="overflow-x-auto no-scrollbar" aria-label="Explore PNPtv">
          <div className="flex items-center gap-2 px-4 h-12 w-max">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSheet(activeSheet === item.id ? null : item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150 flex-shrink-0 border ${
                  activeSheet === item.id
                    ? "btn-gradient border-transparent text-white"
                    : "border-pnp-border text-pnp-textSecondary hover:text-white hover:border-white/30"
                }`}
              >
                <span>{item.emoji}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Legal links */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-2 border-t border-pnp-border safe-area-bottom">
          {legalLinks.map(l => (
            <a key={l.href} href={l.href} className="text-[10px] text-pnp-textSecondary/40 hover:text-pnp-textSecondary transition-colors whitespace-nowrap">
              {l.label}
            </a>
          ))}
        </div>
      </div>

      {/* ── BOTTOM SHEET ────────────────────────────────────────────────────── */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setActiveSheet(null)} aria-hidden="true" />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 glass-nav border-t border-pnp-border rounded-t-2xl overflow-y-auto animate-fade-in-up"
            style={{ maxHeight: "70dvh", animationDuration: "0.2s" }}
            role="dialog"
            aria-label={sheet.title}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-pnp-border" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border sticky top-0 glass-nav">
              <div className="flex items-center gap-2">
                <span className="text-xl">{sheet.emoji}</span>
                <h2 className="text-sm font-bold text-white">{sheet.title}</h2>
              </div>
              <button onClick={() => setActiveSheet(null)} className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-white hover:bg-pnp-surface transition-colors" aria-label="Close">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-4 py-4">{sheet.body}</div>

            {/* CTA */}
            <div className="px-4 pb-6">
              <Link to="/join" onClick={() => setActiveSheet(null)} className="btn-gradient block w-full text-center py-3 rounded-xl text-sm font-bold text-white">
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
