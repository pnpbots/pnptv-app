import React from "react";
import { CristinaWidget } from "@/components/CristinaWidget";

export function Support() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-1">
          🧜‍♀️ Cristina AI Support
        </h1>
        <p className="text-sm text-pnp-textSecondary">
          Get instant help with your account, subscription, or any questions about PNPtv.
        </p>
      </div>
      <CristinaWidget mode="page" />
    </div>
  );
}

export default Support;
