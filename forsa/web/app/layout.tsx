import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa";
import { I18nProvider } from "@/lib/i18n";
import { PrefsProvider, themeBootScript } from "@/lib/prefs";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], variable: "--font-arabic",
  display: "swap" });

export const metadata: Metadata = {
  title: { default: "FORSA", template: "%s · FORSA" },
  description: "Evidence-first commercial intelligence — find the opportunities your company can win.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "FORSA" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f5f3ee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${arabic.variable}`} suppressHydrationWarning>
      <head>
        {/* Sets the theme before first paint so there is no light/dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <PrefsProvider>
          <I18nProvider>{children}</I18nProvider>
        </PrefsProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
