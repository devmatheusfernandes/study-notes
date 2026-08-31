import type { Metadata } from "next";
import { NoteEditor } from "@/components/content/note-editor";

export const metadata: Metadata = {
  title: "Nota — Study Notes",
};

export default async function NotePage(props: PageProps<"/notes/[id]">) {
  const { id } = await props.params;
  return <NoteEditor noteId={id} />;
}
