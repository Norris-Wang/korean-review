
import type { Grade } from "ts-fsrs";

import { db, type ReviewDB } from "./db";

import type { ReviewUnit } from "../review/units";

import type { GeneratedQuestion } from "../generators/types";

import { calculateNextReview } from "../review/schedulingService";

/**
 * 向指定数据库保存一次答题。
 *
 * 正式环境使用主数据库；
 * 自动测试可以使用隔离数据库。
 *
 * 在同一个事务中：
 * 1. 读取最新复习状态
 * 2. 计算下一次复习
 * 3. 保存复习状态
 * 4. 写入答题日志
 */
export async function saveAnswerToDb(
    database: ReviewDB,
    unitKey: string,
    correct: boolean,
    questionType: GeneratedQuestion["type"],
    now = Date.now(),
    rating?: Grade
): Promise<ReviewUnit> {
    return database.transaction(
        "rw",
        database.units,
        database.logs,
        async () => {
            const unit = await database.units.get(
                unitKey
            );

            if (!unit) {
                throw new Error(
                    `找不到复习单元：${unitKey}`
                );
            }

            const algorithm =
                unit.schedulingAlgorithm ?? "fixed";

            // 纯同步计算，不在事务中执行其他异步任务
            const updated = calculateNextReview(
                unit,
                correct,
                now,
                rating
            );

            // 两次写入处于同一 IndexedDB 事务
            await database.units.put(updated);

            await database.logs.add({
                unitKey,
                correct,
                at: now,
                type: questionType,
                algorithm,

                ...(algorithm === "fsrs"
                    ? { rating }
                    : {})
            });

            return updated;
        }
    );
}

/**
 * 正式应用的统一保存入口。
 *
 * 保持原有调用签名不变，
 * 因此不必修改 useReviewSession 和 WrongBook。
 */
export function saveAnswer(
    unitKey: string,
    correct: boolean,
    questionType: GeneratedQuestion["type"],
    rating?: Grade
): Promise<ReviewUnit> {
    return saveAnswerToDb(
        db,
        unitKey,
        correct,
        questionType,
        Date.now(),
        rating
    );
}