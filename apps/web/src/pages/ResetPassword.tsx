import React, { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";
const RP = {
  en: {
    pwdMin: "Password must be at least 8 characters",
    pwdMismatch: "Passwords don't match",
    failGeneric: "Failed to reset password",
    failConn: "Connection error. Try again.",
    invalidLink: "Invalid reset link. Please request a new one.",
    backToLogin: "Back to login",
    title: "Reset Password",
    subtitle: "Choose a new password for your PNPtv account",
    pwdUpdated: "Password updated!",
    pwdUpdatedBody: "You can now log in with your email and new password.",
    goToLogin: "Go to Login",
    placeholderNew: "New password (min 8 characters)",
    placeholderConfirm: "Confirm password",
    cta: "Set New Password",
    resetting: "Resetting…",
  },
  es: {
    pwdMin: "La contraseña debe tener al menos 8 caracteres",
    pwdMismatch: "Las contraseñas no coinciden",
    failGeneric: "No se pudo restablecer la contraseña",
    failConn: "Error de conexión. Intenta de nuevo.",
    invalidLink: "Enlace de restablecimiento inválido. Solicita uno nuevo.",
    backToLogin: "Volver al login",
    title: "Restablecer contraseña",
    subtitle: "Elige una nueva contraseña para tu cuenta PNPtv",
    pwdUpdated: "¡Contraseña actualizada!",
    pwdUpdatedBody: "Ya puedes iniciar sesión con tu email y la nueva contraseña.",
    goToLogin: "Ir al login",
    placeholderNew: "Nueva contraseña (mín. 8 caracteres)",
    placeholderConfirm: "Confirma la contraseña",
    cta: "Establecer nueva contraseña",
    resetting: "Restableciendo…",
  },
};

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const i18n = useI18n();
  const s = RP[i18n.lang === "es" ? "es" : "en"];
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!password || password.length < 8) {
      setError(s.pwdMin);
      return;
    }
    if (password !== confirm) {
      setError(s.pwdMismatch);
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
        setError(data.error || s.failGeneric);
      }
    } catch {
      setError(s.failConn);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background px-4">
        <div className="glass-card-sm p-6 max-w-sm w-full text-center">
          <p className="text-white text-sm">{s.invalidLink}</p>
          <button onClick={() => navigate("/login")} className="mt-4 text-xs text-pink-400 hover:text-pink-300">
            {s.backToLogin}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-pnp-background px-4">
      <div className="glass-card-sm p-6 max-w-sm w-full space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-bold text-white">{s.title}</h1>
          <p className="text-xs text-white/50 mt-1">{s.subtitle}</p>
        </div>

        {success ? (
          <div className="text-center space-y-3 py-4">
            <svg className="w-12 h-12 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-green-400 font-medium">{s.pwdUpdated}</p>
            <p className="text-xs text-white/50">{s.pwdUpdatedBody}</p>
            <button
              onClick={() => navigate("/login")}
              className="btn-gradient w-full py-2.5 rounded-xl text-sm font-bold text-white mt-2"
            >
              {s.goToLogin}
            </button>
          </div>
        ) : (
          <>
            <input
              type="password"
              placeholder={s.placeholderNew}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ fontSize: "16px" }}
              className="w-full px-3 py-2.5 rounded-xl text-white bg-pnp-surface border border-pnp-border focus:border-pnp-accent focus:outline-none placeholder-pnp-textSecondary/50"
            />
            <input
              type="password"
              placeholder={s.placeholderConfirm}
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
              {loading ? s.resetting : s.cta}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
