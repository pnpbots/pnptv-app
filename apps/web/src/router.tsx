import React, { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Layout } from "@/components/Layout";
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
const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const CreatorDashboard = lazy(() => import("@/pages/CreatorDashboard"));
const CreatorApplications = lazy(() => import("@/pages/admin/CreatorApplications"));
const Subscribe = lazy(() => import("@/pages/Subscribe"));
const DirectMessages = lazy(() => import("@/pages/DirectMessages"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const Support = lazy(() => import("@/pages/Support"));
const Apply = lazy(() => import("@/pages/Apply"));

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
              <PrimeGate>
                <Booking />
              </PrimeGate>
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
      {
        path: "admin/creators",
        element: (
          <ModuleLoader>
            <CreatorApplications />
          </ModuleLoader>
        ),
      },
      {
        path: "admin/*",
        element: (
          <ModuleLoader>
            <AdminDashboard />
          </ModuleLoader>
        ),
      },
    ],
  },
  {
    path: "/auth/callback",
    element: (
      <ModuleLoader>
        <AuthCallback />
      </ModuleLoader>
    ),
  },
]);
