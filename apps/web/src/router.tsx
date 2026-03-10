import React, { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ModuleLoader } from "@/components/ModuleLoader";
import { VerificationGate } from "@/components/VerificationGate";
import { TierGate } from "@/components/TierGate";

const Home = lazy(() => import("@/pages/Home"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const Media = lazy(() => import("@/pages/Media"));
const Live = lazy(() => import("@/pages/Live"));
const Stream = lazy(() => import("@/pages/Stream"));
const Nearby = lazy(() => import("@/pages/Nearby"));
const Chat = lazy(() => import("@/pages/Chat"));
const Social = lazy(() => import("@/pages/Social"));
const Profile = lazy(() => import("@/pages/Profile"));
const CreatorDashboard = lazy(() => import("@/pages/CreatorDashboard"));
const Subscribe = lazy(() => import("@/pages/Subscribe"));
const DirectMessages = lazy(() => import("@/pages/DirectMessages"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const DaimoCheckout = lazy(() => import("@/pages/DaimoCheckout"));
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
const CommunityResourcesPage = lazy(() => import("@/pages/CommunityResourcesPage"));
const ShopPage = lazy(() => import("@/pages/ShopPage"));
const DownloadPage = lazy(() => import("@/pages/DownloadPage"));
const MainStage = lazy(() => import("@/pages/MainStage"));
const PostDetail = lazy(() => import("@/pages/PostDetail"));
const Settings = lazy(() => import("@/pages/Settings"));

// Admin pages
const StatsOverview = lazy(() => import("@/pages/admin/StatsOverview"));
const UserManagement = lazy(() => import("@/pages/admin/UserManagement"));
const UserDetail = lazy(() => import("@/pages/admin/UserDetail"));
const PlanManagement = lazy(() => import("@/pages/admin/PlanManagement"));
const ContentModeration = lazy(() => import("@/pages/admin/ContentModeration"));
const HangoutModeration = lazy(() => import("@/pages/admin/HangoutModeration"));
const CreatorApplications = lazy(() => import("@/pages/admin/CreatorApplications"));
const AdminNotifications = lazy(() => import("@/pages/admin/AdminNotifications"));
const ExternalServices = lazy(() => import("@/pages/admin/ExternalServices"));
const NearbyPlaces = lazy(() => import("@/pages/admin/NearbyPlaces"));
const CanvaIntegration = lazy(() => import("@/pages/admin/CanvaIntegration"));
const XAutoCampaigns = lazy(() => import("@/pages/admin/XAutoCampaigns"));
const AdminDemographics = lazy(() => import("@/pages/admin/AdminDemographics"));
const Mono = lazy(() => import("@/pages/admin/Mono"));
const Gamification = lazy(() => import("@/pages/admin/Gamification"));
const StreamManagement = lazy(() => import("@/pages/admin/StreamManagement"));
const SupportDashboard = lazy(() => import("@/pages/admin/SupportDashboard"));
const AccessMatrix = lazy(() => import("@/pages/admin/AccessMatrix"));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <ModuleLoader>
            <Home />
          </ModuleLoader>
        ),
      },
      {
        path: "media",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <TierGate required="prime">
                <Media />
              </TierGate>
            </VerificationGate>
          </ModuleLoader>
        ),
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
        path: "booking",
        element: <Navigate to="/nearby" replace />,
      },
      {
        path: "chat",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Chat />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
      {
        path: "main-stage",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <MainStage />
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
            <Profile />
          </ModuleLoader>
        ),
      },
      {
        path: "settings",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Settings />
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
      {
        path: "become-a-model",
        element: (
          <ModuleLoader>
            <BecomeModel />
          </ModuleLoader>
        ),
      },
      {
        path: "creator",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <CreatorDashboard />
            </VerificationGate>
          </ModuleLoader>
        ),
      },
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
        path: "hangouts",
        element: (
          <ModuleLoader>
            <HangoutModeration />
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
        path: "x-campaigns",
        element: (
          <ModuleLoader>
            <XAutoCampaigns />
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
    ],
  },
  {
    path: "/login",
    element: (
      <ModuleLoader>
        <LoginPage />
      </ModuleLoader>
    ),
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
    path: "/landing",
    element: (
      <ModuleLoader>
        <LandingPage />
      </ModuleLoader>
    ),
  },
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
    path: "/checkout/:paymentId",
    element: (
      <ModuleLoader>
        <DaimoCheckout />
      </ModuleLoader>
    ),
  },
  {
    path: "/token-checkout/:purchaseId",
    element: (
      <ModuleLoader>
        <TokenCheckout />
      </ModuleLoader>
    ),
  },
]);
