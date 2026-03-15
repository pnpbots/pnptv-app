import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Hide splash screen after React mounts
requestAnimationFrame(() => {
  const splash = document.getElementById("splash");
  if (splash) {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 500);
  }
});

// ── Service Worker update detection ────────────────────────────────────────
if ("serviceWorker" in navigator) {
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

