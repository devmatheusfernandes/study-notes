import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Study Notes",
    short_name: "Study Notes",
    description: "Suas notas, arquivos e conversas em um só lugar — offline-first.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // No orientation lock: this is a notes app used in both portrait
    // (phone) and landscape (tablet, foldables, desktop-as-PWA) — locking
    // it would actively hurt those cases, so "any" (the default) is a
    // deliberate choice, not an omission.
    background_color: "#121110",
    theme_color: "#121110",
    lang: "pt-BR",
    categories: ["productivity", "education"],
    shortcuts: [
      {
        name: "Nova nota",
        url: "/notes/new",
        icons: [{ src: "/pwa-icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Buscar",
        url: "/notes?focus=search",
        icons: [{ src: "/pwa-icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    icons: [
      {
        src: "/pwa-icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icons/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // POST + multipart/form-data (not the simpler GET+urlencoded shape) is
    // required specifically to support sharing images, not just text/links.
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "images", accept: ["image/*"] }],
      },
    },
  };
}
