import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(<App />);

// Hide splash screen
const splash = document.getElementById("splash");
if (splash) splash.classList.add("hidden");

// Register service worker for PWA support
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
}
