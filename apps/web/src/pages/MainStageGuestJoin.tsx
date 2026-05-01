import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { previewMainStageInvite, redeemMainStageInvite, ApiError } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "loading" | "form" | "joining" | "error";

interface InvitePreview {
  hostName?: string | null;
  expiresAt?: string;
}

interface InviteError {
  code: string;
  message: string;
  messageEs: string;
}

const ERROR_MESSAGES: Record<string, InviteError> = {
  INVITE_NOT_FOUND: {
    code: "INVITE_NOT_FOUND",
    message: "This invite link doesn't exist.",
    messageEs: "Este enlace de invitación no existe.",
  },
  INVITE_REVOKED: {
    code: "INVITE_REVOKED",
    message: "This invite link has been revoked by the host.",
    messageEs: "El anfitrión ha revocado este enlace de invitación.",
  },
  INVITE_EXPIRED: {
    code: "INVITE_EXPIRED",
    message: "This invite link has expired.",
    messageEs: "Este enlace de invitación ha expirado.",
  },
  INVITE_EXHAUSTED: {
    code: "INVITE_EXHAUSTED",
    message: "This invite link has reached its maximum number of uses.",
    messageEs: "Este enlace de invitación ha alcanzado el número máximo de usos.",
  },
  UNKNOWN: {
    code: "UNKNOWN",
    message: "Something went wrong. Please ask for a new invite link.",
    messageEs: "Algo salió mal. Por favor solicita un nuevo enlace de invitación.",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "now";
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  if (days  >= 1) return `${days} day${days > 1 ? "s" : ""}`;
  if (hours >= 1) return `${hours} hour${hours > 1 ? "s" : ""}`;
  return `${mins} minute${mins !== 1 ? "s" : ""}`;
}

const SESSION_KEY = "pnptv:ms:guest";

// ── Component ─────────────────────────────────────────────────────────────────

export default function MainStageGuestJoin() {
  const { code }   = useParams<{ code: string }>();
  const navigate   = useNavigate();

  const [phase,        setPhase]        = useState<Phase>("loading");
  const [preview,      setPreview]      = useState<InvitePreview | null>(null);
  const [displayName,  setDisplayName]  = useState("");
  const [terms,        setTerms]        = useState(false);
  const [errorInfo,    setErrorInfo]    = useState<InviteError | null>(null);
  const [fieldError,   setFieldError]   = useState<string | null>(null);

  // ── Fetch invite preview ──
  useEffect(() => {
    if (!code) {
      setErrorInfo(ERROR_MESSAGES.INVITE_NOT_FOUND);
      setPhase("error");
      return;
    }

    let cancelled = false;
    previewMainStageInvite(code)
      .then((p) => {
        if (cancelled) return;
        if (!p.valid) {
          // Distinguish expired from exhausted / revoked by checking expiresAt.
          const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
          setErrorInfo(expired ? ERROR_MESSAGES.INVITE_EXPIRED : ERROR_MESSAGES.INVITE_REVOKED);
          setPhase("error");
          return;
        }
        setPreview({ hostName: p.hostName, expiresAt: p.expiresAt });
        setPhase("form");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setErrorInfo(ERROR_MESSAGES.INVITE_NOT_FOUND);
        } else {
          setErrorInfo(ERROR_MESSAGES.UNKNOWN);
        }
        setPhase("error");
      });

    return () => { cancelled = true; };
  }, [code]);

  // ── Submit handler ──
  const handleJoin = useCallback(async () => {
    setFieldError(null);

    const name = displayName.trim();
    if (name.length < 2 || name.length > 30) {
      setFieldError("Display name must be 2–30 characters. / El nombre debe tener 2–30 caracteres.");
      return;
    }
    if (!terms) {
      setFieldError("You must accept the terms to continue. / Debes aceptar los términos para continuar.");
      return;
    }

    if (!code) return;

    setPhase("joining");

    try {
      const result = await redeemMainStageInvite(code, name);

      // Store guest credentials in sessionStorage so MainStage can pick them up.
      // sessionStorage is cleared by MainStage immediately after reading.
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          token:       result.token,
          livekitUrl:  result.livekitUrl,
          roomName:    result.roomName,
          displayName: name,
          identity:    result.identity,
        }));
      } catch {
        // sessionStorage full / blocked — proceed anyway (MainStage reads it
        // or falls back to the normal auth flow).
      }

      navigate("/main-stage?guest=1", { replace: true });
    } catch (err) {
      let info = ERROR_MESSAGES.UNKNOWN;
      if (err instanceof ApiError) {
        const mapped = ERROR_MESSAGES[err.code ?? ""] ?? ERROR_MESSAGES.UNKNOWN;
        info = mapped;
      }
      setErrorInfo(info);
      setPhase("error");
    }
  }, [code, displayName, terms, navigate]);

  // ── Render: loading ──
  if (phase === "loading") {
    return (
      <GuestShell>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(212,0,122,0.25)", borderTopColor: "#D4007A" }}
          />
          <p className="text-white/50 text-sm">
            Checking invite… / Verificando invitación…
          </p>
        </div>
      </GuestShell>
    );
  }

  // ── Render: error ──
  if (phase === "error" && errorInfo) {
    return (
      <GuestShell>
        <div className="flex flex-col items-center gap-4 text-center max-w-xs">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,69,58,0.12)", border: "1px solid rgba(255,69,58,0.25)" }}
          >
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-snug">{errorInfo.message}</p>
            <p className="text-white/50 text-xs mt-1 leading-snug">{errorInfo.messageEs}</p>
          </div>
          <a
            href="https://pnptv.app"
            className="text-xs text-pnp-accent underline underline-offset-2"
          >
            Back to PNPtv / Regresar a PNPtv
          </a>
        </div>
      </GuestShell>
    );
  }

  // ── Render: joining spinner ──
  if (phase === "joining") {
    return (
      <GuestShell>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(212,0,122,0.25)", borderTopColor: "#D4007A" }}
          />
          <p className="text-white/50 text-sm">
            Joining Main Stage… / Entrando al Main Stage…
          </p>
        </div>
      </GuestShell>
    );
  }

  // ── Render: form ──
  const expiryLabel = preview?.expiresAt ? `Expires in ${formatExpiry(preview.expiresAt)}` : null;

  return (
    <GuestShell>
      <div className="w-full max-w-sm space-y-5">
        {/* Header */}
        <div className="text-center space-y-2">
          <img src="/logo-login.png" alt="PNPtv!" className="h-8 w-auto object-contain mx-auto brightness-110" />
          <h1 className="text-white font-bold text-xl leading-tight">
            You're invited! / ¡Estás invitado!
          </h1>
          {preview?.hostName && (
            <p className="text-white/60 text-sm">
              <span className="text-pnp-accent font-semibold">{preview.hostName}</span> invited you to join Main Stage
              {" / "}
              <span className="text-pnp-accent font-semibold">{preview.hostName}</span> te invitó al Main Stage
            </p>
          )}
          {expiryLabel && (
            <p className="text-white/35 text-xs">{expiryLabel}</p>
          )}
        </div>

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label htmlFor="guest-name" className="block text-xs font-semibold text-white/70 mb-1.5">
              Display name / Nombre visible
            </label>
            <input
              id="guest-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && terms) handleJoin(); }}
              placeholder="Your name / Tu nombre"
              maxLength={30}
              minLength={2}
              autoFocus
              className="w-full px-4 py-3 rounded-2xl text-sm text-white placeholder-white/30 focus:outline-none transition-colors"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.15)",
              }}
              aria-describedby={fieldError ? "guest-field-error" : undefined}
            />
          </div>

          {fieldError && (
            <p id="guest-field-error" className="text-xs text-pnp-error" role="alert">
              {fieldError}
            </p>
          )}

          {/* Terms */}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-pnp-accent flex-shrink-0"
            />
            <span className="text-xs text-white/60 leading-snug">
              I agree to PNPtv's{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-pnp-accent underline">
                Terms of Service
              </a>{" "}
              and understand this is a live adult platform.
              {" / "}
              Acepto los{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-pnp-accent underline">
                Términos de Servicio
              </a>{" "}
              y entiendo que esta es una plataforma adulta en vivo.
            </span>
          </label>

          <button
            type="button"
            onClick={handleJoin}
            disabled={!terms || displayName.trim().length < 2}
            className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Join Main Stage / Entrar al Main Stage
          </button>
        </div>

        <p className="text-center text-[11px] text-white/30">
          No PNPtv account needed to join as a guest.{" "}
          <a href="/join" className="text-pnp-accent underline">Create one free</a>
          {" / "}
          No necesitas cuenta PNPtv para unirte como invitado.{" "}
          <a href="/join" className="text-pnp-accent underline">Crea una gratis</a>
        </p>
      </div>
    </GuestShell>
  );
}

// ── Shell layout ──────────────────────────────────────────────────────────────

function GuestShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-4 py-8"
      style={{ background: "var(--pnp-background, #0A0A0F)" }}
    >
      {children}
    </div>
  );
}

export { SESSION_KEY as GUEST_SESSION_KEY };
