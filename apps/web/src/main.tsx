import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

const REALTIME_SESSION_KEY = "pnptv:active-realtime-session";
const SW_UPDATE_PENDING_KEY = "pnptv:sw-update-pending";

async function clearClientCaches() {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

function hasActiveRealtimeSession(): boolean {
  try {
    return !!sessionStorage.getItem(REALTIME_SESSION_KEY);
  } catch {
    return false;
  }
}

function markSwUpdatePending(): void {
  try {
    sessionStorage.setItem(SW_UPDATE_PENDING_KEY, "1");
  } catch {
    // ignore storage failures
  }
}

function clearSwUpdatePending(): void {
  try {
    sessionStorage.removeItem(SW_UPDATE_PENDING_KEY);
  } catch {
    // ignore storage failures
  }
}

function dispatchSwUpdateStatus(status: string): void {
  try {
    window.dispatchEvent(new CustomEvent("pnptv:sw-update-status", { detail: { status } }));
  } catch {
    // ignore event dispatch failures
  }
}

const url = new URL(window.location.href);
const resetInProgress = url.searchParams.get("update") === "1" || url.searchParams.get("reset") === "1";
if (resetInProgress) {
  clearClientCaches()
    .catch(() => undefined)
    .finally(() => {
      url.searchParams.delete("update");
      url.searchParams.delete("reset");
      window.location.replace(url.toString());
    });
  document.documentElement.style.background = "#0a0a14";
  document.body.innerHTML = "";
}

// Vite 4.4+ emits this when a dynamic import chunk fails to load (stale build hash).
// Silently reload once — the new build's chunks will be fetched fresh.
window.addEventListener("vite:preloadError", () => {
  if (sessionStorage.getItem("pnptv:stale-chunk-reload") === "1") return;
  sessionStorage.setItem("pnptv:stale-chunk-reload", "1");
  clearClientCaches()
    .catch(() => undefined)
    .finally(() => {
      const retryUrl = new URL(window.location.href);
      retryUrl.searchParams.set("update", "1");
      window.location.replace(retryUrl.toString());
    });
});

window.addEventListener("error", (event) => {
  const message = String(event.error?.message || event.message || "");
  const file = String(event.filename || "");
  const isStaleChunk =
    file.includes("/assets/") &&
    (message.includes("Failed to fetch dynamically imported module") ||
     message.includes("Importing a module script failed") ||
     (file.includes("/assets/Chat-") && (message.includes("before initialization") || message.includes("is not defined"))));
  if (!isStaleChunk || sessionStorage.getItem("pnptv:stale-chunk-reload") === "1") return;

  sessionStorage.setItem("pnptv:stale-chunk-reload", "1");
  clearClientCaches()
    .catch(() => undefined)
    .finally(() => {
      const retryUrl = new URL(window.location.href);
      retryUrl.searchParams.set("update", "1");
      window.location.replace(retryUrl.toString());
    });
});

// ── Patch DOM to prevent "removeChild" / "insertBefore" crashes ──────────────
// Browser extensions (Google Translate, ad blockers, etc.) and PWA chrome can
// mutate the DOM outside of React. When React later tries to reconcile, it
// calls removeChild/insertBefore on a node whose children have shifted, causing
// "NotFoundError: The node to be removed is not a child of this node."
// This patch makes those calls no-ops when the child doesn't belong to the parent.
if (typeof Node !== "undefined") {
  const origRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      console.warn("[DOM patch] removeChild: node is not a child, skipping", child);
      return child;
    }
    return origRemoveChild.call(this, child) as T;
  };

  const origInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, refNode: Node | null): T {
    if (refNode && refNode.parentNode !== this) {
      console.warn("[DOM patch] insertBefore: ref node is not a child, appending instead", refNode);
      return origInsertBefore.call(this, newNode, null) as T;
    }
    return origInsertBefore.call(this, newNode, refNode) as T;
  };
}

// Lock orientation to portrait (works for installed PWAs)
try { (screen.orientation as any)?.lock?.("portrait").catch(() => {}); } catch {}

if (!resetInProgress) {
  try {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err) {
    const w = window as unknown as { __pnptvShowBootError?: (r: string) => void };
    if (typeof w.__pnptvShowBootError === "function") w.__pnptvShowBootError("render-throw");
    throw err;
  }
}

// Hide splash screen after React mounts
if (!resetInProgress) {
  requestAnimationFrame(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.classList.add("hide");
      setTimeout(() => splash.remove(), 500);
    }
  });
}

// ── Service Worker update detection (silent auto-update) ──────────────────
// New SW finishes installing → wait a 5s grace period for any in-flight user
// action, then SKIP_WAITING so the new SW activates. controllerchange below
// catches that event and reloads the page automatically. No user click needed.
if (!resetInProgress && "serviceWorker" in navigator) {
  const GRACE_MS = 5_000;
  const activateSoon = (sw: ServiceWorker) => {
    setTimeout(() => sw.postMessage({ type: "SKIP_WAITING" }), GRACE_MS);
  };

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    const maybeActivateWaitingWorker = () => {
      if (!reg.waiting) return;
      if (hasActiveRealtimeSession()) {
        markSwUpdatePending();
        dispatchSwUpdateStatus("deferred-active-session");
        return;
      }
      clearSwUpdatePending();
      dispatchSwUpdateStatus("activating");
      activateSoon(reg.waiting);
    };

    // Poll for updates every 60s while the tab is open
    setInterval(() => {
      reg.update();
      maybeActivateWaitingWorker();
    }, 60_000);

    const watchInstalling = (sw: ServiceWorker) => {
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          if (hasActiveRealtimeSession()) {
            markSwUpdatePending();
            dispatchSwUpdateStatus("installed-deferred-active-session");
            return;
          }
          clearSwUpdatePending();
          dispatchSwUpdateStatus("installed-activating");
          activateSoon(sw);
        }
      });
    };

    if (reg.waiting) maybeActivateWaitingWorker();
    if (reg.installing) watchInstalling(reg.installing);
    reg.addEventListener("updatefound", () => {
      if (reg.installing) watchInstalling(reg.installing);
    });

    window.addEventListener("pnptv:realtime-session-change", maybeActivateWaitingWorker);
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasActiveRealtimeSession()) {
      markSwUpdatePending();
      dispatchSwUpdateStatus("controllerchange-deferred-active-session");
      return;
    }
    if (!refreshing) {
      refreshing = true;
      clearSwUpdatePending();
      dispatchSwUpdateStatus("controllerchange-reload");
      window.location.reload();
    }
  });
}
