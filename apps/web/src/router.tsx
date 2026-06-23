import React, { lazy, useEffect, useState } from "react";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { joinHangoutByInvite, ApiError } from "@/lib/api";

function HangoutToChatRedirect() {
  const { groupId } = useParams();
  return <Navigate to={`/chat/${groupId}`} replace />;
}

function HangoutInviteRedirect() {
  const { code } = useParams();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setTarget("/?view=hangouts");
      return;
    }
    joinHangoutByInvite(code)
      .then((r) => {
        if (cancelled) return;
        setTarget(r?.groupId ? `/chat/${r.groupId}` : "/?view=hangouts");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setTarget("/login");
          return;
        }
        const msg = err instanceof Error ? err.message : "Invalid invite link";
        try {
          sessionStorage.setItem("pnptv:flash", JSON.stringify({ type: "error", message: msg }));
        } catch {}
        setTarget("/?view=hangouts");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!target) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black text-white">
        <div className="text-sm opacity-70">Joining hangout…</div>
      </div>
    );
  }
  return <Navigate to={target} replace />;
}

import { Layout } from "@/components/Layout";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ModuleLoader } from "@/components/ModuleLoader";
import { VerificationGate } from "@/components/VerificationGate";
import { TierGate } from "@/components/TierGate";

// Main Stage accepts unauthenticated guests when they arrive via a redeemed
// invite (credentials in sessionStorage at `pnptv:ms:guest`). Wrap the page so
// VerificationGate is bypassed in that case — guests already accepted terms +
// confirmed age on the invite form.
//
// IMPORTANT: lock the decision in on initial mount via useState initializer.
// MainStage consumes (deletes) the sessionStorage key when it reads creds, so
// any subsequent re-render of this gate would see an empty sessionStorage and
// fall through to VerificationGate → /login. The useState snapshot prevents that.
function MainStageRouteGate({ children }: { children: React.ReactNode }) {
  const [hasGuestCreds] = useState(() => {
    try {
      const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("pnptv:ms:guest") : null;
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !!(parsed?.token && parsed?.livekitUrl && parsed?.roomName);
    } catch { return false; }
  });
  if (hasGuestCreds) return <>{children}</>;
  return <VerificationGate>{children}</VerificationGate>;
}

const Home = lazy(() => import("@/pages/Home"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Live = lazy(() => import("@/pages/Live"));
const Stream = lazy(() => import("@/pages/Stream"));
const Nearby = lazy(() => import("@/pages/Nearby"));
const Channels = lazy(() => import("@/pages/Channels"));
const Chat = lazy(() => import("@/pages/Chat"));
const Social = lazy(() => import("@/pages/Social"));
const Profile = lazy(() => import("@/pages/Profile"));
const Subscribe = lazy(() => import("@/pages/Subscribe"));
const MyAccess = lazy(() => import("@/pages/MyAccess"));
const DirectMessages = lazy(() => import("@/pages/DirectMessages"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const TokenCheckout = lazy(() => import("@/pages/TokenCheckout"));
const Support = lazy(() => import("@/pages/Support"));
const Apply = lazy(() => import("@/pages/Apply"));
const Welcome = lazy(() => import("@/pages/Welcome"));
const Join = lazy(() => import("@/pages/Join"));
const BecomeModel = lazy(() => import("@/pages/BecomeModel"));
const CmsPage = lazy(() => import("@/pages/CmsPage"));
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const BlogPage = lazy(() => import("@/pages/BlogPage"));
const AboutPage = lazy(() => import("@/pages/AboutPage"));
const CareersPage = lazy(() => import("@/pages/CareersPage"));
const Legal2257Page = lazy(() => import("@/pages/Legal2257Page"));
const CommunityResourcesPage = lazy(() => import("@/pages/CommunityResourcesPage"));
const ShopPage = lazy(() => import("@/pages/ShopPage"));
const DownloadPage = lazy(() => import("@/pages/DownloadPage"));
const DashBankPage = lazy(() => import("@/pages/DashBankPage"));
const MainStage = lazy(() => import("@/pages/MainStage"));
const MainStageAdmin = lazy(() => import("@/pages/MainStageAdmin"));
const MainStageGuestJoin = lazy(() => import("@/pages/MainStageGuestJoin"));

const PostDetail = lazy(() => import("@/pages/PostDetail"));
const Settings = lazy(() => import("@/pages/Settings"));
const AccountSettings = lazy(() => import("@/pages/settings/AccountSettings"));
const PreferencesSettings = lazy(() => import("@/pages/settings/PreferencesSettings"));
const NotificationsSettings = lazy(() => import("@/pages/settings/NotificationsSettings"));
const PrivacySettings = lazy(() => import("@/pages/settings/PrivacySettings"));
const PaymentsSettings = lazy(() => import("@/pages/settings/PaymentsSettings"));
const DangerZoneSettings = lazy(() => import("@/pages/settings/DangerZoneSettings"));
const BookingConfirmation = lazy(() => import("@/pages/BookingConfirmation"));
const CallRoom = lazy(() => import("@/pages/CallRoom"));

// Admin pages
const StatsOverview = lazy(() => import("@/pages/admin/StatsOverview"));
const UserManagement = lazy(() => import("@/pages/admin/UserManagement"));
const UserDetail = lazy(() => import("@/pages/admin/UserDetail"));
const PlanManagement = lazy(() => import("@/pages/admin/PlanManagement"));
const ContentModeration = lazy(() => import("@/pages/admin/ContentModeration"));
const HangoutModeration = lazy(() => import("@/pages/admin/HangoutModeration"));
const AdminReports = lazy(() => import("@/pages/admin/Reports"));
const CreatorApplications = lazy(() => import("@/pages/admin/CreatorApplications"));
const AdminNotifications = lazy(() => import("@/pages/admin/AdminNotifications"));
const ExternalServices = lazy(() => import("@/pages/admin/ExternalServices"));
const NearbyPlaces = lazy(() => import("@/pages/admin/NearbyPlaces"));
const CanvaIntegration = lazy(() => import("@/pages/admin/CanvaIntegration"));
const AdminDemographics = lazy(() => import("@/pages/admin/AdminDemographics"));
const Mono = lazy(() => import("@/pages/admin/Mono"));
const Gamification = lazy(() => import("@/pages/admin/Gamification"));
const MediaPacks = lazy(() => import("@/pages/admin/MediaPacks"));
const StreamManagement = lazy(() => import("@/pages/admin/StreamManagement"));
const SupportDashboard = lazy(() => import("@/pages/admin/SupportDashboard"));
const AccessMatrix = lazy(() => import("@/pages/admin/AccessMatrix"));
const CreatorSubscriptions = lazy(() => import("@/pages/admin/CreatorSubscriptions"));
const XAutoCampaigns = lazy(() => import("@/pages/admin/XAutoCampaigns"));
const MeruLinks = lazy(() => import("@/pages/admin/MeruLinks"));
const DuplicateAccounts = lazy(() => import("@/pages/admin/DuplicateAccounts"));
const PaymentHealth = lazy(() => import("@/pages/admin/PaymentHealth"));
const HangoutTelegramHealth = lazy(() => import("@/pages/admin/HangoutTelegramHealth"));
const WellnessShell = lazy(() => import("@/pages/WellnessShell"));
const SelfCareCenter = lazy(() => import("@/pages/SelfCareCenter"));
const CristinaPage = lazy(() => import("@/components/CristinaWidget").then((m) => ({ default: m.CristinaWidget })));
const PrimeChannel = lazy(() => import("@/pages/admin/PrimeChannel"));
const Compliance2257 = lazy(() => import("@/pages/admin/Compliance2257"));
const AdminInviteLinks = lazy(() => import("@/pages/admin/InviteLinks"));
const Lifetime100 = lazy(() => import("@/pages/Lifetime100"));
const CryptoGuide = lazy(() => import("@/pages/CryptoGuide"));
const GamificationPage = lazy(() => import("@/pages/GamificationPage"));
const ReferralCenter = lazy(() => import("@/pages/ReferralCenter"));
const InvitePage = lazy(() => import("@/pages/InvitePage"));
const ConfirmPayment = lazy(() => import("@/pages/ConfirmPayment"));

// Creator Studio pages
const CreatorLayout = lazy(() => import("@/components/creators/CreatorLayout"));
const CreatorOverview = lazy(() => import("@/pages/creators/CreatorOverview"));
const CreatorContent = lazy(() => import("@/pages/creators/CreatorContent"));
const CreatorEarnings = lazy(() => import("@/pages/creators/CreatorEarnings"));
const CreatorPayouts = lazy(() => import("@/pages/creators/CreatorPayouts"));
const CreatorLive = lazy(() => import("@/pages/creators/CreatorLive"));
const CreatorAvailability = lazy(() => import("@/pages/creators/CreatorAvailability"));
const CreatorAnalytics = lazy(() => import("@/pages/creators/CreatorAnalytics"));
const CreatorSettings = lazy(() => import("@/pages/creators/CreatorSettings"));
const CreatorApply = lazy(() => import("@/pages/creators/CreatorApply"));
const Appeal = lazy(() => import("@/pages/Appeal"));
const CreatorSubscribers = lazy(() => import("@/components/creators/CreatorLayout").then(m => ({ default: m.CreatorSubscribers })));
const CreatorConsents = lazy(() => import("@/components/creators/CreatorLayout").then(m => ({ default: m.CreatorConsents })));
const CreatorXCampaignsPage = lazy(() => import("@/components/creators/CreatorLayout").then(m => ({ default: m.CreatorXCampaigns })));
const CreatorGuidelines = lazy(() => import("@/pages/creators/CreatorGuidelines"));
const Donate = lazy(() => import("@/pages/Donate"));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Home />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "media",
        element: <Navigate to="/channels" replace />,
      },
      {
        path: "live",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Live />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "live/:streamId",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Stream />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "nearby",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Nearby />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "explore",
        element: <Navigate to="/nearby" replace />,
      },
      {
        path: "channels",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Channels />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "booking/:bookingId/confirm",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <BookingConfirmation />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "call/:bookingId",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <CallRoom />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "chat",
        element: <Navigate to="/?view=hangouts" replace />,
      },
      {
        path: "chat/:groupId",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Chat />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "mainstage",
        element: <Navigate to="/main-stage" replace />,
      },
      {
        path: "main-stage",
        element: (
          <ModuleLoader>
            <MainStageRouteGate>
              <MainStage />
            </MainStageRouteGate>
          </ModuleLoader>
        ),
        // Per-route boundary: if a grid or overlay throws, keep the app shell
        // (header, nav) alive and render a small recoverable error state
        // instead of crashing the entire SPA.
        errorElement: (
          <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
               style={{ background: "var(--pnp-background, #0A0A0F)" }}>
            <p className="text-white/80 text-sm font-semibold">Main Stage hit a snag</p>
            <p className="text-white/40 text-xs max-w-sm">
              Something went wrong rendering the stage. The rest of PNPtv is fine.
            </p>
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#D4007A,#7B61FF)" }}
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="min-h-[44px] px-5 rounded-2xl text-sm font-semibold text-white/60"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
              >
                Go back
              </button>
            </div>
          </div>
        ),
      },
      {
        path: "main-stage/admin",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <MainStageAdmin standalone />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "dm",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <DirectMessages />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "dm/:userId",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <DirectMessages />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "social",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Social />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "social/post/:postId",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <PostDetail />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "profile",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Profile />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "profile/:userId",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Profile />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        // Settings: top-level menu + drill-down sub-pages.
        // The Settings component renders both the menu (index) and the right-column
        // shell (with <Outlet /> for sub-pages). Sub-routes render inside Outlet.
        path: "settings",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Settings />
            </VerificationGate>
          </ModuleLoader>
        ),
        children: [
          {
            path: "account",
            element: (
              <ModuleLoader>
                <AccountSettings />
              </ModuleLoader>
            ),
          },
          {
            path: "preferences",
            element: (
              <ModuleLoader>
                <PreferencesSettings />
              </ModuleLoader>
            ),
          },
          {
            path: "notifications",
            element: (
              <ModuleLoader>
                <NotificationsSettings />
              </ModuleLoader>
            ),
          },
          {
            path: "privacy",
            element: (
              <ModuleLoader>
                <PrivacySettings />
              </ModuleLoader>
            ),
          },
          {
            path: "payments",
            element: (
              <ModuleLoader>
                <PaymentsSettings />
              </ModuleLoader>
            ),
          },
          {
            path: "danger",
            element: (
              <ModuleLoader>
                <DangerZoneSettings />
              </ModuleLoader>
            ),
          },
        ],
      },
      {
        // Wellness Mode shell — accessible even when wellness mode is active
        // (the API guard's allowlist permits this route). Renders only the
        // wellness hangouts + Cristina + crisis resources.
        path: "wellness",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <WellnessShell />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        // Self-Care Center — dedicated home for harm-reduction & wellness
        // tools. Hosts the Use Tracker, Wellness Break Mode, Cristina link,
        // crisis resources, and future tools (sleep, mood, accountability).
        path: "self-care",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <SelfCareCenter />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        // Cristina AI page — full-screen mode. Also accessible in wellness mode
        // (the API guard allowlist covers /api/webapp/cristina/*).
        path: "cristina",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <CristinaPage mode="page" />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "welcome",
        element: (
          <ModuleLoader>
            <Welcome />
          </ModuleLoader>
        ),
      },
      {
        path: "subscribe",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Subscribe />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "my-access",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <MyAccess />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "badges",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <GamificationPage />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "referrals",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <ReferralCenter />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "support",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Support />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "apply",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Apply />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      { path: "creator", element: <Navigate to="/creators" replace /> },
      { path: "hangouts", element: <Navigate to="/?view=hangouts" replace /> },
      { path: "hangouts/invite/:code", element: <HangoutInviteRedirect /> },
      { path: "hangouts/:groupId", element: <HangoutToChatRedirect /> },
      // Short shareable alias: pnptv.app/h/123 → chat room
      { path: "h/:groupId", element: <HangoutToChatRedirect /> },
      { path: "pnplive", element: <Navigate to="/live" replace /> },
      { path: "pnptv-haus", element: <Navigate to="/?view=hangouts" replace /> },
      { path: "community-room", element: <Navigate to="/?view=hangouts" replace /> },
      { path: "da-haus", element: <Navigate to="/?view=hangouts" replace /> },
      { path: "portal", element: <Navigate to="/" replace /> },
      { path: "plans", element: <Navigate to="/subscribe" replace /> },
      { path: "memberships", element: <Navigate to="/subscribe" replace /> },
    ],
  },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: (
          <ModuleLoader>
            <StatsOverview />
          </ModuleLoader>
        ),
      },
      {
        path: "users",
        element: (
          <ModuleLoader>
            <UserManagement />
          </ModuleLoader>
        ),
      },
      {
        path: "users/:id",
        element: (
          <ModuleLoader>
            <UserDetail />
          </ModuleLoader>
        ),
      },
      {
        path: "plans",
        element: (
          <ModuleLoader>
            <PlanManagement />
          </ModuleLoader>
        ),
      },
      {
        path: "posts",
        element: (
          <ModuleLoader>
            <ContentModeration />
          </ModuleLoader>
        ),
      },
      {
        path: "moderation",
        element: <Navigate to="/admin/posts" replace />,
      },
      {
        path: "hangouts",
        element: (
          <ModuleLoader>
            <HangoutModeration />
          </ModuleLoader>
        ),
      },
      {
        path: "reports",
        element: (
          <ModuleLoader>
            <AdminReports />
          </ModuleLoader>
        ),
      },
      {
        path: "creators",
        element: (
          <ModuleLoader>
            <CreatorApplications />
          </ModuleLoader>
        ),
      },
      {
        path: "notifications",
        element: (
          <ModuleLoader>
            <AdminNotifications />
          </ModuleLoader>
        ),
      },
      {
        path: "places",
        element: (
          <ModuleLoader>
            <NearbyPlaces />
          </ModuleLoader>
        ),
      },
      {
        path: "services",
        element: (
          <ModuleLoader>
            <ExternalServices />
          </ModuleLoader>
        ),
      },
      {
        path: "canva",
        element: (
          <ModuleLoader>
            <CanvaIntegration />
          </ModuleLoader>
        ),
      },
      {
        path: "demographics",
        element: (
          <ModuleLoader>
            <AdminDemographics />
          </ModuleLoader>
        ),
      },
      {
        path: "prime",
        element: (
          <ModuleLoader>
            <PrimeChannel />
          </ModuleLoader>
        ),
      },
      {
        path: "mono",
        element: (
          <ModuleLoader>
            <Mono />
          </ModuleLoader>
        ),
      },
      {
        path: "gamification",
        element: (
          <ModuleLoader>
            <Gamification />
          </ModuleLoader>
        ),
      },
      {
        path: "media-packs",
        element: (
          <ModuleLoader>
            <MediaPacks />
          </ModuleLoader>
        ),
      },
      {
        path: "streams",
        element: (
          <ModuleLoader>
            <StreamManagement />
          </ModuleLoader>
        ),
      },
      {
        path: "support",
        element: (
          <ModuleLoader>
            <SupportDashboard />
          </ModuleLoader>
        ),
      },
      {
        path: "access-matrix",
        element: (
          <ModuleLoader>
            <AccessMatrix />
          </ModuleLoader>
        ),
      },
      {
        path: "creator-subscriptions",
        element: (
          <ModuleLoader>
            <CreatorSubscriptions />
          </ModuleLoader>
        ),
      },
      {
        path: "x-campaigns",
        element: (
          <ModuleLoader>
            <XAutoCampaigns />
          </ModuleLoader>
        ),
      },
      {
        path: "meru-links",
        element: (
          <ModuleLoader>
            <MeruLinks />
          </ModuleLoader>
        ),
      },
      {
        path: "duplicate-accounts",
        element: (
          <ModuleLoader>
            <DuplicateAccounts />
          </ModuleLoader>
        ),
      },
      {
        path: "payment-health",
        element: (
          <ModuleLoader>
            <PaymentHealth />
          </ModuleLoader>
        ),
      },
      {
        path: "hangout-telegram-health",
        element: (
          <ModuleLoader>
            <HangoutTelegramHealth />
          </ModuleLoader>
        ),
      },
      {
        path: "compliance-2257",
        element: (
          <ModuleLoader>
            <Compliance2257 />
          </ModuleLoader>
        ),
      },
      {
        path: "invite-links",
        element: (
          <ModuleLoader>
            <AdminInviteLinks />
          </ModuleLoader>
        ),
      },
    ],
  },
  // Creator Studio section
  {
    path: "/creators",
    element: (
      <ModuleLoader>
        <CreatorLayout />
      </ModuleLoader>
    ),
    children: [
      { index: true, element: <ModuleLoader><CreatorOverview /></ModuleLoader> },
      { path: "content", element: <ModuleLoader><CreatorContent /></ModuleLoader> },
      { path: "earnings", element: <ModuleLoader><CreatorEarnings /></ModuleLoader> },
      { path: "payouts", element: <ModuleLoader><CreatorPayouts /></ModuleLoader> },
      { path: "live", element: <ModuleLoader><CreatorLive /></ModuleLoader> },
      { path: "availability", element: <ModuleLoader><CreatorAvailability /></ModuleLoader> },
      { path: "analytics", element: <ModuleLoader><CreatorAnalytics /></ModuleLoader> },
      { path: "settings", element: <ModuleLoader><CreatorSettings /></ModuleLoader> },
      { path: "apply", element: <ModuleLoader><CreatorApply /></ModuleLoader> },
      { path: "subscribers", element: <ModuleLoader><CreatorSubscribers /></ModuleLoader> },
      { path: "consents", element: <ModuleLoader><CreatorConsents /></ModuleLoader> },
      { path: "x-campaigns", element: <ModuleLoader><CreatorXCampaignsPage /></ModuleLoader> },
      { path: "guidelines", element: <ModuleLoader><CreatorGuidelines /></ModuleLoader> },
    ],
  },
  // Main Stage guest join — public, no auth, no Layout shell
  {
    path: "/main-stage/join/:code",
    element: (
      <ModuleLoader>
        <MainStageGuestJoin />
      </ModuleLoader>
    ),
  },
  {
    path: "/reset-password",
    element: (
      <ModuleLoader>
        <ResetPassword />
      </ModuleLoader>
    ),
  },
  {
    path: "/appeal",
    element: (
      <ModuleLoader>
        <Appeal />
      </ModuleLoader>
    ),
  },
  {
    path: "/donate",
    element: (
      <ModuleLoader>
        <Donate />
      </ModuleLoader>
    ),
  },
  {
    path: "/login",
    element: (
      <ModuleLoader>
        <LandingPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/auth",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/join",
    element: (
      <ModuleLoader>
        <Join />
      </ModuleLoader>
    ),
  },
  ...[
    "terms",
    "privacy",
    "cookies",
    "community-guidelines",
    "content-policy",
    "refunds",
    "subscriptions",
    "creator-terms",
    "dmca",
    "safety",
    "contact",
  ].map((slug) => ({
    path: `/${slug}`,
    element: (
      <ModuleLoader>
        <CmsPage />
      </ModuleLoader>
    ),
  })),
  {
    path: "/blog",
    element: (
      <ModuleLoader>
        <BlogPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/about",
    element: (
      <ModuleLoader>
        <AboutPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/careers",
    element: (
      <ModuleLoader>
        <CareersPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/2257",
    element: (
      <ModuleLoader>
        <Legal2257Page />
      </ModuleLoader>
    ),
  },
  {
    path: "/community-resources",
    element: (
      <ModuleLoader>
        <CommunityResourcesPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/shop",
    element: (
      <ModuleLoader>
        <ShopPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/download",
    element: (
      <ModuleLoader>
        <DownloadPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/bank",
    element: (
      <ModuleLoader>
        <DashBankPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/landing",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/become-a-model",
    element: (
      <ModuleLoader>
        <BecomeModel />
      </ModuleLoader>
    ),
  },
  {
    path: "/become-model",
    element: <Navigate to="/become-a-model" replace />,
  },
  { path: "/lifetime80", element: <Navigate to="/lifetime100" replace /> },
  {
    path: "/lifetime100",
    element: (
      <ModuleLoader>
        <Lifetime100 />
      </ModuleLoader>
    ),
  },
  {
    path: "/crypto-guide",
    element: (
      <ModuleLoader>
        <CryptoGuide />
      </ModuleLoader>
    ),
  },
  {
    path: "/how-to-pay",
    element: (
      <ModuleLoader>
        <CryptoGuide />
      </ModuleLoader>
    ),
  },
  // Invite page — public, no auth required (handles its own auth check inline)
  {
    path: "/invite/:code",
    element: (
      <ModuleLoader>
        <InvitePage />
      </ModuleLoader>
    ),
  },
  // Public alias — /lifetime → /subscribe (offer closed)
  { path: "/lifetime", element: <Navigate to="/subscribe" replace /> },
  { path: "/lifetime100b", element: <Navigate to="/lifetime100" replace /> },
  {
    path: "/page/:slug",
    element: (
      <ModuleLoader>
        <CmsPage />
      </ModuleLoader>
    ),
  },
  {
    path: "/auth/callback",
    element: (
      <ModuleLoader>
        <AuthCallback />
      </ModuleLoader>
    ),
  },
  {
    path: "/token-checkout/:purchaseId",
    element: (
      <ModuleLoader>
        <VerificationGate>
          <TokenCheckout />
        </VerificationGate>
      </ModuleLoader>
    ),
  },
  {
    path: "/confirm-payment/:token",
    element: (
      <ModuleLoader>
        <ConfirmPayment />
      </ModuleLoader>
    ),
  },
]);
