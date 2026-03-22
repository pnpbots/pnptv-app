import { Suspense, lazy } from "react";
import { useNavigate } from "react-router-dom";

const StreamerDashboard = lazy(() => import("@/components/streaming/StreamerDashboard"));

export default function BrowserStream() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 bg-pnp-background">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <StreamerDashboard onClose={() => navigate("/")} />
      </Suspense>
    </div>
  );
}
