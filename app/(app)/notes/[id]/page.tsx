import type { Metadata } from "next";
import { NoteEditor } from "@/components/content/note-editor";
import { JwpubReader } from "@/components/content/jwpub-reader";
import { getPublication } from "@/app/(app)/jwpub-actions";

export const metadata: Metadata = {
  title: "Nota — Study Notes",
};

export default async function NotePage(props: PageProps<"/notes/[id]">) {
  const { id } = await props.params;

  // An uploaded .jwpub gets the reader; everything else is a normal note.
  // Indexed by note_id, and returns nothing for plain notes.
  const { publication, chapters } = await getPublication(id);
  if (publication) {
    return (
      <JwpubReader noteId={id} initialPublication={publication} initialChapters={chapters ?? []} />
    );
  }

  return <NoteEditor noteId={id} />;
}
