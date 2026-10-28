
import type { KnowledgeBase } from "../data/schema";
import type { ReviewUnit } from "./units";

export type KnowledgeType = ReviewUnit["itemType"];

export interface ProgressCount {
    total: number;
    started: number;
    mastered: number;
    unavailable: number;
}

export interface LessonProgress extends ProgressCount {
    lessonId: string;
    title: string;
    percent: number;
    vocab: ProgressCount;
    grammar: ProgressCount;
    topic: ProgressCount;
}

// 当前版本的掌握标准
export const MASTERY_STAGE = 3;

// 不同知识类型的代表性练习方向
const MASTERY_DIRECTION: Record<KnowledgeType, string> = {
    vocab: "fill",
    grammar: "fill",
    topic: "order"
};

function emptyCount(): ProgressCount {
    return {
        total: 0,
        started: 0,
        mastered: 0,
        unavailable: 0
    };
}

function unitKey(
    lessonId: string,
    type: KnowledgeType,
    itemId: string
): string {
    return [
        lessonId,
        type,
        itemId,
        MASTERY_DIRECTION[type]
    ].join("|");
}

export function calculateProgress(
    kb: KnowledgeBase,
    units: Record<string, ReviewUnit>
): LessonProgress[] {
    return kb.lessons.map(lesson => {
        const vocab = emptyCount();
        const grammar = emptyCount();
        const topic = emptyCount();

        function countItem(
            type: KnowledgeType,
            itemId: string,
            available: boolean,
            target: ProgressCount
        ) {
            target.total++;

            if (!available) {
                target.unavailable++;
                return;
            }

            const unit = units[
                unitKey(lesson.id, type, itemId)
            ];

            if (!unit) {
                // 课程有该知识点，但数据库缺少复习单元
                target.unavailable++;
                return;
            }

            const hasStarted = Object.values(units).some(u =>
                u.lessonId === lesson.id &&
                u.itemType === type &&
                u.itemId === itemId &&
                u.seen > 0
            );

            if (hasStarted) {
                target.started++;
            }

            if (
                unit.seen > 0 &&
                unit.stage >= MASTERY_STAGE
            ) {
                target.mastered++;
            }
        }

        for (const group of lesson.vocabGroups) {
            for (const item of group.items) {
                countItem(
                    "vocab",
                    item.id,
                    true,
                    vocab
                );
            }
        }

        for (const item of lesson.grammars) {
            countItem(
                "grammar",
                item.id,
                item.examples.length > 0,
                grammar
            );
        }

        for (const item of lesson.topics) {
            countItem(
                "topic",
                item.id,
                true,
                topic
            );
        }

        const total =
            vocab.total +
            grammar.total +
            topic.total;

        const started =
            vocab.started +
            grammar.started +
            topic.started;

        const mastered =
            vocab.mastered +
            grammar.mastered +
            topic.mastered;

        const unavailable =
            vocab.unavailable +
            grammar.unavailable +
            topic.unavailable;

        return {
            lessonId: lesson.id,
            title: lesson.title,
            total,
            started,
            mastered,
            unavailable,
            percent: total > 0
                ? Math.round(mastered / total * 100)
                : 0,
            vocab,
            grammar,
            topic
        };
    });
}