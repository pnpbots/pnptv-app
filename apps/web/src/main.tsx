import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Dismiss splash screen once React has mounted — hold briefly for visual impact
requestAnimationFrame(() => {
  const splash = document.getElementById("splash");
  if (splash) {
    // Let the splash breathe for a moment before dismissing
    setTimeout(() => {
      splash.classList.add("hide");
      setTimeout(() => splash.remove(), 700);
    }, 600);
  }
});
