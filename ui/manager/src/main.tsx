import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import rastaMark from "../../../bin/assets/rasta-mark.svg?inline";

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) favicon.href = rastaMark;

async function start() {
  if (
    import.meta.env.DEV &&
    !window.rastaPreview &&
    !window.webkit?.messageHandlers.rasta
  ) {
    window.rastaModernUI = true;
    // This browser-only fixture is omitted from production bundles by Vite.
    // @ts-expect-error The existing fixture is a plain JavaScript module.
    await import("../../../tools/manager-preview/bridge.js");
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void start();
