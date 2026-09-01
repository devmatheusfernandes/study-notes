import { create } from "zustand";

export interface AssistantSource {
  noteId?: string;
  type: string;
  title: string;
  chapterTitle?: string;
  documentId?: number;
}

interface AssistantStore {
  open: boolean;
  question: string;
  answer: string;
  sources: AssistantSource[];
  isLoading: boolean;
  isStreaming: boolean;
  start: (question: string) => void;
  appendDelta: (delta: string) => void;
  setSources: (sources: AssistantSource[]) => void;
  finishStream: () => void;
  resolve: (answer: string, sources: AssistantSource[]) => void;
  fail: (message: string) => void;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  close: () => void;
}

export const useAssistantStore = create<AssistantStore>((set) => ({
  open: false,
  question: "",
  answer: "",
  sources: [],
  isLoading: false,
  isStreaming: false,

  start: (question) =>
    set({
      open: true,
      question,
      answer: "",
      sources: [],
      isLoading: true,
      isStreaming: true,
    }),

  appendDelta: (delta) =>
    set((s) => ({
      answer: s.answer + delta,
      isLoading: false,
    })),

  setSources: (sources) => set({ sources }),

  finishStream: () => set({ isLoading: false, isStreaming: false }),

  resolve: (answer, sources) =>
    set({ answer, sources, isLoading: false, isStreaming: false }),

  fail: (message) =>
    set({ answer: message, sources: [], isLoading: false, isStreaming: false }),

  setOpen: (open) => set({ open }),

  toggleOpen: () => set((s) => ({ open: !s.open })),

  close: () => set({ open: false, isLoading: false, isStreaming: false }),
}));
