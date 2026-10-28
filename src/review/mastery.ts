
import { State } from "ts-fsrs";

import type { ReviewUnit } from "./units";

// 旧算法掌握标准
export const FIXED_MASTERY_STAGE = 3;

// FSRS 暂定掌握标准
export const FSRS_MASTERY_STABILITY_DAYS = 7;
export const FSRS_MASTERY_CORRECT_COUNT = 3;

/**
 * 判断一个复习单元当前是否达到掌握标准。
 *
 * 不修改数据。
 * 不依赖当前日期。
 * 不写数据库。
 */
export function isUnitMastered(
    unit: ReviewUnit | undefined
): boolean {
    if (!unit || unit.seen <= 0) {
        return false;
    }

    const algorithm =
        unit.schedulingAlgorithm ?? "fixed";

    // 旧记录继续使用原来的判断规则
    if (algorithm === "fixed") {
        return unit.stage >= FIXED_MASTERY_STAGE;
    }

    if (algorithm !== "fsrs") {
        return false;
    }

    const card = unit.fsrsCard;

    // 没有完整 FSRS 状态，不能标记为已掌握
    if (!card) {
        return false;
    }

    // 旧计数器记录的是总答题次数与错误次数
    const correctCount = unit.seen - unit.lapses;

    return (
        card.state === State.Review &&
        Number.isFinite(card.stability) &&
        card.stability >= FSRS_MASTERY_STABILITY_DAYS &&
        correctCount >= FSRS_MASTERY_CORRECT_COUNT
    );
}