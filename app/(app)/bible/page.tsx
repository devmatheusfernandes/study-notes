import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BibleReader } from "@/components/content/bible-reader";

export const metadata: Metadata = {
  title: "Bíblia — Study Notes",
};

interface BiblePageProps {
  searchParams: Promise<{ book?: string; chapter?: string; verse?: string }>;
}

export default async function BiblePage({ searchParams }: BiblePageProps) {
  const params = await searchParams;
  const initialBookOrder = params.book ? Number(params.book) : null;
  const initialChapter = params.chapter ? Number(params.chapter) : null;
  const initialVerse = params.verse ? Number(params.verse) : null;

  // BibleReader owns its whole header (its title changes with the current
  // book/chapter, unlike the shared <Header>'s static title) — so the user's
  // email is fetched here and passed down instead of rendering the shared
  // <Header>, whose UserMenu is an async Server Component and can't be
  // rendered from inside a Client Component.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <BibleReader
      initialBookOrder={initialBookOrder}
      initialChapter={initialChapter}
      initialVerse={initialVerse}
      userEmail={user?.email}
    />
  );
}
