import React, { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { deleteAccount, eraseMyAccount, type EraseAccountReceipt } from "@/lib/api";

// ── DangerZoneSettings ────────────────────────────────────────────────────────

export default function DangerZoneSettings() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const t = useI18n();
  const p = t.profile;

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInputRef = useRef<HTMLInputElement>(null);
  const deleteModalRef = useRef<HTMLDivElement>(null);

  const [showEraseModal, setShowEraseModal] = useState(false);
  const [eraseConfirmText, setEraseConfirmText] = useState("");
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const [eraseReceipt, setEraseReceipt] = useState<EraseAccountReceipt | null>(null);
  const eraseInputRef = useRef<HTMLInputElement>(null);
  const eraseModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showDeleteModal) deleteInputRef.current?.focus();
  }, [showDeleteModal]);

  useEffect(() => {
    if (showEraseModal) eraseInputRef.current?.focus();
  }, [showEraseModal]);

  const handleDeleteAccount = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      setShowDeleteModal(false);
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : p.deleteAccountFailed);
      setDeleting(false);
    }
  }, [deleting, navigate, p]);

  const handleEraseAccount = useCallback(async () => {
    if (erasing) return;
    setErasing(true);
    setEraseError(null);
    try {
      const receipt = await eraseMyAccount();
      setEraseReceipt(receipt);
      setTimeout(async () => {
        try { await logout(); } catch { /* ignore */ }
        navigate("/login");
      }, 3000);
    } catch (err) {
      setEraseError(err instanceof Error ? err.message : "Data erasure failed. Please try again.");
      setErasing(false);
    }
  }, [erasing, logout, navigate]);

  return (
    <div className="space-y-4">
      <div className="glass-card-sm p-5">
        <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
          {p.dangerZoneSection}
        </h2>

        {/* Delete account */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{ background: "rgba(255,59,48,0.05)", border: "1px solid rgba(255,59,48,0.15)" }}
        >
          <p className="text-sm font-medium text-white mb-1">{p.deleteAccount}</p>
          <p className="text-xs mb-3" style={{ color: "var(--pnp-text-secondary)" }}>
            {p.deleteAccountDesc}
          </p>
          <button
            onClick={() => { setDeleteConfirmText(""); setDeleteError(null); setShowDeleteModal(true); }}
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,59,48,0.15)", color: "#FF3B30", border: "1px solid rgba(255,59,48,0.3)" }}
          >
            {p.deleteAccount}
          </button>
        </div>

        {/* GDPR full erasure */}
        <div
          className="rounded-xl p-4"
          style={{ background: "rgba(255,59,48,0.08)", border: "1px solid rgba(255,59,48,0.3)" }}
        >
          <div className="flex items-start gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: "rgba(255,59,48,0.2)" }}
            >
              <svg className="w-4 h-4" style={{ color: "#FF3B30" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">
                Erase All My Data (GDPR Article 17)
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                This permanently deletes ALL your data from our servers, including messages, payment history, and chat history. This action cannot be undone.
              </p>
            </div>
          </div>
          <button
            onClick={() => { setEraseConfirmText(""); setEraseError(null); setEraseReceipt(null); setShowEraseModal(true); }}
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,59,48,0.25)", color: "#FF3B30", border: "1px solid rgba(255,59,48,0.5)" }}
          >
            Request Full Data Erasure
          </button>
        </div>
      </div>

      {/* ── Back to settings ── */}
      <button
        onClick={() => navigate("/settings")}
        className="w-full py-3 rounded-xl text-sm font-medium transition-colors hover:text-white"
        style={{ color: "var(--pnp-text-secondary)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {p.back}
      </button>

      {/* ── Delete Account Modal ── */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          aria-describedby="delete-modal-desc"
          onKeyDown={(e) => { if (e.key === "Escape" && !deleting) setShowDeleteModal(false); }}
          tabIndex={-1}
          ref={deleteModalRef}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: "var(--pnp-background)", border: "1px solid rgba(255,59,48,0.25)" }}
          >
            <h2 id="delete-modal-title" className="text-base font-bold text-white mb-3">
              {p.deleteAccountConfirm}
            </h2>
            <p id="delete-modal-desc" className="text-xs leading-relaxed mb-4" style={{ color: "var(--pnp-text-secondary)" }}>
              {p.deleteAccountWarning}
            </p>
            <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>
              {p.typeToConfirm.replace("{word}", p.deleteConfirmWord)}
            </p>
            <input
              ref={deleteInputRef}
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deleting}
              autoFocus
              className="w-full rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,59,48,0.3)",
                color: "#fff",
                fontSize: "16px",
              }}
              placeholder={p.deleteConfirmWord}
              aria-label={p.typeToConfirm.replace("{word}", p.deleteConfirmWord)}
            />
            {deleteError && (
              <p className="text-xs mb-3" style={{ color: "#FF6B6B" }}>{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => !deleting && setShowDeleteModal(false)}
                disabled={deleting}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
              >
                {p.cancel}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirmText.toUpperCase() !== p.deleteConfirmWord.toUpperCase()}
                className="flex-1 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: "rgba(255,59,48,0.25)", color: "#FF3B30", border: "1px solid rgba(255,59,48,0.4)" }}
              >
                {deleting ? p.deletingAccount : p.deleteAccount}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GDPR Erase Modal ── */}
      {showEraseModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="erase-modal-title"
          aria-describedby="erase-modal-desc"
          onKeyDown={(e) => { if (e.key === "Escape" && !erasing && !eraseReceipt) setShowEraseModal(false); }}
          tabIndex={-1}
          ref={eraseModalRef}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: "var(--pnp-background)", border: "1px solid rgba(255,59,48,0.4)" }}
          >
            {eraseReceipt ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(94,209,196,0.15)" }}>
                    <svg className="w-4 h-4" style={{ color: "#5ED1C4" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <h2 id="erase-modal-title" className="text-base font-bold text-white">Erasure Requested</h2>
                </div>
                <p className="text-xs leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.6)" }}>
                  Your data erasure request has been logged. You will be signed out in a moment.
                </p>
                <div className="rounded-lg p-3 space-y-1.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--pnp-text-secondary)" }}>Erasure ID</p>
                    <p className="text-xs font-mono text-white break-all">{eraseReceipt.erasure_id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--pnp-text-secondary)" }}>Timestamp</p>
                    <p className="text-xs text-white">{new Date(eraseReceipt.timestamp).toLocaleString()}</p>
                  </div>
                  {eraseReceipt.scope && eraseReceipt.scope.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--pnp-text-secondary)" }}>Scope</p>
                      <p className="text-xs text-white">{eraseReceipt.scope.join(", ")}</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(255,59,48,0.2)" }}>
                    <svg className="w-4 h-4" style={{ color: "#FF3B30" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div>
                    <h2 id="erase-modal-title" className="text-base font-bold text-white mb-1">
                      Erase All My Data (GDPR Article 17)
                    </h2>
                    <p id="erase-modal-desc" className="text-xs leading-relaxed" style={{ color: "var(--pnp-text-secondary)" }}>
                      This permanently deletes ALL your data from our servers, including messages, payment history, and chat history. This action cannot be undone.
                    </p>
                  </div>
                </div>
                <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Type <span className="font-mono font-semibold" style={{ color: "#FF3B30" }}>DELETE MY ACCOUNT</span> to confirm
                </p>
                <input
                  ref={eraseInputRef}
                  type="text"
                  value={eraseConfirmText}
                  onChange={(e) => setEraseConfirmText(e.target.value)}
                  disabled={erasing}
                  autoFocus
                  className="w-full rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,59,48,0.4)", color: "#fff", fontSize: "16px" }}
                  placeholder="DELETE MY ACCOUNT"
                  aria-label="Type DELETE MY ACCOUNT to confirm erasure"
                />
                {eraseError && (
                  <p className="text-xs mb-3" style={{ color: "#FF6B6B" }}>{eraseError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => !erasing && setShowEraseModal(false)}
                    disabled={erasing}
                    className="flex-1 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    {p.cancel}
                  </button>
                  <button
                    onClick={handleEraseAccount}
                    disabled={erasing || eraseConfirmText !== "DELETE MY ACCOUNT"}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ background: "rgba(255,59,48,0.3)", color: "#FF3B30", border: "1px solid rgba(255,59,48,0.5)" }}
                  >
                    {erasing ? "Erasing..." : "Erase All Data"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
