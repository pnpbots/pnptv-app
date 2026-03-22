import React, { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";

interface LiveRulesModalProps {
  onAcknowledge: () => void;
}

interface Rule {
  title: string;
  body: string;
}

interface ModalStrings {
  title: string;
  rules: Rule[];
  footer: string;
  button: string;
}

const MODAL_STRINGS: Record<"en" | "es", ModalStrings> = {
  en: {
    title: "Community Guidelines for Live Streams",
    rules: [
      {
        title: "Respect Body Autonomy",
        body: "We fully support everyone's body autonomy. Please do not ask a model to do anything they are not comfortable with.",
      },
      {
        title: "Privacy Respected",
        body: "We respect your privacy and do not spy on chats. However, we have features to detect when transactions outside the app are being discussed.",
      },
      {
        title: "No Outside Transactions",
        body: "Making transactions outside PNPtv is grounds for immediate ban, membership cancellation without refund, and expulsion of the performer. PNPtv holds no responsibility for any business conducted with models outside the app.",
      },
      {
        title: "Buy Tips Before Streaming",
        body: "For the best experience, purchase your tips before joining a stream.",
      },
      {
        title: "Everyone is Equal",
        body: "We do not use color codes based on token amounts. Every viewer is treated the same.",
      },
      {
        title: "No Tip Refunds",
        body: "All tips are final. We do not offer refunds on tips.",
      },
    ],
    footer: "By clicking 'I Acknowledge', you confirm you have read and agree to these guidelines.",
    button: "I Acknowledge",
  },
  es: {
    title: "Normas de la Comunidad para Transmisiones en Vivo",
    rules: [
      {
        title: "Respeta la Autonomía Corporal",
        body: "Apoyamos completamente la autonomía corporal de todos. Por favor, no le pidas a un modelo que haga algo con lo que no se sienta cómodo.",
      },
      {
        title: "Privacidad Respetada",
        body: "Respetamos tu privacidad y no espiamos los chats. Sin embargo, tenemos funciones para detectar cuando se discuten transacciones fuera de la aplicación.",
      },
      {
        title: "Sin Transacciones Externas",
        body: "Realizar transacciones fuera de PNPtv es motivo de baneo inmediato, cancelación de membresía sin reembolso y expulsión del modelo. PNPtv no se hace responsable de ningún negocio realizado con los modelos fuera de la aplicación.",
      },
      {
        title: "Compra Tips Antes de la Transmisión",
        body: "Para una mejor experiencia, compra tus tips antes de unirte a una transmisión.",
      },
      {
        title: "Todos Somos Iguales",
        body: "No usamos códigos de colores basados en la cantidad de tokens. Todos los espectadores son tratados por igual.",
      },
      {
        title: "Sin Reembolsos de Tips",
        body: "Todos los tips son finales. No ofrecemos reembolsos de tips.",
      },
    ],
    footer: "Al hacer clic en 'Acepto', confirmas que has leído y aceptas estas normas.",
    button: "Acepto",
  },
};

const RULE_ICONS = ["\u270b", "\ud83d\udd12", "\ud83d\udEab", "\ud83d\udcb0", "\u2696\ufe0f", "\ud83d\udea9"] as const;

export function LiveRulesModal({ onAcknowledge }: LiveRulesModalProps) {
  const t = useI18n();
  const [acknowledging, setAcknowledging] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const strings: ModalStrings =
    MODAL_STRINGS[t.lang as "en" | "es"] ?? MODAL_STRINGS.en;

  // Focus the acknowledge button on mount
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  // Focus trap: keep focus within modal
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleAcknowledge = async () => {
    if (acknowledging) return;
    setAcknowledging(true);
    try {
      await onAcknowledge();
    } finally {
      setAcknowledging(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-rules-title"
        className="w-full sm:max-w-lg bg-pnp-surface border border-pnp-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh]"
      >
        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-5 pb-3 border-b border-pnp-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-pnp-accent/10 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-pnp-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <h2
              id="live-rules-title"
              className="text-sm font-semibold text-pnp-textPrimary leading-snug"
            >
              {strings.title}
            </h2>
          </div>
        </div>

        {/* Scrollable rules list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {strings.rules.map((rule, idx) => (
            <div key={idx} className="flex gap-3">
              <span
                className="flex-shrink-0 w-8 h-8 rounded-full bg-pnp-background border border-pnp-border flex items-center justify-center text-base leading-none"
                aria-hidden="true"
              >
                {RULE_ICONS[idx] ?? "\u2022"}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-pnp-textPrimary mb-0.5">
                  {idx + 1}. {rule.title}
                </p>
                <p className="text-xs text-pnp-textSecondary leading-relaxed">
                  {rule.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer + CTA */}
        <div className="flex-shrink-0 px-5 pb-6 pt-4 border-t border-pnp-border space-y-3">
          <p className="text-[11px] text-pnp-textSecondary text-center leading-relaxed">
            {strings.footer}
          </p>
          <button
            ref={buttonRef}
            onClick={handleAcknowledge}
            disabled={acknowledging}
            className="w-full py-3 rounded-xl btn-gradient text-white text-sm font-semibold disabled:opacity-60 transition-opacity active:scale-[0.98] transition-transform"
          >
            {acknowledging ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {strings.button}
              </span>
            ) : (
              strings.button
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
