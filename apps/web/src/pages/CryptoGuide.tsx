import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

type Lang = "en" | "es";

const LANG_KEY = "pnptv:lang";

function getInitialLang(): Lang {
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (s === "en" || s === "es") return s;
  } catch { /* ignore */ }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const isEn = lang === "en";
  const base: React.CSSProperties = { background: "none", border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 18, minHeight: 36, minWidth: 44 };
  return (
    <div style={{ display: "flex", background: "rgba(255,255,255,0.10)", borderRadius: 20, padding: 2 }}>
      <button onClick={() => onChange("en")} style={{ ...base, background: isEn ? "#fff" : "transparent", color: isEn ? "#120d14" : "#8E8E93" }}>EN</button>
      <button onClick={() => onChange("es")} style={{ ...base, background: !isEn ? "#fff" : "transparent", color: !isEn ? "#120d14" : "#8E8E93" }}>ES</button>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2, color: "#26a17b" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

const S = {
  en: {
    pageTitle: "How to Pay — PNPtv!",
    heroEyebrow: "PAYMENT GUIDE",
    heroTitle: "How to Pay on PNPtv",
    heroSubtitle: "Credit card, crypto, or Dash — pick what works for you.",
    whyTitle: "Why pay with crypto?",
    why: [
      { e: "🔒", t: "100% private", b: "No bank statement. No name attached to the transaction. Your business stays yours." },
      { e: "🌎", t: "Works from any country", b: "No card declines, no geo-blocks, no \"your card isn't supported\" messages." },
      { e: "💰", t: "Save 20% on most plans", b: "Yearly and lifetime plans get an automatic 20% discount when you pay with crypto." },
      { e: "⚡", t: "Fast & reliable", b: "Payments settle in minutes. No chargebacks, no reversals." },
    ],
    cardTitle: "Option 1 — Credit or Debit Card (fastest)",
    cardWhat: "Pay directly with your Visa or Mastercard. Most cards from any country are accepted. Checkout is handled by ePayco — a PCI-certified payment processor.",
    cardWhy: "Best for: anyone who wants to pay right now. No crypto needed.",
    cardSteps: [
      {
        n: "1",
        title: "Go to the Subscribe page and pick a plan",
        body: "Go to pnptv.app/subscribe (or /lifetime100 for the $100 Lifetime deal). Choose your plan — Weekly, Monthly, Yearly, or Lifetime — and click \"Pay with Card\".",
        links: [
          { label: "Subscribe ↗", href: "/subscribe" },
          { label: "Lifetime $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "2",
        title: "Enter your card details",
        body: "Fill in your full name, card number, expiry date, and CVV. Make sure the billing name matches your card exactly.",
        links: [],
      },
      {
        n: "3",
        title: "⏳ Wait for the 3D Secure verification popup",
        body: "After submitting your card, your bank will trigger a security check. A popup or redirect may appear asking you to confirm the payment — either in your banking app, by SMS code, or via a security question. THIS CAN TAKE 20–30 SECONDS TO APPEAR. Do NOT close the tab, press Back, or refresh the page while waiting. If nothing appears after 60 seconds, your bank may have approved it silently — keep waiting.",
        links: [],
        warning: "💡 Tip: Check your phone — your bank may send a push notification or SMS to approve the payment.",
      },
      {
        n: "4",
        title: "Your PRIME access activates instantly",
        body: "Once approved, you'll see a confirmation screen and receive a notification inside PNPtv. Your PRIME access is live immediately — no waiting.",
        links: [],
      },
    ],
    usdcTitle: "Option 2 — USDC (recommended for beginners)",
    usdcWhat: "USDC is a digital dollar. 1 USDC = $1 USD, always. It doesn't go up or down in value like Bitcoin. You buy exactly what you need and spend it.",
    usdcWhy: "Best for: anyone new to crypto. Stable value, easy to buy, works everywhere.",
    usdcSteps: [
      {
        n: "1",
        title: "Get a free crypto account",
        body: "Download Coinbase, Binance, or Kraken — all free, available on iOS and Android. Create an account with your email. Takes about 2 minutes.",
        links: [
          { label: "Coinbase ↗", href: "https://www.coinbase.com/signup" },
          { label: "Binance ↗", href: "https://www.binance.com/en/register" },
          { label: "Kraken ↗", href: "https://www.kraken.com/sign-up" },
        ],
      },
      {
        n: "2",
        title: "Buy USDC",
        body: "Search for \"USDC\" in the app. Buy the amount you need — if your plan costs $30, buy $30 of USDC. The price is always $1 per USDC. You can pay with a debit card or bank transfer.",
        links: [
          { label: "Buy on Coinbase ↗", href: "https://www.coinbase.com/price/usd-coin" },
          { label: "Buy on MoonPay ↗", href: "https://www.moonpay.com/buy/usdc" },
        ],
      },
      {
        n: "3",
        title: "Go to PNPtv and pick a plan",
        body: "Go to pnptv.app/subscribe (or /lifetime100 for the Lifetime PRIME deal). Choose your plan and select \"USDC\" as the payment method.",
        links: [
          { label: "Subscribe page ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "4",
        title: "Complete the NowPayments checkout",
        body: "A secure NowPayments page opens. It shows you a wallet address and a QR code. In your Coinbase/Binance app, go to \"Send\" → paste the address → confirm. Your membership activates automatically when the payment confirms.",
        links: [],
      },
    ],
    dashTitle: "Option 3 — Dash (most private)",
    dashWhat: "Dash is a cryptocurrency built for fast, private payments. Unlike USDC, the price can fluctuate — but invoices are fixed in USD so you always pay the right amount.",
    dashWhy: "Best for: users who already have Dash or want maximum privacy. No account needed on our end — just scan and send.",
    dashSteps: [
      {
        n: "1",
        title: "Get a Dash wallet",
        body: "Download the official Dash wallet or use an exchange like Kraken or Uphold to hold your Dash.",
        links: [
          { label: "Dash Wallet ↗", href: "https://www.dash.org/downloads/" },
          { label: "Kraken ↗", href: "https://www.kraken.com/learn/buy-dash-coin" },
          { label: "Uphold ↗", href: "https://uphold.com/en/assets/crypto/buy-dash" },
        ],
      },
      {
        n: "2",
        title: "Buy Dash",
        body: "Buy the USD equivalent you need. For example, if your plan costs $30, buy ~$31 worth of Dash (a tiny bit extra covers any price movement). Kraken and Uphold both sell Dash directly.",
        links: [
          { label: "Buy on Kraken ↗", href: "https://www.kraken.com/learn/buy-dash-coin" },
          { label: "Buy on MoonPay ↗", href: "https://www.moonpay.com/buy/dash" },
        ],
      },
      {
        n: "3",
        title: "Go to PNPtv and pick a plan",
        body: "Go to pnptv.app/subscribe or /lifetime100. Select your plan and tap \"Dash\" as the payment method.",
        links: [
          { label: "Subscribe page ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "4",
        title: "Scan the QR code and send Dash",
        body: "A QR code and a Dash address appear. Open your Dash wallet → tap \"Send\" → scan the QR code or paste the address → confirm. The exact DASH amount is shown — send that amount. Your membership activates as soon as the payment is detected on the network (usually under 2 minutes).",
        links: [],
      },
    ],
    faqTitle: "Common questions",
    faq: [
      {
        q: "My card was charged but my account wasn't activated.",
        a: "This happens sometimes when our system doesn't receive the payment confirmation in time. Your access will activate automatically within 15 minutes. If it hasn't after 15 minutes, contact support and we'll fix it manually.",
      },
      {
        q: "Why does the 3D Secure popup take so long?",
        a: "The delay is on your bank's side — they're running fraud checks before showing you the verification screen. This is normal. The longest wait we've seen is about 45 seconds. Just keep the page open.",
      },
      {
        q: "My card was declined. What do I do?",
        a: "Try a different card, or use USDC — it works from any country without declines. You can also contact your bank to authorize international online payments.",
      },
      {
        q: "What if my crypto payment doesn't confirm?",
        a: "If you sent the payment but your account wasn't activated, contact us at pnptv.app/contact. We can recover it manually with your transaction ID.",
      },
      {
        q: "Can I pay with Bitcoin or other crypto?",
        a: "USDC and Dash are our currently supported options. USDC works on Ethereum, Base, Polygon, Solana, TRON, and more — so you have lots of networks to choose from.",
      },
      {
        q: "Is the discount applied automatically?",
        a: "Yes. For most yearly and lifetime plans, the 20% crypto discount is applied automatically when you select Dash or USDC as your payment method. The Lifetime PRIME $80 offer is already at its fixed crypto price.",
      },
      {
        q: "Is it safe?",
        a: "Yes. We use BTCPay Server (open-source, self-hosted) for Dash and NowPayments for USDC. We never see or store your wallet address beyond the transaction.",
      },
    ],
    ctaTitle: "Ready to pay?",
    ctaCard: "Pay with Card →",
    ctaSubscribe: "Go to Subscribe →",
    ctaLifetime: "Lifetime PRIME $80 →",
    backHome: "← Back to PNPtv",
    needHelp: "Still stuck? Contact support →",
  },
  es: {
    pageTitle: "Cómo Pagar — PNPtv!",
    heroEyebrow: "GUÍA DE PAGOS",
    heroTitle: "Cómo Pagar en PNPtv",
    heroSubtitle: "Tarjeta, cripto o Dash — elige lo que más te convenga.",
    whyTitle: "¿Por qué pagar con cripto?",
    why: [
      { e: "🔒", t: "100% privado", b: "Sin estado de cuenta. Sin nombre asociado a la transacción. Tu privacidad es lo primero." },
      { e: "🌎", t: "Funciona desde cualquier país", b: "Sin rechazos de tarjeta, sin bloqueos geográficos, sin mensajes de \"tarjeta no soportada\"." },
      { e: "💰", t: "Ahorra 20% en la mayoría de planes", b: "Los planes anuales y lifetime obtienen un 20% de descuento automático al pagar con cripto." },
      { e: "⚡", t: "Rápido y confiable", b: "Los pagos se confirman en minutos. Sin contracargos, sin reversiones." },
    ],
    cardTitle: "Opción 1 — Tarjeta de Crédito o Débito (más rápido)",
    cardWhat: "Paga directamente con tu Visa o Mastercard. Se aceptan tarjetas de la mayoría de países. El cobro lo procesa ePayco — un procesador de pagos certificado PCI.",
    cardWhy: "Ideal para: quienes quieren pagar ahora mismo. Sin cripto.",
    cardSteps: [
      {
        n: "1",
        title: "Ve a Suscripciones y elige un plan",
        body: "Ve a pnptv.app/subscribe (o /lifetime80 para la oferta Lifetime de $80). Elige tu plan — Semanal, Mensual, Anual o Lifetime — y haz clic en \"Pagar con Tarjeta\".",
        links: [
          { label: "Suscripciones ↗", href: "/subscribe" },
          { label: "Lifetime $80 ↗", href: "/lifetime80" },
        ],
      },
      {
        n: "2",
        title: "Ingresa los datos de tu tarjeta",
        body: "Completa tu nombre completo, número de tarjeta, fecha de vencimiento y CVV. Asegúrate de que el nombre coincida exactamente con el de tu tarjeta.",
        links: [],
      },
      {
        n: "3",
        title: "⏳ Espera la verificación 3D Secure",
        body: "Después de enviar tu tarjeta, tu banco iniciará una verificación de seguridad. Puede aparecer una ventana emergente o redirigirte para confirmar el pago — ya sea en tu app bancaria, por código SMS o con una pregunta de seguridad. ESTO PUEDE TARDAR 20 A 30 SEGUNDOS EN APARECER. No cierres la pestaña, no presiones Atrás ni recargues la página mientras esperas. Si no aparece nada después de 60 segundos, tu banco puede haberlo aprobado de forma silenciosa — sigue esperando.",
        links: [],
        warning: "💡 Consejo: Revisa tu teléfono — tu banco puede enviar una notificación push o SMS para aprobar el pago.",
      },
      {
        n: "4",
        title: "Tu acceso PRIME se activa al instante",
        body: "Una vez aprobado, verás una pantalla de confirmación y recibirás una notificación dentro de PNPtv. Tu acceso PRIME está activo de inmediato — sin esperas.",
        links: [],
      },
    ],
    usdcTitle: "Opción 2 — USDC (recomendado para principiantes)",
    usdcWhat: "USDC es un dólar digital. 1 USDC = $1 USD, siempre. No sube ni baja de valor como el Bitcoin. Compras exactamente lo que necesitas y lo gastas.",
    usdcWhy: "Ideal para: quienes son nuevos en cripto. Valor estable, fácil de comprar, funciona en todas partes.",
    usdcSteps: [
      {
        n: "1",
        title: "Crea una cuenta de cripto gratis",
        body: "Descarga Coinbase, Binance o Kraken — todos gratuitos, disponibles en iOS y Android. Crea una cuenta con tu correo. Tarda unos 2 minutos.",
        links: [
          { label: "Coinbase ↗", href: "https://www.coinbase.com/signup" },
          { label: "Binance ↗", href: "https://www.binance.com/en/register" },
          { label: "Kraken ↗", href: "https://www.kraken.com/sign-up" },
        ],
      },
      {
        n: "2",
        title: "Compra USDC",
        body: "Busca \"USDC\" en la app. Compra el monto que necesitas — si tu plan cuesta $30, compra $30 de USDC. El precio siempre es $1 por USDC. Puedes pagar con tarjeta de débito o transferencia bancaria.",
        links: [
          { label: "Comprar en Coinbase ↗", href: "https://www.coinbase.com/price/usd-coin" },
          { label: "Comprar en MoonPay ↗", href: "https://www.moonpay.com/buy/usdc" },
        ],
      },
      {
        n: "3",
        title: "Ve a PNPtv y elige un plan",
        body: "Ve a pnptv.app/subscribe (o /lifetime80 para la oferta Lifetime PRIME). Elige tu plan y selecciona \"USDC\" como método de pago.",
        links: [
          { label: "Página de suscripción ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $80 ↗", href: "/lifetime80" },
        ],
      },
      {
        n: "4",
        title: "Completa el checkout de NowPayments",
        body: "Se abre una página segura de NowPayments con una dirección de wallet y un código QR. En tu app de Coinbase/Binance, ve a \"Enviar\" → pega la dirección → confirma. Tu membresía se activa automáticamente cuando el pago se confirma.",
        links: [],
      },
    ],
    dashTitle: "Opción 3 — Dash (más privado)",
    dashWhat: "Dash es una criptomoneda creada para pagos rápidos y privados. A diferencia del USDC, el precio puede fluctuar — pero las facturas se fijan en USD para que siempre pagues el monto correcto.",
    dashWhy: "Ideal para: usuarios que ya tienen Dash o quieren máxima privacidad. No necesitas cuenta en nuestro lado — solo escanea y envía.",
    dashSteps: [
      {
        n: "1",
        title: "Obtén una wallet de Dash",
        body: "Descarga la wallet oficial de Dash o usa un exchange como Kraken o Uphold para guardar tu Dash.",
        links: [
          { label: "Wallet Dash ↗", href: "https://www.dash.org/downloads/" },
          { label: "Kraken ↗", href: "https://www.kraken.com/learn/buy-dash-coin" },
          { label: "Uphold ↗", href: "https://uphold.com/en/assets/crypto/buy-dash" },
        ],
      },
      {
        n: "2",
        title: "Compra Dash",
        body: "Compra el equivalente en USD que necesitas. Por ejemplo, si tu plan cuesta $30, compra ~$31 de Dash (un poco más cubre cualquier variación de precio). Kraken y Uphold venden Dash directamente.",
        links: [
          { label: "Comprar en Kraken ↗", href: "https://www.kraken.com/learn/buy-dash-coin" },
          { label: "Comprar en MoonPay ↗", href: "https://www.moonpay.com/buy/dash" },
        ],
      },
      {
        n: "3",
        title: "Ve a PNPtv y elige un plan",
        body: "Ve a pnptv.app/subscribe o /lifetime80. Elige tu plan y toca \"Dash\" como método de pago.",
        links: [
          { label: "Página de suscripción ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $80 ↗", href: "/lifetime80" },
        ],
      },
      {
        n: "4",
        title: "Escanea el código QR y envía Dash",
        body: "Aparece un código QR y una dirección Dash. Abre tu wallet → toca \"Enviar\" → escanea el QR o pega la dirección → confirma. El monto exacto en DASH se muestra — envía ese monto. Tu membresía se activa en cuanto el pago se detecta en la red (generalmente menos de 2 minutos).",
        links: [],
      },
    ],
    faqTitle: "Preguntas frecuentes",
    faq: [
      {
        q: "Mi tarjeta fue cobrada pero mi cuenta no se activó.",
        a: "Esto ocurre a veces cuando nuestro sistema no recibe la confirmación del pago a tiempo. Tu acceso se activará automáticamente en 15 minutos. Si no es así, contáctanos y lo resolvemos manualmente.",
      },
      {
        q: "¿Por qué tarda tanto el popup de 3D Secure?",
        a: "El retraso es del lado de tu banco — están ejecutando verificaciones antifraude antes de mostrarte la pantalla de verificación. Esto es normal. La espera más larga que hemos visto es de unos 45 segundos. Solo mantén la página abierta.",
      },
      {
        q: "Mi tarjeta fue rechazada. ¿Qué hago?",
        a: "Prueba con otra tarjeta, o usa USDC — funciona desde cualquier país sin rechazos. También puedes contactar a tu banco para autorizar pagos internacionales en línea.",
      },
      {
        q: "¿Qué pasa si mi pago en cripto no se confirma?",
        a: "Si enviaste el pago pero tu cuenta no se activó, contáctanos en pnptv.app/contact. Podemos recuperarlo manualmente con tu ID de transacción.",
      },
      {
        q: "¿Puedo pagar con Bitcoin u otro cripto?",
        a: "USDC y Dash son nuestras opciones actualmente disponibles. USDC funciona en Ethereum, Base, Polygon, Solana, TRON y más — así que tienes muchas redes para elegir.",
      },
      {
        q: "¿El descuento se aplica automáticamente?",
        a: "Sí. En la mayoría de planes anuales y lifetime, el 20% de descuento cripto se aplica automáticamente al seleccionar Dash o USDC. La oferta Lifetime PRIME $80 ya está a su precio cripto fijo.",
      },
      {
        q: "¿Es seguro?",
        a: "Sí. Usamos BTCPay Server (código abierto, alojado por nosotros) para Dash y NowPayments para USDC. Nunca vemos ni guardamos tu dirección de wallet más allá de la transacción.",
      },
    ],
    ctaTitle: "¿Listo para pagar?",
    ctaCard: "Pagar con Tarjeta →",
    ctaSubscribe: "Ir a Suscripciones →",
    ctaLifetime: "Lifetime PRIME $80 →",
    backHome: "← Volver a PNPtv",
    needHelp: "¿Aún con dudas? Contacta soporte →",
  },
};

function Step({ n, title, body, links, color, warning }: { n: string; title: string; body: string; links: { label: string; href: string }[]; color: string; warning?: string }) {
  const isWarningStep = !!warning;
  const bubbleColor = isWarningStep ? "#f59e0b" : color;
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
      <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: bubbleColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff" }}>{n}</div>
      <div style={{ flex: 1 }}>
        <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "#ffffff", lineHeight: 1.3 }}>{title}</p>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>{body}</p>
        {warning && (
          <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#fbbf24", marginBottom: 10 }}>
            {warning}
          </div>
        )}
        {links.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {links.map((l) => (
              <a key={l.href} href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer"
                style={{ fontSize: 12, fontWeight: 600, color, textDecoration: "none", padding: "4px 10px", borderRadius: 20, border: `1px solid ${color}33`, background: `${color}11` }}>
                {l.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CryptoGuide() {
  const [lang, setLang] = useState<Lang>(getInitialLang);
  const s = S[lang];

  useEffect(() => { document.title = s.pageTitle; }, [s.pageTitle]);

  const handleLangChange = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--pnp-background)", color: "#ffffff", overflowX: "hidden" }}>
      {/* Ambient glow */}
      <div aria-hidden="true" style={{ position: "fixed", top: "-20%", left: "50%", transform: "translateX(-50%)", width: "100vw", height: "100vw", background: "radial-gradient(circle, rgba(38,161,123,0.10) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <header style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", maxWidth: 720, margin: "0 auto" }}>
        <a href="/" style={{ display: "flex" }}>
          <img src="/logo-header.png" alt="PNPtv!" style={{ height: 32, width: "auto" }} />
        </a>
        <LangToggle lang={lang} onChange={handleLangChange} />
      </header>

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 680, margin: "0 auto", padding: "0 20px 80px" }}>

        {/* Hero */}
        <section style={{ textAlign: "center", padding: "8px 0 28px" }}>
          <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#26a17b" }}>{s.heroEyebrow}</p>
          <h1 style={{ margin: "0 0 12px", fontSize: "clamp(22px, 5vw, 30px)", fontWeight: 900, lineHeight: 1.15 }}>{s.heroTitle}</h1>
          <p style={{ margin: "0 0 24px", fontSize: 15, color: "#9ca3af" }}>{s.heroSubtitle}</p>
          {/* Method picker strip */}
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
            <a href="#card" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 24, background: "rgba(212,0,122,0.12)", border: "1px solid rgba(212,0,122,0.35)", color: "#f472b6", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
              💳 {lang === "en" ? "Credit/Debit Card" : "Tarjeta"}
            </a>
            <a href="#usdc" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 24, background: "rgba(38,161,123,0.12)", border: "1px solid rgba(38,161,123,0.35)", color: "#26a17b", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
              🪙 USDC
            </a>
            <a href="#dash" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 24, background: "rgba(0,141,228,0.12)", border: "1px solid rgba(0,141,228,0.35)", color: "#008DE4", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
              🥷 Dash
            </a>
          </div>
        </section>

        {/* Why crypto */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>{s.whyTitle}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {s.why.map((w) => (
              <div key={w.t} style={{ padding: "16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 }}>
                <span style={{ fontSize: 22 }}>{w.e}</span>
                <p style={{ margin: "8px 0 4px", fontSize: 13, fontWeight: 700, color: "#ffffff" }}>{w.t}</p>
                <p style={{ margin: 0, fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>{w.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Card Section */}
        <section id="card" style={{ marginBottom: 48 }}>
          <div style={{ padding: "20px 20px 24px", background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.25)", borderRadius: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>💳</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#D4007A" }}>{s.cardTitle}</h2>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{s.cardWhat}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckIcon />
              <p style={{ margin: 0, fontSize: 13, color: "#D4007A", fontWeight: 600 }}>{s.cardWhy}</p>
            </div>
          </div>
          {s.cardSteps.map((step) => (
            <Step key={step.n} {...step} color="#D4007A" />
          ))}
        </section>

        {/* USDC Section */}
        <section id="usdc" style={{ marginBottom: 48 }}>
          <div style={{ padding: "20px 20px 24px", background: "rgba(38,161,123,0.06)", border: "1px solid rgba(38,161,123,0.25)", borderRadius: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>🪙</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#26a17b" }}>{s.usdcTitle}</h2>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{s.usdcWhat}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckIcon />
              <p style={{ margin: 0, fontSize: 13, color: "#26a17b", fontWeight: 600 }}>{s.usdcWhy}</p>
            </div>
          </div>
          {s.usdcSteps.map((step) => (
            <Step key={step.n} {...step} color="#26a17b" />
          ))}
        </section>

        {/* Dash Section */}
        <section id="dash" style={{ marginBottom: 48 }}>
          <div style={{ padding: "20px 20px 24px", background: "rgba(0,141,228,0.06)", border: "1px solid rgba(0,141,228,0.25)", borderRadius: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>🥷</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#008DE4" }}>{s.dashTitle}</h2>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{s.dashWhat}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckIcon />
              <p style={{ margin: 0, fontSize: 13, color: "#008DE4", fontWeight: 600 }}>{s.dashWhy}</p>
            </div>
          </div>
          {s.dashSteps.map((step) => (
            <Step key={step.n} {...step} color="#008DE4" />
          ))}
        </section>

        {/* FAQ */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>{s.faqTitle}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {s.faq.map((item) => (
              <details key={item.q} style={{ padding: "14px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, cursor: "pointer" }}>
                <summary style={{ fontWeight: 700, fontSize: 14, color: "#ffffff", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {item.q}
                  <span style={{ fontSize: 18, color: "#9ca3af", flexShrink: 0, marginLeft: 12 }}>+</span>
                </summary>
                <p style={{ margin: "12px 0 0", fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section style={{ textAlign: "center", padding: "32px 0" }}>
          <h2 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 800 }}>{s.ctaTitle}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <Link to="/subscribe" style={{ display: "block", width: "100%", maxWidth: 320, padding: "16px 24px", background: "#D4007A", color: "#ffffff", fontSize: 15, fontWeight: 800, textDecoration: "none", borderRadius: 14, textAlign: "center", letterSpacing: "0.03em" }}>
              {s.ctaCard}
            </Link>
            <Link to="/subscribe" style={{ display: "block", width: "100%", maxWidth: 320, padding: "16px 24px", background: "linear-gradient(90deg, #D4007A, #ff9933)", color: "#ffffff", fontSize: 15, fontWeight: 800, textDecoration: "none", borderRadius: 14, textAlign: "center", letterSpacing: "0.03em" }}>
              {s.ctaSubscribe}
            </Link>
            <Link to="/lifetime80" style={{ display: "block", width: "100%", maxWidth: 320, padding: "16px 24px", background: "linear-gradient(90deg, #26a17b, #008DE4)", color: "#ffffff", fontSize: 15, fontWeight: 800, textDecoration: "none", borderRadius: 14, textAlign: "center", letterSpacing: "0.03em" }}>
              {s.ctaLifetime}
            </Link>
            <a href="/contact" style={{ marginTop: 8, fontSize: 13, color: "#9ca3af", textDecoration: "underline" }}>{s.needHelp}</a>
          </div>
        </section>

        <div style={{ textAlign: "center", paddingBottom: 20 }}>
          <a href="/" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>{s.backHome}</a>
        </div>
      </div>
    </div>
  );
}
