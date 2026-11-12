import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";

const plex = IBM_Plex_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Any Stock",
  description: "A quiet watchlist for the stocks you're actually watching.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plex.variable}`}>
      <body>
        <Suspense fallback={null}>
          <SiteNav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
