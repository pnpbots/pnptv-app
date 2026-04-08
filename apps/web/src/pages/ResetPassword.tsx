import React, { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/webapp/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setError(data.error || "Failed to reset password");
      }
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background px-4">
        <div className="glass-card-sm p-6 max-w-sm w-full text-center">
          <p className="text-white text-sm">Invalid reset link. Please request a new one.</p>
          <button onClick={() => navigate("/login")} className="mt-4 text-xs text-pink-400 hover:text-pink-300">
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-pnp-background px-4">
      <div className="glass-card-sm p-6 max-w-sm w-full space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-bold text-white">Reset Password</h1>
          <p className="text-xs text-white/50 mt-1">Choose a new password for your PNPtv account</p>
        </div>

        {success ? (
          <div className="text-center space-y-3 py-4">
            <svg className="w-12 h-12 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-green-400 font-medium">Password updated!</p>
            <p className="text-xs text-white/50">You can now log in with your email and new password.</p>
            <button
              onClick={() => navigate("/login")}
              className="btn-gradient w-full py-2.5 rounded-xl text-sm font-bold text-white mt-2"
            >
              Go to Login
            </button>
          </div>
        ) : (
          <>
            <input
              type="password"
              placeholder="New password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ fontSize: "16px" }}
              className="w-full px-3 py-2.5 rounded-xl text-white bg-pnp-surface border border-pnp-border focus:border-pnp-accent focus:outline-none placeholder-pnp-textSecondary/50"
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={{ fontSize: "16px" }}
              className="w-full px-3 py-2.5 rounded-xl text-white bg-pnp-surface border border-pnp-border focus:border-pnp-accent focus:outline-none placeholder-pnp-textSecondary/50"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn-gradient w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            >
              {loading ? "Resetting..." : "Set New Password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
