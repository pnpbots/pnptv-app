import React from "react";
import { Helmet } from "react-helmet-async";
import { useCreatorData } from "@/hooks/useCreatorData";

export default function CreatorAnalytics() {
  const { dashboard, loading } = useCreatorData();

  return (
    <>
      <Helmet>
        <title>Analytics — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        <h1 className="text-xl font-bold text-white mb-1">Analytics</h1>
        <p className="text-sm mb-6" style={{ color: "#8E8E93" }}>Your creator performance at a glance.</p>

        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="h-24 bg-white/5 rounded-lg" />
              <div className="h-24 bg-white/5 rounded-lg" />
              <div className="h-24 bg-white/5 rounded-lg" />
              <div className="h-24 bg-white/5 rounded-lg" />
            </div>
            <div className="h-32 bg-white/5 rounded-lg" />
          </div>
        ) : dashboard ? (
          <div className="space-y-4">
            {/* Key metrics grid */}
            <div className="grid grid-cols-2 gap-3">

              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold text-white">{dashboard.subscriberCount}</p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Subscribers</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: "#5ED1C4" }}>
                  ${dashboard.monthlyEarnings.toFixed(2)}
                </p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>This Month</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold text-white">{dashboard.exclusivePostCount}</p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Exclusive Posts</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <p className="text-2xl font-bold text-white">
                  ${dashboard.totalEarnings.toFixed(2)}
                </p>
                <p className="text-xs mt-1" style={{ color: "#8E8E93" }}>Total Earned</p>
              </div>
            </div>

            {/* Subscription price */}
            <div className="glass-card-sm p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Subscription Price</p>
                  <p className="text-xs mt-0.5" style={{ color: "#8E8E93" }}>Your current monthly rate</p>
                </div>
                <p className="text-lg font-bold" style={{ color: "#5ED1C4" }}>
                  ${dashboard.priceUsd.toFixed(2)}<span className="text-xs font-normal text-pnp-textSecondary">/mo</span>
                </p>
              </div>
            </div>

            {/* Phase 1 notice */}
            <div className="rounded-xl p-4" style={{ background: "rgba(212,0,122,0.06)", border: "1px solid rgba(212,0,122,0.15)" }}>
              <p className="text-xs font-semibold mb-1" style={{ color: "#D4007A" }}>More analytics coming soon</p>
              <p className="text-xs" style={{ color: "#8E8E93" }}>
                Detailed charts for views, follower growth, and revenue trends are on the roadmap for Phase 2.
              </p>
            </div>
          </div>
        ) : (
          <div className="glass-card-sm p-8 text-center">
            <p className="text-sm text-pnp-textSecondary">No analytics data available yet.</p>
          </div>
        )}
      </div>
    </>
  );
}
