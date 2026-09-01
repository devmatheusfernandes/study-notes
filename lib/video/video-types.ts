export interface GlobalVideo {
  id: string; // naturalKey from JW.org API (e.g. docid-702024001_1_VIDEO)
  title: string;
  categoryKey?: string;
  durationFormatted?: string;
  durationSeconds?: number;
  coverImage?: string;
  videoUrl?: string;
  subtitlesUrl?: string;
  contentText?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface TranscriptSegment {
  startTime: number; // in seconds
  startTimeFormatted: string; // MM:SS or HH:MM:SS
  text: string;
}

export interface VideoCrawlerItem {
  id: string;
  title: string;
  categoryKey: string;
  durationFormatted: string;
  durationSeconds: number;
  coverImage?: string;
  videoUrl?: string;
  subtitlesUrl?: string;
}
