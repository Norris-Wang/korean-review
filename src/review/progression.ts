
import type { ReviewUnit } from "./units";

type UnitMap = Map<string, ReviewUnit>;

export function getKnowledgeKey(
    unit: ReviewUnit
): string {
    return [
        unit.lessonId,
        unit.itemType,
        unit.itemId
    ].join("|");
}

/**
 * 当前数据模型中：
 * seen = 总答题次数
 * lapses = 答错次数
 *
 * 因此 seen > lapses 表示至少答对过一次。
 * 一旦解锁下一阶段，后续答错不会重新锁定。
 */
export function hasEverSucceeded(
    unit?: ReviewUnit
): boolean {
    return !!unit && unit.seen > unit.lapses;
}

/**
 * 判断一个复习方向是否已经开放。
 *
 * 只对全新的词汇练习方向实施进阶限制。
 * 已经练习过的方向继续保留，兼容旧数据。
 */
export function isDirectionUnlocked(
    unit: ReviewUnit,
    allUnits: UnitMap
): boolean {
    if (unit.itemType !== "vocab") {
        return true;
    }

    if (unit.seen > 0) {
        return true;
    }

    const prefix = [
        unit.lessonId,
        unit.itemType,
        unit.itemId
    ].join("|");

    if (unit.direction === "kr2zh") {
        return true;
    }

    const recognition = allUnits.get(
        `${prefix}|kr2zh`
    );

    if (unit.direction === "zh2kr") {
        return hasEverSucceeded(recognition);
    }

    if (unit.direction === "fill") {
        const recall = allUnits.get(
            `${prefix}|zh2kr`
        );

        return (
            hasEverSucceeded(recognition) &&
            hasEverSucceeded(recall)
        );
    }

    return false;
}

/**
 * 在三个尚未练习过的方向中，
 * 只开放当前应当学习的那个方向。
 *
 * 已经练习过的方向不受影响。
 */
export function getEligibleUnits(
    allUnits: ReviewUnit[]
): ReviewUnit[] {
    const unitMap = new Map(
        allUnits.map(unit => [unit.key, unit])
    );

    return allUnits.filter(unit =>
        isDirectionUnlocked(unit, unitMap)
    );
}