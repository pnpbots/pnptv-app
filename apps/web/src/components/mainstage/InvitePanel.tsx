import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMainStageInvite,
  listMainStageInvites,
  revokeMainStageInvite,
  type MainStageInvite,
  ApiError,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired / Expirado";
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  if (days  >= 1) return `${days}d`;
  if (hours >= 1) return `${hours}h`;
  return `${mins}m`;
}

const EXPIRES_OPTIONS: { label: string; hours: number }[] = [
  { label: "1 hour / 1 hora",         hours: 1   },
  { label: "6 hours / 6 horas",        hours: 6   },
  { label: "24 hours / 24 horas",      hours: 24  },
  { label: "3 days / 3 días",          hours: 72  },
  { label: "7 days / 7 días",          hours: 168 },
];

const MAX_USES_OPTIONS: { label: string; value: number }[] = [
  { label: "1 use / 1 uso",            value: 1  },
  { label: "5 uses / 5 usos",          value: 5  },
  { label: "10 uses / 10 usos",        value: 10 },
  { label: "Unlimited / Sin límite",   value: 0  },
];

// ── InviteRow ─────────────────────────────────────────────────────────────────

function InviteRow({
  invite,
  onRevoke,
}: {
  invite: MainStageInvite;
  onRevoke: (id: number) => void;
}) {
  const [copied, setCopied]     = useState(false);
  const [revoking, setRevoking] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(invite.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [invite.url]);

  const handleRevoke = useCallback(async () => {
    if (!window.confirm("Revoke this invite? Guests with the link won't be able to join.\n\n¿Revocar este enlace? Los invitados no podrán unirse.")) return;
    setRevoking(true);
    try {
      await revokeMainStageInvite(invite.id);
      onRevoke(invite.id);
    } catch {
      setRevoking(false);
    }
  }, [invite.id, onRevoke]);

  const isInactive = invite.isRevoked || invite.isExpired;
  const codeHint   = invite.code.slice(-6);
  const expiry     = formatExpiry(invite.expiresAt);
  const usageLine  = invite.maxUses === 0
    ? `${invite.usedCount ?? 0} used`
    : `${invite.usedCount ?? 0} / ${invite.maxUses} used`;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl border"
      style={{
        background: isInactive ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
        borderColor: isInactive ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
        opacity: isInactive ? 0.5 : 1,
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs text-white/80 truncate font-mono">…{codeHint}</p>
        <p className="text-[10px] text-white/40 mt-0.5 truncate">
          {invite.label ? `${invite.label} · ` : ""}
          {isInactive ? (invite.isRevoked ? "Revoked / Revocado" : "Expired / Expirado") : `Expires ${expiry}`}
          {" · "}
          {usageLine}
        </p>
      </div>

      {!isInactive && (
        <>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy invite URL / Copiar enlace"
            className="flex-shrink-0 min-h-[28px] px-2 rounded-lg text-[10px] font-bold transition-all active:scale-[0.95] bg-white/[0.07] border border-white/10 text-white/70"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking}
            aria-label="Revoke invite / Revocar invitación"
            className="flex-shrink-0 min-h-[28px] px-2 rounded-lg text-[10px] font-bold transition-all active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed bg-pnp-error/[0.12] border border-pnp-error/25 text-pnp-error"
          >
            {revoking ? "…" : "Revoke"}
          </button>
        </>
      )}
    </div>
  );
}

// ── InvitePanel ───────────────────────────────────────────────────────────────

export default function InvitePanel() {
  const [open,           setOpen]           = useState(false);
  const [label,          setLabel]          = useState("");
  const [expiresHours,   setExpiresHours]   = useState(24);
  const [maxUses,        setMaxUses]        = useState(1);
  const [generating,     setGenerating]     = useState(false);
  const [generatedInvite, setGeneratedInvite] = useState<MainStageInvite | null>(null);
  const [invites,        setInvites]        = useState<MainStageInvite[]>([]);
  const [loadingList,    setLoadingList]    = useState(false);
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);
  const [copied,         setCopied]         = useState(false);
  const generatedUrlRef = useRef<HTMLInputElement>(null);

  // Load existing invites when the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingList(true);
    listMainStageInvites()
      .then((list) => { if (!cancelled) setInvites(list); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [open]);

  const handleGenerate = useCallback(async () => {
    setErrorMsg(null);
    setGenerating(true);
    setGeneratedInvite(null);
    try {
      const invite = await createMainStageInvite({
        label:          label.trim() || undefined,
        expiresInHours: expiresHours,
        maxUses,
      });
      setGeneratedInvite(invite);
      setInvites((prev) => [invite, ...prev]);
      setLabel("");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to generate invite / Error al generar invitación";
      setErrorMsg(msg);
    } finally {
      setGenerating(false);
    }
  }, [label, expiresHours, maxUses]);

  const handleCopyGenerated = useCallback(() => {
    if (!generatedInvite) return;
    navigator.clipboard.writeText(generatedInvite.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: select the input
      generatedUrlRef.current?.select();
    });
  }, [generatedInvite]);

  const handleShareWeb = useCallback(() => {
    if (!generatedInvite) return;
    if (navigator.share) {
      navigator.share({
        title: "Join me on PNPtv Main Stage",
        text:  "You're invited to join Main Stage on PNPtv! / ¡Estás invitado al Main Stage de PNPtv!",
        url:   generatedInvite.url,
      }).catch(() => {});
    }
  }, [generatedInvite]);

  const handleShareX = useCallback(() => {
    if (!generatedInvite) return;
    const text = encodeURIComponent("Join me on PNPtv Main Stage! 🎉 / ¡Únete al Main Stage de PNPtv!");
    const url  = encodeURIComponent(generatedInvite.url);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "noopener,noreferrer");
  }, [generatedInvite]);

  const handleRevoked = useCallback((id: number) => {
    setInvites((prev) => prev.map((inv) => inv.id === id ? { ...inv, isRevoked: true } : inv));
    if (generatedInvite?.id === id) setGeneratedInvite(null);
  }, [generatedInvite]);

  const activeInvites   = invites.filter((i) => !i.isRevoked && !i.isExpired);
  const inactiveInvites = invites.filter((i) => i.isRevoked  || i.isExpired);

  return (
    <section>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <h3 className="text-white/50 text-[10px] font-bold uppercase tracking-widest">
          Invite to Stage / Invitar al Stage
        </h3>
        <svg
          className={`w-3.5 h-3.5 text-white/40 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Label */}
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional) / Etiqueta (opcional)"
            maxLength={80}
            className="w-full px-3 py-2 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none bg-white/[0.06] border border-white/10"
          />

          {/* Expires + max-uses row */}
          <div className="flex gap-2">
            <select
              value={expiresHours}
              onChange={(e) => setExpiresHours(Number(e.target.value))}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-xl text-xs text-white bg-white/[0.06] border border-white/10 focus:outline-none"
              aria-label="Expires in / Expira en"
            >
              {EXPIRES_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>{o.label}</option>
              ))}
            </select>
            <select
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-xl text-xs text-white bg-white/[0.06] border border-white/10 focus:outline-none"
              aria-label="Max uses / Usos máximos"
            >
              {MAX_USES_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {errorMsg && (
            <p className="text-[11px] text-pnp-error px-1">{errorMsg}</p>
          )}

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="w-full min-h-[40px] flex items-center justify-center gap-2 rounded-xl text-xs font-bold text-white transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
          >
            {generating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                Generate invite link / Generar enlace
              </>
            )}
          </button>

          {/* Generated invite result */}
          {generatedInvite && (
            <div
              className="rounded-xl p-3 space-y-2"
              style={{ background: "rgba(212,0,122,0.07)", border: "1px solid rgba(212,0,122,0.25)" }}
            >
              <p className="text-[10px] font-bold text-pnp-accent uppercase tracking-wider">
                Ready to share / Listo para compartir
              </p>
              <div className="flex gap-2">
                <input
                  ref={generatedUrlRef}
                  type="text"
                  readOnly
                  value={generatedInvite.url}
                  onClick={() => generatedUrlRef.current?.select()}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[11px] text-white/80 bg-black/30 border border-white/10 focus:outline-none font-mono"
                  aria-label="Invite URL"
                />
                <button
                  type="button"
                  onClick={handleCopyGenerated}
                  className="flex-shrink-0 min-h-[32px] px-2.5 rounded-lg text-[11px] font-bold transition-all active:scale-[0.95] bg-white/[0.08] border border-white/10 text-white/70"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <div className="flex gap-2">
                {/* Web Share API — only shows when supported (mobile, Safari) */}
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button
                    type="button"
                    onClick={handleShareWeb}
                    className="flex-1 min-h-[34px] flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold text-white/80 transition-all active:scale-[0.96] bg-white/[0.07] border border-white/10"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share
                  </button>
                )}

                {/* Share on X */}
                <button
                  type="button"
                  onClick={handleShareX}
                  className="flex-1 min-h-[34px] flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition-all active:scale-[0.96]"
                  style={{ background: "rgba(0,0,0,0.60)", border: "1px solid rgba(255,255,255,0.20)", color: "#E7E9EA" }}
                  aria-label="Share on X (Twitter)"
                >
                  {/* X logo */}
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.734-8.835L1.254 2.25H8.08l4.258 5.63 5.906-5.63Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Post on X
                </button>
              </div>
            </div>
          )}

          {/* Active invite list */}
          {loadingList ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : activeInvites.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[10px] text-white/35 font-semibold uppercase tracking-wider">
                Active / Activos ({activeInvites.length})
              </p>
              {activeInvites.map((inv) => (
                <InviteRow key={inv.id} invite={inv} onRevoke={handleRevoked} />
              ))}
            </div>
          ) : null}

          {/* Expired/revoked — collapsed by default */}
          {inactiveInvites.length > 0 && (
            <p className="text-[10px] text-white/25">
              + {inactiveInvites.length} expired/revoked / expirado/revocado
            </p>
          )}
        </div>
      )}
    </section>
  );
}
