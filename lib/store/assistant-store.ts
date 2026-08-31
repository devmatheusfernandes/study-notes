import { create } from "zustand";

export interface AssistantSource {
  type: string;
  title: string;
}

interface AssistantStore {
  open: boolean;
  question: string;
  answer: string;
  sources: AssistantSource[];
  isLoading: boolean;
  start: (question: string) => void;
  resolve: (answer: string, sources: AssistantSource[]) => void;
  fail: (message: string) => void;
  close: () => void;
}

export const useAssistantStore = create<AssistantStore>((set) => ({
  open: false,
  question: "",
  answer: "",
  sources: [],
  isLoading: false,

  start: (question) => set({ open: true, question, answer: "", sources: [], isLoading: true }),
  resolve: (answer, sources) => set({ answer, sources, isLoading: false }),
  fail: (message) => set({ answer: message, sources: [], isLoading: false }),
  close: () => set({ open: false, isLoading: false }),
}));
