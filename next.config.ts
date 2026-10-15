import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const isDev = process.env.NODE_ENV === "development";

// Static CSP on purpose, not the per-request nonce variant: the service worker
// precaches `/`, `/login` and `/offline` as HTML, and a precached page carrying a
// stale nonce would have its own scripts blocked when served offline. So scripts
// keep 'unsafe-inline' (Next's bootstrap scripts), and the policy's value is in
// everything else: no third-party script origins, no plugins, no framing, no
// base-tag or form-action hijacking, and network/frame access limited to the
// origins this app actually talks to.
const supabaseHosts = "https://*.supabase.co";
const jwHosts = "https://*.jw.org https://*.jw-cdn.org";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Images in notes/publications can come from jw.org's CDNs and Supabase; data/blob for pasted and generated ones.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Supabase REST/Realtime/Storage uploads; jw.org for subtitles/video metadata fetched from the browser.
  `connect-src 'self' ${supabaseHosts} wss://*.supabase.co ${jwHosts}`,
  // Videos stream straight from JW's CDN hosts, which vary by region.
  "media-src 'self' blob: https:",
  // The PDF reader frames a Supabase signed URL.
  `frame-src 'self' blob: ${supabaseHosts}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone is the note recorder's; camera/location/etc. are never used. `publickey-credentials-get` keeps WebAuthn available for a future biometric unlock.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker needs to be fetched fresh and must never be framed/sniffed differently.
      {
        source: "/serwist/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Up to MAX_FILES_PER_BATCH (5) files at MAX_FILE_SIZE (15 MB) each,
      // plus multipart overhead — see lib/storage-config.ts.
      bodySizeLimit: "80mb",
    },
    // proxy.ts runs on the upload routes too (for the auth check) and buffers
    // the request body independently, defaulting to 10MB — below our upload
    // limit, which silently truncated multipart bodies instead of erroring.
    // Keep this matched to serverActions.bodySizeLimit.
    proxyClientMaxBodySize: "80mb",
  },
};

export default withSerwist(nextConfig);
