import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Slices `items` into batches whose *summed* size never exceeds `maxBytes` —
 * unlike a fixed row count, this stays safe regardless of how unevenly sized
 * the items are (a plain jwpub citation/chapter can be a few hundred bytes;
 * one with an embedded excerpt or a long encyclopedia entry can run past
 * 50KB). A single item larger than `maxBytes` still gets its own batch
 * rather than being dropped or split. Used by the Settings cards that import
 * shared global content in batched Server Action calls (Guia de Pesquisa,
 * Perspicaz) to stay under Vercel's ~4.5MB request-body cap.
 */
export function batchBySize<T>(items: T[], sizeOf: (item: T) => number, maxBytes: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const size = sizeOf(item);
    if (current.length > 0 && currentBytes + size > maxBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);

  return batches;
}

