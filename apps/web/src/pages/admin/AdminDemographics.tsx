import React, { useState, useEffect, useCallback } from "react";
import { getAdminDemographics, type AdminDemographics } from "@/lib/api";

const LANG_LABELS: Record<string, string> = {
  en: "English", es: "Spanish", "pt-br": "Portuguese (BR)", fr: "French",
  de: "German", it: "Italian", th: "Thai", tr: "Turkish",
  "zh-hans": "Chinese (S)", "zh-hant": "Chinese (T)", unknown: "Unknown",
};

const TIER_COLORS: Record<string, string> = {
  PRIME: "#D4007A", member: "#30D158", free: "#636366", banned: "#FF453A",
};

const INSIGHT_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  opportunity: { bg: "rgba(0,191,255,0.07)", border: "rgba(0,191,255,0.25)", icon: "💡" },
  conversion:  { bg: "rgba(212,0,122,0.07)", border: "rgba(212,0,122,0.25)", icon: "📈" },
  engagement:  { bg: "rgba(230,145,56,0.07)", border: "rgba(230,145,56,0.25)", icon: "🔥" },
  onboarding:  { bg: "rgba(48,209,88,0.07)",  border: "rgba(48,209,88,0.25)",  icon: "🚀" },
  retention:   { bg: "rgba(255,69,58,0.07)",   border: "rgba(255,69,58,0.25)",   icon: "⚠️" },
  success:     { bg: "rgba(48,209,88,0.07)",   border: "rgba(48,209,88,0.25)",   icon: "✅" },
};

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function BarChart({ data, colorFn }: {
  data: { label: string; count: number }[];
  colorFn?: (label: string, i: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const pctVal = pct(d.count, total);
        const barPct = (d.count / max) * 100;
        const color = colorFn ? colorFn(d.label, i) : `hsl(${(i * 47) % 360}, 70%, 55%)`;
        return (
          <div key={d.label} className="flex items-center gap-2 text-sm">
            <div className="w-28 shrink-0 text-xs truncate" style={{ color: "#8E8E93" }} title={LANG_LABELS[d.label] || d.label}>
              {LANG_LABELS[d.label] || d.label}
            </div>
            <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${barPct}%`, background: color }}
              />
            </div>
            <div className="w-16 text-right text-xs" style={{ color: "#8E8E93" }}>
              {d.count.toLocaleString()} <span style={{ color: "#636366" }}>({pctVal}%)</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ data }: { data: { day: string; count: number }[] }) {
  if (!data.length) return <div className="text-xs text-pnp-textSecondary">No data</div>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-0.5 h-16">
      {data.map((d, i) => {
        const h = Math.max((d.count / max) * 100, 2);
        return (
          <div key={i} className="group relative flex-1 flex flex-col items-center justify-end h-full">
            <div
              className="w-full rounded-t transition-colors"
              style={{ height: `${h}%`, background: "rgba(212,0,122,0.7)" }}
            />
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-pnp-background border border-pnp-border rounded px-2 py-1 text-xs text-pnp-textPrimary whitespace-nowrap z-10 pointer-events-none">
              {d.day}: {d.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatPill({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs font-medium mt-0.5" style={{ color: "#D4007A" }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: "#636366" }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-5" style={{ background: "#1C1C1E", border: "1px solid rgba(255,255,255,0.08)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "#8E8E93" }}>{title}</h2>
      {children}
    </div>
  );
}

function FeatureRow({ label, value, icon, total }: { label: string; value: number; icon: string; total: number }) {
  const p = pct(value, total);
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <span className="text-lg w-7 text-center">{icon}</span>
      <div className="flex-1">
        <div className="text-sm text-white font-medium">{label}</div>
        <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(p * 2, 100)}%`, background: "linear-gradient(90deg,#D4007A,#E69138)" }} />
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-bold text-white">{value.toLocaleString()}</div>
        <div className="text-[10px]" style={{ color: "#636366" }}>{p}% of users</div>
      </div>
    </div>
  );
}

function SkeletonBlock({ h = "h-48" }: { h?: string }) {
  return <div className={`rounded-xl ${h} animate-pulse`} style={{ background: "#1C1C1E" }} />;
}

export default function AdminDemographics() {
  const [data, setData] = useState<AdminDemographics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getAdminDemographics();
      setData(res.demographics);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const total = data?.activity.total || 1;

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-pnp-textPrimary">Demographics & Engagement</h1>
          <p className="text-sm mt-1" style={{ color: "#8E8E93" }}>
            Population snapshot · strategy insights · feature adoption
          </p>
        </div>
        {!loading && (
          <button onClick={load} className="text-xs border rounded-lg px-3 py-1.5 transition-colors hover:text-white" style={{ color: "#8E8E93", borderColor: "rgba(255,255,255,0.1)" }}>
            Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm text-red-400" style={{ background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.2)" }}>
          {error}
        </div>
      )}

      {/* Strategy Insights */}
      {loading ? <SkeletonBlock h="h-32" /> : data?.insights && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#8E8E93" }}>Strategy Insights</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.insights.map((ins, i) => {
              const style = INSIGHT_COLORS[ins.type] || INSIGHT_COLORS.opportunity;
              return (
                <div key={i} className="rounded-xl p-4" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{style.icon}</span>
                    <span className="text-sm font-bold text-white">{ins.title}</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "#8E8E93" }}>{ins.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Population KPIs */}
      {loading ? <SkeletonBlock h="h-24" /> : data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatPill label="Total Users" value={data.activity.total.toLocaleString()} />
          <StatPill label="Active 7d" value={data.activity.active7d.toLocaleString()} sub={`${pct(data.activity.active7d, total)}%`} />
          <StatPill label="Active 30d" value={data.activity.active30d.toLocaleString()} sub={`${pct(data.activity.active30d, total)}%`} />
          <StatPill label="New 30d" value={data.activity.new30d.toLocaleString()} sub="signups" />
          <StatPill label="Age Verified" value={`${pct(data.activity.ageVerified, total)}%`} sub={`${data.activity.ageVerified.toLocaleString()} users`} />
          <StatPill label="Avg XP" value={data.activity.avgXp.toFixed(0)} sub="engagement score" />
        </div>
      )}

      {/* Demographics Grid */}
      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonBlock /><SkeletonBlock /><SkeletonBlock /><SkeletonBlock />
        </div>
      ) : data && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Tier Distribution */}
          <Section title="Tier Distribution">
            <BarChart
              data={data.tiers}
              colorFn={(label) => TIER_COLORS[label] || "#636366"}
            />
            <div className="flex gap-3 mt-4 flex-wrap">
              {data.tiers.map((t) => (
                <div key={t.label} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: TIER_COLORS[t.label] || "#636366" }} />
                  <span style={{ color: "#8E8E93" }}>{t.label}</span>
                  <span className="font-semibold text-white">{pct(t.count, total)}%</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Language Breakdown */}
          <Section title="Language Breakdown">
            <BarChart
              data={data.languages}
              colorFn={(_, i) => `hsl(${(i * 53 + 200) % 360}, 65%, 58%)`}
            />
          </Section>

          {/* Location / Region */}
          <Section title="Location / Region">
            {data.locations.length > 0 ? (
              <BarChart
                data={data.locations}
                colorFn={(_, i) => `hsl(${(i * 41 + 160) % 360}, 60%, 55%)`}
              />
            ) : (
              <p className="text-xs" style={{ color: "#8E8E93" }}>No location data yet. Most users haven't shared their location.</p>
            )}
          </Section>

          {/* XP / Engagement Buckets */}
          <Section title="Engagement (XP Buckets)">
            <BarChart
              data={data.xpBuckets}
              colorFn={(_, i) => {
                const colors = ["#636366", "#0085FF", "#30D158", "#E69138", "#D4007A"];
                return colors[i] || "#636366";
              }}
            />
            <p className="text-xs mt-3" style={{ color: "#636366" }}>
              XP reflects in-app activity. 0 XP = never engaged. Higher buckets = power users.
            </p>
          </Section>

          {/* Subscription Type */}
          <Section title="Subscription Type">
            <BarChart
              data={data.subscriptionTypes}
              colorFn={(_, i) => i === 0 ? "#D4007A" : "#E69138"}
            />
          </Section>

          {/* Profile Completion */}
          <Section title="Profile Completion">
            {[
              { label: "Has Bio", count: data.activity.withBio },
              { label: "Has Photo", count: data.activity.withPhoto },
              { label: "Has Location", count: data.activity.withLocation },
              { label: "Terms Accepted", count: data.activity.termsAccepted ?? 0 },
              { label: "Age Verified", count: data.activity.ageVerified },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 mb-2">
                <div className="w-28 text-xs shrink-0" style={{ color: "#8E8E93" }}>{item.label}</div>
                <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct(item.count, total)}%`, background: "linear-gradient(90deg,#D4007A,#E69138)" }}
                  />
                </div>
                <div className="text-xs w-10 text-right font-semibold text-white">{pct(item.count, total)}%</div>
              </div>
            ))}
          </Section>
        </div>
      )}

      {/* Signup Trend */}
      {loading ? <SkeletonBlock h="h-32" /> : data && (
        <Section title="New Signups — Last 30 Days">
          <Sparkline data={data.signupTrend} />
          <div className="flex justify-between mt-1 text-xs" style={{ color: "#636366" }}>
            {data.signupTrend[0] && <span>{data.signupTrend[0].day}</span>}
            {data.signupTrend[data.signupTrend.length - 1] && <span>{data.signupTrend[data.signupTrend.length - 1].day}</span>}
          </div>
          <div className="mt-3 flex gap-4 text-sm">
            <span className="text-white font-bold">{data.activity.new30d.toLocaleString()}</span>
            <span style={{ color: "#8E8E93" }}>new users in last 30 days</span>
            <span className="text-white font-bold">{data.activity.new7d.toLocaleString()}</span>
            <span style={{ color: "#8E8E93" }}>last 7 days</span>
          </div>
        </Section>
      )}

      {/* Retention */}
      {loading ? <SkeletonBlock h="h-20" /> : data && data.retention.cohortSize > 0 && (
        <Section title="30-Day Retention (Users Who Joined 30–60 Days Ago)">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-3xl font-bold" style={{ color: (data.retention.rate ?? 0) >= 30 ? "#30D158" : "#FF453A" }}>
                {data.retention.rate !== null ? `${data.retention.rate}%` : "—"}
              </div>
              <div className="text-xs mt-1" style={{ color: "#8E8E93" }}>retention rate</div>
            </div>
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${data.retention.rate ?? 0}%`,
                  background: (data.retention.rate ?? 0) >= 30 ? "#30D158" : "#FF453A",
                }}
              />
            </div>
            <div className="text-xs text-right" style={{ color: "#8E8E93" }}>
              {data.retention.retained} / {data.retention.cohortSize} users
            </div>
          </div>
        </Section>
      )}

      {/* Feature Engagement */}
      {loading ? <SkeletonBlock /> : data && (
        <Section title="Feature Interactions & Engagement">
          <div className="grid md:grid-cols-2 gap-x-8">
            <div>
              <FeatureRow label="Social Posts" value={data.features.posts} icon="📝" total={total} />
              <FeatureRow label="Post Likes" value={data.features.postLikes} icon="❤️" total={total} />
              <FeatureRow label="User Follows" value={data.features.follows} icon="👥" total={total} />
              <FeatureRow label="Direct Messages" value={data.features.dms} icon="💬" total={total} />
              <FeatureRow label="Chat Messages" value={data.features.chatMessages} icon="🗨️" total={total} />
              <FeatureRow label="Hangout Rooms" value={data.features.hangouts} icon="🎥" total={total} />
              <FeatureRow label="Hangout Members" value={data.features.hangoutMembers} icon="🙋" total={total} />
            </div>
            <div>
              <FeatureRow label="Live Streams" value={data.features.streams} icon="🔴" total={total} />
              <FeatureRow label="Media Plays" value={data.features.mediaPlays} icon="▶️" total={total} />
              <FeatureRow label="Media Favorites" value={data.features.mediaFavorites} icon="⭐" total={total} />
              <FeatureRow label="Tips Sent" value={data.features.tips} icon="💸" total={total} />
              <FeatureRow label="Push Subscribers" value={data.features.pushSubscribers} icon="🔔" total={total} />
              <FeatureRow label="Notifications Sent" value={data.features.notificationsSent} icon="📣" total={total} />
              <FeatureRow label="X / Twitter Linked" value={data.features.xLinked} icon="𝕏" total={total} />
              <FeatureRow label="Bluesky Linked" value={data.features.blueskyLinked} icon="🦋" total={total} />
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
