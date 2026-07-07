import React, { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";

export default function CallConfirmPage() {
  const [seconds, setSeconds] = useState(15 * 60);

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const expired = seconds === 0;

  return (
    <>
      <Helmet>
        <title>Reserva confirmada — PNPtv!</title>
      </Helmet>

      <div style={{ minHeight: "100dvh", background: "#0a0a14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'Roboto Mono', monospace" }}>

        {/* Glow blob */}
        <div style={{ position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(212,0,122,.25) 0%, rgba(230,145,56,.12) 50%, transparent 70%)", filter: "blur(60px)", pointerEvents: "none" }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 480, width: "100%", textAlign: "center" }}>

          {/* Check icon */}
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #D4007A, #E69138)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", boxShadow: "0 0 40px rgba(212,0,122,.4)" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#fff", margin: "0 0 8px", letterSpacing: "0.04em" }}>
            ¡Pago recibido!
          </h1>
          <p style={{ color: "rgba(255,255,255,.5)", fontSize: "0.85rem", margin: "0 0 32px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Tu sesión está siendo coordinada
          </p>

          {/* Timer card */}
          <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(212,0,122,.3)", borderRadius: 20, padding: "24px 20px", marginBottom: 20 }}>
            <p style={{ color: "rgba(255,255,255,.6)", fontSize: "0.8rem", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Recibirás un DM de Santino o Lex en
            </p>
            <div style={{ fontSize: expired ? "1.2rem" : "2.8rem", fontWeight: 700, color: expired ? "rgba(255,255,255,.4)" : "#D4007A", letterSpacing: "0.05em" }}>
              {expired ? "En camino..." : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`}
            </div>
          </div>

          {/* Info cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>

            <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "flex-start", gap: 14, textAlign: "left" }}>
              <span style={{ fontSize: "1.3rem", flexShrink: 0, marginTop: 2 }}>⏰</span>
              <div>
                <p style={{ color: "#fff", fontWeight: 600, margin: "0 0 4px", fontSize: "0.9rem" }}>Disponibles ahora</p>
                <p style={{ color: "rgba(255,255,255,.55)", margin: 0, fontSize: "0.82rem", lineHeight: 1.5 }}>
                  Tanto Santino como Lex están disponibles durante las próximas <strong style={{ color: "#E69138" }}>3 horas</strong>. Confirman por orden de llegada.
                </p>
              </div>
            </div>

            <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "flex-start", gap: 14, textAlign: "left" }}>
              <span style={{ fontSize: "1.3rem", flexShrink: 0, marginTop: 2 }}>👤</span>
              <div>
                <p style={{ color: "#fff", fontWeight: 600, margin: "0 0 4px", fontSize: "0.9rem" }}>Una sesión, un modelo</p>
                <p style={{ color: "rgba(255,255,255,.55)", margin: 0, fontSize: "0.82rem", lineHeight: 1.5 }}>
                  Tu llamada es <strong style={{ color: "#fff" }}>con Santino O con Lex</strong>, no con los dos al mismo tiempo. Quien confirme primero será tu modelo para la sesión.
                </p>
              </div>
            </div>

            <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "flex-start", gap: 14, textAlign: "left" }}>
              <span style={{ fontSize: "1.3rem", flexShrink: 0, marginTop: 2 }}>📩</span>
              <div>
                <p style={{ color: "#fff", fontWeight: 600, margin: "0 0 4px", fontSize: "0.9rem" }}>Envía tu comprobante</p>
                <p style={{ color: "rgba(255,255,255,.55)", margin: 0, fontSize: "0.82rem", lineHeight: 1.5 }}>
                  Si aún no lo has hecho, envía la captura de tu pago por DM en PNPtv! para acelerar la confirmación.
                </p>
              </div>
            </div>

          </div>

          {/* CTA */}
          <a
            href="/"
            style={{ display: "inline-block", background: "linear-gradient(135deg, #D4007A, #E69138)", color: "#fff", fontWeight: 700, fontSize: "0.9rem", padding: "14px 32px", borderRadius: 50, textDecoration: "none", letterSpacing: "0.05em" }}
          >
            Ir a PNPtv! →
          </a>

          <p style={{ color: "rgba(255,255,255,.25)", fontSize: "0.72rem", marginTop: 24, lineHeight: 1.6 }}>
            PNPtv! · Sesiones privadas con modelos verificados
          </p>
        </div>
      </div>
    </>
  );
}
