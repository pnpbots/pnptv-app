import React from "react";
import { useI18n } from "@/lib/i18n";

// ─── Static data ────────────────────────────────────────────────────────────

type CellValue = "yes" | "no" | "partial";

interface MatrixRow {
  feature: string;
  free: CellValue;
  member: CellValue;
  prime: CellValue;
  note?: string;
}

const MATRIX_ROWS: MatrixRow[] = [
  { feature: "Browse profiles & nearby users", free: "yes", member: "yes", prime: "yes" },
  { feature: "Community hangouts & group chat", free: "no", member: "yes", prime: "yes" },
  { feature: "Live stream access", free: "no", member: "yes", prime: "yes" },
  {
    feature: "Direct messages",
    free: "partial",
    member: "yes",
    prime: "yes",
    note: "Free users get 3 DMs/day (increases to 10 after 7 days of activity)",
  },
  { feature: "Buy tokens", free: "no", member: "yes", prime: "yes" },
  { feature: "Book private video calls", free: "no", member: "yes", prime: "yes" },
  { feature: "Prime media (VOD & exclusive posts)", free: "no", member: "no", prime: "yes" },
  { feature: "Subscribe to creators", free: "no", member: "no", prime: "yes" },
];

const ADD_ON_DESCRIPTIONS: { id: string; label: string; description: string; color: string }[] = [
  {
    id: "pnp-member",
    label: "pnp-member",
    description: "Full platform access — hangouts, live streams, DMs, tokens & calls",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  {
    id: "prime",
    label: "prime",
    description: "PRIME content — exclusive VOD, prime streams & creator subscriptions",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  {
    id: "private-calls",
    label: "private-calls",
    description: "One private video call credit",
    color: "text-pnp-accent bg-pnp-accent/10 border-pnp-accent/20",
  },
];

// ─── Cell badge ──────────────────────────────────────────────────────────────

function StatusBadge({ value, note }: { value: CellValue; note?: string }) {
  if (value === "yes") {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-500/15 text-green-400 text-base select-none"
        aria-label="Included"
        title="Included"
      >
        ✓
      </span>
    );
  }
  if (value === "no") {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-500/10 text-red-400 text-base select-none"
        aria-label="Not included"
        title="Not included"
      >
        ✕
      </span>
    );
  }
  // partial
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-yellow-500/10 text-yellow-400 text-base select-none"
      aria-label={note ?? "Partially available"}
      title={note ?? "Partially available"}
    >
      ~
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AccessMatrix() {
  const t = useI18n().admin;
  return (
    <div className="page-container space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">{t.accessMatrix.title}</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">
          {t.accessMatrix.subtitle}
        </p>
      </div>

      {/* How plans work note */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-4 space-y-1.5">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">
          {t.accessMatrix.howPlansWork}
        </p>
        <p className="text-sm text-pnp-textPrimary leading-relaxed">
          Plans bundle one or more add-ons together with a price and duration. For example, a plan
          with <span className="font-mono text-blue-400">pnp-member</span> +{" "}
          <span className="font-mono text-amber-400">prime</span> for 30 days gives the user full
          access for one month. Add-ons can each have their own duration, or inherit the plan
          duration. Checking &quot;Lifetime&quot; on an add-on grants it with no expiry.
        </p>
      </div>

      {/* Feature matrix table */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-pnp-border">
          <h2 className="text-sm font-semibold text-pnp-textPrimary">{t.accessMatrix.featureAccess}</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-pnp-border">
                <th className="text-left px-4 py-3 text-pnp-textSecondary font-medium text-xs uppercase tracking-wide w-full">
                  {t.accessMatrix.feature}
                </th>
                <th className="px-4 py-3 text-center text-pnp-textSecondary font-medium text-xs uppercase tracking-wide whitespace-nowrap min-w-[80px]">
                  Free
                </th>
                <th className="px-4 py-3 text-center font-semibold text-xs uppercase tracking-wide whitespace-nowrap min-w-[100px]">
                  <span className="text-blue-400">pnp-member</span>
                </th>
                <th className="px-4 py-3 text-center font-semibold text-xs uppercase tracking-wide whitespace-nowrap min-w-[80px]">
                  <span className="text-amber-400">prime</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map((row, idx) => (
                <tr
                  key={row.feature}
                  className={`border-b border-pnp-border/50 ${
                    idx % 2 === 0 ? "bg-transparent" : "bg-pnp-background/40"
                  }`}
                >
                  <td className="px-4 py-3 text-pnp-textPrimary">
                    <span>{row.feature}</span>
                    {row.note && (
                      <span className="block text-xs text-yellow-400 mt-0.5">{row.note}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <StatusBadge value={row.free} note={row.note} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <StatusBadge value={row.member} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <StatusBadge value={row.prime} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-pnp-textSecondary">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500/15 text-green-400 text-xs">✓</span>
          <span>{t.accessMatrix.included}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500/10 text-red-400 text-xs">✕</span>
          <span>{t.accessMatrix.notIncluded}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500/10 text-yellow-400 text-xs">~</span>
          <span>{t.accessMatrix.limited}</span>
        </div>
      </div>

      {/* Add-on reference cards */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">{t.accessMatrix.addonRef}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ADD_ON_DESCRIPTIONS.map((addon) => (
            <div
              key={addon.id}
              className={`rounded-xl border px-4 py-4 ${addon.color}`}
            >
              <p className={`font-mono text-sm font-semibold mb-1.5`}>{addon.label}</p>
              <p className="text-xs leading-relaxed opacity-90">{addon.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Builder tip */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-4">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide mb-2">
          {t.accessMatrix.builderTip}
        </p>
        <ul className="space-y-1.5 text-sm text-pnp-textPrimary">
          <li className="flex gap-2">
            <span className="text-blue-400 flex-shrink-0">•</span>
            <span>
              <span className="font-medium">Full access plan:</span> enable{" "}
              <span className="font-mono text-xs text-blue-400">pnp-member</span> +{" "}
              <span className="font-mono text-xs text-amber-400">prime</span>, set duration.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-400 flex-shrink-0">•</span>
            <span>
              <span className="font-medium">Member-only plan:</span> enable{" "}
              <span className="font-mono text-xs text-blue-400">pnp-member</span> only — no PRIME
              content.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-400 flex-shrink-0">•</span>
            <span>
              <span className="font-medium">Call credit bundle:</span> add{" "}
              <span className="font-mono text-xs text-pnp-accent">private-calls</span> to any plan
              to include a call credit alongside other entitlements.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-400 flex-shrink-0">•</span>
            <span>
              <span className="font-medium">Lifetime grants:</span> toggle &quot;Lifetime&quot; on
              an individual add-on to make that entitlement permanent regardless of plan expiry.
            </span>
          </li>
        </ul>
      </div>

    </div>
  );
}
