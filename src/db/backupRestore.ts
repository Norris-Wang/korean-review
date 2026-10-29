
import type { ReviewDB } from "./db";
import {
    validateLearningBackup
} from "./backupValidation";
import {
    canonicalDatabaseData,
    type TargetSnapshot
} from "./backupFingerprint";

export interface RestoreOptions {
    expectedTarget: {
        units: number;
        logs: number;
    };

    // 仅供测试使用，不能作为生产环境选项
    testFailAfter?: "clear" | "units" | "logs";
}

export interface RestoreResult {
    restoredUnits: number;
    restoredLogs: number;
    pendingLocalStorageKeys: number;
}

const TEST_DB_PREFIX = "yeshan-restore-test-";

/**
 * 11.1.4 专用测试版。
 *
 * 只允许恢复到独立测试库。
 * 严禁用于默认 korean-review 数据库。
 */
export async function restoreBackupToTestDb(
    database: ReviewDB,
    input: unknown,
    options: RestoreOptions
): Promise<RestoreResult> {
    // 首先检查目标库，不允许传入正式数据库。
    if (!database.name.startsWith(TEST_DB_PREFIX)) {
        throw new Error(
            "安全限制：仅允许恢复到 yeshan-restore-test- 开头的测试库"
        );
    }

    const expected = options.expectedTarget;

    if (
        !Number.isSafeInteger(expected.units) ||
        expected.units < 0 ||
        !Number.isSafeInteger(expected.logs) ||
        expected.logs < 0
    ) {
        throw new Error("目标数据库预期数量无效");
    }

    // 即使调用方已经校验，也必须在写入前重新校验。
    const validation = validateLearningBackup(input);

    if (!validation.valid || !validation.backup) {
        throw new Error(
            "备份校验失败，拒绝恢复"
        );
    }

    // 本阶段更严格：警告同样阻止恢复。
    // 特别是孤立日志不能静默写入。
    if (validation.issues.length > 0) {
        throw new Error(
            "备份包含未解决的校验警告，拒绝恢复"
        );
    }

    const backup = validation.backup;

    // 复制数据，避免恢复过程中调用方修改原始对象。
    // JSON 备份只应包含 JSON 可序列化值。
    const units = structuredClone(backup.data.units);
    const logs = structuredClone(backup.data.logs);

    // 事务内不要调用 fetch、setTimeout 或 localStorage。
    // Dexie 的事务仅覆盖 units 和 logs 两张表。
    await database.transaction(
        "rw",
        database.units,
        database.logs,
        async () => {
            // 在同一个事务中检查目标状态。
            const [unitCount, logCount] = await Promise.all([
                database.units.count(),
                database.logs.count()
            ]);

            if (
                unitCount !== expected.units ||
                logCount !== expected.logs
            ) {
                throw new Error(
                    "目标数据库已变化，请重新生成导入预览"
                );
            }

            // 先清理两个表。
            await database.units.clear();
            await database.logs.clear();

            if (options.testFailAfter === "clear") {
                throw new Error("TEST_FAILURE_AFTER_CLEAR");
            }

            // 然后完整恢复复习单元。
            if (units.length > 0) {
                await database.units.bulkAdd(units);
            }

            if (options.testFailAfter === "units") {
                throw new Error("TEST_FAILURE_AFTER_UNITS");
            }

            // 原样恢复自增日志 ID。
            if (logs.length > 0) {
                await database.logs.bulkAdd(logs);
            }

            if (options.testFailAfter === "logs") {
                throw new Error("TEST_FAILURE_AFTER_LOGS");
            }
        }
    );

    // 只有事务真正成功提交后才返回结果。
    return {
        restoredUnits: units.length,
        restoredLogs: logs.length,
        pendingLocalStorageKeys:
            Object.keys(backup.data.localStorage).length
    };
}


/**
 * 11.1.5 强化版测试恢复。
 * 使用完整目标快照检查数据变化。
 *
 * 只允许独立测试数据库。
 */
export async function restoreWithSnapshotToTestDb(
    database: ReviewDB,
    input: unknown,
    expected: TargetSnapshot,
    testWriteConflict = false
): Promise<RestoreResult> {
    if (
        !database.name.startsWith(
            "yeshan-restore-test-"
        )
    ) {
        throw new Error("拒绝恢复到非测试数据库");
    }

    const validation = validateLearningBackup(input);

    if (
        !validation.valid ||
        !validation.backup ||
        validation.issues.length > 0
    ) {
        throw new Error("备份未通过严格校验");
    }

    const backup = validation.backup;

    const units = structuredClone(backup.data.units);
    const logs = structuredClone(backup.data.logs);

    await database.transaction(
        "rw",
        database.units,
        database.logs,
        async () => {
            const [currentUnits, currentLogs] =
                await Promise.all([
                    database.units.toArray(),
                    database.logs.toArray()
                ]);

            // 在读写事务中比较完整内容，而不只是数量。
            const currentCanonical =
                canonicalDatabaseData(
                    currentUnits,
                    currentLogs
                );

            if (
                currentUnits.length !== expected.units ||
                currentLogs.length !== expected.logs ||
                currentCanonical !== expected.canonicalData
            ) {
                throw new Error(
                    "目标数据库内容已变化，必须重新预览"
                );
            }

            await database.units.clear();
            await database.logs.clear();

            if (units.length > 0) {
                await database.units.bulkAdd(units);
            }

            if (logs.length > 0) {
                await database.logs.bulkAdd(logs);
            }

            if (testWriteConflict) {
                // 真实重复主键写入：由 IndexedDB
                // 的唯一主键约束产生 ConstraintError。
                if (logs.length === 0) {
                    throw new Error(
                        "写入冲突测试需要至少一条日志"
                    );
                }

                await database.logs.add(
                    structuredClone(logs[0])
                );
            }
        }
    );

    return {
        restoredUnits: units.length,
        restoredLogs: logs.length,
        pendingLocalStorageKeys:
            Object.keys(backup.data.localStorage).length
    };
}