import React, { useState, useEffect, useCallback } from "react";
import {
  listAdminInviteLinks,
  createAdminInviteLink,
  type InviteLink,
  type InviteLinkStats,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function inviteUrl(code: string): string {
  return `https://pnptv.app/invite/${code}`;
}

function conversionPct(clicks: number, signups: number): string {
  if (!clicks) return "—";
  return `${Math.round((signups / clicks) * 100)}%`;
}

// ── Create Link Modal ─────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: (link: InviteLink, url: string) => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [note, setNote]         = useState("");
  const [maxUses, setMaxUses]   = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [isLifetime, setIsLifetime] = useState(true);
  const [primeHours, setPrimeHours] = useState<string>("0");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await createAdminInviteLink({
        note:       note.trim() || undefined,
        maxUses:    maxUses ? parseInt(maxUses, 10) : null,
        expiresAt:  expiresAt || null,
        isLifetime,
        primeHours: parseInt(primeHours || "0", 10),
      });
      if (result.success) {
        onCreated(result.link, result.url);
      } else {
        setError("No se pudo crear el enlace.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  const ph = parseInt(primeHours || "0", 10);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: "#111117", border: "1px solid rgba(255,255,255,0.10)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Crear enlace de invitación</h2>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white/70 text-xl leading-none" aria-label="Cerrar">×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Note */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Nota (opcional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="p.ej. Anuncio Nicegram junio 2025"
              maxLength={200}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:ring-1 focus:ring-[#D4007A]"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
            />
          </div>

          {/* Max uses */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Máximo de usos (vacío = ilimitado)</label>
            <input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="500"
              min={1}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
            />
          </div>

          {/* Expires at */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Expira el (vacío = nunca)</label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", colorScheme: "dark" }}
            />
          </div>

          {/* Lifetime pnp-member */}
          <label
            className="flex items-center gap-3 cursor-pointer select-none"
            style={{ padding: "10px 14px", borderRadius: 12, background: isLifetime ? "rgba(255,180,84,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${isLifetime ? "rgba(255,180,84,0.25)" : "rgba(255,255,255,0.08)"}`, transition: "all 0.15s" }}
          >
            <input type="checkbox" checked={isLifetime} onChange={(e) => setIsLifetime(e.target.checked)} className="sr-only" />
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
              style={{ background: isLifetime ? "linear-gradient(135deg,#FFB454,#FF9933)" : "rgba(255,255,255,0.08)", border: `1.5px solid ${isLifetime ? "#FFB454" : "rgba(255,255,255,0.18)"}`, transition: "all 0.15s" }}
            >
              {isLifetime && <span className="text-white text-xs font-bold">✓</span>}
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: isLifetime ? "#FFB454" : "rgba(255,255,255,0.6)" }}>💎 Acceso de por vida + badge Parche</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Otorga pnp-member vitalicio y el badge Parche 💎 al canjear</p>
            </div>
          </label>

          {/* PRIME hours */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Horas de PRIME gratis (0 = ninguna)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={primeHours}
                onChange={(e) => setPrimeHours(e.target.value)}
                placeholder="0"
                min={0}
                max={720}
                className="w-28 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:ring-1 focus:ring-[#7B61FF]"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
              />
              {ph > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(123,97,255,0.15)", color: "#A78BFA", border: "1px solid rgba(123,97,255,0.3)" }}
                >
                  ⚡ {ph}h PRIME gratis
                </span>
              )}
            </div>
            <p className="text-xs text-white/30">Típico: 24 para anuncios. Los usuarios que ya tengan PRIME extenderán su tiempo.</p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[42px] rounded-xl text-sm font-semibold text-white/60"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 min-h-[42px] rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-opacity"
              style={{ background: "linear-gradient(135deg,#D4007A,#9B00B0)" }}
            >
              {loading ? "Creando…" : "Crear enlace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
      }}
      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg transition-all"
      style={{
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(212,0,122,0.12)",
        color:      copied ? "#4ADE80" : "#D4007A",
        border:     copied ? "1px solid rgba(34,197,94,0.30)" : "1px solid rgba(212,0,122,0.25)",
      }}
    >
      {copied ? "✓ Copiado" : "Copiar"}
    </button>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <p className="text-xs text-white/40 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black text-white leading-none">{value}</p>
      {sub && <p className="text-xs text-white/30">{sub}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InviteLinks() {
  const [links, setLinks]           = useState<InviteLink[]>([]);
  const [stats, setStats]           = useState<InviteLinkStats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newLinkInfo, setNewLinkInfo] = useState<{ code: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAdminInviteLinks();
      if (result.success) {
        setLinks(result.links);
        setStats(result.stats ?? null);
      } else {
        setError("No se pudieron cargar los enlaces.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error cargando enlaces.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreated = (link: InviteLink, url: string) => {
    setShowCreate(false);
    setNewLinkInfo({ code: link.code, url });
    setLinks((prev) => [link, ...prev]);
    setStats((prev) => prev ? { ...prev, totalLinks: prev.totalLinks + 1 } : prev);
  };

  const isExpired   = (l: InviteLink) => !!l.expires_at && new Date(l.expires_at) < new Date();
  const isExhausted = (l: InviteLink) => l.max_uses !== null && l.use_count >= l.max_uses;
  const isActive    = (l: InviteLink) => !isExpired(l) && !isExhausted(l);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-white">🔗 Enlaces de Invitación</h1>
          <p className="text-sm text-white/50 mt-0.5">
            💎 otorga pnp-member vitalicio + badge Parche. ⚡ otorga PRIME gratis al canjear.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setNewLinkInfo(null); setShowCreate(true); }}
          className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#D4007A,#9B00B0)" }}
        >
          + Crear enlace
        </button>
      </div>

      {/* Aggregate stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Links activos" value={stats.totalLinks} />
          <StatCard label="Clicks totales" value={stats.totalClicks} sub="visitas a la página" />
          <StatCard label="Canjes totales" value={stats.totalSignups} sub="usuarios registrados" />
          <StatCard label="Conversión" value={`${stats.avgConversion}%`} sub="clicks → canjes" />
        </div>
      )}

      {/* New link flash */}
      {newLinkInfo && (
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{ background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.25)" }}
        >
          <span className="text-green-400 text-xl" aria-hidden>✓</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-400">Enlace creado</p>
            <p className="text-xs text-white/60 truncate">{newLinkInfo.url}</p>
          </div>
          <CopyButton text={newLinkInfo.url} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl text-sm text-red-400" style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)" }}>
          {error}
          <button type="button" onClick={load} className="ml-3 underline text-red-400/80 hover:text-red-400">Reintentar</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-3 py-8 text-white/40 text-sm">
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "#D4007A" }} />
          Cargando…
        </div>
      ) : links.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-white/30 text-sm">No hay enlaces creados todavía.</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  {["Código", "Tipo", "Nota", "Clicks", "Canjes", "Conv.", "Expira", "Estado", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-white/50 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {links.map((link, idx) => {
                  const active    = isActive(link);
                  const expired   = isExpired(link);
                  const exhausted = isExhausted(link);
                  const rowBg     = idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent";
                  const clicks    = link.click_count || 0;
                  const signups   = link.use_count   || 0;

                  return (
                    <tr key={link.code} style={{ background: rowBg }}>
                      {/* Code */}
                      <td className="px-4 py-3 font-mono font-bold text-white/90 whitespace-nowrap">{link.code}</td>

                      {/* Type badges */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          {link.is_lifetime && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,180,84,0.12)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.25)" }}>
                              💎 Lifetime
                            </span>
                          )}
                          {(link.prime_hours || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(123,97,255,0.15)", color: "#A78BFA", border: "1px solid rgba(123,97,255,0.3)" }}>
                              ⚡ {link.prime_hours}h PRIME
                            </span>
                          )}
                          {!link.is_lifetime && !link.prime_hours && (
                            <span className="text-xs text-white/30">Regular</span>
                          )}
                        </div>
                      </td>

                      {/* Note */}
                      <td className="px-4 py-3 text-white/60 max-w-[180px] truncate">
                        {link.note || <span className="text-white/25 italic">sin nota</span>}
                      </td>

                      {/* Clicks */}
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap tabular-nums">{clicks.toLocaleString()}</td>

                      {/* Signups */}
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap tabular-nums">
                        {signups.toLocaleString()}
                        {link.max_uses !== null && <span className="text-white/30"> / {link.max_uses}</span>}
                      </td>

                      {/* Conversion */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {clicks > 0 ? (
                          <span
                            className="text-xs font-semibold"
                            style={{ color: signups / clicks >= 0.1 ? "#4ADE80" : signups / clicks >= 0.03 ? "#FCD34D" : "#FB923C" }}
                          >
                            {conversionPct(clicks, signups)}
                          </span>
                        ) : (
                          <span className="text-white/25 text-xs">—</span>
                        )}
                      </td>

                      {/* Expiry */}
                      <td className="px-4 py-3 text-white/50 whitespace-nowrap text-xs">{formatDate(link.expires_at)}</td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {active ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: "#4ADE80", border: "1px solid rgba(34,197,94,0.25)" }}>Activo</span>
                        ) : expired ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.10)" }}>Expirado</span>
                        ) : exhausted ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(251,146,60,0.12)", color: "#FB923C", border: "1px solid rgba(251,146,60,0.25)" }}>Agotado</span>
                        ) : null}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3"><CopyButton text={inviteUrl(link.code)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
    </div>
  );
}
