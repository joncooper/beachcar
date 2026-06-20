import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!clerkPublishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App clerkPublishableKey={clerkPublishableKey} />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app still works without offline shell caching.
    });
  });
}
