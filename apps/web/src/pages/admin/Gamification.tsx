import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import {
  getGamificationCategories,
  getGamificationBadgeHolders,
  awardGamificationBadge,
  revokeGamificationBadge,
  awardMeCuidoToAllCreators,
  type GamificationCategory,
  type GamificationBadge,
  type GamificationHolder,
} from "@/lib/api";

// ── Badge icon renderer ───────────────────────────────────────────────────────

function BadgeIcon({ icon, size = "md" }: { icon: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "text-base" : size === "lg" ? "text-3xl" : "text-xl";

  // Map slug-based icon names to emoji fallbacks
  const emojiMap: Record<string, string> = {
    shield: "🛡️",
    "shield-check": "✅",
    "shield-star": "⭐",
    zap: "⚡",
    heart: "❤️",
    star: "⭐",
    trophy: "🏆",
    medal: "🥇",
    crown: "👑",
    fire: "🔥",
    bolt: "⚡",
    check: "✅",
    lock: "🔒",
    gift: "🎁",
    sparkle: "✨",
  };

  const resolved = emojiMap[icon] ?? icon;

  return (
    <span className={sizeClass} role="img" aria-hidden="true">
      {resolved}
    </span>
  );
}

// ── Holders panel ─────────────────────────────────────────────────────────────

function HoldersPanel({
  badgeSlug,
  badgeName,
  onClose,
  onRevoke,
}: {
  badgeSlug: string;
  badgeName: string;
  onClose: () => void;
  onRevoke: (telegramId: string) => Promise<void>;
}) {
  const t = useI18n();
  const g = t.gamification;
  const [holders, setHolders] = useState<GamificationHolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getGamificationBadgeHolders(badgeSlug)
      .then((res) => setHolders(res.holders))
      .catch((err) =>
        setError(err instanceof Error ? err.message : g.errorLoading)
      )
      .finally(() => setLoading(false));
  }, [badgeSlug, g.errorLoading]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = async (telegramId: string) => {
    setRevoking(telegramId);
    try {
      await onRevoke(telegramId);
      setHolders((prev) => prev.filter((h) => h.id !== telegramId));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div
      className="mt-3 rounded-xl p-4 backdrop-blur"
      style={{
        background: "rgba(18,18,18,0.92)",
        border: "1px solid rgba(212,0,122,0.2)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white">
          {g.holders} — {badgeName}
        </span>
        <button
          onClick={onClose}
          className="text-xs transition-colors min-h-[32px] px-2"
          style={{ color: "#8E8E93" }}
          aria-label={t.common.close}
        >
          {t.common.close}
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="text-xs text-red-400 flex items-center gap-2">
          {error}
          <button
            onClick={load}
            className="underline hover:no-underline transition-colors"
          >
            {g.retry}
          </button>
        </div>
      ) : holders.length === 0 ? (
        <p className="text-xs py-3 text-center" style={{ color: "#8E8E93" }}>
          {g.noHolders}
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {holders.map((holder) => (
            <div
              key={holder.id}
              className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">
                  {holder.first_name || holder.username || String(holder.id)}
                  {holder.username && (
                    <span className="ml-1.5 font-normal" style={{ color: "#8E8E93" }}>
                      @{holder.username}
                    </span>
                  )}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
                  {g.awardedAt}:{" "}
                  {new Date(holder.awarded_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleRevoke(holder.id)}
                disabled={revoking === holder.id}
                className="ml-3 flex-shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 min-h-[32px]"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  color: "#EF4444",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
                aria-label={`${g.revokeConfirm} ${holder.first_name || holder.username || holder.id}`}
              >
                {revoking === holder.id ? g.revoking : g.revoke}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Badge row ─────────────────────────────────────────────────────────────────

function BadgeRow({
  badge,
  lang,
  openHoldersSlug,
  onToggleHolders,
  onRevoke,
}: {
  badge: GamificationBadge;
  lang: string;
  openHoldersSlug: string | null;
  onToggleHolders: (slug: string) => void;
  onRevoke: (telegramId: string, badgeSlug: string) => Promise<void>;
}) {
  const t = useI18n();
  const g = t.gamification;
  const isOpen = openHoldersSlug === badge.slug;
  const badgeName = lang === "es" ? badge.name_es : badge.name_en;

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.2)" }}
        >
          <BadgeIcon icon={badge.icon} size="md" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{badgeName}</span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(230,145,56,0.15)", color: "#E69138" }}
            >
              {g.level} {badge.level}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
            {badge.slug}
          </p>
        </div>

        <button
          onClick={() => onToggleHolders(badge.slug)}
          className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-all min-h-[36px]"
          style={
            isOpen
              ? {
                  background: "rgba(212,0,122,0.18)",
                  color: "#D4007A",
                  border: "1px solid rgba(212,0,122,0.3)",
                }
              : {
                  background: "rgba(255,255,255,0.06)",
                  color: "#8E8E93",
                  border: "1px solid rgba(255,255,255,0.1)",
                }
          }
          aria-expanded={isOpen}
          aria-label={isOpen ? g.hideHolders : g.viewHolders}
        >
          {isOpen ? g.hideHolders : g.viewHolders}
        </button>
      </div>

      {isOpen && (
        <HoldersPanel
          badgeSlug={badge.slug}
          badgeName={badgeName}
          onClose={() => onToggleHolders(badge.slug)}
          onRevoke={(telegramId) => onRevoke(telegramId, badge.slug)}
        />
      )}
    </div>
  );
}

// ── Award form ────────────────────────────────────────────────────────────────

interface AwardFormState {
  telegramId: string;
  badgeSlug: string;
  note: string;
  submitting: boolean;
  result: string | null;
  error: string | null;
}

function AwardForm({ allBadges, lang }: { allBadges: GamificationBadge[]; lang: string }) {
  const t = useI18n();
  const g = t.gamification;
  const [form, setForm] = useState<AwardFormState>({
    telegramId: "",
    badgeSlug: "",
    note: "",
    submitting: false,
    result: null,
    error: null,
  });

  const setField = <K extends keyof AwardFormState>(key: K, value: AwardFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value, error: null, result: null }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = form.telegramId.trim();
    if (!id || !form.badgeSlug) {
      setForm((prev) => ({
        ...prev,
        error: "Telegram ID and badge are required.",
      }));
      return;
    }
    setForm((prev) => ({ ...prev, submitting: true, error: null, result: null }));
    try {
      await awardGamificationBadge(id, form.badgeSlug, form.note.trim() || undefined);
      setForm((prev) => ({
        ...prev,
        submitting: false,
        result: g.awardSuccess,
        telegramId: "",
        note: "",
      }));
    } catch (err) {
      setForm((prev) => ({
        ...prev,
        submitting: false,
        error: err instanceof Error ? err.message : g.awardError,
      }));
    }
  };

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(212,0,122,0.2)",
      }}
    >
      <h3 className="text-base font-bold text-white mb-1">{g.awardFormTitle}</h3>
      <p className="text-xs mb-4" style={{ color: "#8E8E93" }}>
        {g.awardFormSubtitle}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="award-telegram-id"
            className="block text-xs font-medium text-white/70 mb-1.5"
          >
            {g.telegramId}
          </label>
          <input
            id="award-telegram-id"
            type="text"
            inputMode="numeric"
            value={form.telegramId}
            onChange={(e) => setField("telegramId", e.target.value)}
            placeholder={g.telegramIdPlaceholder}
            className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition-colors"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            disabled={form.submitting}
            aria-required="true"
          />
        </div>

        <div>
          <label
            htmlFor="award-badge-slug"
            className="block text-xs font-medium text-white/70 mb-1.5"
          >
            {g.selectBadge}
          </label>
          <select
            id="award-badge-slug"
            value={form.badgeSlug}
            onChange={(e) => setField("badgeSlug", e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-colors appearance-none"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            disabled={form.submitting}
            aria-required="true"
          >
            <option value="" disabled style={{ background: "#1E1E1E" }}>
              {g.selectBadgePlaceholder}
            </option>
            {allBadges.map((b) => (
              <option key={b.slug} value={b.slug} style={{ background: "#1E1E1E" }}>
                {lang === "es" ? b.name_es : b.name_en} (lvl {b.level})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="award-note"
            className="block text-xs font-medium text-white/70 mb-1.5"
          >
            {g.note}
          </label>
          <textarea
            id="award-note"
            value={form.note}
            onChange={(e) => setField("note", e.target.value)}
            placeholder={g.notePlaceholder}
            rows={3}
            className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none resize-none transition-colors"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            disabled={form.submitting}
          />
        </div>

        {form.error && (
          <p className="text-xs text-red-400">{form.error}</p>
        )}

        {form.result && (
          <p className="text-xs font-semibold" style={{ color: "#5ED1C4" }}>
            {form.result}
          </p>
        )}

        <button
          type="submit"
          disabled={form.submitting || !form.telegramId.trim() || !form.badgeSlug}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          style={{
            background: "linear-gradient(135deg, rgba(212,0,122,0.85), rgba(230,145,56,0.75))",
            color: "#fff",
          }}
        >
          {form.submitting ? g.awarding : g.award}
        </button>
      </form>
    </div>
  );
}

// ── Bulk award panel ──────────────────────────────────────────────────────────

function BulkAwardPanel() {
  const t = useI18n();
  const g = t.gamification;
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBulkAward = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    setConfirming(false);
    try {
      const res = await awardMeCuidoToAllCreators();
      setResult(g.awardAllCreatorsSuccess.replace("{count}", String(res.awarded)));
    } catch (err) {
      setError(err instanceof Error ? err.message : g.awardAllCreatorsError);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(230,145,56,0.25)",
      }}
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(230,145,56,0.15)", border: "1px solid rgba(230,145,56,0.3)" }}
        >
          <span className="text-xl" role="img" aria-hidden="true">❤️</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">{g.meCuido} — {g.awardBadge}</h3>
          <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>
            {g.awardAllCreators}
          </p>
        </div>
      </div>

      {result && (
        <p className="text-xs font-semibold mb-3" style={{ color: "#5ED1C4" }}>
          {result}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400 mb-3">{error}</p>
      )}

      {confirming ? (
        <div
          className="rounded-lg p-3 mb-3 text-xs"
          style={{
            background: "rgba(230,145,56,0.1)",
            border: "1px solid rgba(230,145,56,0.25)",
            color: "#E69138",
          }}
        >
          {g.awardAllCreatorsConfirm}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleBulkAward}
              disabled={running}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 min-h-[36px]"
              style={{
                background: "rgba(230,145,56,0.2)",
                color: "#E69138",
                border: "1px solid rgba(230,145,56,0.35)",
              }}
            >
              {running ? g.awardingAll : t.common.confirm}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={running}
              className="px-4 py-2 rounded-lg text-xs transition-colors disabled:opacity-40 min-h-[36px]"
              style={{ background: "rgba(255,255,255,0.05)", color: "#8E8E93" }}
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          disabled={running}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          style={{
            background: "rgba(230,145,56,0.15)",
            color: "#E69138",
            border: "1px solid rgba(230,145,56,0.3)",
          }}
        >
          {running ? g.awardingAll : g.awardAllCreators}
        </button>
      )}
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({
  category,
  lang,
  openHoldersSlug,
  onToggleHolders,
  onRevoke,
}: {
  category: GamificationCategory;
  lang: string;
  openHoldersSlug: string | null;
  onToggleHolders: (slug: string) => void;
  onRevoke: (telegramId: string, badgeSlug: string) => Promise<void>;
}) {
  const t = useI18n();
  const g = t.gamification;
  const categoryName = lang === "es" ? category.name_es : category.name_en;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-3 mb-3 text-left group min-h-[44px]"
        aria-expanded={!collapsed}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
          style={{ background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.2)" }}
        >
          <BadgeIcon icon={category.icon} size="sm" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-base font-bold text-white group-hover:text-pnp-accent transition-colors">
            {categoryName}
          </span>
          <span className="ml-2 text-xs" style={{ color: "#8E8E93" }}>
            {category.badges.length} {g.badges.toLowerCase()}
          </span>
        </div>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform ${collapsed ? "" : "rotate-180"}`}
          style={{ color: "#8E8E93" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="space-y-2 pl-0">
          {category.badges.length === 0 ? (
            <p className="text-xs py-3 text-center" style={{ color: "#8E8E93" }}>
              {g.noBadges}
            </p>
          ) : (
            category.badges.map((badge) => (
              <BadgeRow
                key={badge.slug}
                badge={badge}
                lang={lang}
                openHoldersSlug={openHoldersSlug}
                onToggleHolders={onToggleHolders}
                onRevoke={onRevoke}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Gamification() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const t = useI18n();
  const g = t.gamification;
  const lang = t.lang;

  const [categories, setCategories] = useState<GamificationCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openHoldersSlug, setOpenHoldersSlug] = useState<string | null>(null);

  // Flat list of all badges for the award form dropdown
  const allBadges: GamificationBadge[] = categories.flatMap((c) => c.badges);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getGamificationCategories();
      setCategories(res.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : g.errorLoading);
    } finally {
      setLoading(false);
    }
  }, [g.errorLoading]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const handleToggleHolders = useCallback((slug: string) => {
    setOpenHoldersSlug((prev) => (prev === slug ? null : slug));
  }, []);

  const handleRevoke = useCallback(
    async (telegramId: string, badgeSlug: string) => {
      await revokeGamificationBadge(telegramId, badgeSlug);
    },
    [],
  );

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-white/60">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-16">
      {/* Back nav */}
      <button
        onClick={() => navigate("/admin")}
        className="flex items-center gap-2 text-sm mb-4 hover:text-pnp-accent transition-colors min-h-[44px]"
        style={{ color: "#8E8E93" }}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Admin Dashboard
      </button>

      {/* Page header */}
      <h1 className="text-2xl font-bold text-white mb-1">{g.title}</h1>
      <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>
        {g.subtitle}
      </p>

      {/* Bulk action */}
      <div className="mb-8">
        <BulkAwardPanel />
      </div>

      {/* Award form */}
      <div className="mb-8">
        <AwardForm allBadges={allBadges} lang={lang} />
      </div>

      {/* Categories & badges */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4">{g.categories}</h2>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-10 rounded-xl bg-white/5 animate-pulse" />
                <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
                <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div
            className="px-4 py-3 rounded-xl text-sm text-red-300"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            {error}
            <button
              onClick={load}
              className="ml-2 text-red-400 underline hover:no-underline transition-colors text-xs"
            >
              {g.retry}
            </button>
          </div>
        ) : categories.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-white/40 text-sm">{g.noCategories}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {categories.map((cat) => (
              <CategorySection
                key={cat.slug}
                category={cat}
                lang={lang}
                openHoldersSlug={openHoldersSlug}
                onToggleHolders={handleToggleHolders}
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
