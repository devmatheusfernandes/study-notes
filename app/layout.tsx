import type { Metadata, Viewport } from "next";
import { Caprasimo, Figtree, JetBrains_Mono } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import { Toaster } from "@/components/ui/toaster";
import { APPLE_SPLASH_SCREENS } from "@/lib/apple-splash-screens";
import "./globals.css";

const caprasimo = Caprasimo({
  variable: "--font-caprasimo",
  subsets: ["latin"],
  weight: "400",
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Study Notes",
  description: "Suas notas, arquivos e conversas em um só lugar — offline-first.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Study Notes",
  },
  icons: {
    icon: [
      { url: "/pwa-icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa-icons/icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/pwa-icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#121110",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${caprasimo.variable} ${figtree.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {APPLE_SPLASH_SCREENS.map(({ media, href }) => (
          <link key={href} rel="apple-touch-startup-image" media={media} href={href} />
        ))}
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <SerwistProvider swUrl="/serwist/sw.js">
          {children}
          <Toaster />
        </SerwistProvider>
      </body>
    </html>
  );
}
