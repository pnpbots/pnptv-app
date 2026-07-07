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

function CheckIcon({ color = "#26a17b" }: { color?: string }) {
  return (
    <svg style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2, color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg style={{ width: 18, height: 18, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

const WALLETS = {
  metamask: {
    name: "MetaMask",
    emoji: "🦊",
    color: "#F6851B",
    android: "https://play.google.com/store/apps/details?id=io.metamask",
    ios: "https://apps.apple.com/app/metamask-blockchain-wallet/id1438144202",
  },
  trust: {
    name: "Trust Wallet",
    emoji: "👛",
    color: "#3375BB",
    android: "https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp",
    ios: "https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409",
  },
  dash: {
    name: "Dash Wallet",
    emoji: "🥷",
    color: "#008DE4",
    android: "https://play.google.com/store/apps/details?id=hashengineering.darkcoin.wallet",
    ios: "https://apps.apple.com/app/dash-wallet/id1206647026",
  },
};

const S = {
  en: {
    pageTitle: "Pay with Crypto — PNPtv!",
    heroEyebrow: "PAYMENT GUIDE",
    heroTitle: "Pay Free. Stay Private.",
    heroSubtitle: "No banks. No governments. No one's business but yours. Crypto is the payment method built for communities like ours.",

    manifestoTitle: "Why crypto is the right choice for our community",
    manifesto: [
      { e: "🔒", t: "Total privacy", b: "No bank statement. No transaction with your real name. No history visible to anyone — partner, employer, family. What you do here stays here." },
      { e: "🕊️", t: "Free from control", b: "Bitcoin and Dash are decentralized — no government, no bank, no corporation can freeze them, block them, or shut them down. Your money, your rules." },
      { e: "🌎", t: "Works everywhere", b: "Colombia, Mexico, USA, Spain, anywhere. No \"card not supported\", no geo-blocks, no international fees. If you have internet, you can pay." },
      { e: "💜", t: "Aligned with our values", b: "Our community has always been about freedom, autonomy, and living without judgment. Paying with crypto is an extension of that. We built our payment system around it." },
      { e: "💰", t: "Save 20% on most plans", b: "Yearly and lifetime plans get an automatic 20% discount when you pay with crypto. The Lifetime PRIME $100 deal is already at its fixed crypto price." },
      { e: "⚡", t: "Fast & irreversible", b: "Payments confirm in minutes. No chargebacks, no reversals, no bank deciding to hold your funds." },
    ],

    whichTitle: "Which crypto should I use?",
    whichOptions: [
      { coin: "Dash", anchor: "#dash", color: "#008DE4", emoji: "🥷", tag: "Most private", desc: "Fastest confirmation. Built for private everyday payments. Self-hosted checkout via BTCPay — we never see your identity." },
      { coin: "Bitcoin (BTC)", anchor: "#btc", color: "#F7931A", emoji: "₿", tag: "Most recognized", desc: "The original decentralized currency. No government can stop it. Known worldwide. Great if you already have BTC." },
      { coin: "USDT (BNB Chain)", anchor: "#stable", color: "#26a17b", emoji: "₮", tag: "Stable = 1 USD", desc: "Digital dollar on BNB Chain. 1 USDT = $1 USD always. Works natively with MetaMask, Trust Wallet, and Binance — tap the shortcut button and pay instantly." },
    ],

    beginnerTitle: "New to crypto? Start here.",
    beginnerSubtitle: "You've never touched crypto before. That's fine — this section is for you. Three steps and you're ready to pay.",

    walletTitle: "Step 1 — Get a wallet",
    walletBody: "A crypto wallet is an app that holds your coins. Think of it like a digital purse. You need one to receive and send crypto. Here are the three we recommend:",
    wallets: [
      {
        key: "metamask" as const,
        desc: "The most popular EVM wallet. Supports USDT on BNB Smart Chain natively — the PNPtv checkout opens straight inside MetaMask. Free, no account needed.",
        androidLabel: "Google Play",
        iosLabel: "App Store",
        tip: "Use MetaMask for USDT (BNB Chain) — the PNPtv checkout links directly to it.",
      },
      {
        key: "trust" as const,
        desc: "All-in-one wallet. Supports Bitcoin, USDT, USDC, and hundreds of other coins. Free, open-source, no account needed.",
        androidLabel: "Google Play",
        iosLabel: "App Store",
        tip: "Use Trust Wallet for Bitcoin and USDT.",
      },
      {
        key: "dash" as const,
        desc: "The official Dash wallet. Lightweight, simple, built specifically for Dash payments. If you're paying with Dash, this is the fastest option.",
        androidLabel: "Google Play",
        iosLabel: "App Store",
        tip: "Use Dash Wallet for Dash payments only.",
      },
    ],
    walletTip: "💡 Not sure which to pick? Download MetaMask or Trust Wallet — both work with USDT on BNB Chain and open directly from the PNPtv checkout.",

    buyTitle: "Step 2 — Buy crypto",
    buyBody: "You get crypto by buying it on an exchange — an app that sells crypto the same way a currency exchange converts dollars to euros.",
    exchanges: [
      { name: "Binance", desc: "The world's largest exchange. Supports most countries in Latin America and worldwide. Buy with debit card, bank transfer, or local payment methods.", url: "https://www.binance.com/en/register", label: "Open Binance ↗", color: "#F0B90B" },
      { name: "Coinbase", desc: "The easiest for beginners. Available in USA, Canada, Europe, and many LatAm countries. Clean interface, simple to buy.", url: "https://www.coinbase.com/signup", label: "Open Coinbase ↗", color: "#0052FF" },
      { name: "Kraken", desc: "Reliable, available worldwide. Sells Dash, Bitcoin, USDC, and more. Great for users outside the USA.", url: "https://www.kraken.com/sign-up", label: "Open Kraken ↗", color: "#5741D9" },
      { name: "MoonPay", desc: "Instant buy with card — no full account required. Best for quick top-ups. Works in most countries.", url: "https://www.moonpay.com", label: "Open MoonPay ↗", color: "#7B2FF7" },
    ],
    buySteps: [
      "Create an account with your email (takes 2 minutes). Some exchanges ask for ID verification — this is standard by law.",
      "Search for the coin you want (\"Dash\", \"Bitcoin\", or \"USDC\"). Buy the amount you need — if your plan costs $30, buy $30 worth.",
      "Once purchased, the coins sit in your exchange account. You can pay directly from there, or transfer to your wallet for more privacy.",
    ],
    buyTip: "💡 No ID? Use MoonPay — allows small purchases with just a card, no full account needed.",

    payTitle: "Step 3 — Pay on PNPtv",
    payBody: "Go to the Subscribe page, pick your plan, and select your crypto. A payment page opens with a wallet address and QR code. Open your wallet → Send → scan the QR or paste the address → confirm. Done.",
    payLink: "Go to Subscribe →",

    dashTitle: "Dash — Most Private",
    dashWhat: "Dash is a decentralized cryptocurrency built specifically for fast, everyday private payments. No bank controls it. No government can freeze it. It was created as a peer-to-peer cash system — money that works like actual cash, except digital. We process Dash payments through BTCPay Server, our own self-hosted open-source checkout. We never see who you are.",
    dashWhy: "Best for: anyone who wants maximum privacy and speed. Confirms in under 2 minutes.",
    dashSteps: [
      {
        n: "1",
        title: "Get Dash",
        body: "Buy Dash on Kraken, Uphold, or MoonPay. Load it into the Dash Wallet app (available on Android and iOS).",
        links: [
          { label: "Dash Wallet — Android ↗", href: WALLETS.dash.android },
          { label: "Dash Wallet — iOS ↗", href: WALLETS.dash.ios },
          { label: "Buy on Kraken ↗", href: "https://www.kraken.com/learn/buy-dash-coin" },
          { label: "Buy on MoonPay ↗", href: "https://www.moonpay.com/buy/dash" },
        ],
      },
      {
        n: "2",
        title: "Choose your plan on PNPtv",
        body: "Go to pnptv.app/subscribe or /lifetime100. Select your plan and tap \"Dash\" as the payment method.",
        links: [
          { label: "Subscribe page ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "3",
        title: "Scan the QR code and send",
        body: "A QR code and Dash address appear. Open your Dash Wallet → tap \"Send\" → scan the QR or paste the address → confirm. Send the exact DASH amount shown. Your membership activates within 2 minutes.",
        links: [],
      },
    ],

    btcTitle: "Bitcoin (BTC) — Most Recognized",
    btcWhat: "Bitcoin is the original cryptocurrency — the one that started it all in 2009. It is completely decentralized: no central bank, no government, no single company controls it. No authority can freeze your Bitcoin or stop a payment. It is the most widely held and recognized digital currency in the world. We accept Bitcoin through NowPayments.",
    btcWhy: "Best for: anyone who already has Bitcoin, or who wants the most proven decentralized currency.",
    btcSteps: [
      {
        n: "1",
        title: "Get Bitcoin",
        body: "Buy Bitcoin (BTC) on Binance, Coinbase, Kraken, or instantly via MoonPay. Store it in Trust Wallet for more privacy, or pay directly from your exchange.",
        links: [
          { label: "Trust Wallet — Android ↗", href: WALLETS.trust.android },
          { label: "Trust Wallet — iOS ↗", href: WALLETS.trust.ios },
          { label: "Buy on Binance ↗", href: "https://www.binance.com/en/buy-Bitcoin" },
          { label: "Buy on MoonPay ↗", href: "https://www.moonpay.com/buy/btc" },
        ],
      },
      {
        n: "2",
        title: "Choose your plan on PNPtv",
        body: "Go to pnptv.app/subscribe or /lifetime100. Select your plan and choose \"Bitcoin\" as the payment method.",
        links: [
          { label: "Subscribe page ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "3",
        title: "Complete the NowPayments checkout",
        body: "A secure NowPayments page opens with a Bitcoin address and QR code. Open Trust Wallet → Send → scan the QR or paste the address → confirm the exact BTC amount shown. Your membership activates automatically once the transaction confirms.",
        links: [],
        warning: "💡 Bitcoin confirmations can take 10–60 minutes depending on network congestion. Your access activates as soon as the first confirmation appears — usually much faster.",
      },
    ],

    stableTitle: "USDT (BNB Chain) — Stable Digital Dollar",
    stableWhat: "USDT is a stablecoin — a digital dollar. 1 USDT = $1 USD. Always. It doesn't go up or down in value like Bitcoin or Dash. You buy exactly the amount you need and spend it. We use USDT on BNB Smart Chain (BSC) — the same network natively supported by MetaMask, Trust Wallet, and Binance. No bridge, no network confusion. It still gives you full crypto privacy — no bank statement, no name attached — but without price volatility. Perfect for beginners.",
    stableWhy: "Best for: beginners who want stability. Buy $30 of USDT, spend $30 on PNPtv. Open directly in MetaMask or Trust Wallet with one tap.",
    stableSteps: [
      {
        n: "1",
        title: "Get USDT (BNB Chain)",
        body: "Buy USDT on Binance, Coinbase, or Kraken. Or instantly with a card via MoonPay. Store it in MetaMask or Trust Wallet — both support BNB Smart Chain natively.",
        links: [
          { label: "MetaMask — Android ↗", href: WALLETS.metamask.android },
          { label: "MetaMask — iOS ↗", href: WALLETS.metamask.ios },
          { label: "Trust Wallet — Android ↗", href: WALLETS.trust.android },
          { label: "Trust Wallet — iOS ↗", href: WALLETS.trust.ios },
          { label: "Buy on Binance ↗", href: "https://www.binance.com/en/buy-sell-crypto" },
          { label: "Buy on MoonPay ↗", href: "https://www.moonpay.com/buy/usdt" },
        ],
      },
      {
        n: "2",
        title: "BNB Smart Chain is pre-selected",
        body: "Unlike other crypto options, you don't have to choose a network. We pre-select BNB Smart Chain (BSC) for USDT — the cheapest and fastest option, fully supported by MetaMask, Trust Wallet, and Binance. No network mismatch risk.",
        links: [],
      },
      {
        n: "3",
        title: "Choose your plan on PNPtv",
        body: "Go to pnptv.app/subscribe or /lifetime100. Select your plan and choose \"USDT\" as the payment method.",
        links: [
          { label: "Subscribe page ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "4",
        title: "Open in your wallet and pay",
        body: "Three shortcut buttons appear: 🦊 MetaMask, 🔵 Trust Wallet, and 🌐 Other wallet. Tap your wallet — it opens the payment page directly inside your app. Confirm the USDT amount. Your membership activates automatically.",
        links: [],
      },
    ],

    faqTitle: "Common questions",
    faq: [
      { q: "I've never used crypto. Is this complicated?", a: "It feels new at first but it's simpler than it looks. The hardest part is buying the crypto — once you have it, sending a payment is just \"open app → send → scan QR → confirm\". Follow the step-by-step guides above and you'll be done in under 10 minutes." },
      { q: "Why Dash and Bitcoin specifically?", a: "Because they are genuinely decentralized. No government, no bank, no corporation controls them. Bitcoin has been running for 15+ years without anyone being able to shut it down. Dash was designed for fast, private everyday payments. USDC/USDT are convenient but issued by companies — technically a company could freeze USDC. Dash and Bitcoin can't be frozen by anyone." },
      { q: "What's the difference between USDC and USDT?", a: "Both are digital dollars worth exactly $1 each. We use USDT on BNB Smart Chain (BSC) as the quick-pay option — it works natively with MetaMask, Trust Wallet, and Binance, so when you tap the checkout button your wallet opens directly. USDC is also accepted via NowPayments if you prefer it. Both are stable, both give you full crypto privacy." },
      { q: "What if my crypto payment doesn't confirm?", a: "If you sent the payment but your account wasn't activated after 30 minutes, contact us at pnptv.app/contact. Send your transaction ID (a long string of letters/numbers your wallet gives you after sending). We can recover it manually." },
      { q: "Is my identity hidden when I pay with crypto?", a: "Yes. Crypto transactions are pseudonymous — recorded on a public blockchain but not tied to your real name. We don't ask for your name when you pay. We never see who you are beyond your PNPtv account." },
      { q: "Can I pay with other cryptocurrencies (Ethereum, Litecoin, etc.)?", a: "We accept many coins via NowPayments — including ETH, LTC, XMR (Monero), and more. On the checkout page you can select your coin. We highlight Dash, Bitcoin, USDC, and USDT because they're the most practical for our community." },
      { q: "Is the 20% discount applied automatically?", a: "Yes. For most yearly and lifetime plans, the crypto discount is applied automatically when you select any crypto payment method. The Lifetime PRIME $100 offer is already at its fixed crypto price." },
      { q: "What is BTCPay Server?", a: "BTCPay Server is the checkout system we use for Dash payments. It's open-source software we run on our own server — no third party sees your payment data. We self-host it for maximum privacy." },
      { q: "Can I get a refund on a crypto payment?", a: "Yes. Our refund policy applies to all payments including crypto. You have 24 hours from payment to request a refund. Requests are reviewed and processed within 72 hours. Contact us at pnptv.app/contact with your transaction ID and we'll take care of it." },
    ],

    ctaTitle: "Ready to pay?",
    ctaSubscribe: "Choose a Plan →",
    ctaLifetime: "Lifetime PRIME $100 →",
    backHome: "← Back to PNPtv",
    needHelp: "Still stuck? Contact support →",
    stableCoinsNote: "USDT on BNB Chain = 1 USD always. No volatility.",
    androidLabel: "Android",
    iosLabel: "iPhone / iOS",
  },
  es: {
    pageTitle: "Paga con Cripto — PNPtv!",
    heroEyebrow: "GUÍA DE PAGOS",
    heroTitle: "Paga Libre. Mantén tu Privacidad.",
    heroSubtitle: "Sin bancos. Sin gobiernos. Sin que nadie sepa. El cripto es el método de pago creado para comunidades como la nuestra.",

    manifestoTitle: "Por qué el cripto es la elección correcta para nuestra comunidad",
    manifesto: [
      { e: "🔒", t: "Privacidad total", b: "Sin estado de cuenta. Sin transacciones con tu nombre real. Sin historial visible para nadie — pareja, empleador, familia. Lo que haces aquí se queda aquí." },
      { e: "🕊️", t: "Libre de control", b: "Bitcoin y Dash son descentralizados — ningún gobierno, ningún banco, ninguna empresa puede congelarlos, bloquearlos o apagarlos. Tu dinero, tus reglas." },
      { e: "🌎", t: "Funciona en todas partes", b: "Colombia, México, USA, España, en cualquier lugar. Sin \"tarjeta no soportada\", sin bloqueos geográficos, sin comisiones internacionales. Si tienes internet, puedes pagar." },
      { e: "💜", t: "Alineado con nuestros valores", b: "Nuestra comunidad siempre ha sido sobre libertad, autonomía y vivir sin juicios. Pagar con cripto es una extensión de eso. Construimos nuestra infraestructura de pagos alrededor de ello." },
      { e: "💰", t: "Ahorra 20% en la mayoría de planes", b: "Los planes anuales y lifetime obtienen un 20% de descuento automático al pagar con cripto. La oferta Lifetime PRIME de $100 ya está a su precio cripto fijo." },
      { e: "⚡", t: "Rápido e irreversible", b: "Los pagos se confirman en minutos. Sin contracargos, sin reversiones, sin que un banco retenga tu dinero." },
    ],

    whichTitle: "¿Cuál cripto debo usar?",
    whichOptions: [
      { coin: "Dash", anchor: "#dash", color: "#008DE4", emoji: "🥷", tag: "Más privado", desc: "Confirmación más rápida. Creado para pagos privados del día a día. Checkout propio con BTCPay — nunca vemos tu identidad." },
      { coin: "Bitcoin (BTC)", anchor: "#btc", color: "#F7931A", emoji: "₿", tag: "El más reconocido", desc: "La moneda descentralizada original. Ningún gobierno puede detenerlo. Conocido en todo el mundo. Ideal si ya tienes BTC." },
      { coin: "USDT (BNB Chain)", anchor: "#stable", color: "#26a17b", emoji: "₮", tag: "Estable = 1 USD", desc: "Dólar digital en BNB Chain. 1 USDT = $1 USD siempre. Compatible nativamente con MetaMask, Trust Wallet y Binance — toca el botón de acceso directo y paga al instante." },
    ],

    beginnerTitle: "¿Nuevo en cripto? Empieza aquí.",
    beginnerSubtitle: "Nunca has tocado cripto. Sin problema — esta sección es para ti. Tres pasos y estás listo para pagar.",

    walletTitle: "Paso 1 — Obtén una wallet",
    walletBody: "Una wallet de cripto es una app que guarda tus monedas. Piénsala como una billetera digital. La necesitas para recibir y enviar cripto. Estas son las tres que recomendamos:",
    wallets: [
      {
        key: "metamask" as const,
        desc: "La billetera EVM más popular. Soporta USDT en BNB Smart Chain de forma nativa — el checkout de PNPtv abre directamente en MetaMask. Gratuita, sin necesidad de cuenta.",
        androidLabel: "Google Play",
        iosLabel: "App Store",
        tip: "Usa MetaMask para USDT (BNB Chain) — el checkout de PNPtv enlaza directamente.",
      },
      {
        key: "trust" as const,
        desc: "Billetera todo-en-uno. Soporta Bitcoin, USDT, USDC y cientos de otras monedas. Gratuita, código abierto, sin cuenta.",
        androidLabel: "Google Play",
        iosLabel: "App Store",
        tip: "Usa Trust Wallet para Bitcoin y USDT.",
      },
      {
        key: "dash" as const,
        desc: "La wallet oficial de Dash. Ligera, simple, creada específicamente para pagos con Dash. La opción más rápida si pagas con Dash.",
        androidLabel: "Google Play",
        iosLabel: "App Store",
        tip: "Usa Dash Wallet solo para pagos con Dash.",
      },
    ],
    walletTip: "💡 ¿No sabes cuál elegir? Descarga MetaMask o Trust Wallet — ambas funcionan con USDT en BNB Chain y abren directamente desde el checkout de PNPtv.",

    buyTitle: "Paso 2 — Compra cripto",
    buyBody: "Obtienes cripto comprándolo en un exchange — una app que vende cripto igual que una casa de cambio convierte dólares a euros.",
    exchanges: [
      { name: "Binance", desc: "El exchange más grande del mundo. Disponible en la mayoría de países de Latinoamérica. Compra con tarjeta de débito, transferencia bancaria o métodos locales.", url: "https://www.binance.com/en/register", label: "Abrir Binance ↗", color: "#F0B90B" },
      { name: "Coinbase", desc: "El más fácil para principiantes. Disponible en USA, Canadá, Europa y muchos países de LatAm. Interfaz clara.", url: "https://www.coinbase.com/signup", label: "Abrir Coinbase ↗", color: "#0052FF" },
      { name: "Kraken", desc: "Confiable, disponible en todo el mundo. Vende Dash, Bitcoin, USDC y más. Excelente para usuarios fuera de USA.", url: "https://www.kraken.com/sign-up", label: "Abrir Kraken ↗", color: "#5741D9" },
      { name: "MoonPay", desc: "Compra instantánea con tarjeta — sin registro completo. Ideal para recargas rápidas. Funciona en la mayoría de países.", url: "https://www.moonpay.com", label: "Abrir MoonPay ↗", color: "#7B2FF7" },
    ],
    buySteps: [
      "Crea una cuenta con tu correo (tarda 2 minutos). Algunos exchanges piden verificación de identidad — esto es estándar por ley.",
      "Busca la moneda que quieres (\"Dash\", \"Bitcoin\" o \"USDC\"). Compra el monto que necesitas — si tu plan cuesta $30, compra $30.",
      "Una vez comprado, las monedas quedan en tu cuenta del exchange. Puedes pagar desde ahí, o transferirlas a tu wallet para más privacidad.",
    ],
    buyTip: "💡 ¿Sin identificación? Usa MoonPay — permite compras pequeñas solo con tarjeta, sin cuenta completa.",

    payTitle: "Paso 3 — Paga en PNPtv",
    payBody: "Ve a la página de Suscripciones, elige tu plan y selecciona tu cripto. Se abre una página de pago con una dirección de wallet y código QR. Abre tu app → Enviar → escanea el QR o pega la dirección → confirma. Listo.",
    payLink: "Ir a Suscripciones →",

    dashTitle: "Dash — El Más Privado",
    dashWhat: "Dash es una criptomoneda descentralizada creada específicamente para pagos privados rápidos del día a día. Ningún banco lo controla. Ningún gobierno puede congelarlo. Fue creado como un sistema de efectivo entre pares — dinero digital que funciona como el efectivo real. Procesamos los pagos con Dash a través de BTCPay Server, nuestro propio checkout de código abierto alojado por nosotros. Nunca vemos quién eres.",
    dashWhy: "Ideal para: quienes quieren máxima privacidad y velocidad. Confirmación en menos de 2 minutos.",
    dashSteps: [
      {
        n: "1",
        title: "Obtén Dash",
        body: "Compra Dash en Kraken, Uphold o MoonPay. Cárgalo en la app Dash Wallet (disponible en Android e iOS).",
        links: [
          { label: "Dash Wallet — Android ↗", href: WALLETS.dash.android },
          { label: "Dash Wallet — iOS ↗", href: WALLETS.dash.ios },
          { label: "Comprar en Kraken ↗", href: "https://www.kraken.com/learn/buy-dash-coin" },
          { label: "Comprar en MoonPay ↗", href: "https://www.moonpay.com/buy/dash" },
        ],
      },
      {
        n: "2",
        title: "Elige tu plan en PNPtv",
        body: "Ve a pnptv.app/subscribe o /lifetime100. Elige tu plan y toca \"Dash\" como método de pago.",
        links: [
          { label: "Página de suscripción ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "3",
        title: "Escanea el QR y envía",
        body: "Aparece un código QR y una dirección Dash. Abre tu Dash Wallet → toca \"Enviar\" → escanea el QR o pega la dirección → confirma el monto exacto. Tu membresía se activa en menos de 2 minutos.",
        links: [],
      },
    ],

    btcTitle: "Bitcoin (BTC) — El Más Reconocido",
    btcWhat: "Bitcoin es la criptomoneda original — la que empezó todo en 2009. Es completamente descentralizada: ningún banco central, ningún gobierno, ninguna empresa la controla. Ninguna autoridad puede congelar tu Bitcoin ni detener un pago. Es la moneda digital más reconocida y usada en el mundo. Aceptamos Bitcoin a través de NowPayments.",
    btcWhy: "Ideal para: quienes ya tienen Bitcoin, o quieren la moneda descentralizada más probada del mundo.",
    btcSteps: [
      {
        n: "1",
        title: "Obtén Bitcoin",
        body: "Compra Bitcoin (BTC) en Binance, Coinbase, Kraken, o instantáneamente con MoonPay. Guárdalo en Trust Wallet (Android o iOS) para más privacidad.",
        links: [
          { label: "Trust Wallet — Android ↗", href: WALLETS.trust.android },
          { label: "Trust Wallet — iOS ↗", href: WALLETS.trust.ios },
          { label: "Comprar en Binance ↗", href: "https://www.binance.com/en/buy-Bitcoin" },
          { label: "Comprar en MoonPay ↗", href: "https://www.moonpay.com/buy/btc" },
        ],
      },
      {
        n: "2",
        title: "Elige tu plan en PNPtv",
        body: "Ve a pnptv.app/subscribe o /lifetime100. Elige tu plan y selecciona \"Bitcoin\" como método de pago.",
        links: [
          { label: "Página de suscripción ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "3",
        title: "Completa el checkout de NowPayments",
        body: "Se abre una página segura de NowPayments con una dirección Bitcoin y código QR. Abre Trust Wallet → Enviar → escanea el QR o pega la dirección → confirma el monto exacto en BTC. Tu membresía se activa automáticamente.",
        links: [],
        warning: "💡 Las confirmaciones de Bitcoin pueden tardar 10–60 minutos. Tu acceso se activará tan pronto aparezca la primera confirmación — generalmente mucho más rápido.",
      },
    ],

    stableTitle: "USDT (BNB Chain) — Dólar Digital Estable",
    stableWhat: "USDT es una stablecoin — un dólar digital. 1 USDT = $1 USD. Siempre. No sube ni baja de valor como Bitcoin o Dash. Compras exactamente el monto que necesitas y lo gastas. Usamos USDT en BNB Smart Chain (BSC) — la misma red que soportan MetaMask, Trust Wallet y Binance de forma nativa. Sin bridges, sin confusión de redes. Igualmente te da privacidad total de cripto — sin estado de cuenta, sin nombre asociado — pero sin volatilidad de precios. Perfecto para principiantes.",
    stableWhy: "Ideal para: principiantes que quieren estabilidad. Compra $30 de USDT, gasta $30 en PNPtv. Abre directamente en MetaMask o Trust Wallet con un toque.",
    stableSteps: [
      {
        n: "1",
        title: "Obtén USDT (BNB Chain)",
        body: "Compra USDT en Binance, Coinbase o Kraken. O instantáneamente con tarjeta en MoonPay. Guárdalo en MetaMask o Trust Wallet — ambas soportan BNB Smart Chain de forma nativa.",
        links: [
          { label: "MetaMask — Android ↗", href: WALLETS.metamask.android },
          { label: "MetaMask — iOS ↗", href: WALLETS.metamask.ios },
          { label: "Trust Wallet — Android ↗", href: WALLETS.trust.android },
          { label: "Trust Wallet — iOS ↗", href: WALLETS.trust.ios },
          { label: "Comprar en Binance ↗", href: "https://www.binance.com/en/buy-sell-crypto" },
          { label: "Comprar en MoonPay ↗", href: "https://www.moonpay.com/buy/usdt" },
        ],
      },
      {
        n: "2",
        title: "BNB Smart Chain ya está preseleccionado",
        body: "A diferencia de otras opciones de cripto, no tienes que elegir una red. Preseleccionamos BNB Smart Chain (BSC) para USDT — la opción más barata y rápida, completamente compatible con MetaMask, Trust Wallet y Binance. Sin riesgo de enviar en la red incorrecta.",
        links: [],
      },
      {
        n: "3",
        title: "Elige tu plan en PNPtv",
        body: "Ve a pnptv.app/subscribe o /lifetime100. Elige tu plan y selecciona \"USDT\" como método de pago.",
        links: [
          { label: "Página de suscripción ↗", href: "/subscribe" },
          { label: "Lifetime PRIME $100 ↗", href: "/lifetime100" },
        ],
      },
      {
        n: "4",
        title: "Abre en tu billetera y paga",
        body: "Aparecen tres botones de acceso directo: 🦊 MetaMask, 🔵 Trust Wallet y 🌐 Otra billetera. Toca tu billetera — abre la página de pago directamente dentro de tu app. Confirma el monto en USDT. Tu membresía se activa automáticamente.",
        links: [],
      },
    ],

    faqTitle: "Preguntas frecuentes",
    faq: [
      { q: "Nunca he usado cripto. ¿Es complicado?", a: "Al principio se siente nuevo pero es más simple de lo que parece. La parte más difícil es comprar el cripto — una vez que lo tienes, enviar un pago es solo \"abrir app → enviar → escanear QR → confirmar\". Sigue las guías paso a paso y estarás listo en menos de 10 minutos." },
      { q: "¿Por qué Dash y Bitcoin específicamente?", a: "Porque son genuinamente descentralizados. Ningún gobierno, ningún banco, ninguna empresa los controla. Bitcoin lleva más de 15 años funcionando sin que nadie haya podido apagarlo. Dash fue diseñado para pagos privados y rápidos del día a día. USDC/USDT son convenientes pero los emiten empresas — técnicamente podrían congelarlos. Dash y Bitcoin no pueden ser congelados por nadie." },
      { q: "¿Cuál es la diferencia entre USDC y USDT?", a: "Ambos son dólares digitales que valen exactamente $1 cada uno. Usamos USDT en BNB Smart Chain (BSC) como opción de pago rápido — funciona nativamente con MetaMask, Trust Wallet y Binance, así que cuando tocas el botón de checkout tu billetera abre directamente. USDC también es aceptado a través de NowPayments si lo prefieres. Ambos son estables y ambos te dan privacidad total." },
      { q: "¿Qué pasa si mi pago en cripto no se confirma?", a: "Si enviaste el pago pero tu cuenta no se activó después de 30 minutos, contáctanos en pnptv.app/contact. Envía tu ID de transacción (una cadena larga de letras/números que tu wallet te da después de enviar). Podemos recuperarlo manualmente." },
      { q: "¿Mi identidad está oculta cuando pago con cripto?", a: "Sí. Las transacciones cripto son seudónimas — se registran en una blockchain pública pero no están vinculadas a tu nombre real. No pedimos tu nombre cuando pagas. Nunca vemos quién eres más allá de tu cuenta en PNPtv." },
      { q: "¿Puedo pagar con otras criptomonedas (Ethereum, Litecoin, etc.)?", a: "Aceptamos muchas monedas a través de NowPayments — incluyendo ETH, LTC, XMR (Monero) y más. En la página de checkout puedes seleccionar tu moneda." },
      { q: "¿El descuento se aplica automáticamente?", a: "Sí. En la mayoría de planes anuales y lifetime, el descuento cripto se aplica automáticamente. La oferta Lifetime PRIME de $100 ya está a su precio cripto fijo." },
      { q: "¿Qué es BTCPay Server?", a: "Es el sistema de checkout que usamos para pagos con Dash. Software de código abierto que ejecutamos en nuestro propio servidor — ningún tercero ve tus datos de pago." },
      { q: "¿Puedo pedir un reembolso si pagué con cripto?", a: "Sí. Nuestra política de reembolsos aplica a todos los pagos, incluyendo cripto. Tienes 24 horas desde el pago para solicitar un reembolso. Las solicitudes se revisan y procesan dentro de las 72 horas. Contáctanos en pnptv.app/contact con tu ID de transacción y lo resolvemos." },
    ],

    ctaTitle: "¿Listo para pagar?",
    ctaSubscribe: "Elegir un Plan →",
    ctaLifetime: "Lifetime PRIME $100 →",
    backHome: "← Volver a PNPtv",
    needHelp: "¿Aún con dudas? Contacta soporte →",
    stableCoinsNote: "USDT en BNB Chain = 1 USD siempre. Sin volatilidad.",
    androidLabel: "Android",
    iosLabel: "iPhone / iOS",
  },
};

function Step({ n, title, body, links, color, warning }: {
  n: string; title: string; body: string;
  links: { label: string; href: string }[]; color: string; warning?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
      <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: warning ? "#f59e0b" : color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff" }}>{n}</div>
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

function WalletCard({ walletKey, desc, androidLabel, iosLabel, tip }: {
  walletKey: "trust" | "dash" | "metamask"; desc: string; androidLabel: string; iosLabel: string; tip: string;
}) {
  const w = WALLETS[walletKey];
  return (
    <div style={{ padding: "16px", background: `${w.color}08`, border: `1px solid ${w.color}30`, borderRadius: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>{w.emoji}</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: w.color }}>{w.name}</span>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#d1d5db", lineHeight: 1.5 }}>{desc}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <a href={w.android} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: w.color, textDecoration: "none", padding: "7px 12px", borderRadius: 10, border: `1px solid ${w.color}40`, background: `${w.color}10` }}>
          🤖 {androidLabel}
        </a>
        <a href={w.ios} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: w.color, textDecoration: "none", padding: "7px 12px", borderRadius: 10, border: `1px solid ${w.color}40`, background: `${w.color}10` }}>
           {iosLabel}
        </a>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>{tip}</p>
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
    <div style={{ minHeight: "100dvh", background: "var(--pnp-background)", color: "#ffffff", overflowX: "hidden" }}>
      <div aria-hidden="true" style={{ position: "fixed", top: "-20%", left: "50%", transform: "translateX(-50%)", width: "100vw", height: "100vw", background: "radial-gradient(circle, rgba(111,63,180,0.12) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      <header style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", maxWidth: 720, margin: "0 auto" }}>
        <a href="/"><img src="/logo-header.png" alt="PNPtv!" style={{ height: 32, width: "auto" }} /></a>
        <LangToggle lang={lang} onChange={handleLangChange} />
      </header>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 680, margin: "0 auto", padding: "0 20px 80px" }}>

        {/* Hero */}
        <section style={{ textAlign: "center", padding: "8px 0 32px" }}>
          <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#a78bfa" }}>{s.heroEyebrow}</p>
          <h1 style={{ margin: "0 0 14px", fontSize: "clamp(24px, 6vw, 36px)", fontWeight: 900, lineHeight: 1.1, background: "linear-gradient(135deg, #a78bfa 0%, #60a5fa 50%, #34d399 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{s.heroTitle}</h1>
          <p style={{ margin: "0 0 28px", fontSize: 15, color: "#9ca3af", lineHeight: 1.7, maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>{s.heroSubtitle}</p>
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
            {s.whichOptions.map((opt) => (
              <a key={opt.coin} href={opt.anchor} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 24, background: `${opt.color}12`, border: `1px solid ${opt.color}40`, color: opt.color, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                {opt.emoji} {opt.coin}
              </a>
            ))}
          </div>
        </section>

        {/* Manifesto */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ margin: "0 0 18px", fontSize: 18, fontWeight: 800 }}>{s.manifestoTitle}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {s.manifesto.map((w) => (
              <div key={w.t} style={{ padding: "16px", background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 14 }}>
                <span style={{ fontSize: 22 }}>{w.e}</span>
                <p style={{ margin: "8px 0 4px", fontSize: 13, fontWeight: 700, color: "#ffffff" }}>{w.t}</p>
                <p style={{ margin: 0, fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>{w.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Which crypto */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800 }}>{s.whichTitle}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {s.whichOptions.map((opt) => (
              <a key={opt.coin} href={opt.anchor} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 18px", background: "rgba(255,255,255,0.03)", border: `1px solid ${opt.color}33`, borderRadius: 16, textDecoration: "none", color: "inherit" }}>
                <span style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>{opt.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: opt.color }}>{opt.coin}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: `${opt.color}22`, color: opt.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>{opt.tag}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "#9ca3af", lineHeight: 1.5 }}>{opt.desc}</p>
                </div>
                <span style={{ color: opt.color, fontSize: 18, flexShrink: 0, alignSelf: "center" }}>→</span>
              </a>
            ))}
          </div>
        </section>

        {/* Beginner section */}
        <section style={{ marginBottom: 48, padding: "28px 24px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20 }}>
          <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#a78bfa" }}>
            {lang === "en" ? "BEGINNERS START HERE" : "PRINCIPIANTES EMPIEZA AQUÍ"}
          </p>
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 900 }}>{s.beginnerTitle}</h2>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: "#9ca3af" }}>{s.beginnerSubtitle}</p>

          {/* Step 1: Wallet */}
          <div style={{ marginBottom: 28 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800, color: "#a78bfa" }}>{s.walletTitle}</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>{s.walletBody}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {s.wallets.map((w) => (
                <WalletCard key={w.key} walletKey={w.key} desc={w.desc} androidLabel={w.androidLabel} iosLabel={w.iosLabel} tip={w.tip} />
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10, fontSize: 12, color: "#c4b5fd" }}>
              {s.walletTip}
            </div>
          </div>

          {/* Step 2: Buy */}
          <div style={{ marginBottom: 28 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800, color: "#a78bfa" }}>{s.buyTitle}</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>{s.buyBody}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 16 }}>
              {s.exchanges.map((ex) => (
                <div key={ex.name} style={{ padding: "14px", background: "rgba(255,255,255,0.03)", border: `1px solid ${ex.color}25`, borderRadius: 12 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 800, color: ex.color }}>{ex.name}</p>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>{ex.desc}</p>
                  <a href={ex.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: ex.color, textDecoration: "none" }}>{ex.label}</a>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {s.buySteps.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "rgba(167,139,250,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#a78bfa" }}>{i + 1}</div>
                  <p style={{ margin: 0, fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>{step}</p>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10, fontSize: 12, color: "#c4b5fd" }}>
              {s.buyTip}
            </div>
          </div>

          {/* Step 3: Pay */}
          <div>
            <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800, color: "#a78bfa" }}>{s.payTitle}</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>{s.payBody}</p>
            <Link to="/subscribe" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px", background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.4)", borderRadius: 12, color: "#a78bfa", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
              {s.payLink}
            </Link>
          </div>
        </section>

        {/* Dash section */}
        <section id="dash" style={{ marginBottom: 48 }}>
          <div style={{ padding: "20px 20px 24px", background: "rgba(0,141,228,0.05)", border: "1px solid rgba(0,141,228,0.25)", borderRadius: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>🥷</span>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#008DE4" }}>{s.dashTitle}</h2>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(0,141,228,0.15)", color: "#008DE4", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {lang === "en" ? "Decentralized · No government control" : "Descentralizado · Sin control gubernamental"}
                </span>
              </div>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{s.dashWhat}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckIcon color="#008DE4" />
              <p style={{ margin: 0, fontSize: 13, color: "#008DE4", fontWeight: 600 }}>{s.dashWhy}</p>
            </div>
          </div>
          {s.dashSteps.map((step) => <Step key={step.n} {...step} color="#008DE4" />)}
        </section>

        {/* Bitcoin section */}
        <section id="btc" style={{ marginBottom: 48 }}>
          <div style={{ padding: "20px 20px 24px", background: "rgba(247,147,26,0.05)", border: "1px solid rgba(247,147,26,0.25)", borderRadius: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>₿</span>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#F7931A" }}>{s.btcTitle}</h2>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(247,147,26,0.15)", color: "#F7931A", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {lang === "en" ? "Decentralized · 15 years unbreakable" : "Descentralizado · 15 años irrompible"}
                </span>
              </div>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{s.btcWhat}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckIcon color="#F7931A" />
              <p style={{ margin: 0, fontSize: 13, color: "#F7931A", fontWeight: 600 }}>{s.btcWhy}</p>
            </div>
          </div>
          {s.btcSteps.map((step) => <Step key={step.n} {...step} color="#F7931A" />)}
        </section>

        {/* USDC/USDT section */}
        <section id="stable" style={{ marginBottom: 48 }}>
          <div style={{ padding: "20px 20px 24px", background: "rgba(38,161,123,0.05)", border: "1px solid rgba(38,161,123,0.25)", borderRadius: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>💵</span>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#26a17b" }}>{s.stableTitle}</h2>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(38,161,123,0.15)", color: "#26a17b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {s.stableCoinsNote}
                </span>
              </div>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{s.stableWhat}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckIcon color="#26a17b" />
              <p style={{ margin: 0, fontSize: 13, color: "#26a17b", fontWeight: 600 }}>{s.stableWhy}</p>
            </div>
          </div>
          {s.stableSteps.map((step) => <Step key={step.n} {...step} color="#26a17b" />)}
        </section>

        {/* Decentralization callout */}
        <section style={{ marginBottom: 48, padding: "22px 24px", background: "linear-gradient(135deg, rgba(0,141,228,0.08) 0%, rgba(247,147,26,0.08) 100%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10, color: "#a78bfa" }}>
            <ShieldIcon />
            <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {lang === "en" ? "Why decentralized matters" : "Por qué importa la descentralización"}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#d1d5db", lineHeight: 1.7, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            {lang === "en"
              ? "Traditional payment systems can be shut down, frozen, or blocked by governments, banks, and payment processors. We experienced this firsthand when Stripe froze our account. Bitcoin and Dash exist outside that system entirely — no company can revoke access to the network. That's why we built our payment infrastructure around them."
              : "Los sistemas de pago tradicionales pueden ser apagados, congelados o bloqueados por gobiernos, bancos y procesadores de pagos. Lo experimentamos directamente cuando Stripe congeló nuestra cuenta. Bitcoin y Dash existen completamente fuera de ese sistema — ninguna empresa puede revocar el acceso a la red. Por eso construimos nuestra infraestructura de pagos alrededor de ellos."}
          </p>
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
            <Link to="/subscribe" style={{ display: "block", width: "100%", maxWidth: 320, padding: "16px 24px", background: "linear-gradient(135deg, #6f3fb4, #3375BB)", color: "#ffffff", fontSize: 15, fontWeight: 800, textDecoration: "none", borderRadius: 14, textAlign: "center", letterSpacing: "0.03em" }}>
              {s.ctaSubscribe}
            </Link>
            <Link to="/lifetime100" style={{ display: "block", width: "100%", maxWidth: 320, padding: "16px 24px", background: "linear-gradient(135deg, #008DE4, #26a17b)", color: "#ffffff", fontSize: 15, fontWeight: 800, textDecoration: "none", borderRadius: 14, textAlign: "center", letterSpacing: "0.03em" }}>
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
