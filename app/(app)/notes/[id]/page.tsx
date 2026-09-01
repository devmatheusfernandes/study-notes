import { Suspense } from "react";
import type { Metadata } from "next";
import { NoteEditor } from "@/components/content/note-editor";
import { JwpubReader } from "@/components/content/jwpub-reader";
import { PdfReader } from "@/components/content/pdf-reader";
import { getPublication } from "@/app/(app)/jwpub-actions";
import { getNoteRow } from "@/app/(app)/notes-actions";

export const metadata: Metadata = {
  title: "Nota — Study Notes",
};

export default async function NotePage(props: PageProps<"/notes/[id]">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const chapterParam = typeof searchParams?.chapter === "string" ? searchParams.chapter : undefined;

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
        />
      </Suspense>
    );
  }

  // An uploaded PDF gets the PdfReader.
  const note = await getNoteRow(id);
  if (note && (note.type === "pdf" || note.storagePath?.toLowerCase().endsWith(".pdf"))) {
    return <PdfReader noteId={id} initialNote={note} />;
  }

  return <NoteEditor noteId={id} />;
}

