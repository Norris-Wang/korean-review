
import { Rating, type Grade } from "ts-fsrs";

import type { ReviewUnit } from "./units";

import { schedule } from "./scheduler";
import { calculateFsrsReview } from "./fsrsScheduler";

/**
 * 根据复习单元的算法标记计算下一次复习。
 *
 * fixed：旧固定间隔算法
 * fsrs：FSRS 自适应算法
 *
 * 不修改传入对象，不写入数据库。
 */
export function calculateNextReview(
    unit: ReviewUnit,
    correct: boolean,
    now = Date.now(),
    rating?: Grade
): ReviewUnit {
    const algorithm =
        unit.schedulingAlgorithm ?? "fixed";

    if (algorithm === "fixed") {

        if (rating !== undefined) {
            throw new Error(
                "固定间隔算法不接受 FSRS 评分"
            );
        }

        const updated: ReviewUnit = { ...unit };
        schedule(updated, correct, now);

        return updated;
    }

    if (algorithm !== "fsrs") {
        throw new Error(
            `不支持的复习算法：${algorithm}`
        );
    }

    /**
     * 防止已有学习记录在缺少 FSRS 状态时，
     * 被错误地当作全新卡片。
     */
    if (unit.seen > 0 && !unit.fsrsCard) {
        throw new Error(
            `复习单元 ${unit.key} 已有历史学习记录，` +
            "不能直接切换到 FSRS。"
        );
    }

    // FSRS 必须提供明确的最终评分
    if (rating === undefined) {
        throw new Error(
            `FSRS 复习单元 ${unit.key} 缺少评分`
        );
    }

    // 只接受四种正式复习评分
    const validRating =
        rating === Rating.Again ||
        rating === Rating.Hard ||
        rating === Rating.Good ||
        rating === Rating.Easy;

    if (!validRating) {
        throw new Error("无效的 FSRS 评分");
    }

    // 保证自动判题与评分结果一致
    const ratingMeansCorrect =
        rating !== Rating.Again;

    if (correct !== ratingMeansCorrect) {
        throw new Error(
            "答题正确性与 FSRS 评分不一致"
        );
    }

    const card = calculateFsrsReview(
        unit.fsrsCard ?? null,
        rating,
        now
    );

    if (!Number.isFinite(card.due)) {
        throw new Error(
            `FSRS 返回了无效的复习时间：${unit.key}`
        );
    }

    return {
        ...unit,

        schedulingAlgorithm: "fsrs",
        fsrsCard: card,

        // 兼容现有每日选题器
        dueAt: card.due,

        // 保留旧统计字段的计数含义
        seen: unit.seen + 1,
        lapses: unit.lapses + (correct ? 0 : 1),
        streak: correct ? unit.streak + 1 : 0

        // 暂不使用 FSRS 修改旧 stage。
        // 下一阶段会单独适配掌握度统计。
    };
}