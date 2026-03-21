import React from "react";
import { Helmet } from "react-helmet-async";
import { CreatorAvailabilitySettings } from "@/components/creators/CreatorAvailabilitySettings";
import { CallPackageManager } from "@/pages/creator/CallPackageManager";

export default function CreatorAvailability() {
  return (
    <>
      <Helmet>
        <title>Availability — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        <div className="space-y-4">
          <CreatorAvailabilitySettings />
          <CallPackageManager />
        </div>
      </div>
    </>
  );
}
