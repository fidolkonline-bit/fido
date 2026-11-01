import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { PwaBoot } from "@/components/pwa/PwaBoot";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fido", template: "%s · Fido" },
  description: "Fido shop operations",
  applicationName: "Fido",
  appleWebApp: { capable: true, title: "Fido", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#242a26" },
    { media: "(prefers-color-scheme: dark)", color: "#111512" },
  ],
};

// The theme cookie is read on the server so the first paint is already in the chosen theme (no flash).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("fido_theme")?.value;
  return (
    <html lang="en" data-theme={theme === "light" || theme === "dark" ? theme : undefined} suppressHydrationWarning>
      <body>
        {children}
        <PwaBoot />
      </body>
    </html>
  );
}
