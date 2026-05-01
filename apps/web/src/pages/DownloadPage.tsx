import React from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";

export default function DownloadPage() {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>PNPtv!</title>
        <meta name="description" content="Access PNPtv! — log in with your PNPtv ID" />
      </Helmet>
      <div className="min-h-dvh flex items-center justify-center bg-pnp-background p-6">
        <div className="text-center max-w-sm space-y-6">
          <img src="/icon-192.png" alt="PNPtv" className="w-20 h-20 rounded-2xl mx-auto shadow-2xl" />
          <h1 className="text-2xl font-bold text-white">PNPtv!</h1>
          <p className="text-pnp-textSecondary text-sm">
            Log in with your PNPtv ID to access all services.
          </p>
          <button
            onClick={() => navigate("/")}
            className="w-full py-3 rounded-xl font-bold text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            Go to PNPtv
          </button>
        </div>
      </div>
    </>
  );
}
