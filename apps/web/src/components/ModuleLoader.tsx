import React, { Suspense, Component, type ReactNode, type ErrorInfo } from "react";
import { Skeleton } from "@pnptv/ui-kit";

function PageSkeleton() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-[#D4007A] border-t-transparent animate-spin" />
    </div>
  );
}

// Detects stale-chunk errors from Vite's dynamic import after a deploy.
// Vite content-hashes chunk filenames, so old HTML referencing old hashes
// gets a 404 on lazy import. One hard reload fixes it; a session flag
// prevents an infinite reload loop if something else is broken.
function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /No se pudo obtener el módu/i.test(msg) ||  // Spanish Firefox/Chrome
    /Couldn't load.*module/i.test(msg) ||
    /Loading chunk/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /vite:preload/i.test(msg)
  );
}

const RELOAD_FLAG = "pnptv_chunk_reload";

interface BoundaryState { crashed: boolean; }

class ChunkErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { crashed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { crashed: true };
  }

  componentDidCatch(err: Error, _info: ErrorInfo) {
    if (isChunkLoadError(err)) {
      // Reload once; if we already tried a reload this session, don't loop.
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.crashed) {
      // If we got here the error wasn't a chunk issue (or the reload itself
      // failed). Show a minimal inline prompt rather than the JS error overlay.
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-sm text-pnp-textSecondary">Something went wrong loading this page.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ModuleLoaderProps {
  children: ReactNode;
}

export function ModuleLoader({ children }: ModuleLoaderProps) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}
