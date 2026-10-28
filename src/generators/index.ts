import type { KnowledgeBase } from "../data/schema";
import type { GeneratedQuestion } from "./types";
import { genVocabKr2Zh, genVocabZh2Kr, genVocabFill } from "./vocab";
import { genGrammar } from "./grammar";
import { genTopic } from "./topic";

export { normalize, shuffle } from "./utils";

export function generateFor(
    kb: KnowledgeBase,
    unit: { lessonId: string; itemType: string; itemId: string; direction: string }
): GeneratedQuestion | null {
    const lesson = kb.lessons.find(l => l.id === unit.lessonId);
    if (!lesson) return null;

    // 1. 词汇模块
    if (unit.itemType === "vocab") {
        for (const g of lesson.vocabGroups) {
            const v = g.items.find(x => x.id === unit.itemId);
            if (!v) continue;
            if (unit.direction === "kr2zh") return genVocabKr2Zh(v, kb);
            if (unit.direction === "zh2kr") return genVocabZh2Kr(v, kb);
            if (unit.direction === "fill") return genVocabFill(v, kb);
        }
    }

    // 2. 语法模块
    if (unit.itemType === "grammar") {
        const g = lesson.grammars.find(x => x.id === unit.itemId);
        if (g) return genGrammar(g, unit.direction);
    }

    // 3. 对话模块
    if (unit.itemType === "topic") {
        const t = lesson.topics.find(x => x.id === unit.itemId);
        if (t) return genTopic(t);
    }

    return null;
}