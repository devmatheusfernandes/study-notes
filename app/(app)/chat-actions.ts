"use server";

import { createClient } from "@/lib/supabase/server";

export interface ChatConversationRow {
  id: string;
  title: string;
  status: "active" | "archived" | "trashed";
  updatedAt: number;
  lastMessage?: string;
}

export interface ChatSource {
  noteId: string;
  type: string;
  title: string;
  chapterTitle?: string;
  documentId?: number;
}

export interface ChatMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  createdAt: number;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function listConversations(): Promise<ChatConversationRow[]> {
  const { supabase, user } = await requireUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("chat_conversations")
    .select("id, title, status, updated_at")
    .in("status", ["active", "archived"])
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as ChatConversationRow["status"],
    updatedAt: new Date(row.updated_at).getTime(),
  }));
}

export async function createConversation(
  firstMessage: string
): Promise<{ conversationId?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const title = firstMessage.trim().slice(0, 60) || "Nova conversa";

  const { data: conversation, error: convError } = await supabase
    .from("chat_conversations")
    .insert({ user_id: user.id, title })
    .select("id")
    .single();

  if (convError || !conversation) return { error: "Não foi possível criar a conversa." };

  return { conversationId: conversation.id };
}

export async function addUserMessage(
  conversationId: string,
  content: string
): Promise<{ messageId?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  // Verify ownership via RLS
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("id", conversationId)
    .single();
  if (!conv) return { error: "Conversa não encontrada." };

  const { data: msg, error } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: content.trim(),
    })
    .select("id")
    .single();

  // Touch conversation updated_at
  await supabase
    .from("chat_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (error || !msg) return { error: "Não foi possível salvar a mensagem." };
  return { messageId: msg.id };
}

export async function getConversationMessages(
  conversationId: string
): Promise<{ messages: ChatMessageRow[]; title: string; status: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { messages: [], title: "", status: "active" };

  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("title, status")
    .eq("id", conversationId)
    .single();

  if (!conv) return { messages: [], title: "", status: "active" };

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, sources, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error || !data) return { messages: [], title: conv.title, status: conv.status };

  return {
    title: conv.title,
    status: conv.status,
    messages: data.map((row) => ({
      id: row.id,
      role: row.role as ChatMessageRow["role"],
      content: row.content,
      sources: (row.sources ?? []) as ChatSource[],
      createdAt: new Date(row.created_at).getTime(),
    })),
  };
}

export async function archiveConversation(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase
    .from("chat_conversations")
    .update({ status: "archived" })
    .eq("id", id);

  return error ? { error: "Não foi possível arquivar." } : {};
}

export async function restoreConversation(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase
    .from("chat_conversations")
    .update({ status: "active" })
    .eq("id", id);

  return error ? { error: "Não foi possível restaurar." } : {};
}

export async function deleteConversation(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("chat_conversations").delete().eq("id", id);
  return error ? { error: "Não foi possível excluir." } : {};
}

/** Settings "danger zone" — removes every conversation for this user (all statuses); `chat_messages` rows cascade via the FK. */
export async function deleteAllConversations(): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("chat_conversations").delete().not("id", "is", null);
  return error ? { error: "Não foi possível excluir as conversas." } : {};
}

export async function renameConversation(
  id: string,
  title: string
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase
    .from("chat_conversations")
    .update({ title: title.trim().slice(0, 120) })
    .eq("id", id);

  return error ? { error: "Não foi possível renomear." } : {};
}
