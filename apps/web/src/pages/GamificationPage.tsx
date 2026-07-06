import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getGamificationCategories, getUserGamificationBadges, type GamificationCategory, type UserBadgeEntry } from "@/lib/api";

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="animate-spin" style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const FOUNDER_COLOR = "#FFB454";

const CATEGORY_STYLES: Record<string, { color: string; bg: string; border: string; gradient: string }> = {
  founder:    { color: "#FFB454", bg: "rgba(255,180,84,0.10)", border: "rgba(255,180,84,0.30)", gradient: "linear-gradient(135deg, rgba(255,180,84,0.20), rgba(255,153,51,0.10))" },
  wellness:   { color: "#34C759", bg: "rgba(52,199,89,0.10)",  border: "rgba(52,199,89,0.30)",  gradient: "linear-gradient(135deg, rgba(52,199,89,0.15), rgba(52,199,89,0.05))" },
  engagement: { color: "#007AFF", bg: "rgba(0,122,255,0.10)",  border: "rgba(0,122,255,0.30)",  gradient: "linear-gradient(135deg, rgba(0,122,255,0.15), rgba(0,122,255,0.05))" },
};

function getStyle(slug: string) {
  return CATEGORY_STYLES[slug] ?? { color: "#cfcfd4", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.12)", gradient: "rgba(255,255,255,0.03)" };
}

interface BadgeCardProps {
  badge: GamificationCategory["badges"][number];
  userBadge: UserBadgeEntry | undefined;
  categorySlug: string;
  lang: string;
}

function BadgeCard({ badge, userBadge, categorySlug, lang }: BadgeCardProps) {
  const earned = !!userBadge;
  const es = lang.startsWith("es");
  const style = getStyle(categorySlug);
  const name = es ? badge.name_es : badge.name_en;
  const desc = es ? badge.description_es : badge.description_en;

  return (
    <div
      className="rounded-2xl p-4 flex flex-col items-center text-center gap-2 border transition-all"
      style={{
        background: earned ? style.gradient : "rgba(255,255,255,0.02)",
        border: `1px solid ${earned ? style.border : "rgba(255,255,255,0.07)"}`,
        opacity: earned ? 1 : 0.45,
        boxShadow: earned && categorySlug === "founder" ? "0 0 20px rgba(255,180,84,0.12)" : "none",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Glow for founder badge */}
      {earned && categorySlug === "founder" && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 0%, rgba(255,180,84,0.15), transparent 70%)", pointerEvents: "none" }} />
      )}

      <span className="text-4xl leading-none" role="img" aria-hidden="true">{badge.icon}</span>
      <p className="text-sm font-bold" style={{ color: earned ? style.color : "rgba(255,255,255,0.5)" }}>{name}</p>
      {desc && (
        <p className="text-xs leading-relaxed" style={{ color: "rgba(207,207,212,0.55)" }}>{desc}</p>
      )}
      {earned && userBadge.awarded_at && (
        <p className="text-[10px] mt-1" style={{ color: "rgba(207,207,212,0.40)" }}>
          {es ? "Obtenida" : "Earned"} {new Date(userBadge.awarded_at).toLocaleDateString(es ? "es" : "en", { year: "numeric", month: "short", day: "numeric" })}
        </p>
      )}
      {!earned && (
        <span className="inline-flex items-center gap-1 text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          {es ? "Bloqueada" : "Locked"}
        </span>
      )}
    </div>
  );
}

export default function GamificationPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { lang } = useI18n();
  const es = lang.startsWith("es");

  const [categories, setCategories] = useState<GamificationCategory[]>([]);
  const [userBadges, setUserBadges] = useState<UserBadgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/login?returnTo=/badges", { replace: true }); return; }

    let cancelled = false;
    setLoading(true);
    Promise.all([
      getGamificationCategories(),
      getUserGamificationBadges(user.id),
    ])
      .then(([catRes, badgeRes]) => {
        if (cancelled) return;
        // Sort: founder first
        const sorted = [...(catRes.categories || [])].sort((a, b) => {
          if (a.slug === "founder") return -1;
          if (b.slug === "founder") return 1;
          return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        });
        setCategories(sorted);
        setUserBadges(badgeRes.badges || []);
      })
      .catch((err) => {
        if (!cancelled) setError(es ? "No se pudieron cargar las insignias." : "Failed to load badges.");
        console.error(err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading, user, navigate, es]);

  const earnedCount = userBadges.length;
  const totalBadges = categories.reduce((sum, c) => sum + c.badges.length, 0);

  const userBadgeMap = Object.fromEntries(userBadges.map(b => [b.slug, b]));

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <p className="text-sm mb-4" style={{ color: "rgba(207,207,212,0.6)" }}>{error}</p>
        <button onClick={() => window.location.reload()} className="text-sm font-semibold" style={{ color: "var(--pnp-accent)" }}>
          {es ? "Reintentar" : "Try Again"}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm mb-4 hover:text-white transition-colors" style={{ color: "var(--pnp-text-secondary)" }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {es ? "Volver" : "Back"}
        </button>
        <h1 className="text-2xl font-bold text-white mb-1">{es ? "Mis Insignias" : "My Badges"}</h1>
        <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>
          {earnedCount > 0
            ? (es ? `${earnedCount} de ${totalBadges} obtenidas` : `${earnedCount} of ${totalBadges} earned`)
            : (es ? `0 de ${totalBadges} obtenidas — ¡sigue participando!` : `0 of ${totalBadges} earned — keep engaging!`)}
        </p>
      </div>

      {/* Founder hero card (if earned) */}
      {userBadgeMap["founder"] && (
        <div
          className="rounded-2xl p-6 mb-6 text-center relative overflow-hidden border"
          style={{
            background: "linear-gradient(135deg, rgba(255,180,84,0.15), rgba(255,153,51,0.08))",
            border: "1px solid rgba(255,180,84,0.40)",
            boxShadow: "0 0 40px rgba(255,180,84,0.15)",
          }}
        >
          <div aria-hidden="true" style={{ position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)", width: "200%", height: "200%", background: "radial-gradient(circle, rgba(255,180,84,0.12) 0%, transparent 60%)", pointerEvents: "none" }} />
          <span className="text-6xl leading-none block mb-3" role="img">🏅</span>
          <p className="text-lg font-extrabold mb-1" style={{ color: FOUNDER_COLOR }}>
            {es ? "Miembro Fundador" : "Founding Member"}
          </p>
          <p className="text-sm" style={{ color: "rgba(207,207,212,0.65)" }}>
            {es ? "Uno de los primeros en apostar por PNPtv. Tú lo hiciste posible." : "One of the first to invest in PNPtv. You made this possible."}
          </p>
          <p className="text-[11px] mt-3" style={{ color: "rgba(255,180,84,0.55)" }}>
            {es ? "Obtenida" : "Earned"} {new Date(userBadgeMap["founder"].awarded_at).toLocaleDateString(es ? "es" : "en", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
      )}

      {/* Category sections */}
      {categories.map((cat) => {
        const style = getStyle(cat.slug);
        const catName = es ? cat.name_es : cat.name_en;
        const earnedInCat = cat.badges.filter(b => userBadgeMap[b.slug]).length;
        if (cat.slug === "founder" && cat.badges.length === 1) return null; // already shown as hero
        return (
          <div key={cat.slug} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl" aria-hidden="true">{cat.icon}</span>
              <h2 className="text-base font-bold text-white">{catName}</h2>
              <span className="text-xs ml-auto" style={{ color: "rgba(207,207,212,0.45)" }}>
                {earnedInCat}/{cat.badges.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {cat.badges.map((badge) => (
                <BadgeCard
                  key={badge.slug}
                  badge={badge}
                  userBadge={userBadgeMap[badge.slug]}
                  categorySlug={cat.slug}
                  lang={lang}
                />
              ))}
            </div>
          </div>
        );
      })}

      {categories.length === 0 && (
        <p className="text-center text-sm py-12" style={{ color: "var(--pnp-text-secondary)" }}>
          {es ? "No hay insignias disponibles todavía." : "No badges available yet."}
        </p>
      )}

      {/* Link to profile */}
      <div className="mt-4 text-center">
        <Link to="/profile" className="text-sm font-semibold" style={{ color: "var(--pnp-accent)" }}>
          {es ? "Ver mi perfil →" : "View my profile →"}
        </Link>
      </div>
    </div>
  );
}
