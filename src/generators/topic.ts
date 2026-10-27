import type { Topic } from "../data/schema";
import type { GeneratedQuestion } from "./types";
import { shuffle } from "./utils";

export function genTopic(t: Topic): GeneratedQuestion {
    return {
        type: "topic_order",
        prompt: "把下列对话按正确顺序排列",
        turns: shuffle(t.turns.map(x => ({ speaker: x.speaker, text: x.text }))),
        answer: t.turns.map(x => x.text).join("|"),
        explanation: "正确顺序：\n" + t.turns.map((x, i) => `${i + 1}. ${x.speaker}: ${x.text}`).join("\n"),
    };
}