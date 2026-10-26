export type QuestionType =
  | "vocab_mc_kr2zh"
  | "vocab_mc_zh2kr"
  | "vocab_fill"
  | "grammar_mc"
  | "grammar_fill"
  | "topic_order";

export interface GeneratedQuestion {
  type: QuestionType;
  prompt: string;
  choices?: string[];
  answer: string;
  accept?: string[];
  explanation: string;
  isFill?: boolean;
  turns?: { speaker: string; text: string }[];
}