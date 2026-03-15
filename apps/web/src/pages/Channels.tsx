import React from "react";
import { Helmet } from "react-helmet-async";

export default function Channels() {
  return (
    <>
      <Helmet>
        <title>Channels — PNPtv</title>
        <meta name="description" content="PNP Channels are coming soon" />
      </Helmet>

      <div
        className="flex flex-col items-center justify-center min-h-screen px-6 text-center"
        style={{ background: "#0A0A0F" }}
      >
        {/* Piggy icon */}
        <div
          className="w-28 h-28 rounded-full flex items-center justify-center mb-6 animate-bounce"
          style={{
            background: "linear-gradient(135deg, #D4007A 0%, #E69138 100%)",
            boxShadow: "0 0 40px rgba(212,0,122,0.35), 0 0 80px rgba(230,145,56,0.15)",
          }}
        >
          <span className="text-5xl" role="img" aria-label="pig">
            🐷
          </span>
        </div>

        {/* Title */}
        <h1
          className="text-3xl font-black tracking-tight mb-3"
          style={{
            background: "linear-gradient(135deg, #D4007A, #E69138)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          PNP Channels
        </h1>

        {/* Subtitle */}
        <p className="text-lg font-semibold text-white mb-2">
          Something piggy is on its way...
        </p>

        <p className="text-sm max-w-xs" style={{ color: "#8E8E93" }}>
          We're cooking up something filthy for you. Exclusive creators,
          private shows, and way more cloud content than you can handle.
        </p>

        {/* Divider */}
        <div
          className="w-16 h-0.5 rounded-full my-6"
          style={{ background: "linear-gradient(90deg, #D4007A, #E69138)" }}
        />

        {/* Coming soon badge */}
        <div
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold uppercase tracking-widest"
          style={{
            background: "rgba(212,0,122,0.12)",
            border: "1px solid rgba(212,0,122,0.3)",
            color: "#D4007A",
          }}
        >
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: "#D4007A" }}
          />
          Coming Soon
        </div>

        {/* Cloud emojis */}
        <div className="mt-8 flex items-center gap-3 text-2xl opacity-40">
          <span>💨</span>
          <span>🔥</span>
          <span>🐷</span>
          <span>☁️</span>
          <span>💎</span>
        </div>
      </div>
    </>
  );
}
