import type { VideoCrawlerItem } from "./video-types";

interface VideoFile {
  mimetype?: string;
  frameHeight?: number;
  bitRate?: number;
  progressiveDownloadURL?: string;
  subtitles?: { url?: string };
}

interface JWMediaApiItem {
  naturalKey: string;
  title?: string;
  primaryCategory?: string;
  duration?: number;
  durationFormattedMinSec?: string;
  images?: {
    wss?: { lg?: string };
    pnr?: { lg?: string };
    sqr?: { lg?: string };
  };
  files?: VideoFile[];
}

interface JWCategoryApiResponse {
  category?: {
    key: string;
    media?: JWMediaApiItem[];
    subcategories?: { key: string }[];
  };
}

/** Picks the best MP4 progressive download URL (highest resolution, then highest bitrate) */
export function selectBestVideoUrl(files: VideoFile[] = []): string | undefined {
  const mp4s = files.filter((f) => (f.mimetype || "").includes("mp4"));
  if (mp4s.length === 0) return undefined;

  mp4s.sort((a, b) => {
    const ah = Number(a.frameHeight || 0);
    const bh = Number(b.frameHeight || 0);
    const ar = Number(a.bitRate || 0);
    const br = Number(b.bitRate || 0);
    if (bh !== ah) return bh - ah;
    return br - ar;
  });

  return mp4s[0]?.progressiveDownloadURL;
}

export async function fetchCategory(key: string): Promise<JWCategoryApiResponse | null> {
  const url = `https://b.jw-cdn.org/apis/mediator/v1/categories/T/${key}?detailed=1&mediaLimit=0&clientType=www`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Recursively crawls JW.org VideoOnDemand category tree for subtitled videos */
export async function crawlCategory(
  key: string = "VideoOnDemand",
  visited = new Set<string>()
): Promise<VideoCrawlerItem[]> {
  if (visited.has(key)) return [];
  visited.add(key);

  const data = await fetchCategory(key);
  const category = data?.category;
  if (!category) return [];

  const mediaList = Array.isArray(category.media) ? category.media : [];
  const results: VideoCrawlerItem[] = [];

  for (const video of mediaList) {
    const subtitlesUrl = (video.files || []).find((f) => f?.subtitles?.url)?.subtitles?.url;
    if (!subtitlesUrl) continue;

    const title = video.title || "";
    const coverImage =
      video.images?.wss?.lg || video.images?.pnr?.lg || video.images?.sqr?.lg || undefined;
    const videoUrl = selectBestVideoUrl(video.files || []);

    results.push({
      id: video.naturalKey,
      title,
      categoryKey: video.primaryCategory || key,
      durationFormatted: video.durationFormattedMinSec || "00:00",
      durationSeconds: video.duration || 0,
      coverImage,
      videoUrl,
      subtitlesUrl,
    });
  }

  const subcategories = Array.isArray(category.subcategories) ? category.subcategories : [];
  const subResults = await Promise.all(
    subcategories.map((sub) => crawlCategory(sub.key, visited))
  );

  return [...results, ...subResults.flat()];
}
