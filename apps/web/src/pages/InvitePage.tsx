import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { checkInviteLink, redeemInviteLink, claimPendingPrime, type InviteLinkCheck } from "@/lib/api";

// ── Confetti ───────────────────────────────────────────────────────────────────

interface Particle {
  id: number; x: number; y: number; vx: number; vy: number;
  color: string; size: number; rotation: number; rotationSpeed: number; opacity: number;
}

const CONFETTI_COLORS = ["#D4007A","#FFD700","#FCD116","#003087","#CE1126","#7B61FF","#00C8FF","#FF6B6B","#4ECDC4","#FFE66D"];

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
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < 160; i++) {
      particlesRef.current.push({
        id: i, x: Math.random() * canvas.width, y: -10 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: 6 + Math.random() * 8, rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 6, opacity: 1,
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.rotation += p.rotationSpeed; p.opacity -= 0.006;
        if (p.opacity <= 0 || p.y > canvas.height + 20) continue;
        alive.push(p);
        ctx.save(); ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x, p.y); ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      particlesRef.current = alive;
      if (alive.length > 0) rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
  }, [active]);

  return canvasRef;
}

// ── Copy ───────────────────────────────────────────────────────────────────────

const COPY = {
  en: {
    colombiaBlockedTitle: "Colombia-only link",
    colombiaBlockedDesc: "This invite link is only valid for users connecting from Colombia. If you're in Colombia, try from mobile data or a different network.",
    primePendingTitle: "You're in! PRIME is waiting.",
    primePendingDesc: "Your membership is active. Complete these steps to unlock your PRIME access:",
    primePendingPhoto: "Add a profile photo",
    primePendingPosts: (n: number) => `Post ${n < 3 ? `${n}/3` : "3+"} times in the feed`,
    primePendingClaim: "Claim my PRIME",
    primePendingChecking: "Checking…",
    primePendingNotYet: "Not yet — complete the steps above first.",
    inviteBy: "Special Invitation from",
    tagline1: "The pig club you were looking for.",
    tagline2: "You finally made it, slut.",
    pitch: "The rawest queer PNP space with zero censorship. Real piggy creators, thirsty members, thick clouds and real chemsex energy.",
    accessPrime: (h: number) => `${h}h FREE PRIME Access`,
    accessPrimeDesc: "Unlock all premium content — no restrictions.",
    accessLifetime: "Lifetime Membership – You're Mine Now",
    accessLifetimeDesc: "No payments. No renewals. Forever yours.",
    perksLabel: "What's included",
    perks: [
      ["📡", "Live Streams", "Creators live 24/7. Chat while they perform."],
      ["🎬", "Videorama VOD", "Exclusive uncensored video library for members."],
      ["🎙️", "PNP Radio", "Curated playlists, podcasts and non-stop sets."],
      ["🎥", "Hangouts & Video Calls", "Group rooms and private calls with creators."],
      ["💬", "Chat & Social Feed", "Walls, posts, DMs. A community that gets your vibe."],
      ["🐷", "Real Piggy Creators", "Support real Latin creators. Subscribe, tip, connect."],
    ],
    quote: "\"Best fucking place for real PNP. I'm never leaving Santino's kennel 🔥\"",
    ctaAuth: (h: number, lifetime: boolean) => lifetime ? "🔓 Activate lifetime access" : `🐷 Activate your PRIME now, pig`,
    ctaGuest: "🚀 Sign in and activate",
    ctaGuestNote: "Create your free account or sign in — we'll bring you right back here.",
    activatingFor: "Activating for",
    activating: "Activating…",
    usesLeft: (used: number, max: number) => `${used} / ${max} uses`,
    successTitle: "You're in the kennel now.",
    successPrime: (h: number) => `Your ${h}h PRIME is live. Go make the most of it.`,
    successLifetime: "Lifetime membership activated. Welcome to the family, pig.",
    successBadge: (h: number, lifetime: boolean) => lifetime ? "Lifetime member" : `PRIME ${h}h activated`,
    enter: "Enter PNPtv! →",
    invalidTitle: "Invalid link",
    invalidDesc: "This invite link is no longer valid — it may have expired, hit its use limit, or simply not exist. Ask whoever shared it to send you a new one.",
    goHome: "Go to PNPtv!",
    errorTitle: "Something went wrong",
    retry: "Try again",
  },
  es: {
    colombiaBlockedTitle: "Enlace solo para Colombia",
    colombiaBlockedDesc: "Este enlace de invitación solo funciona desde Colombia. Si estás en Colombia, prueba desde datos móviles o una red diferente.",
    primePendingTitle: "¡Ya eres miembro! Tu PRIME te espera.",
    primePendingDesc: "Tu membresía está activa. Completa estos pasos para desbloquear tu acceso PRIME:",
    primePendingPhoto: "Agrega una foto de perfil",
    primePendingPosts: (n: number) => `Publica ${n < 3 ? `${n}/3` : "3+"} veces en el feed`,
    primePendingClaim: "Activar mi PRIME",
    primePendingChecking: "Verificando…",
    primePendingNotYet: "Aún no — completa los pasos de arriba primero.",
    inviteBy: "Invitación especial de",
    tagline1: "El club que estabas buscando.",
    tagline2: "Ya llegaste, perra.",
    pitch: "El espacio queer más guarro y sin censura. Creadores piggy reales, miembros sedientos, nubes espesas y pura energía chemsex.",
    accessPrime: (h: number) => `${h}h de acceso PRIME gratis`,
    accessPrimeDesc: "Prueba todo el contenido premium sin restricciones.",
    accessLifetime: "Membresía de por vida – Ya eres mío",
    accessLifetimeDesc: "Sin pagos. Sin renovaciones. Para siempre.",
    perksLabel: "Qué incluye tu acceso",
    perks: [
      ["📡", "Streams en vivo", "Creadores en directo las 24h. Chatea mientras transmiten."],
      ["🎬", "Videorama VOD", "Catálogo exclusivo de videos sin censura para miembros."],
      ["🎙️", "Radio PNP", "Playlists curadas, podcasts y sets non-stop."],
      ["🎥", "Hangouts & Videollamadas", "Salas grupales y llamadas privadas con creadores."],
      ["💬", "Chat & Social", "Muros, posts, DMs. Una comunidad que sí entiende tu vibe."],
      ["🐷", "Creadores reales", "Apoya a creadores latines. Suscríbete, propina, conéctate."],
    ],
    quote: "\"El lugar más cerdo y real. Ya no me voy de la perrera de Santino 🔥\"",
    ctaAuth: (h: number, lifetime: boolean) => lifetime ? "🔓 Activar membresía de por vida" : `🐷 Activa tu PRIME ya, cerdo`,
    ctaGuest: "🚀 Entrar y activar invitación",
    ctaGuestNote: "Crea tu cuenta gratis o inicia sesión — te traemos de vuelta aquí automáticamente.",
    activatingFor: "Activando para",
    activating: "Activando…",
    usesLeft: (used: number, max: number) => `${used} / ${max} usos`,
    successTitle: "¡Ya estás en la perrera.",
    successPrime: (h: number) => `Tu PRIME de ${h}h está activo. Disfrútalo al máximo.`,
    successLifetime: "Membresía de por vida activada. Bienvenido a la familia, cerdo.",
    successBadge: (h: number, lifetime: boolean) => lifetime ? "Miembro de por vida" : `PRIME ${h}h activado`,
    enter: "Entrar a PNPtv! →",
    invalidTitle: "Enlace no válido",
    invalidDesc: "Este enlace de invitación ya no funciona — puede haber expirado, alcanzado su límite de usos, o simplemente no existir. Pídele a quien te lo compartió que te envíe uno nuevo.",
    goHome: "Ir a PNPtv!",
    errorTitle: "Algo salió mal",
    retry: "Intentar de nuevo",
  },
} as const;

type Lang = "en" | "es";

// ── Pride strip ────────────────────────────────────────────────────────────────

function PrideStrip() {
  return (
    <div className="flex h-0.5 w-full rounded-full overflow-hidden">
      {["#E40303","#FF8C00","#FFED00","#008026","#004DFF","#750787"].map((c) => (
        <div key={c} className="flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

// ── Lang toggle ────────────────────────────────────────────────────────────────

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div
      className="flex rounded-full p-0.5 gap-0.5"
      style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)" }}
    >
      {(["en","es"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className="rounded-full px-3 py-1 text-xs font-bold transition-all"
          style={lang === l
            ? { background: "#D4007A", color: "#fff" }
            : { background: "transparent", color: "rgba(255,255,255,0.4)" }
          }
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

type Phase = "loading" | "invalid" | "colombia_blocked" | "ready" | "redeeming" | "success" | "prime_pending" | "error";

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user, isLoading: authLoading, refreshUser } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [linkInfo, setLinkInfo] = useState<InviteLinkCheck | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [pendingPrimeHours, setPendingPrimeHours] = useState(0);
  const [lang, setLang] = useState<Lang>(() =>
    navigator.language.startsWith("es") ? "es" : "en"
  );

  const confettiRef = useConfetti(phase === "success");

  useEffect(() => {
    if (!code) { setPhase("invalid"); return; }
    let cancelled = false;
    checkInviteLink(code)
      .then((info) => {
        if (cancelled) return;
        setLinkInfo(info);
        if (!info.valid) { setPhase("invalid"); return; }
        if (info.colombiaOnly && !info.isFromColombia) { setPhase("colombia_blocked"); return; }
        setPhase("ready");
      })
      .catch(() => { if (!cancelled) setPhase("invalid"); });
    return () => { cancelled = true; };
  }, [code]);

  const handleActivate = async () => {
    if (!isAuthenticated) { navigate(`/login?returnTo=/invite/${code}`); return; }
    setPhase("redeeming");
    try {
      const result = await redeemInviteLink(code!);
      if (result.success) {
        try { await refreshUser(); } catch (_) { /* non-fatal */ }
        if (result.primePending) {
          setPendingPrimeHours(result.pendingPrimeHours ?? 0);
          setPhase("prime_pending");
        } else {
          setPhase("success");
        }
      } else {
        setErrorMsg(result.error || (lang === "es" ? "No se pudo activar. Intenta de nuevo." : "Could not activate. Try again."));
        setPhase("error");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : (lang === "es" ? "Error inesperado." : "Unexpected error."));
      setPhase("error");
    }
  };

  const t = COPY[lang];

  if (authLoading && phase === "loading") return <Shell lang={lang} setLang={setLang}><LoadingSpinner /></Shell>;

  return (
    <Shell lang={lang} setLang={setLang} confettiRef={confettiRef}>
      {phase === "loading"          && <LoadingSpinner />}
      {phase === "invalid"          && <InvalidState t={t} />}
      {phase === "colombia_blocked" && <ColombiaBlockedState t={t} />}
      {(phase === "ready" || phase === "redeeming") && (
        <ReadyState
          t={t}
          linkInfo={linkInfo}
          isAuthenticated={isAuthenticated}
          userName={user?.firstName || user?.username || null}
          onActivate={handleActivate}
          loading={phase === "redeeming"}
        />
      )}
      {phase === "success"      && <SuccessState t={t} linkInfo={linkInfo} />}
      {phase === "prime_pending" && <PrimePendingState t={t} pendingPrimeHours={pendingPrimeHours} lang={lang} />}
      {phase === "error"        && <ErrorState t={t} message={errorMsg} onRetry={() => setPhase("ready")} />}
    </Shell>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────────

function Shell({ children, lang, setLang, confettiRef }: {
  children: React.ReactNode;
  lang: Lang;
  setLang: (l: Lang) => void;
  confettiRef?: React.RefObject<HTMLCanvasElement>;
}) {
  return (
    <div
      className="relative min-h-dvh flex flex-col items-center justify-center px-5 py-12"
      style={{ background: "linear-gradient(160deg, #0A0A0F 0%, #12081A 50%, #0A0A0F 100%)" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ background: "linear-gradient(90deg,#E40303,#FF8C00,#FFED00,#008026,#004DFF,#750787)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1 h-48 opacity-15"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%,rgba(212,0,122,0.7) 0%,transparent 70%)" }} />
      {confettiRef && <canvas ref={confettiRef} className="pointer-events-none fixed inset-0 z-50" aria-hidden />}

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5">
        <div className="flex w-full items-center justify-between">
          <span className="text-xl font-black tracking-tight" style={{ color: "#D4007A" }}>PNPtv!</span>
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <PrideStrip />
        {children}
      </div>
    </div>
  );
}

// ── Loading ────────────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "rgba(212,0,122,0.3)", borderTopColor: "#D4007A" }} />
    </div>
  );
}

// ── Invalid ────────────────────────────────────────────────────────────────────

function InvalidState({ t }: { t: typeof COPY[Lang] }) {
  return (
    <div className="w-full rounded-2xl p-6 flex flex-col items-center gap-4 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <span className="text-4xl" aria-hidden>🔗</span>
      <h1 className="text-lg font-bold text-white/90">{t.invalidTitle}</h1>
      <p className="text-sm text-white/50 leading-relaxed">{t.invalidDesc}</p>
      <a href="/"
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold rounded-xl px-5 py-2.5"
        style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}>
        {t.goHome}
      </a>
    </div>
  );
}

// ── Ready ──────────────────────────────────────────────────────────────────────

function ReadyState({ t, linkInfo, isAuthenticated, userName, onActivate, loading }: {
  t: typeof COPY[Lang];
  linkInfo: InviteLinkCheck | null;
  isAuthenticated: boolean;
  userName: string | null;
  onActivate: () => void;
  loading: boolean;
}) {
  const primeHours = linkInfo?.primeHours || 0;
  const isLifetime = linkInfo?.isLifetime ?? true;

  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.10)" }}>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6 flex flex-col items-center gap-3 text-center"
        style={{ background: "linear-gradient(160deg,rgba(212,0,122,0.14) 0%,rgba(155,0,176,0.10) 50%,rgba(212,0,122,0.06) 100%)" }}>

        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(212,0,122,0.8)" }}>
            {t.inviteBy}
          </span>
          <span className="text-3xl font-black tracking-tight"
            style={{ background: "linear-gradient(135deg,#D4007A,#FFD700)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Santino ✨
          </span>
        </div>

        <h1 className="text-xl font-black text-white leading-tight mt-1">
          {t.tagline1}<br />
          <span style={{ color: "#D4007A" }}>{t.tagline2}</span>
        </h1>

        <p className="text-sm text-white/65 leading-relaxed max-w-xs">{t.pitch}</p>

        <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold"
          style={{ background: "rgba(212,0,122,0.18)", border: "1px solid rgba(212,0,122,0.4)", color: "#FF69B4" }}>
          <span aria-hidden>🎁</span>
          {isLifetime ? t.accessLifetime : t.accessPrime(primeHours)}
        </div>
        <p className="text-xs text-white/40">{isLifetime ? t.accessLifetimeDesc : t.accessPrimeDesc}</p>
      </div>

      {/* Features */}
      <div className="px-5 pt-5 pb-3" style={{ background: "rgba(255,255,255,0.025)" }}>
        <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-3">{t.perksLabel}</p>
        <div className="flex flex-col gap-3">
          {t.perks.map(([emoji, title, desc]) => (
            <div key={title as string} className="flex items-start gap-3">
              <span className="text-xl leading-none mt-0.5 shrink-0" aria-hidden>{emoji}</span>
              <div>
                <p className="text-sm font-semibold text-white/90">{title}</p>
                <p className="text-xs text-white/45 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Social proof */}
      <div className="px-5 py-4" style={{ background: "rgba(255,255,255,0.018)" }}>
        <p className="text-xs text-white/35 text-center italic leading-relaxed">{t.quote}</p>
      </div>

      {/* CTA */}
      <div className="px-5 pb-6 pt-3 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.018)" }}>
        {isAuthenticated && userName && (
          <p className="text-xs text-white/40 text-center">
            {t.activatingFor} <span className="text-white/70 font-medium">{userName}</span>
          </p>
        )}
        <button type="button" onClick={onActivate} disabled={loading}
          className="w-full min-h-[52px] rounded-xl font-bold text-white text-base transition-all disabled:opacity-60"
          style={{
            background: loading ? "rgba(212,0,122,0.5)" : "linear-gradient(135deg,#D4007A 0%,#9B00B0 100%)",
            boxShadow: loading ? "none" : "0 0 24px rgba(212,0,122,0.35)",
          }}>
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin inline-block"
                style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
              {t.activating}
            </span>
          ) : isAuthenticated ? (
            t.ctaAuth(primeHours, isLifetime)
          ) : (
            t.ctaGuest
          )}
        </button>
        {!isAuthenticated && (
          <p className="text-xs text-white/35 text-center">{t.ctaGuestNote}</p>
        )}
        {linkInfo?.maxUses != null && (
          <p className="text-xs text-white/25 text-center">{t.usesLeft(linkInfo.useCount ?? 0, linkInfo.maxUses)}</p>
        )}
      </div>
    </div>
  );
}

// ── Success ────────────────────────────────────────────────────────────────────

function SuccessState({ t, linkInfo }: { t: typeof COPY[Lang]; linkInfo: InviteLinkCheck | null }) {
  const primeHours = linkInfo?.primeHours || 0;
  const isLifetime = linkInfo?.isLifetime ?? true;

  return (
    <div className="w-full rounded-2xl p-6 flex flex-col items-center gap-5 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <span className="text-5xl leading-none" aria-hidden>🎉</span>
      <h1 className="text-xl font-black text-white">{t.successTitle}</h1>
      <p className="text-sm text-white/60 leading-relaxed">
        {isLifetime ? t.successLifetime : t.successPrime(primeHours)}
      </p>
      <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold"
        style={{ background: "rgba(212,0,122,0.18)", border: "1px solid rgba(212,0,122,0.4)", color: "#FF69B4" }}>
        <span aria-hidden>✅</span>
        {t.successBadge(primeHours, isLifetime)}
      </div>
      <PrideStrip />
      <a href="/"
        className="w-full min-h-[50px] inline-flex items-center justify-center rounded-xl font-bold text-white text-base"
        style={{ background: "linear-gradient(135deg,#D4007A 0%,#9B00B0 100%)", boxShadow: "0 0 24px rgba(212,0,122,0.35)" }}>
        {t.enter}
      </a>
    </div>
  );
}

// ── Error ──────────────────────────────────────────────────────────────────────

function ErrorState({ t, message, onRetry }: { t: typeof COPY[Lang]; message: string; onRetry: () => void }) {
  return (
    <div className="w-full rounded-2xl p-6 flex flex-col items-center gap-4 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <span className="text-4xl" aria-hidden>⚠️</span>
      <h1 className="text-lg font-bold text-white/90">{t.errorTitle}</h1>
      <p className="text-sm text-white/50 leading-relaxed">{message}</p>
      <button type="button" onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-xl px-5 py-2.5"
        style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}>
        {t.retry}
      </button>
    </div>
  );
}

// ── Colombia blocked ──────────────────────────────────────────────────────────

function ColombiaBlockedState({ t }: { t: typeof COPY[Lang] }) {
  return (
    <div className="w-full rounded-2xl p-6 flex flex-col items-center gap-4 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <span className="text-4xl" aria-hidden>🇨🇴</span>
      <h1 className="text-lg font-bold text-white/90">{t.colombiaBlockedTitle}</h1>
      <p className="text-sm text-white/50 leading-relaxed">{t.colombiaBlockedDesc}</p>
      <a href="/"
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold rounded-xl px-5 py-2.5"
        style={{ background: "rgba(212,0,122,0.15)", color: "#D4007A", border: "1px solid rgba(212,0,122,0.3)" }}>
        {t.goHome}
      </a>
    </div>
  );
}

// ── Prime pending (Colombia socios requirements gate) ─────────────────────────

function PrimePendingState({ t, pendingPrimeHours, lang }: { t: typeof COPY[Lang]; pendingPrimeHours: number; lang: Lang }) {
  const [checking, setChecking] = useState(false);
  const [reqs, setReqs] = useState<{ hasPhoto: boolean; postCount: number } | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState("");

  useEffect(() => {
    // Load current requirement status on mount
    claimPendingPrime().then((res) => {
      if (res.primeGranted) { setClaimed(true); return; }
      if (res.requirements) setReqs(res.requirements);
    }).catch(() => { /* non-critical */ });
  }, []);

  const handleClaim = async () => {
    setChecking(true);
    setClaimError("");
    try {
      const res = await claimPendingPrime();
      if (res.primeGranted) { setClaimed(true); return; }
      if (res.requirements) setReqs(res.requirements);
      if (!res.met) setClaimError(t.primePendingNotYet);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : (lang === "es" ? "Error inesperado." : "Unexpected error."));
    } finally {
      setChecking(false);
    }
  };

  if (claimed) {
    return (
      <div className="w-full rounded-2xl p-6 flex flex-col items-center gap-5 text-center"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span className="text-5xl leading-none" aria-hidden>🎉</span>
        <h1 className="text-xl font-black text-white">{t.successTitle}</h1>
        <p className="text-sm text-white/60 leading-relaxed">{t.successPrime(pendingPrimeHours)}</p>
        <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold"
          style={{ background: "rgba(212,0,122,0.18)", border: "1px solid rgba(212,0,122,0.4)", color: "#FF69B4" }}>
          <span aria-hidden>✅</span>{t.successBadge(pendingPrimeHours, false)}
        </div>
        <PrideStrip />
        <a href="/"
          className="w-full min-h-[50px] inline-flex items-center justify-center rounded-xl font-bold text-white text-base"
          style={{ background: "linear-gradient(135deg,#D4007A 0%,#9B00B0 100%)", boxShadow: "0 0 24px rgba(212,0,122,0.35)" }}>
          {t.enter}
        </a>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.10)" }}>
      <div className="px-6 pt-8 pb-5 flex flex-col items-center gap-3 text-center"
        style={{ background: "linear-gradient(160deg,rgba(212,0,122,0.14) 0%,rgba(155,0,176,0.10) 50%,rgba(212,0,122,0.06) 100%)" }}>
        <span className="text-5xl leading-none" aria-hidden>🐷</span>
        <h1 className="text-xl font-black text-white">{t.primePendingTitle}</h1>
        <p className="text-sm text-white/55 leading-relaxed max-w-xs">{t.primePendingDesc}</p>
      </div>

      <div className="px-5 py-5 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.025)" }}>
        {/* Photo requirement */}
        <div className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-xl shrink-0" aria-hidden>{reqs ? (reqs.hasPhoto ? "✅" : "❌") : "⏳"}</span>
          <span className="text-sm text-white/80">{t.primePendingPhoto}</span>
        </div>
        {/* Posts requirement */}
        <div className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-xl shrink-0" aria-hidden>{reqs ? ((reqs.postCount ?? 0) >= 3 ? "✅" : "❌") : "⏳"}</span>
          <span className="text-sm text-white/80">{t.primePendingPosts(reqs?.postCount ?? 0)}</span>
        </div>
      </div>

      <div className="px-5 pb-6 pt-3 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.018)" }}>
        {claimError && <p className="text-xs text-center" style={{ color: "#FF6B6B" }}>{claimError}</p>}
        <button type="button" onClick={handleClaim} disabled={checking}
          className="w-full min-h-[52px] rounded-xl font-bold text-white text-base transition-all disabled:opacity-60"
          style={{
            background: checking ? "rgba(212,0,122,0.5)" : "linear-gradient(135deg,#D4007A 0%,#9B00B0 100%)",
            boxShadow: checking ? "none" : "0 0 24px rgba(212,0,122,0.35)",
          }}>
          {checking ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin inline-block"
                style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
              {t.primePendingChecking}
            </span>
          ) : t.primePendingClaim}
        </button>
        <a href="/" className="text-xs text-white/30 text-center hover:text-white/50 transition-colors">
          {t.enter}
        </a>
      </div>
    </div>
  );
}

// ── Colombia badge pill (used externally) ─────────────────────────────────────

export function ColombiaBadgePill({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${className}`}
      style={{
        background: "linear-gradient(135deg,rgba(252,209,22,0.20) 0%,rgba(206,17,38,0.15) 100%)",
        color: "#FFD700", border: "1px solid rgba(252,209,22,0.35)",
      }}>
      <span aria-hidden>🇨🇴</span>Socio Colombia
    </span>
  );
}
