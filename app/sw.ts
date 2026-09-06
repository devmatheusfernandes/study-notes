/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

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

// defaultCache has no dedicated rule for `.wasm` (no font/image/script/style
// extension matches it), so without this it falls all the way through to
// defaultCache's generic same-origin "others" bucket — sql.js's wasm binary
// (public/sql-wasm.wasm, loaded by lib/jwpub/parser.ts to parse .jwpub
// files in-browser) shared that same cache/key space as every other
// miscellaneous same-origin asset. That bucket is where a stale/bad response
// (e.g. an HTML page, from whatever ended up cached under this URL before
// proxy.ts's matcher was fixed to exclude .wasm from the auth check) can get
// stuck and keep being served instead of a fresh fetch — surfaces in the
// browser as `WebAssembly.instantiate(): expected magic word ... found
// 3c 21 44 4f` (the bytes for "<!DO", i.e. an HTML document instead of wasm).
// Giving it its own named cache sidesteps whatever's already sitting in
// "others" instead of trying to reason about invalidating that shared bucket.
const wasmCaching: RuntimeCaching = {
  matcher: /\.wasm$/i,
  handler: new NetworkFirst({
    cacheName: "wasm-assets",
    plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 30 * 24 * 60 * 60 })],
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
  runtimeCaching: [supabaseMediaCaching, wasmCaching, ...defaultCache],
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
