import { create } from "zustand";
import type { ReviewUnit } from "../review/units";
import type { GeneratedQuestion } from "../generators/types";

interface SessionState {
  queue: ReviewUnit[];
  index: number;
  current: { unit: ReviewUnit; question: GeneratedQuestion } | null;
  answered: boolean;
  correctCount: number;
  start: (queue: ReviewUnit[], current: { unit: ReviewUnit; question: GeneratedQuestion } | null) => void;
  setCurrent: (c: { unit: ReviewUnit; question: GeneratedQuestion } | null) => void;
  setAnswered: (v: boolean) => void;
  incCorrect: () => void;
  next: () => void;
  reset: () => void;
}

export const useSession = create<SessionState>((set) => ({
  queue: [],
  index: 0,
  current: null,
  answered: false,
  correctCount: 0,
  start: (queue, current) => set({ queue, index: 0, current, answered: false, correctCount: 0 }),
  setCurrent: (current) => set({ current }),
  setAnswered: (answered) => set({ answered }),
  incCorrect: () => set((s) => ({ correctCount: s.correctCount + 1 })),
  next: () => set((s) => ({ index: s.index + 1, answered: false })),
  reset: () => set({ queue: [], index: 0, current: null, answered: false, correctCount: 0 }),
}));