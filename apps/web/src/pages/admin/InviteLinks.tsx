import React, { useState, useEffect, useCallback } from "react";
import {
  listAdminInviteLinks,
  createAdminInviteLink,
  type InviteLink,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function inviteUrl(code: string): string {
  return `https://pnptv.app/invite/${code}`;
}

// ── Create Link Modal ─────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: (link: InviteLink, url: string) => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [isLifetime, setIsLifetime] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await createAdminInviteLink({
        note: note.trim() || undefined,
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        expiresAt: expiresAt || null,
        isLifetime,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: "#111117", border: "1px solid rgba(255,255,255,0.10)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Crear enlace de invitación</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white/70 text-xl leading-none transition-colors"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              Nota (opcional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="p.ej. Grupo Colombia Telegram"
              maxLength={200}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:ring-1 focus:ring-[#D4007A]"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              Máximo de usos (dejar vacío = ilimitado)
            </label>
            <input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="100"
              min={1}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
              Expira el (dejar vacío = nunca)
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", colorScheme: "dark" }}
            />
          </div>

          <label
            className="flex items-center gap-3 cursor-pointer select-none"
            style={{ padding: "10px 14px", borderRadius: 12, background: isLifetime ? "rgba(255,180,84,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${isLifetime ? "rgba(255,180,84,0.25)" : "rgba(255,255,255,0.08)"}`, transition: "all 0.15s" }}
          >
            <input
              type="checkbox"
              checked={isLifetime}
              onChange={(e) => setIsLifetime(e.target.checked)}
              className="sr-only"
            />
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
              style={{ background: isLifetime ? "linear-gradient(135deg,#FFB454,#FF9933)" : "rgba(255,255,255,0.08)", border: `1.5px solid ${isLifetime ? "#FFB454" : "rgba(255,255,255,0.18)"}`, transition: "all 0.15s" }}
            >
              {isLifetime && <span className="text-white text-xs font-bold">✓</span>}
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: isLifetime ? "#FFB454" : "rgba(255,255,255,0.6)" }}>
                💎 Acceso de por vida + badge Parche
              </p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Otorga pnp-member vitalicio y el badge Parche 💎 al canjear
              </p>
            </div>
          </label>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

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

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      /* clipboard may be blocked in some browsers — silent fail */
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg transition-all"
      style={{
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(212,0,122,0.12)",
        color: copied ? "#4ADE80" : "#D4007A",
        border: copied ? "1px solid rgba(34,197,94,0.30)" : "1px solid rgba(212,0,122,0.25)",
      }}
    >
      {copied ? "✓ Copiado" : "Copiar enlace"}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InviteLinks() {
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newLinkInfo, setNewLinkInfo] = useState<{ code: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAdminInviteLinks();
      if (result.success) {
        setLinks(result.links);
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
  };

  const isExpired = (link: InviteLink): boolean => {
    if (!link.expires_at) return false;
    return new Date(link.expires_at) < new Date();
  };

  const isExhausted = (link: InviteLink): boolean => {
    if (link.max_uses === null) return false;
    return link.use_count >= link.max_uses;
  };

  const isActive = (link: InviteLink) => !isExpired(link) && !isExhausted(link);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-white">
            🔗 Enlaces de Invitación
          </h1>
          <p className="text-sm text-white/50 mt-0.5">
            Los enlaces 💎 otorgan pnp-member vitalicio + badge Socio Colombia + badge Parche.
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
        <div
          className="p-4 rounded-xl text-sm text-red-400"
          style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          {error}
          <button
            type="button"
            onClick={load}
            className="ml-3 underline text-red-400/80 hover:text-red-400"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-3 py-8 text-white/40 text-sm">
          <div
            className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "#D4007A" }}
          />
          Cargando…
        </div>
      ) : links.length === 0 ? (
        <div
          className="rounded-2xl p-10 text-center"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-white/30 text-sm">No hay enlaces creados todavía.</p>
        </div>
      ) : (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  {["Código", "Tipo", "Nota", "Usos", "Expira", "Estado", "Acción"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-white/50 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {links.map((link, idx) => {
                  const active = isActive(link);
                  const expired = isExpired(link);
                  const exhausted = isExhausted(link);
                  const rowBg = idx % 2 === 0
                    ? "rgba(255,255,255,0.02)"
                    : "rgba(255,255,255,0.00)";

                  return (
                    <tr key={link.code} style={{ background: rowBg }}>
                      <td className="px-4 py-3 font-mono font-bold text-white/90">
                        {link.code}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {link.is_lifetime ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(255,180,84,0.12)", color: "#FFB454", border: "1px solid rgba(255,180,84,0.25)" }}
                          >
                            💎 Lifetime
                          </span>
                        ) : (
                          <span className="text-xs text-white/30">Regular</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/60 max-w-xs truncate">
                        {link.note || <span className="text-white/25 italic">sin nota</span>}
                      </td>
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                        {link.use_count}
                        {link.max_uses !== null
                          ? ` / ${link.max_uses}`
                          : " / ∞"}
                      </td>
                      <td className="px-4 py-3 text-white/50 whitespace-nowrap text-xs">
                        {formatDate(link.expires_at)}
                      </td>
                      <td className="px-4 py-3">
                        {active ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(34,197,94,0.15)", color: "#4ADE80", border: "1px solid rgba(34,197,94,0.25)" }}
                          >
                            Activo
                          </span>
                        ) : expired ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.10)" }}
                          >
                            Expirado
                          </span>
                        ) : exhausted ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(251,146,60,0.12)", color: "#FB923C", border: "1px solid rgba(251,146,60,0.25)" }}
                          >
                            Agotado
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <CopyButton text={inviteUrl(link.code)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
