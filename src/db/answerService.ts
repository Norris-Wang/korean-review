
import { db } from "./db";
import { schedule } from "../review/scheduler";
import type { ReviewUnit } from "../review/units";
import type { GeneratedQuestion } from "../generators/types";

/**
 * 将一次答题作为一个原子操作保存。
 *
 * 数据库更新成功：
 * - 学习单元状态更新
 * - 答题日志新增
 *
 * 数据库更新失败：
 * - 两项操作一起回滚
 */
export async function saveAnswer(
    unitKey: string,
    correct: boolean,
    questionType: GeneratedQuestion["type"]
): Promise<ReviewUnit> {
    return db.transaction(
        "rw",
        db.units,
        db.logs,
        async () => {
            const unit = await db.units.get(unitKey);

            if (!unit) {
                throw new Error(
                    `找不到复习单元：${unitKey}`
                );
            }

            // 创建副本，不直接修改原始对象
            const updated: ReviewUnit = { ...unit };

            // 根据答题结果更新复习状态
            schedule(updated, correct);

            // 两项写入在同一个事务中执行
            await db.units.put(updated);

            await db.logs.add({
                unitKey,
                correct,
                at: Date.now(),
                type: questionType
            });

            return updated;
        }
    );
}