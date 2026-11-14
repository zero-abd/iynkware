"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/local/sw-register";

/** Registers the offline worker once the page has loaded, so it never competes with the page for the network. It draws nothing. */
export function SwRegister() {
  useEffect(() => {
    const register = () => {
      registerServiceWorker({
        nav: navigator,
        buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "",
        isProd: process.env.NODE_ENV === "production",
        location: window.location,
      }).catch(() => {
        // The page works without a worker.
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
