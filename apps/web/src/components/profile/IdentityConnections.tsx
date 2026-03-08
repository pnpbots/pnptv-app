import React, { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { checkAuthStatus, unlinkX, getXLoginUrl, type AuthMethods } from "@/lib/api";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface IdentityConnectionsProps {
  telegramUsername?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function IdentityConnections({ telegramUsername }: IdentityConnectionsProps) {
  const t = useI18n();
  const p = t.profile;
  const [xLinked, setXLinked] = useState(false);
  const [xHandle, setXHandle] = useState<string | null>(null);
  const [xLoading, setXLoading] = useState(true);
  const [xUnlinking, setXUnlinking] = useState(false);
  const [xUnlinkError, setXUnlinkError] = useState<string | null>(null);
  const [unlinkVersion, setUnlinkVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    checkAuthStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.authenticated && status.user) {
          const methods = status.user.auth_methods as AuthMethods | undefined;
          setXLinked(!!methods?.x);
          setXHandle(status.user.x_handle ?? null);
        } else {
          setXLinked(false);
          setXHandle(null);
        }
        setXLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setXLinked(false);
          setXHandle(null);
          setXLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unlinkVersion]);

  const handleUnlinkX = async () => {
    setXUnlinking(true);
    setXUnlinkError(null);
    try {
      await unlinkX();
      setXLinked(false);
      setXHandle(null);
      setUnlinkVersion((v) => v + 1);
    } catch (err: unknown) {
      setXUnlinkError(err instanceof Error ? err.message : p.failedToUnlinkX);
    } finally {
      setXUnlinking(false);
    }
  };

  return (
    <div className="glass-card-sm p-5 mt-4">
      <h2 className="text-sm font-semibold text-white mb-3 tracking-wide uppercase opacity-60">
        {p.identityConnections}
      </h2>

      {/* Data sovereignty notice */}
      <div className="flex items-start gap-2 mb-4 pl-3 border-l-2 border-pink-500/30">
        <svg className="w-3.5 h-3.5 text-white/40 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <p className="text-xs text-white/50 leading-relaxed">
          Your PNPtv! identity is sovereign. Your data lives on our servers — only content you explicitly share to external platforms (like X) leaves PNPtv!
        </p>
      </div>

      <div className="space-y-3">
        {/* Telegram row — always connected */}
        <div className="flex items-center justify-between py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #2AABEE, #229ED9)" }}
            >
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">{p.telegram}</p>
              {telegramUsername ? (
                <p className="text-xs" style={{ color: "#8E8E93" }}>@{telegramUsername}</p>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{p.connected}</p>
              )}
            </div>
          </div>
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}
          >
            {p.connected}
          </span>
        </div>

        {/* X / Twitter section */}
        <div className="py-2 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255, 255, 255, 0.1)" }}
              aria-hidden="true"
            >
              <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{p.xTwitter}</p>
              {xLoading ? (
                <div className="h-3 w-24 bg-white/10 rounded animate-pulse mt-0.5" />
              ) : xLinked && xHandle ? (
                <p className="text-xs truncate" style={{ color: "#8E8E93" }}>@{xHandle}</p>
              ) : (
                <p className="text-xs" style={{ color: "#8E8E93" }}>{p.notConnected}</p>
              )}
            </div>
            {!xLoading && (
              xLinked ? (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759" }}
                >
                  {p.connected}
                </span>
              ) : (
                <button
                  onClick={() => { window.location.href = getXLoginUrl(); }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 transition-colors hover:opacity-80"
                  style={{ background: "rgba(255, 255, 255, 0.1)", color: "#FFFFFF" }}
                >
                  {p.connect}
                </button>
              )
            )}
          </div>

          {/* Unlink option when connected */}
          {!xLoading && xLinked && (
            <div className="mt-2 flex items-center gap-2 pl-12">
              <button
                onClick={handleUnlinkX}
                disabled={xUnlinking}
                className="text-xs font-medium hover:underline disabled:opacity-50"
                style={{ color: "#FF453A" }}
              >
                {xUnlinking ? p.unlinking : p.unlinkXAccount}
              </button>
              {xUnlinkError && (
                <span className="text-xs text-red-400">{xUnlinkError}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
