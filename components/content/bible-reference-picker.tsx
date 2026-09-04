"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listBibleBooks, getBibleChapterCount, getBibleVerseCount, type BibleBook } from "@/app/(app)/bible-actions";

export interface BibleReferenceValue {
  bookOrder: number | null;
  chapter: number | null;
  verse: number | null;
}

interface BibleReferencePickerProps {
  value: BibleReferenceValue;
  onChange: (value: BibleReferenceValue) => void;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** Cascading book → chapter → verse picker — no such picker existed anywhere in the app before Phase 2. */
export function BibleReferencePicker({ value, onChange }: BibleReferencePickerProps) {
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [chapterCount, setChapterCount] = useState<number | null>(null);
  const [verseCount, setVerseCount] = useState<number | null>(null);

  useEffect(() => {
    void listBibleBooks().then((result) => setBooks(result.books ?? []));
  }, []);

  useEffect(() => {
    if (value.bookOrder === null) {
      queueMicrotask(() => setChapterCount(null));
      return;
    }
    void getBibleChapterCount(value.bookOrder).then((result) => setChapterCount(result.count ?? null));
  }, [value.bookOrder]);

  useEffect(() => {
    if (value.bookOrder === null || value.chapter === null) {
      queueMicrotask(() => setVerseCount(null));
      return;
    }
    void getBibleVerseCount(value.bookOrder, value.chapter).then((result) => setVerseCount(result.count ?? null));
  }, [value.bookOrder, value.chapter]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select
        value={value.bookOrder !== null ? String(value.bookOrder) : ""}
        onValueChange={(v) => onChange({ bookOrder: Number(v), chapter: null, verse: null })}
      >
        <SelectTrigger className="flex-[2]">
          <SelectValue placeholder="Livro" />
        </SelectTrigger>
        <SelectContent>
          {books.map((b) => (
            <SelectItem key={b.bookOrder} value={String(b.bookOrder)}>
              {b.book}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.chapter !== null ? String(value.chapter) : ""}
        onValueChange={(v) => onChange({ ...value, chapter: Number(v), verse: null })}
      >
        <SelectTrigger disabled={!chapterCount}>
          <SelectValue placeholder="Cap." />
        </SelectTrigger>
        <SelectContent>
          {chapterCount &&
            range(chapterCount).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <Select
        value={value.verse !== null ? String(value.verse) : ""}
        onValueChange={(v) => onChange({ ...value, verse: Number(v) })}
      >
        <SelectTrigger disabled={!verseCount}>
          <SelectValue placeholder="Vers." />
        </SelectTrigger>
        <SelectContent>
          {verseCount &&
            range(verseCount).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
