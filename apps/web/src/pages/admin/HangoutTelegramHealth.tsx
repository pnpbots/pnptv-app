import React, { useCallback, useEffect, useState } from "react";
import {
  getHangoutTelegramHealth,
  type HangoutTelegramHealth,
  type HangoutTelegramHealthItem,
} from "@/lib/api";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusTone(status: HangoutTelegramHealthItem["status"]): string {
  if (status === "ok") return "bg-emerald-900/40 text-emerald-300 border-emerald-800";
  if (status === "stale") return "bg-red-900/40 text-red-300 border-red-800";
  if (status === "error") return "bg-amber-900/40 text-amber-300 border-amber-800";
  return "bg-zinc-800 text-zinc-300 border-zinc-700";
}

function SummaryCard({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default function HangoutTelegramHealth() {
  const [data, setData] = useState<HangoutTelegramHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getHangoutTelegramHealth();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return <div className="p-6 text-zinc-400">Loading Telegram hangout health…</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-400">{error}</p>
        <button onClick={load} className="mt-3 rounded bg-zinc-800 px-3 py-1 hover:bg-zinc-700">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 p-6 text-zinc-100">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hangout Telegram Health</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Checks every linked hangout against Telegram so stale chat IDs show up before broadcast failures.
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>Checked {fmtTime(data.checkedAt)}</div>
          <button onClick={load} className="mt-2 rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800">
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Linked" value={data.summary.totalLinked} tone="bg-zinc-900/70 text-zinc-100 border-zinc-800" />
        <SummaryCard label="Healthy" value={data.summary.ok} tone="bg-emerald-900/40 text-emerald-300 border-emerald-800" />
        <SummaryCard label="Stale" value={data.summary.stale} tone="bg-red-900/40 text-red-300 border-red-800" />
        <SummaryCard label="Missing Invite" value={data.summary.missingInviteLink} tone="bg-amber-900/40 text-amber-300 border-amber-800" />
      </div>

      {!data.summary.telegramConfigured ? (
        <div className="rounded-lg border border-amber-800 bg-amber-900/30 p-4 text-sm text-amber-200">
          <code>BOT_TOKEN</code> is not configured in this environment, so Telegram chat verification is disabled.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-400">
            <tr>
              <th className="px-4 py-3">Hangout</th>
              <th className="px-4 py-3">Telegram Chat</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Telegram Title</th>
              <th className="px-4 py-3">Invite Link</th>
              <th className="px-4 py-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length ? data.items.map((item) => (
              <tr key={item.groupId} className="border-b border-zinc-900 align-top hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">{item.groupName}</div>
                  <div className="text-xs text-zinc-500">#{item.groupId}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-300">{item.telegramChatId}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusTone(item.status)}`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-300">{item.chatType || "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{item.telegramTitle || "—"}</td>
                <td className="px-4 py-3">
                  {item.telegramInviteLink ? (
                    <a
                      className="text-sky-300 underline decoration-zinc-700 underline-offset-2 hover:text-sky-200"
                      href={item.telegramInviteLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="text-zinc-500">Missing</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-400">{item.error || "—"}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                  No Telegram-linked hangouts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
