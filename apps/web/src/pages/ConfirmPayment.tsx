import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";

interface ConfirmResult {
  plan: { id: string; name: string; description?: string };
  payment: { provider: string; amount?: number };
}

const STRINGS = {
  en: {
    verifying: "Verifying your payment…",
    confirmed: "Payment Confirmed!",
    alreadyUsed: "This confirmation link has already been used.",
    expired: "This confirmation link is invalid or has expired.",
    error: "Something went wrong. Please contact support.",
    goHome: "Go to App",
    planLabel: "Plan",
    providerLabel: "Provider",
  },
  es: {
    verifying: "Verificando tu pago…",
    confirmed: "¡Pago Confirmado!",
    alreadyUsed: "Este enlace de confirmación ya fue utilizado.",
    expired: "Este enlace de confirmación es inválido o ha expirado.",
    error: "Algo salió mal. Por favor contacta soporte.",
    goHome: "Ir a la App",
    planLabel: "Plan",
    providerLabel: "Proveedor",
  },
};

export default function ConfirmPayment() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { lang } = useI18n();
  const t = STRINGS[lang] ?? STRINGS.en;

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setErrorMsg(t.expired);
      setStatus("error");
      return;
    }

    fetch(`/api/confirm-payment/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setResult(data);
          setStatus("success");
        } else {
          const msg = data.error ?? "";
          if (msg.includes("already been used")) {
            setErrorMsg(t.alreadyUsed);
          } else if (msg.includes("Invalid") || msg.includes("expired")) {
            setErrorMsg(t.expired);
          } else {
            setErrorMsg(msg || t.error);
          }
          setStatus("error");
        }
      })
      .catch(() => {
        setErrorMsg(t.error);
        setStatus("error");
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <div className="w-12 h-12 border-4 border-[#D4007A] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-white/60 text-sm">{t.verifying}</p>
          </div>
        )}

        {status === "success" && result && (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-[#D4007A]/20 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-[#D4007A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">{t.confirmed}</h1>
              <p className="text-[#D4007A] font-semibold text-lg">{result.plan.name}</p>
            </div>
            {result.plan.description && (
              <p className="text-white/60 text-sm">{result.plan.description}</p>
            )}
            <button
              onClick={() => navigate("/")}
              className="w-full py-3 px-6 bg-[#D4007A] hover:bg-[#b8006a] text-white font-semibold rounded-xl transition-colors"
            >
              {t.goHome}
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <p className="text-white/80 text-base">{errorMsg}</p>
            </div>
            <button
              onClick={() => navigate("/")}
              className="w-full py-3 px-6 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-colors"
            >
              {t.goHome}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
