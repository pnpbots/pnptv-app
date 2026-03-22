import { createBrowserRouter } from "react-router-dom";
import { lazy, Suspense } from "react";
import StudioLayout from "@/components/StudioLayout";

const StudioHome = lazy(() => import("@/pages/StudioHome"));
const BrowserStream = lazy(() => import("@/pages/BrowserStream"));
const StreamSettings = lazy(() => import("@/pages/StreamSettings"));

function LazyPage({ Component }: { Component: React.LazyExoticComponent<() => JSX.Element> }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <StudioLayout />,
    children: [
      { index: true, element: <LazyPage Component={StudioHome} /> },
      { path: "stream", element: <LazyPage Component={BrowserStream} /> },
      { path: "settings", element: <LazyPage Component={StreamSettings} /> },
    ],
  },
]);
