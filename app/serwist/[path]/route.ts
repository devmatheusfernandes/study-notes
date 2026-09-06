import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "app/sw.ts",
    useNativeEsbuild: true,
    additionalPrecacheEntries: [
      { url: "/", revision },
      { url: "/login", revision },
      { url: "/offline", revision },
      { url: "/notes", revision },
      // Fallback body for a failed /notes/<id> navigation while offline —
      // see the matcher in app/sw.ts's `fallbacks` config.
      { url: "/notes-offline", revision },
      { url: "/install", revision },
    ],
  });
