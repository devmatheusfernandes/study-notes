import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
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
