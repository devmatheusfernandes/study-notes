/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache, PAGES_CACHE_NAME } from "@serwist/turbopack/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig, SerwistPlugin } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

// Every RSC fetch Next's client router makes carries a `_rsc=<hash>` cache-busting
// query param derived from the current router state tree (see
// node_modules/next/dist/client/components/router-reducer/set-cache-busting-search-param.js),
// so the exact same page opened from a different navigation context hashes
// differently. defaultCache's pages-rsc(-prefetch) rules key their cache purely
// by request URL, so a page visited online under one hash is a guaranteed miss
// when reopened offline under another — the failed fetch then trips Next's
// nav-failure-handler into a hard `window.location.href` reload, which the SW
// has never cached a full HTML document for either, landing on /offline even
// for notes the user opened moments ago. Stripping `_rsc` before it's used as
// the cache key collapses every hash variant of the same URL onto one entry.
const stripRscCacheBuster: SerwistPlugin = {
  cacheKeyWillBeUsed: ({ request }) => {
    const url = new URL(request.url);
    url.searchParams.delete("_rsc");
    return url.href;
  },
};

// Shadow defaultCache's own pages-rsc(-prefetch) rules (matched first, so
// these win) — same matchers and cache names, just with the plugin above added.
const rscCacheKeyFix: RuntimeCaching[] = [
  {
    matcher: ({ request, url: { pathname }, sameOrigin }) =>
      request.headers.get("RSC") === "1" &&
      request.headers.get("Next-Router-Prefetch") === "1" &&
      sameOrigin &&
      !pathname.startsWith("/api/"),
    handler: new NetworkFirst({
      cacheName: PAGES_CACHE_NAME.rscPrefetch,
      plugins: [stripRscCacheBuster, new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
  {
    matcher: ({ request, url: { pathname }, sameOrigin }) =>
      request.headers.get("RSC") === "1" && sameOrigin && !pathname.startsWith("/api/"),
    handler: new NetworkFirst({
      cacheName: PAGES_CACHE_NAME.rsc,
      plugins: [stripRscCacheBuster, new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
];

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
  runtimeCaching: [supabaseMediaCaching, wasmCaching, ...rscCacheKeyFix, ...defaultCache],
  fallbacks: {
    entries: [
      // More specific — checked first. A failed /notes/<id> navigation (the
      // RSC fetch missed cache and Next's nav-failure-handler forced a hard
      // reload — see the rscCacheKeyFix comment above) gets a body that can
      // still render that exact note from the local offline-first store,
      // instead of the generic "you're offline" dead end. Never matches
      // /notes/new (handled fine on its own) or /notes itself (the list).
      {
        url: "/notes-offline",
        matcher({ request }) {
          const { pathname } = new URL(request.url);
          return request.destination === "document" && /^\/notes\/[^/]+$/.test(pathname);
        },
      },
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
