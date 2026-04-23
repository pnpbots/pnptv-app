import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useLocation, useNavigate, Link } from "react-router-dom";
import { useLifetime100Strings, type Lifetime100Strings } from "@/lib/i18n/lifetime100";
import { sheets } from "@/pages/LandingPage";

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || "https://pnptv.app";
const LANG_STORAGE_KEY = "pnptv:lifetime100:lang";
const REDIRECT_DELAY_MS = 2500;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getInitialLang(): string {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // localStorage unavailable
  }
  return typeof navigator !== "undefined" ? navigator.language || "es" : "es";
}

function persistLang(lang: string): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Diamond icon matching static page aesthetic ────────────────────────────────

function DiamondIcon({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2 }}
    >
      <path d="M12 2L2 12L12 22L22 12L12 2Z" fill={color} />
    </svg>
  );
}

// ── Language toggle ────────────────────────────────────────────────────────────

interface LangToggleProps {
  lang: string;
  onChange: (lang: string) => void;
}

function LangToggle({ lang, onChange }: LangToggleProps) {
  const isEn = lang.toLowerCase().startsWith("en");

  const btnBase: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    borderRadius: 18,
    transition: "all 0.2s ease",
    minHeight: 36,
    minWidth: 44,
  };

  return (
    <div
      style={{
        display: "flex",
        background: "rgba(255,255,255,0.10)",
        borderRadius: 20,
        padding: 2,
      }}
      role="group"
      aria-label="Language toggle"
    >
      <button
        onClick={() => onChange("en")}
        style={{
          ...btnBase,
          background: isEn ? "#ffffff" : "transparent",
          color: isEn ? "#120d14" : "#8E8E93",
        }}
        aria-pressed={isEn}
      >
        EN
      </button>
      <button
        onClick={() => onChange("es")}
        style={{
          ...btnBase,
          background: !isEn ? "#ffffff" : "transparent",
          color: !isEn ? "#120d14" : "#8E8E93",
        }}
        aria-pressed={!isEn}
      >
        ES
      </button>
    </div>
  );
}

// ── Modal backdrop ─────────────────────────────────────────────────────────────

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(44,44,46,0.92)",
          border: "1px solid rgba(255,180,84,0.3)",
          borderRadius: 24,
          padding: "28px 24px",
          width: "100%",
          maxWidth: 420,
          boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
          animation: "lt100-fadeIn 0.25s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Email capture modal ────────────────────────────────────────────────────────

interface EmailModalProps {
  s: Lifetime100Strings;
  lang: string;
  onClose: () => void;
  onSuccess: (meruUrl: string | null) => void;
}

function EmailModal({ s, lang, onClose, onSuccess }: EmailModalProps) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Delay focus to allow animation to complete
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError(s.invalidEmail);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/public/lifetime100/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, language: lang }),
        credentials: "include",
      });
      const data = await res.json();
      if (res.status === 429) {
        setError(data.error || data.message || s.errorGeneric);
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.error || data.message || s.errorGeneric);
        return;
      }
      onSuccess(typeof data.meruUrl === "string" ? data.meruUrl : null);
    } catch {
      setError(s.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }, [email, lang, onSuccess, s]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <ModalOverlay onClose={!submitting ? onClose : undefined}>
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 20,
          fontWeight: 700,
          color: "#ffffff",
        }}
      >
        {s.modalTitle}
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: 14, color: "#8E8E93", lineHeight: 1.5 }}>
        {s.modalSubtitle}
      </p>

      <label
        htmlFor="lt100-email"
        style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#8E8E93", marginBottom: 6 }}
      >
        {s.emailLabel}
      </label>
      <input
        id="lt100-email"
        ref={inputRef}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(null); }}
        onKeyDown={handleKeyDown}
        placeholder={s.emailPlaceholder}
        disabled={submitting}
        style={{
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.3)",
          color: "#ffffff",
          fontSize: 16,
          marginBottom: 8,
          outline: "none",
          opacity: submitting ? 0.6 : 1,
        }}
        aria-describedby={error ? "lt100-email-error" : undefined}
        aria-invalid={!!error}
      />

      {error && (
        <p
          id="lt100-email-error"
          role="alert"
          style={{ margin: "0 0 12px", fontSize: 13, color: "#FF453A" }}
        >
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || !email.trim()}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "14px 20px",
          borderRadius: 12,
          border: "none",
          background: submitting || !email.trim()
            ? "rgba(255,51,119,0.4)"
            : "linear-gradient(90deg, #ff3377, #ff9933)",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          cursor: submitting || !email.trim() ? "not-allowed" : "pointer",
          minHeight: 48,
          transition: "opacity 0.15s",
        }}
      >
        {submitting && <Spinner size={16} />}
        {submitting ? s.modalSubmitting : s.modalSubmit}
      </button>

      <button
        onClick={onClose}
        disabled={submitting}
        style={{
          display: "block",
          width: "100%",
          marginTop: 10,
          padding: "10px",
          background: "none",
          border: "none",
          color: "#8E8E93",
          fontSize: 13,
          cursor: submitting ? "not-allowed" : "pointer",
          minHeight: 44,
        }}
      >
        {s.modalCancel}
      </button>
    </ModalOverlay>
  );
}

// ── Confirmation modal ─────────────────────────────────────────────────────────

interface ConfirmationModalProps {
  s: Lifetime100Strings;
  onClose: () => void;
  onDismiss: () => void;
  activateHref: string;
}

function ConfirmationModal({ s, onClose, onDismiss, activateHref }: ConfirmationModalProps) {
  return (
    <ModalOverlay onClose={onClose}>
      {/* Checkmark icon */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(230,145,56,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px",
        }}
        aria-hidden="true"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#E69138" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 20,
          fontWeight: 700,
          color: "#ffffff",
          textAlign: "center",
        }}
      >
        {s.confirmationTitle}
      </h2>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: "#8E8E93", lineHeight: 1.5, textAlign: "center" }}>
        {s.confirmationBody}
      </p>
      <p style={{ margin: "0 0 24px", fontSize: 12, color: "#8E8E93", textAlign: "center" }}>
        {s.confirmationCheckEmail}
      </p>

      <a
        href={activateHref}
        style={{
          display: "block",
          textAlign: "center",
          padding: "10px 16px",
          marginBottom: 8,
          borderRadius: 10,
          background: "rgba(255,180,84,0.12)",
          border: "1px solid rgba(255,180,84,0.3)",
          color: "#FFB454",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
        }}
        onClick={onClose}
      >
        {s.alreadyPaidLink}
      </a>

      <button
        onClick={onDismiss}
        style={{
          display: "block",
          width: "100%",
          padding: "12px",
          borderRadius: 12,
          border: "none",
          background: "linear-gradient(90deg, #ff3377, #ff9933)",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          minHeight: 48,
        }}
      >
        {s.confirmationClose}
      </button>
    </ModalOverlay>
  );
}

// ── Activate view ──────────────────────────────────────────────────────────────

interface ActivateViewProps {
  s: Lifetime100Strings;
  initialCode: string;
}

type ActivateError =
  | { type: "402" }
  | { type: "410" }
  | { type: "404" }
  | { type: "409" }
  | { type: "generic"; message: string };

function ActivateView({ s, initialCode }: ActivateViewProps) {
  const navigate = useNavigate();
  const [code, setCode] = useState(initialCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ActivateError | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount, unless a code is pre-filled (focus still helps)
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  const getErrorMessage = (err: ActivateError): string => {
    switch (err.type) {
      case "402": return s.errorPaymentNotReceived;
      case "410": return s.errorCodeExpired;
      case "404": return s.errorCodeInvalid;
      case "409": return s.errorGeneric; // already used — treated as generic
      default: return err.message;
    }
  };

  const handleActivate = useCallback(async () => {
    const trimmed = code.trim();
    if (trimmed.length < 3) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/public/lifetime100/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(true);
        setTimeout(() => {
          // Use assign() to force a fresh page load so session cookies bind properly
          window.location.assign(data.redirect || "/");
        }, REDIRECT_DELAY_MS);
        return;
      }
      if (res.status === 402) { setError({ type: "402" }); return; }
      if (res.status === 410) { setError({ type: "410" }); return; }
      if (res.status === 404) { setError({ type: "404" }); return; }
      if (res.status === 409) { setError({ type: "409" }); return; }
      setError({ type: "generic", message: data.error || s.errorGeneric });
    } catch {
      setError({ type: "generic", message: s.errorGeneric });
    } finally {
      setSubmitting(false);
    }
  }, [code, navigate, s]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleActivate();
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (success) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          textAlign: "center",
          padding: "32px 24px",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "rgba(255,153,51,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
          aria-hidden="true"
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="#ff9933" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 800, color: "#ffffff" }}>
          {s.activateSuccessTitle}
        </h2>
        <p style={{ margin: "0 0 24px", fontSize: 15, color: "#8E8E93", maxWidth: 320, lineHeight: 1.5 }}>
          {s.activateSuccessBody}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8E8E93", fontSize: 13 }}>
          <Spinner size={14} />
          <span>{s.activateSuccessBody}</span>
        </div>
      </div>
    );
  }

  // ── Activate form ──────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 24px 120px" }}>
      {/* Amber top glow */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100vw",
          height: "50vw",
          background: "radial-gradient(circle, rgba(255,153,51,0.10) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <h1
        style={{
          margin: "0 0 8px",
          fontSize: 26,
          fontWeight: 900,
          color: "#ffffff",
          lineHeight: 1.15,
        }}
      >
        {s.activateTitle}
      </h1>
      <p style={{ margin: "0 0 28px", fontSize: 15, color: "#8E8E93", lineHeight: 1.5 }}>
        {s.activateSubtitle}
      </p>

      <label
        htmlFor="lt100-code"
        style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#8E8E93", marginBottom: 6 }}
      >
        {s.codeLabel}
      </label>
      <input
        id="lt100-code"
        ref={inputRef}
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        onChange={(e) => { setCode(e.target.value); setError(null); }}
        onKeyDown={handleKeyDown}
        placeholder={s.codePlaceholder}
        disabled={submitting}
        style={{
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          padding: "14px 16px",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.3)",
          color: "#ffffff",
          fontSize: 18,
          fontWeight: 600,
          fontFamily: "monospace",
          letterSpacing: "0.05em",
          marginBottom: 12,
          outline: "none",
          opacity: submitting ? 0.6 : 1,
        }}
        aria-describedby={error ? "lt100-activate-error" : undefined}
        aria-invalid={!!error}
      />

      {error && (
        <p
          id="lt100-activate-error"
          role="alert"
          style={{ margin: "0 0 16px", fontSize: 13, color: "#FF453A", lineHeight: 1.4 }}
        >
          {getErrorMessage(error)}
        </p>
      )}

      <button
        onClick={handleActivate}
        disabled={submitting || code.trim().length < 3}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "16px 20px",
          borderRadius: 14,
          border: "none",
          background: submitting || code.trim().length < 3
            ? "rgba(255,51,119,0.4)"
            : "linear-gradient(90deg, #ff3377, #ff9933)",
          color: "#ffffff",
          fontSize: 15,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          cursor: submitting || code.trim().length < 3 ? "not-allowed" : "pointer",
          minHeight: 52,
          transition: "opacity 0.15s",
        }}
      >
        {submitting && <Spinner size={16} />}
        {submitting ? s.activateSubmitting : s.activateSubmit}
      </button>
    </div>
  );
}

// ── Default (hero) view ────────────────────────────────────────────────────────

interface HeroViewProps {
  s: Lifetime100Strings;
  available: number | null;
  availabilityLoading: boolean;
  lang: string;
  onLangChange: (lang: string) => void;
  onOpenSheet: (id: string) => void;
}

function HeroView({ s, available, availabilityLoading, lang, onLangChange, onOpenSheet }: HeroViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [meruUrl, setMeruUrl] = useState<string | null>(null);

  const isSoldOut = available === 0;
  const isClosed = !availabilityLoading && isSoldOut;

  const handleCtaClick = () => {
    if (isClosed) return;
    setModalOpen(true);
  };

  const handleReserveSuccess = (url: string | null) => {
    setMeruUrl(url);
    setModalOpen(false);
    setShowConfirmation(true);
  };

  const activateHref = `/lifetime100/activate`;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#120d14",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        paddingBottom: 200, // clearance for stacked pills + legal + CTA footer
      }}
    >
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: "-20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "100vw",
          height: "100vw",
          background:
            "radial-gradient(circle, rgba(255,0,204,0.13) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Header */}
      <header
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "20px 24px",
        }}
      >
        <a href="/" aria-label="PNPtv! home" style={{ display: "flex" }}>
          <img src="/logo-header.png" alt="PNPtv!" style={{ height: 36, width: "auto" }} />
        </a>
        <LangToggle lang={lang} onChange={onLangChange} />
      </header>

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 500,
          margin: "0 auto",
          padding: "0 16px",
        }}
      >
        {/* Hero */}
        <section style={{ textAlign: "center", padding: "12px 8px 20px" }}>
          <h1
            style={{
              fontSize: "clamp(26px, 7vw, 34px)",
              fontWeight: 900,
              lineHeight: 1.1,
              margin: "0 0 10px",
              textTransform: "uppercase",
            }}
          >
            {s.heroTitle}
          </h1>
          <p style={{ color: "#8E8E93", fontSize: 16, margin: 0 }}>
            {s.heroSubtitle}
          </p>
        </section>

        {/* Pricing glass card */}
        <div
          style={{
            background: "rgba(44,44,46,0.7)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,180,84,0.3)",
            borderRadius: 24,
            padding: "28px 24px",
            marginBottom: 16,
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          }}
        >
          {/* Velvet rope top border */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: 4,
              background: "linear-gradient(90deg, #ff3377, #ff9933)",
            }}
          />

          {/* Badge */}
          <span
            style={{
              display: "block",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "#ff9933",
              fontWeight: 700,
              marginBottom: 14,
            }}
          >
            {s.limitedBadge}
          </span>

          {/* Price */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <span
              style={{
                fontSize: 20,
                color: "#636366",
                textDecoration: "line-through",
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              {s.oldPrice}
            </span>
            <div
              style={{
                fontSize: "clamp(56px, 15vw, 72px)",
                fontWeight: 900,
                lineHeight: 1,
                textShadow: "0 0 30px rgba(255,180,84,0.4)",
                display: "flex",
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: "0.36em", marginTop: "0.55em", opacity: 0.8 }}>$</span>
              <span>100</span>
            </div>
          </div>

          {/* Benefits list */}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, textAlign: "left" }}>
            {s.benefits.map((benefit, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  marginBottom: 14,
                  fontSize: 14,
                  lineHeight: 1.4,
                  color: "rgba(255,255,255,0.9)",
                  gap: 12,
                }}
              >
                <DiamondIcon color="#ff9933" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Notice card — "Before you pay" */}
        <div
          role="note"
          style={{
            margin: "0 0 16px",
            padding: "18px 20px",
            borderRadius: 24,
            border: "1px solid rgba(255,153,51,0.45)",
            background:
              "linear-gradient(135deg, rgba(255,153,51,0.10), rgba(255,51,119,0.06))",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#ff9933",
            }}
          >
            {s.noticeTitle}
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              lineHeight: 1.55,
              color: "#d6d6dc",
              listStyleType: "disc",
            }}
          >
            <li style={{ marginBottom: 8 }}>{s.noticeFundraising}</li>
            <li style={{ marginBottom: 8 }}>{s.noticeEarlyAccess}</li>
            <li>{s.noticeInProgress}</li>
          </ul>
        </div>

        {/* Diamond separator */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 4,
            margin: "20px 0",
            opacity: 0.5,
          }}
        >
          <span style={{ color: "#ff3377" }}>⬥</span>
          <span style={{ color: "#8E8E93" }}>⬥</span>
          <span style={{ color: "#ff9933" }}>⬥</span>
        </div>

        {/* Already paid link */}
        <p style={{ textAlign: "center", fontSize: 13, color: "#8E8E93" }}>
          {s.alreadyPaid}{" "}
          <a
            href={activateHref}
            style={{
              color: "#ff9933",
              fontWeight: 600,
              borderBottom: "1px solid rgba(255,153,51,0.5)",
              textDecoration: "none",
            }}
          >
            {s.alreadyPaidLink}
          </a>
        </p>
      </div>

      {/* Sticky footer: nav pills + legal + CTA button, stacked */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          background:
            "linear-gradient(to top, rgba(18,13,20,0.98) 50%, rgba(18,13,20,0.9) 85%, transparent)",
          zIndex: 50,
          boxSizing: "border-box",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        {/* Pill nav — opens bottom sheets in-place (stays on /lifetime100) */}
        <nav style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }} aria-label="Explore PNPtv">
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", width: "max-content" }}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenSheet(item.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#cfcfd4",
                  cursor: "pointer",
                  flexShrink: 0,
                  background: "rgba(18,13,20,0.6)",
                }}
              >
                <span>{item.emoji}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Legal links */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            columnGap: 12,
            rowGap: 2,
            padding: "4px 16px 8px",
          }}
        >
          {LEGAL_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              style={{
                fontSize: 10,
                color: "rgba(207,207,212,0.5)",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {l.label}
            </a>
          ))}
        </div>

        {/* CTA button container */}
        <div style={{ padding: "4px 20px 0" }}>
        <button
          onClick={handleCtaClick}
          disabled={availabilityLoading || isClosed}
          aria-disabled={availabilityLoading || isClosed}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            maxWidth: 500,
            margin: "0 auto",
            padding: "18px 24px",
            borderRadius: 16,
            border: "none",
            background: isClosed
              ? "rgba(255,255,255,0.08)"
              : "linear-gradient(90deg, #ff3377, #ff9933)",
            color: isClosed ? "#8E8E93" : "#ffffff",
            fontSize: 15,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            cursor: availabilityLoading || isClosed ? "not-allowed" : "pointer",
            minHeight: 56,
            boxShadow: isClosed
              ? "none"
              : "0 8px 32px rgba(255,51,119,0.4)",
            transition: "opacity 0.15s, transform 0.1s",
          }}
          onMouseDown={(e) => {
            if (!isClosed) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)";
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
          onTouchStart={(e) => {
            if (!isClosed) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)";
          }}
          onTouchEnd={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
        >
          {availabilityLoading && <Spinner size={16} />}
          {availabilityLoading
            ? s.ctaLoading
            : isClosed
            ? s.ctaSoldOut
            : s.ctaGetAccess}
        </button>
        </div>
      </div>

      {/* Modals */}
      {modalOpen && !showConfirmation && (
        <EmailModal
          s={s}
          lang={lang}
          onClose={() => setModalOpen(false)}
          onSuccess={handleReserveSuccess}
        />
      )}
      {showConfirmation && (
        <ConfirmationModal
          s={s}
          onClose={() => setShowConfirmation(false)}
          onDismiss={() => {
            setShowConfirmation(false);
            if (meruUrl) {
              window.location.assign(meruUrl);
            } else {
              window.location.assign("/landing");
            }
          }}
          activateHref={activateHref}
        />
      )}
    </div>
  );
}

// ── Bottom nav + legal footer (mirrors LandingPage.tsx style) ─────────────────
// Pills deep-link to /landing?sheet=X so the user lands on the relevant bottom
// sheet on the main Landing page.

const NAV_ITEMS = [
  { id: "about",    emoji: "👋", label: "About" },
  { id: "feed",     emoji: "📣", label: "Feed" },
  { id: "hangouts", emoji: "🎙️", label: "Hangouts" },
  { id: "live",     emoji: "🔴", label: "Live" },
  { id: "nearby",   emoji: "📍", label: "Connect" },
  { id: "creators", emoji: "💰", label: "Creators" },
  { id: "payments", emoji: "💳", label: "Payments" },
  { id: "safety",   emoji: "🛡️", label: "Safety" },
] as const;

const LEGAL_LINKS = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Cookies", href: "/cookies" },
  { label: "Content Policy", href: "/content-policy" },
  { label: "DMCA", href: "/dmca" },
  { label: "Refunds", href: "/refunds" },
  { label: "Contact", href: "/contact" },
];

function NavFooter({ onOpenSheet }: { onOpenSheet: (id: string) => void }) {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: "rgba(18, 13, 20, 0.92)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <nav style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }} aria-label="Explore PNPtv">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", height: 48, width: "max-content" }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenSheet(item.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#cfcfd4",
                cursor: "pointer",
                flexShrink: 0,
                background: "transparent",
                transition: "color 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#ffffff";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#cfcfd4";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              }}
            >
              <span>{item.emoji}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          columnGap: 12,
          rowGap: 2,
          padding: "8px 16px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
        }}
      >
        {LEGAL_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            style={{
              fontSize: 10,
              color: "rgba(207,207,212,0.4)",
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#cfcfd4"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(207,207,212,0.4)"; }}
          >
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Bottom-sheet modal (mirrors LandingPage's sheet) ──────────────────────────
// Lets pills open sheet content IN-PLACE so the user stays on /lifetime100.

interface SheetModalProps {
  sheet: { title: string; emoji: string; body: React.ReactNode };
  onClose: () => void;
}

function SheetModal({ sheet, onClose }: SheetModalProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[60] glass-nav border-t border-pnp-border rounded-t-2xl overflow-y-auto animate-fade-in-up"
        style={{ maxHeight: "70dvh", animationDuration: "0.2s" }}
        role="dialog"
        aria-label={sheet.title}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-pnp-border" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-pnp-border sticky top-0 glass-nav">
          <div className="flex items-center gap-2">
            <span className="text-xl">{sheet.emoji}</span>
            <h2 className="text-sm font-bold text-white">{sheet.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-pnp-textSecondary hover:text-white hover:bg-pnp-surface transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-4">{sheet.body}</div>
        <div className="px-4 pb-6">
          <Link
            to="/join"
            onClick={onClose}
            className="btn-gradient block w-full text-center py-3 rounded-xl text-sm font-bold text-white"
          >
            Join free →
          </Link>
        </div>
      </div>
    </>
  );
}

// ── Root page ──────────────────────────────────────────────────────────────────

export default function Lifetime100() {
  const [searchParams] = useSearchParams();
  const location = useLocation();

  // Determine display mode
  const isActivatePath = location.pathname.includes("/activate");
  const modeParam = searchParams.get("mode");
  const codeParam = searchParams.get("code") || "";
  const isActivateMode = isActivatePath || modeParam === "activate" || !!codeParam;

  // Bottom-sheet state — pills open an in-place sheet instead of navigating
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  useEffect(() => {
    document.body.style.overflow = activeSheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [activeSheet]);
  const sheetData = activeSheet ? sheets[activeSheet] : null;

  // Language
  const [lang, setLang] = useState(getInitialLang);
  const s = useLifetime100Strings(lang);

  const handleLangChange = (next: string) => {
    setLang(next);
    persistLang(next);
  };

  // Availability (hero view only)
  const [available, setAvailable] = useState<number | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(!isActivateMode);

  useEffect(() => {
    document.title = s.pageTitle;
  }, [s.pageTitle]);

  useEffect(() => {
    if (isActivateMode) return;
    let cancelled = false;
    setAvailabilityLoading(true);
    fetch(`${API_BASE}/api/public/lifetime100/availability`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data.available === "number") {
          setAvailable(data.available);
        }
      })
      .catch(() => {
        // On error, don't block the CTA — treat as available
        if (!cancelled) setAvailable(null);
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => { cancelled = true; };
  }, [isActivateMode]);

  // Global keyframe injection (once)
  useEffect(() => {
    const STYLE_ID = "lt100-keyframes";
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes lt100-fadeIn {
        from { opacity: 0; transform: scale(0.96); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
    return () => {
      try { document.head.removeChild(style); } catch { /* already removed */ }
    };
  }, []);

  if (isActivateMode) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#120d14",
          color: "#ffffff",
          position: "relative",
          overflowX: "hidden",
          paddingBottom: 96, // clearance for fixed NavFooter
        }}
      >
        {/* Header with lang toggle */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "20px 24px",
          }}
        >
          <a href="/" aria-label="PNPtv! home" style={{ display: "flex" }}>
            <img src="/logo-header.png" alt="PNPtv!" style={{ height: 36, width: "auto" }} />
          </a>
          <LangToggle lang={lang} onChange={handleLangChange} />
        </header>

        <ActivateView s={s} initialCode={codeParam} />
        <NavFooter onOpenSheet={setActiveSheet} />
        {sheetData && (
          <SheetModal sheet={sheetData} onClose={() => setActiveSheet(null)} />
        )}
      </div>
    );
  }

  return (
    <>
    <HeroView
      s={s}
      available={available}
      availabilityLoading={availabilityLoading}
      lang={lang}
      onLangChange={handleLangChange}
      onOpenSheet={setActiveSheet}
    />
    {sheetData && (
      <SheetModal sheet={sheetData} onClose={() => setActiveSheet(null)} />
    )}
    </>
  );
}
