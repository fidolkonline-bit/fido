import type { MetadataRoute } from "next";

// Installable app on Android, iPhone/iPad (Add to Home Screen), Windows and Mac (Chrome / Edge "Install app").
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Fido",
    short_name: "Fido",
    description: "Fido shop operations: POS, stock, repairs and staff tasks",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#242a26",
    theme_color: "#242a26",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the app icon (Android) or right-click it (Windows) to jump straight in.
    shortcuts: [
      { name: "POS", url: "/pos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "New repair", url: "/repairs/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Tasks", url: "/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
