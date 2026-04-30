import React, { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import {
  checkAuthStatus,
  recoverAccount,
  linkTelegramAccount,
  unlinkTelegramAccount,
  type TelegramWidgetUser,
} from "@/lib/api";

export interface IdentityConnectionsProps {
  telegramUsername?: string;
}

function getBotUsername(): string {
  const raw =
    (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string) || "PNPLatinoTV_bot";
  return raw.replace(/^@/, "").trim();
}

interface TelegramLinkWidgetProps {
  onAuth: (user: TelegramWidgetUser) => void;
  onLoadError: () => void;
}

function TelegramLinkWidget({ onAuth, onLoadError }: TelegramLinkWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
    (window as unknown as Record<string, unknown>)["onTelegramLinkAuth"] = (
      user: TelegramWidgetUser,
    ) => {
      onAuthRef.current(user);
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "medium");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramLinkAuth(user)");
    script.setAttribute("data-request-access", "write");

    const timer = setTimeout(() => onLoadErrorRef.current(), 8000);
    script.onload = () => clearTimeout(timer);
    script.onerror = () => {
      clearTimeout(timer);
      onLoadErrorRef.current();
    };

    const container = containerRef.current;
    container?.appendChild(script);

    return () => {
      clearTimeout(timer);
      delete (window as unknown as Record<string, unknown>)["onTelegramLinkAuth"];
      if (container && script.parentNode === container) {
        container.removeChild(script);
      }
    };
  }, []);

  return <div ref={containerRef} className="flex justify-center py-2" />;
}

export default function IdentityConnections({ telegramUsername }: IdentityConnectionsProps) {
  const t = useI18n();
  const p = t.profile;
  const [hasLegacyEmail, setHasLegacyEmail] = useState(false);
  const [legacyEmail, setLegacyEmail] = useState<string | null>(null);

  // Telegram link state
  const [telegramLinked, setTelegramLinked] = useState<boolean>(!!telegramUsername);
  const [telegramHandle, setTelegramHandle] = useState<string | null>(telegramUsername || null);
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [showLinkWidget, setShowLinkWidget] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  // Recovery form state
  const [showRecovery, setShowRecovery] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    return checkAuthStatus()
      .then((status) => {
        if (status.authenticated && status.user) {
          const placeholder = status.user.email && /@telegram\.pnptv\.app$/i.test(status.user.email);
          setHasLegacyEmail(!!status.user.email && !placeholder);
          setLegacyEmail(!placeholder && status.user.email ? status.user.email : null);
          const tgId = status.user.telegram_id;
          const linked = !!tgId && Number(tgId) > 0;
          setTelegramLinked(linked);
          setTelegramId(linked ? String(tgId) : null);
          if (status.user.username && status.user.last_login_method === "telegram") {
            setTelegramHandle(status.user.username);
          } else if (telegramUsername) {
            setTelegramHandle(telegramUsername);
          }
        }
      })
      .catch(() => {});
  }, [telegramUsername]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleRecover = async () => {
    if (!emailInput.trim()) return;
    setIsRecovering(true);
    setError(null);
    try {
      const res = await recoverAccount(emailInput);
      if (res.success) {
        setRecoverySent(true);
      } else {
        setError(res.message || "Failed to initiate recovery");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection error");
    } finally {
      setIsRecovering(false);
    }
  };

  const handleTelegramWidgetAuth = async (user: TelegramWidgetUser) => {
    setLinkLoading(true);
    setLinkError(null);
    try {
      const res = await linkTelegramAccount(user);
      if (res.success) {
        setShowLinkWidget(false);
        await refreshStatus();
      } else {
        setLinkError(res.error || "Failed to link Telegram");
      }
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : "Failed to link Telegram");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleUnlink = async () => {
    setLinkLoading(true);
    setLinkError(null);
    try {
      const res = await unlinkTelegramAccount();
      if (res.success) {
        setUnlinkConfirm(false);
        await refreshStatus();
      } else {
        setLinkError(res.error || "Failed to unlink Telegram");
      }
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : "Failed to unlink Telegram");
    } finally {
      setLinkLoading(false);
    }
  };

  return (
    <div className="glass-card-sm p-5 mt-4">
      <h2 className="text-sm font-semibold text-white mb-3 tracking-wide uppercase opacity-60">
        {p.identityConnections}
      </h2>

      {/* Data sovereignty notice */}
      <div className="flex items-start gap-2 mb-4 pl-3 border-l-2 border-pink-500/30">
        <svg className="w-3.5 h-3.5 text-white/40 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <p className="text-xs text-white/50 leading-relaxed">
          Your PNPtv! identity is consolidated. We've moved away from external platforms like X to a secure, private SSO system powered by Authentik.
        </p>
      </div>

      <div className="space-y-3">
        {/* Telegram row */}
        <div className="py-3 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #2AABEE, #229ED9)" }}>
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">Telegram</p>
                {telegramLinked ? (
                  <p className="text-xs truncate" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>
                    {telegramHandle ? `@${telegramHandle}` : telegramId ? `ID: ${telegramId}` : "Connected"}
                  </p>
                ) : (
                  <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>Link your Telegram account</p>
                )}
              </div>
            </div>
            {telegramLinked ? (
              <button
                onClick={() => { setUnlinkConfirm(true); setLinkError(null); }}
                disabled={linkLoading}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                Unlink
              </button>
            ) : (
              <button
                onClick={() => { setShowLinkWidget(true); setLinkError(null); }}
                disabled={linkLoading}
                className="text-xs font-semibold px-3 py-1.5 rounded-full text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ background: "#2AABEE" }}
              >
                Link
              </button>
            )}
          </div>

          {/* Link widget panel */}
          {showLinkWidget && !telegramLinked && (
            <div className="bg-white/5 rounded-xl p-4 mt-3 animate-fade-in-up">
              <p className="text-[11px] text-white/60 mb-3 leading-relaxed">
                Sign in with Telegram below to link this Telegram account to your PNPtv account. If you don't have a username on PNPtv yet, your Telegram @username will be adopted automatically.
              </p>
              {linkLoading ? (
                <p className="text-xs text-white/70">Linking…</p>
              ) : (
                <TelegramLinkWidget
                  onAuth={handleTelegramWidgetAuth}
                  onLoadError={() => setLinkError("Telegram widget failed to load. Check your network or ad-blocker.")}
                />
              )}
              {linkError && <p className="text-[10px] text-red-400 mt-2">{linkError}</p>}
              <button
                onClick={() => { setShowLinkWidget(false); setLinkError(null); }}
                className="text-[10px] text-white/30 mt-3 hover:text-white/60"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Unlink confirm panel */}
          {unlinkConfirm && telegramLinked && (
            <div className="bg-white/5 rounded-xl p-4 mt-3 animate-fade-in-up">
              <p className="text-[11px] text-white/80 mb-3 leading-relaxed">
                Unlink Telegram from this account? You will no longer be able to log in with Telegram. Make sure you have an email + password set first, or you may lose access.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleUnlink}
                  disabled={linkLoading}
                  className="bg-red-500/20 text-red-300 hover:bg-red-500/30 text-xs px-3 py-1.5 rounded-lg font-bold transition-colors disabled:opacity-50"
                >
                  {linkLoading ? "…" : "Unlink"}
                </button>
                <button
                  onClick={() => { setUnlinkConfirm(false); setLinkError(null); }}
                  className="text-xs text-white/50 hover:text-white/80 px-2"
                >
                  Cancel
                </button>
              </div>
              {linkError && <p className="text-[10px] text-red-400 mt-2">{linkError}</p>}
            </div>
          )}
        </div>

        {/* Legacy / Email section */}
        <div className="py-2 border-t border-white/5">
          {!showRecovery ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255, 255, 255, 0.1)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Legacy Account</p>
                  {hasLegacyEmail ? (
                    <p className="text-xs truncate" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>{legacyEmail}</p>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--pnp-text-secondary, #8E8E93)" }}>Link your old X or Email account</p>
                  )}
                </div>
              </div>
              {!hasLegacyEmail && (
                <button onClick={() => setShowRecovery(true)} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
                  Recover
                </button>
              )}
              {hasLegacyEmail && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}>Linked</span>
              )}
            </div>
          ) : (
            <div className="bg-white/5 rounded-xl p-4 animate-fade-in-up">
              <h3 className="text-xs font-bold text-white mb-2">Recover Old Account</h3>
              {recoverySent ? (
                <p className="text-[10px] text-green-400">Recovery link sent! Check your email to set a password, then you can link it here.</p>
              ) : (
                <>
                  <p className="text-[10px] text-white/50 mb-3">Enter the email from your old account to trigger a password reset.</p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="email@example.com"
                      style={{ fontSize: "16px" }}
                      className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-white outline-none focus:border-pink-500"
                    />
                    <button
                      onClick={handleRecover}
                      disabled={isRecovering || !emailInput.includes("@")}
                      className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-bold transition-colors"
                    >
                      {isRecovering ? "..." : "Send"}
                    </button>
                  </div>
                  {error && <p className="text-[10px] text-red-400 mt-2">{error}</p>}
                  <button onClick={() => setShowRecovery(false)} className="text-[10px] text-white/30 mt-3 hover:text-white/60">Cancel</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
