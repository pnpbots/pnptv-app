import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { LanguageSelector } from "@/components/LanguageSelector";
import { magicLinkStart, passkeyBegin, passkeyFinish, checkAuthStatus } from "@/lib/api";
import { sanitizeReturnTo } from "@/lib/auth";

// ── WebAuthn helpers ──────────────────────────────────────────────────────────
// Authentik's flow executor returns binary fields as base64url strings; the
// browser's PublicKeyCredential API speaks ArrayBuffers.  Convert in both
// directions so we can drive the ceremony inline without redirects.

function b64urlToBuffer(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function bufferToB64url(buf: ArrayBuffer | null | undefined): string | undefined {
  if (!buf) return undefined;
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Sheet content ─────────────────────────────────────────────────────────────

export const sheets: Record<string, { title: string; emoji: string; body: React.ReactNode }> = {
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
    title: "Connect",
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
          { e: "⚡", t: "Crypto (USDC/BTC/ETH +100)", b: "Pay with crypto via NowPayments. Near-instant, low fees." },
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
  { id: "nearby",   emoji: "📍", label: "Connect" },
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
  // Surface OIDC errors from backend redirect (?oidc_error=...)
  const [oidcError, setOidcError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("oidc_error");
  });

  // Surface magic-link verify errors from backend redirect (?magic_error=...)
  const [magicError, setMagicError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("magic_error");
  });

  // Surface generic reason banners (?reason=session_expired from App.tsx socket event)
  const [reasonBanner, setReasonBanner] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("reason");
  });

  // Magic-link send flow state
  type MagicState = "hidden" | "form" | "sending" | "sent";
  const [magicState, setMagicState] = useState<MagicState>("hidden");
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSendError, setMagicSendError] = useState<string | null>(null);
  const [magicSentTo, setMagicSentTo] = useState<string | null>(null);

  // Passkey ceremony state. The primary "Continue with PNPtv ID" button
  // attempts WebAuthn inline; on failure the magic-link form is auto-opened.
  const [passkeyState, setPasskeyState] = useState<"idle" | "trying">("idle");
  const [passkeyHint, setPasskeyHint] = useState<string | null>(null);

  // Native registration form state
  type RegState = "hidden" | "form" | "submitting";
  const [regState, setRegState] = useState<RegState>("hidden");
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regShowPassword, setRegShowPassword] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // Telegram deep-link flow state
  type TgState = "idle" | "waiting" | "error";
  const [tgState, setTgState] = useState<TgState>("idle");
  const [tgError, setTgError] = useState<string | null>(null);
  const [tgFallbackUrl, setTgFallbackUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingTokenRef = useRef<string | null>(null);

  // Returning-user personalization. `pnptv_last_auth` reflects the most recent
  // method; `pnptv_last_telegram_*` persist across other logins so the Telegram
  // button stays personalized even after the user later signs in via PNPtv ID.
  const lastAuth = (() => {
    try { return localStorage.getItem("pnptv_last_auth"); } catch { return null; }
  })();
  const lastTgUsername = (() => {
    try { return localStorage.getItem("pnptv_last_telegram_username") || localStorage.getItem("pnptv_last_username"); } catch { return null; }
  })();
  const lastTgPhoto = (() => {
    try { return localStorage.getItem("pnptv_last_telegram_photo"); } catch { return null; }
  })();

  // Active bottom sheet (carousel pills)
  const [activeSheet, setActiveSheet] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("sheet");
    const valid = new Set(["about", "feed", "hangouts", "live", "nearby", "creators", "payments", "safety"]);
    return requested && valid.has(requested) ? requested : null;
  });

  // LATAM performer-focus mode (backend redirect with ?focus=performer)
  const params = new URLSearchParams(window.location.search);
  const performerFocus = params.get("focus") === "performer";
  const performerCountry = params.get("country") || null;

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // iOS Safari freezes setInterval when the page is backgrounded (e.g. user switches
  // to Telegram app). On return, fire an immediate poll so the confirmed token is
  // picked up without waiting for the next interval tick.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const token = pendingTokenRef.current;
      if (!token) return;
      fetch(`${API_BASE}/api/webapp/auth/telegram/check?token=${token}`, { credentials: "include" })
        .then(r => r.json())
        .then(result => {
          if (result.authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            pendingTokenRef.current = null;
            try {
              localStorage.setItem("pnptv_last_auth", "telegram");
              if (result.user?.username) {
                localStorage.setItem("pnptv_last_username", result.user.username);
                localStorage.setItem("pnptv_last_telegram_username", result.user.username);
              }
            } catch { /* ignore quota */ }
            const returnTo = new URLSearchParams(window.location.search).get("returnTo");
            window.location.href = sanitizeReturnTo(returnTo) ?? "/";
          }
        })
        .catch(() => { /* interval will retry */ });
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Auto-redirect already-authenticated users so they don't have to log in again.
  // Runs once on mount; skipped if there is no returnTo (user landed on /login directly).
  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    const safe = sanitizeReturnTo(returnTo);
    if (!safe) return;
    checkAuthStatus().then((status) => {
      if (status.authenticated) window.location.href = safe;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    document.body.style.overflow = activeSheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [activeSheet]);

  // ── PNPtv ID — inline passkey first, magic-link as fallback ─────────────
  // The primary button drives a WebAuthn ceremony directly (passkeyBegin →
  // navigator.credentials.get → passkeyFinish). On any failure (no passkey
  // enrolled, user cancels, transport error, backend 503) we silently swap to
  // the magic-link form below so the user never lands on a password screen.
  // No redirect to Authentik is involved.
  const openMagicForm = (hint?: string) => {
    setPasskeyHint(hint || null);
    setMagicState("form");
    setMagicSendError(null);
  };

  const handleOidcLogin = async () => {
    try { localStorage.setItem("pnptv_last_auth", "pnptv_id"); } catch { /* ignore */ }

    const supportsPasskey = typeof window !== "undefined" && !!window.PublicKeyCredential;
    if (!supportsPasskey) {
      openMagicForm("Your browser doesn't support passkeys — sign in with email instead.");
      return;
    }

    setPasskeyState("trying");
    setPasskeyHint(null);
    try {
      const challenge = await passkeyBegin();
      if (!challenge.success || !challenge.publicKey || !challenge.stateToken) {
        openMagicForm("Passkey login isn't ready right now. Sign in with email instead.");
        return;
      }

      // Convert base64url → ArrayBuffer for the WebAuthn API.
      const pk = challenge.publicKey;
      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: b64urlToBuffer(pk.challenge),
        rpId: pk.rpId,
        timeout: pk.timeout,
        userVerification: (pk.userVerification as UserVerificationRequirement | undefined) || "preferred",
        allowCredentials: pk.allowCredentials?.map((c) => ({
          id: b64urlToBuffer(c.id),
          type: "public-key" as const,
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
      };

      let credential: PublicKeyCredential | null;
      try {
        credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
      } catch (err) {
        // NotAllowedError = user cancelled or no matching credential. Other
        // errors (network, TimeoutError) are also non-actionable here — fall
        // back to magic-link in every case.
        const name = (err as { name?: string })?.name || "";
        const hint = name === "NotAllowedError"
          ? "No passkey on this device — sign in with email instead."
          : "Passkey couldn't be used. Sign in with email instead.";
        openMagicForm(hint);
        return;
      }
      if (!credential) {
        openMagicForm("No passkey on this device — sign in with email instead.");
        return;
      }

      const response = credential.response as AuthenticatorAssertionResponse;
      const assertion = {
        id: credential.id,
        rawId: bufferToB64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToB64url(response.clientDataJSON),
          authenticatorData: bufferToB64url(response.authenticatorData),
          signature: bufferToB64url(response.signature),
          userHandle: bufferToB64url(response.userHandle ?? null),
        },
        clientExtensionResults: credential.getClientExtensionResults?.() || {},
      };

      const finish = await passkeyFinish({ stateToken: challenge.stateToken, assertion });
      if (!finish.authenticated) {
        openMagicForm("Passkey didn't verify. Sign in with email instead.");
        return;
      }

      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      window.location.href = sanitizeReturnTo(returnTo) ?? "/";
    } catch {
      openMagicForm("Couldn't sign in with passkey. Sign in with email instead.");
    } finally {
      setPasskeyState("idle");
    }
  };

  // Magic-link send. Calls the PNPtv-native endpoint that mints a single-use
  // 15-min token, emails the link, and (on click) regenerates the session.
  // No user enumeration: the API always reports success, so the UI also shows
  // the same confirmation regardless of whether the address exists.
  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = magicEmail.trim();
    setMagicSendError(null);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMagicSendError("Please enter a valid email address.");
      return;
    }
    setMagicState("sending");
    try {
      await magicLinkStart(email);
      try { localStorage.setItem("pnptv_last_auth", "pnptv_id"); } catch { /* ignore */ }
      setMagicSentTo(email);
      setMagicState("sent");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      if (message.toLowerCase().includes("too many")) {
        setMagicSendError("Too many requests — wait a few minutes and try again.");
      } else {
        setMagicSendError("Couldn't send the link. Please try again.");
      }
      setMagicState("form");
    }
  };

  // ── Native registration ──────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = regEmail.trim();
    const username = regUsername.trim();
    setRegError(null);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegError("Please enter a valid email address.");
      return;
    }
    if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      setRegError("Username must be 3–30 characters (letters, numbers, underscores).");
      return;
    }
    if (!regPassword || regPassword.length < 8) {
      setRegError("Password must be at least 8 characters.");
      return;
    }
    setRegState("submitting");
    try {
      const res = await fetch(`${API_BASE}/api/webapp/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password: regPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegError(data.error || "Registration failed. Please try again.");
        setRegState("form");
        return;
      }
      window.location.href = "/";
    } catch {
      setRegError("Connection error. Please try again.");
      setRegState("form");
    }
  };

  // ── Telegram deep-link ──────────────────────────────────────────────────
  // Set "waiting" state immediately so the button changes the moment it's
  // tapped, then fetch a one-shot token, open the bot in a new tab. If the
  // popup gets blocked we surface a tap-to-open fallback link so the user
  // can continue manually instead of being stuck on a button that "did
  // nothing." Polling is independent of how the bot was opened.
  const handleTelegramLogin = async () => {
    if (tgState === "waiting") return;
    setTgError(null);
    setTgFallbackUrl(null);
    setTgState("waiting");
    try {
      const res = await fetch(`${API_BASE}/api/webapp/auth/telegram/token`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!data.success || !data.token || !data.deepLink) {
        setTgState("error");
        setTgError("Couldn't start Telegram sign-in. Try again.");
        return;
      }
      const isValid = (url: string) => url.startsWith("https://t.me/");
      if (!isValid(data.deepLink)) {
        setTgState("error");
        setTgError("Invalid Telegram link.");
        return;
      }

      // Always surface the deep-link as a tap-to-open button. On mobile
      // Safari window.open() after an awaited fetch often returns a non-null
      // Window that is never actually shown (popup-blocker false negative),
      // leaving users with a spinner that never resolves. Showing the link
      // unconditionally guarantees a working manual path while we still
      // attempt the popup as a convenience.
      setTgFallbackUrl(data.deepLink);
      try {
        window.open(data.deepLink, "_blank", "noopener,noreferrer");
      } catch {
        // Popup blocked or sandboxed — fallback link still works.
      }

      // Poll for completion regardless of how the bot was opened.
      // pendingTokenRef lets the visibilitychange handler fire an immediate
      // poll when iOS returns focus after the user switches back from Telegram.
      pendingTokenRef.current = data.token;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        if (++attempts > 60) {
          if (pollRef.current) clearInterval(pollRef.current);
          pendingTokenRef.current = null;
          setTgState("error");
          setTgError("Telegram sign-in timed out. If you already confirmed in Telegram, tap the button again.");
          return;
        }
        try {
          const check = await fetch(`${API_BASE}/api/webapp/auth/telegram/check?token=${data.token}`, { credentials: "include" });
          const result = await check.json();
          if (!check.ok) {
            if (pollRef.current) clearInterval(pollRef.current);
            setTgState("error");
            setTgError(
              typeof result?.error === "string" && result.error
                ? `Telegram sign-in failed: ${result.error}`
                : "Telegram sign-in failed after confirmation. Try again."
            );
            return;
          }
          if (result.authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            try {
              localStorage.setItem("pnptv_last_auth", "telegram");
              if (result.user?.username) {
                localStorage.setItem("pnptv_last_username", result.user.username);
                localStorage.setItem("pnptv_last_telegram_username", result.user.username);
              }
              if (result.user?.photoUrl) {
                localStorage.setItem("pnptv_last_telegram_photo", result.user.photoUrl);
              }
            } catch { /* ignore quota */ }
            const returnTo = new URLSearchParams(window.location.search).get("returnTo");
            window.location.href = sanitizeReturnTo(returnTo) ?? "/";
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch {
      setTgState("error");
      setTgError("Connection error. Try again.");
    }
  };

  const sheet = activeSheet ? sheets[activeSheet] : null;
  const showLastAuth = lastAuth === "pnptv_id" || lastAuth === "telegram";
  const lastAuthLabel = lastAuth === "pnptv_id" ? "Last signed in with PNPtv ID"
    : lastAuth === "telegram" ? "Last signed in with Telegram"
    : null;
  const tgButtonLabel = lastTgUsername ? `Log in as ${lastTgUsername}` : "Continue with Telegram";

  return (
    <div className="app-shell bg-pnp-background">

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="glass-nav border-b border-pnp-border flex items-center justify-end px-4 h-14 flex-shrink-0">
        <LanguageSelector />
      </header>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-4 overflow-y-auto py-4">
        <div className="w-full max-w-xs flex flex-col items-center gap-4">

          {/* Logo */}
          <img src="/logo-login.png" alt="PNPtv!" className="w-56 h-auto" />

          {/* Tagline */}
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-pnp-accent">
            The Queer PNP Community
          </p>

          {/* Performer focus banner — LATAM redirect with ?focus=performer */}
          {performerFocus && (
            <div className="w-full rounded-2xl border border-pnp-accent/30 bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-orange-500/10 p-4 space-y-3 text-left">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎬</span>
                <p className="text-xs font-bold uppercase tracking-widest text-gradient">
                  {performerCountry === "CO" ? "Colombia · Only performers" : "Only performers in your region"}
                </p>
              </div>
              <p className="text-[13px] leading-relaxed text-white font-medium">
                The full PNPtv app isn't available here yet — but you can apply to become a performer.
              </p>
              <Link
                to="/become-a-model"
                className="btn-gradient block w-full text-center py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 active:scale-[0.98] transition-all"
              >
                Become a Performer →
              </Link>
            </div>
          )}

          {/* OIDC error banner */}
          {oidcError && (
            <div className="w-full flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-left">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-red-300 flex-1">
                {oidcError === "access_denied" ? "Access was denied. Please try again." :
                 oidcError === "session_expired" ? "Session expired. Please try again." :
                 "Sign-in failed. Please try again."}
              </p>
              <button onClick={() => setOidcError(null)} className="text-red-400 hover:text-red-300" aria-label="Dismiss error">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Session-expired banner (?reason=session_expired from socket event) */}
          {reasonBanner === "session_expired" && (
            <div className="w-full flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-left">
              <svg className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
              </svg>
              <p className="text-xs text-yellow-300 flex-1">Your session expired. Sign in again to continue.</p>
              <button onClick={() => setReasonBanner(null)} className="text-yellow-400 hover:text-yellow-300" aria-label="Dismiss">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Magic-link verify error banner (?magic_error=...) */}
          {magicError && (
            <div className="w-full flex flex-col gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-left">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-xs text-red-300 flex-1">
                  {magicError === "expired" ? "That sign-in link expired." :
                   magicError === "user_gone" ? "That account no longer exists." :
                   magicError === "invalid" || magicError === "missing" ? "That link is invalid." :
                   "Sign-in failed."}
                </p>
                <button onClick={() => setMagicError(null)} className="text-red-400 hover:text-red-300" aria-label="Dismiss error">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {magicError !== "user_gone" && (
                <button
                  type="button"
                  onClick={() => { setMagicError(null); setMagicState("form"); setMagicSendError(null); }}
                  className="text-xs text-red-300 hover:text-white underline text-left transition-colors ml-6"
                >
                  Send a new sign-in link →
                </button>
              )}
            </div>
          )}

          {/* Last sign-in hint (returning users only) */}
          {showLastAuth && (
            <p className="text-xs text-pnp-textSecondary -mb-2">{lastAuthLabel}</p>
          )}

          {/* PRIMARY: Continue with PNPtv ID — inline passkey ceremony, falls
              back to the magic-link form below on any failure */}
          <button
            onClick={handleOidcLogin}
            disabled={passkeyState === "trying"}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-sm font-bold uppercase tracking-wide text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-80"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)", boxShadow: "0 0 24px rgba(212, 0, 122, 0.35)" }}
          >
            {passkeyState === "trying" ? <Spinner /> : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
              </svg>
            )}
            {passkeyState === "trying" ? "Verifying passkey…" : "Continue with PNPtv ID"}
          </button>

          {/* Magic-link fallback (always — useful when WebAuthn isn't set up
              for the account, or the user is on a device without a passkey) */}
          {magicState === "hidden" && (
            <button
              type="button"
              onClick={() => { setMagicState("form"); setMagicSendError(null); }}
              className="text-xs text-pnp-textSecondary hover:text-white underline transition-colors -mt-2"
            >
              Email me a sign-in link instead
            </button>
          )}

          {(magicState === "form" || magicState === "sending") && passkeyHint && (
            <div
              className="w-full rounded-xl px-3 py-2 text-[11px] text-left -mt-1"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "var(--pnp-text-secondary)",
              }}
            >
              {passkeyHint}
            </div>
          )}

          {(magicState === "form" || magicState === "sending") && (
            <form onSubmit={handleSendMagicLink} className="w-full space-y-2 -mt-1" noValidate>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={magicEmail}
                onChange={(e) => { setMagicEmail(e.target.value); setMagicSendError(null); }}
                placeholder="your@email.com"
                aria-label="Email address"
                aria-invalid={!!magicSendError}
                disabled={magicState === "sending"}
                autoFocus
                className="w-full py-3 px-4 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 transition-all disabled:opacity-60"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: magicSendError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.1)",
                  fontSize: "16px",
                }}
              />
              {magicSendError && (
                <p className="text-xs text-red-400 px-1 text-left">{magicSendError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setMagicState("hidden"); setMagicEmail(""); setMagicSendError(null); setPasskeyHint(null); }}
                  disabled={magicState === "sending"}
                  className="px-4 py-3 rounded-xl text-xs font-semibold text-pnp-textSecondary hover:text-white transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={magicState === "sending" || !magicEmail.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {magicState === "sending" ? <Spinner /> : "Send sign-in link"}
                </button>
              </div>
            </form>
          )}

          {magicState === "sent" && magicSentTo && (
            <div
              className="w-full rounded-xl p-3 text-xs text-left -mt-1"
              style={{
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.3)",
                color: "#86efac",
              }}
            >
              <p className="font-semibold mb-1">Check your email.</p>
              <p className="text-[11px] leading-relaxed" style={{ color: "rgba(134,239,172,0.85)" }}>
                We sent a sign-in link to <strong>{magicSentTo}</strong>. It expires
                in 15 minutes and can only be used once.
              </p>
              <button
                type="button"
                onClick={() => { setMagicState("hidden"); setMagicEmail(""); setMagicSentTo(null); setPasskeyHint(null); }}
                className="text-[11px] underline mt-2 hover:opacity-80"
              >
                Use a different email
              </button>
            </div>
          )}

          {/* OR divider */}
          <div className="w-full flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] text-pnp-textSecondary uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* SECONDARY: Telegram (deep-link, no widget — works with ad blockers) */}
          <div className="w-full flex items-center gap-2">
            <button
              onClick={handleTelegramLogin}
              disabled={tgState === "waiting"}
              className="flex-1 min-w-0 flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
              style={{ background: "#229ED9", boxShadow: "0 0 16px rgba(34, 158, 217, 0.35)" }}
            >
              {tgState === "waiting" ? <Spinner /> : (
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                </svg>
              )}
              <span className="truncate">{tgState === "waiting" ? "Waiting for Telegram…" : tgButtonLabel}</span>
            </button>
            {lastTgPhoto && (
              <img
                src={lastTgPhoto}
                alt={lastTgUsername || "Telegram avatar"}
                className="w-12 h-12 rounded-full border border-white/15 flex-shrink-0 object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                referrerPolicy="no-referrer"
              />
            )}
          </div>

          {tgState === "error" && tgError && (
            <p className="text-xs text-red-400 text-center -mt-2">{tgError}</p>
          )}

          {/* Always-visible deep-link fallback while we wait. Mobile Safari
              and many in-app browsers silently swallow window.open() — a
              tappable link/button is the only reliable path. */}
          {tgState === "waiting" && tgFallbackUrl && (
            <a
              href={tgFallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:brightness-110 active:scale-[0.98]"
              style={{
                background: "rgba(34,158,217,0.18)",
                border: "1px solid rgba(34,158,217,0.50)",
              }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
              <span>Open Telegram to finish sign-in →</span>
            </a>
          )}

          {/* No account → inline registration form */}
          {regState === "hidden" && (
            <p className="text-xs text-pnp-textSecondary">
              No account?{" "}
              <button
                type="button"
                onClick={() => { setRegState("form"); setRegError(null); }}
                className="font-semibold underline text-pnp-accent hover:brightness-125 transition-all"
              >
                Create one
              </button>
            </p>
          )}

          {(regState === "form" || regState === "submitting") && (
            <form onSubmit={handleRegister} className="w-full space-y-2" noValidate>
              <p className="text-xs font-semibold text-white text-center">Create your account</p>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={regEmail}
                onChange={(e) => { setRegEmail(e.target.value); setRegError(null); }}
                placeholder="Email address"
                aria-label="Email address"
                disabled={regState === "submitting"}
                autoFocus
                className="w-full py-3 px-4 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 transition-all disabled:opacity-60"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
              />
              <input
                type="text"
                autoComplete="username"
                value={regUsername}
                onChange={(e) => { setRegUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "")); setRegError(null); }}
                placeholder="Username (letters, numbers, _)"
                aria-label="Username"
                disabled={regState === "submitting"}
                className="w-full py-3 px-4 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 transition-all disabled:opacity-60"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
              />
              <div className="relative">
                <input
                  type={regShowPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={regPassword}
                  onChange={(e) => { setRegPassword(e.target.value); setRegError(null); }}
                  placeholder="Password (min 8 chars)"
                  aria-label="Password"
                  disabled={regState === "submitting"}
                  className="w-full py-3 px-4 pr-10 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 transition-all disabled:opacity-60"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "16px" }}
                />
                <button
                  type="button"
                  onClick={() => setRegShowPassword(!regShowPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                  aria-label={regShowPassword ? "Hide password" : "Show password"}
                >
                  {regShowPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {regError && <p className="text-xs text-red-400 px-1 text-left">{regError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setRegState("hidden"); setRegEmail(""); setRegUsername(""); setRegPassword(""); setRegError(null); }}
                  disabled={regState === "submitting"}
                  className="px-4 py-3 rounded-xl text-xs font-semibold text-pnp-textSecondary hover:text-white transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={regState === "submitting"}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
                >
                  {regState === "submitting" ? <Spinner /> : "Create account"}
                </button>
              </div>
              <p className="text-[10px] text-white/30 text-center">
                By creating an account you agree to our{" "}
                <a href="/terms" className="underline hover:text-white/50">Terms</a>
                {" "}and{" "}
                <a href="/privacy" className="underline hover:text-white/50">Privacy Policy</a>.
              </p>
            </form>
          )}

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
