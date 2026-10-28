
import type { KnowledgeBase } from "./schema";

/**
 * 确保同形异义词、多种韩语表达具有足够的语境信息。
 * 在知识库加载完成后调用。
 */
export function assertVocabularyDisambiguation(
    kb: KnowledgeBase
): void {
    const entries = kb.lessons.flatMap(lesson =>
        lesson.vocabGroups.flatMap(group =>
            group.items.map(vocab => ({
                id: `${lesson.id}/${vocab.id}`,
                word: vocab.word,
                meaning: vocab.meaning,
                context:
                    vocab.context?.trim() ||
                    group.context?.trim() ||
                    ""
            }))
        )
    );

    for (const target of entries) {
        // 同一个韩语词，不同的中文含义
        const sameWord = entries.filter(other =>
            other.word === target.word &&
            other.meaning !== target.meaning
        );

        // 同一个中文含义，不同的韩语表达
        const sameMeaning = entries.filter(other =>
            other.meaning === target.meaning &&
            other.word !== target.word
        );

        const conflicts = [...sameWord, ...sameMeaning];

        if (conflicts.length === 0) {
            continue;
        }

        if (!target.context) {
            throw new Error(
                `词汇 ${target.id}（${target.word}）` +
                `存在歧义，请添加 context`
            );
        }

        // 即使添加了语境，也必须能区分不同答案
        for (const other of conflicts) {
            if (other.context === target.context) {
                throw new Error(
                    `词汇 ${target.id} 与 ${other.id} ` +
                    `答案不同，却使用了相同语境：` +
                    target.context
                );
            }
        }
    }
}