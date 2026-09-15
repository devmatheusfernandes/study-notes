"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "saving";

export interface Recording {
  blob: Blob;
  durationMs: number;
  extension: "webm" | "mp4";
}

/**
 * Safari/iOS only produces `audio/mp4` — every other browser gets Opus in
 * WebM, which is several times smaller for speech. Picking here (rather than
 * assuming WebM) is what makes recording work on an iPad at all.
 */
function pickMimeType(): { mimeType: string; extension: "webm" | "mp4" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" as const },
    { mimeType: "audio/webm", extension: "webm" as const },
    { mimeType: "audio/mp4", extension: "mp4" as const },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
}

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Read synchronously by the canvas to stamp each stroke onto the recording's
   * timeline — a ref, not the state above, because a stroke starting between
   * two 200ms ticks must still land at its real moment.
   */
  const elapsedNow = useCallback(
    () => (startedAtRef.current === null ? undefined : performance.now() - startedAtRef.current),
    []
  );

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    startedAtRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<{ error?: string }> => {
    if (state !== "idle") return {};

    const picked = pickMimeType();
    if (!picked) return { error: "Este navegador não permite gravar áudio." };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      return { error: "Permissão de microfone negada." };
    }

    const recorder = new MediaRecorder(stream, { mimeType: picked.mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    // A timeslice keeps chunks flowing instead of buffering the whole take in
    // one blob, so a long recording doesn't sit entirely in memory.
    recorder.start(1000);
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    setState("recording");

    tickRef.current = setInterval(() => {
      if (startedAtRef.current !== null) setElapsedMs(performance.now() - startedAtRef.current);
    }, 200);

    return {};
  }, [state]);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const recorder = recorderRef.current;
    if (!recorder || state !== "recording") return null;

    setState("saving");
    const durationMs = elapsedNow() ?? 0;
    const extension = recorder.mimeType.includes("mp4") ? ("mp4" as const) : ("webm" as const);

    // Dropping the `;codecs=opus` suffix matters: Supabase validates a bucket's
    // allowedMimeTypes against the blob's *own* type, and the parameterized
    // form doesn't match the plain `audio/webm` the bucket allows (the same
    // trap uploadPublicationMedia hits with typeless zip entries).
    const baseMimeType = recorder.mimeType.split(";")[0];

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: baseMimeType }));
      recorder.stop();
    });

    cleanup();
    setState("idle");
    setElapsedMs(0);

    return { blob, durationMs, extension };
  }, [state, elapsedNow, cleanup]);

  return { state, elapsedMs, elapsedNow, start, stop };
}
