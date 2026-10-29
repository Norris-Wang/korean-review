
import type { ReviewDB } from "./db";
import type { LearningBackup } from "./backupService";

export interface BackupImportPreview {
    source: {
        units: number;
        logs: number;
        localKeys: number;
    };
    target: {
        units: number;
        logs: number;
        localKeys: number;
    };
    comparison: {
        overlappingUnits: number;
        changedUnits: number;
        sourceOnlyUnits: number;
        targetOnlyUnits: number;
        duplicateLogIds: number;
        conflictingLogIds: number;
        sourceOnlyLogs: number;
        targetOnlyLogs: number;
        conflictingLocalKeys: number;
    };
    warnings: string[];
}

/**
 * 仅用来比较记录的字段和值。
 * 不用 JSON.stringify 的属性顺序判断相等。
 */
function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(",")}]`;
    }

    if (
        value !== null &&
        typeof value === "object"
    ) {
        const obj = value as Record<string, unknown>;

        return `{${Object.keys(obj)
            .sort()
            .map(key =>
                `${JSON.stringify(key)}:${canonical(obj[key])}`
            )
            .join(",")}}`;
    }

    return JSON.stringify(value) ?? "undefined";
}

/**
 * 比较备份与目标数据。
 * 不执行 add、put、delete、clear 或事务写入。
 *
 * 调用前必须先通过 validateLearningBackup()。
 */
export async function previewLearningBackupImport(
    backup: LearningBackup,
    database: ReviewDB,
    targetLocalStorage: Record<string, string>
): Promise<BackupImportPreview> {
    const { units, logs } = await database.transaction(
        "r",
        database.units,
        database.logs,
        async () => {
            const [units, logs] = await Promise.all([
                database.units.toArray(),
                database.logs.toArray()
            ]);

            return { units, logs };
        }
    );

    const sourceUnits = new Map(
        backup.data.units.map(unit => [unit.key, unit])
    );

    const targetUnits = new Map(
        units.map(unit => [unit.key, unit])
    );

    const sourceLogs = new Map(
        backup.data.logs.map(log => [log.id, log])
    );

    const targetLogs = new Map(
        logs.map(log => [log.id, log])
    );

    let overlappingUnits = 0;
    let changedUnits = 0;
    let sourceOnlyUnits = 0;

    for (const [key, source] of sourceUnits) {
        const target = targetUnits.get(key);

        if (!target) {
            sourceOnlyUnits++;
            continue;
        }

        overlappingUnits++;

        if (canonical(source) !== canonical(target)) {
            changedUnits++;
        }
    }

    let targetOnlyUnits = 0;

    for (const key of targetUnits.keys()) {
        if (!sourceUnits.has(key)) {
            targetOnlyUnits++;
        }
    }

    let duplicateLogIds = 0;
    let conflictingLogIds = 0;
    let sourceOnlyLogs = 0;

    for (const [id, source] of sourceLogs) {
        const target = targetLogs.get(id);

        if (!target) {
            sourceOnlyLogs++;
            continue;
        }

        duplicateLogIds++;

        if (canonical(source) !== canonical(target)) {
            conflictingLogIds++;
        }
    }

    let targetOnlyLogs = 0;

    for (const id of targetLogs.keys()) {
        if (!sourceLogs.has(id)) {
            targetOnlyLogs++;
        }
    }

    let conflictingLocalKeys = 0;

    for (
        const [key, sourceValue]
        of Object.entries(backup.data.localStorage)
    ) {
        if (
            Object.prototype.hasOwnProperty.call(
                targetLocalStorage, key
            ) &&
            targetLocalStorage[key] !== sourceValue
        ) {
            conflictingLocalKeys++;
        }
    }

    const warnings: string[] = [];

    if (changedUnits > 0) {
        warnings.push(
            `${changedUnits} 个同主键复习单元内容不同`
        );
    }

    if (conflictingLogIds > 0) {
        warnings.push(
            `${conflictingLogIds} 条日志存在同 ID 不同内容`
        );
    }

    if (targetOnlyLogs > 0) {
        warnings.push(
            `目标环境有 ${targetOnlyLogs} 条源备份没有的日志`
        );
    }

    if (conflictingLocalKeys > 0) {
        warnings.push(
            `${conflictingLocalKeys} 个每日学习记录键内容不同`
        );
    }

    return {
        source: {
            units: backup.data.units.length,
            logs: backup.data.logs.length,
            localKeys:
                Object.keys(backup.data.localStorage).length
        },
        target: {
            units: units.length,
            logs: logs.length,
            localKeys:
                Object.keys(targetLocalStorage).length
        },
        comparison: {
            overlappingUnits,
            changedUnits,
            sourceOnlyUnits,
            targetOnlyUnits,
            duplicateLogIds,
            conflictingLogIds,
            sourceOnlyLogs,
            targetOnlyLogs,
            conflictingLocalKeys
        },
        warnings
    };
}