"use client";

/**
 * Shared "please wait" animations for a file mid-upload/mid-ingest — used by
 * NoteCard (note-card.tsx) and the /jwlibrary import banner
 * (jwlibrary-notes-collection.tsx). The parent must be `relative overflow-hidden`
 * for either to clip to its rounded corners.
 */

/** Sheen sweeping across while a .jwpub/.jwlibrary is being parsed after upload. */
export function ProcessingShimmer() {
  return (
    <span
      aria-hidden
      className="animate-shimmer pointer-events-none absolute inset-0 bg-[length:200%_100%] bg-gradient-to-r from-transparent via-foreground/12 to-transparent"
    />
  );
}

/**
 * A wave that rises to fill the area as upload progresses (0-100, simulated —
 * see hooks/use-file-upload.ts, Server Actions don't expose real byte
 * progress) — monotonic, never dips back down. The horizontal ripple keeps
 * drifting continuously just for texture; only its height reflects actual
 * progress.
 */
export function UploadWaveProgress({ progress }: { progress: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <span
        className="absolute inset-x-0 bottom-0 transition-[top] duration-300 ease-out"
        style={{ top: `${100 - Math.max(0, Math.min(100, progress))}%` }}
      >
        <span className="absolute inset-x-0 bottom-0 top-2 bg-accent/15" />
        <svg
          className="animate-wave-scroll absolute inset-x-0 top-0 h-3 w-[200%] text-accent/30"
          viewBox="0 0 200 20"
          preserveAspectRatio="none"
        >
          <path d="M0 10 C 25 20, 75 0, 100 10 S 175 20, 200 10 L200 20 L0 20 Z" fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}
