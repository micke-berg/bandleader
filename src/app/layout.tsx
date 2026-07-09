import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import { Topbar } from "@/components/Topbar";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Bandleader",
  description:
    "Local-first workbench for AI coding agents. The bandleader decides which model takes the solo.",
};

/**
 * Theme: dark is the no-JS default (:root); the stored choice or the OS
 * preference is stamped on <html data-theme> before first paint.
 */
const themeInit = `(function(){try{var t=localStorage.getItem("bandleader-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the pre-paint script stamps data-theme on
    // <html> before React hydrates; that one attribute is expected to differ.
    <html lang="en" className={`${plexMono.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <div className="shell">
          <Topbar />
          {children}
        </div>
      </body>
    </html>
  );
}
