
import type { ReviewDB } from "./db";

export interface TargetSnapshot {
    units: number;
    logs: number;
    fingerprint: string;
    canonicalData: string;
}

function normalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalize);
    }

    if (
        value !== null &&
        typeof value === "object"
    ) {
        const object = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};

        for (const key of Object.keys(object).sort()) {
            result[key] = normalize(object[key]);
        }

        return result;
    }

    return value;
}

export function canonicalDatabaseData(
    units: unknown[],
    logs: unknown[]
): string {
    const orderedUnits = [...units].sort(
        (a, b) => String(
            (a as { key?: unknown }).key
        ).localeCompare(String(
            (b as { key?: unknown }).key
        ))
    );

    const orderedLogs = [...logs].sort(
        (a, b) => Number(
            (a as { id?: unknown }).id
        ) - Number(
            (b as { id?: unknown }).id
        )
    );

    return JSON.stringify(
        normalize({
            units: orderedUnits,
            logs: orderedLogs
        })
    );
}

export async function sha256(
    text: string
): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest(
        "SHA-256",
        bytes
    );

    return Array.from(
        new Uint8Array(digest),
        byte => byte.toString(16).padStart(2, "0")
    ).join("");
}

export async function createTargetSnapshot(
    database: ReviewDB
): Promise<TargetSnapshot> {
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

    const canonicalData = canonicalDatabaseData(
        units,
        logs
    );

    return {
        units: units.length,
        logs: logs.length,
        canonicalData,
        fingerprint: await sha256(canonicalData)
    };
}