import { Suspense } from "react";
import type { Metadata } from "next";
import { NoteEditor } from "@/components/content/note-editor";
import { JwpubReader } from "@/components/content/jwpub-reader";
import { PdfReader } from "@/components/content/pdf-reader";
import { DrawingNoteEditor } from "@/components/content/drawing-note-editor";
import { getPublication } from "@/app/(app)/jwpub-actions";
import { getNoteRow } from "@/app/(app)/notes-actions";
import { getDrawing } from "@/app/(app)/drawing-actions";

export const metadata: Metadata = {
  title: "Nota — Study Notes",
};

export default async function NotePage(props: PageProps<"/notes/[id]">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const chapterParam = typeof searchParams?.chapter === "string" ? searchParams.chapter : undefined;
  const docParam = typeof searchParams?.doc === "string" ? searchParams.doc : undefined;

  // An uploaded .jwpub gets the JwpubReader.
  const { publication, chapters } = await getPublication(id);
  if (publication) {
    return (
      <Suspense fallback={null}>
        <JwpubReader
          noteId={id}
          initialPublication={publication}
          initialChapters={chapters ?? []}
          initialChapterParam={chapterParam}
          initialDocParam={docParam}
        />
      </Suspense>
    );
  }

  // An uploaded PDF gets the PdfReader.
  const note = await getNoteRow(id);
  if (note && (note.type === "pdf" || note.storagePath?.toLowerCase().endsWith(".pdf"))) {
    return <PdfReader noteId={id} initialNote={note} />;
  }

  // A handwriting/drawing note gets the canvas editor instead of Tiptap.
  if (note?.type === "desenho") {
    const drawing = await getDrawing(id);
    return <DrawingNoteEditor noteId={id} initialNote={note} initialDrawing={drawing} />;
  }

  return <NoteEditor noteId={id} initialNote={note} />;
}

