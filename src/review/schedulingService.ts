
import { Rating } from "ts-fsrs";

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
    now = Date.now()
): ReviewUnit {
    const algorithm =
        unit.schedulingAlgorithm ?? "fixed";

    if (algorithm === "fixed") {
        const updated: ReviewUnit = { ...unit };

        // 第七阶段已经让 schedule 支持 now 参数
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

    // 暂时使用二元评分映射。
    // 下一阶段再支持 Hard / Easy。
    const rating = correct
        ? Rating.Good
        : Rating.Again;

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