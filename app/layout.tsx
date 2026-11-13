import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";

const plex = IBM_Plex_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Any Stock",
  description: "A quiet watchlist for the stocks you're actually watching.",
  appleWebApp: { capable: true, title: "Any Stock", statusBarStyle: "black-translucent" },
  icons: { apple: "/pwa-icon/180" },
};

export const viewport: Viewport = {
  themeColor: "#10141b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plex.variable} ${mono.variable}`}>
      <body>
        <Suspense fallback={null}>
          <SiteNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
