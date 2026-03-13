import React, { useState, useEffect, useCallback, useRef } from "react";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import {
  getAdminUserEntitlements,
  grantAdminUserEntitlement,
  revokeAdminUserEntitlement,
  extendAdminUserEntitlement,
  getAddOns,
  type AdminEntitlement,
  type EntitlementAuditEntry,
  type AddOn,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// ---------------------------------------------------------------------------
// Local SVG icons
// ---------------------------------------------------------------------------

function IconChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// EntitlementStatusPill
// ---------------------------------------------------------------------------

interface EntitlementStatusPillProps {
  entitlement: AdminEntitlement;
}

function EntitlementStatusPill({ entitlement }: EntitlementStatusPillProps) {
  if (entitlement.is_consumed) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-pnp-surface text-pnp-textSecondary border border-pnp-border">
        Consumed
      </span>
    );
  }
  if (entitlement.is_lifetime) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/20">
        Lifetime
      </span>
    );
  }
  if (entitlement.expires_at && isExpired(entitlement.expires_at)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/20">
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">
      Active
      {entitlement.expires_at && (
        <span className="opacity-80">· {formatDate(entitlement.expires_at)}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ExtendForm
// ---------------------------------------------------------------------------

interface ExtendFormProps {
  addOnId: string;
  addOnName: string;
  userId: string;
  onDone: () => void;
  onCancel: () => void;
}

function ExtendForm({ addOnId, addOnName, userId, onDone, onCancel }: ExtendFormProps) {
  const [days, setDays] = useState<string>("30");
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const extraDays = parseInt(days, 10);
    if (isNaN(extraDays) || extraDays < 1) {
      setErr("Enter a valid number of days (minimum 1).");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      await extendAdminUserEntitlement(userId, addOnId, { extraDays, reason: reason || undefined });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to extend entitlement.");
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg bg-pnp-background border border-pnp-border space-y-3">
      <p className="text-xs text-pnp-textSecondary">
        Extend <span className="text-pnp-textPrimary font-medium">{addOnName}</span> by:
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor={`extend-days-${addOnId}`}>
            Days to add
          </label>
          <input
            ref={inputRef}
            id={`extend-days-${addOnId}`}
            type="number"
            min={1}
            value={days}
            onChange={(e) => { setDays(e.target.value); setErr(null); }}
            className="w-24 px-3 py-2 rounded-lg border border-pnp-border bg-pnp-surface text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor={`extend-reason-${addOnId}`}>
            Reason (optional)
          </label>
          <input
            id={`extend-reason-${addOnId}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer request"
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-surface text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          />
        </div>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm text-pnp-textSecondary border border-pnp-border hover:bg-pnp-surfaceHover disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-pnp-accent text-white hover:bg-pnp-accentHover disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {loading && <IconSpinner />}
          Extend
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GrantEntitlementForm
// ---------------------------------------------------------------------------

interface GrantFormProps {
  userId: string;
  availableAddOns: AddOn[];
  onGranted: () => void;
}

function GrantEntitlementForm({ userId, availableAddOns, onGranted }: GrantFormProps) {
  const [selectedAddOnId, setSelectedAddOnId] = useState<string>("");
  const [isLifetime, setIsLifetime] = useState(false);
  const [durationDays, setDurationDays] = useState<string>("30");
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleGrant = async () => {
    if (!selectedAddOnId) {
      setErr("Please select an add-on.");
      return;
    }
    const days = isLifetime ? undefined : parseInt(durationDays, 10);
    if (!isLifetime && (!days || isNaN(days) || days < 1)) {
      setErr("Enter a valid duration in days (minimum 1).");
      return;
    }
    setLoading(true);
    setErr(null);
    setSuccessMsg(null);
    try {
      await grantAdminUserEntitlement(userId, {
        addOnId: selectedAddOnId,
        durationDays: isLifetime ? undefined : days,
        isLifetime,
        reason: reason || undefined,
      });
      const addOnName = availableAddOns.find((a) => a.id === selectedAddOnId)?.name ?? selectedAddOnId;
      setSuccessMsg(`"${addOnName}" granted successfully.`);
      setSelectedAddOnId("");
      setIsLifetime(false);
      setDurationDays("30");
      setReason("");
      onGranted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to grant entitlement.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
      <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
        Grant Entitlement
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="grant-addon">
            Add-on
          </label>
          <select
            id="grant-addon"
            value={selectedAddOnId}
            onChange={(e) => { setSelectedAddOnId(e.target.value); setErr(null); setSuccessMsg(null); }}
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          >
            <option value="">— Select add-on —</option>
            {availableAddOns.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-pnp-textSecondary mb-1" htmlFor="grant-reason">
            Reason (optional)
          </label>
          <input
            id="grant-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. promo, manual fix"
            className="w-full px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer select-none min-h-[44px]">
          <input
            type="checkbox"
            checked={isLifetime}
            onChange={(e) => { setIsLifetime(e.target.checked); setErr(null); }}
            className="w-4 h-4 accent-pnp-accent"
          />
          <span className="text-sm text-pnp-textPrimary">Lifetime access</span>
        </label>

        {!isLifetime && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-pnp-textSecondary" htmlFor="grant-days">
              Duration (days)
            </label>
            <input
              id="grant-days"
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => { setDurationDays(e.target.value); setErr(null); }}
              className="w-24 px-3 py-2 rounded-lg border border-pnp-border bg-pnp-background text-pnp-textPrimary text-sm focus:outline-none focus:border-pnp-accent"
            />
          </div>
        )}
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
      {successMsg && <p className="text-xs text-green-400">{successMsg}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleGrant}
          disabled={loading}
          className="px-5 py-2 rounded-lg bg-pnp-accent text-white text-sm font-medium hover:bg-pnp-accentHover disabled:opacity-50 transition-colors flex items-center gap-2 min-h-[44px]"
        >
          {loading && <IconSpinner />}
          Grant Entitlement
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuditLogEntry
// ---------------------------------------------------------------------------

interface AuditEntryProps {
  entry: EntitlementAuditEntry;
}

function AuditLogEntry({ entry }: AuditEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.details !== null && entry.details !== undefined;

  let detailsStr = "";
  if (hasDetails) {
    try {
      detailsStr = JSON.stringify(entry.details, null, 2);
    } catch {
      detailsStr = String(entry.details);
    }
  }

  return (
    <div className="py-3 border-b border-pnp-border last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-sm text-pnp-textPrimary font-medium break-words">{entry.action}</span>
          <p className="text-xs text-pnp-textSecondary mt-0.5">{formatDateTime(entry.created_at)}</p>
        </div>
        {hasDetails && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex-shrink-0 text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors flex items-center gap-1 min-h-[44px] px-1"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            <IconChevronDown open={expanded} />
            <span className="sr-only">{expanded ? "Collapse" : "Expand"}</span>
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <pre className="mt-2 p-3 rounded-lg bg-pnp-background border border-pnp-border text-xs text-pnp-textSecondary overflow-x-auto whitespace-pre-wrap break-words">
          {detailsStr}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserEntitlementsSection (exported)
// ---------------------------------------------------------------------------

interface UserEntitlementsSectionProps {
  userId: string;
}

export function UserEntitlementsSection({ userId }: UserEntitlementsSectionProps) {
  const [entitlements, setEntitlements] = useState<AdminEntitlement[]>([]);
  const [auditLog, setAuditLog] = useState<EntitlementAuditEntry[]>([]);
  const [availableAddOns, setAvailableAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  // Per-row extend form tracking
  const [extendingAddOnId, setExtendingAddOnId] = useState<string | null>(null);

  // Revoke confirmation
  const [revokeTarget, setRevokeTarget] = useState<AdminEntitlement | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entRes, addOnsRes] = await Promise.all([
        getAdminUserEntitlements(userId),
        getAddOns(),
      ]);
      setEntitlements(entRes.entitlements);
      setAuditLog(entRes.auditLog);
      setAvailableAddOns(addOnsRes.addOns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entitlements.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevokeLoading(true);
    try {
      await revokeAdminUserEntitlement(userId, revokeTarget.add_on_id);
      setRevokeTarget(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke entitlement.");
      setRevokeTarget(null);
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleExtendDone = async () => {
    setExtendingAddOnId(null);
    await loadData();
  };

  const handleGranted = () => {
    loadData();
  };

  // --- Loading skeleton ---
  if (loading) {
    return (
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5 space-y-4">
        <div className="h-4 w-32 bg-pnp-border rounded animate-pulse" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 bg-pnp-background rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="rounded-xl bg-pnp-surface border border-pnp-border p-5">
        <div className="flex items-start gap-3 text-red-400">
          <IconAlert />
          <div className="flex-1 min-w-0">
            <p className="text-sm">{error}</p>
            <button
              onClick={loadData}
              className="mt-2 flex items-center gap-1.5 text-xs hover:underline"
            >
              <IconRefresh />
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Entitlements table card */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border overflow-hidden">
        <div className="px-5 py-4 border-b border-pnp-border flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider">
            Entitlements
          </h2>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 text-xs text-pnp-textSecondary hover:text-pnp-textPrimary transition-colors min-h-[44px] px-1"
            aria-label="Refresh entitlements"
          >
            <IconRefresh />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {entitlements.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-pnp-textSecondary">No entitlements found for this user.</p>
            <p className="text-xs text-pnp-textSecondary mt-1 opacity-70">Use the form below to grant one.</p>
          </div>
        ) : (
          <div className="divide-y divide-pnp-border">
            {entitlements.map((ent) => (
              <div key={ent.id} className="px-5 py-4">
                {/* Row top: name + status + actions */}
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-pnp-textPrimary break-words">
                      {ent.add_on_name}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <EntitlementStatusPill entitlement={ent} />
                      {ent.granted_by_plan && (
                        <span className="text-xs text-pnp-textSecondary">
                          Plan: <span className="text-pnp-textPrimary">{ent.granted_by_plan}</span>
                        </span>
                      )}
                      {ent.source && (
                        <span className="text-xs text-pnp-textSecondary">
                          via <span className="text-pnp-textPrimary">{ent.source}</span>
                        </span>
                      )}
                      <span className="text-xs text-pnp-textSecondary">
                        Granted {formatDate(ent.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!ent.is_consumed && !ent.is_lifetime && (
                      <button
                        onClick={() =>
                          setExtendingAddOnId(
                            extendingAddOnId === ent.add_on_id ? null : ent.add_on_id
                          )
                        }
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-pnp-border text-pnp-textSecondary hover:text-pnp-textPrimary hover:bg-pnp-surfaceHover transition-colors min-h-[44px]"
                        aria-pressed={extendingAddOnId === ent.add_on_id}
                        aria-label={`Extend ${ent.add_on_name}`}
                      >
                        Extend
                      </button>
                    )}
                    <button
                      onClick={() => setRevokeTarget(ent)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors min-h-[44px]"
                      aria-label={`Revoke ${ent.add_on_name}`}
                    >
                      Revoke
                    </button>
                  </div>
                </div>

                {/* Inline extend form */}
                {extendingAddOnId === ent.add_on_id && (
                  <ExtendForm
                    addOnId={ent.add_on_id}
                    addOnName={ent.add_on_name}
                    userId={userId}
                    onDone={handleExtendDone}
                    onCancel={() => setExtendingAddOnId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grant form */}
      <GrantEntitlementForm
        userId={userId}
        availableAddOns={availableAddOns}
        onGranted={handleGranted}
      />

      {/* Audit log collapsible */}
      <div className="rounded-xl bg-pnp-surface border border-pnp-border overflow-hidden">
        <button
          onClick={() => setAuditOpen((v) => !v)}
          className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-pnp-surfaceHover transition-colors min-h-[44px]"
          aria-expanded={auditOpen}
          aria-controls="entitlement-audit-log"
        >
          <h2 className="text-sm font-semibold text-pnp-textSecondary uppercase tracking-wider text-left">
            Entitlement Audit Log
            {auditLog.length > 0 && (
              <span className="ml-2 text-xs font-normal text-pnp-textSecondary normal-case tracking-normal">
                ({auditLog.length} {auditLog.length === 1 ? "entry" : "entries"})
              </span>
            )}
          </h2>
          <span className="text-pnp-textSecondary flex-shrink-0">
            <IconChevronDown open={auditOpen} />
          </span>
        </button>

        {auditOpen && (
          <div id="entitlement-audit-log" className="px-5 border-t border-pnp-border">
            {auditLog.length === 0 ? (
              <p className="py-8 text-center text-sm text-pnp-textSecondary">
                No audit log entries yet.
              </p>
            ) : (
              <div>
                {auditLog.map((entry) => (
                  <AuditLogEntry key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Revoke confirmation modal */}
      <ConfirmModal
        open={revokeTarget !== null}
        title="Revoke Entitlement"
        message={
          revokeTarget
            ? `Are you sure you want to revoke "${revokeTarget.add_on_name}" from this user? This cannot be undone.`
            : ""
        }
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
        loading={revokeLoading}
      />
    </>
  );
}
