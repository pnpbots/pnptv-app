import React from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const STEPS = [
  {
    num: 1,
    title: "Go to Subscribe",
    desc: "Open pnptv.app/subscribe or tap the Subscribe button in the app.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    ),
  },
  {
    num: 2,
    title: "Choose Your Plan",
    desc: "Browse the available plans and pick the one that fits you best — from a 7-day trial to Lifetime PRIME.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.251 2.251 0 011.15.564m-5.8 0c-.376.023-.75.05-1.124.08C7.095 3.007 6.25 3.97 6.25 5.108v12.642A2.25 2.25 0 008.5 20h.5" />
      </svg>
    ),
  },
  {
    num: 3,
    title: 'Select the "Dash" Tab',
    desc: 'On the payment screen, you\'ll see two tabs: Card/PSE and Dash. Tap the ninja emoji tab — that\'s Dash.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
      </svg>
    ),
  },
  {
    num: 4,
    title: 'Tap "Subscribe Now"',
    desc: "Enter your email (optional, for receipt) and hit the Subscribe button. This opens the BTCPay checkout page.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
      </svg>
    ),
  },
  {
    num: 5,
    title: "Pay with Your Dash Wallet",
    desc: "Scan the QR code or copy the Dash address shown on the BTCPay checkout page. Send the exact amount from your Dash wallet or exchange.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
      </svg>
    ),
  },
  {
    num: 6,
    title: "Wait for Confirmation",
    desc: "Dash transactions confirm in about 2-5 minutes. The page will update automatically once your payment is confirmed on the blockchain.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    num: 7,
    title: "You're In!",
    desc: "Your membership activates instantly after confirmation. Enjoy full access to PNPtv! — no personal data required, no trace left behind.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    ),
  },
];

const WALLETS = [
  {
    name: "Dash Wallet",
    desc: "Official mobile wallet — download from dash.org. Simple, fast, and works on iOS & Android.",
    tag: "Best for beginners",
  },
  {
    name: "Kraken",
    desc: "Major crypto exchange. Buy Dash with bank transfer or card, then send it to pay.",
    tag: "Exchange",
  },
  {
    name: "Uphold",
    desc: "Multi-asset platform. Buy Dash and send directly from the app.",
    tag: "Exchange",
  },
  {
    name: "Coinbase",
    desc: "One of the largest exchanges worldwide. Easy to buy Dash and withdraw.",
    tag: "Exchange",
  },
];

const BENEFITS = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>
    ),
    title: "100% Anonymous",
    desc: "No name, no ID, no bank account linked. Your payment leaves zero trace.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: "Private & Secure",
    desc: "Dash uses advanced encryption. No third party sees your transaction details.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    title: "Instant Transactions",
    desc: "Dash InstantSend confirms payments in seconds. Your membership activates in under 5 minutes.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
    title: "Ultra-Low Fees",
    desc: "Dash network fees are fractions of a cent — way cheaper than credit card processing.",
  },
];

export default function DashBankPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>PNPtv! Bank — Private. Secure. Immediate. Anonymous.</title>
        <meta
          name="description"
          content="Pay for your PNPtv! membership with Dash cryptocurrency. 100% anonymous, private, and secure. No bank account or credit card needed."
        />
        <meta property="og:title" content="PNPtv! Bank — Private. Secure. Immediate. Anonymous." />
        <meta
          property="og:description"
          content="Pay for your PNPtv! membership with Dash cryptocurrency. 100% anonymous, private, and secure."
        />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="min-h-dvh" style={{ background: "var(--pnp-background, #0A0A0B)", color: "#fff" }}>
        {/* Top bar */}
        <div
          className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-3"
          style={{
            background: "rgba(10,10,11,0.92)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="text-white/60 hover:text-white transition-colors"
              aria-label="Go back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <Link to="/">
              <img src="/logo-header.png" alt="PNPtv!" className="h-8 w-auto" />
            </Link>
          </div>
          {!isAuthenticated && (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="text-xs font-medium text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
              >
                Log In
              </Link>
              <Link
                to="/join"
                className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg"
                style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
              >
                Join Free
              </Link>
            </div>
          )}
        </div>

        {/* Hero */}
        <div className="relative overflow-hidden text-center px-4 pt-12 pb-10">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,141,228,0.14) 0%, transparent 70%)",
            }}
          />
          <div className="relative">
            <div className="flex justify-center mb-3">
              <img src="/logo-header.png" alt="PNPtv!" className="h-14 w-auto" />
            </div>
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="text-4xl font-black" style={{ color: "#008DE4" }}>Bank</span>
            </div>
            <p
              className="text-lg sm:text-xl font-semibold tracking-wide mb-3"
              style={{ color: "#008DE4" }}
            >
              Private. Secure. Immediate. Anonymous.
            </p>
            <p className="text-sm text-white/50 max-w-lg mx-auto leading-relaxed">
              Pay for your PNPtv! membership using Dash cryptocurrency.
              No bank account. No credit card. No personal data. Just pure privacy.
            </p>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 pb-16 space-y-14">
          {/* Video Tutorial */}
          <section>
            <h2 className="text-xl font-bold text-white mb-2">Watch: How Dash Payments Work</h2>
            <p className="text-sm text-white/50 mb-4">
              This quick video explains everything you need to know about paying with Dash.
            </p>
            <div
              className="relative w-full overflow-hidden rounded-2xl border"
              style={{
                paddingBottom: "56.25%",
                borderColor: "rgba(0,141,228,0.3)",
                background: "rgba(0,141,228,0.06)",
              }}
            >
              <iframe
                className="absolute inset-0 w-full h-full"
                src="https://www.youtube.com/embed/G4lklnnIMZE"
                title="How to Pay with Dash — PNPtv! Bank Tutorial"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
              />
            </div>
          </section>

          {/* What is Dash */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">What is Dash?</h2>
            <div
              className="rounded-2xl p-6 border"
              style={{
                background: "rgba(0,141,228,0.06)",
                borderColor: "rgba(0,141,228,0.2)",
              }}
            >
              <p className="text-sm leading-relaxed text-white/75 mb-3">
                <strong className="text-white">Dash</strong> is a cryptocurrency designed for fast, private, and low-cost payments.
                Unlike Bitcoin, Dash transactions confirm in seconds thanks to <strong className="text-white">InstantSend</strong> technology,
                and optional <strong className="text-white">CoinJoin</strong> mixing makes your transactions virtually untraceable.
              </p>
              <p className="text-sm leading-relaxed text-white/75">
                PNPtv! accepts Dash because we believe in your right to privacy. When you pay with Dash,
                no bank, no payment processor, and no one else can see what you purchased or link it back to you.
                It's the most private way to access PNPtv!
              </p>
            </div>
          </section>

          {/* Step by Step */}
          <section>
            <h2 className="text-xl font-bold text-white mb-2">How to Pay with Dash — Step by Step</h2>
            <p className="text-sm text-white/50 mb-6">
              It only takes a few minutes. Follow these steps:
            </p>
            <div className="space-y-4">
              {STEPS.map((step) => (
                <div
                  key={step.num}
                  className="flex gap-4 rounded-xl p-4 border transition-colors hover:border-[#008DE4]/30"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex-shrink-0 flex flex-col items-center gap-1">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ background: "linear-gradient(135deg, #008DE4, #0054A6)" }}
                    >
                      {step.num}
                    </div>
                    <div className="text-[#008DE4]/60">{step.icon}</div>
                  </div>
                  <div className="pt-1">
                    <h3 className="text-sm font-bold text-white mb-1">{step.title}</h3>
                    <p className="text-xs text-white/55 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Why Dash */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">Why Pay with Dash?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="rounded-xl p-5 border transition-colors hover:border-[#008DE4]/30"
                  style={{
                    background: "rgba(0,141,228,0.04)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5" style={{ color: "#008DE4" }}>
                      {b.icon}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white mb-1">{b.title}</h3>
                      <p className="text-xs text-white/55 leading-relaxed">{b.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Where to get Dash */}
          <section>
            <h2 className="text-xl font-bold text-white mb-2">Where to Get Dash</h2>
            <p className="text-sm text-white/50 mb-4">
              Don't have Dash yet? Here are the easiest ways to buy some:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {WALLETS.map((w) => (
                <div
                  key={w.name}
                  className="rounded-xl p-4 border"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-white">{w.name}</h3>
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: "rgba(0,141,228,0.15)",
                        color: "#008DE4",
                      }}
                    >
                      {w.tag}
                    </span>
                  </div>
                  <p className="text-xs text-white/55 leading-relaxed">{w.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* PNP Live Tokens */}
          <section>
            <h2 className="text-xl font-bold text-white mb-2">PNP Live Tokens — Tip Creators Anonymously</h2>
            <p className="text-sm text-white/50 mb-4">
              Dash makes it incredibly easy to get tokens for PNP Live. Here's why:
            </p>
            <div
              className="rounded-2xl p-6 border mb-4"
              style={{
                background: "linear-gradient(135deg, rgba(212,0,122,0.08), rgba(0,141,228,0.06))",
                borderColor: "rgba(212,0,122,0.25)",
              }}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">Instant Top-Up, Zero Hassle</h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    Buy tokens with Dash and they hit your account in minutes. No waiting for bank approvals, no card declines, no payment processor blocking your transaction. Just scan, send, done.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">No Paper Trail</h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    Your tips stay between you and the creator. Dash payments don't appear on any bank statement or credit card bill. Nobody knows what you spent, where, or on whom.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">More Tokens for Your Money</h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    Dash network fees are fractions of a cent — way less than credit card processing fees. That means more of your money goes to tokens, not to middlemen.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">Support Your Favorite Creators Live</h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    Use your tokens during PNP Live streams to tip performers in real time. Show your appreciation, unlock special interactions, and keep the energy going — all completely anonymously.
                  </p>
                </div>
              </div>
            </div>
            <div
              className="rounded-xl p-4 border text-center"
              style={{
                background: "rgba(0,141,228,0.06)",
                borderColor: "rgba(0,141,228,0.2)",
              }}
            >
              <p className="text-sm text-white/70 leading-relaxed">
                <strong className="text-white">3 simple steps:</strong> Get Dash from any exchange or wallet, send it to PNPtv! Bank, and your tokens are ready to use on PNP Live instantly. That's it.
              </p>
            </div>
          </section>

          {/* FAQ */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">Frequently Asked Questions</h2>
            <div className="space-y-3">
              {[
                {
                  q: "Is paying with Dash really anonymous?",
                  a: "Yes. Dash does not require any personal information. Your transaction is between your wallet and ours — no bank, no card issuer, no middleman. For extra privacy, use Dash's built-in CoinJoin feature before sending.",
                },
                {
                  q: "How long does it take to confirm?",
                  a: "Most Dash transactions confirm within 2-5 minutes. Thanks to InstantSend, the payment is locked in seconds, and your membership activates as soon as the blockchain confirms it.",
                },
                {
                  q: "What if my payment doesn't go through?",
                  a: "If the BTCPay invoice expires before you send payment, simply go back to /subscribe and try again. Your Dash will not be lost — it stays in your wallet if the invoice times out.",
                },
                {
                  q: "Can I pay with other cryptocurrencies?",
                  a: "We support Dash via BTCPay and 100+ cryptocurrencies via NowPayments (USDC, BTC, ETH, and more). Dash offers the strongest privacy.",
                },
                {
                  q: "Do I need to give my email?",
                  a: "Email is optional when paying with Dash. It's only used to send you a receipt. If you skip it, your membership still activates — you just won't get a confirmation email.",
                },
              ].map((faq) => (
                <div
                  key={faq.q}
                  className="rounded-xl p-4 border"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <h3 className="text-sm font-bold text-white mb-1">{faq.q}</h3>
                  <p className="text-xs text-white/55 leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section
            className="rounded-2xl p-6 sm:p-8 border text-center"
            style={{
              background: "linear-gradient(135deg, rgba(0,141,228,0.08), rgba(212,0,122,0.06))",
              borderColor: "rgba(0,141,228,0.25)",
            }}
          >
            <h2 className="text-lg font-bold text-white mb-2">
              Ready to Go Private?
            </h2>
            <p className="text-sm text-white/60 mb-5 max-w-sm mx-auto">
              Get your PNPtv! membership now with Dash — no personal data, no trace, just access.
            </p>
            <Link
              to="/subscribe"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #008DE4, #0054A6)" }}
            >
              Subscribe with Dash
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </section>
        </div>

        {/* Mini footer */}
        <div
          className="border-t px-4 py-8 text-center"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.25)" }}>
            &copy; 2026 PNPtv!
          </p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {[
              { href: "/terms", label: "Terms" },
              { href: "/privacy", label: "Privacy" },
              { href: "/safety", label: "Safety" },
              { href: "/subscribe", label: "Subscribe" },
            ].map(({ href, label }) => (
              <Link
                key={href}
                to={href}
                className="text-xs hover:underline transition-colors"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
