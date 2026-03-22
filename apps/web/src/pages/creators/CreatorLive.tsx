import React from "react";
import { Helmet } from "react-helmet-async";

const STUDIO_URL = import.meta.env.VITE_STUDIO_URL || "https://studio.pnptv.app";

export default function CreatorLive() {
  return (
    <>
      <Helmet>
        <title>Go Live — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        <div className="glass-card-sm p-6 text-center space-y-4">
          <h2 className="text-lg font-bold text-pnp-textPrimary">Streaming has moved!</h2>
          <p className="text-sm text-pnp-textSecondary">
            Live streaming is now available in the dedicated PNPtv! Studio app.
          </p>
          <a
            href={STUDIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            Open PNPtv! Studio
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </div>
      </div>
    </>
  );
}
