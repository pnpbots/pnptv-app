import React, { useState, useEffect, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

export function LoginPage() {
  const [showTooltip, setShowTooltip] = useState(false);
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setShowTooltip(true);
    setTimeout(() => setShowTooltip(false), 2000);
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

          {/* Register with X */}
          <div className="relative">
            <button
              onClick={handleXClick}
              className="w-full py-3.5 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:bg-white/10"
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "#FFFFFF",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Register with X
            </button>

            {/* Coming Soon tooltip */}
            {showTooltip && (
              <div
                className="absolute -top-10 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg text-sm font-medium text-white whitespace-nowrap animate-fade-in-up"
                style={{ background: "rgba(30, 30, 30, 0.9)", border: "1px solid rgba(212, 0, 122, 0.4)" }}
              >
                Coming Soon
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <p className="text-center text-xs" style={{ color: "#8E8E93" }}>
            By continuing, you agree to our Terms of Service
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
