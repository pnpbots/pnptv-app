import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  telegramWidgetAuth,
  recoverAccount,
  telegramGenerateLoginToken,
  telegramCheckLoginToken,
  magicLinkStart,
  passkeyBegin,
  passkeyFinish,
  type TelegramWidgetUser,
} from "@/lib/api";
import { login as oidcLogin, rememberReturnTo, sanitizeReturnTo } from "@/lib/auth";
import { getI18n, getLang } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";

const AUTHENTIK_URL = import.meta.env.VITE_AUTHENTIK_URL || "https://auth.pnptv.app";
const ENROLLMENT_FLOW_URL = `${AUTHENTIK_URL}/if/flow/pnptv-enrollment/`;

// Strip leading '@' if present (BotFather usernames may be stored with it)
function getBotUsername(): string {
  const raw =
    import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "PNPLatinoTV_Bot";
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── ShieldIcon ────────────────────────────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-5 h-5 flex-shrink-0"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M12 1.5a.75.75 0 0 1 .75.75V4.5a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 12 1.5ZM5.636 4.136a.75.75 0 0 1 1.06 0l1.592 1.591a.75.75 0 0 1-1.061 1.06L5.636 5.197a.75.75 0 0 1 0-1.06Zm12.728 0a.75.75 0 0 1 0 1.06l-1.591 1.592a.75.75 0 0 1-1.061-1.061l1.591-1.591a.75.75 0 0 1 1.061 0Zm-6.816 4.496a.75.75 0 0 1 .82.311l5.228 7.917a.75.75 0 0 1-.777 1.148l-2.097-.43 1.045 3.9a.75.75 0 0 1-1.45.388l-1.044-3.899-1.601 1.42a.75.75 0 0 1-1.247-.606l.569-9.47a.75.75 0 0 1 .554-.678ZM3 10.5a.75.75 0 0 1 .75-.75H6a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 10.5Zm14.25 0a.75.75 0 0 1 .75-.75h2.25a.75.75 0 0 1 0 1.5H18a.75.75 0 0 1-.75-.75Zm-8.962 3.712a.75.75 0 0 1 0 1.061l-1.591 1.591a.75.75 0 1 1-1.061-1.06l1.591-1.592a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ── ForgotPasswordPanel ───────────────────────────────────────────────────────
// Click "Forgot password?" → reveals an inline email input → submits to our
// /api/webapp/auth/recover-account endpoint, which resolves the email against
// our DB and triggers Authentik's recovery flow (bypassing the placeholder
// @telegram.pnptv.app emails that broke the direct Authentik flow). Always
// shows a success message regardless of whether the email is on file.

interface ForgotPasswordPanelProps {
  t: ReturnType<typeof getI18n>["login"];
}

function ForgotPasswordPanel({ t }: ForgotPasswordPanelProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !sent) {
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [open, sent]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await recoverAccount(trimmed);
    } catch {
      // Backend always returns 200 to avoid email enumeration. Swallow
      // network errors so the user still sees the neutral success message.
    }
    setSent(true);
    setSending(false);
  }, [email, sending]);

  if (!open) {
    return (
      <p className="text-center text-xs mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="underline text-pnp-accent hover:brightness-125 transition-all"
        >
          {t.forgotPassword}
        </button>
      </p>
    );
  }

  if (sent) {
    return (
      <p className="text-center text-xs mt-3 px-2 leading-snug" style={{ color: "#9ce19c" }}>
        ✓ {t.forgotPasswordSent}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 px-2">
      <p className="text-center text-[11px] leading-snug" style={{ color: "#8E8E93" }}>
        {t.forgotPasswordPrompt}
      </p>
      <input
        ref={inputRef}
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={sending}
        required
        className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-pnp-accent transition-all"
        style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.15)" }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setEmail(""); }}
          disabled={sending}
          className="flex-1 min-h-[40px] rounded-lg text-xs font-semibold transition-all active:scale-[0.97] bg-white/[0.06] border border-white/10 text-white/70 disabled:opacity-50"
        >
          {t.forgotPasswordCancel}
        </button>
        <button
          type="submit"
          disabled={sending || !email.trim()}
          className="flex-1 min-h-[40px] rounded-lg text-xs font-bold text-white transition-all active:scale-[0.97] disabled:opacity-50"
          style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
        >
          {sending ? t.forgotPasswordSending : t.forgotPasswordSubmit}
        </button>
      </div>
    </form>
  );
}

// ── TelegramLoginWidget ────────────────────────────────────────────────────────

interface TelegramWidgetProps {
  onAuth: (user: TelegramWidgetUser) => void;
  onLoadError: () => void;
}

function TelegramLoginWidget({ onAuth, onLoadError }: TelegramWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const onAuthRef = useRef(onAuth);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const botUsername = getBotUsername();

    (window as unknown as Record<string, unknown>)["onTelegramAuth"] = (
      user: TelegramWidgetUser,
    ) => {
      onAuthRef.current(user);
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-auth-url", window.location.pathname + window.location.search);
    script.setAttribute("data-request-access", "write");

    const LOAD_TIMEOUT_MS = 8000;
    const timer = setTimeout(() => {
      onLoadErrorRef.current();
    }, LOAD_TIMEOUT_MS);

    // Even when the script loads, the iframe can be silently dropped by ad
    // blockers, privacy shields, or third-party-cookie blockers. We re-check
    // ~2.5s after onload — if no <iframe> rendered, treat it as blocked.
    let renderCheck: ReturnType<typeof setTimeout> | null = null;
    script.onload = () => {
      clearTimeout(timer);
      renderCheck = setTimeout(() => {
        if (
          containerRef.current &&
          !containerRef.current.querySelector("iframe")
        ) {
          onLoadErrorRef.current();
        }
      }, 2500);
    };
    script.onerror = () => {
      clearTimeout(timer);
      onLoadErrorRef.current();
    };

    scriptRef.current = script;
    containerRef.current?.appendChild(script);

    return () => {
      clearTimeout(timer);
      if (renderCheck) clearTimeout(renderCheck);
      delete (window as unknown as Record<string, unknown>)["onTelegramAuth"];
      if (
        scriptRef.current &&
        containerRef.current?.contains(scriptRef.current)
      ) {
        containerRef.current.removeChild(scriptRef.current);
      }
    };
  }, []);

  return <div ref={containerRef} className="flex justify-center" />;
}

// ── TelegramDeepLinkPanel ─────────────────────────────────────────────────────
// Replaces the static <a> deep-link button. Manages the full poll lifecycle:
// starting → waiting (recursive setTimeout poll) → success / expired / error.

type TgFlowStatus = "idle" | "starting" | "waiting" | "success" | "expired" | "error";

interface TelegramDeepLinkPanelProps {
  t: ReturnType<typeof getI18n>["login"];
  lastMethod: string | null;
  lastUsername: string | null;
  returnTo: string | null;
  onWidgetVerifying: boolean;
  refreshUser: () => Promise<void>;
}

function TelegramDeepLinkPanel({
  t,
  lastMethod,
  lastUsername,
  returnTo,
  onWidgetVerifying,
  refreshUser,
}: TelegramDeepLinkPanelProps) {
  const [tgFlowStatus, setTgFlowStatus] = useState<TgFlowStatus>("idle");
  const [tgError, setTgError] = useState<string | null>(null);

  // Stable refs that survive re-renders without triggering effect re-runs
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number>(0);
  const tokenRef = useRef<string>("");
  const deepLinkRef = useRef<string>("");
  const statusRef = useRef<TgFlowStatus>("idle");

  // Keep statusRef in sync so the poll closure can read current status
  // without capturing a stale closure value.
  useEffect(() => {
    statusRef.current = tgFlowStatus;
  }, [tgFlowStatus]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // PWA standalone mode (esp. iOS) suspends + reloads tabs when the user
  // switches to Telegram. Persist the in-flight token so we can resume
  // polling on remount instead of resetting to idle and forcing the user
  // to start over.
  const PERSIST_KEY = "pnptv_tg_login";
  const clearPersisted = useCallback(() => {
    try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const schedulePoll = useCallback((delayMs: number) => {
    stopPolling();
    pollTimerRef.current = setTimeout(async () => {
      // Guard: only continue if we're still in "waiting"
      if (statusRef.current !== "waiting") return;

      // Guard: deadline check
      if (Date.now() > deadlineRef.current) {
        setTgFlowStatus("expired");
        return;
      }

      try {
        const result = await telegramCheckLoginToken(tokenRef.current);
        if (statusRef.current !== "waiting") return; // status changed during await

        if (result.authenticated && result.user) {
          stopPolling();
          clearPersisted();
          localStorage.setItem("pnptv_last_auth", "telegram");
          if (result.user.username) {
            localStorage.setItem("pnptv_last_username", result.user.username);
          }
          setTgFlowStatus("success");
          // Brief success flash, then redirect
          setTimeout(async () => {
            await refreshUser();
            window.location.href = returnTo || "/";
          }, 500);
        } else {
          // Not yet — check deadline then schedule next poll
          if (Date.now() > deadlineRef.current) {
            clearPersisted();
            setTgFlowStatus("expired");
          } else {
            schedulePoll(2000);
          }
        }
      } catch {
        // Network/transient error — back off and keep trying until deadline
        if (statusRef.current !== "waiting") return;
        if (Date.now() > deadlineRef.current) {
          clearPersisted();
          setTgFlowStatus("expired");
        } else {
          schedulePoll(4000);
        }
      }
    }, delayMs);
  }, [stopPolling, refreshUser, returnTo, clearPersisted]);

  const handleStart = useCallback(async () => {
    if (tgFlowStatus === "starting") return;
    setTgFlowStatus("starting");
    setTgError(null);

    try {
      const result = await telegramGenerateLoginToken();
      if (!result.success || !result.token || !result.deepLink) {
        throw new Error(result.error || t.telegramWidgetError);
      }

      tokenRef.current = result.token;
      deepLinkRef.current = result.deepLink;
      deadlineRef.current = Date.now() + 300_000; // 5 min TTL matches backend

      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({
          token: result.token,
          deadline: deadlineRef.current,
        }));
      } catch { /* ignore quota errors */ }

      // Open Telegram — works regardless of browser extension restrictions
      // because it's a direct user-gesture initiated window.open call.
      window.open(result.deepLink, "_blank", "noopener,noreferrer");

      setTgFlowStatus("waiting");
      schedulePoll(2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t.telegramWidgetError;
      setTgFlowStatus("error");
      setTgError(message);
    }
  }, [tgFlowStatus, t.telegramWidgetError, schedulePoll]);

  const handleCancel = useCallback(() => {
    stopPolling();
    clearPersisted();
    setTgFlowStatus("idle");
    setTgError(null);
  }, [stopPolling, clearPersisted]);

  const handleRetry = useCallback(() => {
    clearPersisted();
    setTgFlowStatus("idle");
    setTgError(null);
  }, [clearPersisted]);

  // Resume an in-flight login if the PWA was reloaded while the user was in
  // Telegram. Reads the persisted token + deadline; if still valid, jumps
  // straight into "waiting" and polls immediately.
  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(PERSIST_KEY); } catch { /* ignore */ }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { token?: string; deadline?: number };
      if (!parsed.token || !parsed.deadline || Date.now() >= parsed.deadline) {
        clearPersisted();
        return;
      }
      tokenRef.current = parsed.token;
      deadlineRef.current = parsed.deadline;
      setTgFlowStatus("waiting");
      schedulePoll(0);
    } catch {
      clearPersisted();
    }
    // Run once on mount; schedulePoll/clearPersisted are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown display derived from deadline ref — recalculated each second
  const [countdown, setCountdown] = useState<string>("");
  useEffect(() => {
    if (tgFlowStatus !== "waiting") {
      setCountdown("");
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, deadlineRef.current - Date.now());
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tgFlowStatus]);

  const botUsername = getBotUsername();
  const isPersonalized = lastMethod === "telegram" && !!lastUsername;

  // ── render: idle ──────────────────────────────────────────────────────────
  if (tgFlowStatus === "idle" && !onWidgetVerifying) {
    return (
      <button
        type="button"
        onClick={handleStart}
        className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.98]"
        style={{
          background: "#229ED9",
          color: "#FFFFFF",
          boxShadow: "0 0 16px rgba(34, 158, 217, 0.35)",
        }}
        aria-label={isPersonalized ? `Continue as @${lastUsername}` : "Continue with Telegram"}
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
        </svg>
        <span>
          {isPersonalized
            ? `Continue as @${lastUsername}`
            : t.telegramInstructions}
        </span>
      </button>
    );
  }

  // ── render: starting ──────────────────────────────────────────────────────
  if (tgFlowStatus === "starting") {
    return (
      <button
        type="button"
        disabled
        className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 opacity-70 cursor-not-allowed"
        style={{ background: "#229ED9", color: "#FFFFFF" }}
      >
        <Spinner className="h-4 w-4" />
        <span>{t.tgDeepLinkOpening}</span>
      </button>
    );
  }

  // ── render: waiting ───────────────────────────────────────────────────────
  if (tgFlowStatus === "waiting") {
    return (
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: "rgba(34,158,217,0.1)", border: "1px solid rgba(34,158,217,0.3)" }}
      >
        <div className="flex items-center gap-3">
          <Spinner className="h-5 w-5 text-[#229ED9] flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-white leading-tight">
              {t.tgDeepLinkConfirm}
              {isPersonalized ? ` as @${lastUsername}` : ""}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "#8E8E93" }}>
              Tap <strong>Start</strong> in the chat with @{botUsername}
            </p>
          </div>
        </div>

        {countdown && (
          <p className="text-center text-[10px]" style={{ color: "#636366" }}>
            Expires in {countdown}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold transition-all active:scale-[0.97] text-white/70 border border-white/10"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            {t.cancel}
          </button>
          <a
            href={deepLinkRef.current}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-h-[36px] rounded-lg text-xs font-semibold flex items-center justify-center transition-all active:scale-[0.97] text-white"
            style={{ background: "#229ED9" }}
          >
            {t.tgDeepLinkOpenAgain}
          </a>
        </div>
      </div>
    );
  }

  // ── render: success ───────────────────────────────────────────────────────
  if (tgFlowStatus === "success") {
    return (
      <div className="flex items-center justify-center gap-3 py-4">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#22c55e" />
          <path
            d="M7.5 12l3 3 6-6"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-sm font-bold" style={{ color: "#22c55e" }}>
          Logged in! Redirecting…
        </span>
      </div>
    );
  }

  // ── render: expired ───────────────────────────────────────────────────────
  if (tgFlowStatus === "expired") {
    return (
      <div className="space-y-2">
        <p className="text-center text-xs text-yellow-400">{t.tgDeepLinkExpired}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ background: "#229ED9", color: "#FFFFFF" }}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
            <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
          </svg>
          <span>{t.telegramWidgetRetry}</span>
        </button>
      </div>
    );
  }

  // ── render: error ─────────────────────────────────────────────────────────
  // (tgFlowStatus === "error")
  return (
    <div className="space-y-2">
      {tgError && (
        <p className="text-center text-xs text-red-400">{tgError}</p>
      )}
      <button
        type="button"
        onClick={handleRetry}
        className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.98]"
        style={{ background: "#229ED9", color: "#FFFFFF" }}
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
        </svg>
        <span>{t.telegramWidgetRetry}</span>
      </button>
    </div>
  );
}

// ── LoginPage ─────────────────────────────────────────────────────────────────

export function LoginPage() {
  const lang = getLang(
    navigator.language?.startsWith("es") ? "es" : undefined,
  );
  const t = getI18n(lang).login;
  const { refreshUser } = useAuth();

  const [lastMethod, setLastMethod] = useState<string | null>(null);
  const [lastUsername, setLastUsername] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    const storedMethod = localStorage.getItem("pnptv_last_auth");
    const storedUser = localStorage.getItem("pnptv_last_username");
    if (storedMethod) setLastMethod(storedMethod);
    if (storedUser) setLastUsername(storedUser);
    const raw = new URLSearchParams(window.location.search).get("returnTo");
    const safe = sanitizeReturnTo(raw);
    if (safe) {
      setReturnTo(safe);
      rememberReturnTo(safe);
    }

  }, []);

  // Handle Telegram widget redirect mode (popup blocked on mobile/some browsers).
  // Telegram delivers auth data either as:
  //   - query params: ?id=...&first_name=...&hash=...  (most common in redirect mode)
  //   - hash fragment: #tgAuthResult=BASE64           (some Telegram versions)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const hash = params.get("hash");
    const auth_date = params.get("auth_date");

    if (id && hash && auth_date) {
      // Query-param redirect mode — strip auth params from URL then submit
      const userData: TelegramWidgetUser = {
        id: Number(id),
        hash,
        auth_date: Number(auth_date),
        first_name: params.get("first_name") ?? "",
        last_name: params.get("last_name") ?? undefined,
        username: params.get("username") ?? undefined,
        photo_url: params.get("photo_url") ?? undefined,
      };
      const clean = new URLSearchParams(window.location.search);
      ["id","hash","auth_date","first_name","last_name","username","photo_url"].forEach(k => clean.delete(k));
      const qs = clean.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
      handleWidgetAuth(userData);
      return;
    }

    // Hash fragment mode: #tgAuthResult=BASE64
    const fragment = window.location.hash;
    if (fragment.startsWith("#tgAuthResult=")) {
      try {
        const decoded = JSON.parse(atob(fragment.slice("#tgAuthResult=".length))) as TelegramWidgetUser;
        if (decoded?.id && decoded?.hash) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          handleWidgetAuth(decoded);
        }
      } catch { /* malformed — ignore */ }
    }
  // handleWidgetAuth is stable after mount; run once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const methodLabel = (method: string | null): string | null => {
    if (!method) return null;
    const map: Record<string, string> = {
      telegram: "Telegram",
      deep_link: "Telegram",
      oidc: "PNPtv ID",
      pnptv_id: "PNPtv ID",
      passkey: "Passkey",
      magic_link: "Email link",
    };
    return map[method] ?? null;
  };

  // Email capture for signup
  const [signupEmail, setSignupEmail] = useState("");
  const [signupEmailError, setSignupEmailError] = useState<string | null>(null);
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const email = signupEmail.trim();
    if (!email) {
      setSignupEmailError(t.emailRequiredForSignup);
      return;
    }
    if (!isValidEmail(email)) {
      setSignupEmailError(t.emailInvalid);
      return;
    }
    setSignupEmailError(null);
    // Persist so Settings / downstream can pick it up, and pre-fill Authentik
    try { localStorage.setItem("pnptv_signup_email", email); } catch { /* ignore */ }
    const url = `${ENROLLMENT_FLOW_URL}?email=${encodeURIComponent(email)}`;
    window.location.href = url;
  };

  const handleCreateAccountNoEmail = () => {
    // Fallback: user clicks CTA without filling email
    window.location.href = ENROLLMENT_FLOW_URL;
  };

  const [oidcLoading, setOidcLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Magic-link state — minimal inline panel (idle → sending → sent / error).
  type MagicStatus = "idle" | "sending" | "sent" | "error";
  const [magicEmail, setMagicEmail] = useState("");
  const [magicStatus, setMagicStatus] = useState<MagicStatus>("idle");
  const [magicError, setMagicError] = useState<string | null>(null);

  // Surface verify failures redirected back from /api/webapp/auth/magic/verify
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("magic_error");
    if (!code) return;
    setMagicStatus("error");
    setMagicError(
      code === "expired" ? "This sign-in link expired. Request a new one below."
      : code === "invalid" ? "Invalid sign-in link."
      : code === "user_gone" ? "Account not found. Please sign up."
      : "Sign-in failed. Try requesting a new link."
    );
    params.delete("magic_error");
    const cleaned = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (cleaned ? `?${cleaned}` : ""));
  }, []);

  const handleMagicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = magicEmail.trim();
    if (!isValidEmail(email)) {
      setMagicStatus("error");
      setMagicError(t.emailInvalid);
      return;
    }
    setMagicStatus("sending");
    setMagicError(null);
    try {
      await magicLinkStart(email);
      setMagicStatus("sent");
      try { localStorage.setItem("pnptv_last_auth", "magic_link"); } catch { /* ignore */ }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not send link. Please try again.";
      setMagicStatus("error");
      setMagicError(message);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!window.PublicKeyCredential) {
      setMagicStatus("error");
      setMagicError("Passkeys aren't supported on this browser.");
      return;
    }
    setPasskeyLoading(true);
    try {
      const begin = await passkeyBegin();
      if (!begin.success || !begin.publicKey || !begin.stateToken) {
        throw new Error(
          begin.error === "passkey_unavailable"
            ? "Passkey sign-in isn't configured yet."
            : "Could not start passkey sign-in."
        );
      }

      const decode = (s: string): ArrayBuffer => {
        const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(
          s.length + (4 - (s.length % 4)) % 4,
          "="
        );
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      };

      const pk = begin.publicKey;
      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: decode(pk.challenge),
        rpId: pk.rpId,
        allowCredentials: pk.allowCredentials?.map((c) => ({
          id: decode(c.id),
          type: "public-key" as const,
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
        userVerification: (pk.userVerification as UserVerificationRequirement) || "preferred",
        timeout: pk.timeout || 60000,
      };

      const cred = (await navigator.credentials.get({
        publicKey,
        mediation: "optional" as CredentialMediationRequirement,
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error("Passkey selection cancelled.");

      const encode = (buf: ArrayBuffer): string => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      };

      const r = cred.response as AuthenticatorAssertionResponse;
      const assertion = {
        id: cred.id,
        rawId: encode(cred.rawId),
        type: cred.type,
        response: {
          authenticatorData: encode(r.authenticatorData),
          clientDataJSON: encode(r.clientDataJSON),
          signature: encode(r.signature),
          userHandle: r.userHandle ? encode(r.userHandle) : null,
        },
        clientExtensionResults: cred.getClientExtensionResults(),
      };

      const finish = await passkeyFinish({ stateToken: begin.stateToken, assertion });
      if (!finish.authenticated) {
        throw new Error(finish.error || "Passkey sign-in failed.");
      }

      try { localStorage.setItem("pnptv_last_auth", "passkey"); } catch { /* ignore */ }
      if (finish.user?.username) {
        try { localStorage.setItem("pnptv_last_username", finish.user.username); } catch { /* ignore */ }
      }
      const rt = new URLSearchParams(window.location.search).get("returnTo");
      window.location.href = rt && /^\/[a-z0-9/_-]*/i.test(rt) ? rt : "/";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Passkey sign-in failed.";
      setPasskeyLoading(false);
      setMagicStatus("error");
      setMagicError(msg);
    }
  };

  type WidgetStatus = "idle" | "verifying" | "error";
  const [widgetStatus, setWidgetStatus] = useState<WidgetStatus>("idle");
  const [widgetBlocked, setWidgetBlocked] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const handleOidcLogin = async () => {
    setOidcLoading(true);
    try {
      localStorage.setItem("pnptv_last_auth", "pnptv_id");
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const loginUrl = "/api/webapp/auth/oidc/login" + (returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : "");
      window.location.href = loginUrl;
    } catch {
      setOidcLoading(false);
    }
  };

  const handleWidgetAuth = useCallback(
    async (userData: TelegramWidgetUser) => {
      setWidgetStatus("verifying");
      setWidgetError(null);
      try {
        const result = await telegramWidgetAuth(userData);
        if (result.success) {
          localStorage.setItem("pnptv_last_auth", "telegram");
          if (result.user?.username)
            localStorage.setItem("pnptv_last_username", result.user.username);
          await refreshUser();
          window.location.href = returnTo || "/";
        } else {
          setWidgetStatus("error");
          setWidgetError(result.error || t.telegramWidgetError);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : t.telegramWidgetError;
        setWidgetStatus("error");
        setWidgetError(message);
      }
    },
    [refreshUser, returnTo, t],
  );

  const handleWidgetLoadError = useCallback(() => {
    setWidgetBlocked(true);
  }, []);

  const label = methodLabel(lastMethod);
  const returningUser = !!label;

  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4 py-8 relative overflow-hidden"
      style={{ background: "var(--pnp-background, #121212)" }}
    >
      {/* Background glows */}
      <div
        className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #D4007A, transparent 70%)" }}
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #E69138, transparent 70%)" }}
      />

      <div className="glass-card neon-glow animate-subtle-glow w-full max-w-md p-6 sm:p-8 relative z-10 animate-fade-in-up">
        {/* Logo + tagline */}
        <div className="text-center mb-5">
          <img
            src="/logo-login.png"
            alt="PNPtv!"
            className="w-48 sm:w-56 h-auto mx-auto"
          />
          <p
            className="text-xs mt-2 font-medium"
            style={{ color: "#E69138" }}
          >
            {t.tagline}
          </p>
        </div>

        {/* Lifetime deal banner */}
        <a
          href="/subscribe?plan=lifetime"
          className="block rounded-xl p-3 mb-4 text-center transition-all hover:brightness-110 active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.15), rgba(230,145,56,0.15))",
            border: "1px solid rgba(230,145,56,0.35)",
          }}
        >
          <div className="flex items-center justify-center gap-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{ background: "#E69138", color: "#121212" }}
            >
              {t.lifetimeDealLabel}
            </span>
          </div>
          <p className="text-sm font-bold text-white mt-1.5">
            {t.lifetimeDealTitle}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "#E69138" }}>
            {t.lifetimeDealSub} <span className="font-semibold">{t.lifetimeDealCta}</span>
          </p>
        </a>

        {/* Feature badges — 3-up */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {t.featureBadges.map((b) => (
            <div
              key={b.title}
              className="rounded-lg px-2 py-2 text-center"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <p className="text-[11px] font-bold text-white leading-tight">{b.title}</p>
              <p className="text-[9px] mt-0.5" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{b.sub}</p>
            </div>
          ))}
        </div>

        {/* ── PRIMARY: Join + email capture ─────────────────────────────── */}
        <form onSubmit={handleCreateAccount} noValidate className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-white mb-2 text-center">
              {t.joinHeadline}
            </h2>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={signupEmail}
              onChange={(e) => { setSignupEmail(e.target.value); setSignupEmailError(null); }}
              placeholder={t.emailPlaceholder}
              aria-label={t.emailPlaceholder}
              aria-invalid={!!signupEmailError}
              aria-describedby={signupEmailError ? "signup-email-error" : undefined}
              className="w-full py-3 px-4 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 transition-all"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: signupEmailError ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.1)",
              }}
            />
            {signupEmailError && (
              <p id="signup-email-error" className="text-xs text-red-400 mt-1 px-1">
                {signupEmailError}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="w-full py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, #D4007A, #E69138)",
              boxShadow: "0 0 24px rgba(212, 0, 122, 0.4)",
            }}
          >
            <span>{t.createMyAccount}</span>
            <span aria-hidden="true">→</span>
          </button>
          <p className="text-center text-[11px]" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {t.freeTakes30s}
          </p>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] text-pnp-textSecondary uppercase tracking-widest">
            {t.orContinueWith}
          </span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Telegram login — stateful deep-link button/panel (primary) +
            official widget below as a secondary option. The widget gets
            silently blocked by Brave Shields / uBlock / Firefox Strict
            Mode for many users; the deep-link flow reaches everyone. */}
        <div>
          {widgetStatus === "verifying" && (
            <div className="flex items-center justify-center gap-3 py-4 text-white text-sm font-medium">
              <Spinner />
              <span>{t.telegramWidgetVerifying}</span>
            </div>
          )}
          {widgetStatus !== "verifying" && (
            <TelegramDeepLinkPanel
              t={t}
              lastMethod={lastMethod}
              lastUsername={lastUsername}
              returnTo={returnTo}
              onWidgetVerifying={false}
              refreshUser={refreshUser}
            />
          )}
          <div className={widgetStatus === "verifying" ? "hidden" : "mt-3"}>
            <TelegramLoginWidget
              onAuth={handleWidgetAuth}
              onLoadError={handleWidgetLoadError}
            />
          </div>
          <p className="text-center text-[11px] mt-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
            {t.recommendedForBot}
          </p>
          {widgetStatus === "error" && widgetError && (
            <p className="text-center text-xs text-red-400 mt-2">{widgetError}</p>
          )}
        </div>

        {/* ── Passkey + Magic-link (passwordless) ─────────────────────────── */}
        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={passkeyLoading}
            className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
            aria-label="Sign in with Passkey"
          >
            {passkeyLoading ? <Spinner className="h-4 w-4" /> : (
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c1.66 0 3-1.34 3-3S13.66 5 12 5s-3 1.34-3 3 1.34 3 3 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 13c-3.5 0-6 2-6 4.5V19h12v-1.5c0-2.5-2.5-4.5-6-4.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 9c0-3.5 3-6 7-6m7 6c0-1.5-.5-3-1.5-4" opacity="0.5" />
              </svg>
            )}
            <span>Sign in with Passkey</span>
          </button>

          {/* Magic-link inline form */}
          {magicStatus === "sent" ? (
            <div
              className="rounded-xl p-3 text-center"
              style={{
                background: "rgba(52,199,89,0.08)",
                border: "1px solid rgba(52,199,89,0.25)",
              }}
            >
              <p className="text-xs font-semibold" style={{ color: "#34C759" }}>
                Check your inbox
              </p>
              <p className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
                We sent a sign-in link to <span className="font-mono">{magicEmail}</span>. It expires in 15 minutes.
              </p>
              <button
                type="button"
                onClick={() => { setMagicStatus("idle"); setMagicError(null); }}
                className="text-[11px] underline mt-2"
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicSubmit} className="flex gap-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={magicEmail}
                onChange={(e) => { setMagicEmail(e.target.value); if (magicStatus === "error") { setMagicStatus("idle"); setMagicError(null); } }}
                disabled={magicStatus === "sending"}
                className="flex-1 py-3 px-4 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 disabled:opacity-60"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: magicStatus === "error" ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.1)",
                }}
                aria-label="Email for magic-link sign-in"
              />
              <button
                type="submit"
                disabled={magicStatus === "sending" || !magicEmail.trim()}
                className="px-4 py-3 rounded-xl font-bold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 whitespace-nowrap"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {magicStatus === "sending" ? <Spinner className="h-4 w-4" /> : (
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )}
                <span>{magicStatus === "sending" ? "Sending" : "Email link"}</span>
              </button>
            </form>
          )}
          {magicError && magicStatus === "error" && (
            <p className="text-[11px] text-red-400 text-center">{magicError}</p>
          )}
        </div>

        {/* ── SECONDARY: already a member? ──────────────────────────────── */}
        <div className="mt-6 pt-5 border-t border-white/10">
          <p className="text-center text-xs text-pnp-textSecondary mb-3">
            {t.alreadyMember}
          </p>
          {returningUser && (
            <p className="text-center text-[11px] mb-2" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
              {t.lastLoginedWith}{" "}
              <span className="font-semibold text-white">{label}</span>
              {lastUsername ? ` (@${lastUsername})` : ""}
            </p>
          )}
          <button
            onClick={handleOidcLogin}
            disabled={oidcLoading}
            className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:bg-white/10 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#FFFFFF",
            }}
          >
            {oidcLoading ? <Spinner className="h-4 w-4" /> : <ShieldIcon />}
            <span>{t.signInWithEmail}</span>
          </button>
          <p className="text-center text-[10px] mt-1.5" style={{ color: "#636366" }}>
            {t.signInSubLabel}
          </p>
          <ForgotPasswordPanel t={t} />
        </div>

        {/* Signup fallback if they click without typing email — edge case kept accessible */}
        <p className="sr-only">
          <button type="button" onClick={handleCreateAccountNoEmail}>
            {t.createAccount}
          </button>
        </p>

        {/* Legal footer */}
        <div className="mt-6 pt-5 border-t border-white/5">
          <p className="text-center text-[10px] text-pnp-textSecondary mb-3">
            {t.legalPrefix}{" "}
            <a href="/terms" className="underline text-pnp-accent">
              {t.legalTerms}
            </a>{" "}
            {t.legalAnd}{" "}
            <a href="/privacy" className="underline text-pnp-accent">
              {t.legalPrivacyPolicy}
            </a>
          </p>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            {["cookies", "safety", "contact"].map((key) => (
              <a
                key={key}
                href={`/${key}`}
                className="text-[10px] text-pnp-textSecondary hover:underline capitalize"
              >
                {key}
              </a>
            ))}
          </div>
          <p className="text-center text-[9px] text-pnp-textSecondary/50 mt-3">
            {t.copyright}
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
