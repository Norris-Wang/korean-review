
/**
 * 默认调度算法配置。
 *
 * 注意：
 * 1. 只决定未来新创建单元的算法。
 * 2. 不修改数据库中已经存在的单元。
 * 3. 关闭开关也不会转换已有 FSRS 单元。
 */

export type SchedulingAlgorithm =
    "fixed" | "fsrs";

// 正式启用前保持 false
export const ENABLE_FSRS_FOR_NEW_UNITS = true;

export function getDefaultSchedulingAlgorithm():
    SchedulingAlgorithm {
    return ENABLE_FSRS_FOR_NEW_UNITS
        ? "fsrs"
        : "fixed";
}