import type { TranscriptSegment } from "./video-types";

/** Formats seconds into MM:SS or HH:MM:SS string */
export function formatSecondsToTimestamp(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return "00:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

/** Parses clean plain text from a WebVTT file string */
export function formatVttToText(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const paragraphs: string[] = [];
  let buffer = "";

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith("WEBVTT") || line.startsWith("NOTE") || line.startsWith("STYLE")) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;

    // Strip HTML/VTT tags like <c.colorE5E5E5> or <i>
    line = line.replace(/<[^>]+>/g, "").trim();
    if (!line) continue;

    if (buffer.length > 0) {
      buffer += " " + line;
    } else {
      buffer = line;
    }

    if (/[.!?…]$/.test(line)) {
      paragraphs.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer) paragraphs.push(buffer.trim());
  return paragraphs.join("\n\n");
}

/** Parses WebVTT file string into timed transcript segments */
export function parseVttToSegments(vtt: string): TranscriptSegment[] {
  const lines = vtt.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let currentStartTime: number | null = null;
  let currentBuffer = "";

  const timestampRegex = /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3}) -->/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE") || line.startsWith("STYLE")) continue;

    const tsMatch = line.match(timestampRegex);
    if (tsMatch) {
      const startStr = tsMatch[1];
      const parts = startStr.split(":");
      let seconds = 0;

      if (parts.length === 3) {
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const s = parseFloat(parts[2]);
        seconds = h * 3600 + m * 60 + s;
      } else if (parts.length === 2) {
        const m = parseInt(parts[0], 10);
        const s = parseFloat(parts[1]);
        seconds = m * 60 + s;
      }

      if (currentStartTime === null) {
        currentStartTime = seconds;
      }
      continue;
    }

    if (/^\d+$/.test(line)) continue;

    const cleanText = line.replace(/<[^>]+>/g, "").trim();
    if (!cleanText) continue;

    if (currentBuffer) {
      currentBuffer += " " + cleanText;
    } else {
      currentBuffer = cleanText;
    }

    if (/[.!?…]$/.test(cleanText) && currentStartTime !== null) {
      segments.push({
        startTime: currentStartTime,
        startTimeFormatted: formatSecondsToTimestamp(currentStartTime),
        text: currentBuffer.trim(),
      });
      currentStartTime = null;
      currentBuffer = "";
    }
  }

  if (currentBuffer && currentStartTime !== null) {
    segments.push({
      startTime: currentStartTime,
      startTimeFormatted: formatSecondsToTimestamp(currentStartTime),
      text: currentBuffer.trim(),
    });
  }

  return segments;
}
