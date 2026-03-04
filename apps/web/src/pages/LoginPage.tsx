import React, { useState, useEffect, useRef } from "react";
import { getXLoginUrl, getAtprotoLoginUrl } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

const API = import.meta.env.VITE_API_URL || "https://pnptv.app";

export function LoginPage() {
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const [xRedirecting, setXRedirecting] = useState(false);
  const [showBlueskyForm, setShowBlueskyForm] = useState(false);
  const [bskyHandle, setBskyHandle] = useState("");
  const [bskyError, setBskyError] = useState<string | null>(null);
  const [bskyRedirecting, setBskyRedirecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bskyInputRef = useRef<HTMLInputElement>(null);

  // Email login state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailVal, setEmailVal] = useState("");
  const [passwordVal, setPasswordVal] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [emailLogging, setEmailLogging] = useState(false);
  const [emailLoginError, setEmailLoginError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleTelegramLogin = async () => {
    try {
      setStatus("waiting");

      // 1. Request a login token from the API
      const res = await fetch(`${API_BASE}/api/webapp/auth/telegram/token`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!data.success || !data.token || !data.deepLink) {
        setStatus("error");
        return;
      }

      // 2. Open the Telegram deep link (user authenticates in Telegram)
      window.open(data.deepLink, "_blank");

      // 3. Poll for auth confirmation
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes at 5s intervals
      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("error");
          return;
        }
        try {
          const check = await fetch(
            `${API_BASE}/api/webapp/auth/telegram/check?token=${data.token}`,
            { credentials: "include" }
          );
          const result = await check.json();
          if (result.authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            // Session cookie is now set — reload to let useAuth pick it up
            window.location.reload();
          }
        } catch {
          // Network error, keep polling
        }
      }, 5000);
    } catch {
      setStatus("error");
    }
  };

  const handleXClick = () => {
    setXRedirecting(true);
    window.location.href = getXLoginUrl();
  };

  const handleBlueskySubmit = () => {
    const raw = bskyHandle.trim().replace(/^@/, "");
    if (!raw || raw.length < 3) {
      setBskyError("Enter a valid Bluesky handle, e.g. yourname.bsky.social");
      bskyInputRef.current?.focus();
      return;
    }
    if (!raw.includes(".") || raw.length < 5) {
      setBskyError("Handle must include a domain, e.g. yourname.bsky.social");
      bskyInputRef.current?.focus();
      return;
    }
    setBskyRedirecting(true);
    setBskyError(null);
    window.location.href = getAtprotoLoginUrl(raw);
  };

  const handleEmailLogin = async () => {
    const trimmedEmail = emailVal.trim().toLowerCase();
    if (!trimmedEmail || !passwordVal) {
      setEmailLoginError("Please enter your email and password");
      return;
    }
    setEmailLogging(true);
    setEmailLoginError(null);
    try {
      const res = await fetch(`${API}/api/webapp/auth/email/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password: passwordVal, rememberMe }),
      });
      const data = await res.json();
      if (res.ok && data.authenticated) {
        window.location.reload();
      } else {
        setEmailLoginError(data.error || data.message || "Login failed");
      }
    } catch {
      setEmailLoginError("Connection error. Please try again.");
    } finally {
      setEmailLogging(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "#121212" }}
    >
      {/* Background gradient orbs */}
      <div
        className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #D4007A, transparent 70%)" }}
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #E69138, transparent 70%)" }}
      />

      {/* Glass card */}
      <div
        className="glass-card neon-glow animate-subtle-glow w-full max-w-md p-8 sm:p-10 relative z-10 animate-fade-in-up"
      >
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <img src="/Logo2-50.png" alt="PNPTV" className="h-14 w-auto mx-auto" />
        </div>

        {/* Buttons */}
        <div className="space-y-4">
          {/* Login with Telegram */}
          <button
            onClick={handleTelegramLogin}
            disabled={status === "waiting"}
            className="btn-gradient w-full py-3.5 px-6 rounded-xl text-white font-semibold text-base flex items-center justify-center gap-3 disabled:opacity-60"
          >
            {status === "waiting" ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Waiting for Telegram...
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.492-1.302.48-.428-.013-1.252-.242-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Login with Telegram
              </>
            )}
          </button>

          {status === "waiting" && (
            <p className="text-center text-xs" style={{ color: "#8E8E93" }}>
              Open Telegram and press Start to log in
            </p>
          )}

          {status === "error" && (
            <p className="text-center text-xs text-red-400">
              Login failed. Please try again.
            </p>
          )}

          {/* Login with X */}
          <button
            onClick={handleXClick}
            disabled={xRedirecting}
            className="w-full py-3.5 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:bg-white/10 disabled:opacity-60"
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#FFFFFF",
            }}
          >
            {xRedirecting ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Redirecting to X...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Login with X
              </>
            )}
          </button>

          {/* Login with Bluesky */}
          {!showBlueskyForm ? (
            <button
              onClick={() => {
                setShowBlueskyForm(true);
                setTimeout(() => bskyInputRef.current?.focus(), 100);
              }}
              className="w-full py-3.5 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:bg-white/10"
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#FFFFFF",
              }}
            >
              <svg width="20" height="18" viewBox="0 0 360 320" fill="currentColor">
                <path d="M180 142c-16.3-31.7-60.7-90.8-102-120C38.5-2.9 27.2 1 18.8 1 8.3 1 0 7.8 0 25.4 0 39 6.6 116.7 10.3 132.9 23 187.7 74.3 207 122.7 202c-71 10.5-133.3 41-67.3 147.9 51.7 81.4 103.3 27.8 127.2 0 24-27.9 53.7-87.3 53.7-87.3s29.7 59.4 53.7 87.3c23.9 27.8 75.5 81.4 127.2 0 66-106.9 3.7-137.4-67.3-147.9 48.4 5 99.7-14.3 112.4-69.1 3.7-16.2 10.3-93.9 10.3-107.5C360 7.8 351.7 1 341.2 1c-8.4 0-19.7-3.9-59.2 21C240.7 51.2 196.3 110.3 180 142z" />
              </svg>
              Login with Bluesky
            </button>
          ) : (
            <div
              className="rounded-xl p-4 space-y-3 animate-fade-in-up"
              style={{
                background: "rgba(0, 133, 255, 0.06)",
                border: "1px solid rgba(0, 133, 255, 0.2)",
              }}
            >
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-sm select-none pointer-events-none font-medium"
                    style={{ color: "#8E8E93" }}
                  >
                    @
                  </span>
                  <input
                    ref={bskyInputRef}
                    type="text"
                    inputMode="url"
                    value={bskyHandle}
                    onChange={(e) => {
                      setBskyHandle(e.target.value);
                      setBskyError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleBlueskySubmit();
                    }}
                    placeholder="yourname.bsky.social"
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors"
                    style={{
                      borderColor: bskyError ? "#FF453A" : "rgba(255,255,255,0.15)",
                    }}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    disabled={bskyRedirecting}
                  />
                </div>
                <button
                  onClick={handleBlueskySubmit}
                  disabled={bskyRedirecting || !bskyHandle.trim()}
                  className="px-4 py-2.5 rounded-lg text-white text-sm font-semibold whitespace-nowrap flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, #0085FF, #00BAFF)" }}
                >
                  {bskyRedirecting ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    "Go"
                  )}
                </button>
              </div>
              {bskyError && (
                <p className="text-xs text-red-400">{bskyError}</p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs" style={{ color: "#8E8E93" }}>
                  Enter your Bluesky handle to log in
                </p>
                <button
                  onClick={() => {
                    setShowBlueskyForm(false);
                    setBskyHandle("");
                    setBskyError(null);
                  }}
                  className="text-xs font-medium hover:underline"
                  style={{ color: "#8E8E93" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Email login divider */}
        <div className="flex items-center gap-3 mt-6 mb-4">
          <div className="flex-1 h-px" style={{ background: "rgba(255, 255, 255, 0.08)" }} />
          <span className="text-xs" style={{ color: "#8E8E93" }}>or</span>
          <div className="flex-1 h-px" style={{ background: "rgba(255, 255, 255, 0.08)" }} />
        </div>

        {/* Email login */}
        {!showEmailForm ? (
          <button
            onClick={() => {
              setShowEmailForm(true);
              setTimeout(() => emailInputRef.current?.focus(), 100);
            }}
            className="w-full py-3.5 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:bg-white/10"
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#FFFFFF",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            Login with Email
          </button>
        ) : (
          <div
            className="rounded-xl p-4 space-y-3 animate-fade-in-up"
            style={{
              background: "rgba(212, 0, 122, 0.06)",
              border: "1px solid rgba(212, 0, 122, 0.2)",
            }}
          >
            <input
              ref={emailInputRef}
              type="email"
              value={emailVal}
              onChange={(e) => { setEmailVal(e.target.value); setEmailLoginError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleEmailLogin(); }}
              placeholder="Email address"
              disabled={emailLogging}
              className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
              style={{ borderColor: emailLoginError ? "#FF453A" : "rgba(255,255,255,0.15)" }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <input
              type="password"
              value={passwordVal}
              onChange={(e) => { setPasswordVal(e.target.value); setEmailLoginError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleEmailLogin(); }}
              placeholder="Password"
              disabled={emailLogging}
              className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent text-white outline-none transition-colors placeholder-[#8E8E93]"
              style={{ borderColor: emailLoginError ? "#FF453A" : "rgba(255,255,255,0.15)" }}
            />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-[#D4007A]"
              />
              <span className="text-xs" style={{ color: "#8E8E93" }}>Remember me</span>
            </label>
            {emailLoginError && (
              <p className="text-xs text-red-400">{emailLoginError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleEmailLogin}
                disabled={emailLogging || !emailVal.trim() || !passwordVal}
                className="flex-1 py-2.5 rounded-lg text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                {emailLogging ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  "Log In"
                )}
              </button>
              <button
                onClick={() => {
                  setShowEmailForm(false);
                  setEmailVal("");
                  setPasswordVal("");
                  setEmailLoginError(null);
                }}
                className="px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors"
                style={{ color: "#8E8E93" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <p className="text-center text-xs" style={{ color: "#8E8E93" }}>
            By continuing, you agree to our{" "}
            <a href="https://pnptv.app/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition-colors" style={{ color: "#D4007A" }}>
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="https://pnptv.app/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition-colors" style={{ color: "#D4007A" }}>
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
