"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "paused" | "saving";

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
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Recorded time is summed per segment rather than measured from a single
   * start: pausing stops the audio advancing, so a wall-clock elapsed would
   * drift past it by however long the pause lasted — and every stroke stamped
   * after that would replay at the wrong moment.
   */
  const accumulatedRef = useRef(0);
  const segmentStartedAtRef = useRef<number | null>(null);

  /**
   * Read synchronously by the canvas to stamp each stroke onto the recording's
   * timeline — a ref, not the state above, because a stroke starting between
   * two 200ms ticks must still land at its real moment. `undefined` means
   * "no recording in progress", which is what makes a stroke always-visible.
   */
  const elapsedNow = useCallback(() => {
    if (segmentStartedAtRef.current === null) {
      // Paused still counts as "in this recording": ink drawn while paused
      // belongs at the moment the audio was paused, not outside the timeline.
      return recorderRef.current ? accumulatedRef.current : undefined;
    }
    return accumulatedRef.current + (performance.now() - segmentStartedAtRef.current);
  }, []);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    accumulatedRef.current = 0;
    segmentStartedAtRef.current = null;
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
    accumulatedRef.current = 0;
    segmentStartedAtRef.current = performance.now();
    setElapsedMs(0);
    setState("recording");

    tickRef.current = setInterval(() => setElapsedMs(elapsedNow() ?? 0), 200);

    return {};
  }, [state, elapsedNow]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    if (segmentStartedAtRef.current !== null) {
      accumulatedRef.current += performance.now() - segmentStartedAtRef.current;
      segmentStartedAtRef.current = null;
    }
    setElapsedMs(accumulatedRef.current);
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    segmentStartedAtRef.current = performance.now();
    setState("recording");
  }, []);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const recorder = recorderRef.current;
    if (!recorder || (state !== "recording" && state !== "paused")) return null;

    const durationMs = elapsedNow() ?? 0;
    setState("saving");
    const extension = recorder.mimeType.includes("mp4") ? ("mp4" as const) : ("webm" as const);

    // Dropping the `;codecs=opus` suffix matters: Supabase validates a bucket's
    // allowedMimeTypes against the blob's *own* type, and the parameterized
    // form doesn't match the plain `audio/webm` the bucket allows (the same
    // trap uploadPublicationMedia hits with typeless zip entries).
    const baseMimeType = recorder.mimeType.split(";")[0];

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: baseMimeType }));
      // A paused recorder still needs an explicit stop to flush its last chunk.
      recorder.stop();
    });

    cleanup();
    setState("idle");
    setElapsedMs(0);

    return { blob, durationMs, extension };
  }, [state, elapsedNow, cleanup]);

  return { state, elapsedMs, elapsedNow, start, pause, resume, stop };
}
