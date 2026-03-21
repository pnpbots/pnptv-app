import React from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { ContentTab } from "@/pages/creator/ContentTab";

export default function CreatorContent() {
  const { creator: t } = useI18n();

  return (
    <>
      <Helmet>
        <title>Content — Creator Studio — PNPtv!</title>
      </Helmet>
      <div className="p-4 lg:p-6">
        <ContentTab t={t} />
      </div>
    </>
  );
}
