import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";

export default function StudioLayout() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const t = useI18n();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pnp-background">
        <div className="w-8 h-8 border-2 border-pnp-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-pnp-background px-4 text-center">
        <h1 className="text-xl font-bold text-white mb-2">PNPtv! Studio</h1>
        <p className="text-sm text-pnp-textSecondary mb-6">{t.notAuthenticated}</p>
        <a
          href="https://app.pnptv.app/login"
          className="px-6 py-3 rounded-xl text-sm font-bold text-white btn-gradient"
        >
          {t.goToLogin}
        </a>
      </div>
    );
  }

  const isCreator =
    user?.role === "model" ||
    user?.role === "creator" ||
    user?.role === "admin" ||
    user?.role === "superadmin" ||
    user?.creator_status === "active";

  if (!isCreator) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-pnp-background px-4 text-center">
        <h1 className="text-xl font-bold text-white mb-2">PNPtv! Studio</h1>
        <p className="text-sm text-pnp-textSecondary mb-6">{t.notCreator}</p>
        <a
          href="https://app.pnptv.app/become-a-model"
          className="px-6 py-3 rounded-xl text-sm font-bold text-white btn-gradient"
        >
          {t.applyAsCreator}
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pnp-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 border-b border-pnp-border bg-pnp-background/90 backdrop-blur-md">
        <button
          onClick={() => navigate("/")}
          className="text-sm font-bold text-gradient"
        >
          PNPtv! Studio
        </button>
        <div className="flex items-center gap-3">
          <a
            href="https://app.pnptv.app"
            className="text-xs text-pnp-textSecondary hover:text-white transition-colors"
          >
            app.pnptv.app
          </a>
          <div className="flex items-center gap-2">
            {user?.photoUrl && (
              <img
                src={user.photoUrl}
                alt=""
                className="w-7 h-7 rounded-full object-cover border border-pnp-border"
              />
            )}
            <span className="text-xs text-pnp-textPrimary hidden sm:inline">
              {user?.displayName}
            </span>
          </div>
          <button
            onClick={logout}
            className="text-xs text-pnp-textSecondary hover:text-pnp-error transition-colors"
          >
            {t.logOut}
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
