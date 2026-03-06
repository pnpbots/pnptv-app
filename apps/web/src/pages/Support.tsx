import React from "react";
import { Helmet } from "react-helmet-async";
import { useI18n } from "@/lib/i18n";
import { CristinaWidget } from "@/components/CristinaWidget";

export function Support() {
  const { support: t } = useI18n();

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.pageDescription} />
      </Helmet>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-pnp-textPrimary mb-1">
          {t.pageHeading}
        </h1>
        <p className="text-sm text-pnp-textSecondary">
          {t.pageSubtitle}
        </p>
      </div>
      <CristinaWidget mode="page" />
    </div>
  );
}

export default Support;
