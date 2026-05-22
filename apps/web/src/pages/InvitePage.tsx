import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { checkInviteLink, redeemInviteLink, type InviteLinkCheck } from "@/lib/api";

// ── Confetti particle ──────────────────────────────────────────────────────────

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

const CONFETTI_COLORS = [
  "#D4007A", "#FFD700", "#FCD116", "#003087", "#CE1126",
  "#7B61FF", "#00C8FF", "#FF6B6B", "#4ECDC4", "#FFE66D",
];

function useConfetti(active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const spawnedRef = useRef(false);

  useEffect(() => {
    if (!active || spawnedRef.current) return;
    spawnedRef.current = true;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Spawn 160 particles from top
    for (let i = 0; i < 160; i++) {
      particlesRef.current.push({
        id: i,
        x: Math.random() * canvas.width,
        y: -10 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: 6 + Math.random() * 8,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 6,
        opacity: 1,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.rotation += p.rotationSpeed;
        p.opacity -= 0.006;

        if (p.opacity <= 0 || p.y > canvas.height + 20) continue;
        alive.push(p);

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      particlesRef.current = alive;
      if (alive.length > 0) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [active]);

  return canvasRef;
}

// ── Colombia flag gradient strip ───────────────────────────────────────────────

function ColombiaStrip() {
  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden">
      <div className="flex-1" style={{ background: "#FCD116" }} />
      <div className="flex-1" style={{ background: "#003087" }} />
      <div className="flex-1" style={{ background: "#CE1126" }} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Phase = "loading" | "invalid" | "ready" | "redeeming" | "success" | "error";

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user, isLoading: authLoading, refreshUser } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [linkInfo, setLinkInfo] = useState<InviteLinkCheck | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const confettiRef = useConfetti(phase === "success");

  // Validate code on mount
  useEffect(() => {
    if (!code) {
      setPhase("invalid");
      return;
    }
    let cancelled = false;
    checkInviteLink(code)
      .then((info) => {
        if (cancelled) return;
        setLinkInfo(info);
        setPhase(info.valid ? "ready" : "invalid");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("invalid");
      });
    return () => { cancelled = true; };
  }, [code]);

  const handleActivate = async () => {
    if (!isAuthenticated) {
      // Redirect to login, return here after
      navigate(`/login?returnTo=/invite/${code}`);
      return;
    }

    setPhase("redeeming");
    try {
      const result = await redeemInviteLink(code!);
      if (result.success) {
        // Refresh user session so colombiaBadge is reflected immediately
        try { await refreshUser(); } catch (_) { /* non-fatal */ }
        setPhase("success");
      } else {
        setErrorMsg(result.error || "No se pudo activar el acceso. Intenta de nuevo.");
        setPhase("error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error inesperado.";
      setErrorMsg(msg);
      setPhase("error");
    }
  };

  // While auth is loading, keep showing loading
  if (authLoading && phase === "loading") {
    return <Shell><LoadingState /></Shell>;
  }

  return (
    <Shell confettiRef={confettiRef}>
      {phase === "loading" && <LoadingState />}
      {phase === "invalid" && <InvalidState />}
      {(phase === "ready" || phase === "redeeming") && (
        <ReadyState
          linkInfo={linkInfo}
          isAuthenticated={isAuthenticated}
          userName={user?.firstName || user?.username || null}
          onActivate={handleActivate}
          loading={phase === "redeeming"}
        />
      )}
      {phase === "success" && <SuccessState />}
      {phase === "error" && <ErrorState message={errorMsg} onRetry={() => setPhase("ready")} />}
    </Shell>
  );
}

// ── Shell wrapper ──────────────────────────────────────────────────────────────

function Shell({ children, confettiRef }: { children: React.ReactNode; confettiRef?: React.RefObject<HTMLCanvasElement> }) {
  return (
    <div
      className="relative min-h-dvh flex flex-col items-center justify-center px-5 py-12"
      style={{ background: "linear-gradient(160deg, #0A0A0F 0%, #12081A 50%, #0A0A0F 100%)" }}
    >
      {/* Subtle pride gradient glow at top */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{
          background:
            "linear-gradient(90deg, #E40303,#FF8C00,#FFED00,#008026,#004DFF,#750787)",
        }}
      />
      {/* Colombia accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1 h-32 opacity-20"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(252,209,22,0.6) 0%, transparent 70%)",
        }}
      />
      {/* Confetti canvas — overlays content, pointer-events none */}
      {confettiRef && (
        <canvas
          ref={confettiRef}
          className="pointer-events-none fixed inset-0 z-50"
          aria-hidden
        />
      )}
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6">
        {/* Logo wordmark */}
        <div className="flex flex-col items-center gap-1">
          <span
            className="text-2xl font-black tracking-tight"
            style={{ color: "#D4007A" }}
          >
            PNPtv
          </span>
          <ColombiaStrip />
        </div>
        {children}
      </div>
    </div>
  );
}

// ── State: loading ─────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div
        className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "rgba(212,0,122,0.3)", borderTopColor: "#D4007A" }}
      />
      <p className="text-white/50 text-sm">Verificando enlace…</p>
    </div>
  );
}

// ── State: invalid ─────────────────────────────────────────────────────────────

function InvalidState() {
  return (
    <div
      className="w-full rounded-2xl p-6 flex flex-col items-center gap-4 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <span className="text-4xl" aria-hidden>🔗</span>
      <h1 className="text-lg font-bold text-white/90">Enlace no válido</h1>
      <p className="text-sm text-white/50 leading-relaxed">
        Este enlace de invitación ya no es válido — puede haber expirado, alcanzado su límite de usos, o no existir.
      </p>
      <a
        href="/"
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold rounded-xl px-5 py-2.5"
        style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}
      >
        Ir a PNPtv
      </a>
    </div>
  );
}

// ── State: ready / CTA ────────────────────────────────────────────────────────

interface ReadyStateProps {
  linkInfo: InviteLinkCheck | null;
  isAuthenticated: boolean;
  userName: string | null;
  onActivate: () => void;
  loading: boolean;
}

function ReadyState({ linkInfo, isAuthenticated, userName, onActivate, loading }: ReadyStateProps) {
  return (
    <div
      className="w-full rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.10)" }}
    >
      {/* Hero band — Colombia + Pride flags blended */}
      <div
        className="px-6 pt-8 pb-6 flex flex-col items-center gap-3 text-center"
        style={{
          background:
            "linear-gradient(160deg, rgba(252,209,22,0.12) 0%, rgba(0,48,135,0.12) 50%, rgba(206,17,38,0.12) 100%)",
        }}
      >
        <span className="text-5xl leading-none" aria-hidden>🇨🇴</span>
        <h1 className="text-xl font-black text-white leading-tight">
          Bienvenido a la familia PNPtv Colombia
        </h1>
        <p className="text-sm text-white/70 leading-relaxed max-w-xs">
          Acceso de por vida como <strong className="text-white/90">Socio Colombia</strong> — sin costo.
          Disfruta de todo PNPtv con tu badge exclusivo.
        </p>
        <ColombiaStrip />
      </div>

      {/* Perks list */}
      <div
        className="px-6 py-5 flex flex-col gap-3"
        style={{ background: "rgba(255,255,255,0.03)" }}
      >
        {[
          ["🎉", "Membresía de por vida", "Sin pagos, sin renovaciones."],
          ["🇨🇴", "Badge Socio Colombia", "Visible en tu perfil para toda la comunidad."],
          ["💬", "Hangouts & Chat", "Acceso a todos los grupos y salas de chat."],
          ["🎶", "Contenido exclusivo", "Radio, VOD, feeds y más."],
        ].map(([emoji, title, desc]) => (
          <div key={title} className="flex items-start gap-3">
            <span className="text-xl leading-none mt-0.5" aria-hidden>{emoji}</span>
            <div>
              <p className="text-sm font-semibold text-white/90">{title}</p>
              <p className="text-xs text-white/50">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="px-6 pb-6 pt-2 flex flex-col gap-3">
        {isAuthenticated && userName && (
          <p className="text-xs text-white/40 text-center">
            Activando para <span className="text-white/70 font-medium">{userName}</span>
          </p>
        )}
        <button
          type="button"
          onClick={onActivate}
          disabled={loading}
          className="w-full min-h-[50px] rounded-xl font-bold text-white text-base transition-opacity disabled:opacity-60"
          style={{
            background: loading
              ? "rgba(212,0,122,0.5)"
              : "linear-gradient(135deg, #D4007A 0%, #9B00B0 100%)",
          }}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span
                className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin inline-block"
                style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }}
              />
              Activando…
            </span>
          ) : isAuthenticated ? (
            "Activar mi acceso"
          ) : (
            "Iniciar sesión para activar"
          )}
        </button>
        {!isAuthenticated && (
          <p className="text-xs text-white/40 text-center">
            Te llevaremos a iniciar sesión y de vuelta aquí automáticamente.
          </p>
        )}
        {linkInfo?.maxUses !== null && linkInfo?.maxUses !== undefined && (
          <p className="text-xs text-white/30 text-center">
            {linkInfo.useCount} / {linkInfo.maxUses} usos
          </p>
        )}
      </div>
    </div>
  );
}

// ── State: success ────────────────────────────────────────────────────────────

function SuccessState() {
  return (
    <div
      className="w-full rounded-2xl p-6 flex flex-col items-center gap-5 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex flex-col items-center gap-2">
        <span className="text-5xl leading-none" aria-hidden>✅</span>
        <h1 className="text-xl font-black text-white">
          ¡Ya eres Socio Colombia!
        </h1>
        <p className="text-sm text-white/60 leading-relaxed">
          Tu badge aparece en tu perfil. Bienvenido a la familia PNPtv.
        </p>
      </div>
      <ColombiaBadgePill />
      <ColombiaStrip />
      <a
        href="/"
        className="w-full min-h-[48px] inline-flex items-center justify-center rounded-xl font-bold text-white text-base"
        style={{ background: "linear-gradient(135deg,#D4007A 0%,#9B00B0 100%)" }}
      >
        Entrar a PNPtv
      </a>
    </div>
  );
}

// ── State: error ──────────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="w-full rounded-2xl p-6 flex flex-col items-center gap-4 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <span className="text-4xl" aria-hidden>⚠️</span>
      <h1 className="text-lg font-bold text-white/90">Algo salió mal</h1>
      <p className="text-sm text-white/50 leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-xl px-5 py-2.5"
        style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}
      >
        Intentar de nuevo
      </button>
    </div>
  );
}

// ── Colombia badge pill (reusable) ────────────────────────────────────────────

export function ColombiaBadgePill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(252,209,22,0.20) 0%, rgba(206,17,38,0.15) 100%)",
        color: "#FFD700",
        border: "1px solid rgba(252,209,22,0.35)",
      }}
    >
      <span aria-hidden>🇨🇴</span>
      Socio Colombia
    </span>
  );
}
