import React, { lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";

const BrowserStreamer = lazy(() => import("@/components/WebRTCStreamer"));

export default function CreatorLive() {
  return (
    <>
      <Helmet>
        <title>Go Live — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        <div className="glass-card-sm p-4">
          <Suspense
            fallback={
              <div className="space-y-4">
                <div className="h-6 w-40 rounded-lg bg-pnp-surface animate-pulse" />
                <div className="rounded-2xl bg-pnp-surface animate-pulse" style={{ aspectRatio: "16/9" }} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-10 rounded-xl bg-pnp-surface animate-pulse" />
                  <div className="h-10 rounded-xl bg-pnp-surface animate-pulse" />
                </div>
                <div className="h-[52px] rounded-2xl bg-pnp-surface animate-pulse" />
              </div>
            }
          >
            <BrowserStreamer />
          </Suspense>
        </div>
      </div>
    </>
  );
}
