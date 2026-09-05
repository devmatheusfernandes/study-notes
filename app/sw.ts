/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// note-images and jwpub-media are both public-read, content-addressed-by-UUID
// Supabase Storage buckets (see lib/storage-config.ts) — stable URLs that
// never change once uploaded, so CacheFirst is safe. This runs before
// defaultCache because defaultCache's own image rule is a same-origin-only
// RegExp route and never matches these cross-origin *.supabase.co URLs.
// Extends the app's offline-first note text (lib/store/notes-store.ts) to
// the images referenced inside that same text.
const supabaseMediaCaching: RuntimeCaching = {
  matcher: ({ url }) => url.hostname.endsWith(".supabase.co") && url.pathname.includes("/storage/v1/object/public/"),
  handler: new CacheFirst({
    cacheName: "supabase-public-media",
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // false so a new SW sits in "waiting" until the user opts into the update
  // toast (see components/providers/sw-update-listener.tsx) instead of
  // silently taking over mid-session.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [supabaseMediaCaching, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
