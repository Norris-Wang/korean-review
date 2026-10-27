import type { KnowledgeBase, Vocab } from "../data/schema";

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

// 构建词汇索引，用于找干扰项
export function buildVocabIndex(kb: KnowledgeBase) {
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

// 抽取干扰项
export function pickDistractors(
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