import React from "react";
import { Helmet } from "react-helmet-async";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";

export default function DownloadPage() {
  return (
    <>
      <Helmet>
        <title>Install PNPtv!</title>
        <meta name="description" content="Install PNPtv! on your device" />
      </Helmet>
      <PWAInstallBanner forceShow />
    </>
  );
}
