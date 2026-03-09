import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Dismiss splash screen after React mounts
requestAnimationFrame(() => {
  const splash = document.getElementById("splash");
  if (splash) {
    setTimeout(() => {
      splash.classList.add("hide");
      setTimeout(() => splash.remove(), 500);
    }, 1400);
  }
});

