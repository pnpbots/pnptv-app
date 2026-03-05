import React, { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ModuleLoader } from "@/components/ModuleLoader";
import { VerificationGate } from "@/components/VerificationGate";
import { PrimeGate } from "@/components/PrimeGate";

const Home = lazy(() => import("@/pages/Home"));
const Media = lazy(() => import("@/pages/Media"));
const Live = lazy(() => import("@/pages/Live"));
const Booking = lazy(() => import("@/pages/Booking"));
const Chat = lazy(() => import("@/pages/Chat"));
const Social = lazy(() => import("@/pages/Social"));
const Profile = lazy(() => import("@/pages/Profile"));
const CreatorDashboard = lazy(() => import("@/pages/CreatorDashboard"));
const Subscribe = lazy(() => import("@/pages/Subscribe"));
const DirectMessages = lazy(() => import("@/pages/DirectMessages"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const DaimoCheckout = lazy(() => import("@/pages/DaimoCheckout"));
const Support = lazy(() => import("@/pages/Support"));
const Apply = lazy(() => import("@/pages/Apply"));
const Welcome = lazy(() => import("@/pages/Welcome"));
const Join = lazy(() => import("@/pages/Join"));

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
              <PrimeGate>
                <Media />
              </PrimeGate>
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
        path: "booking",
        element: (
          <ModuleLoader>
            <VerificationGate>
              <Booking />
            </VerificationGate>
          </ModuleLoader>
        ),
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
    ],
  },
  {
    path: "/join",
    element: (
      <ModuleLoader>
        <Join />
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
]);
