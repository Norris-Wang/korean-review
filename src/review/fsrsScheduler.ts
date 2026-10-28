
import {
    createEmptyCard,
    fsrs,
    Rating,
    type Card,
    type Grade
} from "ts-fsrs";

export { Rating };

/**
 * FSRS 的持久化格式。
 * Date 统一转换成毫秒时间戳。
 */
export type StoredFsrsCard =
    Omit<Card, "due" | "last_review"> & {
        due: number;
        last_review?: number;
    };

/**
 * 创建 FSRS 调度器。
 *
 * 关闭随机扰动，方便开发阶段验证。
 */
const engine = fsrs({
    request_retention: 0.9,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"]
});

/**
 * 把数据库中的卡片恢复为 FSRS Card。
 */
function restoreCard(
    stored: StoredFsrsCard
): Card {
    return {
        ...stored,
        due: new Date(stored.due),
        last_review:
            stored.last_review === undefined
                ? undefined
                : new Date(stored.last_review)
    };
}

/**
 * 将 FSRS Card 转换为可持久化数据。
 */
function serializeCard(
    card: Card
): StoredFsrsCard {
    const { due, last_review, ...rest } = card;

    return {
        ...rest,
        due: due.getTime(),
        ...(last_review
            ? { last_review: last_review.getTime() }
            : {})
    };
}

/**
 * 计算下一次复习状态。
 *
 * previous 为 null：第一次学习
 * previous 不为 null：继续已有 FSRS 记录
 *
 * 不修改输入对象，不写入数据库。
 */
export function calculateFsrsReview(
    previous: StoredFsrsCard | null,
    rating: Grade,
    now = Date.now()
): StoredFsrsCard {

    const currentCard = previous
        ? restoreCard(previous)
        : createEmptyCard(new Date(now));

    const result = engine.next(
        currentCard,
        new Date(now),
        rating
    );

    return serializeCard(result.card);
}