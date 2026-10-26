import type { KnowledgeBase, Vocab, GrammarExample } from "../data/schema";
import type { GeneratedQuestion } from "./types";

export function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function normalize(s: string): string {
    return String(s).trim().replace(/\s+/g, " ").replace(/[.?!。？！]+$/g, "").toLowerCase();
}

function buildIndex(kb: KnowledgeBase) {
    const groupOf = new Map<string, string>();
    const allVocab: Vocab[] = [];
    for (const l of kb.lessons) {
        for (const g of l.vocabGroups) {
            for (const v of g.items) {
                groupOf.set(v.id, g.id);
                allVocab.push(v);
            }
        }
    }
    return { groupOf, allVocab };
}

function pickDistractors(
    target: Vocab,
    allVocab: Vocab[],
    groupOf: Map<string, string>,
    n: number,
    useMeaning: boolean
): string[] {
    const field = useMeaning ? "meaning" : "word";
    const targetVal = target[field];
    const targetGroup = groupOf.get(target.id);
    const sameGroup = allVocab.filter(v => v.id !== target.id && groupOf.get(v.id) === targetGroup);
    const others = allVocab.filter(v => v.id !== target.id && groupOf.get(v.id) !== targetGroup);
    const pool = [...shuffle(sameGroup), ...shuffle(others)];
    const out: string[] = [];
    const used = new Set([targetVal]);
    for (const v of pool) {
        const val = v[field];
        if (used.has(val)) continue;
        used.add(val);
        out.push(val);
        if (out.length === n) break;
    }
    return out;
}

export function generateFor(
    kb: KnowledgeBase,
    unit: { lessonId: string; itemType: string; itemId: string; direction: string }
): GeneratedQuestion | null {
    const lesson = kb.lessons.find(l => l.id === unit.lessonId);
    if (!lesson) return null;
    const { groupOf, allVocab } = buildIndex(kb);

    if (unit.itemType === "vocab") {
        for (const g of lesson.vocabGroups) {
            const v = g.items.find(x => x.id === unit.itemId);
            if (!v) continue;
            if (unit.direction === "kr2zh") {
                return {
                    type: "vocab_mc_kr2zh",
                    prompt: v.word,
                    choices: shuffle([v.meaning, ...pickDistractors(v, allVocab, groupOf, 3, true)]),
                    answer: v.meaning,
                    explanation: `${v.word} = ${v.meaning}`,
                };
            }
            if (unit.direction === "zh2kr") {
                return {
                    type: "vocab_mc_zh2kr",
                    prompt: v.meaning,
                    choices: shuffle([v.word, ...pickDistractors(v, allVocab, groupOf, 3, false)]),
                    answer: v.word,
                    explanation: `${v.meaning} = ${v.word}`,
                };
            }
            if (unit.direction === "fill") {
                return {
                    type: "vocab_fill",
                    prompt: `${v.meaning}`,
                    answer: v.word,
                    accept: [v.word],
                    explanation: `${v.meaning} = ${v.word}`,
                    isFill: true,
                };
            }
        }
    }

    if (unit.itemType === "grammar") {
        const g = lesson.grammars.find(x => x.id === unit.itemId);
        if (g) {
            const ex: GrammarExample = g.examples[Math.floor(Math.random() * g.examples.length)];
            const hintPrefix = ex.hint ? `【${ex.hint}】\n` : "";
            const dictHint = ex.dictionaryForm ? `（${ex.dictionaryForm}）` : "";
            const promptText = hintPrefix + ex.sentence.replace(ex.focus, `＿＿＿${dictHint}`);
            const explanation = `${g.name}：${g.function}\n例句：${ex.sentence}${ex.translation ? " — " + ex.translation : ""}`;

            if (unit.direction === "mc" && ex.choices && ex.choices.length > 0) {
                return {
                    type: "grammar_mc",
                    prompt: promptText,
                    choices: shuffle([ex.answer, ...ex.choices.filter(c => c !== ex.answer).slice(0, 3)]),
                    answer: ex.answer,
                    explanation,
                };
            }

            // 否则出填空题（填答案，或者填词干变形）
            return {
                type: "grammar_fill",
                prompt: promptText,
                answer: ex.answer,
                accept: ex.accept || [ex.answer],
                explanation,
                isFill: true,
            };
        }
    }

    if (unit.itemType === "topic") {
        const t = lesson.topics.find(x => x.id === unit.itemId);
        if (t) {
            return {
                type: "topic_order",
                prompt: "把下列对话按正确顺序排列",
                turns: shuffle(t.turns.map(x => ({ speaker: x.speaker, text: x.text }))),
                answer: t.turns.map(x => x.text).join("|"),
                explanation: "正确顺序：\n" + t.turns.map((x, i) => `${i + 1}. ${x.speaker}: ${x.text}`).join("\n"),
            };
        }
    }

    return null;
}