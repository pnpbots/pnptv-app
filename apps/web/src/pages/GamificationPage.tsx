import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  getGamificationCategories,
  getUserGamificationBadges,
  getWeeklyLeaderboard,
  type GamificationCategory,
  type UserBadgeEntry,
  type LeaderboardEntry,
  type WeeklyLeaderboardResponse,
} from "@/lib/api";

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
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          {es ? "Bloqueada" : "Locked"}
        </span>
      )}
    </div>
  );
}

// ── Leaderboard components ────────────────────────────────────────────────────

const RANK_STYLES: Record<number, { color: string; bg: string; border: string; label: string }> = {
  1: { color: "#FFD700", bg: "rgba(255,215,0,0.12)",  border: "rgba(255,215,0,0.35)",  label: "1" },
  2: { color: "#C0C0C0", bg: "rgba(192,192,192,0.10)", border: "rgba(192,192,192,0.30)", label: "2" },
  3: { color: "#CD7F32", bg: "rgba(205,127,50,0.12)",  border: "rgba(205,127,50,0.30)",  label: "3" },
};

const RANK_MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function LeaderboardSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)", animation: "pulse 1.5s infinite" }} />
          <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)", animation: "pulse 1.5s infinite" }} />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 rounded" style={{ background: "rgba(255,255,255,0.08)", width: `${40 + (i % 4) * 15}%`, animation: "pulse 1.5s infinite" }} />
          </div>
          <div className="h-3 w-12 rounded" style={{ background: "rgba(255,255,255,0.08)", animation: "pulse 1.5s infinite" }} />
        </div>
      ))}
    </div>
  );
}

function AvatarCircle({ avatar, displayName, size = 32 }: { avatar: string | null; displayName: string; size?: number }) {
  const initials = displayName.slice(0, 1).toUpperCase();
  if (avatar) {
    // avatar may be a relative path like /uploads/avatars/...
    const src = avatar.startsWith("http") ? avatar : avatar;
    return (
      <img
        src={src}
        alt={displayName}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: "linear-gradient(135deg, rgba(var(--pnp-accent-rgb, 139,92,246),0.6), rgba(var(--pnp-accent-rgb, 139,92,246),0.3))",
      }}
    >
      {initials}
    </div>
  );
}

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  es: boolean;
}

function LeaderboardRow({ entry, es }: LeaderboardRowProps) {
  const rankStyle = RANK_STYLES[entry.rank];
  const medal = RANK_MEDALS[entry.rank];
  const isTop3 = entry.rank <= 3;

  return (
    <div
      className="rounded-2xl px-4 py-3 flex items-center gap-3 transition-all"
      style={{
        background: entry.isCurrentUser
          ? "rgba(var(--pnp-accent-rgb, 139,92,246),0.12)"
          : isTop3
          ? rankStyle.bg
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${
          entry.isCurrentUser
            ? "rgba(var(--pnp-accent-rgb, 139,92,246),0.35)"
            : isTop3
            ? rankStyle.border
            : "rgba(255,255,255,0.06)"
        }`,
        boxShadow: entry.rank === 1 ? "0 0 16px rgba(255,215,0,0.08)" : "none",
      }}
    >
      {/* Rank badge */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-extrabold"
        style={{
          background: isTop3 ? rankStyle.bg : "rgba(255,255,255,0.06)",
          border: `1px solid ${isTop3 ? rankStyle.border : "rgba(255,255,255,0.10)"}`,
          color: isTop3 ? rankStyle.color : "rgba(207,207,212,0.5)",
          fontSize: isTop3 ? "1.1rem" : "0.75rem",
        }}
      >
        {medal ?? entry.rank}
      </div>

      {/* Avatar */}
      <AvatarCircle avatar={entry.avatar} displayName={entry.displayName} size={32} />

      {/* Name + prime badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: entry.isCurrentUser ? "var(--pnp-accent, #8b5cf6)" : isTop3 ? rankStyle.color : "rgba(255,255,255,0.90)" }}
          >
            {entry.displayName}
            {entry.isCurrentUser && (
              <span className="ml-1.5 text-[10px] font-normal" style={{ color: "rgba(var(--pnp-accent-rgb, 139,92,246),0.7)" }}>
                ({es ? "tú" : "you"})
              </span>
            )}
          </span>
          {entry.primeAwarded && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: "rgba(255,180,84,0.15)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.30)" }}
            >
              PRIME
            </span>
          )}
        </div>
      </div>

      {/* Points */}
      <div className="text-right flex-shrink-0">
        <span
          className="text-sm font-bold"
          style={{ color: isTop3 ? rankStyle.color : "rgba(207,207,212,0.8)" }}
        >
          {entry.points.toLocaleString()}
        </span>
        <span className="text-[10px] block" style={{ color: "rgba(207,207,212,0.35)" }}>pts</span>
      </div>
    </div>
  );
}

function LeaderboardTab({ es, currentUserId }: { es: boolean; currentUserId: string | undefined }) {
  const [data, setData] = useState<WeeklyLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWeeklyLeaderboard()
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => {
        if (!cancelled) { setError(es ? "No se pudo cargar el ranking." : "Failed to load leaderboard."); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [es]);

  if (loading) return <LeaderboardSkeleton />;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm mb-3" style={{ color: "rgba(207,207,212,0.55)" }}>{error}</p>
        <button onClick={() => window.location.reload()} className="text-sm font-semibold" style={{ color: "var(--pnp-accent)" }}>
          {es ? "Reintentar" : "Try Again"}
        </button>
      </div>
    );
  }

  if (!data || data.leaderboard.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4" aria-hidden="true">🏆</div>
        <p className="text-sm font-medium text-white mb-1">{es ? "Sin actividad esta semana" : "No activity this week yet"}</p>
        <p className="text-xs" style={{ color: "rgba(207,207,212,0.45)" }}>
          {es ? "Participa en el grupo para aparecer aquí." : "Participate in the group to appear here."}
        </p>
      </div>
    );
  }

  const isAllTime = data.period === "alltime";
  const weekLabel = isAllTime
    ? (es ? "Historial Total" : "All Time")
    : (() => {
        const d = new Date(data.weekStart + "T00:00:00Z");
        return d.toLocaleDateString(es ? "es" : "en", { month: "long", day: "numeric" });
      })();

  return (
    <div>
      {/* Period label */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(207,207,212,0.45)" }}>
          {isAllTime ? (es ? "Ranking General" : "Overall Ranking") : (es ? `Semana del ${weekLabel}` : `Week of ${weekLabel}`)}
        </p>
        <span className="text-xs" style={{ color: "rgba(207,207,212,0.35)" }}>
          {es ? `Top ${data.leaderboard.length}` : `Top ${data.leaderboard.length}`}
        </span>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {data.leaderboard.map((entry) => (
          <LeaderboardRow key={entry.userId} entry={entry} es={es} />
        ))}
      </div>

      {/* Current user rank if outside top 20 */}
      {data.currentUserRank && (
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs mb-2" style={{ color: "rgba(207,207,212,0.45)" }}>
            {es ? "Tu posición esta semana" : "Your position this week"}
          </p>
          <div
            className="rounded-2xl px-4 py-3 flex items-center justify-between"
            style={{ background: "rgba(var(--pnp-accent-rgb, 139,92,246),0.10)", border: "1px solid rgba(var(--pnp-accent-rgb, 139,92,246),0.25)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--pnp-accent, #8b5cf6)" }}>
              {es ? `Posición #${data.currentUserRank.rank}` : `Rank #${data.currentUserRank.rank}`}
            </span>
            <span className="text-sm font-bold" style={{ color: "rgba(207,207,212,0.80)" }}>
              {data.currentUserRank.points.toLocaleString()} pts
            </span>
          </div>
        </div>
      )}

      {/* Footer note */}
      <p className="text-[11px] text-center mt-5" style={{ color: "rgba(207,207,212,0.30)" }}>
        {isAllTime
          ? (es ? "Ranking acumulado de toda la actividad." : "Cumulative ranking across all activity.")
          : (es ? "Ranking se reinicia cada lunes." : "Ranking resets every Monday.")}
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "badges" | "leaderboard";

export default function GamificationPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { lang } = useI18n();
  const es = lang.startsWith("es");

  const [activeTab, setActiveTab] = useState<Tab>("badges");
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
        <h1 className="text-2xl font-bold text-white mb-1">
          {activeTab === "badges"
            ? (es ? "Mis Insignias" : "My Badges")
            : (es ? "Ranking Semanal" : "Weekly Leaderboard")}
        </h1>
        {activeTab === "badges" && (
          <p className="text-sm" style={{ color: "var(--pnp-text-secondary)" }}>
            {earnedCount > 0
              ? (es ? `${earnedCount} de ${totalBadges} obtenidas` : `${earnedCount} of ${totalBadges} earned`)
              : (es ? `0 de ${totalBadges} obtenidas — ¡sigue participando!` : `0 of ${totalBadges} earned — keep engaging!`)}
          </p>
        )}
      </div>

      {/* Tab switcher */}
      <div
        className="flex rounded-xl p-1 mb-6"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {(["badges", "leaderboard"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{
              background: activeTab === tab ? "rgba(255,255,255,0.10)" : "transparent",
              color: activeTab === tab ? "white" : "rgba(207,207,212,0.50)",
              border: activeTab === tab ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
            }}
          >
            {tab === "badges"
              ? (es ? "Insignias" : "Badges")
              : (es ? "Ranking" : "Leaderboard")}
          </button>
        ))}
      </div>

      {/* Badges tab */}
      {activeTab === "badges" && (
        <>
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
            if (cat.slug === "founder" && cat.badges.length === 1) return null;
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

          <div className="mt-4 text-center">
            <Link to="/profile" className="text-sm font-semibold" style={{ color: "var(--pnp-accent)" }}>
              {es ? "Ver mi perfil →" : "View my profile →"}
            </Link>
          </div>
        </>
      )}

      {/* Leaderboard tab */}
      {activeTab === "leaderboard" && (
        <LeaderboardTab es={es} currentUserId={user?.id} />
      )}
    </div>
  );
}
