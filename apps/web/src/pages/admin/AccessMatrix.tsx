import React from "react";
import { useI18n } from "@/lib/i18n";

// ─── Types ───────────────────────────────────────────────────────────────────

type CellValue = "yes" | "no" | "partial";

interface MatrixRow {
  feature: string;
  free: CellValue;
  member: CellValue;
  prime: CellValue;
  note?: string;
}

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
  const am = t.accessMatrix;

  const MATRIX_ROWS: MatrixRow[] = [
    { feature: am.browseProfiles,    free: "yes",     member: "yes", prime: "yes" },
    { feature: am.communityHangouts, free: "no",      member: "yes", prime: "yes" },
    { feature: am.liveStreamAccess,  free: "no",      member: "yes", prime: "yes" },
    {
      feature: am.directMessages,
      free: "partial",
      member: "yes",
      prime: "yes",
      note: am.dmNote,
    },
    { feature: am.buyTokens,         free: "no",      member: "yes", prime: "yes" },
    { feature: am.bookCalls,         free: "no",      member: "yes", prime: "yes" },
    { feature: am.primeMedia,        free: "no",      member: "no",  prime: "yes" },
    { feature: am.subscribeCreators, free: "no",      member: "yes", prime: "yes" },
  ];

  const ADD_ON_DESCRIPTIONS: { id: string; label: string; description: string; color: string }[] = [
    {
      id: "pnp-member",
      label: "pnp-member",
      description: "Base membership — hangouts, live streams, DMs, tokens & calls",
      color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    },
    {
      id: "prime",
      label: "prime",
      description: "Full PRIME content access — exclusive VOD, prime streams & PRIME channel",
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      id: "creator-subscription",
      label: "creator-subscription",
      description: "Scoped: subscribe to a specific creator for their exclusive content & DMs (recurring)",
      color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    },
    {
      id: "channel-access",
      label: "channel-access",
      description: "Scoped: one-time purchase of a paid creator channel + its linked hangout",
      color: "text-green-400 bg-green-500/10 border-green-500/20",
    },
    {
      id: "hangout-access",
      label: "hangout-access",
      description: "Scoped: one-time access to a standalone paid hangout not linked to a channel",
      color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    },
    {
      id: "private-calls",
      label: "private-calls",
      description: "One-time use credit for a private video call with a creator",
      color: "text-pnp-accent bg-pnp-accent/10 border-pnp-accent/20",
    },
    {
      id: "pnp-col",
      label: "pnp-col",
      description: "Required for Colombian users — grants platform access under regional pricing",
      color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
    },
  ];

  return (
    <div className="page-container space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-pnp-textPrimary">{am.title}</h1>
        <p className="text-sm text-pnp-textSecondary mt-1">
          {am.subtitle}
        </p>
      </div>

      {/* How plans work note */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-4 space-y-1.5">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide">
          {am.howPlansWork}
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
          <h2 className="text-sm font-semibold text-pnp-textPrimary">{am.featureAccess}</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-pnp-border">
                <th className="text-left px-4 py-3 text-pnp-textSecondary font-medium text-xs uppercase tracking-wide w-full">
                  {am.feature}
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
          <span>{am.included}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500/10 text-red-400 text-xs">✕</span>
          <span>{am.notIncluded}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500/10 text-yellow-400 text-xs">~</span>
          <span>{am.limited}</span>
        </div>
      </div>

      {/* Add-on reference cards */}
      <div>
        <h2 className="text-sm font-semibold text-pnp-textPrimary mb-3">{am.addonRef}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ADD_ON_DESCRIPTIONS.map((addon) => (
            <div
              key={addon.id}
              className={`rounded-xl border px-4 py-4 ${addon.color}`}
            >
              <p className="font-mono text-sm font-semibold mb-1.5">{addon.label}</p>
              <p className="text-xs leading-relaxed opacity-90">{addon.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Builder tip */}
      <div className="rounded-xl border border-pnp-border bg-pnp-surface px-4 py-4">
        <p className="text-xs font-semibold text-pnp-textSecondary uppercase tracking-wide mb-2">
          {am.builderTip}
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
              <span className="font-medium">Scoped add-ons</span> (
              <span className="font-mono text-xs text-purple-400">creator-subscription</span>,{" "}
              <span className="font-mono text-xs text-green-400">channel-access</span>,{" "}
              <span className="font-mono text-xs text-cyan-400">hangout-access</span>) are
              per-resource — they attach to a specific creator or hangout, not to the plan globally.
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
