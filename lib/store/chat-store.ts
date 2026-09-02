import { create } from "zustand";

export interface ChatSource {
  noteId?: string;
  videoId?: string;
  type: string;
  title: string;
  chapterTitle?: string;
  documentId?: number;
  snippet?: string;
  videoUrl?: string;
  coverImage?: string;
  durationFormatted?: string;
  subtitlesUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  createdAt: number;
  isStreaming?: boolean;
}

export interface ChatConversation {
  id: string;
  title: string;
  status: "active" | "archived" | "trashed";
  updatedAt: number;
}

interface ChatStore {
  conversations: ChatConversation[];
  isLoaded: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  activeConversationId: string | null;

  setConversations: (conversations: ChatConversation[]) => void;
  addConversation: (conversation: ChatConversation) => void;
  removeConversation: (id: string) => void;
  updateConversation: (id: string, patch: Partial<ChatConversation>) => void;

  setMessages: (messages: ChatMessage[]) => void;
  addUserMessage: (content: string) => void;
  startAssistantStream: () => void;
  appendDelta: (content: string) => void;
  finishStream: (sources: ChatSource[]) => void;
  failStream: (errorMessage: string) => void;

  setActiveConversationId: (id: string | null) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  conversations: [],
  isLoaded: false,
  messages: [],
  isStreaming: false,
  activeConversationId: null,

  setConversations: (conversations) => set({ conversations, isLoaded: true }),

  addConversation: (conversation) =>
    set((s) => ({
      conversations: [conversation, ...s.conversations],
    })),

  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
    })),

  updateConversation: (id, patch) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    })),

  setMessages: (messages) => set({ messages }),

  addUserMessage: (content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `temp-${Date.now()}`,
          role: "user" as const,
          content,
          sources: [],
          createdAt: Date.now(),
        },
      ],
    })),

  startAssistantStream: () =>
    set((s) => ({
      isStreaming: true,
      messages: [
        ...s.messages,
        {
          id: `stream-${Date.now()}`,
          role: "assistant" as const,
          content: "",
          sources: [],
          createdAt: Date.now(),
          isStreaming: true,
        },
      ],
    })),

  appendDelta: (content) =>
    set((s) => ({
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.isStreaming
          ? { ...m, content: m.content + content }
          : m
      ),
    })),

  finishStream: (sources) =>
    set((s) => ({
      isStreaming: false,
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.isStreaming
          ? { ...m, isStreaming: false, sources }
          : m
      ),
    })),

  failStream: (errorMessage) =>
    set((s) => ({
      isStreaming: false,
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.isStreaming
          ? { ...m, isStreaming: false, content: errorMessage }
          : m
      ),
    })),

  setActiveConversationId: (id) => set({ activeConversationId: id }),
}));
