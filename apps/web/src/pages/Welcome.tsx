import React from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useI18n } from "@/lib/i18n";

const featureRoutes = [
  { icon: "\ud83d\udcfa", route: "/channels", color: "from-pink-600 to-purple-600" },
  { icon: "\ud83d\udcf9", route: "/chat", color: "from-orange-500 to-pink-600" },
  { icon: "\ud83d\udd34", route: "/live", color: "from-red-600 to-orange-500" },
  { icon: "\ud83d\udcac", route: "/social", color: "from-blue-500 to-purple-600" },
  { icon: "\ud83d\udccd", route: "/nearby", color: "from-green-500 to-teal-500" },
  { icon: "\u2709\ufe0f", route: "/dm", color: "from-indigo-500 to-blue-500" },
  { icon: "\ud83d\udc64", route: "/profile", color: "from-purple-500 to-pink-500" },
  { icon: "\u2b50", route: null, external: "https://t.me/PNPtvBot", color: "from-yellow-500 to-orange-500" },
];

export default function Welcome() {
  const { user } = useAuth();
  const { isPrime, isMember } = useTier();
  const t = useI18n().welcome;
  const displayName = user?.firstName || user?.username || "member";

  return (
    <div className="min-h-dvh pb-24 lg:pb-8">
      <Helmet>
        <title>{t.pageTitle}</title>
        <meta name="description" content={t.metaDescription} />
      </Helmet>
      {/* Hero section */}
      <div className="relative overflow-hidden rounded-2xl mx-4 mt-4 mb-6 p-6 bg-gradient-to-br from-[#D4007A]/20 to-[#E69138]/20 border border-white/10">
        <div className="relative z-10 text-center">
          <div className="text-4xl mb-2">
            <span className="font-bold text-white">PNPtv</span>
            <span className="text-[#D4007A] font-bold">!</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {t.welcomeGreeting.replace("{name}", displayName)}
          </h1>
          <p className="text-white/70 text-sm max-w-md mx-auto">
            {t.heroBody}
          </p>
          {isPrime && (
            <div className="inline-flex items-center gap-2 mt-3 px-3 py-1 rounded-full bg-[#D4007A]/20 border border-[#D4007A]/30">
              <span className="w-2 h-2 rounded-full bg-[#D4007A] animate-pulse" />
              <span className="text-xs text-[#D4007A] font-medium">
                {t.primeActiveBadge}
              </span>
            </div>
          )}
          {isMember && !isPrime && (
            <div className="inline-flex items-center gap-2 mt-3 px-3 py-1 rounded-full bg-[#FFB454]/20 border border-[#FFB454]/30">
              <span className="w-2 h-2 rounded-full bg-[#FFB454] animate-pulse" />
              <span className="text-xs text-[#FFB454] font-medium">
                {t.memberActiveBadge}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Community Guidelines & Age Verification */}
      <div className="mx-4 mb-6 p-5 rounded-xl bg-red-500/[0.08] border border-red-500/20">
        <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {t.communityRulesTitle}
        </h2>

        <div className="space-y-3 text-sm text-white/70 leading-relaxed">
          <div className="flex items-start gap-2">
            <span className="text-red-400 font-bold mt-0.5 flex-shrink-0">{t.ageRequirementLabel}</span>
            <p>
              {t.ageRequirementText}
            </p>
          </div>

          <div>
            <p className="text-white font-medium mb-1.5">{t.prohibitedContentTitle}</p>
            <ul className="space-y-1 ml-4">
              {(t.prohibitedItems as readonly string[]).map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-red-400 text-xs mt-1">&#10005;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-2 border-t border-red-500/10">
            <p className="text-white/60 text-xs">
              {t.violationsNote.split(t.violationsImmediateTermination)[0]}
              <span className="text-white font-medium">{t.violationsImmediateTermination}</span>
              {t.violationsNote
                .split(t.violationsImmediateTermination)[1]
                .split(t.violationsReportedAuthorities)[0]}
              <span className="text-white font-medium">{t.violationsReportedAuthorities}</span>
              {t.violationsNote
                .split(t.violationsImmediateTermination)[1]
                .split(t.violationsReportedAuthorities)[1]}
            </p>
          </div>
        </div>
      </div>

      {/* Feature cards grid */}
      <div className="px-4">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t.exploreFeaturesHeading}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {featureRoutes.map((feat, i) => {
            const card = t.featureCards[i];
            const content = (
              <div
                key={card.title}
                className="group relative rounded-xl p-4 bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.06] transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${feat.color} flex items-center justify-center text-lg`}
                  >
                    {feat.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white group-hover:text-[#D4007A] transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-xs text-white/50 mt-1 leading-relaxed">
                      {card.desc}
                    </p>
                  </div>
                  <svg
                    className="w-4 h-4 text-white/20 group-hover:text-white/40 mt-1 flex-shrink-0 transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            );

            if (feat.external) {
              return (
                <a
                  key={card.title}
                  href={feat.external}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {content}
                </a>
              );
            }

            return (
              <Link key={card.title} to={feat.route!}>
                {content}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Quick start checklist */}
      <div className="mx-4 mt-6 p-4 rounded-xl bg-white/[0.04] border border-white/[0.06]">
        <h3 className="text-sm font-semibold text-white mb-3">
          {t.quickStartTitle}
        </h3>
        <div className="space-y-2">
          {(t.quickStartItems as readonly string[]).map((item) => (
            <div key={item} className="flex items-start gap-2">
              <span className="text-[#D4007A] text-xs mt-0.5">&#10003;</span>
              <span className="text-xs text-white/60">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA buttons */}
      <div className="mx-4 mt-6 flex flex-col sm:flex-row gap-3">
        <Link
          to="/"
          className="flex-1 text-center py-3 px-6 rounded-xl bg-gradient-to-r from-[#D4007A] to-[#E69138] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          {t.explorePnptvCta}
        </Link>
        <a
          href="https://t.me/PNPtvBot"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center py-3 px-6 rounded-xl border border-white/10 text-white/70 font-medium text-sm hover:bg-white/[0.04] transition-colors"
        >
          {t.openTelegramBotCta}
        </a>
      </div>

      {/* Support */}
      <div className="mx-4 mt-4 mb-8 text-center">
        <p className="text-xs text-white/30">
          {t.needHelp}{" "}
          <Link to="/support" className="text-[#D4007A] hover:underline">
            {t.contactSupport}
          </Link>
        </p>
      </div>
    </div>
  );
}
