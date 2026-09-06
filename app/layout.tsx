import type { Metadata, Viewport } from "next";
import { Caprasimo, Figtree, JetBrains_Mono } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import { Toaster } from "@/components/ui/toaster";
import { DeviceListener } from "@/components/providers/device-listener";
import { SwUpdateListener } from "@/components/providers/sw-update-listener";
import { UpdateToast } from "@/components/providers/update-toast";
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
  // Without this, Android/Chrome leaves the layout viewport (and every dvh/vh
  // calc) untouched when the on-screen keyboard opens and instead just shrinks
  // the *visual* viewport — which is what made the sticky assistant dock and
  // the Vault drawer end up stranded mid-screen once the keyboard closed.
  // "resizes-content" makes the keyboard behave like a real layout resize.
  interactiveWidget: "resizes-content",
  // Opts into drawing under the notch/status bar/home indicator on iOS —
  // required for the env(safe-area-inset-*) paddings already used across the
  // app (sidebar, assistant dock, headers) to resolve to anything but 0.
  viewportFit: "cover",
  // Pinch-to-zoom was left on by default (Next doesn't set maximumScale/
  // userScalable unless asked), which read as a browser tab rather than the
  // native-feeling app this is meant to be — every screen here is already
  // built to fit/scroll on its own, so there's nothing users need pinch-zoom
  // *for*. Android Chrome honors this; iOS Safari has ignored it since iOS
  // 10 for accessibility reasons, so this is a one-way improvement there,
  // never a regression.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${caprasimo.variable} ${figtree.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body
        // Anecdotally keeps Chrome's "Touch to Search" long-press banner
        // from covering the UI on some Android/Chrome versions — no
        // documented mechanism behind it (Chromium's own team says there's
        // no supported way to disable long-press Touch to Search short of
        // making text unselectable, which this app can't do — see
        // jwpub-chapter-view.tsx's whole highlight/note flow), so treat this
        // as a harmless, unverified try rather than a guaranteed fix.
        tabIndex={-1}
        className="min-h-full flex flex-col bg-background text-foreground font-sans"
      >
        <DeviceListener />
        {/* reloadOnOnline defaults to true and force-calls location.reload() on
            every "online" event — DeviceListener already handles reconnection
            gracefully via the offline outbox, so a full reload here would just
            discard in-progress state the outbox was designed to preserve. */}
        <SerwistProvider swUrl="/serwist/sw.js" reloadOnOnline={false}>
          <SwUpdateListener />
          <UpdateToast />
          {children}
          <Toaster />
        </SerwistProvider>
        <div id="vault-root" />
      </body>
    </html>
  );
}
