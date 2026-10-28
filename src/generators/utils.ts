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
    const contextOf = new Map<string, string>();
    const allVocab: Vocab[] = [];

    for (const lesson of kb.lessons) {
        for (const group of lesson.vocabGroups) {
            for (const vocab of group.items) {
                groupOf.set(vocab.id, group.id);

                const context =
                    vocab.context?.trim() ||
                    group.context?.trim();

                if (context) {
                    contextOf.set(vocab.id, context);
                }

                allVocab.push(vocab);
            }
        }
    }

    return { groupOf, contextOf, allVocab };
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

export function getVocabPrompt(
    v: Vocab,
    kb: KnowledgeBase,
    direction: "kr2zh" | "zh2kr"
): string {
    const { allVocab, contextOf } =
        buildVocabIndex(kb);

    // 韩→中：同一个韩语词是否具有不同中文释义
    // 中→韩：同一个中文释义是否对应不同韩语表达
    const ambiguous = allVocab.some(other => {
        if (direction === "kr2zh") {
            return (
                other.word === v.word &&
                other.meaning !== v.meaning
            );
        }

        return (
            other.meaning === v.meaning &&
            other.word !== v.word
        );
    });

    const raw =
        direction === "kr2zh" ? v.word : v.meaning;

    // 没有歧义：保持题目简洁
    if (!ambiguous) {
        return raw;
    }

    // 有歧义：必须提供明确的语境
    const context = contextOf.get(v.id);

    if (!context) {
        throw new Error(
            `词汇 ${v.id}（${v.word}）存在歧义，` +
            `但没有提供 context`
        );
    }

    return `${raw}（${context}）`;
}