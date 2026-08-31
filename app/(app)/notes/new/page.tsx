import type { Metadata } from "next";
import { NoteEditor } from "@/components/content/note-editor";

export const metadata: Metadata = {
  title: "Nova nota — Study Notes",
};

export default async function NewNotePage(props: PageProps<"/notes/new">) {
  const { q, folder } = await props.searchParams;

  return (
    <NoteEditor
      initialBody={typeof q === "string" ? q : ""}
      folderId={typeof folder === "string" ? folder : undefined}
    />
  );
}
