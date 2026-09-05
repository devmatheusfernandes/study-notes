import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadNoteImage } from "@/app/(app)/note-images-actions";

// Shared text/title/url arrive as plain strings from the OS share sheet, not
// HTML — escape rather than trying to sanitize them as markup.
function escapeHtml(raw: string) {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 303 downgrades to GET regardless of the original POST, so this doesn't
    // try to replay a multipart body through the login flow. Content is
    // dropped, not preserved — sharing into a signed-out installed PWA is
    // rare enough that a login round-trip carrying the payload isn't worth
    // the complexity; app/login/login-form.tsx surfaces a notice instead.
    return NextResponse.redirect(new URL("/login?shared=dropped", request.url), 303);
  }

  const formData = await request.formData();
  const title = formData.get("title");
  const text = formData.get("text");
  const url = formData.get("url");
  const images = formData.getAll("images").filter((v): v is File => v instanceof File);

  const imageTags: string[] = [];
  for (const image of images) {
    const uploadForm = new FormData();
    uploadForm.set("file", image);
    const result = await uploadNoteImage(uploadForm);
    if (result.url) imageTags.push(`<img src="${result.url}" alt="">`);
  }

  const textParts = [title, text, url]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => `<p>${escapeHtml(v)}</p>`);

  const bodyHtml = [...imageTags, ...textParts].join("");

  // Reuses the same /notes/new?q= flow the assistant dock's drag-to-create
  // gesture already uses, instead of inserting the note straight into
  // Postgres — that would bypass the client store's id generation and
  // offline-outbox bookkeeping (lib/store/notes-store.ts), leaving the note
  // server-persisted but invisible client-side until a full reload.
  const dest = new URL("/notes/new", request.url);
  if (bodyHtml) dest.searchParams.set("q", bodyHtml);
  return NextResponse.redirect(dest, 303);
}
