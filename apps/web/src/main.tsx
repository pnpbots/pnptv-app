import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

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

window.addEventListener("error", (event) => {
  const message = String(event.error?.message || event.message || "");
  const file = String(event.filename || "");
  const isStaleChunk =
    file.includes("/assets/Chat-") &&
    (message.includes("before initialization") || message.includes("is not defined"));
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
try { screen.orientation?.lock?.("portrait").catch(() => {}); } catch {}

if (!resetInProgress) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
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

// ── Service Worker update detection ────────────────────────────────────────
if (!resetInProgress && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    // Check for updates every 60s
    setInterval(() => reg.update(), 60_000);

    const onNewSW = (sw: ServiceWorker) => {
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          // New SW waiting → notify app
          window.dispatchEvent(new CustomEvent("sw-update-available", { detail: sw }));
        }
      });
    };

    if (reg.waiting) {
      // Already a waiting SW on page load
      window.dispatchEvent(new CustomEvent("sw-update-available", { detail: reg.waiting }));
    }
    if (reg.installing) onNewSW(reg.installing);
    reg.addEventListener("updatefound", () => {
      if (reg.installing) onNewSW(reg.installing);
    });
  });

  // When the new SW takes over, reload the page
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
