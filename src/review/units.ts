import type { Lesson } from "../data/schema";
import type { StoredFsrsCard } from "./fsrsScheduler";

export interface ReviewUnit {
    key: string;
    lessonId: string;
    itemType: "vocab" | "grammar" | "topic";
    itemId: string;
    direction: string;
    stage: number;
    dueAt: number;
    streak: number;
    lapses: number;
    seen: number;
    schedulingAlgorithm?: "fixed" | "fsrs";
    fsrsCard?: StoredFsrsCard;
}

export function buildUnitsForLesson(lesson: Lesson): ReviewUnit[] {
    const now = Date.now();
    const units: ReviewUnit[] = [];
    const mk = (
        itemType: ReviewUnit["itemType"],
        itemId: string,
        direction: string
    ): ReviewUnit => ({
        key: `${lesson.id}|${itemType}|${itemId}|${direction}`,
        lessonId: lesson.id,
        itemType,
        itemId,
        direction,
        stage: 0,
        dueAt: now,
        streak: 0,
        lapses: 0,
        seen: 0,
    });

    for (const g of lesson.vocabGroups) {
        for (const v of g.items) {
            units.push(mk("vocab", v.id, "kr2zh"));
            units.push(mk("vocab", v.id, "zh2kr"));
            units.push(mk("vocab", v.id, "fill"));
        }
    }
    for (const g of lesson.grammars) {
        if (g.examples.length === 0) continue;
        units.push(mk("grammar", g.id, "mc"));
        units.push(mk("grammar", g.id, "fill"));
    }
    for (const t of lesson.topics) {
        units.push(mk("topic", t.id, "order"));
    }
    return units;
}